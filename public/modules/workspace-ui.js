import { state } from './state.js';
import { $ } from './dom.js';
import { composerHeightStorageKey, historyWidthStorageKey } from './constants.js';

let composerLayoutObserver = null;
let fallbackResizeListenerBound = false;
let resultLayoutFrameId = 0;
let resultLayoutSettleTimers = [];
let floatingMenuPortal = null;
let activeFloatingPill = null;
let activeFloatingMenu = null;
let floatingMenuFrameId = 0;

function syncComposerPadding(height) {
  document.body.classList.toggle('composer-expanded', Number(height || 0) > 176);
}

export function syncHistoryToggleLabel() {
  const button = $('collapseHistoryBtn');
  const label = button?.querySelector('span');
  if (!label) return;
  const isMobile = window.matchMedia('(max-width: 1180px)').matches;
  const text = state.activePanel !== 'studio'
    ? '展开历史'
    : isMobile
      ? (document.body.classList.contains('history-mobile-open') ? '关闭历史' : '展开历史')
      : (document.body.classList.contains('history-opened') ? '收起历史' : '展开历史');
  label.textContent = text;
  button.setAttribute('aria-label', text);
  button.title = text;
}

export function normalizeHistoryLayoutState() {
  const isMobile = window.matchMedia('(max-width: 1180px)').matches;
  if (state.activePanel !== 'studio') {
    document.body.classList.remove('history-opened', 'history-collapsed', 'history-mobile-open');
    syncHistoryToggleLabel();
    return;
  }
  if (isMobile) {
    document.body.classList.remove('history-opened', 'history-collapsed');
  } else {
    document.body.classList.remove('history-mobile-open');
    document.body.classList.toggle('history-collapsed', !document.body.classList.contains('history-opened'));
  }
  syncHistoryToggleLabel();
}

export function setHistoryWidth(width) {
  const maxWidth = window.innerWidth > 1460 ? 360 : 292;
  const value = Math.max(260, Math.min(maxWidth, Number.parseFloat(width) || 320));
  document.documentElement.style.setProperty('--history-width', `${Math.round(value)}px`);
  return value;
}

export function restoreHistoryWidth() {
  try {
    const stored = window.localStorage?.getItem(historyWidthStorageKey);
    if (stored) setHistoryWidth(stored);
  } catch {
    // localStorage can be blocked in restricted browser contexts.
  }
}

function syncComposerSafeArea() {
  const composer = $('create');
  if (!composer) return;
  const rect = composer.getBoundingClientRect();
  const height = Math.max(0, Math.round(rect.height || composer.offsetHeight || 0));
  const bottomInset = window.innerWidth > 1180
    ? Math.max(0, Math.round(window.innerHeight - rect.bottom))
    : 0;
  document.documentElement.style.setProperty('--composer-safe-space', `${Math.max(360, height + bottomInset + 96)}px`);
}

function liftResultPreviewAboveComposer() {
  if (window.innerWidth <= 1180) return;
  const workspace = document.querySelector('.workspace-content');
  const preview = $('preview');
  const composer = $('create');
  const thread = document.querySelector('.result-thread');
  if (!workspace || !preview || !composer || !thread) return;
  const hasVisibleResult = preview.classList.contains('has-result') || preview.classList.contains('loading') || thread.classList.contains('is-visible');
  if (!hasVisibleResult) return;
  const visualTarget = preview.querySelector('.result-image-frame, .single-result, .multi-result') || preview;
  const target = preview.classList.contains('has-result') ? visualTarget : thread;
  const previewRect = target.getBoundingClientRect();
  const composerRect = composer.getBoundingClientRect();
  const workspaceRect = workspace.getBoundingClientRect();
  const clearLine = Math.min(composerRect.top, workspaceRect.bottom) - 48;
  const overlap = previewRect.bottom - clearLine;
  if (overlap > 0) {
    workspace.scrollTop += Math.ceil(overlap);
    window.requestAnimationFrame?.(() => {
      const nextRect = target.getBoundingClientRect();
      const nextComposerRect = composer.getBoundingClientRect();
      const nextWorkspaceRect = workspace.getBoundingClientRect();
      const nextClearLine = Math.min(nextComposerRect.top, nextWorkspaceRect.bottom) - 48;
      const nextOverlap = nextRect.bottom - nextClearLine;
      if (nextOverlap > 0) workspace.scrollTop += Math.ceil(nextOverlap);
    });
    return;
  }
  if (previewRect.top < workspaceRect.top + 12 && workspace.scrollTop > 0) {
    workspace.scrollTop = Math.max(0, workspace.scrollTop - Math.ceil((workspaceRect.top + 12) - previewRect.top));
  }
}

export function scheduleResultLayoutSettle() {
  resultLayoutSettleTimers.forEach((timer) => window.clearTimeout(timer));
  resultLayoutSettleTimers = [];
  if (resultLayoutFrameId) {
    window.cancelAnimationFrame?.(resultLayoutFrameId);
    resultLayoutFrameId = 0;
  }
  syncComposerSafeArea();
  const settle = () => {
    syncComposerSafeArea();
    liftResultPreviewAboveComposer();
  };
  if (typeof window.requestAnimationFrame === 'function') {
    resultLayoutFrameId = window.requestAnimationFrame(() => {
      resultLayoutFrameId = 0;
      settle();
      window.requestAnimationFrame(settle);
    });
  }
  resultLayoutSettleTimers = [120, 360].map((delay) => window.setTimeout(settle, delay));
}

export function observeComposerLayout() {
  const composer = $('create');
  if (!composer) return;
  syncComposerSafeArea();
  composerLayoutObserver?.disconnect?.();
  if (typeof ResizeObserver === 'function') {
    composerLayoutObserver = new ResizeObserver(() => scheduleResultLayoutSettle());
    composerLayoutObserver.observe(composer);
  } else if (!fallbackResizeListenerBound) {
    fallbackResizeListenerBound = true;
    window.addEventListener('resize', scheduleResultLayoutSettle);
  }
}

export function bindStudioMotion() {
  // Visual hover motion is handled by CSS.
}

export function setComposerTextHeight(height) {
  const value = Math.max(104, Math.min(260, Number.parseFloat(height) || 128));
  document.documentElement.style.setProperty('--composer-textarea-height', `${Math.round(value)}px`);
  syncComposerPadding(value);
  window.requestAnimationFrame?.(syncComposerSafeArea);
  return value;
}

export function restoreComposerHeight() {
  try {
    const stored = window.localStorage?.getItem(composerHeightStorageKey);
    setComposerTextHeight(stored || 128);
  } catch {
    setComposerTextHeight(128);
  }
}

export function toggleComposerSize() {
  const prompt = $('prompt');
  const current = prompt?.getBoundingClientRect().height || 128;
  const expanded = current <= 176;
  const nextHeight = setComposerTextHeight(expanded ? 220 : 128);
  try {
    window.localStorage?.setItem(composerHeightStorageKey, `${Math.round(nextHeight)}px`);
  } catch {
    // localStorage can be blocked in restricted browser contexts.
  }
  const button = $('composerResizeBtn');
  if (button) {
    button.setAttribute('aria-label', expanded ? '收起输入区' : '展开输入区');
    button.title = expanded ? '收起输入区' : '展开输入区';
  }
}

export function bindComposerResize() {
  const handle = $('composerResizeBtn');
  const prompt = $('prompt');
  if (!handle || !prompt) return;
  let startY = 0;
  let startHeight = 128;
  let dragging = false;
  let moved = false;
  const finish = (event) => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('resizing-composer');
    handle.releasePointerCapture?.(event.pointerId);
    try {
      const height = getComputedStyle(document.documentElement).getPropertyValue('--composer-textarea-height').trim();
      window.localStorage?.setItem(composerHeightStorageKey, height);
    } catch {
      // localStorage can be blocked in restricted browser contexts.
    }
    if (moved) {
      handle.dataset.dragged = '1';
      window.setTimeout(() => {
        handle.dataset.dragged = '';
      }, 0);
    }
  };
  handle.addEventListener('pointerdown', (event) => {
    dragging = true;
    moved = false;
    startY = event.clientY;
    startHeight = prompt.getBoundingClientRect().height || 128;
    document.body.classList.add('resizing-composer');
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  handle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const delta = startY - event.clientY;
    if (Math.abs(delta) > 3) moved = true;
    if (moved) setComposerTextHeight(startHeight + delta);
  });
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('click', (event) => {
    if (handle.dataset.dragged === '1') {
      event.preventDefault();
      return;
    }
    toggleComposerSize();
  });
}

export function bindHistoryResize() {
  const handle = $('historyResizeHandle');
  if (!handle) return;
  let startX = 0;
  let startWidth = 320;
  let dragging = false;
  const finish = () => {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove('resizing-history');
    try {
      const width = getComputedStyle(document.documentElement).getPropertyValue('--history-width').trim();
      window.localStorage?.setItem(historyWidthStorageKey, width);
    } catch {
      // localStorage can be blocked in restricted browser contexts.
    }
  };
  handle.addEventListener('pointerdown', (event) => {
    if (window.matchMedia('(max-width: 1180px)').matches) return;
    dragging = true;
    startX = event.clientX;
    startWidth = $('historySection')?.getBoundingClientRect().width || 320;
    document.body.classList.add('resizing-history');
    handle.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  handle.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    setHistoryWidth(startWidth + event.clientX - startX);
  });
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
}

function floatingMenuButtonSelector(button) {
  if (!button) return '';
  const pairs = [
    ['data-size', button.dataset.size],
    ['data-quality', button.dataset.quality],
    ['data-format', button.dataset.format],
    ['data-count', button.dataset.count]
  ].filter(([, value]) => value !== undefined && value !== '');
  return pairs.map(([name, value]) => `[${name}="${CSS.escape(String(value))}"]`).join('');
}

function buildFloatingPillMenu(sourceMenu) {
  if (!sourceMenu) return null;
  const floatingMenu = sourceMenu.cloneNode(true);
  floatingMenu.classList.add('floating-pill-menu');
  floatingMenu.querySelectorAll('button').forEach((floatingButton, index) => {
    const sourceButton = sourceMenu.querySelector(floatingMenuButtonSelector(floatingButton))
      || sourceMenu.querySelectorAll('button')[index]
      || null;
    floatingButton.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      sourceButton?.click();
    };
  });
  return floatingMenu;
}

function resetFloatingPillMenu() {
  if (floatingMenuFrameId) {
    cancelAnimationFrame(floatingMenuFrameId);
    floatingMenuFrameId = 0;
  }
  if (activeFloatingMenu) {
    activeFloatingMenu.remove();
  }
  activeFloatingPill = null;
  activeFloatingMenu = null;
}

function positionFloatingPillMenu() {
  if (!activeFloatingPill || !activeFloatingMenu || !activeFloatingPill.classList.contains('open')) return;
  const pillRect = activeFloatingPill.getBoundingClientRect();
  const viewportWidth = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const viewportHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  const gutter = 12;
  const maxWidth = Math.max(180, viewportWidth - gutter * 2);
  const width = Math.min(Math.round(pillRect.width), maxWidth);
  const menuHeight = Math.min(activeFloatingMenu.scrollHeight || 220, Math.max(180, viewportHeight - gutter * 2));
  const opensUp = pillRect.bottom + 10 + menuHeight > viewportHeight && pillRect.top > viewportHeight - pillRect.bottom;
  const top = opensUp
    ? Math.max(gutter, pillRect.top - menuHeight - 10)
    : Math.min(viewportHeight - gutter - Math.min(menuHeight, viewportHeight - gutter * 2), pillRect.bottom + 10);
  const left = Math.min(
    Math.max(gutter, Math.round(pillRect.left)),
    viewportWidth - width - gutter
  );

  activeFloatingMenu.style.setProperty('--floating-menu-arrow-left', `${Math.max(18, Math.min((pillRect.left + pillRect.width / 2) - left, width - 18))}px`);
  activeFloatingMenu.style.left = `${left}px`;
  activeFloatingMenu.style.top = `${top}px`;
  activeFloatingMenu.style.width = `${width}px`;
  activeFloatingMenu.style.maxHeight = `${Math.min(360, viewportHeight - top - gutter)}px`;
  activeFloatingMenu.classList.toggle('opens-up', opensUp);
}

export function scheduleFloatingPillMenuPosition() {
  if (!activeFloatingMenu) return;
  if (floatingMenuFrameId) cancelAnimationFrame(floatingMenuFrameId);
  floatingMenuFrameId = requestAnimationFrame(() => {
    floatingMenuFrameId = 0;
    positionFloatingPillMenu();
  });
}

export function activateFloatingPillMenu(pill) {
  resetFloatingPillMenu();
  const sourceMenu = pill?.querySelector('.pill-menu');
  if (!pill || !sourceMenu) return;
  if (!floatingMenuPortal) {
    floatingMenuPortal = document.getElementById('floatingMenuPortal') || document.body;
  }
  const menu = buildFloatingPillMenu(sourceMenu);
  if (!menu) return;
  activeFloatingPill = pill;
  activeFloatingMenu = menu;
  menu.dataset.floatingMenu = pill.dataset.select || 'option';
  floatingMenuPortal.appendChild(menu);
  positionFloatingPillMenu();
}

export function closePillMenus(except = null) {
  document.querySelectorAll('.select-pill.open').forEach((pill) => {
    if (pill !== except) pill.classList.remove('open');
  });
  const hasOpenMenu = Boolean(document.querySelector('.select-pill.open'));
  $('create')?.classList.toggle('dropdown-open', hasOpenMenu);
  if (!hasOpenMenu || (except && activeFloatingPill !== except)) resetFloatingPillMenu();
}

export function toggleTheme() {
  const dark = !document.body.classList.contains('theme-dark');
  document.body.classList.toggle('theme-dark', dark);
  try {
    window.localStorage?.setItem('onetop-theme', dark ? 'dark' : 'light');
  } catch {
    // localStorage can be blocked in restricted browser contexts.
  }
}

export function restoreTheme() {
  let stored = '';
  try {
    stored = window.localStorage?.getItem('onetop-theme') || '';
  } catch {
    stored = '';
  }
  const forcedTheme = new URLSearchParams(window.location.search).get('theme');
  document.body.classList.toggle('theme-dark', forcedTheme === 'dark' || stored === 'dark');
}
