import { isPrivateProxyIp } from '../src/imageProxySafety.js';

const checks = [];

function record(name, ok, detail = {}) {
  const item = { ...detail, name, ok: Boolean(ok) };
  checks.push(item);
  if (!item.ok) process.exitCode = 1;
}

function expectPrivate(address) {
  record(`private:${address}`, isPrivateProxyIp(address) === true, {
    address,
    actual: isPrivateProxyIp(address)
  });
}

function expectPublic(address) {
  record(`public:${address}`, isPrivateProxyIp(address) === false, {
    address,
    actual: isPrivateProxyIp(address)
  });
}

[
  '',
  '0.0.0.0',
  '10.0.0.1',
  '100.64.0.1',
  '127.0.0.1',
  '169.254.1.2',
  '172.16.0.1',
  '192.168.1.1',
  '198.18.0.1',
  '224.0.0.1',
  '::',
  '::1',
  'fc00::1',
  'fd12:3456::1',
  'fe80::1',
  'ff02::1',
  '2001:db8::1',
  '::ffff:127.0.0.1',
  '::ffff:10.0.0.1',
  '::ffff:192.168.1.10',
  '::ffff:7f00:1',
  '::ffff:0a00:1',
  '::7f00:1',
  '64:ff9b::7f00:1',
  '2002:0a00:0001::'
].forEach(expectPrivate);

[
  '1.1.1.1',
  '8.8.8.8',
  '93.184.216.34',
  '2606:4700:4700::1111',
  '2001:4860:4860::8888',
  '::ffff:8.8.8.8',
  '::ffff:0808:0808',
  '64:ff9b::0808:0808'
].forEach(expectPublic);

const ok = checks.every((item) => item.ok);
console.log(JSON.stringify({
  ok,
  checkedAt: new Date().toISOString(),
  checks
}, null, 2));

if (!ok) process.exit(1);
