import {
  mysqlTable,
  mysqlEnum,
  serial,
  varchar,
  text,
  timestamp,
  bigint,
  int,
  boolean,
  double,
  index,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: serial("id").primaryKey(),
  unionId: varchar("unionId", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  email: varchar("email", { length: 320 }).unique(),
  passwordHash: varchar("passwordHash", { length: 255 }),
  avatar: text("avatar"),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  // 生图额度（积分）
  quota: int("quota").default(0).notNull(),
  // 账号状态
  status: mysqlEnum("status", ["active", "banned"]).default("active").notNull(),
  // 开放 API 密钥
  apiKey: varchar("apiKey", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
  lastSignInAt: timestamp("lastSignInAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const emailVerificationCodes = mysqlTable(
  "email_verification_codes",
  {
    id: serial("id").primaryKey(),
    userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
    purpose: mysqlEnum("purpose", ["password_change"])
      .default("password_change")
      .notNull(),
    codeHash: varchar("codeHash", { length: 64 }).notNull(),
    attempts: int("attempts").default(0).notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    usedAt: timestamp("usedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => [
    index("email_verification_user_purpose_created_idx").on(
      table.userId,
      table.purpose,
      table.createdAt
    ),
    index("email_verification_expires_idx").on(table.expiresAt),
  ]
);

export type EmailVerificationCode = typeof emailVerificationCodes.$inferSelect;

export const registrationEmailCodes = mysqlTable(
  "registration_email_codes",
  {
    email: varchar("email", { length: 320 }).primaryKey(),
    codeHash: varchar("codeHash", { length: 64 }).notNull(),
    attempts: int("attempts").default(0).notNull(),
    sendCount: int("sendCount").default(0).notNull(),
    windowStartedAt: timestamp("windowStartedAt"),
    lastSentAt: timestamp("lastSentAt"),
    expiresAt: timestamp("expiresAt").notNull(),
    usedAt: timestamp("usedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  table => [index("registration_email_expires_idx").on(table.expiresAt)]
);

export type RegistrationEmailCode = typeof registrationEmailCodes.$inferSelect;

// Preserve hashed legacy keys so existing API clients remain authenticated.
export const legacyApiKeys = mysqlTable("legacy_api_keys", {
  id: serial("id").primaryKey(),
  legacyId: varchar("legacyId", { length: 64 }).notNull().unique(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  keyHash: varchar("keyHash", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  prefix: varchar("prefix", { length: 32 }),
  last4: varchar("last4", { length: 8 }),
  status: mysqlEnum("status", ["active", "revoked"])
    .default("active")
    .notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  lastUsedAt: timestamp("lastUsedAt"),
  revokedAt: timestamp("revokedAt"),
});

export type LegacyApiKey = typeof legacyApiKeys.$inferSelect;

// ============ 生图模型上游配置 ============
export const upstreams = mysqlTable("upstreams", {
  id: serial("id").primaryKey(),
  legacyId: varchar("legacyId", { length: 64 }).unique(),
  name: varchar("name", { length: 255 }).notNull(),
  // demo = 内置演示上游（无需真实 API），openai = OpenAI 兼容图像接口
  provider: mysqlEnum("provider", ["demo", "openai"])
    .default("openai")
    .notNull(),
  baseUrl: varchar("baseUrl", { length: 512 }),
  apiKey: varchar("apiKey", { length: 512 }),
  model: varchar("model", { length: 255 }).notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  priority: int("priority").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type Upstream = typeof upstreams.$inferSelect;

// ============ 生图价格配置 ============
export const modelPricing = mysqlTable("model_pricing", {
  id: serial("id").primaryKey(),
  model: varchar("model", { length: 255 }).notNull(),
  label: varchar("label", { length: 255 }).notNull(),
  width: int("width").default(1024).notNull(),
  height: int("height").default(1024).notNull(),
  price: int("price").default(10).notNull(), // 积分 / 次
  enabled: boolean("enabled").default(true).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ModelPricing = typeof modelPricing.$inferSelect;

// ============ 生图历史 ============
export const generations = mysqlTable("generations", {
  id: serial("id").primaryKey(),
  legacyId: varchar("legacyId", { length: 64 }).unique(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  prompt: text("prompt").notNull(),
  negativePrompt: text("negativePrompt"),
  model: varchar("model", { length: 255 }).notNull(),
  width: int("width").default(1024).notNull(),
  height: int("height").default(1024).notNull(),
  imageUrl: text("imageUrl"),
  status: mysqlEnum("status", ["pending", "success", "failed"])
    .default("pending")
    .notNull(),
  cost: int("cost").default(0).notNull(),
  isPublic: boolean("isPublic").default(false).notNull(),
  errorMsg: text("errorMsg"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Generation = typeof generations.$inferSelect;

// ============ 卡密 ============
export const cardKeys = mysqlTable("card_keys", {
  id: serial("id").primaryKey(),
  legacyId: varchar("legacyId", { length: 64 }).unique(),
  code: varchar("code", { length: 32 }).notNull().unique(),
  credits: int("credits").notNull(),
  status: mysqlEnum("status", ["unused", "redeemed", "disabled"])
    .default("unused")
    .notNull(),
  redeemedById: bigint("redeemedById", { mode: "number", unsigned: true }),
  redeemedAt: timestamp("redeemedAt"),
  batchNo: varchar("batchNo", { length: 32 }),
  remark: varchar("remark", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CardKey = typeof cardKeys.$inferSelect;

// ============ 额度流水 ============
export const creditLogs = mysqlTable("credit_logs", {
  id: serial("id").primaryKey(),
  legacyId: varchar("legacyId", { length: 64 }).unique(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  amount: int("amount").notNull(), // 正为充值，负为消费
  balanceAfter: int("balanceAfter").notNull(),
  type: mysqlEnum("type", [
    "redeem",
    "generate",
    "refund",
    "admin_adjust",
  ]).notNull(),
  remark: varchar("remark", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CreditLog = typeof creditLogs.$inferSelect;

// ============ 社区点赞 ============
export const likes = mysqlTable("likes", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  generationId: bigint("generationId", {
    mode: "number",
    unsigned: true,
  }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Like = typeof likes.$inferSelect;

// ============ 无限画布节点 ============
export const canvasNodes = mysqlTable("canvas_nodes", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  type: mysqlEnum("type", ["image", "prompt", "copy"]).notNull(),
  // image 节点关联的生成记录
  refId: bigint("refId", { mode: "number", unsigned: true }),
  title: varchar("title", { length: 255 }),
  // prompt 文本 / copy 节点的 JSON 内容
  content: text("content"),
  x: double("x").default(0).notNull(),
  y: double("y").default(0).notNull(),
  w: int("w").default(280).notNull(),
  z: int("z").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt")
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});

export type CanvasNode = typeof canvasNodes.$inferSelect;

// ============ 画布连线 ============
export const canvasEdges = mysqlTable("canvas_edges", {
  id: serial("id").primaryKey(),
  userId: bigint("userId", { mode: "number", unsigned: true }).notNull(),
  fromId: bigint("fromId", { mode: "number", unsigned: true }).notNull(),
  toId: bigint("toId", { mode: "number", unsigned: true }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type CanvasEdge = typeof canvasEdges.$inferSelect;
