import { db } from '../db.js';
import { stayDates, isWeekend, dayOfWeek, todayISO } from '../utils/date.js';
import { config } from '../config/index.js';
import { Errors } from '../utils/errors.js';
import { memberInfoForUser } from './loyalty.service.js';

/**
 * ============================================================================
 *  PRICING ENGINE
 * ============================================================================
 *  Giá cuối = (base_price × seasonal_multiplier × weekend_surcharge) cho TỪNG ĐÊM
 *             + phụ thu khách vượt chuẩn
 *             - coupon
 *             + service fee + VAT
 *
 *  Hai nguyên tắc backend quan trọng:
 *   1) NEVER trust the client price. Client chỉ gửi roomTypeId/qty/dates.
 *      Server tự tính lại toàn bộ.
 *   2) PRICE SNAPSHOT: kết quả được lưu vào booking (price_breakdown JSON).
 *      Sau này đổi giá / đổi rule cũng KHÔNG ảnh hưởng booking cũ.
 * ============================================================================
 */

const round = (n) => Math.round(n / 1000) * 1000; // làm tròn nghìn VND

/** Tìm multiplier cao nhất đang áp dụng cho 1 ngày của 1 room type */
function findPriceRule(roomTypeId, date) {
  const dow = dayOfWeek(date);
  const rules = db.prepare(`
    SELECT * FROM price_rules
    WHERE room_type_id = ? AND ? BETWEEN start_date AND end_date
    ORDER BY priority DESC
  `).all(roomTypeId, date);

  for (const r of rules) {
    if (!r.days_of_week) return r;
    let dows;
    try { dows = JSON.parse(r.days_of_week); } catch { continue; }
    if (Array.isArray(dows) && dows.includes(dow)) return r;
  }
  return null;
}

/**
 * Tính giá chi tiết cho 1 line (1 room type × qty × kỳ ở)
 */
export function quoteLine({ roomTypeId, checkIn, checkOut, qty = 1, guests = 0 }) {
  const rt = db.prepare(`SELECT * FROM room_types WHERE id = ? AND is_active = 1`).get(roomTypeId);
  if (!rt) throw Errors.notFound('Loại phòng không tồn tại hoặc đã ngừng kinh doanh');

  const dates = stayDates(checkIn, checkOut);
  if (!dates.length) throw Errors.badRequest('Khoảng ngày không hợp lệ');
  if (qty < 1) throw Errors.badRequest('Số phòng phải >= 1');
  if (guests > rt.capacity * qty) {
    throw Errors.badRequest(`Loại phòng "${rt.name_vi}" tối đa ${rt.capacity * qty} khách cho ${qty} phòng`);
  }

  const perNight = dates.map((date) => {
    const rule = findPriceRule(roomTypeId, date);
    const multiplier = rule?.multiplier ?? 1;
    const weekend = isWeekend(date);
    const weekendPct = weekend ? config.app.weekendSurchargePct : 0;

    const base = rt.base_price * multiplier;
    const weekendFee = Math.round((base * weekendPct) / 100);
    const price = round(base + weekendFee);

    return {
      date,
      base_price: rt.base_price,
      rule_name: rule?.name ?? null,
      multiplier: Number(multiplier.toFixed(2)),
      weekend,
      weekend_surcharge: weekendFee,
      unit_price: price,
      line_total: price * qty,
    };
  });

  const subtotal = perNight.reduce((s, n) => s + n.line_total, 0);

  // Phụ thu khách vượt chuẩn: 200k/khách/đêm sau capacity mặc định (2 khách/phòng)
  const standardCapacity = 2 * qty;
  const extraGuests = Math.max(0, guests - standardCapacity);
  const extraGuestFee = extraGuests * 200_000 * dates.length;

  return {
    room_type_id: roomTypeId,
    room_type_name: rt.name_vi,
    slug: rt.slug,
    qty,
    nights: dates.length,
    guests,
    per_night: perNight,
    subtotal,
    extra_guests: extraGuests,
    extra_guest_fee: extraGuestFee,
    total: subtotal + extraGuestFee,
    currency: 'VND',
    policy: {
      cancel_free_hours: rt.cancel_free_hours,
      cancel_penalty_pct: rt.cancel_penalty_pct,
      cancel_no_refund_hours: rt.cancel_no_refund_hours,
    },
  };
}

/**
 * Tính giá toàn bộ booking (nhiều line) + coupon + thuế phí.
 * Trả về object có thể lưu thẳng vào price_breakdown.
 */
export function quoteBooking({ lines, couponCode = null, userId = null }) {
  if (!Array.isArray(lines) || !lines.length) throw Errors.badRequest('Phải có ít nhất 1 loại phòng');
  if (lines.length > config.booking.maxRoomsPerBooking) {
    throw Errors.badRequest(`Tối đa ${config.booking.maxRoomsPerBooking} loại phòng / lần đặt`);
  }

  const quoted = lines.map((l) => quoteLine(l));
  const subtotal = quoted.reduce((s, l) => s + l.total, 0);

  let discount = 0;
  let coupon = null;
  if (couponCode) {
    coupon = validateCoupon(couponCode, subtotal, userId);
    discount = coupon.discount;
  }

  // Ưu đãi hạng thành viên: tính SAU coupon, trên tiền phòng; server tự tra hạng
  // từ lifetime_spend — client không gửi và không sửa được con số này.
  const member = memberInfoForUser(userId);
  const afterCoupon = subtotal - discount;
  const memberDiscount = member.pct ? round((afterCoupon * member.pct) / 100) : 0;

  const afterDiscount = afterCoupon - memberDiscount;
  const serviceFee = round((afterDiscount * config.app.serviceFeePct) / 100);
  const tax = round(((afterDiscount + serviceFee) * config.app.taxPct) / 100);
  const total = afterDiscount + serviceFee + tax;

  return {
    currency: 'VND',
    lines: quoted,
    subtotal,
    discount,
    coupon: coupon ? { code: coupon.code, id: coupon.id, label: coupon.label } : null,
    member_discount: memberDiscount,
    member_tier: memberDiscount ? member.tier : null,
    member_tier_name: memberDiscount ? member.name_vi : null,
    member_pct: member.pct,
    service_fee: serviceFee,
    service_fee_pct: config.app.serviceFeePct,
    tax,
    tax_pct: config.app.taxPct,
    total_amount: total,
    nights: quoted[0]?.nights ?? 0,
  };
}

/**
 * LỊCH GIÁ THÁNG — gợi ý "ngày rẻ nhất" cho khách.
 * Với mỗi ngày trong tháng, tìm đơn giá/đêm THẤP NHẤT trong các room type
 * đang kinh doanh (đã gồm hệ số mùa + phụ thu cuối tuần).
 * Tối ưu: load price_rules 1 lần cho cả tháng thay vì query theo từng ngày.
 */
export function monthPriceCalendar({ month, roomTypeId = null }) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month || ''))) {
    throw Errors.badRequest('month phải có dạng YYYY-MM');
  }
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const start = `${month}-01`;
  const end = `${month}-${String(daysInMonth).padStart(2, '0')}`;

  const types = roomTypeId
    ? db.prepare(`SELECT * FROM room_types WHERE is_active = 1 AND id = ?`).all(roomTypeId)
    : db.prepare(`SELECT * FROM room_types WHERE is_active = 1`).all();
  if (!types.length) throw Errors.notFound('Không có loại phòng đang kinh doanh');

  const rules = db.prepare(`
    SELECT * FROM price_rules WHERE start_date <= ? AND end_date >= ? ORDER BY priority DESC
  `).all(end, start);

  const matchRule = (rtId, date) => {
    const dow = dayOfWeek(date);
    for (const r of rules) {
      if (r.room_type_id !== rtId) continue;
      if (date < r.start_date || date > r.end_date) continue;
      if (!r.days_of_week) return r;
      let dows; try { dows = JSON.parse(r.days_of_week); } catch { continue; }
      if (Array.isArray(dows) && dows.includes(dow)) return r;
    }
    return null;
  };

  const days = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${month}-${String(d).padStart(2, '0')}`;
    let best = null;
    for (const rt of types) {
      const rule = matchRule(rt.id, date);
      const base = rt.base_price * (rule?.multiplier ?? 1);
      const weekend = isWeekend(date);
      const price = round(base + (weekend ? Math.round((base * config.app.weekendSurchargePct) / 100) : 0));
      if (!best || price < best.min_price) {
        best = { min_price: price, room_type_id: rt.id, room_type_name: rt.name_vi, rule_name: rule?.name ?? null };
      }
    }
    days.push({ date, day: d, weekend: isWeekend(date), past: date < todayISO(), ...best });
  }

  const cheapest = days.filter((x) => !x.past)
    .slice().sort((a, b) => a.min_price - b.min_price || a.date.localeCompare(b.date)).slice(0, 5);
  return { month, days, cheapest };
}

/** Validate coupon + tính số tiền giảm (không ghi DB ở đây) */
export function validateCoupon(code, subtotal, userId = null) {
  const c = db.prepare(`SELECT * FROM coupons WHERE code = ? COLLATE NOCASE`).get(String(code).trim());
  if (!c || !c.is_active) throw Errors.badRequest('Mã giảm giá không tồn tại');

  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
  if (c.starts_at > now) throw Errors.badRequest('Mã giảm giá chưa đến thời gian sử dụng');
  if (c.ends_at < now) throw Errors.badRequest('Mã giảm giá đã hết hạn');
  if (c.usage_limit !== null && c.used_count >= c.usage_limit) throw Errors.badRequest('Mã giảm giá đã hết lượt');
  if (subtotal < c.min_amount) {
    throw Errors.badRequest(`Đơn tối thiểu ${c.min_amount.toLocaleString('vi-VN')}₫ để dùng mã này`);
  }
  if (userId && c.per_user_limit > 0) {
    const used = db.prepare(`SELECT COUNT(*) n FROM coupon_usages WHERE coupon_id = ? AND user_id = ?`)
      .get(c.id, userId)?.n || 0;
    if (used >= c.per_user_limit) throw Errors.badRequest('Bạn đã dùng hết lượt cho mã này');
  }

  let discount = c.type === 'PERCENT'
    ? Math.round((subtotal * c.value) / 100)
    : c.value;
  if (c.type === 'PERCENT' && c.max_discount) discount = Math.min(discount, c.max_discount);
  discount = Math.min(discount, subtotal); // không bao giờ giảm quá tiền phòng

  return { ...c, discount, label: c.type === 'PERCENT' ? `Giảm ${c.value}%` : `Giảm ${c.value.toLocaleString('vi-VN')}₫` };
}

/** Ước lượng giá nhanh cho UI (không cần chi tiết từng đêm) */
export function quickPrice(roomTypeId, nights = 1) {
  const rt = db.prepare(`SELECT base_price FROM room_types WHERE id = ?`).get(roomTypeId);
  return rt ? rt.base_price * nights : 0;
}
