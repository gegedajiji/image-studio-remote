import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  creditLogs,
  generations,
  legacyApiKeys,
  modelPricing,
  upstreams,
  users,
} from "@db/schema";
import { getDb } from "./queries/connection";
import { callUpstream } from "./imageService";
import {
  classifyGenerationFailure,
  getRawGenerationError,
  refundedGenerationMessage,
} from "./generationError";

/**
 * 开放 API（REST）：/api/v1/*
 * 鉴权：Authorization: Bearer <apiKey>（在「账号设置」中生成）
 */
export const openApi = new Hono();

async function authByApiKey(req: Request) {
  const header = req.headers.get("authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const [u] = await getDb().select().from(users).where(eq(users.apiKey, token));
  if (u) return u;

  const keyHash = createHash("sha256").update(token).digest("hex");
  const [legacyKey] = await getDb()
    .select()
    .from(legacyApiKeys)
    .where(
      and(
        eq(legacyApiKeys.keyHash, keyHash),
        eq(legacyApiKeys.status, "active"),
      ),
    );
  if (!legacyKey) return null;

  await getDb()
    .update(legacyApiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(legacyApiKeys.id, legacyKey.id));
  const [legacyUser] = await getDb()
    .select()
    .from(users)
    .where(eq(users.id, legacyKey.userId));
  return legacyUser ?? null;
}

openApi.post("/images/generations", async (c) => {
  const user = await authByApiKey(c.req.raw);
  if (!user) return c.json({ error: { message: "无效的 API Key" } }, 401);
  if (user.status === "banned") return c.json({ error: { message: "账号已被禁用" } }, 403);

  const body = (await c.req.json().catch(() => null)) as {
    prompt?: string;
    negative_prompt?: string;
    model?: string;
    size?: string;
  } | null;
  if (!body?.prompt) return c.json({ error: { message: "prompt 为必填参数" } }, 400);

  const db = getDb();
  // 找到价格配置（按 model + size，或该 model 默认项）
  const pricings = await db
    .select()
    .from(modelPricing)
    .where(eq(modelPricing.enabled, true));
  let pricing = pricings.find((p) => p.model === (body.model ?? "") && `${p.width}x${p.height}` === (body.size ?? ""));
  pricing ??= pricings.find((p) => p.model === body.model) ?? pricings[0];
  if (!pricing) return c.json({ error: { message: "服务暂不可用" } }, 503);

  const upstream = (
    await db
      .select()
      .from(upstreams)
      .where(and(eq(upstreams.enabled, true), eq(upstreams.model, pricing.model)))
      .orderBy(desc(upstreams.priority))
  )[0];
  if (!upstream) return c.json({ error: { message: "暂无可用上游" } }, 503);

  if (user.quota < pricing.price) {
    return c.json({ error: { message: `额度不足，需 ${pricing.price} 积分` } }, 402);
  }

  // 扣费
  await db.transaction(async (tx) => {
    const [u] = await tx.select().from(users).where(eq(users.id, user.id));
    const next = u.quota - pricing.price;
    await tx.update(users).set({ quota: next }).where(eq(users.id, user.id));
    await tx.insert(creditLogs).values({
      userId: user.id,
      amount: -pricing.price,
      balanceAfter: next,
      type: "generate",
      remark: `API 生图·${pricing.label}`,
    });
  });

  const [{ id }] = await db
    .insert(generations)
    .values({
      userId: user.id,
      prompt: body.prompt,
      negativePrompt: body.negative_prompt ?? null,
      model: pricing.model,
      width: pricing.width,
      height: pricing.height,
      cost: pricing.price,
      status: "pending",
    })
    .$returningId();

  try {
    const result = await callUpstream(upstream, {
      prompt: body.prompt,
      negativePrompt: body.negative_prompt,
      width: pricing.width,
      height: pricing.height,
    });
    await db
      .update(generations)
      .set({ status: "success", imageUrl: result.imageUrl })
      .where(eq(generations.id, id));
    return c.json({
      id,
      model: pricing.model,
      size: `${pricing.width}x${pricing.height}`,
      cost: pricing.price,
      data: [{ url: result.imageUrl }],
    });
  } catch (err) {
    const msg = getRawGenerationError(err);
    const failure = classifyGenerationFailure(err);
    console.error("[open-api] upstream request failed", {
      generationId: id,
      userId: user.id,
      upstreamId: upstream.id,
      error: msg.slice(0, 500),
    });
    await db
      .update(generations)
      .set({ status: "failed", errorMsg: msg.slice(0, 500) })
      .where(eq(generations.id, id));
    // 退款
    await db.transaction(async (tx) => {
      const [u] = await tx.select().from(users).where(eq(users.id, user.id));
      const next = u.quota + pricing.price;
      await tx.update(users).set({ quota: next }).where(eq(users.id, user.id));
      await tx.insert(creditLogs).values({
        userId: user.id,
        amount: pricing.price,
        balanceAfter: next,
        type: "refund",
        remark: "API 生图失败退款",
      });
    });
    return c.json(
      {
        error: {
          code: failure.code,
          message: refundedGenerationMessage(err),
        },
        refunded: true,
      },
      failure.httpStatus
    );
  }
});
