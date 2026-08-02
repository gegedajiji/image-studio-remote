import { getDb } from "../api/queries/connection";
import { upstreams, modelPricing, cardKeys } from "./schema";
import { randomBytes } from "crypto";

function makeCardCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const raw = randomBytes(16);
  const chars = Array.from(raw, (b) => alphabet[b % alphabet.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12)}`;
}

async function seed() {
  const db = getDb();
  console.log("Seeding database...");

  // 演示上游（若已存在则跳过）
  const existingUpstreams = await db.select().from(upstreams);
  if (existingUpstreams.length === 0) {
    await db.insert(upstreams).values({
      name: "内置演示上游",
      provider: "demo",
      model: "dream-v1",
      priority: 10,
      enabled: true,
    });
    console.log("✓ 已创建内置演示上游 (dream-v1)");
  }

  // 价格配置
  const existingPricing = await db.select().from(modelPricing);
  if (existingPricing.length === 0) {
    await db.insert(modelPricing).values([
      { model: "dream-v1", label: "梦幻 v1 · 方形 1024×1024", width: 1024, height: 1024, price: 10 },
      { model: "dream-v1", label: "梦幻 v1 · 横版 1280×720", width: 1280, height: 720, price: 12 },
      { model: "dream-v1", label: "梦幻 v1 · 竖版 768×1152", width: 768, height: 1152, price: 12 },
      { model: "dream-v1", label: "梦幻 v1 · 高清 1536×1024", width: 1536, height: 1024, price: 20 },
    ]);
    console.log("✓ 已创建价格配置");
  }

  // 演示卡密
  const existingCards = await db.select().from(cardKeys);
  if (existingCards.length === 0) {
    const batchNo = `B${Date.now().toString(36).toUpperCase()}`;
    for (let i = 0; i < 5; i++) {
      const code = makeCardCode();
      await db.insert(cardKeys).values({ code, credits: 100, batchNo, remark: "初始演示卡密" });
      console.log(`✓ 演示卡密: ${code} (100 积分)`);
    }
  }

  console.log("Done.");
  process.exit(0);
}

seed();
