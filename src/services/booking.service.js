import { db, withTransaction } from '../db.js';
import { config } from '../config/index.js';
import { newId, newBookingCode } from '../utils/id.js';
import { Errors, BizCode } from '../utils/errors.js';
import { stayDates, todayISO, diffDays, plusMinutesISO } from '../utils/date.js';
import { validateStayDates, pickRooms, holdRooms, releaseRooms, countAvailable } from './availability.service.js';
import { quoteBooking, validateCoupon } from './pricing.service.js';
import { assertTransition, STATUS, canTransition } from './booking-state.js';
import { computeRefund } from './cancellation.service.js';
import { revokeForBooking } from './loyalty.service.js';
import { audit } from './audit.service.js';
import { logger } from '../utils/logger.js';

/**
 * ============================================================================
 *  BOOKING SERVICE
 * ============================================================================
 *  LUỒNG TẠO BOOKING (chống double-booking 4 lớp):
 *
 *   Lớp 1 — VALIDATE: ngày, sức chứa, min/max stay, max advance.
 *   Lớp 2 — IDEMPOTENCY: cùng idempotency_key => trả lại booking cũ, không tạo mới.
 *   Lớp 3 — TRANSACTION `BEGIN IMMEDIATE`: chỉ 1 writer tại 1 thời điểm.
 *           Đọc tồn kho + chọn phòng + ghi chiếm chỗ đều nằm TRONG transaction
 *           => không có cửa "2 request cùng đọc thấy còn phòng".
 *   Lớp 4 — PRIMARY KEY (room_id, stay_date) của room_calendar:
 *           nếu 3 lớp trên đều hỏng thì DB vẫn ném UNIQUE constraint => ROLLBACK.
 *
 *  Kết quả: không thể overbook, kể cả khi client spam 1000 request đồng thời.
 * ============================================================================
 */

export function getBookingById(id, { withRooms = true } = {}) {
  const b = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(id);
  if (!b) return null;
  if (!withRooms) return b;
  b.lines = db.prepare(`
    SELECT br.*, rt.name_vi AS room_type_name, rt.name AS room_type_name_en, rt.slug, rt.images, rt.capacity, rt.bed_type, rt.size_m2
    FROM booking_rooms br JOIN room_types rt ON rt.id = br.room_type_id
    WHERE br.booking_id = ?`).all(id);
  b.payments = db.prepare(`SELECT id, provider, type, status, amount, txn_ref, paid_at, created_at
                           FROM payments WHERE booking_id = ? ORDER BY created_at`).all(id);
  b.paid_amount = b.payments
    .filter((p) => p.type === 'CHARGE' && p.status === 'PAID')
    .reduce((s, p) => s + p.amount, 0);
  b.refunded_amount = b.payments
    .filter((p) => p.type === 'REFUND' && p.status === 'PAID')
    .reduce((s, p) => s + p.amount, 0);
  b.assigned_rooms = db.prepare(`
    SELECT rc.room_id, r.room_number, r.floor, rc.stay_date, rt.name_vi AS room_type_name
    FROM room_calendar rc
    JOIN rooms r ON r.id = rc.room_id
    JOIN room_types rt ON rt.id = rc.room_type_id
    WHERE rc.booking_id = ? ORDER BY rc.stay_date, r.room_number`).all(id);
  return b;
}

export const getBookingByCode = (code) =>
  db.prepare(`SELECT * FROM bookings WHERE code = ?`).get(String(code).toUpperCase());

/**
 * TẠO BOOKING
 * @param {object} input  { user, checkIn, checkOut, guests, lines[], couponCode, guestInfo, idempotencyKey }
 */
export function createBooking(input, { req } = {}) {
  const {
    user, checkIn, checkOut, guests, lines, couponCode = null,
    guestName, guestPhone, guestEmail, specialRequest = null, idempotencyKey = null,
  } = input;

  // ---------- LỚP 1: validate ngày (làm sớm để fail fast, không tốn lock) ----------
  // Dùng policy khắt khe nhất trong các room type được chọn
  const chosenTypes = lines.map((l) =>
    db.prepare(`SELECT * FROM room_types WHERE id = ? AND is_active = 1`).get(l.roomTypeId));
  for (const t of chosenTypes) {
    if (!t) throw Errors.notFound('Loại phòng không tồn tại hoặc đã ngừng kinh doanh');
  }
  const policy = {
    minStay: Math.max(...chosenTypes.map((t) => t.min_stay)),
    maxStay: Math.min(...chosenTypes.map((t) => t.max_stay), config.booking.maxNights),
    maxAdvanceDays: Math.min(...chosenTypes.map((t) => t.max_advance_days)),
  };
  const { nights } = validateStayDates({ checkIn, checkOut, ...policy });

  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  if (totalQty > config.booking.maxRoomsPerBooking) {
    throw Errors.badRequest(`Tối đa ${config.booking.maxRoomsPerBooking} phòng mỗi lần đặt`);
  }
  if (guests > config.booking.maxGuestsPerBooking) {
    throw Errors.badRequest(`Tối đa ${config.booking.maxGuestsPerBooking} khách mỗi lần đặt`);
  }

  // ---------- LỚP 2: idempotency (trước transaction, rẻ) ----------
  if (idempotencyKey) {
    const existing = db.prepare(`SELECT * FROM bookings WHERE idempotency_key = ?`).get(idempotencyKey);
    if (existing) {
      return { booking: getBookingById(existing.id), replayed: true };
    }
  }

  // ---------- LỚP 3 + 4: transaction ghi ----------
  const result = withTransaction((tx) => {
    // Kiểm tra lại idempotency BÊN TRONG transaction (chống race giữa check và insert)
    if (idempotencyKey) {
      const existing = tx.prepare(`SELECT * FROM bookings WHERE idempotency_key = ?`).get(idempotencyKey);
      if (existing) return { booking: existing, replayed: true };
    }

    // TÍNH GIÁ LẠI TRÊN SERVER — tuyệt đối không tin giá client gửi
    const quote = quoteBooking({
      lines: lines.map((l) => ({
        roomTypeId: l.roomTypeId, checkIn, checkOut, qty: l.qty, guests: l.guests || guests,
      })),
      couponCode,
      userId: user.id,
    });

    const bookingId = newId('bkg');
    const code = newBookingCode();
    const holdExpiresAt = plusMinutesISO(config.booking.holdMinutes);

    tx.prepare(`
      INSERT INTO bookings (
        id, code, user_id, status, check_in, check_out, nights, guests,
        guest_name, guest_phone, guest_email, special_request,
        currency, subtotal, discount_total, member_discount, service_fee, tax, total_amount, price_breakdown,
        coupon_code, coupon_id, idempotency_key, hold_expires_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      bookingId, code, user.id, STATUS.PENDING, checkIn, checkOut, nights, guests,
      guestName, guestPhone, guestEmail, specialRequest,
      'VND', quote.subtotal, quote.discount, quote.member_discount || 0, quote.service_fee, quote.tax, quote.total_amount,
      JSON.stringify(quote.lines.map((l) => ({
        room_type_id: l.room_type_id, room_type_name: l.room_type_name, qty: l.qty,
        nights: l.nights, per_night: l.per_night, subtotal: l.subtotal,
        extra_guest_fee: l.extra_guest_fee, total: l.total,
      }))),
      quote.coupon?.code ?? null, quote.coupon?.id ?? null, idempotencyKey, holdExpiresAt,
    );

    const insLine = tx.prepare(`
      INSERT INTO booking_rooms (id, booking_id, room_type_id, qty, nights, unit_price, line_total, price_detail)
      VALUES (?,?,?,?,?,?,?,?)`);
    for (const l of quote.lines) {
      insLine.run(newId('blr'), bookingId, l.room_type_id, l.qty, l.nights,
        Math.round(l.subtotal / l.nights), l.total, JSON.stringify(l.per_night));
    }

    // ---------- CHIẾM PHÒNG VẬT LÝ (đây là bước quyết định) ----------
    const dates = stayDates(checkIn, checkOut);
    const assignments = [];
    for (const l of quote.lines) {
      const roomIds = pickRooms(l.room_type_id, checkIn, checkOut, l.qty); // ném lỗi nếu không đủ
      holdRooms(roomIds, dates, bookingId, l.room_type_id, 'HELD');        // PK chặn trùng
      assignments.push({ room_type_id: l.room_type_id, room_ids: roomIds });
    }

    // Coupon: ghi usage TRONG cùng transaction (nếu không sẽ bị dùng coupon rồi huỷ booking mà coupon vẫn mất)
    if (quote.coupon) {
      tx.prepare(`
        INSERT INTO coupon_usages (id, coupon_id, user_id, booking_id, discount) VALUES (?,?,?,?,?)
      `).run(newId('cpu'), quote.coupon.id, user.id, bookingId, quote.discount);
      tx.prepare(`UPDATE coupons SET used_count = used_count + 1 WHERE id = ?`).run(quote.coupon.id);
    }

    return {
      replayed: false,
      bookingId,
      quote,
      assignments,
      row: tx.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId),
    };
  });

  if (result.replayed) {
    return { booking: getBookingById(result.booking.id), replayed: true };
  }

  audit({
    req, actor: user, action: 'BOOKING_CREATED', entityType: 'booking', entityId: result.bookingId,
    after: { code: result.row.code, total: result.quote.total_amount, check_in: checkIn, check_out: checkOut },
    meta: { assignments: result.assignments },
  });

  logger.info('Booking created', { code: result.row.code, total: result.quote.total_amount });
  return { booking: getBookingById(result.bookingId), replayed: false };
}

/**
 * HUỶ BOOKING — tuân thủ state machine + tính refund + nhả phòng trong 1 transaction
 */
export function cancelBooking({ bookingId, actor, reason, req, force = false, isNoShow = false }) {
  return withTransaction((tx) => {
    const b = tx.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId);
    if (!b) throw Errors.notFound('Không tìm thấy booking');

    // IDOR guard
    if (actor.role === 'customer' && b.user_id !== actor.id) {
      throw Errors.forbidden('Bạn không có quyền huỷ booking này');
    }
    if (actor.role === 'customer' && ['CHECKED_IN', 'COMPLETED', 'NO_SHOW', 'REFUNDED', 'EXPIRED'].includes(b.status)) {
      throw Errors.conflict(`Booking ở trạng thái ${b.status} không thể tự huỷ, vui lòng liên hệ lễ tân`);
    }

    const targetStatus = isNoShow ? STATUS.NO_SHOW : STATUS.CANCELLED;
    const check = canTransition(b.status, targetStatus, actor.role);
    if (!check.allowed) throw Errors.conflict(check.reason, { code: BizCode.INVALID_TRANSITION });

    // Tính refund (cần policy của room type đầu tiên)
    const firstLine = tx.prepare(`
      SELECT br.*, rt.cancel_free_hours, rt.cancel_penalty_pct, rt.cancel_no_refund_hours
      FROM booking_rooms br JOIN room_types rt ON rt.id = br.room_type_id
      WHERE br.booking_id = ? LIMIT 1`).get(bookingId);

    const paid = tx.prepare(`
      SELECT COALESCE(SUM(amount),0) AS total FROM payments
      WHERE booking_id = ? AND type = 'CHARGE' AND status = 'PAID'`).get(bookingId).total;

    const refund = computeRefund({
      check_in: b.check_in,
      nights: b.nights,
      subtotal: b.subtotal,
      paid_amount: paid,
      policy: firstLine ? {
        cancel_free_hours: firstLine.cancel_free_hours,
        cancel_penalty_pct: firstLine.cancel_penalty_pct,
        cancel_no_refund_hours: firstLine.cancel_no_refund_hours,
      } : {},
    }, { isNoShow });

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    tx.prepare(`
      UPDATE bookings SET status = ?, cancelled_at = ?, cancel_reason = ?, cancelled_by = ?,
                          version = version + 1, updated_at = ?
      WHERE id = ? AND version = ?   -- optimistic lock
    `).run(targetStatus, now, reason ?? null, actor.id, now, bookingId, b.version);

    // NHẢ PHÒNG — booking huỷ thì phòng phải về kho ngay
    const released = tx.prepare(`DELETE FROM room_calendar WHERE booking_id = ?`).run(bookingId).changes;

    // ---- LOYALTY: đơn đã trả tiền mà huỷ => thu hồi điểm + trừ chi tiêu (trong tx) ----
    if (paid > 0) {
      revokeForBooking({ userId: b.user_id, bookingId, refundAmount: refund.refund_amount }, tx);
    }

    return { booking_id: bookingId, status: targetStatus, refund, released_room_nights: released, before: b };
  });
}

/** Xác nhận booking sau khi thanh toán thành công */
export function confirmBooking({ bookingId, actorRole = 'system', req, paymentInfo = null }) {
  return withTransaction((tx) => {
    const b = tx.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId);
    if (!b) throw Errors.notFound('Không tìm thấy booking');
    const check = canTransition(b.status, STATUS.CONFIRMED, actorRole === 'system' ? 'customer' : actorRole);
    if (!check.allowed) throw Errors.conflict(check.reason, { code: BizCode.INVALID_TRANSITION });

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    tx.prepare(`UPDATE bookings SET status = 'CONFIRMED', confirmed_at = ?, hold_expires_at = NULL,
                version = version + 1, updated_at = ? WHERE id = ?`).run(now, now, bookingId);
    // Nâng cấp lịch phòng: HELD -> CONFIRMED (khách đã trả tiền, phòng chắc chắn thuộc về họ)
    tx.prepare(`UPDATE room_calendar SET status = 'CONFIRMED' WHERE booking_id = ?`).run(bookingId);
    return { booking_id: bookingId, status: STATUS.CONFIRMED, before: b };
  });
}

/** Đổi trạng thái bởi staff/admin (check-in, check-out, no-show) — kèm optimistic lock */
export function transitionBooking({ bookingId, to, actor, req, note = null }) {
  const result = withTransaction((tx) => {
    const b = tx.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId);
    if (!b) throw Errors.notFound('Không tìm thấy booking');
    assertTransition(b.status, to, actor.role);

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // Cột timestamp riêng cho từng trạng thái đích (whitelist => không lo SQL injection)
    const TIMESTAMP_FIELD = {
      CHECKED_IN: 'checkin_at',
      COMPLETED: 'checkout_at',
      CANCELLED: 'cancelled_at',
      NO_SHOW: 'cancelled_at',
    };
    const tsField = TIMESTAMP_FIELD[to];

    const info = tsField
      ? tx.prepare(`
          UPDATE bookings
             SET status = ?, updated_at = ?, ${tsField} = ?,
                 cancel_reason = COALESCE(?, cancel_reason),
                 version = version + 1
           WHERE id = ? AND version = ?
        `).run(to, now, now, note, bookingId, b.version)
      : tx.prepare(`
          UPDATE bookings
             SET status = ?, updated_at = ?,
                 cancel_reason = COALESCE(?, cancel_reason),
                 version = version + 1
           WHERE id = ? AND version = ?
        `).run(to, now, note, bookingId, b.version);

    // 0 rows affected => version đã đổi (concurrent update) => báo conflict, không ghi đè
    if (info.changes === 0) {
      throw Errors.conflict('Booking vừa được cập nhật bởi người khác, vui lòng tải lại trang',
        { code: 'VERSION_CONFLICT' });
    }

    if (to === STATUS.CHECKED_IN) {
      tx.prepare(`UPDATE room_calendar SET status = 'CONFIRMED' WHERE booking_id = ?`).run(bookingId);
    }
    if (to === STATUS.COMPLETED || to === STATUS.CANCELLED) {
      tx.prepare(`DELETE FROM room_calendar WHERE booking_id = ?`).run(bookingId);
    }
    return { booking_id: bookingId, from: b.status, to, before: b };
  });

  audit({
    req, actor, action: `BOOKING_${result.to}`, entityType: 'booking', entityId: bookingId,
    before: { status: result.from }, after: { status: result.to, note },
  });
  return result;
}

/**
 * SWEEPER — dọn booking PENDING quá hạn giữ chỗ.
 * Chạy theo chu kỳ (xem src/jobs.js). Đây là "compensating transaction":
 * nếu client bỏ giỏ hàng giữa chừng, phòng phải được trả về kho.
 */
export function expireStaleHolds({ req = null, limit = 200 } = {}) {
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  const stale = db.prepare(`
    SELECT id, code, user_id FROM bookings
    WHERE status = 'PENDING' AND hold_expires_at IS NOT NULL AND hold_expires_at < ?
    ORDER BY hold_expires_at ASC LIMIT ?`).all(now, limit);

  let count = 0;
  for (const b of stale) {
    try {
      withTransaction((tx) => {
        const cur = tx.prepare(`SELECT status, version FROM bookings WHERE id = ?`).get(b.id);
        if (!cur || cur.status !== STATUS.PENDING) return;
        tx.prepare(`UPDATE bookings SET status = 'EXPIRED', updated_at = ?, version = version + 1
                    WHERE id = ? AND version = ?`).run(now, b.id, cur.version);
        tx.prepare(`DELETE FROM room_calendar WHERE booking_id = ?`).run(b.id);
        // Hoàn coupon usage
        const cu = tx.prepare(`SELECT coupon_id FROM coupon_usages WHERE booking_id = ?`).get(b.id);
        if (cu) {
          tx.prepare(`UPDATE coupons SET used_count = MAX(0, used_count - 1) WHERE id = ?`).run(cu.coupon_id);
          tx.prepare(`DELETE FROM coupon_usages WHERE booking_id = ?`).run(b.id);
        }
        // Huỷ payment QR chưa thanh toán
        tx.prepare(`UPDATE payments SET status = 'EXPIRED' WHERE booking_id = ? AND status = 'PENDING'`).run(b.id);
        count++;
      });
      audit({ req: null, actor: { id: 'system', role: 'system' }, action: 'BOOKING_EXPIRED',
              entityType: 'booking', entityId: b.id, after: { code: b.code } });
    } catch (err) {
      logger.error('expireStaleHolds failed', { booking: b.id, err: err.message });
    }
  }
  if (count) logger.info('Expired stale holds', { count });
  return count;
}

/** Tự động COMPLETED cho booking đã qua ngày trả phòng (cron đêm) */
export function autoCompletePastBookings() {
  const today = todayISO();
  const rows = db.prepare(`
    SELECT id FROM bookings WHERE status IN ('CONFIRMED','CHECKED_IN') AND check_out <= ?`).all(today);
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  let count = 0;
  for (const r of rows) {
    withTransaction((tx) => {
      const info = tx.prepare(`UPDATE bookings SET status = 'COMPLETED', checkout_at = ?, updated_at = ?,
                               version = version + 1 WHERE id = ? AND status IN ('CONFIRMED','CHECKED_IN')`)
        .run(now, now, r.id);
      if (info.changes) {
        tx.prepare(`DELETE FROM room_calendar WHERE booking_id = ?`).run(r.id);
        count++;
      }
    });
  }
  if (count) logger.info('Auto-completed past bookings', { count });
  return count;
}

/** Tự động NO_SHOW: CONFIRMED mà qua ngày check_in 1 ngày vẫn chưa check-in */
export function markNoShows() {
  const cutoff = todayISO();
  const rows = db.prepare(`SELECT id FROM bookings WHERE status = 'CONFIRMED' AND check_in < ?`).all(cutoff);
  let count = 0;
  for (const r of rows) {
    try {
      transitionBooking({
        bookingId: r.id, to: STATUS.NO_SHOW,
        actor: { id: 'system', role: 'system' }, note: 'Auto no-show',
      });
      count++;
    } catch { /* đã chuyển trạng thái bởi staff */ }
  }
  if (count) logger.info('Marked no-shows', { count });
  return count;
}

/** Danh sách booking (có phân trang + filter, chống SQL injection bằng whitelist) */
export function listBookings({ userId = null, role = 'customer', status = null, q = null, from = null, to = null, page = 1, limit = 20, sort = 'created_at' } = {}) {
  const where = [];
  const params = [];

  // RBAC ngay trong query: customer CHỈ thấy booking của mình (không thể "quên" filter)
  if (role === 'customer') { where.push('b.user_id = ?'); params.push(userId); }
  else if (userId) { where.push('b.user_id = ?'); params.push(userId); }

  const allowedStatus = ['PENDING','CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED','NO_SHOW','EXPIRED','REFUNDED'];
  if (status && allowedStatus.includes(status)) { where.push('b.status = ?'); params.push(status); }
  if (from) { where.push('b.check_in >= ?'); params.push(from); }
  if (to) { where.push('b.check_out <= ?'); params.push(to); }
  if (q) {
    where.push('(b.code LIKE ? OR b.guest_name LIKE ? OR b.guest_phone LIKE ? OR b.guest_email LIKE ?)');
    const like = `%${String(q).replace(/[%_]/g, '')}%`; // escape LIKE wildcards
    params.push(like, like, like, like);
  }

  const allowedSort = {
    created_at: 'b.created_at DESC',
    check_in: 'b.check_in ASC',
    total: 'b.total_amount DESC',
    status: 'b.status ASC',
  };
  const orderBy = allowedSort[sort] || allowedSort.created_at;

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const offset = (page - 1) * limit;

  const total = db.prepare(`SELECT COUNT(*) n FROM bookings b ${whereSql}`).get(...params).n;
  const rows = db.prepare(`
    SELECT b.id, b.code, b.status, b.check_in, b.check_out, b.nights, b.guests,
           b.guest_name, b.guest_phone, b.guest_email, b.total_amount, b.currency,
           b.hold_expires_at, b.confirmed_at, b.cancelled_at, b.created_at,
           u.full_name AS booker_name, u.email AS booker_email,
           (SELECT COALESCE(SUM(amount),0) FROM payments p
             WHERE p.booking_id = b.id AND p.type='CHARGE' AND p.status='PAID') AS paid_amount
    FROM bookings b JOIN users u ON u.id = b.user_id
    ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const linesStmt = db.prepare(`
    SELECT br.qty, br.line_total, rt.name_vi, rt.slug FROM booking_rooms br
    JOIN room_types rt ON rt.id = br.room_type_id WHERE br.booking_id = ?`);
  for (const r of rows) r.lines = linesStmt.all(r.id);

  return { rows, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/** Stats cho dashboard admin */
export function bookingStats({ days = 30 } = {}) {
  const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const byStatus = db.prepare(`SELECT status, COUNT(*) n, COALESCE(SUM(total_amount),0) revenue
                               FROM bookings GROUP BY status`).all();
  const revenue = db.prepare(`SELECT COALESCE(SUM(amount),0) n FROM payments
                              WHERE type='CHARGE' AND status='PAID' AND date(paid_at) >= ?`).get(from).n;
  const refunds = db.prepare(`SELECT COALESCE(SUM(amount),0) n FROM payments
                              WHERE type='REFUND' AND status='PAID' AND date(paid_at) >= ?`).get(from).n;
  const bookingsCount = db.prepare(`SELECT COUNT(*) n FROM bookings WHERE date(created_at) >= ?`).get(from).n;
  const today = todayISO();
  const arrivals = db.prepare(`SELECT COUNT(*) n FROM bookings WHERE status='CONFIRMED' AND check_in = ?`).get(today).n;
  const departures = db.prepare(`SELECT COUNT(*) n FROM bookings WHERE status IN ('CONFIRMED','CHECKED_IN') AND check_out = ?`).get(today).n;
  const inHouse = db.prepare(`SELECT COUNT(*) n FROM bookings WHERE status='CHECKED_IN'`).get().n;

  const daily = db.prepare(`
    SELECT date(check_in) AS d, COUNT(*) bookings, COALESCE(SUM(total_amount),0) revenue
    FROM bookings WHERE check_in >= ? AND status NOT IN ('CANCELLED','EXPIRED')
    GROUP BY date(check_in) ORDER BY d`).all(from);

  const topRooms = db.prepare(`
    SELECT rt.name_vi, rt.slug, COUNT(br.id) bookings, COALESCE(SUM(br.line_total),0) revenue
    FROM booking_rooms br JOIN room_types rt ON rt.id = br.room_type_id
    JOIN bookings b ON b.id = br.booking_id
    WHERE b.status IN ('CONFIRMED','CHECKED_IN','COMPLETED') AND b.created_at >= ?
    GROUP BY rt.id ORDER BY revenue DESC LIMIT 5`).all(from);

  return {
    period_days: days,
    revenue, refunds, net_revenue: revenue - refunds,
    bookings: bookingsCount,
    today: { arrivals, departures, in_house: inHouse },
    by_status: byStatus,
    daily, top_rooms: topRooms,
    pending_expiring: db.prepare(`SELECT COUNT(*) n FROM bookings WHERE status='PENDING'
                                  AND hold_expires_at > datetime('now')`).get().n,
  };
}
