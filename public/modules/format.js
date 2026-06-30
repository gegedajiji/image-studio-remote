export function yuan(cents) {
  return `${(Number(cents || 0) / 100).toFixed(2)} 奇点`;
}

export function singularity(cents) {
  return yuan(cents);
}

export function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function dataUrlToBlob(dataUrl) {
  const match = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!match) throw new Error('源图格式无效，请重新上传。');
  const mimeType = match[1];
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export async function copyText(text) {
  const value = String(text || '').trim();
  if (!value) throw new Error('没有可复制内容');
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  textarea.remove();
  if (!ok) throw new Error('复制失败');
}

export function parseYuanToCents(input, { label, optional = false } = {}) {
  const text = String(input ?? '').trim();
  if (!text) return optional ? 0 : NaN;
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    throw new Error(`${label}最多支持两位小数。`);
  }
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`${label}格式不正确。`);
  return Math.round(value * 100);
}

export function parseSingularityToCents(input, options = {}) {
  return parseYuanToCents(input, options);
}

export function formatDate(value) {
  const timestamp = Number(value || 0);
  if (!timestamp) return '刚刚';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
}
