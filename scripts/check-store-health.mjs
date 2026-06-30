import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const rootDir = process.cwd();
const dataDir = path.join(rootDir, 'data');
const jsonPath = path.join(dataDir, 'db.json');
const sqlitePath = path.join(dataDir, 'app.sqlite');
const jobDir = path.join(dataDir, 'jobs');
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

function hasMysqlConfig() {
  return Boolean(
    process.env.MYSQL_URL ||
    process.env.DATABASE_URL ||
    process.env.MYSQL_HOST ||
    process.env.MYSQL_DATABASE ||
    process.env.STORE_DRIVER === 'mysql'
  );
}

function mysqlPoolOptionsFromEnv() {
  const mysqlUrl = String(process.env.MYSQL_URL || process.env.DATABASE_URL || '').trim();
  if (mysqlUrl) {
    const url = new URL(mysqlUrl);
    if (!['mysql:', 'mysql2:'].includes(url.protocol)) throw new Error('MYSQL_URL must use mysql:// protocol');
    const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!database) throw new Error('MYSQL_URL must include a database name');
    return {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username || ''),
      password: decodeURIComponent(url.password || ''),
      database,
      waitForConnections: true,
      connectionLimit: 2,
      charset: 'utf8mb4',
      enableKeepAlive: true
    };
  }
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'image_studio',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'image_studio',
    waitForConnections: true,
    connectionLimit: 2,
    charset: 'utf8mb4',
    enableKeepAlive: true
  };
}

function fail(message) {
  console.error(`store health check failed: ${message}`);
  process.exitCode = 1;
}

function readJsonDb() {
  if (!fs.existsSync(jsonPath)) {
    fail(`missing ${jsonPath}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (error) {
    fail(`db.json is not valid JSON: ${error.message}`);
    return null;
  }
}

function readSqliteCounts() {
  if (!fs.existsSync(sqlitePath)) return null;
  const result = spawnSync('sqlite3', [
    '-batch',
    '-noheader',
    sqlitePath,
    'select collection || "|" || count(*) from object_snapshot group by collection order by collection;'
  ], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`sqlite3 read failed: ${(result.stderr || '').trim() || result.status}`);
    return null;
  }
  return Object.fromEntries(
    result.stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [collection, count] = line.split('|');
        return [collection, Number(count || 0)];
      })
  );
}

function readSqliteGenerationJobs() {
  if (!fs.existsSync(sqlitePath)) return null;
  const tableCheck = spawnSync('sqlite3', [
    '-batch',
    '-noheader',
    sqlitePath,
    "select count(*) from sqlite_master where type='table' and name='generation_jobs';"
  ], { encoding: 'utf8' });
  if (tableCheck.status !== 0) {
    fail(`sqlite generation_jobs table check failed: ${(tableCheck.stderr || '').trim() || tableCheck.status}`);
    return null;
  }
  if (Number((tableCheck.stdout || '').trim() || 0) < 1) return null;
  const result = spawnSync('sqlite3', [
    '-batch',
    '-separator',
    '|',
    sqlitePath,
    "select generation_id, status, payload, lease_owner, lease_until from generation_jobs where status in ('queued','running') order by generation_id;"
  ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) {
    fail(`sqlite generation_jobs read failed: ${(result.stderr || '').trim() || result.status}`);
    return null;
  }
  return result.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [generationId, status, payload, leaseOwner, leaseUntil] = line.split('|');
      return { generationId, status, payload, leaseOwner, leaseUntil: Number(leaseUntil || 0) };
    });
}

function listFileGenerationJobs() {
  if (!fs.existsSync(jobDir)) return [];
  return fs.readdirSync(jobDir)
    .filter((name) => /^[a-zA-Z0-9_-]{8,80}\.json$/.test(name))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();
}

function checkUserBalances(db) {
  const usersById = new Map((db.users || []).map((user) => [user.id, user]));
  for (const user of db.users || []) {
    if (!user.id) fail(`user without id: ${user.account || user.username || '<unknown>'}`);
    if (!user.account && !user.username) fail(`user ${user.id} has no account or username`);
    if (!Number.isInteger(Number(user.balanceCents || 0))) fail(`user ${user.account || user.id} has invalid balance`);
  }
  for (const tx of db.transactions || []) {
    if (!tx.id) fail('transaction without id');
    if (!usersById.has(tx.userId)) fail(`transaction ${tx.id} references missing user ${tx.userId}`);
    if (!Number.isInteger(Number(tx.amountCents || 0))) fail(`transaction ${tx.id} has invalid amountCents`);
    if (!Number.isInteger(Number(tx.balanceAfterCents || 0))) fail(`transaction ${tx.id} has invalid balanceAfterCents`);
  }
}

async function readMysqlSnapshot(db) {
  if (!hasMysqlConfig()) return null;
  try {
    const mysql = await import('mysql2/promise');
    const pool = mysql.createPool(mysqlPoolOptionsFromEnv());
    try {
      const [appRows] = await pool.execute('SELECT payload FROM app_state WHERE id = 1 LIMIT 1');
      if (!appRows?.[0]?.payload) fail('mysql app_state is empty');
      const mysqlDb = appRows?.[0]?.payload ? JSON.parse(appRows[0].payload) : null;
      const [countRows] = await pool.execute(
        'SELECT collection, COUNT(*) AS count FROM object_snapshot GROUP BY collection ORDER BY collection'
      );
      const counts = Object.fromEntries(countRows.map((row) => [row.collection, Number(row.count || 0)]));
      for (const collection of collections) {
        const jsonCount = Array.isArray(db[collection]) ? db[collection].filter((item) => item?.id).length : 0;
        const mysqlCount = Number(counts[collection] || 0);
        if (jsonCount !== mysqlCount) {
          fail(`mysql snapshot count mismatch for ${collection}: json=${jsonCount} mysql=${mysqlCount}`);
        }
        const mysqlAppCount = Array.isArray(mysqlDb?.[collection]) ? mysqlDb[collection].length : 0;
        const jsonAppCount = Array.isArray(db[collection]) ? db[collection].length : 0;
        if (jsonAppCount !== mysqlAppCount) {
          fail(`mysql app_state count mismatch for ${collection}: json=${jsonAppCount} mysql=${mysqlAppCount}`);
        }
      }
      return { objectSnapshot: counts, appStatePresent: Boolean(mysqlDb) };
    } finally {
      await pool.end();
    }
  } catch (error) {
    fail(`mysql read failed: ${error.message}`);
    return null;
  }
}

async function main() {
  const db = readJsonDb();
  if (!db) return;
  for (const collection of collections) {
    if (!Array.isArray(db[collection])) fail(`db.${collection} is not an array`);
  }
  checkUserBalances(db);
  const sqliteCounts = readSqliteCounts();
  if (sqliteCounts) {
    for (const collection of collections) {
      const jsonCount = Array.isArray(db[collection]) ? db[collection].filter((item) => item?.id).length : 0;
      const sqliteCount = Number(sqliteCounts[collection] || 0);
      if (jsonCount !== sqliteCount) {
        fail(`sqlite snapshot count mismatch for ${collection}: json=${jsonCount} sqlite=${sqliteCount}`);
      }
    }
  }
  const sqliteJobs = readSqliteGenerationJobs();
  if (sqliteJobs) {
    const generationIds = new Set((db.generations || []).map((generation) => generation.id));
    sqliteJobs.forEach((job) => {
      if (!generationIds.has(job.generationId)) fail(`generation_jobs references missing generation ${job.generationId}`);
      try {
        const payload = JSON.parse(job.payload || '{}');
        if (payload.generationId !== job.generationId) fail(`generation_jobs payload id mismatch for ${job.generationId}`);
      } catch (error) {
        fail(`generation_jobs payload invalid for ${job.generationId}: ${error.message}`);
      }
      if (job.status === 'running' && (!job.leaseOwner || !Number.isFinite(job.leaseUntil) || job.leaseUntil <= 0)) {
        fail(`generation_jobs running job ${job.generationId} has invalid lease`);
      }
    });
  }
  const mysqlSnapshot = await readMysqlSnapshot(db);
  if (process.exitCode) return;
  const summary = Object.fromEntries(collections.map((collection) => [collection, db[collection].length]));
  console.log(JSON.stringify({
    ok: true,
    collections: summary,
    mysql: mysqlSnapshot,
    generationJobs: {
      files: listFileGenerationJobs().length,
      sqliteActive: sqliteJobs ? sqliteJobs.length : null
    }
  }, null, 2));
}

main().catch((error) => {
  fail(error.stack || error.message);
});
