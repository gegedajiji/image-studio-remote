import { state } from './state.js';
import {
  agentStorageKey,
  defaultAgentModel,
  reasoningLabels
} from './constants.js';
import { $ } from './dom.js';
import { api } from './api-client.js';
import { escapeHtml } from './format.js';
import { setStatus as defaultSetStatus } from './status-ui.js';
import { agentModelLabel } from './studio-format.js';

let agentConversationsLoaded = false;
let agentEventsBound = false;
let setAgentStatus = defaultSetStatus;
let openAgentAuthModal = () => {};
let formatAgentError = (message) => String(message || '') || '智能对话失败，请稍后重试。';

export function initAgentController(options = {}) {
  setAgentStatus = options.setStatus || defaultSetStatus;
  openAgentAuthModal = options.openAuthModal || (() => {});
  formatAgentError = options.formatError || formatAgentError;
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function createAgentConversation(patch = {}) {
  const time = nowIso();
  return {
    id: newId('agent'),
    title: '新对话',
    renamed: false,
    preview: '暂无消息',
    model: defaultAgentModel,
    reasoningEffort: 'medium',
    messages: [],
    createdAt: time,
    updatedAt: time,
    ...patch
  };
}

function activeAgentConversation() {
  return state.agentConversations.find((item) => item.id === state.activeAgentConversationId) || state.agentConversations[0] || null;
}

function messagePreview(messages = []) {
  const last = [...messages].reverse().find((message) => message.content || message.attachments?.length);
  if (!last) return '暂无消息';
  const text = last.content || `${last.attachments?.length || 0} 张图片`;
  return String(text).replace(/\s+/g, ' ').slice(0, 64);
}

function titleFromMessage(message) {
  const text = String(message || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 18) : '图片分析';
}

function normalizeAgentConversation(item) {
  const base = createAgentConversation();
  return {
    ...base,
    ...item,
    model: item?.model || defaultAgentModel,
    reasoningEffort: ['low', 'medium', 'high'].includes(item?.reasoningEffort) ? item.reasoningEffort : 'medium',
    messages: Array.isArray(item?.messages) ? item.messages.slice(-120) : [],
    preview: item?.preview || messagePreview(item?.messages || [])
  };
}

function persistAgentConversations() {
  try {
    localStorage.setItem(agentStorageKey, JSON.stringify(state.agentConversations.slice(0, 40)));
  } catch {
    // Browser storage can be unavailable in private contexts.
  }
}

function loadAgentConversations() {
  let conversations = [];
  try {
    const raw = localStorage.getItem(agentStorageKey);
    conversations = raw ? JSON.parse(raw) : [];
  } catch {
    conversations = [];
  }
  if (!Array.isArray(conversations) || !conversations.length) conversations = [createAgentConversation()];
  state.agentConversations = conversations.map(normalizeAgentConversation).slice(0, 40);
  state.activeAgentConversationId = state.agentConversations[0]?.id || '';
  agentConversationsLoaded = true;
}

function ensureAgentConversationsLoaded() {
  if (!agentConversationsLoaded) loadAgentConversations();
}

function updateAgentConversation(id, updater, { persist = true } = {}) {
  ensureAgentConversationsLoaded();
  state.agentConversations = state.agentConversations.map((item) => {
    if (item.id !== id) return item;
    const next = typeof updater === 'function' ? updater(item) : { ...item, ...updater };
    const updated = {
      ...next,
      preview: messagePreview(next.messages || []),
      title: next.renamed ? next.title : titleFromMessage(next.messages?.find((message) => message.role === 'user')?.content || next.title),
      updatedAt: nowIso()
    };
    return normalizeAgentConversation(updated);
  });
  if (persist) persistAgentConversations();
}

function selectAgentConversation(id) {
  ensureAgentConversationsLoaded();
  if (!state.agentConversations.some((item) => item.id === id)) return;
  state.activeAgentConversationId = id;
  state.agentAttachments = [];
  renderAgentPanel();
}

function createNewAgentConversation() {
  ensureAgentConversationsLoaded();
  if (state.agentPending) return setAgentStatus('当前回复完成后再新建对话。', true);
  const current = activeAgentConversation();
  const conversation = createAgentConversation({
    model: current?.model || defaultAgentModel,
    reasoningEffort: current?.reasoningEffort || 'medium'
  });
  state.agentConversations = [conversation, ...state.agentConversations].slice(0, 40);
  state.activeAgentConversationId = conversation.id;
  state.agentAttachments = [];
  persistAgentConversations();
  renderAgentPanel();
}

function renameActiveAgentConversation() {
  ensureAgentConversationsLoaded();
  const conversation = activeAgentConversation();
  if (!conversation) return;
  const next = window.prompt('重命名对话', conversation.title || '新对话');
  if (next === null) return;
  const title = next.trim();
  if (!title) return;
  updateAgentConversation(conversation.id, (item) => ({ ...item, title: title.slice(0, 40), renamed: true }));
  renderAgentPanel();
}

function deleteAgentConversation(id) {
  ensureAgentConversationsLoaded();
  if (state.agentPending && id === state.activeAgentConversationId) return setAgentStatus('当前回复完成后再删除这个对话。', true);
  const next = state.agentConversations.filter((item) => item.id !== id);
  state.agentConversations = next.length ? next : [createAgentConversation()];
  if (!state.agentConversations.some((item) => item.id === state.activeAgentConversationId)) {
    state.activeAgentConversationId = state.agentConversations[0].id;
  }
  persistAgentConversations();
  renderAgentPanel();
}

function clearActiveAgentConversation() {
  ensureAgentConversationsLoaded();
  const conversation = activeAgentConversation();
  if (!conversation) return;
  updateAgentConversation(conversation.id, (item) => ({
    ...item,
    title: item.renamed ? item.title : '新对话',
    messages: []
  }));
  renderAgentPanel();
}

function formatAgentTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function renderAgentConversations() {
  const list = $('agentConversationList');
  if (!list) return;
  list.innerHTML = state.agentConversations.map((item) => {
    const active = item.id === state.activeAgentConversationId;
    return `
      <button class="agent-conversation ${active ? 'active' : ''}" type="button" data-agent-conversation="${escapeHtml(item.id)}">
        <span class="agent-conversation-top">
          <strong>${escapeHtml(item.title || '新对话')}</strong>
          <small>${escapeHtml(formatAgentTime(item.updatedAt))}</small>
        </span>
        <span class="agent-conversation-preview">${escapeHtml(item.preview || '暂无消息')}</span>
        <span class="agent-conversation-meta">
          <em>${escapeHtml(agentModelLabel(item.model || defaultAgentModel))} · ${escapeHtml(reasoningLabels[item.reasoningEffort] || '中')}</em>
          <span>
            <i role="button" tabindex="0" data-agent-action="rename" data-agent-id="${escapeHtml(item.id)}">重命名</i>
            <i role="button" tabindex="0" data-agent-action="delete" data-agent-id="${escapeHtml(item.id)}">删除</i>
          </span>
        </span>
      </button>
    `;
  }).join('');
}

function renderAgentAttachments() {
  const node = $('agentAttachments');
  if (!node) return;
  node.innerHTML = state.agentAttachments.length
    ? state.agentAttachments.map((item) => `
      <article class="agent-attachment">
        <img src="${escapeHtml(item.dataUrl)}" alt="${escapeHtml(item.name)}" />
        <button type="button" data-remove-agent-attachment="${escapeHtml(item.id)}" aria-label="移除图片">×</button>
      </article>
    `).join('')
    : '';
}

function renderAgentMessages() {
  const node = $('agentMessages');
  if (!node) return;
  const conversation = activeAgentConversation();
  const messages = conversation?.messages || [];
  node.innerHTML = messages.length ? messages.map((message) => `
    <article class="agent-message ${message.role}">
      <span>${message.role === 'user' ? '你' : '助手'}</span>
      <p>${escapeHtml(message.content)}</p>
      ${message.attachments?.length ? `
        <div class="agent-message-images">
          ${message.attachments.map((item) => `<img src="${escapeHtml(item.dataUrl)}" alt="${escapeHtml(item.name || '图片')}" />`).join('')}
        </div>
      ` : ''}
    </article>
  `).join('') : `
    <div class="agent-empty">
      <strong>开始对话</strong>
      <p>输入问题，或插入图片分析画面、提取提示词、改写连续画面。</p>
    </div>
  `;
  node.scrollTop = node.scrollHeight;
}

export function renderAgentPanel({ force = false } = {}) {
  if (!force && state.activePanel !== 'agent') return;
  bindAgentEvents();
  ensureAgentConversationsLoaded();
  const conversation = activeAgentConversation();
  if ($('agentTitle')) $('agentTitle').textContent = conversation?.title || '智能对话';
  if ($('agentModelSelect')) $('agentModelSelect').value = conversation?.model || defaultAgentModel;
  if ($('agentReasoningSelect')) $('agentReasoningSelect').value = conversation?.reasoningEffort || 'medium';
  renderAgentConversations();
  renderAgentMessages();
  renderAgentAttachments();
}

async function sendAgentMessage() {
  ensureAgentConversationsLoaded();
  if (state.agentPending) return;
  if (!state.user) {
    openAgentAuthModal();
    return setAgentStatus('请先登录后再使用智能对话。', true);
  }
  const input = $('agentInput');
  if (!input) return;
  const conversation = activeAgentConversation();
  const content = input.value.trim();
  if (!conversation) return;
  if (content.length < 2 && !state.agentAttachments.length) return;
  const attachments = [...state.agentAttachments];
  const userMessage = { id: newId('msg'), role: 'user', content, attachments, createdAt: nowIso() };
  const assistantMessage = { id: newId('msg'), role: 'assistant', content: '', createdAt: nowIso() };
  updateAgentConversation(conversation.id, (item) => ({ ...item, messages: [...item.messages, userMessage, assistantMessage] }));
  input.value = '';
  state.agentAttachments = [];
  state.agentPending = true;
  if ($('agentSendBtn')) $('agentSendBtn').disabled = true;
  renderAgentPanel();
  try {
    const data = await api('/api/chat', {
      method: 'POST',
      body: {
        message: [
          content,
          attachments.length && content ? `\n用户附带了 ${attachments.length} 张图片，请按图片分析场景理解需求。` : ''
        ].join('').trim(),
        model: conversation.model,
        reasoningEffort: conversation.reasoningEffort,
        images: attachments.map((item) => ({ dataUrl: item.dataUrl, mimeType: item.mimeType, name: item.name }))
      }
    });
    updateAgentConversation(conversation.id, (item) => ({
      ...item,
      messages: item.messages.map((message) => message.id === assistantMessage.id ? { ...message, content: data.message || '没有返回内容。' } : message)
    }));
  } catch (error) {
    updateAgentConversation(conversation.id, (item) => ({
      ...item,
      messages: item.messages.map((message) => message.id === assistantMessage.id ? { ...message, content: formatAgentError(error.message) } : message)
    }));
  } finally {
    state.agentPending = false;
    if ($('agentSendBtn')) $('agentSendBtn').disabled = false;
    renderAgentPanel();
  }
}

export async function readAgentImageFiles(files) {
  ensureAgentConversationsLoaded();
  const incoming = Array.from(files || []).slice(0, Math.max(0, 4 - state.agentAttachments.length));
  if (!incoming.length) return;
  const next = [];
  for (const file of incoming) {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setAgentStatus('智能对话只支持常见图片格式。', true);
      continue;
    }
    if (file.size > 12 * 1024 * 1024) {
      setAgentStatus('单张图片不能超过 12 兆。', true);
      continue;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.readAsDataURL(file);
    });
    next.push({ id: newId('agent-image'), name: file.name || '图片', dataUrl, mimeType: file.type });
  }
  state.agentAttachments = [...state.agentAttachments, ...next].slice(0, 4);
  renderAgentAttachments();
  if (next.length) setAgentStatus(`已添加 ${next.length} 张对话图片。`);
}

function handleAgentConversationListClick(event) {
  const action = event.target.closest('[data-agent-action]');
  if (action) {
    event.stopPropagation();
    const id = action.dataset.agentId;
    if (action.dataset.agentAction === 'rename') {
      state.activeAgentConversationId = id;
      renameActiveAgentConversation();
      return;
    }
    deleteAgentConversation(id);
    return;
  }
  const button = event.target.closest('[data-agent-conversation]');
  if (button) selectAgentConversation(button.dataset.agentConversation);
}

function handleAgentConversationListKeydown(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  const action = event.target.closest('[data-agent-action]');
  if (!action) return;
  event.preventDefault();
  action.click();
}

function bindAgentEvents() {
  if (agentEventsBound) return;
  const panel = $('agentPanel');
  if (!panel) return;
  agentEventsBound = true;

  if ($('agentNewConversationBtn')) $('agentNewConversationBtn').onclick = createNewAgentConversation;
  if ($('agentRenameBtn')) $('agentRenameBtn').onclick = renameActiveAgentConversation;
  if ($('agentClearBtn')) $('agentClearBtn').onclick = clearActiveAgentConversation;
  if ($('agentModelSelect')) {
    $('agentModelSelect').onchange = () => {
      ensureAgentConversationsLoaded();
      const conversation = activeAgentConversation();
      if (!conversation) return;
      updateAgentConversation(conversation.id, { model: $('agentModelSelect').value || defaultAgentModel });
      renderAgentPanel();
    };
  }
  if ($('agentReasoningSelect')) {
    $('agentReasoningSelect').onchange = () => {
      ensureAgentConversationsLoaded();
      const conversation = activeAgentConversation();
      if (!conversation) return;
      updateAgentConversation(conversation.id, { reasoningEffort: $('agentReasoningSelect').value || 'medium' });
      renderAgentPanel();
    };
  }
  if ($('agentSendBtn')) $('agentSendBtn').onclick = sendAgentMessage;
  if ($('agentInput')) {
    $('agentInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) sendAgentMessage();
    });
  }
  if ($('agentImageInput')) {
    $('agentImageInput').onchange = async () => {
      await readAgentImageFiles($('agentImageInput').files);
      $('agentImageInput').value = '';
    };
  }
  if ($('agentConversationList')) {
    $('agentConversationList').addEventListener('click', handleAgentConversationListClick);
    $('agentConversationList').addEventListener('keydown', handleAgentConversationListKeydown);
  }
  if ($('agentAttachments')) {
    $('agentAttachments').addEventListener('click', (event) => {
      const button = event.target.closest('[data-remove-agent-attachment]');
      if (!button) return;
      state.agentAttachments = state.agentAttachments.filter((item) => item.id !== button.dataset.removeAgentAttachment);
      renderAgentAttachments();
    });
  }
  panel.addEventListener('paste', async (event) => {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    event.preventDefault();
    await readAgentImageFiles(files);
  });
  panel.addEventListener('dragover', (event) => {
    if (Array.from(event.dataTransfer?.files || []).length) event.preventDefault();
  });
  panel.addEventListener('drop', async (event) => {
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    event.preventDefault();
    await readAgentImageFiles(files);
  });
}
