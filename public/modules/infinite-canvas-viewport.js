import { canvasNodeBounds } from './infinite-canvas-renderer.js';
import { canvasBoundsByNode } from './infinite-canvas-bounds.js';

const renderOverscanPx = 900;

export function visibleCanvasRect(viewportElement, viewport) {
  if (!viewportElement) return null;
  const rect = viewportElement.getBoundingClientRect();
  const scale = Number(viewport.scale || 1) || 1;
  return {
    left: (-Number(viewport.x || 0) - renderOverscanPx) / scale,
    top: (-Number(viewport.y || 0) - renderOverscanPx) / scale,
    right: (rect.width - Number(viewport.x || 0) + renderOverscanPx) / scale,
    bottom: (rect.height - Number(viewport.y || 0) + renderOverscanPx) / scale
  };
}

export function rectsIntersect(a, b) {
  return Boolean(a && b && a.left <= b.right && a.right >= b.left && a.top <= b.bottom && a.bottom >= b.top);
}

export function visibleCanvasNodes(nodes = [], viewportElement, viewport, selectedId = '', boundsCache = null, predicate = null) {
  const rect = visibleCanvasRect(viewportElement, viewport);
  if (!rect) return nodes;
  const matches = typeof predicate === 'function' ? predicate : null;
  return nodes.filter((node) => (
    node.id === selectedId
    || (
      (!matches || matches(node))
      && rectsIntersect(boundsCache ? canvasBoundsByNode(boundsCache, node) : canvasNodeBounds(node), rect)
    )
  ));
}

export function visibleCanvasNodeIds(nodes = [], viewportElement, viewport, selectedId = '', boundsCache = null, predicate = null) {
  return new Set(visibleCanvasNodes(nodes, viewportElement, viewport, selectedId, boundsCache, predicate).map((node) => node.id));
}
