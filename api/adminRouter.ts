import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, like, ne, or, sql } from "drizzle-orm";
import {
  cardKeys,
  creditLogs,
  generations,
  modelPricing,
  upstreams,
  users,
} from "@db/schema";
import { createRouter, adminQuery } from "./middleware";
import { getDb } from "./queries/connection";
import { randomBytes } from "crypto";
import { isImage25Model } from "./generationSize";

const IMAGE_25_BASELINE = { width: 1536, height: 1024 } as const;

function makeCardCode() {
  // 16 位卡密，4-4-4-4 分组，去掉易混淆字符
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const raw = randomBytes(16);
  const chars = Array.from(raw, (b) => alphabet[b % alphabet.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12)}`;
}

function normalizeUpstreamBaseUrl(
  provider: "demo" | "openai",
  baseUrl: string | undefined
) {
  if (provider === "demo") return null;
  const value = baseUrl?.trim().replace(/\/+$/, "");
  if (!value) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "OpenAI 兼容上游需填写 Base URL",
    });
  }
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    ) {
      throw new Error("invalid");
    }
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Base URL 格式无效，请填写完整的 http(s) 地址",
    });
  }
  return value;
}

export const adminRouter = createRouter({
  // ===== 总览统计 =====
  stats: adminQuery.query(async () => {
    const db = getDb();
    const [u] = await db.select({ n: sql<number>`COUNT(*)` }).from(users);
    const [g] = await db.select({ n: sql<number>`COUNT(*)` }).from(generations);
    const [gs] = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(generations)
      .where(eq(generations.status, "success"));
    const [c] = await db.select({ n: sql<number>`COUNT(*)` }).from(cardKeys);
    const [cu] = await db
      .select({ n: sql<number>`COUNT(*)` })
      .from(cardKeys)
      .where(eq(cardKeys.status, "unused"));
    const [spent] = await db
      .select({ n: sql<number>`COALESCE(SUM(cost),0)` })
      .from(generations)
      .where(eq(generations.status, "success"));
    return {
      userCount: u?.n ?? 0,
      generationCount: g?.n ?? 0,
      successCount: gs?.n ?? 0,
      cardCount: c?.n ?? 0,
      unusedCardCount: cu?.n ?? 0,
      creditsSpent: spent?.n ?? 0,
    };
  }),

  // ===== 上游管理 =====
  upstreams: createRouter({
    list: adminQuery.query(async () => {
      const rows = await getDb()
        .select()
        .from(upstreams)
        .orderBy(desc(upstreams.priority), desc(upstreams.id));
      // API keys are write-only from the admin UI; never send them back to the browser.
      return rows.map(upstream => ({
        ...upstream,
        apiKey: null,
      }));
    }),
    create: adminQuery
      .input(
        z.object({
          name: z.string().trim().min(1).max(255),
          provider: z.enum(["demo", "openai"]),
          baseUrl: z.string().trim().max(512).optional(),
          apiKey: z.string().max(512).optional(),
          model: z.string().trim().min(1).max(255),
          priority: z.number().int().default(0),
        }),
      )
      .mutation(async ({ input }) => {
        const baseUrl = normalizeUpstreamBaseUrl(input.provider, input.baseUrl);
        await getDb().insert(upstreams).values({
          name: input.name,
          provider: input.provider,
          baseUrl,
          apiKey: input.apiKey?.trim() || null,
          model: input.model,
          priority: input.priority,
        });
        return { ok: true };
      }),
    update: adminQuery
      .input(
        z.object({
          id: z.number(),
          name: z.string().trim().min(1).max(255),
          provider: z.enum(["demo", "openai"]),
          baseUrl: z.string().trim().max(512).optional(),
          apiKey: z.string().max(512).optional(),
          model: z.string().trim().min(1).max(255),
          priority: z.number().int(),
          enabled: z.boolean(),
        }),
      )
      .mutation(async ({ input }) => {
        const baseUrl = normalizeUpstreamBaseUrl(input.provider, input.baseUrl);
        await getDb()
          .update(upstreams)
          .set({
            name: input.name,
            provider: input.provider,
            baseUrl,
            ...(input.apiKey?.trim() ? { apiKey: input.apiKey.trim() } : {}),
            model: input.model,
            priority: input.priority,
            enabled: input.enabled,
          })
          .where(eq(upstreams.id, input.id));
        return { ok: true };
      }),
    toggle: adminQuery
      .input(z.object({ id: z.number(), enabled: z.boolean() }))
      .mutation(async ({ input }) => {
        await getDb().update(upstreams).set({ enabled: input.enabled }).where(eq(upstreams.id, input.id));
        return { ok: true };
      }),
    remove: adminQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      await getDb().delete(upstreams).where(eq(upstreams.id, input.id));
      return { ok: true };
    }),
  }),

  // ===== 用户管理 =====
  users: createRouter({
    list: adminQuery
      .input(
        z.object({
          keyword: z.string().optional(),
          limit: z.number().min(1).max(200).default(50),
        }),
      )
      .query(async ({ input }) => {
        const db = getDb();
        const cond = input.keyword
          ? or(like(users.name, `%${input.keyword}%`), like(users.email, `%${input.keyword}%`))
          : undefined;
        return db
          .select({
            id: users.id,
            unionId: users.unionId,
            name: users.name,
            email: users.email,
            avatar: users.avatar,
            role: users.role,
            quota: users.quota,
            status: users.status,
            passwordHash: sql<string | null>`NULL`,
            apiKey: sql<string | null>`NULL`,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
            lastSignInAt: users.lastSignInAt,
          })
          .from(users)
          .where(cond)
          .orderBy(desc(users.id))
          .limit(input.limit);
      }),
    update: adminQuery
      .input(
        z.object({
          id: z.number(),
          quota: z.number().int().min(0).max(2_000_000_000).optional(),
          status: z.enum(["active", "banned"]).optional(),
          role: z.enum(["user", "admin"]).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = getDb();
        await db.transaction(async tx => {
          const activeAdmins = await tx
            .select({ id: users.id })
            .from(users)
            .where(and(eq(users.role, "admin"), eq(users.status, "active")))
            .for("update");
          const [target] = await tx
            .select()
            .from(users)
            .where(eq(users.id, input.id))
            .for("update");
          if (!target) {
            throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
          }

          const nextQuota = input.quota ?? target.quota;
          const nextRole = input.role ?? target.role;
          const nextStatus = input.status ?? target.status;
          if (
            target.role === "admin" &&
            target.status === "active" &&
            (nextRole !== "admin" || nextStatus !== "active") &&
            activeAdmins.length <= 1
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "至少需要保留一个可用管理员账号",
            });
          }
          // 额度流水与用户余额更新必须在同一事务中，并基于锁定后的余额计算。
          if (nextQuota !== target.quota) {
            await tx.insert(creditLogs).values({
              userId: input.id,
              amount: nextQuota - target.quota,
              balanceAfter: nextQuota,
              type: "admin_adjust",
              remark: `管理员调整（操作人 #${ctx.user.id}）`,
            });
          }
          await tx
            .update(users)
            .set({
              ...(input.quota !== undefined ? { quota: nextQuota } : {}),
              ...(input.status ? { status: input.status } : {}),
              ...(input.role ? { role: input.role } : {}),
            })
            .where(eq(users.id, input.id));
        });
        return { ok: true };
      }),
  }),

  // ===== 生图价格 =====
  pricing: createRouter({
    list: adminQuery.query(async () => {
      return getDb()
        .select()
        .from(modelPricing)
        .orderBy(modelPricing.model, modelPricing.price);
    }),
    create: adminQuery
      .input(
        z.object({
          model: z.string().trim().min(1).max(255),
          label: z.string().trim().min(1).max(255),
          width: z.number().int().min(64).max(4096),
          height: z.number().int().min(64).max(4096),
          price: z.number().int().min(0),
        })
      )
      .mutation(async ({ input }) => {
        const db = getDb();
        if (
          isImage25Model(input.model) &&
          (input.width !== IMAGE_25_BASELINE.width ||
            input.height !== IMAGE_25_BASELINE.height)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Image 2.5 使用模型统一价格，不能新增独立尺寸价格项",
          });
        }
        const [duplicate] = await db
          .select({ id: modelPricing.id })
          .from(modelPricing)
          .where(
            isImage25Model(input.model)
              ? eq(modelPricing.model, input.model)
              : and(
                  eq(modelPricing.model, input.model),
                  eq(modelPricing.width, input.width),
                  eq(modelPricing.height, input.height)
                )
          )
          .limit(1);
        if (duplicate) {
          throw new TRPCError({
            code: "CONFLICT",
            message: isImage25Model(input.model)
              ? "该 Image 2.5 模型已存在统一价格项"
              : "该模型与尺寸已存在",
          });
        }
        await db.insert(modelPricing).values(input);
        return { ok: true };
      }),
    updatePrice: adminQuery
      .input(
        z.object({
          id: z.number().int().positive(),
          price: z.number().int().min(0),
        })
      )
      .mutation(async ({ input }) => {
        const db = getDb();
        const [target] = await db
          .select({ id: modelPricing.id })
          .from(modelPricing)
          .where(eq(modelPricing.id, input.id))
          .limit(1);
        if (!target) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "价格配置不存在",
          });
        }
        await db
          .update(modelPricing)
          .set({ price: input.price })
          .where(eq(modelPricing.id, input.id));
        return { ok: true };
      }),
    updateEnabled: adminQuery
      .input(
        z.object({
          id: z.number().int().positive(),
          enabled: z.boolean(),
        })
      )
      .mutation(async ({ input }) => {
        const db = getDb();
        const [target] = await db
          .select({ id: modelPricing.id })
          .from(modelPricing)
          .where(eq(modelPricing.id, input.id))
          .limit(1);
        if (!target) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "价格配置不存在",
          });
        }
        await db
          .update(modelPricing)
          .set({ enabled: input.enabled })
          .where(eq(modelPricing.id, input.id));
        return { ok: true };
      }),
    update: adminQuery
      .input(
        z.object({
          id: z.number().int().positive(),
          label: z.string().trim().min(1).max(255),
          width: z.number().int().min(64).max(4096),
          height: z.number().int().min(64).max(4096),
          price: z.number().int().min(0),
          enabled: z.boolean(),
        })
      )
      .mutation(async ({ input }) => {
        const db = getDb();
        const [current] = await db
          .select({
            model: modelPricing.model,
            width: modelPricing.width,
            height: modelPricing.height,
          })
          .from(modelPricing)
          .where(eq(modelPricing.id, input.id))
          .limit(1);
        if (!current) {
          throw new TRPCError({ code: "NOT_FOUND", message: "价格配置不存在" });
        }
        if (
          isImage25Model(current.model) &&
          (input.width !== IMAGE_25_BASELINE.width ||
            input.height !== IMAGE_25_BASELINE.height)
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Image 2.5 使用模型统一价格，内部基准尺寸不能修改",
          });
        }
        const [duplicate] = await db
          .select({ id: modelPricing.id })
          .from(modelPricing)
          .where(
            isImage25Model(current.model)
              ? and(
                  eq(modelPricing.model, current.model),
                  ne(modelPricing.id, input.id)
                )
              : and(
                  eq(modelPricing.model, current.model),
                  eq(modelPricing.width, input.width),
                  eq(modelPricing.height, input.height),
                  ne(modelPricing.id, input.id)
                )
          )
          .limit(1);
        if (duplicate) {
          throw new TRPCError({
            code: "CONFLICT",
            message: isImage25Model(current.model)
              ? "该 Image 2.5 模型存在重复价格项，请先清理重复配置"
              : "该模型与尺寸已存在",
          });
        }
        await db
          .update(modelPricing)
          .set({
            label: input.label,
            width: input.width,
            height: input.height,
            price: input.price,
            enabled: input.enabled,
          })
          .where(eq(modelPricing.id, input.id));
        return { ok: true };
      }),
    remove: adminQuery
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await getDb().delete(modelPricing).where(eq(modelPricing.id, input.id));
        return { ok: true };
      }),
  }),

  // ===== 卡密管理 =====
  cards: createRouter({
    list: adminQuery
      .input(
        z.object({
          status: z.enum(["all", "unused", "redeemed", "disabled"]).default("all"),
          limit: z.number().min(1).max(500).default(100),
        }),
      )
      .query(async ({ input }) => {
        const db = getDb();
        const cond = input.status === "all" ? undefined : eq(cardKeys.status, input.status);
        return db
          .select({
            id: cardKeys.id,
            code: cardKeys.code,
            credits: cardKeys.credits,
            status: cardKeys.status,
            batchNo: cardKeys.batchNo,
            remark: cardKeys.remark,
            redeemedAt: cardKeys.redeemedAt,
            createdAt: cardKeys.createdAt,
            redeemedByName: users.name,
          })
          .from(cardKeys)
          .leftJoin(users, eq(cardKeys.redeemedById, users.id))
          .where(cond)
          .orderBy(desc(cardKeys.id))
          .limit(input.limit);
      }),
    generate: adminQuery
      .input(
        z.object({
          count: z.number().int().min(1).max(200),
          credits: z.number().int().min(1).max(1_000_000_000),
          remark: z.string().max(255).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const db = getDb();
        const batchNo = `B${Date.now().toString(36).toUpperCase()}`;
        const codes = Array.from({ length: input.count }, () => makeCardCode());
        await db.transaction(async tx => {
          await tx.insert(cardKeys).values(
            codes.map(code => ({
              code,
              credits: input.credits,
              batchNo,
              remark: input.remark ?? null,
            }))
          );
        });
        return { batchNo, codes };
      }),
    setStatus: adminQuery
      .input(z.object({ id: z.number(), status: z.enum(["unused", "disabled"]) }))
      .mutation(async ({ input }) => {
        const db = getDb();
        const [card] = await db.select().from(cardKeys).where(eq(cardKeys.id, input.id));
        if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "卡密不存在" });
        if (card.status === "redeemed")
          throw new TRPCError({ code: "BAD_REQUEST", message: "已兑换的卡密不可修改" });
        await db.update(cardKeys).set({ status: input.status }).where(eq(cardKeys.id, input.id));
        return { ok: true };
      }),
  }),
});
