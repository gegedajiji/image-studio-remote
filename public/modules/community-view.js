import { state } from './state.js';
import { $ } from './dom.js';
import { communityHeatHelpText } from './constants.js';
import { escapeHtml } from './format.js';

export const communityDiscoveryFilters = [
  { id: 'all', label: '全部', description: '查看全部公开作品。' },
  { id: 'uncommented', label: '等你首评', description: '还没有评论的作品，适合留下第一条建议。' },
  { id: 'commented', label: '有评论', description: '优先看已经有人讨论的作品。' },
  { id: 'reusable', label: '可参考二创', description: '有可复用参数，适合作为二创参考；不影响热度排名。' },
  { id: 'downloaded', label: '有人保存过', description: '有人免费下载保存过，适合找素材参考；不影响热度排名。' },
  { id: 'new', label: '新发布', description: '最近发布的新作品。' },
  { id: 'liked', label: '我点赞过', description: '回看自己点过赞的作品。' }
];

export const serverCommunityDiscoveryFilters = new Set(['uncommented', 'commented', 'reusable', 'downloaded', 'new', 'liked']);

const templateClasses = ['prompt-rose', 'prompt-blue', 'prompt-purple', 'prompt-cyan'];

let studioTemplatesRenderKey = '';
let helpers = {
  cleanDisplayText: (value) => String(value || ''),
  feedbackQuestion: () => '',
  reuseInsightText: () => '',
  creatorPrimaryAction: () => ({ action: 'share', label: '邀请评论' }),
  creatorNextStep: () => '',
  isOwnPost: () => false,
  isDownloadPending: () => false,
  isActionPending: () => false
};

export function initCommunityView(nextHelpers = {}) {
  helpers = { ...helpers, ...nextHelpers };
}

export function communityPrimaryMetrics(post) {
  return `
    <span title="${escapeHtml(communityHeatHelpText)}">热度 ${escapeHtml(String(post.hotScore || 0))} · 点赞+评论</span>
    <span>${post.likeCount || 0} 赞</span>
    <span>${post.commentCount || 0} 评论</span>
  `;
}

export function communitySecondaryMetrics(post) {
  return `
    <span>${post.reuseCount || 0} 参考延展 · 不计排名</span>
    <span>${post.downloadCount || 0} 免费下载 · 不计排名</span>
  `;
}

export function communityDiscoveryFilterById(id) {
  return communityDiscoveryFilters.find((filter) => filter.id === id) || communityDiscoveryFilters[0];
}

export function isRecentCommunityPost(post) {
  const createdAt = Number(post.createdAt || 0);
  return createdAt > 0 && Date.now() - createdAt <= 7 * 24 * 60 * 60 * 1000;
}

export function matchesCommunityDiscoveryFilter(post) {
  const filter = state.communityDiscoveryFilter || 'all';
  if (filter === 'uncommented') return Number(post.commentCount || 0) === 0;
  if (filter === 'commented') return Number(post.commentCount || 0) > 0;
  if (filter === 'reusable') return Boolean(post.canReuse);
  if (filter === 'downloaded') return Number(post.downloadCount || 0) > 0;
  if (filter === 'new') return isRecentCommunityPost(post);
  if (filter === 'liked') return Boolean(post.liked);
  return true;
}

export function communityTagList(posts = state.communityPosts) {
  const globalTags = Array.isArray(state.communityTags) ? state.communityTags : [];
  const fallbackTags = Array.from(new Set(posts.flatMap((post) => post.tags || []).filter(Boolean)))
    .map((tag) => ({ tag, count: posts.filter((post) => (post.tags || []).includes(tag)).length }));
  return (globalTags.length ? globalTags : fallbackTags).slice(0, 24);
}

export function fallbackStudioTemplates() {
  return [
    {
      id: 'guofeng-campaign',
      label: '国风宣发',
      source: 'fallback',
      title: '周芷若联动宣传图',
      description: '国风角色联动、商业主视觉、红金氛围。',
      prompt: '周芷若联动宣传图，国风角色联动，红金渐变背景，现代广告构图，人物占比突出，无文字，无水印',
      imageUrl: '/assets/templates/guofeng-campaign.jpg'
    },
    {
      id: 'porcelain-museum',
      label: '博物馆图鉴',
      source: 'fallback',
      title: '青花瓷博物馆图鉴',
      description: '蓝白瓷器、展陈空间、画册摄影质感。',
      prompt: '青花瓷博物馆图鉴，蓝白瓷器，展陈空间，柔和自然光，文物摄影质感，高级画册风格，无文字',
      imageUrl: '/assets/templates/porcelain-museum.jpg'
    },
    {
      id: 'poster-character',
      label: '人物海报',
      source: 'fallback',
      title: '卡芙卡轮廓宇宙海报',
      description: '深紫星云、人物剪影、电影感构图。',
      prompt: '卡芙卡轮廓宇宙海报，电影感构图，深紫色星云，人物剪影，细腻光影，高清细节，无文字，无水印',
      imageUrl: '/assets/templates/poster-character.jpg'
    },
    {
      id: 'game-scene',
      label: '游戏场景',
      source: 'fallback',
      title: '地平线8深圳实机图',
      description: '未来城市、赛道车流、写实游戏截图。',
      prompt: '地平线8深圳实机图，未来城市，航拍视角，高速运动感，蓝橙色调，写实游戏截图，无文字',
      imageUrl: '/assets/templates/game-scene.jpg'
    }
  ];
}

export function studioTemplatePrompt(post) {
  const prompt = String(post.prompt || '').trim();
  if (prompt) return prompt;
  const tags = Array.isArray(post.tags) && post.tags.length ? `，关键词：${post.tags.slice(0, 4).join('、')}` : '';
  const mode = post.mode === 'edit' ? '图生图风格延展' : '文生图创作';
  return `${post.title || '交流区作品'}，${post.description || mode}${tags}，参考交流区热门作品的构图、质感和色彩，高清细节，无文字，无水印`;
}

export function communityTemplateImageUrl(post) {
  return post?.imageUrl || post?.images?.[0]?.imageUrl || '';
}

export function studioTemplatesForRender() {
  return fallbackStudioTemplates().slice(0, 4);
}

export function renderStudioTemplateCards() {
  const grid = $('studioTemplateGrid');
  if (!grid) return;
  const templates = studioTemplatesForRender();
  const renderKey = templates.map((item, index) => [
    index,
    item.id || '',
    item.title || '',
    item.imageUrl || '',
    item.prompt || '',
    item.description || '',
    item.hotScore || '',
    item.source || ''
  ].join('::')).join('||');
  if (studioTemplatesRenderKey === renderKey && grid.dataset.renderKey === renderKey) return;
  studioTemplatesRenderKey = renderKey;
  grid.dataset.renderKey = renderKey;
  grid.innerHTML = templates.map((item, index) => `
    <button class="prompt-card prompt-live-template ${escapeHtml(templateClasses[index] || 'prompt-blue')}" data-prompt="${escapeHtml(item.prompt || studioTemplatePrompt(item))}" type="button">
      <div class="prompt-cover">
        ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" loading="lazy" onerror="this.closest('.prompt-cover')?.classList.add('image-missing'); this.remove();" />` : '<em>预览</em>'}
      </div>
      <span>${escapeHtml(item.label || (item.source === 'community' ? '交流区模板' : '内置模板'))}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <p>${escapeHtml(item.description || item.prompt).slice(0, 80)}</p>
      <small>${item.source === 'community' ? `交流区图 · 热度 ${escapeHtml(String(item.hotScore || 0))}` : `固定模板 ${index + 1}`}</small>
    </button>
  `).join('');
}

export function renderCommunityCard(post) {
  const downloadPending = helpers.isDownloadPending(post.id, 0);
  const imageCount = Array.isArray(post.images) && post.images.length ? post.images.length : 1;
  const image = post.imageUrl
    ? `<img src="${escapeHtml(post.imageUrl)}" alt="${escapeHtml(post.title)}" loading="lazy" decoding="async" fetchpriority="low" />`
    : '';
  const tags = (post.tags || []).slice(0, 4).map((tag) => `<em>${escapeHtml(tag)}</em>`).join('');
  const hotScore = Number(post.hotScore || 0);
  const primaryInteractionCount = Number(post.likeCount || 0) + Number(post.commentCount || 0);
  const hotLabel = hotScore >= 60 ? '热门作品' : primaryInteractionCount > 0 ? '讨论升温' : isRecentCommunityPost(post) ? '新发布' : '等你首评';
  const downloadLabel = imageCount > 1 ? '逐张免费下载' : '免费下载';
  const canReuse = post.canReuse !== false;
  const reuseCount = Number(post.reuseCount || 0);
  const needsFirstComment = Number(post.commentCount || 0) === 0;
  const isOwnPost = helpers.isOwnPost(post);
  const cardTitle = helpers.cleanDisplayText(post.title || '').slice(0, 60) || '未命名作品';
  const cardDescription = helpers.cleanDisplayText(post.description || '') || '作者暂未填写介绍。';
  const feedbackQuestion = helpers.feedbackQuestion(post);
  const reuseInsight = state.communityScope === 'mine' ? helpers.reuseInsightText(post) : '';
  const viewerNextStep = state.communityScope !== 'mine'
    ? (needsFirstComment
      ? '还没有评论，留下第一条具体建议。'
      : (post.liked ? '已点赞，下一步可以告诉作者你准备用在哪。' : '喜欢这张图？先点赞，再留一句用途或改图建议。'))
    : '';
  const publicReuseInsight = state.communityScope !== 'mine' && reuseCount > 0
    ? `<button class="community-card-reuse-link" type="button" data-community-open="${escapeHtml(post.id)}" title="查看这个作品的参考延展和已发布版本">${reuseCount} 次参考延展</button>`
    : '';
  const cardSecondaryActions = state.communityScope === 'mine'
    ? [
      `<button type="button" data-community-download="${escapeHtml(post.id)}" ${downloadPending ? 'disabled' : ''}>${downloadPending ? '准备下载…' : downloadLabel}</button>`,
      canReuse ? `<button type="button" data-community-use="${escapeHtml(post.id)}" title="基于这个作品的提示词和参数做自己的版本">参考创作</button>` : '',
      `<button type="button" data-community-share="${escapeHtml(post.id)}">复制邀请文案</button>`
    ].filter(Boolean).join('')
    : `<button type="button" data-community-download="${escapeHtml(post.id)}" ${downloadPending ? 'disabled' : ''}>${downloadPending ? '准备下载…' : downloadLabel}</button>`;
  const creatorPrimaryAction = state.communityScope === 'mine' ? helpers.creatorPrimaryAction(post) : null;
  const cardLikeAction = isOwnPost
    ? '<span class="community-own-work-pill">自己的作品</span>'
    : `<button class="community-card-primary" type="button" data-community-like="${escapeHtml(post.id)}" ${helpers.isActionPending('like', post.id) ? 'disabled' : ''}>${helpers.isActionPending('like', post.id) ? '处理中…' : (post.liked ? '已赞' : '点赞')}</button>`;
  return `
    <article class="library-card community-card">
      <button class="library-cover community-cover" type="button" data-community-open="${escapeHtml(post.id)}">
        ${image || '<span>暂无预览</span>'}
        <span>${hotLabel}</span>
        ${imageCount > 1 ? `<b class="community-image-count">共 ${imageCount} 张</b>` : ''}
      </button>
      <div>
        <span>${escapeHtml(post.username || '创作者')}</span>
        <h3>${escapeHtml(cardTitle)}</h3>
        <p>${escapeHtml(cardDescription)}</p>
        ${feedbackQuestion ? `<button class="community-feedback-question" type="button" data-community-comment="${escapeHtml(post.id)}"><span>作者想听</span>${escapeHtml(feedbackQuestion)}</button>` : ''}
        <div class="community-card-metrics primary">${communityPrimaryMetrics(post)}</div>
        <div class="community-card-metrics secondary" aria-label="辅助互动指标">${communitySecondaryMetrics(post)}</div>
        ${viewerNextStep ? `<span class="community-first-comment-hint">${escapeHtml(viewerNextStep)}</span>` : ''}
        ${publicReuseInsight}
        ${reuseInsight ? `<div class="creator-reuse-insight"><span>${escapeHtml(reuseInsight)}</span><button type="button" data-community-open="${escapeHtml(post.id)}">查看参考延展</button></div>` : ''}
        ${state.communityScope === 'mine' ? `
          <div class="creator-card-insight ${creatorPrimaryAction.action === 'reportedFeedback' ? 'is-urgent' : ''}">
            <span>${escapeHtml(helpers.creatorNextStep(post))}</span>
            <button type="button" data-creator-card-action="${creatorPrimaryAction.action}" data-post-id="${escapeHtml(post.id)}">${escapeHtml(creatorPrimaryAction.label)}</button>
          </div>
        ` : ''}
        <div class="library-card-tags">${tags}</div>
      </div>
      <div class="library-card-actions community-card-actions">
        <div class="community-card-primary-actions">
          ${cardLikeAction}
          <button class="community-card-primary" type="button" data-community-comment="${escapeHtml(post.id)}">${needsFirstComment ? '留首条建议' : '评论'}</button>
        </div>
        <div class="community-card-secondary-actions">
          ${cardSecondaryActions}
        </div>
      </div>
    </article>
  `;
}
