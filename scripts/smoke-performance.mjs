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
const concurrency = Math.max(1, Math.trunc(Number(args.get('concurrency') || process.env.SMOKE_CONCURRENCY || 8)));
const requests = Math.max(concurrency, Math.trunc(Number(args.get('requests') || process.env.SMOKE_REQUESTS || 80)));
const adminAccount = String(args.get('admin-account') || process.env.ADMIN_ACCOUNT || '');
const adminPassword = String(args.get('admin-password') || process.env.ADMIN_PASSWORD || '');

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index]);
}

async function timedFetch(path, options = {}) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.arrayBuffer();
  const durationMs = performance.now() - startedAt;
  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}: ${Buffer.from(body).toString('utf8').slice(0, 200)}`);
  }
  return { path, status: response.status, bytes: body.byteLength, durationMs };
}

async function loginCookie() {
  if (!adminAccount || !adminPassword) return '';
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ account: adminAccount, password: adminPassword })
  });
  if (!response.ok) throw new Error(`admin login returned ${response.status}`);
  return response.headers.get('set-cookie')?.split(';')[0] || '';
}

async function worker(id, jobs, results, cookie) {
  while (jobs.length) {
    const index = jobs.shift();
    const endpoint = endpoints[index % endpoints.length];
    const headers = endpoint.admin && cookie ? { cookie } : {};
    try {
      results.push(await timedFetch(endpoint.path, { headers }));
    } catch (error) {
      results.push({ path: endpoint.path, error: error.message, worker: id });
    }
  }
}

const cookie = await loginCookie();
const endpoints = [
  { path: '/api/health' },
  { path: '/styles.css?v=202606271930' },
  { path: '/assets/site-logo.png' }
];
if (cookie) endpoints.push({ path: '/api/admin/overview', admin: true });

const jobs = Array.from({ length: requests }, (_, index) => index);
const results = [];
await Promise.all(Array.from({ length: concurrency }, (_, index) => worker(index, jobs, results, cookie)));

const failures = results.filter((item) => item.error);
const successes = results.filter((item) => !item.error);
const durations = successes.map((item) => item.durationMs);
const byPath = {};
for (const item of successes) {
  byPath[item.path] ||= [];
  byPath[item.path].push(item.durationMs);
}

const report = {
  ok: failures.length === 0,
  baseUrl,
  requests,
  concurrency,
  successes: successes.length,
  failures: failures.slice(0, 10),
  latencyMs: {
    p50: percentile(durations, 50),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    max: Math.round(Math.max(0, ...durations))
  },
  endpoints: Object.fromEntries(Object.entries(byPath).map(([path, values]) => [path, {
    count: values.length,
    p95: percentile(values, 95),
    max: Math.round(Math.max(0, ...values))
  }]))
};

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
