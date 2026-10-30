import { Router } from 'express';
import { z } from 'zod';
import { db } from '../../db.js';
import { validate } from '../../middlewares/validate.js';
import { optionalAuth } from '../../middlewares/auth.js';
import { asyncHandler, ok, sanitize, paginate, pageMeta } from '../../utils/http.js';
import { Errors } from '../../utils/errors.js';
import { isValidDateString, todayISO, addDays, diffDays } from '../../utils/date.js';
import { searchAvailability, getInventoryByDate, countAvailable } from '../../services/availability.service.js';
import { quoteBooking, quoteLine, monthPriceCalendar } from '../../services/pricing.service.js';
import { cancellationPreview } from '../../services/cancellation.service.js';

const router = Router();

const parseJson = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

const shapeRoomType = (t, extra = {}) => ({
  id: t.id,
  slug: t.slug,
  name: t.name,
  name_vi: t.name_vi,
  name_en: t.name || null,
  description: t.description,
  description_en: t.description_en || null,
  capacity: t.capacity,
  bed_type: t.bed_type,
  size_m2: t.size_m2,
  base_price: t.base_price,
  total_rooms: t.total_rooms,
  amenities: parseJson(t.amenities, []),
  images: parseJson(t.images, []),
  policy: {
    min_stay: t.min_stay, max_stay: t.max_stay, max_advance_days: t.max_advance_days,
    cancel_free_hours: t.cancel_free_hours,
    cancel_penalty_pct: t.cancel_penalty_pct,
    cancel_no_refund_hours: t.cancel_no_refund_hours,
  },
  rating: extra.rating ?? null,
  review_count: extra.review_count ?? 0,
  ...extra,
});

/** GET /api/rooms?checkIn=&checkOut=&guests=&page=&limit=  — danh sách + tồn kho + rating */
const listQuery = z.object({
  checkIn: z.string().optional(),
  checkOut: z.string().optional(),
  guests: z.coerce.number().int().min(1).max(20).default(1),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  amenities: z.string().max(300).optional(),      // comma-separated
  minRating: z.coerce.number().min(1).max(5).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  sort: z.enum(['price_asc', 'price_desc', 'rating', 'name']).default('price_asc'),
});

router.get('/', optionalAuth, validate(listQuery, 'query'), asyncHandler(async (req, res) => {
  const { checkIn, checkOut, guests, minPrice, maxPrice, sort } = req.query;
  const wantAmenities = String(req.query.amenities || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
  const minRating = req.query.minRating ?? null;
  const pg = paginate(req.query);

  const hasDates = checkIn && checkOut && isValidDateString(checkIn) && isValidDateString(checkOut) && checkOut > checkIn;
  const ci = hasDates ? checkIn : todayISO();
  const co = hasDates ? checkOut : addDays(ci, 1);

  const ratings = db.prepare(`
    SELECT room_type_id, AVG(rating) avg_rating, COUNT(*) cnt FROM reviews
    WHERE is_approved = 1 GROUP BY room_type_id`).all();
  const ratingMap = new Map(ratings.map((r) => [r.room_type_id, r]));

  let types = db.prepare(`SELECT * FROM room_types WHERE is_active = 1`).all()
    .filter((t) => (!minPrice || t.base_price >= minPrice) && (!maxPrice || t.base_price <= maxPrice));

  const items = types.map((t) => {
    const r = ratingMap.get(t.id);
    const available = countAvailable(t.id, ci, co);
    return shapeRoomType(t, {
      available,
      fits_guests: t.capacity >= guests,
      rating: r ? Number(r.avg_rating.toFixed(2)) : null,
      review_count: r?.cnt || 0,
    });
  }).filter((t) => {
    if (minRating && !(t.rating >= minRating)) return false;
    if (wantAmenities.length) {
      const have = new Set((t.amenities || []).map((a) => a.toLowerCase()));
      if (!wantAmenities.every((a) => have.has(a))) return false;
    }
    return true;
  });

  const sorters = {
    price_asc: (a, b) => a.base_price - b.base_price,
    price_desc: (a, b) => b.base_price - a.base_price,
    rating: (a, b) => (b.rating || 0) - (a.rating || 0),
    name: (a, b) => a.name_vi.localeCompare(b.name_vi, 'vi'),
  };
  items.sort(sorters[sort] || sorters.price_asc);

  const total = items.length;
  const paged = items.slice(pg.offset, pg.offset + pg.limit);

  ok(res, {
    items: paged,
    search: { check_in: ci, check_out: co, guests, nights: hasDates ? diffDays(ci, co) : 1 },
  }, pageMeta(pg, total));
}));

/** GET /api/rooms/:slug — chi tiết + tồn kho 30 ngày + preview chính sách huỷ */
router.get('/:slug', optionalAuth, asyncHandler(async (req, res) => {
  const t = db.prepare(`SELECT * FROM room_types WHERE slug = ? AND is_active = 1`).get(req.params.slug);
  if (!t) throw Errors.notFound('Không tìm thấy loại phòng');

  const from = todayISO();
  const to = addDays(from, 30);
  const inventory = getInventoryByDate(t.id, from, to);

  const rating = db.prepare(`SELECT AVG(rating) avg_rating, COUNT(*) cnt FROM reviews
                             WHERE room_type_id = ? AND is_approved = 1`).get(t.id);
  const reviews = db.prepare(`
    SELECT r.id, r.rating, r.title, r.content, r.created_at, u.full_name, r.owner_reply
    FROM reviews r JOIN users u ON u.id = r.user_id
    WHERE r.room_type_id = ? AND r.is_approved = 1
    ORDER BY r.created_at DESC LIMIT 8`).all(t.id);

  const sample = quoteLine({ roomTypeId: t.id, checkIn: from, checkOut: addDays(from, 1), qty: 1, guests: 0 });

  ok(res, {
    room_type: shapeRoomType(t, {
      rating: rating.avg_rating ? Number(rating.avg_rating.toFixed(2)) : null,
      review_count: rating.cnt,
      inventory_30d: inventory,
      sample_price_1_night: sample,
      cancellation_preview: cancellationPreview({
        checkIn: addDays(from, 3), subtotal: t.base_price, nights: 1,
        policy: { cancel_free_hours: t.cancel_free_hours, cancel_penalty_pct: t.cancel_penalty_pct, cancel_no_refund_hours: t.cancel_no_refund_hours },
      }),
    }),
    reviews: reviews.map((r) => ({ ...r, full_name: r.full_name.split(' ').slice(-1)[0] + '.' })),
  });
}));

/** GET /api/rooms/:id/availability?checkIn&checkOut */
router.get('/:id/availability', asyncHandler(async (req, res) => {
  const q = z.object({
    checkIn: z.string().refine(isValidDateString),
    checkOut: z.string().refine(isValidDateString),
  }).parse(req.query);
  if (q.checkOut <= q.checkIn) throw Errors.badRequest('checkOut phải sau checkIn');
  ok(res, { inventory: getInventoryByDate(req.params.id, q.checkIn, q.checkOut) });
}));

/** POST /api/rooms/quote — báo giá không cần đăng nhập (client gọi trước khi đặt) */
const quoteSchema = z.object({
  checkIn: z.string().refine(isValidDateString, 'Ngày không hợp lệ (YYYY-MM-DD)'),
  checkOut: z.string().refine(isValidDateString, 'Ngày không hợp lệ (YYYY-MM-DD)'),
  guests: z.number().int().min(1).max(30).default(2),
  lines: z.array(z.object({
    roomTypeId: z.string().min(1),
    qty: z.number().int().min(1).max(10).default(1),
    guests: z.number().int().min(0).max(30).optional(),
  })).min(1).max(5),
  couponCode: z.string().trim().max(32).optional(),
});

router.post('/quote', optionalAuth, validate(quoteSchema), asyncHandler(async (req, res) => {
  const { checkIn, checkOut, guests, lines, couponCode } = req.body;
  const quote = quoteBooking({
    lines,
    guests,
    checkIn,
    checkOut,
    couponCode,
    userId: req.user?.id,
  });

  // Gắn số phòng còn trống để UI disable nút đặt nếu hết (l.qty đã gộp các line cùng room_type_id)
  quote.availability = quote.lines.map((l) => ({
    room_type_id: l.room_type_id,
    available: countAvailable(l.room_type_id, checkIn, checkOut),
    requested: l.qty,
  }));
  quote.check_in = checkIn;
  quote.check_out = checkOut;
  quote.guests = guests;
  ok(res, { quote });
}));

/** GET /api/rooms/meta/price-calendar?month=YYYY-MM[&roomTypeId=] — ngày rẻ nhất trong tháng */
router.get('/meta/price-calendar', asyncHandler(async (req, res) => {
  const cal = monthPriceCalendar({
    month: String(req.query.month || todayISO().slice(0, 7)),
    roomTypeId: req.query.roomTypeId ? String(req.query.roomTypeId) : null,
  });
  ok(res, cal);
}));

/** GET /api/rooms/meta/amenities — dùng cho filter UI */
router.get('/meta/amenities', asyncHandler(async (_req, res) => {
  const all = db.prepare(`SELECT amenities FROM room_types WHERE is_active = 1`).all();
  const set = new Set();
  for (const a of all) for (const x of parseJson(a.amenities, [])) set.add(x);
  ok(res, { amenities: [...set].sort() });
}));

export default router;
