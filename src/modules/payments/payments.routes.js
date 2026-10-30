import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth, requireRole } from '../../middlewares/auth.js';
import { rateLimit } from '../../middlewares/error.js';
import { config } from '../../config/index.js';
import { asyncHandler, ok, clientIp, paginate, pageMeta } from '../../utils/http.js';
import { Errors } from '../../utils/errors.js';
import {
  paymentProviders, createPayment, handlePaymentSuccess, paymentStatus,
  verifyWebhookSignature, signWebhook, extractTxnRef, markPaidManually,
  refundPayment,
} from '../../services/payment.service.js';
import { parseVietQRPayload, bankInfo } from '../../services/vietqr.service.js';
import { audit, securityEvent } from '../../services/audit.service.js';
import { paymentEvents } from '../../services/payment.service.js';
import { notify } from '../../services/mail.service.js';
import { renderVoucherPDF } from '../../services/voucher.service.js';
import { getBookingById } from '../../services/booking.service.js';

/**
 * Hậu xử lý sau khi thanh toán thành công: gửi email xác nhận kèm voucher PDF.
 * Fire-and-forget + catch toàn bộ => KHÔNG bao giờ làm hỏng luồng webhook.
 */
function sendConfirmationEmail(bookingId) {
  (async () => {
    try {
      const booking = getBookingById(bookingId);
      if (!booking) return;
      let attachments = [];
      try {
        const pdf = await renderVoucherPDF(bookingId);
        attachments = [{ filename: `LakStay-${booking.code}.pdf`, content: pdf }];
      } catch (e) { /* voucher lỗi vẫn gửi mail thường */ }
      notify('booking_confirmed', {
        booking: { ...booking, paid_amount: booking.paid_amount },
        url: `${config.publicUrl}/#/booking/${booking.id}`,
        attachments,
      });
    } catch (e) { /* ignore */ }
  })();
}

const router = Router();

/** GET /api/payments/providers — danh sách phương thức + thông tin thụ hưởng */
router.get('/providers', (_req, res) => {
  ok(res, { providers: paymentProviders(), bank: bankInfo() });
});

/** POST /api/payments — tạo QR / payment intent */
const createSchema = z.object({
  bookingId: z.string().min(1),
  provider: z.enum(['VIETQR', 'MOMO', 'VNPAY', 'CARD', 'CASH', 'MANUAL']).default('VIETQR'),
  amount: z.number().int().min(1000).max(999_999_999).optional(),
});

router.post('/', requireAuth,
  rateLimit({ windowMs: 60_000, max: 20, keyPrefix: 'payment' }),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const idemKey = req.headers['idempotency-key'];
    const result = await createPayment({
      bookingId: req.body.bookingId,
      provider: req.body.provider,
      amount: req.body.amount ?? null,
      userId: req.user.id,
      idempotencyKey: idemKey ? `${req.user.id}:${idemKey}` : null,
      req,
    });

    const p = result.payment;
    ok(res, {
      payment: {
        id: p.id, booking_id: p.booking_id, provider: p.provider, status: p.status,
        amount: p.amount, currency: p.currency, txn_ref: p.txn_ref,
        qr_payload: p.qr_payload, qr_image: p.qr_image,
        qr_url: result.qr_url ?? null,
        bank: result.bank ?? bankInfo(),
        transfer_content: result.transfer_content ?? null,
        expired_at: p.expired_at,
        expires_in_seconds: p.expires_in_seconds ?? null,
      },
      replayed: result.replayed,
      reused: result.reused ?? false,
      // Endpoint để demo/simulate khi không có cổng thanh toán thật (hoặc bật DEMO_MODE trên preview)
      simulate_url: (!config.isProd || config.demoMode) ? `/api/payments/simulate/success?txnRef=${p.txn_ref}` : null,
    });
  })
);

/** GET /api/payments/:id/status — client poll trạng thái (SSE thay thế nếu muốn realtime) */
router.get('/:id/status', requireAuth, asyncHandler(async (req, res) => {
  const s = paymentStatus(req.params.id);
  // chống IDOR
  if (req.user.role === 'customer') {
    const b = db.prepare(`SELECT user_id FROM bookings WHERE id = ?`).get(s.payment.booking_id);
    if (!b || b.user_id !== req.user.id) throw Errors.forbidden();
  }
  ok(res, s);
}));

/** GET /api/payments/mine — lịch sử giao dịch của tôi */
router.get('/mine/list', requireAuth, asyncHandler(async (req, res) => {
  const pg = paginate(req.query);
  const total = db.prepare(`SELECT COUNT(*) n FROM payments WHERE user_id = ?`).get(req.user.id).n;
  const rows = db.prepare(`
    SELECT p.id, p.provider, p.type, p.status, p.amount, p.txn_ref, p.paid_at, p.created_at,
           b.code AS booking_code, b.check_in, b.check_out
    FROM payments p JOIN bookings b ON b.id = p.booking_id
    WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT ? OFFSET ?
  `).all(req.user.id, pg.limit, pg.offset);
  ok(res, { items: rows }, pageMeta(pg, total));
}));

/* ------------------------------------------------------------------ */
/*  WEBHOOK — cổng thanh toán gọi về. KHÔNG yêu cầu JWT, yêu cầu CHỮ KÝ.  */
/* ------------------------------------------------------------------ */
router.post('/webhook/:provider',
  rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'webhook' }),
  asyncHandler(async (req, res) => {
    const provider = String(req.params.provider).toUpperCase();
    const signature = req.headers['x-signature'] || req.headers['x-hub-signature-256'];
    const rawBody = req.rawBody;

    if (!rawBody) throw Errors.badRequest('Thiếu raw body');
    if (!verifyWebhookSignature(rawBody, signature)) {
      securityEvent({
        type: 'WEBHOOK_BAD_SIGNATURE', severity: 'critical', ip: clientIp(req),
        detail: `${provider} ${req.originalUrl}`,
      });
      throw Errors.forbidden('Chữ ký webhook không hợp lệ');
    }

    const body = JSON.parse(rawBody.toString('utf8'));
    const schema = z.object({
      txnRef: z.string().optional(),
      providerTxnId: z.string().optional(),
      amount: z.number().int().positive().optional(),
      status: z.string().optional(),
      content: z.string().optional(),
    });
    const parsed = schema.parse(body);

    // Một số cổng gửi cả sự kiện fail => xử lý riêng
    if (parsed.status && ['FAILED', 'CANCELLED'].includes(parsed.status.toUpperCase())) {
      const p = db.prepare(`SELECT * FROM payments WHERE txn_ref = ?`).get((parsed.txnRef || '').toUpperCase());
      if (p && p.status === 'PENDING') {
        db.prepare(`UPDATE payments SET status='FAILED', updated_at=datetime('now') WHERE id=?`).run(p.id);
        audit({ actor: { id: 'system', role: 'system' }, action: 'PAYMENT_FAILED', entityType: 'payment', entityId: p.id });
      }
      return ok(res, { received: true, result: 'FAILED' });
    }

    const result = handlePaymentSuccess({
      txnRef: parsed.txnRef?.toUpperCase() ?? null,
      providerTxnId: parsed.providerTxnId ?? null,
      amount: parsed.amount ?? null,
      content: parsed.content,
      rawPayload: parsed,
      provider,
      req,
    });

    if (!result.duplicate) sendConfirmationEmail(result.payment.booking_id);
    ok(res, { received: true, duplicate: result.duplicate, booking_status: result.booking?.status });
  })
);

/** POST /api/payments/simulate/success — CHỈ ở môi trường dev/demo: giả lập bank callback */
router.post('/simulate/success',
  requireAuth, requireRole('staff', 'admin', 'customer'),
  asyncHandler(async (req, res) => {
    if (config.isProd && !config.demoMode) throw Errors.forbidden('Không khả dụng ở môi trường production');
    const q = z.object({
      txnRef: z.string().optional(),
      paymentId: z.string().optional(),
      amount: z.number().int().positive().optional(),
    }).parse({ ...req.query, ...req.body });

    if (!q.txnRef && !q.paymentId) throw Errors.badRequest('Cần txnRef hoặc paymentId');
    let txnRef = q.txnRef;
    const p = q.paymentId
      ? db.prepare(`SELECT txn_ref, booking_id, user_id FROM payments WHERE id = ?`).get(q.paymentId)
      : (txnRef ? db.prepare(`SELECT txn_ref, booking_id, user_id FROM payments WHERE txn_ref = ?`).get(txnRef.toUpperCase()) : null);
    if (!p) throw Errors.notFound('Không tìm thấy giao dịch');
    if (req.user.role === 'customer') {
      const b = db.prepare(`SELECT user_id FROM bookings WHERE id = ?`).get(p.booking_id);
      if (!b || b.user_id !== req.user.id) throw Errors.forbidden();
    }
    txnRef = p.txn_ref;

    const payload = { txnRef: txnRef.toUpperCase(), amount: q.amount ?? null, providerTxnId: `SIM${Date.now()}`, status: 'SUCCESS' };
    const raw = JSON.stringify(payload);
    const result = handlePaymentSuccess({
      txnRef: payload.txnRef, amount: q.amount ?? null, providerTxnId: payload.providerTxnId,
      rawPayload: payload, provider: 'VIETQR',
      req: { headers: { 'x-signature': signWebhook(raw) }, ...req },
    });
    if (!result.duplicate) sendConfirmationEmail(result.payment.booking_id);
    ok(res, { simulated: true, ...result });
  })
);

/** POST /api/payments/reconcile — staff đối soát bằng nội dung chuyển khoản */
router.post('/reconcile', requireAuth, requireRole('staff', 'admin'),
  validate(z.object({ content: z.string().min(3).max(200), amount: z.number().int().positive().optional() })),
  asyncHandler(async (req, res) => {
    const txnRef = extractTxnRef(req.body.content);
    if (!txnRef) throw Errors.badRequest('Không tìm thấy mã giao dịch trong nội dung chuyển khoản');
    const result = handlePaymentSuccess({
      txnRef, amount: req.body.amount ?? null, rawPayload: { reconcile: true, content: req.body.content, by: req.user.id },
      provider: 'MANUAL', req,
    });
    audit({ req, actor: req.user, action: 'PAYMENT_RECONCILED', entityType: 'payment', entityId: result.payment.id,
            after: { content: req.body.content } });
    if (!result.duplicate) sendConfirmationEmail(result.payment.booking_id);
    ok(res, result);
  })
);

/** POST /api/payments/:id/confirm-manual — staff xác nhận thu tiền mặt */
router.post('/:id/confirm-manual', requireAuth, requireRole('staff', 'admin'),
  validate(z.object({ note: z.string().max(300).optional() })),
  asyncHandler(async (req, res) => {
    const result = markPaidManually({ paymentId: req.params.id, actor: req.user, req, note: req.body.note });
    if (!result.duplicate) sendConfirmationEmail(result.payment.booking_id);
    ok(res, result);
  })
);

/** POST /api/payments/:bookingId/refund — hoàn tiền (chỉ admin) */
router.post('/:bookingId/refund', requireAuth, requireRole('admin'),
  validate(z.object({ amount: z.number().int().positive().optional(), reason: z.string().trim().min(3).max(300) })),
  asyncHandler(async (req, res) => {
    const result = refundPayment({
      bookingId: req.params.bookingId, amount: req.body.amount ?? null,
      actor: req.user, req, reason: req.body.reason,
    });
    ok(res, result);
  })
);

/**
 * GET /api/payments/:id/stream — SSE realtime trạng thái thanh toán.
 * Thay cho polling: server đẩy event ngay khi webhook/expiry xảy ra.
 * Auth bằng cookie (EventSource không gửi custom header được) => cùng origin.
 */
router.get('/:id/stream', requireAuth, asyncHandler(async (req, res) => {
  const s = paymentStatus(req.params.id);
  if (req.user.role === 'customer') {
    const b = db.prepare(`SELECT user_id FROM bookings WHERE id = ?`).get(s.payment.booking_id);
    if (!b || b.user_id !== req.user.id) throw Errors.forbidden();
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // tắt buffer của nginx để event tới ngay
  res.flushHeaders?.();

  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  // trạng thái hiện tại ngay khi kết nối (để client không bỏ lỡ nếu đã PAID trước đó)
  send('status', { paymentId: req.params.id, status: s.payment.status, bookingStatus: s.booking?.status });
  if (config.isVercel) return res.end();

  const onStatus = (ev) => {
    if (ev.paymentId !== req.params.id) return;
    send('status', ev);
    if (['PAID', 'EXPIRED', 'FAILED'].includes(ev.status)) finish();
  };
  const heartbeat = setInterval(() => res.write(': hb\n\n'), 25_000);
  const finish = () => {
    clearInterval(heartbeat);
    paymentEvents.off('status', onStatus);
    res.end();
  };
  paymentEvents.on('status', onStatus);
  req.on('close', finish);
}));

/** GET /api/payments/qr/verify?q=<payload> — kiểm tra 1 chuỗi QR có hợp lệ không */
router.get('/qr/verify', requireAuth, requireRole('staff', 'admin'),
  asyncHandler(async (req, res) => {
    ok(res, parseVietQRPayload(String(req.query.q || '')));
  })
);

export default router;
