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
  canvasNodeById,
  createCanvasNodeIndex
} from './infinite-canvas-index.js';
import {
  canvasBoundsByNode,
  canvasContentBounds,
  createCanvasBoundsCache,
  setCanvasNodeBounds
} from './infinite-canvas-bounds.js';
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
  canvasNodeSearchText,
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
  nodeIndex: createCanvasNodeIndex(),
  boundsCache: createCanvasBoundsCache(),
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
let lastCanvasStageKey = '';
let lastCanvasVisibleCount = 0;
const pendingAssetNodeIds = new Set();
let hasRenderedCanvas = false;
let canvasLoaded = false;
let canvasLoadPromise = null;
const canvasUiState = {
  search: '',
  kindFilter: 'all'
};
const minCanvasStageWidth = 2400;
const minCanvasStageHeight = 1800;
const canvasStagePadding = 640;
const canvasSave = createCanvasSaveScheduler({
  save: () => writeCanvasState(canvasState),
  onError: () => callbacks.onStatus('画布已更新，但浏览器本地存储空间不足，刷新后可能无法保留。', true)
});

function canvasFilterQuery() {
  return String(canvasUiState.search || '').trim().toLowerCase();
}

function syncCanvasFilterControls() {
  const search = $('canvasSearchInput');
  if (search && search.value !== canvasUiState.search) search.value = canvasUiState.search;
  document.querySelectorAll('[data-canvas-kind-filter]').forEach((button) => {
    button.classList.toggle('active', button.dataset.canvasKindFilter === canvasUiState.kindFilter);
  });
}

function setCanvasSearch(value = '') {
  canvasUiState.search = String(value || '').slice(0, 120);
  syncCanvasFilterControls();
}

function setCanvasKindFilter(kind = 'all') {
  canvasUiState.kindFilter = ['all', 'image', 'video'].includes(kind) ? kind : 'all';
  syncCanvasFilterControls();
}

function canvasNodeMatchesFilter(node) {
  if (!node) return false;
  if (node.id === canvasState.selectedId) return true;
  if (canvasUiState.kindFilter !== 'all' && node.kind !== canvasUiState.kindFilter) return false;
  const query = canvasFilterQuery();
  if (!query) return true;
  return canvasNodeSearchText(node).includes(query);
}

function syncCanvasStageDimensions(force = false) {
  const stage = $('infiniteCanvasStage');
  if (!stage) return;
  const viewport = $('infiniteCanvasViewport');
  const viewportRect = viewport?.getBoundingClientRect();
  const bounds = canvasContentBounds(canvasState.nodes, canvasState.boundsCache);
  const width = Math.max(
    minCanvasStageWidth,
    Math.ceil((viewportRect?.width || 0) * 1.5) || minCanvasStageWidth,
    Math.ceil((bounds?.right || 0) + canvasStagePadding)
  );
  const height = Math.max(
    minCanvasStageHeight,
    Math.ceil((viewportRect?.height || 0) * 1.5) || minCanvasStageHeight,
    Math.ceil((bounds?.bottom || 0) + canvasStagePadding)
  );
  const stageKey = `${width}x${height}`;
  if (!force && stageKey === lastCanvasStageKey) return;
  lastCanvasStageKey = stageKey;
  stage.style.setProperty('--canvas-stage-width', `${width}px`);
  stage.style.setProperty('--canvas-stage-height', `${height}px`);
}

function selectedNode() {
  return canvasNodeById(canvasState.nodeIndex, canvasState.selectedId);
}

function syncCanvasNodeIndex() {
  canvasState.nodeIndex = createCanvasNodeIndex(canvasState.nodes);
}

function syncCanvasBoundsCache() {
  canvasState.boundsCache = createCanvasBoundsCache(canvasState.nodes);
}

async function readCanvas() {
  const data = await readCanvasState(canvasState);
  canvasState.nodes = data.nodes;
  syncCanvasNodeIndex();
  syncCanvasBoundsCache();
  canvasState.viewport = data.viewport;
  syncCanvasStageDimensions(true);
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
  const filtered = Boolean(canvasUiState.search.trim() || canvasUiState.kindFilter !== 'all');
  const chromeKey = `${Math.round(canvasState.viewport.scale * 100)}:${canvasState.nodes.length}:${lastCanvasVisibleCount}:${selected?.id || ''}:${canvasUiState.search}:${canvasUiState.kindFilter}`;
  if (chromeKey !== lastChromeKey) {
    lastChromeKey = chromeKey;
    if (zoomLabel) zoomLabel.textContent = `${Math.round(canvasState.viewport.scale * 100)}%`;
    if (status) {
      const visibleCount = filtered ? lastCanvasVisibleCount : (lastCanvasVisibleCount || canvasState.nodes.length);
      status.textContent = canvasStatusText(canvasState.nodes.length, visibleCount, filtered);
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
  lastCanvasVisibleCount = visibleIds.size;
  syncCanvasStageDimensions();
  const visibleNodes = canvasState.nodes.filter((node) => visibleIds.has(node.id));
  if (!hasRenderedCanvas) {
    if (!renderCanvasNodes(visibleNodes, selectedId)) return;
    hasRenderedCanvas = true;
  } else {
    syncCanvasNodeElements(visibleNodes, visibleIds, selectedId);
  }
  lastVisibleKey = visibleKey(visibleIds);
  lastSelectedNodeId = selectedId;
  loadVisibleNodeAssets(visibleIds);
  applyViewport();
  syncSelectedNodeClass();
  updateCanvasChrome();
}

function currentVisibleNodeIds() {
  return visibleCanvasNodeIds(
    canvasState.nodes,
    $('infiniteCanvasViewport'),
    canvasState.viewport,
    canvasState.selectedId,
    canvasState.boundsCache,
    canvasNodeMatchesFilter
  );
}

function visibleKey(ids) {
  return [...ids].sort().join('|');
}

function syncVisibleNodesNow() {
  visibleFrameId = 0;
  if (!hasRenderedCanvas) return;
  const visibleIds = currentVisibleNodeIds();
  lastCanvasVisibleCount = visibleIds.size;
  const nextKey = visibleKey(visibleIds);
  if (nextKey === lastVisibleKey) return;
  lastVisibleKey = nextKey;
  syncCanvasNodeElements(canvasState.nodes, visibleIds, canvasState.selectedId);
  loadVisibleNodeAssets(visibleIds);
  syncSelectedNodeClass();
}

function loadVisibleNodeAssets(visibleIds) {
  visibleIds.forEach((id) => {
    const node = canvasNodeById(canvasState.nodeIndex, id);
    if (!node || node.kind === 'video' || !node.imageRef || node.src || pendingAssetNodeIds.has(id)) return;
    pendingAssetNodeIds.add(id);
    getCanvasAsset(node.imageRef)
      .then((src) => {
        if (!src) return;
        const current = canvasNodeById(canvasState.nodeIndex, id);
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
  const node = canvasNodeById(canvasState.nodeIndex, id);
  applyNodePositionElement(node);
}

function updateNodeSizeElement(id) {
  const node = canvasNodeById(canvasState.nodeIndex, id);
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
  const node = canvasNodeById(canvasState.nodeIndex, id);
  canvasState.nodes = canvasState.nodes.filter((node) => node.id !== id);
  syncCanvasNodeIndex();
  canvasState.boundsCache.delete(id);
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
  const bounds = canvasContentBounds(canvasState.nodes, canvasState.boundsCache) || {
    left: 0,
    top: 0,
    right: rect.width,
    bottom: rect.height,
    width: rect.width,
    height: rect.height
  };
  const contentWidth = Math.max(1, bounds.width || (bounds.right - bounds.left));
  const contentHeight = Math.max(1, bounds.height || (bounds.bottom - bounds.top));
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
  setCanvasNodeBounds(canvasState.boundsCache, node);
  updateNodeSizeElement(node.id);
  syncCanvasStageDimensions();
  updateCanvasChrome();
  canvasSave.scheduleSave();
}

async function clearCanvas() {
  await ensureCanvasLoaded();
  if (!canvasState.nodes.length) return;
  if (!window.confirm('确认清空当前无限画布？')) return;
  await Promise.all(canvasState.nodes.filter((node) => node.imageRef).map((node) => deleteCanvasAsset(node.imageRef)));
  canvasState.nodes = [];
  syncCanvasNodeIndex();
  canvasState.boundsCache = createCanvasBoundsCache();
  canvasState.selectedId = '';
  syncCanvasStageDimensions(true);
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
    const node = canvasNodeById(canvasState.nodeIndex, nodeElement.dataset.canvasNode);
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
    const node = canvasNodeById(canvasState.nodeIndex, dragState.nodeId);
    if (!node) return;
    node.x = dragState.originX + dx / canvasState.viewport.scale;
    node.y = dragState.originY + dy / canvasState.viewport.scale;
    setCanvasNodeBounds(canvasState.boundsCache, node);
    syncCanvasStageDimensions();
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
  $('canvasSearchInput')?.addEventListener('input', (event) => {
    setCanvasSearch(event.target.value || '');
    lastVisibleKey = '';
    renderCanvas();
  });
  $('canvasSearchInput')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    setCanvasSearch('');
    lastVisibleKey = '';
    renderCanvas();
    event.currentTarget?.blur?.();
  });
  document.querySelectorAll('[data-canvas-kind-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      setCanvasKindFilter(button.dataset.canvasKindFilter || 'all');
      lastVisibleKey = '';
      renderCanvas();
    });
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
  syncCanvasFilterControls();
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
    syncCanvasFilterControls();
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
  syncCanvasNodeIndex();
  removedNodes.forEach((oldNode) => canvasState.boundsCache.delete(oldNode.id));
  setCanvasNodeBounds(canvasState.boundsCache, runtimeNode);
  canvasState.selectedId = runtimeNode.id;
  syncCanvasStageDimensions();
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
