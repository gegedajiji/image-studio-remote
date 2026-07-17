import { state } from './state.js';
import { $ } from './dom.js';
import { composerHeightStorageKey, historyWidthStorageKey } from './constants.js';
import { studioCompactMediaQuery, studioCompactWidth } from './constants.js';

let composerLayoutObserver = null;
let fallbackResizeListenerBound = false;
let resultLayoutFrameId = 0;
let resultLayoutSettleTimers = [];
let floatingMenuPortal = null;
let activeFloatingPill = null;
let activeFloatingMenu = null;
let floatingMenuFrameId = 0;
let floatingViewportListenersBound = false;
let historyOverlayWasOpen = false;
let historyOverlayFocusBound = false;

function usesStaticStudioLayout() {
  return document.body.classList.contains('studio-layout-v2');
}

function syncComposerPadding(height) {
  document.body.classList.toggle('composer-expanded', Number(height || 0) > 176);
}

export function syncHistoryToggleLabel() {
  const button = $('collapseHistoryBtn');
  const label = button?.querySelector('span');
  if (!label) return;
  const isMobile = window.matchMedia(studioCompactMediaQuery).matches;
  const text = state.activePanel !== 'studio'
    ? '展开历史'
    : isMobile
      ? (document.body.classList.contains('history-mobile-open') ? '关闭历史' : '展开历史')
      : (document.body.classList.contains('history-opened') ? '收起历史' : '展开历史');
  label.textContent = text;
  button.setAttribute('aria-label', text);
  button.setAttribute('aria-expanded', String(
    isMobile
      ? document.body.classList.contains('history-mobile-open')
      : document.body.classList.contains('history-opened')
  ));
  button.title = text;
}

function historyFocusableElements(history) {
  if (!history) return [];
  return [...history.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
    .filter((node) => !node.hidden && node.getClientRects().length > 0);
}

function bindHistoryOverlayFocus(history) {
  if (!history || historyOverlayFocusBound) return;
  historyOverlayFocusBound = true;
  history.addEventListener('keydown', (event) => {
    if (!document.body.classList.contains('history-mobile-open')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      $('historyCloseBtn')?.click();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = historyFocusableElements(history);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

export function normalizeHistoryLayoutState() {
  const isMobile = window.matchMedia(studioCompactMediaQuery).matches;
  const wasOpen = document.body.classList.contains('history-opened')
    || document.body.classList.contains('history-mobile-open');
  const history = $('historySection');
  const backdrop = $('historyBackdrop');
  const workspace = document.querySelector('.workspace');
  const rail = document.querySelector('.studio-rail');
  bindHistoryOverlayFocus(history);
  if (state.activePanel !== 'studio') {
    document.body.classList.remove('history-opened', 'history-collapsed', 'history-mobile-open');
    document.body.classList.remove('history-overlay-open');
    history?.setAttribute('aria-hidden', 'true');
    backdrop?.setAttribute('aria-hidden', 'true');
    if (workspace) workspace.inert = false;
    if (rail) rail.inert = false;
    historyOverlayWasOpen = false;
    syncHistoryToggleLabel();
    return;
  }
  if (isMobile) {
    document.body.classList.remove('history-opened', 'history-collapsed');
    document.body.classList.toggle('history-mobile-open', wasOpen);
  } else {
    document.body.classList.remove('history-mobile-open');
    document.body.classList.toggle('history-opened', wasOpen);
    document.body.classList.toggle('history-collapsed', !wasOpen);
  }
  const mobileOverlayOpen = isMobile && wasOpen;
  document.body.classList.toggle('history-overlay-open', mobileOverlayOpen);
  history?.setAttribute('aria-hidden', String(!wasOpen));
  backdrop?.setAttribute('aria-hidden', String(!mobileOverlayOpen));
  if (workspace) workspace.inert = mobileOverlayOpen;
  if (rail) rail.inert = mobileOverlayOpen;
  if (mobileOverlayOpen && !historyOverlayWasOpen) {
    window.requestAnimationFrame?.(() => $('historyCloseBtn')?.focus({ preventScroll: true }));
  } else if (!mobileOverlayOpen && historyOverlayWasOpen) {
    window.requestAnimationFrame?.(() => $('collapseHistoryBtn')?.focus({ preventScroll: true }));
  }
  historyOverlayWasOpen = mobileOverlayOpen;
  syncHistoryToggleLabel();
}

export function setHistoryWidth(width) {
  const maxWidth = Math.min(360, Math.max(292, window.innerWidth * 0.245));
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
  if (usesStaticStudioLayout()) {
    document.documentElement.style.setProperty('--composer-safe-space', '0px');
    return;
  }
  const composer = $('create');
  if (!composer) return;
  const rect = composer.getBoundingClientRect();
  const height = Math.max(0, Math.round(rect.height || composer.offsetHeight || 0));
  const bottomInset = window.innerWidth > studioCompactWidth
    ? Math.max(0, Math.round(window.innerHeight - rect.bottom))
    : 0;
  document.documentElement.style.setProperty('--composer-safe-space', `${Math.max(360, height + bottomInset + 96)}px`);
}

function liftResultPreviewAboveComposer() {
  if (usesStaticStudioLayout()) return;
  if (window.innerWidth <= studioCompactWidth) return;
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
  if (usesStaticStudioLayout()) {
    syncComposerSafeArea();
    return;
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
  if (usesStaticStudioLayout()) return;
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
    if (window.matchMedia(studioCompactMediaQuery).matches) return;
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
    ['data-model', button.dataset.model],
    ['data-format', button.dataset.format],
    ['data-count', button.dataset.count]
  ].filter(([, value]) => value !== undefined && value !== '');
  return pairs.map(([name, value]) => `[${name}="${CSS.escape(String(value))}"]`).join('');
}

function buildFloatingPillMenu(sourceMenu) {
  if (!sourceMenu) return null;
  const floatingMenu = sourceMenu.cloneNode(true);
  const sourceMenuId = sourceMenu.id || `pill-menu-${Date.now()}`;
  floatingMenu.id = `${sourceMenuId}-floating`;
  floatingMenu.dataset.sourceMenuId = sourceMenuId;
  floatingMenu.removeAttribute('aria-hidden');
  floatingMenu.querySelectorAll('[id]').forEach((node) => node.removeAttribute('id'));
  floatingMenu.classList.add('floating-pill-menu');
  floatingMenu.querySelectorAll('button').forEach((floatingButton, index) => {
    const selector = floatingMenuButtonSelector(floatingButton);
    const sourceButton = (selector ? sourceMenu.querySelector(selector) : null)
      || sourceMenu.querySelectorAll('button')[index]
      || null;
    floatingButton.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const returnFocus = activeFloatingPill?.querySelector('.select-pill-trigger');
      sourceButton?.click();
      window.queueMicrotask?.(() => returnFocus?.focus());
    };
    floatingButton.setAttribute('role', 'option');
    floatingButton.setAttribute('aria-selected', String(floatingButton.classList.contains('active')));
  });
  floatingMenu.addEventListener('keydown', (event) => {
    const buttons = [...floatingMenu.querySelectorAll('button:not(:disabled)')];
    const currentIndex = Math.max(0, buttons.indexOf(document.activeElement));
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(currentIndex + delta + buttons.length) % buttons.length]?.focus();
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      const trigger = activeFloatingPill?.querySelector('.select-pill-trigger');
      closePillMenus();
      trigger?.focus();
    }
  });
  return floatingMenu;
}

function resetFloatingPillMenu() {
  if (floatingMenuFrameId) {
    cancelAnimationFrame(floatingMenuFrameId);
    floatingMenuFrameId = 0;
  }
  if (activeFloatingMenu) {
    const trigger = activeFloatingPill?.querySelector('.select-pill-trigger');
    const sourceMenuId = activeFloatingMenu.dataset.sourceMenuId;
    if (trigger && sourceMenuId) trigger.setAttribute('aria-controls', sourceMenuId);
    activeFloatingMenu.remove();
  }
  if (floatingMenuPortal?.id === 'floatingMenuPortal') floatingMenuPortal.setAttribute('aria-hidden', 'true');
  activeFloatingPill = null;
  activeFloatingMenu = null;
}

function positionFloatingPillMenu() {
  if (!activeFloatingPill || !activeFloatingMenu || !activeFloatingPill.classList.contains('open')) return;
  const pillRect = activeFloatingPill.getBoundingClientRect();
  const visualViewport = window.visualViewport;
  const viewportLeft = visualViewport?.offsetLeft || 0;
  const viewportTop = visualViewport?.offsetTop || 0;
  const viewportWidth = visualViewport?.width || Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const viewportHeight = visualViewport?.height || Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  const viewportRight = viewportLeft + viewportWidth;
  const viewportBottom = viewportTop + viewportHeight;
  const gutter = 12;
  const gap = 10;
  const maxWidth = Math.max(180, viewportWidth - gutter * 2);
  const width = Math.min(Math.max(Math.round(pillRect.width), 196), maxWidth);
  const naturalHeight = activeFloatingMenu.scrollHeight || 220;
  const availableBelow = Math.max(0, viewportBottom - pillRect.bottom - gap - gutter);
  const availableAbove = Math.max(0, pillRect.top - viewportTop - gap - gutter);
  const opensUp = availableBelow < Math.min(naturalHeight, 180) && availableAbove > availableBelow;
  const availableSpace = opensUp ? availableAbove : availableBelow;
  const maxHeight = Math.max(96, Math.min(360, naturalHeight, availableSpace || viewportHeight - gutter * 2));
  const top = opensUp
    ? Math.max(viewportTop + gutter, pillRect.top - gap - maxHeight)
    : Math.max(viewportTop + gutter, Math.min(pillRect.bottom + gap, viewportBottom - gutter - maxHeight));
  const left = Math.min(
    Math.max(viewportLeft + gutter, Math.round(pillRect.left)),
    viewportRight - width - gutter
  );

  activeFloatingMenu.style.setProperty('--floating-menu-arrow-left', `${Math.max(18, Math.min((pillRect.left + pillRect.width / 2) - left, width - 18))}px`);
  activeFloatingMenu.style.left = `${left}px`;
  activeFloatingMenu.style.top = `${top}px`;
  activeFloatingMenu.style.width = `${width}px`;
  activeFloatingMenu.style.maxHeight = `${maxHeight}px`;
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
  pill.querySelector('.select-pill-trigger')?.setAttribute('aria-controls', menu.id);
  if (floatingMenuPortal.id === 'floatingMenuPortal') floatingMenuPortal.setAttribute('aria-hidden', 'false');
  floatingMenuPortal.appendChild(menu);
  if (!floatingViewportListenersBound && window.visualViewport) {
    floatingViewportListenersBound = true;
    window.visualViewport.addEventListener('resize', scheduleFloatingPillMenuPosition, { passive: true });
    window.visualViewport.addEventListener('scroll', scheduleFloatingPillMenuPosition, { passive: true });
  }
  positionFloatingPillMenu();
  window.requestAnimationFrame?.(() => {
    (menu.querySelector('button.active:not(:disabled)') || menu.querySelector('button:not(:disabled)'))?.focus();
  });
}

export function closePillMenus(except = null) {
  document.querySelectorAll('.select-pill.open').forEach((pill) => {
    if (pill !== except) {
      pill.classList.remove('open');
      pill.querySelector('.select-pill-trigger')?.setAttribute('aria-expanded', 'false');
    }
  });
  except?.querySelector('.select-pill-trigger')?.setAttribute('aria-expanded', 'true');
  const hasOpenMenu = Boolean(document.querySelector('.select-pill.open'));
  $('create')?.classList.toggle('dropdown-open', hasOpenMenu);
  if (!hasOpenMenu || (except && activeFloatingPill !== except)) resetFloatingPillMenu();
}

export function toggleTheme() {
  document.body.classList.remove('theme-dark');
  try {
    window.localStorage?.setItem('onetop-theme', 'light');
  } catch {
    // localStorage can be blocked in restricted browser contexts.
  }
}

export function restoreTheme() {
  try {
    window.localStorage?.setItem('onetop-theme', 'light');
  } catch {
    // localStorage can be blocked in restricted browser contexts.
  }
  document.body.classList.remove('theme-dark');
}
