import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const expectedHomeFiles = new Map([
  ['public/home.html', 'b85e471026ba6061aeb5bdf0921d928c3d5967bc1280248cde09262fbd76b7e1'],
  ['public/home.css', '8b604a985dc27befb05f4037832a8657e6e615806c34b1fde6297c9ef6cceec0'],
  ['public/home.js', '2bf1a428fa399e86abe326a5872d268cbbf14b278341a122ee91cb2702562377']
]);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

const root = process.cwd();
const results = [];

for (const [file, expectedHash] of expectedHomeFiles) {
  const absolutePath = path.join(root, file);
  const actualHash = sha256(await fs.readFile(absolutePath));
  const ok = actualHash === expectedHash;
  results.push({ file, ok, actualHash, expectedHash });
  if (!ok) process.exitCode = 1;
}

console.log(JSON.stringify({
  ok: results.every((item) => item.ok),
  checkedAt: new Date().toISOString(),
  results
}, null, 2));
