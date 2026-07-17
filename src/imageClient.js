import { request } from 'undici';
import { qualityMap, sizeMap, supportedQualities, supportedSizes } from './config.js';
import { detectImageMimeType, validateImageBuffer } from './imageValidation.js';
import { aiSettings, recordImageUpstreamResult } from './store.js';

const promptOptimizeTimeout = 1000 * 25;
const imageGenerateTotalTimeout = 1000 * 60 * 4;
const imageEditTotalTimeout = 1000 * 90;
const imageEditFallbackGenerateTimeout = 1000 * 150;
const imageBodyTimeout = 1000 * 60 * 4;
const imageHeadersTimeout = 1000 * 60 * 4;
const imageBatchConcurrency = 2;
const imageTaskRetries = 2;
const imageEditTaskRetries = 0;
const imageEditFallbackRetries = 0;
const imageModelCacheTtlMs = Math.max(30 * 1000, Number(process.env.IMAGE_MODEL_CACHE_TTL_MS || 5 * 60 * 1000));
const imageModelFetchTimeoutMs = Math.max(3000, Number(process.env.IMAGE_MODEL_FETCH_TIMEOUT_MS || 8000));
const imageModelCache = new Map();

export function normalizeQuality(quality) {
  if (supportedQualities.includes(quality)) return quality;
  return '2k';
}

export function normalizeSize(size) {
  if (supportedSizes.includes(size)) return size;
  return '1024x1024';
}

export function normalizeOutputFormat(format) {
  if (['jpeg', 'png', 'webp'].includes(format)) return format;
  return 'jpeg';
}

export function normalizeOutputFormatForSize(format, size) {
  const normalizedFormat = normalizeOutputFormat(format);
  return normalizedFormat;
}

export function normalizeCount(count) {
  const value = Number(count || 1);
  if ([1, 2, 4].includes(value)) return value;
  return 1;
}

function parseDataUrl(dataUrl, filenamePrefix = 'reference') {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('请上传有效图片');
  const mimeType = match[1];
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
    throw new Error('只支持常见图片格式');
  }
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length) throw new Error('图片内容为空');
  if (buffer.length > 12 * 1024 * 1024) throw new Error('图片不能超过 12 兆');
  validateImageBuffer(buffer, { mimeType, label: '图片' });
  const extension = mimeType.split('/')[1].replace('jpeg', 'jpg');
  return { buffer, mimeType, filename: `${filenamePrefix}.${extension}` };
}

function mimeForFormat(format) {
  return {
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp'
  }[normalizeOutputFormat(format)];
}

function upstreamErrorMessage(payload, text, statusCode, label = '上游') {
  const rawMessage = payload?.error?.message || payload?.message || '';
  if (rawMessage) return rawMessage;
  const rawText = String(text || '');
  const compactText = rawText.replace(/\s+/g, ' ').trim();
  const cloudflareCode = compactText.match(/error\s+code:\s*(\d{3})/i)?.[1]
    || compactText.match(/cloudflare[^<]{0,80}(\d{3})/i)?.[1];
  if (cloudflareCode) return `${label}网关返回 ${cloudflareCode}`;
  if (/^\s*</.test(rawText)) return `${label}网关返回 ${statusCode}`;
  return compactText || `上游错误 ${statusCode}`;
}

function imageMetadataFromBase64(imageBase64, requestedFormat) {
  const fallbackFormat = normalizeOutputFormat(requestedFormat);
  if (!imageBase64) {
    return { outputFormat: fallbackFormat, mimeType: mimeForFormat(fallbackFormat) };
  }
  const bytes = Buffer.from(String(imageBase64), 'base64');
  const detectedMimeType = detectImageMimeType(bytes);
  if (detectedMimeType === 'image/png') {
    return { outputFormat: 'png', mimeType: 'image/png' };
  }
  if (detectedMimeType === 'image/jpeg') {
    return { outputFormat: 'jpeg', mimeType: 'image/jpeg' };
  }
  if (detectedMimeType === 'image/webp') {
    return { outputFormat: 'webp', mimeType: 'image/webp' };
  }
  throw new Error('上游返回了无效图片');
}

async function parseUpstreamResponse(response, outputFormat = 'jpeg') {
  const text = await response.body.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const message = upstreamErrorMessage(payload, text, response.statusCode);
    const error = new Error(message);
    error.statusCode = response.statusCode;
    error.retryAfterMs = retryAfterMs(response.headers?.['retry-after']);
    throw error;
  }

  const images = Array.isArray(payload?.data)
    ? payload.data
      .map((item) => {
        const imageBase64 = item?.b64_json || null;
        const metadata = imageMetadataFromBase64(imageBase64, outputFormat);
        return {
          imageUrl: item?.url || null,
          imageBase64,
          outputFormat: metadata.outputFormat,
          mimeType: metadata.mimeType
        };
      })
      .filter((item) => item.imageUrl || item.imageBase64)
    : [];
  if (!images.length) throw new Error('上游未返回图片');

  return {
    upstreamStatus: response.statusCode,
    upstreamPayload: payload,
    imageUrl: images[0].imageUrl,
    imageBase64: images[0].imageBase64,
    images
  };
}

async function parseTextResponse(response) {
  const text = await response.body.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { raw: text };
  }

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const message = upstreamErrorMessage(payload, text, response.statusCode, '文本上游');
    const error = new Error(message);
    error.statusCode = response.statusCode;
    throw error;
  }

  const contentToText = (value) => {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      return value
        .map((item) => item?.text || item?.content || '')
        .filter(Boolean)
        .join('');
    }
    return '';
  };
  const responseText = Array.isArray(payload?.output)
    ? payload.output
      .flatMap((item) => Array.isArray(item.content) ? item.content : [])
      .map((item) => item.text || item.content || '')
      .join('')
    : '';
  const content = contentToText(payload?.choices?.[0]?.message?.content)
    || contentToText(payload?.choices?.[0]?.text)
    || contentToText(payload?.output_text)
    || responseText
    || '';
  const optimizedPrompt = String(content).trim().replace(/^["“]|["”]$/g, '');
  if (!optimizedPrompt) throw new Error('文本模型未返回优化结果');
  return optimizedPrompt.slice(0, 1200);
}

async function requestUpstream(url, options = {}) {
  if (options.body instanceof FormData) {
    const response = await fetch(url, {
      method: options.method || 'POST',
      headers: options.headers || {},
      body: options.body,
      signal: options.signal
    });
    const headers = {};
    response.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    return {
      statusCode: response.status,
      headers,
      body: {
        text: () => response.text()
      }
    };
  }
  return request(url, options);
}

function buildPromptOptimizerInput({ prompt, mode }) {
  const promptMode = mode === 'edit' ? '图生图' : '文生图';
  return [
    '你是专业的 AI 生图提示词优化助手。',
    '把用户的短提示词改写成适合图像生成模型的中文提示词。',
    '只输出最终提示词，不要解释，不要编号，不要 Markdown。',
    '保留用户原意，补充主体、场景、构图、光线、材质、风格、细节和负面约束。',
    '不要添加文字、商标、水印、签名、畸形肢体、低清晰度等不希望出现的元素。',
    '',
    `生成模式：${promptMode}`,
    `原始提示词：${prompt}`
  ].join('\n');
}

function baseAiSettings() {
  const settings = aiSettings({ includeSecret: true });
  const imageUpstreams = Array.isArray(settings.imageUpstreams)
    ? settings.imageUpstreams.map((item, index) => ({
      ...item,
      name: String(item.name || `生图通道 ${index + 1}`).trim(),
      upstreamBaseUrl: String(item.upstreamBaseUrl || '').replace(/\/$/, ''),
      upstreamApiKey: String(item.upstreamApiKey || '').trim(),
      imageModel: String(item.imageModel || '').trim(),
      enabled: item.enabled !== false,
      priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : (100 - index),
      weight: Math.max(1, Math.min(100, Math.trunc(Number(item.weight || 1)) || 1)),
      cooldownUntil: Math.max(0, Math.trunc(Number(item.cooldownUntil || 0)) || 0),
      failureCount: Math.max(0, Math.trunc(Number(item.failureCount || 0)) || 0),
      order: index
    }))
    : [];
  return {
    ...settings,
    imageUpstreams,
    upstreamBaseUrl: (settings.upstreamBaseUrl || '').replace(/\/$/, ''),
    textUpstreamBaseUrl: (settings.textUpstreamBaseUrl || settings.upstreamBaseUrl || '').replace(/\/$/, ''),
    textUpstreamApiKey: settings.textUpstreamApiKey || settings.upstreamApiKey
  };
}

function configuredImageUpstreams() {
  const settings = baseAiSettings();
  return settings.imageUpstreams.length
    ? settings.imageUpstreams
    : [{
      id: 'legacy',
      name: '默认生图通道',
      upstreamBaseUrl: settings.upstreamBaseUrl,
      upstreamApiKey: settings.upstreamApiKey,
      imageModel: settings.imageModel,
      enabled: true,
      priority: 100,
      weight: 1,
      cooldownUntil: 0,
      failureCount: 0,
      order: 0
    }];
}

function isModelName(value) {
  const model = String(value || '').trim();
  return Boolean(model && model.length <= 120 && /^[a-zA-Z0-9._:/@-]+$/.test(model));
}

function normalizeModelNames(models) {
  return [...new Set((Array.isArray(models) ? models : [])
    .map((item) => String(item || '').trim())
    .filter(isModelName))].slice(0, 200);
}

function modelCacheKey(upstream) {
  return String(upstream.id || upstream.upstreamBaseUrl || upstream.name || 'default');
}

function modelCacheSignature(upstream) {
  const apiKey = String(upstream.upstreamApiKey || '');
  return [
    String(upstream.upstreamBaseUrl || ''),
    apiKey ? `${apiKey.length}:${apiKey.slice(0, 8)}:${apiKey.slice(-4)}` : 'no-key'
  ].join('|');
}

function cachedModelsForUpstream(upstream, { allowExpired = true } = {}) {
  const entry = imageModelCache.get(modelCacheKey(upstream));
  if (!entry || entry.signature !== modelCacheSignature(upstream)) return [];
  if (!allowExpired && entry.expiresAt <= Date.now()) return [];
  return normalizeModelNames(entry.models);
}

function modelIdFromItem(item) {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return '';
  return item.id || item.model || item.name || item.value || '';
}

function itemLooksImageCapable(item) {
  if (!item || typeof item !== 'object') return true;
  const searchable = [
    item.type,
    item.object,
    item.modality,
    item.category,
    item.group,
    Array.isArray(item.modalities) ? item.modalities.join(',') : '',
    Array.isArray(item.capabilities) ? item.capabilities.join(',') : '',
    item.capabilities && typeof item.capabilities === 'object' ? Object.keys(item.capabilities).join(',') : ''
  ].filter(Boolean).join(' ').toLowerCase();
  if (!searchable) return true;
  if (/image|vision|multimodal|图片|生图|绘图/.test(searchable)) return true;
  if (/chat|text|embedding|audio|speech|rerank/.test(searchable)) return false;
  return true;
}

function extractModelNames(payload) {
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
        ? payload.models
        : Array.isArray(payload?.items)
          ? payload.items
          : [];
  return normalizeModelNames(list
    .filter(itemLooksImageCapable)
    .map(modelIdFromItem));
}

async function fetchModelsFromEndpoint(upstream, path) {
  const response = await requestUpstream(`${upstream.upstreamBaseUrl}${path}`, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${upstream.upstreamApiKey}`
    },
    bodyTimeout: imageModelFetchTimeoutMs,
    headersTimeout: imageModelFetchTimeoutMs
  });
  const text = await response.body.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const error = new Error(upstreamErrorMessage(payload, text, response.statusCode, '模型列表'));
    error.statusCode = response.statusCode;
    throw error;
  }
  const models = extractModelNames(payload);
  if (!models.length) throw new Error('模型列表为空');
  return models;
}

async function fetchImageModelsForUpstream(upstream, { force = false } = {}) {
  const cacheKey = modelCacheKey(upstream);
  const signature = modelCacheSignature(upstream);
  const cached = imageModelCache.get(cacheKey);
  if (!force && cached && cached.signature === signature && cached.expiresAt > Date.now()) {
    return normalizeModelNames(cached.models);
  }
  const endpoints = normalizeModelNames(String(process.env.IMAGE_MODEL_ENDPOINTS || '/v1/models,/models,/model')
    .split(',')
    .map((item) => item.trim()))
    .filter((item) => item.startsWith('/'));
  let lastError = null;
  for (const endpoint of endpoints.length ? endpoints : ['/v1/models', '/models', '/model']) {
    try {
      const models = await fetchModelsFromEndpoint(upstream, endpoint);
      imageModelCache.set(cacheKey, {
        signature,
        models,
        fetchedAt: Date.now(),
        expiresAt: Date.now() + imageModelCacheTtlMs,
        error: ''
      });
      return models;
    } catch (error) {
      lastError = error;
    }
  }
  imageModelCache.set(cacheKey, {
    signature,
    models: cached?.signature === signature ? normalizeModelNames(cached.models) : [],
    fetchedAt: cached?.fetchedAt || 0,
    expiresAt: Date.now() + Math.min(imageModelCacheTtlMs, 60 * 1000),
    error: String(lastError?.message || '模型列表读取失败').slice(0, 240)
  });
  return cached?.signature === signature ? normalizeModelNames(cached.models) : [];
}

export function availableImageModels() {
  const models = configuredImageUpstreams()
    .filter((item) => item.enabled && item.upstreamBaseUrl && item.upstreamApiKey && item.imageModel)
    .flatMap((item) => [
      ...cachedModelsForUpstream(item),
      item.imageModel
    ]);
  return normalizeModelNames(models);
}

export async function refreshAvailableImageModels({ force = false } = {}) {
  const upstreams = configuredImageUpstreams()
    .filter((item) => item.enabled && item.upstreamBaseUrl && item.upstreamApiKey && item.imageModel);
  const fetched = await Promise.allSettled(upstreams.map((item) => fetchImageModelsForUpstream(item, { force })));
  return normalizeModelNames([
    ...fetched.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
    ...upstreams.map((item) => item.imageModel)
  ]);
}

function upstreamSupportsRequestedModel(upstream, requestedModel) {
  if (!requestedModel) return true;
  if (upstream.imageModel === requestedModel) return true;
  const cachedModels = cachedModelsForUpstream(upstream);
  return cachedModels.includes(requestedModel);
}

function currentImageUpstreams({ imageModel = '' } = {}) {
  const requestedModel = String(imageModel || '').trim();
  const configured = configuredImageUpstreams();
  const ready = configured
    .filter((item) => item.enabled && item.upstreamBaseUrl && item.upstreamApiKey && item.imageModel)
    .filter((item) => upstreamSupportsRequestedModel(item, requestedModel))
    .map((item) => ({
      ...item,
      requestImageModel: requestedModel || item.imageModel
    }));
  if (requestedModel && !ready.length) throw new Error('所选模型暂无可用通道');
  const now = Date.now();
  const available = ready.filter((item) => !item.cooldownUntil || item.cooldownUntil <= now);
  const upstreams = orderImageUpstreams(available.length ? available : ready, { cooldownFallback: !available.length });
  if (!upstreams.length) throw new Error('未配置可用的生图通道');
  return upstreams;
}

function currentTextSettings() {
  const settings = baseAiSettings();
  if (!settings.textUpstreamApiKey) throw new Error('未配置文本通道密钥');
  if (!settings.textUpstreamBaseUrl) throw new Error('未配置文本上游地址');
  return settings;
}

function abortError(message = '生成任务已取消') {
  const error = new Error(message);
  error.name = 'AbortError';
  error.code = 'GENERATION_ABORTED';
  return error;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error ? signal.reason : abortError();
}

function isAbortError(error) {
  return error?.name === 'AbortError' || error?.code === 'GENERATION_ABORTED' || error?.code === 'UND_ERR_ABORTED';
}

async function sleep(ms, signal = null) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason instanceof Error ? signal.reason : abortError());
    };
    signal?.addEventListener?.('abort', abort, { once: true });
  });
}

async function withUpstreamTimeout(label, timeoutMs, action, parentSignal = null) {
  throwIfAborted(parentSignal);
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(parentSignal.reason || abortError());
  parentSignal?.addEventListener?.('abort', abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await action(controller.signal);
  } catch (error) {
    if (parentSignal?.aborted) throw parentSignal.reason instanceof Error ? parentSignal.reason : abortError();
    if (controller.signal.aborted || error?.name === 'AbortError' || error?.code === 'UND_ERR_ABORTED') {
      const timeoutError = new Error(`${label}响应超时`);
      timeoutError.code = 'UPSTREAM_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener?.('abort', abortFromParent);
  }
}

async function runImageBatch(count, task, options = {}) {
  const runs = normalizeCount(count);
  return runImageTasks(Array.from({ length: runs }, (_item, index) => () => task(index)), options);
}

async function runImageTasks(tasks, options = {}) {
  const taskList = Array.isArray(tasks) ? tasks.filter((item) => typeof item === 'function') : [];
  const runs = taskList.length;
  const retries = Math.max(0, Math.trunc(Number(options.retries ?? imageTaskRetries)) || 0);
  const signal = options.signal || null;
  const results = [];
  const failures = [];
  let cursor = 0;
  const workerCount = Math.min(imageBatchConcurrency, runs);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < runs) {
      throwIfAborted(signal);
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await runImageTaskWithRetry(taskList[index], { retries, signal });
      } catch (error) {
        if (signal?.aborted) throw error;
        failures[index] = error;
      }
    }
  });
  await Promise.all(workers);
  const successful = results.filter(Boolean);
  const batchFailures = failures
    .map((item, index) => item ? {
      index,
      message: item.message || '生成失败',
      statusCode: item.statusCode || null,
      code: item.code || null,
      upstreamAttempts: Array.isArray(item.upstreamAttempts) ? item.upstreamAttempts : null
    } : null)
    .filter(Boolean);
  if (successful.length) {
    Object.defineProperty(successful, 'batchMeta', {
      value: {
        requestedCount: runs,
        returnedCount: successful.length,
        failedCount: Math.max(0, runs - successful.length),
        batchFailures
      },
      enumerable: false
    });
    return successful;
  }
  const error = failures.find(Boolean) || new Error('上游未返回图片');
  error.batchFailures = batchFailures;
  throw error;
}

async function runImageTaskWithRetry(task, { retries = imageTaskRetries, signal = null } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    throwIfAborted(signal);
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (!shouldRetryImageTask(error, attempt, retries)) break;
      await sleep(retryDelayMs(error, attempt), signal);
    }
  }
  throw lastError;
}

function shouldRetryImageTask(error, attempt, retries = imageTaskRetries) {
  if (attempt >= retries) return false;
  if (isAbortError(error)) return false;
  const statusCode = Number(error?.statusCode || 0);
  if ([400, 401, 403, 404, 422].includes(statusCode)) return false;
  return true;
}

function retryAfterMs(value) {
  const retryAfter = Array.isArray(value) ? value[0] : value;
  if (!retryAfter) return 0;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(30_000, seconds * 1000);
  const dateMs = Date.parse(String(retryAfter));
  if (!Number.isNaN(dateMs)) return Math.min(30_000, Math.max(0, dateMs - Date.now()));
  return 0;
}

function retryDelayMs(error, attempt) {
  const upstreamDelay = Number(error?.retryAfterMs || 0);
  if (upstreamDelay > 0) return upstreamDelay;
  const base = 800 * (2 ** attempt);
  const jitter = Math.floor(Math.random() * 320);
  return Math.min(5000, base + jitter);
}

function upstreamMetadata(upstream) {
  return {
    upstreamId: upstream.id || null,
    upstreamName: upstream.name || null,
    upstreamBaseUrl: upstream.upstreamBaseUrl || null,
    upstreamModel: upstream.requestImageModel || upstream.imageModel || null
  };
}

function orderImageUpstreams(upstreams, { cooldownFallback = false } = {}) {
  const grouped = new Map();
  upstreams.forEach((upstream) => {
    const key = Number(upstream.priority || 0);
    grouped.set(key, [...(grouped.get(key) || []), upstream]);
  });
  return [...grouped.entries()]
    .sort((a, b) => b[0] - a[0])
    .flatMap(([, group]) => {
      const ordered = weightedShuffle(group);
      return cooldownFallback
        ? ordered.sort((a, b) => (a.cooldownUntil || 0) - (b.cooldownUntil || 0))
        : ordered;
    });
}

function weightedShuffle(items) {
  const pool = items.map((item) => ({
    ...item,
    scoreWeight: Math.max(1, Number(item.weight || 1))
  }));
  const ordered = [];
  while (pool.length) {
    const total = pool.reduce((sum, item) => sum + item.scoreWeight, 0);
    let pick = Math.random() * total;
    let selectedIndex = pool.length - 1;
    for (let index = 0; index < pool.length; index += 1) {
      pick -= pool[index].scoreWeight;
      if (pick <= 0) {
        selectedIndex = index;
        break;
      }
    }
    ordered.push(pool.splice(selectedIndex, 1)[0]);
  }
  return ordered;
}

function shouldTryNextImageUpstream(error, index, upstreamCount) {
  if (index >= upstreamCount - 1) return false;
  const statusCode = Number(error?.statusCode || 0);
  if ([400, 422].includes(statusCode)) return false;
  return true;
}

function shouldRecordImageUpstreamFailure(error) {
  const statusCode = Number(error?.statusCode || 0);
  if ([400, 422].includes(statusCode)) return false;
  return true;
}

function summarizeImageUpstreamErrors(errors) {
  return errors
    .map((item) => `${item.name || '生图通道'}：${item.message || '请求失败'}`)
    .filter(Boolean)
    .join('；')
    .slice(0, 900);
}

async function requestImageWithDispatch({ label, timeoutMs, path, buildRequest, outputFormat, imageModel = '', signal = null }) {
  const upstreams = currentImageUpstreams({ imageModel });
  const errors = [];
  for (let index = 0; index < upstreams.length; index += 1) {
    throwIfAborted(signal);
    const upstream = upstreams[index];
    const startedAt = Date.now();
    try {
      const result = await withUpstreamTimeout(`${label}「${upstream.name || index + 1}」`, timeoutMs, async (signal) => {
        const requestOptions = buildRequest(upstream, signal);
        const response = await requestUpstream(`${upstream.upstreamBaseUrl}${path}`, requestOptions);
        return parseUpstreamResponse(response, outputFormat);
      }, signal);
      await recordImageUpstreamResult({ upstreamId: upstream.id, success: true }).catch(() => {});
      const attempts = [
        ...errors,
        {
          id: upstream.id || null,
          name: upstream.name || `通道 ${index + 1}`,
          statusCode: result.upstreamStatus || 200,
          code: null,
          message: '成功',
          success: true,
          durationMs: Date.now() - startedAt
        }
      ];
      return {
        ...result,
        ...upstreamMetadata(upstream),
        upstreamAttempts: attempts
      };
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) {
        throw error;
      }
      if (shouldRecordImageUpstreamFailure(error)) {
        await recordImageUpstreamResult({
          upstreamId: upstream.id,
          success: false,
          errorMessage: error?.message || '请求失败'
        }).catch(() => {});
      }
      errors.push({
        id: upstream.id || null,
        name: upstream.name || `通道 ${index + 1}`,
        statusCode: error?.statusCode || null,
        code: error?.code || null,
        message: error?.message || '请求失败',
        success: false,
        retryAfterMs: Number(error?.retryAfterMs || 0) || null,
        durationMs: Date.now() - startedAt
      });
      if (!shouldTryNextImageUpstream(error, index, upstreams.length)) {
        error.upstreamAttempts = errors;
        throw error;
      }
    }
  }
  const fallback = new Error(summarizeImageUpstreamErrors(errors) || `${label}全部通道不可用`);
  fallback.code = 'ALL_IMAGE_UPSTREAMS_FAILED';
  fallback.upstreamAttempts = errors;
  throw fallback;
}

export async function optimizePrompt({ prompt, mode }) {
  const settings = currentTextSettings();
  const input = String(prompt || '').trim();
  const optimizerInput = buildPromptOptimizerInput({ prompt: input, mode });
  const chatBody = {
    model: settings.textModel,
    temperature: 0.5,
    max_tokens: 500,
    messages: [
      {
        role: 'system',
        content: [
          '你是专业的 AI 生图提示词优化助手。',
          '把用户的短提示词改写成适合图像生成模型的中文提示词。',
          '只输出最终提示词，不要解释，不要编号，不要 Markdown。',
          '保留用户原意，补充主体、场景、构图、光线、材质、风格、细节和负面约束。',
          '不要添加文字、商标、水印、签名、畸形肢体、低清晰度等不希望出现的元素。'
        ].join('\n')
      },
      {
        role: 'user',
        content: optimizerInput
      }
    ]
  };

  let lastError = null;
  try {
    const response = await request(`${settings.textUpstreamBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${settings.textUpstreamApiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(chatBody),
      bodyTimeout: promptOptimizeTimeout,
      headersTimeout: promptOptimizeTimeout
    });

    return parseTextResponse(response);
  } catch (error) {
    lastError = error;
    if (error?.statusCode === 401 || error?.statusCode === 403) throw error;
  }

  const responsesBody = {
    model: settings.textModel,
    input: optimizerInput,
    max_output_tokens: 500
  };
  const response = await request(`${settings.textUpstreamBaseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${settings.textUpstreamApiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(responsesBody),
    bodyTimeout: promptOptimizeTimeout,
    headersTimeout: promptOptimizeTimeout
  }).catch((error) => {
    if (lastError?.statusCode) throw lastError;
    throw error;
  });

  return parseTextResponse(response);
}

function normalizeChatImages(images) {
  if (!Array.isArray(images)) return [];
  return images.slice(0, 4).map((item) => {
    const dataUrl = String(item?.dataUrl || '');
    const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!match) return null;
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 12 * 1024 * 1024) return null;
    return { dataUrl, mimeType: match[1] };
  }).filter(Boolean);
}

function buildChatContent(input, images) {
  if (!images.length) return input;
  return [
    { type: 'text', text: input || '请分析这些图片，并给出适合生图的提示词建议。' },
    ...images.map((image) => ({
      type: 'image_url',
      image_url: { url: image.dataUrl }
    }))
  ];
}

export async function chatText({ message, model, reasoningEffort, images }) {
  const settings = currentTextSettings();
  const input = String(message || '').trim();
  const textModel = String(model || settings.textModel || '').trim() || settings.textModel;
  const effort = ['low', 'medium', 'high'].includes(reasoningEffort) ? reasoningEffort : 'medium';
  const chatImages = normalizeChatImages(images);
  const chatBody = {
    model: textModel,
    temperature: 0.6,
    max_tokens: 700,
    reasoning_effort: effort,
    messages: [
      {
        role: 'system',
        content: [
          '你是 OneTop 图像工作台里的中文创作助手。',
          '优先帮助用户整理生图提示词、分镜、画面构图、风格和负面约束。',
          '回答要简洁、可直接复制使用，不要输出 Markdown 表格。'
        ].join('\n')
      },
      {
        role: 'user',
        content: buildChatContent(input, chatImages)
      }
    ]
  };

  let lastError = null;
  try {
    const response = await request(`${settings.textUpstreamBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${settings.textUpstreamApiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(chatBody),
      bodyTimeout: promptOptimizeTimeout,
      headersTimeout: promptOptimizeTimeout
    });
    return parseTextResponse(response);
  } catch (error) {
    lastError = error;
    if (error?.statusCode === 401 || error?.statusCode === 403) throw error;
  }

  const responsesBody = {
    model: textModel,
    input: [
      '你是 OneTop 图像工作台里的中文创作助手。',
      '请帮助用户整理生图提示词、分镜、画面构图、风格和负面约束。',
      chatImages.length ? `用户附带了 ${chatImages.length} 张图片。当前 fallback 接口不支持直接传图，请提醒用户切回支持图片的对话模型。` : '',
      '',
      input
    ].join('\n'),
    max_output_tokens: 700,
    reasoning: { effort }
  };
  const response = await request(`${settings.textUpstreamBaseUrl}/v1/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${settings.textUpstreamApiKey}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(responsesBody),
    bodyTimeout: promptOptimizeTimeout,
    headersTimeout: promptOptimizeTimeout
  }).catch((error) => {
    if (lastError?.statusCode) throw lastError;
    throw error;
  });

  return parseTextResponse(response);
}

async function generateOneImage({ prompt, quality, size, outputFormat, imageModel = '', timeoutMs = imageGenerateTotalTimeout, signal = null }) {
  const normalized = normalizeQuality(quality);
  const normalizedSize = normalizeSize(size || sizeMap[normalized]);
  const normalizedFormat = normalizeOutputFormatForSize(outputFormat, normalizedSize);

  return requestImageWithDispatch({
    label: '文生图上游',
    timeoutMs,
    path: '/v1/images/generations',
    outputFormat: normalizedFormat,
    imageModel,
    signal,
    buildRequest: (upstream, signal) => ({
      method: 'POST',
      headers: {
        authorization: `Bearer ${upstream.upstreamApiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: upstream.requestImageModel || upstream.imageModel,
        prompt,
        n: 1,
        size: normalizedSize,
        quality: qualityMap[normalized],
        output_format: normalizedFormat
      }),
      bodyTimeout: timeoutMs,
      headersTimeout: timeoutMs,
      signal
    })
  });
}

async function editOneImage({ prompt, quality, imageDataUrl, imageDataUrls, maskDataUrl, size, outputFormat, imageModel = '', signal = null }) {
  const normalized = normalizeQuality(quality);
  const normalizedSize = normalizeSize(size || sizeMap[normalized]);
  const normalizedFormat = normalizeOutputFormatForSize(outputFormat, normalizedSize);
  const images = (Array.isArray(imageDataUrls) && imageDataUrls.length ? imageDataUrls : [imageDataUrl])
    .filter(Boolean)
    .slice(0, 4)
    .map((item, index) => parseDataUrl(item, `reference-${index + 1}`));
  if (!images.length) throw new Error('请上传有效图片');
  const mask = maskDataUrl ? parseDataUrl(maskDataUrl, 'mask') : null;

  return requestImageWithDispatch({
    label: '图生图上游',
    timeoutMs: imageEditTotalTimeout,
    path: '/v1/images/edits',
    outputFormat: normalizedFormat,
    imageModel,
    signal,
    buildRequest: (upstream, signal) => {
      const form = new FormData();
      form.set('model', upstream.requestImageModel || upstream.imageModel);
      form.set('prompt', prompt);
      form.set('n', '1');
      form.set('size', normalizedSize);
      form.set('quality', qualityMap[normalized]);
      form.set('output_format', normalizedFormat);
      images.forEach((image) => {
        form.append('image', new Blob([image.buffer], { type: image.mimeType }), image.filename);
      });
      if (mask) form.set('mask', new Blob([mask.buffer], { type: mask.mimeType }), mask.filename);
      return {
      method: 'POST',
      headers: {
        authorization: `Bearer ${upstream.upstreamApiKey}`
      },
      body: form,
      bodyTimeout: imageEditTotalTimeout,
      headersTimeout: imageEditTotalTimeout,
      signal
      };
    }
  });
}

function mergeImageResults(results) {
  const images = results.flatMap((item) => item.images || []);
  if (!images.length) throw new Error('上游未返回图片');
  const selected = results.find((item) => item.upstreamId || item.upstreamName || item.upstreamBaseUrl || item.upstreamModel) || {};
  const upstreamAttempts = results.flatMap((item, index) => (Array.isArray(item.upstreamAttempts) ? item.upstreamAttempts : [])
    .map((attempt) => ({
      ...attempt,
      imageIndex: index
    })));
  const batchMeta = results.batchMeta || {
    requestedCount: images.length,
    returnedCount: images.length,
    failedCount: 0,
    batchFailures: []
  };
  return {
    upstreamStatus: results.at(-1)?.upstreamStatus || 200,
    imageUrl: images[0].imageUrl,
    imageBase64: images[0].imageBase64,
    images,
    ...batchMeta,
    upstreamAttempts,
    ...upstreamMetadata({
      id: selected.upstreamId,
      name: selected.upstreamName,
      upstreamBaseUrl: selected.upstreamBaseUrl,
      imageModel: selected.upstreamModel
    })
  };
}

function shouldFallbackEdit(error) {
  const statusCode = Number(error?.statusCode || 0);
  const text = String(error?.message || '').toLowerCase();
  if (error?.code === 'UPSTREAM_TIMEOUT'
    || text.includes('timeout')
    || text.includes('headers timeout')
    || text.includes('body timeout')
    || text.includes('超时')) return true;
  if ([404, 409, 500, 501, 502, 503, 504].includes(statusCode)) return true;
  return text.includes('gateway')
    || text.includes('bad gateway')
    || text.includes('service unavailable')
    || text.includes('not found')
    || text.includes('unsupported')
    || text.includes('not support')
    || text.includes('网关');
}

async function buildEditFallbackPrompt({ prompt, imageDataUrl, imageDataUrls, maskDataUrl }) {
  const sourceImages = (Array.isArray(imageDataUrls) && imageDataUrls.length ? imageDataUrls : [imageDataUrl])
    .filter(Boolean)
    .slice(0, 4);
  const imageNote = await chatText({
    reasoningEffort: 'low',
    images: sourceImages.map((dataUrl) => ({ dataUrl })),
    message: [
      '请分析用户上传的参考图，提炼可用于重新生成图片的画面描述。',
      '只输出一段中文提示词，不要解释，不要 Markdown。',
      '包含主体、风格、构图、镜头、光线、材质、色彩和关键细节。',
      maskDataUrl ? '用户提供了局部选区，请重点保留未选区内容，并按用户要求修改选区。' : '保留参考图的主体、构图和主要视觉特征。',
      '',
      `用户想做的修改：${prompt}`
    ].join('\n')
  }).catch(() => '');
  return [
    '根据参考图进行重绘，保留参考图的主体、构图、比例、风格和关键细节。',
    imageNote ? `参考图描述：${imageNote}` : '',
    `用户修改要求：${prompt}`,
    '输出为完整成品图，不要文字、水印、边框、拼贴或对比图。'
  ].filter(Boolean).join('\n');
}

export async function generateImage({ prompt, quality, size, outputFormat, count, imageModel = '', retries = imageTaskRetries, timeoutMs = imageGenerateTotalTimeout, signal = null }) {
  const results = await runImageBatch(count, () => generateOneImage({ prompt, quality, size, outputFormat, imageModel, timeoutMs, signal }), { retries, signal });
  return mergeImageResults(results);
}

export async function editImage({ prompt, quality, imageDataUrl, imageDataUrls, maskDataUrl, size, outputFormat, count, imageModel = '', signal = null }) {
  try {
    const results = await runImageBatch(count, () => editOneImage({ prompt, quality, imageDataUrl, imageDataUrls, maskDataUrl, size, outputFormat, imageModel, signal }), { retries: imageEditTaskRetries, signal });
    return mergeImageResults(results);
  } catch (error) {
    if (!shouldFallbackEdit(error)) throw error;
    throwIfAborted(signal);
    const fallbackPrompt = await buildEditFallbackPrompt({ prompt, imageDataUrl, imageDataUrls, maskDataUrl });
    throwIfAborted(signal);
    const result = await generateImage({ prompt: fallbackPrompt, quality, size, outputFormat, count, imageModel, retries: imageEditFallbackRetries, timeoutMs: imageEditFallbackGenerateTimeout, signal });
    return {
      ...result,
      editFallback: true,
      originalEditError: error.message || '图生图上游不可用'
    };
  }
}

export async function generateStoryboardImages({ prompts, quality, size, outputFormat, imageModel = '', signal = null }) {
  const scenes = Array.isArray(prompts)
    ? prompts.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  if (!scenes.length) throw new Error('请先生成分镜草稿');
  const tasks = scenes.map((prompt) => () => generateOneImage({ prompt, quality, size, outputFormat, imageModel, signal }));
  const results = await runImageTasks(tasks, { retries: imageTaskRetries, signal });
  return {
    ...mergeImageResults(results),
    sceneCount: results.length,
    scenePrompts: scenes
  };
}

export async function editStoryboardImages({ prompts, quality, imageDataUrl, imageDataUrls, maskDataUrl, size, outputFormat, imageModel = '', signal = null }) {
  const scenes = Array.isArray(prompts)
    ? prompts.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  if (!scenes.length) throw new Error('请先生成分镜草稿');
  const tasks = scenes.map((prompt) => () => editOneImage({ prompt, quality, imageDataUrl, imageDataUrls, maskDataUrl, size, outputFormat, imageModel, signal }));
  const results = await runImageTasks(tasks, { retries: imageEditTaskRetries, signal });
  return {
    ...mergeImageResults(results),
    sceneCount: results.length,
    scenePrompts: scenes
  };
}
