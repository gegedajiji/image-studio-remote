import { state } from './modules/state.js';
import {
  communityHeatHelpText,
  creatorFeedbackHandledMigrationPrefix,
  creatorFeedbackHandledStoragePrefix,
  recommendedQualityMap,
  recommendedSizeMap,
  routeByPanel,
  supportedSizes
} from './modules/constants.js';
import { $, scrollIntoViewSafe } from './modules/dom.js';
import { api } from './modules/api-client.js';
import {
  copyText,
  escapeHtml,
  formatDate,
  parseSingularityToCents,
  parseYuanToCents,
  singularity,
  yuan
} from './modules/format.js';
import {
  imageEntries,
  imageSources,
  normalizeImageIndexSelection,
  sourceToDataUrl
} from './modules/image-utils.js';
import {
  initHistoryPanel,
  renderHistoryList
} from './modules/history-panel.js';
import {
  bindHistoryControls,
  clearHistoryFilters,
  deleteHistoryGeneration,
  initHistoryController,
  loadHistory,
  publishHistoryGeneration,
  reuseHistoryGeneration
} from './modules/history-controller.js';
import { initInfiniteCanvas } from './modules/infinite-canvas-entry.js';
import { setAuthStatus, setInlineStatus, setStatus } from './modules/status-ui.js';
import {
  addReferenceImage,
  clearReferenceImage,
  clearSelectionMask,
  currentImageDataUrls,
  hasActiveMask,
  initSourceImages,
  readImageFiles,
  renderReferencePreview,
  syncActiveReference,
  syncSourceImageStateClass
} from './modules/source-images.js';
import {
  bindSelectionMaskEvents,
  closeSelectionModal,
  initSelectionMask,
  openSelectionModal
} from './modules/selection-mask.js';
import {
  activateFloatingPillMenu,
  bindComposerResize,
  bindHistoryResize,
  bindStudioMotion,
  closePillMenus,
  normalizeHistoryLayoutState,
  observeComposerLayout,
  restoreComposerHeight,
  restoreHistoryWidth,
  restoreTheme,
  scheduleFloatingPillMenuPosition,
  scheduleResultLayoutSettle,
  toggleTheme
} from './modules/workspace-ui.js';
import { createDebouncer } from './modules/scheduler.js';
import {
  buildGenerationPayload,
  clearGenerationTimers,
  createLongGenerationTimers,
  initGenerationRunner,
  pollGenerationResult,
  submitGenerationRequest
} from './modules/generation-runner.js';
import {
  beginGenerationActivity,
  finishGenerationActivity,
  isCurrentGenerationActivity,
  isGenerateButtonLocked,
  lockGenerateButtonForSession,
  unlockGenerateButtonForSession
} from './modules/generation-session.js';
import {
  friendlyGenerateError,
  generationPreviewMeta,
  isReuseSourceExpiredError,
  mergeReusePostIntoGeneration
} from './modules/generation-result.js';
import {
  addHistoryGenerationToCanvas,
  initGenerationHistoryActions,
  openHistoryGeneration,
  resumePendingGeneration
} from './modules/generation-history-actions.js';
import {
  applyGenerationSettings,
  initGenerationSettingsController
} from './modules/generation-settings-controller.js';
import {
  initPreviewController,
  renderFailedGeneration,
  renderGeneratedImages,
  renderGeneratingPreview,
  renderPreviewEmpty,
  setResultImageState,
  showGenerationInPreview
} from './modules/preview-controller.js';
import {
  clearCommunityCardCache,
  communityDiscoveryFilterById,
  communityDiscoveryFilters,
  communityPrimaryMetrics,
  communitySecondaryMetrics,
  communityTagList,
  initCommunityView,
  renderCommunityCards,
  renderStudioTemplateCards,
  serverCommunityDiscoveryFilters
} from './modules/community-view.js';
import {
  cleanCommunityDisplayText,
  communityPublishDraft,
  normalizeCommunityPostForDisplay,
  parseTags
} from './modules/community-text.js';
import {
  clearCreatorFeedbackSummaryCache,
  creatorFeedbackSummaryForPost as summarizeCreatorFeedbackForPost,
  isCreatorFeedbackHandledByState,
  isCreatorFeedbackReported
} from './modules/community-feedback-summary.js';
import {
  adminCommunityHtml,
  adminGenerationLogsHtml,
  adminGenerationUserOptionsHtml,
  adminImageUpstreamsHtml,
  adminRedeemCodesHtml,
  adminUsersHtml
} from './modules/admin-view.js';
import {
  billingStateText,
  durationText,
  formatResultLabel,
  generationModeText,
  generationStatusText,
  qualityLabel,
  redeemStatusForClass,
  redeemStatusText,
  renderSpecLabels,
  selectedPriceCompactText,
  selectedPriceText,
  sizeLabelText,
  sourceText,
  userStatusText
} from './modules/studio-format.js';
import {
  initAgentController,
  renderAgentPanel
} from './modules/agent-controller.js';
import {
  initApiDocsController,
  loadApiKeys,
  renderApiDocsPanel
} from './modules/api-docs-controller.js';
import {
  closeOriginalViewer,
  initOriginalViewerController,
  openOriginalViewer
} from './modules/original-viewer-controller.js';
import {
  initStoryboardController,
  parseStoryboardText,
  renderStoryboardDraft
} from './modules/storyboard-controller.js';

const scheduleCommunitySearch = createDebouncer(320);
const scheduleAdminGenerationLogSearch = createDebouncer(260);
const scheduleAdminRedeemSearch = createDebouncer(260);

let preferredStudioRoute = '/image/history';

function panelFromPath(pathname = window.location.pathname) {
  if (pathname.startsWith('/prompts')) return 'prompts';
  if (pathname.startsWith('/agent')) return 'agent';
  if (pathname.startsWith('/api-docs') || pathname.startsWith('/developers')) return 'developers';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/admin')) return 'admin';
  return 'studio';
}

let promptLibraryData = {
  version: 1,
  updatedAt: '',
  categories: [],
  items: []
};

async function refreshHealth() {
  const pill = $('readyPill');
  if (!pill) return;
  try {
    const data = await api('/api/health');
    pill.classList.remove('offline', 'partial');
    pill.classList.toggle('partial', data.imageReady && !data.textReady);
    pill.title = data.textReady ? '图片生成和图片助手均已连接' : '图片生成已连接，图片助手暂不可用';
    pill.lastChild.textContent = data.textReady ? '图片就绪' : '图片就绪 · 助手离线';
    if ($('settingsImageModel')) $('settingsImageModel').textContent = '图像通道已配置';
    if ($('settingsUpstream')) $('settingsUpstream').textContent = '通道已连接';
    if ($('agentModelBadge')) $('agentModelBadge').textContent = data.textReady ? '文本模型已连接' : '文本模型';
  } catch {
    pill.classList.remove('partial');
    pill.classList.add('offline');
    pill.title = '本地服务异常';
    pill.lastChild.textContent = '异常';
    if ($('settingsImageModel')) $('settingsImageModel').textContent = '服务异常';
    if ($('settingsUpstream')) $('settingsUpstream').textContent = '请检查本地服务';
  }
}

function cueComposerFocus({ focusPrompt = false, focusGenerate = false } = {}) {
  const composer = $('create');
  if (!composer) return;
  composer.classList.remove('composer-cue');
  void composer.offsetWidth;
  composer.classList.add('composer-cue');
  window.setTimeout(() => composer.classList.remove('composer-cue'), 900);
  if (focusPrompt) window.setTimeout(() => $('prompt')?.focus({ preventScroll: true }), 120);
  if (focusGenerate) window.setTimeout(() => $('generateBtn')?.focus({ preventScroll: true }), 120);
}

function requireLoginForCommunity(action, postId, options = {}) {
  if (!postId) return;
  state.pendingAuthAction = { type: action, postId, ...options };
  if (!options.keepDetailOpen) closeCommunityDetailModal();
  openAuthModal({ reason: action });
}

function requireLoginForAction(type, options = {}, message = '请先登录。') {
  state.pendingAuthAction = { type, ...options };
  openAuthModal({ reason: type });
  setStatus(message, true);
}

function requireLoginAfterExpired(pending = null) {
  state.user = null;
  if (pending) state.pendingAuthAction = pending;
  clearCreatorFeedbackState();
  leavePrivateCommunityView();
  sanitizeCommunityStateForViewer();
  renderAccount();
  renderCommunityPanel();
  if (state.communityDetailPost) renderCommunityDetail();
  openAuthModal({ reason: pending?.type });
}

async function runPendingAuthAction() {
  const pending = state.pendingAuthAction;
  if (!pending || !state.user) return { attempted: false, success: false };
  state.pendingAuthAction = null;
  try {
    if (pending.postId && pending.type !== 'deletePost') {
      await openCommunityDetail(pending.postId, { updateUrl: true });
    }
    if (pending.type === 'communityScopeMine') {
      switchPanel('prompts');
      state.communityScope = 'mine';
      state.communityView = pending.view === 'feedback' ? 'feedback' : 'posts';
      if (state.communityView === 'feedback') state.creatorFeedbackPostFilterId = '';
      await loadCommunityPosts({ silent: true });
      renderCommunityPanel();
      setStatus(state.communityView === 'feedback' ? '已打开反馈收件箱。' : '已切换到我的发布。');
      return { attempted: true, success: true };
    }
    if (pending.type === 'communityDiscoveryLiked') {
      switchPanel('prompts');
      state.communityDiscoveryFilter = pending.discoveryFilter || 'liked';
      await loadCommunityPosts({ silent: true });
      renderCommunityPanel();
      setStatus('已筛选你点赞过的作品。');
      return { attempted: true, success: true };
    }
    if (pending.type === 'reuseCommunity') {
      const post = await ensureCommunityPostPrompt(pending.postId);
      openCommunityReuseModal(post, { imageIndex: pending.imageIndex || 0 });
      return { attempted: true, success: true };
    }
    if (pending.type === 'like') {
      await likeCommunityPost(pending.postId);
      return { attempted: true, success: true };
    }
    if (pending.type === 'download') {
      await downloadCommunityPost(pending.postId, pending.index || 0);
      return { attempted: true, success: true };
    }
    if (pending.type === 'tip') {
      const post = findCommunityPost(pending.postId);
      if (post && pending.amountCents) post.presetTipAmount = Math.max(0.1, Number(pending.amountCents || 0) / 100);
      await tipCommunityPostOptional(pending.postId);
      return { attempted: true, success: true };
    }
    if (pending.type === 'comment') {
      const input = $('communityCommentInput');
      if (input && pending.body) input.value = pending.body;
      state.creatorFeedbackReplyingId = pending.feedbackId || '';
      if (pending.parentCommentId) state.communityReplyToCommentId = pending.parentCommentId;
      if (String(pending.body || '').trim()) {
        await submitCommunityComment();
        if (!pending.feedbackId) setStatus('登录成功，评论已发布。');
      } else {
        renderCommunityDetail();
        setTimeout(() => $('communityCommentInput')?.focus(), 30);
        setStatus('已登录，可以继续输入评论。');
      }
      return { attempted: true, success: true };
    }
    if (pending.type === 'replyComment') {
      state.communityReplyToCommentId = pending.commentId || '';
      renderCommunityDetail();
      setTimeout(() => $('communityCommentInput')?.focus(), 30);
      setStatus('已定位到回复框，可以继续输入回复。');
      return { attempted: true, success: true };
    }
    if (pending.type === 'reportComment') {
      await reportCommunityCommentById(pending.commentId);
      return { attempted: true, success: true };
    }
    if (pending.type === 'resolveReports') {
      await resolveCommunityCommentReportsById(pending.commentId);
      return { attempted: true, success: true };
    }
    if (pending.type === 'pinComment') {
      await pinCommunityCommentById(pending.commentId);
      return { attempted: true, success: true };
    }
    if (pending.type === 'unpinComment') {
      await unpinCommunityCommentById();
      return { attempted: true, success: true };
    }
    if (pending.type === 'deleteComment') {
      await deleteCommunityComment(pending.commentId);
      return { attempted: true, success: true };
    }
    if (pending.type === 'deletePost') {
      await openCommunityDetail(pending.postId, { updateUrl: true });
      await deleteCommunityPostById(pending.postId);
      return { attempted: true, success: true };
    }
    if (pending.type === 'generate') {
      await submitGeneration(pending.statusText || '登录成功，正在继续生成…');
      return { attempted: true, success: true };
    }
    if (pending.type === 'publish') {
      openCommunityPublish(pending.generation, pending.imageIndex || 0, { defaultAll: Boolean(pending.defaultAll) });
      if (Array.isArray(pending.imageIndexes)) {
        const entries = imageEntries(pending.generation);
        state.communityPublishImageIndexes = normalizeImageIndexSelection(pending.imageIndexes, entries, pending.imageIndex || 0);
        if (state.communityPublishGeneration) state.communityPublishGeneration.selectedImageIndexes = [...state.communityPublishImageIndexes];
        renderCommunityPublishPreview(pending.generation, pending.imageIndex || 0);
      }
      applyCommunityPublishFormDraft(pending.draft || {});
      return { attempted: true, success: true };
    }
    if (pending.type === 'editCommunity') {
      openCommunityEdit(pending.postId);
      applyCommunityPublishFormDraft(pending.draft || {});
      return { attempted: true, success: true };
    }
    if (pending.type === 'openCommunity' && pending.postId) {
      await openCommunityDetail(pending.postId, { updateUrl: true });
      return { attempted: true, success: true };
    }
  } catch (error) {
    setStatus(`已登录，但继续操作失败：${error.message}`, true);
    return { attempted: true, success: false };
  }
  return { attempted: false, success: false };
}

function setPreviewMeta(text) {
  if ($('previewMeta')) $('previewMeta').textContent = text || '等待生成';
}

function syncPreviewMeta() {
  if (state.previewState === 'loading') {
    setPreviewMeta(selectedPriceText());
  } else if (state.previewState === 'empty') {
    setPreviewMeta('等待生成');
  }
}

function creatorFeedbackHandledStorageKey() {
  return `${creatorFeedbackHandledStoragePrefix}:${state.user?.id || 'guest'}`;
}

function creatorFeedbackHandledMigrationKey() {
  return `${creatorFeedbackHandledMigrationPrefix}:${state.user?.id || 'guest'}`;
}

function loadCreatorFeedbackHandledIds() {
  if (!state.user) {
    state.creatorFeedbackHandledIds = [];
    clearCreatorFeedbackSummaryCache();
    return;
  }
  try {
    const raw = window.localStorage?.getItem(creatorFeedbackHandledStorageKey());
    const list = JSON.parse(raw || '[]');
    state.creatorFeedbackHandledIds = Array.isArray(list)
      ? [...new Set(list.map((id) => String(id || '')).filter(Boolean))].slice(0, 500)
      : [];
  } catch {
    state.creatorFeedbackHandledIds = [];
  }
  clearCreatorFeedbackSummaryCache();
}

function saveCreatorFeedbackHandledIds() {
  if (!state.user) return;
  try {
    window.localStorage?.setItem(creatorFeedbackHandledStorageKey(), JSON.stringify(state.creatorFeedbackHandledIds.slice(0, 500)));
  } catch {
    // 本地存储失败时只影响隐藏状态，不影响收件箱读写。
  }
}

function isCreatorFeedbackHandled(id) {
  return isCreatorFeedbackHandledByState(state.creatorFeedbackItems, state.creatorFeedbackHandledIds, id);
}

function setLocalCreatorFeedbackHandled(id, handled) {
  const feedbackId = String(id || '');
  if (!feedbackId) return false;
  if (handled) {
    state.creatorFeedbackHandledIds = [feedbackId, ...state.creatorFeedbackHandledIds.filter((item) => item !== feedbackId)].slice(0, 500);
  } else {
    state.creatorFeedbackHandledIds = state.creatorFeedbackHandledIds.filter((item) => item !== feedbackId);
  }
  saveCreatorFeedbackHandledIds();
  clearCreatorFeedbackSummaryCache();
  return true;
}

async function migrateLocalCreatorFeedbackHandled(items = []) {
  if (!state.user || !state.creatorFeedbackHandledIds.length || !items.length) return;
  try {
    if (window.localStorage?.getItem(creatorFeedbackHandledMigrationKey()) === 'done') {
      if (state.creatorFeedbackHandledIds.length) window.localStorage?.removeItem(creatorFeedbackHandledMigrationKey());
      else return;
    }
  } catch {
    return;
  }
  const localHandledIds = new Set(state.creatorFeedbackHandledIds);
  const allCandidates = items.filter((item) => (
    localHandledIds.has(String(item.id || ''))
    && !item.handled
    && Number(item.reportCount || 0) < 1
  ));
  const candidates = allCandidates.slice(0, 30);
  if (!candidates.length) {
    try {
      if (!state.creatorFeedbackHandledIds.length) window.localStorage?.setItem(creatorFeedbackHandledMigrationKey(), 'done');
      else window.localStorage?.removeItem(creatorFeedbackHandledMigrationKey());
    } catch {}
    return;
  }
  try {
    const results = await Promise.allSettled(candidates.map((item) => api(`/api/community/posts/${encodeURIComponent(item.postId)}/comments/${encodeURIComponent(item.commentId)}/feedback/handled`, {
      method: 'POST',
      body: { handled: true }
    })));
    const failed = results.some((result) => result.status === 'rejected');
    const migratedIds = new Set(candidates.filter((_, index) => results[index]?.status === 'fulfilled').map((item) => String(item.id || '')));
    state.creatorFeedbackItems = state.creatorFeedbackItems.map((item) => migratedIds.has(String(item.id || ''))
      ? { ...item, handled: true }
      : item);
    clearCreatorFeedbackSummaryCache();
    const updatedPosts = new Map();
    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value?.post?.id) {
        updatedPosts.set(result.value.post.id, result.value.post);
      }
    });
    updatedPosts.forEach((post) => applyCommunityPostUpdate(post));
    if (!failed) {
      state.creatorFeedbackHandledIds = state.creatorFeedbackHandledIds.filter((id) => !migratedIds.has(String(id || '')));
      saveCreatorFeedbackHandledIds();
      clearCreatorFeedbackSummaryCache();
      try {
        if (allCandidates.length <= candidates.length) {
          window.localStorage?.setItem(creatorFeedbackHandledMigrationKey(), 'done');
        } else {
          window.localStorage?.removeItem(creatorFeedbackHandledMigrationKey());
        }
      } catch {}
    }
  } catch {
    // 保留旧本地状态，下次加载反馈时继续尝试迁移。
  }
}

async function toggleCreatorFeedbackHandled(id) {
  const feedbackId = String(id || '');
  const item = state.creatorFeedbackItems.find((entry) => entry.id === feedbackId);
  if (!feedbackId || !item) return;
  if (isCommunityActionPending('feedbackHandled', feedbackId)) return setStatus('正在更新反馈状态，请稍等。');
  const nextHandled = !isCreatorFeedbackHandled(feedbackId);
  setCommunityActionPending('feedbackHandled', feedbackId, true);
  renderCommunityPanel();
  try {
    const data = await api(`/api/community/posts/${encodeURIComponent(item.postId)}/comments/${encodeURIComponent(item.commentId)}/feedback/handled`, {
      method: 'POST',
      body: { handled: nextHandled }
    });
    state.creatorFeedbackItems = state.creatorFeedbackItems.map((entry) => entry.id === feedbackId ? { ...entry, handled: nextHandled } : entry);
    clearCreatorFeedbackSummaryCache();
    setLocalCreatorFeedbackHandled(feedbackId, nextHandled);
    if (data.post) applyCommunityPostUpdate(data.post);
    await loadCreatorFeedback({ silent: true });
    setStatus(nextHandled ? '已标记为已处理反馈。' : '已恢复为待处理反馈。');
  } catch (error) {
    if (error.status === 401) {
      requireLoginAfterExpired({ type: 'communityScopeMine', view: 'feedback' });
      setStatus('登录状态已过期，请重新登录后继续处理这条反馈。', true);
      return;
    }
    setStatus(error.message, true);
  } finally {
    setCommunityActionPending('feedbackHandled', feedbackId, false);
    renderCommunityPanel();
  }
}

function markCreatorFeedbackHandled(id, { silent = false } = {}) {
  const feedbackId = String(id || '');
  if (!feedbackId) return false;
  const item = state.creatorFeedbackItems.find((entry) => entry.id === feedbackId);
  const previousHandled = isCreatorFeedbackHandled(feedbackId);
  setLocalCreatorFeedbackHandled(feedbackId, true);
  if (item) {
    state.creatorFeedbackItems = state.creatorFeedbackItems.map((entry) => entry.id === feedbackId ? { ...entry, handled: true } : entry);
    clearCreatorFeedbackSummaryCache();
  }
  if (item) {
    api(`/api/community/posts/${encodeURIComponent(item.postId)}/comments/${encodeURIComponent(item.commentId)}/feedback/handled`, {
      method: 'POST',
      body: { handled: true }
    }).then((data) => {
      state.creatorFeedbackItems = state.creatorFeedbackItems.map((entry) => entry.id === feedbackId ? { ...entry, handled: true } : entry);
      clearCreatorFeedbackSummaryCache();
      if (data.post) applyCommunityPostUpdate(data.post);
      loadCreatorFeedback({ silent: true }).catch((refreshError) => setStatus(`反馈已处理，但刷新收件箱失败：${refreshError.message}`, true));
    }).catch((error) => {
      setLocalCreatorFeedbackHandled(feedbackId, previousHandled);
      state.creatorFeedbackItems = state.creatorFeedbackItems.map((entry) => entry.id === feedbackId ? { ...entry, handled: previousHandled } : entry);
      clearCreatorFeedbackSummaryCache();
      if (error.status === 401) {
        requireLoginAfterExpired({ type: 'communityScopeMine', view: 'feedback' });
        setStatus('登录状态已过期，反馈处理状态未同步，请重新登录后再处理。', true);
      } else {
        loadCreatorFeedback({ silent: true }).catch((refreshError) => setStatus(`反馈处理状态同步失败，刷新也失败：${refreshError.message}`, true));
        setStatus(`反馈处理状态同步失败：${error.message}`, true);
      }
      renderCommunityPanel();
    });
  }
  if (!silent) {
    setStatus('已标记为已处理反馈。');
    renderCommunityPanel();
  }
  return true;
}

function creatorFeedbackIdForCommentReply(postId, commentId) {
  const post = state.communityDetailPost;
  if (!postId || !commentId || !state.user || !post || post.id !== postId) return '';
  const canManagePost = state.user.role === 'admin' || isOwnCommunityPost(post);
  if (!canManagePost) return '';
  const item = state.creatorFeedbackItems.find((entry) => (
    entry.postId === postId
    && entry.commentId === commentId
    && !isCreatorFeedbackHandled(entry.id)
    && !(entry.actorIsAuthor && Number(entry.reportCount || 0) > 0)
  ));
  return item?.id || '';
}

function saveCurrentPrompt() {
  if (!$('prompt')) return;
  state.prompts[state.mode] = $('prompt').value;
}

function updateComposerPromptState() {
  const prompt = $('prompt');
  if (!prompt) return;
  document.body.classList.toggle('has-prompt-text', prompt.value.trim().length > 0);
}

function updateModeCopy() {
  const editing = state.mode === 'edit';
  const uploadBoxTitle = $('uploadBox')?.querySelector(':scope > span');
  if (uploadBoxTitle) uploadBoxTitle.textContent = editing ? '上传源图' : '上传参考图';
  if ($('uploadTriggerLabel')) $('uploadTriggerLabel').textContent = editing ? '上传源图' : '上传参考图';
  if ($('prompt')) {
    $('prompt').placeholder = editing
      ? '描述你想基于源图修改成什么画面'
      : '描述你想生成的画面';
  }
}

function renderPromptForMode() {
  const prompt = $('prompt');
  if (!prompt) return;
  prompt.value = state.prompts[state.mode] || '';
  updatePromptCount();
  updateComposerPromptState();
}

function friendlyOptimizeError(message) {
  const text = String(message || '');
  if (text.includes('API key') || text.includes('密钥')) return '优化通道暂不可用，请联系管理员检查配置。';
  if (text.includes('model') || text.includes('模型')) return '文本模型暂不可用，请联系管理员检查文本模型配置。';
  return text || '优化失败，请稍后重试。';
}

function closePromptOwnedUi({ preserveRoute = false } = {}) {
  closeCommunityDetailModal({ preserveRoute });
  closeCommunityPublishModal();
  closeCommunityTipModal();
  closeCommunityReuseModal();
  hideCommunityDownloadNudge();
}

function switchPanel(panel, options = {}) {
  closePillMenus();
  const nextPanel = ['studio', 'prompts', 'agent', 'developers', 'settings', 'admin'].includes(panel) ? panel : 'studio';
  if (nextPanel !== 'prompts') closePromptOwnedUi({ preserveRoute: true });
  state.activePanel = nextPanel;
  if (state.activePanel === 'admin' && state.user?.role !== 'admin') {
    state.activePanel = 'settings';
  }
  syncAdminVisibility();
  document.body.dataset.panel = state.activePanel;
  syncPanelVisibility();
  const nextPath = state.activePanel === 'studio'
    ? (options.path || preferredStudioRoute || routeByPanel.studio)
    : routeByPanel[state.activePanel];
  if (options.updateUrl !== false && window.location.pathname !== nextPath) {
    window.history.pushState({ panel: state.activePanel }, '', nextPath);
  }
  document.querySelectorAll('[data-panel-target]').forEach((node) => {
    node.classList.toggle('active', node.dataset.panelTarget === state.activePanel);
    node.classList.toggle('rail-active', node.dataset.panelTarget === state.activePanel);
    if (node.tagName === 'A') node.setAttribute('href', routeByPanel[node.dataset.panelTarget] || '/image/history');
  });
  if (state.activePanel === 'prompts' && !state.communityPosts.length) loadCommunityPosts();
  if (state.activePanel === 'developers' && state.user && !state.apiKeys.length) loadApiKeys();
  if (state.activePanel === 'admin' && state.user?.role === 'admin') loadAdmin();
  normalizeHistoryLayoutState();
  renderActivePanel();
}

function renderActivePanel() {
  if (state.activePanel === 'studio') {
    renderStudioTemplateCards();
    return;
  }
  if (state.activePanel === 'prompts') {
    renderCommunityPanel({ force: true });
    return;
  }
  if (state.activePanel === 'developers') {
    renderApiDocsPanel({ force: true });
    return;
  }
  if (state.activePanel === 'agent') {
    renderAgentPanel({ force: true });
    return;
  }
  if (state.activePanel === 'settings') {
    renderSettingsPanel({ force: true });
    return;
  }
  renderAdminConsole({ force: true });
}

function syncPanelVisibility() {
  const studioVisible = state.activePanel === 'studio';
  const workspaceVisible = state.activePanel !== 'admin';
  const workspaceContent = document.querySelector('.workspace-content');
  const historyPanel = $('historySection');
  const introPanel = document.querySelector('.intro-panel');
  const composerCard = $('create');
  const resultThread = document.querySelector('.result-thread');
  const promptPanel = $('promptLibraryPanel');
  const agentPanel = $('agentPanel');
  const apiDocsPanel = $('apiDocsPanel');
  const settingsPanel = $('settingsPanel');
  const adminPanel = $('adminConsolePanel');

  if (workspaceContent) {
    workspaceContent.hidden = !workspaceVisible;
    workspaceContent.setAttribute('aria-hidden', String(!workspaceVisible));
  }
  [historyPanel, introPanel, composerCard, resultThread].forEach((node) => {
    if (!node) return;
    node.hidden = !studioVisible;
    node.setAttribute('aria-hidden', String(!studioVisible));
  });

  [
    [promptPanel, state.activePanel === 'prompts'],
    [agentPanel, state.activePanel === 'agent'],
    [apiDocsPanel, state.activePanel === 'developers'],
    [settingsPanel, state.activePanel === 'settings'],
    [adminPanel, state.activePanel === 'admin' && state.user?.role === 'admin']
  ].forEach(([node, visible]) => {
    if (!node) return;
    node.hidden = !visible;
    node.setAttribute('aria-hidden', String(!visible));
  });
}

function syncPanelWithLocation(options = {}) {
  const expectedPanel = panelFromPath();
  if (expectedPanel !== state.activePanel || document.body.dataset.panel !== expectedPanel) {
    switchPanel(expectedPanel, { updateUrl: false, ...options });
  }
}

function usePrompt(prompt) {
  switchPanel('studio');
  clearReferenceImage();
  renderReferencePreview();
  setMode('generate');
  $('prompt').value = prompt;
  state.prompts.generate = prompt;
  updatePromptCount();
  updateComposerPromptState();
  setStatus('已加入提示词。');
  $('prompt').focus();
}

function startCommunityCreation() {
  switchPanel('studio', { path: '/image/history' });
  clearReferenceImage();
  renderReferencePreview();
  setMode('generate');
  setStatus('先生成图片，成功后在结果卡片或历史记录里上传到交流区。');
  window.setTimeout(() => $('prompt')?.focus(), 80);
}

function normalizeLibrary(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const categories = Array.isArray(source.categories)
    ? source.categories
      .map((item) => ({ id: String(item?.id || '').trim(), label: String(item?.label || '').trim() }))
      .filter((item) => item.id && item.label)
    : [];
  const categoryIds = new Set(categories.map((item) => item.id));
  const items = Array.isArray(source.items)
    ? source.items.map((item) => {
      const category = String(item?.category || '').trim();
      return {
        id: String(item?.id || '').trim(),
        title: String(item?.title || '').trim(),
        category,
        summary: String(item?.summary || '').trim(),
        prompt: String(item?.prompt || '').trim(),
        tags: Array.isArray(item?.tags) ? item.tags.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 12) : [],
        materials: Array.isArray(item?.materials)
          ? item.materials.map((material) => ({
            type: 'image',
            url: String(material?.url || '').trim(),
            alt: String(material?.alt || '').trim(),
            caption: String(material?.caption || '').trim()
          })).filter((material) => material.url.startsWith('/prompt-library/assets/') && !material.url.includes('..'))
          : [],
        recommended: item?.recommended && typeof item.recommended === 'object' ? {
          size: String(item.recommended.size || '').trim(),
          quality: String(item.recommended.quality || '').trim(),
          outputFormat: String(item.recommended.outputFormat || '').trim(),
          count: Number.isFinite(Number(item.recommended.count)) ? Math.max(1, Math.min(4, Math.floor(Number(item.recommended.count)))) : undefined
        } : null,
        featured: Boolean(item?.featured)
      };
    }).filter((item) => item.id && item.title && item.prompt && (!categoryIds.size || categoryIds.has(item.category)))
    : [];
  return {
    version: Number(source.version || 1),
    updatedAt: String(source.updatedAt || '').trim(),
    categories,
    items
  };
}

function allLibraryTags(items = promptLibraryData.items) {
  return Array.from(new Set(items.flatMap((item) => item.tags || []))).slice(0, 24);
}

function recommendedText(item) {
  const recommended = item?.recommended;
  if (!recommended) return '';
  const size = recommended.size || '默认尺寸';
  const quality = { low: '低', medium: '中', high: '高', auto: '自动' }[recommended.quality] || recommended.quality || '默认';
  const format = String(recommended.outputFormat || 'jpeg').toUpperCase();
  const count = recommended.count || 1;
  return `${size} · ${quality} · ${format} · ${count} 张`;
}

async function loadPromptLibrary() {
  if (state.activePanel !== 'prompts') return;
  await loadCommunityPosts({ silent: true });
}

async function loadMaterialAsReference(url) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`素材读取失败 (${response.status})`);
  const blob = await response.blob();
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'].includes(blob.type)) {
    throw new Error('素材格式不支持');
  }
  if (blob.size > 12 * 1024 * 1024) throw new Error('素材不能超过 12 兆');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('素材读取失败'));
    reader.readAsDataURL(blob);
  });
}

async function applyLibraryPrompt(item, withMaterials = false) {
  if (!item) return;
  preferredStudioRoute = '/image/workspace';
  switchPanel('studio', { path: '/image/workspace' });
  const recommended = item.recommended || {};
  if (recommended.size) setSize(recommendedSizeMap[recommended.size] || recommended.size);
  if (recommended.quality) setQuality(recommendedQualityMap[recommended.quality] || recommended.quality);
  if (recommended.outputFormat) setOutputFormat(recommended.outputFormat);
  if (recommended.count) setCount(recommended.count);
  if (withMaterials && item.materials?.[0]?.url) {
    try {
      const material = item.materials[0];
      const dataUrl = await loadMaterialAsReference(material.url);
      const added = addReferenceImage(dataUrl, { replace: true, label: material.caption || '当前源图' });
      if (!added) return setStatus('参考素材加载失败，请重试。', true);
      setMode('edit');
      state.prompts.edit = item.prompt;
      $('prompt').value = item.prompt;
      renderReferencePreview();
      setStatus('已带入提示词和参考素材。');
    } catch (error) {
      setStatus(error.message, true);
    }
  } else {
    clearReferenceImage();
    setMode('generate');
    state.prompts.generate = item.prompt;
    $('prompt').value = item.prompt;
    renderReferencePreview();
    setStatus('已加入提示词。');
  }
  updatePromptCount();
  updateComposerPromptState();
  $('prompt').focus();
}

function renderPromptLibrary() {
  renderCommunityPanel();
}

function handlePromptLibraryClick(event) {
  handleCommunityClick(event);
}

function clearCreatorFeedbackState() {
  state.creatorFeedbackLoadToken += 1;
  state.creatorFeedbackItems = [];
  state.creatorFeedbackCounts = null;
  state.creatorFeedbackTotals = null;
  state.creatorFeedbackPostFilterId = '';
  state.creatorFeedbackLoading = false;
  clearCreatorFeedbackSummaryCache();
}

function leavePrivateCommunityView() {
  if (state.communityScope !== 'mine') return;
  state.communityScope = 'all';
  state.communityView = 'posts';
  state.creatorFeedbackFilter = 'pending';
  state.creatorFeedbackPostFilterId = '';
}

function resetCommunitySessionStateForUser(nextUser) {
  if (state.user?.id === nextUser?.id) return;
  closeCommunityDetailModal();
  closeCommunityTipModal();
  closeCommunityReuseModal();
  clearCreatorFeedbackState();
  leavePrivateCommunityView();
  state.communityDetailPost = null;
  state.communityTipPost = null;
  state.communityReusePost = null;
  state.communityDownloadNudgePost = null;
  state.communityPostPublishSuccessId = '';
  state.communityCommentFollowup = null;
  state.communityReplyToCommentId = '';
  state.creatorFeedbackReplyingId = '';
  state.communityActionPendingKeys = [];
  state.communityDownloadPendingIds = [];
}

function canKeepCommunityPrivateFields(post) {
  return Boolean(state.user?.id && (state.user.role === 'admin' || isOwnCommunityPost(post)));
}

const communityPrivateFieldDenylist = [
  'userId',
  'tipTotalCents',
  'hasTipped',
  'pinnedCommentId',
  'generationId',
  'pendingFeedbackCounts',
  'reportCount',
  'reportedByViewer',
  'feedbackLocked',
  'imageBase64'
];

const communityPublicSummaryFieldDenylist = [
  ...communityPrivateFieldDenylist,
  'prompt',
  'tipCents',
  'comments'
];

function stripCommunityPrivateFields(post, { summary = false } = {}) {
  if (!post?.id || canKeepCommunityPrivateFields(post)) return post;
  const cleaned = { ...post };
  const denylist = summary ? communityPublicSummaryFieldDenylist : communityPrivateFieldDenylist;
  denylist.forEach((key) => {
    delete cleaned[key];
  });
  if (Array.isArray(cleaned.images)) {
    cleaned.images = cleaned.images.map((image) => {
      const nextImage = { ...image };
      delete nextImage.imageBase64;
      return nextImage;
    });
  }
  if (Array.isArray(cleaned.comments)) {
    cleaned.comments = cleaned.comments.map((comment) => stripCommunityCommentPrivateFields(comment));
  }
  if (Array.isArray(cleaned.sameStyleVersions)) {
    cleaned.sameStyleVersions = cleaned.sameStyleVersions.map((item) => stripCommunityPrivateFields(item, { summary: true }));
  }
  return cleaned;
}

function stripCommunityCommentPrivateFields(comment) {
  const cleaned = { ...comment };
  delete cleaned.userId;
  delete cleaned.reportCount;
  delete cleaned.reportedByViewer;
  delete cleaned.feedbackLocked;
  delete cleaned.imageBase64;
  if (Array.isArray(cleaned.replies)) {
    cleaned.replies = cleaned.replies.map((reply) => stripCommunityCommentPrivateFields(reply));
  }
  return cleaned;
}

function sanitizeCommunityStateForViewer() {
  state.communityPosts = state.communityPosts.map((post) => normalizeCommunityPostForDisplay(stripCommunityPrivateFields(post, { summary: true })));
  clearCommunityCardCache();
  if (state.communityDetailPost) state.communityDetailPost = normalizeCommunityPostForDisplay(stripCommunityPrivateFields(state.communityDetailPost));
  if (state.communityTipPost) state.communityTipPost = normalizeCommunityPostForDisplay(stripCommunityPrivateFields(state.communityTipPost));
  if (state.communityReusePost) state.communityReusePost = normalizeCommunityPostForDisplay(stripCommunityPrivateFields(state.communityReusePost));
  if (state.communityDownloadNudgePost) state.communityDownloadNudgePost = normalizeCommunityPostForDisplay(stripCommunityPrivateFields(state.communityDownloadNudgePost, { summary: true }));
  state.historyItems = state.historyItems.map((entry) => (
    entry.communityPost ? { ...entry, communityPost: normalizeCommunityPostForDisplay(stripCommunityPrivateFields(entry.communityPost, { summary: true })) } : entry
  ));
  if (state.previewItem?.communityPost) {
    state.previewItem = { ...state.previewItem, communityPost: normalizeCommunityPostForDisplay(stripCommunityPrivateFields(state.previewItem.communityPost, { summary: true })) };
  }
}

function clearCommunityFilters() {
  state.communityActiveTag = '';
  state.communityDiscoveryFilter = 'all';
  state.communityLimit = 24;
  const search = $('promptLibrarySearch');
  if (search) search.value = '';
  loadCommunityPosts({ silent: true });
}

function resetCommunityPagination() {
  state.communityLimit = 24;
}

function loadMoreCommunityPosts() {
  const pageSize = 24;
  const maxLimit = state.communityScope === 'mine' ? 200 : 80;
  const nextLimit = Math.min(maxLimit, Math.max(Number(state.communityLimit || pageSize) + pageSize, Number(state.communityReturned || 0) + pageSize));
  if (nextLimit <= Number(state.communityLimit || 0)) return;
  state.communityLimit = nextLimit;
  loadCommunityPosts({ silent: true }).catch((error) => setStatus(`交流区读取失败：${error.message}`, true));
}

async function loadCommunityPosts({ silent = false } = {}) {
  if (!state.user && state.communityScope === 'mine') {
    leavePrivateCommunityView();
    clearCreatorFeedbackState();
  }
  if (!state.user && state.communityDiscoveryFilter === 'liked') {
    state.communityDiscoveryFilter = 'all';
  }
  const query = String($('promptLibrarySearch')?.value || '').trim();
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (state.communityActiveTag) params.set('tag', state.communityActiveTag);
  params.set('sort', state.communitySort === 'latest' ? 'latest' : 'hot');
  if (state.communityScope === 'mine') params.set('scope', 'mine');
  if (serverCommunityDiscoveryFilters.has(state.communityDiscoveryFilter)) {
    params.set('discovery', state.communityDiscoveryFilter);
  }
  const requestedCommunityLimit = Math.max(12, Math.min(state.communityScope === 'mine' ? 200 : 80, Number(state.communityLimit || 24)));
  params.set('limit', String(requestedCommunityLimit));
  const tagParams = new URLSearchParams();
  if (state.communityScope === 'mine') tagParams.set('scope', 'mine');
  const token = state.communityLoadToken + 1;
  state.communityLoadToken = token;
  state.communityLoading = true;
  if (!silent) renderCommunityPanel();
  try {
    const [data, tagsData] = await Promise.all([
      api(`/api/community/posts${params.toString() ? `?${params}` : ''}`),
      api(`/api/community/tags${tagParams.toString() ? `?${tagParams}` : ''}`).catch(() => null)
    ]);
	    if (token !== state.communityLoadToken) return;
	    state.communityPosts = (data.posts || []).map((post) => normalizeCommunityPostForDisplay(post));
	    clearCommunityCardCache();
	    state.communityTotal = Number(data.total ?? data.count ?? state.communityPosts.length);
	    state.communityReturned = Number(data.returned ?? data.count ?? state.communityPosts.length);
	    state.communityTags = Array.isArray(data.tags)
	      ? data.tags
	      : tagsData?.tags
	        ? tagsData.tags
	        : state.communityTags;
    sanitizeCommunityStateForViewer();
    syncCommunityDownloadNudgePost();
    if (state.communityScope === 'mine') {
      await loadCreatorFeedback({
        silent: true,
        postId: state.communityView === 'feedback' ? state.creatorFeedbackPostFilterId : ''
      });
    }
  } catch (error) {
    if (token !== state.communityLoadToken) return;
	    if (state.communityScope === 'mine') {
	      state.communityPosts = [];
	      clearCommunityCardCache();
	      state.communityTotal = 0;
	      state.communityReturned = 0;
	      clearCreatorFeedbackState();
	    }
    if (!silent) setStatus(`交流区读取失败：${error.message}`, true);
  } finally {
    if (token !== state.communityLoadToken) return;
    state.communityLoading = false;
    renderCommunityPanel();
  }
}

async function loadCreatorFeedback({ silent = false, postId = state.creatorFeedbackPostFilterId, applyState = true } = {}) {
  const token = state.creatorFeedbackLoadToken + 1;
  if (!state.user) {
    if (applyState) clearCreatorFeedbackState();
    return;
  }
  if (applyState) {
    state.creatorFeedbackLoadToken = token;
    state.creatorFeedbackLoading = true;
    if (!silent) renderCommunityPanel();
  }
  try {
    const params = new URLSearchParams({ limit: '80' });
    if (postId) params.set('postId', postId);
    const data = await api(`/api/community/creator/feedback?${params}`);
    if (applyState && token !== state.creatorFeedbackLoadToken) return null;
    if (applyState) {
      state.creatorFeedbackItems = data.items || [];
      state.creatorFeedbackCounts = data.counts || null;
      state.creatorFeedbackTotals = data.totals || null;
      clearCreatorFeedbackSummaryCache();
      migrateLocalCreatorFeedbackHandled(state.creatorFeedbackItems).catch(() => {});
    }
    return data;
  } catch (error) {
    if (applyState && token !== state.creatorFeedbackLoadToken) return null;
    if (applyState) clearCreatorFeedbackState();
    if (!silent) setStatus(`反馈收件箱读取失败：${error.message}`, true);
    if (!applyState) throw error;
    return null;
  } finally {
    if (applyState) {
      if (token !== state.creatorFeedbackLoadToken) return;
      state.creatorFeedbackLoading = false;
      if (!silent) renderCommunityPanel();
    }
  }
}

function renderCommunityPanel({ force = false } = {}) {
  const grid = $('promptLibraryGrid');
  const tags = $('promptLibraryTags');
  if (!force && state.activePanel !== 'prompts') return;
  if (!grid || !tags) return;
  if (!state.user && state.communityScope === 'mine') {
    leavePrivateCommunityView();
    clearCreatorFeedbackState();
  }
  if (!state.user && state.communityDiscoveryFilter === 'liked') {
    state.communityDiscoveryFilter = 'all';
  }
  const activeTag = state.communityActiveTag || '';
  const query = String($('promptLibrarySearch')?.value || '').trim().toLowerCase();
  const posts = state.communityPosts.slice().sort((a, b) => state.communitySort === 'latest'
    ? Number(b.createdAt || 0) - Number(a.createdAt || 0)
    : Number(b.hotScore || 0) - Number(a.hotScore || 0) || Number(b.createdAt || 0) - Number(a.createdAt || 0));
  const tagButtons = [
    `<button class="${!activeTag ? 'active' : ''}" type="button" data-community-tag="">全部作品</button>`,
    ...communityTagList().map((item) => {
      const tag = typeof item === 'string' ? item : item.tag;
      const count = typeof item === 'string' ? 0 : Number(item.count || 0);
      return `<button class="${activeTag === tag ? 'active' : ''}" type="button" data-community-tag="${escapeHtml(tag)}">${escapeHtml(tag)}${count ? `<small>${count}</small>` : ''}</button>`;
    })
  ];
  const discoveryButtons = communityDiscoveryFilters.map((filter) => `
    <button class="${state.communityDiscoveryFilter === filter.id ? 'active' : ''}" type="button" data-community-discovery="${escapeHtml(filter.id)}" title="${escapeHtml(filter.description)}">
      ${escapeHtml(filter.label)}
    </button>
  `).join('');
  const hasCommunityFilters = Boolean(activeTag || query || state.communityDiscoveryFilter !== 'all');
  const totalMatches = Number(state.communityTotal || posts.length);
  const returnedMatches = Number(state.communityReturned || posts.length);
  const resultHint = hasCommunityFilters
    ? `<div class="community-filter-summary"><span>命中 ${totalMatches} 个作品${totalMatches > returnedMatches ? `，当前展示 ${returnedMatches} 个` : ''}</span><button type="button" data-community-clear-filters>清除筛选</button></div>`
    : '';
  const loadMoreControl = totalMatches > returnedMatches
    ? `<div class="community-load-more"><span>已展示 ${returnedMatches} / ${totalMatches}</span><button type="button" data-community-load-more>加载更多作品</button></div>`
    : '';
  tags.innerHTML = `
    <div class="library-filter-row community-sort-row">
      <button class="${state.communitySort === 'hot' ? 'active' : ''}" type="button" data-community-sort="hot" title="${escapeHtml(communityHeatHelpText)}">热门优先</button>
      <button class="${state.communitySort === 'latest' ? 'active' : ''}" type="button" data-community-sort="latest">最新发布</button>
      <button class="${state.communityScope === 'mine' ? 'active' : ''}" type="button" data-community-scope="mine">我的发布</button>
      <button class="${state.communityScope === 'mine' && state.communityView === 'feedback' ? 'active' : ''}" type="button" data-community-view="feedback">反馈收件箱</button>
    </div>
    <p class="community-heat-note">${escapeHtml(communityHeatHelpText)}</p>
    <div class="library-filter-row community-filter-row">
      ${tagButtons.join('')}
    </div>
    <div class="library-filter-row community-discovery-row" aria-label="发现筛选">
      <span>发现筛选</span>
      ${discoveryButtons}
    </div>
    ${resultHint}
  `;
  if (state.communityLoading) {
    grid.innerHTML = '<p class="feature-empty">正在读取交流区作品…</p>';
    return;
  }
  if (state.communityScope === 'mine' && state.communityView === 'feedback') {
    grid.innerHTML = renderCreatorFeedbackInbox(posts);
    return;
  }
  if (state.communityScope === 'mine' && posts.length) {
    const totals = communityCreatorTotals(posts);
    grid.innerHTML = `
      <section class="creator-dashboard-summary">
        <div>
          <span>我的发布</span>
          <strong>${posts.length} 个作品</strong>
        </div>
        <div class="creator-dashboard-primary-metric" title="${escapeHtml(communityHeatHelpText)}"><span>互动热度</span><strong>${escapeHtml(String(totals.hotScore))}</strong></div>
        <div class="creator-dashboard-primary-metric"><span>点赞</span><strong>${totals.likeCount}</strong></div>
        <div class="creator-dashboard-primary-metric"><span>评论</span><strong>${totals.commentCount}</strong></div>
        <div class="creator-dashboard-secondary-metric"><span>参考延展</span><strong>${totals.reuseCount}</strong></div>
        <div class="creator-dashboard-secondary-metric"><span>免费下载参考</span><strong>${totals.downloadCount}</strong></div>
      </section>
      <p class="creator-support-summary">当前公开作品已收到自愿支持 ${yuan(totals.tipTotalCents || 0)}，自愿支持不影响互动热度和交流区排名。</p>
      ${renderCreatorDashboardFocus(posts)}
      ${renderCommunityCards(posts)}
      ${loadMoreControl}
    `;
    return;
  }
  grid.innerHTML = posts.length
    ? `${renderCommunityCards(posts)}${loadMoreControl}`
    : `<div class="feature-empty community-filter-empty"><p>${communityEmptyMessage({ query, activeTag })}</p>${hasCommunityFilters ? '<button type="button" data-community-clear-filters>清除筛选</button>' : ''}</div>`;
}

async function loadStudioTemplates({ silent = false } = {}) {
  state.studioTemplates = [];
  state.studioTemplatesLoading = false;
  if (!silent) renderStudioTemplateCards();
}

function communityEmptyMessage({ query = '', activeTag = '' } = {}) {
  if (state.communityScope === 'mine') return '你还没有上传到交流区的作品。生成图片后点击“上传到交流区”，就能查看点赞和评论表现；参考创作与免费下载只作辅助参考。';
  if (state.communityDiscoveryFilter === 'liked') return '你还没有点赞过作品。';
  if (state.communityDiscoveryFilter === 'uncommented') return '当前没有等待首评的作品。可以切回全部，或去生成一张新作品上传到交流区。';
  if (query) return '没有找到匹配作品，换个关键词试试。';
  if (activeTag) return '这个标签下暂时没有作品。';
  if (state.communityDiscoveryFilter !== 'all') return '当前筛选没有结果，清除筛选后查看全部作品。';
  return '还没有公开作品。生成一张图片后，点击“上传到交流区”就能成为第一批作品。';
}

function creatorFeedbackFilterLabel(filter) {
  if (filter === 'pending') return '未处理';
  if (filter === 'handled') return '已处理';
  if (filter === 'reported') return '被举报';
  if (filter === 'reply') return '有回复';
  return '全部';
}

function creatorFeedbackTypeLabel(item) {
  if (item.type === 'reported') return '被举报';
  if (item.type === 'reply') return '回复';
  return '评论';
}

function filterCreatorFeedbackItems(items = []) {
  const scoped = state.creatorFeedbackPostFilterId
    ? items.filter((item) => item.postId === state.creatorFeedbackPostFilterId)
    : items;
  if (state.creatorFeedbackFilter === 'pending') return scoped.filter((item) => isCreatorFeedbackReported(item) || !isCreatorFeedbackHandled(item.id));
  if (state.creatorFeedbackFilter === 'handled') return scoped.filter((item) => !isCreatorFeedbackReported(item) && isCreatorFeedbackHandled(item.id));
  if (state.creatorFeedbackFilter === 'reported') return scoped.filter((item) => Number(item.reportCount || 0) > 0);
  if (state.creatorFeedbackFilter === 'reply') return scoped.filter((item) => item.type === 'reply');
  return scoped;
}

function creatorFeedbackGroupKey(item) {
  if (isCreatorFeedbackReported(item)) return 'reported';
  if (isCreatorFeedbackHandled(item.id)) return 'handled';
  if (item.type === 'reply') return 'reply';
  return 'comment';
}

function creatorFeedbackGroupDefinitions(emptyPostId = '') {
  const inviteAction = emptyPostId
    ? `<button type="button" data-community-share="${escapeHtml(emptyPostId)}">复制邀请文案</button>`
    : '';
  return [
    {
      id: 'reported',
      title: '待处理举报',
      description: '先确认被举报内容，处理后再决定是否保留或删除评论。',
      empty: '暂无待处理举报。'
    },
    {
      id: 'comment',
      title: '待回复评论',
      description: '优先回复有价值的问题、用途反馈和改进建议。',
      empty: `暂无待回复评论。${emptyPostId ? '可以先复制邀请文案，请朋友点赞、评论。' : ''}`,
      action: inviteAction
    },
    {
      id: 'reply',
      title: '待查看回复',
      description: '查看用户对你回复的后续反馈，必要时继续跟进。',
      empty: '暂无待查看回复。'
    },
    {
      id: 'handled',
      title: '已处理',
      description: '已处理的反馈会留在这里，方便回看上下文。',
      empty: '暂无已处理反馈。'
    }
  ];
}

function creatorFeedbackGroupsForFilter(emptyPostId = '') {
  const definitions = creatorFeedbackGroupDefinitions(emptyPostId);
  const allowed = {
    pending: ['reported', 'comment', 'reply'],
    reported: ['reported'],
    reply: ['reply'],
    handled: ['handled'],
    all: ['reported', 'comment', 'reply', 'handled']
  }[state.creatorFeedbackFilter] || ['reported', 'comment', 'reply', 'handled'];
  return definitions.filter((group) => allowed.includes(group.id));
}

function renderCreatorFeedbackGroup(group, items) {
  const groupItems = items.filter((item) => creatorFeedbackGroupKey(item) === group.id);
  const body = groupItems.length
    ? groupItems.map(renderCreatorFeedbackItem).join('')
    : `<div class="feature-empty creator-feedback-empty"><p>${escapeHtml(group.empty)}</p>${group.action || ''}</div>`;
  return `
    <section class="creator-feedback-group ${group.id === 'reported' ? 'is-urgent' : ''}">
      <header>
        <div>
          <strong>${escapeHtml(group.title)}</strong>
          <span>${escapeHtml(group.description)}</span>
        </div>
        <em>${groupItems.length}</em>
      </header>
      <div class="creator-feedback-group-list">
        ${body}
      </div>
    </section>
  `;
}

function creatorFeedbackActionPlan({ counts = {}, totals = {}, scopedPost = null, emptyPostId = '' } = {}) {
  const reported = Number(counts.reported || 0);
  const pending = Number(counts.pending || 0);
  const replies = Number(counts.reply || 0);
  const comments = Number(counts.comment || 0);
  const downloads = Number(totals.downloadCount || 0);
  const reuseCount = Number(totals.reuseCount || 0);
  const title = scopedPost?.title || '';
  if (reported > 0) {
    return {
      tone: 'urgent',
      title: `先处理 ${reported} 条被举报评论`,
      body: '确认评论是否保留，处理完再回复其他反馈，避免争议内容继续影响作品讨论。',
      action: 'reported',
      actionLabel: '只看举报'
    };
  }
  if (pending > 0) {
    return {
      tone: 'active',
      title: `有 ${pending} 条反馈待处理`,
      body: replies > 0
        ? `先看 ${replies} 条回复，再回应新的评论；及时回复能带动后续点赞和评论，让作品更容易进入热门讨论。`
        : `优先回复具体问题和用途反馈，再置顶有代表性的评论，方便后来的人参与讨论。`,
      action: 'pending',
      actionLabel: '只看待处理'
    };
  }
  if (comments > 0) {
    return {
      tone: 'quiet',
      title: '评论互动已开始',
      body: '可以回到作品详情，置顶有代表性的评论；参考创作和免费下载只作为辅助观察。',
      action: 'viewCommunity',
      actionLabel: '查看点赞评论'
    };
  }
  if (reuseCount > 0 || downloads > 0) {
    return {
      tone: 'quiet',
      title: '已有辅助互动',
      body: [
        reuseCount > 0 ? `${reuseCount} 次参考延展` : '',
        downloads > 0 ? `${downloads} 位用户免费下载` : '',
        '都不参与排名；下一步仍是复制邀请文案邀请点赞、评论。'
      ].filter(Boolean).join('，'),
      action: 'share',
      actionLabel: '复制邀请文案'
    };
  }
  return {
    tone: 'quiet',
    title: '暂无待处理反馈',
    body: emptyPostId ? '先复制最新作品邀请文案，请朋友点赞和评论；有评论、回复或举报后会进入这里。' : '上传作品后，评论、回复和举报会进入这里集中处理。',
    action: emptyPostId ? 'share' : '',
    actionLabel: emptyPostId ? '复制邀请文案' : ''
  };
}

function renderCreatorFeedbackActionPlan(plan, emptyPostId = '') {
  if (!plan) return '';
  const action = plan.action === 'reported'
    ? '<button type="button" data-creator-feedback-filter="reported">只看举报</button>'
    : plan.action === 'pending'
      ? '<button type="button" data-creator-feedback-filter="pending">只看待处理</button>'
      : plan.action === 'viewCommunity' && emptyPostId
        ? `<button type="button" data-community-open="${escapeHtml(emptyPostId)}">查看作品详情</button>`
        : plan.action === 'share' && emptyPostId
          ? `<button type="button" data-community-share="${escapeHtml(emptyPostId)}">复制邀请文案</button>`
          : '';
  return `
    <section class="creator-feedback-action-plan ${plan.tone === 'urgent' ? 'is-urgent' : ''}">
      <div>
        <span>${plan.tone === 'urgent' ? '优先行动' : '下一步建议'}</span>
        <strong>${escapeHtml(plan.title)}</strong>
        <p>${escapeHtml(plan.body)}</p>
      </div>
      ${action}
    </section>
  `;
}

function renderCreatorFeedbackInbox(posts = []) {
  const totals = state.creatorFeedbackTotals || communityCreatorTotals(posts);
  const counts = state.creatorFeedbackCounts || {};
  const scopedFeedbackItems = state.creatorFeedbackPostFilterId
    ? state.creatorFeedbackItems.filter((item) => item.postId === state.creatorFeedbackPostFilterId)
    : state.creatorFeedbackItems;
  const items = filterCreatorFeedbackItems(state.creatorFeedbackItems);
  const pendingCount = scopedFeedbackItems.filter((item) => isCreatorFeedbackReported(item) || !isCreatorFeedbackHandled(item.id)).length;
  const handledCount = scopedFeedbackItems.filter((item) => !isCreatorFeedbackReported(item) && isCreatorFeedbackHandled(item.id)).length;
  const scopedPost = state.creatorFeedbackPostFilterId
    ? posts.find((post) => post.id === state.creatorFeedbackPostFilterId) || state.communityPosts.find((post) => post.id === state.creatorFeedbackPostFilterId) || null
    : null;
  const scopedPostTitle = scopedPost?.title || scopedFeedbackItems[0]?.postTitle || '当前作品';
  const scopedPendingItems = scopedFeedbackItems.filter((item) => isCreatorFeedbackReported(item) || !isCreatorFeedbackHandled(item.id));
  const scopedCounts = state.creatorFeedbackPostFilterId ? {
    total: scopedPendingItems.length,
    pending: scopedPendingItems.length,
    handled: handledCount,
    comment: scopedPendingItems.filter((item) => item.type === 'comment' && !isCreatorFeedbackReported(item)).length,
    reply: scopedPendingItems.filter((item) => item.type === 'reply' && !isCreatorFeedbackReported(item)).length,
    reported: scopedPendingItems.filter((item) => Number(item.reportCount || 0) > 0).length
  } : counts;
  const scopedTotals = scopedPost ? communityCreatorTotals([scopedPost]) : totals;
  const filters = ['pending', 'all', 'reply', 'reported', 'handled'].map((filter) => `
    <button class="${state.creatorFeedbackFilter === filter ? 'active' : ''}" type="button" data-creator-feedback-filter="${filter}">
      ${creatorFeedbackFilterLabel(filter)}${filter === 'pending' ? ` ${pendingCount}` : filter === 'handled' ? ` ${handledCount}` : ''}
    </button>
  `).join('');
  const emptyPostId = state.creatorFeedbackPostFilterId || scopedPost?.id || totals.latestPostId || posts[0]?.id || '';
  const actionPlan = creatorFeedbackActionPlan({ counts: scopedCounts, totals: scopedTotals, scopedPost, emptyPostId });
  const emptyAction = emptyPostId
    ? `<span>${scopedPost ? '当前筛选下暂时没有反馈，可以继续复制邀请文案，请朋友点赞、评论。' : '可以先复制最新作品邀请文案，请朋友点赞评论。'}</span><button type="button" data-community-share="${escapeHtml(emptyPostId)}">${scopedPost ? '复制邀请文案' : '复制最新邀请文案'}</button>`
    : '<span>发布作品后，评论和回复会出现在这里。</span>';
  const body = state.creatorFeedbackLoading
    ? '<p class="feature-empty">正在读取反馈收件箱…</p>'
    : (items.length || ['pending', 'all', 'reported', 'reply', 'handled'].includes(state.creatorFeedbackFilter)
      ? creatorFeedbackGroupsForFilter(emptyPostId).map((group) => renderCreatorFeedbackGroup(group, items)).join('')
      : `<div class="feature-empty creator-feedback-empty"><p>${state.creatorFeedbackFilter === 'pending' ? '暂时没有未处理反馈。' : '当前筛选下没有反馈。'}</p>${emptyAction}</div>`);
  return `
    <section class="creator-dashboard-summary">
	      <div><span>作品</span><strong>${state.creatorFeedbackPostFilterId ? (scopedTotals.postCount ?? (scopedPost ? 1 : 0)) : (totals.postCount ?? posts.length)}</strong></div>
	      <div><span>待处理反馈</span><strong>${scopedCounts.total || 0}</strong></div>
	      <div><span>评论</span><strong>${scopedCounts.comment || 0}</strong></div>
	      <div><span>回复</span><strong>${scopedCounts.reply || 0}</strong></div>
	      <div><span>举报</span><strong>${scopedCounts.reported || 0}</strong></div>
	      <div class="creator-dashboard-secondary-metric"><span>已处理</span><strong>${scopedCounts.handled || 0}</strong></div>
	      <div class="creator-dashboard-secondary-metric"><span>免费下载参考</span><strong>${scopedTotals.downloadCount || 0}</strong></div>
	    </section>
    <p class="creator-support-summary">${state.creatorFeedbackPostFilterId ? '当前作品' : '当前公开作品'}已收到自愿支持 ${yuan(scopedTotals.tipTotalCents || 0)}，不进入反馈待办，也不影响排名。</p>
    <section class="creator-feedback-inbox">
      <div class="creator-feedback-toolbar">
        <div>
          <strong>创作者反馈收件箱</strong>
          <span>${state.creatorFeedbackPostFilterId ? `正在只看《${escapeHtml(scopedPostTitle || '未命名作品')}》的反馈。` : '评论、回复和被举报内容集中处理；下载始终免费，自愿支持不参与排名。'}</span>
        </div>
        <div class="creator-feedback-actions">
          ${filters}
          ${state.creatorFeedbackPostFilterId ? '<button type="button" data-creator-feedback-clear-post>查看全部反馈</button>' : ''}
          <button type="button" data-creator-feedback-refresh>刷新</button>
        </div>
      </div>
      <div class="creator-feedback-list">
        ${renderCreatorFeedbackActionPlan(actionPlan, emptyPostId)}
        ${body}
      </div>
    </section>
  `;
}

function renderCreatorFeedbackItem(item) {
  const metrics = item.postMetrics || {};
  const handled = isCreatorFeedbackHandled(item.id);
  const isReported = Number(item.reportCount || 0) > 0;
  const image = item.postImageUrl
    ? `<img src="${escapeHtml(item.postImageUrl)}" alt="${escapeHtml(item.postTitle || '作品')}" loading="lazy" />`
    : '<span>作品</span>';
  const parent = item.parentBody ? `<small>回复：${escapeHtml(String(item.parentBody).slice(0, 80))}</small>` : '';
  const pinAction = item.parentCommentId || isReported ? '' : (item.pinned
    ? `<button type="button" data-creator-feedback-unpin="${escapeHtml(item.postId)}">取消置顶</button>`
    : `<button type="button" data-creator-feedback-pin="${escapeHtml(item.commentId)}" data-post-id="${escapeHtml(item.postId)}">置顶</button>`);
  const replyTargetId = item.parentCommentId || item.commentId;
  const feedbackHandledPending = isCommunityActionPending('feedbackHandled', item.id);
  const replyAction = isReported
    ? ''
    : `<button type="button" data-creator-feedback-reply="${escapeHtml(replyTargetId)}" data-feedback-id="${escapeHtml(item.id)}" data-post-id="${escapeHtml(item.postId)}">回复</button>`;
  const handleAction = isReported
    ? `<button type="button" data-creator-feedback-resolve="${escapeHtml(item.commentId)}" data-post-id="${escapeHtml(item.postId)}" data-feedback-id="${escapeHtml(item.id)}">保留并处理</button>`
    : `<button type="button" data-creator-feedback-toggle-handled="${escapeHtml(item.id)}" ${feedbackHandledPending ? 'disabled' : ''}>${feedbackHandledPending ? (handled ? '恢复中…' : '标记中…') : (handled ? '恢复待处理' : '标记已处理')}</button>`;
  return `
    <article class="creator-feedback-item ${isReported ? 'reported' : ''} ${handled ? 'handled' : ''}">
      <button class="creator-feedback-thumb" type="button" data-community-open="${escapeHtml(item.postId)}">${image}</button>
      <div class="creator-feedback-copy">
        <div class="creator-feedback-head">
          <strong>${escapeHtml(item.actorName || '用户')}</strong>
          <span>${creatorFeedbackTypeLabel(item)}</span>
          ${item.reportCount ? `<em>${item.reportCount} 举报</em>` : ''}
          <time>${escapeHtml(formatDate(item.createdAt))}</time>
        </div>
        <p>${escapeHtml(item.body || '')}</p>
        ${parent}
        ${handled && !isReported ? '<span class="creator-feedback-handled-note">已回复并归档，可恢复待处理。</span>' : ''}
        <small>${escapeHtml(item.postTitle || '未命名作品')} · ${metrics.likeCount || 0} 赞 · ${metrics.commentCount || 0} 评论 · 辅助：${metrics.reuseCount || 0} 参考延展 / ${metrics.downloadCount || 0} 位用户免费下载</small>
      </div>
      <div class="creator-feedback-item-actions">
        ${replyAction}
        ${handleAction}
        ${pinAction}
        <button type="button" data-creator-feedback-delete="${escapeHtml(item.commentId)}" data-post-id="${escapeHtml(item.postId)}">删除</button>
        <button type="button" data-community-share="${escapeHtml(item.postId)}">复制邀请文案</button>
        <button class="primary-button" type="button" data-community-open="${escapeHtml(item.postId)}">查看作品</button>
      </div>
    </article>
  `;
}

function communityCreatorTotals(posts = []) {
  const totals = posts.reduce((sum, post) => ({
    hotScore: sum.hotScore + Number(post.hotScore || 0),
    likeCount: sum.likeCount + Number(post.likeCount || 0),
    commentCount: sum.commentCount + Number(post.commentCount || 0),
    reuseCount: sum.reuseCount + Number(post.reuseCount || 0),
    downloadCount: sum.downloadCount + Number(post.downloadCount || 0),
    tipTotalCents: sum.tipTotalCents + Number(post.tipTotalCents || 0)
  }), {
    hotScore: 0,
    likeCount: 0,
    commentCount: 0,
    reuseCount: 0,
    downloadCount: 0,
    tipTotalCents: 0
  });
  return {
    ...totals,
    hotScore: Math.round(totals.hotScore * 100) / 100
  };
}

function creatorFeedbackSummaryForPost(postId) {
  return summarizeCreatorFeedbackForPost({
    postId,
    items: state.creatorFeedbackItems,
    handledIds: state.creatorFeedbackHandledIds,
    findPost: (id) => findCommunityPost(id) || state.historyItems.find((item) => item.communityPostId === id)?.communityPost || null
  });
}

function communityCreatorNextStep(post) {
  const feedback = creatorFeedbackSummaryForPost(post.id);
  if (feedback.reported > 0) return `有 ${feedback.reported} 条被举报评论待处理，先确认保留或删除。`;
  if (feedback.normal > 0) return `有 ${feedback.normal} 条新反馈待处理，优先回复评论或置顶有价值的问题。`;
  const likeCount = Number(post.likeCount || 0);
  const commentCount = Number(post.commentCount || 0);
  const reuseCount = Number(post.reuseCount || 0);
  const downloadCount = Number(post.downloadCount || 0);
  if (commentCount > 0) return '有新反馈时，优先回复评论并置顶有价值的问题。';
  if (likeCount > 0) return '已有点赞但还缺评论，可以复制邀请文案，请朋友留下具体建议。';
  if (reuseCount > 0 || downloadCount > 0) return '已有参考创作或免费下载记录，但排名仍只看点赞、评论和时间衰减；先邀请点赞评论。';
  if (likeCount === 0) return '先复制邀请文案，请朋友点赞评论；热度排名只看点赞、评论和时间衰减。';
  return '互动正在积累，优先回看点赞和评论，挑一条有代表性的评论置顶。';
}

function communityReuseInsightText(post) {
  const reuseCount = Number(post?.reuseCount || 0);
  if (reuseCount < 1) return '';
  return `已有 ${reuseCount} 次参考延展，说明这个风格有人在继续创作；可作为参考，当前仍优先看点赞、评论和时间衰减。`;
}

function communityCreatorPrimaryAction(post) {
  const feedback = creatorFeedbackSummaryForPost(post.id);
  if (feedback.reported > 0) return { action: 'reportedFeedback', label: `处理被举报评论 ${feedback.reported}` };
  if (feedback.normal > 0) return { action: 'feedback', label: `处理反馈 ${feedback.normal}` };
  const likeCount = Number(post.likeCount || 0);
  const commentCount = Number(post.commentCount || 0);
  if (commentCount > 0) return { action: 'feedback', label: '处理反馈' };
  if (likeCount === 0 || commentCount === 0) return { action: 'share', label: '邀请评论' };
  return { action: 'viewCommunity', label: '查看点赞评论' };
}

function communityFeedbackQuestion(post) {
  const description = String(post?.description || '').trim();
  if (!description) return '';
  const lines = description
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const direct = lines.find((line) => /最想听|希望大家帮我看|想听|帮我看/.test(line));
  const text = (direct || lines.find((line) => line.length >= 8) || description).replace(/^(最想听哪一处建议|希望大家帮我看|想听|帮我看)[：:]\s*/, '');
  return text.slice(0, 80);
}

function historyCommunityNextStep(post) {
  const feedback = creatorFeedbackSummaryForPost(post.id);
  if (feedback.reported > 0) return `有 ${feedback.reported} 条举报待处理，先确认评论是否保留。`;
  if (feedback.comments > 0) return `有 ${feedback.comments} 条新评论待回复，及时回应能带动后续互动。`;
  if (feedback.replies > 0) return `有 ${feedback.replies} 条新回复待查看，先确认是否需要继续回应。`;
  const commentCount = Number(post.commentCount || 0);
  const downloadCount = Number(post.downloadCount || 0);
  const reuseCount = Number(post.reuseCount || 0);
  if (commentCount === 0) return '这张作品还缺评论，可以复制邀请文案，请朋友点赞、评论。';
  if (reuseCount > 0 || downloadCount > 0) return '参考创作和免费下载只作辅助参考；这里先关注点赞和评论。';
  return '互动正在积累，可以重点查看点赞和评论。';
}

function historyCommunityPrimaryAction(post, imageCount = 1) {
  const feedback = creatorFeedbackSummaryForPost(post.id);
  if (feedback.reported > 0) return { action: 'reportedFeedback', label: `处理举报 ${feedback.reported}` };
  if (feedback.comments > 0) return { action: 'feedback', label: `回复评论 ${feedback.comments}` };
  if (feedback.replies > 0) return { action: 'feedback', label: `查看回复 ${feedback.replies}` };
  const likeCount = Number(post.likeCount || 0);
  const commentCount = Number(post.commentCount || 0);
  if (commentCount === 0 || likeCount === 0) return { action: 'share', label: '邀请点赞评论' };
  return { action: 'viewCommunity', label: imageCount > 1 ? '查看作品' : '查看点赞评论' };
}

function creatorDashboardFocus(posts = []) {
  const ranked = posts
    .map((post) => {
      const feedback = creatorFeedbackSummaryForPost(post.id);
      const priority = feedback.reported > 0
        ? 5000 + feedback.reported
        : feedback.normal > 0
          ? 4000 + feedback.normal
          : Number(post.commentCount || 0) < 1
            ? 3000 + Number(post.likeCount || 0)
            : Number(post.likeCount || 0) < 1
              ? 2500 + Number(post.commentCount || 0)
              : Number(post.hotScore || 0);
      return { post, action: communityCreatorPrimaryAction(post), priority };
    })
    .sort((a, b) => b.priority - a.priority || Number(b.post.updatedAt || b.post.createdAt || 0) - Number(a.post.updatedAt || a.post.createdAt || 0));
  return ranked[0] || null;
}

function renderCreatorDashboardFocus(posts = []) {
  const focus = creatorDashboardFocus(posts);
  if (!focus?.post) return '';
  const urgent = focus.action.action === 'reportedFeedback';
  return `
    <section class="creator-dashboard-focus ${urgent ? 'is-urgent' : ''}">
      <div>
        <span>${urgent ? '优先处理' : '今日回访建议'}</span>
        <strong>${escapeHtml(focus.post.title || '未命名作品')}</strong>
        <p>${escapeHtml(communityCreatorNextStep(focus.post))}</p>
      </div>
      <button type="button" data-creator-card-action="${escapeHtml(focus.action.action)}" data-post-id="${escapeHtml(focus.post.id)}">${escapeHtml(focus.action.label)}</button>
    </section>
  `;
}

function runCreatorCardAction(postId, action) {
  if (!postId) return;
  if (action === 'feedback' || action === 'reportedFeedback') {
    state.communityScope = 'mine';
    state.communityView = 'feedback';
    state.creatorFeedbackFilter = action === 'reportedFeedback' ? 'reported' : 'pending';
    state.creatorFeedbackPostFilterId = postId;
    switchPanel('prompts');
    renderCommunityPanel();
    loadCreatorFeedback({ postId }).catch((error) => setStatus(`反馈收件箱读取失败：${error.message}`, true));
    loadCommunityPosts({ silent: true }).catch((error) => setStatus(`交流区读取失败：${error.message}`, true));
    return;
  }
  if (action === 'series') {
    continueCommunitySeries(postId);
    return;
  }
  if (action === 'edit') {
    openCommunityEdit(postId);
    return;
  }
  shareCommunityPost(postId);
}

function findCommunityPost(id) {
  if (state.communityDetailPost?.id === id) return state.communityDetailPost;
  return state.communityPosts.find((post) => post.id === id) || null;
}

function findCommunityPostSummaryForInvite(id) {
  const postId = String(id || '');
  if (!postId) return null;
  const directPost = findCommunityPost(postId);
  if (directPost) return directPost;
  const historyEntry = state.historyItems.find((item) => item.communityPostId === postId || item.communityPost?.id === postId);
  if (historyEntry?.communityPost) return historyEntry.communityPost;
  if (state.previewItem?.communityPostId === postId && state.previewItem?.communityPost) return state.previewItem.communityPost;
  if (state.previewItem?.communityPostId === postId) {
    return {
      id: postId,
      title: state.previewItem.title || state.previewItem.prompt || ''
    };
  }
  return null;
}

function isOwnCommunityPost(post) {
  return Boolean(state.user?.id && (post?.isOwnPost || post?.userId === state.user.id));
}

function communitySupportText(post) {
  return Number(post?.tipTotalCents || 0) > 0
    ? `已收到自愿支持 ${yuan(post.tipTotalCents)}`
    : '暂无自愿支持';
}

function communityPostLink(postId) {
  const url = new URL('/prompts', window.location.origin);
  url.searchParams.set('post', postId);
  return url.href;
}

function communityReuseSettings(post) {
  const reuseImageIndex = Math.max(0, Math.trunc(Number(post?.reuseImageIndex || 0)) || 0);
  const previewImage = post?.images?.[reuseImageIndex]?.imageUrl || post?.images?.[0]?.imageUrl || post?.imageUrl || '';
  return {
    mode: post?.mode === 'edit' ? 'edit' : 'generate',
    prompt: post?.prompt || '',
    quality: post?.quality || state.quality,
    size: post?.size || state.size,
    outputFormat: post?.outputFormat || state.outputFormat,
    count: post?.count || 1,
    layout: post?.layout || state.layout,
    previewImage
  };
}

const communityReuseIntents = [
  {
    id: 'direct',
    title: '保留参考参数',
    description: '保留原提示词和参数，先生成一个接近的参考版本。',
    suffix: ''
  },
  {
    id: 'subject',
    title: '保持风格换主体',
    description: '保留画风、光影和构图，把主体替换成新的角色或物体。',
    suffix: '保持原作品的画风、光影、镜头语言和构图节奏，将主体替换成新的角色或物体，背景与氛围自然适配'
  },
  {
    id: 'series',
    title: '延展成组作品',
    description: '延续设定，做成同一组作品里的下一张参考版本。',
    suffix: '同一系列，保持主体风格一致，延续世界观和视觉设定，构图和场景做自然变化'
  },
  {
    id: 'usage',
    title: '改成用途图',
    description: '更适合海报、头像、封面或壁纸等实际使用。',
    suffix: '改成适合发布使用的成品图，构图更清晰，主体更突出，可用于海报、头像、封面或壁纸，不添加文字、水印或边框'
  },
  {
    id: 'variation',
    title: '轻微变化',
    description: '只做小幅变化，保留整体观感和主体识别。',
    suffix: '只做轻微变化，保留整体画面观感、主体识别和核心构图，调整细节、姿态、光影或背景层次'
  }
];

function communityReuseIntentById(id) {
  return communityReuseIntents.find((intent) => intent.id === id) || communityReuseIntents[0];
}

function applyCommunityReuseIntent(settings, intentId) {
  const intent = communityReuseIntentById(intentId);
  if (!intent.suffix) return { ...settings };
  const basePrompt = String(settings.prompt || '').trim();
  return {
    ...settings,
    prompt: basePrompt ? `${basePrompt}，${intent.suffix}` : intent.suffix
  };
}

function seriesPrompt(prompt) {
  return applyCommunityReuseIntent({ prompt }, 'series').prompt;
}

function referenceIndexLabel(post) {
  return Math.max(0, Math.trunc(Number(post?.reuseImageIndex || 0)) || 0) + 1;
}

function renderCommunityReuseModal() {
  const post = state.communityReusePost;
  const body = $('communityReuseBody');
  if (!body || !post) return;
  const reuseImageIndex = Math.max(0, Math.trunc(Number(post.reuseImageIndex || 0)) || 0);
  const image = post.images?.[reuseImageIndex]?.imageUrl || post.images?.[0]?.imageUrl || post.imageUrl || '';
  const intent = communityReuseIntentById(state.communityReuseIntent);
  const settings = applyCommunityReuseIntent(communityReuseSettings(post), intent.id);
  const prompt = String(post.prompt || '').trim();
  const promptText = String(settings.prompt || prompt || '').trim();
  const previewPrompt = promptText.length > 260 ? `${promptText.slice(0, 260)}...` : promptText;
  const willReplaceReference = settings.mode === 'edit' && state.sourceImages.length > 0;
  const hasImageContext = Array.isArray(post.images) && post.images.length > 1;
  if ($('communityReuseTitle')) {
    $('communityReuseTitle').textContent = hasImageContext ? `用第 ${reuseImageIndex + 1} 张做参考创作？` : '确认参考参数';
  }
  const meta = [
    settings.mode === 'edit' ? '图生图参考创作' : '文生图参考创作',
    qualityLabel(settings.quality),
    sizeLabelText(settings.size),
    `${settings.count || 1} 张`,
    settings.outputFormat ? String(settings.outputFormat).toUpperCase() : ''
  ].filter(Boolean).join(' · ');
  const imageHint = Array.isArray(post.images) && post.images.length > 1 ? ` · 参考第 ${reuseImageIndex + 1} 张` : '';
  body.innerHTML = `
    <div class="community-reuse-preview">
      ${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(post.title || '参考来源作品')}" />` : '<span>暂无预览</span>'}
    </div>
    <div class="community-reuse-copy">
      <strong>${escapeHtml(post.title || '未命名作品')}</strong>
      <small>${escapeHtml(`${meta}${imageHint}`)}</small>
      <div class="community-reuse-intents">
        ${communityReuseIntents.map((item) => `
          <button class="${item.id === intent.id ? 'active' : ''}" type="button" data-community-reuse-intent="${escapeHtml(item.id)}">
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.description)}</span>
          </button>
        `).join('')}
      </div>
      <p>${escapeHtml(previewPrompt || '这个作品没有可复用提示词。')}</p>
      <ul>
        <li>确认后才会套用当前意图、提示词、尺寸、质量和模式。</li>
        <li>${settings.mode === 'edit' ? '如果是图生图参考创作，会使用来源图片作为参考图。' : '文生图参考创作会只带入提示词和参数。'}</li>
        <li>生成成功后可以上传到交流区，形成你的延展版本。</li>
        <li>取消不会改变你当前工作台里的内容。</li>
      </ul>
      ${willReplaceReference ? `
        <div class="community-reuse-warning">
          <strong>选择如何处理当前源图</strong>
          <span>工作台里已有源图或选区。继续套用会替换当前源图；如果你只想复用提示词，也可以只带入提示词。</span>
        </div>
      ` : ''}
    </div>
  `;
  if ($('communityReuseStatus')) $('communityReuseStatus').textContent = '';
  renderCommunityReuseActions(settings);
}

function renderCommunityReuseActions(settings = null) {
  const actions = $('communityReuseActions');
  if (!actions) return;
  const post = state.communityReusePost;
  const activeSettings = settings || (post ? applyCommunityReuseIntent(communityReuseSettings(post), state.communityReuseIntent) : null);
  const isEditReuse = activeSettings?.mode === 'edit';
  const sourceCount = state.sourceImages.length;
  if (!isEditReuse || sourceCount < 1) {
    actions.innerHTML = `
      <button class="primary-button" id="communityReuseApplyBtn" type="button" data-community-reuse-apply="replace" ${state.communityReuseApplyPending ? 'disabled' : ''}>${state.communityReuseApplyPending ? '处理中…' : '套用到工作台'}</button>
      <button class="secondary-button" id="communityReuseCancelBtn" type="button">取消</button>
    `;
    bindCommunityReuseActionButtons();
    return;
  }
  actions.innerHTML = `
    <button class="primary-button" id="communityReuseApplyBtn" type="button" data-community-reuse-apply="replace" ${state.communityReuseApplyPending ? 'disabled' : ''}>${state.communityReuseApplyPending ? '处理中…' : '替换当前源图'}</button>
    <button class="secondary-button" type="button" data-community-reuse-apply="prompt" ${state.communityReuseApplyPending ? 'disabled' : ''}>只带入提示词</button>
    <button class="secondary-button" id="communityReuseCancelBtn" type="button">取消</button>
  `;
  bindCommunityReuseActionButtons();
}

function bindCommunityReuseActionButtons() {
  $('communityReuseCancelBtn')?.addEventListener('click', closeCommunityReuseModal);
  document.querySelectorAll('[data-community-reuse-apply]').forEach((button) => {
    button.addEventListener('click', () => {
      const post = state.communityReusePost;
      if (!post || state.communityReuseApplyPending) return;
      useCommunityPrompt(post, { referenceMode: button.dataset.communityReuseApply || 'replace' })
        .catch((error) => setCommunityReuseStatus(error.message, true));
    });
  });
}

function activeCommunityReuseSource() {
  const postId = state.communityReusePendingPostId || '';
  if (!postId) return null;
  return findCommunityPost(postId)
    || (state.communityReusePost?.id === postId ? state.communityReusePost : null)
    || (state.communityDetailPost?.id === postId ? state.communityDetailPost : null)
    || { id: postId, title: '交流区作品' };
}

function clearCommunityReuseSource(message = '') {
  state.communityReusePendingPostId = '';
  state.communityReusePendingToken = '';
  renderCommunityReuseSourceBar();
  hideCommunityReuseNudge();
  if (message) setStatus(message);
}

function renderCommunityReuseSourceBar() {
  const bar = $('communityReuseSourceBar');
  if (!bar) return;
  const source = activeCommunityReuseSource();
  if (!source?.id) {
    bar.hidden = true;
    bar.innerHTML = '';
    return;
  }
  const sourceTitle = String(source.title || '交流区作品').trim() || '交流区作品';
  bar.hidden = false;
  bar.innerHTML = `
    <div>
      <span>参考来源</span>
      <strong>《${escapeHtml(sourceTitle)}》</strong>
      <small>生成成功后会记录为这张作品的参考延展；清除来源后只作为普通生成。</small>
    </div>
    <div class="community-reuse-source-actions">
      <button class="secondary-button" type="button" data-community-reuse-source-open="${escapeHtml(source.id)}">查看来源</button>
      <button class="text-button" type="button" data-community-reuse-source-clear>清除来源</button>
    </div>
  `;
}

function openCommunityReuseModal(post, options = {}) {
  if (!post?.prompt) return setStatus('这个作品没有可复用提示词。', true);
  const reuseImageIndex = Math.max(0, Math.trunc(Number(options.imageIndex ?? post.reuseImageIndex ?? 0)) || 0);
  state.communityReusePost = { ...post, reuseImageIndex };
  state.communityReuseIntent = 'direct';
  state.communityReuseApplyPending = false;
  renderCommunityReuseModal();
  $('communityReuseModal')?.classList.add('open');
  $('communityReuseModal')?.setAttribute('aria-hidden', 'false');
  syncModalState();
}

function closeCommunityReuseModal() {
  if (state.communityReuseApplyPending) return;
  $('communityReuseModal')?.classList.remove('open');
  $('communityReuseModal')?.setAttribute('aria-hidden', 'true');
  state.communityReusePost = null;
  state.communityReuseIntent = 'direct';
  state.communityReuseApplyPending = false;
  if ($('communityReuseTitle')) $('communityReuseTitle').textContent = '确认参考参数';
  if ($('communityReuseStatus')) $('communityReuseStatus').textContent = '';
  syncModalState();
}

function setCommunityReuseStatus(message, isError = false) {
  const node = $('communityReuseStatus');
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('error-text', Boolean(isError));
}

async function useCommunityPrompt(post, options = {}) {
  if (!post?.prompt) return setStatus('这个作品没有可复用提示词。', true);
  if (state.communityReuseApplyPending) return;
  state.communityReuseApplyPending = true;
  renderCommunityReuseActions();
  let settings = null;
  try {
    const intentId = state.communityReuseIntent;
    const intent = communityReuseIntentById(intentId);
    settings = applyCommunityReuseIntent(communityReuseSettings(post), intent.id);
    const referenceMode = ['prompt', 'replace'].includes(options.referenceMode) ? options.referenceMode : 'replace';
    if (settings.mode === 'edit' && referenceMode === 'replace' && state.sourceImages.length > 0) {
      const ok = window.confirm('套用这个图生图参考创作会替换工作台当前源图和选区，确认继续？');
      if (!ok) {
        setCommunityReuseStatus('已取消套用，当前工作台源图保持不变。');
        return;
      }
    }
    $('communityReuseModal')?.classList.remove('open');
    $('communityReuseModal')?.setAttribute('aria-hidden', 'true');
    closeCommunityDetailModal();
    let statusText = `已按“${intent.title}”回填提示词和参数，可以直接生成你的版本；生成后可上传到交流区。`;
    if (settings.mode === 'edit') {
      try {
        if (referenceMode === 'prompt') {
          settings.mode = 'generate';
          clearReferenceImage();
          renderReferencePreview();
          statusText = '已只带入参考提示词和参数，源图已清空；生成后可上传到交流区。';
        } else {
          const dataUrl = await sourceToDataUrl(settings.previewImage);
          const added = addReferenceImage(dataUrl, { replace: true, label: '来源参考图' });
          if (!added) throw new Error('来源参考图加载失败');
          renderReferencePreview();
          const sourceName = Array.isArray(post.images) && post.images.length > 1 ? `第 ${referenceIndexLabel(post)} 张` : '来源参考图';
          statusText = `已回填参考提示词、参数和${sourceName}，可以直接生成你的版本；生成后可上传到交流区。`;
        }
      } catch (error) {
        settings.mode = 'generate';
        statusText = `来源参考图读取失败，已保留当前工作台，只带入提示词和参数：${error.message}`;
      }
    }
    applyGenerationSettings(settings, { submit: false, statusText });
    state.communityReusePendingPostId = post.id;
    state.communityReusePendingToken = post.reuseIntentToken || '';
    renderCommunityReuseSourceBar();
    showCommunityReuseNudge();
  } finally {
    state.communityReuseApplyPending = false;
    if ($('communityReuseModal')?.classList.contains('open')) renderCommunityReuseActions(settings);
  }
}

function showCommunityReuseNudge() {
  const nudge = $('communityReuseNudge');
  if (!nudge) return;
  nudge.classList.add('visible');
  cueComposerFocus({ focusGenerate: true });
}

function hideCommunityReuseNudge() {
  $('communityReuseNudge')?.classList.remove('visible');
}

function showCommunityDownloadNudge(post, imageIndex = 0) {
  const nudge = $('communityDownloadNudge');
  if (!nudge || !post) return;
  hideCommunityDownloadNudge();
  const reuseImageIndex = Math.max(0, Math.trunc(Number(imageIndex || 0)) || 0);
  const imageCount = Array.isArray(post.images) && post.images.length ? post.images.length : 1;
  const canReuse = post.canReuse !== false;
  state.communityDownloadNudgePost = stripCommunityPrivateFields({ ...post, reuseImageIndex }, { summary: true });
  if ($('communityDownloadNudgeText')) {
    const targetText = `${post.title || '这张作品'}${imageCount > 1 ? `第 ${reuseImageIndex + 1} 张` : ''}`;
    const hasComments = Number(post.commentCount || 0) > 0;
    const feedbackHint = hasComments ? '也可以补一句你准备用在哪。' : '你可以留下第一条用途建议。';
    $('communityDownloadNudgeText').textContent = `${targetText} 已保存到本机。点赞/评论会反馈给作者，${feedbackHint} 自愿支持只是感谢，不影响排名。`;
  }
  syncCommunityDownloadNudgeActions(post);
  if ($('communityDownloadReuseBtn')) {
    $('communityDownloadReuseBtn').hidden = !canReuse;
    $('communityDownloadReuseBtn').disabled = !canReuse;
    $('communityDownloadReuseBtn').textContent = canReuse ? '参考参数创作' : '暂无可复用参数';
    $('communityDownloadReuseBtn').title = canReuse ? '把这个作品作为参数参考，创作自己的版本' : '这个作品没有可复用提示词';
  }
  nudge.classList.add('visible');
}

function hideCommunityDownloadNudge() {
  $('communityDownloadNudge')?.classList.remove('visible');
  state.communityDownloadNudgePost = null;
}

function syncCommunityDownloadNudgeActions(post) {
  const liked = Boolean(post?.liked);
  const hasComments = Number(post?.commentCount || 0) > 0;
  if ($('communityDownloadLikeBtn')) {
    $('communityDownloadLikeBtn').textContent = liked ? '已点赞，去评论' : '点赞';
    $('communityDownloadLikeBtn').dataset.communityDownloadNext = liked ? 'comment' : 'like';
    $('communityDownloadLikeBtn').title = liked ? '已经点过赞，继续给作者留一条评论' : '点赞后可以继续评论作品';
  }
  if ($('communityDownloadCommentBtn')) {
    $('communityDownloadCommentBtn').textContent = hasComments ? '留一句用途反馈' : '留下第一条建议';
    $('communityDownloadCommentBtn').title = hasComments ? '告诉作者你准备用在哪' : '成为第一个给作者具体建议的人';
  }
}

function syncCommunityDownloadNudgePost() {
  const current = state.communityDownloadNudgePost;
  if (!current?.id) return;
  const latest = findCommunityPost(current.id);
  if (latest) {
    const canReuse = latest.canReuse !== false;
    state.communityDownloadNudgePost = stripCommunityPrivateFields({ ...latest, reuseImageIndex: current.reuseImageIndex || 0 }, { summary: true });
    if ($('communityDownloadNudgeText')) {
      const hasComments = Number(latest.commentCount || 0) > 0;
      $('communityDownloadNudgeText').textContent = hasComments
        ? '已保存到本机。点赞/评论会反馈给作者；自愿支持只是感谢，不影响排名。'
        : '已保存到本机。你可以留下第一条用途建议；自愿支持只是感谢，不影响排名。';
    }
    syncCommunityDownloadNudgeActions(latest);
    if ($('communityDownloadReuseBtn')) {
      $('communityDownloadReuseBtn').hidden = !canReuse;
      $('communityDownloadReuseBtn').disabled = !canReuse;
      $('communityDownloadReuseBtn').textContent = canReuse ? '参考参数创作' : '暂无可复用参数';
      $('communityDownloadReuseBtn').title = canReuse ? '把这个作品作为参数参考，创作自己的版本' : '这个作品没有可复用提示词';
    }
    return;
  }
  hideCommunityDownloadNudge();
}

async function continueCommunitySeries(postId) {
  const post = await ensureCommunityPostPrompt(postId);
  if (!post) return setStatus('作品不存在，无法继续创作。', true);
  closeCommunityDetailModal();
  const settings = applyCommunityReuseIntent(communityReuseSettings(post), 'series');
  applyGenerationSettings(settings, { submit: false, statusText: '已套用参考参数。生成后可以发布你的版本。' });
}

async function shareCommunityPost(postId) {
  if (!postId) return;
  try {
    const post = findCommunityPostSummaryForInvite(postId);
    const title = String(post?.title || '这张交流区作品').trim();
    const link = communityPostLink(postId);
    const opening = isOwnCommunityPost(post)
      ? `我刚上传了一张图《${title}》，想听听你的看法。`
      : `我看到一张交流区作品《${title}》，想拉你一起看看。`;
    const invite = [
      opening,
      '你会把它用在哪个场景？如果改一处，你会改哪里？',
      `可以在这里点赞或评论：${link}`
    ].join('\n');
    await copyText(invite);
    setStatus('邀请文案已复制，可以直接发给朋友；热度排名只看点赞、评论和时间衰减。');
  } catch (error) {
    setStatus(error.message, true);
  }
}

function communityPostParameterText(post, { includePrompt = Boolean(post?.prompt) } = {}) {
  const settings = communityReuseSettings(post);
  const lines = [
    `模式：${settings.mode === 'edit' ? '图生图' : '文生图'}`,
    `尺寸：${sizeLabelText(settings.size)}`,
    `质量：${qualityLabel(settings.quality)}`,
    `格式：${String(settings.outputFormat || 'jpeg').toUpperCase()}`,
    `张数：${settings.count || 1}`,
    `布局：${settings.layout || 'single'}`
  ];
  if (includePrompt && settings.prompt) {
    lines.push('', `提示词：${settings.prompt}`);
  }
  return lines.join('\n');
}

async function copyCommunityPrompt(postId) {
  let post = findCommunityPost(postId);
  if (!post?.prompt) post = await ensureCommunityPostPrompt(postId);
  if (!post?.prompt) return setStatus('这个作品没有可复制的提示词。', true);
  try {
    await copyText(post.prompt);
    setStatus('作品提示词已复制，可作为创作参考；想反馈原作品，优先点赞或评论。');
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function copyCommunityParameters(postId) {
  let post = findCommunityPost(postId);
  if (!post) return setStatus('作品不存在，无法复制参数。', true);
  try {
    await copyText(communityPostParameterText(post, { includePrompt: Boolean(post.prompt) }));
    setStatus(post.prompt
      ? '作品参数已复制，可作为创作参考；复制不会影响交流区热度。'
      : '公开参数已复制，不含完整提示词；点赞或评论会反馈给原作者。');
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function openCommunityDetail(postId, options = {}) {
  const token = state.communityDetailLoadToken + 1;
  state.communityDetailLoadToken = token;
  try {
    if (state.communityDownloadNudgePost?.id && state.communityDownloadNudgePost.id !== postId) {
      hideCommunityDownloadNudge();
    }
    if (options.updateUrl && state.activePanel !== 'prompts') {
      switchPanel('prompts', { updateUrl: false });
    }
    const data = await api(`/api/community/posts/${encodeURIComponent(postId)}`);
    if (token !== state.communityDetailLoadToken) return;
    state.communityDetailPost = normalizeCommunityPostForDisplay(data.post);
    state.communityReplyToCommentId = '';
    renderCommunityDetail();
    $('communityDetailModal').classList.add('open');
    $('communityDetailModal').setAttribute('aria-hidden', 'false');
    if (options.updateUrl) {
      const nextPath = `/prompts?post=${encodeURIComponent(postId)}`;
      if (`${window.location.pathname}${window.location.search}` !== nextPath) {
        window.history.pushState({ panel: 'prompts', postId }, '', nextPath);
      }
    }
    syncModalState();
  } catch (error) {
    if (token !== state.communityDetailLoadToken) return;
    if (error.status === 401) {
      requireLoginAfterExpired({ type: 'openCommunity', postId });
      return setStatus('登录状态已过期，请重新登录后继续查看作品。', true);
    }
    setStatus(error.message, true);
  }
}

async function ensureCommunityPostPrompt(postId) {
  const post = findCommunityPost(postId);
  if (post?.prompt) return post;
  if (!postId) return null;
  if (!state.user) {
    requireLoginForCommunity('reuseCommunity', postId, { keepDetailOpen: true });
    throw new Error('请先登录后再参考创作。');
  }
  const data = await api(`/api/community/posts/${encodeURIComponent(postId)}/reuse-params`);
  if (data.post) applyCommunityPostUpdate(data.post);
  const nextPost = data.post || findCommunityPost(postId);
  return nextPost ? { ...nextPost, reuseIntentToken: data.reuseIntentToken || '' } : nextPost;
}

function closeCommunityDetailModal(options = {}) {
  const { preserveRoute = false } = options;
  state.communityDetailLoadToken += 1;
  $('communityDetailModal')?.classList.remove('open');
  $('communityDetailModal')?.setAttribute('aria-hidden', 'true');
  if (state.communityDetailPost?.id === state.communityPostPublishSuccessId) {
    state.communityPostPublishSuccessId = '';
  }
  state.communityReplyToCommentId = '';
  state.creatorFeedbackReplyingId = '';
  state.communityCommentFollowup = null;
  if (!preserveRoute && panelFromPath() === 'prompts' && new URLSearchParams(window.location.search).has('post')) {
    window.history.pushState({ panel: 'prompts' }, '', '/prompts');
  }
  syncModalState();
}

function renderCommunityTipModal() {
  const post = state.communityTipPost;
  if (!post) return;
  if ($('communityTipTitle')) $('communityTipTitle').textContent = '自愿支持作者';
  if ($('communityTipWork')) {
    $('communityTipWork').textContent = `${post.title || '未命名作品'} · ${post.username || '创作者'}，下载仍然免费；自愿支持不会解锁额外内容，也不影响交流区排名。`;
  }
  if ($('communityTipBalance')) $('communityTipBalance').textContent = yuan(state.user?.balanceCents || 0);
  if ($('communityTipStatus')) $('communityTipStatus').textContent = '';
  if ($('communityTipSubmitBtn')) $('communityTipSubmitBtn').disabled = false;
}

function openCommunityTipModal(post) {
  state.communityTipPost = post;
  if ($('communityTipAmount')) $('communityTipAmount').value = post?.presetTipAmount ? String(post.presetTipAmount) : '';
  renderCommunityTipModal();
  $('communityTipModal')?.classList.add('open');
  $('communityTipModal')?.setAttribute('aria-hidden', 'false');
  syncModalState();
  setTimeout(() => $('communityTipAmount')?.focus(), 30);
}

function closeCommunityTipModal() {
  if (state.communityTipPending) return;
  $('communityTipModal')?.classList.remove('open');
  $('communityTipModal')?.setAttribute('aria-hidden', 'true');
  state.communityTipPost = null;
  if ($('communityTipStatus')) $('communityTipStatus').textContent = '';
  syncModalState();
}

function setCommunityTipStatus(message, isError = false) {
  const node = $('communityTipStatus');
  if (!node) return;
  node.textContent = message || '';
  node.classList.toggle('error-text', Boolean(isError));
}

function renderCommunityComment(comment, { canManagePost = false, isReply = false } = {}) {
  const isViewerComment = Boolean(comment.isViewerComment);
  const canDelete = state.user && (canManagePost || isViewerComment);
  const canReport = state.user && !isViewerComment;
  const isFeedbackLocked = canManagePost && (Number(comment.reportCount || 0) > 0 || Boolean(comment.feedbackLocked));
  const canReply = !isReply && comment.canReply !== false && (!state.user || !isViewerComment);
  const canPin = canManagePost && !isReply && !isFeedbackLocked;
  const canResolveReports = canManagePost && Number(comment.reportCount || 0) > 0;
  const pinPending = isCommunityActionPending('pinComment', comment.id) || isCommunityActionPending('unpinComment', comment.postId);
  const reportPending = isCommunityActionPending('reportComment', comment.id);
  const resolvePending = isCommunityActionPending('resolveReports', comment.id);
  const deletePending = isCommunityActionPending('deleteComment', comment.id);
  const replies = !isReply && Array.isArray(comment.replies) && comment.replies.length
    ? `<div class="community-replies">${comment.replies.map((reply) => renderCommunityComment(reply, { canManagePost, isReply: true })).join('')}</div>`
    : '';
  return `
    <article class="community-comment ${comment.pinned ? 'pinned' : ''} ${isReply ? 'reply' : ''}">
      <div class="community-comment-head">
        <strong>${escapeHtml(comment.username || '用户')}</strong>
        ${comment.isAuthor ? '<span class="community-comment-badge">作者</span>' : ''}
        ${comment.pinned ? '<span class="community-comment-badge pinned">置顶</span>' : ''}
        <span>${escapeHtml(formatDate(comment.createdAt))}</span>
        ${canPin ? (comment.pinned
          ? `<button type="button" data-community-comment-unpin="${escapeHtml(comment.id)}" ${pinPending ? 'disabled' : ''}>${pinPending ? '处理中…' : '取消置顶'}</button>`
          : `<button type="button" data-community-comment-pin="${escapeHtml(comment.id)}" ${pinPending ? 'disabled' : ''}>${pinPending ? '处理中…' : '置顶'}</button>`) : ''}
        ${canManagePost && comment.reportCount ? `<span class="community-comment-badge report">${comment.reportCount} 举报</span>` : ''}
        ${canReply ? `<button type="button" data-community-comment-reply="${escapeHtml(comment.id)}">回复</button>` : ''}
        ${canReport ? `<button type="button" data-community-comment-report="${escapeHtml(comment.id)}" ${reportPending ? 'disabled' : ''}>${reportPending ? '提交中…' : (comment.reportedByViewer ? '已举报' : '举报')}</button>` : ''}
        ${canResolveReports ? `<button type="button" data-community-comment-resolve-reports="${escapeHtml(comment.id)}" ${resolvePending ? 'disabled' : ''}>${resolvePending ? '处理中…' : '保留并处理'}</button>` : ''}
        ${canDelete ? `<button type="button" data-community-comment-delete="${escapeHtml(comment.id)}" ${deletePending ? 'disabled' : ''}>${deletePending ? '删除中…' : '删除'}</button>` : ''}
      </div>
      <p>${escapeHtml(comment.body)}</p>
      ${replies}
    </article>
  `;
}

function flattenCommunityComments(comments = []) {
  return comments.flatMap((comment) => [comment, ...flattenCommunityComments(comment.replies || [])]);
}

function clearCommunityCommentFollowup() {
  state.communityCommentFollowup = null;
  renderCommunityDetail();
}

function renderCommunityDetail() {
  const post = state.communityDetailPost;
  const body = $('communityDetailBody');
  if (!body || !post) return;
  const images = (post.images || []).length ? post.images : (post.imageUrl ? [{ imageUrl: post.imageUrl }] : []);
  const sourceImages = Array.isArray(post.sourceImages) ? post.sourceImages.filter((image) => image?.imageUrl) : [];
  const canManagePost = state.user && (state.user.role === 'admin' || isOwnCommunityPost(post));
  const isOwnPost = isOwnCommunityPost(post);
  const publishSuccess = state.communityPostPublishSuccessId === post.id;
  const creatorInsight = canManagePost ? communityCreatorNextStep(post) : '';
  const comments = post.comments || [];
  const hasPinnableComment = comments.some((comment) => !comment.parentCommentId && Number(comment.reportCount || 0) < 1 && !comment.feedbackLocked && comment.canReply !== false);
  const shouldShowPinPrompt = canManagePost && hasPinnableComment && !post.pinnedCommentId;
  const canReuse = post.canReuse !== false;
  const sameStyleVersions = Array.isArray(post.sameStyleVersions) ? post.sameStyleVersions : [];
  const commentFollowup = state.communityCommentFollowup?.postId === post.id ? state.communityCommentFollowup : null;
  const canCopyFullPrompt = Boolean(post.prompt);
  const commentPending = isCommunityActionPending('comment', post.id);
  const shouldPromptAuthorNote = canManagePost && String(post.description || '').trim().length < 20;
  const feedbackQuestion = communityFeedbackQuestion(post);
  const detailLikeAction = isOwnPost
    ? '<span class="community-own-work-pill detail">自己的作品无需点赞</span>'
    : `<button class="primary-button community-detail-primary-action" type="button" data-community-like="${escapeHtml(post.id)}" ${isCommunityActionPending('like', post.id) ? 'disabled' : ''}>${isCommunityActionPending('like', post.id) ? '处理中…' : (post.liked ? '已点赞' : '点赞')}</button>`;
  const detailReuseButton = canReuse
    ? `<button class="secondary-button community-detail-secondary-action" type="button" data-community-use="${escapeHtml(post.id)}" title="基于这个作品的参数做自己的版本">参考创作</button>`
    : '';
  body.innerHTML = `
    ${publishSuccess ? `
      <section class="community-publish-success">
        <div>
          <strong>作品已发布</strong>
          <span>先复制邀请文案，请朋友留下第一条具体建议；下载始终免费，自愿支持不影响排名。</span>
          <ol class="community-publish-steps">
            <li><span>1</span>复制邀请文案</li>
            <li><span>2</span>邀请首评</li>
            <li><span>3</span>查看并置顶好评论</li>
          </ol>
        </div>
        <div>
          <button class="primary-button" type="button" data-community-share="${escapeHtml(post.id)}">复制邀请文案</button>
          ${shouldPromptAuthorNote ? '<button class="secondary-button" type="button" data-community-author-note>补充作者说明</button>' : ''}
          <button class="secondary-button" type="button" data-community-focus-comment>查看评论区</button>
        </div>
      </section>
    ` : ''}
    <div class="community-detail-grid">
      <section class="community-detail-preview">
        ${images.map((image, index) => `
          <article class="community-detail-image">
            <img src="${escapeHtml(image.imageUrl)}" alt="${escapeHtml(post.title)} 预览 ${index + 1}" loading="lazy" decoding="async" fetchpriority="low" />
            <button class="secondary-button" type="button" data-community-download="${escapeHtml(post.id)}" data-community-download-index="${index}" ${isCommunityDownloadPending(post.id, index) ? 'disabled' : ''}>${isCommunityDownloadPending(post.id, index) ? '准备下载…' : `免费下载第 ${index + 1} 张`}</button>
          </article>
        `).join('') || '<div class="community-empty-preview">暂无预览</div>'}
        ${sourceImages.length ? `
          <div class="community-source-preview">
            <div class="community-source-preview-head">
              <strong>图生图原图</strong>
              <span>${sourceImages.length} 张参考源图</span>
            </div>
            <div class="community-source-preview-grid">
              ${sourceImages.map((image, index) => `
                <figure>
                  <img src="${escapeHtml(image.imageUrl)}" alt="${escapeHtml(post.title || '交流区作品')} 原图 ${index + 1}" loading="lazy" decoding="async" fetchpriority="low" />
                  <figcaption>原图 ${index + 1}</figcaption>
                </figure>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </section>
      <section class="community-detail-copy">
        <p class="eyebrow">交流区作品</p>
        <h2 id="communityDetailTitle">${escapeHtml(post.title || '未命名作品')}</h2>
        <p>${escapeHtml(post.description || '作者暂未填写介绍。')}</p>
        <div class="community-detail-meta">
          <span>${escapeHtml(post.username || '创作者')}</span>
          <span>${escapeHtml(formatDate(post.createdAt))}</span>
        </div>
        <div class="community-detail-metrics primary">${communityPrimaryMetrics(post)}</div>
        <div class="community-detail-metrics secondary" aria-label="辅助互动指标">${communitySecondaryMetrics(post)}</div>
        ${creatorInsight ? `
          <div class="creator-detail-insight">
            <strong>创作者反馈</strong>
            <span>${escapeHtml(creatorInsight)}</span>
          </div>
        ` : ''}
        <div class="library-card-tags">
          ${(post.tags || []).map((tag) => `<em>${escapeHtml(tag)}</em>`).join('')}
        </div>
        <div class="community-detail-prompt-box">
          <div>
            <strong>${canCopyFullPrompt ? '完整提示词' : '参考参数'}</strong>
            <span>${canReuse ? (canCopyFullPrompt ? '你可以复制自己的完整提示词；其他用户可用参考创作延展版本，便于作者看到延展版本。' : '公开详情不直接展示完整提示词；想做自己的版本，请使用参考创作，方便作者看到延展版本。') : '这个作品暂时没有可复用提示词。'}</span>
          </div>
          <div class="community-detail-prompt-actions">
            ${canReuse ? `<button class="secondary-button" type="button" data-community-use="${escapeHtml(post.id)}">参考创作</button>` : ''}
            ${canCopyFullPrompt ? `<button class="secondary-button" type="button" data-community-copy-prompt="${escapeHtml(post.id)}">复制完整提示词</button>` : ''}
            <button class="secondary-button" type="button" data-community-copy-params="${escapeHtml(post.id)}">复制参数</button>
          </div>
          <pre class="community-detail-prompt">${canCopyFullPrompt ? escapeHtml(post.prompt || '') : '完整提示词仅作者可见；点击“参考创作”可在登录后套用参数并发布自己的版本。'}</pre>
        </div>
        <div class="community-detail-actions">
          ${detailLikeAction}
          <button class="primary-button community-detail-primary-action" type="button" data-community-focus-comment>留下建议</button>
          ${detailReuseButton}
          ${images.length > 1
            ? '<span class="community-download-note">本作品集支持逐张免费下载；热度排名只看点赞、评论和时间衰减，自愿支持不参与排名。</span>'
            : `<button class="secondary-button" type="button" data-community-download="${escapeHtml(post.id)}" ${isCommunityDownloadPending(post.id, 0) ? 'disabled' : ''}>${isCommunityDownloadPending(post.id, 0) ? '准备下载…' : '免费下载'}</button>`}
          ${isOwnPost ? `<span class="community-support-note detail">${escapeHtml(communitySupportText(post))}，不影响交流区排名。</span>` : `<button class="secondary-button" type="button" data-community-tip="${escapeHtml(post.id)}">自愿支持作者</button>`}
          <button class="secondary-button" type="button" data-community-share="${escapeHtml(post.id)}">复制邀请文案</button>
          ${canManagePost ? `<button class="secondary-button" type="button" data-community-edit="${escapeHtml(post.id)}">编辑资料</button>` : ''}
          ${canManagePost ? `<button class="danger-button" type="button" data-community-delete="${escapeHtml(post.id)}">撤下作品</button>` : ''}
        </div>
      </section>
    </div>
	    <section class="community-comments">
	      <h3>评论</h3>
	      ${feedbackQuestion ? `<div class="community-comment-brief"><strong>作者想听</strong><span>${escapeHtml(feedbackQuestion)}</span></div>` : ''}
      ${commentFollowup ? `
        <div class="community-comment-followup">
          <div>
            <strong>评论已发布</strong>
            <span>${post.liked ? '可以继续看评论；热度排名只看点赞、评论和时间衰减，参考创作只是可选延展。' : '可以继续看评论；如果也喜欢这张作品，顺手点赞会让作者更快看到反馈。'}</span>
          </div>
          <div>
            <button class="primary-button" type="button" data-community-followup-dismiss>继续看评论</button>
            ${post.liked || isOwnPost ? '' : `<button class="secondary-button" type="button" data-community-like="${escapeHtml(post.id)}">顺手点赞</button>`}
          </div>
        </div>
      ` : ''}
      ${shouldShowPinPrompt ? `
        <div class="community-pin-prompt">
          <div>
            <strong>置顶一个有代表性的评论</strong>
            <span>优先展示有价值的问题、使用反馈或改进建议，能帮助后来的用户参与讨论。</span>
          </div>
        </div>
      ` : ''}
      <div class="community-comment-list">
        ${comments.length ? comments.map((comment) => renderCommunityComment(comment, { canManagePost })).join('') : `<p class="feature-empty">${canManagePost ? '还没有评论。可以先复制邀请文案，请朋友留下第一条评论。' : '还没有评论。说说你会怎么使用这张图，或给作者一个改进建议。'}</p>`}
      </div>
      <p class="community-reply-target" id="communityReplyTarget" ${state.communityReplyToCommentId ? '' : 'hidden'}></p>
      ${!state.communityReplyToCommentId ? `
        <div class="community-comment-suggestions" aria-label="评论建议">
          <button type="button" data-community-comment-suggestion="我会把它用在这个场景：">你会用在哪？</button>
          <button type="button" data-community-comment-suggestion="最吸引我的是这个细节：">哪点最吸引？</button>
          <button type="button" data-community-comment-suggestion="如果只改一处，我建议改这里：">改一处哪里？</button>
        </div>
      ` : ''}
      <div class="community-comment-form">
	        <textarea id="communityCommentInput" maxlength="300" placeholder="${state.user ? (state.communityReplyToCommentId ? '写下你的回复' : (feedbackQuestion ? `围绕作者想听的问题说一句：${feedbackQuestion}` : '说说你会怎么使用这张图，或给作者一个建议')) : '登录后可以评论，告诉作者你会怎么用这张图'}"></textarea>
        <button class="primary-button" id="communityCommentSubmitBtn" type="button" ${commentPending ? 'disabled' : ''}>${commentPending ? (state.communityReplyToCommentId ? '回复中…' : '发布中…') : (state.user ? (state.communityReplyToCommentId ? '提交回复' : '提交评论') : '登录评论')}</button>
        ${state.communityReplyToCommentId ? '<button class="secondary-button" id="communityReplyCancelBtn" type="button">取消回复</button>' : ''}
      </div>
    </section>
    ${sameStyleVersions.length || Number(post.reuseCount || 0) > 0 ? `
      <section class="community-same-style">
        <div class="community-section-head">
          <div>
            <span>参考延展</span>
            <h3>${sameStyleVersions.length ? '这些延展版本可作为创作参考' : `已有 ${post.reuseCount || 0} 次参考创作，暂时还没人发布版本`}</h3>
          </div>
          ${canReuse ? `<button class="secondary-button" type="button" data-community-use="${escapeHtml(post.id)}">做我的版本</button>` : ''}
        </div>
        ${sameStyleVersions.length ? `
          <div class="community-same-style-list">
            ${sameStyleVersions.map((item) => `
              <button class="community-same-style-card" type="button" data-community-open="${escapeHtml(item.id)}">
                ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title || '参考延展版本')}" loading="lazy" />` : '<span>暂无预览</span>'}
                <strong>${escapeHtml(item.title || '未命名版本')}</strong>
                <small>${escapeHtml(item.username || '创作者')} · 主：${item.likeCount || 0} 赞 / ${item.commentCount || 0} 评论 · 辅助：${item.downloadCount || 0} 位用户免费下载</small>
              </button>
            `).join('')}
          </div>
        ` : '<p class="community-same-style-empty">有人已经用它做过参考创作；先看看评论反馈，发布你的版本后会出现在这里作为参考。</p>'}
      </section>
    ` : ''}
  `;
  const replyTarget = $('communityReplyTarget');
  if (replyTarget && state.communityReplyToCommentId) {
    const target = comments.find((comment) => comment.id === state.communityReplyToCommentId);
    replyTarget.textContent = target ? `正在回复 ${target.username || '用户'}：${String(target.body || '').slice(0, 40)}` : '正在回复评论';
  }
}

async function deleteCommunityComment(commentId) {
  const post = state.communityDetailPost;
  if (!post || !commentId) return;
  if (isCommunityActionPending('deleteComment', commentId)) return;
  const ok = window.confirm('确认删除这条评论？');
  if (!ok) return;
  setCommunityActionPending('deleteComment', commentId, true);
  renderCommunityDetail();
  try {
    const data = await api(`/api/community/posts/${encodeURIComponent(post.id)}/comments/${encodeURIComponent(commentId)}`, {
      method: 'DELETE'
    });
    if (data.post) {
      state.creatorFeedbackHandledIds = state.creatorFeedbackHandledIds.filter((id) => id !== commentId);
      saveCreatorFeedbackHandledIds();
      clearCreatorFeedbackSummaryCache();
      if (state.communityScope === 'mine') loadCreatorFeedback({ silent: true }).catch(() => {});
      applyCommunityPostUpdate(data.post);
    }
    setStatus('评论已删除。');
  } catch (error) {
    if (error.status === 401) {
      requireLoginAfterExpired({ type: 'deleteComment', postId: post.id, commentId });
      return setStatus('登录状态已过期，请重新登录后继续删除评论。', true);
    }
    setStatus(error.message, true);
  } finally {
    setCommunityActionPending('deleteComment', commentId, false);
    if (state.communityDetailPost?.id === post.id) renderCommunityDetail();
  }
}

async function resolveCommunityCommentReportsById(commentId) {
  const post = state.communityDetailPost;
  if (!post || !commentId) return;
  const target = flattenCommunityComments(post.comments || []).find((comment) => comment.id === commentId);
  if (!state.user) {
    requireLoginAfterExpired({ type: 'resolveReports', postId: post.id, commentId });
    return setStatus('登录后才能处理举报。', true);
  }
  const canManagePost = state.user.role === 'admin' || isOwnCommunityPost(post);
  if (!canManagePost) return setStatus('没有权限处理这条举报。', true);
  if (target && Number(target.reportCount || 0) < 1) return setStatus('这条评论没有待处理举报。');
  if (isCommunityActionPending('resolveReports', commentId)) return;
  const ok = window.confirm('确认保留这条评论并把举报标记为已处理？');
  if (!ok) return;
  setCommunityActionPending('resolveReports', commentId, true);
  renderCommunityDetail();
  try {
    const data = await api(`/api/community/posts/${encodeURIComponent(post.id)}/comments/${encodeURIComponent(commentId)}/reports/resolve`, {
      method: 'POST'
    });
    if (data.post) {
      applyCommunityPostUpdate(data.post);
      state.communityDetailPost = data.post;
      const handledId = creatorFeedbackIdForCommentReply(post.id, commentId) || commentId;
      markCreatorFeedbackHandled(handledId, { silent: true });
      if (state.communityScope === 'mine') loadCreatorFeedback({ silent: true }).catch(() => {});
      renderCommunityDetail();
      renderCommunityPanel();
    }
    setStatus(`已处理 ${data.resolvedCount || 0} 条举报，评论已保留。如需突出展示，可重新置顶。`);
  } catch (error) {
    if (error.status === 401) {
      requireLoginAfterExpired({ type: 'resolveReports', postId: post.id, commentId });
      return setStatus('登录状态已过期，请重新登录后继续处理举报。', true);
    }
    setStatus(error.message, true);
  } finally {
    setCommunityActionPending('resolveReports', commentId, false);
    if (state.communityDetailPost?.id === post.id) renderCommunityDetail();
  }
}

async function resolveCreatorFeedbackReports(commentId, postId, feedbackId = '') {
  if (!commentId || !postId) return;
  try {
    await openCommunityDetailForFeedback(postId, { updateUrl: false });
    await resolveCommunityCommentReportsById(commentId);
    if (feedbackId) markCreatorFeedbackHandled(feedbackId, { silent: true });
    await loadCreatorFeedback({ silent: true });
    renderCommunityPanel();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function deleteCommunityPostById(postId) {
  const post = findCommunityPost(postId);
  if (!post) return;
  const ok = window.confirm('确认撤下这个交流区作品？撤下后别人将无法再浏览、下载或评论它。');
  if (!ok) return;
  try {
    const data = await api(`/api/community/posts/${encodeURIComponent(postId)}`, { method: 'DELETE' });
    state.communityPosts = state.communityPosts.filter((item) => item.id !== postId);
    clearCommunityCardCache();
    if (state.communityDetailPost?.id === postId) state.communityDetailPost = null;
    state.historyItems = state.historyItems.map((entry) => entry.communityPostId === postId ? { ...entry, communityPostId: null, communityPost: null } : entry);
    if (state.previewItem?.communityPostId === postId) {
      state.previewItem = { ...state.previewItem, communityPostId: null, communityPost: null };
      renderGeneratedImages(state.previewItem);
    }
    await loadHistory();
    closeCommunityDetailModal();
    renderCommunityPanel();
    setStatus(data.deleted?.generationId ? '作品已从交流区撤下，历史记录仍保留。' : '作品已从交流区撤下。');
  } catch (error) {
    if (error.status === 401) {
      requireLoginAfterExpired({ type: 'deletePost', postId });
      return setStatus('登录状态已过期，请重新登录后继续管理作品。', true);
    }
    setStatus(error.message, true);
  }
}

async function pinCommunityCommentById(commentId) {
  const post = state.communityDetailPost;
  if (!post || !commentId) return;
  if (isCommunityActionPending('pinComment', commentId)) return;
  const target = (post.comments || []).find((comment) => comment.id === commentId);
  if (Number(target?.reportCount || 0) > 0) return setStatus('被举报评论暂不支持置顶，请先处理举报或删除。', true);
  setCommunityActionPending('pinComment', commentId, true);
  renderCommunityDetail();
  try {
    const data = await api(`/api/community/posts/${encodeURIComponent(post.id)}/comments/${encodeURIComponent(commentId)}/pin`, {
      method: 'POST'
    });
    if (data.post) {
      if (state.communityScope === 'mine') loadCreatorFeedback({ silent: true }).catch(() => {});
      applyCommunityPostUpdate(data.post);
    }
    setStatus('评论已置顶，会优先展示给后来查看作品的用户。');
  } catch (error) {
    if (error.status === 401) {
      requireLoginAfterExpired({ type: 'pinComment', postId: post.id, commentId });
      return setStatus('登录状态已过期，请重新登录后继续置顶评论。', true);
    }
    setStatus(error.message, true);
  } finally {
    setCommunityActionPending('pinComment', commentId, false);
    if (state.communityDetailPost?.id === post.id) renderCommunityDetail();
  }
}

async function unpinCommunityCommentById() {
  const post = state.communityDetailPost;
  if (!post) return;
  if (isCommunityActionPending('unpinComment', post.id)) return;
  setCommunityActionPending('unpinComment', post.id, true);
  renderCommunityDetail();
  try {
    const data = await api(`/api/community/posts/${encodeURIComponent(post.id)}/comments/pin`, {
      method: 'DELETE'
    });
    if (data.post) {
      if (state.communityScope === 'mine') loadCreatorFeedback({ silent: true }).catch(() => {});
      applyCommunityPostUpdate(data.post);
    }
    setStatus('已取消置顶。');
  } catch (error) {
    if (error.status === 401) {
      requireLoginAfterExpired({ type: 'unpinComment', postId: post.id });
      return setStatus('登录状态已过期，请重新登录后继续取消置顶。', true);
    }
    setStatus(error.message, true);
  } finally {
    setCommunityActionPending('unpinComment', post.id, false);
    if (state.communityDetailPost?.id === post.id) renderCommunityDetail();
  }
}

async function reportCommunityCommentById(commentId) {
  const post = state.communityDetailPost;
  if (!post || !commentId) return;
  if (!state.user) {
    requireLoginForCommunity('reportComment', post.id, { commentId, keepDetailOpen: true });
    return setStatus('请先登录后再举报评论。', true);
  }
  if (isCommunityActionPending('reportComment', commentId)) return;
  const ok = window.confirm('确认举报这条评论？管理员会在社区治理面板中看到。');
  if (!ok) return;
  setCommunityActionPending('reportComment', commentId, true);
  renderCommunityDetail();
  try {
    const data = await api(`/api/community/posts/${encodeURIComponent(post.id)}/comments/${encodeURIComponent(commentId)}/report`, {
      method: 'POST'
    });
    if (data.post) applyCommunityPostUpdate(data.post);
    setStatus('举报已提交，管理员会进行处理。');
  } catch (error) {
    if (error.status === 401) {
      requireLoginAfterExpired({ type: 'reportComment', postId: post.id, commentId });
      return setStatus('登录状态已过期，请重新登录后继续举报评论。', true);
    }
    setStatus(error.message, true);
  } finally {
    setCommunityActionPending('reportComment', commentId, false);
    if (state.communityDetailPost?.id === post.id) renderCommunityDetail();
  }
}

function replyCommunityCommentById(commentId) {
  const post = state.communityDetailPost;
  if (!state.user) {
    requireLoginForCommunity('replyComment', post?.id || '', { commentId, keepDetailOpen: true });
    return setStatus('请先登录后再回复评论。', true);
  }
  const target = (post?.comments || []).find((comment) => comment.id === commentId);
  if (!target) return setStatus('回复的评论不存在。', true);
  if (target.isAuthor || target.isViewerComment) return setStatus('自己的评论无需回复，可以补充一条新评论或完善作品介绍。', true);
  if (Number(target.reportCount || 0) > 0) return setStatus('被举报评论暂不支持回复，请先处理举报或删除。', true);
  state.creatorFeedbackReplyingId = creatorFeedbackIdForCommentReply(post.id, target.id);
  state.communityReplyToCommentId = commentId;
  renderCommunityDetail();
  setTimeout(() => $('communityCommentInput')?.focus(), 30);
}

function cancelCommunityReply() {
  state.communityReplyToCommentId = '';
  state.creatorFeedbackReplyingId = '';
  renderCommunityDetail();
}

function focusCommunityCommentBox() {
  const post = state.communityDetailPost;
  if (!post?.id) return;
  if (!state.user) {
    requireLoginForCommunity('comment', post.id, { body: '', parentCommentId: null, keepDetailOpen: true });
    return setStatus('请先登录后再评论。', true);
  }
  state.creatorFeedbackReplyingId = '';
  state.communityReplyToCommentId = '';
  renderCommunityDetail();
  setTimeout(() => {
    const input = $('communityCommentInput');
    scrollIntoViewSafe(input, { behavior: 'smooth', block: 'center' });
    input?.focus();
  }, 30);
  setStatus('可以给作者留个评论；留下点赞和评论，作品更容易进入热门讨论。下载始终免费，自愿支持不参与排名。');
}

function focusCommunityAuthorNote() {
  const post = state.communityDetailPost;
  if (!post?.id) return;
  if (!state.user) {
    requireLoginForCommunity('comment', post.id, { body: '作者说明：', parentCommentId: null, keepDetailOpen: true });
    return setStatus('请先登录后再补充作者说明。', true);
  }
  state.creatorFeedbackReplyingId = '';
  state.communityReplyToCommentId = '';
  renderCommunityDetail();
  setTimeout(() => {
    const input = $('communityCommentInput');
    if (!input) return;
    input.value = '作者说明：';
    scrollIntoViewSafe(input, { behavior: 'smooth', block: 'center' });
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, 30);
  setStatus('补充你想用于什么、希望大家看哪里，能帮助别人留下更具体的评论。');
}

async function openCommunityDetailForFeedback(postId, { replyTo = '', updateUrl = true } = {}) {
  await openCommunityDetail(postId, { updateUrl });
  if (state.communityDetailPost?.id !== postId) return;
  if (replyTo) {
    const target = flattenCommunityComments(state.communityDetailPost.comments || []).find((comment) => comment.id === replyTo);
    if (!target) {
      state.creatorFeedbackReplyingId = '';
      return setStatus('原评论已删除，已打开作品详情。', true);
    }
    state.communityReplyToCommentId = replyTo;
    renderCommunityDetail();
    setTimeout(() => $('communityCommentInput')?.focus(), 30);
  }
}

async function submitCommunityComment() {
  const post = state.communityDetailPost;
  if (!post) return;
  const input = $('communityCommentInput');
  const body = String(input?.value || '').trim();
  if (!state.user) {
    requireLoginForCommunity('comment', post.id, { body, parentCommentId: state.communityReplyToCommentId || null, feedbackId: state.creatorFeedbackReplyingId || '', keepDetailOpen: true });
    return setStatus('请先登录后再评论。', true);
  }
  if (!body) return setStatus('请输入评论内容。', true);
  if (isCommunityActionPending('comment', post.id)) return setStatus(state.communityReplyToCommentId ? '回复正在发布，请不要重复提交。' : '评论正在发布，请不要重复提交。');
  setCommunityActionPending('comment', post.id, true);
  renderCommunityDetail();
  const button = $('communityCommentSubmitBtn');
  if (button) button.disabled = true;
  const wasReply = Boolean(state.communityReplyToCommentId);
  const wasFeedbackReply = Boolean(wasReply && state.creatorFeedbackReplyingId);
  try {
    const data = await api(`/api/community/posts/${encodeURIComponent(post.id)}/comments`, {
      method: 'POST',
      body: { body, parentCommentId: state.communityReplyToCommentId || null }
    });
    state.communityReplyToCommentId = '';
    let handledFeedback = false;
    if (wasFeedbackReply) {
      handledFeedback = markCreatorFeedbackHandled(state.creatorFeedbackReplyingId, { silent: true });
      state.creatorFeedbackReplyingId = '';
    }
    if (state.communityScope === 'mine') loadCreatorFeedback({ silent: true }).catch(() => {});
    if (data.post) applyCommunityPostUpdate(data.post);
    else {
      renderCommunityDetail();
      renderCommunityPanel();
    }
    state.communityCommentFollowup = !wasReply && !handledFeedback
      ? { postId: post.id, createdAt: Date.now() }
      : null;
    if (state.communityDetailPost?.id === post.id) renderCommunityDetail();
    setStatus(handledFeedback
      ? '回复已发布，反馈已处理。'
      : (wasReply ? '回复已发布。' : '评论已发布。可以继续看评论，也可以给作品点赞；参考创作只是可选延展。'));
  } catch (error) {
    if (error.status === 401) {
      requireLoginAfterExpired({
        type: 'comment',
        postId: post.id,
        body,
        parentCommentId: state.communityReplyToCommentId || null,
        feedbackId: state.creatorFeedbackReplyingId || ''
      });
      return setStatus('登录状态已过期，请重新登录后继续评论。', true);
    }
    setStatus(error.message, true);
  } finally {
    setCommunityActionPending('comment', post.id, false);
    if (button) button.disabled = false;
    if (state.communityDetailPost?.id === post.id) renderCommunityDetail();
  }
}

function downloadByUrl(url, filename) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'community-image';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function downloadBlobUrl(url, filename, { timeoutMs = 30000 } = {}) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  let objectUrl = '';
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal
    });
    const contentType = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!response.ok) {
      const payload = contentType === 'application/json' ? await response.json().catch(() => ({})) : {};
      throw new Error(payload.message || `下载请求失败 (${response.status})`);
    }
    if (!contentType.startsWith('image/')) throw new Error('下载接口没有返回图片文件。');
    const blob = await response.blob();
    if (!blob.size) throw new Error('图片文件为空。');
    objectUrl = URL.createObjectURL(blob);
    downloadByUrl(objectUrl, filename);
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('下载准备超时，请重试。');
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}

function communityDownloadPendingKey(postId, index = 0) {
  return `${postId}:${Number(index || 0)}`;
}

function isCommunityDownloadPending(postId, index = 0) {
  return state.communityDownloadPendingIds.includes(communityDownloadPendingKey(postId, index));
}

function communityActionKey(action, id = '') {
  return `${action}:${id}`;
}

function isCommunityActionPending(action, id = '') {
  return state.communityActionPendingKeys.includes(communityActionKey(action, id));
}

function setCommunityActionPending(action, id = '', pending = true) {
  const key = communityActionKey(action, id);
  state.communityActionPendingKeys = pending
    ? [...new Set([...state.communityActionPendingKeys, key])]
    : state.communityActionPendingKeys.filter((item) => item !== key);
}

async function refreshCommunityPostSummary(postId) {
  if (!postId) return;
  await loadCommunityPosts({ silent: true });
  const data = await api(`/api/community/posts/${encodeURIComponent(postId)}`);
  if (data.post) applyCommunityPostUpdate(data.post);
}

async function downloadCommunityPost(postId, index = 0) {
  let post = findCommunityPost(postId);
  if (!post) return;
  const key = communityDownloadPendingKey(post.id, index);
  if (state.communityDownloadPendingIds.includes(key)) return;
  const image = post.images?.[index] || post.images?.[0] || {};
  const extension = image.outputFormat === 'png' ? 'png' : image.outputFormat === 'webp' ? 'webp' : 'jpg';
  state.communityDownloadPendingIds = [...state.communityDownloadPendingIds, key];
  renderCommunityPanel();
  if (state.communityDetailPost?.id === post.id) renderCommunityDetail();
  setStatus('正在准备免费下载…');
  try {
    await downloadBlobUrl(`/api/community/posts/${encodeURIComponent(post.id)}/download/${index}`, `${post.title || 'community-image'}.${extension}`);
    setStatus('已免费下载。喜欢的话可以点赞、评论；参考创作只是可选延展。');
    if (!isOwnCommunityPost(post)) showCommunityDownloadNudge(post, index);
    window.setTimeout(() => refreshCommunityPostSummary(post.id).catch(() => {}), 1200);
  } catch (error) {
    hideCommunityDownloadNudge();
    setStatus(`下载没有开始：${error.message}`, true);
  } finally {
    state.communityDownloadPendingIds = state.communityDownloadPendingIds.filter((item) => item !== key);
    renderCommunityPanel();
    if (state.communityDetailPost?.id === post.id) renderCommunityDetail();
  }
}

async function likeCommunityPost(postId) {
  if (!state.user) {
    requireLoginForCommunity('like', postId);
    return setStatus('请先登录后再点赞。', true);
  }
  if (isCommunityActionPending('like', postId)) return;
  setCommunityActionPending('like', postId, true);
  renderCommunityPanel();
  if (state.communityDetailPost?.id === postId) renderCommunityDetail();
  try {
    const includeComments = state.communityDetailPost?.id === postId;
    const data = await api(`/api/community/posts/${encodeURIComponent(postId)}/like`, {
      method: 'POST',
      body: includeComments ? { includeComments: true } : undefined
    });
    if (data.post) applyCommunityPostUpdate(data.post);
    else renderCommunityPanel();
    setStatus(data.liked ? '已点赞。也可以留个评论，告诉作者你会怎么用。' : '已取消点赞。');
  } catch (error) {
    if (error.status === 401) {
      requireLoginAfterExpired({ type: 'like', postId });
      return setStatus('登录状态已过期，请重新登录后继续点赞。', true);
    }
    setStatus(error.message, true);
  } finally {
    setCommunityActionPending('like', postId, false);
    renderCommunityPanel();
    if (state.communityDetailPost?.id === postId) renderCommunityDetail();
  }
}

async function likeDownloadedCommunityPost() {
  const post = state.communityDownloadNudgePost;
  if (!post?.id) return;
  if (post.liked) return commentDownloadedCommunityPost();
  await likeCommunityPost(post.id);
  const updatedPost = findCommunityPost(post.id) || post;
  state.communityDownloadNudgePost = stripCommunityPrivateFields({ ...updatedPost, reuseImageIndex: post.reuseImageIndex || 0 }, { summary: true });
  syncCommunityDownloadNudgeActions(updatedPost);
}

async function commentDownloadedCommunityPost() {
  const post = state.communityDownloadNudgePost;
  if (!post?.id) return;
  hideCommunityDownloadNudge();
  await openCommunityDetail(post.id, { updateUrl: true });
  setTimeout(() => $('communityCommentInput')?.focus(), 60);
  setStatus('可以给作者留个评论，告诉作者你会怎么用这张图。');
}

function reuseDownloadedCommunityPost() {
  const post = state.communityDownloadNudgePost;
  if (!post?.id) return;
  if (post.canReuse === false) return setStatus('这个作品没有可复用提示词。', true);
  hideCommunityDownloadNudge();
  ensureCommunityPostPrompt(post.id)
    .then((detailPost) => openCommunityReuseModal(detailPost, { imageIndex: post.reuseImageIndex || 0 }))
    .catch((error) => setStatus(error.message, true));
}

async function tipCommunityPostOptional(postId) {
  let post = findCommunityPost(postId);
  if (!post) return;
  if (!state.user) {
    requireLoginForCommunity('tip', postId);
    return setStatus('请先登录后再自愿支持作者。', true);
  }
  if (isOwnCommunityPost(post)) return setStatus('自己的作品无需自愿支持。', true);
  openCommunityTipModal(post);
}

async function submitCommunityTip() {
  const post = state.communityTipPost;
  if (!post || state.communityTipPending) return;
  let amount;
  try {
    amount = parseSingularityToCents($('communityTipAmount')?.value || '', { label: '自愿支持金额' });
  } catch (error) {
    return setCommunityTipStatus(error.message, true);
  }
  if (!Number.isInteger(amount) || amount < 10) return setCommunityTipStatus('自愿支持金额至少 0.1 奇点。', true);
  if (state.user?.balanceCents < amount) {
    state.communityTipResume = { postId: post.id, amountCents: amount };
    setCommunityTipStatus('余额不足；下载不受影响，充值后仍需你再次确认是否自愿支持作者。', true);
    setStatus('余额不足；下载不受影响，充值后仍需你再次确认是否自愿支持作者。', true);
    closeCommunityTipModal();
    openRechargeModal({ reason: 'tip' });
    return;
  }
  state.communityTipPending = true;
  if ($('communityTipSubmitBtn')) $('communityTipSubmitBtn').disabled = true;
  setCommunityTipStatus('正在提交自愿支持…');
  try {
    const data = await api(`/api/community/posts/${encodeURIComponent(post.id)}/tip`, {
      method: 'POST',
      body: { amountCents: amount }
    });
    state.user = data.user || state.user;
    renderAccount();
    if (state.communityScope === 'mine') loadCreatorFeedback({ silent: true }).catch(() => {});
    if (data.post) {
      applyCommunityPostUpdate(data.post, { preserveCommunityRank: true });
    } else {
      await loadCommunityPosts({ silent: true });
      const detail = await api(`/api/community/posts/${encodeURIComponent(post.id)}`);
      if (detail.post) applyCommunityPostUpdate(detail.post, { preserveCommunityRank: true });
    }
    state.communityTipPending = false;
    closeCommunityTipModal();
    setStatus(`已自愿支持作者 ${yuan(amount)}。支持不会影响交流区排名，也不会解锁额外内容。`);
  } catch (error) {
    if (error.status === 401) {
      state.communityTipPending = false;
      const amountCents = amount;
      closeCommunityTipModal();
      requireLoginAfterExpired({ type: 'tip', postId: post.id, amountCents });
      setStatus('登录状态已过期，请重新登录后继续自愿支持作者。', true);
      return;
    }
    if (error.message.includes('余额不足')) {
      state.communityTipResume = { postId: post.id, amountCents: amount };
      state.communityTipPending = false;
      closeCommunityTipModal();
      openRechargeModal({ reason: 'tip' });
      return;
    }
    setCommunityTipStatus(error.message, true);
    setStatus(error.message, true);
  } finally {
    state.communityTipPending = false;
    if ($('communityTipSubmitBtn')) $('communityTipSubmitBtn').disabled = false;
  }
}

function handleCommunityClick(event) {
  const feedbackOpen = event.target.closest('[data-community-open-feedback]');
  if (feedbackOpen) {
    event.preventDefault();
    if (!state.user) {
      requireLoginForAction('communityScopeMine', { view: 'feedback' }, '登录后查看反馈收件箱。');
      return;
    }
    if (state.communityPostPublishSuccessId) state.communityPostPublishSuccessId = '';
    closeCommunityDetailModal();
    switchPanel('prompts');
    state.communityScope = 'mine';
    state.communityView = 'feedback';
    state.creatorFeedbackFilter = 'pending';
    state.creatorFeedbackPostFilterId = '';
    resetCommunityPagination();
    loadCommunityPosts();
    return;
  }

  const creatorCardAction = event.target.closest('[data-creator-card-action]');
  if (creatorCardAction) {
    event.preventDefault();
    runCreatorCardAction(creatorCardAction.dataset.postId, creatorCardAction.dataset.creatorCardAction);
    return;
  }

  const feedbackFilter = event.target.closest('[data-creator-feedback-filter]');
  if (feedbackFilter) {
    event.preventDefault();
    state.creatorFeedbackFilter = ['pending', 'all', 'reply', 'reported', 'handled'].includes(feedbackFilter.dataset.creatorFeedbackFilter)
      ? feedbackFilter.dataset.creatorFeedbackFilter
      : 'pending';
    renderCommunityPanel();
    return;
  }

  if (event.target.closest('[data-creator-feedback-clear-post]')) {
    event.preventDefault();
    state.creatorFeedbackPostFilterId = '';
    loadCreatorFeedback({ silent: true }).catch(() => {});
    renderCommunityPanel();
    setStatus('已显示全部反馈。');
    return;
  }

  const discoveryButton = event.target.closest('[data-community-discovery]');
  if (discoveryButton) {
    event.preventDefault();
    const nextFilter = communityDiscoveryFilterById(discoveryButton.dataset.communityDiscovery).id;
    if (nextFilter === 'liked' && !state.user) {
      requireLoginForAction('communityDiscoveryLiked', { discoveryFilter: 'liked' }, '登录后查看你点赞过的作品。');
      return;
    }
    state.communityDiscoveryFilter = nextFilter;
    resetCommunityPagination();
    loadCommunityPosts();
    return;
  }

  if (event.target.closest('[data-community-load-more]')) {
    event.preventDefault();
    loadMoreCommunityPosts();
    return;
  }

  if (event.target.closest('[data-community-clear-filters]')) {
    event.preventDefault();
    clearCommunityFilters();
    return;
  }

  const feedbackHandled = event.target.closest('[data-creator-feedback-toggle-handled]');
  if (feedbackHandled) {
    event.preventDefault();
    toggleCreatorFeedbackHandled(feedbackHandled.dataset.creatorFeedbackToggleHandled).catch((error) => setStatus(error.message, true));
    return;
  }

  const feedbackResolve = event.target.closest('[data-creator-feedback-resolve]');
  if (feedbackResolve) {
    event.preventDefault();
    resolveCreatorFeedbackReports(
      feedbackResolve.dataset.creatorFeedbackResolve,
      feedbackResolve.dataset.postId,
      feedbackResolve.dataset.feedbackId
    );
    return;
  }

  if (event.target.closest('[data-creator-feedback-refresh]')) {
    event.preventDefault();
    loadCreatorFeedback();
    return;
  }

  const feedbackReply = event.target.closest('[data-creator-feedback-reply]');
  if (feedbackReply) {
    event.preventDefault();
    state.creatorFeedbackReplyingId = feedbackReply.dataset.feedbackId || '';
    openCommunityDetailForFeedback(feedbackReply.dataset.postId, { replyTo: feedbackReply.dataset.creatorFeedbackReply }).catch((error) => {
      state.creatorFeedbackReplyingId = '';
      setStatus(error.message, true);
    });
    return;
  }

  const feedbackPin = event.target.closest('[data-creator-feedback-pin]');
  if (feedbackPin) {
    event.preventDefault();
    openCommunityDetailForFeedback(feedbackPin.dataset.postId, { updateUrl: false })
      .then(() => pinCommunityCommentById(feedbackPin.dataset.creatorFeedbackPin))
      .catch((error) => setStatus(error.message, true));
    return;
  }

  const feedbackUnpin = event.target.closest('[data-creator-feedback-unpin]');
  if (feedbackUnpin) {
    event.preventDefault();
    openCommunityDetailForFeedback(feedbackUnpin.dataset.creatorFeedbackUnpin, { updateUrl: false })
      .then(() => unpinCommunityCommentById())
      .catch((error) => setStatus(error.message, true));
    return;
  }

  const feedbackDelete = event.target.closest('[data-creator-feedback-delete]');
  if (feedbackDelete) {
    event.preventDefault();
    openCommunityDetailForFeedback(feedbackDelete.dataset.postId, { updateUrl: false })
      .then(() => deleteCommunityComment(feedbackDelete.dataset.creatorFeedbackDelete))
      .catch((error) => setStatus(error.message, true));
    return;
  }

  const viewButton = event.target.closest('[data-community-view]');
  if (viewButton) {
    event.preventDefault();
    if (!state.user) {
      requireLoginForAction('communityScopeMine', { view: viewButton.dataset.communityView }, '登录后查看反馈收件箱。');
      return;
    }
    state.communityScope = 'mine';
    state.communityView = viewButton.dataset.communityView === 'feedback' ? 'feedback' : 'posts';
    if (state.communityView === 'feedback') state.creatorFeedbackPostFilterId = '';
    resetCommunityPagination();
    loadCommunityPosts();
    return;
  }

  const sortButton = event.target.closest('[data-community-sort]');
  if (sortButton) {
    event.preventDefault();
    state.communitySort = sortButton.dataset.communitySort === 'latest' ? 'latest' : 'hot';
    resetCommunityPagination();
    loadCommunityPosts();
    return;
  }

  const scopeButton = event.target.closest('[data-community-scope]');
  if (scopeButton) {
    event.preventDefault();
    if (!state.user) {
      requireLoginForAction('communityScopeMine', {}, '登录后查看你上传到交流区的作品。');
      return;
    }
    state.communityScope = state.communityScope === 'mine' ? 'all' : 'mine';
    state.communityView = 'posts';
    state.creatorFeedbackPostFilterId = '';
    resetCommunityPagination();
    loadCommunityPosts();
    return;
  }

  const tagButton = event.target.closest('[data-community-tag]');
  if (tagButton) {
    event.preventDefault();
    state.communityActiveTag = tagButton.dataset.communityTag || '';
    resetCommunityPagination();
    loadCommunityPosts();
    return;
  }

  const openButton = event.target.closest('[data-community-open]');
  if (openButton) {
    event.preventDefault();
    openCommunityDetail(openButton.dataset.communityOpen, { updateUrl: true });
    return;
  }

  const reuseSourceOpenButton = event.target.closest('[data-community-reuse-source-open]');
  if (reuseSourceOpenButton) {
    event.preventDefault();
    openCommunityDetail(reuseSourceOpenButton.dataset.communityReuseSourceOpen, { updateUrl: true });
    return;
  }

  if (event.target.closest('[data-community-reuse-source-clear]')) {
    event.preventDefault();
    clearCommunityReuseSource('已清除参考来源，本次会作为普通生成。');
    return;
  }

  const viewPublishedButton = event.target.closest('[data-community-view-published]');
  if (viewPublishedButton) {
    event.preventDefault();
    if (state.communityPostPublishSuccessId === viewPublishedButton.dataset.communityViewPublished) {
      state.communityPostPublishSuccessId = '';
    }
    renderCommunityDetail();
    setStatus('已切换到作品详情，可以继续查看互动。');
    return;
  }

  const commentButton = event.target.closest('[data-community-comment]');
  if (commentButton) {
    event.preventDefault();
    openCommunityDetail(commentButton.dataset.communityComment, { updateUrl: true })
      .then(() => focusCommunityCommentBox())
      .catch((error) => setStatus(error.message, true));
    return;
  }

  const useButton = event.target.closest('[data-community-use]');
  if (useButton) {
    event.preventDefault();
    if (state.communityCommentFollowup?.postId === useButton.dataset.communityUse) state.communityCommentFollowup = null;
    ensureCommunityPostPrompt(useButton.dataset.communityUse)
      .then((post) => openCommunityReuseModal(post))
      .catch((error) => setStatus(error.message, true));
    return;
  }

  if (event.target.closest('[data-community-followup-dismiss]')) {
    event.preventDefault();
    clearCommunityCommentFollowup();
    return;
  }

  const downloadButton = event.target.closest('[data-community-download]');
  if (downloadButton) {
    event.preventDefault();
    downloadCommunityPost(downloadButton.dataset.communityDownload, Number(downloadButton.dataset.communityDownloadIndex || 0));
    return;
  }

  const publishImageButton = event.target.closest('[data-community-publish-image]');
  if (publishImageButton) {
    event.preventDefault();
    toggleCommunityPublishImage(publishImageButton.dataset.communityPublishImage);
    return;
  }

  const publishTemplateButton = event.target.closest('[data-community-publish-template]');
  if (publishTemplateButton) {
    event.preventDefault();
    applyCommunityPublishTemplate(publishTemplateButton.dataset.communityPublishTemplate);
    return;
  }

  const reuseIntentButton = event.target.closest('[data-community-reuse-intent]');
  if (reuseIntentButton) {
    event.preventDefault();
    state.communityReuseIntent = communityReuseIntentById(reuseIntentButton.dataset.communityReuseIntent).id;
    renderCommunityReuseModal();
    return;
  }
  const likeButton = event.target.closest('[data-community-like]');
  if (likeButton) {
    event.preventDefault();
    likeCommunityPost(likeButton.dataset.communityLike);
    return;
  }
  if (event.target.closest('[data-community-focus-comment]')) {
    event.preventDefault();
    focusCommunityCommentBox();
    return;
  }
  if (event.target.closest('[data-community-author-note]')) {
    event.preventDefault();
    focusCommunityAuthorNote();
    return;
  }
  const tipButton = event.target.closest('[data-community-tip]');
  if (tipButton) {
    event.preventDefault();
    tipCommunityPostOptional(tipButton.dataset.communityTip);
    return;
  }
  const shareButton = event.target.closest('[data-community-share]');
  if (shareButton) {
    event.preventDefault();
    shareCommunityPost(shareButton.dataset.communityShare)
      .then(() => setStatus('邀请文案已复制，可以直接发给朋友；热度排名只看点赞、评论和时间衰减。'))
      .catch((error) => setStatus(error.message, true));
    return;
  }
  const copyPromptButton = event.target.closest('[data-community-copy-prompt]');
  if (copyPromptButton) {
    event.preventDefault();
    copyCommunityPrompt(copyPromptButton.dataset.communityCopyPrompt);
    return;
  }
  const copyParamsButton = event.target.closest('[data-community-copy-params]');
  if (copyParamsButton) {
    event.preventDefault();
    copyCommunityParameters(copyParamsButton.dataset.communityCopyParams);
    return;
  }
  const seriesButton = event.target.closest('[data-community-series]');
  if (seriesButton) {
    event.preventDefault();
    if (state.communityPostPublishSuccessId === seriesButton.dataset.communitySeries) state.communityPostPublishSuccessId = '';
    continueCommunitySeries(seriesButton.dataset.communitySeries);
    return;
  }
  const editButton = event.target.closest('[data-community-edit]');
  if (editButton) {
    event.preventDefault();
    openCommunityEdit(editButton.dataset.communityEdit);
    return;
  }
  const deleteButton = event.target.closest('[data-community-delete]');
  if (deleteButton) {
    event.preventDefault();
    deleteCommunityPostById(deleteButton.dataset.communityDelete);
  }
}

async function openLinkedCommunityPost() {
  const postId = new URLSearchParams(window.location.search).get('post');
  if (!postId || panelFromPath() !== 'prompts') return;
  await openCommunityDetail(postId, { updateUrl: false });
}

function setCommunityPublishDialogMode(mode) {
  const isEdit = mode === 'edit';
  const isReuseCreate = mode === 'reuse';
  state.communityPublishMode = isEdit ? 'edit' : 'create';
  if ($('communityPublishTitle')) $('communityPublishTitle').textContent = isEdit ? '编辑作品资料' : (isReuseCreate ? '发布我的版本' : '上传作品到交流区');
  if ($('communityPublishIntro')) {
    $('communityPublishIntro').textContent = isEdit
      ? '修改标题、介绍和标签；免费下载和已产生的互动记录不会受影响。'
      : isReuseCreate
        ? '把这次参考创作结果发布回交流区，保留来源作品信息，方便别人对比和评论。'
        : '选择要公开的图片，写清用途和想听的建议；发布后可邀请朋友点赞、评论。';
  }
  if ($('communityPublishSubmitBtn')) $('communityPublishSubmitBtn').textContent = isEdit ? '保存修改' : (isReuseCreate ? '发布我的版本' : '上传到交流区');
}

function renderCommunityPublishPreview(source, imageIndex = 0) {
  const node = $('communityPublishPreview');
  if (!node) return;
  const isEdit = state.communityPublishMode === 'edit';
  const entries = imageEntries(source);
  if (!entries.length) {
    node.innerHTML = '<p class="feature-empty">作品没有可发布的图片。</p>';
    return;
  }
  if (!isEdit) {
    state.communityPublishImageIndexes = normalizeImageIndexSelection(state.communityPublishImageIndexes, entries, imageIndex);
    if (state.communityPublishGeneration) state.communityPublishGeneration.selectedImageIndexes = [...state.communityPublishImageIndexes];
  }
  const selectedIndexes = isEdit
    ? entries.map((entry) => entry.index)
    : state.communityPublishImageIndexes;
  const selectedSet = new Set(selectedIndexes);
  const firstSelectedIndex = selectedIndexes[0] ?? entries[0].index;
  const selectedEntry = entries.find((entry) => entry.index === firstSelectedIndex) || entries[0];
  const previewImage = selectedEntry.src;
  const prompt = String(source?.prompt || '').trim();
  const promptText = prompt.length > 180 ? `${prompt.slice(0, 180)}...` : (prompt || '这条作品没有提示词。');
  const reuseSource = !isEdit && source?.reuseSourcePost?.id ? source.reuseSourcePost : null;
  const selectedImage = selectedEntry.image || {};
  const meta = [
    source?.mode === 'edit' ? '图生图' : '文生图',
    qualityLabel(selectedImage.quality || source?.quality || state.quality),
    sizeLabelText(selectedImage.size || source?.size || state.size),
    isEdit ? `${entries.length} 张` : `已选择 ${selectedIndexes.length} / ${entries.length} 张`
  ].filter(Boolean).join(' · ');
  const selector = !isEdit && entries.length > 1 ? `
    <div class="community-publish-selector">
      <div>
        <strong>选择公开图片</strong>
        <span>${selectedIndexes.length ? `已选择 ${selectedIndexes.length} / ${entries.length} 张` : '请至少选择 1 张图片'}</span>
      </div>
      <div class="community-publish-thumbs">
        ${entries.map((entry, order) => {
          const selected = selectedSet.has(entry.index);
          return `
            <button class="community-publish-thumb ${selected ? 'selected' : ''}" type="button" data-community-publish-image="${entry.index}" aria-pressed="${selected ? 'true' : 'false'}">
              <img src="${escapeHtml(entry.src)}" alt="第 ${order + 1} 张候选图片" />
              <span>${selected ? '已选' : '选择'} · 第 ${order + 1} 张</span>
            </button>
          `;
        }).join('')}
      </div>
    </div>
  ` : '';
  node.innerHTML = `
    <div class="community-publish-preview-media">
      ${previewImage ? `<img src="${escapeHtml(previewImage)}" alt="将公开展示的作品预览" />` : '<span>暂无预览</span>'}
    </div>
    <div class="community-publish-preview-copy">
      <strong>${isEdit ? '当前公开内容' : '上传后公开内容'}</strong>
      <small>${escapeHtml(meta)}</small>
      ${reuseSource ? `<div class="community-publish-source"><span>参考来源</span><strong>《${escapeHtml(reuseSource.title || '交流区作品')}》</strong></div>` : ''}
      <p>${escapeHtml(promptText)}</p>
      <ul class="community-publish-checklist">
        <li><span>1</span>${entries.length > 1 && !isEdit ? '确认要公开的图片；同批多张会合并成一个作品集。' : '确认预览图、标题、介绍和标签会公开展示。'}</li>
        <li><span>2</span>介绍写清用途和想听哪处建议，方便别人留下具体评论。</li>
        <li><span>3</span>发布后复制邀请文案，请朋友点赞、评论；下载免费，自愿支持不影响排名。</li>
      </ul>
      ${selector}
    </div>
  `;
  syncCommunityPublishSubmitState();
}

function syncCommunityPublishSubmitState() {
  const button = $('communityPublishSubmitBtn');
  if (!button) return;
  if (state.communityPublishPending) {
    button.disabled = true;
    return;
  }
  if (state.communityPublishMode === 'edit') {
    button.disabled = false;
    return;
  }
  button.disabled = state.communityPublishImageIndexes.length < 1;
}

function openCommunityPublish(item, imageIndex = 0, options = {}) {
  if (!state.user) {
    return requireLoginForAction('publish', { generation: item, imageIndex, defaultAll: Boolean(options.defaultAll) }, '请先登录后再发布作品。');
  }
  if (!item?.id || item.status === 'failed') return setStatus('只能发布生成成功的作品。', true);
  const entries = imageEntries(item);
  if (!entries.length) return setStatus('作品没有可发布的图片。', true);
  setCommunityPublishDialogMode(item.reuseSourcePost?.id ? 'reuse' : 'create');
  if ($('communityPublishIntro') && item.reuseSourcePost?.id) {
    $('communityPublishIntro').textContent = `这是基于《${item.reuseSourcePost.title || '交流区作品'}》生成的新版本；发布后可邀请朋友对比来源作品、点赞并留下建议。`;
  }
  const selectedImageIndex = entries.some((entry) => entry.index === Math.trunc(Number(imageIndex || 0)))
    ? Math.trunc(Number(imageIndex || 0))
    : entries[0].index;
  state.communityPublishImageIndexes = options.defaultAll && entries.length > 1
    ? entries.map((entry) => entry.index)
    : normalizeImageIndexSelection([selectedImageIndex], entries, selectedImageIndex);
  state.communityPublishGeneration = { ...item, selectedImageIndex, selectedImageIndexes: [...state.communityPublishImageIndexes] };
  state.communityEditingPost = null;
  const draft = communityPublishDraft(item);
  const sourceTitle = String(item.reuseSourcePost?.title || '交流区作品').trim();
  $('communityPostTitle').value = item.reuseSourcePost?.id
    ? `${sourceTitle.slice(0, 18)}的我的版本`.slice(0, 28)
    : draft.title;
  $('communityPostDescription').value = item.reuseSourcePost?.id
    ? `这是基于《${item.reuseSourcePost.title || '交流区作品'}》生成的新版本，欢迎评论给改进建议。`
    : draft.description;
  $('communityPostTags').value = draft.tags.join(', ');
  renderCommunityPublishPreview(item, selectedImageIndex);
  setInlineStatus('communityPublishStatus', item.reuseSourcePost?.id
    ? '已识别为参考延展版本。发布后可邀请朋友对比来源作品、点赞并留下建议。'
    : entries.length > 1
      ? '已自动填写资料；继续勾选同批图片，发布后可邀请朋友点赞、评论。'
      : '已自动填写资料；发布后可复制邀请文案，请朋友点赞、评论。');
  $('communityPublishModal').classList.add('open');
  $('communityPublishModal').setAttribute('aria-hidden', 'false');
  syncModalState();
  setTimeout(() => $('communityPostTitle')?.focus(), 30);
}

function openCommunityEdit(postId) {
  const post = findCommunityPost(postId);
  if (!post) return setStatus('作品不存在，无法编辑。', true);
  if (!state.user || (state.user.role !== 'admin' && !isOwnCommunityPost(post))) {
    return setStatus('没有权限编辑这个作品。', true);
  }
  setCommunityPublishDialogMode('edit');
  state.communityPublishGeneration = null;
  state.communityPublishImageIndexes = [];
  state.communityEditingPost = post;
  $('communityPostTitle').value = post.title || '';
  $('communityPostDescription').value = post.description || '';
  $('communityPostTags').value = (post.tags || []).join(', ');
  renderCommunityPublishPreview(post);
  setInlineStatus('communityPublishStatus', '你可以更新作品资料；下载依然免费，自愿支持由对方自己选择，不影响排名。');
  $('communityPublishModal').classList.add('open');
  $('communityPublishModal').setAttribute('aria-hidden', 'false');
  syncModalState();
  setTimeout(() => $('communityPostTitle')?.focus(), 30);
}

function closeCommunityPublishModal() {
  $('communityPublishModal')?.classList.remove('open');
  $('communityPublishModal')?.setAttribute('aria-hidden', 'true');
  state.communityEditingPost = null;
  state.communityPublishMode = 'create';
  state.communityPublishPending = false;
  state.communityPublishImageIndexes = [];
  setCommunityPublishDialogMode('create');
  if ($('communityPublishPreview')) $('communityPublishPreview').innerHTML = '';
  syncCommunityPublishSubmitState();
  syncModalState();
}

function communityPublishFormDraft() {
  return {
    title: $('communityPostTitle')?.value.trim() || '',
    description: $('communityPostDescription')?.value.trim() || '',
    tagsText: $('communityPostTags')?.value || '',
    imageIndexes: [...state.communityPublishImageIndexes]
  };
}

function validateCommunityPublishDraft() {
  const title = $('communityPostTitle')?.value.trim() || '';
  const description = $('communityPostDescription')?.value.trim() || '';
  const tags = parseTags($('communityPostTags')?.value || '');
  if (!title) throw new Error('请输入作品标题。');
  if (title.length > 60) throw new Error('标题不能超过 60 个字。');
  if (description.length > 300) throw new Error('介绍不能超过 300 个字。');
  if (tags.length > 8) throw new Error('标签最多 8 个。');
  return {
    title,
    description,
    tags
  };
}

function applyCommunityPublishFormDraft(draft = {}) {
  if ($('communityPostTitle') && draft.title !== undefined) $('communityPostTitle').value = draft.title;
  if ($('communityPostDescription') && draft.description !== undefined) $('communityPostDescription').value = draft.description;
  if ($('communityPostTags') && draft.tagsText !== undefined) $('communityPostTags').value = draft.tagsText;
  if (Array.isArray(draft.imageIndexes) && state.communityPublishMode === 'create') {
    const entries = imageEntries(state.communityPublishGeneration);
    state.communityPublishImageIndexes = normalizeImageIndexSelection(draft.imageIndexes, entries, draft.imageIndexes[0] || 0);
    if (state.communityPublishGeneration) state.communityPublishGeneration.selectedImageIndexes = [...state.communityPublishImageIndexes];
    renderCommunityPublishPreview(state.communityPublishGeneration, draft.imageIndexes[0] || 0);
  }
}

function communityPublishTemplateText(templateId) {
  if (templateId === 'revision') return '我想把它用于：\n希望大家帮我看：构图、颜色和细节哪里还可以改。\n最想听哪一处建议：如果只改一处，你会先改哪里？';
  if (templateId === 'commercial') return '我想把它用于：商业海报或产品宣传参考。\n希望大家帮我看：标题留白、主体突出程度和画面高级感。\n最想听哪一处建议：这张图适合投放在哪类场景？';
  return '我想把它用于：\n希望大家帮我看：这张图更适合做头像、海报、封面还是配图。\n最想听哪一处建议：你会怎么使用这张图？';
}

function applyCommunityPublishTemplate(templateId) {
  const input = $('communityPostDescription');
  if (!input) return;
  const template = communityPublishTemplateText(templateId);
  input.value = template.slice(0, Number(input.maxLength || 300));
  input.focus();
  setInlineStatus('communityPublishStatus', '已填入介绍模板，你可以继续按作品实际用途微调。');
}

function toggleCommunityPublishImage(index) {
  if (state.communityPublishMode !== 'create' || !state.communityPublishGeneration) return;
  const entries = imageEntries(state.communityPublishGeneration);
  const selectedIndex = Math.trunc(Number(index));
  if (!entries.some((entry) => entry.index === selectedIndex)) return;
  const current = [...state.communityPublishImageIndexes];
  const existing = current.indexOf(selectedIndex);
  if (existing >= 0) current.splice(existing, 1);
  else current.push(selectedIndex);
  state.communityPublishImageIndexes = current;
  state.communityPublishGeneration.selectedImageIndexes = [...current];
  renderCommunityPublishPreview(state.communityPublishGeneration, current[0] ?? selectedIndex);
  setInlineStatus('communityPublishStatus', current.length ? `已选择 ${current.length} 张图片，会作为同一个作品公开。` : '请至少选择 1 张图片。', current.length < 1);
}

function mergeCommunityPostForState(nextPost, previousPost) {
  if (!nextPost?.id) return nextPost;
  const mergedPost = { ...nextPost };
  if (!String(mergedPost.prompt || '').trim() && String(previousPost?.prompt || '').trim()) {
    mergedPost.prompt = previousPost.prompt;
  }
  ['tipCents', 'tipTotalCents', 'hasTipped', 'pinnedCommentId', 'generationId'].forEach((key) => {
    const shouldPreservePrivateField = canKeepCommunityPrivateFields(previousPost)
      || state.user?.role === 'admin';
    if (shouldPreservePrivateField && !Object.prototype.hasOwnProperty.call(mergedPost, key) && Object.prototype.hasOwnProperty.call(previousPost || {}, key)) {
      mergedPost[key] = previousPost[key];
    }
  });
  return mergedPost;
}

function mergeCommunityPostForViewer(nextPost, previousPost, options = {}) {
  return stripCommunityPrivateFields(mergeCommunityPostForState(nextPost, previousPost), options);
}

function preserveCommunityRankFields(nextPost, previousPost) {
  if (!nextPost?.id || !previousPost?.id) return nextPost;
  return {
    ...nextPost,
    hotScore: previousPost.hotScore,
    likeCount: previousPost.likeCount,
    commentCount: previousPost.commentCount,
    reuseCount: previousPost.reuseCount,
    downloadCount: previousPost.downloadCount,
    createdAt: previousPost.createdAt
  };
}

function applyCommunityPostUpdate(post, options = {}) {
  if (!post?.id) return;
  const normalizedPost = normalizeCommunityPostForDisplay(post);
  const historyPost = state.historyItems.find((entry) => entry.communityPostId === normalizedPost.id)?.communityPost;
  const previewPost = state.previewItem?.communityPostId === normalizedPost.id ? state.previewItem.communityPost : null;
  const existingPost = state.communityDetailPost?.id === normalizedPost.id
    ? state.communityDetailPost
    : state.communityPosts.find((entry) => entry.id === normalizedPost.id) || historyPost || previewPost;
  const postForMerge = options.preserveCommunityRank ? preserveCommunityRankFields(normalizedPost, existingPost) : normalizedPost;
  const mergedPost = mergeCommunityPostForViewer(postForMerge, existingPost, { summary: false });
  const mergedSummaryPost = normalizeCommunityPostForDisplay(stripCommunityPrivateFields(mergedPost, { summary: true }));
  state.communityPosts = state.communityPosts.map((entry) => entry.id === mergedPost.id ? normalizeCommunityPostForDisplay(mergeCommunityPostForViewer(mergedSummaryPost, entry, { summary: true })) : entry);
  if (!state.communityPosts.some((entry) => entry.id === mergedPost.id)) state.communityPosts = [mergedSummaryPost, ...state.communityPosts];
  clearCommunityCardCache();
  if (state.communityDetailPost?.id === mergedPost.id) state.communityDetailPost = mergeCommunityPostForViewer(mergedPost, state.communityDetailPost, { summary: false });
  state.historyItems = state.historyItems.map((entry) => (
    entry.communityPostId === mergedPost.id
      ? { ...entry, communityPost: normalizeCommunityPostForDisplay(mergeCommunityPostForViewer(mergedSummaryPost, entry.communityPost, { summary: true })) }
      : entry
  ));
  if (state.previewItem?.communityPostId === normalizedPost.id) {
    state.previewItem = { ...state.previewItem, communityPost: normalizeCommunityPostForDisplay(mergeCommunityPostForViewer(mergedSummaryPost, state.previewItem.communityPost, { summary: true })) };
    renderGeneratedImages(state.previewItem);
  }
  renderHistoryList();
  renderCommunityPanel();
  if (state.communityDetailPost?.id === normalizedPost.id) renderCommunityDetail();
}

async function submitCommunityEdit() {
  if (state.communityPublishPending) return;
  const post = state.communityEditingPost;
  if (!post?.id) return;
  const button = $('communityPublishSubmitBtn');
  let draft;
  try {
    draft = validateCommunityPublishDraft();
  } catch (error) {
    setInlineStatus('communityPublishStatus', error.message, true);
    return;
  }
  state.communityPublishPending = true;
  if (button) button.disabled = true;
  setInlineStatus('communityPublishStatus', '正在保存…');
  try {
    const data = await api(`/api/community/posts/${encodeURIComponent(post.id)}`, {
      method: 'PATCH',
      body: {
        title: draft.title,
        description: draft.description,
        tags: draft.tags
      }
    });
    closeCommunityPublishModal();
    if (data.post) applyCommunityPostUpdate(data.post);
    setStatus('作品资料已更新。');
  } catch (error) {
    if (error.status === 401) {
      requireLoginAfterExpired({ type: 'editCommunity', postId: post.id, draft: communityPublishFormDraft() });
      return setInlineStatus('communityPublishStatus', '登录状态已过期，请重新登录后继续编辑。', true);
    }
    setInlineStatus('communityPublishStatus', error.message, true);
  } finally {
    state.communityPublishPending = false;
    syncCommunityPublishSubmitState();
  }
}

async function submitCommunityPublish() {
  if (state.communityPublishPending) return;
  if (state.communityPublishMode === 'edit') return submitCommunityEdit();
  const item = state.communityPublishGeneration;
  if (!item?.id) return;
  const button = $('communityPublishSubmitBtn');
  let draft;
  try {
    draft = validateCommunityPublishDraft();
    if (!state.communityPublishImageIndexes.length) throw new Error('请至少选择 1 张图片。');
  } catch (error) {
    setInlineStatus('communityPublishStatus', error.message, true);
    return;
  }
  state.communityPublishPending = true;
  if (button) button.disabled = true;
  setInlineStatus('communityPublishStatus', '正在发布…');
  try {
    const data = await api('/api/community/posts', {
      method: 'POST',
      body: {
        generationId: item.id,
        imageIndex: Number(state.communityPublishImageIndexes[0] ?? item.selectedImageIndex ?? 0),
        imageIndexes: state.communityPublishImageIndexes,
        title: draft.title,
        description: draft.description,
        tags: draft.tags
      }
    });
    if (state.previewItem?.id === item.id) {
      state.previewItem = { ...state.previewItem, communityPostId: data.post.id, communityPost: data.post };
      renderGeneratedImages(state.previewItem);
    }
    state.historyItems = state.historyItems.map((entry) => entry.id === item.id ? { ...entry, communityPostId: data.post.id, communityPost: data.post } : entry);
    renderHistoryList();
    closeCommunityPublishModal();
    loadHistory().catch(() => {});
    await loadCommunityPosts({ silent: true });
    state.communityPostPublishSuccessId = data.post.id;
    switchPanel('prompts');
    await openCommunityDetail(data.post.id);
    setStatus(item.reuseSourcePost?.id
      ? '我的版本已发布到交流区，可以查看来源作品或邀请朋友对比评论。'
      : '作品已发布到交流区，可以复制邀请文案邀请点赞评论。');
  } catch (error) {
    if (error.status === 401) {
      requireLoginAfterExpired({ type: 'publish', generation: item, imageIndex: state.communityPublishImageIndexes[0] ?? item.selectedImageIndex ?? 0, imageIndexes: state.communityPublishImageIndexes, draft: communityPublishFormDraft() });
      return setInlineStatus('communityPublishStatus', '登录状态已过期，请重新登录后继续发布。', true);
    }
    if (error.payload?.code === 'already_published' && error.payload.post) {
      closeCommunityPublishModal();
      const post = error.payload.post;
      applyCommunityPostUpdate(post);
      const summaryPost = stripCommunityPrivateFields(post, { summary: true });
      state.historyItems = state.historyItems.map((entry) => entry.id === item.id ? { ...entry, communityPostId: post.id, communityPost: mergeCommunityPostForViewer(summaryPost, entry.communityPost, { summary: true }) } : entry);
      if (state.previewItem?.id === item.id) {
        state.previewItem = { ...state.previewItem, communityPostId: post.id, communityPost: mergeCommunityPostForViewer(summaryPost, state.previewItem.communityPost, { summary: true }) };
        renderGeneratedImages(state.previewItem);
      }
      renderHistoryList();
      loadHistory().catch(() => {});
      await openCommunityDetail(post.id, { updateUrl: true });
      return setStatus('这张作品已经发布过，已为你打开交流区作品。');
    }
    setInlineStatus('communityPublishStatus', error.message, true);
  } finally {
    state.communityPublishPending = false;
    syncCommunityPublishSubmitState();
  }
}

function renderSettingsPanel({ force = false } = {}) {
  if (!force && state.activePanel !== 'settings') return;
  if ($('settingsAccountName')) $('settingsAccountName').textContent = state.user?.username || '未登录';
  if ($('settingsAccountMeta')) $('settingsAccountMeta').textContent = state.user ? `账号 ${state.user.account || state.user.username}` : '登录后查看账号信息。';
  if ($('settingsBalance')) $('settingsBalance').textContent = yuan(state.user?.balanceCents || 0);
}

const railAuthIcon = (label, path) => `
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>
  <span class="rail-label">${label}</span>
`;

function openAuthModal(options = {}) {
  setAuthStatus('');
  setAuthMode('login');
  const reasonText = {
    generate: '登录后继续生成，并保存历史记录。',
    publish: '登录后继续上传到交流区。',
    comment: '登录后继续评论这张作品。',
    like: '登录后继续点赞这张作品。',
    tip: '登录后继续自愿支持作者。',
    download: '登录后继续下载；交流区图片仍然免费下载。'
  }[options.reason];
  if (reasonText) $('authIntro').textContent = reasonText;
  $('authModal').classList.add('open');
  $('authModal').setAttribute('aria-hidden', 'false');
  syncModalState();
  setTimeout(() => $('account').focus(), 30);
}

function closeAuthModal(options = {}) {
  if (options.clearPending !== false) state.pendingAuthAction = null;
  $('authModal').classList.remove('open');
  $('authModal').setAttribute('aria-hidden', 'true');
  syncModalState();
}

function setAuthMode(mode) {
  state.authMode = mode === 'register' ? 'register' : 'login';
  const isRegister = state.authMode === 'register';
  $('authTitle').textContent = isRegister ? '注册账号' : '登录';
  $('authIntro').textContent = isRegister ? '注册需要填写用户名、账号和密码。' : '登录后展示用户名和钱包余额。';
  $('displayNameField').classList.toggle('visible', isRegister);
  $('loginBtn').textContent = isRegister ? '返回登录' : '登录';
  $('registerBtn').textContent = isRegister ? '提交注册' : '注册账号';
  $('password').setAttribute('autocomplete', isRegister ? 'new-password' : 'current-password');
  if (!isRegister) $('displayName').value = '';
  setAuthStatus('');
}

function openRechargeModal(options = {}) {
  if (!state.user) {
    openAuthModal();
    return setStatus('请先登录后再充值。', true);
  }
  renderRechargeModal(options);
  $('rechargeModal').classList.add('open');
  $('rechargeModal').setAttribute('aria-hidden', 'false');
  syncModalState();
  setTimeout(() => $('redeemCodeInput')?.focus(), 30);
}

function closeRechargeModal() {
  state.communityTipResume = null;
  $('rechargeModal').classList.remove('open');
  $('rechargeModal').setAttribute('aria-hidden', 'true');
  syncModalState();
}

function openAccountModal() {
  renderAccount();
  $('accountModal').classList.add('open');
  $('accountModal').setAttribute('aria-hidden', 'false');
  syncModalState();
}

function closeAccountModal() {
  $('accountModal').classList.remove('open');
  $('accountModal').setAttribute('aria-hidden', 'true');
  syncModalState();
}

function openAccountOrAuth() {
  if (state.user) {
    openAccountModal();
  } else {
    openAuthModal();
  }
}

function syncModalState() {
  const hasOpenModal = Boolean(document.querySelector('.modal-backdrop.open, .selection-modal.open, .original-viewer.open'));
  document.body.classList.toggle('modal-open', hasOpenModal);
}

function renderRechargeModal(options = {}) {
  const isAdmin = state.user?.role === 'admin';
  const resumeTip = state.communityTipResume;
  document.querySelector('.recharge-dialog')?.classList.toggle('user-recharge', !isAdmin);
  $('rechargeIntro').textContent = isAdmin
    ? '管理员可生成兑换码，也可以直接测试兑换。'
    : resumeTip
      ? `你刚才选择的自愿支持金额超过当前余额；下载不受影响，兑换后会回到 ${yuan(resumeTip.amountCents)} 确认弹窗。`
      : '购买兑换码后回到这里输入，余额会自动到账。';
  $('rechargeNote').textContent = isAdmin
    ? `已选择 ${yuan(state.rechargeAmount * 100)}，可生成一个新兑换码。`
    : options.reason === 'tip' && resumeTip
      ? '下载不受影响；充值不会自动支持作者，兑换后仍需再次确认。'
      : '请先点击购买兑换码，拿到兑换码后填入下方输入框。';
  const rechargeGrid = document.querySelector('.recharge-grid');
  if (rechargeGrid) {
    rechargeGrid.style.display = isAdmin ? 'grid' : 'none';
    rechargeGrid.setAttribute('aria-hidden', String(!isAdmin));
  }
  const purchaseLink = $('purchaseCodeLink');
  const purchaseHelper = $('purchaseHelper');
  if (purchaseLink) {
    purchaseLink.style.display = isAdmin ? 'none' : 'flex';
    purchaseLink.setAttribute('aria-hidden', String(isAdmin));
  }
  if (purchaseHelper) {
    purchaseHelper.style.display = isAdmin ? 'none' : 'block';
    purchaseHelper.setAttribute('aria-hidden', String(isAdmin));
  }
  $('adminCreateCodeBtn').style.display = isAdmin ? 'inline-flex' : 'none';
  document.querySelectorAll('.recharge-plan').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.amount) === state.rechargeAmount);
    button.disabled = !isAdmin;
    button.title = isAdmin ? '选择生成兑换码金额' : '普通用户请通过购买链接购买兑换码';
  });
}

async function redeemCurrentCode() {
  if (state.redeemPending) return;
  const code = $('redeemCodeInput').value.trim();
  if (!code) {
    $('rechargeNote').textContent = '请输入兑换码。';
    $('rechargeNote').classList.add('error-text');
    return;
  }
  state.redeemPending = true;
  $('redeemCodeBtn').disabled = true;
  $('rechargeNote').classList.remove('error-text');
  $('rechargeNote').textContent = '正在兑换…';
  try {
    const data = await api('/api/redeem', {
      method: 'POST',
      body: { code }
    });
    state.user = data.user;
    $('redeemCodeInput').value = '';
    $('rechargeNote').textContent = `兑换成功，到账 ${yuan(data.amountCents)}。`;
    setStatus(`兑换成功，当前余额 ${yuan(state.user.balanceCents)}。`);
    await renderAll();
    await resumeCommunityTipAfterRecharge();
  } catch (error) {
    $('rechargeNote').textContent = error.message;
    $('rechargeNote').classList.add('error-text');
  } finally {
    state.redeemPending = false;
    $('redeemCodeBtn').disabled = false;
  }
}

async function resumeCommunityTipAfterRecharge() {
  const resume = state.communityTipResume;
  if (!resume?.postId) return;
  const amountSingularity = Math.max(0.1, Number(resume.amountCents || 0) / 100);
  state.communityTipResume = null;
  $('rechargeModal')?.classList.remove('open');
  $('rechargeModal')?.setAttribute('aria-hidden', 'true');
  syncModalState();
  try {
    let post = findCommunityPost(resume.postId);
    if (!post) {
      const data = await api(`/api/community/posts/${encodeURIComponent(resume.postId)}`);
      post = data.post;
      if (post) state.communityDetailPost = post;
    }
    if (!post) return setStatus('充值成功，但原作品暂时找不到了。', true);
    openCommunityTipModal(post);
    if ($('communityTipAmount')) $('communityTipAmount').value = String(amountSingularity);
    setCommunityTipStatus('余额已到账，请再次确认是否自愿支持作者。');
  } catch (error) {
    setStatus(`充值成功，但恢复自愿支持失败：${error.message}`, true);
  }
}

async function createAdminRedeemCode() {
  $('adminCreateCodeBtn').disabled = true;
  $('rechargeNote').classList.remove('error-text');
  $('rechargeNote').textContent = '正在生成兑换码…';
  try {
    const data = await api('/api/admin/redeem-codes', {
      method: 'POST',
      body: { amountSingularity: state.rechargeAmount }
    });
    $('redeemCodeInput').value = data.redeemCode.code;
    $('rechargeNote').textContent = `已生成 ${yuan(data.redeemCode.amountCents)} 兑换码：${data.redeemCode.code}`;
  } catch (error) {
    $('rechargeNote').textContent = error.message;
    $('rechargeNote').classList.add('error-text');
  } finally {
    $('adminCreateCodeBtn').disabled = false;
  }
}

function renderAccount() {
  const navBalance = $('navBalance');
  const sideBalance = $('sideBalance');
  const sideLoginBtn = $('sideLoginBtn');
  const headerAccountBtn = $('headerAccountBtn');
  const accountTitle = $('accountTitle');
  const accountIntro = $('accountIntro');
  const accountLoginBtn = $('accountLoginBtn');
  const accountRechargeBtn = $('accountRechargeBtn');
  const accountLogoutBtn = $('accountLogoutBtn');
  if (!state.user) {
    if (navBalance) navBalance.textContent = '登录后查看余额';
    if (sideBalance) sideBalance.textContent = '未登录';
    if (headerAccountBtn) {
      headerAccountBtn.textContent = '登录 / 注册';
      headerAccountBtn.title = '登录 / 注册';
    }
    if (accountTitle) accountTitle.textContent = '登录 / 注册';
    if (accountIntro) accountIntro.textContent = '登录后展示用户名和钱包余额。';
    if (accountLoginBtn) accountLoginBtn.style.display = 'inline-flex';
    if (accountRechargeBtn) accountRechargeBtn.style.display = 'none';
    if (accountLogoutBtn) accountLogoutBtn.style.display = 'none';
    if (sideLoginBtn) {
      sideLoginBtn.innerHTML = railAuthIcon('登录', 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3');
      sideLoginBtn.setAttribute('aria-label', '登录 / 注册');
      sideLoginBtn.title = '登录 / 注册';
      sideLoginBtn.onclick = openAuthModal;
    }
    syncAdminVisibility();
    syncPanelVisibility();
    renderAdminConsole();
    return;
  }
  if (navBalance) navBalance.textContent = yuan(state.user.balanceCents);
  if (sideBalance) sideBalance.textContent = yuan(state.user.balanceCents);
  if (headerAccountBtn) {
    headerAccountBtn.textContent = state.user.username;
    headerAccountBtn.title = `当前用户：${state.user.username}`;
  }
  if (accountTitle) accountTitle.textContent = state.user.username;
  if (accountIntro) accountIntro.textContent = `账号 ${state.user.account || state.user.username}`;
  if (accountLoginBtn) accountLoginBtn.style.display = 'none';
  if (accountRechargeBtn) accountRechargeBtn.style.display = 'inline-flex';
  if (accountLogoutBtn) accountLogoutBtn.style.display = 'inline-flex';
  if (sideLoginBtn) {
    sideLoginBtn.innerHTML = railAuthIcon(state.user.username, 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10');
    sideLoginBtn.setAttribute('aria-label', '账户');
    sideLoginBtn.title = state.user.username;
    sideLoginBtn.onclick = openAccountModal;
  }
  syncAdminVisibility();
  syncPanelVisibility();
  renderAdminConsole();
}

function renderPrice() {
  const text = selectedPriceText();
  const node = $('priceHint');
  if (node) {
    node.textContent = selectedPriceCompactText();
    node.title = text;
  }
  if ($('walletChipBtn')) $('walletChipBtn').textContent = '';
  renderSpecLabels();
  document.querySelectorAll('[data-size]').forEach((button) => {
    button.classList.toggle('active', button.dataset.size === state.size);
  });
  document.querySelectorAll('[data-quality]').forEach((button) => {
    button.classList.toggle('active', button.dataset.quality === state.quality);
  });
  document.querySelectorAll('[data-format]').forEach((button) => {
    button.classList.toggle('active', button.dataset.format === state.outputFormat);
  });
  document.querySelectorAll('[data-count]').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.count) === state.count);
  });
  syncPreviewMeta();
}

function resetComposer() {
  preferredStudioRoute = '/image/workspace';
  switchPanel('studio', { path: '/image/workspace' });
  normalizeHistoryLayoutState();
  state.prompts = { generate: '', edit: '' };
  clearCommunityReuseSource();
  $('prompt').value = '';
  clearReferenceImage();
  renderReferencePreview();
  setMode('generate');
  renderPreviewEmpty();
  $('preview').classList.remove('has-result');
  setStatus('');
  syncPreviewMeta();
  updateComposerPromptState();
  cueComposerFocus({ focusPrompt: true });
}

function updatePromptCount() {
  const prompt = $('prompt');
  const counter = $('promptCount');
  if (!prompt || !counter) return;
  counter.textContent = `${prompt.value.length} / ${prompt.maxLength || 1000}`;
  updateComposerPromptState();
}

async function optimizeCurrentPrompt() {
  if (state.optimizePending) return;
  if (!state.user) {
    openAuthModal();
    return setStatus('请先登录后再优化提示词。', true);
  }

  const prompt = $('prompt').value.trim();
  if (prompt.length < 2) return setStatus('请输入需要优化的提示词。', true);

  state.optimizePending = true;
  $('optimizePromptBtn').disabled = true;
  $('optimizePromptBtn').textContent = '优化中…';
  setStatus('正在优化提示词…');
  try {
    const data = await api('/api/optimize-prompt', {
      method: 'POST',
      body: { prompt, mode: state.mode }
    });
    $('prompt').value = String(data.optimizedPrompt || prompt).slice(0, Number($('prompt').maxLength || 1000));
    state.prompts[state.mode] = $('prompt').value;
    updatePromptCount();
    setStatus('提示词已优化，可直接生成。');
    $('prompt').focus();
  } catch (error) {
    setStatus(friendlyOptimizeError(error.message), true);
  } finally {
    state.optimizePending = false;
    $('optimizePromptBtn').disabled = false;
    $('optimizePromptBtn').textContent = '优化提示词';
    $('optimizePromptBtn').setAttribute('aria-label', '优化提示词');
    $('optimizePromptBtn').title = '优化提示词';
  }
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } finally {
    state.user = null;
    state.apiKeys = [];
    state.apiNewKey = '';
    state.creatorFeedbackHandledIds = [];
    clearCreatorFeedbackSummaryCache();
    clearCreatorFeedbackState();
    leavePrivateCommunityView();
    sanitizeCommunityStateForViewer();
    closeCommunityTipModal();
    closeCommunityReuseModal();
    clearCommunityReuseSource();
    hideCommunityDownloadNudge();
    if (state.activePanel === 'admin') switchPanel('settings', { updateUrl: false });
    setStatus('已退出登录。');
    await renderAll();
  }
}

async function loadMe() {
  try {
    const data = await api('/api/me');
    state.user = data.user;
    loadCreatorFeedbackHandledIds();
    state.prices = data.prices || state.prices;
  } catch (error) {
    state.user = null;
    state.creatorFeedbackHandledIds = [];
    clearCreatorFeedbackSummaryCache();
    clearCreatorFeedbackState();
    leavePrivateCommunityView();
    sanitizeCommunityStateForViewer();
    state.apiKeys = [];
    state.apiNewKey = '';
    if (error.message !== '请先登录') {
      setStatus(`账号状态读取失败：${error.message}`, true);
    }
  }
}

async function loadAdmin() {
  if (!state.user || state.user.role !== 'admin') return;
  try {
    const data = await api('/api/admin/overview');
    if (data.billing?.prices) state.prices = data.billing.prices;
    state.adminUsers = Array.isArray(data.users) ? data.users : [];
    state.adminAiSettings = data.ai || state.adminAiSettings;
    renderPrice();
    renderAdminBilling(data.billing);
    renderAdminUpstream(data.ai);
    renderAdminOverview(data);
    $('topupUser').innerHTML = data.users
      .filter((user) => user.role !== 'admin' && user.status !== 'deleted')
      .map((user) => `<option value="${user.id}">${escapeHtml(user.username)} - ${yuan(user.balanceCents)}</option>`)
      .join('');
    renderAdminUsers(state.adminUsers);
    renderAdminCommunity(data);
    renderAdminConsole();
    if (state.adminActiveTab === 'redeem') await loadAdminRedeemCodes({ silent: true });
    if (state.adminActiveTab === 'generationLogs') await loadAdminGenerationLogs({ silent: true });
  } catch (error) {
    setStatus(`管理员数据读取失败：${error.message}`, true);
  }
}

function renderAdminUpstream(ai = state.adminAiSettings) {
  const settings = ai || {};
  state.adminAiSettings = settings;
  const fill = (id, value) => {
    const input = $(id);
    if (input && document.activeElement !== input) input.value = value || '';
  };
  renderAdminImageUpstreams(settings);
  fill('adminTextUpstreamBaseUrl', settings.textUpstreamBaseUrl || settings.upstreamBaseUrl);
  fill('adminTextModel', settings.textModel);
  if ($('adminTextUpstreamApiKey') && document.activeElement !== $('adminTextUpstreamApiKey')) $('adminTextUpstreamApiKey').value = '';
  if ($('adminUpstreamMeta')) {
    const upstreams = adminImageUpstreams(settings);
    const enabledCount = upstreams.filter((item) => item.enabled !== false && item.upstreamBaseUrl && item.imageModel && (item.upstreamApiKeyConfigured || item.upstreamApiKeyMasked)).length;
    const imageKeyText = `生图通道 ${enabledCount}/${upstreams.length || 0} 可用`;
    const textKeyText = settings.textUpstreamApiKeyConfigured
      ? `文本 Key ${settings.textUpstreamApiKeyMasked || '已配置'}`
      : '文本 Key 未配置';
    const updatedAt = settings.updatedAt ? ` · ${formatDate(settings.updatedAt)}` : '';
    $('adminUpstreamMeta').textContent = `${imageKeyText} · ${textKeyText}${updatedAt}`;
  }
  if ($('adminSaveUpstreamBtn')) {
    $('adminSaveUpstreamBtn').disabled = state.upstreamSavePending;
    $('adminSaveUpstreamBtn').textContent = state.upstreamSavePending ? '保存中…' : '保存上游';
  }
}

function adminImageUpstreams(settings = state.adminAiSettings || {}) {
  if (Array.isArray(settings.imageUpstreams) && settings.imageUpstreams.length) return settings.imageUpstreams;
  return [{
    id: 'default-image-upstream',
    name: '默认生图通道',
    upstreamBaseUrl: settings.upstreamBaseUrl || '',
    upstreamApiKeyConfigured: Boolean(settings.upstreamApiKeyConfigured),
    upstreamApiKeyMasked: settings.upstreamApiKeyMasked || '',
    imageModel: settings.imageModel || '',
    enabled: true,
    priority: 100,
    weight: 1,
    failureCount: 0,
    cooldownUntil: 0,
    coolingDown: false,
    lastError: '',
    lastFailedAt: null,
    lastUsedAt: null
  }];
}

function newAdminImageUpstream() {
  return {
    id: `draft-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: '备用生图通道',
    upstreamBaseUrl: '',
    upstreamApiKeyConfigured: false,
    upstreamApiKeyMasked: '',
    imageModel: state.adminAiSettings?.imageModel || 'gpt-image-2',
    enabled: false,
    priority: Math.max(1, 100 - adminImageUpstreams().length),
    weight: 1,
    failureCount: 0,
    cooldownUntil: 0,
    coolingDown: false,
    lastError: '',
    lastFailedAt: null,
    lastUsedAt: null
  };
}

function renderAdminImageUpstreams(settings = state.adminAiSettings || {}) {
  const list = $('adminImageUpstreamList');
  if (!list) return;
  const upstreams = adminImageUpstreams(settings);
  list.innerHTML = adminImageUpstreamsHtml(upstreams);
}

function addAdminImageUpstream() {
  const settings = state.adminAiSettings || {};
  state.adminAiSettings = {
    ...settings,
    imageUpstreams: [...collectAdminImageUpstreams(), newAdminImageUpstream()]
  };
  renderAdminUpstream(state.adminAiSettings);
}

function removeAdminImageUpstream(id) {
  const settings = state.adminAiSettings || {};
  const upstreams = collectAdminImageUpstreams();
  if (upstreams.length <= 1) return;
  state.adminAiSettings = {
    ...settings,
    imageUpstreams: upstreams.filter((item) => String(item.id || '') !== String(id || ''))
  };
  renderAdminUpstream(state.adminAiSettings);
}

function collectAdminImageUpstreams() {
  const cards = Array.from(document.querySelectorAll('#adminImageUpstreamList .admin-upstream-card'));
  if (!cards.length) return adminImageUpstreams();
  const existingById = new Map(adminImageUpstreams().map((item) => [String(item.id || ''), item]));
  return cards.map((card, index) => {
    const field = (name) => card.querySelector(`[data-upstream-field="${name}"]`);
    const existing = existingById.get(String(card.dataset.upstreamId || '')) || {};
    return {
      id: card.dataset.upstreamId || '',
      name: field('name')?.value || `生图通道 ${index + 1}`,
      upstreamBaseUrl: field('upstreamBaseUrl')?.value || '',
      upstreamApiKey: field('upstreamApiKey')?.value || '',
      upstreamApiKeyConfigured: Boolean(existing.upstreamApiKeyConfigured),
      upstreamApiKeyMasked: existing.upstreamApiKeyMasked || '',
      imageModel: field('imageModel')?.value || '',
      enabled: Boolean(field('enabled')?.checked),
      autoBan: Boolean(field('autoBan')?.checked),
      priority: Number(field('priority')?.value || (100 - index)),
      weight: Number(field('weight')?.value || 1)
    };
  });
}

async function saveAdminUpstream() {
  if (state.upstreamSavePending) return;
  const payload = {
    imageUpstreams: collectAdminImageUpstreams(),
    textUpstreamBaseUrl: $('adminTextUpstreamBaseUrl')?.value || '',
    textUpstreamApiKey: $('adminTextUpstreamApiKey')?.value || '',
    textModel: $('adminTextModel')?.value || ''
  };
  state.upstreamSavePending = true;
  renderAdminUpstream();
  try {
    const data = await api('/api/admin/ai-settings', {
      method: 'PUT',
      body: payload
    });
    state.adminAiSettings = data.ai || state.adminAiSettings;
    renderAdminUpstream(state.adminAiSettings);
    await refreshHealth();
    setStatus('上游配置已保存，后续生图和文本请求会分别使用新配置。');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    state.upstreamSavePending = false;
    renderAdminUpstream();
  }
}

function renderAdminBilling(billing = null) {
  const prices = billing?.prices || state.prices;
  const price1k = Number(prices?.['1k'] || 0) / 100;
  const price2k = Number(prices?.['2k'] || 0) / 100;
  if ($('adminPrice1k') && document.activeElement !== $('adminPrice1k')) $('adminPrice1k').value = price1k ? String(price1k) : '';
  if ($('adminPrice2k') && document.activeElement !== $('adminPrice2k')) $('adminPrice2k').value = price2k ? String(price2k) : '';
  if ($('adminBillingMeta')) {
    const updatedAt = billing?.updatedAt ? ` · ${formatDate(billing.updatedAt)}` : '';
    $('adminBillingMeta').textContent = `当前 ${yuan(prices?.['1k'] || 0)} / ${yuan(prices?.['2k'] || 0)}${updatedAt}`;
  }
  if ($('adminSaveBillingBtn')) {
    $('adminSaveBillingBtn').disabled = state.billingSavePending;
    $('adminSaveBillingBtn').textContent = state.billingSavePending ? '保存中…' : '保存计费';
  }
}

async function saveAdminBilling() {
  if (state.billingSavePending) return;
  const price1kCents = Math.round(Number($('adminPrice1k')?.value || 0) * 100);
  const price2kCents = Math.round(Number($('adminPrice2k')?.value || 0) * 100);
  state.billingSavePending = true;
  renderAdminBilling();
  try {
    const data = await api('/api/admin/billing', {
      method: 'PUT',
      body: { prices: { '1k': price1kCents, '2k': price2kCents } }
    });
    state.prices = data.prices || data.billing?.prices || state.prices;
    renderAdminBilling(data.billing);
    renderPrice();
    setStatus(`计费已更新：标准 ${yuan(state.prices['1k'])} / 高质量 ${yuan(state.prices['2k'])}。`);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    state.billingSavePending = false;
    renderAdminBilling();
  }
}

function renderAdminOverview(data = {}) {
  const prices = data.billing?.prices || state.prices;
  const users = Array.isArray(data.users) ? data.users.filter((user) => user.role !== 'admin') : [];
  const redeemCodes = Array.isArray(data.redeemCodes) ? data.redeemCodes : [];
  const redeemStats = data.redeemStats || {};
  const activeRedeems = Number.isFinite(Number(redeemStats.active))
    ? Number(redeemStats.active)
    : redeemCodes.filter((item) => item.status === 'active').length;
  const reportedComments = Array.isArray(data.communityComments) ? data.communityComments.filter((item) => Number(item.reportCount || 0) > 0).length : 0;
  if ($('adminOverviewPrices')) $('adminOverviewPrices').textContent = `${yuan(prices?.['1k'] || 0)} / ${yuan(prices?.['2k'] || 0)}`;
  if ($('adminOverviewRedeems')) {
    const totalRedeems = Number.isFinite(Number(redeemStats.total)) ? ` / 共 ${redeemStats.total} 张` : '';
    $('adminOverviewRedeems').textContent = `${activeRedeems} 张未使用${totalRedeems}`;
  }
  if ($('adminOverviewUsers')) $('adminOverviewUsers').textContent = `${users.length} 个用户`;
  if ($('adminOverviewCommunity')) $('adminOverviewCommunity').textContent = `${reportedComments} 条待处理评论`;
}

function renderAdminConsole({ force = false } = {}) {
  const visible = state.user?.role === 'admin' && state.activePanel === 'admin';
  const adminSectionMeta = {
    overview: {
      title: '控制台',
      summary: '查看当前计费、卡密、用户和社区治理概况。'
    },
    billing: {
      title: '计费设置',
      summary: '实时调整生图单价，保存后立即生效。'
    },
    upstream: {
      title: '上游配置',
      summary: '实时调整生图上游地址、密钥和模型。'
    },
    generationLogs: {
      title: '生图日志',
      summary: '查看所有用户的生图任务、扣费、退款、耗时和命中通道。'
    },
    redeem: {
      title: '卡密中心',
      summary: '集中生成、搜索、复制和撤销兑换卡密。'
    },
    users: {
      title: '用户管理',
      summary: '维护用户账号、余额、密码和状态。'
    },
    community: {
      title: '社区治理',
      summary: '查看热门作品和被举报评论，处理交流区内容。'
    }
  };
  if (!$('adminConsolePanel')) return;
  if (!visible && !force) return;
  const currentMeta = adminSectionMeta[state.adminActiveTab] || adminSectionMeta.overview;
  if ($('adminConsoleSectionTitle')) $('adminConsoleSectionTitle').textContent = currentMeta.title;
  if ($('adminConsoleSectionSummary')) $('adminConsoleSectionSummary').textContent = currentMeta.summary;
  document.querySelectorAll('[data-admin-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.adminTab === state.adminActiveTab);
  });
  document.querySelectorAll('[data-admin-section]').forEach((section) => {
    section.classList.toggle('active', section.dataset.adminSection === state.adminActiveTab);
  });
}

function syncAdminVisibility() {
  const adminNavBtn = $('adminNavBtn');
  const isAdmin = state.user?.role === 'admin';
  if (adminNavBtn) {
    adminNavBtn.hidden = !isAdmin;
    adminNavBtn.setAttribute('aria-hidden', String(!isAdmin));
    adminNavBtn.tabIndex = isAdmin ? 0 : -1;
  }
  if (!isAdmin && state.activePanel === 'admin') {
    state.activePanel = 'settings';
    document.body.dataset.panel = 'settings';
  }
}

function renderAdminGenerationUserOptions() {
  const select = $('adminGenerationLogUserFilter');
  if (!select) return;
  const current = state.adminGenerationLogUserId || '';
  const users = state.adminUsers.filter((user) => user.role !== 'admin' && user.status !== 'deleted');
  select.innerHTML = adminGenerationUserOptionsHtml(state.adminUsers, current);
  select.value = users.some((user) => user.id === current) ? current : '';
  state.adminGenerationLogUserId = select.value;
}

function adminGenerationLogParams() {
  const params = new URLSearchParams({
    page: String(state.adminGenerationLogPage || 1),
    limit: String(state.adminGenerationLogLimit || 50)
  });
  const q = state.adminGenerationLogSearch.trim();
  if (q) params.set('q', q);
  if (state.adminGenerationLogStatus !== 'all') params.set('status', state.adminGenerationLogStatus);
  if (state.adminGenerationLogMode !== 'all') params.set('mode', state.adminGenerationLogMode);
  if (state.adminGenerationLogSource !== 'all') params.set('source', state.adminGenerationLogSource);
  if (state.adminGenerationLogUserId) params.set('userId', state.adminGenerationLogUserId);
  return params;
}

async function loadAdminGenerationLogs({ silent = false } = {}) {
  if (!state.user || state.user.role !== 'admin') return;
  state.adminGenerationLogLoading = true;
  if (!silent) renderAdminGenerationLogs();
  try {
    const data = await api(`/api/admin/generation-logs?${adminGenerationLogParams()}`);
    state.adminGenerationLogs = Array.isArray(data.logs) ? data.logs : [];
    state.adminGenerationLogStats = data.stats || null;
    state.adminGenerationLogTotal = Number(data.total || 0);
    state.adminGenerationLogPage = Number(data.page || state.adminGenerationLogPage || 1);
    state.adminGenerationLogLimit = Number(data.limit || state.adminGenerationLogLimit || 50);
  } catch (error) {
    if (!silent) setStatus(`生图日志读取失败：${error.message}`, true);
    state.adminGenerationLogs = [];
    state.adminGenerationLogStats = null;
    state.adminGenerationLogTotal = 0;
  } finally {
    state.adminGenerationLogLoading = false;
    renderAdminGenerationLogs();
  }
}

function renderAdminGenerationLogs() {
  renderAdminGenerationUserOptions();
  if ($('adminGenerationLogSearch')) $('adminGenerationLogSearch').value = state.adminGenerationLogSearch;
  if ($('adminGenerationLogStatusFilter')) $('adminGenerationLogStatusFilter').value = state.adminGenerationLogStatus;
  if ($('adminGenerationLogModeFilter')) $('adminGenerationLogModeFilter').value = state.adminGenerationLogMode;
  if ($('adminGenerationLogSourceFilter')) $('adminGenerationLogSourceFilter').value = state.adminGenerationLogSource;
  const stats = state.adminGenerationLogStats || {};
  const total = Number(state.adminGenerationLogTotal || 0);
  const page = Number(state.adminGenerationLogPage || 1);
  const limit = Number(state.adminGenerationLogLimit || 50);
  const maxPage = Math.max(1, Math.ceil(total / limit));
  if ($('adminGenerationLogMeta')) $('adminGenerationLogMeta').textContent = state.adminGenerationLogLoading ? '正在读取' : `共 ${total} 条任务`;
  if ($('adminGenerationLogSucceeded')) $('adminGenerationLogSucceeded').textContent = String(stats.succeeded || 0);
  if ($('adminGenerationLogFailed')) $('adminGenerationLogFailed').textContent = String(stats.failed || 0);
  if ($('adminGenerationLogImages')) $('adminGenerationLogImages').textContent = String(stats.imageCount || 0);
  if ($('adminGenerationLogNet')) $('adminGenerationLogNet').textContent = yuan(stats.netCents || 0);
  if ($('adminGenerationLogPageMeta')) $('adminGenerationLogPageMeta').textContent = `第 ${page}/${maxPage} 页`;
  if ($('adminGenerationLogPrevBtn')) $('adminGenerationLogPrevBtn').disabled = state.adminGenerationLogLoading || page <= 1;
  if ($('adminGenerationLogNextBtn')) $('adminGenerationLogNextBtn').disabled = state.adminGenerationLogLoading || page >= maxPage;
  if ($('adminGenerationLogRefreshBtn')) $('adminGenerationLogRefreshBtn').disabled = state.adminGenerationLogLoading;
  if ($('adminGenerationLogTableMeta')) {
    const start = total ? (page - 1) * limit + 1 : 0;
    const end = Math.min(page * limit, total);
    $('adminGenerationLogTableMeta').textContent = state.adminGenerationLogLoading ? '正在读取生图日志' : `当前显示 ${start}-${end} / ${total}`;
  }
  const list = $('adminGenerationLogList');
  if (!list) return;
  list.innerHTML = adminGenerationLogsHtml({
    logs: state.adminGenerationLogs,
    loading: state.adminGenerationLogLoading,
    stats: state.adminGenerationLogStats || {},
    total: state.adminGenerationLogTotal || 0,
    page: state.adminGenerationLogPage || 1,
    limit: state.adminGenerationLogLimit || 50
  });
}

function adminRedeemParams({ page = state.adminRedeemPage, limit = state.adminRedeemLimit, includePage = true } = {}) {
  const params = new URLSearchParams();
  if (includePage) {
    params.set('page', String(Math.max(1, Number(page || 1))));
    params.set('limit', String(Math.max(20, Math.min(500, Number(limit || 100)))));
  }
  const q = String(state.adminRedeemSearch || '').trim();
  if (q) params.set('q', q);
  if (state.adminRedeemStatusFilter !== 'all') params.set('status', state.adminRedeemStatusFilter);
  return params;
}

async function loadAdminRedeemCodes({ silent = false } = {}) {
  if (!state.user || state.user.role !== 'admin') return;
  state.adminRedeemLoading = true;
  if (!silent) renderAdminRedeemCodes();
  try {
    const data = await api(`/api/admin/redeem-codes?${adminRedeemParams()}`);
    state.adminRedeemCodes = Array.isArray(data.redeemCodes) ? data.redeemCodes : [];
    state.adminRedeemStats = data.stats || null;
    state.adminRedeemAllStats = data.allStats || null;
    state.adminRedeemTotal = Number(data.total || 0);
    state.adminRedeemPage = Number(data.page || state.adminRedeemPage || 1);
    state.adminRedeemLimit = Number(data.limit || state.adminRedeemLimit || 100);
    const pageIds = new Set(state.adminRedeemCodes.filter((item) => item.status === 'active').map((item) => item.id));
    state.adminRedeemSelectedIds = state.adminRedeemSelectedIds.filter((id) => pageIds.has(id));
  } catch (error) {
    if (!silent) setStatus(`卡密读取失败：${error.message}`, true);
    state.adminRedeemCodes = [];
    state.adminRedeemStats = null;
    state.adminRedeemTotal = 0;
  } finally {
    state.adminRedeemLoading = false;
    renderAdminRedeemCodes();
  }
}

function csvValue(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function adminRedeemCsv(codes = []) {
  const rows = [
    ['卡密', '奇点', '状态', '使用用户', '使用账号', '创建时间', '使用时间', '撤销时间', 'ID'],
    ...codes.map((item) => [
      item.code,
      (Number(item.amountCents || 0) / 100).toFixed(2),
      redeemStatusText(item.status),
      item.usedByName || '',
      item.usedByAccount || '',
      item.createdAt ? new Date(item.createdAt).toISOString() : '',
      item.usedAt ? new Date(item.usedAt).toISOString() : '',
      item.revokedAt ? new Date(item.revokedAt).toISOString() : '',
      item.id || ''
    ])
  ];
  return `\uFEFF${rows.map((row) => row.map(csvValue).join(',')).join('\n')}\n`;
}

function downloadTextFile(filename, text, type = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

async function downloadAdminRedeemExport(kind = 'filtered') {
  if (kind === 'created') {
    if (!state.adminRedeemLastCreated.length) return setStatus('本次还没有新生成的兑换码。', true);
    downloadTextFile(`本次生成兑换码-${Date.now()}.csv`, adminRedeemCsv(state.adminRedeemLastCreated), 'text/csv;charset=utf-8');
    setStatus(`已下载本次生成的 ${state.adminRedeemLastCreated.length} 张兑换码。`);
    return;
  }
  if (kind === 'selected') {
    if (!state.adminRedeemSelectedIds.length) return setStatus('请先勾选要下载的卡密。', true);
    const selected = state.adminRedeemCodes.filter((item) => state.adminRedeemSelectedIds.includes(item.id));
    if (!selected.length) return setStatus('当前页没有可下载的选中卡密。', true);
    downloadTextFile(`选中兑换码-${Date.now()}.csv`, adminRedeemCsv(selected), 'text/csv;charset=utf-8');
    setStatus(`已下载 ${selected.length} 张选中卡密。`);
    return;
  }
  const response = await fetch(`/api/admin/redeem-codes/export?${adminRedeemParams({ includePage: false })}`, { cache: 'no-store' });
  if (!response.ok) {
    let message = '下载筛选结果失败';
    try {
      const payload = await response.json();
      message = payload.message || message;
    } catch {}
    throw new Error(message);
  }
  const text = await response.text();
  downloadTextFile(`兑换码筛选结果-${Date.now()}.csv`, text, 'text/csv;charset=utf-8');
  setStatus('已下载当前筛选条件下的全部兑换码。');
}

function renderAdminRedeemCodes(codes = state.adminRedeemCodes) {
  const pageCodes = Array.isArray(codes) ? codes : [];
  const selectedIds = state.adminRedeemSelectedIds.filter((id) => pageCodes.some((item) => item.id === id && item.status === 'active'));
  const stats = state.adminRedeemStats || {};
  const allStats = state.adminRedeemAllStats || stats;
  const total = Number(state.adminRedeemTotal || 0);
  const page = Math.max(1, Number(state.adminRedeemPage || 1));
  const limit = Math.max(1, Number(state.adminRedeemLimit || 100));
  const maxPage = Math.max(1, Math.ceil(total / limit));
  if ($('adminRedeemMeta')) {
    $('adminRedeemMeta').textContent = state.adminRedeemLoading
      ? '正在读取卡密'
      : `${allStats.active || 0} 张未使用 · 共 ${allStats.total || total} 张 · 当前筛选 ${total} 张`;
  }
  if ($('adminRedeemTableMeta')) {
    const start = total ? (page - 1) * limit + 1 : 0;
    const end = Math.min(page * limit, total);
    $('adminRedeemTableMeta').textContent = state.adminRedeemLoading ? '正在读取兑换卡密' : `当前显示 ${start}-${end} / ${total} · 筛选合计 ${singularity(stats.amountCents || 0)}`;
  }
  if ($('adminRedeemPageMeta')) $('adminRedeemPageMeta').textContent = `第 ${page}/${maxPage} 页`;
  if ($('adminRedeemPrevBtn')) $('adminRedeemPrevBtn').disabled = state.adminRedeemLoading || page <= 1;
  if ($('adminRedeemNextBtn')) $('adminRedeemNextBtn').disabled = state.adminRedeemLoading || page >= maxPage;
  if ($('adminRedeemRefreshBtn')) $('adminRedeemRefreshBtn').disabled = state.adminRedeemLoading;
  if ($('adminRedeemStatusFilter')) $('adminRedeemStatusFilter').value = state.adminRedeemStatusFilter;
  if ($('adminRedeemSearch')) $('adminRedeemSearch').value = state.adminRedeemSearch;
  if ($('adminRedeemSelectionMeta')) $('adminRedeemSelectionMeta').textContent = selectedIds.length ? `已选 ${selectedIds.length} 张未使用卡密` : '未选择兑换码';
  if ($('adminCreateRedeemBtn')) {
    $('adminCreateRedeemBtn').disabled = state.adminRedeemPending;
    $('adminCreateRedeemBtn').textContent = state.adminRedeemPending ? '生成中…' : '生成卡密';
  }
  if ($('adminBatchRevokeRedeemBtn')) $('adminBatchRevokeRedeemBtn').disabled = state.adminRedeemPending || !selectedIds.length;
  if ($('adminDownloadRedeemSelectedBtn')) $('adminDownloadRedeemSelectedBtn').disabled = !selectedIds.length;
  if ($('adminDownloadRedeemFilteredBtn')) $('adminDownloadRedeemFilteredBtn').disabled = state.adminRedeemLoading || total <= 0;
  if ($('adminDownloadRedeemCreatedBtn')) $('adminDownloadRedeemCreatedBtn').disabled = !state.adminRedeemLastCreated.length;
  if (!$('adminRedeemCodes')) return;
  $('adminRedeemCodes').innerHTML = adminRedeemCodesHtml({
    codes: pageCodes,
    loading: state.adminRedeemLoading,
    total,
    page,
    limit,
    stats,
    allStats,
    selectedIds
  });
}

function renderAdminUsers(users = []) {
  const keyword = state.adminUserSearch.trim().toLowerCase();
  const managedUsers = users.filter((user) => user.role !== 'admin').filter((user) => {
    if (!keyword) return true;
    return [user.username, user.account]
      .map((value) => String(value || '').toLowerCase())
      .some((value) => value.includes(keyword));
  });
  if ($('adminUserMeta')) {
    const allUsers = users.filter((user) => user.role !== 'admin');
    const activeCount = allUsers.filter((user) => user.status === 'active').length;
    const disabledCount = allUsers.filter((user) => user.status === 'disabled').length;
    $('adminUserMeta').textContent = `${activeCount} 个正常 · ${disabledCount} 个禁用 · 共 ${allUsers.length} 个用户`;
  }
  if ($('adminUserTableMeta')) $('adminUserTableMeta').textContent = `共 ${users.filter((user) => user.role !== 'admin').length} 条，当前显示 ${managedUsers.length} 条`;
  if ($('adminUserSearch')) $('adminUserSearch').value = state.adminUserSearch;
  if ($('adminCreateUserBtn')) {
    $('adminCreateUserBtn').disabled = state.adminUserPending;
    $('adminCreateUserBtn').textContent = state.adminUserPending ? '创建中…' : '新增用户';
  }
  if (!$('adminUserList')) return;
  $('adminUserList').innerHTML = adminUsersHtml({ users, search: state.adminUserSearch });
}

async function createAdminRedeemCodeFromPanel() {
  if (state.adminRedeemPending) return;
  state.adminRedeemPending = true;
  if ($('adminCreateRedeemBtn')) {
    $('adminCreateRedeemBtn').disabled = true;
    $('adminCreateRedeemBtn').textContent = '生成中…';
  }
  try {
    const quantity = Math.max(1, Math.trunc(Number($('adminRedeemQuantity')?.value || 1)));
    const data = await api('/api/admin/redeem-codes', {
      method: 'POST',
      body: {
        amountSingularity: Number($('adminRedeemAmount')?.value || 0),
        quantity,
        code: quantity > 1 ? '' : ($('adminRedeemCustomCode')?.value || '')
      }
    });
    if ($('adminRedeemCustomCode')) $('adminRedeemCustomCode').value = '';
    if ($('adminRedeemQuantity')) $('adminRedeemQuantity').value = '';
    const created = Array.isArray(data.redeemCodes) && data.redeemCodes.length
      ? data.redeemCodes
      : data.redeemCode
        ? [data.redeemCode]
        : [];
    state.adminRedeemLastCreated = created;
    if (created.length > 1) {
      setStatus(`已批量生成 ${created.length} 张 ${yuan(created[0].amountCents)} 兑换卡密，可点“下载本次生成”；旧卡密仍在列表分页和筛选导出里。`);
    } else if (created.length) {
      setStatus(`已生成 ${yuan(created[0].amountCents)} 卡密：${created[0].code}。旧卡密仍在列表分页和筛选导出里。`);
    } else {
      setStatus('卡密已生成。');
    }
    state.adminRedeemPending = false;
    state.adminRedeemPage = 1;
    await loadAdminRedeemCodes();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    state.adminRedeemPending = false;
    if ($('adminCreateRedeemBtn')) {
      $('adminCreateRedeemBtn').disabled = false;
      $('adminCreateRedeemBtn').textContent = '生成卡密';
    }
  }
}

function toggleAdminRedeemSelection(id, checked) {
  if (!id) return;
  if (checked) {
    if (!state.adminRedeemSelectedIds.includes(id)) state.adminRedeemSelectedIds.push(id);
  } else {
    state.adminRedeemSelectedIds = state.adminRedeemSelectedIds.filter((item) => item !== id);
  }
  renderAdminRedeemCodes();
}

async function copyAdminRedeemCodes() {
  const pageCodes = state.adminRedeemCodes || [];
  if (!pageCodes.length) return setStatus('当前页没有可复制的兑换码。', true);
  const text = pageCodes.map((item) => `${item.code} ${yuan(item.amountCents)} ${redeemStatusText(item.status)}`).join('\n');
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`已复制当前页 ${pageCodes.length} 条兑换码。`);
  } catch {
    setStatus('复制失败，请检查浏览器剪贴板权限。', true);
  }
}

async function batchRevokeAdminRedeemCodes() {
  if (!state.adminRedeemSelectedIds.length) return setStatus('请先勾选要撤销的未使用卡密。', true);
  try {
    const data = await api('/api/admin/redeem-codes/revoke-batch', {
      method: 'POST',
      body: { codeIds: state.adminRedeemSelectedIds }
    });
    state.adminRedeemSelectedIds = [];
    setStatus(`已批量撤销 ${data.count} 张兑换卡密。`);
    await loadAdminRedeemCodes();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function revokeAdminRedeemCode(id, button) {
  if (!id) return;
  if (button.dataset.confirm !== '1') {
    button.dataset.confirm = '1';
    button.textContent = '确认撤销';
    window.setTimeout(() => {
      button.dataset.confirm = '';
      button.textContent = '撤销';
    }, 3000);
    return;
  }
  button.disabled = true;
  try {
    await api(`/api/admin/redeem-codes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    setStatus('兑换卡密已撤销。');
    await loadAdminRedeemCodes();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function createAdminUser() {
  if (state.adminUserPending) return;
  state.adminUserPending = true;
  if ($('adminCreateUserBtn')) {
    $('adminCreateUserBtn').disabled = true;
    $('adminCreateUserBtn').textContent = '创建中…';
  }
  try {
    const data = await api('/api/admin/users', {
      method: 'POST',
      body: {
        account: $('adminNewAccount')?.value || '',
        username: $('adminNewUsername')?.value || '',
        password: $('adminNewPassword')?.value || '',
        balanceSingularity: Number($('adminNewBalance')?.value || 0)
      }
    });
    ['adminNewAccount', 'adminNewUsername', 'adminNewPassword', 'adminNewBalance'].forEach((id) => {
      if ($(id)) $(id).value = '';
    });
    setStatus(`已新增用户 ${data.user.username}。`);
    state.adminUserPending = false;
    await loadAdmin();
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    state.adminUserPending = false;
    if ($('adminCreateUserBtn')) {
      $('adminCreateUserBtn').disabled = false;
      $('adminCreateUserBtn').textContent = '新增用户';
    }
  }
}

async function resetAdminUserPassword(userId) {
  const password = window.prompt('输入新密码，至少 6 位');
  if (password === null) return;
  try {
    await api(`/api/admin/users/${encodeURIComponent(userId)}/reset-password`, {
      method: 'POST',
      body: { password }
    });
    setStatus('用户密码已重置，旧登录状态已失效。');
    await loadAdmin();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function updateAdminUserStatus(userId, status) {
  try {
    const data = await api(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
      method: 'PATCH',
      body: { status }
    });
    setStatus(`${data.user.username} 已${status === 'active' ? '启用' : '禁用'}。`);
    await loadAdmin();
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function deleteAdminUser(userId, button) {
  if (button.dataset.confirm !== '1') {
    button.dataset.confirm = '1';
    button.textContent = '确认删除';
    window.setTimeout(() => {
      button.dataset.confirm = '';
      button.textContent = '删除';
    }, 3000);
    return;
  }
  button.disabled = true;
  try {
    await api(`/api/admin/users/${encodeURIComponent(userId)}`, { method: 'DELETE' });
    setStatus('用户已软删除，历史记录和账单仍保留。');
    await loadAdmin();
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderAdminCommunity(data = {}) {
  const posts = data.communityPosts || [];
  const comments = data.communityComments || [];
  const rendered = adminCommunityHtml({ posts, comments });
  if ($('adminCommunityMeta')) {
    $('adminCommunityMeta').textContent = `${posts.length} 个公开作品 · ${rendered.reportedCount} 条被举报评论`;
  }
  if ($('adminCommunityPosts')) {
    $('adminCommunityPosts').innerHTML = rendered.posts;
  }
  if ($('adminCommunityComments')) {
    $('adminCommunityComments').innerHTML = rendered.comments;
  }
}

async function renderAll() {
  renderAccount();
  renderPrice();
  renderActivePanel();
  updatePromptCount();
  renderCommunityReuseSourceBar();
  if (state.activePanel === 'studio') {
    try {
      await loadHistory();
    } catch (error) {
      state.historyItems = [];
      state.historyTotal = 0;
      state.historyDeletableCount = 0;
      if ($('history')) $('history').innerHTML = `<p class="history-empty-copy error-text">历史读取失败：${escapeHtml(error.message)}</p>`;
      if ($('historyHint')) $('historyHint').textContent = '!';
      setStatus('历史读取失败，但不影响当前生成结果。', true);
    }
  }
  if (state.user && state.activePanel === 'developers') await loadApiKeys({ silent: true });
  if (state.activePanel === 'admin') await loadAdmin();
}

function setMode(mode) {
  const nextMode = mode === 'edit' ? 'edit' : 'generate';
  if (nextMode !== state.mode) {
    const currentPrompt = $('prompt')?.value || '';
    saveCurrentPrompt();
    state.prompts[nextMode] = currentPrompt;
  }
  state.mode = nextMode;
  $('modeTabs')?.querySelectorAll('button').forEach((item) => item.classList.toggle('active', item.dataset.mode === state.mode));
  $('uploadBox').classList.remove('visible');
  $('referencePreview').classList.toggle('visible', state.mode === 'edit' && Boolean(state.imageDataUrl));
  document.body.classList.toggle('edit-mode-active', state.mode === 'edit');
  syncSourceImageStateClass();
  updateModeCopy();
  renderPromptForMode();
  if (state.mode === 'edit') {
    setStatus(currentImageDataUrls().length ? '源图已就绪。' : '图生图需要先上传源图。');
  } else if ($('status')?.textContent === '图生图需要先上传源图。') {
    setStatus('');
  }
  renderPrice();
  scheduleResultLayoutSettle();
}

function setQuality(quality) {
  state.quality = ['1k', '2k'].includes(quality) ? quality : '2k';
  renderPrice();
}

function setSize(size) {
  state.size = supportedSizes.includes(size) ? size : '1024x1024';
  renderPrice();
}

function setOutputFormat(format) {
  state.outputFormat = ['jpeg', 'png', 'webp'].includes(format) ? format : 'jpeg';
  renderPrice();
}

function setCount(count) {
  const value = Number(count || 1);
  state.count = [1, 2, 4].includes(value) ? value : 1;
  renderPrice();
}

function setLayout(layout) {
  state.layout = 'single';
  state.storyboardText = '';
  state.storyboardScenes = [];
  renderStoryboardDraft();
  renderPrice();
}

async function handleLogin() {
  const account = $('account').value.trim();
  const password = $('password').value;
  if (!account || !password) throw new Error('请输入账号和密码');
  const data = await api('/api/auth/login', {
    method: 'POST',
    body: { account, password }
  });
  resetCommunitySessionStateForUser(data.user);
  state.user = data.user;
  loadCreatorFeedbackHandledIds();
  sanitizeCommunityStateForViewer();
  $('password').value = '';
  closeAuthModal({ clearPending: false });
  if (state.activePanel === 'developers') await loadApiKeys({ silent: true });
  await renderAll();
  const continued = await runPendingAuthAction();
  if (!continued.attempted) setStatus('登录成功，可以开始生成。');
  else if (continued.success) setStatus('登录成功，已继续刚才的操作。');
}

async function handleRegister() {
  const username = $('displayName').value.trim();
  const account = $('account').value.trim();
  const password = $('password').value;
  if (!username || !account || !password) throw new Error('请输入用户名、账号和密码');
  const data = await api('/api/auth/register', {
    method: 'POST',
    body: { username, account, password }
  });
  resetCommunitySessionStateForUser(data.user);
  state.user = data.user;
  loadCreatorFeedbackHandledIds();
  sanitizeCommunityStateForViewer();
  $('password').value = '';
  closeAuthModal({ clearPending: false });
  setStatus('注册成功，已自动登录。');
  if (state.activePanel === 'developers') await loadApiKeys({ silent: true });
  await renderAll();
  const continued = await runPendingAuthAction();
  if (!continued.attempted) setStatus('注册成功，已自动登录。');
  else if (continued.success) setStatus('注册成功，已继续刚才的操作。');
}

async function runAuth(action) {
  if (state.authPending) return;
  if (action === 'login' && state.authMode === 'register') {
    setAuthMode('login');
    return;
  }
  if (action === 'register' && state.authMode === 'login') {
    setAuthMode('register');
    setTimeout(() => $('displayName').focus(), 30);
    return;
  }
  state.authPending = true;
  $('loginBtn').disabled = true;
  $('registerBtn').disabled = true;
  setAuthStatus(action === 'login' ? '正在登录…' : '正在注册…');
  try {
    if (action === 'login') {
      await handleLogin();
    } else {
      await handleRegister();
    }
  } catch (error) {
    setAuthStatus(error.message, true);
  } finally {
    state.authPending = false;
    $('loginBtn').disabled = false;
    $('registerBtn').disabled = false;
  }
}

async function submitGeneration(statusText = '请求已提交。') {
  const generateBtn = $('generateBtn');
  if (!generateBtn) return;
  if (isGenerateButtonLocked()) return;
  if (!state.user) {
    return requireLoginForAction('generate', { statusText: '登录成功，正在继续生成…' }, '请先登录后再生成。');
  }
  saveCurrentPrompt();
  applyModeFromSources();
  saveCurrentPrompt();
  const rawPrompt = state.prompts[state.mode].trim();
  const prompt = rawPrompt;
  const imageDataUrls = state.mode === 'edit' ? currentImageDataUrls() : [];
  const storyboardPrompts = state.layout === 'storyboard'
    ? (state.storyboardScenes.length ? state.storyboardScenes : parseStoryboardText(state.storyboardText))
    : [];
  if (rawPrompt.length < 2) return setStatus('请输入提示词。', true);
  if (state.mode === 'edit' && !imageDataUrls.length) return setStatus('图生图需要先上传源图。', true);
  if (state.layout === 'storyboard' && !storyboardPrompts.length) return setStatus('请先生成分镜草稿，再生成整组画面。', true);
  const submitSeq = beginGenerationActivity();
  if ($('generationBannerMeta')) $('generationBannerMeta').textContent = selectedPriceText();
  const generateButtonLock = lockGenerateButtonForSession(submitSeq, { setStatus });
  renderGeneratingPreview();
  setPreviewMeta(selectedPriceText());
  setStatus(statusText);
  const reusePostId = state.communityReusePendingPostId || '';
  const reuseIntentToken = reusePostId ? state.communityReusePendingToken || '' : '';
  const payload = buildGenerationPayload({ prompt, imageDataUrls, storyboardPrompts, reusePostId, reuseIntentToken });
  const longTaskTimers = createLongGenerationTimers(submitSeq);
  try {
    const queuedData = await submitGenerationRequest(payload, { mode: state.mode });
    if (queuedData.generation?.id) {
      renderGeneratingPreview(queuedData.generation);
      setStatus('任务已进入后台队列，可以继续提交下一张。');
      setPreviewMeta(queuedData.queue?.queued ? `排队中 · 队列 ${queuedData.queue.queued} 个任务` : '后台任务已创建');
      await loadHistory();
    }
    const data = queuedData.queued && queuedData.generation?.id
      ? await pollGenerationResult(queuedData.generation.id, submitSeq)
      : queuedData;
    if (reusePostId) {
      clearCommunityReuseSource();
    }
    state.user = data.user;
    await loadMe();
    if (data.reusePost) {
      applyCommunityPostUpdate(data.reusePost);
    }
    const item = mergeReusePostIntoGeneration(data);
    if (!isCurrentGenerationActivity(submitSeq)) {
      await loadHistory();
      setStatus('一张图片已生成完成，已放入历史记录。');
      return;
    }
    $('preview').classList.remove('loading');
    if (item.status === 'failed') {
      const failedMessage = friendlyGenerateError(item.error || '生成失败');
      renderFailedGeneration(item, failedMessage);
      setStatus(failedMessage, true);
      await loadHistory();
      return;
    }
    setStatus(`生成成功，已扣费 ${yuan(item.priceCents)}。`);
    await renderAll();
    showGenerationInPreview(item);
    setPreviewMeta(generationPreviewMeta(item, state.count));
  } catch (error) {
    if (error.status === 401) {
      requireLoginAfterExpired({ type: 'generate', statusText: '登录成功，正在继续生成…' });
      setStatus('登录状态已过期，请重新登录后继续生成。', true);
      return;
    }
    if (!isCurrentGenerationActivity(submitSeq)) {
      await loadHistory();
      return;
    }
    $('preview').classList.remove('loading');
    document.querySelector('.result-thread')?.classList.add('is-visible');
    if (isReuseSourceExpiredError(error, reusePostId)) {
      clearCommunityReuseSource('参考来源已过期，请重新从作品详情发起参考创作。当前提示词和设置已保留。');
    }
    const failedGeneration = error.payload?.generation;
    const failedMessage = friendlyGenerateError(failedGeneration?.error || error.message);
    renderFailedGeneration(failedGeneration, failedMessage);
    setStatus(failedMessage, true);
    await loadHistory();
  } finally {
    clearGenerationTimers(longTaskTimers);
    finishGenerationActivity(submitSeq);
    unlockGenerateButtonForSession(submitSeq, generateButtonLock);
  }
}

function bindEvents() {
  normalizeHistoryLayoutState();
  window.addEventListener('resize', normalizeHistoryLayoutState);
  window.addEventListener('resize', scheduleResultLayoutSettle);
  window.addEventListener('resize', scheduleFloatingPillMenuPosition);
  window.addEventListener('scroll', scheduleFloatingPillMenuPosition, true);
  observeComposerLayout();
  $('sideLoginBtn').onclick = openAccountOrAuth;
  $('sideRechargeBtn').onclick = openRechargeModal;
  const openStudioHome = (event) => {
    event.preventDefault();
    preferredStudioRoute = '/image/history';
    switchPanel('studio', { path: '/image/history' });
  };
  document.querySelector('[data-panel-target="studio"]').onclick = openStudioHome;
  $('railBrandHome').onclick = openStudioHome;
  $('themeToggleBtn').onclick = toggleTheme;
  $('promptLibraryNavBtn').onclick = () => switchPanel('prompts');
  $('agentNavBtn').onclick = () => switchPanel('agent');
  $('apiDocsNavBtn').onclick = () => switchPanel('developers');
  $('settingsNavBtn').onclick = () => switchPanel('settings');
  $('adminNavBtn').onclick = () => switchPanel('admin');
  $('headerAccountBtn').onclick = openAccountOrAuth;
  $('headerRechargeBtn').onclick = openRechargeModal;
  $('railCollapseBtn').onclick = () => {
    document.body.classList.toggle('rail-collapsed');
    const collapsed = document.body.classList.contains('rail-collapsed');
    $('railCollapseBtn').setAttribute('aria-label', collapsed ? '展开导航' : '收起导航');
    $('railCollapseBtn').title = collapsed ? '展开导航' : '收起导航';
  };
  bindComposerResize();
  bindHistoryResize();
  bindStudioMotion();
  $('communityReuseGenerateBtn').onclick = () => {
    hideCommunityReuseNudge();
    submitGeneration('正在生成参考延展版本…').catch((error) => setStatus(error.message, true));
  };
  $('communityReuseDismissBtn').onclick = hideCommunityReuseNudge;
  $('communityDownloadDismissBtn').onclick = hideCommunityDownloadNudge;
  $('communityDownloadLikeBtn').onclick = () => {
    likeDownloadedCommunityPost().catch((error) => setStatus(error.message, true));
  };
  $('communityDownloadCommentBtn').onclick = () => {
    commentDownloadedCommunityPost().catch((error) => setStatus(error.message, true));
  };
  $('communityDownloadReuseBtn').onclick = reuseDownloadedCommunityPost;
  $('communityDownloadTipBtn').onclick = () => {
    const post = state.communityDownloadNudgePost;
    hideCommunityDownloadNudge();
    if (post?.id) tipCommunityPostOptional(post.id);
  };
  $('communityReuseCloseBtn').onclick = closeCommunityReuseModal;
  $('communityReuseModal').onclick = (event) => {
    handleCommunityClick(event);
    if (event.target === $('communityReuseModal')) closeCommunityReuseModal();
  };
  $('newSessionBtn').onclick = resetComposer;
  bindHistoryControls();
  $('collapseHistoryBtn').onclick = () => {
    closePillMenus();
    if (state.activePanel !== 'studio') {
      switchPanel('studio', { path: preferredStudioRoute || '/image/history' });
      if (window.matchMedia('(max-width: 1180px)').matches) {
        document.body.classList.add('history-mobile-open');
      } else {
        document.body.classList.add('history-opened');
        document.body.classList.remove('history-collapsed');
      }
      normalizeHistoryLayoutState();
      return;
    }
    if (window.matchMedia('(max-width: 1180px)').matches) {
      document.body.classList.toggle('history-mobile-open');
    } else {
      document.body.classList.toggle('history-opened');
      document.body.classList.toggle('history-collapsed', !document.body.classList.contains('history-opened'));
    }
    normalizeHistoryLayoutState();
  };
  document.querySelectorAll('.select-pill').forEach((pill) => {
    pill.onclick = (event) => {
      if (event.target.closest('.pill-menu button')) return;
      const shouldOpen = !pill.classList.contains('open');
      closePillMenus();
      pill.classList.toggle('open', shouldOpen);
      $('create')?.classList.toggle('dropdown-open', shouldOpen);
      if (shouldOpen) activateFloatingPillMenu(pill);
    };
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.select-pill') && !event.target.closest('[data-floating-menu]')) closePillMenus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closePillMenus();
  });
  $('authCloseBtn').onclick = closeAuthModal;
  $('rechargeCloseBtn').onclick = closeRechargeModal;
  $('accountCloseBtn').onclick = closeAccountModal;
  bindSelectionMaskEvents();
  $('authModal').onclick = null;
  $('rechargeModal').onclick = (event) => {
    if (event.target === $('rechargeModal')) closeRechargeModal();
  };
  $('accountModal').onclick = (event) => {
    if (event.target === $('accountModal')) closeAccountModal();
  };
  $('communityPublishCloseBtn').onclick = closeCommunityPublishModal;
  $('communityPublishCancelBtn').onclick = closeCommunityPublishModal;
  $('communityPublishSubmitBtn').onclick = submitCommunityPublish;
  $('communityPublishModal').onclick = (event) => {
    handleCommunityClick(event);
    if (event.target === $('communityPublishModal')) closeCommunityPublishModal();
  };
  $('communityDetailCloseBtn').onclick = closeCommunityDetailModal;
  $('communityDetailModal').onclick = (event) => {
    if (event.target === $('communityDetailModal')) closeCommunityDetailModal();
  };
  $('communityDetailModal').addEventListener('click', (event) => {
    handleCommunityClick(event);
    const pinButton = event.target.closest('[data-community-comment-pin]');
    if (pinButton) {
      event.preventDefault();
      pinCommunityCommentById(pinButton.dataset.communityCommentPin);
      return;
    }
    const unpinButton = event.target.closest('[data-community-comment-unpin]');
    if (unpinButton) {
      event.preventDefault();
      unpinCommunityCommentById();
      return;
    }
    const reportButton = event.target.closest('[data-community-comment-report]');
    if (reportButton) {
      event.preventDefault();
      reportCommunityCommentById(reportButton.dataset.communityCommentReport);
      return;
    }
    const resolveReportsButton = event.target.closest('[data-community-comment-resolve-reports]');
    if (resolveReportsButton) {
      event.preventDefault();
      resolveCommunityCommentReportsById(resolveReportsButton.dataset.communityCommentResolveReports);
      return;
    }
    const replyButton = event.target.closest('[data-community-comment-reply]');
    if (replyButton) {
      event.preventDefault();
      replyCommunityCommentById(replyButton.dataset.communityCommentReply);
      return;
    }
    const deleteButton = event.target.closest('[data-community-comment-delete]');
    if (deleteButton) {
      event.preventDefault();
      deleteCommunityComment(deleteButton.dataset.communityCommentDelete);
      return;
    }
    const suggestionButton = event.target.closest('[data-community-comment-suggestion]');
    if (suggestionButton) {
      event.preventDefault();
      const input = $('communityCommentInput');
      if (input) {
        const suggestion = String(suggestionButton.dataset.communityCommentSuggestion || '').trim();
        const current = input.value.trim();
        const maxLength = Number(input.maxLength || 300);
        const next = current ? `${current} ${suggestion}` : suggestion;
        input.value = next.slice(0, maxLength);
        input.focus();
        if (next.length > maxLength) setStatus('评论最多 300 字，已为你保留可提交的部分。', true);
      }
      return;
    }
    if (event.target.closest('#communityReplyCancelBtn')) {
      event.preventDefault();
      cancelCommunityReply();
      return;
    }
    if (event.target.closest('#communityCommentSubmitBtn')) submitCommunityComment();
  });
  $('communityTipCloseBtn').onclick = closeCommunityTipModal;
  $('communityTipCancelBtn').onclick = closeCommunityTipModal;
  $('communityTipSubmitBtn').onclick = submitCommunityTip;
  $('communityTipModal').onclick = (event) => {
    if (event.target === $('communityTipModal')) closeCommunityTipModal();
  };
  document.querySelectorAll('[data-community-tip-amount]').forEach((button) => {
    button.onclick = () => {
      if ($('communityTipAmount')) $('communityTipAmount').value = button.dataset.communityTipAmount;
      setCommunityTipStatus('');
    };
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeAuthModal();
      closeRechargeModal();
      closeAccountModal();
      closeCommunityPublishModal();
      closeCommunityDetailModal();
      closeCommunityTipModal();
      closeSelectionModal();
      closeOriginalViewer();
    }
  });
  $('accountLoginBtn').onclick = () => {
    closeAccountModal();
    openAuthModal();
  };
  $('accountRechargeBtn').onclick = () => {
    closeAccountModal();
    openRechargeModal();
  };
  $('accountLogoutBtn').onclick = async () => {
    closeAccountModal();
    await logout();
  };
  $('settingsAccountBtn').onclick = openAccountOrAuth;
  $('settingsRechargeBtn').onclick = openRechargeModal;
  $('promptLibrarySearch').addEventListener('input', () => {
    renderPromptLibrary();
    scheduleCommunitySearch(() => {
      resetCommunityPagination();
      loadCommunityPosts({ silent: true });
    });
  });
  $('promptLibrarySearch').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      scheduleCommunitySearch.cancel();
      loadCommunityPosts();
    }
  });
  $('communityRefreshBtn').onclick = () => {
    loadCommunityPosts();
  };
  $('communityCreateBtn').onclick = startCommunityCreation;
  $('promptLibraryPanel').addEventListener('click', handlePromptLibraryClick);
window.addEventListener('popstate', () => {
  switchPanel(panelFromPath(), { updateUrl: false });
  openLinkedCommunityPost();
});

  $('loginBtn').onclick = () => runAuth('login');
  $('registerBtn').onclick = () => runAuth('register');
  ['displayName', 'account', 'password'].forEach((id) => {
    $(id).addEventListener('keydown', (event) => {
      if (event.key === 'Enter') runAuth(state.authMode);
    });
    $(id).addEventListener('input', () => setAuthStatus(''));
  });

  document.querySelectorAll('.recharge-plan').forEach((button) => {
    button.onclick = () => {
      state.rechargeAmount = Number(button.dataset.amount || 50);
      renderRechargeModal();
    };
  });

  $('redeemCodeBtn').onclick = redeemCurrentCode;
  $('adminCreateCodeBtn').onclick = createAdminRedeemCode;
  $('adminSaveBillingBtn').onclick = saveAdminBilling;
  $('adminSaveUpstreamBtn').onclick = saveAdminUpstream;
  $('adminAddImageUpstreamBtn').onclick = addAdminImageUpstream;
  $('adminImageUpstreamList').addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-admin-remove-upstream]');
    if (removeButton) removeAdminImageUpstream(removeButton.dataset.adminRemoveUpstream);
  });
  $('adminImageUpstreamList').addEventListener('change', (event) => {
    if (event.target?.dataset?.upstreamField === 'enabled') {
      const label = event.target.closest('.admin-upstream-toggle')?.querySelector('span');
      if (label) label.textContent = event.target.checked ? '启用' : '停用';
    }
  });
  $('redeemCodeInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') redeemCurrentCode();
  });
  $('redeemCodeInput').addEventListener('input', () => {
    $('rechargeNote').classList.remove('error-text');
  });

  document.querySelectorAll('[data-size]').forEach((button) => {
    button.onclick = () => {
      setSize(button.dataset.size);
      closePillMenus();
    };
  });
  document.querySelectorAll('[data-quality]').forEach((button) => {
    button.onclick = () => {
      setQuality(button.dataset.quality);
      closePillMenus();
    };
  });
  document.querySelectorAll('[data-format]').forEach((button) => {
    button.onclick = () => {
      setOutputFormat(button.dataset.format);
      closePillMenus();
    };
  });
  document.querySelectorAll('[data-count]').forEach((button) => {
    button.onclick = () => {
      setCount(button.dataset.count);
      closePillMenus();
    };
  });
  $('modeTabs')?.querySelectorAll('button').forEach((button) => {
    button.onclick = () => setMode(button.dataset.mode);
  });

  $('studioTemplateGrid')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-prompt]');
    if (button) {
      clearReferenceImage();
      renderReferencePreview();
      setMode('generate');
      $('prompt').value = button.dataset.prompt;
      state.prompts.generate = $('prompt').value;
      updatePromptCount();
      updateComposerPromptState();
      setStatus('已填入交流区模板提示词。');
      cueComposerFocus();
    }
  });

  $('prompt').addEventListener('input', () => {
    state.prompts[state.mode] = $('prompt').value;
    updatePromptCount();
    updateComposerPromptState();
  });
  $('optimizePromptBtn').onclick = optimizeCurrentPrompt;
  $('optimizePromptBtn').setAttribute('aria-label', '优化提示词');
  $('optimizePromptBtn').title = '优化提示词';

  $('imageInput').onchange = async () => {
    await readImageFiles($('imageInput').files);
    $('imageInput').value = '';
  };

  ['dragenter', 'dragover'].forEach((eventName) => {
    $('uploadBox').addEventListener(eventName, (event) => {
      event.preventDefault();
      state.dragDepth += eventName === 'dragenter' ? 1 : 0;
      $('uploadBox').classList.add('dragging');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    $('uploadBox').addEventListener(eventName, async (event) => {
      event.preventDefault();
      state.dragDepth = Math.max(0, state.dragDepth - 1);
      if (eventName === 'drop') {
        state.dragDepth = 0;
        await readImageFiles(event.dataTransfer?.files);
      }
      if (state.dragDepth === 0) $('uploadBox').classList.remove('dragging');
    });
  });

  $('generateBtn').onclick = async () => {
    await submitGeneration();
  };

  $('topupBtn').onclick = async () => {
    try {
      const data = await api('/api/admin/topup', {
        method: 'POST',
        body: { userId: $('topupUser').value, amountSingularity: Number($('topupAmount').value || 0) }
      });
      setStatus(`已给 ${data.user.username} 加余额。`);
      await renderAll();
    } catch (error) {
      setStatus(error.message, true);
    }
  };
  $('adminRefreshBtn').onclick = () => loadAdmin();
  $('adminConsoleNav').addEventListener('click', (event) => {
    const button = event.target.closest('[data-admin-tab]');
    if (!button) return;
    state.adminActiveTab = button.dataset.adminTab || 'overview';
    renderAdminConsole();
    if (state.adminActiveTab === 'generationLogs') loadAdminGenerationLogs().catch((error) => setStatus(`生图日志读取失败：${error.message}`, true));
    if (state.adminActiveTab === 'redeem') loadAdminRedeemCodes().catch((error) => setStatus(`卡密读取失败：${error.message}`, true));
  });
  $('adminOverviewSection')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-admin-tab-jump]');
    if (!button) return;
    state.adminActiveTab = button.dataset.adminTabJump || 'overview';
    renderAdminConsole();
    if (state.adminActiveTab === 'generationLogs') loadAdminGenerationLogs().catch((error) => setStatus(`生图日志读取失败：${error.message}`, true));
    if (state.adminActiveTab === 'redeem') loadAdminRedeemCodes().catch((error) => setStatus(`卡密读取失败：${error.message}`, true));
  });
  $('adminCreateRedeemBtn').onclick = createAdminRedeemCodeFromPanel;
  $('adminCopyRedeemBtn').onclick = copyAdminRedeemCodes;
  $('adminBatchRevokeRedeemBtn').onclick = batchRevokeAdminRedeemCodes;
  $('adminDownloadRedeemSelectedBtn')?.addEventListener('click', () => {
    downloadAdminRedeemExport('selected').catch((error) => setStatus(error.message, true));
  });
  $('adminDownloadRedeemFilteredBtn')?.addEventListener('click', () => {
    downloadAdminRedeemExport('filtered').catch((error) => setStatus(error.message, true));
  });
  $('adminDownloadRedeemCreatedBtn')?.addEventListener('click', () => {
    downloadAdminRedeemExport('created').catch((error) => setStatus(error.message, true));
  });
  $('adminRedeemPrevBtn')?.addEventListener('click', () => {
    if (state.adminRedeemPage <= 1) return;
    state.adminRedeemPage -= 1;
    loadAdminRedeemCodes().catch((error) => setStatus(`卡密读取失败：${error.message}`, true));
  });
  $('adminRedeemNextBtn')?.addEventListener('click', () => {
    state.adminRedeemPage += 1;
    loadAdminRedeemCodes().catch((error) => setStatus(`卡密读取失败：${error.message}`, true));
  });
  $('adminRedeemRefreshBtn')?.addEventListener('click', () => {
    loadAdminRedeemCodes().catch((error) => setStatus(`卡密读取失败：${error.message}`, true));
  });
  $('adminRedeemStatusFilter').onchange = () => {
    state.adminRedeemStatusFilter = $('adminRedeemStatusFilter').value || 'all';
    state.adminRedeemPage = 1;
    loadAdminRedeemCodes().catch((error) => setStatus(`卡密读取失败：${error.message}`, true));
  };
  $('adminRedeemSearch').oninput = () => {
    state.adminRedeemSearch = $('adminRedeemSearch').value || '';
    state.adminRedeemPage = 1;
    scheduleAdminRedeemSearch(() => {
      loadAdminRedeemCodes().catch((error) => setStatus(`卡密读取失败：${error.message}`, true));
    });
  };
  $('adminCreateUserBtn').onclick = createAdminUser;
  $('adminUserSearch').oninput = () => {
    state.adminUserSearch = $('adminUserSearch').value || '';
    renderAdminUsers(state.adminUsers);
  };
  $('adminGenerationLogSearch')?.addEventListener('input', () => {
    state.adminGenerationLogSearch = $('adminGenerationLogSearch').value || '';
    state.adminGenerationLogPage = 1;
    scheduleAdminGenerationLogSearch(() => loadAdminGenerationLogs({ silent: true }).catch((error) => setStatus(`生图日志读取失败：${error.message}`, true)));
  });
  ['adminGenerationLogUserFilter', 'adminGenerationLogStatusFilter', 'adminGenerationLogModeFilter', 'adminGenerationLogSourceFilter'].forEach((id) => {
    $(id)?.addEventListener('change', () => {
      state.adminGenerationLogUserId = $('adminGenerationLogUserFilter')?.value || '';
      state.adminGenerationLogStatus = $('adminGenerationLogStatusFilter')?.value || 'all';
      state.adminGenerationLogMode = $('adminGenerationLogModeFilter')?.value || 'all';
      state.adminGenerationLogSource = $('adminGenerationLogSourceFilter')?.value || 'all';
      state.adminGenerationLogPage = 1;
      loadAdminGenerationLogs({ silent: true }).catch((error) => setStatus(`生图日志读取失败：${error.message}`, true));
    });
  });
  $('adminGenerationLogRefreshBtn')?.addEventListener('click', () => loadAdminGenerationLogs().catch((error) => setStatus(`生图日志读取失败：${error.message}`, true)));
  $('adminGenerationLogPrevBtn')?.addEventListener('click', () => {
    state.adminGenerationLogPage = Math.max(1, Number(state.adminGenerationLogPage || 1) - 1);
    loadAdminGenerationLogs().catch((error) => setStatus(`生图日志读取失败：${error.message}`, true));
  });
  $('adminGenerationLogNextBtn')?.addEventListener('click', () => {
    state.adminGenerationLogPage = Number(state.adminGenerationLogPage || 1) + 1;
    loadAdminGenerationLogs().catch((error) => setStatus(`生图日志读取失败：${error.message}`, true));
  });
  $('adminConsolePanel')?.addEventListener('click', (event) => {
    const openButton = event.target.closest('[data-admin-community-open]');
    if (openButton) {
      event.preventDefault();
      switchPanel('prompts');
      openCommunityDetail(openButton.dataset.adminCommunityOpen, { updateUrl: true });
      return;
    }
    const revokeCodeButton = event.target.closest('[data-admin-revoke-code]');
    if (revokeCodeButton) {
      event.preventDefault();
      revokeAdminRedeemCode(revokeCodeButton.dataset.adminRevokeCode, revokeCodeButton);
      return;
    }
    const redeemSelect = event.target.closest('[data-admin-redeem-select]');
    if (redeemSelect) {
      toggleAdminRedeemSelection(redeemSelect.dataset.adminRedeemSelect, redeemSelect.checked);
      return;
    }
    const resetButton = event.target.closest('[data-admin-reset-password]');
    if (resetButton) {
      event.preventDefault();
      resetAdminUserPassword(resetButton.dataset.adminResetPassword);
      return;
    }
    const statusButton = event.target.closest('[data-admin-user-status]');
    if (statusButton) {
      event.preventDefault();
      updateAdminUserStatus(statusButton.dataset.adminUserStatus, statusButton.dataset.nextStatus);
      return;
    }
    const deleteButton = event.target.closest('[data-admin-delete-user]');
    if (deleteButton) {
      event.preventDefault();
      deleteAdminUser(deleteButton.dataset.adminDeleteUser, deleteButton);
    }
  });
}

restoreTheme();
restoreHistoryWidth();
restoreComposerHeight();
initSelectionMask({
  setStatus,
  syncModalState
});
initCommunityView({
  cleanDisplayText: cleanCommunityDisplayText,
  feedbackQuestion: communityFeedbackQuestion,
  reuseInsightText: communityReuseInsightText,
  creatorPrimaryAction: communityCreatorPrimaryAction,
  creatorNextStep: communityCreatorNextStep,
  isOwnPost: isOwnCommunityPost,
  isDownloadPending: isCommunityDownloadPending,
  isActionPending: isCommunityActionPending
});
initAgentController({
  setStatus,
  openAuthModal,
  formatError: friendlyOptimizeError
});
initApiDocsController({
  setStatus,
  openAuthModal
});
initOriginalViewerController({
  setStatus,
  syncModalState
});
initStoryboardController({
  setStatus,
  openAuthModal,
  saveCurrentPrompt,
  updatePromptCount,
  updateComposerPromptState,
  formatError: friendlyOptimizeError
});
initSourceImages({
  setMode,
  setStatus,
  openSelectionModal
});
initGenerationRunner({
  hasActiveMask,
  isCurrentSubmitSeq: isCurrentGenerationActivity,
  setStatus,
  setPreviewMeta
});
initHistoryController({
  setStatus,
  openAuthModal,
  openCommunityPublish,
  applyGenerationSettings,
  renderPreviewEmpty
});
initGenerationHistoryActions({
  setStatus,
  setPreviewMeta,
  loadMe,
  loadHistory
});
initGenerationSettingsController({
  setPreferredStudioRoute: (path) => {
    preferredStudioRoute = path || preferredStudioRoute;
  },
  switchPanel,
  clearReferenceImage,
  renderReferencePreview,
  setMode,
  setQuality,
  setSize,
  setOutputFormat,
  setCount,
  setLayout,
  updatePromptCount,
  updateComposerPromptState,
  cueComposerFocus,
  clearCommunityReuseSource,
  renderCommunityReuseSourceBar,
  submitGeneration,
  setStatus
});
initPreviewController({
  setStatus,
  setPreviewMeta,
  friendlyGenerateError,
  applyGenerationSettings,
  openRechargeModal,
  addReferenceImage,
  renderReferencePreview,
  setMode,
  switchPanel,
  cueComposerFocus,
  openOriginalViewer,
  openCommunityPublish,
  openCommunityDetail,
  shareCommunityPost,
  setPreferredStudioRoute: (path) => {
    preferredStudioRoute = path || preferredStudioRoute;
  }
});
initHistoryPanel({
  formatGenerateError: friendlyGenerateError,
  clearFilters: clearHistoryFilters,
  delete: deleteHistoryGeneration,
  reuse: reuseHistoryGeneration,
  resumePending: resumePendingGeneration,
  publish: publishHistoryGeneration,
  communityDownload: downloadCommunityPost,
  shareCommunity: shareCommunityPost,
  viewCommunity: openCommunityDetail,
  creatorNext: runCreatorCardAction,
  openGeneration: openHistoryGeneration,
  addToCanvas: addHistoryGenerationToCanvas
});
initInfiniteCanvas({ onStatus: setStatus });
bindEvents();
const initialPanel = panelFromPath();
if (initialPanel !== 'admin') {
  switchPanel(initialPanel, { updateUrl: false });
}
await refreshHealth();
if (panelFromPath() === 'prompts') await loadPromptLibrary();
await loadStudioTemplates({ silent: true });
await loadMe();
switchPanel(panelFromPath(), { updateUrl: false });
document.addEventListener('load', (event) => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.matches('img[data-result-image]')) {
    setResultImageState(image, 'loaded');
  }
}, true);
document.addEventListener('error', (event) => {
  const image = event.target;
  if (image instanceof HTMLImageElement && image.matches('img[data-result-image]')) {
    setResultImageState(image, 'broken');
  }
}, true);
await renderAll();
syncPanelWithLocation();
await openLinkedCommunityPost();
