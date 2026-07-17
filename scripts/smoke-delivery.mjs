import { createHash } from 'node:crypto';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const arg = process.argv[index];
  if (!arg.startsWith('--')) continue;
  const [key, inlineValue] = arg.slice(2).split('=');
  const value = inlineValue ?? process.argv[index + 1];
  if (inlineValue === undefined) index += 1;
  args.set(key, value);
}

const baseUrl = String(args.get('base') || process.env.SMOKE_BASE_URL || 'http://127.0.0.1:8790').replace(/\/+$/, '');
const adminAccount = String(args.get('admin-account') || process.env.ADMIN_ACCOUNT || '');
const adminPassword = String(args.get('admin-password') || process.env.ADMIN_PASSWORD || '');
const allowMissingAdmin = args.has('allow-missing-admin') || process.env.SMOKE_ALLOW_MISSING_ADMIN === '1';
const expectedHomeHashes = new Map([
  ['/', '6d08b1a3a7d2e021c7a17cadcc08acf414a90bd6939ecf5bee00460d9d1350f1'],
  ['/home.html', '6d08b1a3a7d2e021c7a17cadcc08acf414a90bd6939ecf5bee00460d9d1350f1'],
  ['/home.css?v=2026062924', '60c472e35ea9351c33a40b12e16e14f44f946131ee22744e803aae13fdc6195b'],
  ['/home.js?v=2026062924', '95be25d6a1de3f410e2bd64bf24b4f8edefe50dc3fadb73da10621843c809908']
]);

const checks = [];

function record(name, ok, detail = {}) {
  checks.push({ ...detail, name, ok: Boolean(ok) });
  if (!ok) process.exitCode = 1;
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: 'manual',
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const contentType = response.headers.get('content-type') || '';
  const raw = await response.text();
  const body = contentType.includes('application/json') && raw ? JSON.parse(raw) : raw;
  if (!response.ok) {
    const message = typeof body === 'object' ? body.message || JSON.stringify(body) : raw.slice(0, 240);
    throw new Error(`${path} returned ${response.status}: ${message}`);
  }
  return { response, body };
}

async function checkJson(path, predicate, name = path, options = {}) {
  try {
    const { body } = await request(path, options);
    record(name, predicate(body), { status: 'ok' });
    return body;
  } catch (error) {
    record(name, false, { error: error.message });
    return null;
  }
}

async function checkHtmlRoute(path) {
  try {
    const { body } = await request(path);
    record(`route:${path}`, typeof body === 'string' && body.includes('有鱼生图'), { status: 'ok' });
  } catch (error) {
    record(`route:${path}`, false, { error: error.message });
  }
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function checkStaticHash(path, expectedHash) {
  try {
    const { body } = await request(path);
    const actualHash = sha256(String(body));
    record(`static-hash:${path}`, actualHash === expectedHash, {
      actualHash,
      expectedHash
    });
  } catch (error) {
    record(`static-hash:${path}`, false, { error: error.message });
  }
}

let cookie = '';
if (adminAccount && adminPassword) {
  try {
    const { response, body } = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ account: adminAccount, password: adminPassword })
    });
    cookie = response.headers.get('set-cookie')?.split(';')[0] || '';
    record('auth:admin-login', Boolean(body?.success && cookie), {
      user: body?.user?.account || body?.user?.username || null,
      role: body?.user?.role || null
    });
  } catch (error) {
    record('auth:admin-login', false, { error: error.message });
  }
} else {
  record('auth:admin-login', allowMissingAdmin, { skipped: 'missing admin credentials' });
}

for (const [path, hash] of expectedHomeHashes) {
  await checkStaticHash(path, hash);
}

await checkHtmlRoute('/');
await checkHtmlRoute('/app');
await checkHtmlRoute('/community');
await checkHtmlRoute('/admin/redeem');

await checkJson('/api/health', (body) => body?.success === true && body?.generationQueue && Number.isFinite(Number(body.generationQueue.active)));
await checkJson('/api/community/posts?limit=3', (body) => body?.success === true && Array.isArray(body.posts));
await checkJson('/api/community/studio-templates', (body) => body?.success === true && Array.isArray(body.templates) && body.templates.length >= 1);

if (cookie) {
  const authHeaders = { cookie };
  await checkJson('/api/me', (body) => body?.success === true && body?.user?.id, '/api/me', { headers: authHeaders });
  await checkJson('/api/history?limit=5', (body) => body?.success === true && Array.isArray(body.generations), '/api/history', { headers: authHeaders });
  await checkJson('/api/admin/overview', (body) => body?.success === true && Array.isArray(body.users) && body.billing && body.ai, '/api/admin/overview', { headers: authHeaders });
}

const report = {
  ok: checks.every((item) => item.ok),
  baseUrl,
  checkedAt: new Date().toISOString(),
  checks
};

console.log(JSON.stringify(report, null, 2));
