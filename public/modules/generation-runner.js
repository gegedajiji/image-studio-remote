import { state } from './state.js';
import { api, apiForm } from './api-client.js';
import { dataUrlToBlob, sleep } from './format.js';

let callbacks = {
  hasActiveMask: () => false,
  isCurrentSubmitSeq: () => true,
  setStatus: () => {},
  setPreviewMeta: () => {}
};

export function initGenerationRunner(nextCallbacks = {}) {
  callbacks = { ...callbacks, ...nextCallbacks };
}

export function buildGenerationPayload({ prompt, imageDataUrls, storyboardPrompts, reusePostId, reuseIntentToken }) {
  return {
    prompt,
    quality: state.quality,
    size: state.size,
    outputFormat: state.outputFormat,
    count: state.count,
    layout: state.layout,
    storyboardPrompts,
    storyboardText: storyboardPrompts.join('\n'),
    mode: state.mode,
    imageDataUrl: imageDataUrls[0] || '',
    imageDataUrls,
    maskDataUrl: state.mode === 'edit' && callbacks.hasActiveMask() ? state.maskDataUrl : '',
    reusePostId,
    reuseIntentToken
  };
}

function generationFormData(payload) {
  const form = new FormData();
  Object.entries(payload).forEach(([key, value]) => {
    if (key === 'imageDataUrls' || key === 'imageDataUrl' || key === 'maskDataUrl') return;
    if (Array.isArray(value)) {
      value.forEach((item) => form.append(key, String(item || '')));
    } else {
      form.set(key, String(value ?? ''));
    }
  });
  (payload.imageDataUrls || []).slice(0, 4).forEach((dataUrl, index) => {
    const blob = dataUrlToBlob(dataUrl);
    const extension = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    form.append('images', blob, `source-${index + 1}.${extension}`);
  });
  if (payload.maskDataUrl) {
    const blob = dataUrlToBlob(payload.maskDataUrl);
    form.set('mask', blob, blob.type === 'image/png' ? 'mask.png' : 'mask.jpg');
  }
  return form;
}

export async function submitGenerationRequest(payload, { mode = state.mode } = {}) {
  return mode === 'edit'
    ? apiForm('/api/generate?async=1', generationFormData(payload))
    : api('/api/generate?async=1', { method: 'POST', body: payload });
}

export async function pollGenerationResult(generationId, submitSeq) {
  const startedAt = Date.now();
  let intervalMs = 1200;
  while (Date.now() - startedAt < 45 * 60 * 1000) {
    await sleep(intervalMs);
    const data = await api(`/api/generate/${encodeURIComponent(generationId)}`);
    const item = data.generation;
    if (!item || !callbacks.isCurrentSubmitSeq(submitSeq)) return data;
    if (item.status === 'succeeded' || item.status === 'failed') return data;
    const elapsedSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    callbacks.setStatus(elapsedSeconds > 60 ? `任务生成中，已等待 ${Math.round(elapsedSeconds / 60)} 分钟。` : '任务生成中，正在等待上游返回。');
    const activeQueueCount = Number(data.queue?.active || 0);
    callbacks.setPreviewMeta(activeQueueCount > 0 ? `生成中 · 队列运行 ${activeQueueCount}` : '生成中 · 后台任务运行中');
    intervalMs = Math.min(5000, Math.round(intervalMs * 1.2));
  }
  throw new Error('生成任务等待超时，请到历史记录查看最终状态；失败会自动退款。');
}

export function createLongGenerationTimers(submitSeq) {
  return [
    window.setTimeout(() => {
      if (callbacks.isCurrentSubmitSeq(submitSeq)) {
        callbacks.setStatus('任务还在生成中，多图或高清任务可能需要 1-3 分钟，请不要刷新页面。');
        callbacks.setPreviewMeta('生成中 · 正在等待上游返回');
      }
    }, 45000),
    window.setTimeout(() => {
      if (callbacks.isCurrentSubmitSeq(submitSeq)) {
        callbacks.setStatus('仍在生成中。如果上游超时，系统会自动切换通道或退款并保留失败日志。');
        callbacks.setPreviewMeta('生成中 · 正在容错重试');
      }
    }, 90000)
  ];
}

export function clearGenerationTimers(timers = []) {
  timers.forEach((timer) => window.clearTimeout(timer));
}
