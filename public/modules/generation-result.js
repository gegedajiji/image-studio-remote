import { imageSources } from './image-utils.js';
import { qualityLabel, sizeLabelText } from './studio-format.js';

const reuseSourceExpiredPattern = /同款参数已过期|同款来源作品已下架|参考参数已过期|参考来源作品已下架/;

export function friendlyGenerateError(message) {
  const text = String(message || '');
  const lowerText = text.toLowerCase();
  if (text.includes('API key') || text.includes('IMAGE_UPSTREAM_API_KEY')) return '生成通道暂不可用，请联系管理员检查配置。';
  if (text.includes('No available compatible accounts')) return '上游生图账号池暂无可用账号，本次未扣费，请管理员在后台切换可用上游或稍后重试。';
  if (lowerText.includes('error code: 502') || text.includes('上游生图网关返回 502')) return '上游生图网关当前不可用，本次未扣费，请管理员在后台切换可用上游或稍后重试。';
  if (text.includes('上游生图网关返回')) return '上游生图网关返回错误，本次未扣费，请管理员检查上游配置或稍后重试。';
  if (text.includes('openai_error')) return '生成通道返回错误，本次未扣费，请稍后重试。';
  if (text.includes('other side closed') || text.includes('UND_ERR_SOCKET') || text.includes('ECONNRESET')) return '生成通道连接中断，本次未扣费，请稍后重试。';
  if (text.includes('fetch failed') || text.includes('timeout') || text.includes('headersTimeout')) return '生成通道响应超时，本次未扣费，请稍后重试。';
  if (text.includes('size') || text.includes('4096') || text.includes('2048')) return '当前图片尺寸不被上游支持，请刷新后重试。';
  return text || '生成失败，请稍后重试。';
}

export function mergeReusePostIntoGeneration(data = {}) {
  return data.reusePost
    ? { ...data.generation, reuseSourcePost: data.reusePost, reuseSourcePostId: data.reusePost.id }
    : data.generation;
}

export function generationPreviewMeta(item, fallbackCount = 1) {
  return `${qualityLabel(item?.quality)} · ${sizeLabelText(item?.size)} · ${item?.count || imageSources(item).length || fallbackCount} 张`;
}

export function isReuseSourceExpiredError(error, reusePostId = '') {
  return Boolean(reusePostId) && error?.status === 400 && reuseSourceExpiredPattern.test(String(error.message || ''));
}
