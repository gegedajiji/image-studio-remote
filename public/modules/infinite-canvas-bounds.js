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
