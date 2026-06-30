import { state } from './state.js';
import { $ } from './dom.js';
import { api } from './api-client.js';
import {
  copyText,
  escapeHtml
} from './format.js';
import { setStatus as defaultSetStatus } from './status-ui.js';

let setStoryboardStatus = defaultSetStatus;
let openStoryboardAuthModal = () => {};
let saveCurrentPrompt = () => {};
let updatePromptCount = () => {};
let updateComposerPromptState = () => {};
let formatStoryboardError = (message) => String(message || '') || '分镜草稿生成失败，请稍后重试。';

export function initStoryboardController(options = {}) {
  setStoryboardStatus = options.setStatus || defaultSetStatus;
  openStoryboardAuthModal = options.openAuthModal || (() => {});
  saveCurrentPrompt = options.saveCurrentPrompt || (() => {});
  updatePromptCount = options.updatePromptCount || (() => {});
  updateComposerPromptState = options.updateComposerPromptState || (() => {});
  formatStoryboardError = options.formatError || formatStoryboardError;
}

export function parseStoryboardText(text) {
  const cleaned = String(text || '')
    .replace(/```[a-z]*\n?/gi, '')
    .replace(/```/g, '')
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*]|\d+[.、)]|分镜\s*\d+[:：-]?)\s*/i, '').trim())
    .filter(Boolean);
  return cleaned.slice(0, 4);
}

async function draftStoryboard() {
  if (state.storyboardPending) return;
  if (!state.user) {
    openStoryboardAuthModal();
    return setStoryboardStatus('请先登录后再生成分镜草稿。', true);
  }
  saveCurrentPrompt();
  const prompt = state.prompts[state.mode].trim();
  if (prompt.length < 2) {
    renderStoryboardDraft([]);
    return setStoryboardStatus('请输入提示词后再生成分镜草稿。', true);
  }
  state.storyboardPending = true;
  state.storyboardText = '';
  state.storyboardScenes = [];
  renderStoryboardDraft(['正在拆解分镜…', '统一角色与画面风格…', '准备镜头提示词…']);
  setStoryboardStatus('正在生成分镜草稿，不会扣费。');
  try {
    const data = await api('/api/chat', {
      method: 'POST',
      body: {
        message: [
          '把下面的生图需求拆成 4 个连续分镜提示词。',
          '每行一个分镜，直接输出画面提示词，不要解释，不要 Markdown。',
          '要求角色、场景、色调连续，适合后续逐张生成。',
          '',
          prompt
        ].join('\n')
      }
    });
    state.storyboardText = data.message || '';
    state.storyboardPending = false;
    const scenes = parseStoryboardText(state.storyboardText);
    state.storyboardScenes = scenes;
    renderStoryboardDraft(scenes.length ? scenes : [state.storyboardText]);
    setStoryboardStatus('分镜草稿已生成，可复制或继续生成整组画面。');
  } catch (error) {
    state.storyboardPending = false;
    state.storyboardScenes = [];
    renderStoryboardDraft([]);
    setStoryboardStatus(formatStoryboardError(error.message), true);
  } finally {
    state.storyboardPending = false;
  }
}

function currentStoryboardText() {
  return (state.storyboardScenes.length ? state.storyboardScenes : parseStoryboardText(state.storyboardText)).join('\n');
}

export function renderStoryboardDraft(scenes = parseStoryboardText(state.storyboardText)) {
  const node = $('storyboardDraft');
  if (!node) return;
  const visible = state.layout === 'storyboard';
  node.classList.toggle('visible', visible);
  if (!visible) {
    node.innerHTML = '';
    return;
  }
  const items = scenes.length ? scenes : ['输入提示词后可先生成分镜草稿，不会扣费。'];
  const hasStoryboardContent = Boolean(state.storyboardText.trim());
  node.innerHTML = `
    <div class="storyboard-draft-head">
      <span>分镜草稿</span>
      <button type="button" id="draftStoryboardBtn">${state.storyboardPending ? '生成中…' : '生成草稿'}</button>
    </div>
    <div class="storyboard-scenes">
      ${items.map((scene, index) => `
        <article>
          <strong>${index + 1}</strong>
          <p>${escapeHtml(scene)}</p>
        </article>
      `).join('')}
    </div>
    <div class="storyboard-actions">
      <button type="button" id="copyStoryboardBtn" ${hasStoryboardContent ? '' : 'disabled'}>复制分镜</button>
      <button type="button" id="useStoryboardBtn" ${hasStoryboardContent ? '' : 'disabled'}>填入输入框</button>
    </div>
  `;
  $('draftStoryboardBtn').disabled = state.storyboardPending;
  $('draftStoryboardBtn').onclick = draftStoryboard;
  $('copyStoryboardBtn').onclick = async () => {
    try {
      await copyText(currentStoryboardText());
      setStoryboardStatus('分镜已复制。');
    } catch (error) {
      setStoryboardStatus(error.message, true);
    }
  };
  $('useStoryboardBtn').onclick = () => {
    const text = currentStoryboardText();
    if (!text.trim()) return setStoryboardStatus('暂无分镜内容。', true);
    const prompt = $('prompt');
    if (!prompt) return;
    prompt.value = text.slice(0, Number(prompt.maxLength || 1000));
    state.prompts[state.mode] = prompt.value;
    updatePromptCount();
    updateComposerPromptState();
    setStoryboardStatus('已填入分镜提示词。');
  };
}
