import "dotenv/config";
import mysql from "mysql2/promise";

const SOURCE_MODEL = "gpt-image-2";
const LOCK_NAME = "mirage-enable-image-2-6";
const size = { name: "自适应画幅（请求基准）", width: 1536, height: 1024 };
const models = [
  { id: "gpt-image-2.6-flare", displayName: "GPT Image 2.6 Flare", price: 15 },
  {
    id: "gpt-image-2.6-sunburst",
    displayName: "GPT Image 2.6 Sunburst",
    price: 20,
  },
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const connection = await mysql.createConnection(databaseUrl);
let lockAcquired = false;

try {
  const [[lockResult]] = await connection.execute(
    "SELECT GET_LOCK(?, 10) AS acquired",
    [LOCK_NAME]
  );
  if (Number(lockResult.acquired) !== 1) {
    throw new Error("Could not acquire the Image 2.6 upgrade lock");
  }
  lockAcquired = true;

  await connection.beginTransaction();
  const [sourceRows] = await connection.execute(
    `SELECT name, provider, baseUrl, apiKey, priority
       FROM upstreams
      WHERE model = ? AND enabled = 1
      ORDER BY priority DESC, id ASC
      LIMIT 1
      FOR UPDATE`,
    [SOURCE_MODEL]
  );
  const source = sourceRows[0];
  if (!source) throw new Error(`No enabled ${SOURCE_MODEL} upstream was found`);

  const results = [];
  for (const target of models) {
    const [existingUpstreams] = await connection.execute(
      "SELECT id FROM upstreams WHERE model = ? LIMIT 1",
      [target.id]
    );
    let upstreamAction = "skipped";
    if (!existingUpstreams.length) {
      await connection.execute(
        `INSERT INTO upstreams
           (name, provider, baseUrl, apiKey, model, enabled, priority)
         VALUES (?, ?, ?, ?, ?, 1, ?)`,
        [
          `${source.name} · ${target.displayName}`,
          source.provider,
          source.baseUrl,
          source.apiKey,
          target.id,
          source.priority,
        ]
      );
      upstreamAction = "created";
    }

    const [pricingRows] = await connection.execute(
      `SELECT id FROM model_pricing
        WHERE model = ? AND width = ? AND height = ?
        ORDER BY id ASC`,
      [target.id, size.width, size.height]
    );
    if (pricingRows.length > 1) {
      throw new Error(`Duplicate pricing rows found for ${target.id}`);
    }
    let pricingAction = "skipped";
    if (!pricingRows.length) {
      await connection.execute(
        `INSERT INTO model_pricing
           (model, label, width, height, price, enabled)
         VALUES (?, ?, ?, ?, ?, 1)`,
        [
          target.id,
          `${target.displayName} · ${size.name} ${size.width}×${size.height}`,
          size.width,
          size.height,
          target.price,
        ]
      );
      pricingAction = "created";
    }
    results.push({ model: target.id, upstreamAction, pricingAction });
  }

  await connection.commit();
  for (const result of results) {
    console.log(
      `${result.model}: upstream ${result.upstreamAction}; pricing ${result.pricingAction}`
    );
  }
  console.log("GPT Image 2.6 models are enabled");
} catch (error) {
  await connection.rollback().catch(() => undefined);
  throw error;
} finally {
  if (lockAcquired) {
    await connection
      .execute("SELECT RELEASE_LOCK(?)", [LOCK_NAME])
      .catch(() => undefined);
  }
  await connection.end();
}
