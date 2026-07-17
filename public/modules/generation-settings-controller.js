import { state } from './state.js';
import { $ } from './dom.js';

let callbacks = {
  setPreferredStudioRoute: () => {},
  switchPanel: () => {},
  clearReferenceImage: () => {},
  renderReferencePreview: () => {},
  setMode: () => {},
  setQuality: () => {},
  setSize: () => {},
  setImageModel: () => {},
  setOutputFormat: () => {},
  setCount: () => {},
  setLayout: () => {},
  updatePromptCount: () => {},
  updateComposerPromptState: () => {},
  cueComposerFocus: () => {},
  clearCommunityReuseSource: () => {},
  renderCommunityReuseSourceBar: () => {},
  submitGeneration: async () => {},
  setStatus: () => {}
};

export function initGenerationSettingsController(nextCallbacks = {}) {
  callbacks = { ...callbacks, ...nextCallbacks };
}

export function applyGenerationSettings(item, { submit = false, statusText = '已回填生成参数。', preserveReferenceImage = false } = {}) {
  if (!item) return;
  callbacks.setPreferredStudioRoute('/image/workspace');
  callbacks.switchPanel('studio', { path: '/image/workspace' });

  if (!preserveReferenceImage) {
    callbacks.clearReferenceImage();
    callbacks.renderReferencePreview();
  }

  callbacks.setMode(item.mode === 'edit' ? 'edit' : 'generate');
  if (item.quality) callbacks.setQuality(item.quality);
  if (item.size) callbacks.setSize(item.size);
  if (item.model || item.imageModel || item.metadata?.requestedModel || item.metadata?.upstreamModel) {
    callbacks.setImageModel(item.model || item.imageModel || item.metadata?.requestedModel || item.metadata?.upstreamModel);
  }
  if (item.outputFormat) callbacks.setOutputFormat(item.outputFormat);
  if (item.count) callbacks.setCount(item.count);
  if (item.layout) callbacks.setLayout(item.layout);

  const prompt = $('prompt');
  if (prompt) {
    prompt.value = item.prompt || '';
    state.prompts[state.mode] = prompt.value;
  }
  callbacks.updatePromptCount();
  callbacks.updateComposerPromptState();
  callbacks.cueComposerFocus({ focusPrompt: !submit });

  if (!/同款|参考/.test(String(statusText || ''))) {
    callbacks.clearCommunityReuseSource();
  } else {
    callbacks.renderCommunityReuseSourceBar();
  }

  if (submit) {
    callbacks.submitGeneration(statusText).catch((error) => callbacks.setStatus(error.message, true));
  } else {
    callbacks.setStatus(statusText);
  }
}
