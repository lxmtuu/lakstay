import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db, withTransaction } from '../../db.js';
import { config } from '../../config/index.js';
import { validate } from '../../middlewares/validate.js';
import { rateLimit } from '../../middlewares/error.js';
import {
  requireAuth, optionalAuth, verifyCsrfCookie,
  signAccessToken, signRefreshToken, setAuthCookies, clearAuthCookies, COOKIE_REFRESH,
} from '../../middlewares/auth.js';
import { newId, sha256, randomToken } from '../../utils/id.js';
import { Errors } from '../../utils/errors.js';
import { ok, created, asyncHandler, clientIp, sanitize } from '../../utils/http.js';
import { audit, securityEvent } from '../../services/audit.service.js';
import { logger } from '../../utils/logger.js';

const router = Router();

const BCRYPT_ROUNDS = config.isProd ? 12 : 10; // prod tốn ~250ms/lần hash là CHUẨN (chống brute-force)
const DUMMY_HASH = bcrypt.hashSync('lakstay-anti-timing-dummy-secret', BCRYPT_ROUNDS);
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

const registerSchema = z.object({
  email: z.string().trim().email('Email không hợp lệ').max(120),
  password: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự').max(72)
    .regex(/[a-z]/, 'Mật khẩu cần có chữ thường')
    .regex(/[A-Z]/, 'Mật khẩu cần có chữ hoa')
    .regex(/\d/, 'Mật khẩu cần có số'),
  fullName: z.string().trim().min(2, 'Họ tên tối thiểu 2 ký tự').max(80),
  phone: z.string().trim().regex(/^(\+?84|0)\d{8,10}$/, 'Số điện thoại Việt Nam không hợp lệ').optional().or(z.literal('')),
  // role KHÔNG nhận từ client — chống privilege escalation. Luôn là 'customer'.
});

const loginSchema = z.object({
  email: z.string().trim().email().max(120),
  password: z.string().min(1).max(72),
});

/** Cấp cặp token + lưu refresh token (chỉ lưu HASH của refresh token) */
function issueTokens(res, user, { req, rotateFrom = null } = {}) {
  const accessToken = signAccessToken(user);
  const refreshToken = randomToken(48);
  const id = newId('rft');

  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, user_agent, ip, expires_at)
    VALUES (?,?,?,?,?,?)
  `).run(
    id, user.id, sha256(refreshToken),
    (req?.headers?.['user-agent'] || '').slice(0, 200), clientIp(req),
    new Date(Date.now() + config.jwt.refreshTtlDays * 86_400_000).toISOString().slice(0, 19).replace('T', ' '),
  );

  if (rotateFrom) {
    db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now'), replaced_by = ? WHERE id = ?`)
      .run(id, rotateFrom);
  }

  setAuthCookies(res, { accessToken, refreshToken, refreshDays: config.jwt.refreshTtlDays });
  if (!req?.cookies?.lks_csrf) {
    res.cookie('lks_csrf', randomToken(24), {
      httpOnly: false,
      sameSite: 'lax', secure: config.isProd, path: '/', maxAge: 86_400_000,
    });
  }
  return { accessToken, refreshToken };
}

/* ------------------------------------------------------------------ */
/*  CSRF: cấp token công khai (đọc được bởi JS) khớp với cookie        */
/* ------------------------------------------------------------------ */
router.get('/csrf', (req, res) => {
  let token = req.cookies?.lks_csrf;
  if (!token) {
    token = randomToken(24);
    res.cookie('lks_csrf', token, {
      httpOnly: false,          // JS PHẢI đọc được để gửi kèm header
      sameSite: 'lax', secure: config.isProd, path: '/', maxAge: 86_400_000,
    });
  }
  ok(res, { csrfToken: token });
});

/* ------------------------------------------------------------------ */
/*  REGISTER                                                           */
/* ------------------------------------------------------------------ */
router.post('/register',
  rateLimit({ windowMs: config.rateLimit.authWindowMs, max: config.rateLimit.registerMax, keyPrefix: 'register' }),
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const { email, password, fullName, phone } = req.body;

    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
    if (existing) {
      securityEvent({ type: 'REGISTER_DUPLICATE', ip: clientIp(req), email, userAgent: req.headers['user-agent'] });
      throw Errors.conflict('Email này đã được đăng ký');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const id = newId('usr');

    db.prepare(`
      INSERT INTO users (id, email, phone, password_hash, full_name, role, email_verified)
      VALUES (?,?,?,?,?,?,?)
    `).run(id, email, phone || null, passwordHash, fullName, 'customer', 0);

    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    const tokens = issueTokens(res, user, { req });

    audit({ req, actor: user, action: 'USER_REGISTERED', entityType: 'user', entityId: id, after: { email, role: 'customer' } });
    logger.info('User registered', { id, email });

    created(res, { user: sanitize(user), csrfToken: req.cookies?.lks_csrf || null }, { tokens });
  })
);

/* ------------------------------------------------------------------ */
/*  LOGIN — có lockout chống brute-force                               */
/* ------------------------------------------------------------------ */
router.post('/login',
  rateLimit({ windowMs: config.rateLimit.authWindowMs, max: config.rateLimit.authMax, keyPrefix: 'login' }),
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    const ip = clientIp(req);
    const ua = req.headers['user-agent'] || '';

    const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);

    // KHÔNG tiết lộ "email tồn tại hay không" — luôn trả cùng 1 thông điệp + cùng thời gian (hash đủ 60 ký tự cùng cost)
    const hashToCheck = user?.password_hash || DUMMY_HASH;
    const passwordOk = await bcrypt.compare(password, hashToCheck);

    if (!user) {
      securityEvent({ type: 'LOGIN_FAIL_UNKNOWN_EMAIL', ip, userAgent: ua, email });
      throw Errors.unauthorized('Email hoặc mật khẩu không đúng');
    }
    if (user.status !== 'active') {
      securityEvent({ type: 'LOGIN_FAIL_DISABLED', severity: 'critical', ip, userAgent: ua, email });
      throw Errors.forbidden('Tài khoản đã bị khoá. Liên hệ hỗ trợ.');
    }
    if (user.locked_until && new Date(user.locked_until.replace(' ', 'T') + 'Z') > new Date()) {
      const mins = Math.ceil((new Date(user.locked_until.replace(' ', 'T') + 'Z') - Date.now()) / 60_000);
      securityEvent({ type: 'LOGIN_WHILE_LOCKED', ip, userAgent: ua, email });
      throw Errors.locked(`Tài khoản tạm khoá do nhiều lần đăng nhập sai. Thử lại sau ${mins} phút.`);
    }
    if (!passwordOk) {
      const fails = (user.failed_logins || 0) + 1;
      const lockUntil = fails >= MAX_FAILED
        ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString().slice(0, 19).replace('T', ' ')
        : null;
      db.prepare(`UPDATE users SET failed_logins = ?, locked_until = COALESCE(?, locked_until) WHERE id = ?`)
        .run(fails, lockUntil, user.id);
      securityEvent({
        type: 'LOGIN_FAIL_BAD_PASSWORD', severity: fails >= MAX_FAILED ? 'critical' : 'warn',
        ip, userAgent: ua, email, detail: `attempt ${fails}`,
      });
      if (lockUntil) {
        throw Errors.locked(`Sai mật khẩu ${MAX_FAILED} lần — tài khoản tạm khoá ${LOCK_MINUTES} phút.`);
      }
      throw Errors.unauthorized('Email hoặc mật khẩu không đúng');
    }

    db.prepare(`UPDATE users SET failed_logins = 0, locked_until = NULL,
                last_login_at = datetime('now'), last_login_ip = ? WHERE id = ?`).run(ip, user.id);

    const tokens = issueTokens(res, user, { req });
    audit({ req, actor: user, action: 'USER_LOGIN', entityType: 'user', entityId: user.id, after: { ip } });

    ok(res, {
      user: sanitize(user),
      accessToken: tokens.accessToken,
    });
  })
);

/* ------------------------------------------------------------------ */
/*  REFRESH — rotation + reuse detection                               */
/* ------------------------------------------------------------------ */
router.post('/refresh', verifyCsrfCookie, asyncHandler(async (req, res) => {
  const token = req.cookies?.[COOKIE_REFRESH];
  if (!token) throw Errors.unauthorized('Không có refresh token');

  const hash = sha256(token);
  const row = db.prepare(`SELECT * FROM refresh_tokens WHERE token_hash = ?`).get(hash);
  if (!row) throw Errors.unauthorized('Refresh token không hợp lệ');

  // REUSE DETECTION: token đã bị revoke mà vẫn được dùng => nghi vấn bị đánh cắp
  // => thu hồi TOÀN BỘ phiên của user đó (panic logout)
  if (row.revoked_at) {
    db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ?`).run(row.user_id);
    securityEvent({
      type: 'REFRESH_TOKEN_REUSE', severity: 'critical', ip: clientIp(req),
      userAgent: req.headers['user-agent'], detail: `token ${row.id} reused after revoke`,
    });
    clearAuthCookies(res);
    throw Errors.unauthorized('Phiên đăng nhập không an toàn, vui lòng đăng nhập lại');
  }
  if (new Date(row.expires_at.replace(' ', 'T') + 'Z') < new Date()) {
    throw Errors.unauthorized('Refresh token đã hết hạn');
  }

  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(row.user_id);
  if (!user || user.status !== 'active') throw Errors.unauthorized('Tài khoản không khả dụng');

  const tokens = issueTokens(res, user, { req, rotateFrom: row.id });
  ok(res, { accessToken: tokens.accessToken });
}));

/* ------------------------------------------------------------------ */
/*  LOGOUT                                                             */
/* ------------------------------------------------------------------ */
router.post('/logout', optionalAuth, verifyCsrfCookie, asyncHandler(async (req, res) => {
  const token = req.cookies?.[COOKIE_REFRESH];
  if (token) {
    const row = db.prepare(`SELECT id, user_id FROM refresh_tokens WHERE token_hash = ?`).get(sha256(token));
    if (row) {
      db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE id = ?`).run(row.id);
      const actor = req.user || db.prepare(`SELECT id, role FROM users WHERE id = ?`).get(row.user_id);
      if (actor) audit({ req, actor, action: 'USER_LOGOUT', entityType: 'refresh_token', entityId: row.id });
    }
  } else if (req.user) {
    audit({ req, actor: req.user, action: 'USER_LOGOUT', entityType: 'user', entityId: req.user.id });
  }
  clearAuthCookies(res);
  res.clearCookie('lks_csrf', { path: '/' });
  ok(res, { loggedOut: true });
}));

/* ------------------------------------------------------------------ */
/*  ME / đổi mật khẩu / sessions                                       */
/* ------------------------------------------------------------------ */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const stats = db.prepare(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN status IN ('CONFIRMED','CHECKED_IN') THEN 1 ELSE 0 END) upcoming,
      SUM(CASE WHEN status='COMPLETED' THEN 1 ELSE 0 END) completed
    FROM bookings WHERE user_id = ?`).get(req.user.id);
  const loyalty = db.prepare(`
    SELECT COALESCE(SUM(amount),0) spent FROM payments p
    JOIN bookings b ON b.id = p.booking_id
    WHERE b.user_id = ? AND p.type='CHARGE' AND p.status='PAID'`).get(req.user.id).spent;

  ok(res, { user: sanitize(req.user), stats: { ...stats, total_spent: loyalty } });
}));

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(72)
    .regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/, 'Mật khẩu mới cần có chữ hoa, chữ thường và số'),
});

router.post('/change-password', requireAuth, validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user.id);
    if (!(await bcrypt.compare(req.body.currentPassword, user.password_hash))) {
      securityEvent({ type: 'CHANGE_PASSWORD_FAIL', ip: clientIp(req), email: user.email });
      throw Errors.badRequest('Mật khẩu hiện tại không đúng');
    }
    const hash = await bcrypt.hash(req.body.newPassword, BCRYPT_ROUNDS);
    db.prepare(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`).run(hash, user.id);
    // Thu hồi mọi phiên khác => kẻ tấn công bị đá ra
    db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`).run(user.id);
    audit({ req, actor: user, action: 'PASSWORD_CHANGED', entityType: 'user', entityId: user.id });
    ok(res, { changed: true, allSessionsRevoked: true });
  })
);

router.get('/sessions', requireAuth, asyncHandler(async (req, res) => {
  const rows = db.prepare(`
    SELECT id, user_agent, ip, created_at, expires_at, revoked_at FROM refresh_tokens
    WHERE user_id = ? ORDER BY created_at DESC LIMIT 20`).all(req.user.id);
  ok(res, { sessions: rows });
}));

router.post('/sessions/revoke-all', requireAuth, asyncHandler(async (req, res) => {
  db.prepare(`UPDATE refresh_tokens SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`).run(req.user.id);
  audit({ req, actor: req.user, action: 'SESSIONS_REVOKED_ALL', entityType: 'user', entityId: req.user.id });
  ok(res, { revoked: true });
}));

export default router;
