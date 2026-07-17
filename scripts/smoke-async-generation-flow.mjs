import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const ONE_BY_ONE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const DEFAULT_TIMEOUT_MS = 45_000;

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith('--')) continue;
  const [key, inlineValue] = arg.slice(2).split('=');
  const value = inlineValue ?? process.argv[index + 1];
  if (inlineValue === undefined) index += 1;
  args.set(key, value);
}

const sourceRoot = path.resolve(args.get('source') || process.cwd());
const keepTemp = args.has('keep-temp');
const adminAccount = String(args.get('admin-account') || 'admin');
const adminPassword = String(args.get('admin-password') || '12345678');
const userPassword = 'testpass123';
const testRunId = randomUUID().replace(/-/g, '').slice(0, 12);
const testAccount = `async_${testRunId}`;
const testUsername = `异步_${testRunId.slice(0, 8)}`;

const checks = [];
const cleanupTasks = [];
let tempRoot = '';
let fakeUpstreamRequests = [];

function record(name, ok, detail = {}) {
  const item = { ...detail, name, ok: Boolean(ok) };
  checks.push(item);
  if (!item.ok) process.exitCode = 1;
  return item.ok;
}

function assertCheck(name, condition, detail = {}) {
  if (!record(name, condition, detail)) {
    throw new Error(`${name} failed${detail.error ? `: ${detail.error}` : ''}`);
  }
}

async function listen(server, host = '127.0.0.1') {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to allocate a local port');
  return `http://${host}:${address.port}`;
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function readRequestJson(req) {
  const buffer = await readRequestBody(req);
  const raw = buffer.toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

async function startFakeUpstream({ name = 'success', delayMs = 0, invalidImages = false, failImages = false, urlOnly = false, invalidRemoteImage = false } = {}) {
  let baseUrl = '';
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const body = await readRequestJson(req);
    fakeUpstreamRequests.push({
      name,
      method: req.method,
      path: url.pathname,
      body,
      at: Date.now()
    });

    if (req.method === 'GET' && url.pathname === '/fixture.png') {
      if (invalidRemoteImage) {
        const invalidBuffer = Buffer.from('not an image');
        res.writeHead(200, {
          'content-type': 'image/png',
          'content-length': String(invalidBuffer.length)
        });
        res.end(invalidBuffer);
        return;
      }
      const imageBuffer = Buffer.from(ONE_BY_ONE_PNG_BASE64, 'base64');
      res.writeHead(200, {
        'content-type': 'image/png',
        'content-length': String(imageBuffer.length)
      });
      res.end(imageBuffer);
      return;
    }

    if (req.method === 'POST' && (url.pathname === '/v1/images/generations' || url.pathname === '/v1/images/edits')) {
      if (delayMs > 0) await sleep(delayMs);
      if (failImages) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: `${name} synthetic outage` } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          urlOnly
            ? {
              url: `${baseUrl}/fixture.png`,
              mime_type: 'image/png'
            }
            : {
              b64_json: invalidImages ? Buffer.from('not an image').toString('base64') : ONE_BY_ONE_PNG_BASE64,
              mime_type: 'image/png'
            }
        ]
      }));
      return;
    }

    if (req.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/v1/responses')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        choices: [{ message: { content: 'Async smoke fake text response' } }],
        output_text: 'Async smoke fake text response'
      }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'fake upstream route not found' } }));
  });
  baseUrl = await listen(server);
  cleanupTasks.push(() => new Promise((resolve) => server.close(resolve)));
  return baseUrl;
}

async function copyProjectToTemp() {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'youyu-async-generation-flow-'));
  const excludedNames = new Set(['.git', '.playwright-cli', 'data', 'node_modules', 'output']);
  await fs.cp(sourceRoot, tempRoot, {
    recursive: true,
    filter: (entry) => {
      const relative = path.relative(sourceRoot, entry);
      if (!relative) return true;
      const parts = relative.split(path.sep);
      if (parts.some((part) => excludedNames.has(part))) return false;
      const base = path.basename(entry);
      if (base === '.env' || (base.startsWith('.env.') && base !== '.env.example')) return false;
      if (base.startsWith('._')) return false;
      if (base.endsWith('.tgz') || base.endsWith('.tar.gz')) return false;
      return true;
    }
  });

  try {
    await fs.symlink(path.join(sourceRoot, 'node_modules'), path.join(tempRoot, 'node_modules'), 'dir');
  } catch {
    // The spawned app will fail with its own startup log if node_modules is unavailable.
  }

  cleanupTasks.push(async () => {
    if (!keepTemp && tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  });
  return tempRoot;
}

function spawnApp({ appRoot, appBaseUrl, fakeUpstreamBaseUrl }) {
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: appRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: new URL(appBaseUrl).port,
      PUBLIC_BASE_URL: appBaseUrl,
      APP_SECRET: `async-smoke-secret-${testRunId}`,
      ADMIN_USERNAME: adminAccount,
      ADMIN_PASSWORD: adminPassword,
      IMAGE_UPSTREAM_BASE_URL: fakeUpstreamBaseUrl,
      IMAGE_UPSTREAM_API_KEY: 'async-smoke-fake-key',
      IMAGE_MODEL: 'async-smoke-image-model',
      TEXT_MODEL: 'async-smoke-text-model',
      PRICE_1K_CENTS: '100',
      PRICE_2K_CENTS: '200',
      IMAGE_WORKER_CONCURRENCY: '1',
      IMAGE_MAX_PENDING_PER_USER: '3',
      IMAGE_PROXY_ALLOW_LOCAL: '1',
      STORE_PERSIST_COALESCE_MS: '0',
      LOG_LEVEL: 'warn'
    }
  });

  const logs = [];
  const collect = (streamName) => (chunk) => {
    const text = chunk.toString();
    logs.push(`[${streamName}] ${text}`);
    if (logs.length > 100) logs.shift();
  };
  child.stdout.on('data', collect('stdout'));
  child.stderr.on('data', collect('stderr'));

  cleanupTasks.push(() => new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 2500);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  }));

  return { child, logs };
}

async function request(baseUrl, pathName, options = {}) {
  const targetUrl = /^https?:\/\//i.test(String(pathName)) ? String(pathName) : `${baseUrl}${pathName}`;
  const response = await fetch(targetUrl, {
    redirect: 'manual',
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const contentType = response.headers.get('content-type') || '';
  const buffer = Buffer.from(await response.arrayBuffer());
  const raw = buffer.toString('utf8');
  const body = contentType.includes('application/json') && raw ? JSON.parse(raw) : raw;
  return { response, body, raw, byteLength: buffer.length };
}

async function requestOk(baseUrl, pathName, options = {}) {
  const result = await request(baseUrl, pathName, options);
  if (!result.response.ok) {
    const message = typeof result.body === 'object' && result.body
      ? result.body.message || result.body.error?.message || JSON.stringify(result.body)
      : String(result.raw || '').slice(0, 240);
    throw new Error(`${pathName} returned ${result.response.status}: ${message}`);
  }
  return result;
}

async function waitForApp(baseUrl, appProcess, logs) {
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS;
  let lastError = null;
  while (Date.now() < deadline) {
    if (appProcess.exitCode !== null) {
      throw new Error(`app exited early with code ${appProcess.exitCode}\n${logs.join('')}`);
    }
    try {
      const { body } = await requestOk(baseUrl, '/api/health');
      if (body?.success) return body;
    } catch (error) {
      lastError = error;
    }
    await sleep(350);
  }
  throw new Error(`app did not become healthy: ${lastError?.message || 'timeout'}\n${logs.join('')}`);
}

async function login(baseUrl, account, password) {
  const { response, body } = await requestOk(baseUrl, '/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account, password })
  });
  const cookie = response.headers.get('set-cookie')?.split(';')[0] || '';
  assertCheck(`login:${account}`, body?.success === true && Boolean(cookie), {
    role: body?.user?.role || null
  });
  return { cookie, user: body.user };
}

async function createFundedUser(baseUrl, adminCookie) {
  const { body } = await requestOk(baseUrl, '/api/admin/users', {
    method: 'POST',
    headers: { cookie: adminCookie },
    body: JSON.stringify({
      username: testUsername,
      account: testAccount,
      password: userPassword,
      balanceSingularity: 3
    })
  });
  assertCheck('admin:create-async-funded-user', body?.success === true && body?.user?.balanceCents === 300, {
    userId: body?.user?.id || null,
    balanceCents: body?.user?.balanceCents
  });
  return body.user;
}

async function configureSingleImageUpstream(baseUrl, adminCookie, upstreamBaseUrl, {
  id = 'async-smoke-single',
  name = 'Async Smoke 单通道',
  model = 'async-smoke-model'
} = {}) {
  const { body } = await requestOk(baseUrl, '/api/admin/ai-settings', {
    method: 'PUT',
    headers: { cookie: adminCookie },
    body: JSON.stringify({
      imageUpstreams: [
        {
          id,
          name,
          enabled: true,
          autoBan: false,
          priority: 1000,
          weight: 1,
          upstreamBaseUrl,
          upstreamApiKey: `${id}-key`,
          imageModel: model
        }
      ],
      textUpstreamBaseUrl: upstreamBaseUrl,
      textUpstreamApiKey: `${id}-text-key`,
      textModel: `${model}-text`
    })
  });
  assertCheck(`admin:configure-${id}`, body?.success === true
    && Array.isArray(body?.ai?.imageUpstreams)
    && body.ai.imageUpstreams.some((item) => item.id === id && item.enabled && item.upstreamApiKeyConfigured), {
    upstreams: body?.ai?.imageUpstreams?.map((item) => ({
      id: item.id,
      name: item.name,
      enabled: item.enabled,
      configured: item.upstreamApiKeyConfigured
    }))
  });
}

async function waitForGeneration(baseUrl, cookie, generationId, terminalStatus, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastBody = null;
  while (Date.now() < deadline) {
    const { body } = await requestOk(baseUrl, `/api/generate/${encodeURIComponent(generationId)}`, {
      headers: { cookie }
    });
    lastBody = body;
    if (body?.generation?.status === terminalStatus) return body;
    if (body?.generation?.status && body.generation.status !== 'pending') {
      throw new Error(`generation ${generationId} ended as ${body.generation.status}, expected ${terminalStatus}`);
    }
    await sleep(250);
  }
  throw new Error(`generation ${generationId} did not become ${terminalStatus}; last=${JSON.stringify(lastBody?.generation || null)}`);
}

async function runSuccessFlow(appBaseUrl, userCookie) {
  const { body: queuedBody, response } = await request(appBaseUrl, '/api/generate?async=1', {
    method: 'POST',
    headers: { cookie: userCookie },
    body: JSON.stringify({
      prompt: `Async E2E success ${testRunId}`,
      quality: '1k',
      size: '1024x1024',
      outputFormat: 'png',
      count: 1
    })
  });
  const generation = queuedBody?.generation;
  assertCheck('async:success-queued-202', response.status === 202
    && queuedBody?.success === true
    && queuedBody?.queued === true
    && generation?.status === 'pending'
    && generation?.consumedAmountCents === 100
    && queuedBody?.user?.balanceCents === 200
    && queuedBody?.queue?.disabled === false, {
    status: response.status,
    generationStatus: generation?.status,
    consumedAmountCents: generation?.consumedAmountCents,
    balanceCents: queuedBody?.user?.balanceCents,
    queue: queuedBody?.queue
  });

  const generationId = generation.id;
  const { body: pendingDetail } = await requestOk(appBaseUrl, `/api/generate/${encodeURIComponent(generationId)}`, {
    headers: { cookie: userCookie }
  });
  assertCheck('async:success-visible-while-pending', pendingDetail?.generation?.status === 'pending', {
    status: pendingDetail?.generation?.status,
    queue: pendingDetail?.queue
  });

  const { body: pendingHistory } = await requestOk(appBaseUrl, '/api/history?status=pending&limit=5', {
    headers: { cookie: userCookie }
  });
  assertCheck('async:success-history-shows-pending', pendingHistory?.success === true
    && Array.isArray(pendingHistory.generations)
    && pendingHistory.generations.some((item) => item.id === generationId && item.status === 'pending'), {
    total: pendingHistory?.total,
    ids: pendingHistory?.generations?.map((item) => `${item.id}:${item.status}`)
  });

  const succeededBody = await waitForGeneration(appBaseUrl, userCookie, generationId, 'succeeded');
  const succeeded = succeededBody?.generation;
  assertCheck('async:success-finished', succeededBody?.success === true
    && succeeded?.status === 'succeeded'
    && Array.isArray(succeeded?.images)
    && succeeded.images.length === 1
    && succeeded?.consumedAmountCents === 100
    && succeeded?.refundedAmountCents === 0
    && succeededBody?.user?.balanceCents === 200, {
    status: succeeded?.status,
    imageCount: succeeded?.images?.length,
    consumedAmountCents: succeeded?.consumedAmountCents,
    refundedAmountCents: succeeded?.refundedAmountCents,
    balanceCents: succeededBody?.user?.balanceCents,
    queue: succeededBody?.queue
  });

  const imageUrl = succeeded?.images?.[0]?.imageUrl || `/api/history/${encodeURIComponent(generationId)}/image/0`;
  const imageResult = await requestOk(appBaseUrl, imageUrl, {
    headers: { cookie: userCookie }
  });
  const contentType = imageResult.response.headers.get('content-type') || '';
  assertCheck('async:success-image-downloads', contentType.includes('image/png') && imageResult.byteLength > 0, {
    contentType,
    bytes: imageResult.byteLength
  });

  return generationId;
}

async function runFailureRefundFlow(appBaseUrl, adminCookie, userCookie, invalidUpstreamBaseUrl) {
  const { body: beforeBody } = await requestOk(appBaseUrl, '/api/me', {
    headers: { cookie: userCookie }
  });
  const balanceBefore = Number(beforeBody?.user?.balanceCents || 0);
  await configureSingleImageUpstream(appBaseUrl, adminCookie, invalidUpstreamBaseUrl, {
    id: 'async-smoke-invalid',
    name: 'Async Smoke 破图通道',
    model: 'async-smoke-invalid-model'
  });

  const { body: queuedBody, response } = await request(appBaseUrl, '/api/generate?async=1', {
    method: 'POST',
    headers: { cookie: userCookie },
    body: JSON.stringify({
      prompt: `Async E2E invalid image refund ${testRunId}`,
      quality: '1k',
      size: '1024x1024',
      outputFormat: 'png',
      count: 1
    })
  });
  const queued = queuedBody?.generation;
  assertCheck('async:failure-queued-202', response.status === 202
    && queuedBody?.success === true
    && queuedBody?.queued === true
    && queued?.status === 'pending'
    && queued?.consumedAmountCents === 100
    && queuedBody?.user?.balanceCents === balanceBefore - 100, {
    status: response.status,
    generationStatus: queued?.status,
    consumedAmountCents: queued?.consumedAmountCents,
    balanceBefore,
    balanceAfterQueue: queuedBody?.user?.balanceCents
  });

  const failedBody = await waitForGeneration(appBaseUrl, userCookie, queued.id, 'failed');
  const failed = failedBody?.generation;
  assertCheck('async:failure-refunds', failedBody?.success === true
    && failed?.status === 'failed'
    && /无效图片|上游返回/.test(String(failed?.error || failed?.metadata?.errorCode || failed?.metadata?.batchFailures?.[0]?.message || ''))
    && failed?.consumedAmountCents === 100
    && failed?.refundedAmountCents === 100
    && failed?.remainingAmountCents === 0
    && failedBody?.user?.balanceCents === balanceBefore, {
    status: failed?.status,
    error: failed?.error,
    consumedAmountCents: failed?.consumedAmountCents,
    refundedAmountCents: failed?.refundedAmountCents,
    remainingAmountCents: failed?.remainingAmountCents,
    balanceBefore,
    balanceAfterFailure: failedBody?.user?.balanceCents
  });

  const { body: failedHistory } = await requestOk(appBaseUrl, '/api/history?status=failed&limit=5', {
    headers: { cookie: userCookie }
  });
  assertCheck('async:failure-history-visible', failedHistory?.success === true
    && Array.isArray(failedHistory.generations)
    && failedHistory.generations.some((item) => item.id === queued.id && item.status === 'failed'), {
    total: failedHistory?.total,
    ids: failedHistory?.generations?.map((item) => `${item.id}:${item.status}`)
  });

  return queued.id;
}

async function runUrlOnlySuccessFlow(appBaseUrl, adminCookie, userCookie, urlOnlyUpstreamBaseUrl) {
  const { body: beforeBody } = await requestOk(appBaseUrl, '/api/me', {
    headers: { cookie: userCookie }
  });
  const balanceBefore = Number(beforeBody?.user?.balanceCents || 0);
  await configureSingleImageUpstream(appBaseUrl, adminCookie, urlOnlyUpstreamBaseUrl, {
    id: 'async-smoke-url-only',
    name: 'Async Smoke URL 图片通道',
    model: 'async-smoke-url-only-model'
  });

  const { body: queuedBody, response } = await request(appBaseUrl, '/api/generate?async=1', {
    method: 'POST',
    headers: { cookie: userCookie },
    body: JSON.stringify({
      prompt: `Async E2E url-only persistence ${testRunId}`,
      quality: '1k',
      size: '1024x1024',
      outputFormat: 'png',
      count: 1
    })
  });
  const queued = queuedBody?.generation;
  assertCheck('async:url-only-queued-202', response.status === 202
    && queuedBody?.success === true
    && queuedBody?.queued === true
    && queued?.status === 'pending'
    && queued?.consumedAmountCents === 100
    && queuedBody?.user?.balanceCents === balanceBefore - 100, {
    status: response.status,
    generationStatus: queued?.status,
    consumedAmountCents: queued?.consumedAmountCents,
    balanceBefore,
    balanceAfterQueue: queuedBody?.user?.balanceCents
  });

  const succeededBody = await waitForGeneration(appBaseUrl, userCookie, queued.id, 'succeeded');
  const succeeded = succeededBody?.generation;
  assertCheck('async:url-only-persisted', succeededBody?.success === true
    && succeeded?.status === 'succeeded'
    && Array.isArray(succeeded?.images)
    && succeeded.images.length === 1
    && succeeded.images[0]?.imageUrl?.includes(`/api/history/${encodeURIComponent(queued.id)}/image/0`)
    && succeeded?.consumedAmountCents === 100
    && succeeded?.refundedAmountCents === 0
    && succeededBody?.user?.balanceCents === balanceBefore - 100, {
    status: succeeded?.status,
    image: succeeded?.images?.[0],
    balanceBefore,
    balanceAfterSuccess: succeededBody?.user?.balanceCents
  });

  const imageResult = await requestOk(appBaseUrl, `/api/history/${encodeURIComponent(queued.id)}/image/0`, {
    headers: { cookie: userCookie }
  });
  const contentType = imageResult.response.headers.get('content-type') || '';
  assertCheck('async:url-only-image-downloads', contentType.includes('image/png') && imageResult.byteLength > 0, {
    contentType,
    bytes: imageResult.byteLength
  });

  return queued.id;
}

async function runUrlOnlyFailureRefundFlow(appBaseUrl, adminCookie, userCookie, invalidUrlOnlyUpstreamBaseUrl) {
  const { body: beforeBody } = await requestOk(appBaseUrl, '/api/me', {
    headers: { cookie: userCookie }
  });
  const balanceBefore = Number(beforeBody?.user?.balanceCents || 0);
  await configureSingleImageUpstream(appBaseUrl, adminCookie, invalidUrlOnlyUpstreamBaseUrl, {
    id: 'async-smoke-url-invalid',
    name: 'Async Smoke URL 坏图通道',
    model: 'async-smoke-url-invalid-model'
  });

  const { body: queuedBody, response } = await request(appBaseUrl, '/api/generate?async=1', {
    method: 'POST',
    headers: { cookie: userCookie },
    body: JSON.stringify({
      prompt: `Async E2E url-only invalid refund ${testRunId}`,
      quality: '1k',
      size: '1024x1024',
      outputFormat: 'png',
      count: 1
    })
  });
  const queued = queuedBody?.generation;
  assertCheck('async:url-only-failure-queued-202', response.status === 202
    && queuedBody?.success === true
    && queuedBody?.queued === true
    && queued?.status === 'pending'
    && queued?.consumedAmountCents === 100
    && queuedBody?.user?.balanceCents === balanceBefore - 100, {
    status: response.status,
    generationStatus: queued?.status,
    consumedAmountCents: queued?.consumedAmountCents,
    balanceBefore,
    balanceAfterQueue: queuedBody?.user?.balanceCents
  });

  const failedBody = await waitForGeneration(appBaseUrl, userCookie, queued.id, 'failed');
  const failed = failedBody?.generation;
  assertCheck('async:url-only-failure-refunds', failedBody?.success === true
    && failed?.status === 'failed'
    && /保存失败|无效图片|退款/.test(String(failed?.error || failed?.metadata?.errorCode || failed?.metadata?.batchFailures?.[0]?.message || ''))
    && failed?.consumedAmountCents === 100
    && failed?.refundedAmountCents === 100
    && failed?.remainingAmountCents === 0
    && failedBody?.user?.balanceCents === balanceBefore, {
    status: failed?.status,
    error: failed?.error,
    batchFailures: failed?.metadata?.batchFailures,
    consumedAmountCents: failed?.consumedAmountCents,
    refundedAmountCents: failed?.refundedAmountCents,
    balanceBefore,
    balanceAfterFailure: failedBody?.user?.balanceCents
  });

  return queued.id;
}

async function main() {
  const successUpstreamBaseUrl = await startFakeUpstream({ name: 'async-success', delayMs: 1200 });
  const invalidUpstreamBaseUrl = await startFakeUpstream({ name: 'async-invalid', delayMs: 250, invalidImages: true });
  const urlOnlyUpstreamBaseUrl = await startFakeUpstream({ name: 'async-url-only', delayMs: 250, urlOnly: true });
  const invalidUrlOnlyUpstreamBaseUrl = await startFakeUpstream({ name: 'async-url-invalid', delayMs: 250, urlOnly: true, invalidRemoteImage: true });
  const appRoot = await copyProjectToTemp();

  const portServer = http.createServer((_req, res) => res.end('reserved'));
  const appBaseUrl = await listen(portServer);
  await new Promise((resolve) => portServer.close(resolve));

  const { child: appProcess, logs } = spawnApp({ appRoot, appBaseUrl, fakeUpstreamBaseUrl: successUpstreamBaseUrl });
  const health = await waitForApp(appBaseUrl, appProcess, logs);
  assertCheck('health:async-worker-enabled', (health?.imageReady === true || health?.ai?.imageReady === true)
    && health?.generationQueue?.disabled === false, {
    imageReady: health?.imageReady,
    aiImageReady: health?.ai?.imageReady,
    generationQueue: health?.generationQueue
  });

  const admin = await login(appBaseUrl, adminAccount, adminPassword);
  await createFundedUser(appBaseUrl, admin.cookie);
  const testUser = await login(appBaseUrl, testAccount, userPassword);

  const successGenerationId = await runSuccessFlow(appBaseUrl, testUser.cookie);
  const failedGenerationId = await runFailureRefundFlow(appBaseUrl, admin.cookie, testUser.cookie, invalidUpstreamBaseUrl);
  const urlOnlyGenerationId = await runUrlOnlySuccessFlow(appBaseUrl, admin.cookie, testUser.cookie, urlOnlyUpstreamBaseUrl);
  const invalidUrlOnlyGenerationId = await runUrlOnlyFailureRefundFlow(appBaseUrl, admin.cookie, testUser.cookie, invalidUrlOnlyUpstreamBaseUrl);

  const successRequests = fakeUpstreamRequests.filter((item) => item.name === 'async-success' && item.path === '/v1/images/generations');
  const invalidRequests = fakeUpstreamRequests.filter((item) => item.name === 'async-invalid' && item.path === '/v1/images/generations');
  const urlOnlyRequests = fakeUpstreamRequests.filter((item) => item.name === 'async-url-only' && item.path === '/v1/images/generations');
  const urlOnlyImageFetches = fakeUpstreamRequests.filter((item) => item.name === 'async-url-only' && item.path === '/fixture.png');
  const invalidUrlOnlyRequests = fakeUpstreamRequests.filter((item) => item.name === 'async-url-invalid' && item.path === '/v1/images/generations');
  const invalidUrlOnlyImageFetches = fakeUpstreamRequests.filter((item) => item.name === 'async-url-invalid' && item.path === '/fixture.png');
  assertCheck('fake-upstream:async-request-count', successRequests.length === 1
    && invalidRequests.length >= 1
    && urlOnlyRequests.length === 1
    && urlOnlyImageFetches.length === 1
    && invalidUrlOnlyRequests.length >= 1
    && invalidUrlOnlyImageFetches.length >= 1, {
    successRequests: successRequests.length,
    invalidRequests: invalidRequests.length,
    urlOnlyRequests: urlOnlyRequests.length,
    urlOnlyImageFetches: urlOnlyImageFetches.length,
    invalidUrlOnlyRequests: invalidUrlOnlyRequests.length,
    invalidUrlOnlyImageFetches: invalidUrlOnlyImageFetches.length,
    requests: fakeUpstreamRequests.map((item) => ({ name: item.name, path: item.path, body: item.body }))
  });

  const report = {
    ok: checks.every((item) => item.ok),
    sourceRoot,
    tempRoot: keepTemp ? tempRoot : undefined,
    appBaseUrl,
    successUpstreamBaseUrl,
    invalidUpstreamBaseUrl,
    urlOnlyUpstreamBaseUrl,
    invalidUrlOnlyUpstreamBaseUrl,
    successGenerationId,
    failedGenerationId,
    urlOnlyGenerationId,
    invalidUrlOnlyGenerationId,
    checkedAt: new Date().toISOString(),
    checks
  };
  console.log(JSON.stringify(report, null, 2));
}

async function cleanup() {
  for (const task of cleanupTasks.reverse()) {
    await task().catch(() => {});
  }
}

try {
  await main();
} catch (error) {
  record('smoke:async-generation-flow', false, {
    error: error.message,
    tempRoot: keepTemp ? tempRoot : undefined
  });
  console.error(JSON.stringify({
    ok: false,
    sourceRoot,
    tempRoot: keepTemp ? tempRoot : undefined,
    fakeUpstreamRequests,
    checkedAt: new Date().toISOString(),
    checks
  }, null, 2));
  process.exitCode = 1;
} finally {
  await cleanup();
}
