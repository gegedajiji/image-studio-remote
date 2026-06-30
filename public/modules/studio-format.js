import { state } from './state.js';
import { $ } from './dom.js';
import {
  agentModelLabels,
  formatLabels,
  qualityLabels,
  sizeLabels
} from './constants.js';
import { escapeHtml, yuan } from './format.js';
import { outputFormatForImage, parseImageSize } from './image-utils.js';

export function modeLabel(mode = state.mode) {
  return mode === 'edit' ? '图生图' : '文生图';
}

export function selectedPriceText() {
  const label = qualityLabels[state.quality] || '标准';
  const formatNote = (state.outputFormat || 'jpeg').toUpperCase();
  return `${modeLabel()} · ${label} · ${formatNote} · ${state.count} 张 · ${yuan((state.prices[state.quality] || 0) * state.count)}`;
}

export function selectedPriceCompactText() {
  const total = (state.prices[state.quality] || 0) * state.count;
  return `预计 ${yuan(total)} · 成功后扣费`;
}

export function stripSpecPrefix(text, prefix) {
  return String(text || '').replace(new RegExp(`^${prefix}\\s*`), '').trim();
}

export function setSpecLabel(id, label, value) {
  const node = $(id);
  if (!node) return;
  node.classList.add('spec-label');
  node.innerHTML = `<small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong>`;
}

export function renderSpecLabels() {
  const size = sizeLabels[state.size] || sizeLabels['1024x1024'];
  setSpecLabel('sizeLabel', size.ratio, size.size);
  setSpecLabel('qualityLabel', '质量', stripSpecPrefix(qualityLabels[state.quality] || '质量 1K', '质量'));
  setSpecLabel('formatLabel', '格式', stripSpecPrefix(formatLabels[state.outputFormat] || '格式 JPEG', '格式'));
  setSpecLabel('countLabel', '数量', String(state.count));
}

export function qualityLabel(quality) {
  return { '1k': '质量 1K', '2k': '质量 2K' }[quality] || '历史规格';
}

export function sizeLabelText(size) {
  const label = sizeLabels[size] || sizeLabels['1024x1024'];
  return `${label.ratio} ${label.size}`;
}

export function formatResultLabel(format) {
  return (format || 'jpeg').toUpperCase().replace('JPEG', 'JPG');
}

export function resultMetaText(item, index = 0) {
  if (item?.layout === 'storyboard') {
    const scenePrompt = Array.isArray(item.storyboardPrompts) ? String(item.storyboardPrompts[index] || '').trim() : '';
    return [
      `第 ${index + 1} 幕`,
      scenePrompt ? scenePrompt.slice(0, 22) : null
    ].filter(Boolean).join(' · ');
  }
  const outputFormat = item?.images?.[index]?.outputFormat || item?.outputFormat || state.outputFormat;
  return [
    `原生 ${sizeLabelText(item?.size)}`,
    formatResultLabel(outputFormat),
    qualityLabel(item?.quality)
  ].join(' · ');
}

export function originalViewerMeta(item, index) {
  const outputFormat = outputFormatForImage(item?.images?.[index] || item, item?.outputFormat || state.outputFormat);
  const { width, height } = parseImageSize(item?.size);
  return [
    width && height ? `${width} x ${height}` : '原始尺寸',
    outputFormat ? outputFormat.toUpperCase() : ''
  ].filter(Boolean).join(' · ');
}

export function agentModelLabel(model) {
  return agentModelLabels[model] || '自定义模型';
}

export function trimmedTitle(value, maxLength = 28) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '未命名任务';
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1))}…`;
}

export function redeemStatusText(status) {
  if (status === 'used') return '已兑换';
  if (status === 'revoked') return '已撤销';
  return '未使用';
}

export function userStatusText(status) {
  if (status === 'disabled') return '已禁用';
  if (status === 'deleted') return '已删除';
  return '正常';
}

export function generationStatusText(status) {
  if (status === 'succeeded') return '成功';
  if (status === 'failed') return '失败';
  if (status === 'pending') return '生成中';
  return '未知';
}

export function generationModeText(mode) {
  return mode === 'edit' ? '图生图' : '文生图';
}

export function redeemStatusForClass(status) {
  if (status === 'active') return 'active';
  if (status === 'used') return 'used';
  if (status === 'revoked') return 'deleted';
  return '';
}

export function sourceText(source) {
  return source === 'api' ? 'API' : '网页';
}

export function billingStateText(stateText) {
  if (stateText === 'refunded') return '已退款';
  if (stateText === 'charged') return '已扣费';
  return '未扣费';
}

export function durationText(value) {
  const ms = Number(value || 0);
  if (!ms) return '-';
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}
