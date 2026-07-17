import { mimeByFormat } from './constants.js';

export function imageSrc(item) {
  if (item?.imageUrl) return item.imageUrl;
  if (item?.imageBase64) return `data:${item.mimeType || mimeByFormat[item.outputFormat] || 'image/png'};base64,${item.imageBase64}`;
  return '';
}

export function imageSources(item) {
  if (Array.isArray(item?.images) && item.images.length) {
    return item.images
      .map((image) => image.imageUrl || (image.imageBase64 ? `data:${image.mimeType || mimeByFormat[image.outputFormat] || 'image/png'};base64,${image.imageBase64}` : ''))
      .filter(Boolean);
  }
  const src = imageSrc(item);
  return src ? [src] : [];
}

export function itemImageSource(item, index = 0) {
  const sources = imageSources(item);
  return sources[index] || sources[0] || '';
}

export function imageEntries(item) {
  if (Array.isArray(item?.images) && item.images.length) {
    return item.images
      .map((image, index) => ({
        index,
        src: image.imageUrl || (image.imageBase64 ? `data:${image.mimeType || mimeByFormat[image.outputFormat] || 'image/png'};base64,${image.imageBase64}` : ''),
        image
      }))
      .filter((entry) => entry.src);
  }
  const src = imageSrc(item);
  return src ? [{ index: 0, src, image: item }] : [];
}

export function normalizeImageIndexSelection(indexes, entries, fallbackIndex = 0) {
  const valid = new Set(entries.map((entry) => entry.index));
  const selected = [];
  (Array.isArray(indexes) ? indexes : [fallbackIndex]).forEach((value) => {
    const index = Math.trunc(Number(value));
    if (!Number.isInteger(index) || !valid.has(index) || selected.includes(index)) return;
    selected.push(index);
  });
  if (!selected.length && entries.length) {
    const fallback = Math.trunc(Number(fallbackIndex || 0));
    selected.push(valid.has(fallback) ? fallback : entries[0].index);
  }
  return selected;
}

export async function sourceToDataUrl(src) {
  if (!src) throw new Error('图片不存在');
  if (src.startsWith('data:')) return src;
  const response = await fetch(src);
  if (!response.ok) throw new Error('源图读取失败');
  const blob = await response.blob();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) {
    throw new Error('只支持常见图片格式作为源图');
  }
  if (blob.size > 12 * 1024 * 1024) throw new Error('图片不能超过 12 兆');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
}

export function extensionForFormat(format = 'jpeg') {
  return format === 'png' ? 'png' : format === 'webp' ? 'webp' : 'jpg';
}

export function outputFormatForImage(image, fallback = 'jpeg') {
  const mimeType = String(image?.mimeType || '').split(';')[0].trim().toLowerCase();
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpeg';
  return image?.outputFormat || fallback;
}

export function firstImageMeta(item) {
  return Array.isArray(item?.images) && item.images.length ? item.images[0] : item;
}

export function parseImageSize(size) {
  const match = String(size || '').match(/^(\d+)x(\d+)$/);
  if (!match) return { width: 0, height: 0 };
  return { width: Number(match[1]), height: Number(match[2]) };
}
