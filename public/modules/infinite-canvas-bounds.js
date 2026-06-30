import { canvasNodeBounds } from './infinite-canvas-renderer.js';

export function createCanvasBoundsCache(nodes = []) {
  return new Map(nodes.filter((node) => node?.id).map((node) => [node.id, canvasNodeBounds(node)]));
}

export function canvasBoundsByNode(cache, node) {
  if (!node?.id || !(cache instanceof Map)) return canvasNodeBounds(node);
  let bounds = cache.get(node.id);
  if (!bounds) {
    bounds = canvasNodeBounds(node);
    cache.set(node.id, bounds);
  }
  return bounds;
}

export function setCanvasNodeBounds(cache, node) {
  if (!node?.id || !(cache instanceof Map)) return;
  cache.set(node.id, canvasNodeBounds(node));
}

export function canvasContentBounds(nodes = [], cache = null) {
  if (!Array.isArray(nodes) || !nodes.length) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  let hasNode = false;
  nodes.forEach((node) => {
    const bounds = canvasBoundsByNode(cache, node);
    if (!bounds) return;
    hasNode = true;
    left = Math.min(left, bounds.left);
    top = Math.min(top, bounds.top);
    right = Math.max(right, bounds.right);
    bottom = Math.max(bottom, bounds.bottom);
  });
  if (!hasNode) return null;
  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top)
  };
}
