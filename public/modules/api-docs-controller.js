import { state } from './state.js';
import { $ } from './dom.js';
import { api } from './api-client.js';
import {
  copyText,
  escapeHtml,
  formatDate,
  yuan
} from './format.js';
import { setStatus as defaultSetStatus } from './status-ui.js';

let apiDocsEventsBound = false;
let setApiStatus = defaultSetStatus;
let openApiAuthModal = () => {};

export function initApiDocsController(options = {}) {
  setApiStatus = options.setStatus || defaultSetStatus;
  openApiAuthModal = options.openAuthModal || (() => {});
}

export async function loadApiKeys({ silent = false } = {}) {
  if (!state.user) {
    state.apiKeys = [];
    state.apiNewKey = '';
    renderApiDocsPanel();
    return;
  }
  if (state.apiKeysLoading) return;
  state.apiKeysLoading = true;
  if (!silent) renderApiDocsPanel();
  try {
    const data = await api('/api/api-keys');
    state.apiKeys = data.apiKeys || [];
  } catch (error) {
    if (!silent) setApiStatus(`API Key 读取失败：${error.message}`, true);
  } finally {
    state.apiKeysLoading = false;
    renderApiDocsPanel();
  }
}

export function renderApiDocsPanel({ force = false } = {}) {
  if (!force && state.activePanel !== 'developers') return;
  bindApiDocsEvents();
  syncApiDocsOrigin();
  const hint = $('apiKeyAccountHint');
  const list = $('apiKeyList');
  const createButton = $('createApiKeyBtn');
  const nameInput = $('apiKeyNameInput');
  const newKeyBox = $('apiNewKeyBox');
  const newKeyValue = $('apiNewKeyValue');
  if (!list) return;
  if (hint) hint.textContent = state.user
    ? `${state.user.username} · 余额 ${yuan(state.user.balanceCents)}`
    : '登录后创建密钥';
  if (createButton) createButton.disabled = !state.user || state.apiKeysLoading;
  if (nameInput) nameInput.disabled = !state.user || state.apiKeysLoading;
  if (newKeyBox && newKeyValue) {
    newKeyBox.hidden = !state.apiNewKey;
    newKeyValue.textContent = state.apiNewKey || '';
  }
  if (!state.user) {
    list.innerHTML = `
      <div class="api-key-empty">
        <strong>还没有登录</strong>
        <p>登录后可以在这里创建 API Key，接口费用会从当前账号余额扣除。</p>
        <button class="primary-button" type="button" data-open-auth>登录 / 注册</button>
      </div>
    `;
    return;
  }
  if (state.apiKeysLoading) {
    list.innerHTML = '<p class="feature-empty">正在读取 API Keys…</p>';
    return;
  }
  list.innerHTML = state.apiKeys.length
    ? state.apiKeys.map((key) => `
      <article class="api-key-item ${key.status === 'revoked' ? 'revoked' : ''}">
        <div>
          <strong>${escapeHtml(key.name)}</strong>
          <span>${escapeHtml(key.prefix || 'sk-img-')}••••${escapeHtml(key.last4 || '')}</span>
          <small>创建 ${escapeHtml(formatDate(key.createdAt))}${key.lastUsedAt ? ` · 最近使用 ${escapeHtml(formatDate(key.lastUsedAt))}` : ''}</small>
        </div>
        <button class="secondary-button" type="button" data-revoke-api-key="${escapeHtml(key.id)}" ${key.status === 'revoked' ? 'disabled' : ''}>${key.status === 'revoked' ? '已撤销' : '撤销'}</button>
      </article>
    `).join('')
    : '<p class="feature-empty">还没有 API Key。输入名称后点击创建。</p>';
}

function syncApiDocsOrigin() {
  const panel = $('apiDocsPanel');
  if (!panel) return;
  const origin = window.location.origin || 'https://your-domain.example';
  panel.querySelectorAll('[data-copy-api-path]').forEach((button) => {
    button.dataset.copyText = `${origin}${button.dataset.copyApiPath || ''}`;
  });
  const generationExample = panel.querySelector('[data-api-example="generations"]');
  if (generationExample) {
    generationExample.textContent = `curl ${origin}/v1/images/generations \\
  -H "Authorization: Bearer sk-img-xxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "一张极简产品海报，柔和自然光，无文字",
    "quality": "2k",
    "size": "1024x1024",
    "output_format": "jpeg",
    "n": 1
  }'`;
  }
  const editExample = panel.querySelector('[data-api-example="edits"]');
  if (editExample) {
    editExample.textContent = `curl ${origin}/v1/images/edits \\
  -H "Authorization: Bearer sk-img-xxx" \\
  -F "prompt=把图片改成 iOS 风格产品摄影，背景干净" \\
  -F "quality=2k" \\
  -F "size=1024x1024" \\
  -F "output_format=png" \\
  -F "image=@source.png"`;
  }
}

async function createApiKeyFromDocs() {
  if (!state.user) {
    openApiAuthModal();
    return setApiStatus('请先登录后再创建 API Key。', true);
  }
  const button = $('createApiKeyBtn');
  if (button) button.disabled = true;
  try {
    const data = await api('/api/api-keys', {
      method: 'POST',
      body: { name: $('apiKeyNameInput')?.value.trim() || 'API Key' }
    });
    state.apiNewKey = data.key || '';
    if ($('apiKeyNameInput')) $('apiKeyNameInput').value = '';
    await loadApiKeys({ silent: true });
    setApiStatus('API Key 已创建，请立即复制保存。');
  } catch (error) {
    setApiStatus(error.message, true);
  } finally {
    if (button) button.disabled = false;
  }
}

async function revokeApiKey(keyId) {
  if (!keyId) return;
  const ok = window.confirm('确认撤销这个 API Key？撤销后不能恢复。');
  if (!ok) return;
  try {
    await api(`/api/api-keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' });
    await loadApiKeys({ silent: true });
    setApiStatus('API Key 已撤销。');
  } catch (error) {
    setApiStatus(error.message, true);
  }
}

function bindApiDocsEvents() {
  if (apiDocsEventsBound) return;
  const panel = $('apiDocsPanel');
  if (!panel) return;
  apiDocsEventsBound = true;
  $('refreshApiKeysBtn')?.addEventListener('click', () => loadApiKeys());
  $('createApiKeyBtn')?.addEventListener('click', createApiKeyFromDocs);
  $('apiKeyNameInput')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') createApiKeyFromDocs();
  });
  $('copyNewApiKeyBtn')?.addEventListener('click', () => {
    copyText(state.apiNewKey)
      .then(() => setApiStatus('API Key 已复制。'))
      .catch((error) => setApiStatus(error.message, true));
  });
  panel.addEventListener('click', (event) => {
    const copyButton = event.target.closest('[data-copy-text]');
    if (copyButton) {
      copyText(copyButton.dataset.copyText)
        .then(() => setApiStatus('已复制接口地址。'))
        .catch((error) => setApiStatus(error.message, true));
      return;
    }
    const revokeButton = event.target.closest('[data-revoke-api-key]');
    if (revokeButton) {
      revokeApiKey(revokeButton.dataset.revokeApiKey);
      return;
    }
    if (event.target.closest('[data-open-auth]')) openApiAuthModal();
  });
}
