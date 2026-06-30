const state = {
  mode: 'login',
  user: null
};

const $ = (id) => document.getElementById(id);
const templateLabels = {
  'guofeng-campaign': '国风宣发',
  'porcelain-museum': '博物馆图鉴',
  'poster-character': '人物海报',
  'game-scene': '游戏场景'
};

function safeImageUrl(value) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.href;
  } catch {
    return '';
  }
}

function escapeAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function communityPostImageUrl(post) {
  const candidates = [
    post?.imageUrl,
    ...(Array.isArray(post?.images) ? post.images.map((image) => image?.imageUrl || image?.url) : [])
  ];
  for (const item of candidates) {
    const imageUrl = safeImageUrl(item);
    if (imageUrl) return imageUrl;
  }
  return '';
}

function renderFeaturedWorksStrip(posts) {
  const strip = document.querySelector('.template-strip');
  const track = $('featuredWorksTrack');
  if (!strip || !track) return;
  strip.classList.remove('is-running');
  const works = posts
    .map((post) => ({
      imageUrl: communityPostImageUrl(post),
      title: String(post?.title || '精选作品').trim()
    }))
    .filter((item) => item.imageUrl)
    .slice(0, 10);
  if (!works.length) {
    strip.hidden = true;
    track.innerHTML = '';
    return;
  }
  strip.hidden = false;
  const repeated = [...works, ...works];
  track.innerHTML = repeated.map((item, index) => `
    <figure${index >= works.length ? ' aria-hidden="true"' : ''}>
      <img src="${item.imageUrl}" alt="${index >= works.length ? '' : escapeAttribute(item.title)}" loading="lazy" decoding="async" fetchpriority="low" />
    </figure>
  `).join('');
  restartFeaturedWorksStrip(strip, track);
}

function restartFeaturedWorksStrip(strip, track) {
  if (!strip || !track) return;
  strip.classList.remove('is-running');
  track.style.animation = 'none';
  track.getBoundingClientRect();
  window.requestAnimationFrame(() => {
    track.style.animation = '';
    strip.classList.add('is-running');
  });
  const images = Array.from(track.querySelectorAll('img'));
  let pending = images.filter((image) => !image.complete).length;
  if (!pending) return;
  const settle = () => {
    pending -= 1;
    if (pending > 0) return;
    window.requestAnimationFrame(() => restartFeaturedWorksStrip(strip, track));
  };
  images.forEach((image) => {
    if (image.complete) return;
    image.addEventListener('load', settle, { once: true });
    image.addEventListener('error', settle, { once: true });
  });
}

async function loadFeaturedWorksStrip() {
  const strip = document.querySelector('.template-strip');
  const track = $('featuredWorksTrack');
  if (!strip || !track) return;
  try {
    const response = await fetch('/api/community/posts?sort=hot&limit=10', { cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || payload.success === false || !Array.isArray(payload.posts)) {
      renderFeaturedWorksStrip([]);
      return;
    }
    renderFeaturedWorksStrip(payload.posts);
  } catch {
    renderFeaturedWorksStrip([]);
  }
}

function runWhenIdle(callback, timeout = 1200) {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(callback, { timeout });
    return;
  }
  window.setTimeout(callback, Math.min(timeout, 700));
}

function preloadImage(src) {
  if (!src) return;
  const image = new Image();
  image.decoding = 'async';
  image.src = src;
}

function setStatus(message, isError = false) {
  const node = $('homeAuthStatus');
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('is-error', Boolean(isError));
}

async function loadTemplatePreviewImages() {
  // 首页模板实验室必须固定，避免被交流区热门作品覆盖成错图错文案。
}

function setMode(mode) {
  state.mode = mode === 'register' ? 'register' : 'login';
  const isRegister = state.mode === 'register';
  document.body.classList.toggle('register-mode', isRegister);
  $('loginModeBtn')?.classList.toggle('active', !isRegister);
  $('registerModeBtn')?.classList.toggle('active', isRegister);
  if ($('authKicker')) $('authKicker').textContent = isRegister ? '创建账号' : '登录账号';
  if ($('authTitle')) $('authTitle').textContent = isRegister ? '开始第一张作品' : '回到你的创作台';
  if ($('homeAuthSubmit')) $('homeAuthSubmit').textContent = isRegister ? '注册并进入' : '登录并进入';
  const password = $('homePassword');
  if (password) password.autocomplete = isRegister ? 'new-password' : 'current-password';
  setStatus('');
}

function focusAuth(mode = 'login') {
  setMode(mode);
  const panel = $('authPanel') || document.querySelector('.auth-panel');
  panel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  window.setTimeout(() => $('homeAccount')?.focus(), 260);
}

async function api(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.success === false) {
    const error = new Error(payload.message || '请求失败');
    error.status = response.status;
    throw error;
  }
  return payload;
}

async function loadMe() {
  try {
    const response = await fetch('/api/me', { cache: 'no-store' });
    const payload = await response.json();
    state.user = payload.user || null;
    if (state.user) {
      setStatus(`${state.user.username || state.user.account} 已登录，可直接进入工作台。`);
      if ($('homeAuthSubmit')) $('homeAuthSubmit').textContent = '进入工作台';
    }
  } catch {
    state.user = null;
  }
}

async function submitAuth(event) {
  event.preventDefault();
  if (state.user && state.mode === 'login') {
    window.location.href = '/image/history';
    return;
  }
  const account = $('homeAccount')?.value.trim() || '';
  const username = $('homeUsername')?.value.trim() || account;
  const password = $('homePassword')?.value || '';
  if (!account || !password) {
    setStatus('请输入账号和密码。', true);
    return;
  }
  if (state.mode === 'register' && !username) {
    setStatus('请输入用户名。', true);
    return;
  }
  const submit = $('homeAuthSubmit');
  if (submit) submit.disabled = true;
  setStatus(state.mode === 'register' ? '正在注册...' : '正在登录...');
  try {
    const payload = state.mode === 'register'
      ? { account, username, password }
      : { account, password };
    await api(state.mode === 'register' ? '/api/auth/register' : '/api/auth/login', payload);
    window.location.href = '/image/history';
  } catch (error) {
    setStatus(error.message || '登录失败，请稍后重试。', true);
  } finally {
    if (submit) submit.disabled = false;
  }
}

function initBlackHoleEasterEgg() {
  const backgroundTrigger = $('blackholeBackgroundTrigger');
  const shipTrigger = $('blackholeShipTrigger');
  if (!backgroundTrigger || !shipTrigger) return;

  const reduceMotionQuery = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const mobileQuery = window.matchMedia?.('(max-width: 680px)');
  const selectors = [
    '.site-header',
    '.hero-copy',
    '.showcase-panel',
    '.auth-panel',
    '.template-strip',
    '.intro-copy',
    '.feature-grid article'
  ];
  const targets = Array.from(new Set(selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))));
  if (!targets.length) return;

  targets.forEach((target) => target.classList.add('blackhole-pull-target'));

  let blackholeState = 'idle';
  let stateTimer = 0;
  let resizeFrame = 0;

  const isSimpleMotion = () => Boolean(reduceMotionQuery?.matches || mobileQuery?.matches);

  const setContentInert = (isHidden) => {
    targets.forEach((target) => {
      target.inert = isHidden;
      if (isHidden) {
        target.setAttribute('aria-hidden', 'true');
      } else {
        target.removeAttribute('aria-hidden');
      }
    });
  };

  const setTriggerAccess = ({ canCollapse, canRestore }) => {
    backgroundTrigger.tabIndex = canCollapse ? 0 : -1;
    shipTrigger.tabIndex = canRestore ? 0 : -1;
    backgroundTrigger.setAttribute('aria-disabled', canCollapse ? 'false' : 'true');
    shipTrigger.setAttribute('aria-disabled', canRestore ? 'false' : 'true');
  };

  const resolveViewportLength = (value, axisSize) => {
    const text = String(value || '').trim();
    const amount = Number.parseFloat(text);
    if (!Number.isFinite(amount)) return axisSize / 2;
    if (text.endsWith('vw')) return window.innerWidth * amount / 100;
    if (text.endsWith('vh')) return window.innerHeight * amount / 100;
    if (text.endsWith('%')) return axisSize * amount / 100;
    if (text.endsWith('px')) return amount;
    return amount;
  };

  const getCorePoint = () => {
    const styles = window.getComputedStyle(document.documentElement);
    return {
      x: resolveViewportLength(styles.getPropertyValue('--blackhole-core-x'), window.innerWidth),
      y: resolveViewportLength(styles.getPropertyValue('--blackhole-core-y'), window.innerHeight)
    };
  };

  const setTargetMotion = () => {
    const core = getCorePoint();
    const simpleMotion = isSimpleMotion();
    targets.forEach((target, index) => {
      const rect = target.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      if (simpleMotion) {
        target.style.setProperty('--bh-x', '0px');
        target.style.setProperty('--bh-y', '0px');
        target.style.setProperty('--bh-rot', '0deg');
        target.style.setProperty('--bh-delay', '0ms');
        target.style.setProperty('--bh-restore-delay', '0ms');
        target.style.setProperty('--bh-scale-x', '0.96');
        target.style.setProperty('--bh-scale-y', '0.96');
        target.style.setProperty('--bh-blur', '1px');
        return;
      }

      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = core.x - centerX;
      const dy = core.y - centerY;
      const distance = Math.hypot(dx, dy);
      const travelBoost = Math.min(1.34, 1.04 + distance / 1300);
      const delay = Math.round(Math.min(420, index * 34 + distance * 0.045));
      const stretch = Math.round((8.8 + Math.min(10.8, distance / 92)) * 100) / 100;
      const squeeze = Math.round((0.045 + Math.min(0.025, rect.height / 12000)) * 1000) / 1000;
      const angle = Math.round(Math.atan2(dy, dx) * 180 / Math.PI);
      const blur = Math.round(Math.min(14, 2.4 + distance / 120));

      target.style.setProperty('--bh-x', `${Math.round(dx * travelBoost)}px`);
      target.style.setProperty('--bh-y', `${Math.round(dy * travelBoost)}px`);
      target.style.setProperty('--bh-rot', `${angle}deg`);
      target.style.setProperty('--bh-delay', `${delay}ms`);
      target.style.setProperty('--bh-restore-delay', `${Math.max(0, Math.round(190 - delay * 0.42))}ms`);
      target.style.setProperty('--bh-scale-x', String(stretch));
      target.style.setProperty('--bh-scale-y', String(squeeze));
      target.style.setProperty('--bh-blur', `${blur}px`);
    });
  };

  const setShipMotion = () => {
    const core = getCorePoint();
    const rect = shipTrigger.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = core.x - centerX;
    const dy = core.y - centerY;
    shipTrigger.style.setProperty('--ship-x', `${Math.round(dx * 1.05)}px`);
    shipTrigger.style.setProperty('--ship-y', `${Math.round(dy * 1.05)}px`);
    shipTrigger.style.setProperty('--ship-rot', `${Math.round(Math.atan2(dy, dx) * 180 / Math.PI)}deg`);
  };

  const setBodyState = (nextState) => {
    document.body.classList.remove('is-blackhole-collapsing', 'is-blackhole-hidden', 'is-blackhole-restoring');
    if (nextState !== 'idle') document.body.classList.add(`is-blackhole-${nextState}`);
    blackholeState = nextState;
  };

  const clearStateTimer = () => {
    if (!stateTimer) return;
    window.clearTimeout(stateTimer);
    stateTimer = 0;
  };

  const finishCollapse = () => {
    setBodyState('hidden');
    setContentInert(true);
    setTriggerAccess({ canCollapse: false, canRestore: true });
    setShipMotion();
    shipTrigger.focus({ preventScroll: true });
  };

  const collapseHome = (event) => {
    event?.preventDefault();
    if (blackholeState !== 'idle') return;
    clearStateTimer();
    setContentInert(false);
    setTargetMotion();
    setTriggerAccess({ canCollapse: false, canRestore: false });
    setBodyState('collapsing');
    stateTimer = window.setTimeout(finishCollapse, isSimpleMotion() ? 320 : 2480);
  };

  const finishRestore = () => {
    setBodyState('idle');
    setContentInert(false);
    setTriggerAccess({ canCollapse: true, canRestore: false });
  };

  const restoreHome = (event) => {
    event?.preventDefault();
    if (blackholeState === 'idle' || blackholeState === 'restoring') return;
    clearStateTimer();
    setTargetMotion();
    setShipMotion();
    setContentInert(true);
    setTriggerAccess({ canCollapse: false, canRestore: false });
    setBodyState('restoring');
    stateTimer = window.setTimeout(finishRestore, reduceMotionQuery?.matches ? 360 : 1500);
  };

  const isInteractiveTarget = (target) => Boolean(target?.closest?.([
    'a',
    'button',
    'input',
    'textarea',
    'select',
    'label',
    'summary',
    'form',
    '[role="button"]',
    '[contenteditable="true"]',
    '[data-home-template]'
  ].join(',')));

  const isContentTarget = (target) => Boolean(target?.closest?.('.blackhole-pull-target'));

  const handleDocumentClick = (event) => {
    if (blackholeState !== 'idle' || event.defaultPrevented || isInteractiveTarget(event.target)) return;
    if (isContentTarget(event.target)) return;
    collapseHome(event);
  };

  const scheduleMeasure = () => {
    if (blackholeState === 'idle' || resizeFrame) return;
    resizeFrame = window.requestAnimationFrame(() => {
      resizeFrame = 0;
      setTargetMotion();
      setShipMotion();
    });
  };

  setTriggerAccess({ canCollapse: true, canRestore: false });
  backgroundTrigger.addEventListener('click', collapseHome);
  shipTrigger.addEventListener('click', restoreHome);
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') restoreHome(event);
  });
  window.addEventListener('resize', scheduleMeasure, { passive: true });
  reduceMotionQuery?.addEventListener?.('change', () => {
    setTargetMotion();
    setShipMotion();
  });
  mobileQuery?.addEventListener?.('change', () => {
    setTargetMotion();
    setShipMotion();
  });
}

function bindHome() {
  $('loginModeBtn')?.addEventListener('click', () => setMode('login'));
  $('registerModeBtn')?.addEventListener('click', () => setMode('register'));
  $('homeAuthForm')?.addEventListener('submit', submitAuth);
  $('heroRegisterBtn')?.addEventListener('click', () => focusAuth('register'));
  initBlackHoleEasterEgg();
  bindPointerLighting();
  setMode('login');
  loadMe();
  loadTemplatePreviewImages();
  runWhenIdle(() => {
    document.body.classList.add('is-home-effects-ready');
    preloadImage('/assets/home/endurance-inspired-ship.jpg?v=2026070103');
    loadFeaturedWorksStrip();
  });
}

function bindPointerLighting() {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const finePointer = window.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches;
  if (reduceMotion || !finePointer) return;
  document.body.classList.add('is-pointer-lighting-ready');
  let frameId = 0;
  let latestEvent = null;
  let latestCard = null;

  const updatePageSpot = (event) => {
    const x = `${Math.round((event.clientX / window.innerWidth) * 1000) / 10}%`;
    const y = `${Math.round((event.clientY / window.innerHeight) * 1000) / 10}%`;
    document.documentElement.style.setProperty('--spot-x', x);
    document.documentElement.style.setProperty('--spot-y', y);
  };

  const updateCardSpot = (event, targetCard) => {
    const card = targetCard || event.currentTarget;
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const xRatio = (event.clientX - rect.left) / rect.width;
    const yRatio = (event.clientY - rect.top) / rect.height;
    const x = `${Math.round(xRatio * 1000) / 10}%`;
    const y = `${Math.round(yRatio * 1000) / 10}%`;
    const rotateX = Math.round((0.5 - yRatio) * 36) / 10;
    const rotateY = Math.round((xRatio - 0.5) * 44) / 10;
    card.style.setProperty('--card-x', x);
    card.style.setProperty('--card-y', y);
    card.style.setProperty('--magnetic-transform', `perspective(1100px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`);
  };

  const resetCardSpot = (event) => {
    event.currentTarget.style.removeProperty('--magnetic-transform');
  };

  const flushPointerLighting = () => {
    frameId = 0;
    if (!latestEvent) return;
    if (document.body.className.includes('is-blackhole-')) return;
    updatePageSpot(latestEvent);
    if (latestCard) updateCardSpot(latestEvent, latestCard);
  };

  const schedulePointerLighting = (event) => {
    latestEvent = event;
    latestCard = event.target?.closest?.('.magnetic-card') || null;
    if (frameId) return;
    frameId = window.requestAnimationFrame(flushPointerLighting);
  };

  document.addEventListener('pointermove', schedulePointerLighting, { passive: true });
  document.querySelectorAll('.magnetic-card').forEach((card) => {
    card.addEventListener('pointerleave', resetCardSpot, { passive: true });
  });
}

document.addEventListener('DOMContentLoaded', bindHome);
