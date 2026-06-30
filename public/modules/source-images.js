import { state } from './state.js';
import { $ } from './dom.js';
import { MAX_STUDIO_SOURCE_IMAGES } from './constants.js';
import { escapeHtml } from './format.js';
import { scheduleResultLayoutSettle } from './workspace-ui.js';

let callbacks = {
  setMode: () => {},
  setStatus: () => {},
  openSelectionModal: () => {}
};

export function initSourceImages(nextCallbacks = {}) {
  callbacks = { ...callbacks, ...nextCallbacks };
}

function newSourceId() {
  return `source-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function clearSelectionMask() {
  state.maskDataUrl = '';
  state.maskSourceDataUrl = '';
  state.selectionImageDataUrl = '';
  state.selectionPaths = [];
  state.selectionDrawing = false;
}

function syncActiveSourceFromLegacy() {
  if (!state.imageDataUrl) return;
  if (!state.sourceImages.length) {
    const id = newSourceId();
    state.sourceImages = [{
      id,
      dataUrl: state.imageDataUrl,
      maskDataUrl: state.maskDataUrl || '',
      label: '源图 1'
    }];
    state.activeSourceId = id;
  }
}

export function activeSourceImage() {
  syncActiveSourceFromLegacy();
  return state.sourceImages.find((item) => item.id === state.activeSourceId) || state.sourceImages[0] || null;
}

export function syncActiveReference() {
  const active = state.sourceImages.find((item) => item.id === state.activeSourceId) || state.sourceImages[0] || null;
  state.activeSourceId = active?.id || '';
  state.imageDataUrl = active?.dataUrl || '';
  state.maskDataUrl = active?.maskDataUrl || '';
  state.maskSourceDataUrl = state.maskDataUrl ? state.imageDataUrl : '';
}

export function currentImageDataUrls() {
  syncActiveReference();
  return state.sourceImages.map((item) => item.dataUrl).filter(Boolean);
}

export function hasActiveMask() {
  syncActiveReference();
  return Boolean(state.maskDataUrl && state.maskSourceDataUrl && state.maskSourceDataUrl === state.imageDataUrl);
}

export function syncSourceImageStateClass() {
  document.body.classList.toggle('has-source-image', currentImageDataUrls().length > 0);
}

function applyModeFromSources() {
  callbacks.setMode(currentImageDataUrls().length ? 'edit' : 'generate');
}

export function setActiveSource(id) {
  if (!state.sourceImages.some((item) => item.id === id)) return;
  state.activeSourceId = id;
  clearSelectionMask();
  syncActiveReference();
  renderReferencePreview();
}

export function addReferenceImage(dataUrl, { replace = false, label = '' } = {}) {
  if (!dataUrl) return false;
  if (!replace && state.sourceImages.length >= MAX_STUDIO_SOURCE_IMAGES) return false;
  const item = {
    id: newSourceId(),
    dataUrl,
    maskDataUrl: '',
    label: label || '当前源图'
  };
  state.sourceImages = replace ? [item] : [...state.sourceImages, item].slice(0, MAX_STUDIO_SOURCE_IMAGES);
  state.activeSourceId = item.id;
  clearSelectionMask();
  syncActiveReference();
  applyModeFromSources();
  return true;
}

export function clearReferenceImage() {
  state.imageDataUrl = '';
  state.sourceImages = [];
  state.activeSourceId = '';
  clearSelectionMask();
  if ($('imageInput')) $('imageInput').value = '';
  applyModeFromSources();
}

export function removeReferenceImage(id) {
  state.sourceImages = state.sourceImages.filter((item) => item.id !== id);
  if (state.activeSourceId === id) state.activeSourceId = state.sourceImages[0]?.id || '';
  clearSelectionMask();
  syncActiveReference();
  applyModeFromSources();
}

export function renderReferencePreview() {
  syncActiveReference();
  syncSourceImageStateClass();
  const referencePreview = $('referencePreview');
  if (!referencePreview) return;
  if (!state.imageDataUrl) {
    clearSelectionMask();
    referencePreview.innerHTML = '';
    referencePreview.classList.remove('visible');
    syncSourceImageStateClass();
    scheduleResultLayoutSettle();
    return;
  }
  const active = activeSourceImage();
  referencePreview.innerHTML = `
    <div class="reference-head">
      <div class="reference-head-copy">
        <strong>源图</strong>
        <span>${hasActiveMask() ? '当前源图已保存选区，可继续局部重绘' : '单张源图模式，可替换当前源图并继续编辑'}</span>
      </div>
      <label class="text-button source-add-button" for="imageInput">替换源图</label>
    </div>
    <div class="source-strip">
      <article class="source-card active source-card-single" data-source-id="${escapeHtml(active?.id || '')}">
        <button class="source-thumb" type="button" data-source-select="${escapeHtml(active?.id || '')}" aria-label="查看当前源图">
          <img src="${active?.dataUrl || ''}" alt="当前源图" />
          ${active?.maskDataUrl ? '<em>选区</em>' : ''}
        </button>
        <div>
          <strong>${escapeHtml(active?.label || '当前源图')}</strong>
          <span>${active?.maskDataUrl ? '已保存选区，继续编辑时会一并提交' : '当前编辑源图'}</span>
        </div>
        <button class="source-remove" type="button" data-source-remove="${escapeHtml(active?.id || '')}" aria-label="移除当前源图">&times;</button>
      </article>
    </div>
    <div class="reference-actions">
      <button class="text-button" id="selectionEditBtn" type="button">选区编辑</button>
      <button class="text-button" id="clearImageBtn" type="button">清空源图</button>
    </div>
  `;
  referencePreview.classList.toggle('visible', state.mode === 'edit');
  syncSourceImageStateClass();
  scheduleResultLayoutSettle();
  $('selectionEditBtn').onclick = () => callbacks.openSelectionModal();
  $('clearImageBtn').onclick = () => {
    clearReferenceImage();
    renderReferencePreview();
  };
  document.querySelectorAll('[data-source-select]').forEach((button) => {
    button.onclick = () => setActiveSource(button.dataset.sourceSelect);
  });
  document.querySelectorAll('[data-source-remove]').forEach((button) => {
    button.onclick = (event) => {
      event.stopPropagation();
      removeReferenceImage(button.dataset.sourceRemove);
      renderReferencePreview();
    };
  });
}

export async function readImageFiles(files) {
  const selectedFiles = Array.from(files || []).slice(0, 1);
  const incoming = selectedFiles.slice(0, MAX_STUDIO_SOURCE_IMAGES);
  if (!incoming.length) return;
  clearReferenceImage();
  for (const file of incoming) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      callbacks.setStatus('只支持常见图片格式。', true);
      if ($('imageInput')) $('imageInput').value = '';
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      callbacks.setStatus('图片不能超过 12 兆。', true);
      if ($('imageInput')) $('imageInput').value = '';
      return;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.readAsDataURL(file);
    });
    if (!addReferenceImage(dataUrl, { replace: true, label: file.name || '当前源图' })) {
      if ($('imageInput')) $('imageInput').value = '';
      callbacks.setStatus('源图加载失败，请重试。', true);
      return;
    }
  }
  callbacks.setMode('edit');
  renderReferencePreview();
  callbacks.setStatus('源图已更新。');
}

export async function readImageFile(file) {
  await readImageFiles(file ? [file] : []);
}
