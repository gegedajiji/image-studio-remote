import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  generations,
  likes,
  modelPricing,
  upstreams,
  users,
  creditLogs,
} from "@db/schema";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import { getDb } from "./queries/connection";
import {
  callUpstream,
  decodeReferenceImageDataUrl,
  MAX_REFERENCE_IMAGE_DATA_URL_LENGTH,
} from "./imageService";
import {
  classifyGenerationFailure,
  getRawGenerationError,
  refundedGenerationMessage,
} from "./generationError";

async function deductQuota(
  userId: number,
  amount: number,
  type: "generate" | "refund",
  remark: string
) {
  const db = getDb();
  await db.transaction(async tx => {
    const [u] = await tx.select().from(users).where(eq(users.id, userId));
    if (!u) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
    const next = u.quota + amount;
    if (next < 0)
      throw new TRPCError({ code: "BAD_REQUEST", message: "额度不足" });
    await tx.update(users).set({ quota: next }).where(eq(users.id, userId));
    await tx.insert(creditLogs).values({
      userId,
      amount,
      balanceAfter: next,
      type,
      remark,
    });
  });
}

export const generationRouter = createRouter({
  // 公开：获取生图价格表
  pricing: publicQuery.query(async () => {
    return getDb()
      .select()
      .from(modelPricing)
      .where(eq(modelPricing.enabled, true))
      .orderBy(modelPricing.price);
  }),

  // 登录：生成图片
  generate: authedQuery
    .input(
      z.object({
        prompt: z.string().min(1, "请输入提示词").max(2000),
        negativePrompt: z.string().max(2000).optional(),
        pricingId: z.number(),
        referenceImageDataUrl: z
          .string()
          .max(MAX_REFERENCE_IMAGE_DATA_URL_LENGTH, "参考图数据不能超过 14 MB")
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();

      if (ctx.user.status === "banned") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "账号已被禁用，无法生图",
        });
      }

      let referenceImage;
      try {
        referenceImage =
          input.referenceImageDataUrl === undefined
            ? undefined
            : decodeReferenceImageDataUrl(input.referenceImageDataUrl);
      } catch (err) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err instanceof Error ? err.message : "参考图内容无效",
        });
      }

      const [pricing] = await db
        .select()
        .from(modelPricing)
        .where(eq(modelPricing.id, input.pricingId));
      if (!pricing || !pricing.enabled) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "所选模型/尺寸不可用",
        });
      }

      // 查找可用上游（按优先级）
      const upstreamList = await db
        .select()
        .from(upstreams)
        .where(
          and(eq(upstreams.enabled, true), eq(upstreams.model, pricing.model))
        )
        .orderBy(desc(upstreams.priority));
      const upstream = upstreamList[0];
      if (!upstream) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "暂无可用生图上游，请联系管理员配置",
        });
      }

      // 先扣额度
      if (ctx.user.quota < pricing.price) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `额度不足，本次需 ${pricing.price} 积分，请先充值`,
        });
      }
      const generationType = referenceImage ? "图生图" : "生图";
      await deductQuota(
        ctx.user.id,
        -pricing.price,
        "generate",
        `${generationType}消费·${pricing.label}`
      );

      // 创建记录
      const [{ id }] = await db
        .insert(generations)
        .values({
          userId: ctx.user.id,
          prompt: input.prompt,
          negativePrompt: input.negativePrompt ?? null,
          model: pricing.model,
          width: pricing.width,
          height: pricing.height,
          cost: pricing.price,
          status: "pending",
        })
        .$returningId();

      try {
        const result = await callUpstream(upstream, {
          prompt: input.prompt,
          negativePrompt: input.negativePrompt,
          width: pricing.width,
          height: pricing.height,
          referenceImage,
        });
        await db
          .update(generations)
          .set({ status: "success", imageUrl: result.imageUrl })
          .where(eq(generations.id, id));
      } catch (err) {
        const msg = getRawGenerationError(err);
        const failure = classifyGenerationFailure(err);
        console.error("[generation] upstream request failed", {
          generationId: id,
          userId: ctx.user.id,
          upstreamId: upstream.id,
          error: msg.slice(0, 500),
        });
        await db
          .update(generations)
          .set({ status: "failed", errorMsg: msg.slice(0, 500) })
          .where(eq(generations.id, id));
        // 失败退款
        await deductQuota(
          ctx.user.id,
          pricing.price,
          "refund",
          `${generationType}失败退款·${pricing.label}`
        );
        throw new TRPCError({
          code:
            failure.kind === "content_rejected"
              ? "BAD_REQUEST"
              : failure.kind === "rate_limited"
                ? "TOO_MANY_REQUESTS"
                : "INTERNAL_SERVER_ERROR",
          message: refundedGenerationMessage(err),
        });
      }

      const [record] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, id));
      return record;
    }),

  // 登录：我的生图历史
  myHistory: authedQuery
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(30),
        cursor: z.number().nullish(),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = getDb();
      const rows = await db
        .select()
        .from(generations)
        .where(eq(generations.userId, ctx.user.id))
        .orderBy(desc(generations.id))
        .limit(input.limit);
      return rows.map(row => ({
        ...row,
        errorMsg: row.errorMsg
          ? classifyGenerationFailure(new Error(row.errorMsg)).message
          : null,
      }));
    }),

  // 登录：发布 / 取消发布到社区
  togglePublic: authedQuery
    .input(z.object({ id: z.number(), isPublic: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [g] = await db
        .select()
        .from(generations)
        .where(eq(generations.id, input.id));
      if (!g || g.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "记录不存在" });
      }
      if (g.status !== "success") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "仅成功的作品可发布",
        });
      }
      await db
        .update(generations)
        .set({ isPublic: input.isPublic })
        .where(eq(generations.id, input.id));
      return { ok: true };
    }),

  // 登录：删除我的记录
  remove: authedQuery
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .delete(generations)
        .where(
          and(eq(generations.id, input.id), eq(generations.userId, ctx.user.id))
        );
      return { ok: true };
    }),
});

export const communityRouter = createRouter({
  // 公开：社区作品流
  list: publicQuery
    .input(
      z.object({
        limit: z.number().min(1).max(60).default(24),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const rows = await db
        .select({
          id: generations.id,
          prompt: generations.prompt,
          model: generations.model,
          width: generations.width,
          height: generations.height,
          imageUrl: generations.imageUrl,
          createdAt: generations.createdAt,
          authorName: users.name,
          authorAvatar: users.avatar,
          likeCount: sql<number>`(SELECT COUNT(*) FROM likes WHERE likes.generationId = ${generations.id})`,
        })
        .from(generations)
        .innerJoin(users, eq(generations.userId, users.id))
        .where(
          and(eq(generations.isPublic, true), eq(generations.status, "success"))
        )
        .orderBy(desc(generations.id))
        .limit(input.limit)
        .offset(input.offset);
      return rows;
    }),

  // 登录：我点赞过的作品 id 列表
  myLikes: authedQuery.query(async ({ ctx }) => {
    const rows = await getDb()
      .select({ generationId: likes.generationId })
      .from(likes)
      .where(eq(likes.userId, ctx.user.id));
    return rows.map(r => r.generationId);
  }),

  // 登录：点赞/取消
  toggleLike: authedQuery
    .input(z.object({ generationId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [existing] = await db
        .select()
        .from(likes)
        .where(
          and(
            eq(likes.userId, ctx.user.id),
            eq(likes.generationId, input.generationId)
          )
        );
      if (existing) {
        await db.delete(likes).where(eq(likes.id, existing.id));
        return { liked: false };
      }
      await db
        .insert(likes)
        .values({ userId: ctx.user.id, generationId: input.generationId });
      return { liked: true };
    }),
});
