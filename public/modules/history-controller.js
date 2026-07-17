import { state } from './state.js';
import { $ } from './dom.js';
import { api } from './api-client.js';
import { sourceToDataUrl } from './image-utils.js';
import { addReferenceImage, renderReferencePreview } from './source-images.js';
import { createDebouncer } from './scheduler.js';
import { MAX_STUDIO_SOURCE_IMAGES } from './constants.js';
import {
  historyHasActiveFilters,
  historyQueryString,
  renderHistoryList,
  resetHistoryRenderLimit
} from './history-panel.js';

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

function mergeHistoryItems(currentItems = [], nextItems = []) {
  const seen = new Set();
  return [...currentItems, ...nextItems].filter((item) => {
    const id = String(item?.id || '');
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export async function loadHistory({ append = false } = {}) {
  if (append && (state.historyLoadingMore || !state.historyHasMore)) return;
  const loadToken = ++state.historyLoadToken;
  if (!append) {
    resetHistoryRenderLimit();
    state.historyLoadingMore = false;
  }
  if (!state.user) {
    state.historyItems = [];
    state.historyTotal = 0;
    state.historyDeletableCount = 0;
    state.historyNextOffset = 0;
    state.historyHasMore = false;
    state.historyLoadingMore = false;
    renderHistoryList();
    return;
  }
  const historyNode = $('history');
  if (!append && historyNode) historyNode.innerHTML = '<p class="history-loading">正在读取会话记录</p>';
  if (append) {
    state.historyLoadingMore = true;
    const moreButton = historyNode?.querySelector('[data-history-action="showMore"]');
    if (moreButton) {
      moreButton.disabled = true;
      moreButton.firstChild.textContent = '正在读取更多历史 ';
    }
  }
  const offset = append ? Number(state.historyNextOffset || state.historyItems.length || 0) : 0;
  const limit = Math.max(1, Math.min(100, Number(state.historyPageSize || 48)));
  try {
    const query = historyQueryString({ limit, offset });
    const data = await api(`/api/history${query ? `?${query}` : ''}`);
    if (loadToken !== state.historyLoadToken) return;
    const nextItems = Array.isArray(data.generations) ? data.generations : [];
    state.historyItems = append ? mergeHistoryItems(state.historyItems, nextItems) : nextItems;
    state.historyTotal = Number(data.total ?? state.historyItems.length ?? 0);
    state.historyDeletableCount = Number(data.deletableCount ?? 0);
    state.historyNextOffset = Number(data.nextOffset ?? state.historyItems.length);
    state.historyHasMore = Boolean(data.hasMore);
    if (append) state.historyLoadingMore = false;
    renderHistoryList();
  } catch (error) {
    if (loadToken !== state.historyLoadToken) return;
    state.historyLoadingMore = false;
    renderHistoryList();
    throw error;
  } finally {
    if (append && loadToken === state.historyLoadToken && state.historyLoadingMore) {
      state.historyLoadingMore = false;
      renderHistoryList();
    }
  }
}

export async function loadMoreHistory() {
  return loadHistory({ append: true });
}

export async function clearHistoryFilters() {
  state.historySearch = '';
  state.historyStatusFilter = 'all';
  state.historyModeFilter = 'all';
  resetHistoryRenderLimit();
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
  const sourceImages = Array.isArray(item.sourceImages)
    ? item.sourceImages.filter((image) => image?.imageUrl).slice(0, MAX_STUDIO_SOURCE_IMAGES)
    : [];
  callbacks.applyGenerationSettings(item, {
    submit: false,
    statusText: item.mode === 'edit' && sourceImages.length ? '已回填历史提示词和参数，正在恢复源图…' : '已回填历史提示词和参数。'
  });
  if (item.mode !== 'edit' || !sourceImages.length) return;
  let restoredCount = 0;
  try {
    for (const [index, image] of sourceImages.entries()) {
      const dataUrl = await sourceToDataUrl(image.imageUrl);
      if (addReferenceImage(dataUrl, { replace: index === 0, label: `历史源图 ${index + 1}` })) {
        restoredCount += 1;
      }
    }
    renderReferencePreview();
    callbacks.setStatus(restoredCount
      ? `已恢复 ${restoredCount} 张历史源图，可以直接按图生图重新生成。`
      : '历史源图恢复失败，请重新上传源图后再生成。', restoredCount === 0);
  } catch (error) {
    renderReferencePreview();
    callbacks.setStatus(`历史源图读取失败，请重新上传源图后再生成：${error.message}`, true);
  }
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
    resetHistoryRenderLimit();
    scheduleHistorySearch(() => loadHistory().catch((error) => callbacks.setStatus(error.message, true)));
  });
  document.querySelectorAll('[data-history-status]').forEach((button) => {
    button.onclick = () => {
      state.historyStatusFilter = ['all', 'pending', 'unpublished', 'published', 'failed'].includes(button.dataset.historyStatus) ? button.dataset.historyStatus : 'all';
      resetHistoryRenderLimit();
      loadHistory().catch((error) => callbacks.setStatus(error.message, true));
    };
  });
  document.querySelectorAll('[data-history-mode]').forEach((button) => {
    button.onclick = () => {
      state.historyModeFilter = button.dataset.historyMode === 'edit' ? 'edit' : button.dataset.historyMode === 'generate' ? 'generate' : 'all';
      resetHistoryRenderLimit();
      loadHistory().catch((error) => callbacks.setStatus(error.message, true));
    };
  });
}
