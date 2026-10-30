import 'dotenv/config';
import { fromHere } from '../utils/paths.js';

const req = (name, fallback) => {
  const v = process.env[name] ?? fallback;
  if (v === undefined) throw new Error(`Missing required env: ${name}`);
  return v;
};

/**
 * SECURITY GUARD: ở production, từ chối khởi động nếu secret vẫn là giá trị dev
 * mặc định (hoặc trống). Dev/test/Docker-CI dùng secret tuỳ chọn khác vẫn chạy.
 */
const DEV_SECRETS = new Set([
  '', 'dev-access-secret-change-me', 'dev-refresh-secret-change-me',
  'dev-webhook-secret', 'dev-webhook-secret-change-me',
]);

const parseTrustProxy = (v) => {
  if (v === undefined || v === '') return 1;
  if (v === 'true') return true;
  if (v === 'false') return false;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : v;
};

const isVercel = Boolean(process.env.VERCEL);
const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || '';

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  isVercel,
  demoMode: ['1', 'true'].includes(String(process.env.DEMO_MODE || '').toLowerCase()),
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  publicUrl: process.env.PUBLIC_URL || (vercelHost ? `https://${vercelHost}` : `http://localhost:${process.env.PORT || 3000}`),

  db: {
    file: process.env.DB_FILE || (isVercel ? '/tmp/lakstay.db' : fromHere(import.meta.url, '..', 'data', 'lakstay.db')),
  },

  jwt: {
    accessSecret: req('JWT_ACCESS_SECRET', 'dev-access-secret-change-me'),
    refreshSecret: req('JWT_REFRESH_SECRET', 'dev-refresh-secret-change-me'),
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS || 30),
  },

  booking: {
    // Thời gian "giữ chỗ" của booking PENDING trước khi tự huỷ & nhả phòng
    holdMinutes: Number(process.env.BOOKING_HOLD_MINUTES || 15),
    maxRoomsPerBooking: Number(process.env.MAX_ROOMS_PER_BOOKING || 5),
    maxNights: 30,
    maxGuestsPerBooking: 12,
    minAdvanceHours: 1,
  },

  rateLimit: {
    globalWindowMs: 60_000,
    globalMax: Number(process.env.RL_GLOBAL_MAX || 600),
    authWindowMs: 15 * 60_000,
    authMax: Number(process.env.RL_AUTH_MAX || 20),
    registerMax: Number(process.env.RL_REGISTER_MAX || 10),
    bookingWindowMs: 60_000,
    bookingMax: Number(process.env.RL_BOOKING_MAX || 10),
  },

  bank: {
    // Thông tin thụ hưởng dùng cho VietQR (EMVCo). Thay bằng tài khoản thật khi deploy.
    bin: process.env.BANK_BIN || '970436',           // Vietcombank
    bankName: process.env.BANK_NAME || 'Vietcombank',
    account: process.env.BANK_ACCOUNT || '1018734562',
    accountName: process.env.BANK_ACCOUNT_NAME || 'LAKSTAY HOTEL JSC',
  },

  payment: {
    qrExpireMinutes: Number(process.env.QR_EXPIRE_MINUTES || 15),
    // Secret ký webhook (mock gateway). Prod: lấy từ nhà cung cấp.
    webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || 'dev-webhook-secret',
  },

  app: {
    name: 'LakStay',
    taxPct: Number(process.env.TAX_PCT || 10),        // VAT
    serviceFeePct: Number(process.env.SERVICE_FEE_PCT || 5),
    weekendSurchargePct: Number(process.env.WEEKEND_SURCHARGE_PCT || 15), // T6, T7, CN
  },
};

export default config;

/* ---------- khởi động an toàn: chặn secret dev ở production ---------- */
if (config.isProd) {
  const weak = [
    ['JWT_ACCESS_SECRET', config.jwt.accessSecret],
    ['JWT_REFRESH_SECRET', config.jwt.refreshSecret],
    ['PAYMENT_WEBHOOK_SECRET', config.payment?.webhookSecret],
  ].filter(([, v]) => DEV_SECRETS.has(v || ''));
  if (weak.length) {
    throw new Error(`[SECURITY] NODE_ENV=production nhưng các secret sau vẫn là giá trị dev/trống: ${weak.map(([n]) => n).join(', ')}. Hãy đặt secret mạnh (vd: openssl rand -hex 32).`);
  }
}
