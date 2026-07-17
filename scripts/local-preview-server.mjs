import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', 'public');
const port = Number(process.env.PORT || 4174);

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
};

const templates = [
  ['guofeng-campaign', '国风宣发', '周芷若联动宣传图', '/assets/templates/guofeng-campaign.jpg'],
  ['porcelain-museum', '博物馆图鉴', '青花瓷博物馆图鉴', '/assets/templates/porcelain-museum.jpg'],
  ['poster-character', '人物海报', '卡芙卡轮廓宇宙海报', '/assets/templates/poster-character.jpg'],
  ['game-scene', '游戏场景', '地平线8深圳实机图', '/assets/templates/game-scene.jpg']
].map(([id, label, title, imageUrl], index) => ({
  id,
  label,
  title,
  description: `${title} 模板缩略图`,
  prompt: title,
  source: 'fallback',
  hotScore: 100 - index,
  imageUrl
}));

function json(res, payload, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function sendFile(res, pathname) {
  const clean = pathname === '/' ? '/home.html' : pathname;
  const filePath = path.resolve(root, clean.replace(/^\/+/, ''));
  if (!filePath.startsWith(root)) return json(res, { success: false, message: 'not found' }, 404);
  try {
    const body = await fs.readFile(filePath);
    res.writeHead(200, {
      'content-type': mime[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': filePath.endsWith('.html') ? 'no-store' : 'public, max-age=60'
    });
    res.end(body);
  } catch {
    json(res, { success: false, message: 'not found' }, 404);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  if (url.pathname === '/api/health') {
    return json(res, {
      success: true,
      imageReady: true,
      textReady: true,
      store: 'preview'
    });
  }
  if (url.pathname === '/api/me') {
    return json(res, {
      success: true,
      user: null,
      prices: { '1k': 100, '2k': 200 },
      qualities: ['1k', '2k'],
      sizes: ['1024x1024', '1536x1024', '1024x1536'],
      outputFormats: ['jpeg', 'png', 'webp'],
      counts: [1, 2, 4]
    });
  }
  if (url.pathname === '/api/community/studio-templates') return json(res, { success: true, templates });
  if (url.pathname === '/api/community/tags') return json(res, { success: true, tags: [] });
  if (url.pathname === '/api/history') return json(res, { success: true, generations: [] });
  if (url.pathname === '/api/community/posts') return json(res, { success: true, posts: [] });
  if (['/image', '/image/history', '/image/workspace', '/prompts', '/api-docs', '/developers', '/agent', '/settings', '/admin'].includes(url.pathname)) {
    return sendFile(res, '/index.html');
  }
  return sendFile(res, url.pathname);
});

server.listen(port, () => {
  console.log(`preview http://127.0.0.1:${port}`);
});
