export const supportedImageMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);

export function detectImageMimeType(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12
    && bytes.toString('ascii', 0, 4) === 'RIFF'
    && bytes.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  return '';
}

export function validateImageBuffer(buffer, { mimeType = '', label = '图片', allowMimeMismatch = false } = {}) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!bytes.length) throw new Error(`${label}内容为空`);
  const declaredMimeType = String(mimeType || '').split(';')[0].trim().toLowerCase();
  if (declaredMimeType && !supportedImageMimeTypes.has(declaredMimeType)) {
    throw new Error('只支持常见图片格式');
  }
  const detectedMimeType = detectImageMimeType(bytes);
  if (!detectedMimeType) throw new Error(`请上传有效${label}`);
  if (declaredMimeType && detectedMimeType !== declaredMimeType && !allowMimeMismatch) {
    throw new Error(`${label}格式与文件内容不一致`);
  }
  return detectedMimeType;
}
