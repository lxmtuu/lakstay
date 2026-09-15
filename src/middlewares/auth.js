import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { db } from '../db.js';
import { Errors, AppError } from '../utils/errors.js';
import { safeEqual } from '../utils/id.js';
import { clientIp } from '../utils/http.js';

/**
 * AUTH STRATEGY: Access token (JWT, 15 phút) trong httpOnly cookie + CSRF token.
 *  - httpOnly  => XSS không đọc được token
 *  - SameSite=Lax/Strict => chặn phần lớn CSRF
 *  - CSRF double-submit token => chặn nốt phần còn lại (form cross-site)
 *  - Access token ngắn + refresh token rotation => giảm thiểu thiệt hại khi lộ
 */
export const COOKIE_ACCESS = 'lks_at';
export const COOKIE_REFRESH = 'lks_rt';
export const HEADER_CSRF = 'x-csrf-token';

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, name: user.full_name },
    config.jwt.accessSecret,
    { expiresIn: config.jwt.accessTtl, issuer: 'lakstay', audience: 'lakstay-web' }
  );
}

export function signRefreshToken(payload) {
  return jwt.sign(payload, config.jwt.refreshSecret, {
    expiresIn: `${config.jwt.refreshTtlDays}d`,
    issuer: 'lakstay',
  });
}

const cookieBase = {
  httpOnly: true,
  sameSite: 'lax',
  secure: config.isProd,
  path: '/',
};

export function setAuthCookies(res, { accessToken, refreshToken, refreshDays }) {
  res.cookie(COOKIE_ACCESS, accessToken, { ...cookieBase, maxAge: 15 * 60 * 1000 });
  if (refreshToken) {
    res.cookie(COOKIE_REFRESH, refreshToken, {
      ...cookieBase,
      path: '/api/auth', // thu hẹp phạm vi gửi cookie
      maxAge: refreshDays * 86_400_000,
    });
  }
}

export function clearAuthCookies(res) {
  res.clearCookie(COOKIE_ACCESS, cookieBase);
  res.clearCookie(COOKIE_REFRESH, { ...cookieBase, path: '/api/auth' });
}

/** Parse token từ cookie hoặc Authorization: Bearer (cho API client/Postman) */
function extractToken(req) {
  const c = req.cookies?.[COOKIE_ACCESS];
  if (c) return { token: c, source: 'cookie' };
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) return { token: h.slice(7), source: 'bearer' };
  return { token: null, source: null };
}

/** Xác thực bắt buộc */
export function requireAuth(req, _res, next) {
  const { token, source } = extractToken(req);
  if (!token) return next(Errors.unauthorized());
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret, {
      issuer: 'lakstay', audience: 'lakstay-web',
    });
    const user = db.prepare(`SELECT id, email, full_name, role, status, email_verified
                             FROM users WHERE id = ?`).get(payload.sub);
    if (!user) return next(Errors.unauthorized('Tài khoản không tồn tại'));
    if (user.status !== 'active') return next(Errors.forbidden('Tài khoản đã bị khoá'));

    // Nếu token đến từ cookie (browser) => bắt buộc kèm CSRF token khớp
    if (source === 'cookie' && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const header = req.headers[HEADER_CSRF];
      const cookie = req.cookies?.['lks_csrf'];
      if (!header || !cookie || !safeEqual(header, cookie)) {
        db.prepare(`INSERT INTO security_events (id, type, severity, ip, user_agent, email, detail)
                    VALUES (?,?,?,?,?,?,?)`)
          .run(`sec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
               'CSRF_BLOCKED', 'warn', clientIp(req), req.headers['user-agent'] || '', user.email, req.originalUrl);
        return next(Errors.forbidden('CSRF token không hợp lệ'));
      }
    }

    req.user = user;
    req.tokenSource = source;
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) return next(new AppError(401, 'TOKEN_EXPIRED', 'Phiên đã hết hạn'));
    next(Errors.unauthorized('Token không hợp lệ'));
  }
}

/** Xác thực tuỳ chọn — có token thì gắn req.user, không có vẫn cho qua */
export function optionalAuth(req, _res, next) {
  const { token } = extractToken(req);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, config.jwt.accessSecret, { issuer: 'lakstay', audience: 'lakstay-web' });
    const user = db.prepare(`SELECT id, email, full_name, role, status FROM users WHERE id = ?`).get(payload.sub);
    if (user?.status === 'active') req.user = user;
  } catch { /* bỏ qua, coi như khách */ }
  next();
}

/** RBAC theo vai trò */
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(Errors.unauthorized());
  if (!roles.includes(req.user.role)) {
    return next(Errors.forbidden(`Cần quyền: ${roles.join(' hoặc ')}`));
  }
  next();
};

/** RBAC theo quyền chi tiết (permission-based, mở rộng hơn role-based) */
export const PERMISSIONS = {
  admin: ['*'],
  staff: [
    'booking:read', 'booking:read:all', 'booking:update:status', 'booking:cancel',
    'room:read', 'review:moderate', 'payment:read', 'payment:manual',
    'report:read', 'user:read',
  ],
  customer: ['booking:read:own', 'booking:create', 'booking:cancel:own', 'review:create'],
};

export const can = (role, permission) => {
  const list = PERMISSIONS[role] || [];
  return list.includes('*') || list.includes(permission);
};

export const requirePermission = (permission) => (req, _res, next) => {
  if (!req.user) return next(Errors.unauthorized());
  if (!can(req.user.role, permission)) return next(Errors.forbidden());
  next();
};

/**
 * Chống IDOR: resource phải thuộc về user hiện tại, HOẶC user có quyền đọc tất cả.
 * Đây là lỗi bảo mật phổ biến nhất trong hệ booking (đổi ?id=... để xem booking người khác).
 */
export function assertOwnershipOrStaff(resource, user, field = 'user_id') {
  if (!user) throw Errors.unauthorized();
  if (user.role === 'admin' || user.role === 'staff') return;
  if (resource[field] !== user.id) throw Errors.forbidden('Bạn không có quyền truy cập dữ liệu này');
}
