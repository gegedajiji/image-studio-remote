import {
  formatResultLabel,
  qualityLabel,
  sizeLabelText
} from './studio-format.js';

export function parseTags(value) {
  return [...new Set(String(value || '')
    .split(/[,，\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 8))];
}

export function cleanPromptText(prompt) {
  return String(prompt || '')
    .replace(/\s*清晰度要求[:：][^\n\r]*/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[。；;]+/g, '，')
    .trim();
}

export function cleanCommunityDisplayText(text) {
  return String(text || '')
    .replace(/\s*清晰度要求[:：][^\n\r。；;]*/gi, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function inferCommunityTags(prompt, item = {}) {
  const text = cleanPromptText(prompt).toLowerCase();
  const rules = [
    ['产品', /产品|商品|电商|包装|杯|鞋|包|瓶|香水|手表|珠宝|家居|家具/],
    ['海报', /海报|poster|宣传|广告|主视觉|banner|封面/],
    ['人像', /人像|人物|女孩|男孩|角色|肖像|模特|写真|portrait/],
    ['摄影', /摄影|写实|真实|镜头|光影|自然光|棚拍|photo|photography/],
    ['国风', /国风|古风|中式|汉服|水墨|武侠|东方/],
    ['游戏', /游戏|赛博|机甲|科幻|未来|城市|赛道|截图/],
    ['插画', /插画|二次元|动漫|卡通|绘本|illustration/],
    ['建筑', /建筑|室内|空间|展厅|城市|景观/],
    ['美食', /美食|餐|甜品|咖啡|饮品|食物/]
  ];
  const tags = rules.filter(([, pattern]) => pattern.test(text)).map(([tag]) => tag);
  if (item.mode === 'edit') tags.push('图生图');
  tags.push(item.size === '1024x1536' ? '竖图' : item.size === '1536x1024' ? '横图' : '方图');
  if (!tags.length) tags.push('AI作品', '灵感');
  return [...new Set(tags)].slice(0, 5);
}

export function communityPublishDraft(item = {}) {
  const prompt = cleanPromptText(item.prompt);
  const titleSource = prompt
    .split(/[，,.、]/)
    .map((part) => part.trim())
    .find((part) => part.length >= 2) || '未命名作品';
  const title = titleSource.slice(0, 28);
  const tags = inferCommunityTags(prompt, item);
  const specs = [
    item.quality ? qualityLabel(item.quality) : '',
    item.size ? sizeLabelText(item.size) : '',
    item.outputFormat ? formatResultLabel(item.outputFormat) : ''
  ].filter(Boolean).join(' · ');
  const summary = prompt ? prompt.slice(0, 90) : '作者发布了一张新的 AI 作品。';
  const description = [
    summary,
    specs ? `生成规格：${specs}。` : '',
    '我想把它用于：',
    '希望大家帮我看：',
    '最想听哪一处建议：'
  ].filter(Boolean).join('\n');
  return { title, description: description.slice(0, 300), tags };
}

export function normalizeCommunityPostForDisplay(post) {
  if (!post) return post;
  const cleanTitle = cleanCommunityDisplayText(post.title || '').slice(0, 60);
  const cleanDescription = cleanCommunityDisplayText(post.description || '').slice(0, 300);
  const cleanPrompt = cleanPromptText(post.prompt || '').slice(0, 4000);
  return {
    ...post,
    title: cleanTitle || post.title || '未命名作品',
    description: cleanDescription,
    prompt: cleanPrompt
  };
}
