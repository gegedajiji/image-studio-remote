import { state } from './state.js';
import { $ } from './dom.js';
import { renderReferencePreview } from './source-images.js';

let callbacks = {
  setStatus: () => {},
  syncModalState: () => {}
};

export function initSelectionMask(nextCallbacks = {}) {
  callbacks = { ...callbacks, ...nextCallbacks };
}

function getSelectionCanvasPoint(event) {
  const canvas = $('selectionCanvas');
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))
  };
}

function drawSelectionPath(ctx, path, width, height, color) {
  if (!path?.points?.length) return;
  const brush = Math.max(4, (path.brush || state.selectionBrush || 42) * Math.min(width, height) / 900);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = brush;
  const [first, ...rest] = path.points;
  ctx.beginPath();
  ctx.moveTo(first.x * width, first.y * height);
  if (!rest.length) {
    ctx.arc(first.x * width, first.y * height, brush / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    rest.forEach((point) => ctx.lineTo(point.x * width, point.y * height));
    ctx.stroke();
  }
  ctx.restore();
}

async function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片读取失败'));
    image.src = src;
  });
}

export async function redrawSelectionCanvas() {
  const canvas = $('selectionCanvas');
  if (!canvas || !state.selectionImageDataUrl) return;
  const image = await loadImageElement(state.selectionImageDataUrl);
  const wrap = canvas.parentElement;
  const maxWidth = Math.max(1, wrap?.clientWidth || 900);
  const maxHeight = Math.max(1, wrap?.clientHeight || Math.min(620, window.innerHeight - 220));
  const ratio = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight, 1);
  canvas.width = Math.max(1, Math.round(image.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * ratio));
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  if (state.selectionPaths.length) {
    ctx.fillStyle = 'rgba(15, 23, 42, 0.12)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    state.selectionPaths.forEach((path) => drawSelectionPath(ctx, path, canvas.width, canvas.height, 'rgba(62, 108, 255, 0.48)'));
  }
}

export function openSelectionModal(src = state.imageDataUrl) {
  if (!src) return callbacks.setStatus('请先上传或引用一张源图。', true);
  if (state.selectionImageDataUrl !== src) {
    state.selectionPaths = [];
  }
  state.selectionImageDataUrl = src;
  $('selectionModal')?.classList.add('open');
  $('selectionModal')?.setAttribute('aria-hidden', 'false');
  callbacks.syncModalState();
  redrawSelectionCanvas().catch((error) => callbacks.setStatus(error.message, true));
}

export function closeSelectionModal() {
  $('selectionModal')?.classList.remove('open');
  $('selectionModal')?.setAttribute('aria-hidden', 'true');
  state.selectionDrawing = false;
  callbacks.syncModalState();
}

async function saveSelectionMask() {
  if (!state.selectionPaths.length) {
    state.sourceImages = state.sourceImages.map((item) => (
      item.id === state.activeSourceId ? { ...item, maskDataUrl: '' } : item
    ));
    state.maskDataUrl = '';
    state.maskSourceDataUrl = '';
    closeSelectionModal();
    renderReferencePreview();
    callbacks.setStatus('已清空选区遮罩。');
    return;
  }
  const image = await loadImageElement(state.selectionImageDataUrl);
  const mask = document.createElement('canvas');
  mask.width = image.naturalWidth;
  mask.height = image.naturalHeight;
  const ctx = mask.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, mask.width, mask.height);
  ctx.globalCompositeOperation = 'destination-out';
  state.selectionPaths.forEach((path) => drawSelectionPath(ctx, path, mask.width, mask.height, '#000000'));
  const maskDataUrl = mask.toDataURL('image/png');
  state.sourceImages = state.sourceImages.map((item) => (
    item.id === state.activeSourceId ? { ...item, maskDataUrl } : item
  ));
  state.maskDataUrl = maskDataUrl;
  state.maskSourceDataUrl = state.selectionImageDataUrl;
  closeSelectionModal();
  renderReferencePreview();
  callbacks.setStatus('选区遮罩已保存，提交图生图时会一起使用。');
}

export function bindSelectionMaskEvents() {
  $('selectionCloseBtn').onclick = closeSelectionModal;
  $('selectionModal').onclick = (event) => {
    if (event.target === $('selectionModal')) closeSelectionModal();
  };
  $('selectionBrush').oninput = () => {
    state.selectionBrush = Number($('selectionBrush').value || 42);
  };
  $('selectionUndoBtn').onclick = () => {
    state.selectionPaths.pop();
    redrawSelectionCanvas().catch((error) => callbacks.setStatus(error.message, true));
  };
  $('selectionClearBtn').onclick = () => {
    state.selectionPaths = [];
    redrawSelectionCanvas().catch((error) => callbacks.setStatus(error.message, true));
  };
  $('selectionSaveBtn').onclick = () => {
    saveSelectionMask().catch((error) => callbacks.setStatus(error.message, true));
  };
  $('selectionCanvas').addEventListener('pointerdown', (event) => {
    if (!state.selectionImageDataUrl) return;
    const point = getSelectionCanvasPoint(event);
    state.selectionDrawing = true;
    state.selectionBrush = Number($('selectionBrush').value || 42);
    state.selectionPaths.push({ brush: state.selectionBrush, points: [point] });
    $('selectionCanvas').setPointerCapture?.(event.pointerId);
    redrawSelectionCanvas().catch((error) => callbacks.setStatus(error.message, true));
  });
  $('selectionCanvas').addEventListener('pointermove', (event) => {
    if (!state.selectionDrawing) return;
    const activePath = state.selectionPaths[state.selectionPaths.length - 1];
    activePath.points.push(getSelectionCanvasPoint(event));
    redrawSelectionCanvas().catch((error) => callbacks.setStatus(error.message, true));
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((eventName) => {
    $('selectionCanvas').addEventListener(eventName, () => {
      state.selectionDrawing = false;
    });
  });
}
