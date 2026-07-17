const required = ['SMOKE_BASE_URL', 'ADMIN_ACCOUNT', 'ADMIN_PASSWORD'];
const missing = required.filter((name) => !String(process.env[name] || '').trim());

if (process.env.SMOKE_ALLOW_MISSING_ADMIN === '1') {
  console.error('SMOKE_ALLOW_MISSING_ADMIN=1 is not allowed for release gates.');
  process.exit(1);
}

if (missing.length) {
  console.error(`Missing release smoke environment: ${missing.join(', ')}`);
  console.error('Example: SMOKE_BASE_URL=https://image.twotop.icu ADMIN_ACCOUNT=... ADMIN_PASSWORD=... npm run gate:release');
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  checkedAt: new Date().toISOString(),
  baseUrl: process.env.SMOKE_BASE_URL,
  required
}, null, 2));
