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

function bindHome() {
  $('loginModeBtn')?.addEventListener('click', () => setMode('login'));
  $('registerModeBtn')?.addEventListener('click', () => setMode('register'));
  $('homeAuthForm')?.addEventListener('submit', submitAuth);
  $('heroRegisterBtn')?.addEventListener('click', () => focusAuth('register'));
  bindPointerLighting();
  setMode('login');
  loadMe();
  loadTemplatePreviewImages();
  loadFeaturedWorksStrip();
}

function bindPointerLighting() {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (reduceMotion) return;
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
    card.style.transform = `perspective(1100px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-2px)`;
  };

  const resetCardSpot = (event) => {
    event.currentTarget.style.transform = '';
  };

  const flushPointerLighting = () => {
    frameId = 0;
    if (!latestEvent) return;
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
