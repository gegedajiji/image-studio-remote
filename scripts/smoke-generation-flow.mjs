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
const generatedCount = Math.max(1, Math.min(4, Number.parseInt(String(args.get('count') || '2'), 10) || 2));
const adminAccount = String(args.get('admin-account') || 'admin');
const adminPassword = String(args.get('admin-password') || '12345678');
const skipFailover = args.has('skip-failover');
const userPassword = 'testpass123';
const testRunId = randomUUID().replace(/-/g, '').slice(0, 12);
const testAccount = `e2e_${testRunId}`;
const testUsername = `链路_${testRunId.slice(0, 8)}`;
const viewerAccount = `e2e_viewer_${testRunId}`;
const viewerUsername = `访客_${testRunId.slice(0, 8)}`;
const registeredAccount = `e2e_reg_${testRunId}`;
const registeredUsername = `注册_${testRunId.slice(0, 8)}`;
const redeemCodeValue = `SMK-${testRunId.toUpperCase()}-A`;
const revokedRedeemCodeValue = `SMK-${testRunId.toUpperCase()}-R`;

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

async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

async function startFakeUpstream({ name = 'success', failImages = false, invalidImages = false } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const body = await readRequestJson(req);
    fakeUpstreamRequests.push({
      name,
      method: req.method,
      path: url.pathname,
      body
    });

    if (req.method === 'POST' && (url.pathname === '/v1/images/generations' || url.pathname === '/v1/images/edits')) {
      if (failImages) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            message: `${name} synthetic outage`
          }
        }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: [
          {
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
        choices: [
          {
            message: {
              content: 'E2E fake text response'
            }
          }
        ],
        output_text: 'E2E fake text response'
      }));
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'fake upstream route not found' } }));
  });
  const baseUrl = await listen(server);
  cleanupTasks.push(() => new Promise((resolve) => server.close(resolve)));
  return baseUrl;
}

async function copyProjectToTemp() {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'youyu-generation-flow-'));
  const excludedNames = new Set([
    '.git',
    '.playwright-cli',
    'data',
    'node_modules',
    'output'
  ]);
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

  const sourceNodeModules = path.join(sourceRoot, 'node_modules');
  try {
    await fs.symlink(sourceNodeModules, path.join(tempRoot, 'node_modules'), 'dir');
  } catch {
    // If node_modules is unavailable, the spawned app will fail with a clear startup log.
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
      APP_SECRET: `smoke-secret-${testRunId}`,
      ADMIN_USERNAME: adminAccount,
      ADMIN_PASSWORD: adminPassword,
      IMAGE_UPSTREAM_BASE_URL: fakeUpstreamBaseUrl,
      IMAGE_UPSTREAM_API_KEY: 'smoke-fake-key',
      IMAGE_MODEL: 'smoke-image-model',
      TEXT_MODEL: 'smoke-text-model',
      PRICE_1K_CENTS: '100',
      PRICE_2K_CENTS: '200',
      STORE_PERSIST_COALESCE_MS: '0',
      IMAGE_WORKER_DISABLED: '1',
      LOG_LEVEL: 'warn'
    }
  });

  const logs = [];
  const collect = (streamName) => (chunk) => {
    const text = chunk.toString();
    logs.push(`[${streamName}] ${text}`);
    if (logs.length > 80) logs.shift();
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

async function waitForCheck(name, check, { timeoutMs = 3000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await check();
    if (lastValue?.ok) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`${name} timed out${lastValue?.detail ? `: ${lastValue.detail}` : ''}`);
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
    await new Promise((resolve) => setTimeout(resolve, 350));
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

async function register(baseUrl, username, account, password) {
  const { response, body } = await requestOk(baseUrl, '/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, account, password })
  });
  const cookie = response.headers.get('set-cookie')?.split(';')[0] || '';
  assertCheck(`register:${account}`, body?.success === true && Boolean(cookie) && body?.user?.account === account, {
    userId: body?.user?.id || null,
    balanceCents: body?.user?.balanceCents
  });
  return { cookie, user: body.user };
}

async function configureFailoverUpstreams(baseUrl, adminCookie, failingUpstreamBaseUrl, healthyUpstreamBaseUrl) {
  if (skipFailover) return null;
  const { body } = await requestOk(baseUrl, '/api/admin/ai-settings', {
    method: 'PUT',
    headers: { cookie: adminCookie },
    body: JSON.stringify({
      imageUpstreams: [
        {
          id: 'smoke-primary-down',
          name: 'Smoke 主通道故障',
          enabled: true,
          autoBan: false,
          priority: 900,
          weight: 1,
          upstreamBaseUrl: failingUpstreamBaseUrl,
          upstreamApiKey: 'smoke-primary-key',
          imageModel: 'smoke-primary-model'
        },
        {
          id: 'smoke-secondary-ok',
          name: 'Smoke 备用通道',
          enabled: true,
          autoBan: false,
          priority: 800,
          weight: 1,
          upstreamBaseUrl: healthyUpstreamBaseUrl,
          upstreamApiKey: 'smoke-secondary-key',
          imageModel: 'smoke-secondary-model'
        }
      ],
      textUpstreamBaseUrl: healthyUpstreamBaseUrl,
      textUpstreamApiKey: 'smoke-text-key',
      textModel: 'smoke-text-model'
    })
  });
  assertCheck('admin:configure-failover-upstreams', body?.success === true
    && Array.isArray(body?.ai?.imageUpstreams)
    && body.ai.imageUpstreams.filter((item) => item.enabled && item.upstreamApiKeyConfigured).length === 2, {
    upstreams: body?.ai?.imageUpstreams?.map((item) => ({
      id: item.id,
      name: item.name,
      enabled: item.enabled,
      configured: item.upstreamApiKeyConfigured,
      priority: item.priority
    }))
  });
  return body.ai;
}

async function configureSingleImageUpstream(baseUrl, adminCookie, upstreamBaseUrl, {
  id = 'smoke-single',
  name = 'Smoke 单通道',
  model = 'smoke-single-model'
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
  return body.ai;
}

async function main() {
  const healthyUpstreamBaseUrl = await startFakeUpstream({ name: 'secondary-ok' });
  const failingUpstreamBaseUrl = await startFakeUpstream({ name: 'primary-down', failImages: true });
  const invalidImageUpstreamBaseUrl = await startFakeUpstream({ name: 'invalid-image', invalidImages: true });
  const appRoot = await copyProjectToTemp();

  const portServer = http.createServer((_req, res) => res.end('reserved'));
  const appBaseUrl = await listen(portServer);
  await new Promise((resolve) => portServer.close(resolve));

  const { child: appProcess, logs } = spawnApp({ appRoot, appBaseUrl, fakeUpstreamBaseUrl: healthyUpstreamBaseUrl });
  const health = await waitForApp(appBaseUrl, appProcess, logs);
  assertCheck('health:image-ready', health?.imageReady === true || health?.ai?.imageReady === true, {
    healthImageReady: health?.imageReady,
    aiImageReady: health?.ai?.imageReady
  });

  const admin = await login(appBaseUrl, adminAccount, adminPassword);
  await configureFailoverUpstreams(appBaseUrl, admin.cookie, failingUpstreamBaseUrl, healthyUpstreamBaseUrl);

  const registeredUser = await register(appBaseUrl, registeredUsername, registeredAccount, userPassword);
  const duplicateRegister = await request(appBaseUrl, '/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      username: registeredUsername,
      account: registeredAccount,
      password: userPassword
    })
  });
  assertCheck('auth:duplicate-register-fails', duplicateRegister.response.status === 400
    && duplicateRegister.body?.success === false
    && /已存在/.test(String(duplicateRegister.body?.message || '')), {
    status: duplicateRegister.response.status,
    message: duplicateRegister.body?.message
  });

  const { body: createdRedeemBody } = await requestOk(appBaseUrl, '/api/admin/redeem-codes', {
    method: 'POST',
    headers: { cookie: admin.cookie },
    body: JSON.stringify({
      code: redeemCodeValue,
      amountSingularity: 3
    })
  });
  const redeemCode = createdRedeemBody?.redeemCode;
  assertCheck('admin:create-redeem-code', createdRedeemBody?.success === true
    && redeemCode?.code === redeemCodeValue
    && redeemCode?.amountCents === 300
    && redeemCode?.status === 'active', {
    code: redeemCode?.code,
    amountCents: redeemCode?.amountCents,
    status: redeemCode?.status
  });

  const { body: createdRevokedRedeemBody } = await requestOk(appBaseUrl, '/api/admin/redeem-codes', {
    method: 'POST',
    headers: { cookie: admin.cookie },
    body: JSON.stringify({
      code: revokedRedeemCodeValue,
      amountSingularity: 2
    })
  });
  const revocableRedeemCode = createdRevokedRedeemBody?.redeemCode;
  assertCheck('admin:create-revocable-redeem-code', createdRevokedRedeemBody?.success === true
    && revocableRedeemCode?.code === revokedRedeemCodeValue
    && revocableRedeemCode?.amountCents === 200
    && revocableRedeemCode?.status === 'active', {
    code: revocableRedeemCode?.code,
    amountCents: revocableRedeemCode?.amountCents,
    status: revocableRedeemCode?.status
  });

  const { body: redeemedBody } = await requestOk(appBaseUrl, '/api/redeem', {
    method: 'POST',
    headers: { cookie: registeredUser.cookie },
    body: JSON.stringify({ code: redeemCode.code })
  });
  assertCheck('redeem:first-use-succeeds', redeemedBody?.success === true
    && redeemedBody?.amountCents === 300
    && redeemedBody?.user?.balanceCents === 300, {
    amountCents: redeemedBody?.amountCents,
    balanceCents: redeemedBody?.user?.balanceCents
  });

  const secondRedeem = await request(appBaseUrl, '/api/redeem', {
    method: 'POST',
    headers: { cookie: registeredUser.cookie },
    body: JSON.stringify({ code: redeemCode.code })
  });
  assertCheck('redeem:second-use-fails', secondRedeem.response.status === 400
    && secondRedeem.body?.success === false
    && /已使用/.test(String(secondRedeem.body?.message || '')), {
    status: secondRedeem.response.status,
    message: secondRedeem.body?.message
  });

  const { body: revokedRedeemBody } = await requestOk(appBaseUrl, `/api/admin/redeem-codes/${encodeURIComponent(revocableRedeemCode.id)}`, {
    method: 'DELETE',
    headers: { cookie: admin.cookie }
  });
  assertCheck('admin:revoke-redeem-code', revokedRedeemBody?.success === true
    && revokedRedeemBody?.redeemCode?.id === revocableRedeemCode.id
    && revokedRedeemBody?.redeemCode?.status === 'revoked', {
    id: revokedRedeemBody?.redeemCode?.id,
    status: revokedRedeemBody?.redeemCode?.status
  });

  const revokedRedeem = await request(appBaseUrl, '/api/redeem', {
    method: 'POST',
    headers: { cookie: registeredUser.cookie },
    body: JSON.stringify({ code: revocableRedeemCode.code })
  });
  assertCheck('redeem:revoked-code-fails', revokedRedeem.response.status === 400
    && revokedRedeem.body?.success === false
    && /无效/.test(String(revokedRedeem.body?.message || '')), {
    status: revokedRedeem.response.status,
    message: revokedRedeem.body?.message
  });

  const { body: registeredMeBody } = await requestOk(appBaseUrl, '/api/me', {
    headers: { cookie: registeredUser.cookie }
  });
  assertCheck('redeem:failed-attempts-preserve-balance', registeredMeBody?.success === true
    && registeredMeBody?.user?.balanceCents === 300, {
    balanceCents: registeredMeBody?.user?.balanceCents
  });

  const invalidJsonSourceGeneration = await request(appBaseUrl, '/api/generate', {
    method: 'POST',
    headers: { cookie: registeredUser.cookie },
    body: JSON.stringify({
      prompt: `E2E 非法源图 ${testRunId}`,
      quality: '1k',
      size: '1024x1024',
      outputFormat: 'png',
      count: 1,
      imageDataUrls: ['data:text/plain;base64,SGVsbG8=']
    })
  });
  assertCheck('generate:invalid-json-source-rejected-before-charge', invalidJsonSourceGeneration.response.status === 400
    && invalidJsonSourceGeneration.body?.success === false
    && !invalidJsonSourceGeneration.body?.generation
    && invalidJsonSourceGeneration.body?.user?.balanceCents === 300, {
    status: invalidJsonSourceGeneration.response.status,
    message: invalidJsonSourceGeneration.body?.message,
    balanceCents: invalidJsonSourceGeneration.body?.user?.balanceCents,
    generation: invalidJsonSourceGeneration.body?.generation
  });

  const { body: registeredHistoryAfterInvalidSource } = await requestOk(appBaseUrl, '/api/history?limit=5', {
    headers: { cookie: registeredUser.cookie }
  });
  assertCheck('generate:invalid-json-source-creates-no-history', registeredHistoryAfterInvalidSource?.success === true
    && registeredHistoryAfterInvalidSource?.total === 0
    && Array.isArray(registeredHistoryAfterInvalidSource.generations)
    && registeredHistoryAfterInvalidSource.generations.length === 0, {
    total: registeredHistoryAfterInvalidSource?.total,
    returned: registeredHistoryAfterInvalidSource?.returned
  });

  const { body: redeemListBody } = await requestOk(appBaseUrl, `/api/admin/redeem-codes?q=${encodeURIComponent(`SMK-${testRunId.toUpperCase()}`)}`, {
    headers: { cookie: admin.cookie }
  });
  const listedUsedCode = redeemListBody?.redeemCodes?.find((item) => item.code === redeemCodeValue);
  const listedRevokedCode = redeemListBody?.redeemCodes?.find((item) => item.code === revokedRedeemCodeValue);
  assertCheck('admin:redeem-code-statuses', redeemListBody?.success === true
    && listedUsedCode?.status === 'used'
    && listedRevokedCode?.status === 'revoked', {
    usedStatus: listedUsedCode?.status,
    revokedStatus: listedRevokedCode?.status,
    total: redeemListBody?.total
  });

  const { body: createdUserBody } = await requestOk(appBaseUrl, '/api/admin/users', {
    method: 'POST',
    headers: { cookie: admin.cookie },
    body: JSON.stringify({
      username: testUsername,
      account: testAccount,
      password: userPassword,
      balanceSingularity: 10
    })
  });
  assertCheck('admin:create-funded-user', createdUserBody?.success === true && createdUserBody?.user?.balanceCents === 1000, {
    balanceCents: createdUserBody?.user?.balanceCents
  });
  const { body: createdViewerBody } = await requestOk(appBaseUrl, '/api/admin/users', {
    method: 'POST',
    headers: { cookie: admin.cookie },
    body: JSON.stringify({
      username: viewerUsername,
      account: viewerAccount,
      password: userPassword,
      balanceSingularity: 5
    })
  });
  assertCheck('admin:create-funded-viewer', createdViewerBody?.success === true && createdViewerBody?.user?.balanceCents === 500, {
    balanceCents: createdViewerBody?.user?.balanceCents
  });

  const testUser = await login(appBaseUrl, testAccount, userPassword);
  const generatePayload = {
    prompt: `E2E 生图链路 ${testRunId}`,
    quality: '1k',
    size: '1024x1024',
    outputFormat: 'png',
    count: generatedCount
  };
  const { body: generationBody } = await requestOk(appBaseUrl, '/api/generate', {
    method: 'POST',
    headers: { cookie: testUser.cookie },
    body: JSON.stringify(generatePayload)
  });
  const generation = generationBody?.generation;
  const expectedPriceCents = 100 * generatedCount;
  assertCheck('generate:succeeded', generationBody?.success === true && generation?.status === 'succeeded', {
    status: generation?.status,
    message: generationBody?.message
  });
  assertCheck('generate:billing', generation?.priceCents === expectedPriceCents
    && generation?.consumedAmountCents === expectedPriceCents
    && generation?.refundedAmountCents === 0
    && generationBody?.user?.balanceCents === 1000 - expectedPriceCents, {
    priceCents: generation?.priceCents,
    consumedAmountCents: generation?.consumedAmountCents,
    refundedAmountCents: generation?.refundedAmountCents,
    balanceCents: generationBody?.user?.balanceCents
  });
  assertCheck('generate:images', Array.isArray(generation?.images) && generation.images.length === generatedCount
    && generation?.metadata?.returnedCount === generatedCount
    && generation?.metadata?.failedCount === 0, {
    imageCount: generation?.images?.length,
    returnedCount: generation?.metadata?.returnedCount,
    failedCount: generation?.metadata?.failedCount
  });
  const generationId = generation.id;
  if (!skipFailover) {
    const { body: logsBody } = await requestOk(appBaseUrl, `/api/admin/generation-logs?limit=10&q=${encodeURIComponent(generationId)}`, {
      headers: { cookie: admin.cookie }
    });
    const log = Array.isArray(logsBody?.logs) ? logsBody.logs.find((item) => item.id === generationId) : null;
    const attempts = Array.isArray(log?.upstreamAttempts) ? log.upstreamAttempts : [];
    assertCheck('dispatch:failover-to-secondary', logsBody?.success === true
      && log?.upstreamName === 'Smoke 备用通道'
      && attempts.some((item) => item.success === false && item.name === 'Smoke 主通道故障')
      && attempts.some((item) => item.success === true && item.name === 'Smoke 备用通道'), {
      upstreamName: log?.upstreamName,
      attempts
    });
  }

  const { body: historyBody } = await requestOk(appBaseUrl, '/api/history?limit=5', {
    headers: { cookie: testUser.cookie }
  });
  assertCheck('history:list-includes-generation', historyBody?.success === true
    && Array.isArray(historyBody.generations)
    && historyBody.generations.some((item) => item.id === generationId), {
    total: historyBody?.total
  });

  const { body: historyDetailBody } = await requestOk(appBaseUrl, `/api/history/${generationId}`, {
    headers: { cookie: testUser.cookie }
  });
  assertCheck('history:detail', historyDetailBody?.success === true && historyDetailBody?.generation?.id === generationId, {
    status: historyDetailBody?.generation?.status
  });

  for (let index = 0; index < generatedCount; index += 1) {
    const imageResult = await requestOk(appBaseUrl, `/api/history/${generationId}/image/${index}`, {
      headers: { cookie: testUser.cookie }
    });
    const contentType = imageResult.response.headers.get('content-type') || '';
    assertCheck(`history:image-${index}`, contentType.includes('image/png') && imageResult.byteLength > 0, {
      contentType,
      bytes: imageResult.byteLength
    });
  }

  const { body: postBody } = await requestOk(appBaseUrl, '/api/community/posts', {
    method: 'POST',
    headers: { cookie: testUser.cookie },
    body: JSON.stringify({
      generationId,
      title: `E2E 国风联动自定义标题 ${testRunId}`,
      description: '用于验证交流区缩略图不会覆盖固定模板文案。',
      tags: ['国风', '宣传']
    })
  });
  const post = postBody?.post;
  assertCheck('community:publish', postBody?.success === true && post?.generationId === generationId, {
    postId: post?.id,
    imageCount: post?.images?.length
  });

  const { body: studioTemplatesBody } = await requestOk(appBaseUrl, '/api/community/studio-templates');
  const expectedStudioTemplates = new Map([
    ['guofeng-campaign', {
      title: '周芷若联动宣传图',
      prompt: '周芷若联动宣传图，国风角色联动，红金渐变背景，现代广告构图，人物占比突出，无文字，无水印'
    }],
    ['porcelain-museum', {
      title: '青花瓷博物馆图鉴',
      prompt: '青花瓷博物馆图鉴，蓝白瓷器，展陈空间，柔和自然光，文物摄影质感，高级画册风格，无文字'
    }],
    ['poster-character', {
      title: '卡芙卡轮廓宇宙海报',
      prompt: '卡芙卡轮廓宇宙海报，电影感构图，深紫色星云，人物剪影，细腻光影，高清细节，无文字，无水印'
    }],
    ['game-scene', {
      title: '地平线8深圳实机图',
      prompt: '地平线8深圳实机图，未来城市，航拍视角，高速运动感，蓝橙色调，写实游戏截图，无文字'
    }]
  ]);
  const studioTemplates = Array.isArray(studioTemplatesBody?.templates) ? studioTemplatesBody.templates : [];
  const matchedGuofengTemplate = studioTemplates.find((item) => item.id === 'guofeng-campaign');
  assertCheck('community:studio-template-copy-remains-fixed', studioTemplatesBody?.success === true
    && studioTemplates.length === expectedStudioTemplates.size
    && studioTemplates.every((item) => {
      const expected = expectedStudioTemplates.get(item.id);
      return expected && item.title === expected.title && item.prompt === expected.prompt;
    })
    && matchedGuofengTemplate?.source === 'community'
    && matchedGuofengTemplate?.postId === post.id
    && Boolean(matchedGuofengTemplate?.imageUrl), {
    templates: studioTemplates.map((item) => ({
      id: item.id,
      source: item.source,
      postId: item.postId,
      title: item.title,
      prompt: item.prompt
    }))
  });

  const duplicatePost = await request(appBaseUrl, '/api/community/posts', {
    method: 'POST',
    headers: { cookie: testUser.cookie },
    body: JSON.stringify({ generationId })
  });
  assertCheck('community:duplicate-publish-guard', duplicatePost.response.status === 409 && duplicatePost.body?.code === 'already_published', {
    status: duplicatePost.response.status,
    code: duplicatePost.body?.code
  });

  const { body: postsBody } = await requestOk(appBaseUrl, '/api/community/posts?limit=5', {
    headers: { cookie: testUser.cookie }
  });
  assertCheck('community:list-includes-post', postsBody?.success === true
    && Array.isArray(postsBody.posts)
    && postsBody.posts.some((item) => item.id === post.id), {
    returned: postsBody?.posts?.length
  });

  const { body: postDetailBody } = await requestOk(appBaseUrl, `/api/community/posts/${post.id}`, {
    headers: { cookie: testUser.cookie }
  });
  assertCheck('community:detail', postDetailBody?.success === true && postDetailBody?.post?.id === post.id, {
    commentCount: postDetailBody?.post?.comments?.length
  });

  const viewer = await login(appBaseUrl, viewerAccount, userPassword);
  const { body: likedBody } = await requestOk(appBaseUrl, `/api/community/posts/${post.id}/like`, {
    method: 'POST',
    headers: { cookie: viewer.cookie },
    body: JSON.stringify({ includeComments: true })
  });
  assertCheck('community:viewer-like', likedBody?.success === true
    && likedBody?.liked === true
    && likedBody?.post?.liked === true
    && likedBody?.post?.likeCount === 1, {
    liked: likedBody?.liked,
    postLiked: likedBody?.post?.liked,
    likeCount: likedBody?.post?.likeCount
  });

  const { body: commentedBody } = await requestOk(appBaseUrl, `/api/community/posts/${post.id}/comments`, {
    method: 'POST',
    headers: { cookie: viewer.cookie },
    body: JSON.stringify({ body: `E2E 评论 ${testRunId}` })
  });
  assertCheck('community:viewer-comment', commentedBody?.success === true
    && commentedBody?.comment?.body === `E2E 评论 ${testRunId}`
    && commentedBody?.post?.commentCount === 1
    && Array.isArray(commentedBody?.post?.comments)
    && commentedBody.post.comments.some((item) => item.id === commentedBody.comment.id), {
    commentCount: commentedBody?.post?.commentCount,
    comments: commentedBody?.post?.comments?.length
  });

  const { body: tippedBody } = await requestOk(appBaseUrl, `/api/community/posts/${post.id}/tip`, {
    method: 'POST',
    headers: { cookie: viewer.cookie },
    body: JSON.stringify({ amountCents: 10 })
  });
  assertCheck('community:viewer-tip', tippedBody?.success === true
    && tippedBody?.amountCents === 10
    && tippedBody?.user?.balanceCents === 490
    && tippedBody?.post?.hasTipped === true
    && tippedBody?.post?.tipTotalCents === 10, {
    amountCents: tippedBody?.amountCents,
    viewerBalanceCents: tippedBody?.user?.balanceCents,
    hasTipped: tippedBody?.post?.hasTipped,
    tipTotalCents: tippedBody?.post?.tipTotalCents
  });

  const communityDownload = await requestOk(appBaseUrl, `/api/community/posts/${post.id}/download/0`, {
    headers: { cookie: viewer.cookie }
  });
  const communityDownloadType = communityDownload.response.headers.get('content-type') || '';
  assertCheck('community:viewer-free-download', communityDownloadType.includes('image/png') && communityDownload.byteLength > 0, {
    contentType: communityDownloadType,
    bytes: communityDownload.byteLength
  });

  const downloadCountResult = await waitForCheck('community:download-count', async () => {
    const { body } = await requestOk(appBaseUrl, `/api/community/posts/${post.id}`, {
      headers: { cookie: viewer.cookie }
    });
    return {
      ok: body?.post?.downloadCount === 1,
      body,
      detail: `downloadCount=${body?.post?.downloadCount}`
    };
  });
  assertCheck('community:viewer-interaction-detail', downloadCountResult.body?.success === true
    && downloadCountResult.body?.post?.likeCount === 1
    && downloadCountResult.body?.post?.commentCount === 1
    && downloadCountResult.body?.post?.downloadCount === 1
    && Number(downloadCountResult.body?.post?.hotScore || 0) > 0, {
    likeCount: downloadCountResult.body?.post?.likeCount,
    commentCount: downloadCountResult.body?.post?.commentCount,
    downloadCount: downloadCountResult.body?.post?.downloadCount,
    hotScore: downloadCountResult.body?.post?.hotScore
  });

  const { body: authorMeBody } = await requestOk(appBaseUrl, '/api/me', {
    headers: { cookie: testUser.cookie }
  });
  assertCheck('community:tip-credited-author', authorMeBody?.success === true
    && authorMeBody?.user?.balanceCents === 1000 - expectedPriceCents + 10, {
    balanceCents: authorMeBody?.user?.balanceCents,
    expected: 1000 - expectedPriceCents + 10
  });

  const { body: hotPostsBody } = await requestOk(appBaseUrl, '/api/community/posts?sort=hot&limit=5', {
    headers: { cookie: viewer.cookie }
  });
  const hotPost = Array.isArray(hotPostsBody?.posts) ? hotPostsBody.posts.find((item) => item.id === post.id) : null;
  assertCheck('community:hot-ranking-reflects-like-comment', hotPostsBody?.success === true
    && hotPost?.likeCount === 1
    && hotPost?.commentCount === 1
    && Number(hotPost?.hotScore || 0) > 0, {
    likeCount: hotPost?.likeCount,
    commentCount: hotPost?.commentCount,
    hotScore: hotPost?.hotScore
  });

  const sourceDataUrl = `data:image/png;base64,${ONE_BY_ONE_PNG_BASE64}`;
  const { body: editBody } = await requestOk(appBaseUrl, '/api/generate', {
    method: 'POST',
    headers: { cookie: testUser.cookie },
    body: JSON.stringify({
      prompt: `E2E 图生图源图 ${testRunId}`,
      quality: '1k',
      size: '1024x1024',
      outputFormat: 'png',
      count: 1,
      imageDataUrls: [sourceDataUrl]
    })
  });
  const editGeneration = editBody?.generation;
  const expectedBalanceAfterEdit = 1000 - expectedPriceCents + 10 - 100;
  assertCheck('edit:succeeded-with-source-image', editBody?.success === true
    && editGeneration?.status === 'succeeded'
    && editGeneration?.mode === 'edit'
    && Array.isArray(editGeneration?.sourceImages)
    && editGeneration.sourceImages.length === 1
    && editBody?.user?.balanceCents === expectedBalanceAfterEdit, {
    status: editGeneration?.status,
    mode: editGeneration?.mode,
    sourceImageCount: editGeneration?.sourceImages?.length,
    balanceCents: editBody?.user?.balanceCents
  });

  const editGenerationId = editGeneration.id;
  const privateHistorySourceUrl = editGeneration?.sourceImages?.[0]?.imageUrl || '';
  assertCheck('history:edit-source-url-is-private', privateHistorySourceUrl.includes(`/api/history/${encodeURIComponent(editGenerationId)}/source/0`), {
    privateHistorySourceUrl
  });

  const historySourceResult = await requestOk(appBaseUrl, privateHistorySourceUrl, {
    headers: { cookie: testUser.cookie }
  });
  const historySourceType = historySourceResult.response.headers.get('content-type') || '';
  assertCheck('history:edit-source-image-downloads-for-owner', historySourceType.includes('image/png') && historySourceResult.byteLength > 0, {
    contentType: historySourceType,
    bytes: historySourceResult.byteLength
  });

  const otherUserHistorySource = await request(appBaseUrl, privateHistorySourceUrl, {
    headers: { cookie: viewer.cookie }
  });
  assertCheck('history:edit-source-image-rejects-other-user', otherUserHistorySource.response.status === 404, {
    status: otherUserHistorySource.response.status,
    message: otherUserHistorySource.body?.message
  });

  const anonymousHistorySource = await request(appBaseUrl, privateHistorySourceUrl);
  assertCheck('history:edit-source-image-rejects-anonymous', anonymousHistorySource.response.status === 401, {
    status: anonymousHistorySource.response.status,
    message: anonymousHistorySource.body?.message
  });

  const { body: editPostBody } = await requestOk(appBaseUrl, '/api/community/posts', {
    method: 'POST',
    headers: { cookie: testUser.cookie },
    body: JSON.stringify({
      generationId: editGenerationId,
      title: `E2E 图生图源图 ${testRunId}`,
      showSourceImages: true
    })
  });
  const editPost = editPostBody?.post;
  assertCheck('community:publish-edit-with-source-image', editPostBody?.success === true
    && editPost?.generationId === editGenerationId
    && editPost?.showSourceImages === true
    && Array.isArray(editPost?.sourceImages)
    && editPost.sourceImages.length === 1, {
    postId: editPost?.id,
    showSourceImages: editPost?.showSourceImages,
    sourceImageCount: editPost?.sourceImages?.length
  });

  const { body: editPostDetailBody } = await requestOk(appBaseUrl, `/api/community/posts/${editPost.id}`, {
    headers: { cookie: testUser.cookie }
  });
  const sourceImageUrl = editPostDetailBody?.post?.sourceImages?.[0]?.imageUrl || '';
  assertCheck('community:edit-source-visible-in-detail', editPostDetailBody?.success === true
    && editPostDetailBody?.post?.id === editPost.id
    && editPostDetailBody?.post?.showSourceImages === true
    && sourceImageUrl.includes(`/api/community/generations/${encodeURIComponent(editGenerationId)}/source/0`), {
    sourceImageUrl,
    sourceImageCount: editPostDetailBody?.post?.sourceImages?.length
  });

  const sourceImageResult = await requestOk(appBaseUrl, sourceImageUrl, {
    headers: { cookie: testUser.cookie }
  });
  const sourceContentType = sourceImageResult.response.headers.get('content-type') || '';
  assertCheck('community:edit-source-image-downloads', sourceContentType.includes('image/png') && sourceImageResult.byteLength > 0, {
    contentType: sourceContentType,
    bytes: sourceImageResult.byteLength
  });

  const { body: apiKeyBody } = await requestOk(appBaseUrl, '/api/api-keys', {
    method: 'POST',
    headers: { cookie: testUser.cookie },
    body: JSON.stringify({ name: `E2E ${testRunId}` })
  });
  const apiKey = apiKeyBody?.key || '';
  assertCheck('api-key:create', apiKeyBody?.success === true && apiKey.startsWith('sk-img-'), {
    keyPrefix: apiKey.slice(0, 10)
  });

  const { body: apiGenerationBody } = await requestOk(appBaseUrl, '/v1/images/generations', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      prompt: `E2E API Key 生图 ${testRunId}`,
      quality: '1k',
      size: '1024x1024',
      output_format: 'png',
      n: 1
    })
  });
  const apiImageUrl = apiGenerationBody?.data?.[0]?.url || '';
  const expectedBalanceAfterApiGeneration = expectedBalanceAfterEdit - 100;
  assertCheck('api:generation-openai-compatible', apiGenerationBody?.object === 'image.generation'
    && apiGenerationBody?.mode === 'generate'
    && Array.isArray(apiGenerationBody?.data)
    && apiGenerationBody.data.length === 1
    && Boolean(apiImageUrl)
    && apiGenerationBody?.balance_cents === expectedBalanceAfterApiGeneration, {
    object: apiGenerationBody?.object,
    mode: apiGenerationBody?.mode,
    imageCount: apiGenerationBody?.data?.length,
    balanceCents: apiGenerationBody?.balance_cents,
    expectedBalanceCents: expectedBalanceAfterApiGeneration,
    apiImageUrl
  });

  const apiImageResult = await requestOk(appBaseUrl, apiImageUrl, {
    headers: { authorization: `Bearer ${apiKey}` }
  });
  const apiImageContentType = apiImageResult.response.headers.get('content-type') || '';
  assertCheck('api:generation-url-downloads-with-bearer', apiImageContentType.includes('image/png') && apiImageResult.byteLength > 0, {
    contentType: apiImageContentType,
    bytes: apiImageResult.byteLength
  });

  const apiGenerationId = apiGenerationBody?.id || '';
  const { body: historyBeforeDeleteBody } = await requestOk(appBaseUrl, '/api/history?limit=20&status=unpublished', {
    headers: { cookie: testUser.cookie }
  });
  assertCheck('history:delete-target-visible', historyBeforeDeleteBody?.success === true
    && Array.isArray(historyBeforeDeleteBody.generations)
    && historyBeforeDeleteBody.generations.some((item) => item.id === apiGenerationId), {
    apiGenerationId,
    total: historyBeforeDeleteBody?.total
  });

  const { body: deletedHistoryBody } = await requestOk(appBaseUrl, `/api/history/${encodeURIComponent(apiGenerationId)}`, {
    method: 'DELETE',
    headers: { cookie: testUser.cookie }
  });
  assertCheck('history:delete-succeeds', deletedHistoryBody?.success === true && deletedHistoryBody?.deleted === 1, {
    deleted: deletedHistoryBody?.deleted
  });

  const { body: historyAfterDeleteBody } = await requestOk(appBaseUrl, '/api/history?limit=20', {
    headers: { cookie: testUser.cookie }
  });
  assertCheck('history:deleted-item-disappears', historyAfterDeleteBody?.success === true
    && Array.isArray(historyAfterDeleteBody.generations)
    && !historyAfterDeleteBody.generations.some((item) => item.id === apiGenerationId), {
    apiGenerationId,
    total: historyAfterDeleteBody?.total,
    ids: historyAfterDeleteBody?.generations?.map((item) => item.id)
  });

  const { body: firstHistoryPage } = await requestOk(appBaseUrl, '/api/history?limit=1&offset=0', {
    headers: { cookie: testUser.cookie }
  });
  const { body: secondHistoryPage } = await requestOk(appBaseUrl, '/api/history?limit=1&offset=1', {
    headers: { cookie: testUser.cookie }
  });
  assertCheck('history:pagination', firstHistoryPage?.success === true
    && secondHistoryPage?.success === true
    && firstHistoryPage?.returned === 1
    && secondHistoryPage?.returned === 1
    && firstHistoryPage?.hasMore === true
    && firstHistoryPage?.nextOffset === 1
    && secondHistoryPage?.offset === 1
    && firstHistoryPage?.generations?.[0]?.id !== secondHistoryPage?.generations?.[0]?.id, {
    first: firstHistoryPage?.generations?.[0]?.id,
    second: secondHistoryPage?.generations?.[0]?.id,
    total: firstHistoryPage?.total,
    nextOffset: firstHistoryPage?.nextOffset,
    secondOffset: secondHistoryPage?.offset
  });

  const { body: userBeforeInvalidImageBody } = await requestOk(appBaseUrl, '/api/me', {
    headers: { cookie: testUser.cookie }
  });
  const balanceBeforeInvalidImage = Number(userBeforeInvalidImageBody?.user?.balanceCents || 0);
  await configureSingleImageUpstream(appBaseUrl, admin.cookie, invalidImageUpstreamBaseUrl, {
    id: 'smoke-invalid-image',
    name: 'Smoke 破图通道',
    model: 'smoke-invalid-image-model'
  });
  const invalidImageGeneration = await request(appBaseUrl, '/api/generate', {
    method: 'POST',
    headers: { cookie: testUser.cookie },
    body: JSON.stringify({
      prompt: `E2E 上游破图退款 ${testRunId}`,
      quality: '1k',
      size: '1024x1024',
      outputFormat: 'png',
      count: 1
    })
  });
  assertCheck('generate:invalid-upstream-image-fails-and-refunds', invalidImageGeneration.response.status >= 500
    && invalidImageGeneration.body?.success === false
    && invalidImageGeneration.body?.generation?.status === 'failed'
    && invalidImageGeneration.body?.generation?.consumedAmountCents === 100
    && invalidImageGeneration.body?.generation?.remainingAmountCents === 0
    && invalidImageGeneration.body?.user?.balanceCents === balanceBeforeInvalidImage, {
    status: invalidImageGeneration.response.status,
    message: invalidImageGeneration.body?.message,
    generationStatus: invalidImageGeneration.body?.generation?.status,
    consumedAmountCents: invalidImageGeneration.body?.generation?.consumedAmountCents,
    refundedAmountCents: invalidImageGeneration.body?.generation?.refundedAmountCents,
    remainingAmountCents: invalidImageGeneration.body?.generation?.remainingAmountCents,
    balanceBeforeInvalidImage,
    balanceAfterInvalidImage: invalidImageGeneration.body?.user?.balanceCents
  });

  const successfulGenerationRequests = fakeUpstreamRequests.filter((item) => item.name === 'secondary-ok' && item.path === '/v1/images/generations');
  const failedGenerationRequests = fakeUpstreamRequests.filter((item) => item.name === 'primary-down' && item.path === '/v1/images/generations');
  const successfulEditRequests = fakeUpstreamRequests.filter((item) => item.name === 'secondary-ok' && item.path === '/v1/images/edits');
  const failedEditRequests = fakeUpstreamRequests.filter((item) => item.name === 'primary-down' && item.path === '/v1/images/edits');
  assertCheck('fake-upstream:request-count', successfulGenerationRequests.length === generatedCount + 1
    && successfulEditRequests.length === 1
    && (skipFailover || failedGenerationRequests.length >= 1), {
    successfulRequests: successfulGenerationRequests.length,
    failedRequests: failedGenerationRequests.length,
    successfulEditRequests: successfulEditRequests.length,
    failedEditRequests: failedEditRequests.length,
    requests: fakeUpstreamRequests
  });

  const report = {
    ok: checks.every((item) => item.ok),
    sourceRoot,
    tempRoot: keepTemp ? tempRoot : undefined,
    appBaseUrl,
    healthyUpstreamBaseUrl,
    failingUpstreamBaseUrl,
    generatedCount,
    generationId,
    postId: post.id,
    editGenerationId,
    editPostId: editPost.id,
    checkedAt: new Date().toISOString(),
    checks
  };
  console.log(JSON.stringify(report, null, 2));
}

try {
  await main();
} catch (error) {
  record('smoke:generation-flow', false, {
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
  for (const cleanup of cleanupTasks.reverse()) {
    try {
      await cleanup();
    } catch {
      // Best-effort cleanup only.
    }
  }
}
