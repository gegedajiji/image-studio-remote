export const MAX_STUDIO_SOURCE_IMAGES = 1;

export const communityHeatHelpText = '热度 = 点赞 + 评论 + 时间衰减；参考创作、免费下载和自愿支持不参与排名。';

export const mimeByFormat = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp'
};

export const supportedSizes = ['1024x1024', '1536x1024', '1024x1536'];

export const sizeLabels = {
  '1024x1024': { ratio: '尺寸', size: '1024x1024' },
  '1536x1024': { ratio: '尺寸', size: '1536x1024' },
  '1024x1536': { ratio: '尺寸', size: '1024x1536' }
};

export const qualityLabels = {
  '1k': '质量 1K',
  '2k': '质量 2K'
};

export const formatLabels = {
  jpeg: '格式 JPEG',
  png: '格式 PNG',
  webp: '格式 WebP'
};

export const recommendedSizeMap = {
  auto: '1024x1024',
  '2048x2048': '1024x1024',
  '2048x1152': '1536x1024',
  '3840x2160': '1536x1024',
  '2160x3840': '1024x1536'
};

export const recommendedQualityMap = {
  low: '2k',
  medium: '2k',
  high: '2k',
  auto: '2k'
};

export const agentStorageKey = 'onetop-agent-conversations-v1';
export const historyWidthStorageKey = 'onetop-history-width-v1';
export const composerHeightStorageKey = 'onetop-composer-height-v1';
export const creatorFeedbackHandledStoragePrefix = 'onetop-creator-feedback-handled-v1';
export const creatorFeedbackHandledMigrationPrefix = 'onetop-creator-feedback-handled-migrated-v1';

export const defaultAgentModel = 'gpt-5.4-mini';

export const agentModelLabels = {
  'gpt-5.4-mini': '默认模型',
  'gpt-5.5': '增强模型',
  'gpt-5.1': '稳定模型'
};

export const reasoningLabels = {
  low: '低',
  medium: '中',
  high: '高'
};

export const routeByPanel = {
  studio: '/image/history',
  prompts: '/prompts',
  agent: '/agent',
  developers: '/api-docs',
  settings: '/settings',
  admin: '/admin'
};
