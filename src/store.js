import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { DatabaseSync } from 'node:sqlite';
import { v4 as uuidv4 } from 'uuid';
import { config } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '..', 'data');
const dbPath = path.join(dataDir, 'db.json');
const backupDir = path.join(dataDir, 'backups');
const sqlitePath = path.join(dataDir, 'app.sqlite');

const initialDb = () => ({
  users: [],
  sessions: [],
  transactions: [],
  generations: [],
  redeemCodes: [],
  apiKeys: [],
  communityPosts: [],
  communityComments: [],
  communityCommentReports: [],
  communityFeedbackHandled: [],
  communityTips: [],
  communityLikes: [],
  communityReuses: [],
  communityDownloads: [],
  billingSettings: null,
  aiSettings: null
});

let db = initialDb();
let writeQueue = Promise.resolve();
let persistTimer = null;
let persistScheduled = false;
let persistWaiters = [];
let sqliteDb = null;
let sqliteStatements = null;
let sqliteSnapshotPayloads = new Map();
let mysqlPool = null;
let mysqlSnapshotPayloads = new Map();
let lastBackupAt = 0;
let persistMetrics = {
  scheduled: 0,
  flushed: 0,
  failed: 0,
  lastFlushAt: null,
  lastFlushDurationMs: null,
  lastError: null
};
const maxImageUpstreams = 10;
const imageUpstreamAutoDisableFailures = 5;
const minBackupIntervalMs = 1000 * 60 * 5;
const maxJsonBackups = 96;
const persistCoalesceMs = Math.max(0, Math.trunc(Number(process.env.STORE_PERSIST_COALESCE_MS ?? 25)));
const storeDriver = String(process.env.STORE_DRIVER || '').trim().toLowerCase();
const mysqlUrl = String(process.env.MYSQL_URL || process.env.DATABASE_URL || '').trim();
const mysqlRequested = storeDriver === 'mysql' || Boolean(mysqlUrl || process.env.MYSQL_HOST || process.env.MYSQL_DATABASE);
const mysqlPrimary = storeDriver === 'mysql';
const mysqlMetrics = {
  enabled: false,
  primary: mysqlPrimary,
  cachedObjects: 0,
  lastReadAt: null,
  lastWriteAt: null,
  lastError: null
};
const sqliteSnapshotCollections = [
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

export async function initStore({ recoverPending = true } = {}) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(backupDir, { recursive: true });
  initSqliteSnapshot();
  await initMysqlSnapshot();
  db = await loadDurableDb();
  db.redeemCodes ||= [];
  db.apiKeys ||= [];
  db.communityPosts ||= [];
  db.communityComments ||= [];
  db.communityCommentReports ||= [];
  db.communityFeedbackHandled ||= [];
  db.communityTips ||= [];
  db.communityLikes ||= [];
  db.communityReuses ||= [];
  db.communityDownloads ||= [];
  normalizeAiSettings();
  normalizeBillingSettings();
  normalizeExistingUsers();
  normalizeCommunityPostImages();
  rebuildCommunityPostStats();
  clearReportedPinnedComments();
  if (recoverPending) recoverPendingGenerations();
  pruneExpiredSessions();
  await ensureAdmin();
  await persist();
}

async function loadDurableDb() {
  const mysqlState = await readMysqlState();
  const sqliteState = readSqliteState();
  try {
    const raw = await fs.readFile(dbPath, 'utf8');
    const jsonDb = JSON.parse(raw);
    if (shouldPreferMysqlState(jsonDb, mysqlState)) {
      await fs.writeFile(`${dbPath}.replaced-by-mysql-${Date.now()}`, raw).catch(() => {});
      return mysqlState.db;
    }
    if (shouldPreferSqliteState(jsonDb, sqliteState)) {
      await fs.writeFile(`${dbPath}.replaced-by-sqlite-${Date.now()}`, raw).catch(() => {});
      return sqliteState.db;
    }
    return jsonDb;
  } catch (error) {
    if (mysqlState?.db) {
      console.error('db.json read failed, restored from mysql snapshot', error);
      return mysqlState.db;
    }
    if (sqliteState?.db) {
      console.error('db.json read failed, restored from sqlite snapshot', error);
      return sqliteState.db;
    }
    db = initialDb();
    await persist();
    return db;
  }
}

async function readMysqlState() {
  if (!mysqlPool) return null;
  try {
    const [rows] = await mysqlPool.execute('SELECT payload, updated_at FROM app_state WHERE id = 1 LIMIT 1');
    const row = rows?.[0];
    if (!row?.payload) return null;
    mysqlMetrics.lastReadAt = Date.now();
    mysqlMetrics.lastError = null;
    return {
      db: JSON.parse(row.payload),
      updatedAt: Number(row.updated_at || 0)
    };
  } catch (error) {
    mysqlMetrics.lastError = String(error?.message || error).slice(0, 300);
    console.error('mysql snapshot read failed', error);
    if (mysqlPrimary) throw error;
    return null;
  }
}

function readSqliteState() {
  if (!sqliteDb) return null;
  try {
    const row = sqliteStatements?.readAppState.get() || sqliteDb.prepare('SELECT payload, updated_at FROM app_state WHERE id = 1').get();
    if (!row?.payload) return null;
    return {
      db: JSON.parse(row.payload),
      updatedAt: Number(row.updated_at || 0)
    };
  } catch (error) {
    console.error('sqlite snapshot read failed', error);
    return null;
  }
}

function durableDbScore(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    users: Array.isArray(source.users) ? source.users.length : 0,
    generations: Array.isArray(source.generations) ? source.generations.length : 0,
    redeemCodes: Array.isArray(source.redeemCodes) ? source.redeemCodes.length : 0,
    transactions: Array.isArray(source.transactions) ? source.transactions.length : 0
  };
}

function shouldPreferSqliteState(jsonDb, sqliteState) {
  if (!sqliteState?.db) return false;
  const jsonScore = durableDbScore(jsonDb);
  const sqliteScore = durableDbScore(sqliteState.db);
  if (sqliteScore.users > jsonScore.users) return true;
  if (sqliteScore.generations > jsonScore.generations) return true;
  if (sqliteScore.redeemCodes > jsonScore.redeemCodes) return true;
  if (sqliteScore.transactions > jsonScore.transactions) return true;
  return false;
}

function shouldPreferMysqlState(jsonDb, mysqlState) {
  if (!mysqlState?.db) return false;
  if (mysqlPrimary) return true;
  const jsonScore = durableDbScore(jsonDb);
  const mysqlScore = durableDbScore(mysqlState.db);
  if (mysqlScore.users > jsonScore.users) return true;
  if (mysqlScore.generations > jsonScore.generations) return true;
  if (mysqlScore.redeemCodes > jsonScore.redeemCodes) return true;
  if (mysqlScore.transactions > jsonScore.transactions) return true;
  return false;
}

function mysqlPoolOptionsFromEnv() {
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
      connectionLimit: Math.max(1, Math.trunc(Number(process.env.MYSQL_CONNECTION_LIMIT || 5))),
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
    connectionLimit: Math.max(1, Math.trunc(Number(process.env.MYSQL_CONNECTION_LIMIT || 5))),
    charset: 'utf8mb4',
    enableKeepAlive: true
  };
}

async function initMysqlSnapshot() {
  if (!mysqlRequested) return;
  try {
    const mysql = await import('mysql2/promise');
    mysqlPool = mysql.createPool(mysqlPoolOptionsFromEnv());
    await mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS app_state (
        id TINYINT PRIMARY KEY,
        payload LONGTEXT NOT NULL,
        updated_at BIGINT NOT NULL
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    await mysqlPool.execute(`
      CREATE TABLE IF NOT EXISTS object_snapshot (
        collection VARCHAR(80) NOT NULL,
        id VARCHAR(128) NOT NULL,
        payload LONGTEXT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (collection, id),
        INDEX object_snapshot_collection_idx (collection)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    mysqlMetrics.enabled = true;
    mysqlMetrics.lastError = null;
    await hydrateMysqlSnapshotCache();
  } catch (error) {
    mysqlMetrics.enabled = false;
    mysqlMetrics.lastError = String(error?.message || error).slice(0, 300);
    console.error('mysql snapshot init failed', error);
    mysqlPool = null;
    mysqlSnapshotPayloads = new Map();
    if (mysqlPrimary) throw error;
  }
}

function initSqliteSnapshot() {
  try {
    sqliteDb = new DatabaseSync(sqlitePath);
    sqliteDb.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS object_snapshot (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE INDEX IF NOT EXISTS object_snapshot_collection_idx ON object_snapshot(collection);
    `);
    sqliteStatements = {
      readAppState: sqliteDb.prepare('SELECT payload, updated_at FROM app_state WHERE id = 1'),
      upsertAppState: sqliteDb.prepare(`
        INSERT INTO app_state (id, payload, updated_at)
        VALUES (1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
      `),
      upsertObject: sqliteDb.prepare(`
        INSERT INTO object_snapshot (collection, id, payload, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(collection, id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
      `),
      deleteObject: sqliteDb.prepare('DELETE FROM object_snapshot WHERE collection = ? AND id = ?'),
      listObjects: sqliteDb.prepare('SELECT collection, id, payload FROM object_snapshot')
    };
    hydrateSqliteSnapshotCache();
  } catch (error) {
    console.error('sqlite snapshot init failed', error);
    sqliteDb = null;
    sqliteStatements = null;
    sqliteSnapshotPayloads = new Map();
  }
}

function sqliteSnapshotKey(collection, id) {
  return `${collection}:${id}`;
}

function hydrateSqliteSnapshotCache() {
  sqliteSnapshotPayloads = new Map();
  if (!sqliteStatements?.listObjects) return;
  const allowed = new Set(sqliteSnapshotCollections);
  try {
    sqliteStatements.listObjects.all().forEach((row) => {
      if (!allowed.has(row.collection) || !row.id) return;
      sqliteSnapshotPayloads.set(sqliteSnapshotKey(row.collection, row.id), row.payload);
    });
  } catch (error) {
    console.error('sqlite snapshot cache hydrate failed', error);
    sqliteSnapshotPayloads = new Map();
  }
}

async function hydrateMysqlSnapshotCache() {
  mysqlSnapshotPayloads = new Map();
  if (!mysqlPool) return;
  const allowed = new Set(sqliteSnapshotCollections);
  try {
    const [rows] = await mysqlPool.execute('SELECT collection, id, payload FROM object_snapshot');
    rows.forEach((row) => {
      if (!allowed.has(row.collection) || !row.id) return;
      mysqlSnapshotPayloads.set(sqliteSnapshotKey(row.collection, row.id), row.payload);
    });
    mysqlMetrics.cachedObjects = mysqlSnapshotPayloads.size;
    mysqlMetrics.lastError = null;
  } catch (error) {
    mysqlMetrics.lastError = String(error?.message || error).slice(0, 300);
    console.error('mysql snapshot cache hydrate failed', error);
    mysqlSnapshotPayloads = new Map();
    mysqlMetrics.cachedObjects = 0;
    if (mysqlPrimary) throw error;
  }
}

async function rotateJsonBackups() {
  const now = Date.now();
  if (now - lastBackupAt < minBackupIntervalMs) return;
  try {
    const raw = await fs.readFile(dbPath, 'utf8');
    if (!raw.trim()) return;
    await fs.mkdir(backupDir, { recursive: true });
    const backupPath = path.join(backupDir, `db-${new Date(now).toISOString().replace(/[:.]/g, '-')}.json`);
    await fs.writeFile(backupPath, raw);
    lastBackupAt = now;
    const entries = (await fs.readdir(backupDir))
      .filter((name) => /^db-.*\.json$/.test(name))
      .sort();
    const stale = entries.slice(0, Math.max(0, entries.length - maxJsonBackups));
    await Promise.all(stale.map((name) => fs.unlink(path.join(backupDir, name)).catch(() => {})));
  } catch {
    // Backup is protective only; a failed backup must not block writes.
  }
}

function writeSqliteSnapshot(payload, now = Date.now()) {
  if (!sqliteDb || !sqliteStatements) return;
  try {
    sqliteDb.exec('BEGIN IMMEDIATE');
    sqliteStatements.upsertAppState.run(payload, now);
    const seen = new Set();
    sqliteSnapshotCollections.forEach((collection) => {
      const items = Array.isArray(db[collection]) ? db[collection] : [];
      items.forEach((item) => {
        if (!item?.id) return;
        const id = String(item.id);
        const key = sqliteSnapshotKey(collection, id);
        const itemPayload = JSON.stringify(item);
        seen.add(key);
        if (sqliteSnapshotPayloads.get(key) === itemPayload) return;
        sqliteStatements.upsertObject.run(collection, id, itemPayload, now);
        sqliteSnapshotPayloads.set(key, itemPayload);
      });
    });
    for (const [key] of sqliteSnapshotPayloads) {
      if (seen.has(key)) continue;
      const separatorIndex = key.indexOf(':');
      const collection = key.slice(0, separatorIndex);
      const id = key.slice(separatorIndex + 1);
      sqliteStatements.deleteObject.run(collection, id);
      sqliteSnapshotPayloads.delete(key);
    }
    sqliteDb.exec('COMMIT');
  } catch (error) {
    try { sqliteDb.exec('ROLLBACK'); } catch {}
    console.error('sqlite snapshot write failed', error);
    hydrateSqliteSnapshotCache();
  }
}

async function writeMysqlSnapshot(payload, now = Date.now()) {
  if (!mysqlPool) return;
  const connection = await mysqlPool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `INSERT INTO app_state (id, payload, updated_at)
       VALUES (1, ?, ?)
       ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = VALUES(updated_at)`,
      [payload, now]
    );
    const seen = new Set();
    for (const collection of sqliteSnapshotCollections) {
      const items = Array.isArray(db[collection]) ? db[collection] : [];
      for (const item of items) {
        if (!item?.id) continue;
        const id = String(item.id);
        const key = sqliteSnapshotKey(collection, id);
        const itemPayload = JSON.stringify(item);
        seen.add(key);
        if (mysqlSnapshotPayloads.get(key) === itemPayload) continue;
        await connection.execute(
          `INSERT INTO object_snapshot (collection, id, payload, updated_at)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE payload = VALUES(payload), updated_at = VALUES(updated_at)`,
          [collection, id, itemPayload, now]
        );
        mysqlSnapshotPayloads.set(key, itemPayload);
      }
    }
    for (const [key] of mysqlSnapshotPayloads) {
      if (seen.has(key)) continue;
      const separatorIndex = key.indexOf(':');
      const collection = key.slice(0, separatorIndex);
      const id = key.slice(separatorIndex + 1);
      await connection.execute('DELETE FROM object_snapshot WHERE collection = ? AND id = ?', [collection, id]);
      mysqlSnapshotPayloads.delete(key);
    }
    await connection.commit();
    mysqlMetrics.cachedObjects = mysqlSnapshotPayloads.size;
    mysqlMetrics.lastWriteAt = Date.now();
    mysqlMetrics.lastError = null;
  } catch (error) {
    try { await connection.rollback(); } catch {}
    mysqlMetrics.lastError = String(error?.message || error).slice(0, 300);
    console.error('mysql snapshot write failed', error);
    await hydrateMysqlSnapshotCache().catch(() => {});
    if (mysqlPrimary) throw error;
  } finally {
    connection.release();
  }
}

function cleanBaseUrl(value, fallback = config.upstreamBaseUrl) {
  const raw = String(value || fallback || '').trim();
  if (!raw) return '';
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('上游地址必须是有效 URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('上游地址必须以 http:// 或 https:// 开头');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
}

function cleanOptionalBaseUrl(value) {
  const raw = String(value || '').trim();
  return raw ? cleanBaseUrl(raw, '') : '';
}

function cleanModelName(value, fallback) {
  const model = String(value || fallback || '').trim();
  if (!model) throw new Error('模型名称不能为空');
  if (model.length > 120 || !/^[a-zA-Z0-9._:/@-]+$/.test(model)) {
    throw new Error('模型名称只能包含字母、数字、点、斜杠、下划线、冒号、@ 和短横线');
  }
  return model;
}

function cleanUpstreamId(value) {
  const id = String(value || '').trim();
  return /^[a-zA-Z0-9_-]{8,80}$/.test(id) ? id : uuidv4();
}

function cleanUpstreamName(value, fallback) {
  const name = String(value || fallback || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return (name || '生图通道').slice(0, 40);
}

function cleanUpstreamPriority(value, fallback) {
  const priority = Math.trunc(Number(value ?? fallback));
  if (!Number.isInteger(priority)) return Math.trunc(Number(fallback || 10)) || 10;
  return Math.max(1, Math.min(999, priority));
}

function cleanUpstreamWeight(value, fallback = 1) {
  const weight = Math.trunc(Number(value ?? fallback));
  if (!Number.isInteger(weight)) return Math.max(1, Math.min(100, Math.trunc(Number(fallback || 1)) || 1));
  return Math.max(1, Math.min(100, weight));
}

function cleanUpstreamEnabled(value, fallback = true) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return Boolean(fallback);
}

function normalizeImageUpstream(input, index, { existing = null, legacyPriorityMode = false, strict = false, usedIds = new Set() } = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const now = Date.now();
  let id = cleanUpstreamId(source.id || existing?.id);
  while (usedIds.has(id)) id = uuidv4();
  usedIds.add(id);

  const hasApiKeyField = Object.prototype.hasOwnProperty.call(source, 'upstreamApiKey');
  const incomingApiKey = hasApiKeyField ? String(source.upstreamApiKey || '').trim() : '';
  const clearApiKey = cleanUpstreamEnabled(source.clearUpstreamApiKey, false);
  const upstreamApiKey = clearApiKey
    ? incomingApiKey
    : (incomingApiKey || existing?.upstreamApiKey || String(source.upstreamApiKey || '').trim());
  if (upstreamApiKey.length > 300) throw new Error('生图 API Key 长度异常');

  const upstreamBaseUrl = Object.prototype.hasOwnProperty.call(source, 'upstreamBaseUrl')
    ? cleanOptionalBaseUrl(source.upstreamBaseUrl)
    : cleanOptionalBaseUrl(existing?.upstreamBaseUrl);
  const enabled = cleanUpstreamEnabled(source.enabled, existing?.enabled ?? true);
  const fallbackModel = existing?.imageModel || config.imageModel;
  const rawModel = Object.prototype.hasOwnProperty.call(source, 'imageModel') ? source.imageModel : existing?.imageModel;
  const imageModel = String(rawModel || '').trim()
    ? cleanModelName(rawModel, fallbackModel)
    : (enabled ? cleanModelName('', fallbackModel) : '');
  const name = cleanUpstreamName(source.name, existing?.name || `生图通道 ${index + 1}`);
  const rawPriority = Number(source.priority ?? existing?.priority ?? ((index + 1) * 10));
  const priority = legacyPriorityMode
    ? cleanUpstreamPriority(Number.isFinite(rawPriority) ? 1000 - rawPriority : 100 - index, 100 - index)
    : cleanUpstreamPriority(source.priority, existing?.priority ?? (100 - index));
  const weight = cleanUpstreamWeight(source.weight, existing?.weight ?? 1);
  const autoBan = cleanUpstreamEnabled(source.autoBan, existing?.autoBan ?? false);
  const manuallyReenabled = strict && enabled && existing?.enabled === false;

  if (strict && enabled) {
    if (!upstreamBaseUrl) throw new Error(`${name} 已启用，请填写 Base URL`);
    if (!upstreamApiKey) throw new Error(`${name} 已启用，请填写 API Key`);
    if (!imageModel) throw new Error(`${name} 已启用，请填写图像模型`);
  }

  return {
    id,
    name,
    upstreamBaseUrl,
    upstreamApiKey,
    imageModel,
    enabled,
    priority,
    weight,
    autoBan,
    failureCount: manuallyReenabled ? 0 : Math.max(0, Math.trunc(Number(source.failureCount ?? existing?.failureCount ?? 0)) || 0),
    cooldownUntil: manuallyReenabled ? 0 : Math.max(0, Math.trunc(Number(source.cooldownUntil ?? existing?.cooldownUntil ?? 0)) || 0),
    lastError: manuallyReenabled ? '' : String(source.lastError ?? existing?.lastError ?? '').slice(0, 240),
    lastFailedAt: manuallyReenabled ? null : Number(source.lastFailedAt || existing?.lastFailedAt || 0) || null,
    lastUsedAt: Number(source.lastUsedAt || existing?.lastUsedAt || 0) || null,
    createdAt: Number(source.createdAt || existing?.createdAt || now),
    updatedAt: Number(source.updatedAt || existing?.updatedAt || now)
  };
}

function defaultLegacyImageUpstream(current = {}) {
  return {
    id: current.imageUpstreamId || 'default-image-upstream',
    name: current.upstreamName || '默认生图通道',
    upstreamBaseUrl: current.upstreamBaseUrl || config.upstreamBaseUrl,
    upstreamApiKey: current.upstreamApiKey || config.upstreamApiKey || '',
    imageModel: current.imageModel || config.imageModel,
    enabled: true,
    priority: 100,
    weight: 1,
    autoBan: false,
    failureCount: 0,
    cooldownUntil: 0,
    lastError: '',
    lastFailedAt: null,
    lastUsedAt: null,
    createdAt: current.updatedAt || Date.now(),
    updatedAt: current.updatedAt || Date.now()
  };
}

function normalizeImageUpstreams(current = {}, { strict = false } = {}) {
  const rawList = Array.isArray(current.imageUpstreams) && current.imageUpstreams.length
    ? current.imageUpstreams
    : [defaultLegacyImageUpstream(current)];
  if (rawList.length > maxImageUpstreams) throw new Error(`生图通道最多支持 ${maxImageUpstreams} 个`);
  const usedIds = new Set();
  const legacyPriorityMode = Number(current.dispatchVersion || 0) < 2;
  const existingById = new Map((Array.isArray(db.aiSettings?.imageUpstreams) ? db.aiSettings.imageUpstreams : [])
    .map((item) => [String(item.id || ''), item]));
  const imageUpstreams = rawList
    .slice(0, maxImageUpstreams)
    .map((item, index) => normalizeImageUpstream(item, index, {
      existing: existingById.get(String(item?.id || '')) || null,
      legacyPriorityMode,
      strict,
      usedIds
    }));
  if (!imageUpstreams.length) throw new Error('至少需要一个生图通道');
  if (strict && !imageUpstreams.some((item) => item.enabled && item.upstreamBaseUrl && item.upstreamApiKey && item.imageModel)) {
    throw new Error('至少保留一个启用且完整的生图通道');
  }
  return imageUpstreams;
}

function primaryImageUpstream(imageUpstreams = []) {
  return [...imageUpstreams]
    .sort((a, b) => (a.enabled === b.enabled ? 0 : a.enabled ? -1 : 1) || b.priority - a.priority || a.createdAt - b.createdAt)
    .find((item) => item.upstreamBaseUrl || item.upstreamApiKey || item.imageModel)
    || imageUpstreams[0]
    || defaultLegacyImageUpstream();
}

function normalizeAiSettings() {
  const current = db.aiSettings && typeof db.aiSettings === 'object' ? db.aiSettings : {};
  const imageUpstreams = normalizeImageUpstreams(current);
  const primary = primaryImageUpstream(imageUpstreams);
  const hasTextApiKey = Object.prototype.hasOwnProperty.call(current, 'textUpstreamApiKey');
  db.aiSettings = {
    imageUpstreams,
    dispatchVersion: 2,
    upstreamBaseUrl: primary.upstreamBaseUrl || '',
    upstreamApiKey: primary.upstreamApiKey || '',
    imageModel: primary.imageModel || cleanModelName('', config.imageModel),
    textUpstreamBaseUrl: cleanBaseUrl(current.textUpstreamBaseUrl || primary.upstreamBaseUrl || config.textUpstreamBaseUrl || config.upstreamBaseUrl),
    textUpstreamApiKey: hasTextApiKey
      ? String(current.textUpstreamApiKey || '').trim()
      : String(primary.upstreamApiKey || config.textUpstreamApiKey || config.upstreamApiKey || '').trim(),
    textModel: cleanModelName(current.textModel, config.textModel),
    updatedAt: Number(current.updatedAt || Date.now()),
    updatedBy: current.updatedBy || null
  };
}

function maskSecret(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (text.length <= 10) return `${text.slice(0, 2)}***${text.slice(-2)}`;
  return `${text.slice(0, 6)}***${text.slice(-4)}`;
}

function publicAiSettings(settings) {
  const publicImageUpstreams = (settings.imageUpstreams || []).map((item) => ({
    id: item.id,
    name: item.name,
    upstreamBaseUrl: item.upstreamBaseUrl,
    upstreamApiKeyConfigured: Boolean(item.upstreamApiKey),
    upstreamApiKeyMasked: maskSecret(item.upstreamApiKey),
    imageModel: item.imageModel,
    enabled: Boolean(item.enabled),
    priority: item.priority,
    weight: item.weight,
    autoBan: Boolean(item.autoBan),
    failureCount: item.failureCount || 0,
    cooldownUntil: item.cooldownUntil || 0,
    coolingDown: Number(item.cooldownUntil || 0) > Date.now(),
    lastError: item.lastError || '',
    lastFailedAt: item.lastFailedAt || null,
    lastUsedAt: item.lastUsedAt || null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  }));
  return {
    imageUpstreams: publicImageUpstreams,
    upstreamBaseUrl: settings.upstreamBaseUrl,
    upstreamApiKeyConfigured: Boolean(settings.upstreamApiKey),
    upstreamApiKeyMasked: maskSecret(settings.upstreamApiKey),
    imageModel: settings.imageModel,
    textUpstreamBaseUrl: settings.textUpstreamBaseUrl,
    textUpstreamApiKeyConfigured: Boolean(settings.textUpstreamApiKey),
    textUpstreamApiKeyMasked: maskSecret(settings.textUpstreamApiKey),
    textModel: settings.textModel,
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy || null
  };
}

export function aiSettings({ includeSecret = false } = {}) {
  normalizeAiSettings();
  const settings = structuredClone(db.aiSettings);
  return includeSecret ? settings : publicAiSettings(settings);
}

export async function updateAiSettings({ settings, operatorId }) {
  normalizeAiSettings();
  const existingImageUpstreams = db.aiSettings.imageUpstreams || [];
  const submittedImageUpstreams = Array.isArray(settings?.imageUpstreams)
    ? settings.imageUpstreams
    : [{
      id: existingImageUpstreams[0]?.id,
      name: existingImageUpstreams[0]?.name || '默认生图通道',
      upstreamBaseUrl: settings?.upstreamBaseUrl,
      upstreamApiKey: settings?.upstreamApiKey,
      imageModel: settings?.imageModel,
      enabled: true,
      priority: existingImageUpstreams[0]?.priority || 100,
      weight: existingImageUpstreams[0]?.weight || 1,
      autoBan: existingImageUpstreams[0]?.autoBan || false
    }];
  const existingById = new Map(existingImageUpstreams.map((item) => [String(item.id || ''), item]));
  const usedIds = new Set();
  const imageUpstreams = submittedImageUpstreams.slice(0, maxImageUpstreams).map((item, index) => normalizeImageUpstream(item, index, {
    existing: existingById.get(String(item?.id || '')) || null,
    strict: true,
    usedIds
  }));
  if (!imageUpstreams.length) throw new Error('至少需要一个生图通道');
  if (submittedImageUpstreams.length > maxImageUpstreams) throw new Error(`生图通道最多支持 ${maxImageUpstreams} 个`);
  if (!imageUpstreams.some((item) => item.enabled && item.upstreamBaseUrl && item.upstreamApiKey && item.imageModel)) {
    throw new Error('至少保留一个启用且完整的生图通道');
  }
  const hasTextApiKeyField = Object.prototype.hasOwnProperty.call(settings || {}, 'textUpstreamApiKey');
  const primary = primaryImageUpstream(imageUpstreams);
  const next = {
    imageUpstreams: imageUpstreams.map((item) => ({ ...item, updatedAt: Date.now() })),
    dispatchVersion: 2,
    upstreamBaseUrl: primary.upstreamBaseUrl,
    upstreamApiKey: primary.upstreamApiKey,
    imageModel: primary.imageModel,
    textUpstreamBaseUrl: cleanBaseUrl(settings?.textUpstreamBaseUrl, db.aiSettings.textUpstreamBaseUrl || primary.upstreamBaseUrl),
    textUpstreamApiKey: cleanUpstreamEnabled(settings?.clearTextUpstreamApiKey, false)
      ? String(settings?.textUpstreamApiKey || '').trim()
      : (hasTextApiKeyField && String(settings?.textUpstreamApiKey || '').trim()
        ? String(settings.textUpstreamApiKey).trim()
        : db.aiSettings.textUpstreamApiKey),
    textModel: cleanModelName(settings?.textModel, db.aiSettings.textModel),
    updatedAt: Date.now(),
    updatedBy: operatorId || null
  };
  if (next.upstreamApiKey.length > 300) throw new Error('API Key 长度异常');
  if (next.textUpstreamApiKey.length > 300) throw new Error('文本 API Key 长度异常');
  db.aiSettings = next;
  await persist();
  return aiSettings();
}

export async function recordImageUpstreamResult({ upstreamId, success, errorMessage }) {
  normalizeAiSettings();
  const upstream = db.aiSettings.imageUpstreams.find((item) => item.id === upstreamId);
  if (!upstream) return null;
  const now = Date.now();
  if (success) {
    upstream.failureCount = 0;
    upstream.cooldownUntil = 0;
    upstream.lastError = '';
    upstream.lastUsedAt = now;
  } else {
    const nextFailures = Math.max(1, Number(upstream.failureCount || 0) + 1);
    const cooldownMs = Math.min(10 * 60 * 1000, 20 * 1000 * (2 ** Math.min(nextFailures - 1, 5)));
    upstream.failureCount = nextFailures;
    upstream.cooldownUntil = now + cooldownMs;
    upstream.lastError = String(errorMessage || '请求失败').slice(0, 240);
    upstream.lastFailedAt = now;
    if (upstream.autoBan && nextFailures >= imageUpstreamAutoDisableFailures) {
      upstream.enabled = false;
      upstream.cooldownUntil = 0;
      upstream.lastError = `连续失败 ${nextFailures} 次，已自动停用：${upstream.lastError}`;
    }
  }
  upstream.updatedAt = now;
  await persist();
  return publicAiSettings(db.aiSettings).imageUpstreams.find((item) => item.id === upstreamId) || null;
}

function normalizeBillingSettings() {
  const defaults = {
    prices: {
      '1k': config.prices['1k'],
      '2k': config.prices['2k']
    },
    purchaseCodeUrl: config.purchaseCodeUrl || '',
    updatedAt: Date.now(),
    updatedBy: null
  };
  const current = db.billingSettings && typeof db.billingSettings === 'object' ? db.billingSettings : {};
  const currentPrices = current.prices && typeof current.prices === 'object' ? current.prices : {};
  const price1k = Math.trunc(Number(currentPrices['1k'] ?? defaults.prices['1k']));
  const price2k = Math.trunc(Number(currentPrices['2k'] ?? defaults.prices['2k']));
  db.billingSettings = {
    ...current,
    prices: {
      '1k': Number.isInteger(price1k) && price1k > 0 ? price1k : defaults.prices['1k'],
      '2k': Number.isInteger(price2k) && price2k > 0 ? price2k : defaults.prices['2k']
    },
    purchaseCodeUrl: Object.prototype.hasOwnProperty.call(current, 'purchaseCodeUrl')
      ? normalizePurchaseCodeUrl(current.purchaseCodeUrl, '')
      : defaults.purchaseCodeUrl,
    updatedAt: Number(current.updatedAt || defaults.updatedAt),
    updatedBy: current.updatedBy || null
  };
}

function normalizePurchaseCodeUrl(value, fallback = '') {
  const text = String(value || '').trim();
  if (!text) return String(fallback || '').trim();
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) return String(fallback || '').trim();
    return url.toString();
  } catch {
    return String(fallback || '').trim();
  }
}

function assertPurchaseCodeUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('购买链接必须是 http 或 https 地址');
    return url.toString();
  } catch (error) {
    if (error.message.includes('购买链接')) throw error;
    throw new Error('购买链接格式不正确');
  }
}

export function billingSettings() {
  normalizeBillingSettings();
  return structuredClone(db.billingSettings);
}

export function billingPrices() {
  return billingSettings().prices;
}

export async function updateBillingPrices({ prices, purchaseCodeUrl, operatorId }) {
  const price1k = Math.trunc(Number(prices?.['1k']));
  const price2k = Math.trunc(Number(prices?.['2k']));
  if (!Number.isInteger(price1k) || price1k <= 0) throw new Error('标准质量价格必须是大于 0 的整数分');
  if (!Number.isInteger(price2k) || price2k <= 0) throw new Error('高质量价格必须是大于 0 的整数分');
  if (price1k > 100000 || price2k > 100000) throw new Error('单张价格不能超过 1000 奇点');
  const now = Date.now();
  const current = billingSettings();
  const nextPurchaseCodeUrl = Object.prototype.hasOwnProperty.call(arguments[0] || {}, 'purchaseCodeUrl')
    ? assertPurchaseCodeUrl(purchaseCodeUrl)
    : current.purchaseCodeUrl;
  db.billingSettings = {
    ...current,
    prices: { '1k': price1k, '2k': price2k },
    purchaseCodeUrl: nextPurchaseCodeUrl,
    updatedAt: now,
    updatedBy: operatorId || null
  };
  await persist();
  return billingSettings();
}

function normalizeExistingUsers() {
  db.users.forEach((user) => {
    user.account ||= user.username;
    user.username ||= user.account;
  });
}

function generationImageCount(generation) {
  if (!generation) return 0;
  if (Array.isArray(generation.images) && generation.images.length) return generation.images.length;
  return generation.imageUrl || generation.imageBase64 ? 1 : 0;
}

function normalizeImageIndexes(input, fallbackIndex, imageCount) {
  if (imageCount < 1) return [];
  const raw = Array.isArray(input) ? input : [fallbackIndex];
  const indexes = [];
  raw.forEach((value) => {
    const index = Math.trunc(Number(value));
    if (!Number.isInteger(index) || index < 0 || index >= imageCount || indexes.includes(index)) return;
    indexes.push(index);
  });
  if (indexes.length) return indexes;
  const fallback = Math.trunc(Number(fallbackIndex || 0));
  return [Math.max(0, Math.min(imageCount - 1, Number.isInteger(fallback) ? fallback : 0))];
}

function normalizeCommunityPostImages() {
  db.communityPosts.forEach((post) => {
    if (Array.isArray(post.imageIndexes) && post.imageIndexes.length) return;
    const generation = db.generations.find((item) => item.id === post.generationId);
    const count = generationImageCount(generation);
    if (count > 1) post.imageIndexes = [0];
  });
}

function communityPostDownloadImageIndexes(post) {
  const generation = db.generations.find((item) => item.id === post?.generationId);
  const imageCount = generationImageCount(generation);
  if (imageCount < 1) return [];
  const selected = Array.isArray(post?.imageIndexes) && post.imageIndexes.length
    ? post.imageIndexes
      .map((index) => Math.trunc(Number(index)))
      .filter((index, position, indexes) => index >= 0 && index < imageCount && indexes.indexOf(index) === position)
    : [0];
  return selected.length ? selected : [0];
}

function recoverPendingGenerations({ skipGenerationIds = [] } = {}) {
  const now = Date.now();
  const skipIds = new Set([...skipGenerationIds].map((id) => String(id || '')));
  db.generations.forEach((generation) => {
    if (generation.status !== 'pending') return;
    if (skipIds.has(generation.id)) return;
    generation.status = 'failed';
    generation.error = generation.error || '服务重启后任务未完成，请重新生成';
    generation.updatedAt = now;
    const consume = db.transactions.find((tx) => tx.type === 'consume' && tx.generationId === generation.id && tx.userId === generation.userId);
    const amount = Math.abs(Number(consume?.amountCents || generation.priceCents || 0));
    if (consume && amount > 0) applyRefund({
      userId: generation.userId,
      amountCents: amount,
      reason: '服务重启后任务未完成自动退款',
      generationId: generation.id,
      now
    });
  });
}

export async function recoverRestartPendingGenerations({ skipGenerationIds = [] } = {}) {
  recoverPendingGenerations({ skipGenerationIds });
  await persist();
}

function pruneExpiredSessions() {
  const now = Date.now();
  db.sessions = db.sessions.filter((session) => Number(session.expiresAt || 0) > now);
}

async function ensureAdmin() {
  const existing = db.users.find((user) => user.role === 'admin');
  if (existing) {
    existing.account ||= existing.username || config.adminUsername;
    return;
  }
  const now = Date.now();
  db.users.push({
    id: uuidv4(),
    account: config.adminUsername,
    username: config.adminUsername,
    passwordHash: await bcrypt.hash(config.adminPassword, 10),
    role: 'admin',
    status: 'active',
    balanceCents: 0,
    createdAt: now,
    updatedAt: now
  });
  await persist();
}

export function snapshot() {
  return structuredClone(db);
}

function readSqliteObject(collection, id) {
  if (!sqliteDb || !id) return null;
  try {
    const row = sqliteDb
      .prepare('SELECT payload FROM object_snapshot WHERE collection = ? AND id = ?')
      .get(collection, String(id));
    return row?.payload ? JSON.parse(row.payload) : null;
  } catch (error) {
    console.error('sqlite object read failed', error);
    return null;
  }
}

function replaceById(collection, item) {
  if (!item?.id || !Array.isArray(db[collection])) return null;
  const index = db[collection].findIndex((entry) => entry.id === item.id);
  if (index === -1) return null;
  db[collection][index] = item;
  sqliteSnapshotPayloads.set(sqliteSnapshotKey(collection, item.id), JSON.stringify(item));
  return item;
}

function shouldReplaceGenerationFromDurable(current, incoming) {
  if (!incoming?.id) return false;
  if (!current) return true;

  const currentUpdatedAt = Number(current.updatedAt || 0);
  const incomingUpdatedAt = Number(incoming.updatedAt || 0);
  if (incomingUpdatedAt && currentUpdatedAt && incomingUpdatedAt < currentUpdatedAt) return false;

  const currentFinished = current.status === 'failed' || current.status === 'succeeded';
  const incomingPending = incoming.status === 'pending';
  if (currentFinished && incomingPending) return false;

  const currentFinishedAt = Number(current.finishedAt || 0);
  const incomingFinishedAt = Number(incoming.finishedAt || 0);
  if (currentFinishedAt && !incomingFinishedAt) return false;

  return true;
}

export function refreshGenerationFromDurableStore(id) {
  const generation = readSqliteObject('generations', id);
  if (!generation) return findGenerationById(id);
  const current = findGenerationById(id);
  if (!shouldReplaceGenerationFromDurable(current, generation)) return current;
  const refreshed = replaceById('generations', generation);
  if (generation.userId) {
    const user = readSqliteObject('users', generation.userId);
    if (user) replaceById('users', user);
  }
  return refreshed || findGenerationById(id);
}

export function generationPendingStats({ userId = null } = {}) {
  const pending = db.generations.filter((generation) => generation.status === 'pending');
  const scopedUserId = userId ? String(userId) : null;
  return {
    total: pending.length,
    user: scopedUserId ? pending.filter((generation) => generation.userId === scopedUserId).length : 0
  };
}

export function storeStats() {
  return {
    collections: durableDbScore(db),
    persist: {
      ...persistMetrics,
      scheduled: persistMetrics.scheduled,
      pendingWaiters: persistWaiters.length,
      scheduledFlush: persistScheduled,
      coalesceMs: persistCoalesceMs,
      queuePending: Boolean(persistScheduled || persistWaiters.length)
    },
    sqlite: {
      enabled: Boolean(sqliteDb),
      cachedObjects: sqliteSnapshotPayloads.size
    },
    mysql: {
      ...mysqlMetrics,
      enabled: Boolean(mysqlPool),
      cachedObjects: mysqlSnapshotPayloads.size
    },
    backups: {
      lastBackupAt,
      minIntervalMs: minBackupIntervalMs,
      maxJsonBackups
    }
  };
}

async function flushPersist() {
  const waiters = persistWaiters;
  persistWaiters = [];
  persistScheduled = false;
  persistTimer = null;
  const startedAt = Date.now();
  try {
    await rotateJsonBackups();
    const payload = JSON.stringify(db, null, 2);
    const tmpPath = path.join(dataDir, `db.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
    await fs.writeFile(tmpPath, payload);
    await fs.rename(tmpPath, dbPath);
    writeSqliteSnapshot(payload);
    await writeMysqlSnapshot(payload);
    persistMetrics.flushed += 1;
    persistMetrics.lastFlushAt = Date.now();
    persistMetrics.lastFlushDurationMs = persistMetrics.lastFlushAt - startedAt;
    persistMetrics.lastError = null;
    waiters.forEach(({ resolve }) => resolve());
  } catch (error) {
    persistMetrics.failed += 1;
    persistMetrics.lastError = String(error?.message || error).slice(0, 300);
    waiters.forEach(({ reject }) => reject(error));
    throw error;
  }
}

function enqueuePersist() {
  writeQueue = writeQueue.catch(() => {}).then(flushPersist);
  return writeQueue;
}

export function persist() {
  return new Promise((resolve, reject) => {
    persistWaiters.push({ resolve, reject });
    persistMetrics.scheduled += 1;
    if (persistScheduled) return;
    persistScheduled = true;
    if (persistCoalesceMs <= 0) {
      enqueuePersist();
      return;
    }
    persistTimer = setTimeout(enqueuePersist, persistCoalesceMs);
  });
}

export function findUserByUsername(username) {
  const normalized = String(username || '').trim().toLowerCase();
  return db.users.find((user) => String(user.username || '').toLowerCase() === normalized);
}

export function findUserByAccount(account) {
  const normalized = String(account || '').trim().toLowerCase();
  return db.users.find((user) => String(user.account || user.username || '').toLowerCase() === normalized);
}

function findUserByLoginName(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return db.users.find((user) => (
    String(user.account || '').toLowerCase() === normalized
    || String(user.username || '').toLowerCase() === normalized
  ));
}

export function findUserById(id) {
  return db.users.find((user) => user.id === id);
}

function hashApiKey(key) {
  return crypto.createHash('sha256').update(String(key || '')).digest('hex');
}

function createRawApiKey() {
  return `sk-img-${crypto.randomBytes(24).toString('base64url')}`;
}

export function sanitizeApiKey(item) {
  if (!item) return null;
  return {
    id: item.id,
    name: item.name,
    prefix: item.prefix,
    last4: item.last4,
    status: item.status,
    createdAt: item.createdAt,
    lastUsedAt: item.lastUsedAt || null,
    revokedAt: item.revokedAt || null
  };
}

export function listApiKeysByUser(userId) {
  return db.apiKeys
    .filter((item) => item.userId === userId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(sanitizeApiKey);
}

export async function createApiKey({ userId, name }) {
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  const rawKey = createRawApiKey();
  const now = Date.now();
  const item = {
    id: uuidv4(),
    userId,
    name: String(name || 'API Key').trim().slice(0, 40) || 'API Key',
    keyHash: hashApiKey(rawKey),
    prefix: rawKey.slice(0, 10),
    last4: rawKey.slice(-4),
    status: 'active',
    createdAt: now,
    lastUsedAt: null,
    revokedAt: null
  };
  db.apiKeys.unshift(item);
  await persist();
  return { apiKey: sanitizeApiKey(item), key: rawKey };
}

export async function revokeApiKeyByUser(userId, keyId) {
  const item = db.apiKeys.find((entry) => entry.userId === userId && entry.id === keyId);
  if (!item) return null;
  const now = Date.now();
  item.status = 'revoked';
  item.revokedAt = now;
  await persist();
  return sanitizeApiKey(item);
}

export async function verifyApiKey(rawKey) {
  const key = String(rawKey || '').trim();
  if (!key.startsWith('sk-img-')) return null;
  const item = db.apiKeys.find((entry) => entry.keyHash === hashApiKey(key) && entry.status === 'active');
  if (!item) return null;
  const user = findUserById(item.userId);
  if (!user || user.status !== 'active') return null;
  const now = Date.now();
  if (!item.lastUsedAt || now - Number(item.lastUsedAt || 0) > 60 * 1000) {
    item.lastUsedAt = now;
    await persist();
  }
  return { user, apiKey: sanitizeApiKey(item) };
}

export async function createUser({ username, account, password }) {
  username = String(username || '').trim();
  account = String(account || '').trim();
  if (!/^[a-zA-Z0-9_\u4e00-\u9fa5.-]{3,32}$/.test(username)) {
    throw new Error('用户名长度 3-32，仅支持中文、字母、数字、下划线、点和横线');
  }
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(account)) {
    throw new Error('账号长度 3-32，仅支持字母、数字、下划线、点和横线');
  }
  if (String(password).length < 6) {
    throw new Error('密码至少 6 位');
  }
  if (findUserByLoginName(account)) {
    throw new Error('账号已存在');
  }
  if (findUserByLoginName(username)) {
    throw new Error('用户名已存在');
  }
  const now = Date.now();
  const user = {
    id: uuidv4(),
    account,
    username,
    passwordHash: await bcrypt.hash(password, 10),
    role: 'user',
    status: 'active',
    balanceCents: 0,
    createdAt: now,
    updatedAt: now
  };
  if (findUserByLoginName(account)) {
    throw new Error('账号已存在');
  }
  if (findUserByLoginName(username)) {
    throw new Error('用户名已存在');
  }
  db.users.push(user);
  await persist();
  return user;
}

function ensureAdminTarget(userId, operatorId, { allowAdmin = false } = {}) {
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  if (user.id === operatorId) throw new Error('不能操作当前登录的管理员账号');
  if (!allowAdmin && user.role === 'admin') throw new Error('不能操作管理员账号');
  return user;
}

function revokeUserAccess(userId, now = Date.now()) {
  db.sessions = db.sessions.filter((session) => session.userId !== userId);
  db.apiKeys
    .filter((item) => item.userId === userId && item.status === 'active')
    .forEach((item) => {
      item.status = 'revoked';
      item.revokedAt = now;
    });
}

export async function adminCreateUser({ username, account, password, balanceCents = 0, operatorId }) {
  const user = await createUser({ username, account, password });
  const amount = Math.trunc(Number(balanceCents || 0));
  if (amount > 0) {
    await addBalance({
      userId: user.id,
      amountCents: amount,
      reason: '管理员创建用户初始余额',
      operatorId
    });
  }
  return findUserById(user.id);
}

export async function adminUpdateUserStatus({ userId, status, operatorId }) {
  const nextStatus = String(status || '').trim();
  if (!['active', 'disabled'].includes(nextStatus)) throw new Error('用户状态无效');
  const user = ensureAdminTarget(userId, operatorId);
  const now = Date.now();
  user.status = nextStatus;
  user.updatedAt = now;
  if (nextStatus !== 'active') revokeUserAccess(user.id, now);
  await persist();
  return user;
}

export async function adminResetUserPassword({ userId, password, operatorId }) {
  const user = ensureAdminTarget(userId, operatorId, { allowAdmin: true });
  if (String(password || '').length < 6) throw new Error('密码至少 6 位');
  const now = Date.now();
  user.passwordHash = await bcrypt.hash(password, 10);
  user.updatedAt = now;
  revokeUserAccess(user.id, now);
  await persist();
  return user;
}

export async function adminDeleteUser({ userId, operatorId }) {
  const user = ensureAdminTarget(userId, operatorId);
  const now = Date.now();
  user.status = 'deleted';
  user.deletedAt = now;
  user.deletedBy = operatorId || null;
  user.updatedAt = now;
  revokeUserAccess(user.id, now);
  await persist();
  return user;
}

export async function createSession(userId) {
  pruneExpiredSessions();
  const session = {
    id: uuidv4(),
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 14
  };
  db.sessions.push(session);
  await persist();
  return session;
}

export async function deleteSession(sessionId) {
  db.sessions = db.sessions.filter((session) => session.id !== sessionId);
  await persist();
}

export function findSession(sessionId) {
  const session = db.sessions.find((item) => item.id === sessionId);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    db.sessions = db.sessions.filter((item) => item.id !== sessionId);
    persist().catch(() => {});
    return null;
  }
  return session;
}

export async function addBalance({ userId, amountCents, reason, operatorId }) {
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('充值金额必须大于 0');
  const now = Date.now();
  user.balanceCents += amountCents;
  user.updatedAt = now;
  const tx = {
    id: uuidv4(),
    userId,
    type: 'topup',
    amountCents,
    balanceAfterCents: user.balanceCents,
    reason: reason || '管理员加余额',
    operatorId,
    createdAt: now
  };
  db.transactions.push(tx);
  await persist();
  return tx;
}

export async function transferBalance({ fromUserId, toUserId, amountCents, reason, postId }) {
  const fromUser = findUserById(fromUserId);
  const toUser = findUserById(toUserId);
  if (!fromUser) throw new Error('自愿支持用户不存在');
  if (!toUser) throw new Error('作品作者不存在');
  if (fromUserId === toUserId) throw new Error('自己的作品无需自愿支持');
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('自愿支持金额必须大于 0');
  if (fromUser.balanceCents < amountCents) throw new Error('余额不足');
  const now = Date.now();
  fromUser.balanceCents -= amountCents;
  fromUser.updatedAt = now;
  toUser.balanceCents += amountCents;
  toUser.updatedAt = now;
  const debit = {
    id: uuidv4(),
    userId: fromUserId,
    type: 'tip',
    amountCents: -amountCents,
    balanceAfterCents: fromUser.balanceCents,
    reason,
    postId,
    createdAt: now
  };
  const credit = {
    id: uuidv4(),
    userId: toUserId,
    type: 'tip_income',
    amountCents,
    balanceAfterCents: toUser.balanceCents,
    reason,
    postId,
    fromUserId,
    createdAt: now
  };
  db.transactions.push(debit, credit);
  await persist();
  return { debit, credit, fromUser, toUser };
}

function normalizeCode(code) {
  return String(code || '').trim().replace(/\s+/g, '').toUpperCase();
}

function generateCode() {
  const part = () => crypto.randomBytes(2).toString('hex').toUpperCase();
  return `IMG-${part()}-${part()}-${part()}`;
}

function assertRedeemAmount(amountCents) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('兑换金额必须大于 0');
  }
}

export async function createRedeemCode({ code, amountCents, operatorId }) {
  const normalized = normalizeCode(code || generateCode());
  if (!/^[A-Z0-9-]{6,32}$/.test(normalized)) {
    throw new Error('兑换码仅支持 6-32 位字母、数字和横线');
  }
  assertRedeemAmount(amountCents);
  if (db.redeemCodes.some((item) => item.code === normalized)) {
    throw new Error('兑换码已存在');
  }
  const now = Date.now();
  const item = {
    id: uuidv4(),
    code: normalized,
    amountCents,
    status: 'active',
    createdBy: operatorId,
    createdAt: now,
    usedBy: null,
    usedAt: null
  };
  db.redeemCodes.unshift(item);
  await persist();
  return item;
}

export async function createRedeemCodesBatch({ amountCents, quantity, operatorId }) {
  const count = Math.trunc(Number(quantity || 0));
  if (!Number.isInteger(count) || count < 1) throw new Error('批量生成数量必须大于 0');
  if (count > 200) throw new Error('单次最多生成 200 张兑换码');
  assertRedeemAmount(amountCents);
  const items = [];
  for (let index = 0; index < count; index += 1) {
    let attempts = 0;
    let item = null;
    while (!item && attempts < 20) {
      attempts += 1;
      const candidate = normalizeCode(generateCode());
      if (db.redeemCodes.some((entry) => entry.code === candidate) || items.some((entry) => entry.code === candidate)) continue;
      item = {
        id: uuidv4(),
        code: candidate,
        amountCents,
        status: 'active',
        createdBy: operatorId,
        createdAt: Date.now() + index,
        usedBy: null,
        usedAt: null
      };
    }
    if (!item) throw new Error('批量生成失败，请重试');
    items.push(item);
  }
  db.redeemCodes.unshift(...items.reverse());
  await persist();
  return items.reverse();
}

export async function revokeRedeemCode({ codeId, operatorId }) {
  const item = db.redeemCodes.find((entry) => entry.id === codeId);
  if (!item) throw new Error('兑换码不存在');
  if (item.status !== 'active' || item.usedBy) throw new Error('只能撤销未使用的兑换码');
  const now = Date.now();
  item.status = 'revoked';
  item.revokedBy = operatorId || null;
  item.revokedAt = now;
  await persist();
  return item;
}

export async function revokeRedeemCodesBatch({ codeIds, operatorId }) {
  const ids = Array.from(new Set((Array.isArray(codeIds) ? codeIds : []).map((item) => String(item || '').trim()).filter(Boolean)));
  if (!ids.length) throw new Error('请选择需要撤销的兑换码');
  const items = ids.map((id) => {
    const item = db.redeemCodes.find((entry) => entry.id === id);
    if (!item) throw new Error('兑换码不存在');
    if (item.status !== 'active' || item.usedBy) throw new Error('只能批量撤销未使用的兑换码');
    return item;
  });
  const now = Date.now();
  items.forEach((item) => {
    item.status = 'revoked';
    item.revokedBy = operatorId || null;
    item.revokedAt = now;
  });
  await persist();
  return items;
}

export async function redeemCode({ userId, code }) {
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  const normalized = normalizeCode(code);
  if (!normalized) throw new Error('请输入兑换码');
  const item = db.redeemCodes.find((entry) => entry.code === normalized);
  if (!item) throw new Error('兑换码无效');
  if (item.usedBy) throw new Error('兑换码已使用');
  if (item.status !== 'active') throw new Error('兑换码无效');
  const now = Date.now();
  user.balanceCents += item.amountCents;
  user.updatedAt = now;
  item.usedBy = userId;
  item.usedAt = now;
  item.status = 'used';
  const tx = {
    id: uuidv4(),
    userId,
    type: 'redeem',
    amountCents: item.amountCents,
    balanceAfterCents: user.balanceCents,
    reason: `兑换码 ${item.code}`,
    redeemCodeId: item.id,
    createdAt: now
  };
  db.transactions.push(tx);
  await persist();
  return { transaction: tx, redeemCode: item, user };
}

export async function chargeBalance({ userId, amountCents, reason, generationId }) {
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('扣费金额必须大于 0');
  if (user.balanceCents < amountCents) throw new Error('余额不足');
  const now = Date.now();
  user.balanceCents -= amountCents;
  user.updatedAt = now;
  const tx = {
    id: uuidv4(),
    userId,
    type: 'consume',
    amountCents: -amountCents,
    balanceAfterCents: user.balanceCents,
    reason,
    generationId,
    createdAt: now
  };
  db.transactions.push(tx);
  await persist();
  return tx;
}

function applyRefund({ userId, amountCents, reason, generationId, now = Date.now() }) {
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('退款金额必须大于 0');
  if (generationId) {
    const consume = db.transactions.find((tx) => tx.userId === userId && tx.type === 'consume' && tx.generationId === generationId);
    if (!consume) throw new Error('未找到对应扣费记录，不能退款');
    const consumedAmount = Math.abs(Number(consume.amountCents || 0));
    const existingRefunds = db.transactions
      .filter((tx) => tx.userId === userId && tx.type === 'refund' && tx.generationId === generationId)
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    const refundedAmount = existingRefunds.reduce((sum, tx) => sum + Math.abs(Number(tx.amountCents || 0)), 0);
    const remainingAmount = Math.max(0, consumedAmount - refundedAmount);
    if (remainingAmount <= 0) return existingRefunds.at(-1);
    if (amountCents > remainingAmount) {
      if (amountCents === consumedAmount) {
        amountCents = remainingAmount;
      } else {
        throw new Error('退款累计金额不能超过原扣费金额');
      }
    }
  }
  user.balanceCents += amountCents;
  user.updatedAt = now;
  const tx = {
    id: uuidv4(),
    userId,
    type: 'refund',
    amountCents,
    balanceAfterCents: user.balanceCents,
    reason,
    generationId,
    createdAt: now
  };
  db.transactions.push(tx);
  return tx;
}

export async function refundBalance({ userId, amountCents, reason, generationId }) {
  const tx = applyRefund({ userId, amountCents, reason, generationId });
  await persist();
  return tx;
}

export function generationBillingSummary(generationId, userId = null) {
  const scopedGenerationId = String(generationId || '');
  const scopedUserId = userId ? String(userId) : null;
  if (!scopedGenerationId) {
    return {
      consumedAmountCents: 0,
      refundedAmountCents: 0,
      remainingAmountCents: 0,
      consumeTransaction: null,
      refundTransactions: []
    };
  }
  const consumeTransaction = db.transactions.find((tx) => (
    tx.type === 'consume'
    && tx.generationId === scopedGenerationId
    && (!scopedUserId || tx.userId === scopedUserId)
  )) || null;
  const refundTransactions = db.transactions
    .filter((tx) => (
      tx.type === 'refund'
      && tx.generationId === scopedGenerationId
      && (!scopedUserId || tx.userId === scopedUserId)
    ))
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  const consumedAmountCents = Math.abs(Number(consumeTransaction?.amountCents || 0));
  const refundedAmountCents = refundTransactions.reduce((sum, tx) => sum + Math.abs(Number(tx.amountCents || 0)), 0);
  return {
    consumedAmountCents,
    refundedAmountCents,
    remainingAmountCents: Math.max(0, consumedAmountCents - refundedAmountCents),
    consumeTransaction,
    refundTransactions
  };
}

function positiveInteger(value) {
  const amount = Math.trunc(Number(value || 0));
  return Number.isInteger(amount) && amount > 0 ? amount : 0;
}

function generationRefundTargetCents(generation, billing) {
  const metadata = generation?.metadata || {};
  const consumedAmountCents = positiveInteger(billing?.consumedAmountCents);
  const explicitRefund = positiveInteger(metadata.refundRequestedCents);
  const partialRefund = positiveInteger(metadata.partialRefundRequestedCents);
  if (generation?.status === 'succeeded' && partialRefund > 0) {
    return Math.min(consumedAmountCents, partialRefund);
  }
  if (explicitRefund > 0) {
    return Math.min(consumedAmountCents, explicitRefund);
  }
  if (partialRefund > 0 && metadata.partialRefundError) {
    return Math.min(consumedAmountCents, partialRefund);
  }
  return consumedAmountCents;
}

export async function expireStalePendingGenerations({
  maxAgeMs = 1000 * 60 * 35,
  modeMaxAgeMs = null,
  reason = '生成任务超时未完成，已自动退款，请重新生成',
  skipGenerationIds = []
} = {}) {
  const now = Date.now();
  const expired = [];
  const skipIds = new Set([...skipGenerationIds].map((id) => String(id || '')));
  db.generations.forEach((generation) => {
    if (generation.status !== 'pending') return;
    if (skipIds.has(generation.id)) return;
    const startedAt = Number(generation.startedAt || generation.createdAt || 0);
    const modeMaxAge = modeMaxAgeMs ? Number(modeMaxAgeMs[generation.mode]) : 0;
    const maxAgeForGeneration = Number.isFinite(modeMaxAge) && modeMaxAge > 0 ? modeMaxAge : maxAgeMs;
    if (!startedAt || now - startedAt < maxAgeForGeneration) return;
    const consume = db.transactions.find((tx) => tx.type === 'consume' && tx.generationId === generation.id && tx.userId === generation.userId);
    const amount = Math.abs(Number(consume?.amountCents || generation.priceCents || 0));
    let refund = null;
    if (consume && amount > 0) {
      refund = applyRefund({
        userId: generation.userId,
        amountCents: amount,
        reason,
        generationId: generation.id,
        now
      });
    }
    const requestedCount = Math.max(1, Math.trunc(Number(generation.count || 1)) || 1);
    generation.status = 'failed';
    generation.error = reason;
    generation.finishedAt = now;
    generation.durationMs = now - startedAt;
    generation.metadata = {
      ...(generation.metadata || {}),
      requestedCount,
      returnedCount: 0,
      failedCount: requestedCount,
      stalePendingExpired: true,
      stalePendingAgeMs: now - startedAt,
      stalePendingMaxAgeMs: maxAgeForGeneration,
      stalePendingRefundTransactionId: refund?.id || null
    };
    generation.updatedAt = now;
    expired.push({ id: generation.id, userId: generation.userId, amountCents: refund?.amountCents || 0 });
  });
  if (expired.length) await persist();
  return expired;
}

export async function failPendingGenerationsForUser({
  userId,
  reason = '账号已被管理员停用，未完成的生图任务已取消并退款',
  operatorId = null
} = {}) {
  const scopedUserId = String(userId || '');
  if (!scopedUserId) throw new Error('用户不存在');
  const now = Date.now();
  const cancelled = [];
  db.generations.forEach((generation) => {
    if (generation.userId !== scopedUserId || generation.status !== 'pending') return;
    const consume = db.transactions.find((tx) => tx.type === 'consume' && tx.generationId === generation.id && tx.userId === generation.userId);
    const amount = Math.abs(Number(consume?.amountCents || generation.priceCents || 0));
    let refund = null;
    let refundError = null;
    if (consume && amount > 0) {
      try {
        refund = applyRefund({
          userId: generation.userId,
          amountCents: amount,
          reason,
          generationId: generation.id,
          now
        });
      } catch (error) {
        refundError = error;
      }
    }
    const startedAt = Number(generation.startedAt || generation.createdAt || now);
    const requestedCount = Math.max(1, Math.trunc(Number(generation.count || 1)) || 1);
    generation.status = 'failed';
    generation.error = reason;
    generation.finishedAt = now;
    generation.durationMs = Math.max(0, now - startedAt);
    generation.metadata = {
      ...(generation.metadata || {}),
      requestedCount,
      returnedCount: 0,
      failedCount: requestedCount,
      adminCancelled: true,
      adminCancelReason: reason,
      adminCancelOperatorId: operatorId || null,
      adminCancelledAt: now,
      refundCents: Math.abs(Number(refund?.amountCents || 0)),
      refundTransactionId: refund?.id || null,
      refundPending: Boolean(refundError),
      refundLastError: refundError ? String(refundError.message || refundError).slice(0, 300) : null,
      refundLastAttemptAt: now
    };
    generation.updatedAt = now;
    cancelled.push({
      id: generation.id,
      userId: generation.userId,
      amountCents: Math.abs(Number(refund?.amountCents || 0)),
      refundError: refundError?.message || null
    });
  });
  if (cancelled.length) await persist();
  return cancelled;
}

export async function createChargedGeneration({ userId, amountCents, reason, generation }) {
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('扣费金额必须大于 0');
  if (user.balanceCents < amountCents) throw new Error('余额不足');
  const now = Date.now();
  const previousBalance = user.balanceCents;
  const generationRecord = {
    id: uuidv4(),
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    ...generation,
    userId
  };
  user.balanceCents -= amountCents;
  user.updatedAt = now;
  const transaction = {
    id: uuidv4(),
    userId,
    type: 'consume',
    amountCents: -amountCents,
    balanceAfterCents: user.balanceCents,
    reason,
    generationId: generationRecord.id,
    createdAt: now
  };
  db.generations.unshift(generationRecord);
  db.transactions.push(transaction);
  try {
    await persist();
  } catch (error) {
    user.balanceCents = previousBalance;
    user.updatedAt = now;
    db.generations = db.generations.filter((item) => item.id !== generationRecord.id);
    db.transactions = db.transactions.filter((item) => item.id !== transaction.id);
    throw error;
  }
  return { generation: generationRecord, transaction };
}

export async function createGeneration(record) {
  const generation = {
    id: uuidv4(),
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...record
  };
  db.generations.unshift(generation);
  await persist();
  return generation;
}

export function findGenerationById(id) {
  return db.generations.find((item) => item.id === id);
}

export async function updateGeneration(id, patch) {
  const generation = db.generations.find((item) => item.id === id);
  if (!generation) throw new Error('记录不存在');
  Object.assign(generation, patch, { updatedAt: Date.now() });
  await persist();
  return generation;
}

export async function updateGenerationIfPending(id, patch) {
  const generation = db.generations.find((item) => item.id === id);
  if (!generation) throw new Error('记录不存在');
  if (generation.status !== 'pending') {
    return { generation, updated: false };
  }
  Object.assign(generation, patch, { updatedAt: Date.now() });
  await persist();
  return { generation, updated: true };
}

export async function finishGenerationIfPending(id, patchOrBuilder, { refund = null } = {}) {
  const generation = db.generations.find((item) => item.id === id);
  if (!generation) throw new Error('记录不存在');
  if (generation.status !== 'pending') {
    return {
      generation,
      updated: false,
      refundTransaction: null,
      refundActualCents: 0,
      refundError: null
    };
  }
  const now = Date.now();
  let refundTransaction = null;
  let refundActualCents = 0;
  let refundError = null;
  const amountCents = Number(refund?.amountCents || 0);
  if (Number.isInteger(amountCents) && amountCents > 0) {
    try {
      const refundUserId = refund.userId || generation.userId;
      const beforeRefund = generationBillingSummary(generation.id, refundUserId);
      refundTransaction = applyRefund({
        userId: refundUserId,
        amountCents,
        reason: refund.reason || '生成任务自动退款',
        generationId: generation.id,
        now
      });
      const afterRefund = generationBillingSummary(generation.id, refundUserId);
      refundActualCents = Math.max(0, afterRefund.refundedAmountCents - beforeRefund.refundedAmountCents);
    } catch (error) {
      refundError = error;
    }
  }
  const patch = (typeof patchOrBuilder === 'function'
    ? patchOrBuilder({ generation, now, refundTransaction, refundActualCents, refundError })
    : patchOrBuilder) || {};
  if (refundError && amountCents > 0) {
    patch.metadata = {
      ...(patch.metadata || generation.metadata || {}),
      refundPending: true,
      refundRequestedCents: amountCents,
      refundLastError: String(refundError.message || refundError).slice(0, 300),
      refundLastAttemptAt: now,
      refundRetryCount: Number(generation.metadata?.refundRetryCount || 0) + 1
    };
  } else if (refundTransaction && refundActualCents > 0) {
    patch.metadata = {
      ...(patch.metadata || generation.metadata || {}),
      refundPending: false,
      refundLastError: null,
      refundLastAttemptAt: now
    };
  }
  Object.assign(generation, patch || {}, { updatedAt: now });
  await persist();
  return {
    generation,
    updated: true,
    refundTransaction,
    refundActualCents,
    refundError
  };
}

export async function retryPendingGenerationRefunds({ limit = 20, reason = '生成任务退款补偿' } = {}) {
  const now = Date.now();
  const max = Math.max(1, Math.min(100, Math.trunc(Number(limit || 20)) || 20));
  const candidates = db.generations
    .filter((generation) => {
      if (!generation || generation.status === 'pending') return false;
      const metadata = generation.metadata || {};
      return Boolean(metadata.refundPending || metadata.refundError || metadata.partialRefundError || metadata.refundLastError);
    })
    .slice(0, max);
  const results = [];
  for (const generation of candidates) {
    const billing = generationBillingSummary(generation.id, generation.userId);
    const remainingAmountCents = Math.max(0, Number(billing.remainingAmountCents || 0));
    const metadata = generation.metadata || {};
    const targetRefundCents = generationRefundTargetCents(generation, billing);
    const amountToRefundCents = Math.min(
      remainingAmountCents,
      Math.max(0, targetRefundCents - Math.max(0, Number(billing.refundedAmountCents || 0)))
    );
    if (remainingAmountCents <= 0 || amountToRefundCents <= 0) {
      generation.metadata = {
        ...metadata,
        refundPending: false,
        refundLastError: null,
        refundClearedAt: now
      };
      generation.updatedAt = now;
      results.push({ id: generation.id, status: 'cleared', amountCents: 0 });
      continue;
    }
    try {
      const tx = applyRefund({
        userId: generation.userId,
        amountCents: amountToRefundCents,
        reason,
        generationId: generation.id,
        now
      });
      generation.metadata = {
        ...metadata,
        refundPending: false,
        refundLastError: null,
        refundRetryCount: Number(metadata.refundRetryCount || 0) + 1,
        refundRecoveredAt: now,
        refundRecoveryTransactionId: tx?.id || null,
        refundRecoveredCents: Math.abs(Number(tx?.amountCents || amountToRefundCents))
      };
      generation.updatedAt = now;
      results.push({ id: generation.id, status: 'refunded', amountCents: Math.abs(Number(tx?.amountCents || amountToRefundCents)) });
    } catch (error) {
      generation.metadata = {
        ...metadata,
        refundPending: true,
        refundLastError: String(error.message || error).slice(0, 300),
        refundLastAttemptAt: now,
        refundRetryCount: Number(metadata.refundRetryCount || 0) + 1
      };
      generation.updatedAt = now;
      results.push({ id: generation.id, status: 'failed', amountCents: amountToRefundCents, error: error.message || String(error) });
    }
  }
  if (results.length) await persist();
  return results;
}

export async function attachTransactionToGeneration(transactionId, generationId) {
  const tx = db.transactions.find((item) => item.id === transactionId);
  if (!tx) return null;
  tx.generationId = generationId;
  await persist();
  return tx;
}

export async function deleteGenerationsByUser(userId) {
  const publishedGenerationIds = new Set(db.communityPosts
    .filter((post) => post.status === 'published')
    .map((post) => post.generationId));
  const now = Date.now();
  let deleted = 0;
  db.generations.forEach((item) => {
    if (item.userId !== userId) return;
    if (item.status === 'pending' || publishedGenerationIds.has(item.id) || item.deletedFromHistoryAt) return;
    item.deletedFromHistoryAt = now;
    item.deletedFromHistoryBy = userId;
    item.updatedAt = now;
    deleted += 1;
  });
  if (deleted > 0) await persist();
  return deleted;
}

export async function deleteGenerationByUser(userId, generationId) {
  const generation = db.generations.find((item) => item.userId === userId && item.id === generationId);
  if (!generation) return 0;
  if (generation.deletedFromHistoryAt) return 0;
  if (generation?.status === 'pending') throw new Error('图片生成中，暂时不能删除这条历史记录');
  if (db.communityPosts.some((post) => post.generationId === generation.id && post.status === 'published')) {
    throw new Error('这张作品已发布到交流区，不能从历史中删除');
  }
  const now = Date.now();
  generation.deletedFromHistoryAt = now;
  generation.deletedFromHistoryBy = userId;
  generation.updatedAt = now;
  await persist();
  return 1;
}

function normalizeTags(tags) {
  const list = Array.isArray(tags) ? tags : String(tags || '').split(/[,，\s]+/);
  return [...new Set(list.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 8))];
}

function communityHotScore({ likeCount = 0, commentCount = 0, createdAt = Date.now() }) {
  const ageHours = Math.max(1, (Date.now() - Number(createdAt || Date.now())) / 36e5);
  const base = likeCount * 12 + commentCount * 18;
  return Math.round((base / Math.pow(ageHours, 0.28)) * 100) / 100;
}

function activeCommunityCommentReportCount(commentId) {
  return db.communityCommentReports.filter((item) => item.commentId === commentId && item.status === 'active').length;
}

function communityReuseActorKey(reuse) {
  if (reuse?.reuseKey) return reuse.reuseKey;
  if (reuse?.userId) return `user:${reuse.userId}`;
  if (reuse?.anonymousId) return `anon:${reuse.anonymousId}`;
  return '';
}

function communityDownloadActorKey(download) {
  if (download?.downloadKey) return download.downloadKey;
  if (download?.userId) return `user:${download.userId}`;
  if (download?.anonymousId) return `anon:${download.anonymousId}`;
  return '';
}

function refreshCommunityPostStats(post) {
  if (!post) return null;
  post.likeCount = db.communityLikes.filter((like) => like.postId === post.id).length;
  post.commentCount = db.communityComments.filter((comment) => (
    comment.postId === post.id
    && comment.status === 'published'
    && !comment.parentCommentId
    && comment.userId !== post.userId
  )).length;
  post.downloadCount = new Set(db.communityDownloads
    .filter((download) => download.postId === post.id)
    .map(communityDownloadActorKey)
    .filter(Boolean)).size;
  post.tipTotalCents = db.communityTips
    .filter((tip) => tip.postId === post.id)
    .reduce((sum, tip) => sum + Number(tip.amountCents || 0), 0);
  post.reuseCount = new Set(db.communityReuses
    .filter((reuse) => reuse.postId === post.id)
    .map(communityReuseActorKey)
    .filter(Boolean)).size;
  post.hotScore = communityHotScore(post);
  return post;
}

function rebuildCommunityPostStats() {
  db.communityPosts.forEach(refreshCommunityPostStats);
}

function clearReportedPinnedComments() {
  db.communityPosts.forEach((post) => {
    if (!post.pinnedCommentId) return;
    const pinned = db.communityComments.find((comment) => (
      comment.id === post.pinnedCommentId
      && comment.postId === post.id
      && comment.status === 'published'
    ));
    if (pinned && !pinned.parentCommentId && activeCommunityCommentReportCount(pinned.id) <= 0) return;
    clearCommunityPinnedComment(post, Date.now());
  });
}

function clearCommunityPinnedComment(post, now = Date.now()) {
  if (!post?.pinnedCommentId) return false;
  post.pinnedCommentId = null;
  post.updatedAt = now;
  return true;
}

export async function createCommunityPost({ userId, generationId, imageIndex = 0, imageIndexes = null, title, description, tags, showSourceImages = false }) {
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  const generation = findGenerationById(generationId);
  if (!generation || generation.userId !== userId) throw new Error('只能发布自己的作品');
  if (generation.status !== 'succeeded') throw new Error('只能发布生成成功的作品');
  if (!generation.imageUrl && !generation.imageBase64 && !(Array.isArray(generation.images) && generation.images.length)) {
    throw new Error('作品没有可发布的图片');
  }
  const imageCount = Array.isArray(generation.images) && generation.images.length ? generation.images.length : 1;
  const selectedImageIndexes = normalizeImageIndexes(imageIndexes, imageIndex, imageCount);
  if (!selectedImageIndexes.length) throw new Error('请至少选择 1 张图片');
  const existingPost = db.communityPosts.find((post) => post.generationId === generationId && post.status === 'published');
  if (existingPost) {
    const error = new Error('这张作品已经发布过');
    error.existingPostId = existingPost.id;
    throw error;
  }
  const now = Date.now();
  const cleanTitle = String(title || generation.prompt || '未命名作品').trim().slice(0, 60);
  if (cleanTitle.length < 1) throw new Error('请输入作品标题');
  const cleanSourcePostId = String(generation.reuseSourcePostId || '').trim();
  const sourcePost = cleanSourcePostId
    ? db.communityPosts.find((item) => item.id === cleanSourcePostId && item.status === 'published')
    : null;
  const postId = uuidv4();
  const post = {
    id: postId,
    userId,
    username: user.username,
    generationId,
    imageIndexes: selectedImageIndexes,
    title: cleanTitle,
    description: String(description || '').trim().slice(0, 300),
    prompt: String(generation.prompt || '').slice(0, 4000),
    tags: normalizeTags(tags),
    sourcePostId: sourcePost && sourcePost.id !== postId ? sourcePost.id : null,
    showSourceImages: Boolean(showSourceImages && generation.mode === 'edit' && Array.isArray(generation.sourceImages) && generation.sourceImages.length),
    downloadMode: 'free',
    tipCents: 0,
    likeCount: 0,
    commentCount: 0,
    pinnedCommentId: null,
    tipTotalCents: 0,
    reuseCount: 0,
    hotScore: communityHotScore({ createdAt: now }),
    status: 'published',
    createdAt: now,
    updatedAt: now
  };
  db.communityPosts.unshift(post);
  await persist();
  return post;
}

export async function updateCommunityPost({ postId, userId, title, description, tags, showSourceImages = undefined }) {
  const post = db.communityPosts.find((item) => item.id === postId && item.status === 'published');
  if (!post) throw new Error('作品不存在');
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  const canEdit = user.role === 'admin' || post.userId === userId;
  if (!canEdit) throw new Error('没有权限编辑这个作品');
  const cleanTitle = String(title || '').trim().slice(0, 60);
  if (cleanTitle.length < 1) throw new Error('请输入作品标题');
  post.title = cleanTitle;
  post.description = String(description || '').trim().slice(0, 300);
  post.tags = normalizeTags(tags);
  if (showSourceImages !== undefined) {
    const generation = findGenerationById(post.generationId);
    post.showSourceImages = Boolean(showSourceImages && generation?.mode === 'edit' && Array.isArray(generation.sourceImages) && generation.sourceImages.length);
  }
  post.updatedAt = Date.now();
  refreshCommunityPostStats(post);
  await persist();
  return post;
}

export async function createCommunityComment({ postId, userId, body, parentCommentId = null }) {
  const post = db.communityPosts.find((item) => item.id === postId && item.status === 'published');
  if (!post) throw new Error('作品不存在');
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  const text = String(body || '').trim();
  if (text.length < 1) throw new Error('请输入评论内容');
  if (text.length > 300) throw new Error('评论最多 300 字');
  const parentId = parentCommentId ? String(parentCommentId) : null;
  if (parentId) {
    const parent = db.communityComments.find((item) => item.id === parentId && item.postId === postId && item.status === 'published');
    if (!parent) throw new Error('回复的评论不存在');
    if (parent.parentCommentId) throw new Error('暂时只支持一级回复');
    if (parent.userId === userId) throw new Error('自己的评论无需回复');
    if (activeCommunityCommentReportCount(parent.id) > 0) throw new Error('被举报评论暂不支持回复，请先处理举报或删除');
  }
  const now = Date.now();
  const comment = {
    id: uuidv4(),
    postId,
    parentCommentId: parentId,
    userId,
    username: user.username,
    body: text,
    status: 'published',
    createdAt: now
  };
  db.communityComments.push(comment);
  refreshCommunityPostStats(post);
  await persist();
  return comment;
}

export async function reportCommunityComment({ postId, commentId, userId, reason }) {
  const post = db.communityPosts.find((item) => item.id === postId && item.status === 'published');
  if (!post) throw new Error('作品不存在');
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  const comment = db.communityComments.find((item) => item.id === commentId && item.postId === postId && item.status === 'published');
  if (!comment) throw new Error('评论不存在');
  if (comment.userId === userId) throw new Error('不能举报自己的评论');
  const existing = db.communityCommentReports.find((item) => item.commentId === commentId && item.userId === userId && item.status === 'active');
  const now = Date.now();
  if (existing) {
    if (post.pinnedCommentId === commentId) {
      clearCommunityPinnedComment(post, now);
      await persist();
    }
    return existing;
  }
  const report = {
    id: uuidv4(),
    postId,
    commentId,
    userId,
    username: user.username,
    reason: String(reason || '').trim().slice(0, 120),
    status: 'active',
    createdAt: now
  };
  db.communityCommentReports.push(report);
  if (post.pinnedCommentId === commentId) clearCommunityPinnedComment(post, now);
  await persist();
  return report;
}

export async function resolveCommunityCommentReports({ postId, commentId, userId }) {
  const post = db.communityPosts.find((item) => item.id === postId && item.status === 'published');
  if (!post) throw new Error('作品不存在');
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  const canResolve = user.role === 'admin' || post.userId === userId;
  if (!canResolve) throw new Error('没有权限处理这条举报');
  const comment = db.communityComments.find((item) => item.id === commentId && item.postId === postId && item.status === 'published');
  if (!comment) throw new Error('评论不存在');
  const now = Date.now();
  const reports = db.communityCommentReports.filter((item) => item.commentId === commentId && item.status === 'active');
  if (!reports.length) throw new Error('这条评论没有待处理举报');
  reports.forEach((report) => {
    report.status = 'resolved';
    report.resolution = 'kept';
    report.resolvedAt = now;
    report.resolvedBy = userId;
  });
  if (comment.userId !== post.userId) {
    const existingHandled = db.communityFeedbackHandled.find((item) => (
      item.commentId === commentId
      && item.userId === post.userId
      && item.status === 'active'
    ));
    if (!existingHandled) {
      db.communityFeedbackHandled.push({
        id: uuidv4(),
        postId,
        commentId,
        userId: post.userId,
        status: 'active',
        createdAt: now,
        updatedAt: now
      });
    }
  }
  await persist();
  return { comment, resolvedCount: reports.length };
}

export async function setCommunityFeedbackHandled({ postId, commentId, userId, handled = true }) {
  const post = db.communityPosts.find((item) => item.id === postId && item.status === 'published');
  if (!post) throw new Error('作品不存在');
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  const canHandle = user.role === 'admin' || post.userId === userId;
  if (!canHandle) throw new Error('没有权限处理这条反馈');
  const comment = db.communityComments.find((item) => item.id === commentId && item.postId === postId && item.status === 'published');
  if (!comment) throw new Error('评论不存在');
  if (activeCommunityCommentReportCount(comment.id) > 0) throw new Error('被举报评论请先处理举报');
  if (comment.userId === post.userId) throw new Error('自己的评论无需标记为反馈');
  const now = Date.now();
  const existing = db.communityFeedbackHandled.find((item) => item.commentId === commentId && item.userId === userId && item.status === 'active');
  if (handled) {
    if (existing) return { comment, handled: true };
    db.communityFeedbackHandled.push({
      id: uuidv4(),
      postId,
      commentId,
      userId,
      status: 'active',
      createdAt: now,
      updatedAt: now
    });
  } else if (existing) {
    existing.status = 'restored';
    existing.updatedAt = now;
  }
  await persist();
  return { comment, handled: Boolean(handled) };
}

export async function pinCommunityComment({ postId, commentId, userId }) {
  const post = db.communityPosts.find((item) => item.id === postId && item.status === 'published');
  if (!post) throw new Error('作品不存在');
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  const canPin = user.role === 'admin' || post.userId === userId;
  if (!canPin) throw new Error('没有权限置顶评论');
  const comment = db.communityComments.find((item) => item.id === commentId && item.postId === postId && item.status === 'published');
  if (!comment) throw new Error('评论不存在');
  if (comment.parentCommentId) throw new Error('回复暂不支持置顶');
  if (activeCommunityCommentReportCount(comment.id) > 0) throw new Error('被举报评论暂不支持置顶，请先处理举报或删除');
  post.pinnedCommentId = commentId;
  post.updatedAt = Date.now();
  await persist();
  return post;
}

export async function unpinCommunityComment({ postId, userId }) {
  const post = db.communityPosts.find((item) => item.id === postId && item.status === 'published');
  if (!post) throw new Error('作品不存在');
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  const canPin = user.role === 'admin' || post.userId === userId;
  if (!canPin) throw new Error('没有权限取消置顶');
  post.pinnedCommentId = null;
  post.updatedAt = Date.now();
  await persist();
  return post;
}

export async function deleteCommunityComment({ postId, commentId, userId }) {
  const post = db.communityPosts.find((item) => item.id === postId && item.status === 'published');
  if (!post) throw new Error('作品不存在');
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  const comment = db.communityComments.find((item) => item.id === commentId && item.postId === postId && item.status === 'published');
  if (!comment) throw new Error('评论不存在');
  const canDelete = user.role === 'admin' || post.userId === userId || comment.userId === userId;
  if (!canDelete) throw new Error('没有权限删除这条评论');
  comment.status = 'deleted';
  comment.deletedAt = Date.now();
  comment.deletedBy = userId;
  if (post.pinnedCommentId === commentId) post.pinnedCommentId = null;
  db.communityComments
    .filter((item) => item.parentCommentId === commentId && item.status === 'published')
    .forEach((reply) => {
      reply.status = 'deleted';
      reply.deletedAt = comment.deletedAt;
      reply.deletedBy = userId;
    });
  db.communityCommentReports
    .filter((report) => (report.commentId === commentId || db.communityComments.some((item) => item.parentCommentId === commentId && item.id === report.commentId)) && report.status === 'active')
    .forEach((report) => {
      report.status = 'resolved';
      report.resolvedAt = comment.deletedAt;
      report.resolvedBy = userId;
    });
  db.communityFeedbackHandled
    .filter((entry) => (entry.commentId === commentId || db.communityComments.some((item) => item.parentCommentId === commentId && item.id === entry.commentId)) && entry.status === 'active')
    .forEach((entry) => {
      entry.status = 'deleted';
      entry.updatedAt = comment.deletedAt;
    });
  refreshCommunityPostStats(post);
  await persist();
  return comment;
}

export async function deleteCommunityPost({ postId, userId }) {
  const post = db.communityPosts.find((item) => item.id === postId && item.status === 'published');
  if (!post) throw new Error('作品不存在');
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  const canDelete = user.role === 'admin' || post.userId === userId;
  if (!canDelete) throw new Error('没有权限撤下这个作品');
  const now = Date.now();
  post.status = 'deleted';
  post.deletedAt = now;
  post.deletedBy = userId;
  post.updatedAt = now;
  db.communityComments
    .filter((comment) => comment.postId === post.id && comment.status === 'published')
    .forEach((comment) => {
      comment.status = 'deleted';
      comment.deletedAt = now;
      comment.deletedBy = userId;
    });
  db.communityCommentReports
    .filter((report) => report.postId === post.id && report.status === 'active')
    .forEach((report) => {
      report.status = 'resolved';
      report.resolvedAt = now;
      report.resolvedBy = userId;
    });
  db.communityFeedbackHandled
    .filter((entry) => entry.postId === post.id && entry.status === 'active')
    .forEach((entry) => {
      entry.status = 'deleted';
      entry.updatedAt = now;
    });
  db.communityLikes = db.communityLikes.filter((like) => like.postId !== post.id);
  db.communityReuses = db.communityReuses.filter((reuse) => reuse.postId !== post.id);
  db.communityDownloads = db.communityDownloads.filter((download) => download.postId !== post.id);
  refreshCommunityPostStats(post);
  await persist();
  return post;
}

export async function toggleCommunityLike({ postId, userId }) {
  const post = db.communityPosts.find((item) => item.id === postId && item.status === 'published');
  if (!post) throw new Error('作品不存在');
  const user = findUserById(userId);
  if (!user) throw new Error('用户不存在');
  if (post.userId === userId) throw new Error('自己的作品无需点赞');
  const existingIndex = db.communityLikes.findIndex((like) => like.postId === postId && like.userId === userId);
  if (existingIndex >= 0) {
    db.communityLikes.splice(existingIndex, 1);
    refreshCommunityPostStats(post);
    await persist();
    return { liked: false };
  }
  db.communityLikes.push({
    id: uuidv4(),
    postId,
    userId,
    createdAt: Date.now()
  });
  refreshCommunityPostStats(post);
  await persist();
  return { liked: true };
}

export async function recordCommunityReuse({ postId, userId = null, anonymousId = '' }) {
  const post = db.communityPosts.find((item) => item.id === postId && item.status === 'published');
  if (!post) throw new Error('作品不存在');
  if (userId && !findUserById(userId)) throw new Error('用户不存在');
  const reuseKey = userId ? `user:${userId}` : `anon:${String(anonymousId || '').slice(0, 80)}`;
  if (!userId && !anonymousId) throw new Error('缺少访客标识');
  const existing = db.communityReuses.find((reuse) => reuse.postId === postId && communityReuseActorKey(reuse) === reuseKey);
  if (existing) {
    refreshCommunityPostStats(post);
    return { reuseCount: post.reuseCount || 0, reused: false };
  }
  const now = Date.now();
  db.communityReuses.push({
    id: uuidv4(),
    postId,
    userId,
    anonymousId: userId ? null : anonymousId,
    reuseKey,
    createdAt: now
  });
  post.updatedAt = now;
  refreshCommunityPostStats(post);
  await persist();
  return { reuseCount: post.reuseCount || 0, reused: true };
}

export async function recordCommunityDownload({ postId, userId = null, anonymousId = '', imageIndex = 0 }) {
  const post = db.communityPosts.find((item) => item.id === postId && item.status === 'published');
  if (!post) throw new Error('作品不存在');
  if (userId && !findUserById(userId)) throw new Error('用户不存在');
  const downloadKey = userId ? `user:${userId}` : `anon:${String(anonymousId || '').slice(0, 80)}`;
  if (!userId && !anonymousId) throw new Error('缺少访客标识');
  const normalizedIndex = Math.max(0, Math.trunc(Number(imageIndex || 0)) || 0);
  if (!communityPostDownloadImageIndexes(post).includes(normalizedIndex)) throw new Error('图片不存在');
  const existing = db.communityDownloads.find((download) => (
    download.postId === postId
    && download.imageIndex === normalizedIndex
    && communityDownloadActorKey(download) === downloadKey
  ));
  if (existing) {
    refreshCommunityPostStats(post);
    return { downloadCount: post.downloadCount || 0, downloaded: false };
  }
  const now = Date.now();
  db.communityDownloads.push({
    id: uuidv4(),
    postId,
    userId,
    anonymousId: userId ? null : String(anonymousId || '').slice(0, 80),
    downloadKey,
    imageIndex: normalizedIndex,
    createdAt: now
  });
  post.updatedAt = now;
  refreshCommunityPostStats(post);
  await persist();
  return { downloadCount: post.downloadCount || 0, downloaded: true };
}

export async function tipCommunityPost({ postId, userId, amountCents }) {
  const post = db.communityPosts.find((item) => item.id === postId && item.status === 'published');
  if (!post) throw new Error('作品不存在');
  if (post.userId === userId) throw new Error('自己的作品无需自愿支持');
  const amount = Number(amountCents || 0);
  const fromUser = findUserById(userId);
  const toUser = findUserById(post.userId);
  if (!fromUser) throw new Error('自愿支持用户不存在');
  if (!toUser) throw new Error('作品作者不存在');
  if (!Number.isInteger(amount) || amount < 10) throw new Error('自愿支持金额至少 0.1 奇点');
  if (fromUser.balanceCents < amount) throw new Error('余额不足');
  const now = Date.now();
  const reason = `自愿支持作品 ${post.title}`;
  fromUser.balanceCents -= amount;
  fromUser.updatedAt = now;
  toUser.balanceCents += amount;
  toUser.updatedAt = now;
  const debit = {
    id: uuidv4(),
    userId,
    type: 'tip',
    amountCents: -amount,
    balanceAfterCents: fromUser.balanceCents,
    reason,
    postId,
    createdAt: now
  };
  const credit = {
    id: uuidv4(),
    userId: post.userId,
    type: 'tip_income',
    amountCents: amount,
    balanceAfterCents: toUser.balanceCents,
    reason,
    postId,
    fromUserId: userId,
    createdAt: now
  };
  const tip = {
    id: uuidv4(),
    postId,
    fromUserId: userId,
    toUserId: post.userId,
    amountCents: amount,
    createdAt: now
  };
  db.transactions.push(debit, credit);
  db.communityTips.push(tip);
  refreshCommunityPostStats(post);
  await persist();
  return { ...tip, debitId: debit.id, creditId: credit.id };
}
