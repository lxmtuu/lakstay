import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { validate } from '../../middlewares/validate.js';
import { requireAuth, requireRole, optionalAuth } from '../../middlewares/auth.js';
import { rateLimit } from '../../middlewares/error.js';
import { asyncHandler, ok, created, paginate, pageMeta } from '../../utils/http.js';
import { Errors } from '../../utils/errors.js';
import { newId } from '../../utils/id.js';
import { audit } from '../../services/audit.service.js';

const router = Router();

/**
 * QUY TẮC: chỉ booking đã COMPLETED mới được review, và mỗi (booking, room_type) 1 lần.
 * => Chống review ảo (fake reviews) ngay từ tầng nghiệp vụ, không cần AI moderation.
 * UNIQUE (booking_id, room_type_id) ở DB là chốt chặn cuối.
 */

/** GET /api/reviews/eligible — tôi được phép review booking nào */
router.get('/eligible', requireAuth, asyncHandler(async (req, res) => {
  const rows = db.prepare(`
    SELECT b.id AS booking_id, b.code, b.check_in, b.check_out, br.room_type_id,
           rt.name_vi, rt.slug, rt.images,
           (SELECT r.id FROM reviews r WHERE r.booking_id = b.id AND r.room_type_id = br.room_type_id) AS review_id
    FROM bookings b
    JOIN booking_rooms br ON br.booking_id = b.id
    JOIN room_types rt ON rt.id = br.room_type_id
    WHERE b.user_id = ? AND b.status = 'COMPLETED'
    ORDER BY b.check_out DESC LIMIT 30
  `).all(req.user.id);
  ok(res, {
    items: rows.map((r) => ({ ...r, images: (() => { try { return JSON.parse(r.images || '[]'); } catch { return []; } })(), reviewed: !!r.review_id })),
  });
}));

const createSchema = z.object({
  bookingId: z.string().min(1),
  roomTypeId: z.string().min(1),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  content: z.string().trim().min(20, 'Đánh giá tối thiểu 20 ký tự').max(2000),
});

router.post('/', requireAuth,
  rateLimit({ windowMs: 3600_000, max: 20, keyPrefix: 'review' }),
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const { bookingId, roomTypeId, rating, title, content } = req.body;

    const b = db.prepare(`SELECT * FROM bookings WHERE id = ?`).get(bookingId);
    if (!b) throw Errors.notFound('Không tìm thấy booking');
    if (b.user_id !== req.user.id) throw Errors.forbidden();
    if (b.status !== 'COMPLETED') {
      throw Errors.unprocessable('Chỉ có thể đánh giá sau khi kỳ nghỉ đã hoàn tất');
    }
    const line = db.prepare(`SELECT id FROM booking_rooms WHERE booking_id = ? AND room_type_id = ?`)
      .get(bookingId, roomTypeId);
    if (!line) throw Errors.badRequest('Booking này không chứa loại phòng trên');

    const existing = db.prepare(`SELECT id FROM reviews WHERE booking_id = ? AND room_type_id = ?`)
      .get(bookingId, roomTypeId);
    if (existing) throw Errors.conflict('Bạn đã đánh giá phòng này rồi');

    // Lọc nội dung độc hại cơ bản (prod: thay bằng API moderation)
    const banned = /\b(scam|lừa đảo|fake|đếch)\b/i;
    const isApproved = banned.test(content) ? 0 : 1;

    const id = newId('rev');
    db.prepare(`
      INSERT INTO reviews (id, booking_id, user_id, room_type_id, rating, title, content, is_approved)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(id, bookingId, req.user.id, roomTypeId, rating, title || null, content, isApproved);

    audit({ req, actor: req.user, action: 'REVIEW_CREATED', entityType: 'review', entityId: id,
            after: { booking_id: bookingId, rating } });

    created(res, { id, rating, is_approved: !!isApproved,
      message: isApproved ? 'Cảm ơn bạn đã đánh giá!' : 'Đánh giá đang chờ kiểm duyệt' });
  })
);

/** GET /api/reviews?roomTypeId=&rating=&page= */
const listQuery = z.object({
  roomTypeId: z.string().optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

router.get('/', optionalAuth, validate(listQuery, 'query'), asyncHandler(async (req, res) => {
  const pg = paginate(req.query);
  const { roomTypeId, rating } = req.query;
  const where = ['r.is_approved = 1'];
  const params = [];
  if (roomTypeId) { where.push('r.room_type_id = ?'); params.push(roomTypeId); }
  if (rating) { where.push('r.rating = ?'); params.push(rating); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const total = db.prepare(`SELECT COUNT(*) n FROM reviews r ${whereSql}`).get(...params).n;
  const rows = db.prepare(`
    SELECT r.id, r.rating, r.title, r.content, r.created_at, r.owner_reply,
           u.full_name, rt.name_vi AS room_type_name, rt.slug
    FROM reviews r
    JOIN users u ON u.id = r.user_id
    JOIN room_types rt ON rt.id = r.room_type_id
    ${whereSql} ORDER BY r.created_at DESC LIMIT ? OFFSET ?
  `).all(...params, pg.limit, pg.offset);

  const dist = db.prepare(`
    SELECT rating, COUNT(*) n FROM reviews r ${whereSql} GROUP BY rating`).all(...params);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const d of dist) distribution[d.rating] = d.n;
  const avg = total ? rows.length ? null : null : null;
  const avgRow = db.prepare(`SELECT AVG(rating) a FROM reviews r ${whereSql}`).get(...params);

  ok(res, {
    items: rows.map((r) => ({ ...r, full_name: maskName(r.full_name) })),
    summary: { count: total, average: avgRow.a ? Number(avgRow.a.toFixed(2)) : null, distribution },
  }, pageMeta(pg, total));
}));

const maskName = (n = '') => {
  const parts = String(n).trim().split(/\s+/);
  return parts.length > 1 ? `${parts.slice(-1)[0]} ${parts[0][0]}.` : n;
};

/** POST /api/reviews/:id/reply — staff/admin phản hồi */
router.post('/:id/reply', requireAuth, requireRole('staff', 'admin'),
  validate(z.object({ reply: z.string().trim().min(5).max(1000) })),
  asyncHandler(async (req, res) => {
    const r = db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(req.params.id);
    if (!r) throw Errors.notFound('Không tìm thấy đánh giá');
    db.prepare(`UPDATE reviews SET owner_reply = ? WHERE id = ?`).run(req.body.reply, r.id);
    audit({ req, actor: req.user, action: 'REVIEW_REPLIED', entityType: 'review', entityId: r.id });
    ok(res, { id: r.id, owner_reply: req.body.reply });
  })
);

/** PATCH /api/reviews/:id/moderate */
router.patch('/:id/moderate', requireAuth, requireRole('staff', 'admin'),
  validate(z.object({ isApproved: z.boolean() })),
  asyncHandler(async (req, res) => {
    const r = db.prepare(`SELECT * FROM reviews WHERE id = ?`).get(req.params.id);
    if (!r) throw Errors.notFound('Không tìm thấy đánh giá');
    db.prepare(`UPDATE reviews SET is_approved = ? WHERE id = ?`).run(req.body.isApproved ? 1 : 0, r.id);
    audit({ req, actor: req.user, action: 'REVIEW_MODERATED', entityType: 'review', entityId: r.id,
            before: { is_approved: r.is_approved }, after: { is_approved: req.body.isApproved ? 1 : 0 } });
    ok(res, { id: r.id, is_approved: req.body.isApproved });
  })
);

export default router;
