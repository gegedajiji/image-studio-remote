import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { desc, eq, like, or, sql } from "drizzle-orm";
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

function makeCardCode() {
  // 16 位卡密，4-4-4-4 分组，去掉易混淆字符
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const raw = randomBytes(16);
  const chars = Array.from(raw, (b) => alphabet[b % alphabet.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12)}`;
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
      return getDb().select().from(upstreams).orderBy(desc(upstreams.priority), desc(upstreams.id));
    }),
    create: adminQuery
      .input(
        z.object({
          name: z.string().min(1).max(255),
          provider: z.enum(["demo", "openai"]),
          baseUrl: z.string().max(512).optional(),
          apiKey: z.string().max(512).optional(),
          model: z.string().min(1).max(255),
          priority: z.number().int().default(0),
        }),
      )
      .mutation(async ({ input }) => {
        if (input.provider === "openai" && !input.baseUrl) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "OpenAI 兼容上游需填写 Base URL" });
        }
        await getDb().insert(upstreams).values({
          name: input.name,
          provider: input.provider,
          baseUrl: input.baseUrl || null,
          apiKey: input.apiKey || null,
          model: input.model,
          priority: input.priority,
        });
        return { ok: true };
      }),
    update: adminQuery
      .input(
        z.object({
          id: z.number(),
          name: z.string().min(1).max(255),
          provider: z.enum(["demo", "openai"]),
          baseUrl: z.string().max(512).optional(),
          apiKey: z.string().max(512).optional(),
          model: z.string().min(1).max(255),
          priority: z.number().int(),
          enabled: z.boolean(),
        }),
      )
      .mutation(async ({ input }) => {
        await getDb()
          .update(upstreams)
          .set({
            name: input.name,
            provider: input.provider,
            baseUrl: input.baseUrl || null,
            apiKey: input.apiKey || null,
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
        return db.select().from(users).where(cond).orderBy(desc(users.id)).limit(input.limit);
      }),
    update: adminQuery
      .input(
        z.object({
          id: z.number(),
          quota: z.number().int().min(0).optional(),
          status: z.enum(["active", "banned"]).optional(),
          role: z.enum(["user", "admin"]).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const db = getDb();
        const [target] = await db.select().from(users).where(eq(users.id, input.id));
        if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });

        // 额度变更记录流水
        if (input.quota !== undefined && input.quota !== target.quota) {
          const delta = input.quota - target.quota;
          await db.insert(creditLogs).values({
            userId: input.id,
            amount: delta,
            balanceAfter: input.quota,
            type: "admin_adjust",
            remark: `管理员调整（操作人 #${ctx.user.id}）`,
          });
        }
        await db
          .update(users)
          .set({
            ...(input.quota !== undefined ? { quota: input.quota } : {}),
            ...(input.status ? { status: input.status } : {}),
            ...(input.role ? { role: input.role } : {}),
          })
          .where(eq(users.id, input.id));
        return { ok: true };
      }),
  }),

  // ===== 生图价格 =====
  pricing: createRouter({
    list: adminQuery.query(async () => {
      return getDb().select().from(modelPricing).orderBy(modelPricing.model, modelPricing.price);
    }),
    create: adminQuery
      .input(
        z.object({
          model: z.string().min(1).max(255),
          label: z.string().min(1).max(255),
          width: z.number().int().min(64).max(4096),
          height: z.number().int().min(64).max(4096),
          price: z.number().int().min(0),
        }),
      )
      .mutation(async ({ input }) => {
        await getDb().insert(modelPricing).values(input);
        return { ok: true };
      }),
    update: adminQuery
      .input(
        z.object({
          id: z.number(),
          label: z.string().min(1).max(255),
          width: z.number().int().min(64).max(4096),
          height: z.number().int().min(64).max(4096),
          price: z.number().int().min(0),
          enabled: z.boolean(),
        }),
      )
      .mutation(async ({ input }) => {
        await getDb()
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
    remove: adminQuery.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      await getDb().delete(modelPricing).where(eq(modelPricing.id, input.id));
      return { ok: true };
    }),
  }),

  // ===== 生图历史（全部用户） =====
  generations: adminQuery
    .input(
      z.object({
        status: z.enum(["all", "pending", "success", "failed"]).default("all"),
        limit: z.number().min(1).max(200).default(50),
      }),
    )
    .query(async ({ input }) => {
      const db = getDb();
      const cond = input.status === "all" ? undefined : eq(generations.status, input.status);
      return db
        .select({
          id: generations.id,
          prompt: generations.prompt,
          model: generations.model,
          width: generations.width,
          height: generations.height,
          imageUrl: generations.imageUrl,
          status: generations.status,
          cost: generations.cost,
          errorMsg: generations.errorMsg,
          createdAt: generations.createdAt,
          userName: users.name,
          userId: users.id,
        })
        .from(generations)
        .innerJoin(users, eq(generations.userId, users.id))
        .where(cond)
        .orderBy(desc(generations.id))
        .limit(input.limit);
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
          credits: z.number().int().min(1),
          remark: z.string().max(255).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const db = getDb();
        const batchNo = `B${Date.now().toString(36).toUpperCase()}`;
        const codes: string[] = [];
        for (let i = 0; i < input.count; i++) {
          const code = makeCardCode();
          codes.push(code);
          await db.insert(cardKeys).values({
            code,
            credits: input.credits,
            batchNo,
            remark: input.remark ?? null,
          });
        }
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
