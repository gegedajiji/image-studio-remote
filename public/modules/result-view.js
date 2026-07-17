import { state } from './state.js';
import { escapeHtml } from './format.js';
import { extensionForFormat, imageSources, outputFormatForImage, parseImageSize } from './image-utils.js';
import { resultMetaText } from './studio-format.js';

const resultHtmlCacheLimit = 80;
const resultHtmlCache = new Map();

export function clearResultHtmlCache() {
  resultHtmlCache.clear();
}

function rememberResultHtml(cacheKey, html) {
  resultHtmlCache.set(cacheKey, html);
  if (resultHtmlCache.size > resultHtmlCacheLimit) {
    resultHtmlCache.delete(resultHtmlCache.keys().next().value);
  }
  return html;
}

function resultHtmlCacheKey(item, sources) {
  return [
    item?.id || '',
    item?.status || '',
    item?.updatedAt || '',
    item?.createdAt || '',
    item?.prompt || '',
    item?.title || '',
    item?.layout || '',
    item?.size || '',
    item?.quality || '',
    item?.count || '',
    item?.outputFormat || state.outputFormat || '',
    item?.communityPostId || '',
    item?.communityPost?.id || '',
    item?.communityPost?.title || '',
    item?.reuseSourcePost?.id || '',
    item?.reuseSourcePost?.title || '',
    Array.isArray(item?.storyboardPrompts) ? item.storyboardPrompts.join('\n') : '',
    Array.isArray(item?.images) ? item.images.map((image) => [
      image?.imageUrl || '',
      image?.mimeType || '',
      image?.outputFormat || '',
      image?.imageBase64 ? String(image.imageBase64).length : ''
    ].join(':')).join('|') : '',
    sources.join('|')
  ].join('::');
}

export function resultRenderKey(item) {
  return resultHtmlCacheKey(item, imageSources(item));
}

export function renderResultActions(item, index, src) {
  const prompt = item?.prompt || '';
  const outputFormat = outputFormatForImage(item?.images?.[index] || item, item?.outputFormat || state.outputFormat);
  const extension = extensionForFormat(outputFormat);
  const publishButton = item?.id && item?.status !== 'failed' && !item.communityPostId && !item.reuseSourcePost?.id
    ? `<button class="result-action-publish" type="button" data-result-action="publish" data-result-index="${index}">上传交流区</button>`
    : '';
  return `
    <div class="result-actions">
      <a class="result-action-download" href="${escapeHtml(src)}" download="onetop-image-${index + 1}.${extension}">下载原图</a>
      <button class="result-action-edit" type="button" data-result-action="edit" data-result-index="${index}">继续编辑</button>
      ${publishButton}
      <details class="result-more-menu">
        <summary>更多</summary>
        <div class="result-more-popover">
          <button type="button" data-result-action="viewOriginal" data-result-index="${index}">原尺寸查看</button>
          <button type="button" data-result-action="canvas" data-result-index="${index}">放到画布</button>
          <button type="button" data-result-action="copy" data-result-index="${index}" ${prompt ? '' : 'disabled'}>复制提示词</button>
          <button type="button" data-result-action="rerun" data-result-index="${index}" ${prompt ? '' : 'disabled'}>重新生成</button>
        </div>
      </details>
    </div>
  `;
}

export function resultAspectClass(item) {
  const { width, height } = parseImageSize(item?.size);
  if (width && height && width > height) return 'is-landscape';
  if (width && height && height > width) return 'is-portrait';
  return 'is-square';
}

export function renderResultImage(src, index, item = null) {
  const isPriorityImage = index === 0;
  return `
    <div class="result-image-frame ${resultAspectClass(item)} is-loading">
      <img src="${escapeHtml(src)}" alt="生成图片 ${index + 1}" loading="${isPriorityImage ? 'eager' : 'lazy'}" fetchpriority="${isPriorityImage ? 'high' : 'low'}" decoding="async" data-result-image="${index}" data-result-src="${escapeHtml(src)}" />
      <div class="result-image-error" role="status">
        <strong>图片暂时没加载出来</strong>
        <span>可以重试加载，或直接打开原尺寸查看。</span>
        <div>
          <button type="button" data-result-action="retryImage" data-result-index="${index}">重试加载</button>
          <button type="button" data-result-action="viewOriginal" data-result-index="${index}">原尺寸查看</button>
        </div>
      </div>
    </div>
  `;
}

export function renderPublishPrompt(item) {
  if (!item?.id || item.status === 'failed') return '';
  if (!item.communityPostId && item.reuseSourcePost?.id) {
    return `
      <section class="result-publish-prompt">
        <div>
          <strong>发布你的参考延展版本</strong>
          <span>这是基于《${escapeHtml(item.reuseSourcePost.title || '交流区作品')}》生成的新版本，可以发布到交流区让别人对比和评论。</span>
        </div>
        <div class="result-publish-actions">
          <button class="secondary-button" type="button" data-result-action="viewCommunity" data-community-post-id="${escapeHtml(item.reuseSourcePost.id)}">查看来源作品</button>
          <button class="primary-button" type="button" data-result-action="publish" data-result-index="0">发布我的版本</button>
        </div>
      </section>
    `;
  }
  if (item.communityPostId) {
    return `
      <section class="result-publish-prompt">
        <div>
          <strong>作品已发布到交流区</strong>
          <span>可以先复制邀请文案，请朋友点赞评论，再回来看表现；下载数据只是参考。</span>
        </div>
        <div class="result-publish-actions">
          <button class="primary-button" type="button" data-result-action="shareCommunity" data-community-post-id="${escapeHtml(item.communityPostId)}">复制邀请文案</button>
          <button class="secondary-button" type="button" data-result-action="viewCommunity" data-community-post-id="${escapeHtml(item.communityPostId)}">查看交流区</button>
        </div>
      </section>
    `;
  }
  return '';
}

export function renderGeneratedImagesHtml(item) {
  const sources = imageSources(item);
  const cacheKey = resultHtmlCacheKey(item, sources);
  const cached = resultHtmlCache.get(cacheKey);
  if (cached) return cached;
  const gridClass = sources.length > 1 ? 'multi-result' : 'single-result';
  return rememberResultHtml(cacheKey, `
    <div class="${gridClass}">
      ${sources.map((src, index) => `
        <article class="result-card">
          <div class="result-meta">${escapeHtml(resultMetaText(item, index))}</div>
          ${renderResultActions(item, index, src)}
          ${renderResultImage(src, index, item)}
        </article>
      `).join('')}
    </div>
    ${renderPublishPrompt(item)}
  `);
}
