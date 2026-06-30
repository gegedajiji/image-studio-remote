import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'data');
const dbPath = path.join(dataDir, 'db.json');
const collections = [
  'users',
  'sessions',
  'transactions',
  'generations',
  'redeemCodes',
  'apiKeys',
  'communityPosts',
  'communityComments',
  'communityTips',
  'communityLikes',
  'communityReuses',
  'communityCommentReports',
  'communityDownloads',
  'communityFeedbackHandled'
];

function requireMysqlConfig() {
  const hasUrl = Boolean(process.env.MYSQL_URL || process.env.DATABASE_URL);
  const hasParts = Boolean(process.env.MYSQL_HOST && process.env.MYSQL_DATABASE && process.env.MYSQL_USER);
  if (!hasUrl && !hasParts) {
    throw new Error('缺少 MySQL 配置：请设置 MYSQL_URL，或设置 MYSQL_HOST/MYSQL_DATABASE/MYSQL_USER/MYSQL_PASSWORD');
  }
}

function mysqlPoolOptionsFromEnv() {
  const mysqlUrl = String(process.env.MYSQL_URL || process.env.DATABASE_URL || '').trim();
  if (mysqlUrl) {
    const url = new URL(mysqlUrl);
    if (!['mysql:', 'mysql2:'].includes(url.protocol)) throw new Error('MYSQL_URL 必须使用 mysql:// 协议');
    const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!database) throw new Error('MYSQL_URL 必须包含数据库名');
    return {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username || ''),
      password: decodeURIComponent(url.password || ''),
      database,
      waitForConnections: true,
      connectionLimit: 5,
      charset: 'utf8mb4',
      enableKeepAlive: true
    };
  }
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4',
    enableKeepAlive: true
  };
}

function countCollections(db) {
  return Object.fromEntries(collections.map((collection) => [
    collection,
    Array.isArray(db[collection]) ? db[collection].length : 0
  ]));
}

async function ensureSchema(pool) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS app_state (
      id TINYINT PRIMARY KEY,
      payload LONGTEXT NOT NULL,
      updated_at BIGINT NOT NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS object_snapshot (
      collection VARCHAR(80) NOT NULL,
      id VARCHAR(128) NOT NULL,
      payload LONGTEXT NOT NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (collection, id),
      INDEX object_snapshot_collection_idx (collection)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
  `);
}

async function migrate() {
  requireMysqlConfig();
  const mysql = await import('mysql2/promise');
  const pool = mysql.createPool(mysqlPoolOptionsFromEnv());
  const raw = await fs.readFile(dbPath, 'utf8');
  const db = JSON.parse(raw);
  const now = Date.now();
  await ensureSchema(pool);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO app_state (id, payload, updated_at)
       VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = VALUES(updated_at)`,
      [JSON.stringify(db, null, 2), now]
    );
    await connection.execute('DELETE FROM object_snapshot');
    const rows = [];
    for (const collection of collections) {
      const items = Array.isArray(db[collection]) ? db[collection] : [];
      for (const item of items) {
        if (!item?.id) continue;
        rows.push([collection, String(item.id), JSON.stringify(item), now]);
      }
    }
    const chunkSize = 100;
    for (let index = 0; index < rows.length; index += chunkSize) {
      const chunk = rows.slice(index, index + chunkSize);
      await connection.query('INSERT INTO object_snapshot (collection, id, payload, updated_at) VALUES ?', [chunk]);
    }
    await connection.commit();
    console.log(JSON.stringify({
      ok: true,
      migratedObjects: rows.length,
      collections: countCollections(db)
    }, null, 2));
  } catch (error) {
    try { await connection.rollback(); } catch {}
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

migrate().catch((error) => {
  console.error(`mysql migration failed: ${error.stack || error.message}`);
  process.exit(1);
});
