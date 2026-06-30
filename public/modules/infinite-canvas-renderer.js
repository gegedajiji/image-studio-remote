import { escapeHtml } from './format.js';

export const minNodeWidth = 180;
export const maxNodeWidth = 620;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function nodeTitle(node) {
  return String(node?.title || node?.prompt || (node?.kind === 'video' ? '画布视频' : '画布图片'))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 42) || '画布图片';
}

export function nodeKindText(node) {
  return node?.kind === 'video' ? '视频节点' : '图片节点';
}

export function canvasStatusText(count) {
  return count
    ? `${count} 个节点 · 可拖拽排版，滚轮缩放`
    : '暂无图片，先从生成结果或历史记录放入画布。';
}

export function selectionSummaryHtml(node) {
  if (!node) return '';
  const width = Math.round(Number(node.width || 280));
  const meta = node.meta ? ` · ${node.meta}` : '';
  return `<strong>${escapeHtml(nodeTitle(node))}</strong><span>${escapeHtml(nodeKindText(node))} · ${width}px${escapeHtml(meta)}</span>`;
}

export function canvasNodeBounds(node) {
  const width = Number(node.width || 280);
  const mediaHeight = (node.kind === 'video') ? width * 9 / 16 : width;
  return {
    left: Number(node.x || 0),
    top: Number(node.y || 0),
    right: Number(node.x || 0) + width,
    bottom: Number(node.y || 0) + mediaHeight + 72
  };
}

export function canvasNodeSelector(id) {
  const value = String(id || '');
  const safeId = globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replaceAll('"', '\\"');
  return `[data-canvas-node="${safeId}"]`;
}

export function canvasNodeHtml(node, selectedId = '') {
  const src = node.src || '';
  const kind = node.kind || 'image';
  const brokenClass = kind === 'image' && !src ? ' is-missing-image' : '';
  return `
    <article
      class="infinite-canvas-node${brokenClass} ${node.id === selectedId ? 'is-selected' : ''}"
      data-canvas-node="${escapeHtml(node.id)}"
      data-canvas-kind="${escapeHtml(kind)}"
      style="--canvas-node-x:${Number(node.x || 0)}px;--canvas-node-y:${Number(node.y || 0)}px;--canvas-node-w:${Number(node.width || 280)}px"
    >
      ${kind === 'video'
        ? `<div class="canvas-video-placeholder"><strong>Video</strong><span>${escapeHtml(node.meta || '视频生成占位')}</span></div>`
        : src
          ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(nodeTitle(node))}" draggable="false" loading="lazy" />`
          : '<div class="canvas-node-image-missing">图片缓存已失效</div>'}
      <div class="canvas-node-caption">
        <strong>${escapeHtml(nodeTitle(node))}</strong>
        <span>${escapeHtml(node.meta || '生成图片')}</span>
      </div>
      <button class="canvas-node-remove" type="button" data-canvas-node-action="remove" aria-label="从画布移除">移除</button>
    </article>
  `;
}
