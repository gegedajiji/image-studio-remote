/**
 * Add video generation support tables/columns.
 *
 * Idempotent: safe to run on every deploy. Adds:
 *   - upstreams.provider enum value "openai-video"
 *   - model_pricing.kind, model_pricing.durationSeconds
 *   - generations.kind, durationSeconds, videoUrl, upstreamJobId
 * Renames the legacy video_url column without losing stored video URLs.
 *
 * Also seeds disabled demo video tiers so the admin can enable them after
 * configuring a real video upstream.
 */
import "dotenv/config";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const connection = await mysql.createConnection(databaseUrl);

// DATABASE_URL 里的库名
const database = new URL(databaseUrl).pathname.replace("/", "");

async function tableColumns(table) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
    [database, table]
  );
  return new Set(rows.map(r => r.name));
}

async function enumValues(columnType) {
  const match = /enum\(([^)]+)\)/i.exec(columnType);
  if (!match) return new Set();
  return new Set(
    match[1].split(",").map(v => v.trim().replace(/^'|'$/g, ""))
  );
}

try {
  // 1. upstreams.provider enum 扩展
  {
    const [rows] = await connection.query(
      `SELECT COLUMN_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'upstreams' AND COLUMN_NAME = 'provider'`,
      [database]
    );
    if (rows.length) {
      const values = await enumValues(rows[0].type);
      if (!values.has("openai-video")) {
        const all = [...values, "openai-video"]
          .map(v => `'${v}'`)
          .join(",");
        await connection.query(
          `ALTER TABLE upstreams MODIFY COLUMN provider ENUM(${all}) NOT NULL DEFAULT 'openai'`
        );
        console.log("[migrate] upstreams.provider += openai-video");
      }
    }
  }

  // 2. model_pricing 新列
  {
    const cols = await tableColumns("model_pricing");
    if (!cols.has("kind")) {
      await connection.query(
        `ALTER TABLE model_pricing ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'image'`
      );
      console.log("[migrate] model_pricing.kind added");
    }
    if (!cols.has("durationSeconds")) {
      await connection.query(
        `ALTER TABLE model_pricing ADD COLUMN durationSeconds INT NOT NULL DEFAULT 0`
      );
      console.log("[migrate] model_pricing.durationSeconds added");
    }
  }

  // 3. generations 新列
  {
    const cols = await tableColumns("generations");
    if (!cols.has("kind")) {
      await connection.query(
        `ALTER TABLE generations ADD COLUMN kind VARCHAR(16) NOT NULL DEFAULT 'image'`
      );
      console.log("[migrate] generations.kind added");
    }
    if (!cols.has("durationSeconds")) {
      await connection.query(
        `ALTER TABLE generations ADD COLUMN durationSeconds INT NOT NULL DEFAULT 0`
      );
      console.log("[migrate] generations.durationSeconds added");
    }
    if (!cols.has("videoUrl")) {
      if (cols.has("video_url")) {
        await connection.query(
          `ALTER TABLE generations RENAME COLUMN video_url TO videoUrl`
        );
        console.log("[migrate] generations.video_url renamed to videoUrl");
      } else {
        await connection.query(`ALTER TABLE generations ADD COLUMN videoUrl TEXT`);
        console.log("[migrate] generations.videoUrl added");
      }
    }
    if (!cols.has("upstreamJobId")) {
      await connection.query(
        `ALTER TABLE generations ADD COLUMN upstreamJobId VARCHAR(128)`
      );
      console.log("[migrate] generations.upstreamJobId added");
    }
  }

  // 4. 种子：默认视频档位（disabled，等管理员配置上游后启用）
  {
    const [existing] = await connection.query(
      `SELECT COUNT(*) AS n FROM model_pricing WHERE kind = 'video'`
    );
    if (Number(existing[0].n) === 0) {
      await connection.query(
        `INSERT INTO model_pricing (model, label, kind, width, height, durationSeconds, price, enabled) VALUES
         ('sora-2', 'Sora 2 · 720p · 8秒', 'video', 1280, 720, 8, 60, 0),
         ('sora-2', 'Sora 2 · 720p · 12秒', 'video', 1280, 720, 12, 90, 0),
         ('sora-2', 'Sora 2 · 1080p · 8秒', 'video', 1920, 1080, 8, 100, 0)`
      );
      console.log("[migrate] seeded 3 disabled video pricing tiers (sora-2)");
    }
  }

  console.log("[migrate] video schema migration complete");
} finally {
  await connection.end();
}
