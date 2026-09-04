import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import {
  canvasEdges,
  canvasNodes,
  comments,
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
  callUpstreamWithFallback,
  decodeReferenceImageDataUrl,
  MAX_REFERENCE_IMAGE_DATA_URL_LENGTH,
  removeStoredGeneratedImage,
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
    const [u] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
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

async function reserveGeneration(
  userId: number,
  input: {
    prompt: string;
    negativePrompt?: string;
    model: string;
    width: number;
    height: number;
    cost: number;
    label: string;
    generationType: string;
  }
) {
  const db = getDb();
  return db.transaction(async tx => {
    const [user] = await tx
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .for("update");
    if (!user) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
    // Re-check the status after taking the row lock. An administrator can ban
    // an account between the middleware check and this reservation; the
    // locked row must be authoritative so a banned account cannot still
    // consume credits or submit an upstream request.
    if (user.status === "banned") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "账号已被禁用，无法生图",
      });
    }
    if (user.quota < input.cost) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `额度不足，本次需 ${input.cost} 积分，请先充值`,
      });
    }

    const next = user.quota - input.cost;
    await tx.update(users).set({ quota: next }).where(eq(users.id, userId));
    await tx.insert(creditLogs).values({
      userId,
      amount: -input.cost,
      balanceAfter: next,
      type: "generate",
      remark: `${input.generationType}消费·${input.label}`,
    });
    const [{ id }] = await tx
      .insert(generations)
      .values({
        userId,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt ?? null,
        model: input.model,
        width: input.width,
        height: input.height,
        cost: input.cost,
        status: "pending",
      })
      .$returningId();
    return id;
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
        prompt: z.string().trim().min(1, "请输入提示词").max(2000),
        negativePrompt: z.string().trim().max(2000).optional(),
        pricingId: z.number().int().positive(),
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
      if (
        !Number.isInteger(pricing.width) ||
        !Number.isInteger(pricing.height) ||
        pricing.width < 64 ||
        pricing.height < 64 ||
        pricing.width > 4096 ||
        pricing.height > 4096 ||
        pricing.price < 0
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "当前价格配置无效，请联系管理员",
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

      const generationType = referenceImage ? "图生图" : "生图";
      // 锁定用户、扣费和创建 pending 记录在同一事务中完成，避免并发超扣或插入失败漏扣。
      const id = await reserveGeneration(ctx.user.id, {
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        model: pricing.model,
        width: pricing.width,
        height: pricing.height,
        cost: pricing.price,
        label: pricing.label,
        generationType,
      });

      let generatedImageUrl: string | undefined;
      try {
        const { result } = await callUpstreamWithFallback(upstreamList, {
          prompt: input.prompt,
          negativePrompt: input.negativePrompt,
          width: pricing.width,
          height: pricing.height,
          referenceImage,
        });
        generatedImageUrl = result.imageUrl;
        const [updateResult] = await db
          .update(generations)
          .set({ status: "success", imageUrl: result.imageUrl })
          .where(eq(generations.id, id));
        if (updateResult.affectedRows !== 1) {
          throw new Error("生成记录更新失败");
        }
      } catch (err) {
        const msg = getRawGenerationError(err);
        const failure = classifyGenerationFailure(err);
        console.error("[generation] upstream request failed", {
          generationId: id,
          userId: ctx.user.id,
          upstreamIds: upstreamList.map(item => item.id),
          error: msg.slice(0, 500),
        });
        try {
          await db
            .update(generations)
            .set({ status: "failed", errorMsg: msg.slice(0, 500) })
            .where(eq(generations.id, id));
        } catch (statusError) {
          console.error("[generation] failed to mark generation failed", {
            generationId: id,
            error:
              statusError instanceof Error
                ? statusError.message.slice(0, 240)
                : String(statusError),
          });
        }
        if (generatedImageUrl) await removeStoredGeneratedImage(generatedImageUrl);
        // 失败退款
        let refunded = true;
        try {
          await deductQuota(
            ctx.user.id,
            pricing.price,
            "refund",
            `${generationType}失败退款·${pricing.label}`
          );
        } catch (refundError) {
          refunded = false;
          console.error("[generation] refund failed", {
            generationId: id,
            userId: ctx.user.id,
            error:
              refundError instanceof Error
                ? refundError.message.slice(0, 240)
                : String(refundError),
          });
        }
        throw new TRPCError({
          code:
            failure.kind === "content_rejected"
              ? "BAD_REQUEST"
              : failure.kind === "rate_limited"
                ? "TOO_MANY_REQUESTS"
                : "INTERNAL_SERVER_ERROR",
          message: refundedGenerationMessage(err, refunded),
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
      const conditions = [
        eq(generations.userId, ctx.user.id),
        eq(generations.status, "success"),
        isNotNull(generations.imageUrl),
      ];
      if (input.cursor !== null && input.cursor !== undefined) {
        conditions.push(sql`${generations.id} < ${input.cursor}`);
      }
      const rows = await db
        .select()
        .from(generations)
        .where(and(...conditions))
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
      const [record] = await db
        .select({ imageUrl: generations.imageUrl })
        .from(generations)
        .where(
          and(eq(generations.id, input.id), eq(generations.userId, ctx.user.id))
        )
        .limit(1);
      if (!record) return { ok: true };
      await db.transaction(async tx => {
        const nodeRows = await tx
          .select({ id: canvasNodes.id })
          .from(canvasNodes)
          .where(
            and(
              eq(canvasNodes.userId, ctx.user.id),
              eq(canvasNodes.refId, input.id)
            )
          );
        const nodeIds = nodeRows.map(node => node.id);
        if (nodeIds.length) {
          await tx.delete(canvasEdges).where(
            and(
              eq(canvasEdges.userId, ctx.user.id),
              or(inArray(canvasEdges.fromId, nodeIds), inArray(canvasEdges.toId, nodeIds))
            )
          );
          await tx.delete(canvasNodes).where(
            and(
              eq(canvasNodes.userId, ctx.user.id),
              inArray(canvasNodes.id, nodeIds)
            )
          );
        }
        await tx
          .delete(comments)
          .where(eq(comments.generationId, input.id));
        await tx
          .delete(likes)
          .where(eq(likes.generationId, input.id));
        await tx
          .delete(generations)
          .where(
            and(eq(generations.id, input.id), eq(generations.userId, ctx.user.id))
          );
      });
      await removeStoredGeneratedImage(record.imageUrl);
      return { ok: true };
    }),
});

export const communityRouter = createRouter({
  // 公开：社区作品流
  list: publicQuery
    .input(
      z.object({
        limit: z.number().int().min(1).max(60).default(12),
        cursor: z.number().int().positive().nullish(),
      })
    )
    .query(async ({ input }) => {
      const db = getDb();
      const conditions = [
        eq(generations.isPublic, true),
        eq(generations.status, "success"),
      ];
      if (input.cursor !== null && input.cursor !== undefined) {
        conditions.push(sql`${generations.id} < ${input.cursor}`);
      }
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
          commentCount: sql<number>`(SELECT COUNT(*) FROM comments WHERE comments.generationId = ${generations.id})`,
        })
        .from(generations)
        .innerJoin(users, eq(generations.userId, users.id))
        .where(and(...conditions))
        .orderBy(desc(generations.id))
        .limit(input.limit + 1);
      const items = rows.slice(0, input.limit);
      return {
        items,
        nextCursor:
          rows.length > input.limit && items.length > 0
            ? items[items.length - 1]!.id
            : null,
      };
    }),

  // 公开：作品评论。仅公开且生成成功的作品可读取评论，避免泄露私有作品内容。
  comments: publicQuery
    .input(
      z.object({
        generationId: z.number().int().positive(),
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ input }) => {
      return getDb()
        .select({
          id: comments.id,
          generationId: comments.generationId,
          body: comments.body,
          createdAt: comments.createdAt,
          userId: comments.userId,
          authorName: users.name,
          authorAvatar: users.avatar,
        })
        .from(comments)
        .innerJoin(users, eq(comments.userId, users.id))
        .innerJoin(generations, eq(comments.generationId, generations.id))
        .where(
          and(
            eq(comments.generationId, input.generationId),
            eq(generations.isPublic, true),
            eq(generations.status, "success")
          )
        )
        .orderBy(asc(comments.createdAt), asc(comments.id))
        .limit(input.limit);
    }),

  // 登录：在公开作品下发表评论
  createComment: authedQuery
    .input(
      z.object({
        generationId: z.number().int().positive(),
        body: z.string().trim().min(1, "评论内容不能为空").max(1000),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      return db.transaction(async tx => {
        const [generation] = await tx
          .select({
            id: generations.id,
            isPublic: generations.isPublic,
            status: generations.status,
          })
          .from(generations)
          .where(eq(generations.id, input.generationId))
          .for("update");
        if (
          !generation ||
          !generation.isPublic ||
          generation.status !== "success"
        ) {
          throw new TRPCError({ code: "NOT_FOUND", message: "作品不存在" });
        }

        const [{ id }] = await tx
          .insert(comments)
          .values({
            generationId: input.generationId,
            userId: ctx.user.id,
            body: input.body,
          })
          .$returningId();
        const [comment] = await tx
          .select({
            id: comments.id,
            generationId: comments.generationId,
            body: comments.body,
            createdAt: comments.createdAt,
            userId: comments.userId,
            authorName: users.name,
            authorAvatar: users.avatar,
          })
          .from(comments)
          .innerJoin(users, eq(comments.userId, users.id))
          .where(eq(comments.id, id))
          .limit(1);
        if (!comment) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "评论创建失败",
          });
        }
        return comment;
      });
    }),

  // 登录：删除自己的评论，管理员可删除任意评论
  deleteComment: authedQuery
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [comment] = await db
        .select({ userId: comments.userId })
        .from(comments)
        .where(eq(comments.id, input.id))
        .limit(1);
      if (!comment) return { ok: true };
      if (comment.userId !== ctx.user.id && ctx.user.role !== "admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "无权删除该评论" });
      }
      await db.delete(comments).where(eq(comments.id, input.id));
      return { ok: true };
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
      // Lock the target work while checking/inserting the like. This prevents
      // double-click races and also blocks likes on private/failed/nonexistent works.
      return db.transaction(async tx => {
        const [generation] = await tx
          .select({
            id: generations.id,
            isPublic: generations.isPublic,
            status: generations.status,
          })
          .from(generations)
          .where(eq(generations.id, input.generationId))
          .for("update");
        if (!generation || !generation.isPublic || generation.status !== "success") {
          throw new TRPCError({ code: "NOT_FOUND", message: "作品不存在" });
        }

        const existing = await tx
          .select({ id: likes.id })
          .from(likes)
          .where(
            and(
              eq(likes.userId, ctx.user.id),
              eq(likes.generationId, input.generationId)
            )
          )
          .for("update");
        if (existing.length) {
          await tx.delete(likes).where(
            and(
              eq(likes.userId, ctx.user.id),
              eq(likes.generationId, input.generationId)
            )
          );
          return { liked: false };
        }
        await tx
          .insert(likes)
          .values({ userId: ctx.user.id, generationId: input.generationId });
        return { liked: true };
      });
    }),
});
