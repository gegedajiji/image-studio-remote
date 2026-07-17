import 'dotenv/config';
import crypto from 'node:crypto';

const isProduction = process.env.NODE_ENV === 'production';
const defaultAdminPassword = '12345678';
const price = (name, fallback) => {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} 必须是正整数分`);
  }
  return value;
};
const list = (name, fallback) => String(process.env[name] || fallback)
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

if (isProduction && (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === defaultAdminPassword)) {
  throw new Error('生产环境必须设置安全的 ADMIN_PASSWORD，不能使用默认管理员密码');
}

if (isProduction && (!process.env.APP_SECRET || String(process.env.APP_SECRET).length < 32)) {
  throw new Error('生产环境必须设置至少 32 位的 APP_SECRET，避免重启后会话失效');
}

export const config = {
  port: Number(process.env.PORT || 8790),
  publicBaseUrl: process.env.PUBLIC_BASE_URL || 'http://127.0.0.1:8790',
  appSecret: process.env.APP_SECRET || crypto.randomBytes(32).toString('hex'),
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || defaultAdminPassword,
  upstreamBaseUrl: process.env.IMAGE_UPSTREAM_BASE_URL || 'http://64.83.41.109:8081',
  upstreamApiKey: process.env.IMAGE_UPSTREAM_API_KEY || '',
  imageModel: process.env.IMAGE_MODEL || 'gpt-image-2',
  textModel: process.env.TEXT_MODEL || 'gpt-5.4-mini',
  allowedTextModels: list('ALLOWED_TEXT_MODELS', 'gpt-5.4-mini,gpt-5.5,gpt-5.1'),
  prices: {
    '1k': price('PRICE_1K_CENTS', 100),
    '2k': price('PRICE_2K_CENTS', 200)
  },
  purchaseCodeUrl: process.env.PURCHASE_CODE_URL || 'https://catfk.com/shop/aoteman'
};

export const sizeMap = {
  '1k': '1024x1024',
  '2k': '1024x1024'
};

export const supportedSizes = [
  '1024x1024',
  '1536x1024',
  '1024x1536'
];

export const qualityMap = {
  '1k': 'medium',
  '2k': 'high'
};

export const supportedQualities = ['1k', '2k'];
