import { config } from '../config/index.js';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { newId } from '../utils/id.js';
import { db } from '../db.js';
import { clientIp } from '../utils/http.js';
import { ZodError } from 'zod';
import crypto from 'node:crypto';

/** 404 cho API */
export function apiNotFound(req, _res, next) {
  next(new AppError(404, 'ROUTE_NOT_FOUND', `Không tìm thấy endpoint ${req.method} ${req.originalUrl}`));
}

/**
 * Error handler cuối cùng.
 * Nguyên tắc:
 *  - Lỗi nghiệp vụ (expected) => trả message tiếng Việt cho người dùng.
 *  - Lỗi lạ (unexpected) => log chi tiết + trả message chung chung, KHÔNG leak stack/SQL.
 *  - Luôn kèm requestId để đối chiếu log khi support.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const requestId = req.id;
  const expected = err instanceof AppError || err instanceof ZodError;

  let status = err.status || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'Lỗi hệ thống';
  let details = err.details;

  if (err instanceof ZodError) {
    status = 422; code = 'VALIDATION_ERROR'; message = 'Dữ liệu không hợp lệ';
    details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  }

  // SQLite UNIQUE / PRIMARY KEY constraint => dịch thành lỗi nghiệp vụ dễ hiểu
  const isUniqueConstraint =
    /UNIQUE constraint failed/i.test(message) ||
    err?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    err?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
  if (isUniqueConstraint) {
    status = 409; code = 'CONFLICT';
    if (/room_calendar/i.test(message)) {
      code = 'ALREADY_BOOKED';
      message = 'Phòng vừa được người khác đặt. Vui lòng chọn lại.';
    } else if (/idempotency_key/i.test(message)) {
      code = 'IDEMPOTENT_REPLAY';
      message = 'Yêu cầu đã được xử lý trước đó.';
    } else {
      message = 'Dữ liệu đã tồn tại';
    }
  }
  if (/SQLITE_BUSY|database is locked/i.test(message)) {
    status = 503; code = 'SERVER_BUSY';
    message = 'Hệ thống đang bận, vui lòng thử lại sau ít giây.';
  }

  if (!expected) {
    logger.error('Unhandled error', { requestId, err: err.stack || message, url: req.originalUrl });
    if (config.isProd) { message = 'Đã xảy ra lỗi hệ thống'; details = undefined; }
  } else if (status >= 500) {
    logger.error('App error', { requestId, code, message });
  } else {
    logger.debug('Request rejected', { requestId, code, status, message });
  }

  // Ghi security event cho các lỗi 4xx "đáng ngờ"
  if (['FORBIDDEN', 'UNAUTHORIZED', 'TOKEN_EXPIRED'].includes(code)) {
    try {
      db.prepare(`INSERT INTO security_events (id, type, severity, ip, user_agent, email, detail)
                  VALUES (?,?,?,?,?,?,?)`)
        .run(newId('sec'), code, 'warn', clientIp(req), req.headers['user-agent'] || '',
             req.user?.email || null, `${req.method} ${req.originalUrl}`);
    } catch { /* không để ghi log làm hỏng response */ }
  }

  res.status(status).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}) },
    requestId,
  });
}

/** Request ID + access log */
const SAFE_REQ_ID = /^[a-zA-Z0-9._-]{1,64}$/;
export function requestContext(req, res, next) {
  const incoming = req.headers['x-request-id'];
  req.id = (typeof incoming === 'string' && SAFE_REQ_ID.test(incoming))
    ? incoming
    : `req_${crypto.randomBytes(8).toString('hex')}`;
  res.setHeader('X-Request-Id', req.id);
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    const line = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`;
    if (res.statusCode >= 500) logger.error(line, { requestId: req.id });
    else if (res.statusCode >= 400) logger.warn(line, { requestId: req.id });
    else logger.debug(line, { requestId: req.id });
  });
  next();
}

/** Simple in-memory rate limiter (không cần Redis cho môi trường 1 node, có trần RAM chống DoS) */
const MAX_BUCKETS = 50_000;
const buckets = new Map();
function pruneBuckets(now) {
  for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
}
setInterval(() => pruneBuckets(Date.now()), 60_000).unref();

export function rateLimit({ windowMs, max, keyPrefix = 'global', message } = {}) {
  const win = windowMs || config.rateLimit.globalWindowMs;
  const limit = max || config.rateLimit.globalMax;
  return (req, res, next) => {
    const ip = clientIp(req);
    const key = `${keyPrefix}:${ip}:${req.user?.id || ''}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.reset < now) {
      if (buckets.size >= MAX_BUCKETS) {
        pruneBuckets(now);
        if (buckets.size >= MAX_BUCKETS) {
          const oldest = buckets.keys().next().value;
          if (oldest !== undefined) buckets.delete(oldest);
        }
      }
      b = { count: 0, reset: now + win };
      buckets.set(key, b);
    }
    b.count++;
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - b.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(b.reset / 1000));
    if (b.count > limit) {
      res.setHeader('Retry-After', Math.ceil((b.reset - now) / 1000));
      return next(new AppError(429, 'RATE_LIMITED', message || 'Quá nhiều yêu cầu, vui lòng thử lại sau'));
    }
    next();
  };
}
