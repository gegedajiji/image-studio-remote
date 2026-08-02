import * as cookie from "cookie";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, count, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { Session } from "@contracts/constants";
import { registrationEmailCodes, users } from "@db/schema";
import { getSessionCookieOptions } from "./lib/cookies";
import { createRouter, authedQuery, publicQuery } from "./middleware";
import {
  authenticateCredentials,
  getLocalUserInsertValues,
  hashPassword,
  publicUser,
  setSessionCookie,
} from "./localAuth";
import { getDb } from "./queries/connection";
import { sendRegistrationCodeEmail } from "./emailService";
import {
  generateVerificationCode,
  getVerificationSendLimit,
  hashRegistrationVerificationCode,
  maskEmail,
  normalizeVerificationEmail,
  VERIFICATION_CODE_MAX_ATTEMPTS,
  VERIFICATION_CODE_RETENTION_MS,
  VERIFICATION_CODE_TTL_MS,
  verifyRegistrationVerificationCode,
} from "./verificationCode";

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("请输入有效邮箱")
  .max(320);
const credentialsSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, "密码至少需要 8 位").max(128),
});
export const sendRegistrationCodeInputSchema = z.object({ email: emailSchema });
export const registrationInputSchema = credentialsSchema.extend({
  name: z.string().trim().min(2, "昵称至少需要 2 个字符").max(40),
  code: z.string().regex(/^\d{6}$/, "请输入 6 位邮箱验证码"),
});

type RegistrationResult =
  | { status: "success"; user: typeof users.$inferSelect }
  | {
      status: "conflict" | "invalid" | "incorrect" | "too_many_attempts";
    };

function throwRegistrationResult(
  result: Exclude<RegistrationResult, { status: "success" }>
): never {
  if (result.status === "conflict") {
    throw new TRPCError({ code: "CONFLICT", message: "该邮箱已注册" });
  }
  if (result.status === "too_many_attempts") {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: "验证码尝试次数过多，请重新获取",
    });
  }
  throw new TRPCError({
    code: "BAD_REQUEST",
    message:
      result.status === "incorrect"
        ? "邮箱验证码不正确"
        : "验证码无效或已过期，请重新获取",
  });
}

function throwRegistrationSendLimit(limit: "cooldown" | "hourly"): never {
  throw new TRPCError({
    code: "TOO_MANY_REQUESTS",
    message:
      limit === "cooldown"
        ? "验证码发送过于频繁，请稍后再试"
        : "验证码请求次数过多，请一小时后再试",
  });
}

export const authRouter = createRouter({
  me: authedQuery.query(opts => publicUser(opts.ctx.user)),
  login: publicQuery
    .input(credentialsSchema)
    .mutation(async ({ ctx, input }) => {
      const user = await authenticateCredentials(input.email, input.password);
      await setSessionCookie(ctx.req.headers, ctx.resHeaders, user);
      return publicUser(user);
    }),
  sendRegistrationCode: publicQuery
    .input(sendRegistrationCodeInputSchema)
    .mutation(async ({ input }) => {
      const db = getDb();
      const email = normalizeVerificationEmail(input.email);
      const now = new Date();
      await db
        .delete(registrationEmailCodes)
        .where(
          lt(
            registrationEmailCodes.expiresAt,
            new Date(now.getTime() - VERIFICATION_CODE_RETENTION_MS)
          )
        );

      const [existingUser] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      if (existingUser) {
        throw new TRPCError({ code: "CONFLICT", message: "该邮箱已注册" });
      }

      const code = generateVerificationCode();
      const codeHash = hashRegistrationVerificationCode(email, code);
      await db
        .insert(registrationEmailCodes)
        .values({
          email,
          codeHash,
          expiresAt: now,
          usedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: { email: sql`${registrationEmailCodes.email}` },
        });

      await db.transaction(async tx => {
        const [registeredUser] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(1)
          .for("update");
        if (registeredUser) {
          throw new TRPCError({ code: "CONFLICT", message: "该邮箱已注册" });
        }

        // Keep the lock order identical to registration to avoid deadlocks
        // when a code resend races with a registration submission.
        const [record] = await tx
          .select()
          .from(registrationEmailCodes)
          .where(eq(registrationEmailCodes.email, email))
          .for("update");
        if (!record) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "验证码服务暂时不可用，请稍后重试",
          });
        }

        const windowIsCurrent =
          record.windowStartedAt !== null &&
          now.getTime() - record.windowStartedAt.getTime() < 60 * 60 * 1000;
        const recentCount = windowIsCurrent ? record.sendCount : 0;
        const limit = getVerificationSendLimit(
          record.lastSentAt ?? undefined,
          recentCount,
          now
        );
        if (limit) throwRegistrationSendLimit(limit);

        await tx
          .update(registrationEmailCodes)
          .set({
            codeHash,
            attempts: 0,
            sendCount: recentCount + 1,
            windowStartedAt: windowIsCurrent ? record.windowStartedAt : now,
            lastSentAt: now,
            expiresAt: new Date(now.getTime() + VERIFICATION_CODE_TTL_MS),
            usedAt: null,
            updatedAt: now,
          })
          .where(eq(registrationEmailCodes.email, email));
      });

      try {
        await sendRegistrationCodeEmail({ to: email, code });
      } catch (error) {
        await db
          .update(registrationEmailCodes)
          .set({ usedAt: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(registrationEmailCodes.email, email),
              eq(registrationEmailCodes.codeHash, codeHash),
              isNull(registrationEmailCodes.usedAt)
            )
          );
        console.error("Registration verification email failed", error);
        const message =
          error instanceof Error && error.message.includes("尚未配置")
            ? error.message
            : "验证码邮件发送失败，请稍后重试";
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message });
      }

      return { email: maskEmail(email), cooldownSeconds: 60 };
    }),
  register: publicQuery
    .input(registrationInputSchema)
    .mutation(async ({ ctx, input }) => {
      const db = getDb();
      const email = normalizeVerificationEmail(input.email);
      const now = new Date();
      const result: RegistrationResult = await db.transaction(async tx => {
        const [existingUser] = await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.email, email))
          .limit(1)
          .for("update");
        if (existingUser) return { status: "conflict" };

        const [record] = await tx
          .select()
          .from(registrationEmailCodes)
          .where(eq(registrationEmailCodes.email, email))
          .for("update");
        if (
          !record ||
          record.usedAt !== null ||
          record.expiresAt.getTime() < now.getTime()
        ) {
          return { status: "invalid" };
        }
        if (record.attempts >= VERIFICATION_CODE_MAX_ATTEMPTS) {
          return { status: "too_many_attempts" };
        }
        if (
          !verifyRegistrationVerificationCode(
            email,
            input.code,
            record.codeHash
          )
        ) {
          const [attemptResult] = await tx
            .update(registrationEmailCodes)
            .set({
              attempts: sql`${registrationEmailCodes.attempts} + 1`,
              updatedAt: now,
            })
            .where(
              and(
                eq(registrationEmailCodes.email, email),
                eq(registrationEmailCodes.codeHash, record.codeHash),
                isNull(registrationEmailCodes.usedAt),
                lt(
                  registrationEmailCodes.attempts,
                  VERIFICATION_CODE_MAX_ATTEMPTS
                )
              )
            );
          return {
            status:
              attemptResult.affectedRows === 1
                ? "incorrect"
                : "too_many_attempts",
          };
        }

        const [consumeResult] = await tx
          .update(registrationEmailCodes)
          .set({ usedAt: now, updatedAt: now })
          .where(
            and(
              eq(registrationEmailCodes.email, email),
              eq(registrationEmailCodes.codeHash, record.codeHash),
              isNull(registrationEmailCodes.usedAt),
              gte(registrationEmailCodes.expiresAt, now)
            )
          );
        if (consumeResult.affectedRows !== 1) return { status: "invalid" };

        const passwordHash = await hashPassword(input.password);
        const [{ value: userCount }] = await tx
          .select({ value: count() })
          .from(users);
        const [{ id }] = await tx
          .insert(users)
          .values(
            getLocalUserInsertValues(
              { name: input.name, email },
              passwordHash,
              userCount
            )
          )
          .$returningId();
        const [user] = await tx.select().from(users).where(eq(users.id, id));
        await tx
          .delete(registrationEmailCodes)
          .where(eq(registrationEmailCodes.email, email));
        return { status: "success", user };
      });

      if (result.status !== "success") throwRegistrationResult(result);
      await setSessionCookie(ctx.req.headers, ctx.resHeaders, result.user);
      return publicUser(result.user);
    }),
  logout: authedQuery.mutation(async ({ ctx }) => {
    const opts = getSessionCookieOptions(ctx.req.headers);
    ctx.resHeaders.append(
      "set-cookie",
      cookie.serialize(Session.cookieName, "", {
        httpOnly: opts.httpOnly,
        path: opts.path,
        sameSite: opts.sameSite?.toLowerCase() as "lax" | "none",
        secure: opts.secure,
        maxAge: 0,
      })
    );
    return { success: true };
  }),
});
