import bcrypt from 'bcryptjs';
import {
  createSession,
  createUser,
  deleteSession,
  findUserByAccount,
  findSession,
  findUserById,
  verifyApiKey,
} from './store.js';

const cookieName = 'image_studio_sid';

export function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    account: user.account || user.username,
    username: user.username,
    role: user.role,
    status: user.status,
    balanceCents: user.balanceCents,
    createdAt: user.createdAt
  };
}

export async function registerUser(username, account, password) {
  const user = await createUser({ username, account, password });
  const session = await createSession(user.id);
  return { user: sanitizeUser(user), session };
}

export async function loginUser(account, password) {
  const user = findUserByAccount(account);
  if (!user || user.status !== 'active') throw new Error('账号或密码错误');
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new Error('账号或密码错误');
  const session = await createSession(user.id);
  return { user: sanitizeUser(user), session };
}

export async function logout(req, res) {
  const sid = req.cookies?.[cookieName];
  if (sid) await deleteSession(sid);
  res.clearCookie(cookieName, sessionCookieOptions(req));
}

function sessionCookieOptions(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(req.secure || forwardedProto === 'https'),
    path: '/'
  };
}

export function setSessionCookie(req, res, session) {
  res.cookie(cookieName, session.id, {
    ...sessionCookieOptions(req),
    maxAge: Math.max(0, session.expiresAt - Date.now())
  });
}

export function authMiddleware(req, _res, next) {
  const sid = req.cookies?.[cookieName];
  const session = sid ? findSession(sid) : null;
  req.user = session ? findUserById(session.userId) : null;
  next();
}

export async function apiKeyMiddleware(req, _res, next) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  const verified = match ? await verifyApiKey(match[1]) : null;
  req.apiUser = verified?.user || null;
  req.apiKey = verified?.apiKey || null;
  next();
}

export function requireApiUser(req, res, next) {
  if (!req.apiUser) return res.status(401).json({ error: { message: 'Invalid API key', type: 'authentication_error' } });
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ success: false, message: '请先登录' });
  if (req.user.status !== 'active') return res.status(403).json({ success: false, message: '账号已禁用' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: '需要管理员权限' });
  }
  next();
}
