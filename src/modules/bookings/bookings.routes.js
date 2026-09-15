import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth, assertOwnershipOrStaff } from '../../middlewares/auth.js';
import { rateLimit } from '../../middlewares/error.js';
import { config } from '../../config/index.js';
import { asyncHandler, ok, created, paginate, pageMeta } from '../../utils/http.js';
import { Errors } from '../../utils/errors.js';
import { isValidDateString } from '../../utils/date.js';
import { createBooking, getBookingById, cancelBooking, listBookings, transitionBooking } from '../../services/booking.service.js';
import { computeRefund, hoursUntilCheckIn } from '../../services/cancellation.service.js';
import { nextStates, STATUS_META } from '../../services/booking-state.js';
import { audit } from '../../services/audit.service.js';
import { notify } from '../../services/mail.service.js';
import { renderVoucherPDF } from '../../services/voucher.service.js';

const router = Router();
router.use(requireAuth);

/* ---------------- SCHEMAS ---------------- */
const createSchema = z.object({
  checkIn: z.string().refine(isValidDateString, 'Ngày nhận phòng phải dạng YYYY-MM-DD'),
  checkOut: z.string().refine(isValidDateString, 'Ngày trả phòng phải dạng YYYY-MM-DD'),
  guests: z.number().int().min(1).max(config.booking.maxGuestsPerBooking),
  lines: z.array(z.object({
    roomTypeId: z.string().min(1, 'Thiếu roomTypeId'),
    qty: z.number().int().min(1).max(config.booking.maxRoomsPerBooking),
    guests: z.number().int().min(0).max(30).optional(),
  })).min(1).max(config.booking.maxRoomsPerBooking),
  guestName: z.string().trim().min(2).max(80),
  guestPhone: z.string().trim().regex(/^(\+?84|0)\d{8,10}$/, 'Số điện thoại không hợp lệ'),
  guestEmail: z.string().trim().email('Email không hợp lệ'),
  specialRequest: z.string().trim().max(500).optional().nullable(),
  couponCode: z.string().trim().max(32).optional().nullable(),
  // Client gửi giá lên để server SO SÁNH cảnh báo (không dùng để tính)
  clientExpectedTotal: z.number().int().min(0).optional(),
}).refine((d) => d.checkOut > d.checkIn, { message: 'Ngày trả phòng phải sau ngày nhận phòng', path: ['checkOut'] });

const cancelSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

/* ---------------- ROUTES ---------------- */

/** POST /api/bookings — tạo booking (idempotent qua header Idempotency-Key) */
router.post('/',
  rateLimit({ windowMs: config.rateLimit.bookingWindowMs, max: config.rateLimit.bookingMax, keyPrefix: 'booking' }),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const idemKey = req.headers['idempotency-key'];
    if (idemKey && (typeof idemKey !== 'string' || idemKey.length > 100)) {
      throw Errors.badRequest('Idempotency-Key không hợp lệ');
    }

    const { booking, replayed } = createBooking({
      user: req.user,
      checkIn: req.body.checkIn,
      checkOut: req.body.checkOut,
      guests: req.body.guests,
      lines: req.body.lines,
      couponCode: req.body.couponCode || null,
      guestName: req.body.guestName,
      guestPhone: req.body.guestPhone,
      guestEmail: req.body.guestEmail,
      specialRequest: req.body.specialRequest || null,
      idempotencyKey: idemKey ? `${req.user.id}:${idemKey}` : null,
    }, { req });

    // Cảnh báo nếu giá client đang hiển thị khác giá server tính (giá vừa đổi / rule mới)
    let priceWarning = null;
    if (req.body.clientExpectedTotal && req.body.clientExpectedTotal !== booking.total_amount) {
      priceWarning = `Giá đã thay đổi: ${req.body.clientExpectedTotal.toLocaleString('vi-VN')}₫ → ${booking.total_amount.toLocaleString('vi-VN')}₫`;
    }

    if (!replayed) {
      notify('booking_hold', { booking, url: `${config.publicUrl}/#/booking/${booking.id}` });
    }

    res.status(replayed ? 200 : 201).json({
      success: true,
      data: { booking: shapeBooking(booking, req.user), replayed, price_warning: priceWarning },
    });
  })
);

/** GET /api/bookings — booking của tôi (customer) / tất cả (staff, admin) */
router.get('/', asyncHandler(async (req, res) => {
  const pg = paginate(req.query);
  const q = z.object({
    status: z.string().optional(),
    q: z.string().max(100).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    sort: z.enum(['created_at', 'check_in', 'total', 'status']).default('created_at'),
  }).parse(req.query);

  const result = listBookings({
    userId: req.user.id, role: req.user.role,
    status: q.status, q: q.q, from: q.from, to: q.to,
    page: pg.page, limit: pg.limit, sort: q.sort,
  });
  ok(res, { items: result.rows }, pageMeta(pg, result.total));
}));

/** GET /api/bookings/:id — chi tiết (có chống IDOR) */
router.get('/:id', asyncHandler(async (req, res) => {
  const booking = getBookingById(req.params.id);
  if (!booking) throw Errors.notFound('Không tìm thấy booking');
  assertOwnershipOrStaff(booking, req.user);
  ok(res, { booking: shapeBooking(booking, req.user) });
}));

/** GET /api/bookings/code/:code — tra cứu bằng mã đặt phòng (cho khách không đăng nhập) */
router.get('/code/:code', asyncHandler(async (req, res) => {
  const row = db.prepare(`SELECT id, user_id FROM bookings WHERE code = ?`).get(String(req.params.code).toUpperCase());
  if (!row) throw Errors.notFound('Không tìm thấy mã đặt phòng');
  assertOwnershipOrStaff(row, req.user);
  ok(res, { booking: shapeBooking(getBookingById(row.id), req.user) });
}));

/** POST /api/bookings/:id/cancel — huỷ + tính refund theo chính sách */
router.post('/:id/cancel', validate(cancelSchema), asyncHandler(async (req, res) => {
  const booking = getBookingById(req.params.id);
  if (!booking) throw Errors.notFound('Không tìm thấy booking');

  const result = cancelBooking({
    bookingId: booking.id, actor: req.user, reason: req.body.reason, req,
  });

  // Nếu có tiền hoàn => tạo refund record
  let refund = null;
  if (result.refund.eligible) {
    const { refundPayment } = await import('../../services/payment.service.js');
    refund = refundPayment({
      bookingId: booking.id, amount: result.refund.refund_amount,
      actor: req.user, req, reason: `Auto refund theo chính sách huỷ (${result.refund.tier})`,
    });
  }

  audit({ req, actor: req.user, action: 'BOOKING_CANCELLED_BY_USER', entityType: 'booking', entityId: booking.id,
          before: { status: result.before.status }, after: { refund: result.refund.refund_amount, reason: req.body.reason } });

  notify('booking_cancelled', {
    booking: { ...booking, status: result.status }, refund: result.refund,
    url: `${config.publicUrl}/#/booking/${booking.id}`,
  });

  ok(res, {
    booking_id: booking.id,
    status: result.status,
    refund: result.refund,
    refund_transaction: refund,
    released_room_nights: result.released_room_nights,
  });
}));

/** GET /api/bookings/:id/cancel-policy — xem trước sẽ mất bao nhiêu nếu huỷ BÂY GIỜ */
router.get('/:id/cancel-policy', asyncHandler(async (req, res) => {
  const booking = getBookingById(req.params.id);
  if (!booking) throw Errors.notFound('Không tìm thấy booking');
  assertOwnershipOrStaff(booking, req.user);

  const firstLine = booking.lines[0];
  const rt = db.prepare(`SELECT cancel_free_hours, cancel_penalty_pct, cancel_no_refund_hours
                         FROM room_types WHERE id = ?`).get(firstLine.room_type_id);
  const paid = booking.paid_amount || 0;
  const refund = computeRefund({
    check_in: booking.check_in, nights: booking.nights, subtotal: booking.subtotal,
    paid_amount: paid, policy: rt,
  });
  ok(res, {
    refund_if_cancel_now: refund,
    hours_until_checkin: Number(hoursUntilCheckIn(booking.check_in).toFixed(2)),
    policy: rt,
  });
}));

/** GET /api/bookings/:id/voucher.pdf — tải phiếu xác nhận PDF (chủ đơn hoặc staff) */
router.get('/:id/voucher.pdf', asyncHandler(async (req, res) => {
  const booking = getBookingById(req.params.id);
  if (!booking) throw Errors.notFound('Không tìm thấy booking');
  assertOwnershipOrStaff(booking, req.user);
  const pdf = await renderVoucherPDF(booking.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="LakStay-${booking.code}.pdf"`);
  res.setHeader('Cache-Control', 'private, max-age=60');
  res.send(pdf);
}));

/** GET /api/bookings/meta/status — metadata trạng thái cho UI */
router.get('/meta/status', (_req, res) => ok(res, { statuses: STATUS_META }));

/** POST /api/bookings/:id/transition — staff/admin đổi trạng thái (check-in/out/no-show) */
router.post('/:id/transition',
  validate(z.object({
    to: z.enum(['CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'CONFIRMED']),
    note: z.string().max(300).optional(),
  })),
  asyncHandler(async (req, res) => {
    if (req.user.role === 'customer') throw Errors.forbidden('Chỉ nhân viên mới đổi được trạng thái');
    const result = transitionBooking({ bookingId: req.params.id, to: req.body.to, actor: req.user, req, note: req.body.note });
    ok(res, { result, booking: shapeBooking(getBookingById(req.params.id), req.user) });
  })
);

/* ---------------- SHAPE ---------------- */
function shapeBooking(b, user) {
  if (!b) return null;
  let breakdown = [];
  try { breakdown = JSON.parse(b.price_breakdown || '[]'); } catch { /* ignore */ }
  return {
    id: b.id,
    code: b.code,
    status: b.status,
    status_meta: STATUS_META[b.status],
    available_transitions: nextStates(b.status, user?.role || 'customer'),
    check_in: b.check_in,
    check_out: b.check_out,
    nights: b.nights,
    guests: b.guests,
    guest: { name: b.guest_name, phone: b.guest_phone, email: b.guest_email, request: b.special_request },
    money: {
      currency: b.currency,
      subtotal: b.subtotal,
      discount: b.discount_total,
      member_discount: b.member_discount || 0,
      service_fee: b.service_fee,
      tax: b.tax,
      total: b.total_amount,
      paid: b.paid_amount || 0,
      refunded: b.refunded_amount || 0,
      outstanding: Math.max(0, (b.total_amount || 0) - (b.paid_amount || 0)),
    },
    coupon_code: b.coupon_code,
    lines: (b.lines || []).map((l) => ({
      id: l.id, room_type_id: l.room_type_id, room_type_name: l.room_type_name,
      name_vi: l.room_type_name, name_en: l.room_type_name_en || null,
      slug: l.slug, qty: l.qty, nights: l.nights, line_total: l.line_total,
      images: (() => { try { return JSON.parse(l.images || '[]'); } catch { return []; } })(),
    })),
    breakdown,
    rooms: (b.assigned_rooms || []).map((r) => ({
      room_number: r.room_number, floor: r.floor, date: r.stay_date, room_type: r.room_type_name,
    })),
    payments: b.payments || [],
    timeline: {
      created_at: b.created_at,
      hold_expires_at: b.hold_expires_at,
      confirmed_at: b.confirmed_at,
      cancelled_at: b.cancelled_at,
      cancel_reason: b.cancel_reason,
      checkin_at: b.checkin_at,
      checkout_at: b.checkout_at,
    },
  };
}

export { shapeBooking };
export default router;
