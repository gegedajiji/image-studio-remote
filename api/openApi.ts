import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  creditLogs,
  generations,
  legacyApiKeys,
  modelPricing,
  upstreams,
  users,
} from "@db/schema";
import { getDb } from "./queries/connection";
import {
  callUpstreamWithFallback,
  removeStoredGeneratedImage,
  resolveGeneratedImageDimensions,
} from "./imageService";
import {
  classifyGenerationFailure,
  getRawGenerationError,
  refundedGenerationMessage,
} from "./generationError";
import {
  IMAGE_2_SIZE_SOURCE_MODEL,
  isImage25Model,
  resolveGenerationDimensions,
} from "./generationSize";

/**
 * 开放 API（REST）：/api/v1/*
 * 鉴权：Authorization: Bearer <apiKey>（在「账号设置」中生成）
 */
export const openApi = new Hono();

const imageGenerationInputSchema = z.object({
  prompt: z.string().trim().min(1, "prompt 为必填参数").max(2000),
  negative_prompt: z.string().trim().max(2000).optional(),
  model: z.string().trim().min(1).max(255).optional(),
  size: z
    .string()
    .regex(/^\d{2,4}x\d{2,4}$/, "size 必须是 WxH 格式")
    .optional(),
});

function absoluteImageUrl(
  c: { req: { url: string; header(name: string): string | undefined } },
  imageUrl: string
) {
  if (/^https?:\/\//i.test(imageUrl)) return imageUrl;
  try {
    const requestUrl = new URL(c.req.url);
    const forwardedProto = c.req
      .header("x-forwarded-proto")
      ?.split(",", 1)[0]
      ?.trim();
    const forwardedHost = c.req
      .header("x-forwarded-host")
      ?.split(",", 1)[0]
      ?.trim();
    const origin = forwardedHost
      ? `${forwardedProto === "https" ? "https" : "http"}://${forwardedHost}`
      : requestUrl.origin;
    return new URL(imageUrl, origin).toString();
  } catch {
    return imageUrl;
  }
}

function isUsablePricing(pricing: (typeof modelPricing)["$inferSelect"]) {
  return (
    Number.isInteger(pricing.width) &&
    Number.isInteger(pricing.height) &&
    pricing.width >= 64 &&
    pricing.height >= 64 &&
    pricing.width <= 4096 &&
    pricing.height <= 4096 &&
    Number.isInteger(pricing.price) &&
    pricing.price >= 0
  );
}

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
        eq(legacyApiKeys.status, "active")
      )
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

openApi.post("/images/generations", async c => {
  const user = await authByApiKey(c.req.raw);
  if (!user) return c.json({ error: { message: "无效的 API Key" } }, 401);
  if (user.status === "banned")
    return c.json({ error: { message: "账号已被禁用" } }, 403);

  const parsedBody = imageGenerationInputSchema.safeParse(
    await c.req.json().catch(() => null)
  );
  if (!parsedBody.success) {
    return c.json(
      {
        error: {
          message: parsedBody.error.issues[0]?.message ?? "请求参数无效",
        },
      },
      400
    );
  }
  const body = parsedBody.data;

  const db = getDb();
  // 找到价格配置（按 model + size，或该 model 默认项）
  const pricings = await db
    .select()
    .from(modelPricing)
    .where(eq(modelPricing.enabled, true));
  const requestedModelPricings = body.model
    ? pricings.filter(p => p.model === body.model)
    : [];
  const pricing =
    body.model && body.size
      ? (requestedModelPricings.find(
          p => `${p.width}x${p.height}` === body.size
        ) ??
        (isImage25Model(body.model) ? requestedModelPricings[0] : undefined))
      : body.model
        ? requestedModelPricings[0]
        : body.size
          ? pricings.find(p => `${p.width}x${p.height}` === body.size)
          : pricings[0];
  if (!pricing) return c.json({ error: { message: "服务暂不可用" } }, 503);
  if (!isUsablePricing(pricing)) {
    return c.json({ error: { message: "服务暂不可用" } }, 503);
  }

  const [requestedWidth, requestedHeight] = body.size
    ? body.size.split("x").map(Number)
    : [undefined, undefined];
  let requestedDimensions: { width: number; height: number };
  try {
    requestedDimensions = resolveGenerationDimensions(
      pricing,
      { width: requestedWidth, height: requestedHeight },
      pricings
        .filter(item => item.model === IMAGE_2_SIZE_SOURCE_MODEL)
        .map(item => ({ width: item.width, height: item.height }))
    );
  } catch (error) {
    return c.json(
      {
        error: {
          message: error instanceof Error ? error.message : "所选尺寸不可用",
        },
      },
      400
    );
  }
  const generationLabel = isImage25Model(pricing.model)
    ? `${pricing.label.split(" · ", 1)[0]} · ${requestedDimensions.width}×${requestedDimensions.height}`
    : pricing.label;

  const upstreamList = await db
    .select()
    .from(upstreams)
    .where(and(eq(upstreams.enabled, true), eq(upstreams.model, pricing.model)))
    .orderBy(desc(upstreams.priority));
  if (!upstreamList.length)
    return c.json({ error: { message: "暂无可用上游" } }, 503);

  // 锁定用户、扣费和创建 pending 记录在同一事务中，避免并发超扣或插入失败漏扣。
  let id: number;
  try {
    id = await db.transaction(async tx => {
      const [u] = await tx
        .select()
        .from(users)
        .where(eq(users.id, user.id))
        .for("update");
      if (!u) throw new Error("用户不存在");
      if (u.status === "banned") throw new Error("账号已被禁用");
      if (u.quota < pricing.price) {
        const error = new Error(`额度不足，需 ${pricing.price} 积分`);
        error.name = "QuotaError";
        throw error;
      }
      const next = u.quota - pricing.price;
      await tx.update(users).set({ quota: next }).where(eq(users.id, user.id));
      await tx.insert(creditLogs).values({
        userId: user.id,
        amount: -pricing.price,
        balanceAfter: next,
        type: "generate",
        remark: `API 生图·${generationLabel}`,
      });
      const [{ id: generationId }] = await tx
        .insert(generations)
        .values({
          userId: user.id,
          prompt: body.prompt,
          negativePrompt: body.negative_prompt ?? null,
          model: pricing.model,
          width: requestedDimensions.width,
          height: requestedDimensions.height,
          cost: pricing.price,
          status: "pending",
        })
        .$returningId();
      return generationId;
    });
  } catch (error) {
    if (error instanceof Error && error.name === "QuotaError") {
      return c.json({ error: { message: error.message } }, 402);
    }
    if (error instanceof Error && error.message === "账号已被禁用") {
      return c.json({ error: { message: error.message } }, 403);
    }
    throw error;
  }

  try {
    const { result } = await callUpstreamWithFallback(upstreamList, {
      prompt: body.prompt,
      negativePrompt: body.negative_prompt,
      width: requestedDimensions.width,
      height: requestedDimensions.height,
    });
    const actualDimensions = resolveGeneratedImageDimensions(
      result,
      requestedDimensions.width,
      requestedDimensions.height
    );
    const [updateResult] = await db
      .update(generations)
      .set({
        status: "success",
        imageUrl: result.imageUrl,
        ...actualDimensions,
      })
      .where(eq(generations.id, id));
    if (updateResult.affectedRows !== 1) {
      await removeStoredGeneratedImage(result.imageUrl);
      throw new Error("生成记录更新失败");
    }
    return c.json({
      id,
      model: pricing.model,
      size: `${actualDimensions.width}x${actualDimensions.height}`,
      cost: pricing.price,
      data: [{ url: absoluteImageUrl(c, result.imageUrl) }],
    });
  } catch (err) {
    const msg = getRawGenerationError(err);
    const failure = classifyGenerationFailure(err);
    console.error("[open-api] upstream request failed", {
      generationId: id,
      userId: user.id,
      upstreamIds: upstreamList.map(item => item.id),
      error: msg.slice(0, 500),
    });
    try {
      await db
        .update(generations)
        .set({ status: "failed", errorMsg: msg.slice(0, 500) })
        .where(eq(generations.id, id));
    } catch (statusError) {
      console.error("[open-api] failed to mark generation failed", {
        generationId: id,
        error:
          statusError instanceof Error
            ? statusError.message.slice(0, 240)
            : String(statusError),
      });
    }
    // 退款
    let refunded = true;
    try {
      await db.transaction(async tx => {
        const [u] = await tx
          .select()
          .from(users)
          .where(eq(users.id, user.id))
          .for("update");
        if (!u) throw new Error("用户不存在");
        const next = u.quota + pricing.price;
        await tx
          .update(users)
          .set({ quota: next })
          .where(eq(users.id, user.id));
        await tx.insert(creditLogs).values({
          userId: user.id,
          amount: pricing.price,
          balanceAfter: next,
          type: "refund",
          remark: "API 生图失败退款",
        });
      });
    } catch (refundError) {
      refunded = false;
      console.error("[open-api] refund failed", {
        generationId: id,
        userId: user.id,
        error:
          refundError instanceof Error
            ? refundError.message.slice(0, 240)
            : String(refundError),
      });
    }
    return c.json(
      {
        error: {
          code: failure.code,
          message: refundedGenerationMessage(err, refunded),
        },
        refunded,
      },
      failure.httpStatus
    );
  }
});
