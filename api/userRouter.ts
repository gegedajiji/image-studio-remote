import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import {
  cardKeys,
  creditLogs,
  emailVerificationCodes,
  users,
} from "@db/schema";
import { createRouter, authedQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { randomBytes } from "crypto";
import { publicUser, hashPassword } from "./localAuth";
import { persistAvatar, removeStoredAvatar } from "./avatarService";
import { sendPasswordCodeEmail } from "./emailService";
import {
  generateVerificationCode,
  getVerificationSendLimit,
  hashVerificationCode,
  maskEmail,
  VERIFICATION_CODE_MAX_ATTEMPTS,
  VERIFICATION_CODE_RETENTION_MS,
  VERIFICATION_CODE_TTL_MS,
  verifyVerificationCode,
} from "./verificationCode";

type VerificationResult =
  "success" | "invalid" | "incorrect" | "too_many_attempts";

function throwVerificationResult(
  result: Exclude<VerificationResult, "success">
): never {
  if (result === "too_many_attempts") {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "验证码尝试次数过多，请重新获取",
    });
  }
  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      result === "incorrect"
        ? "邮箱验证码不正确"
        : "验证码无效或已过期，请重新获取",
  });
}

function throwSendLimit(limit: "cooldown" | "hourly"): never {
  throw new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message:
      limit === "cooldown"
        ? "验证码发送过于频繁，请稍后再试"
        : "验证码请求次数过多，请一小时后再试",
  });
}

export const userRouter = createRouter({
  // 当前用户完整信息（含额度）
  profile: authedQuery.query(async ({ ctx }) => {
    const [u] = await getDb()
      .select()
      .from(users)
      .where(eq(users.id, ctx.user.id));
    return u ? publicUser(u) : null;
  }),

  updateProfile: authedQuery
    .input(
      z.object({
        name: z.string().trim().min(2, "用户名至少需要 2 个字符").max(40),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      await db
        .update(users)
        .set({ name: input.name.trim() })
        .where(eq(users.id, ctx.user.id));
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id));
      return publicUser(user);
    }),

  updateAvatar: authedQuery
    .input(z.object({ dataUrl: z.string().max(3_000_000) }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const [current] = await db
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id));
      if (!current)
        throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });

      let avatar: string;
      try {
        avatar = await persistAvatar(input.dataUrl, current.id);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "头像上传失败",
        });
      }

      try {
        await db.update(users).set({ avatar }).where(eq(users.id, current.id));
      } catch (error) {
        await removeStoredAvatar(avatar);
        throw error;
      }
      await removeStoredAvatar(current.avatar);
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, current.id));
      return publicUser(user);
    }),

  sendPasswordCode: authedQuery.mutation(async ({ ctx }) => {
    const db = getDb();
    const now = new Date();
    await db
      .delete(emailVerificationCodes)
      .where(
        lt(
          emailVerificationCodes.expiresAt,
          new Date(now.getTime() - VERIFICATION_CODE_RETENTION_MS)
        )
      );

    const challenge = await db.transaction(async tx => {
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.id, ctx.user.id))
        .for("update");
      if (!user?.email) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "当前账号未绑定邮箱",
        });
      }
      if (user.email.toLowerCase().endsWith(".local")) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "当前账号使用迁移邮箱，请联系管理员绑定真实邮箱",
        });
      }

      const [latest] = await tx
        .select()
        .from(emailVerificationCodes)
        .where(
          and(
            eq(emailVerificationCodes.userId, user.id),
            eq(emailVerificationCodes.purpose, "password_change")
          )
        )
        .orderBy(desc(emailVerificationCodes.id))
        .limit(1)
        .for("update");
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const [{ value: recentCount }] = await tx
        .select({ value: count() })
        .from(emailVerificationCodes)
        .where(
          and(
            eq(emailVerificationCodes.userId, user.id),
            eq(emailVerificationCodes.purpose, "password_change"),
            gte(emailVerificationCodes.createdAt, oneHourAgo)
          )
        );
      const limit = getVerificationSendLimit(
        latest?.createdAt,
        recentCount,
        now
      );
      if (limit) throwSendLimit(limit);

      await tx
        .update(emailVerificationCodes)
        .set({ usedAt: now })
        .where(
          and(
            eq(emailVerificationCodes.userId, user.id),
            eq(emailVerificationCodes.purpose, "password_change"),
            isNull(emailVerificationCodes.usedAt)
          )
        );

      const code = generateVerificationCode();
      const [{ id }] = await tx
        .insert(emailVerificationCodes)
        .values({
          userId: user.id,
          purpose: "password_change",
          codeHash: hashVerificationCode(user.id, code),
          expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MS),
        })
        .$returningId();
      return { id, email: user.email, code };
    });

    try {
      await sendPasswordCodeEmail({
        to: challenge.email,
        code: challenge.code,
      });
    } catch (error) {
      await db
        .update(emailVerificationCodes)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(emailVerificationCodes.id, challenge.id),
            isNull(emailVerificationCodes.usedAt)
          )
        );
      console.error("Password verification email failed", error);
      const message =
        error instanceof Error && error.message.includes("尚未配置")
          ? error.message
          : "验证码邮件发送失败，请稍后重试";
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
    }

    return { email: maskEmail(challenge.email), cooldownSeconds: 60 };
  }),

  changePassword: authedQuery
    .input(
      z.object({
        code: z.string().regex(/^\d{6}$/, "请输入 6 位邮箱验证码"),
        newPassword: z.string().min(8, "密码至少需要 8 位").max(128),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const now = new Date();
      const result: VerificationResult = await db.transaction(async tx => {
        const [record] = await tx
          .select()
          .from(emailVerificationCodes)
          .where(
            and(
              eq(emailVerificationCodes.userId, ctx.user.id),
              eq(emailVerificationCodes.purpose, "password_change"),
              isNull(emailVerificationCodes.usedAt),
              gte(emailVerificationCodes.expiresAt, now)
            )
          )
          .orderBy(desc(emailVerificationCodes.id))
          .limit(1)
          .for("update");
        if (!record) return "invalid";
        if (record.attempts >= VERIFICATION_CODE_MAX_ATTEMPTS) {
          return "too_many_attempts";
        }
        if (!verifyVerificationCode(ctx.user.id, input.code, record.codeHash)) {
          const [attemptResult] = await tx
            .update(emailVerificationCodes)
            .set({ attempts: sql`${emailVerificationCodes.attempts} + 1` })
            .where(
              and(
                eq(emailVerificationCodes.id, record.id),
                isNull(emailVerificationCodes.usedAt),
                lt(
                  emailVerificationCodes.attempts,
                  VERIFICATION_CODE_MAX_ATTEMPTS
                )
              )
            );
          return attemptResult.affectedRows === 1
            ? "incorrect"
            : "too_many_attempts";
        }

        const [consumeResult] = await tx
          .update(emailVerificationCodes)
          .set({ usedAt: now })
          .where(
            and(
              eq(emailVerificationCodes.id, record.id),
              isNull(emailVerificationCodes.usedAt),
              gte(emailVerificationCodes.expiresAt, now)
            )
          );
        if (consumeResult.affectedRows !== 1) return "invalid";

        const passwordHash = await hashPassword(input.newPassword);
        await tx
          .update(users)
          .set({ passwordHash })
          .where(eq(users.id, ctx.user.id));
        await tx
          .update(emailVerificationCodes)
          .set({ usedAt: now })
          .where(
            and(
              eq(emailVerificationCodes.userId, ctx.user.id),
              eq(emailVerificationCodes.purpose, "password_change"),
              isNull(emailVerificationCodes.usedAt)
            )
          );
        return "success";
      });
      if (result !== "success") throwVerificationResult(result);
      return { success: true };
    }),

  // 额度流水
  creditLogs: authedQuery
    .input(z.object({ limit: z.number().min(1).max(100).default(30) }))
    .query(async ({ ctx, input }) => {
      return getDb()
        .select()
        .from(creditLogs)
        .where(eq(creditLogs.userId, ctx.user.id))
        .orderBy(desc(creditLogs.id))
        .limit(input.limit);
    }),

  // 卡密兑换
  redeemCard: authedQuery
    .input(
      z.object({ code: z.string().trim().min(4, "请输入完整卡密").max(32) })
    )
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.status === "banned") {
        throw new TRPCError({ code: "FORBIDDEN", message: "账号已被禁用" });
      }
      const db = getDb();
      const code = input.code.toUpperCase().replace(/\s+/g, "");

      return await db.transaction(async tx => {
        const [card] = await tx
          .select()
          .from(cardKeys)
          .where(eq(cardKeys.code, code));
        if (!card)
          throw new TRPCError({ code: "NOT_FOUND", message: "卡密不存在" });
        if (card.status === "redeemed")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "该卡密已被使用",
          });
        if (card.status === "disabled")
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "该卡密已被禁用",
          });

        const [u] = await tx
          .select()
          .from(users)
          .where(eq(users.id, ctx.user.id));
        if (!u)
          throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });

        const next = u.quota + card.credits;
        await tx
          .update(cardKeys)
          .set({
            status: "redeemed",
            redeemedById: ctx.user.id,
            redeemedAt: new Date(),
          })
          .where(eq(cardKeys.id, card.id));
        await tx
          .update(users)
          .set({ quota: next })
          .where(eq(users.id, ctx.user.id));
        await tx.insert(creditLogs).values({
          userId: ctx.user.id,
          amount: card.credits,
          balanceAfter: next,
          type: "redeem",
          remark: `卡密兑换 ${card.code.slice(0, 4)}****`,
        });
        return { credits: card.credits, balance: next };
      });
    }),

  // 生成 / 重置 API Key
  rotateApiKey: authedQuery.mutation(async ({ ctx }) => {
    const key = `sk-${randomBytes(24).toString("hex")}`;
    await getDb()
      .update(users)
      .set({ apiKey: key })
      .where(eq(users.id, ctx.user.id));
    return { apiKey: key };
  }),
});
