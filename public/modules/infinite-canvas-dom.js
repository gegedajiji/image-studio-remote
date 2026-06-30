import { $ } from './dom.js';
import { canvasNodeHtml, canvasNodeSelector } from './infinite-canvas-renderer.js';

export function canvasNodeElement(id) {
  if (!id) return null;
  return document.querySelector(canvasNodeSelector(id));
}

export function renderCanvasNodes(nodes = [], selectedId = '') {
  const content = $('infiniteCanvasContent');
  if (!content) return false;
  content.innerHTML = nodes.map((node) => canvasNodeHtml(node, selectedId)).join('');
  return true;
}

export function upsertCanvasNodeElement(node, selectedId = '') {
  const content = $('infiniteCanvasContent');
  if (!content || !node?.id) return false;
  const html = canvasNodeHtml(node, selectedId);
  const existing = canvasNodeElement(node.id);
  if (existing) existing.outerHTML = html;
  else content.insertAdjacentHTML('beforeend', html);
  return true;
}

export function removeCanvasNodeElement(id) {
  canvasNodeElement(id)?.remove();
}

export function clearCanvasElements() {
  const content = $('infiniteCanvasContent');
  if (content) content.innerHTML = '';
}

export function applyNodePositionElement(node) {
  const element = canvasNodeElement(node?.id);
  if (!node || !element) return;
  element.style.setProperty('--canvas-node-x', `${Number(node.x || 0)}px`);
  element.style.setProperty('--canvas-node-y', `${Number(node.y || 0)}px`);
}

export function applyNodeSizeElement(node) {
  const element = canvasNodeElement(node?.id);
  if (!node || !element) return;
  element.style.setProperty('--canvas-node-w', `${Number(node.width || 280)}px`);
}
