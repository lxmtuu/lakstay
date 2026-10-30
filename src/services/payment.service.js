import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { db, withTransaction } from '../db.js';
import { config } from '../config/index.js';
import { newId, newTxnRef, safeEqual, sha256 } from '../utils/id.js';
import { Errors, BizCode } from '../utils/errors.js';
import { plusMinutesISO } from '../utils/date.js';
import { buildVietQRPayload, buildQRDataUri, vietqrImageUrl, normalizeTransferContent, bankInfo } from './vietqr.service.js';
import { confirmBooking, getBookingById } from './booking.service.js';
import { earnForBooking } from './loyalty.service.js';
import { audit } from './audit.service.js';
import { logger } from '../utils/logger.js';

/**
 * ============================================================================
 *  PAYMENT SERVICE
 * ============================================================================
 *  Ba quy tắc sống còn khi làm thanh toán:
 *
 *  1. IDEMPOTENCY — Webhook LUÔN bị gọi lại (network retry, user bấm 2 lần).
 *     Dùng `provider_txn_id UNIQUE` + check trạng thái trước khi update.
 *     Xử lý 2 lần cũng chỉ ghi nhận tiền 1 lần.
 *
 *  2. RECONCILIATION — Nguồn sự thật là SAO KÊ NGÂN HÀNG, không phải UI.
 *     Nội dung chuyển khoản chứa txn_ref => đối soát tự động, không cần người.
 *
 *  3. AMOUNT MATCHING — Nhận đủ tiền mới xác nhận. Thiếu 1đ vẫn là chưa thanh toán
 *     (ghi nhận vào metadata để CSKH xử lý).
 * ============================================================================
 */

/**
 * Bus sự kiện thanh toán — dùng cho SSE realtime.
 * Client không cần poll nữa: server đẩy trạng thái ngay khi webhook tới.
 * (1 node: EventEmitter đủ. Nhiều node: thay bằng Redis pub/sub.)
 */
export const paymentEvents = new EventEmitter();
paymentEvents.setMaxListeners(200);

const PROVIDERS = {
  VIETQR: { name: 'Chuyển khoản VietQR (quét mã QR)', instant: true },
  MOMO: { name: 'Ví MoMo', instant: true },
  VNPAY: { name: 'Cổng VNPAY', instant: true },
  CARD: { name: 'Thẻ quốc tế', instant: true },
  CASH: { name: 'Thanh toán tại quầy', instant: false },
  MANUAL: { name: 'Chuyển khoản thủ công', instant: false },
};

export const paymentProviders = () =>
  Object.entries(PROVIDERS).map(([id, v]) => ({ id, ...v }));

/**
 * Tạo payment + QR cho 1 booking.
 *
 * LƯU Ý KIẾN TRÚC: better-sqlite3 là ĐỒNG BỘ, nên transaction phải đồng bộ.
 * Việc sinh QR (async) được làm NGOÀI transaction, rồi mới vào transaction
 * để ghi. Trong transaction có re-check "đã có QR PENDING chưa?" để vẫn an toàn
 * khi 2 request chạy song song.
 */
export async function createPayment({ bookingId, provider = 'VIETQR', amount = null, userId, idempotencyKey = null, req = null }) {
  if (!PROVIDERS[provider]) throw Errors.badRequest('Phương thức thanh toán không hợp lệ');
  const actorRole = req?.user?.role || 'customer';

  // ---------- PHA 1: đọc & validate (không lock) ----------
  const b = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId);
  if (!b) throw Errors.notFound('Không tìm thấy booking');
  if (b.user_id !== userId && !['staff', 'admin'].includes(actorRole)) {
    throw Errors.forbidden('Bạn không có quyền thanh toán booking này');
  }
  if (!['PENDING', 'CONFIRMED'].includes(b.status)) {
    throw Errors.conflict(`Booking ở trạng thái ${b.status} không thể thanh toán`, { code: BizCode.INVALID_TRANSITION });
  }
  if (idempotencyKey) {
    const dup = db.prepare(`SELECT * FROM payments WHERE idempotency_key = ?`).get(idempotencyKey);
    if (dup) return { payment: decoratePayment(dup), replayed: true };
  }
  const paid = db.prepare(`
    SELECT COALESCE(SUM(amount),0) n FROM payments
    WHERE booking_id = ? AND type='CHARGE' AND status='PAID'`).get(bookingId).n;
  const outstanding = b.total_amount - paid;

  const reuse = db.prepare(`
    SELECT * FROM payments
    WHERE booking_id = ? AND status = 'PENDING' AND provider = ? AND expired_at > datetime('now')
    ORDER BY created_at DESC LIMIT 1`).get(bookingId, provider);
  if (reuse && (!amount || amount === reuse.amount)) {
    return { payment: decoratePayment(reuse), replayed: true, reused: true };
  }
  if (outstanding <= 0) throw Errors.conflict('Booking đã được thanh toán đủ', { code: BizCode.PAYMENT_MISMATCH });

  const payAmount = amount ?? outstanding;
  if (actorRole === 'customer' && payAmount !== outstanding) {
    throw Errors.badRequest(`Vui lòng thanh toán toàn bộ số tiền còn lại (${outstanding.toLocaleString('vi-VN')}₫)`);
  }
  if (payAmount > outstanding) {
    throw Errors.badRequest(`Số tiền vượt quá phần còn phải thanh toán (${outstanding.toLocaleString('vi-VN')}₫)`);
  }
  if (!Number.isInteger(payAmount) || payAmount < 1000) {
    throw Errors.badRequest('Số tiền không hợp lệ (tối thiểu 1.000₫)');
  }

  // ---------- PHA 2: sinh QR (async, ngoài transaction) ----------
  const id = newId('pay');
  const txnRef = newTxnRef(b.code);
  const expiredAt = plusMinutesISO(config.payment.qrExpireMinutes);
  const transferContent = `LAKSTAY ${txnRef}`;

  let qrPayload = null, qrDataUri = null, qrUrl = null;
  if (provider === 'VIETQR' || provider === 'MANUAL') {
    qrPayload = buildVietQRPayload({ amount: payAmount, content: transferContent });
    qrDataUri = await buildQRDataUri(qrPayload);
    qrUrl = vietqrImageUrl({ amount: payAmount, content: transferContent });
  } else {
    // Mock redirect URL. Prod: gọi API cổng thanh toán, nhận về payUrl + ký HMAC theo spec.
    qrPayload = `${config.publicUrl}/checkout/${provider.toLowerCase()}/${txnRef}`;
  }

  const metadata = JSON.stringify({
    booking_code: b.code,
    transfer_content: transferContent,
    outstanding_before: outstanding,
    qr_url: qrUrl,
  });

  // ---------- PHA 3: ghi trong transaction (đồng bộ) ----------
  const row = withTransaction((tx) => {
    // Re-check bên trong transaction: nếu request song song đã tạo QR thì dùng lại
    const race = tx.prepare(`
      SELECT * FROM payments WHERE booking_id = ? AND status='PENDING' AND provider = ?
        AND expired_at > datetime('now') ORDER BY created_at DESC LIMIT 1`).get(bookingId, provider);
    if (race && race.amount === payAmount) return { payment: race, reused: true };

    tx.prepare(`
      INSERT INTO payments (id, booking_id, user_id, provider, type, status, amount, currency,
                            txn_ref, qr_payload, qr_image, bank_bin, bank_account, bank_account_name,
                            metadata, idempotency_key, expired_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, bookingId, userId, provider, 'CHARGE', 'PENDING', payAmount, 'VND',
      txnRef, qrPayload, qrDataUri,
      config.bank.bin, config.bank.account, config.bank.accountName,
      metadata, idempotencyKey, expiredAt,
    );
    return { payment: tx.prepare(`SELECT * FROM payments WHERE id = ?`).get(id), reused: false };
  });

  if (!row.reused) {
    audit({ req, actor: { id: userId, role: actorRole }, action: 'PAYMENT_CREATED',
            entityType: 'payment', entityId: row.payment.id,
            after: { amount: payAmount, provider, txn_ref: txnRef } });
  }

  return {
    payment: decoratePayment(row.payment),
    replayed: false,
    reused: row.reused,
    qr_url: qrUrl,
    transfer_content: transferContent,
    bank: bankInfo(),
  };
}

/** Gắn thêm thông tin ngân hàng + QR URL để client render, không phải gọi thêm API */
function decoratePayment(p) {
  if (!p) return p;
  let meta = {};
  try { meta = JSON.parse(p.metadata || '{}'); } catch { /* ignore */ }
  return {
    ...p,
    bank: bankInfo(),
    transfer_content: meta.transfer_content || null,
    qr_url: meta.qr_url || null,
    expires_in_seconds: p.expired_at
      ? Math.max(0, Math.round((new Date(p.expired_at.replace(' ', 'T') + 'Z').getTime() - Date.now()) / 1000))
      : null,
  };
}


/**
 * Ký webhook payload (mock gateway) — prod: nhà cung cấp ký, mình verify.
 * LƯU Ý: phải ký trên CHUỖI GỐC từng byte nhận được (rawBody), không phải trên
 * object đã parse rồi stringify lại — thứ tự key/khoảng trắng sẽ khác => sai chữ ký.
 */
export function signWebhook(payload) {
  const raw = Buffer.isBuffer(payload)
    ? payload.toString('utf8')
    : typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', config.payment.webhookSecret).update(raw, 'utf8').digest('hex');
}

export function verifyWebhookSignature(rawBody, signature) {
  if (!signature) return false;
  return safeEqual(signWebhook(rawBody), signature.replace(/^sha256=/, ''));
}

/**
 * Xử lý webhook / notify thanh toán thành công.
 * IDEMPOTENT: gọi bao nhiêu lần cũng chỉ 1 hiệu ứng.
 */
export function handlePaymentSuccess({ txnRef = null, providerTxnId = null, amount = null, rawPayload = null, provider = 'VIETQR', req = null }) {
  if (!txnRef && !providerTxnId) throw Errors.badRequest('Thiếu txnRef hoặc providerTxnId');

  const logId = newId('whl');
  db.prepare(`INSERT INTO payment_webhook_logs (id, provider, event_id, payload, signature)
              VALUES (?,?,?,?,?)`)
    .run(logId, provider, providerTxnId || txnRef, JSON.stringify(rawPayload || {}),
         req?.headers?.['x-signature'] || null);

  return withTransaction((tx) => {
    let payment = txnRef
      ? tx.prepare(`SELECT * FROM payments WHERE txn_ref = ?`).get(String(txnRef).toUpperCase())
      : tx.prepare(`SELECT * FROM payments WHERE provider_txn_id = ?`).get(providerTxnId);

    if (!payment && rawPayload?.content) {
      // Fallback: tìm theo nội dung chuyển khoản (reconciliation thật của ngân hàng)
      const ref = extractTxnRef(rawPayload.content);
      if (ref) payment = tx.prepare(`SELECT * FROM payments WHERE txn_ref = ?`).get(ref);
    }
    if (!payment) {
      tx.prepare(`UPDATE payment_webhook_logs SET error = 'payment not found' WHERE id = ?`).run(logId);
      throw Errors.notFound('Không tìm thấy giao dịch thanh toán');
    }

    // ---- IDEMPOTENCY: đã PAID rồi thì trả về luôn, KHÔNG cộng tiền lần 2 ----
    if (payment.status === 'PAID') {
      tx.prepare(`UPDATE payment_webhook_logs SET processed = 1 WHERE id = ?`).run(logId);
      return { payment, booking: getBookingById(payment.booking_id), duplicate: true };
    }
    if (payment.status === 'EXPIRED' || payment.status === 'FAILED') {
      tx.prepare(`UPDATE payment_webhook_logs SET error = ? WHERE id = ?`)
        .run(`payment already ${payment.status}`, logId);
      throw Errors.conflict(`Giao dịch đã ${payment.status === 'EXPIRED' ? 'hết hạn' : 'thất bại'}, không thể ghi nhận`);
    }

    const booking = tx.prepare(`SELECT * FROM bookings WHERE id = ?`).get(payment.booking_id);
    if (!booking || ['CANCELLED', 'EXPIRED', 'NO_SHOW', 'REFUNDED'].includes(booking.status)) {
      tx.prepare(`UPDATE payment_webhook_logs SET error = ? WHERE id = ?`)
        .run(`booking already ${booking?.status || 'missing'}`, logId);
      throw Errors.conflict(`Booking đã ở trạng thái ${booking?.status || 'không hợp lệ'}, không thể ghi nhận thanh toán`);
    }

    // ---- AMOUNT MATCHING ----
    const received = Number(amount ?? payment.amount);
    if (received < payment.amount) {
      const meta = JSON.parse(payment.metadata || '{}');
      meta.underpaid = payment.amount - received;
      tx.prepare(`UPDATE payments SET metadata = ? WHERE id = ?`).run(JSON.stringify(meta), payment.id);
      tx.prepare(`UPDATE payment_webhook_logs SET error = ? WHERE id = ?`)
        .run(`underpaid: ${received}/${payment.amount}`, logId);
      throw Errors.unprocessable('Số tiền nhận được thấp hơn số phải thanh toán', {
        code: BizCode.PAYMENT_MISMATCH, expected: payment.amount, received,
      });
    }

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const meta = (() => { try { return JSON.parse(payment.metadata || '{}'); } catch { return {}; } })();
    meta.received = received;
    meta.overpaid = received - payment.amount;
    meta.provider_txn_id = providerTxnId || meta.provider_txn_id || null;
    meta.paid_at = now;

    tx.prepare(`
      UPDATE payments
         SET status = 'PAID', paid_at = ?, provider_txn_id = COALESCE(?, provider_txn_id),
             amount = ?, metadata = ?, updated_at = ?
       WHERE id = ? AND status = 'PENDING'
    `).run(now, providerTxnId || null, received, JSON.stringify(meta), now, payment.id);

    // ---- Kích hoạt state machine: PENDING -> CONFIRMED (chỉ khi đã thu đủ tổng đơn) ----
    const totalPaid = tx.prepare(`
      SELECT COALESCE(SUM(amount),0) n FROM payments
      WHERE booking_id = ? AND type = 'CHARGE' AND status = 'PAID'`).get(booking.id).n;

    if (booking.status === 'PENDING' && totalPaid >= booking.total_amount) {
      tx.prepare(`UPDATE bookings SET status='CONFIRMED', confirmed_at=?, hold_expires_at=NULL,
                  version = version + 1, updated_at=? WHERE id=? AND status='PENDING'`)
        .run(now, now, booking.id);
      tx.prepare(`UPDATE room_calendar SET status='CONFIRMED' WHERE booking_id=?`).run(booking.id);
    }
    // ---- LOYALTY: cộng điểm TRONG cùng transaction khi đã thanh toán đủ (atomic, idempotent) ----
    let loyalty = null;
    if (totalPaid >= booking.total_amount) {
      loyalty = earnForBooking({
        userId: booking.user_id, bookingId: booking.id, amount: booking.total_amount,
        note: `Tích điểm đơn ${booking.code}`,
      }, tx);
    }
    if (loyalty) logger.info('Loyalty points earned', { user: booking.user_id, points: loyalty.points, tier: loyalty.tier });

    // Huỷ các QR PENDING khác của cùng booking khi đã thu đủ tiền
    if (totalPaid >= booking.total_amount) {
      tx.prepare(`UPDATE payments SET status='EXPIRED' WHERE booking_id=? AND status='PENDING' AND id<>?`)
        .run(payment.booking_id, payment.id);
    }

    tx.prepare(`UPDATE payment_webhook_logs SET processed = 1 WHERE id = ?`).run(logId);

    audit({ req, actor: { id: 'system', role: 'system' }, action: 'PAYMENT_PAID',
            entityType: 'payment', entityId: payment.id,
            after: { amount: received, booking_id: payment.booking_id, provider_txn_id: providerTxnId } });
    logger.info('Payment confirmed', { txn: payment.txn_ref, amount: received });

    paymentEvents.emit('status', {
      paymentId: payment.id, bookingId: payment.booking_id, status: 'PAID',
      amount: received, bookingCode: booking.code, at: now,
    });

    return { payment: { ...payment, status: 'PAID', amount: received }, duplicate: false,
             booking: getBookingById(payment.booking_id), overpaid: received - payment.amount };
  });
}

/** Trích txn_ref từ nội dung chuyển khoản ngân hàng gửi về */
export function extractTxnRef(content) {
  if (!content) return null;
  const norm = normalizeTransferContent(content);
  const m = norm.match(/LKS[A-Z0-9]{6,20}/);
  return m ? m[0] : null;
}

/** Nhân viên xác nhận đã nhận tiền thủ công (có audit + yêu cầu role) */
export function markPaidManually({ paymentId, actor, req, note }) {
  const p = db.prepare(`SELECT * FROM payments WHERE id = ?`).get(paymentId);
  if (!p) throw Errors.notFound('Không tìm thấy giao dịch');
  if (p.status === 'PAID') return { payment: p, duplicate: true };
  const res = handlePaymentSuccess({
    txnRef: p.txn_ref, amount: p.amount, provider: p.provider,
    rawPayload: { manual: true, note, by: actor.id }, req,
  });
  audit({ req, actor, action: 'PAYMENT_MANUAL_CONFIRM', entityType: 'payment', entityId: paymentId, after: { note } });
  return res;
}

/** Hoàn tiền — chỉ tạo record + cập nhật booking, tiền thật đi qua cổng thanh toán */
export function refundPayment({ bookingId, amount = null, actor, req, reason }) {
  return withTransaction((tx) => {
    const b = tx.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId);
    if (!b) throw Errors.notFound('Không tìm thấy booking');

    const charged = tx.prepare(`
      SELECT COALESCE(SUM(amount),0) n FROM payments
      WHERE booking_id=? AND type='CHARGE' AND status='PAID'`).get(bookingId).n;
    const refunded = tx.prepare(`
      SELECT COALESCE(SUM(amount),0) n FROM payments
      WHERE booking_id=? AND type='REFUND' AND status='PAID'`).get(bookingId).n;
    const available = charged - refunded;

    if (available <= 0) throw Errors.conflict('Không còn khoản nào để hoàn');
    const refundAmount = amount ?? available;
    if (refundAmount > available) throw Errors.badRequest(`Chỉ có thể hoàn tối đa ${available.toLocaleString('vi-VN')}₫`);

    const id = newId('pay');
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    tx.prepare(`
      INSERT INTO payments (id, booking_id, user_id, provider, type, status, amount, currency,
                            txn_ref, metadata, paid_at, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(id, bookingId, b.user_id, 'MANUAL', 'REFUND', 'PAID', refundAmount, 'VND',
      newTxnRef(`RF${b.code}`), JSON.stringify({ reason, by: actor.id, refunded_from: charged }), now, now, now);

    const totalRefunded = refunded + refundAmount;
    const nextStatus = (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(b.status) && totalRefunded >= charged)
      ? 'REFUNDED'
      : b.status;
    if (nextStatus === 'REFUNDED') {
      tx.prepare(`UPDATE bookings SET status='REFUNDED', updated_at=?, version=version+1 WHERE id=?`)
        .run(now, bookingId);
    }

    audit({ req, actor, action: 'PAYMENT_REFUNDED', entityType: 'payment', entityId: id,
            before: { status: b.status, refunded }, after: { amount: refundAmount, total_refunded: totalRefunded, reason } });

    return { refund_id: id, amount: refundAmount, total_refunded: totalRefunded, booking_status: nextStatus };
  });
}

/** Huỷ QR quá hạn chưa thanh toán (job) */
export function expireStalePayments() {
  const rows = db.prepare(`SELECT id, booking_id FROM payments
                           WHERE status='PENDING' AND expired_at IS NOT NULL AND expired_at < datetime('now')`).all();
  if (!rows.length) return 0;
  db.prepare(`UPDATE payments SET status='EXPIRED'
              WHERE status='PENDING' AND expired_at IS NOT NULL AND expired_at < datetime('now')`).run();
  for (const r of rows) paymentEvents.emit('status', { paymentId: r.id, bookingId: r.booking_id, status: 'EXPIRED' });
  logger.info('Expired stale payments', { count: rows.length });
  return rows.length;
}

/** Trạng thái thanh toán cho UI polling */
export function paymentStatus(paymentId) {
  const p = db.prepare(`SELECT id, booking_id, provider, status, amount, txn_ref, paid_at, expired_at, metadata
                        FROM payments WHERE id = ?`).get(paymentId);
  if (!p) throw Errors.notFound('Không tìm thấy giao dịch');
  const b = db.prepare(`SELECT code, status, total_amount FROM bookings WHERE id = ?`).get(p.booking_id);
  return { payment: p, booking: b };
}
