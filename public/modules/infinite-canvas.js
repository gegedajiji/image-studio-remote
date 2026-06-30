import { $ } from './dom.js';
import {
  deleteCanvasAsset,
  getCanvasAsset,
  readCanvasState,
  writeCanvasState
} from './canvas-store.js';
import { createCanvasSaveScheduler } from './canvas-save-scheduler.js';
import {
  appendCanvasNode,
  createCanvasNode
} from './infinite-canvas-model.js';
import {
  applyNodePositionElement,
  applyNodeSizeElement,
  canvasNodeElement,
  clearCanvasElements,
  removeCanvasNodeElement,
  renderCanvasNodes,
  syncCanvasNodeElements,
  upsertCanvasNodeElement
} from './infinite-canvas-dom.js';
import {
  canvasNodeBounds,
  canvasStatusText,
  clamp,
  maxNodeWidth,
  minNodeWidth,
  nodeTitle,
  selectionSummaryHtml
} from './infinite-canvas-renderer.js';
import {
  visibleCanvasNodeIds
} from './infinite-canvas-viewport.js';

const canvasState = {
  nodes: [],
  selectedId: '',
  viewport: { x: 120, y: 90, scale: 0.78 }
};

let callbacks = {
  onStatus: () => {}
};
let initialized = false;
let dragState = null;
let viewportFrameId = 0;
let nodeFrameId = 0;
let visibleFrameId = 0;
const pendingNodePositionIds = new Set();
let lastChromeKey = '';
let lastSelectionKey = '';
let lastSelectedNodeId = '';
let lastVisibleKey = '';
const pendingAssetNodeIds = new Set();
let hasRenderedCanvas = false;
let canvasLoaded = false;
let canvasLoadPromise = null;
const canvasSave = createCanvasSaveScheduler({
  save: () => writeCanvasState(canvasState),
  onError: () => callbacks.onStatus('画布已更新，但浏览器本地存储空间不足，刷新后可能无法保留。', true)
});

function selectedNode() {
  return canvasState.nodes.find((item) => item.id === canvasState.selectedId) || null;
}

async function readCanvas() {
  const data = await readCanvasState(canvasState);
  canvasState.nodes = data.nodes;
  canvasState.viewport = data.viewport;
}

function ensureCanvasLoaded() {
  if (canvasLoaded) return Promise.resolve();
  if (!canvasLoadPromise) {
    canvasLoadPromise = readCanvas()
      .catch(() => {
        callbacks.onStatus('画布读取失败，已使用空白画布继续。', true);
      })
      .then(() => {
        canvasLoaded = true;
        renderCanvas();
      });
  }
  return canvasLoadPromise;
}

function updateCanvasChrome() {
  const panel = $('infiniteCanvasPanel');
  const zoomLabel = $('canvasZoomLabel');
  const status = $('canvasStatus');
  const selectionBar = $('canvasSelectionBar');
  const selected = selectedNode();
  const chromeKey = `${Math.round(canvasState.viewport.scale * 100)}:${canvasState.nodes.length}:${selected?.id || ''}`;
  if (chromeKey !== lastChromeKey) {
    lastChromeKey = chromeKey;
    if (zoomLabel) zoomLabel.textContent = `${Math.round(canvasState.viewport.scale * 100)}%`;
    if (status) {
      status.textContent = canvasStatusText(canvasState.nodes.length);
    }
    ['canvasNodeShrinkBtn', 'canvasNodeGrowBtn'].forEach((id) => {
      const button = $(id);
      if (button) button.disabled = !selected;
    });
  }
  if (selectionBar) {
    selectionBar.hidden = !selected;
    const selectionKey = selected
      ? `${selected.id}:${selected.width}:${selected.title}:${selected.meta}:${selected.kind}`
      : '';
    if (selectionKey !== lastSelectionKey) {
      lastSelectionKey = selectionKey;
      selectionBar.innerHTML = selectionSummaryHtml(selected);
    }
  }
  panel?.classList.toggle('is-empty', canvasState.nodes.length < 1);
}

function applyViewportNow() {
  const stage = $('infiniteCanvasStage');
  if (!stage) return;
  const { x, y, scale } = canvasState.viewport;
  stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  scheduleVisibleNodesSync();
  updateCanvasChrome();
}

function applyViewport() {
  if (viewportFrameId) return;
  viewportFrameId = window.requestAnimationFrame?.(() => {
    viewportFrameId = 0;
    applyViewportNow();
  }) || 0;
  if (!viewportFrameId) applyViewportNow();
}

function renderCanvas() {
  const selectedId = canvasState.selectedId;
  const visibleIds = currentVisibleNodeIds();
  if (!renderCanvasNodes(canvasState.nodes.filter((node) => visibleIds.has(node.id)), selectedId)) return;
  lastVisibleKey = visibleKey(visibleIds);
  hasRenderedCanvas = true;
  lastSelectedNodeId = selectedId;
  loadVisibleNodeAssets(visibleIds);
  applyViewport();
}

function currentVisibleNodeIds() {
  return visibleCanvasNodeIds(
    canvasState.nodes,
    $('infiniteCanvasViewport'),
    canvasState.viewport,
    canvasState.selectedId
  );
}

function visibleKey(ids) {
  return [...ids].sort().join('|');
}

function syncVisibleNodesNow() {
  visibleFrameId = 0;
  if (!hasRenderedCanvas) return;
  const visibleIds = currentVisibleNodeIds();
  const nextKey = visibleKey(visibleIds);
  if (nextKey === lastVisibleKey) return;
  lastVisibleKey = nextKey;
  syncCanvasNodeElements(canvasState.nodes, visibleIds, canvasState.selectedId);
  loadVisibleNodeAssets(visibleIds);
  syncSelectedNodeClass();
}

function loadVisibleNodeAssets(visibleIds) {
  visibleIds.forEach((id) => {
    const node = canvasState.nodes.find((item) => item.id === id);
    if (!node || node.kind === 'video' || !node.imageRef || node.src || pendingAssetNodeIds.has(id)) return;
    pendingAssetNodeIds.add(id);
    getCanvasAsset(node.imageRef)
      .then((src) => {
        if (!src) return;
        const current = canvasState.nodes.find((item) => item.id === id);
        if (!current) return;
        current.src = src;
        if (canvasNodeElement(id)) {
          upsertCanvasNodeElement(current, canvasState.selectedId);
          syncSelectedNodeClass();
        }
      })
      .finally(() => {
        pendingAssetNodeIds.delete(id);
      });
  });
}

function scheduleVisibleNodesSync() {
  if (visibleFrameId) return;
  visibleFrameId = window.requestAnimationFrame?.(syncVisibleNodesNow) || 0;
  if (!visibleFrameId) syncVisibleNodesNow();
}

function updateNodePositionElementNow(id) {
  const node = canvasState.nodes.find((item) => item.id === id);
  applyNodePositionElement(node);
}

function updateNodeSizeElement(id) {
  const node = canvasState.nodes.find((item) => item.id === id);
  applyNodeSizeElement(node);
}

function updateNodePositionElement(id) {
  if (!id) return;
  pendingNodePositionIds.add(id);
  if (nodeFrameId) return;
  nodeFrameId = window.requestAnimationFrame?.(() => {
    nodeFrameId = 0;
    const ids = [...pendingNodePositionIds];
    pendingNodePositionIds.clear();
    ids.forEach(updateNodePositionElementNow);
  }) || 0;
  if (!nodeFrameId) {
    const ids = [...pendingNodePositionIds];
    pendingNodePositionIds.clear();
    ids.forEach(updateNodePositionElementNow);
  }
}

function syncSelectedNodeClass() {
  if (lastSelectedNodeId && lastSelectedNodeId !== canvasState.selectedId) {
    canvasNodeElement(lastSelectedNodeId)?.classList.remove('is-selected');
  }
  if (canvasState.selectedId) {
    if (!canvasNodeElement(canvasState.selectedId)) {
      syncCanvasNodeElements(canvasState.nodes, currentVisibleNodeIds(), canvasState.selectedId);
    }
    canvasNodeElement(canvasState.selectedId)?.classList.add('is-selected');
  }
  lastSelectedNodeId = canvasState.selectedId;
  updateCanvasChrome();
}

function selectNode(id) {
  canvasState.selectedId = id || '';
  syncSelectedNodeClass();
}

async function removeNode(id) {
  const node = canvasState.nodes.find((item) => item.id === id);
  canvasState.nodes = canvasState.nodes.filter((node) => node.id !== id);
  if (canvasState.selectedId === id) canvasState.selectedId = '';
  if (node?.imageRef) await deleteCanvasAsset(node.imageRef);
  canvasSave.saveNow();
  if (hasRenderedCanvas) {
    removeCanvasNodeElement(id);
    syncSelectedNodeClass();
    updateCanvasChrome();
  } else {
    renderCanvas();
  }
}

function resetCanvasView() {
  canvasState.viewport = { x: 120, y: 90, scale: 0.78 };
  canvasSave.saveNow();
  applyViewportNow();
}

function fitCanvasView() {
  const viewport = $('infiniteCanvasViewport');
  if (!viewport || !canvasState.nodes.length) return resetCanvasView();
  const rect = viewport.getBoundingClientRect();
  const bounds = canvasState.nodes.reduce((acc, node) => {
    const item = canvasNodeBounds(node);
    return {
      left: Math.min(acc.left, item.left),
      top: Math.min(acc.top, item.top),
      right: Math.max(acc.right, item.right),
      bottom: Math.max(acc.bottom, item.bottom)
    };
  }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  const contentWidth = Math.max(1, bounds.right - bounds.left);
  const contentHeight = Math.max(1, bounds.bottom - bounds.top);
  const padding = 96;
  const scale = clamp(Math.min((rect.width - padding) / contentWidth, (rect.height - padding) / contentHeight), 0.28, 1.25);
  canvasState.viewport = {
    scale,
    x: Math.round((rect.width - contentWidth * scale) / 2 - bounds.left * scale),
    y: Math.round((rect.height - contentHeight * scale) / 2 - bounds.top * scale)
  };
  canvasSave.scheduleSave();
  applyViewportNow();
}

function resizeSelectedNode(multiplier) {
  const node = selectedNode();
  if (!node) return;
  node.width = Math.round(clamp(Number(node.width || 280) * multiplier, minNodeWidth, maxNodeWidth));
  updateNodeSizeElement(node.id);
  updateCanvasChrome();
  canvasSave.scheduleSave();
}

async function clearCanvas() {
  await ensureCanvasLoaded();
  if (!canvasState.nodes.length) return;
  if (!window.confirm('确认清空当前无限画布？')) return;
  canvasState.nodes.filter((node) => node.imageRef).forEach((node) => {
    deleteCanvasAsset(node.imageRef);
  });
  canvasState.nodes = [];
  canvasState.selectedId = '';
  canvasSave.saveNow();
  if (hasRenderedCanvas) {
    clearCanvasElements();
    updateCanvasChrome();
  } else {
    renderCanvas();
  }
  callbacks.onStatus('无限画布已清空。');
}

function setZoom(nextScale, origin = null) {
  const viewport = $('infiniteCanvasViewport');
  const currentScale = canvasState.viewport.scale;
  const scale = clamp(nextScale, 0.25, 2.4);
  if (!viewport || Math.abs(scale - currentScale) < 0.001) return;
  const rect = viewport.getBoundingClientRect();
  const originX = origin?.x ?? rect.width / 2;
  const originY = origin?.y ?? rect.height / 2;
  const boardX = (originX - canvasState.viewport.x) / currentScale;
  const boardY = (originY - canvasState.viewport.y) / currentScale;
  canvasState.viewport.x = originX - boardX * scale;
  canvasState.viewport.y = originY - boardY * scale;
  canvasState.viewport.scale = scale;
  canvasSave.scheduleSave();
  applyViewport();
}

function startDrag(event) {
  const viewport = $('infiniteCanvasViewport');
  if (!viewport || event.target.closest('[data-canvas-node-action]')) return;
  const nodeElement = event.target.closest('[data-canvas-node]');
  if (nodeElement) {
    const node = canvasState.nodes.find((item) => item.id === nodeElement.dataset.canvasNode);
    if (!node) return;
    canvasState.selectedId = node.id;
    dragState = {
      type: 'node',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      nodeId: node.id,
      originX: Number(node.x || 0),
      originY: Number(node.y || 0)
    };
  } else {
    canvasState.selectedId = '';
    dragState = {
      type: 'pan',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: canvasState.viewport.x,
      originY: canvasState.viewport.y
    };
  }
  viewport.setPointerCapture?.(event.pointerId);
  viewport.classList.add('is-dragging');
  syncSelectedNodeClass();
  event.preventDefault();
}

function moveDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  const dx = event.clientX - dragState.startX;
  const dy = event.clientY - dragState.startY;
  if (dragState.type === 'node') {
    const node = canvasState.nodes.find((item) => item.id === dragState.nodeId);
    if (!node) return;
    node.x = dragState.originX + dx / canvasState.viewport.scale;
    node.y = dragState.originY + dy / canvasState.viewport.scale;
    updateNodePositionElement(node.id);
    return;
  }
  canvasState.viewport.x = dragState.originX + dx;
  canvasState.viewport.y = dragState.originY + dy;
  applyViewport();
}

function endDrag(event) {
  if (!dragState || event.pointerId !== dragState.pointerId) return;
  if (dragState.type === 'node') updateNodePositionElementNow(dragState.nodeId);
  if (dragState.type === 'pan') applyViewportNow();
  $('infiniteCanvasViewport')?.classList.remove('is-dragging');
  dragState = null;
  canvasSave.scheduleSave();
}

function bindCanvasEvents() {
  const viewport = $('infiniteCanvasViewport');
  viewport?.addEventListener('pointerdown', startDrag);
  viewport?.addEventListener('pointermove', moveDrag);
  viewport?.addEventListener('pointerup', endDrag);
  viewport?.addEventListener('pointercancel', endDrag);
  viewport?.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const delta = event.deltaY > 0 ? 0.9 : 1.1;
    setZoom(canvasState.viewport.scale * delta, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    });
  }, { passive: false });
  $('infiniteCanvasContent')?.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-canvas-node-action="remove"]');
    if (removeButton) {
      const node = removeButton.closest('[data-canvas-node]');
      removeNode(node?.dataset.canvasNode || '');
      event.stopPropagation();
      return;
    }
    const node = event.target.closest('[data-canvas-node]');
    selectNode(node?.dataset.canvasNode || '');
  });
  $('canvasCloseBtn')?.addEventListener('click', closeInfiniteCanvas);
  $('canvasResetBtn')?.addEventListener('click', resetCanvasView);
  $('canvasFitBtn')?.addEventListener('click', fitCanvasView);
  $('canvasClearBtn')?.addEventListener('click', clearCanvas);
  $('canvasZoomInBtn')?.addEventListener('click', () => setZoom(canvasState.viewport.scale * 1.12));
  $('canvasZoomOutBtn')?.addEventListener('click', () => setZoom(canvasState.viewport.scale * 0.88));
  $('canvasNodeShrinkBtn')?.addEventListener('click', () => resizeSelectedNode(0.88));
  $('canvasNodeGrowBtn')?.addEventListener('click', () => resizeSelectedNode(1.12));
  document.addEventListener('keydown', (event) => {
    if (!$('infiniteCanvasPanel') || $('infiniteCanvasPanel').hidden || !canvasState.selectedId) return;
    const target = event.target;
    const editing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
    if (editing) return;
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      removeNode(canvasState.selectedId);
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      resizeSelectedNode(1.08);
      return;
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      resizeSelectedNode(0.92);
    }
  });
}

export function initInfiniteCanvas(options = {}) {
  callbacks = {
    ...callbacks,
    ...options
  };
  if (initialized) return;
  initialized = true;
  bindCanvasEvents();
}

export function openInfiniteCanvas() {
  const panel = $('infiniteCanvasPanel');
  if (!panel) return;
  panel.hidden = false;
  panel.setAttribute('aria-hidden', 'false');
  document.body.classList.add('infinite-canvas-open');
  ensureCanvasLoaded().then(() => {
    if (!hasRenderedCanvas) renderCanvas();
    else applyViewportNow();
    window.requestAnimationFrame?.(() => {
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

export function closeInfiniteCanvas() {
  const panel = $('infiniteCanvasPanel');
  if (!panel) return;
  panel.hidden = true;
  panel.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('infinite-canvas-open');
}

async function addNodeToCanvas(payload = {}, kind = 'image') {
  await ensureCanvasLoaded();
  const runtimeNode = await createCanvasNode(payload, kind, canvasState.nodes.length);
  const { nodes: nextNodes, removedNodes } = appendCanvasNode(canvasState.nodes, runtimeNode);
  removedNodes.filter((oldNode) => oldNode.imageRef).forEach((oldNode) => deleteCanvasAsset(oldNode.imageRef));
  canvasState.nodes = nextNodes;
  canvasState.selectedId = runtimeNode.id;
  canvasSave.saveNow();
  if (hasRenderedCanvas) {
    removedNodes.forEach((oldNode) => removeCanvasNodeElement(oldNode.id));
    lastVisibleKey = '';
    upsertCanvasNodeElement(runtimeNode, canvasState.selectedId);
    syncSelectedNodeClass();
    applyViewport();
  } else {
    renderCanvas();
  }
  return runtimeNode;
}

export async function addImageToCanvas(payload = {}) {
  return addNodeToCanvas(payload, 'image');
}

export async function addVideoToCanvas(payload = {}) {
  return addNodeToCanvas(payload, 'video');
}
