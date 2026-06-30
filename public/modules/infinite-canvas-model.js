import {
  isLargeDataUrl,
  maxCanvasNodes,
  putCanvasAsset
} from './canvas-store.js';
import {
  clamp,
  maxNodeWidth,
  minNodeWidth
} from './infinite-canvas-renderer.js';

export function newCanvasId() {
  return `canvas-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function nextNodePosition(nodeCount = 0) {
  const offset = Number(nodeCount || 0) % 12;
  return {
    x: 220 + (offset % 4) * 330,
    y: 180 + Math.floor(offset / 4) * 360
  };
}

export async function createCanvasNode(payload = {}, kind = 'image', nodeCount = 0) {
  const nodeKind = kind === 'video' ? 'video' : 'image';
  const src = String(payload.src || '').trim();
  if (nodeKind === 'image' && !src) throw new Error('图片不存在，不能放到画布。');

  const id = newCanvasId();
  let storedSrc = src;
  let imageRef = '';
  if (nodeKind === 'image' && isLargeDataUrl(src)) {
    imageRef = `image:${id}`;
    const stored = await putCanvasAsset(imageRef, src);
    if (stored) storedSrc = '';
    else imageRef = '';
  }

  const position = nextNodePosition(nodeCount);
  const node = {
    id,
    kind: nodeKind,
    src: storedSrc,
    imageRef,
    title: String(payload.title || payload.prompt || (nodeKind === 'video' ? '文案视频' : '生成图片')).slice(0, 80),
    prompt: String(payload.prompt || '').slice(0, 1200),
    meta: String(payload.meta || (nodeKind === 'video' ? '视频生成占位' : '')).slice(0, 120),
    generationId: String(payload.generationId || ''),
    imageIndex: Number(payload.imageIndex || 0),
    videoId: String(payload.videoId || ''),
    x: position.x,
    y: position.y,
    width: Math.round(clamp(Number(payload.width || 286), minNodeWidth, maxNodeWidth))
  };

  return { ...node, src };
}

export function appendCanvasNode(nodes = [], node) {
  const nextNodes = [...nodes, node].slice(-maxCanvasNodes);
  const nextIds = new Set(nextNodes.map((item) => item.id));
  return {
    nodes: nextNodes,
    removedNodes: nodes.filter((oldNode) => !nextIds.has(oldNode.id))
  };
}
