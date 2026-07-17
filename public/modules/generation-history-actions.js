import { state } from './state.js';
import { api } from './api-client.js';
import { itemImageSource } from './image-utils.js';
import { pollGenerationResult } from './generation-runner.js';
import { beginGenerationActivity, finishGenerationActivity, isCurrentGenerationActivity } from './generation-session.js';
import { friendlyGenerateError, generationPreviewMeta } from './generation-result.js';
import {
  addGenerationImageToCanvas,
  pendingGenerationMeta,
  renderFailedGeneration,
  renderGeneratingPreview,
  showGenerationInPreview
} from './preview-controller.js';

let callbacks = {
  setStatus: () => {},
  setPreviewMeta: () => {},
  loadMe: async () => {},
  loadHistory: async () => {}
};

export function initGenerationHistoryActions(nextCallbacks = {}) {
  callbacks = { ...callbacks, ...nextCallbacks };
}

export async function addHistoryGenerationToCanvas(id) {
  const summary = state.historyItems.find((entry) => entry.id === id);
  if (!summary) return;
  if (summary.status === 'pending') return callbacks.setStatus('这条任务还在生成中，完成后再放到画布。', true);
  if (summary.status === 'failed') return callbacks.setStatus('失败记录没有可用图片。', true);
  try {
    let item = summary;
    if (!itemImageSource(item, 0)) {
      const data = await api(`/api/history/${encodeURIComponent(id)}`);
      item = data.generation || summary;
    }
    await addGenerationImageToCanvas(item, 0, '已从历史记录放到无限画布。');
  } catch (error) {
    callbacks.setStatus(error.message, true);
  }
}

export async function openHistoryGeneration(id) {
  const summary = state.historyItems.find((item) => item.id === id);
  if (!summary) return;
  if (summary.status === 'pending') {
    resumePendingGeneration(id, summary);
    return;
  }
  if (summary.status === 'failed') {
    showGenerationInPreview(summary);
    return;
  }
  callbacks.setStatus('正在读取历史图片…');
  try {
    const data = await api(`/api/history/${encodeURIComponent(id)}`);
    showGenerationInPreview(data.generation);
    callbacks.setStatus('已打开历史作品。');
  } catch (error) {
    callbacks.setStatus(error.message, true);
  }
}

export async function resumePendingGeneration(id, summary = null) {
  if (!id) return;
  const submitSeq = beginGenerationActivity();
  renderGeneratingPreview(summary);
  callbacks.setPreviewMeta(pendingGenerationMeta(summary));
  callbacks.setStatus('已回到正在生成的任务，正在等待上游返回。');
  try {
    let data = await api(`/api/generate/${encodeURIComponent(id)}`);
    let item = data.generation;
    if (item?.status === 'pending') {
      data = await pollGenerationResult(id, submitSeq);
      item = data.generation;
    }
    if (data.user) state.user = data.user;
    await callbacks.loadMe();
    await callbacks.loadHistory();
    if (!isCurrentGenerationActivity(submitSeq)) return;
    document.getElementById('preview')?.classList.remove('loading');
    if (item?.status === 'failed') {
      const failedMessage = friendlyGenerateError(item.error || '生成失败');
      renderFailedGeneration(item, failedMessage);
      callbacks.setStatus(failedMessage, true);
      return;
    }
    if (item?.status === 'succeeded') {
      showGenerationInPreview(item);
      callbacks.setStatus('生成完成，已回到这次任务的结果。');
      callbacks.setPreviewMeta(generationPreviewMeta(item, 1));
      return;
    }
    renderGeneratingPreview(item || summary);
    callbacks.setPreviewMeta(pendingGenerationMeta(item || summary));
    callbacks.setStatus('任务仍在生成中，可以稍后从历史继续查看。');
  } catch (error) {
    if (!isCurrentGenerationActivity(submitSeq)) {
      await callbacks.loadHistory();
      return;
    }
    const pendingGeneration = error.payload?.generation?.status === 'pending' ? error.payload.generation : null;
    if (error.generationStillPending || pendingGeneration) {
      renderGeneratingPreview(pendingGeneration || summary);
      callbacks.setPreviewMeta(pendingGeneration ? pendingGenerationMeta(pendingGeneration) : '生成中 · 状态读取暂时中断');
      callbacks.setStatus(error.message || '任务仍在后台生成，可以稍后从历史记录继续查看。');
      await callbacks.loadHistory();
      return;
    }
    document.getElementById('preview')?.classList.remove('loading');
    const failedMessage = friendlyGenerateError(error.payload?.generation?.error || error.message);
    renderFailedGeneration(error.payload?.generation || summary, failedMessage);
    callbacks.setStatus(failedMessage, true);
    await callbacks.loadHistory();
  } finally {
    finishGenerationActivity(submitSeq);
  }
}
