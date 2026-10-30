import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import { fromHere } from './utils/paths.js';
import { requestContext, errorHandler, apiNotFound, rateLimit } from './middlewares/error.js';
import { ok, maskPhone } from './utils/http.js';
import { dmyVN } from './utils/format.js';
import { STATUS_META } from './services/booking-state.js';
import { db } from './db.js';

import authRoutes from './modules/auth/auth.routes.js';
import roomRoutes from './modules/rooms/rooms.routes.js';
import bookingRoutes from './modules/bookings/bookings.routes.js';
import paymentRoutes from './modules/payments/payments.routes.js';
import reviewRoutes from './modules/reviews/reviews.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import loyaltyRoutes from './modules/loyalty/loyalty.routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', config.trustProxy); // đứng sau reverse proxy (nginx) thì cần để lấy đúng IP
  app.disable('x-powered-by');

  /* ---------------- SECURITY HEADERS ---------------- */
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://img.vietqr.io', 'https://images.unsplash.com'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }));

  /* ---------------- BODY PARSING ----------------
     Giữ lại rawBody để verify chữ ký webhook (HMAC tính trên chuỗi gốc,
     nếu parse rồi mới ký lại sẽ sai vì thứ tự key / khoảng trắng). */
  app.use(express.json({
    limit: '100kb', // chặn payload khổng lồ (DoS)
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());

  app.use(requestContext);

  /* ---------------- CORS ---------------- */
  const allowedOrigins = (process.env.CORS_ORIGINS || config.publicUrl).split(',').map((s) => s.trim());
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-CSRF-Token,Idempotency-Key,X-Request-Id');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  /* ---------------- GLOBAL RATE LIMIT ---------------- */
  app.use('/api', rateLimit({
    windowMs: config.rateLimit.globalWindowMs,
    max: config.rateLimit.globalMax,
    keyPrefix: 'global',
  }));

  /* ---------------- HEALTH ---------------- */
  app.get('/healthz', (_req, res) => {
    const start = Date.now();
    try {
      db.prepare('SELECT 1').get();
      res.json({ status: 'ok', uptime: process.uptime(), db_ms: Date.now() - start, time: new Date().toISOString() });
    } catch (err) {
      res.status(503).json({ status: 'degraded', error: err.message });
    }
  });

  /* ---------------- PUBLIC API (không cần auth) ---------------- */
  const publicRouter = express.Router();

  /** GET /api/site — cấu hình công khai cho frontend (tên, liên hệ, MXH) */
  publicRouter.get('/site', (_req, res) => {
    ok(res, {
      name: config.app.name,
      tagline: 'Nghỉ dưỡng giữa lòng Đà Lạt',
      address: '18 Trần Phú, Phường 3, TP. Đà Lạt, Lâm Đồng',
      phone: '0263 3 888 999',
      hotline: '1900 6789',
      email: 'booking@lakstay.vn',
      checkin_time: '14:00',
      checkout_time: '12:00',
      tax_pct: config.app.taxPct,
      service_fee_pct: config.app.serviceFeePct,
      currency: 'VND',
      socials: [
        { id: 'facebook', name: 'Facebook', url: 'https://facebook.com/lakstay.hotel', icon: 'facebook' },
        { id: 'instagram', name: 'Instagram', url: 'https://instagram.com/lakstay.hotel', icon: 'instagram' },
        { id: 'tiktok', name: 'TikTok', url: 'https://tiktok.com/@lakstay.hotel', icon: 'tiktok' },
        { id: 'youtube', name: 'YouTube', url: 'https://youtube.com/@lakstay', icon: 'youtube' },
        { id: 'zalo', name: 'Zalo', url: 'https://zalo.me/1900678900', icon: 'zalo' },
        { id: 'twitter', name: 'X (Twitter)', url: 'https://x.com/lakstay', icon: 'twitter' },
      ],
      payment_methods: ['VIETQR', 'MOMO', 'VNPAY', 'CARD', 'CASH'],
    });
  });

  app.use('/api', publicRouter);
  app.use('/api/auth', authRoutes);
  app.use('/api/rooms', roomRoutes);
  app.use('/api/bookings', bookingRoutes);
  app.use('/api/payments', paymentRoutes);
  app.use('/api/reviews', reviewRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/loyalty', loyaltyRoutes);

  /* ---------------- VOUCHER QR VERIFICATION (/verify/:code) ---------------- */
  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
  const maskGuestName = (n = '') => {
    const parts = String(n).trim().split(/\s+/);
    if (parts.length <= 1) return n;
    return `${parts[0]} ${parts.slice(1, -1).map((x) => `${x[0] || ''}.`).join(' ')} ${parts[parts.length - 1]}`.replace(/\s+/g, ' ');
  };

  app.get('/verify/:code',
    rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'verify' }),
    (req, res) => {
      const code = String(req.params.code || '').trim().toUpperCase();
      const b = /^[A-Z0-9-]{4,20}$/.test(code)
        ? db.prepare(`SELECT id, code, status, check_in, check_out, nights, guests, guest_name, guest_phone
                      FROM bookings WHERE code = ?`).get(code)
        : null;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      if (!b) {
        return res.status(404).send(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
          <title>Xác thực phiếu — LakStay</title></head>
          <body style="margin:0;background:#f4f2ec;font-family:system-ui,-apple-system,sans-serif;padding:32px 16px">
            <div style="max-width:460px;margin:auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 8px 30px rgba(0,0,0,.08);text-align:center">
              <h2 style="color:#b0413e;margin:0 0 8px">Không tìm thấy mã đặt phòng</h2>
              <p style="color:#5b6770;font-size:14px">Mã <b>${escHtml(code)}</b> không tồn tại trong hệ thống LakStay.</p>
              <a href="/" style="display:inline-block;margin-top:14px;color:#0c3527;font-weight:600">Về trang chủ</a>
            </div></body></html>`);
      }
      const lines = db.prepare(`
        SELECT br.qty, rt.name_vi FROM booking_rooms br
        JOIN room_types rt ON rt.id = br.room_type_id WHERE br.booking_id = ?`).all(b.id);
      const st = STATUS_META[b.status] || { vi: b.status };
      const valid = ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'].includes(b.status);
      return res.send(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>Xác thực ${escHtml(b.code)} — LakStay</title></head>
        <body style="margin:0;background:#f4f2ec;font-family:system-ui,-apple-system,sans-serif;padding:32px 16px;color:#15201a">
          <div style="max-width:480px;margin:auto;background:#fffdf7;border-radius:16px;overflow:hidden;box-shadow:0 10px 32px rgba(12,53,39,.12)">
            <div style="background:#0c3527;color:#fff;padding:22px 26px">
              <div style="font-size:20px;font-weight:700">LakStay <span style="color:#e3c47e;font-size:11px;letter-spacing:2px">XÁC THỰC VOUCHER</span></div>
              <div style="margin-top:6px;font-size:13px;color:#cfd8d3">Mã đặt phòng: <b>${escHtml(b.code)}</b></div>
            </div>
            <div style="padding:24px 26px;font-size:14px;line-height:1.6">
              <div style="padding:10px 14px;border-radius:10px;font-weight:700;margin-bottom:16px;background:${valid ? '#e6f4ee' : '#fdf3dc'};color:${valid ? '#1d6a4e' : '#8a6116'}">
                ${valid ? '✓ Phiếu hợp lệ' : '• Trạng thái'} — ${escHtml(st.vi)}
              </div>
              <div><b>Khách lưu trú:</b> ${escHtml(maskGuestName(b.guest_name))} (${escHtml(maskPhone(b.guest_phone))})</div>
              <div><b>Nhận phòng:</b> ${escHtml(dmyVN(b.check_in))} (từ 14:00)</div>
              <div><b>Trả phòng:</b> ${escHtml(dmyVN(b.check_out))} (trước 12:00) · ${Number(b.nights)} đêm · ${Number(b.guests)} khách</div>
              <div><b>Hạng phòng:</b> ${escHtml(lines.map((l) => `${l.qty}× ${l.name_vi}`).join(', '))}</div>
              <div style="margin-top:20px;padding-top:14px;border-top:1px solid #efe6d6;display:flex;justify-content:space-between;font-size:13px">
                <a href="/" style="color:#0c3527;text-decoration:none;font-weight:600">← Trang chủ</a>
                <a href="/admin.html#/bookings?q=${encodeURIComponent(b.code)}" style="color:#0c3527;text-decoration:none;font-weight:600">Mở trong Lễ tân →</a>
              </div>
            </div>
          </div></body></html>`);
    });

  /* ---------------- STATIC FRONTEND ---------------- */
  const publicDir = fromHere(import.meta.url, '..', 'public');
  app.use(express.static(publicDir, {
    maxAge: config.isProd ? '7d' : 0,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  }));

  // SPA-ish fallback: route không phải /api và không có đuôi file => index.html
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
    if (path.extname(req.path)) return next();
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  /* ---------------- ERROR ---------------- */
  app.use('/api', apiNotFound);
  app.use(errorHandler);

  return app;
}

export default createApp;
