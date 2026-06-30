import { state } from './state.js';
import { $ } from './dom.js';
import { api } from './api-client.js';
import { createDebouncer } from './scheduler.js';
import { historyHasActiveFilters, historyQueryString, renderHistoryList } from './history-panel.js';

const scheduleHistorySearch = createDebouncer(260);

let callbacks = {
  setStatus: () => {},
  openAuthModal: () => {},
  openCommunityPublish: () => {},
  applyGenerationSettings: () => {},
  renderPreviewEmpty: () => {}
};

export function initHistoryController(nextCallbacks = {}) {
  callbacks = { ...callbacks, ...nextCallbacks };
}

export async function loadHistory() {
  const loadToken = ++state.historyLoadToken;
  if (!state.user) {
    state.historyItems = [];
    state.historyTotal = 0;
    state.historyDeletableCount = 0;
    renderHistoryList();
    return;
  }
  const historyNode = $('history');
  if (historyNode) historyNode.innerHTML = '<p class="history-loading">正在读取会话记录</p>';
  const query = historyQueryString();
  const data = await api(`/api/history${query ? `?${query}` : ''}`);
  if (loadToken !== state.historyLoadToken) return;
  state.historyItems = data.generations || [];
  state.historyTotal = Number(data.total ?? data.generations?.length ?? 0);
  state.historyDeletableCount = Number(data.deletableCount ?? 0);
  renderHistoryList();
}

export async function clearHistoryFilters() {
  state.historySearch = '';
  state.historyStatusFilter = 'all';
  state.historyModeFilter = 'all';
  await loadHistory();
}

export async function publishHistoryGeneration(id) {
  const summary = state.historyItems.find((entry) => entry.id === id);
  if (!summary) return;
  if (summary.status === 'failed') return callbacks.setStatus('只能发布生成成功的作品。', true);
  if (state.historyPublishPendingIds.includes(id)) return;
  state.historyPublishPendingIds = [...state.historyPublishPendingIds, id];
  renderHistoryList();
  try {
    const data = await api(`/api/history/${encodeURIComponent(id)}`);
    callbacks.openCommunityPublish(data.generation, 0, { defaultAll: true });
  } catch (error) {
    callbacks.setStatus(error.message, true);
  } finally {
    state.historyPublishPendingIds = state.historyPublishPendingIds.filter((pendingId) => pendingId !== id);
    renderHistoryList();
  }
}

export async function reuseHistoryGeneration(id) {
  const item = state.historyItems.find((entry) => entry.id === id);
  if (!item) return;
  callbacks.applyGenerationSettings(item, {
    submit: false,
    statusText: item.mode === 'edit' ? '已回填历史提示词和参数；源图需重新上传后再生成。' : '已回填历史提示词和参数。'
  });
}

export async function deleteHistoryGeneration(id, button) {
  if (!id || !button) return;
  if (button.dataset.confirm !== '1') {
    button.dataset.confirm = '1';
    button.textContent = '确认删除';
    callbacks.setStatus('再次点击确认删除这条历史。');
    window.setTimeout(() => {
      button.dataset.confirm = '';
      button.textContent = '删除';
    }, 3000);
    return;
  }
  button.disabled = true;
  callbacks.setStatus('正在删除历史…');
  try {
    await api(`/api/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (state.previewItem?.id === id) callbacks.renderPreviewEmpty();
    await loadHistory();
    callbacks.setStatus('已删除这条历史。');
  } catch (error) {
    callbacks.setStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

export async function clearHistory() {
  const button = $('clearHistoryBtn');
  if (!button) return;
  if (!state.user) {
    callbacks.openAuthModal();
    return callbacks.setStatus('请先登录后再清理历史。', true);
  }
  button.disabled = true;
  let currentCount = Number(state.historyDeletableCount || 0);
  if (!Number.isFinite(currentCount) || currentCount <= 0) {
    try {
      const data = await api('/api/history?limit=0');
      currentCount = Number(data.deletableCount || 0);
      state.historyDeletableCount = currentCount;
    } catch (error) {
      button.disabled = false;
      return callbacks.setStatus(error.message, true);
    }
  }
  if (currentCount <= 0) {
    button.disabled = false;
    return callbacks.setStatus('当前账号没有可清理的历史；生成中和已发布作品会保留。');
  }
  if (button.dataset.confirm !== '1') {
    button.dataset.confirm = '1';
    button.classList.add('confirming');
    button.title = '再次点击确认清理';
    const scopeCopy = historyHasActiveFilters() ? '注意：这是清理当前账号全部可清理历史，不只清理当前筛选结果。' : '';
    callbacks.setStatus(`再次点击清理历史，将删除当前账号 ${currentCount} 条可清理历史；生成中和已发布到交流区的作品会保留。${scopeCopy}`);
    window.setTimeout(() => {
      button.dataset.confirm = '';
      button.classList.remove('confirming');
      button.title = '清理历史';
    }, 3500);
    button.disabled = false;
    return;
  }
  callbacks.setStatus('正在清理历史…');
  try {
    const data = await api('/api/history', { method: 'DELETE' });
    callbacks.setStatus(`已清理 ${data.deleted || 0} 条历史。`);
    await loadHistory();
    if (state.previewItem?.id) {
      try {
        await api(`/api/history/${encodeURIComponent(state.previewItem.id)}`);
      } catch {
        callbacks.renderPreviewEmpty();
      }
    }
  } catch (error) {
    callbacks.setStatus(error.message, true);
  } finally {
    button.dataset.confirm = '';
    button.classList.remove('confirming');
    button.title = '清理历史';
    button.disabled = false;
  }
}

export function bindHistoryControls() {
  const clearButton = $('clearHistoryBtn');
  if (clearButton) clearButton.onclick = clearHistory;
  $('historySearchInput')?.addEventListener('input', (event) => {
    state.historySearch = event.target.value;
    scheduleHistorySearch(() => loadHistory().catch((error) => callbacks.setStatus(error.message, true)));
  });
  document.querySelectorAll('[data-history-status]').forEach((button) => {
    button.onclick = () => {
      state.historyStatusFilter = ['all', 'pending', 'unpublished', 'published', 'failed'].includes(button.dataset.historyStatus) ? button.dataset.historyStatus : 'all';
      loadHistory().catch((error) => callbacks.setStatus(error.message, true));
    };
  });
  document.querySelectorAll('[data-history-mode]').forEach((button) => {
    button.onclick = () => {
      state.historyModeFilter = button.dataset.historyMode === 'edit' ? 'edit' : button.dataset.historyMode === 'generate' ? 'generate' : 'all';
      loadHistory().catch((error) => callbacks.setStatus(error.message, true));
    };
  });
}
