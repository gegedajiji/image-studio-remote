import { state } from './state.js';
import { $ } from './dom.js';
import { escapeHtml, yuan } from './format.js';
import { imageSources, imageSrc } from './image-utils.js';
import { qualityLabel, trimmedTitle } from './studio-format.js';

let actions = {};
const baseHistoryRenderLimit = 48;
const historyRenderStep = 48;

export function initHistoryPanel(nextActions = {}) {
  actions = { ...nextActions };
}

export function historyHasActiveFilters() {
  return state.historyStatusFilter !== 'all'
    || state.historyModeFilter !== 'all'
    || Boolean(state.historySearch.trim());
}

export function historyQueryString() {
  const params = new URLSearchParams();
  if (state.historyStatusFilter !== 'all') params.set('status', state.historyStatusFilter);
  if (state.historyModeFilter !== 'all') params.set('mode', state.historyModeFilter);
  if (state.historySearch.trim()) params.set('q', state.historySearch.trim());
  return params.toString();
}

function historyEmptyMessage() {
  if (!historyHasActiveFilters() && !state.historyTotal) {
    return '还没有历史记录。创建第一条图片任务后，这里会保存缩略图、提示词和发布状态。';
  }
  if (state.historySearch.trim()) return '没有找到匹配的历史记录。换个关键词或清除搜索试试。';
  if (state.historyStatusFilter === 'pending') return '当前没有正在生成的任务。提交生图后，刷新页面也可以从这里继续查看进度。';
  if (state.historyStatusFilter === 'unpublished') return '没有待上传作品。生成成功后可以上传到交流区，让其他用户点赞、评论；参考创作与免费下载只作辅助参考。';
  if (state.historyStatusFilter === 'published') return '还没有已发布作品。发布后可在这里快速回到交流区作品。';
  if (state.historyStatusFilter === 'failed') return '没有失败记录。生成失败的任务会保留在这里，方便调整参数。';
  if (state.historyModeFilter === 'edit') return '还没有图生图记录。上传源图并生成后，会在这里保存参数。';
  return '当前筛选下没有历史记录。切换到“全部”查看所有图片任务。';
}

function renderFilteredHistoryEmpty() {
  const clear = historyHasActiveFilters()
    ? '<button type="button" data-history-action="clearFilters">清除筛选</button>'
    : '';
  return `<p class="history-empty-copy">${escapeHtml(historyEmptyMessage())}${clear}</p>`;
}

function syncHistoryFilters() {
  if ($('historySearchInput') && $('historySearchInput').value !== state.historySearch) {
    $('historySearchInput').value = state.historySearch;
  }
  document.querySelectorAll('[data-history-status]').forEach((button) => {
    button.classList.toggle('active', button.dataset.historyStatus === state.historyStatusFilter);
  });
  document.querySelectorAll('[data-history-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.historyMode === state.historyModeFilter);
  });
}

export function renderHistoryList() {
  const history = $('history');
  if (!history) return;
  syncHistoryFilters();
  const count = state.historyItems.length;
  const renderLimit = Math.max(baseHistoryRenderLimit, Number(state.historyRenderLimit || baseHistoryRenderLimit));
  const visibleItems = state.historyItems.slice(0, renderLimit);
  const hasMore = count > visibleItems.length;
  if ($('historyHint')) {
    $('historyHint').textContent = state.historyTotal > count ? `${count}/${state.historyTotal}` : String(count);
  }
  history.innerHTML = count
    ? `${visibleItems.map(renderHistoryItem).join('')}${renderHistoryMoreControl(count, visibleItems.length, hasMore)}`
    : renderFilteredHistoryEmpty();
  bindHistoryItemClicks();
}

export function resetHistoryRenderLimit() {
  state.historyRenderLimit = baseHistoryRenderLimit;
}

function extendHistoryRenderLimit() {
  state.historyRenderLimit = Math.min(
    state.historyItems.length,
    Math.max(baseHistoryRenderLimit, Number(state.historyRenderLimit || baseHistoryRenderLimit)) + historyRenderStep
  );
  renderHistoryList();
}

function renderHistoryMoreControl(total, rendered, hasMore) {
  if (!hasMore) return '';
  return `
    <button class="history-more-button" type="button" data-history-action="showMore">
      继续显示 ${Math.min(historyRenderStep, total - rendered)} 条
      <span>${rendered}/${total}</span>
    </button>
  `;
}

function renderHistoryItem(item) {
  const sources = imageSources(item);
  const src = sources[0] || imageSrc(item);
  const safeSrc = escapeHtml(src);
  const placeholderAlt = item.status === 'pending' ? '生成中' : '生成失败';
  const image = src ? `<img src="${safeSrc}" alt="作品" loading="lazy" />` : `<img src="/assets/showcase/hero-studio.svg" alt="${placeholderAlt}" />`;
  const mode = item.mode === 'edit' ? '图生图' : '文生图';
  const failedMessage = actions.formatGenerateError?.(item.error || '生成失败') || item.error || '生成失败';
  const title = escapeHtml(item.communityPost?.title || trimmedTitle(item.prompt || `${mode} 任务`, 28));
  const qualityText = qualityLabel(item.quality);
  const consumedAmountCents = Number(item.consumedAmountCents || item.priceCents || 0);
  const refundedAmountCents = Number(item.refundedAmountCents || 0);
  const remainingAmountCents = Math.max(0, Number(item.remainingAmountCents ?? (consumedAmountCents - refundedAmountCents)));
  const chargeText = item.status === 'pending'
    ? '扣费待确认'
    : item.status === 'failed'
      ? '未扣费'
      : refundedAmountCents > 0
        ? `实扣 ${yuan(remainingAmountCents)}`
        : consumedAmountCents > 0
          ? `扣费 ${yuan(consumedAmountCents)}`
          : '未扣费';
  const canvasAction = src && item.status !== 'failed' && item.status !== 'pending'
    ? `<button class="history-canvas-button" type="button" data-history-action="canvas" data-generation-id="${escapeHtml(item.id)}">放到画布</button>`
    : '';
  const metaLine = `
    <div class="history-stat-line">
      <span class="history-quality-pill">${escapeHtml(qualityText)}</span>
      <span class="history-charge-text">${escapeHtml(chargeText)}</span>
    </div>
  `;
  const content = item.status === 'failed'
    ? `
      <div class="history-meta">
        <strong>${title}</strong>
        ${metaLine}
      </div>
      <p class="error-text">失败：${escapeHtml(failedMessage)}</p>
    `
    : `
      <div class="history-meta">
        <strong>${title}</strong>
        ${metaLine}
      </div>
    `;
  return `
    <article class="history-item" data-generation-id="${escapeHtml(item.id)}" tabindex="0" role="button" aria-label="查看历史作品">
      ${image}
      <div class="history-body">
        ${content}
        ${canvasAction}
      </div>
    </article>
  `;
}

function bindHistoryItemClicks() {
  const history = $('history');
  if (!history || history.dataset.bound === 'true') return;
  history.dataset.bound = 'true';
  const runHistoryAction = (button) => {
    const id = button.dataset.generationId;
    if (button.dataset.historyAction === 'clearFilters') return actions.clearFilters?.();
    if (button.dataset.historyAction === 'showMore') return extendHistoryRenderLimit();
    if (button.dataset.historyAction === 'delete') return actions.delete?.(id, button);
    if (button.dataset.historyAction === 'reuse') return actions.reuse?.(id);
    if (button.dataset.historyAction === 'resumePending') return actions.resumePending?.(id, state.historyItems.find((entry) => entry.id === id));
    if (button.dataset.historyAction === 'publish') return actions.publish?.(id);
    if (button.dataset.historyAction === 'canvas') return actions.addToCanvas?.(id);
    if (button.dataset.historyAction === 'communityDownload') return actions.communityDownload?.(button.dataset.communityPostId, 0);
    if (button.dataset.historyAction === 'shareCommunity') return actions.shareCommunity?.(button.dataset.communityPostId);
    if (button.dataset.historyAction === 'viewCommunity') return actions.viewCommunity?.(button.dataset.communityPostId, { updateUrl: true });
    if (button.dataset.historyAction === 'creatorNext') return actions.creatorNext?.(button.dataset.postId, button.dataset.creatorCardAction);
    return null;
  };
  history.addEventListener('click', (event) => {
    const button = event.target.closest('[data-history-action]');
    if (button && history.contains(button)) {
      event.stopPropagation();
      runHistoryAction(button);
      return;
    }
    if (event.target.closest('a, button, summary, details')) return;
    const item = event.target.closest('.history-item');
    if (item && history.contains(item)) actions.openGeneration?.(item.dataset.generationId);
  });
  history.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('a, button, summary, details')) return;
    const item = event.target.closest('.history-item');
    if (!item || !history.contains(item)) return;
    event.preventDefault();
    actions.openGeneration?.(item.dataset.generationId);
  });
}
