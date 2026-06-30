import { state } from './state.js';
import { $ } from './dom.js';
import { setStatus as defaultSetStatus } from './status-ui.js';
import { originalViewerMeta } from './studio-format.js';

let originalViewerEventsBound = false;
let setViewerStatus = defaultSetStatus;
let syncViewerModalState = () => {};

export function initOriginalViewerController(options = {}) {
  setViewerStatus = options.setStatus || defaultSetStatus;
  syncViewerModalState = options.syncModalState || (() => {});
  bindOriginalViewerEvents();
}

export function openOriginalViewer(src, item, index = 0) {
  if (!src) return setViewerStatus('图片不存在', true);
  bindOriginalViewerEvents();
  const modal = $('originalViewerModal');
  const image = $('originalViewerImage');
  const meta = $('originalViewerMeta');
  if (!modal || !image) {
    window.open(src, '_blank', 'noopener,noreferrer');
    return;
  }
  state.originalViewerSrc = src;
  state.originalViewerItem = item || null;
  state.originalViewerIndex = index || 0;
  modal.classList.remove('is-loaded', 'is-broken');
  modal.classList.add('is-loading');
  image.onload = () => {
    modal.classList.remove('is-loading', 'is-broken');
    modal.classList.add('is-loaded');
  };
  image.onerror = () => {
    modal.classList.remove('is-loading', 'is-loaded');
    modal.classList.add('is-broken');
  };
  image.removeAttribute('src');
  image.alt = `原尺寸图片 ${index + 1}`;
  image.dataset.originalSrc = src;
  if (meta) meta.textContent = originalViewerMeta(item, index);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  image.src = src;
  syncViewerModalState();
}

export function closeOriginalViewer() {
  const modal = $('originalViewerModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  const image = $('originalViewerImage');
  if (image) {
    image.onload = null;
    image.onerror = null;
    image.removeAttribute('src');
    delete image.dataset.originalSrc;
  }
  modal.classList.remove('is-loading', 'is-loaded', 'is-broken');
  state.originalViewerSrc = '';
  state.originalViewerItem = null;
  state.originalViewerIndex = 0;
  syncViewerModalState();
}

function retryOriginalViewerImage() {
  const image = $('originalViewerImage');
  const modal = $('originalViewerModal');
  const src = state.originalViewerSrc || image?.dataset.originalSrc || '';
  if (!image || !modal || !src) return;
  modal.classList.remove('is-loaded', 'is-broken');
  modal.classList.add('is-loading');
  const separator = src.includes('?') ? '&' : '?';
  image.src = `${src}${separator}retry=${Date.now()}`;
}

function openOriginalViewerInNewTab() {
  const src = state.originalViewerSrc || $('originalViewerImage')?.dataset.originalSrc || '';
  if (!src) return setViewerStatus('图片不存在', true);
  window.open(src, '_blank', 'noopener,noreferrer');
}

function bindOriginalViewerEvents() {
  if (originalViewerEventsBound) return;
  const modal = $('originalViewerModal');
  if (!modal) return;
  originalViewerEventsBound = true;
  $('originalViewerCloseBtn')?.addEventListener('click', closeOriginalViewer);
  $('originalViewerRetryBtn')?.addEventListener('click', retryOriginalViewerImage);
  $('originalViewerOpenBtn')?.addEventListener('click', openOriginalViewerInNewTab);
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeOriginalViewer();
  });
}
