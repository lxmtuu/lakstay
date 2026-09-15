import crypto from 'node:crypto';

/** ID có prefix — dễ debug, không lộ số lượng bản ghi (khác auto-increment) */
export const newId = (prefix) =>
  `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // bỏ I,O,0,1 => tránh nhầm khi đọc mã
/** Mã booking cho người dùng đọc/đọc qua điện thoại: LKS-8F3K2Q */
export function newBookingCode(prefix = 'LKS') {
  const bytes = crypto.randomBytes(8);
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}-${s}`;
}

/** Mã giao dịch ngắn dùng làm nội dung chuyển khoản VietQR */
export function newTxnRef(bookingCode) {
  const clean = String(bookingCode).replace(/[^A-Z0-9]/g, '');
  const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `${clean}${suffix}`.slice(0, 20);
}

/** Constant-time compare — chống timing attack */
export function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
