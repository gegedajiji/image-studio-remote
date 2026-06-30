import { state } from './state.js';
import { $, scrollIntoViewSafe } from './dom.js';
import { copyText, escapeHtml } from './format.js';
import { imageSources, itemImageSource, sourceToDataUrl } from './image-utils.js';
import { addImageToCanvas, openInfiniteCanvas } from './infinite-canvas-entry.js';
import { renderGeneratedImagesHtml } from './result-view.js';
import { qualityLabel, resultMetaText, sizeLabelText, trimmedTitle } from './studio-format.js';
import { scheduleResultLayoutSettle } from './workspace-ui.js';

let callbacks = {
  setStatus: () => {},
  setPreviewMeta: () => {},
  friendlyGenerateError: (message) => String(message || '生成失败'),
  applyGenerationSettings: () => {},
  openRechargeModal: () => {},
  addReferenceImage: () => false,
  renderReferencePreview: () => {},
  setMode: () => {},
  switchPanel: () => {},
  cueComposerFocus: () => {},
  openOriginalViewer: () => {},
  openCommunityPublish: () => {},
  openCommunityDetail: async () => {},
  shareCommunityPost: async () => {},
  setPreferredStudioRoute: () => {}
};
let canvasOptions = {};

export function initPreviewController(nextCallbacks = {}) {
  callbacks = { ...callbacks, ...nextCallbacks };
  canvasOptions = { onStatus: callbacks.setStatus };
}

function syncPreviewStateClass() {
  const preview = $('preview');
  const isLoading = state.previewState === 'loading' || Boolean(preview?.classList.contains('loading'));
  const hasResult = ['result', 'failed'].includes(state.previewState) || Boolean(preview?.classList.contains('has-result'));
  document.body.classList.toggle('preview-loading', isLoading);
  document.body.classList.toggle('preview-result', hasResult);
  document.body.classList.toggle('preview-empty', !isLoading && !hasResult);
}

function setStudioSessionActive(active) {
  document.body.classList.toggle('studio-session-active', Boolean(active));
  syncPreviewStateClass();
}

export function renderPreviewEmpty() {
  const preview = $('preview');
  if (!preview) return;
  state.previewState = 'empty';
  state.previewItem = null;
  setStudioSessionActive(false);
  document.querySelector('.result-thread')?.classList.remove('is-visible');
  preview.classList.remove('loading', 'has-result');
  syncPreviewStateClass();
  preview.innerHTML = `
    <div class="preview-empty">
      <img src="/assets/showcase/hero-studio.svg" alt="生成预览占位" />
      <h3>等待生成</h3>
      <p>结果会显示在这里，成功后可直接下载，也可以上传到交流区邀请点赞和评论。</p>
    </div>
  `;
  syncPreviewStateClass();
}

export function renderGeneratedImages(item) {
  const preview = $('preview');
  if (!preview) return;
  const sources = imageSources(item);
  if (!sources.length) {
    renderPreviewEmpty();
    return;
  }
  state.previewState = 'result';
  state.previewItem = item;
  setStudioSessionActive(true);
  document.querySelector('.result-thread')?.classList.add('is-visible');
  preview.classList.remove('loading');
  syncPreviewStateClass();
  preview.innerHTML = renderGeneratedImagesHtml(item);
  preview.classList.add('has-result');
  syncPreviewStateClass();
  bindResultImageStates();
  bindResultActions(item);
  scheduleResultLayoutSettle();
}

export function setResultImageState(image, nextState) {
  const frame = image?.closest?.('.result-image-frame');
  if (!frame) return;
  frame.classList.remove('is-loading', 'is-loaded', 'is-broken');
  frame.classList.add(`is-${nextState}`);
  image.dataset.loadState = nextState;
}

function bindResultImageStates() {
  document.querySelectorAll('.result-image-frame img[data-result-image]').forEach((image) => {
    const markLoaded = () => setResultImageState(image, 'loaded');
    const markBroken = () => setResultImageState(image, 'broken');
    setResultImageState(image, 'loading');
    if (image.complete) {
      if (image.naturalWidth > 0) markLoaded();
      else markBroken();
    }
    image.onload = markLoaded;
    image.onerror = markBroken;
  });
}

export function renderFailedGeneration(item, message) {
  const preview = $('preview');
  if (!preview) return;
  state.previewState = 'failed';
  state.previewItem = item || null;
  setStudioSessionActive(true);
  document.querySelector('.result-thread')?.classList.add('is-visible');
  const failedMessage = callbacks.friendlyGenerateError(message || item?.error || '生成失败');
  preview.classList.remove('loading');
  syncPreviewStateClass();
  preview.innerHTML = `
    <div class="preview-empty failed-preview">
      <img src="/assets/showcase/cyber-city.svg" alt="生成失败" />
      <h3>生成失败</h3>
      <p>${escapeHtml(failedMessage)}</p>
      <small>${item?.id ? '失败记录已保存，本次失败已自动退款。' : '本次没有产生可保存的生成记录。'}</small>
      <div class="result-actions">
        ${item?.id ? '<button type="button" data-failed-action="retry">重试同参数</button>' : ''}
        ${item?.prompt ? '<button type="button" data-failed-action="reuse">修改提示词</button>' : ''}
        <button type="button" data-failed-action="recharge">去充值</button>
      </div>
    </div>
  `;
  preview.classList.add('has-result');
  syncPreviewStateClass();
  scheduleResultLayoutSettle();
  callbacks.setPreviewMeta('生成失败');
  document.querySelectorAll('[data-failed-action]').forEach((button) => {
    button.onclick = () => {
      const action = button.dataset.failedAction;
      if (action === 'retry') return callbacks.applyGenerationSettings(item, { submit: true, statusText: '正在按失败记录重试…' });
      if (action === 'reuse') return callbacks.applyGenerationSettings(item, { submit: false, statusText: '已回填失败任务参数，可修改后再生成。' });
      if (action === 'recharge') return callbacks.openRechargeModal();
    };
  });
}

function generationCanvasTitle(item, index = 0) {
  const baseTitle = item?.communityPost?.title || item?.title || trimmedTitle(item?.prompt || '生成图片', 24);
  const total = imageSources(item).length;
  return total > 1 ? `${baseTitle} #${index + 1}` : baseTitle;
}

export async function addGenerationImageToCanvas(item, index = 0, statusText = '已放到无限画布。') {
  const src = itemImageSource(item, index);
  if (!src) return callbacks.setStatus('图片不存在，不能放到画布。', true);
  await addImageToCanvas({
    src,
    title: generationCanvasTitle(item, index),
    prompt: item?.prompt || '',
    generationId: item?.id || '',
    imageIndex: index,
    meta: resultMetaText(item, index)
  }, canvasOptions);
  openInfiniteCanvas(canvasOptions);
  callbacks.setStatus(statusText);
}

function retryResultImage(index, src) {
  const image = document.querySelector(`img[data-result-image="${index}"]`);
  const frame = image?.closest('.result-image-frame');
  const retrySrc = image?.dataset.resultSrc || src;
  if (!image || !retrySrc) return;
  frame?.classList.remove('is-broken', 'is-loaded');
  frame?.classList.add('is-loading');
  const separator = retrySrc.includes('?') ? '&' : '?';
  image.src = `${retrySrc}${separator}retry=${Date.now()}`;
}

async function useResultAsReference(item, index, action) {
  const src = itemImageSource(item, index);
  callbacks.setPreferredStudioRoute('/image/workspace');
  const added = callbacks.addReferenceImage(await sourceToDataUrl(src), { replace: true, label: '结果图' });
  if (!added) return callbacks.setStatus('结果图引用失败，请重试。', true);
  callbacks.renderReferencePreview();
  callbacks.setMode('edit');
  callbacks.switchPanel('studio', { path: '/image/workspace' });
  callbacks.setStatus(action === 'edit' ? '已替换为结果图，可继续编辑。' : '已替换当前源图。');
  callbacks.cueComposerFocus({ focusPrompt: true });
}

function bindResultActions(item) {
  document.querySelectorAll('[data-result-action]').forEach((button) => {
    button.onclick = async (event) => {
      const action = event.currentTarget.dataset.resultAction;
      const index = Number(event.currentTarget.dataset.resultIndex || 0);
      const src = itemImageSource(item, index);
      try {
        if (action === 'retryImage') {
          retryResultImage(index, src);
          return;
        }
        if (action === 'reference' || action === 'edit') {
          await useResultAsReference(item, index, action);
          return;
        }
        if (action === 'copy') {
          await copyText(item.prompt || '');
          callbacks.setStatus('提示词已复制。');
          return;
        }
        if (action === 'viewOriginal') {
          callbacks.openOriginalViewer(src, item, index);
          return;
        }
        if (action === 'canvas') {
          await addGenerationImageToCanvas(item, index);
          return;
        }
        if (action === 'publish') {
          callbacks.openCommunityPublish(item, index);
          return;
        }
        if (action === 'viewCommunity') {
          await callbacks.openCommunityDetail(event.currentTarget.dataset.communityPostId, { updateUrl: true });
          return;
        }
        if (action === 'shareCommunity') {
          await callbacks.shareCommunityPost(event.currentTarget.dataset.communityPostId);
          return;
        }
        if (action === 'rerun') {
          callbacks.applyGenerationSettings(item, { submit: true, statusText: '正在重新生成…' });
        }
      } catch (error) {
        callbacks.setStatus(error.message, true);
      }
    };
  });
}

export function showGenerationInPreview(item) {
  if (!item) {
    renderPreviewEmpty();
    return;
  }
  setStudioSessionActive(true);
  document.querySelector('.result-thread')?.classList.add('is-visible');
  scheduleResultLayoutSettle();
  if (item.status === 'pending') {
    renderGeneratingPreview(item);
  } else if (item.status === 'failed') {
    renderFailedGeneration(item);
  } else {
    renderGeneratedImages(item);
    callbacks.setPreviewMeta(`${qualityLabel(item.quality)} · ${sizeLabelText(item.size)} · ${item.count || imageSources(item).length || 1} 张`);
  }
  scrollIntoViewSafe(document.querySelector('.result-thread'), { behavior: 'smooth', block: 'start' });
  scheduleResultLayoutSettle();
}

export function pendingGenerationMeta(item) {
  if (!item) return '生成中 · 后台任务运行中';
  return `${qualityLabel(item.quality)} · ${sizeLabelText(item.size)} · ${item.count || 1} 张 · 生成中`;
}

export function renderGeneratingPreview(item = null) {
  const preview = $('preview');
  if (!preview) return;
  state.previewState = 'loading';
  state.previewItem = item;
  setStudioSessionActive(true);
  const thread = document.querySelector('.result-thread');
  thread?.classList.add('is-visible');
  preview.classList.remove('has-result');
  preview.classList.add('loading');
  syncPreviewStateClass();
  preview.innerHTML = `
    <div class="generating-stage">
      <div class="breathing-frame centered-candidate-frame">
        <div class="breathing-image"></div>
        <div class="breathing-line line-one"></div>
        <div class="breathing-line line-two"></div>
        <div class="breathing-line line-three"></div>
      </div>
      <div class="generating-copy">
        <strong>图片生成中</strong>
        <p>任务已经提交，生成完成后会自动显示在这里。高质量或多张图片可能需要更久。</p>
      </div>
    </div>
  `;
  scrollIntoViewSafe(thread, { behavior: 'smooth', block: 'start' });
  scheduleResultLayoutSettle();
}
