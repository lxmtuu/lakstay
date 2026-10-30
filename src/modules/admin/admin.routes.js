import { Router } from 'express';
import path from 'node:path';
import { z } from 'zod';
import { db, withTransaction } from '../../db.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth, requireRole } from '../../middlewares/auth.js';
import { rateLimit } from '../../middlewares/error.js';
import { asyncHandler, ok, created, paginate, pageMeta, escapeLike } from '../../utils/http.js';
import { Errors } from '../../utils/errors.js';
import { newId } from '../../utils/id.js';
import { isValidDateString, todayISO, addDays, stayDates } from '../../utils/date.js';
import { bookingStats, transitionBooking, listBookings, getBookingById, expireStaleHolds, autoCompletePastBookings, markNoShows } from '../../services/booking.service.js';
import { occupancyCalendar } from '../../services/availability.service.js';
import { refundPayment } from '../../services/payment.service.js';
import { audit, listAudit, countAudit } from '../../services/audit.service.js';
import { listOutbox, readOutbox } from '../../services/mail.service.js';
import { TIERS, tierForSpend, adjustPoints, getSummary } from '../../services/loyalty.service.js';

const router = Router();

/** Toàn bộ /api/admin yêu cầu staff hoặc admin */
router.use(requireAuth, requireRole('staff', 'admin'));

/** Chỉ admin mới được đụng vào tiền/users/price */
const adminOnly = requireRole('admin');

/* ============================== DASHBOARD ============================== */
router.get('/dashboard', asyncHandler(async (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const stats = bookingStats({ days });
  const calendar = occupancyCalendar({ from: todayISO(), days: 14 });

  const recent = db.prepare(`
    SELECT b.id, b.code, b.status, b.guest_name, b.total_amount, b.check_in, b.created_at
    FROM bookings b ORDER BY b.created_at DESC LIMIT 8`).all();

  ok(res, {
    stats,
    calendar,
    recent_bookings: recent,
    alerts: {
      pending_holds: stats.pending_expiring,
      low_stock_days: calendar.dates.filter((d) => d.available <= 2).length,
      full_days: calendar.dates.filter((d) => d.available === 0).length,
      unapproved_reviews: db.prepare(`SELECT COUNT(*) n FROM reviews WHERE is_approved = 0`).get().n,
      critical_security: db.prepare(`SELECT COUNT(*) n FROM security_events
                                     WHERE severity='critical' AND created_at > datetime('now','-7 day')`).get().n,
    },
  });
}));

/* ============================== BOOKINGS ============================== */
const listQuery = z.object({
  status: z.string().optional(),
  q: z.string().max(100).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  sort: z.enum(['created_at', 'check_in', 'total', 'status']).default('created_at'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

router.get('/bookings', validate(listQuery, 'query'), asyncHandler(async (req, res) => {
  const pg = paginate(req.query);
  const result = listBookings({ role: req.user.role === 'admin' ? 'admin' : 'staff', ...req.query, page: pg.page, limit: pg.limit });
  ok(res, { items: result.rows }, pageMeta(pg, result.total));
}));

router.get('/bookings/:id', asyncHandler(async (req, res) => {
  const b = getBookingById(req.params.id);
  if (!b) throw Errors.notFound('Không tìm thấy booking');
  const history = listAudit({ entityType: 'booking', entityId: b.id, limit: 50 });
  ok(res, { booking: b, history });
}));

/** Đổi trạng thái (check-in / check-out / no-show / cancel) */
router.post('/bookings/:id/transition',
  validate(z.object({
    to: z.enum(['CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'CONFIRMED']),
    note: z.string().max(300).optional(),
  })),
  asyncHandler(async (req, res) => {
    const result = transitionBooking({ bookingId: req.params.id, to: req.body.to, actor: req.user, req, note: req.body.note });
    ok(res, { result, booking: getBookingById(req.params.id) });
  })
);

router.post('/bookings/:id/refund', adminOnly,
  validate(z.object({ amount: z.number().int().positive().optional(), reason: z.string().min(3).max(300) })),
  asyncHandler(async (req, res) => {
    ok(res, refundPayment({ bookingId: req.params.id, amount: req.body.amount ?? null, actor: req.user, req, reason: req.body.reason }));
  })
);

/** Front-desk: lịch đến/đi trong ngày */
router.get('/front-desk', asyncHandler(async (req, res) => {
  const date = isValidDateString(req.query.date) ? req.query.date : todayISO();
  const arrivals = db.prepare(`
    SELECT b.id, b.code, b.guest_name, b.guest_phone, b.status, b.check_in, b.check_out, b.total_amount,
      (SELECT GROUP_CONCAT(rt.name_vi, ', ') FROM booking_rooms br JOIN room_types rt ON rt.id=br.room_type_id WHERE br.booking_id=b.id) AS rooms
    FROM bookings b WHERE b.check_in = ? AND b.status IN ('CONFIRMED','PENDING') ORDER BY b.created_at`).all(date);
  const departures = db.prepare(`
    SELECT b.id, b.code, b.guest_name, b.status, b.check_out, b.total_amount
    FROM bookings b WHERE b.check_out = ? AND b.status IN ('CONFIRMED','CHECKED_IN')`).all(date);
  const inHouse = db.prepare(`
    SELECT b.id, b.code, b.guest_name, b.check_in, b.check_out, rc.room_id, r.room_number
    FROM bookings b
    JOIN room_calendar rc ON rc.booking_id = b.id AND rc.stay_date = ?
    JOIN rooms r ON r.id = rc.room_id
    WHERE b.status IN ('CONFIRMED','CHECKED_IN') GROUP BY b.id ORDER BY r.room_number`).all(date);

  ok(res, { date, arrivals, departures, in_house: inHouse,
            counts: { arrivals: arrivals.length, departures: departures.length, in_house: inHouse.length } });
}));

/* ============================== ROOM TYPES ============================== */
router.get('/room-types', asyncHandler(async (_req, res) => {
  const rows = db.prepare(`SELECT * FROM room_types ORDER BY base_price`).all();
  const stats = db.prepare(`
    SELECT room_type_id, COUNT(*) bookings, COALESCE(SUM(line_total),0) revenue
    FROM booking_rooms GROUP BY room_type_id`).all();
  const map = new Map(stats.map((s) => [s.room_type_id, s]));
  ok(res, { items: rows.map((r) => ({ ...r, stats: map.get(r.id) || { bookings: 0, revenue: 0 } })) });
}));

const roomTypeSchema = z.object({
  name: z.string().min(2).max(80),
  nameVi: z.string().min(2).max(80),
  description: z.string().max(3000).optional(),
  descriptionEn: z.string().max(3000).optional(),
  capacity: z.number().int().min(1).max(20),
  bedType: z.string().min(2).max(40),
  sizeM2: z.number().int().min(5).max(500),
  basePrice: z.number().int().min(0).max(1_000_000_000),
  amenities: z.array(z.string().max(60)).max(40).default([]),
  images: z.array(z.string().max(500)).max(10).default([]),
  cancelFreeHours: z.number().int().min(0).max(720).default(48),
  cancelPenaltyPct: z.number().int().min(0).max(100).default(50),
  cancelNoRefundHours: z.number().int().min(0).max(720).default(24),
  minStay: z.number().int().min(1).max(30).default(1),
  maxStay: z.number().int().min(1).max(90).default(30),
  maxAdvanceDays: z.number().int().min(1).max(1095).default(365),
  isActive: z.boolean().default(true),
  slug: z.string().regex(/^[a-z0-9-]{2,60}$/, 'Slug chỉ gồm chữ thường, số và dấu gạch ngang').optional(),
});

router.post('/room-types', adminOnly, validate(roomTypeSchema), asyncHandler(async (req, res) => {
  const d = req.body;
  const id = newId('rt');
  const slug = d.slug || d.nameVi.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  // total_rooms khởi tạo = 0; trigger trg_rooms_count_ai/ad sẽ tự sync khi thêm/xoá phòng vật lý
  db.prepare(`
    INSERT INTO room_types (id, slug, name, name_vi, description, description_en, capacity, bed_type, size_m2, base_price,
      total_rooms, amenities, images, cancel_free_hours, cancel_penalty_pct, cancel_no_refund_hours,
      min_stay, max_stay, max_advance_days, is_active)
    VALUES (?,?,?,?,?,?,?,?,?,?, 0,?,?,?,?,?,?,?,?,?)
  `).run(id, slug, d.name, d.nameVi, d.description || null, d.descriptionEn || null, d.capacity, d.bedType, d.sizeM2, d.basePrice,
    JSON.stringify(d.amenities), JSON.stringify(d.images), d.cancelFreeHours, d.cancelPenaltyPct,
    d.cancelNoRefundHours, d.minStay, d.maxStay, d.maxAdvanceDays, d.isActive ? 1 : 0);
  audit({ req, actor: req.user, action: 'ROOM_TYPE_CREATED', entityType: 'room_type', entityId: id, after: d });
  created(res, db.prepare(`SELECT * FROM room_types WHERE id=?`).get(id));
}));

router.put('/room-types/:id', adminOnly, validate(roomTypeSchema.partial()), asyncHandler(async (req, res) => {
  const before = db.prepare(`SELECT * FROM room_types WHERE id=?`).get(req.params.id);
  if (!before) throw Errors.notFound('Không tìm thấy loại phòng');
  const d = req.body;
  db.prepare(`
    UPDATE room_types SET
      name=COALESCE(?,name), name_vi=COALESCE(?,name_vi), description=COALESCE(?,description),
      description_en=COALESCE(?,description_en),
      capacity=COALESCE(?,capacity), bed_type=COALESCE(?,bed_type), size_m2=COALESCE(?,size_m2),
      base_price=COALESCE(?,base_price), amenities=COALESCE(?,amenities), images=COALESCE(?,images),
      cancel_free_hours=COALESCE(?,cancel_free_hours), cancel_penalty_pct=COALESCE(?,cancel_penalty_pct),
      cancel_no_refund_hours=COALESCE(?,cancel_no_refund_hours),
      min_stay=COALESCE(?,min_stay), max_stay=COALESCE(?,max_stay), max_advance_days=COALESCE(?,max_advance_days),
      is_active=COALESCE(?,is_active), version=version+1, updated_at=datetime('now')
    WHERE id=? AND version=?
  `).run(d.name ?? null, d.nameVi ?? null, d.description ?? null, d.descriptionEn ?? null,
    d.capacity ?? null, d.bedType ?? null,
    d.sizeM2 ?? null, d.basePrice ?? null, d.amenities ? JSON.stringify(d.amenities) : null,
    d.images ? JSON.stringify(d.images) : null, d.cancelFreeHours ?? null, d.cancelPenaltyPct ?? null,
    d.cancelNoRefundHours ?? null, d.minStay ?? null, d.maxStay ?? null, d.maxAdvanceDays ?? null,
    d.isActive === undefined ? null : (d.isActive ? 1 : 0),
    req.params.id, before.version);
  audit({ req, actor: req.user, action: 'ROOM_TYPE_UPDATED', entityType: 'room_type', entityId: req.params.id, before, after: d });
  ok(res, db.prepare(`SELECT * FROM room_types WHERE id=?`).get(req.params.id));
}));

/* ============================== ROOMS (vật lý) ============================== */
router.get('/rooms', asyncHandler(async (req, res) => {
  const typeId = req.query.roomTypeId;
  const rows = typeId
    ? db.prepare(`SELECT r.*, rt.name_vi FROM rooms r JOIN room_types rt ON rt.id=r.room_type_id WHERE r.room_type_id=? ORDER BY r.room_number`).all(typeId)
    : db.prepare(`SELECT r.*, rt.name_vi FROM rooms r JOIN room_types rt ON rt.id=r.room_type_id ORDER BY rt.base_price, r.room_number`).all();
  ok(res, { items: rows });
}));

router.post('/rooms', adminOnly,
  validate(z.object({
    roomTypeId: z.string().min(1),
    roomNumber: z.string().min(1).max(20),
    floor: z.number().int().min(0).max(99).default(1),
  })),
  asyncHandler(async (req, res) => {
    const id = newId('rom');
    db.prepare(`INSERT INTO rooms (id, room_type_id, room_number, floor) VALUES (?,?,?,?)`)
      .run(id, req.body.roomTypeId, req.body.roomNumber, req.body.floor);
    audit({ req, actor: req.user, action: 'ROOM_CREATED', entityType: 'room', entityId: id, after: req.body });
    created(res, db.prepare(`SELECT * FROM rooms WHERE id=?`).get(id));
  })
);

router.patch('/rooms/:id', validate(z.object({
  status: z.enum(['available', 'maintenance', 'blocked']).optional(),
})), asyncHandler(async (req, res) => {
  const before = db.prepare(`SELECT * FROM rooms WHERE id=?`).get(req.params.id);
  if (!before) throw Errors.notFound('Không tìm thấy phòng');

  // KHÔNG cho chuyển sang maintenance/blocked nếu phòng đang giữ chỗ hoặc có khách (PENDING/CONFIRMED/CHECKED_IN)
  if (req.body.status && req.body.status !== 'available') {
    const conflicts = db.prepare(`
      SELECT rc.stay_date, b.code, b.status FROM room_calendar rc
      JOIN bookings b ON b.id = rc.booking_id
      WHERE rc.room_id = ? AND b.status IN ('PENDING','CONFIRMED','CHECKED_IN') AND rc.stay_date >= ?
      ORDER BY rc.stay_date LIMIT 10`).all(req.params.id, todayISO());
    if (conflicts.length) {
      throw Errors.conflict(`Phòng đang có booking giữ chỗ / sắp tới, không thể chuyển trạng thái`, { conflicts });
    }
  }
  db.prepare(`UPDATE rooms SET status=COALESCE(?,status), version=version+1 WHERE id=?`)
    .run(req.body.status ?? null, req.params.id);
  audit({ req, actor: req.user, action: 'ROOM_STATUS_CHANGED', entityType: 'room', entityId: req.params.id,
          before: { status: before.status }, after: { status: req.body.status } });
  ok(res, db.prepare(`SELECT * FROM rooms WHERE id=?`).get(req.params.id));
}));

/* ============================== BLOCK DATE (chặn phòng bảo trì/đoàn VIP) ============================== */
router.get('/blocks', asyncHandler(async (req, res) => {
  const from = isValidDateString(req.query.from) ? req.query.from : todayISO();
  const to = isValidDateString(req.query.to) ? req.query.to : addDays(from, 30);
  const rows = db.prepare(`
    SELECT rb.*, r.room_number, rt.name_vi AS room_type_name, u.full_name AS blocked_by_name
    FROM room_blocks rb
    JOIN rooms r ON r.id = rb.room_id
    JOIN room_types rt ON rt.id = r.room_type_id
    LEFT JOIN users u ON u.id = rb.created_by
    WHERE rb.block_date BETWEEN ? AND ?
    ORDER BY rb.block_date, r.room_number`).all(from, to);
  ok(res, { items: rows, from, to });
}));

const blockSchema = z.object({
  roomTypeId: z.string().min(1),
  from: z.string().refine(isValidDateString, 'Ngày không hợp lệ'),
  to: z.string().refine(isValidDateString, 'Ngày không hợp lệ'),
  qty: z.number().int().min(1).max(50).default(1),
  reason: z.string().min(3).max(200),
});

router.post('/blocks', adminOnly, validate(blockSchema), asyncHandler(async (req, res) => {
  const { roomTypeId, from, to, qty, reason } = req.body;
  if (to <= from) throw Errors.badRequest('Ngày kết thúc phải sau ngày bắt đầu');
  if ((new Date(to) - new Date(from)) / 86400000 > 90) throw Errors.badRequest('Chỉ chặn tối đa 90 ngày/lần');

  const result = withTransaction((tx) => {
    const dates = stayDates(from, to);
    const ph = dates.map(() => '?').join(',');
    const blocked = [];
    const skipped = [];

    for (const date of dates) {
      // Tìm phòng của loại này còn trống trong ngày đó (chưa bị booking, chưa bị block)
      const candidates = tx.prepare(`
        SELECT r.id, r.room_number FROM rooms r
        WHERE r.room_type_id = ? AND r.status = 'available'
          AND NOT EXISTS (SELECT 1 FROM room_calendar rc WHERE rc.room_id = r.id AND rc.stay_date = ?)
          AND NOT EXISTS (SELECT 1 FROM room_blocks rb WHERE rb.room_id = r.id AND rb.block_date = ?)
        ORDER BY r.room_number LIMIT ?
      `).all(roomTypeId, date, date, qty);

      if (candidates.length < qty) {
        skipped.push({ date, requested: qty, available: candidates.length });
      }
      for (const c of candidates) {
        tx.prepare(`INSERT INTO room_blocks (room_id, block_date, reason, created_by) VALUES (?,?,?,?)`)
          .run(c.id, date, reason, req.user.id);
        blocked.push({ room_id: c.id, room_number: c.room_number, date });
      }
    }
    if (!blocked.length) {
      throw Errors.conflict('Không còn phòng trống để chặn trong khoảng ngày này', { skipped });
    }
    return { blocked, skipped, room_nights: blocked.length };
  });

  audit({ req, actor: req.user, action: 'ROOM_BLOCKED', entityType: 'room_block', entityId: roomTypeId,
          after: { from, to, qty, reason, room_nights: result.room_nights } });
  created(res, result);
}));

router.delete('/blocks', adminOnly, validate(z.object({
  roomId: z.string().min(1),
  from: z.string().refine(isValidDateString),
  to: z.string().refine(isValidDateString),
}), 'query'), asyncHandler(async (req, res) => {
  const { roomId, from, to } = req.query;
  const info = db.prepare(`DELETE FROM room_blocks WHERE room_id = ? AND block_date >= ? AND block_date < ?`)
    .run(roomId, from, to);
  audit({ req, actor: req.user, action: 'ROOM_BLOCK_REMOVED', entityType: 'room_block', entityId: roomId,
          before: { from, to }, after: { removed: info.changes } });
  ok(res, { removed: info.changes });
}));

/* ============================== PRICE RULES ============================== */
router.get('/price-rules', asyncHandler(async (_req, res) => {
  ok(res, { items: db.prepare(`
    SELECT pr.*, rt.name_vi FROM price_rules pr JOIN room_types rt ON rt.id=pr.room_type_id
    ORDER BY pr.start_date DESC`).all() });
}));

router.post('/price-rules', adminOnly, validate(z.object({
  roomTypeId: z.string().min(1),
  name: z.string().min(2).max(80),
  startDate: z.string().refine(isValidDateString),
  endDate: z.string().refine(isValidDateString),
  multiplier: z.number().min(0.1).max(10),
  priority: z.number().int().min(1).max(100).default(10),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
})), asyncHandler(async (req, res) => {
  const d = req.body;
  if (d.endDate < d.startDate) throw Errors.badRequest('Ngày kết thúc phải sau ngày bắt đầu');
  const id = newId('pr');
  db.prepare(`INSERT INTO price_rules (id, room_type_id, name, start_date, end_date, multiplier, priority, days_of_week)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, d.roomTypeId, d.name, d.startDate, d.endDate, d.multiplier, d.priority,
      d.daysOfWeek ? JSON.stringify(d.daysOfWeek) : null);
  audit({ req, actor: req.user, action: 'PRICE_RULE_CREATED', entityType: 'price_rule', entityId: id, after: d });
  created(res, db.prepare(`SELECT * FROM price_rules WHERE id=?`).get(id));
}));

router.delete('/price-rules/:id', adminOnly, asyncHandler(async (req, res) => {
  const before = db.prepare(`SELECT * FROM price_rules WHERE id=?`).get(req.params.id);
  if (!before) throw Errors.notFound();
  db.prepare(`DELETE FROM price_rules WHERE id=?`).run(req.params.id);
  audit({ req, actor: req.user, action: 'PRICE_RULE_DELETED', entityType: 'price_rule', entityId: req.params.id, before });
  ok(res, { deleted: true });
}));

/* ============================== COUPONS ============================== */
router.get('/coupons', asyncHandler(async (_req, res) => {
  ok(res, { items: db.prepare(`SELECT * FROM coupons ORDER BY created_at DESC`).all() });
}));

router.post('/coupons', adminOnly, validate(z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,20}$/, 'Mã gồm 3-20 ký tự A-Z 0-9'),
  type: z.enum(['PERCENT', 'FIXED']),
  value: z.number().int().min(1),
  maxDiscount: z.number().int().min(0).optional(),
  minAmount: z.number().int().min(0).default(0),
  startsAt: z.string().min(10),
  endsAt: z.string().min(10),
  usageLimit: z.number().int().min(1).optional().nullable(),
  perUserLimit: z.number().int().min(1).max(100).default(1),
  isActive: z.boolean().default(true),
})), asyncHandler(async (req, res) => {
  const d = req.body;
  if (d.type === 'PERCENT' && d.value > 100) throw Errors.badRequest('Giảm tối đa 100%');
  const id = newId('cpn');
  db.prepare(`INSERT INTO coupons (id, code, type, value, max_discount, min_amount, starts_at, ends_at,
              usage_limit, per_user_limit, is_active) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, d.code, d.type, d.value, d.maxDiscount ?? null, d.minAmount, d.startsAt, d.endsAt,
      d.usageLimit ?? null, d.perUserLimit, d.isActive ? 1 : 0);
  audit({ req, actor: req.user, action: 'COUPON_CREATED', entityType: 'coupon', entityId: id, after: d });
  created(res, db.prepare(`SELECT * FROM coupons WHERE id=?`).get(id));
}));

router.patch('/coupons/:id', adminOnly, validate(z.object({
  isActive: z.boolean().optional(),
  usageLimit: z.number().int().min(1).nullable().optional(),
  endsAt: z.string().optional(),
})), asyncHandler(async (req, res) => {
  const before = db.prepare(`SELECT * FROM coupons WHERE id=?`).get(req.params.id);
  if (!before) throw Errors.notFound();
  db.prepare(`UPDATE coupons SET is_active=COALESCE(?,is_active), usage_limit=COALESCE(?,usage_limit),
              ends_at=COALESCE(?,ends_at) WHERE id=?`)
    .run(req.body.isActive === undefined ? null : (req.body.isActive ? 1 : 0),
      req.body.usageLimit === undefined ? null : req.body.usageLimit,
      req.body.endsAt ?? null, req.params.id);
  audit({ req, actor: req.user, action: 'COUPON_UPDATED', entityType: 'coupon', entityId: req.params.id, before, after: req.body });
  ok(res, db.prepare(`SELECT * FROM coupons WHERE id=?`).get(req.params.id));
}));

/* ============================== USERS ============================== */
router.get('/users', adminOnly, validate(z.object({
  q: z.string().max(100).optional(), role: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
}), 'query'), asyncHandler(async (req, res) => {
  const pg = paginate(req.query);
  const where = [];
  const params = [];
  if (req.query.q) {
    where.push(`(email LIKE ? ESCAPE '\\' OR full_name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\')`);
    const l = `%${escapeLike(req.query.q)}%`;
    params.push(l, l, l);
  }
  if (req.query.role) { where.push('role = ?'); params.push(req.query.role); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM users ${w}`).get(...params).n;
  const rows = db.prepare(`
    SELECT id, email, full_name, phone, role, status, email_verified, created_at, last_login_at, last_login_ip,
      (SELECT COUNT(*) FROM bookings b WHERE b.user_id = users.id) AS bookings_count
    FROM users ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, pg.limit, pg.offset);
  ok(res, { items: rows }, pageMeta(pg, total));
}));

router.patch('/users/:id', adminOnly, validate(z.object({
  role: z.enum(['customer', 'staff', 'admin']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
})), asyncHandler(async (req, res) => {
  const target = db.prepare(`SELECT * FROM users WHERE id=?`).get(req.params.id);
  if (!target) throw Errors.notFound('Không tìm thấy người dùng');
  if (target.id === req.user.id && req.body.role && req.body.role !== 'admin') {
    throw Errors.badRequest('Không thể tự hạ quyền của chính mình');
  }
  db.prepare(`UPDATE users SET role=COALESCE(?,role), status=COALESCE(?,status), updated_at=datetime('now') WHERE id=?`)
    .run(req.body.role ?? null, req.body.status ?? null, target.id);
  if (req.body.status === 'suspended') {
    db.prepare(`UPDATE refresh_tokens SET revoked_at=datetime('now') WHERE user_id=? AND revoked_at IS NULL`).run(target.id);
  }
  audit({ req, actor: req.user, action: 'USER_UPDATED', entityType: 'user', entityId: target.id,
          before: { role: target.role, status: target.status }, after: req.body });
  ok(res, db.prepare(`SELECT id,email,full_name,role,status FROM users WHERE id=?`).get(target.id));
}));

/* ============================== REVIEWS (kiểm duyệt) ============================== */
router.get('/reviews', validate(z.object({
  status: z.enum(['all', 'pending', 'approved']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
}), 'query'), asyncHandler(async (req, res) => {
  const pg = paginate(req.query);
  const where = [];
  if (req.query.status === 'pending') where.push('r.is_approved = 0');
  else if (req.query.status === 'approved') where.push('r.is_approved = 1');
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM reviews r ${w}`).get().n;
  const rows = db.prepare(`
    SELECT r.id, r.booking_id, r.room_type_id, r.rating, r.title, r.content, r.is_approved,
           r.owner_reply, r.created_at,
           u.full_name, u.email, rt.name_vi AS room_type_name, b.code AS booking_code
    FROM reviews r
    JOIN users u ON u.id = r.user_id
    JOIN room_types rt ON rt.id = r.room_type_id
    JOIN bookings b ON b.id = r.booking_id
    ${w} ORDER BY r.is_approved ASC, r.created_at DESC LIMIT ? OFFSET ?`).all(pg.limit, pg.offset);
  const counts = db.prepare(`
    SELECT SUM(CASE WHEN is_approved = 0 THEN 1 ELSE 0 END) AS pending,
           SUM(CASE WHEN is_approved = 1 THEN 1 ELSE 0 END) AS approved,
           COUNT(*) AS total,
           AVG(CASE WHEN is_approved = 1 THEN rating END) AS average
    FROM reviews`).get();
  ok(res, {
    items: rows,
    summary: {
      total: counts.total || 0,
      pending: counts.pending || 0,
      approved: counts.approved || 0,
      average: counts.average ? Number(counts.average.toFixed(2)) : null,
    },
  }, pageMeta(pg, total));
}));

/* ============================== AUDIT & SECURITY ============================== */
router.get('/audit-logs', adminOnly, validate(z.object({
  action: z.string().optional(),
  entityType: z.string().optional(), entityId: z.string().optional(), actorId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(50),
}), 'query'), asyncHandler(async (req, res) => {
  const pg = paginate(req.query);
  const total = countAudit(req.query);
  const rows = listAudit({ ...req.query, limit: pg.limit, offset: pg.offset });
  ok(res, { items: rows }, pageMeta(pg, total));
}));

router.get('/security-events', adminOnly, validate(z.object({
  severity: z.enum(['info', 'warn', 'critical']).optional(),
  type: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(50),
}), 'query'), asyncHandler(async (req, res) => {
  const pg = paginate(req.query);
  const where = []; const params = [];
  if (req.query.severity) { where.push('severity=?'); params.push(req.query.severity); }
  if (req.query.type) { where.push('type=?'); params.push(req.query.type); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM security_events ${w}`).get(...params).n;
  const rows = db.prepare(`SELECT * FROM security_events ${w} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, pg.limit, pg.offset);
  const byType = db.prepare(`SELECT type, severity, COUNT(*) n FROM security_events
    WHERE created_at > datetime('now','-7 day') GROUP BY type, severity ORDER BY n DESC LIMIT 15`).all();
  ok(res, { items: rows, by_type: byType }, pageMeta(pg, total));
}));

/* ============================== PAYMENTS (admin view) ============================== */
router.get('/payments', validate(z.object({
  status: z.string().optional(), provider: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20),
}), 'query'), asyncHandler(async (req, res) => {
  const pg = paginate(req.query);
  const where = []; const params = [];
  if (req.query.status) { where.push('p.status=?'); params.push(req.query.status); }
  if (req.query.provider) { where.push('p.provider=?'); params.push(req.query.provider); }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) n FROM payments p ${w}`).get(...params).n;
  const rows = db.prepare(`
    SELECT p.id, p.provider, p.type, p.status, p.amount, p.txn_ref, p.paid_at, p.created_at, p.expired_at,
           b.code AS booking_code, u.email AS user_email
    FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN users u ON u.id=p.user_id
    ${w} ORDER BY p.created_at DESC LIMIT ? OFFSET ?`).all(...params, pg.limit, pg.offset);
  ok(res, { items: rows }, pageMeta(pg, total));
}));

/* ============================== REPORTS (CSV export) ============================== */
router.get('/reports/revenue.csv', adminOnly, asyncHandler(async (req, res) => {
  const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));
  const from = addDays(todayISO(), -days);
  const rows = db.prepare(`
    SELECT date(p.paid_at) AS date, COUNT(*) AS transactions, SUM(p.amount) AS revenue
    FROM payments p WHERE p.type='CHARGE' AND p.status='PAID' AND date(p.paid_at) >= ?
    GROUP BY date(p.paid_at) ORDER BY date`).all(from);
  const csv = ['date,transactions,revenue', ...rows.map((r) => `${r.date},${r.transactions},${r.revenue}`)].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="revenue-${from}-${todayISO()}.csv"`);
  res.send('\uFEFF' + csv); // BOM để Excel đọc đúng tiếng Việt
}));

/** GET /api/admin/reports/charts?days=N — chuỗi số liệu cho biểu đồ SVG phía client */
router.get('/reports/charts', asyncHandler(async (req, res) => {
  const days = Math.min(365, Math.max(7, Number(req.query.days) || 30));
  const from = addDays(todayISO(), -(days - 1));
  const fromTs = `${from} 00:00:00`;

  const revRows = db.prepare(`
    SELECT substr(paid_at, 1, 10) d, SUM(amount) total, COUNT(*) n
    FROM payments WHERE type = 'CHARGE' AND status = 'PAID' AND paid_at >= ?
    GROUP BY d ORDER BY d`).all(fromTs);
  const bkRows = db.prepare(`
    SELECT substr(created_at, 1, 10) d, COUNT(*) n
    FROM bookings WHERE created_at >= ? GROUP BY d ORDER BY d`).all(from);
  const statusSplit = db.prepare(`
    SELECT status, COUNT(*) n FROM bookings WHERE created_at >= ? GROUP BY status ORDER BY n DESC`).all(from);
  const byType = db.prepare(`
    SELECT rt.name_vi name, SUM(br.line_total) total
    FROM booking_rooms br JOIN bookings b ON b.id = br.booking_id
    JOIN room_types rt ON rt.id = br.room_type_id
    WHERE b.created_at >= ? AND b.status IN ('CONFIRMED','CHECKED_IN','COMPLETED')
    GROUP BY br.room_type_id ORDER BY total DESC LIMIT 6`).all(from);

  // điền đủ mọi ngày (ngày không có dữ liệu = 0) để đường biểu đồ liền mạch
  const fill = (rows, val) => {
    const map = new Map(rows.map((r) => [r.d, r]));
    const out = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(from, i);
      const r = map.get(d);
      out.push({ date: d, revenue: Number(r?.total || 0), bookings: Number(r?.n || 0), ...((val && r) ? {} : {}) });
    }
    return out;
  };
  const revenueSeries = fill(revRows);
  const bookingsSeries = fill(bkRows);

  ok(res, {
    days, from, to: todayISO(),
    revenue_series: revenueSeries,
    bookings_series: bookingsSeries,
    status_split: statusSplit,
    revenue_by_type: byType,
    totals: {
      revenue: revenueSeries.reduce((s, x) => s + x.revenue, 0),
      paid_orders: revRows.reduce((s, x) => s + x.n, 0),
      bookings: bookingsSeries.reduce((s, x) => s + x.bookings, 0),
    },
  });
}));

router.get('/reports/occupancy', asyncHandler(async (req, res) => {
  const days = Math.min(90, Math.max(1, parseInt(req.query.days, 10) || 30));
  const cal = occupancyCalendar({ from: addDays(todayISO(), -days), days: days * 2 });
  const total = cal.dates.reduce((s, d) => s + d.total_rooms, 0);
  const occupied = cal.dates.reduce((s, d) => s + d.occupied, 0);
  ok(res, {
    period_days: cal.dates.length,
    occupancy_rate_pct: total ? Number(((occupied / total) * 100).toFixed(1)) : 0,
    avg_daily_occupancy: Number((occupied / Math.max(1, cal.dates.length)).toFixed(2)),
    best_day: cal.dates.reduce((a, b) => (b.occupancy_pct > a.occupancy_pct ? b : a), cal.dates[0]),
    days: cal.dates,
  });
}));

/* ============================== LOYALTY (chương trình thành viên) ============================== */

/** GET /api/admin/loyalty — danh sách thành viên + hạng + điểm (admin) */
router.get('/loyalty', adminOnly, asyncHandler(async (req, res) => {
  const q = String(req.query.q || '').trim();
  const tier = String(req.query.tier || '').toUpperCase();
  const where = [];
  const args = [];
  if (q) {
    where.push(`(u.email LIKE ? ESCAPE '\\' OR u.full_name LIKE ? ESCAPE '\\')`);
    const l = `%${escapeLike(q)}%`;
    args.push(l, l);
  }
  if (tier && TIERS.some((t) => t.key === tier)) {
    where.push(`COALESCE(la.tier, 'MEMBER') = ?`);
    args.push(tier);
  }
  const rows = db.prepare(`
    SELECT u.id AS user_id, u.email, u.full_name, u.role,
           COALESCE(la.tier,'MEMBER') tier, COALESCE(la.points,0) points,
           COALESCE(la.lifetime_spend,0) lifetime_spend, la.updated_at
    FROM users u LEFT JOIN loyalty_accounts la ON la.user_id = u.id
    WHERE u.status <> 'deleted' ${where.length ? 'AND ' + where.join(' AND ') : ''}
    ORDER BY lifetime_spend DESC, points DESC LIMIT 200`).all(...args);
  const stats = db.prepare(`
    SELECT COALESCE(la.tier,'MEMBER') tier, COUNT(*) n, COALESCE(SUM(la.points),0) points
    FROM users u LEFT JOIN loyalty_accounts la ON la.user_id = u.id
    WHERE u.status <> 'deleted' GROUP BY COALESCE(la.tier,'MEMBER')`).all();
  ok(res, { items: rows, stats, tiers: TIERS });
}));

/** GET /api/admin/loyalty/:userId — chi tiết 1 thành viên */
router.get('/loyalty/:userId', adminOnly, asyncHandler(async (req, res) => {
  const u = db.prepare(`SELECT id, email, full_name FROM users WHERE id = ?`).get(req.params.userId);
  if (!u) throw Errors.notFound('Không tìm thấy user');
  ok(res, { user: u, loyalty: getSummary(u.id) });
}));

/** POST /api/admin/loyalty/:userId/adjust — điều chỉnh điểm tay (admin, có audit) */
const adjustSchema = z.object({
  points: z.number().int().min(-1_000_000).max(1_000_000).default(0),
  lifetimeSpendDelta: z.number().int().min(-1_000_000_000).max(1_000_000_000).default(0),
  note: z.string().trim().min(3).max(200),
});
router.post('/loyalty/:userId/adjust', adminOnly, validate(adjustSchema), asyncHandler(async (req, res) => {
  const u = db.prepare(`SELECT id, email FROM users WHERE id = ? AND status <> 'deleted'`).get(req.params.userId);
  if (!u) throw Errors.notFound('Không tìm thấy user');
  const before = db.prepare(`SELECT * FROM loyalty_accounts WHERE user_id = ?`).get(u.id) || null;
  const result = withTransaction((tx) =>
    adjustPoints({ userId: u.id, points: req.body.points, lifetimeSpendDelta: req.body.lifetimeSpendDelta,
                   note: req.body.note, actorId: req.user.id }, tx));
  audit({ req, actor: req.user, action: 'LOYALTY_ADJUSTED', entityType: 'user', entityId: u.id,
          before, after: result });
  ok(res, { adjusted: result, tier_info: tierForSpend(result.lifetime_spend) });
}));

/* ============================== MAIL OUTBOX (dev) ============================== */
router.get('/outbox', adminOnly, asyncHandler(async (_req, res) => {
  ok(res, { items: listOutbox(), note: 'Ở môi trường có SMTP thật, email đi qua mail server; đây là bản xem dev.' });
}));
router.get('/outbox/:id', adminOnly, asyncHandler(async (req, res) => {
  const html = readOutbox(req.params.id, 'email.html');
  // Sandbox tuyệt đối: email HTML xem trước không bao giờ được chạy script hoặc đọc cookie cùng origin
  res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: https:;");
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
}));
router.get('/outbox/:id/file/:name', adminOnly, asyncHandler(async (req, res) => {
  const buf = readOutbox(req.params.id, req.params.name);
  const ext = path.extname(req.params.name).toLowerCase();
  res.setHeader('Content-Type', ext === '.pdf' ? 'application/pdf' : 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}"`);
  res.send(buf);
}));

/* ============================== JOBS (chạy tay từ admin) ============================== */
router.post('/jobs/run', adminOnly,
  rateLimit({ windowMs: 60_000, max: 5, keyPrefix: 'job' }),
  asyncHandler(async (req, res) => {
    const result = {
      expired_holds: expireStaleHolds(),
      auto_completed: autoCompletePastBookings(),
      no_shows: markNoShows(),
    };
    audit({ req, actor: req.user, action: 'JOBS_RUN_MANUALLY', entityType: 'system', after: result });
    ok(res, result);
  })
);

export default router;
