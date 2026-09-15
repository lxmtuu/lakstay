import { logger } from './logger.js';

/** Response envelope đồng nhất — client luôn biết cấu trúc dữ liệu */
export const ok = (res, data, meta) =>
  res.json({ success: true, data, ...(meta ? { meta } : {}) });

export const created = (res, data, meta) =>
  res.status(201).json({ success: true, data, ...(meta ? { meta } : {}) });

export const fail = (res, status, code, message, details) =>
  res.status(status).json({ success: false, error: { code, message, ...(details ? { details } : {}) } });

export function paginate(query = {}) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const rawLimit = parseInt(query.limit, 10) || 20;
  const limit = Math.min(100, Math.max(1, rawLimit)); // CHẶN limit=999999 (DoS)
  return { page, limit, offset: (page - 1) * limit };
}

export const pageMeta = ({ page, limit }, total) => ({
  page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)),
});

/** Chỉ pick field cần trả về — tránh leak password_hash v.v. */
export function sanitize(obj, blacklist = ['password_hash', 'token_hash', 'failed_logins', 'locked_until']) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (!blacklist.includes(k)) out[k] = v;
  return out;
}

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.length) return xf.split(',')[0].trim();
  return req.socket?.remoteAddress || '-';
}

export const maskEmail = (e = '') => e.replace(/^(.{2}).*(@.*)$/, '$1***$2');
export const maskPhone = (p = '') => String(p).replace(/^(\d{2})\d+(\d{3})$/, '$1***$2');

export { logger };
