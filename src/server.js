import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import multer from 'multer';
import { Agent, request } from 'undici';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { config, supportedQualities, supportedSizes } from './config.js';
import { chatText, editImage, editStoryboardImages, generateImage, generateStoryboardImages, normalizeCount, normalizeOutputFormatForSize, normalizeQuality, normalizeSize, optimizePrompt } from './imageClient.js';
import { apiKeyMiddleware, authMiddleware, loginUser, logout, registerUser, requireAdmin, requireApiUser, requireUser, sanitizeUser, setSessionCookie } from './auth.js';
import { addBalance, adminCreateUser, adminDeleteUser, adminResetUserPassword, adminUpdateUserStatus, aiSettings, billingPrices, billingSettings, createApiKey, createChargedGeneration, createCommunityComment, createCommunityPost, createRedeemCode, createRedeemCodesBatch, deleteCommunityComment, deleteCommunityPost, deleteGenerationByUser, deleteGenerationsByUser, expireStalePendingGenerations, findGenerationById, findUserById, generationBillingSummary, generationPendingStats, initStore, listApiKeysByUser, pinCommunityComment, recordCommunityDownload, recordCommunityReuse, recoverRestartPendingGenerations, redeemCode, refreshGenerationFromDurableStore, refundBalance, reportCommunityComment, resolveCommunityCommentReports, revokeApiKeyByUser, revokeRedeemCode, revokeRedeemCodesBatch, setCommunityFeedbackHandled, snapshot, storeStats, tipCommunityPost, toggleCommunityLike, unpinCommunityComment, updateAiSettings, updateBillingPrices, updateCommunityPost, updateGeneration } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const homeHtmlPath = path.join(publicDir, 'home.html');
const indexHtmlPath = path.join(publicDir, 'index.html');
const dataDir = path.resolve(__dirname, '..', 'data');
const generationJobDir = path.join(dataDir, 'jobs');
const sqlitePath = path.join(dataDir, 'app.sqlite');
const app = express();
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["set-cookie"]',
      'res.headers["set-cookie"]',
      'headers.authorization',
      'headers.cookie',
      'authorization',
      'cookie'
    ],
    censor: '[redacted]'
  }
});

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '18mb' }));
app.use((error, _req, res, next) => {
  if (error?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: '请求 JSON 格式无效' });
  }
  if (error?.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: '上传内容过大，请减少源图数量或压缩图片后再试。' });
  }
  next(error);
});
app.use(cookieParser());
app.use(pinoHttp({ logger }));
app.use(authMiddleware);
app.use(apiKeyMiddleware);
app.get('/favicon.ico', (_req, res) => {
  res.sendFile(path.join(publicDir, 'assets', 'site-logo.png'));
});
app.use(express.static(publicDir, {
  index: false,
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
      return;
    }
    if (filePath.includes(`${path.sep}assets${path.sep}`)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return;
    }
    if (/\.(?:js|css)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    }
  }
}));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 12 * 1024 * 1024,
    files: 5
  }
});

function handleUploadError(error, _req, res, next) {
  if (!error) return next();
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ success: false, message: '单张源图不能超过 12MB。' });
    if (error.code === 'LIMIT_FILE_COUNT') return res.status(413).json({ success: false, message: '源图最多上传 4 张。' });
    return res.status(400).json({ success: false, message: `上传失败：${error.message}` });
  }
  return next(error);
}

const money = (cents) => Math.round(Number(cents || 0));
function amountUnitToCents(...values) {
  const raw = values.find((value) => value !== undefined && value !== null && String(value).trim() !== '');
  return money(Number(raw || 0) * 100);
}
const publicPrices = () => Object.fromEntries(supportedQualities.map((quality) => [quality, billingPrices()[quality]]));
const rateBuckets = new Map();
const maxRateBuckets = 5000;
let lastRateBucketSweep = 0;
const generationQueue = [];
const generationJobs = new Map();
let activeGenerationJobs = 0;
let generationJobsStarted = 0;
let generationJobsFinished = 0;
let generationJobsFailed = 0;
let persistedGenerationJobCount = 0;
let generationJobDb = null;
let generationJobStatements = null;
const generationWorkerId = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
const maxGenerationWorkers = Math.max(1, Math.min(4, Math.trunc(Number(process.env.IMAGE_WORKER_CONCURRENCY || 2))));
const generationWorkersDisabled = process.env.IMAGE_WORKER_DISABLED === '1';
const generationJobLeaseMs = Math.max(30_000, Math.trunc(Number(process.env.IMAGE_JOB_LEASE_MS || 120_000)));
const generationJobHeartbeatMs = Math.max(5_000, Math.min(30_000, Math.trunc(Number(process.env.IMAGE_JOB_HEARTBEAT_MS || Math.floor(generationJobLeaseMs / 3)))));
const generationJobLeaseRetryMs = Math.max(1_000, Math.min(generationJobLeaseMs, Math.trunc(Number(process.env.IMAGE_JOB_LEASE_RETRY_MS || 5_000))));
const maxPersistedGenerationJobs = Math.max(1, Math.trunc(Number(process.env.IMAGE_MAX_PERSISTED_JOBS || 100)));
const maxPendingGenerations = Math.max(maxPersistedGenerationJobs, Math.trunc(Number(process.env.IMAGE_MAX_PENDING_GENERATIONS || maxPersistedGenerationJobs)));
const maxPendingGenerationsPerUser = Math.max(1, Math.trunc(Number(process.env.IMAGE_MAX_PENDING_PER_USER || 3)));
const maxProxyImageBytes = 24 * 1024 * 1024;
const proxyImageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const communityReuseCookieName = 'community_reuse_id';
const communityReuseCookieMaxAge = 180 * 24 * 60 * 60 * 1000;
const communityReuseIntentMaxAge = 30 * 60 * 1000;
const communityDownloadCookieName = 'community_download_id';
const communityDownloadCookieMaxAge = 180 * 24 * 60 * 60 * 1000;
const studioTemplateDefinitions = [
  {
    id: 'guofeng-campaign',
    label: '国风宣发',
    title: '周芷若联动宣传图',
    description: '国风人物、红金氛围、联动宣传主视觉。',
    prompt: '周芷若联动宣传图，国风角色联动，红金渐变背景，现代广告构图，人物占比突出，无文字，无水印',
    keywords: ['周芷若', '国风', '宣发', '宣传', '联动', '角色', '红金', '海报', '人像'],
    exclude: ['测试', '陶瓷杯', '游戏'],
    fallbackImageUrl: '/assets/templates/guofeng-campaign.jpg'
  },
  {
    id: 'porcelain-museum',
    label: '博物馆图鉴',
    title: '青花瓷博物馆图鉴',
    description: '蓝白瓷器、展陈空间、画册摄影质感。',
    prompt: '青花瓷博物馆图鉴，蓝白瓷器，展陈空间，柔和自然光，文物摄影质感，高级画册风格，无文字',
    keywords: ['青花瓷', '瓷器', '博物馆', '图鉴', '展陈', '文物', '画册', '摄影', '蓝白'],
    exclude: ['测试', '人物', '人像', '游戏', '实机', '周芷若', '卡芙卡'],
    fallbackImageUrl: '/assets/templates/porcelain-museum.jpg'
  },
  {
    id: 'poster-character',
    label: '人物海报',
    title: '卡芙卡轮廓宇宙海报',
    description: '人物剪影、电影构图、强氛围海报。',
    prompt: '卡芙卡轮廓宇宙海报，电影感构图，深紫色星云，人物剪影，细腻光影，高清细节，无文字，无水印',
    keywords: ['卡芙卡', '人物', '人像', '海报', '剪影', '角色', '电影感', '主视觉'],
    exclude: ['测试', '陶瓷杯', '青花瓷', '博物馆', '游戏', '实机', '周芷若'],
    fallbackImageUrl: '/assets/templates/poster-character.jpg'
  },
  {
    id: 'game-scene',
    label: '游戏场景',
    title: '地平线8深圳实机图',
    description: '未来城市、赛道车流、写实游戏截图。',
    prompt: '地平线8深圳实机图，未来城市，航拍视角，高速运动感，蓝橙色调，写实游戏截图，无文字',
    keywords: ['地平线', '游戏', '实机', '城市', '深圳', '赛道', '车流', '未来', '截图', '建筑'],
    exclude: ['测试', '陶瓷杯'],
    fallbackImageUrl: '/assets/templates/game-scene.jpg'
  }
];

function rateIdentity(value) {
  const input = String(value || '').slice(0, 512);
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 24);
}

function signCommunityReuseIntent({ postId, userId, expiresAt }) {
  const payload = [
    String(postId || ''),
    String(userId || ''),
    String(Math.trunc(Number(expiresAt || 0)))
  ].join('.');
  return crypto.createHmac('sha256', config.appSecret).update(payload).digest('base64url');
}

function createCommunityReuseIntent(postId, userId) {
  const expiresAt = Date.now() + communityReuseIntentMaxAge;
  const cleanPostId = String(postId || '');
  const cleanUserId = String(userId || '');
  const signature = signCommunityReuseIntent({ postId: cleanPostId, userId: cleanUserId, expiresAt });
  return `${cleanPostId}.${cleanUserId}.${expiresAt}.${signature}`;
}

function verifyCommunityReuseIntent(token, { postId, userId }) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4) return false;
  const [tokenPostId, tokenUserId, expiresAtText, signature] = parts;
  const expiresAt = Number(expiresAtText);
  if (!tokenPostId || !tokenUserId || !signature || !Number.isSafeInteger(expiresAt)) return false;
  if (tokenPostId !== String(postId || '') || tokenUserId !== String(userId || '')) return false;
  if (expiresAt < Date.now()) return false;
  const expected = signCommunityReuseIntent({ postId: tokenPostId, userId: tokenUserId, expiresAt });
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function findPublishedCommunityPost(postId, db = snapshot()) {
  return db.communityPosts.find((item) => item.id === String(postId || '') && item.status === 'published') || null;
}

function pruneRateBuckets(now = Date.now(), force = false) {
  if (!force && now - lastRateBucketSweep < 60 * 1000 && rateBuckets.size <= maxRateBuckets) return;
  lastRateBucketSweep = now;
  for (const [bucketKey, bucket] of rateBuckets.entries()) {
    if (bucket.resetAt <= now) rateBuckets.delete(bucketKey);
  }
  if (rateBuckets.size <= maxRateBuckets) return;
  const overflow = rateBuckets.size - maxRateBuckets;
  let removed = 0;
  for (const bucketKey of rateBuckets.keys()) {
    rateBuckets.delete(bucketKey);
    removed += 1;
    if (removed >= overflow) break;
  }
}

function rateLimit({ name, windowMs, max, key }) {
  return (req, res, next) => {
    const now = Date.now();
    pruneRateBuckets(now);
    const identity = key ? key(req) : req.ip;
    const bucketKey = `${name}:${rateIdentity(identity || req.ip)}`;
    const bucket = rateBuckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) {
      rateBuckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
      pruneRateBuckets(now, rateBuckets.size > maxRateBuckets);
      return next();
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return res.status(429).json({ success: false, message: '操作太频繁，请稍后再试。' });
    }
    next();
  };
}

function secureCookieOptions(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(req.secure || forwardedProto === 'https'),
    path: '/'
  };
}

function signCommunityReuseId(id) {
  const signature = crypto.createHmac('sha256', config.appSecret).update(id).digest('base64url');
  return `${id}.${signature}`;
}

function verifySignedVisitorCookie(value) {
  const [id, signature, extra] = String(value || '').split('.');
  if (extra || !/^[A-Za-z0-9_-]{16,64}$/.test(id || '') || !signature) return null;
  const expected = crypto.createHmac('sha256', config.appSecret).update(id).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  return crypto.timingSafeEqual(actualBuffer, expectedBuffer) ? id : null;
}

const verifyCommunityReuseCookie = verifySignedVisitorCookie;

function ensureCommunityReuseId(req, res) {
  const existing = verifyCommunityReuseCookie(req.cookies?.[communityReuseCookieName]);
  if (existing) return existing;
  const id = crypto.randomBytes(16).toString('base64url');
  res.cookie(communityReuseCookieName, signCommunityReuseId(id), {
    ...secureCookieOptions(req),
    maxAge: communityReuseCookieMaxAge
  });
  return id;
}

function ensureCommunityDownloadId(req, res) {
  const existing = verifySignedVisitorCookie(req.cookies?.[communityDownloadCookieName]);
  if (existing) return existing;
  const id = crypto.randomBytes(16).toString('base64url');
  res.cookie(communityDownloadCookieName, signCommunityReuseId(id), {
    ...secureCookieOptions(req),
    maxAge: communityDownloadCookieMaxAge
  });
  return id;
}

const authLimiter = rateLimit({ name: 'auth', windowMs: 10 * 60 * 1000, max: 20, key: (req) => `${req.ip}:${String(req.body?.account || req.body?.username || '')}` });
const redeemLimiter = rateLimit({ name: 'redeem', windowMs: 10 * 60 * 1000, max: 12, key: (req) => req.user?.id || req.ip });
const aiLimiter = rateLimit({ name: 'ai', windowMs: 60 * 1000, max: 12, key: (req) => req.user?.id || req.apiUser?.id || req.ip });
const communityWriteLimiter = rateLimit({ name: 'community-write', windowMs: 60 * 1000, max: 24, key: (req) => req.user?.id || req.ip });
const communityReuseLimiter = rateLimit({
  name: 'community-reuse',
  windowMs: 60 * 1000,
  max: 30,
  key: (req) => req.user?.id || verifyCommunityReuseCookie(req.cookies?.[communityReuseCookieName]) || req.ip
});
const communityTipLimiter = rateLimit({ name: 'community-tip', windowMs: 60 * 1000, max: 8, key: (req) => req.user?.id || req.ip });
const communityDownloadLimiter = rateLimit({
  name: 'community-download',
  windowMs: 60 * 1000,
  max: 80,
  key: (req) => req.user?.id || verifySignedVisitorCookie(req.cookies?.[communityDownloadCookieName]) || req.ip
});
const mimeByFormat = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
};
const formatByMime = {
  'image/jpeg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp'
};

function dataUrlImageSource(dataUrl, index = 0) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const [, mimeType, imageBase64] = match;
  if (!imageBase64 || imageBase64.length > 24 * 1024 * 1024) return null;
  return {
    imageBase64,
    mimeType,
    outputFormat: formatByMime[mimeType] || 'jpeg',
    sourceIndex: index
  };
}

function generationSourceImagesFromDataUrls(dataUrls = []) {
  return (Array.isArray(dataUrls) ? dataUrls : [])
    .slice(0, 4)
    .map((dataUrl, index) => dataUrlImageSource(dataUrl, index))
    .filter(Boolean);
}

function uploadedFileToDataUrl(file) {
  if (!file?.buffer?.length) return '';
  const mimeType = String(file.mimetype || '').toLowerCase();
  if (!proxyImageMimeTypes.has(mimeType)) {
    throw new Error('只支持 JPG、PNG、WEBP 源图');
  }
  return `data:${mimeType};base64,${file.buffer.toString('base64')}`;
}

function uploadedFilesToDataUrls(files = []) {
  return files
    .filter(Boolean)
    .slice(0, 4)
    .map(uploadedFileToDataUrl)
    .filter(Boolean);
}

const historyImageUrl = (item, index = 0) => `/api/history/${encodeURIComponent(item.id)}/image/${index}`;

const imageSummary = (item, image, index = 0) => ({
  imageUrl: (image.imageUrl || image.imageBase64) ? historyImageUrl(item, index) : null,
  imageBase64: null,
  outputFormat: image.outputFormat || item.outputFormat,
  mimeType: image.mimeType || item.mimeType || mimeByFormat[item.outputFormat] || 'image/png'
});

const generationImages = (item) => {
  if (Array.isArray(item.images) && item.images.length) {
    return item.images.map((image, index) => imageSummary(item, image, index));
  }
  if (item.imageUrl || item.imageBase64) {
    return [imageSummary(item, item, 0)];
  }
  return [];
};

function publicImageUrlForGeneration(generation, index = 0) {
  return `/api/community/generations/${encodeURIComponent(generation.id)}/preview/${index}`;
}

function publicGenerationImages(generation, indexes = null) {
  const images = generationImages(generation);
  const selectedIndexes = Array.isArray(indexes) && indexes.length
    ? indexes
      .map((index) => Math.trunc(Number(index)))
      .filter((index) => index >= 0 && index < images.length)
    : images.map((_image, index) => index);
  return selectedIndexes.map((sourceIndex, displayIndex) => {
    const image = images[sourceIndex] || {};
    return {
      imageUrl: publicImageUrlForGeneration(generation, sourceIndex),
      outputFormat: image.outputFormat || generation.outputFormat || null,
      mimeType: image.mimeType || mimeByFormat[image.outputFormat || generation.outputFormat] || 'image/png',
      sourceIndex,
      displayIndex
    };
  });
}

function communityPostImageIndexes(post, generation) {
  const images = generationImages(generation);
  if (!images.length) return [];
  if (!Array.isArray(post?.imageIndexes) || !post.imageIndexes.length) {
    return [0];
  }
  return [...new Set(post.imageIndexes
    .map((index) => Math.trunc(Number(index)))
    .filter((index) => index >= 0 && index < images.length))];
}

function communityPostImages(post, generation) {
  return generation ? publicGenerationImages(generation, communityPostImageIndexes(post, generation)) : [];
}

function publicSourceImageUrlForGeneration(generation, index = 0) {
  return `/api/community/generations/${encodeURIComponent(generation.id)}/source/${index}`;
}

function generationSourceImages(generation) {
  if (!generation || generation.mode !== 'edit' || !Array.isArray(generation.sourceImages)) return [];
  return generation.sourceImages
    .map((image, index) => {
      const mimeType = image?.mimeType || mimeByFormat[image?.outputFormat] || 'image/png';
      if (!image || (!image.imageUrl && !image.imageBase64) || !proxyImageMimeTypes.has(mimeType)) return null;
      return {
        imageUrl: publicSourceImageUrlForGeneration(generation, index),
        outputFormat: image.outputFormat || formatByMime[mimeType] || 'jpeg',
        mimeType,
        sourceIndex: Number.isInteger(image.sourceIndex) ? image.sourceIndex : index,
        displayIndex: index
      };
    })
    .filter(Boolean)
    .slice(0, 4);
}

function communityPostImageSummary(req, image) {
  return {
    imageUrl: image?.imageUrl ? absoluteUrl(req, image.imageUrl) : null,
    outputFormat: image?.outputFormat || null,
    mimeType: image?.mimeType || 'image/png',
    sourceIndex: Number.isInteger(image?.sourceIndex) ? image.sourceIndex : 0,
    displayIndex: Number.isInteger(image?.displayIndex) ? image.displayIndex : 0
  };
}

function resolveCommunityDownloadIndex(post, generation, requestedIndex) {
  const allowed = communityPostImageIndexes(post, generation);
  if (!allowed.length) return null;
  if (requestedIndex === undefined || requestedIndex === null || requestedIndex === '') return allowed[0];
  const rawIndex = String(requestedIndex);
  if (!/^\d+$/.test(rawIndex)) return null;
  const index = Number(rawIndex);
  if (!Number.isSafeInteger(index)) return null;
  return allowed[index] ?? null;
}

function publicGenerationError(message) {
  const text = String(message || '');
  const lowerText = text.toLowerCase();
  if (text.includes('API key') || text.includes('IMAGE_UPSTREAM_API_KEY')) return '生成通道暂不可用，请联系管理员检查配置。';
  if (text.includes('No available compatible accounts')) return '上游生图账号池暂无可用账号，本次未扣费，请管理员在后台切换可用上游或稍后重试。';
  if (lowerText.includes('error code: 502') || text.includes('上游生图网关返回 502')) return '上游生图网关当前不可用，本次未扣费，请管理员在后台切换可用上游或稍后重试。';
  if (text.includes('上游生图网关返回')) return '上游生图网关返回错误，本次未扣费，请管理员检查上游配置或稍后重试。';
  if (text.includes('openai_error')) return '生成通道返回错误，本次未扣费，请稍后重试。';
  if (text.includes('other side closed') || text.includes('UND_ERR_SOCKET') || text.includes('ECONNRESET')) return '生成通道连接中断，本次未扣费，请稍后重试。';
  if (lowerText.includes('fetch failed') || lowerText.includes('timeout') || text.includes('headersTimeout')) return '生成通道响应超时，本次未扣费，请稍后重试。';
  if (text.includes('size') || text.includes('4096') || text.includes('2048')) return '当前图片尺寸不被上游支持，请刷新后重试。';
  return text || '生成失败，请稍后重试。';
}

function publicOptimizeError(message) {
  const text = String(message || '');
  if (text.includes('API key') || text.includes('密钥')) return '优化通道暂不可用，请联系管理员检查配置。';
  if (text.includes('model') || text.includes('模型')) return '文本模型暂不可用，请联系管理员检查文本模型配置。';
  if (text.includes('timeout') || text.includes('headersTimeout') || text.includes('bodyTimeout') || text.includes('UND_ERR')) {
    return '文本模型响应超时，请稍后重试。';
  }
  if (text.includes('fetch failed') || text.includes('ECONNRESET') || text.includes('other side closed')) {
    return '文本模型连接中断，请稍后重试。';
  }
  return text || '优化失败，请稍后重试。';
}

const generationSummary = (item, billing = null) => ({
  ...item,
  error: item.error ? publicGenerationError(item.error) : item.error,
  imageUrl: (item.imageUrl || item.imageBase64) ? historyImageUrl(item, 0) : null,
  imageBase64: null,
  images: generationImages(item),
  consumedAmountCents: Number(billing?.consumedAmountCents || 0),
  refundedAmountCents: Number(billing?.refundedAmountCents || 0),
  remainingAmountCents: Number(billing?.remainingAmountCents || 0),
  billingState: billing?.refundedAmountCents
    ? 'refunded'
    : billing?.consumedAmountCents
      ? 'charged'
      : 'no_charge'
});

function adminTransactionSummary(tx) {
  const reason = String(tx.reason || '').replace(/兑换码\s+[A-Z0-9-]{6,32}/g, '兑换码 ****');
  return {
    id: tx.id,
    userId: tx.userId,
    type: tx.type,
    amountCents: tx.amountCents,
    balanceAfterCents: tx.balanceAfterCents,
    reason,
    generationId: tx.generationId || null,
    postId: tx.postId || null,
    createdAt: tx.createdAt
  };
}

function adminGenerationLogSummary(generation, db) {
  const user = db.users.find((item) => item.id === generation.userId);
  const consume = db.transactions.find((tx) => tx.type === 'consume' && tx.generationId === generation.id && tx.userId === generation.userId);
  const refunds = db.transactions
    .filter((tx) => tx.type === 'refund' && tx.generationId === generation.id && tx.userId === generation.userId)
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  const latestRefund = refunds.at(-1) || null;
  const createdAt = Number(generation.createdAt || 0);
  const finishedAt = Number(generation.finishedAt || (generation.status === 'pending' ? 0 : generation.updatedAt) || 0);
  const imageCount = generationImages(generation).length;
  const metadata = generation.metadata || {};
  const consumeAmountCents = consume ? Math.abs(Number(consume.amountCents || 0)) : Number(generation.priceCents || 0);
  const refundAmountCents = refunds.reduce((sum, tx) => sum + Math.abs(Number(tx.amountCents || 0)), 0);
  const promptFull = String(generation.prompt || '');
  return {
    id: generation.id,
    userId: generation.userId || null,
    username: user?.username || generation.username || '未知用户',
    account: user?.account || '',
    userStatus: user?.status || 'unknown',
    status: generation.status || 'pending',
    source: generation.source || 'web',
    mode: generation.mode || 'generate',
    quality: generation.quality || null,
    size: generation.size || null,
    outputFormat: generation.outputFormat || null,
    count: Number(generation.count || imageCount || 1),
    requestedCount: Number(metadata.requestedCount || generation.count || imageCount || 1),
    returnedCount: Number(metadata.returnedCount || imageCount || 0),
    layout: generation.layout || 'single',
    model: generation.model || metadata.upstreamModel || null,
    promptPreview: promptFull.slice(0, 180),
    promptFull: promptFull.slice(0, 4000),
    imageCount,
    priceCents: Number(generation.priceCents || consumeAmountCents || 0),
    consumeTransactionId: consume?.id || null,
    consumeAmountCents,
    refundTransactionId: latestRefund?.id || null,
    refundTransactionIds: refunds.map((tx) => tx.id),
    refundAmountCents,
    netAmountCents: Math.max(0, consumeAmountCents - refundAmountCents),
    balanceAfterCents: latestRefund?.balanceAfterCents ?? consume?.balanceAfterCents ?? null,
    billingState: refunds.length ? 'refunded' : (consume ? 'charged' : 'no_charge'),
    upstreamStatus: generation.upstreamStatus || null,
    upstreamId: metadata.upstreamId || null,
    upstreamName: metadata.upstreamName || null,
    upstreamModel: metadata.upstreamModel || generation.model || null,
    partialRefundCents: Number(metadata.partialRefundCents || 0),
    batchFailures: Array.isArray(metadata.batchFailures) ? metadata.batchFailures.slice(0, 8) : [],
    upstreamAttempts: Array.isArray(metadata.upstreamAttempts) ? metadata.upstreamAttempts.slice(0, 16) : [],
    errorPreview: generation.error ? publicGenerationError(generation.error).slice(0, 240) : '',
    createdAt: generation.createdAt,
    updatedAt: generation.updatedAt,
    deletedFromHistoryAt: generation.deletedFromHistoryAt || null,
    startedAt: generation.startedAt || generation.createdAt || null,
    finishedAt: finishedAt || null,
    durationMs: Number(generation.durationMs || (createdAt && finishedAt ? finishedAt - createdAt : 0)) || null
  };
}

function adminRedeemCodeSummary(item, db) {
  const usedUser = item.usedBy ? db.users.find((user) => user.id === item.usedBy) : null;
  const createdUser = item.createdBy ? db.users.find((user) => user.id === item.createdBy) : null;
  const revokedUser = item.revokedBy ? db.users.find((user) => user.id === item.revokedBy) : null;
  return {
    id: item.id,
    code: item.code,
    amountCents: item.amountCents,
    status: item.status,
    createdBy: item.createdBy || null,
    createdByName: createdUser?.username || null,
    createdByAccount: createdUser?.account || null,
    createdAt: item.createdAt,
    usedBy: item.usedBy || null,
    usedByName: usedUser?.username || null,
    usedByAccount: usedUser?.account || null,
    usedAt: item.usedAt || null,
    revokedBy: item.revokedBy || null,
    revokedByName: revokedUser?.username || null,
    revokedByAccount: revokedUser?.account || null,
    revokedAt: item.revokedAt || null
  };
}

function redeemCodeStatusText(status) {
  if (status === 'used') return '已兑换';
  if (status === 'revoked') return '已撤销';
  return '未使用';
}

function parseRedeemIds(value) {
  return new Set(String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean));
}

function adminRedeemCodeList(db, { status = 'all', q = '', ids = null } = {}) {
  const keyword = String(q || '').trim().toLowerCase();
  const idSet = ids instanceof Set ? ids : null;
  return db.redeemCodes
    .map((item) => adminRedeemCodeSummary(item, db))
    .filter((item) => !idSet || idSet.has(item.id))
    .filter((item) => idSet || status === 'all' || item.status === status)
    .filter((item) => {
      if (idSet || !keyword) return true;
      return [
        item.id,
        item.code,
        item.status,
        redeemCodeStatusText(item.status),
        item.usedByName,
        item.usedByAccount,
        item.createdByName,
        item.createdByAccount,
        item.revokedByName,
        item.revokedByAccount
      ].some((value) => String(value || '').toLowerCase().includes(keyword));
    })
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function adminRedeemStats(codes) {
  return codes.reduce((acc, item) => {
    acc.total += 1;
    acc[item.status] = Number(acc[item.status] || 0) + 1;
    acc.amountCents += Number(item.amountCents || 0);
    return acc;
  }, { total: 0, active: 0, used: 0, revoked: 0, amountCents: 0 });
}

function adminRedeemFullStats(db) {
  return adminRedeemStats(adminRedeemCodeList(db));
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function timestampForCsv(value) {
  const time = Number(value || 0);
  if (!Number.isFinite(time) || time <= 0) return '';
  return new Date(time).toISOString();
}

function redeemCodesCsv(codes) {
  const rows = [
    ['卡密', '奇点', '状态', '使用用户', '使用账号', '创建人', '创建时间', '使用时间', '撤销时间', 'ID'],
    ...codes.map((item) => [
      item.code,
      (Number(item.amountCents || 0) / 100).toFixed(2),
      redeemCodeStatusText(item.status),
      item.usedByName || '',
      item.usedByAccount || '',
      item.createdByName || '',
      timestampForCsv(item.createdAt),
      timestampForCsv(item.usedAt),
      timestampForCsv(item.revokedAt),
      item.id
    ])
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\n')}\n`;
}

function adminCommunityPostSummary(post) {
  return {
    id: post.id,
    userId: post.userId,
    username: post.username,
    title: post.title,
    tags: post.tags || [],
    imageUrl: post.imageUrl,
    likeCount: post.likeCount || 0,
    commentCount: post.commentCount || 0,
    downloadCount: post.downloadCount || 0,
    reuseCount: post.reuseCount || 0,
    tipTotalCents: post.tipTotalCents || 0,
    hotScore: post.hotScore || 0,
    pinnedCommentId: post.pinnedCommentId || null,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt
  };
}

function attachPublishedPost(generation, db, req) {
  const billing = generationBillingSummary(generation.id, generation.userId);
  const summary = generationSummary(generation, billing);
  const post = db.communityPosts.find((item) => item.generationId === generation.id && item.status === 'published');
  if (!post) return summary;
  return {
    ...summary,
    communityPostId: post.id,
    communityPost: communityPostSummary(post, req, { db })
  };
}

function historyMatchesQuery(item, queryText) {
  const query = String(queryText || '').trim().toLowerCase();
  if (!query) return true;
  const haystack = [
    item.prompt,
    item.error,
    item.size,
    item.quality,
    item.outputFormat,
    item.mode,
    item.status,
    item.communityPost?.title,
    item.communityPost?.description,
    (item.communityPost?.tags || []).join(' ')
  ].join(' ').toLowerCase();
  return haystack.includes(query);
}

function historyMatchesStatus(item, status) {
  if (status === 'pending') return item.status === 'pending';
  if (status === 'unpublished') return item.status === 'succeeded' && !item.communityPostId;
  if (status === 'published') return Boolean(item.communityPostId);
  if (status === 'failed') return item.status === 'failed';
  return true;
}

function historyMatchesMode(item, mode) {
  if (mode === 'generate' || mode === 'edit') return item.mode === mode;
  return true;
}

function historyVisibleToUser(item) {
  return !item.deletedFromHistoryAt;
}

function historyDeletableCount(items) {
  return items.filter((item) => item.status !== 'pending' && !item.communityPostId).length;
}

const publicRequestBase = (req) => {
  const configuredBase = String(config.publicBaseUrl || '').replace(/\/$/, '');
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req.get('host');
  const requestBase = host ? `${forwardedProto || req.protocol}://${host}` : '';
  return configuredBase && !/^https?:\/\/127\.0\.0\.1(?::\d+)?$/i.test(configuredBase)
    ? configuredBase
    : requestBase || configuredBase;
};

const absoluteUrl = (req, url) => {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const base = publicRequestBase(req);
  return `${base}${url}`;
};

function escapeMeta(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeDownloadFilename(name, extension = 'jpg') {
  const fallback = 'community-image';
  const cleanBase = String(name || fallback)
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || fallback;
  const cleanExtension = String(extension || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg';
  return `${cleanBase}.${cleanExtension}`;
}

function imageExtension(image = {}) {
  if (image.outputFormat === 'png' || image.mimeType === 'image/png') return 'png';
  if (image.outputFormat === 'webp' || image.mimeType === 'image/webp') return 'webp';
  return 'jpg';
}

function setDownloadHeaders(res, filename) {
  const asciiName = filename.replace(/[^\x20-\x7e]+/g, '-').replace(/"/g, '').replace(/^-+(\.[a-z0-9]+)$/i, 'community-image$1');
  res.setHeader('content-disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
}

function shareDescription(post) {
  const parts = [
    post.description,
    post.prompt,
    `${post.likeCount || 0} 赞 · ${post.commentCount || 0} 评论 · 辅助：${post.reuseCount || 0} 参考延展 / ${post.downloadCount || 0} 位用户免费下载`
  ].filter(Boolean);
  return String(parts.join('｜')).replace(/\s+/g, ' ').slice(0, 180);
}

function canViewPostFeedbackCounts(post, req) {
  return Boolean(req.user?.id && (req.user.role === 'admin' || req.user.id === post.userId));
}

function pendingFeedbackCountsForPost(post, db) {
  const reportsByCommentId = new Map();
  db.communityCommentReports
    .filter((report) => report.postId === post.id && report.status === 'active')
    .forEach((report) => {
      reportsByCommentId.set(report.commentId, (reportsByCommentId.get(report.commentId) || 0) + 1);
    });
  const handledCommentIds = new Set(db.communityFeedbackHandled
    .filter((entry) => entry.postId === post.id && entry.userId === post.userId && entry.status === 'active')
    .map((entry) => entry.commentId));
  return db.communityComments
    .filter((comment) => comment.postId === post.id && comment.status === 'published')
    .filter((comment) => comment.userId !== post.userId || (reportsByCommentId.get(comment.id) || 0) > 0)
    .filter((comment) => (reportsByCommentId.get(comment.id) || 0) > 0 || !handledCommentIds.has(comment.id))
    .reduce((sum, comment) => {
      const isReported = (reportsByCommentId.get(comment.id) || 0) > 0;
      if (isReported) sum.reported += 1;
      else if (comment.parentCommentId) sum.replies += 1;
      else sum.comments += 1;
      sum.total += 1;
      return sum;
    }, { total: 0, reported: 0, comments: 0, replies: 0, normal: 0 });
}

async function sendIndexHtml(req, res) {
  const html = await fs.readFile(indexHtmlPath, 'utf8');
  if (req.path !== '/prompts' || !req.query.post) return res.type('html').send(html);
  const db = snapshot();
  const post = db.communityPosts.find((item) => item.id === String(req.query.post) && item.status === 'published');
  if (!post) return res.type('html').send(html);
  const summary = communityPostSummary(post, req, { db });
  const title = `${summary.title || '交流区作品'} - Rivermoon Image Studio`;
  const description = shareDescription(summary);
  const imageUrl = summary.imageUrl || absoluteUrl(req, '/assets/site-logo.png');
  const pageUrl = absoluteUrl(req, `/prompts?post=${encodeURIComponent(summary.id)}`);
  const meta = [
    `<meta name="description" content="${escapeMeta(description)}" />`,
    `<meta property="og:type" content="article" />`,
    `<meta property="og:site_name" content="Rivermoon Image Studio" />`,
    `<meta property="og:title" content="${escapeMeta(title)}" />`,
    `<meta property="og:description" content="${escapeMeta(description)}" />`,
    `<meta property="og:image" content="${escapeMeta(imageUrl)}" />`,
    `<meta property="og:url" content="${escapeMeta(pageUrl)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeMeta(title)}" />`,
    `<meta name="twitter:description" content="${escapeMeta(description)}" />`,
    `<meta name="twitter:image" content="${escapeMeta(imageUrl)}" />`
  ].join('\n    ');
  const nextHtml = html
    .replace(/<title>.*?<\/title>/, `<title>${escapeMeta(title)}</title>`)
    .replace('</head>', `    ${meta}\n  </head>`);
  res.type('html').send(nextHtml);
}

function hasTippedPost(db, postId, userId) {
  if (!userId) return false;
  return db.communityTips.some((tip) => tip.postId === postId && tip.fromUserId === userId);
}

function communityHotScore({ likeCount, commentCount, createdAt }) {
  const ageHours = Math.max(1, (Date.now() - Number(createdAt || Date.now())) / 36e5);
  const base = likeCount * 12 + commentCount * 18;
  return Math.round((base / Math.pow(ageHours, 0.28)) * 100) / 100;
}

function communityPostMatchesDiscovery(summary, discovery) {
  if (discovery === 'uncommented') return Number(summary.commentCount || 0) === 0;
  if (discovery === 'commented') return Number(summary.commentCount || 0) > 0;
  if (discovery === 'reusable') return Boolean(summary.canReuse);
  if (discovery === 'downloaded') return Number(summary.downloadCount || 0) > 0;
  if (discovery === 'liked') return Boolean(summary.liked);
  if (discovery === 'new') {
    const createdAt = Number(summary.createdAt || 0);
    return createdAt > 0 && Date.now() - createdAt <= 7 * 24 * 60 * 60 * 1000;
  }
  return true;
}

function isPrivateProxyIp(address) {
  if (!address) return true;
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === '::1'
      || normalized === '::'
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe80:');
  }
  if (!net.isIPv4(address)) return true;
  const parts = address.split('.').map(Number);
  return parts[0] === 0
    || parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127);
}

async function validateProxyImageUrl(imageUrl) {
  let parsed;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new Error('invalid_image_url');
  }
  if (parsed.protocol !== 'https:') throw new Error('invalid_image_url');
  const addresses = await dns.lookup(parsed.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateProxyIp(entry.address))) {
    throw new Error('invalid_image_url');
  }
  return { href: parsed.href, hostname: parsed.hostname, address: addresses[0].address };
}

function proxyImageDispatcher({ hostname, address }) {
  return new Agent({
    connect(connectOptions, callback) {
      const socket = tls.connect({
        ...connectOptions,
        host: address,
        servername: hostname
      });
      callback(null, socket);
    }
  });
}

async function proxyImageUrl(res, imageUrl, { fallbackType = 'image/jpeg', cacheControl = 'public, max-age=3600', missingMessage = '图片不存在', readErrorMessage = '图片读取失败', onSuccess = null } = {}) {
  let transferred = 0;
  let dispatcher = null;
  try {
    const safeImage = await validateProxyImageUrl(imageUrl);
    dispatcher = proxyImageDispatcher(safeImage);
    const upstream = await request(safeImage.href, {
      method: 'GET',
      maxRedirections: 0,
      bodyTimeout: 1000 * 60,
      headersTimeout: 1000 * 20,
      dispatcher
    });
    if (upstream.statusCode < 200 || upstream.statusCode >= 300) {
      return res.status(502).json({ success: false, message: readErrorMessage });
    }
    if (upstream.headers['content-length'] === '0') {
      upstream.body.destroy?.();
      return res.status(404).json({ success: false, message: missingMessage });
    }
    const contentLength = Number(upstream.headers['content-length'] || 0);
    if (contentLength > maxProxyImageBytes) {
      upstream.body.destroy?.();
      return res.status(413).json({ success: false, message: '图片文件过大' });
    }
    const contentType = String(upstream.headers['content-type'] || fallbackType).split(';')[0].trim().toLowerCase();
    if (!proxyImageMimeTypes.has(contentType)) {
      upstream.body.destroy?.();
      return res.status(502).json({ success: false, message: readErrorMessage });
    }
    const limitedBody = Readable.from(upstream.body);
    limitedBody.on('data', (chunk) => {
      transferred += chunk.length;
      if (transferred > maxProxyImageBytes) {
        limitedBody.destroy(new Error('image_too_large'));
      }
    });
    res.setHeader('content-type', contentType);
    res.setHeader('cache-control', cacheControl);
    await pipeline(limitedBody, res);
    onSuccess?.();
  } catch (error) {
    if (res.headersSent) {
      res.destroy(error);
      return;
    }
    const message = error.message === 'image_too_large' ? '图片文件过大' : (transferred === 0 ? missingMessage : readErrorMessage);
    res.status(error.message === 'image_too_large' ? 413 : 502).json({ success: false, message });
  } finally {
    dispatcher?.close?.().catch?.(() => {});
  }
}

async function fetchProxyImageData(imageUrl, { fallbackType = 'image/jpeg' } = {}) {
  let transferred = 0;
  let dispatcher = null;
  try {
    const safeImage = await validateProxyImageUrl(imageUrl);
    dispatcher = proxyImageDispatcher(safeImage);
    const upstream = await request(safeImage.href, {
      method: 'GET',
      maxRedirections: 0,
      bodyTimeout: 1000 * 60,
      headersTimeout: 1000 * 20,
      dispatcher
    });
    if (upstream.statusCode < 200 || upstream.statusCode >= 300) throw new Error('image_fetch_failed');
    if (upstream.headers['content-length'] === '0') throw new Error('image_empty');
    const contentLength = Number(upstream.headers['content-length'] || 0);
    if (contentLength > maxProxyImageBytes) throw new Error('image_too_large');
    const contentType = String(upstream.headers['content-type'] || fallbackType).split(';')[0].trim().toLowerCase();
    if (!proxyImageMimeTypes.has(contentType)) throw new Error('image_type_invalid');
    const chunks = [];
    for await (const chunk of upstream.body) {
      transferred += chunk.length;
      if (transferred > maxProxyImageBytes) throw new Error('image_too_large');
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    if (!buffer.length) throw new Error('image_empty');
    return {
      imageBase64: buffer.toString('base64'),
      mimeType: contentType,
      outputFormat: formatByMime[contentType] || formatByMime[fallbackType] || 'jpeg'
    };
  } finally {
    dispatcher?.close?.().catch?.(() => {});
  }
}

async function persistRemoteImages(result, outputFormat) {
  const images = Array.isArray(result?.images) ? result.images : [];
  const hydrateImage = async (image) => {
    if (!image || image.imageBase64 || !image.imageUrl) return image;
    try {
      const persisted = await fetchProxyImageData(image.imageUrl, {
        fallbackType: image.mimeType || mimeByFormat[image.outputFormat || outputFormat] || 'image/jpeg'
      });
      return {
        ...image,
        imageBase64: persisted.imageBase64,
        mimeType: persisted.mimeType || image.mimeType,
        outputFormat: persisted.outputFormat || image.outputFormat
      };
    } catch (error) {
      logger.warn({ err: error, imageUrl: image.imageUrl }, 'image persistence failed');
      return image;
    }
  };
  const nextImages = images.length ? await Promise.all(images.map(hydrateImage)) : [];
  const firstImage = nextImages[0] || result || {};
  return {
    ...result,
    imageBase64: result?.imageBase64 || firstImage.imageBase64 || null,
    imageUrl: result?.imageUrl || firstImage.imageUrl || null,
    images: nextImages.length ? nextImages : result?.images
  };
}

function communityCommentSummary(comment, post, req, { db = snapshot(), canViewReports = canViewPostFeedbackCounts(post, req) } = {}) {
  const activeReportCountForComment = (commentId) => db.communityCommentReports
    .filter((report) => report.commentId === commentId && report.status === 'active')
    .length;
  const reportCount = activeReportCountForComment(comment.id);
  const summary = {
    id: comment.id,
    username: comment.username || '用户',
    body: comment.body || '',
    parentCommentId: comment.parentCommentId || null,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    isAuthor: comment.userId === post.userId,
    isViewerComment: Boolean(req.user?.id && comment.userId === req.user.id),
    pinned: comment.id === post.pinnedCommentId,
    canReply: !comment.parentCommentId && reportCount < 1
  };
  if (req.user?.id) summary.reportedByViewer = db.communityCommentReports.some((report) => report.commentId === comment.id && report.userId === req.user.id && report.status === 'active');
  if (canViewReports) {
    summary.reportCount = reportCount;
    summary.feedbackLocked = reportCount > 0;
  }
  return summary;
}

function communityPostSummary(post, req, { db = snapshot(), includeComments = false, includePrompt = false, includeSupport = false } = {}) {
  const generation = db.generations.find((item) => item.id === post.generationId);
  const canViewFullPrompt = includePrompt || canViewPostFeedbackCounts(post, req);
  const canViewReports = canViewPostFeedbackCounts(post, req);
  const canViewInternalRefs = canViewPostFeedbackCounts(post, req);
  const canViewSupportStats = canViewPostFeedbackCounts(post, req);
  const isOwnPost = Boolean(req.user?.id && post.userId === req.user.id);
  const publishedComments = includeComments
    ? db.communityComments
      .filter((comment) => comment.postId === post.id && comment.status === 'published')
      .map((comment) => communityCommentSummary(comment, post, req, { db, canViewReports }))
    : [];
  const repliesByParent = new Map();
  publishedComments
    .filter((comment) => comment.parentCommentId)
    .sort((a, b) => a.createdAt - b.createdAt)
    .forEach((reply) => {
      const list = repliesByParent.get(reply.parentCommentId) || [];
      list.push(reply);
      repliesByParent.set(reply.parentCommentId, list);
    });
  const comments = includeComments
    ? publishedComments
      .filter((comment) => !comment.parentCommentId)
      .sort((a, b) => {
        const pinnedDelta = Number(b.id === post.pinnedCommentId) - Number(a.id === post.pinnedCommentId);
        return pinnedDelta || a.createdAt - b.createdAt;
      })
      .map((comment) => ({
        id: comment.id,
        username: comment.username,
        body: comment.body,
        parentCommentId: comment.parentCommentId,
        createdAt: comment.createdAt,
        updatedAt: comment.updatedAt,
        isAuthor: comment.isAuthor,
        isViewerComment: comment.isViewerComment,
        pinned: comment.pinned,
        canReply: comment.canReply,
        reportedByViewer: comment.reportedByViewer,
        reportCount: comment.reportCount,
        feedbackLocked: comment.feedbackLocked,
        replies: repliesByParent.get(comment.id) || []
      }))
    : undefined;
  const likeCount = Number(post.likeCount || 0);
  const commentCount = Number(post.commentCount || 0);
  const downloadCount = Number(post.downloadCount || 0);
  const tipTotalCents = Number(post.tipTotalCents || 0);
  const reuseCount = Number(post.reuseCount || 0);
  const viewerId = req.user?.id || null;
  const liked = Boolean(viewerId && db.communityLikes.some((like) => like.postId === post.id && like.userId === viewerId));
  const hasTipped = Boolean(viewerId && hasTippedPost(db, post.id, viewerId));
  const images = communityPostImages(post, generation);
  const sourceImages = generationSourceImages(generation);
  const sameStyleVersions = includeComments
    ? db.communityPosts
      .filter((item) => item.status === 'published' && item.sourcePostId === post.id && item.id !== post.id)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .slice(0, 8)
      .map((item) => communityPostSummary(item, req, { db }))
    : undefined;
  const hotScore = communityHotScore({
    likeCount,
    commentCount,
    createdAt: post.createdAt
  });
  const summary = {
    id: post.id,
    username: post.username,
    title: post.title,
    description: post.description,
    tags: post.tags || [],
    mode: generation?.mode || 'generate',
    quality: generation?.quality || null,
    size: generation?.size || null,
    outputFormat: generation?.outputFormat || null,
    count: images.length || 1,
    layout: generation?.layout || null,
    likeCount,
    reuseCount,
    downloadCount,
    hotScore,
    commentCount,
    imageUrl: images[0]?.imageUrl ? absoluteUrl(req, images[0].imageUrl) : null,
    images: images.map((image) => communityPostImageSummary(req, image)),
    sourceImages: sourceImages.map((image) => communityPostImageSummary(req, image)),
    canDownload: true,
    canReuse: Boolean(String(post.prompt || '').trim()),
    sourcePostId: post.sourcePostId || null,
    sameStyleVersions,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    comments
  };
  if (isOwnPost) summary.isOwnPost = true;
  if (viewerId) summary.liked = liked;
  if (canViewFullPrompt) {
    summary.prompt = post.prompt || '';
  }
  if (canViewSupportStats) {
    summary.userId = post.userId;
    summary.tipTotalCents = tipTotalCents;
    summary.hasTipped = hasTipped;
  }
  if (canViewPostFeedbackCounts(post, req)) summary.pinnedCommentId = post.pinnedCommentId || null;
  if (canViewInternalRefs) summary.generationId = post.generationId;
  if (canViewPostFeedbackCounts(post, req)) {
    const counts = pendingFeedbackCountsForPost(post, db);
    counts.normal = counts.comments + counts.replies;
    summary.pendingFeedbackCounts = counts;
  }
  return summary;
}

function communityPostMetrics(summary) {
  return {
    hotScore: summary.hotScore || 0,
    likeCount: summary.likeCount || 0,
    commentCount: summary.commentCount || 0,
    reuseCount: summary.reuseCount || 0,
    downloadCount: summary.downloadCount || 0,
    tipTotalCents: summary.tipTotalCents || 0
  };
}

function studioTemplatePrompt(post, template) {
  const prompt = String(post?.prompt || '').trim();
  if (prompt) return prompt;
  const tags = Array.isArray(post?.tags) && post.tags.length ? `，关键词：${post.tags.slice(0, 4).join('、')}` : '';
  const mode = post?.mode === 'edit' ? '图生图风格延展' : '文生图创作';
  return `${post?.title || template.title}，${post?.description || mode}${tags}，参考交流区对应类型作品的构图、质感和色彩，高清细节，无文字，无水印`;
}

function studioTemplateSearchText(post, generation) {
  return [
    post?.title,
    post?.description,
    post?.username,
    (post?.tags || []).join(' '),
    post?.prompt,
    generation?.prompt,
    generation?.mode,
    generation?.layout,
    generation?.quality
  ].filter(Boolean).join(' ').toLowerCase();
}

function scoreStudioTemplatePost(post, generation, template) {
  const text = studioTemplateSearchText(post, generation);
  if (!text) return -Infinity;
  let score = 0;
  for (const keyword of template.keywords || []) {
    const word = String(keyword || '').toLowerCase();
    if (word && text.includes(word)) score += 10;
  }
  for (const keyword of template.exclude || []) {
    const word = String(keyword || '').toLowerCase();
    if (word && text.includes(word)) score -= 24;
  }
  if (post.title === template.title) score += 18;
  if ((post.tags || []).some((tag) => (template.keywords || []).includes(tag))) score += 8;
  score += Math.min(8, Number(post.hotScore || 0));
  score += Math.min(4, Number(post.likeCount || 0) + Number(post.commentCount || 0));
  score += Math.max(0, Math.min(3, (Date.now() - Number(post.createdAt || 0)) / (1000 * 60 * 60 * 24 * 30)));
  return score;
}

function communityPostTemplateSummary(post, req, { db, template }) {
  const summary = communityPostSummary(post, req, { db, includePrompt: true });
  return {
    id: template.id,
    label: template.label,
    source: 'community',
    postId: summary.id,
    title: summary.title || template.title,
    description: summary.description || template.description,
    prompt: studioTemplatePrompt(summary, template),
    imageUrl: summary.imageUrl,
    hotScore: summary.hotScore || 0,
    likeCount: summary.likeCount || 0,
    commentCount: summary.commentCount || 0,
    tags: summary.tags || [],
    createdAt: summary.createdAt || null
  };
}

function fallbackStudioTemplateSummary(template, req) {
  return {
    id: template.id,
    label: template.label,
    source: 'fallback',
    postId: null,
    title: template.title,
    description: template.description,
    prompt: template.prompt,
    imageUrl: template.fallbackImageUrl ? absoluteUrl(req, template.fallbackImageUrl) : null,
    hotScore: 0,
    likeCount: 0,
    commentCount: 0,
    tags: [],
    createdAt: null
  };
}

function studioTemplateSummaries(req) {
  const db = snapshot();
  const candidates = db.communityPosts
    .filter((post) => post.status === 'published')
    .map((post) => ({
      post,
      generation: db.generations.find((item) => item.id === post.generationId)
    }))
    .filter(({ post, generation }) => communityPostImages(post, generation).length);
  const usedPostIds = new Set();
  return studioTemplateDefinitions.map((template) => {
    const best = candidates
      .filter(({ post }) => !usedPostIds.has(post.id))
      .map(({ post, generation }) => ({
        post,
        generation,
        score: scoreStudioTemplatePost(post, generation, template)
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || Number(b.post.createdAt || 0) - Number(a.post.createdAt || 0))[0];
    if (!best) return fallbackStudioTemplateSummary(template, req);
    usedPostIds.add(best.post.id);
    return {
      ...communityPostTemplateSummary(best.post, req, { db, template }),
      matchScore: best.score
    };
  });
}

function countCreatorFeedbackItems(items) {
  return items.reduce((sum, item) => {
    sum.total += 1;
    sum[item.type] = (sum[item.type] || 0) + 1;
    if (item.handled) sum.handled += 1;
    else sum.pending += 1;
    return sum;
  }, { total: 0, pending: 0, handled: 0, comment: 0, reply: 0, reported: 0 });
}

function creatorFeedbackTotalsForPosts(posts, req, db) {
  const totals = posts
    .map((post) => communityPostSummary(post, req, { db }))
    .reduce((sum, post) => ({
      hotScore: sum.hotScore + Number(post.hotScore || 0),
      likeCount: sum.likeCount + Number(post.likeCount || 0),
      commentCount: sum.commentCount + Number(post.commentCount || 0),
      reuseCount: sum.reuseCount + Number(post.reuseCount || 0),
      downloadCount: sum.downloadCount + Number(post.downloadCount || 0),
      tipTotalCents: sum.tipTotalCents + Number(post.tipTotalCents || 0)
    }), { hotScore: 0, likeCount: 0, commentCount: 0, reuseCount: 0, downloadCount: 0, tipTotalCents: 0 });

  return {
    ...totals,
    postCount: posts.length,
    hotScore: Math.round(totals.hotScore * 100) / 100,
    latestPostId: [...posts]
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))[0]?.id || null
  };
}

function creatorFeedbackSummary(req, db, { postId = '' } = {}) {
  const myPosts = db.communityPosts
    .filter((post) => post.status === 'published' && post.userId === req.user.id);
  const scopedPosts = postId
    ? myPosts.filter((post) => post.id === postId)
    : myPosts;
  const postById = new Map(myPosts.map((post) => [post.id, post]));
  const reportsByCommentId = new Map();
  db.communityCommentReports
    .filter((report) => report.status === 'active')
    .forEach((report) => {
      reportsByCommentId.set(report.commentId, (reportsByCommentId.get(report.commentId) || 0) + 1);
    });
  const handledCommentIds = new Set(db.communityFeedbackHandled
    .filter((entry) => entry.userId === req.user.id && entry.status === 'active')
    .map((entry) => entry.commentId));

  const items = db.communityComments
    .filter((comment) => comment.status === 'published')
    .filter((comment) => postById.has(comment.postId))
    .filter((comment) => !postId || comment.postId === postId)
    .filter((comment) => comment.userId !== req.user.id || (reportsByCommentId.get(comment.id) || 0) > 0)
    .map((comment) => {
      const post = postById.get(comment.postId);
      const postSummary = communityPostSummary(post, req, { db });
      const reportCount = reportsByCommentId.get(comment.id) || 0;
      const parent = comment.parentCommentId
        ? db.communityComments.find((item) => item.id === comment.parentCommentId && item.postId === comment.postId)
        : null;
      return {
        id: comment.id,
        type: reportCount ? 'reported' : (comment.parentCommentId ? 'reply' : 'comment'),
        postId: post.id,
        postTitle: post.title,
        postImageUrl: postSummary.imageUrl,
        commentId: comment.id,
        parentCommentId: comment.parentCommentId || null,
        parentBody: parent?.body || '',
        actorName: comment.username || '用户',
        actorIsAuthor: comment.userId === post.userId,
        body: comment.body,
        reportCount,
        handled: handledCommentIds.has(comment.id),
        pinned: comment.id === post.pinnedCommentId,
        createdAt: comment.createdAt,
        postMetrics: communityPostMetrics(postSummary)
      };
    })
    .sort((a, b) => {
      const reportDelta = Number(b.reportCount > 0) - Number(a.reportCount > 0);
      return reportDelta || Number(b.createdAt || 0) - Number(a.createdAt || 0);
    });

  return {
    counts: countCreatorFeedbackItems(items),
    totals: creatorFeedbackTotalsForPosts(scopedPosts, req, db),
    items
  };
}

const openAiGenerationSummary = (req, generation) => ({
  id: generation.id,
  object: 'image.generation',
  created: Math.floor(generation.createdAt / 1000),
  model: generation.model,
  mode: generation.mode,
  quality: generation.quality,
  size: generation.size,
  output_format: generation.outputFormat,
  count: generation.count,
  price_cents: generation.priceCents,
  balance_cents: findUserById(generation.userId)?.balanceCents ?? null,
  data: generationImages(generation).map((image) => ({
    url: absoluteUrl(req, image.imageUrl),
    b64_json: null,
    mime_type: image.mimeType,
    output_format: image.outputFormat
  }))
});

function apiError(res, status, message, type = 'invalid_request_error') {
  return res.status(status).json({ error: { message, type } });
}

function generationErrorStatus(message, fallback = 502) {
  const text = String(message || '');
  if (text.includes('余额不足')) return 402;
  if (
    text.includes('请输入提示词')
    || text.includes('提示词最多')
    || text.includes('请先上传源图')
    || text.includes('请上传有效图片')
    || text.includes('只支持常见图片格式')
    || text.includes('图片不能超过')
  ) return 400;
  return fallback;
}

function fileToDataUrl(file) {
  if (!file) return '';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) {
    throw new Error('只支持常见图片格式');
  }
  return `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
}

function normalizeApiQuality(quality) {
  const value = String(quality || '').toLowerCase();
  if (value === 'medium' || value === 'standard' || value === '1k') return '1k';
  if (value === 'high' || value === 'hd' || value === '2k') return '2k';
  return normalizeQuality(value);
}

function parseStoryboardPrompts(input) {
  const list = Array.isArray(input) ? input : String(input || '').split('\n');
  return list
    .map((line) => String(line || '').replace(/^\s*(?:[-*]|\d+[.、)]|分镜\s*\d+[:：-]?)\s*/i, '').trim())
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeGenerationRequest({ user, body, source = 'web', imageDataUrls = [], maskDataUrl = '' }) {
  const prompt = String(body.prompt || '').trim();
  const mode = body.mode === 'edit' ? 'edit' : (imageDataUrls.length ? 'edit' : 'generate');
  const quality = normalizeApiQuality(body.quality);
  const size = normalizeSize(body.size);
  const outputFormat = normalizeOutputFormatForSize(body.outputFormat || body.output_format || body.response_format, size);
  let count = normalizeCount(body.count || body.n);
  const layout = body.layout === 'storyboard' ? 'storyboard' : 'single';
  const storyboardPrompts = layout === 'storyboard' ? parseStoryboardPrompts(body.storyboardPrompts || body.storyboardText || '') : [];
  const prices = billingPrices();
  if (layout === 'storyboard' && storyboardPrompts.length) count = storyboardPrompts.length;
  const priceCents = money(prices[quality]) * count;
  const fallbackImageDataUrl = String(body.imageDataUrl || '');
  const payloadImageDataUrls = Array.isArray(body.imageDataUrls)
    ? body.imageDataUrls.map((item) => String(item || '')).filter(Boolean).slice(0, 4)
    : (fallbackImageDataUrl ? [fallbackImageDataUrl] : []);
  const finalImageDataUrls = imageDataUrls.length ? imageDataUrls.slice(0, 4) : payloadImageDataUrls;
  const finalMaskDataUrl = maskDataUrl || String(body.maskDataUrl || '');

  if (prompt.length < 2) throw new Error('请输入提示词');
  if (prompt.length > 4000) throw new Error('提示词最多 4000 字');
  if (mode === 'edit' && !finalImageDataUrls.length) throw new Error('请先上传源图');
  if (layout === 'storyboard' && !storyboardPrompts.length) throw new Error('请先生成分镜草稿，再生成整组画面');

  return {
    user,
    source,
    prompt,
    mode,
    quality,
    size,
    outputFormat,
    count,
    layout,
    storyboardPrompts,
    prices,
    priceCents,
    finalImageDataUrls,
    finalMaskDataUrl
  };
}

async function prepareGenerationTask(options) {
  const task = normalizeGenerationRequest(options);
  const chargedGeneration = await createChargedGeneration({
    userId: task.user.id,
    amountCents: task.priceCents,
    reason: `${task.source === 'api' ? 'API ' : ''}${task.mode === 'edit' ? '图生图' : '文生图'} ${task.quality.toUpperCase()} 预扣`,
    generation: {
      username: task.user.username,
      mode: task.mode,
      source: task.source,
      prompt: task.prompt,
      quality: task.quality,
      size: task.size,
      outputFormat: task.outputFormat,
      count: task.count,
      layout: task.layout,
      storyboardPrompts: task.storyboardPrompts.length ? task.storyboardPrompts : null,
      priceCents: task.priceCents,
      model: aiSettings({ includeSecret: true }).imageModel,
      startedAt: Date.now(),
      metadata: {
        requestedCount: task.count,
        queuedAt: Date.now(),
        asyncWorker: true
      }
    }
  });
  return { ...task, generation: chargedGeneration.generation };
}

async function executePreparedGenerationTask(task) {
  const { generation, mode, quality, size, outputFormat, count, layout, storyboardPrompts, prices, finalImageDataUrls, finalMaskDataUrl, prompt, user } = task;
  try {
    await updateGeneration(generation.id, {
      startedAt: generation.startedAt || Date.now(),
      metadata: {
        ...(generation.metadata || {}),
        workerStartedAt: Date.now(),
        queuedMs: Math.max(0, Date.now() - Number(generation.createdAt || Date.now()))
      }
    });
    const result = layout === 'storyboard'
      ? (mode === 'edit'
        ? await editStoryboardImages({
          prompts: storyboardPrompts,
          quality,
          imageDataUrl: finalImageDataUrls[0],
          imageDataUrls: finalImageDataUrls,
          maskDataUrl: finalMaskDataUrl,
          size,
          outputFormat
        })
        : await generateStoryboardImages({
          prompts: storyboardPrompts,
          quality,
          size,
          outputFormat
        }))
      : (mode === 'edit'
        ? await editImage({ prompt, quality, imageDataUrl: finalImageDataUrls[0], imageDataUrls: finalImageDataUrls, maskDataUrl: finalMaskDataUrl, size, outputFormat, count })
        : await generateImage({ prompt, quality, size, outputFormat, count }));
    const persistedResult = await persistRemoteImages(result, outputFormat);
    const cappedImages = Array.isArray(persistedResult.images)
      ? persistedResult.images
        .filter((image) => image && (image.imageUrl || image.imageBase64))
        .slice(0, count)
      : [];
    const firstPersistedImage = cappedImages[0] || persistedResult || {};
    const normalizedPersistedResult = {
      ...persistedResult,
      imageUrl: firstPersistedImage.imageUrl || persistedResult.imageUrl || null,
      imageBase64: firstPersistedImage.imageBase64 || persistedResult.imageBase64 || null,
      images: cappedImages.length ? cappedImages : persistedResult.images
    };
    const actualReturnedCount = cappedImages.length
      ? cappedImages.length
      : (normalizedPersistedResult.imageUrl || normalizedPersistedResult.imageBase64 ? 1 : 0);
    if (actualReturnedCount < 1) {
      const emptyResultError = new Error('上游未返回可用图片，已自动退款');
      emptyResultError.code = 'EMPTY_IMAGE_RESULT';
      emptyResultError.batchFailures = Array.isArray(result.batchFailures) ? result.batchFailures : [];
      emptyResultError.upstreamAttempts = Array.isArray(result.upstreamAttempts) ? result.upstreamAttempts : [];
      throw emptyResultError;
    }
    const effectiveReturnedCount = Math.max(0, Math.min(count, actualReturnedCount));
    const refundDiffCents = effectiveReturnedCount > 0 && effectiveReturnedCount < count
      ? money(prices[quality]) * (count - effectiveReturnedCount)
      : 0;
    let partialRefund = null;
    let partialRefundActualCents = 0;
    if (refundDiffCents > 0) {
      try {
        const beforeRefund = generationBillingSummary(generation.id, user.id);
        partialRefund = await refundBalance({
          userId: user.id,
          amountCents: refundDiffCents,
          generationId: generation.id,
          reason: `部分图片生成失败自动退差额（成功 ${effectiveReturnedCount}/${count} 张）`
        });
        const afterRefund = generationBillingSummary(generation.id, user.id);
        partialRefundActualCents = Math.max(0, afterRefund.refundedAmountCents - beforeRefund.refundedAmountCents);
      } catch (refundError) {
        logger.error({ err: refundError, generationId: generation.id }, 'partial refund failed');
      }
    }
    const upstreamMetadata = {
      upstreamId: normalizedPersistedResult.upstreamId || null,
      upstreamName: normalizedPersistedResult.upstreamName || null,
      upstreamBaseUrl: normalizedPersistedResult.upstreamBaseUrl || null,
      upstreamModel: normalizedPersistedResult.upstreamModel || null
    };
    const generationMetadata = {
      ...(generation.metadata || {}),
      ...Object.fromEntries(Object.entries(upstreamMetadata).filter(([, value]) => value)),
      requestedCount: count,
      returnedCount: effectiveReturnedCount,
      failedCount: Math.max(0, count - effectiveReturnedCount),
      batchFailures: Array.isArray(result.batchFailures) ? result.batchFailures.slice(0, 8) : [],
      upstreamAttempts: Array.isArray(result.upstreamAttempts) ? result.upstreamAttempts.slice(0, 16) : [],
      partialRefundCents: partialRefundActualCents,
      partialRefundRequestedCents: refundDiffCents,
      partialRefundTransactionId: partialRefund?.id || null,
      workerFinishedAt: Date.now(),
      ...(normalizedPersistedResult.editFallback ? {
        editFallback: true,
        editFallbackReason: normalizedPersistedResult.originalEditError || null
      } : {})
    };
    const finishedAt = Date.now();
    const sourceImages = mode === 'edit' ? generationSourceImagesFromDataUrls(finalImageDataUrls) : [];
    return updateGeneration(generation.id, {
      status: 'succeeded',
      imageUrl: normalizedPersistedResult.imageUrl,
      imageBase64: normalizedPersistedResult.imageBase64,
      images: normalizedPersistedResult.images,
      sourceImages: sourceImages.length ? sourceImages : null,
      storyboardPrompts: normalizedPersistedResult.scenePrompts || (storyboardPrompts.length ? storyboardPrompts : null),
      upstreamStatus: normalizedPersistedResult.upstreamStatus,
      metadata: generationMetadata,
      finishedAt,
      durationMs: finishedAt - Number(generation.createdAt || finishedAt)
    });
  } catch (error) {
    let fullRefund = null;
    let fullRefundActualCents = 0;
    try {
      const beforeRefund = generationBillingSummary(generation?.id, user.id);
      fullRefund = await refundBalance({
        userId: user.id,
        amountCents: generation?.priceCents || task.priceCents,
        generationId: generation?.id,
        reason: '生成失败自动退款'
      });
      const afterRefund = generationBillingSummary(generation?.id, user.id);
      fullRefundActualCents = Math.max(0, afterRefund.refundedAmountCents - beforeRefund.refundedAmountCents);
    } catch (refundError) {
      logger.error({ err: refundError, generationId: generation?.id }, 'refund failed');
    }
    const finishedAt = Date.now();
    const failedMetadata = {
      ...(generation.metadata || {}),
      requestedCount: count,
      returnedCount: 0,
      failedCount: count,
      batchFailures: Array.isArray(error.batchFailures) ? error.batchFailures.slice(0, 8) : [],
      upstreamAttempts: Array.isArray(error.upstreamAttempts) ? error.upstreamAttempts.slice(0, 12) : [],
      errorCode: error.code || null,
      errorStatusCode: error.statusCode || null,
      refundCents: fullRefundActualCents,
      refundTransactionId: fullRefund?.id || null,
      workerFailedAt: finishedAt
    };
    error.generation = await updateGeneration(generation.id, {
      status: 'failed',
      error: error.message || '生成失败',
      metadata: failedMetadata,
      finishedAt,
      durationMs: finishedAt - Number(generation.createdAt || finishedAt)
    });
    throw error;
  }
}

async function runGenerationTask(options) {
  const task = await prepareGenerationTask(options);
  return executePreparedGenerationTask(task);
}

async function failPreparedGenerationTask(task, error, { reason = '生成任务启动失败，已自动退款', metadata = {} } = {}) {
  if (!task?.generation?.id) return null;
  const generation = task.generation;
  let refund = null;
  let refundActualCents = 0;
  try {
    const beforeRefund = generationBillingSummary(generation.id, task.user?.id || generation.userId);
    refund = await refundBalance({
      userId: generation.userId || task.user?.id,
      amountCents: generation.priceCents || task.priceCents,
      generationId: generation.id,
      reason
    });
    const afterRefund = generationBillingSummary(generation.id, task.user?.id || generation.userId);
    refundActualCents = Math.max(0, afterRefund.refundedAmountCents - beforeRefund.refundedAmountCents);
  } catch (refundError) {
    logger.error({ err: refundError, generationId: generation.id }, 'startup refund failed');
  }
  const finishedAt = Date.now();
  const failed = await updateGeneration(generation.id, {
    status: 'failed',
    error: error?.message || reason,
    metadata: {
      ...(generation.metadata || {}),
      requestedCount: task.count,
      returnedCount: 0,
      failedCount: task.count,
      startupFailure: true,
      refundCents: refundActualCents,
      refundTransactionId: refund?.id || null,
      ...metadata
    },
    finishedAt,
    durationMs: finishedAt - Number(generation.createdAt || finishedAt)
  });
  await deleteGenerationJob(generation.id).catch((deleteError) => {
    logger.error({ err: deleteError, generationId: generation.id }, 'startup failed job cleanup failed');
  });
  return failed;
}

function initGenerationJobStore() {
  try {
    generationJobDb = new DatabaseSync(sqlitePath);
    generationJobDb.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS generation_jobs (
        generation_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        priority INTEGER NOT NULL DEFAULT 100,
        lease_owner TEXT,
        lease_until INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS generation_jobs_status_priority_idx
        ON generation_jobs(status, priority, created_at);
      CREATE INDEX IF NOT EXISTS generation_jobs_user_status_idx
        ON generation_jobs(user_id, status);
      CREATE INDEX IF NOT EXISTS generation_jobs_lease_idx
        ON generation_jobs(status, lease_until);
    `);
    generationJobStatements = {
      upsert: generationJobDb.prepare(`
        INSERT INTO generation_jobs (
          generation_id, user_id, status, payload, attempts, priority,
          lease_owner, lease_until, created_at, updated_at, started_at, finished_at, last_error
        )
        VALUES (?, ?, ?, ?, COALESCE(?, 0), COALESCE(?, 100), ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(generation_id) DO UPDATE SET
          user_id = excluded.user_id,
          status = excluded.status,
          payload = excluded.payload,
          attempts = excluded.attempts,
          priority = excluded.priority,
          lease_owner = excluded.lease_owner,
          lease_until = excluded.lease_until,
          updated_at = excluded.updated_at,
          started_at = excluded.started_at,
          finished_at = excluded.finished_at,
          last_error = excluded.last_error
      `),
      markFinished: generationJobDb.prepare(`
        UPDATE generation_jobs
        SET status = ?, updated_at = ?, finished_at = ?, lease_owner = NULL, lease_until = NULL, last_error = ?
        WHERE generation_id = ?
      `),
      claim: generationJobDb.prepare(`
        UPDATE generation_jobs
        SET status = 'running',
          attempts = attempts + 1,
          lease_owner = ?,
          lease_until = ?,
          updated_at = ?,
          started_at = COALESCE(started_at, ?),
          last_error = NULL
        WHERE generation_id = ?
          AND status IN ('queued', 'running')
          AND (lease_until IS NULL OR lease_until <= ? OR lease_owner = ?)
      `),
      heartbeat: generationJobDb.prepare(`
        UPDATE generation_jobs
        SET lease_until = ?, updated_at = ?
        WHERE generation_id = ? AND status = 'running' AND lease_owner = ?
      `),
      delete: generationJobDb.prepare('DELETE FROM generation_jobs WHERE generation_id = ?'),
      activeIds: generationJobDb.prepare(`
        SELECT generation_id FROM generation_jobs
        WHERE status IN ('queued', 'running')
        ORDER BY priority ASC, created_at ASC
      `),
      activePayloads: generationJobDb.prepare(`
        SELECT generation_id, status, lease_owner, lease_until, payload FROM generation_jobs
        WHERE status IN ('queued', 'running')
        ORDER BY priority ASC, created_at ASC
      `),
      counts: generationJobDb.prepare(`
        SELECT status, COUNT(*) AS count FROM generation_jobs GROUP BY status
      `)
    };
  } catch (error) {
    logger.error({ err: error }, 'generation job sqlite init failed');
    generationJobDb = null;
    generationJobStatements = null;
  }
}

function generationJobSqliteCounts() {
  if (!generationJobStatements?.counts) return {};
  try {
    return Object.fromEntries(generationJobStatements.counts.all().map((row) => [row.status, Number(row.count || 0)]));
  } catch (error) {
    logger.error({ err: error }, 'generation job sqlite count failed');
    return {};
  }
}

function upsertGenerationJobRecord(task, payload, status = 'queued') {
  if (!generationJobStatements?.upsert) return;
  const now = Date.now();
  try {
    generationJobStatements.upsert.run(
      task.generation.id,
      task.generation.userId || task.user.id,
      status,
      JSON.stringify(payload),
      0,
      100,
      null,
      null,
      Number(task.generation.createdAt || now),
      now,
      null,
      null,
      null
    );
  } catch (error) {
    logger.error({ err: error, generationId: task.generation?.id }, 'generation job sqlite upsert failed');
  }
}

function markGenerationJobRecordFinished(generationId, status, errorMessage = '') {
  if (!generationJobStatements?.markFinished || !generationId) return;
  const now = Date.now();
  try {
    generationJobStatements.markFinished.run(status, now, now, errorMessage ? String(errorMessage).slice(0, 1000) : null, generationId);
  } catch (error) {
    logger.error({ err: error, generationId }, 'generation job sqlite finish failed');
  }
}

function claimGenerationJobRecord(generationId) {
  if (!generationJobStatements?.claim || !generationId) return true;
  const now = Date.now();
  const leaseUntil = now + generationJobLeaseMs;
  try {
    const result = generationJobStatements.claim.run(
      generationWorkerId,
      leaseUntil,
      now,
      now,
      generationId,
      now,
      generationWorkerId
    );
    return Number(result.changes || 0) > 0;
  } catch (error) {
    logger.error({ err: error, generationId, workerId: generationWorkerId }, 'generation job claim failed');
    return false;
  }
}

function heartbeatGenerationJobRecord(generationId) {
  if (!generationJobStatements?.heartbeat || !generationId) return true;
  const now = Date.now();
  try {
    const result = generationJobStatements.heartbeat.run(now + generationJobLeaseMs, now, generationId, generationWorkerId);
    return Number(result.changes || 0) > 0;
  } catch (error) {
    logger.error({ err: error, generationId, workerId: generationWorkerId }, 'generation job heartbeat failed');
    return false;
  }
}

function deleteGenerationJobRecord(generationId) {
  if (!generationJobStatements?.delete || !generationId) return;
  try {
    generationJobStatements.delete.run(generationId);
  } catch (error) {
    logger.error({ err: error, generationId }, 'generation job sqlite delete failed');
  }
}

function listSqliteGenerationJobIds() {
  if (!generationJobStatements?.activeIds) return [];
  try {
    return generationJobStatements.activeIds.all().map((row) => String(row.generation_id || '')).filter(Boolean);
  } catch (error) {
    logger.error({ err: error }, 'generation job sqlite list ids failed');
    return [];
  }
}

function listSqliteGenerationJobRecords() {
  if (!generationJobStatements?.activePayloads) return [];
  try {
    return generationJobStatements.activePayloads.all()
      .map((row) => {
        try {
          return {
            generationId: row.generation_id,
            status: row.status,
            leaseOwner: row.lease_owner || null,
            leaseUntil: Number(row.lease_until || 0) || null,
            record: JSON.parse(row.payload)
          };
        } catch (error) {
          logger.error({ err: error, generationId: row.generation_id }, 'generation job sqlite payload parse failed');
          return null;
        }
      })
      .filter(Boolean);
  } catch (error) {
    logger.error({ err: error }, 'generation job sqlite list payloads failed');
    return [];
  }
}

function generationQueueStats() {
  const pending = generationPendingStats();
  const sqliteJobs = generationJobSqliteCounts();
  return {
    concurrency: maxGenerationWorkers,
    disabled: generationWorkersDisabled,
    workerId: generationWorkerId,
    leaseMs: generationJobLeaseMs,
    heartbeatMs: generationJobHeartbeatMs,
    limits: {
      maxPersisted: maxPersistedGenerationJobs,
      maxPending: maxPendingGenerations,
      maxPendingPerUser: maxPendingGenerationsPerUser
    },
    queued: generationQueue.length,
    active: activeGenerationJobs,
    started: generationJobsStarted,
    finished: generationJobsFinished,
    failed: generationJobsFailed,
    tracked: generationJobs.size,
    persisted: persistedGenerationJobCount,
    sqliteJobs,
    pending: pending.total
  };
}

async function activeGenerationJobStats({ userId = null, cleanupStale = true } = {}) {
  const ids = await listPersistedGenerationJobIds();
  const scopedUserId = userId ? String(userId) : null;
  const activeIds = [];
  const staleIds = [];
  for (const id of ids) {
    const generation = refreshGenerationFromDurableStore(id) || findGenerationById(id);
    if (!generation || generation.status !== 'pending') {
      staleIds.push(id);
      continue;
    }
    activeIds.push(id);
  }
  if (cleanupStale && staleIds.length) {
    await Promise.all(staleIds.map((id) => deleteGenerationJob(id).catch((error) => {
      logger.error({ err: error, generationId: id }, 'stale generation job record cleanup failed');
    })));
  }
  return {
    total: activeIds.length,
    user: scopedUserId
      ? activeIds.filter((id) => {
        const generation = findGenerationById(id);
        return generation?.userId === scopedUserId;
      }).length
      : 0,
    ids: activeIds,
    stale: staleIds.length
  };
}

async function ensureGenerationCapacity(userId) {
  const activeJobs = await activeGenerationJobStats({ userId });
  const overload = [];
  if (activeJobs.total >= maxPersistedGenerationJobs) overload.push('persisted_jobs');
  if (activeJobs.total >= maxPendingGenerations) overload.push('global_pending');
  if (activeJobs.user >= maxPendingGenerationsPerUser) overload.push('user_pending');
  if (!overload.length) return null;
  const reason = overload.includes('user_pending')
    ? `你当前已有 ${activeJobs.user} 个生成任务在排队，请等完成后再提交。`
    : '当前生成队列较忙，请稍后再试。';
  return {
    success: false,
    code: 'generation_queue_busy',
    message: reason,
    overload,
    queue: {
      ...generationQueueStats(),
      persisted: activeJobs.total,
      pending: activeJobs.total,
      userPending: activeJobs.user,
      staleJobRecordsCleaned: activeJobs.stale
    }
  };
}

function pumpGenerationQueue() {
  if (generationWorkersDisabled) return;
  while (activeGenerationJobs < maxGenerationWorkers && generationQueue.length) {
    const job = generationQueue.shift();
    if (!job || job.started) continue;
    if (!claimGenerationJobRecord(job.id)) {
      setTimeout(() => {
        if (!generationJobs.has(job.id)) return;
        generationQueue.push(job);
        pumpGenerationQueue();
      }, generationJobLeaseRetryMs);
      continue;
    }
    job.started = true;
    activeGenerationJobs += 1;
    generationJobsStarted += 1;
    const heartbeat = setInterval(() => {
      heartbeatGenerationJobRecord(job.id);
    }, generationJobHeartbeatMs);
    heartbeat.unref?.();
    executePreparedGenerationTask(job.task)
      .then((generation) => {
        generationJobsFinished += 1;
        job.status = 'succeeded';
        job.generationId = generation.id;
        markGenerationJobRecordFinished(generation.id, 'succeeded');
        return deleteGenerationJob(generation.id);
      })
      .catch((error) => {
        generationJobsFailed += 1;
        job.status = 'failed';
        job.error = publicGenerationError(error?.message || '生成失败');
        markGenerationJobRecordFinished(job.task?.generation?.id, 'failed', error?.message || '生成失败');
        logger.error({ err: error, generationId: job.task?.generation?.id }, 'async generation job failed');
        return deleteGenerationJob(job.task?.generation?.id).catch((deleteError) => {
          logger.error({ err: deleteError, generationId: job.task?.generation?.id }, 'generation job cleanup failed');
        });
      })
      .finally(() => {
        clearInterval(heartbeat);
        activeGenerationJobs = Math.max(0, activeGenerationJobs - 1);
        setTimeout(pumpGenerationQueue, 0);
      });
  }
}

function enqueueGenerationTask(task) {
  const generationId = task.generation.id;
  const job = {
    id: generationId,
    task,
    status: 'queued',
    createdAt: Date.now(),
    started: false,
    generationId
  };
  generationJobs.set(generationId, job);
  generationQueue.push(job);
  setTimeout(pumpGenerationQueue, 0);
  return job;
}

function generationJobPath(generationId) {
  const id = String(generationId || '');
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) throw new Error('生成任务 ID 无效');
  return path.join(generationJobDir, `${id}.json`);
}

function serializeGenerationTask(task) {
  return {
    version: 1,
    savedAt: Date.now(),
    generationId: task.generation.id,
    user: {
      id: task.user.id,
      account: task.user.account || '',
      username: task.user.username || '',
      role: task.user.role || 'user',
      status: task.user.status || 'active'
    },
    source: task.source,
    prompt: task.prompt,
    mode: task.mode,
    quality: task.quality,
    size: task.size,
    outputFormat: task.outputFormat,
    count: task.count,
    layout: task.layout,
    storyboardPrompts: task.storyboardPrompts,
    priceCents: task.priceCents,
    finalImageDataUrls: task.finalImageDataUrls,
    finalMaskDataUrl: task.finalMaskDataUrl
  };
}

function hydrateGenerationTask(record) {
  const generation = findGenerationById(record.generationId);
  if (!generation || generation.status !== 'pending') return null;
  const user = findUserById(generation.userId);
  if (!user || user.status !== 'active') return null;
  const quality = normalizeApiQuality(record.quality || generation.quality);
  return {
    user,
    source: record.source || generation.source || 'web',
    prompt: String(record.prompt || generation.prompt || ''),
    mode: record.mode === 'edit' ? 'edit' : generation.mode === 'edit' ? 'edit' : 'generate',
    quality,
    size: normalizeSize(record.size || generation.size),
    outputFormat: normalizeOutputFormatForSize(record.outputFormat || generation.outputFormat, record.size || generation.size),
    count: normalizeCount(record.count || generation.count),
    layout: record.layout === 'storyboard' ? 'storyboard' : 'single',
    storyboardPrompts: Array.isArray(record.storyboardPrompts) ? record.storyboardPrompts.slice(0, 4) : [],
    prices: billingPrices(),
    priceCents: Number(record.priceCents || generation.priceCents || 0),
    finalImageDataUrls: Array.isArray(record.finalImageDataUrls) ? record.finalImageDataUrls.slice(0, 4) : [],
    finalMaskDataUrl: String(record.finalMaskDataUrl || ''),
    generation
  };
}

async function saveGenerationJob(task) {
  await fs.mkdir(generationJobDir, { recursive: true });
  const jobPath = generationJobPath(task.generation.id);
  const tmpPath = `${jobPath}.${process.pid}.${Date.now()}.tmp`;
  const payload = serializeGenerationTask(task);
  await fs.writeFile(tmpPath, JSON.stringify(payload, null, 2));
  await fs.rename(tmpPath, jobPath);
  upsertGenerationJobRecord(task, payload);
  await listPersistedGenerationJobIds();
}

async function deleteGenerationJob(generationId) {
  try {
    await fs.unlink(generationJobPath(generationId));
    persistedGenerationJobCount = Math.max(0, persistedGenerationJobCount - 1);
  } catch {}
  deleteGenerationJobRecord(generationId);
}

async function refundOrphanedGenerationJob(generationId, error, reason = '后台任务恢复失败，已自动退款，请重新生成') {
  const generation = findGenerationById(generationId);
  if (!generation || generation.status !== 'pending') {
    await deleteGenerationJob(generationId).catch(() => {});
    return null;
  }
  const user = findUserById(generation.userId);
  const task = {
    user: user || { id: generation.userId },
    generation,
    count: Math.max(1, Math.trunc(Number(generation.count || 1)) || 1),
    priceCents: Number(generation.priceCents || 0)
  };
  const failed = await failPreparedGenerationTask(task, error, {
    reason,
    metadata: {
      recoveryFailure: true,
      recoveredJobFailedAt: Date.now()
    }
  });
  return failed;
}

async function recoverGenerationJobs() {
  await fs.mkdir(generationJobDir, { recursive: true });
  const entries = await fs.readdir(generationJobDir).catch(() => []);
  const records = [];
  const sqliteRecordIds = new Set();
  for (const sqliteRecord of listSqliteGenerationJobRecords()) {
    sqliteRecordIds.add(sqliteRecord.generationId);
    records.push({ ...sqliteRecord, source: 'sqlite', filePath: null });
  }
  for (const name of entries) {
    if (!/^[a-zA-Z0-9_-]{8,80}\.json$/.test(name)) continue;
    if (sqliteRecordIds.has(name.replace(/\.json$/, ''))) continue;
    const filePath = path.join(generationJobDir, name);
    records.push({ generationId: name.replace(/\.json$/, ''), record: null, source: 'file', filePath });
  }
  persistedGenerationJobCount = new Set(records.map((item) => item.generationId)).size;
  let recovered = 0;
  const recoveredIds = new Set();
  const now = Date.now();
  for (const item of records) {
    if (recoveredIds.has(item.generationId)) continue;
    try {
      const record = item.record || JSON.parse(await fs.readFile(item.filePath, 'utf8'));
      const task = hydrateGenerationTask(record);
      if (!task) {
        await refundOrphanedGenerationJob(item.generationId, new Error('后台任务记录已失效'));
        await deleteGenerationJob(item.generationId);
        continue;
      }
      if (item.status === 'running' && item.leaseUntil && item.leaseUntil > now && item.leaseOwner !== generationWorkerId) {
        generationJobs.delete(item.generationId);
        setTimeout(recoverGenerationJobs, Math.min(generationJobLeaseRetryMs, Math.max(1000, item.leaseUntil - now))).unref?.();
        recoveredIds.add(item.generationId);
        continue;
      }
      task.generation = await updateGeneration(task.generation.id, {
        metadata: {
        ...(task.generation.metadata || {}),
        recoveredJob: true,
        recoveredAt: Date.now()
        }
      });
      upsertGenerationJobRecord(task, serializeGenerationTask(task));
      enqueueGenerationTask(task);
      recovered += 1;
      recoveredIds.add(item.generationId);
    } catch (error) {
      logger.error({ err: error, generationId: item.generationId, source: item.source, filePath: item.filePath }, 'generation job recovery failed');
      await refundOrphanedGenerationJob(item.generationId, error).catch((refundError) => {
        logger.error({ err: refundError, generationId: item.generationId }, 'generation job recovery refund failed');
      });
    }
  }
  if (recovered) logger.warn({ recovered }, 'pending generation jobs recovered');
  return recovered;
}

async function listPersistedGenerationJobIds() {
  await fs.mkdir(generationJobDir, { recursive: true });
  const entries = await fs.readdir(generationJobDir).catch(() => []);
  const fileIds = entries
    .filter((name) => /^[a-zA-Z0-9_-]{8,80}\.json$/.test(name))
    .map((name) => name.replace(/\.json$/, ''));
  const ids = [...new Set([...fileIds, ...listSqliteGenerationJobIds()])];
  persistedGenerationJobCount = ids.length;
  return ids;
}

function generationJobIdsProtectedFromStaleSweep() {
  if (generationWorkersDisabled) return [];
  const now = Date.now();
  const protectedIds = new Set();
  for (const [generationId, job] of generationJobs.entries()) {
    if (job?.started) protectedIds.add(String(generationId));
  }
  for (const item of listSqliteGenerationJobRecords()) {
    if (item.status === 'running' && item.leaseUntil && item.leaseUntil > now) {
      protectedIds.add(String(item.generationId));
    }
  }
  return [...protectedIds];
}

function pickHistoryImage(generation, requestedIndex) {
  const index = Math.max(0, Number.parseInt(requestedIndex || '0', 10) || 0);
  if (Array.isArray(generation.images) && generation.images.length) {
    const image = generation.images[index];
    if (!image) return null;
    return {
      imageUrl: image.imageUrl || null,
      imageBase64: image.imageBase64 || null,
      mimeType: image.mimeType || mimeByFormat[image.outputFormat || generation.outputFormat] || 'image/png'
    };
  }
  if (index === 0 && (generation.imageUrl || generation.imageBase64)) {
    return {
      imageUrl: generation.imageUrl || null,
      imageBase64: generation.imageBase64 || null,
      mimeType: generation.mimeType || mimeByFormat[generation.outputFormat] || 'image/png'
    };
  }
  return null;
}

function pickGenerationSourceImage(generation, requestedIndex) {
  const index = Math.max(0, Number.parseInt(requestedIndex || '0', 10) || 0);
  if (!Array.isArray(generation?.sourceImages) || !generation.sourceImages.length) return null;
  const image = generation.sourceImages[index];
  if (!image) return null;
  return {
    imageUrl: image.imageUrl || null,
    imageBase64: image.imageBase64 || null,
    mimeType: image.mimeType || mimeByFormat[image.outputFormat] || 'image/png',
    outputFormat: image.outputFormat || formatByMime[image.mimeType] || 'png'
  };
}

app.get('/api/health', (_req, res) => {
  const ai = aiSettings({ includeSecret: true });
  const upstreamReady = Array.isArray(ai.imageUpstreams)
    ? ai.imageUpstreams.some((item) => item.enabled && item.upstreamBaseUrl && item.upstreamApiKey && item.imageModel)
    : Boolean(ai.upstreamBaseUrl && ai.upstreamApiKey && ai.imageModel);
  const textUpstreamReady = Boolean((ai.textUpstreamBaseUrl || ai.upstreamBaseUrl) && (ai.textUpstreamApiKey || ai.upstreamApiKey));
  res.json({
    success: true,
    prices: publicPrices(),
    qualities: supportedQualities,
    imageReady: upstreamReady,
    textReady: Boolean(textUpstreamReady && ai.textModel),
    store: storeStats(),
    generationQueue: generationQueueStats()
  });
});

app.get('/api/openapi.json', (req, res) => {
  res.json({
    openapi: '3.1.0',
    info: {
      title: 'Rivermoon Image Studio API',
      version: '1.0.0',
      description: 'Image generation and image editing API. Use Bearer API Key; billing is deducted from the API key owner wallet.'
    },
    servers: [{ url: publicRequestBase(req) }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' }
      },
      schemas: {
        ImageGenerationRequest: {
          type: 'object',
          required: ['prompt'],
          properties: {
            prompt: { type: 'string', minLength: 2, maxLength: 4000 },
            quality: { type: 'string', enum: ['1k', '2k', 'standard', 'high'], default: '2k' },
            size: { type: 'string', enum: supportedSizes, default: '1024x1024' },
            output_format: { type: 'string', enum: ['jpeg', 'png', 'webp'], default: 'jpeg' },
            n: { type: 'integer', enum: [1, 2, 4], default: 1 }
          }
        },
        ImageGenerationResponse: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            object: { type: 'string', example: 'image.generation' },
            created: { type: 'integer' },
            model: { type: 'string' },
            mode: { type: 'string', enum: ['generate', 'edit'] },
            quality: { type: 'string' },
            size: { type: 'string' },
            output_format: { type: 'string' },
            count: { type: 'integer' },
            price_cents: { type: 'integer' },
            balance_cents: { type: 'integer' },
            data: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  url: { type: 'string' },
                  b64_json: { type: ['string', 'null'] },
                  mime_type: { type: 'string' },
                  output_format: { type: 'string' }
                }
              }
            }
          }
        }
      }
    },
    security: [{ bearerAuth: [] }],
    paths: {
      '/v1/images/generations': {
        post: {
          summary: 'Generate images from a prompt',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ImageGenerationRequest' }
              }
            }
          },
          responses: {
            200: {
              description: 'Image generation result',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ImageGenerationResponse' }
                }
              }
            },
            401: { description: 'Invalid API key' },
            402: { description: 'Insufficient balance' },
            429: { description: 'Rate limited or concurrent generation' }
          }
        }
      },
      '/v1/images/edits': {
        post: {
          summary: 'Edit images with one to four source images',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['prompt', 'image'],
                  properties: {
                    prompt: { type: 'string', minLength: 2, maxLength: 4000 },
                    image: {
                      type: 'array',
                      maxItems: 4,
                      items: { type: 'string', format: 'binary' }
                    },
                    mask: { type: 'string', format: 'binary' },
                    quality: { type: 'string', enum: ['1k', '2k', 'standard', 'high'], default: '2k' },
                    size: { type: 'string', enum: supportedSizes, default: '1024x1024' },
                    output_format: { type: 'string', enum: ['jpeg', 'png', 'webp'], default: 'jpeg' },
                    n: { type: 'integer', enum: [1, 2, 4], default: 1 }
                  }
                }
              }
            }
          },
          responses: {
            200: {
              description: 'Image edit result',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ImageGenerationResponse' }
                }
              }
            },
            401: { description: 'Invalid API key' },
            402: { description: 'Insufficient balance' },
            429: { description: 'Rate limited or concurrent generation' }
          }
        }
      }
    }
  });
});

app.post('/api/auth/register', authLimiter, async (req, res) => {
  try {
    const { user, session } = await registerUser(
      String(req.body.username || '').trim(),
      String(req.body.account || '').trim(),
      String(req.body.password || '')
    );
    setSessionCookie(req, res, session);
    res.json({ success: true, user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
  try {
    const account = String(req.body.account || req.body.username || '').trim();
    const { user, session } = await loginUser(account, String(req.body.password || ''));
    setSessionCookie(req, res, session);
    res.json({ success: true, user });
  } catch (error) {
    res.status(401).json({ success: false, message: error.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  await logout(req, res);
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  res.json({
    success: true,
    user: sanitizeUser(req.user),
    prices: publicPrices(),
    qualities: supportedQualities,
    sizes: supportedSizes,
    outputFormats: ['jpeg', 'png', 'webp'],
    counts: [1, 2, 4]
  });
});

app.get('/api/api-keys', requireUser, (req, res) => {
  res.json({ success: true, apiKeys: listApiKeysByUser(req.user.id) });
});

app.post('/api/api-keys', requireUser, async (req, res) => {
  try {
    const result = await createApiKey({
      userId: req.user.id,
      name: String(req.body.name || 'API Key')
    });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.delete('/api/api-keys/:id', requireUser, async (req, res) => {
  const revoked = await revokeApiKeyByUser(req.user.id, req.params.id);
  if (!revoked) return res.status(404).json({ success: false, message: 'API Key 不存在' });
  res.json({ success: true, apiKey: revoked });
});

app.get('/api/history', requireUser, (req, res) => {
  const db = snapshot();
  const status = ['all', 'pending', 'unpublished', 'published', 'failed'].includes(String(req.query.status || 'all')) ? String(req.query.status || 'all') : 'all';
  const mode = ['all', 'generate', 'edit'].includes(String(req.query.mode || 'all')) ? String(req.query.mode || 'all') : 'all';
  const requestedLimit = Number.parseInt(String(req.query.limit ?? '50'), 10);
  const limit = Math.max(0, Math.min(100, Number.isFinite(requestedLimit) ? requestedLimit : 50));
  const mine = db.generations
    .filter((item) => item.userId === req.user.id)
    .filter(historyVisibleToUser)
    .map((item) => attachPublishedPost(item, db, req));
  const filtered = mine
    .filter((item) => historyMatchesStatus(item, status))
    .filter((item) => historyMatchesMode(item, mode))
    .filter((item) => historyMatchesQuery(item, req.query.q));
  res.json({
    success: true,
    total: filtered.length,
    returned: limit ? Math.min(limit, filtered.length) : 0,
    deletableCount: historyDeletableCount(mine),
    generations: limit ? filtered.slice(0, limit) : []
  });
});

app.get('/api/history/:id/image/:index?', requireUser, async (req, res) => {
  const db = snapshot();
  const generation = db.generations.find((item) => item.id === req.params.id && item.userId === req.user.id && historyVisibleToUser(item));
  if (!generation) return res.status(404).json({ success: false, message: '历史记录不存在' });
  const image = pickHistoryImage(generation, req.params.index);
  if (!image) return res.status(404).json({ success: false, message: '历史图片不存在' });
  if (image.imageBase64) {
    const buffer = Buffer.from(image.imageBase64, 'base64');
    if (!buffer.length) return res.status(404).json({ success: false, message: '历史图片不存在' });
    res.setHeader('content-type', image.mimeType);
    res.setHeader('cache-control', 'private, max-age=86400');
    return res.send(buffer);
  }
  if (image.imageUrl) {
    return proxyImageUrl(res, image.imageUrl, {
      fallbackType: image.mimeType,
      cacheControl: 'private, max-age=86400',
      missingMessage: '历史图片不存在',
      readErrorMessage: '历史图片读取失败'
    });
  }
  return res.status(404).json({ success: false, message: '历史图片不存在' });
});

async function sendGenerationImage(req, res, generation, index, options = {}) {
  const image = pickHistoryImage(generation, index);
  if (!image) return res.status(404).json({ success: false, message: '图片不存在' });
  if (options.downloadName) setDownloadHeaders(res, safeDownloadFilename(options.downloadName, imageExtension(image)));
  const cacheControl = options.cacheControl || 'private, no-cache, max-age=0';
  const buffer = Buffer.from(image.imageBase64 || '', 'base64');
  if (buffer.length) {
    res.setHeader('content-type', image.mimeType);
    res.setHeader('cache-control', cacheControl);
    let settled = false;
    const recordSuccess = () => {
      if (settled) return;
      settled = true;
      options.onSuccess?.();
    };
    const recordAbort = () => {
      settled = true;
    };
    res.once('finish', recordSuccess);
    res.once('close', recordAbort);
    return res.send(buffer);
  }
  if (image.imageUrl) {
    return proxyImageUrl(res, image.imageUrl, {
      fallbackType: image.mimeType,
      cacheControl,
      missingMessage: '图片不存在',
      readErrorMessage: '图片读取失败',
      onSuccess: options.onSuccess
    });
  }
  return res.status(404).json({ success: false, message: '图片不存在' });
}

async function sendGenerationSourceImage(_req, res, generation, index, options = {}) {
  const image = pickGenerationSourceImage(generation, index);
  if (!image) return res.status(404).json({ success: false, message: '源图不存在' });
  const cacheControl = options.cacheControl || 'private, no-cache, max-age=0';
  const buffer = Buffer.from(image.imageBase64 || '', 'base64');
  if (buffer.length) {
    res.setHeader('content-type', image.mimeType);
    res.setHeader('cache-control', cacheControl);
    return res.send(buffer);
  }
  if (image.imageUrl) {
    return proxyImageUrl(res, image.imageUrl, {
      fallbackType: image.mimeType,
      cacheControl,
      missingMessage: '源图不存在',
      readErrorMessage: '源图读取失败'
    });
  }
  return res.status(404).json({ success: false, message: '源图不存在' });
}

app.get('/api/community/generations/:id/preview/:index?', async (req, res) => {
  const db = snapshot();
  const generation = db.generations.find((item) => item.id === req.params.id);
  if (!generation) return res.status(404).json({ success: false, message: '图片不存在' });
  const requestedIndex = Math.trunc(Number(req.params.index || 0));
  const post = db.communityPosts.find((item) => {
    if (item.generationId !== generation.id || item.status !== 'published') return false;
    return communityPostImageIndexes(item, generation).includes(requestedIndex);
  });
  if (!post) return res.status(404).json({ success: false, message: '作品未公开' });
  return sendGenerationImage(req, res, generation, req.params.index, {
    cacheControl: 'public, max-age=86400, stale-while-revalidate=604800'
  });
});

app.get('/api/community/generations/:id/source/:index?', async (req, res) => {
  const db = snapshot();
  const generation = db.generations.find((item) => item.id === req.params.id);
  if (!generation) return res.status(404).json({ success: false, message: '源图不存在' });
  const requestedIndex = Math.trunc(Number(req.params.index || 0));
  const sourceImages = generationSourceImages(generation);
  const sourceExists = sourceImages.some((image) => image.displayIndex === requestedIndex);
  if (!sourceExists) return res.status(404).json({ success: false, message: '源图不存在' });
  const post = db.communityPosts.find((item) => item.generationId === generation.id && item.status === 'published');
  if (!post) return res.status(404).json({ success: false, message: '作品未公开' });
  return sendGenerationSourceImage(req, res, generation, req.params.index, {
    cacheControl: 'public, max-age=86400, stale-while-revalidate=604800'
  });
});

app.get('/api/community/posts', (req, res) => {
  const db = snapshot();
  const query = String(req.query.q || '').trim().toLowerCase();
  const tag = String(req.query.tag || '').trim();
  const sort = String(req.query.sort || 'hot') === 'latest' ? 'latest' : 'hot';
  const scope = String(req.query.scope || 'all') === 'mine' ? 'mine' : 'all';
  const discoveryInput = String(req.query.discovery || 'all').trim();
  const discovery = ['uncommented', 'commented', 'reusable', 'downloaded', 'new', 'liked'].includes(discoveryInput)
    ? discoveryInput
    : 'all';
  if (scope === 'mine' && !req.user) return res.status(401).json({ success: false, message: '请先登录' });
  if (discovery === 'liked' && !req.user) return res.status(401).json({ success: false, message: '请先登录后查看点赞过的作品' });
  const matchedPosts = db.communityPosts
    .filter((post) => post.status === 'published')
    .filter((post) => scope !== 'mine' || post.userId === req.user.id)
    .filter((post) => {
      if (tag && !(post.tags || []).includes(tag)) return false;
      if (!query) return true;
      return [post.title, post.description, post.username, (post.tags || []).join(' ')].join(' ').toLowerCase().includes(query);
    })
    .map((post) => communityPostSummary(post, req, { db }))
    .filter((post) => communityPostMatchesDiscovery(post, discovery))
    .sort((a, b) => sort === 'latest'
      ? b.createdAt - a.createdAt
      : b.hotScore - a.hotScore || b.createdAt - a.createdAt);
  const defaultLimit = scope === 'mine' ? 80 : 24;
  const maxLimit = scope === 'mine' ? 200 : 80;
  const requestedLimit = Number.parseInt(String(req.query.limit ?? defaultLimit), 10);
  const limit = Math.max(1, Math.min(maxLimit, Number.isFinite(requestedLimit) ? requestedLimit : defaultLimit));
  const posts = matchedPosts.slice(0, limit);
  const tagCounts = new Map();
  matchedPosts.forEach((post) => {
    new Set((post.tags || []).filter(Boolean)).forEach((item) => {
      tagCounts.set(item, (tagCounts.get(item) || 0) + 1);
    });
  });
  const tags = Array.from(tagCounts.entries())
    .map(([item, count]) => ({ tag: item, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hans-CN'))
    .slice(0, 80);
  res.json({ success: true, count: posts.length, total: matchedPosts.length, returned: posts.length, sort, scope, discovery, tags, posts });
});

app.get('/api/community/tags', (req, res) => {
  const db = snapshot();
  const scope = String(req.query.scope || 'all') === 'mine' ? 'mine' : 'all';
  if (scope === 'mine' && !req.user) return res.status(401).json({ success: false, message: '请先登录' });
  const counts = new Map();
  db.communityPosts
    .filter((post) => post.status === 'published')
    .filter((post) => scope !== 'mine' || post.userId === req.user.id)
    .forEach((post) => {
      new Set((post.tags || []).filter(Boolean)).forEach((tag) => {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      });
    });
  const tags = Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'zh-Hans-CN'))
    .slice(0, 80);
  res.json({ success: true, scope, tags });
});

app.get('/api/community/studio-templates', (req, res) => {
  res.setHeader('cache-control', 'no-store');
  res.json({
    success: true,
    templates: studioTemplateSummaries(req)
  });
});

app.get('/api/community/creator/feedback', requireUser, (req, res) => {
  const db = snapshot();
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(req.query.limit || 50)) || 50));
  const postId = String(req.query.postId || '').trim();
  const feedback = creatorFeedbackSummary(req, db, { postId });
  res.json({
    success: true,
    counts: feedback.counts,
    totals: feedback.totals,
    items: feedback.items.slice(0, limit)
  });
});

app.get('/api/community/posts/:id', (req, res) => {
  const db = snapshot();
  const post = db.communityPosts.find((item) => item.id === req.params.id && item.status === 'published');
  if (!post) return res.status(404).json({ success: false, message: '作品不存在' });
  res.json({ success: true, post: communityPostSummary(post, req, { db, includeComments: true }) });
});

app.post('/api/community/posts', requireUser, communityWriteLimiter, async (req, res) => {
  try {
    const post = await createCommunityPost({
      userId: req.user.id,
      generationId: String(req.body.generationId || ''),
      imageIndex: Number(req.body.imageIndex || 0),
      imageIndexes: req.body.imageIndexes,
      title: String(req.body.title || ''),
      description: String(req.body.description || ''),
      tags: req.body.tags
    });
    const db = snapshot();
    const publishedPost = db.communityPosts.find((item) => item.id === post.id);
    res.json({ success: true, post: communityPostSummary(publishedPost || post, req, { db }) });
  } catch (error) {
    if (error.existingPostId) {
      const db = snapshot();
      const post = db.communityPosts.find((item) => item.id === error.existingPostId && item.status === 'published');
      return res.status(409).json({
        success: false,
        code: 'already_published',
        message: error.message,
        post: post ? communityPostSummary(post, req, { db, includeComments: true }) : null
      });
    }
    res.status(400).json({ success: false, message: error.message });
  }
});

app.patch('/api/community/posts/:id', requireUser, communityWriteLimiter, async (req, res) => {
  try {
    const post = await updateCommunityPost({
      postId: req.params.id,
      userId: req.user.id,
      title: String(req.body.title || ''),
      description: String(req.body.description || ''),
      tags: req.body.tags
    });
    const db = snapshot();
    const updatedPost = db.communityPosts.find((item) => item.id === post.id && item.status === 'published');
    res.json({ success: true, post: communityPostSummary(updatedPost || post, req, { db, includeComments: true }) });
  } catch (error) {
    const status = error.message.includes('权限') ? 403 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
});

app.post('/api/community/posts/:id/comments', requireUser, communityWriteLimiter, async (req, res) => {
  try {
    const comment = await createCommunityComment({
      postId: req.params.id,
      userId: req.user.id,
      body: String(req.body.body || ''),
      parentCommentId: req.body.parentCommentId ? String(req.body.parentCommentId) : null
    });
    const db = snapshot();
    const post = db.communityPosts.find((item) => item.id === req.params.id && item.status === 'published');
    res.json({
      success: true,
      comment: post ? communityCommentSummary(comment, post, req, { db }) : null,
      post: post ? communityPostSummary(post, req, { db, includeComments: true }) : null
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/community/posts/:id/comments/:commentId/report', requireUser, communityWriteLimiter, async (req, res) => {
  try {
    await reportCommunityComment({
      postId: req.params.id,
      commentId: req.params.commentId,
      userId: req.user.id,
      reason: String(req.body.reason || '')
    });
    const db = snapshot();
    const post = db.communityPosts.find((item) => item.id === req.params.id && item.status === 'published');
    res.json({ success: true, post: post ? communityPostSummary(post, req, { db, includeComments: true }) : null });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/community/posts/:id/comments/:commentId/reports/resolve', requireUser, communityWriteLimiter, async (req, res) => {
  try {
    const result = await resolveCommunityCommentReports({
      postId: req.params.id,
      commentId: req.params.commentId,
      userId: req.user.id
    });
    const db = snapshot();
    const post = db.communityPosts.find((item) => item.id === req.params.id && item.status === 'published');
    res.json({
      success: true,
      resolvedCount: result.resolvedCount,
      post: post ? communityPostSummary(post, req, { db, includeComments: true }) : null
    });
  } catch (error) {
    const status = error.message.includes('权限') ? 403 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
});

app.post('/api/community/posts/:id/comments/:commentId/feedback/handled', requireUser, communityWriteLimiter, async (req, res) => {
  try {
    const result = await setCommunityFeedbackHandled({
      postId: req.params.id,
      commentId: req.params.commentId,
      userId: req.user.id,
      handled: req.body.handled !== false
    });
    const db = snapshot();
    const post = db.communityPosts.find((item) => item.id === req.params.id && item.status === 'published');
    res.json({
      success: true,
      handled: result.handled,
      post: post ? communityPostSummary(post, req, { db, includeComments: true }) : null
    });
  } catch (error) {
    const status = error.message.includes('权限') ? 403 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
});

app.delete('/api/community/posts/:id/comments/:commentId', requireUser, communityWriteLimiter, async (req, res) => {
  try {
    await deleteCommunityComment({
      postId: req.params.id,
      commentId: req.params.commentId,
      userId: req.user.id
    });
    const db = snapshot();
    const post = db.communityPosts.find((item) => item.id === req.params.id && item.status === 'published');
    res.json({ success: true, post: post ? communityPostSummary(post, req, { db, includeComments: true }) : null });
  } catch (error) {
    const status = error.message.includes('权限') ? 403 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
});

app.post('/api/community/posts/:id/comments/:commentId/pin', requireUser, communityWriteLimiter, async (req, res) => {
  try {
    await pinCommunityComment({
      postId: req.params.id,
      commentId: req.params.commentId,
      userId: req.user.id
    });
    const db = snapshot();
    const post = db.communityPosts.find((item) => item.id === req.params.id && item.status === 'published');
    res.json({ success: true, post: post ? communityPostSummary(post, req, { db, includeComments: true }) : null });
  } catch (error) {
    const status = error.message.includes('权限') ? 403 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
});

app.delete('/api/community/posts/:id/comments/pin', requireUser, communityWriteLimiter, async (req, res) => {
  try {
    await unpinCommunityComment({
      postId: req.params.id,
      userId: req.user.id
    });
    const db = snapshot();
    const post = db.communityPosts.find((item) => item.id === req.params.id && item.status === 'published');
    res.json({ success: true, post: post ? communityPostSummary(post, req, { db, includeComments: true }) : null });
  } catch (error) {
    const status = error.message.includes('权限') ? 403 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
});

app.delete('/api/community/posts/:id', requireUser, communityWriteLimiter, async (req, res) => {
  try {
    const post = await deleteCommunityPost({
      postId: req.params.id,
      userId: req.user.id
    });
    res.json({ success: true, deleted: { id: post.id, generationId: post.generationId } });
  } catch (error) {
    const status = error.message.includes('权限') ? 403 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
});

app.post('/api/community/posts/:id/like', requireUser, communityWriteLimiter, async (req, res) => {
  try {
    const result = await toggleCommunityLike({
      postId: req.params.id,
      userId: req.user.id
    });
    const db = snapshot();
    const post = db.communityPosts.find((item) => item.id === req.params.id && item.status === 'published');
    const includeComments = String(req.body.includeComments || '') === 'true';
    res.json({ success: true, ...result, post: post ? communityPostSummary(post, req, { db, includeComments }) : null });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/community/posts/:id/reuse', communityReuseLimiter, async (req, res) => {
  try {
    req.communityReuseId = ensureCommunityReuseId(req, res);
    const result = await recordCommunityReuse({
      postId: req.params.id,
      userId: req.user?.id || null,
      anonymousId: req.user ? '' : req.communityReuseId
    });
    const db = snapshot();
    const post = db.communityPosts.find((item) => item.id === req.params.id && item.status === 'published');
    res.setHeader('cache-control', 'no-store');
    res.json({ success: true, ...result, post: post ? communityPostSummary(post, req, { db }) : null });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.get('/api/community/posts/:id/reuse-params', requireUser, communityReuseLimiter, async (req, res) => {
  try {
    const db = snapshot();
    const post = db.communityPosts.find((item) => item.id === req.params.id && item.status === 'published');
    if (!post) return res.status(404).json({ success: false, message: '作品不存在' });
    res.setHeader('cache-control', 'no-store');
    res.json({
      success: true,
      post: communityPostSummary(post, req, { db, includePrompt: true }),
      reuseIntentToken: createCommunityReuseIntent(post.id, req.user.id)
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/community/posts/:id/tip', requireUser, communityTipLimiter, async (req, res) => {
  try {
    const tip = await tipCommunityPost({
      postId: req.params.id,
      userId: req.user.id,
      amountCents: Number(req.body.amountCents || 0)
    });
    const db = snapshot();
    const post = db.communityPosts.find((item) => item.id === req.params.id && item.status === 'published');
    res.json({
      success: true,
      amountCents: tip.amountCents,
      user: sanitizeUser(findUserById(req.user.id)),
      post: post ? communityPostSummary(post, req, { db, includeComments: true, includeSupport: true }) : null
    });
  } catch (error) {
    const status = error.message.includes('余额不足') ? 402 : 400;
    res.status(status).json({ success: false, message: error.message });
  }
});

app.get('/api/community/posts/:id/download/:index?', communityDownloadLimiter, async (req, res) => {
  const db = snapshot();
  const post = db.communityPosts.find((item) => item.id === req.params.id && item.status === 'published');
  if (!post) return res.status(404).json({ success: false, message: '作品不存在' });
  const generation = findGenerationById(post.generationId);
  if (!generation) return res.status(404).json({ success: false, message: '图片不存在' });
  const imageIndex = resolveCommunityDownloadIndex(post, generation, req.params.index);
  if (imageIndex === null) return res.status(404).json({ success: false, message: '图片不存在' });
  req.communityDownloadId = ensureCommunityDownloadId(req, res);
  const recordDownload = () => {
    recordCommunityDownload({
      postId: post.id,
      userId: req.user?.id || null,
      anonymousId: req.user ? '' : req.communityDownloadId,
      imageIndex
    }).catch((error) => {
      req.log?.warn({ err: error, postId: post.id }, 'community download record failed');
    });
  };
  return sendGenerationImage(req, res, generation, imageIndex, { downloadName: post.title, onSuccess: recordDownload });
});

app.get('/api/history/:id', requireUser, (req, res) => {
  const db = snapshot();
  const generation = db.generations.find((item) => item.id === req.params.id && item.userId === req.user.id && historyVisibleToUser(item));
  if (!generation) return res.status(404).json({ success: false, message: '历史记录不存在' });
  res.json({ success: true, generation: attachPublishedPost(generation, db, req) });
});

app.delete('/api/history/:id', requireUser, async (req, res) => {
  try {
    const deleted = await deleteGenerationByUser(req.user.id, req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: '历史记录不存在' });
    res.json({ success: true, deleted });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/optimize-prompt', requireUser, aiLimiter, async (req, res) => {
  const prompt = String(req.body.prompt || '').trim();
  const mode = req.body.mode === 'edit' ? 'edit' : 'generate';

  if (prompt.length < 2) return res.status(400).json({ success: false, message: '请输入需要优化的提示词' });
  if (prompt.length > 1000) return res.status(400).json({ success: false, message: '提示词最多 1000 字' });

  try {
    const optimizedPrompt = await optimizePrompt({ prompt, mode });
    res.json({ success: true, optimizedPrompt });
  } catch (error) {
    res.status(502).json({ success: false, message: publicOptimizeError(error.message) });
  }
});

app.post('/api/chat', requireUser, aiLimiter, async (req, res) => {
  const message = String(req.body.message || '').trim();
  const ai = aiSettings();
  const requestedModel = String(req.body.model || ai.textModel || '').trim();
  const allowedTextModels = new Set([ai.textModel, ...(config.allowedTextModels || [])].filter(Boolean));
  const reasoningEffort = ['low', 'medium', 'high'].includes(req.body.reasoningEffort) ? req.body.reasoningEffort : 'medium';
  const images = Array.isArray(req.body.images) ? req.body.images.slice(0, 4) : [];
  if (message.length < 2 && !images.length) return res.status(400).json({ success: false, message: '请输入对话内容' });
  if (message.length > 2000) return res.status(400).json({ success: false, message: '对话内容最多 2000 字' });
  if (requestedModel.length > 80 || !/^[a-zA-Z0-9._:-]+$/.test(requestedModel) || !allowedTextModels.has(requestedModel)) {
    return res.status(400).json({ success: false, message: '文本模型名称无效' });
  }

  try {
    const reply = await chatText({ message, model: requestedModel, reasoningEffort, images });
    res.json({ success: true, message: reply });
  } catch (error) {
    res.status(502).json({ success: false, message: publicOptimizeError(error.message) });
  }
});

async function handleWebGenerate(req, res) {
  try {
    const reusePostId = String(req.body.reusePostId || '');
    if (reusePostId && !verifyCommunityReuseIntent(req.body.reuseIntentToken, { postId: reusePostId, userId: req.user.id })) {
      return res.status(400).json({ success: false, message: '参考参数已过期，请重新从交流区点击参考创作。' });
    }
    if (reusePostId && !findPublishedCommunityPost(reusePostId)) {
      return res.status(400).json({ success: false, message: '参考来源作品已下架，请作为普通生成继续。' });
    }
    const asyncMode = req.query.async === '1' || req.body.async === true || req.body.async === '1';
    if (asyncMode) {
      if (generationWorkersDisabled) {
        return res.status(503).json({ success: false, message: '后台生图队列暂时关闭，本次未扣费，请稍后重试。' });
      }
      const capacityError = await ensureGenerationCapacity(req.user.id);
      if (capacityError) return res.status(429).json(capacityError);
      const task = await prepareGenerationTask({ user: req.user, body: req.body, source: 'web' });
      try {
        if (reusePostId) {
          await updateGeneration(task.generation.id, { reuseSourcePostId: reusePostId });
          task.generation.reuseSourcePostId = reusePostId;
        }
        await saveGenerationJob(task);
        enqueueGenerationTask(task);
      } catch (queueError) {
        await failPreparedGenerationTask(task, queueError, {
          reason: '生成任务入队失败，已自动退款',
          metadata: { queueFailure: true }
        });
        throw queueError;
      }
      return res.status(202).json({
        success: true,
        queued: true,
        generation: generationSummary(task.generation),
        user: sanitizeUser(findUserById(req.user.id)),
        queue: generationQueueStats()
      });
    }
    const updated = await runGenerationTask({ user: req.user, body: req.body, source: 'web' });
    let reusePost = null;
    if (reusePostId) {
      try {
        req.communityReuseId = ensureCommunityReuseId(req, res);
        await recordCommunityReuse({
          postId: reusePostId,
          userId: req.user?.id || null,
          anonymousId: req.user ? '' : req.communityReuseId
        });
        await updateGeneration(updated.id, { reuseSourcePostId: reusePostId });
        updated.reuseSourcePostId = reusePostId;
        const db = snapshot();
        const post = db.communityPosts.find((item) => item.id === reusePostId && item.status === 'published');
        reusePost = post ? communityPostSummary(post, req, { db }) : null;
      } catch (reuseError) {
        req.log?.warn({ err: reuseError, postId: reusePostId }, 'community reuse record failed after generation');
      }
    }
    res.json({ success: true, generation: generationSummary(updated), user: sanitizeUser(findUserById(req.user.id)), reusePost });
  } catch (error) {
    const message = error.message || '生成失败';
    const statusCode = generationErrorStatus(message);
    res.status(statusCode).json({
      success: false,
      message: publicGenerationError(message),
      generation: error.generation ? generationSummary(error.generation) : null,
      user: sanitizeUser(findUserById(req.user.id))
    });
  }
}

app.get('/api/generate/:id', requireUser, (req, res) => {
  const generation = refreshGenerationFromDurableStore(req.params.id);
  if (!generation || generation.userId !== req.user.id || !historyVisibleToUser(generation)) {
    return res.status(404).json({ success: false, message: '生成任务不存在' });
  }
  res.json({
    success: true,
    generation: generationSummary(generation),
    user: sanitizeUser(findUserById(req.user.id)),
    queue: generationQueueStats()
  });
});

const generateUpload = upload.fields([
  { name: 'images', maxCount: 4 },
  { name: 'image', maxCount: 4 },
  { name: 'mask', maxCount: 1 }
]);

app.post('/api/generate', requireUser, aiLimiter, (req, res, next) => {
  if (!String(req.headers['content-type'] || '').toLowerCase().includes('multipart/form-data')) {
    return handleWebGenerate(req, res);
  }
  return generateUpload(req, res, (error) => {
    if (error) return handleUploadError(error, req, res, next);
    try {
      const imageFiles = [
        ...(Array.isArray(req.files?.images) ? req.files.images : []),
        ...(Array.isArray(req.files?.image) ? req.files.image : [])
      ];
      const maskFile = Array.isArray(req.files?.mask) && req.files.mask[0] ? req.files.mask[0] : null;
      req.body ||= {};
      req.body.imageDataUrls = uploadedFilesToDataUrls(imageFiles);
      req.body.imageDataUrl = req.body.imageDataUrls[0] || '';
      if (maskFile) req.body.maskDataUrl = uploadedFileToDataUrl(maskFile);
    } catch (uploadError) {
      return res.status(400).json({ success: false, message: uploadError.message });
    }
    return handleWebGenerate(req, res);
  });
});

app.post('/v1/images/generations', requireApiUser, aiLimiter, async (req, res) => {
  try {
    const updated = await runGenerationTask({
      user: req.apiUser,
      body: { ...req.body, mode: 'generate' },
      source: 'api'
    });
    res.json(openAiGenerationSummary(req, updated));
  } catch (error) {
    const statusCode = generationErrorStatus(error.message, 400);
    apiError(res, statusCode, publicGenerationError(error.message));
  }
});

app.post('/v1/images/edits', requireApiUser, aiLimiter, upload.fields([
  { name: 'image', maxCount: 4 },
  { name: 'mask', maxCount: 1 }
]), async (req, res) => {
  try {
    const images = Array.isArray(req.files?.image) ? req.files.image.map(fileToDataUrl) : [];
    const mask = Array.isArray(req.files?.mask) && req.files.mask[0] ? fileToDataUrl(req.files.mask[0]) : '';
    const updated = await runGenerationTask({
      user: req.apiUser,
      body: { ...req.body, mode: 'edit' },
      source: 'api',
      imageDataUrls: images,
      maskDataUrl: mask
    });
    res.json(openAiGenerationSummary(req, updated));
  } catch (error) {
    const statusCode = generationErrorStatus(error.message, 400);
    apiError(res, statusCode, publicGenerationError(error.message));
  }
});

app.delete('/api/history', requireUser, async (req, res) => {
  const deleted = await deleteGenerationsByUser(req.user.id);
  res.json({ success: true, deleted });
});

app.post('/api/redeem', requireUser, redeemLimiter, async (req, res) => {
  try {
    const result = await redeemCode({
      userId: req.user.id,
      code: String(req.body.code || '')
    });
    res.json({
      success: true,
      amountCents: result.transaction.amountCents,
      user: sanitizeUser(findUserById(req.user.id))
    });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.get('/api/admin/generation-logs', requireUser, requireAdmin, (req, res) => {
  const db = snapshot();
  const page = Math.max(1, Math.trunc(Number(req.query.page || 1)) || 1);
  const limit = Math.max(10, Math.min(100, Math.trunc(Number(req.query.limit || 50)) || 50));
  const status = ['pending', 'succeeded', 'failed'].includes(String(req.query.status || '')) ? String(req.query.status) : 'all';
  const mode = ['generate', 'edit'].includes(String(req.query.mode || '')) ? String(req.query.mode) : 'all';
  const source = ['web', 'api'].includes(String(req.query.source || '')) ? String(req.query.source) : 'all';
  const userId = String(req.query.userId || '').trim();
  const q = String(req.query.q || '').trim().toLowerCase();
  const from = req.query.from ? Date.parse(String(req.query.from)) : 0;
  const to = req.query.to ? Date.parse(String(req.query.to)) : 0;
  const logs = db.generations
    .map((generation) => adminGenerationLogSummary(generation, db))
    .filter((log) => status === 'all' || log.status === status)
    .filter((log) => mode === 'all' || log.mode === mode)
    .filter((log) => source === 'all' || log.source === source)
    .filter((log) => !userId || log.userId === userId)
    .filter((log) => !Number.isFinite(from) || !from || Number(log.createdAt || 0) >= from)
    .filter((log) => !Number.isFinite(to) || !to || Number(log.createdAt || 0) <= to)
    .filter((log) => {
      if (!q) return true;
      return [
        log.id,
        log.username,
        log.account,
        log.promptPreview,
        log.model,
        log.upstreamName,
        log.errorPreview
      ].some((value) => String(value || '').toLowerCase().includes(q));
    })
    .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  const stats = logs.reduce((acc, log) => {
    acc.total += 1;
    acc[log.status] = Number(acc[log.status] || 0) + 1;
    acc.imageCount += Number(log.imageCount || 0);
    acc.chargedCents += Number(log.consumeAmountCents || 0);
    acc.refundedCents += Number(log.refundAmountCents || 0);
    return acc;
  }, { total: 0, pending: 0, succeeded: 0, failed: 0, imageCount: 0, chargedCents: 0, refundedCents: 0 });
  stats.netCents = stats.chargedCents - stats.refundedCents;
  const offset = (page - 1) * limit;
  res.json({
    success: true,
    page,
    limit,
    total: logs.length,
    stats,
    logs: logs.slice(offset, offset + limit)
  });
});

app.get('/api/admin/overview', requireUser, requireAdmin, (req, res) => {
  const db = snapshot();
  const recentComments = db.communityComments
    .filter((comment) => comment.status === 'published')
    .map((comment) => {
      const post = db.communityPosts.find((item) => item.id === comment.postId);
      const reportCount = db.communityCommentReports.filter((report) => report.commentId === comment.id && report.status === 'active').length;
      const latestReport = db.communityCommentReports
        .filter((report) => report.commentId === comment.id && report.status === 'active')
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      return {
        id: comment.id,
        postId: comment.postId,
        postTitle: post?.title || '作品已下架',
        username: comment.username,
        body: comment.body,
        createdAt: comment.createdAt,
        isAuthor: post ? comment.userId === post.userId : false,
        reportCount,
        latestReportAt: latestReport?.createdAt || null
      };
    })
    .sort((a, b) => (b.reportCount - a.reportCount) || Number(b.latestReportAt || b.createdAt || 0) - Number(a.latestReportAt || a.createdAt || 0))
    .slice(0, 20);
  const communityPosts = db.communityPosts
    .filter((post) => post.status === 'published')
    .map((post) => communityPostSummary(post, req, { db }))
    .sort((a, b) => b.hotScore - a.hotScore || b.createdAt - a.createdAt)
    .slice(0, 20)
    .map(adminCommunityPostSummary);
  res.json({
    success: true,
    users: db.users.map(sanitizeUser),
    redeemCodes: db.redeemCodes.slice(0, 80).map((item) => adminRedeemCodeSummary(item, db)),
    redeemStats: adminRedeemFullStats(db),
    transactions: db.transactions.slice(-100).reverse().map(adminTransactionSummary),
    generations: db.generations.slice(0, 100).map(generationSummary),
    billing: billingSettings(),
    ai: aiSettings(),
    store: storeStats(),
    generationQueue: generationQueueStats(),
    communityPosts,
    communityComments: recentComments
  });
});

app.get('/api/admin/redeem-codes', requireUser, requireAdmin, (req, res) => {
  const db = snapshot();
  const page = Math.max(1, Math.trunc(Number(req.query.page || 1)) || 1);
  const limit = Math.max(20, Math.min(500, Math.trunc(Number(req.query.limit || 100)) || 100));
  const status = ['active', 'used', 'revoked'].includes(String(req.query.status || '')) ? String(req.query.status) : 'all';
  const q = String(req.query.q || '').trim();
  const codes = adminRedeemCodeList(db, { status, q });
  const allStats = adminRedeemStats(adminRedeemCodeList(db));
  const stats = adminRedeemStats(codes);
  const offset = (page - 1) * limit;
  res.json({
    success: true,
    page,
    limit,
    total: codes.length,
    stats,
    allStats,
    redeemCodes: codes.slice(offset, offset + limit)
  });
});

app.get('/api/admin/redeem-codes/export', requireUser, requireAdmin, (req, res) => {
  const db = snapshot();
  const ids = parseRedeemIds(req.query.ids);
  const status = ['active', 'used', 'revoked'].includes(String(req.query.status || '')) ? String(req.query.status) : 'all';
  const q = String(req.query.q || '').trim();
  const codes = adminRedeemCodeList(db, {
    status,
    q,
    ids: ids.size ? ids : null
  });
  setDownloadHeaders(res, safeDownloadFilename(ids.size ? 'selected-redeem-codes' : 'redeem-codes', 'csv'));
  res.type('text/csv; charset=utf-8').send(redeemCodesCsv(codes));
});

app.put('/api/admin/ai-settings', requireUser, requireAdmin, async (req, res) => {
  try {
    const settings = await updateAiSettings({
      settings: {
        imageUpstreams: req.body?.imageUpstreams,
        upstreamBaseUrl: req.body?.upstreamBaseUrl,
        upstreamApiKey: req.body?.upstreamApiKey,
        imageModel: req.body?.imageModel,
        textUpstreamBaseUrl: req.body?.textUpstreamBaseUrl,
        textUpstreamApiKey: req.body?.textUpstreamApiKey,
        textModel: req.body?.textModel
      },
      operatorId: req.user.id
    });
    res.json({ success: true, ai: settings });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.put('/api/admin/billing', requireUser, requireAdmin, async (req, res) => {
  try {
    const settings = await updateBillingPrices({
      prices: {
        '1k': money(Number(req.body?.prices?.['1k'] ?? req.body?.price1kCents)),
        '2k': money(Number(req.body?.prices?.['2k'] ?? req.body?.price2kCents))
      },
      operatorId: req.user.id
    });
    res.json({ success: true, billing: settings, prices: publicPrices() });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/topup', requireUser, requireAdmin, async (req, res) => {
  try {
    const userId = String(req.body.userId || '');
    const amountCents = amountUnitToCents(req.body.amountSingularity, req.body.amountYuan);
    const tx = await addBalance({
      userId,
      amountCents,
      operatorId: req.user.id,
      reason: String(req.body.reason || '管理员加余额')
    });
    res.json({ success: true, transaction: tx, user: sanitizeUser(findUserById(userId)) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/redeem-codes', requireUser, requireAdmin, async (req, res) => {
  try {
    const amountCents = amountUnitToCents(req.body.amountSingularity, req.body.amountYuan);
    const quantity = Math.trunc(Number(req.body.quantity || 1));
    if (quantity > 1) {
      const items = await createRedeemCodesBatch({
        amountCents,
        quantity,
        operatorId: req.user.id
      });
      return res.json({ success: true, redeemCodes: items });
    }
    const item = await createRedeemCode({
      code: String(req.body.code || ''),
      amountCents,
      operatorId: req.user.id
    });
    res.json({ success: true, redeemCode: item });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/redeem-codes/revoke-batch', requireUser, requireAdmin, async (req, res) => {
  try {
    const items = await revokeRedeemCodesBatch({
      codeIds: req.body.codeIds,
      operatorId: req.user.id
    });
    res.json({ success: true, count: items.length });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.delete('/api/admin/redeem-codes/:id', requireUser, requireAdmin, async (req, res) => {
  try {
    const item = await revokeRedeemCode({ codeId: String(req.params.id || ''), operatorId: req.user.id });
    res.json({ success: true, redeemCode: adminRedeemCodeSummary(item, snapshot()) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/users', requireUser, requireAdmin, async (req, res) => {
  try {
    const user = await adminCreateUser({
      username: String(req.body.username || ''),
      account: String(req.body.account || ''),
      password: String(req.body.password || ''),
      balanceCents: amountUnitToCents(req.body.balanceSingularity, req.body.balanceYuan),
      operatorId: req.user.id
    });
    res.json({ success: true, user: sanitizeUser(user) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.patch('/api/admin/users/:id/status', requireUser, requireAdmin, async (req, res) => {
  try {
    const user = await adminUpdateUserStatus({
      userId: String(req.params.id || ''),
      status: String(req.body.status || ''),
      operatorId: req.user.id
    });
    res.json({ success: true, user: sanitizeUser(user) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.post('/api/admin/users/:id/reset-password', requireUser, requireAdmin, async (req, res) => {
  try {
    const user = await adminResetUserPassword({
      userId: String(req.params.id || ''),
      password: String(req.body.password || ''),
      operatorId: req.user.id
    });
    res.json({ success: true, user: sanitizeUser(user) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.delete('/api/admin/users/:id', requireUser, requireAdmin, async (req, res) => {
  try {
    const user = await adminDeleteUser({
      userId: String(req.params.id || ''),
      operatorId: req.user.id
    });
    res.json({ success: true, user: sanitizeUser(user) });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

app.get('/', (_req, res) => {
  res.setHeader('cache-control', 'no-store');
  res.sendFile(homeHtmlPath);
});

app.get(['/image', '/image/history', '/image/workspace', '/prompts', '/api-docs', '/developers', '/agent', '/settings', '/admin'], (req, res) => {
  res.setHeader('cache-control', 'no-store');
  sendIndexHtml(req, res).catch((error) => {
    req.log?.error({ err: error }, 'index html render failed');
    res.sendFile(indexHtmlPath);
  });
});

await initStore({ recoverPending: false });
initGenerationJobStore();
await recoverGenerationJobs();
await recoverRestartPendingGenerations({ skipGenerationIds: await listPersistedGenerationJobIds() });

const stalePendingGenerationMaxAgeMs = 1000 * 60 * 35;
const stalePendingEditGenerationMaxAgeMs = 1000 * 60 * 7;
const stalePendingGenerationSweepMs = 1000 * 60;
const sweepStalePendingGenerations = async () => {
  try {
    await listPersistedGenerationJobIds();
    const expired = await expireStalePendingGenerations({
      maxAgeMs: stalePendingGenerationMaxAgeMs,
      modeMaxAgeMs: { edit: stalePendingEditGenerationMaxAgeMs },
      skipGenerationIds: generationJobIdsProtectedFromStaleSweep()
    });
    if (expired.length) {
      await Promise.all(expired.map(async (item) => {
        generationJobs.delete(item.id);
        await deleteGenerationJob(item.id).catch((error) => {
          logger.error({ err: error, generationId: item.id }, 'stale generation job cleanup failed');
        });
      }));
      logger.warn({ expired }, 'stale pending generations expired');
    }
  } catch (error) {
    logger.error({ err: error }, 'stale pending generation sweep failed');
  }
};
setInterval(sweepStalePendingGenerations, stalePendingGenerationSweepMs).unref();
sweepStalePendingGenerations();

app.listen(config.port, () => {
  const ai = aiSettings();
  const enabledImageUpstreamCount = Array.isArray(ai.imageUpstreams)
    ? ai.imageUpstreams.filter((item) => item.enabled && item.upstreamBaseUrl && item.upstreamApiKeyConfigured && item.imageModel).length
    : 0;
  logger.info({
    port: config.port,
    upstreamBaseUrl: ai.upstreamBaseUrl,
    textUpstreamBaseUrl: ai.textUpstreamBaseUrl,
    model: ai.imageModel,
    imageUpstreams: enabledImageUpstreamCount
  }, 'standalone image studio started');
});
