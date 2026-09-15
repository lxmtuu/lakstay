import { db } from '../db.js';
import { newId } from '../utils/id.js';
import { Errors } from '../utils/errors.js';

/**
 * ============================================================================
 *  LOYALTY — CHƯƠNG TRÌNH THÀNH VIÊN
 * ============================================================================
 *  Nguyên tắc nghiệp vụ:
 *   - Điểm tích luỹ: 1 điểm / 10.000₫ thực trả, cộng KHI THANH TOÁN PAID
 *     (không cộng lúc giữ chỗ — khách có thể không trả tiền).
 *   - Hạng thẻ xét theo `lifetime_spend` (tổng chi tiêu lịch sử, đã trừ refund):
 *       MEMBER 0% → SILVER 2% (≥10tr) → GOLD 5% (≥30tr) → PLATINUM 8% (≥80tr)
 *   - Ưu đãi hạng áp dụng SAU coupon, trên tiền phòng; phí phục vụ & VAT tính
 *     trên phần còn lại → mọi con số đều tái tính được từ price snapshot.
 *   - IDEMPOTENT: mỗi booking chỉ EARN 1 lần / REVOKE 1 lần (unique index
 *     (booking_id, type)) — webhook gọi lại không nhân đôi điểm.
 *   - Huỷ đơn đã trả: thu hồi điểm của đơn (không âm số dư), trừ lifetime_spend
 *     theo số tiền hoàn → hạng có thể rớt nếu refund nhiều.
 * ============================================================================
 */

export const POINT_PER_VND_DIVISOR = 10_000; // 1 điểm / 10.000₫

export const TIERS = [
  { key: 'MEMBER',   name_vi: 'Thành viên', min_spend: 0,         discount_pct: 0,
    perks: ['Tích điểm 1đ/10.000₫', 'Ưu đãi sinh nhật (coupon riêng)'] },
  { key: 'SILVER',   name_vi: 'Bạc',        min_spend: 10_000_000, discount_pct: 2,
    perks: ['Giảm 2% tiền phòng', 'Nhận phòng sớm (tuỳ tình trạng)'] },
  { key: 'GOLD',     name_vi: 'Vàng',       min_spend: 30_000_000, discount_pct: 5,
    perks: ['Giảm 5% tiền phòng', 'Nhận phòng sớm + trả phòng trễ 12h', 'Quà chào mừng tại phòng'] },
  { key: 'PLATINUM', name_vi: 'Bạch kim',   min_spend: 80_000_000, discount_pct: 8,
    perks: ['Giảm 8% tiền phòng', 'Ưu tiên nâng hạng phòng', 'Trả phòng trễ 14h', 'Hotline riêng 24/7'] },
];

export const pointsForAmount = (amount) => Math.max(0, Math.floor(Number(amount || 0) / POINT_PER_VND_DIVISOR));

export const tierForSpend = (spend) => {
  const s = Number(spend || 0);
  let best = TIERS[0];
  for (const t of TIERS) if (s >= t.min_spend) best = t;
  return best;
};

/** Lấy (hoặc tạo lười) tài khoản thành viên */
export function getAccount(userId, tx = db) {
  tx.prepare(`INSERT OR IGNORE INTO loyalty_accounts (user_id) VALUES (?)`).run(userId);
  return tx.prepare(`SELECT * FROM loyalty_accounts WHERE user_id = ?`).get(userId);
}

function recomputeTier(tx, userId) {
  const acc = tx.prepare(`SELECT * FROM loyalty_accounts WHERE user_id = ?`).get(userId);
  const tier = tierForSpend(acc.lifetime_spend).key;
  if (tier !== acc.tier) {
    tx.prepare(`UPDATE loyalty_accounts SET tier = ?, updated_at = datetime('now') WHERE user_id = ?`).run(tier, userId);
  }
  return tier;
}

/**
 * Cộng điểm khi booking được thanh toán PAID.
 * Gọi TRONG transaction của payment → atomic với việc chuyển CONFIRMED.
 * Idempotent: unique index (booking_id, type='EARN').
 */
export function earnForBooking({ userId, bookingId, amount, note = '' }, tx = db) {
  if (!userId) return null;
  const dup = tx.prepare(`SELECT id FROM loyalty_transactions WHERE booking_id = ? AND type = 'EARN'`).get(bookingId);
  if (dup) return null; // đã cộng rồi — webhook lặp lại
  const pts = pointsForAmount(amount);
  const acc = getAccount(userId, tx);
  const balance = acc.points + pts;
  tx.prepare(`UPDATE loyalty_accounts SET points = ?, lifetime_spend = ?, updated_at = datetime('now')
              WHERE user_id = ?`).run(balance, acc.lifetime_spend + Math.max(0, Number(amount || 0)), userId);
  tx.prepare(`INSERT INTO loyalty_transactions (id, user_id, booking_id, type, points, balance_after, note)
              VALUES (?,?,?,?,?,?,?)`)
    .run(newId('loy'), userId, bookingId, 'EARN', pts, balance, note || 'Tích điểm đơn thanh toán');
  const tier = recomputeTier(tx, userId);
  return { points: pts, balance, tier };
}

/**
 * Thu hồi điểm khi huỷ đơn đã trả tiền (refund).
 * - Trừ đúng số điểm đơn này từng EARN (không làm âm số dư hiện tại).
 * - Trừ lifetime_spend theo số tiền hoàn → có thể rớt hạng.
 * Idempotent: unique index (booking_id, type='REVOKE').
 */
export function revokeForBooking({ userId, bookingId, refundAmount = 0 }, tx = db) {
  if (!userId) return null;
  const earn = tx.prepare(`SELECT points FROM loyalty_transactions WHERE booking_id = ? AND type = 'EARN'`).get(bookingId);
  if (!earn) return null; // đơn chưa từng được cộng điểm (huỷ trước khi trả) → không làm gì
  const dup = tx.prepare(`SELECT id FROM loyalty_transactions WHERE booking_id = ? AND type = 'REVOKE'`).get(bookingId);
  if (dup) return null;
  const acc = getAccount(userId, tx);
  const deduct = Math.min(acc.points, earn.points);
  const spendDeduct = Math.min(acc.lifetime_spend, Math.max(0, Number(refundAmount || 0)));
  const balance = acc.points - deduct;
  tx.prepare(`UPDATE loyalty_accounts SET points = ?, lifetime_spend = ?, updated_at = datetime('now')
              WHERE user_id = ?`).run(balance, acc.lifetime_spend - spendDeduct, userId);
  tx.prepare(`INSERT INTO loyalty_transactions (id, user_id, booking_id, type, points, balance_after, note)
              VALUES (?,?,?,?,?,?,?)`)
    .run(newId('loy'), userId, bookingId, 'REVOKE', -deduct, balance, 'Huỷ đơn — thu hồi điểm tích luỹ');
  const tier = recomputeTier(tx, userId);
  return { points: -deduct, balance, tier };
}

/** Admin điều chỉnh tay (thưởng khuyến mãi / sửa sai). points có thể âm. */
export function adjustPoints({ userId, points, lifetimeSpendDelta = 0, note = '', actorId = null }, tx = db) {
  const p = Number(points || 0);
  const sd = Number(lifetimeSpendDelta || 0);
  if (!p && !sd) throw Errors.badRequest('points hoặc lifetimeSpendDelta phải khác 0');
  const acc = getAccount(userId, tx);
  const balance = Math.max(0, acc.points + p);
  const spend = Math.max(0, acc.lifetime_spend + sd);
  tx.prepare(`UPDATE loyalty_accounts SET points = ?, lifetime_spend = ?, updated_at = datetime('now')
              WHERE user_id = ?`).run(balance, spend, userId);
  tx.prepare(`INSERT INTO loyalty_transactions (id, user_id, booking_id, type, points, balance_after, note)
              VALUES (?,?,?,?,?,?,?)`)
    .run(newId('loy'), userId, null, 'ADJUST', balance - acc.points, balance,
         note || `Điều chỉnh bởi ${actorId || 'admin'}`);
  const tier = recomputeTier(tx, userId);
  return { balance, lifetime_spend: spend, tier };
}

/** Thông tin ưu đãi hạng của user — pricing engine dùng để giảm giá */
export function memberInfoForUser(userId) {
  if (!userId) return { tier: null, name_vi: null, pct: 0 };
  const acc = db.prepare(`SELECT lifetime_spend FROM loyalty_accounts WHERE user_id = ?`).get(userId);
  if (!acc) return { tier: null, name_vi: null, pct: 0 };
  const t = tierForSpend(acc.lifetime_spend);
  return { tier: t.key, name_vi: t.name_vi, pct: t.discount_pct };
}

/** Tổng hợp cho trang "Thành viên" của khách */
export function getSummary(userId) {
  const acc = getAccount(userId);
  const tier = tierForSpend(acc.lifetime_spend);
  const idx = TIERS.findIndex((t) => t.key === tier.key);
  const next = TIERS[idx + 1] || null;
  const transactions = db.prepare(`
    SELECT lt.id, lt.type, lt.points, lt.balance_after, lt.note, lt.created_at, b.code AS booking_code
    FROM loyalty_transactions lt LEFT JOIN bookings b ON b.id = lt.booking_id
    WHERE lt.user_id = ? ORDER BY lt.created_at DESC LIMIT 20`).all(userId);
  return {
    tier: { ...tier, index: idx },
    points: acc.points,
    lifetime_spend: acc.lifetime_spend,
    next_tier: next ? { ...next, spend_needed: Math.max(0, next.min_spend - acc.lifetime_spend) } : null,
    progress_pct: next ? Math.min(100, Math.round((acc.lifetime_spend / next.min_spend) * 100)) : 100,
    point_rule: `1 điểm / ${POINT_PER_VND_DIVISOR.toLocaleString('vi-VN')}₫ thực trả`,
    all_tiers: TIERS,
    transactions,
  };
}
