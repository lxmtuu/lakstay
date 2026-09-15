import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config/index.js';
import { fromHere } from './utils/paths.js';
import { requestContext, errorHandler, apiNotFound, rateLimit } from './middlewares/error.js';
import { ok, clientIp } from './utils/http.js';
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
  app.set('trust proxy', 1); // đứng sau reverse proxy (nginx) thì cần để lấy đúng IP
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
