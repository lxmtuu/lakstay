import { diffDays } from '../utils/date.js';

/**
 * ============================================================================
 *  CANCELLATION POLICY — tính tiền phạt / tiền hoàn
 * ============================================================================
 *  Mỗi room type có 3 mốc (giờ so với 14:00 ngày nhận phòng):
 *    > cancel_free_hours      → hoàn 100%
 *    > cancel_no_refund_hours → phạt cancel_penalty_pct% đêm đầu tiên
 *    <= cancel_no_refund_hours→ mất 100%
 *
 *  Nguyên tắc backend: TIỀN PHẢI TÍNH ĐƯỢC & GIẢI THÍCH ĐƯỢC.
 *  Vì vậy hàm trả về cả `breakdown` để lưu audit + hiển thị cho khách.
 * ============================================================================
 */

const CHECKIN_HOUR = 14; // giờ nhận phòng chuẩn

/** Số giờ từ BÂY GIỜ đến 14:00 ngày check_in */
export function hoursUntilCheckIn(checkIn, now = new Date()) {
  const target = new Date(`${checkIn}T${String(CHECKIN_HOUR).padStart(2, '0')}:00:00+07:00`);
  return (target.getTime() - now.getTime()) / 3_600_000;
}

/**
 * @param {object} booking  booking row + first_night_price
 * @param {object} opts     { now, isNoShow }
 */
export function computeRefund(booking, { now = new Date(), isNoShow = false } = {}) {
  const paid = booking.paid_amount || 0;

  if (paid <= 0) {
    return {
      eligible: false, refund_amount: 0, penalty: 0, tier: 'UNPAID',
      message: 'Chưa thanh toán nên không phát sinh hoàn tiền.',
      breakdown: [],
    };
  }

  if (isNoShow) {
    return {
      eligible: false, refund_amount: 0, penalty: paid, tier: 'NO_SHOW',
      message: 'Khách không nhận phòng: không hoàn tiền.',
      breakdown: [{ label: 'No-show', amount: -paid }],
    };
  }

  const policy = booking.policy || {};
  const freeHours = policy.cancel_free_hours ?? 48;
  const noRefundHours = policy.cancel_no_refund_hours ?? 24;
  const penaltyPct = policy.cancel_penalty_pct ?? 50;

  const hoursLeft = hoursUntilCheckIn(booking.check_in, now);
  const nights = booking.nights || 1;
  const firstNight = Math.round((booking.subtotal || paid) / nights);

  let tier, penalty, message;
  const breakdown = [];

  if (hoursLeft >= freeHours) {
    tier = 'FREE';
    penalty = 0;
    message = `Huỷ trước ${freeHours} giờ: hoàn 100%.`;
    breakdown.push({ label: 'Hoàn 100% (huỷ trong thời gian miễn phí)', amount: paid });
  } else if (hoursLeft > noRefundHours) {
    tier = 'PARTIAL';
    // phạt = (giá đêm đầu × %phạt) / 100, làm tròn xuống nghìn VND
    const rawPenalty = (firstNight * penaltyPct) / 100;
    penalty = Math.min(paid, Math.round(rawPenalty / 1000) * 1000);
    message = `Huỷ trong vòng ${freeHours}h: phạt ${penaltyPct}% giá đêm đầu (${penalty.toLocaleString('vi-VN')}₫).`;
    breakdown.push({ label: `Phạt ${penaltyPct}% đêm đầu`, amount: -penalty });
    breakdown.push({ label: 'Hoàn phần còn lại', amount: paid - penalty });
  } else {
    tier = 'NONE';
    penalty = paid;
    message = `Đã quá sát ngày nhận phòng (còn ${Math.max(0, Math.round(hoursLeft))}h): không hoàn tiền.`;
    breakdown.push({ label: 'Không hoàn tiền (quá hạn huỷ)', amount: -paid });
  }

  const refund = Math.max(0, paid - penalty);

  return {
    eligible: refund > 0,
    refund_amount: refund,
    penalty,
    tier,
    hours_until_checkin: Number(hoursLeft.toFixed(2)),
    message,
    breakdown,
    policy_applied: { free_hours: freeHours, no_refund_hours: noRefundHours, penalty_pct: penaltyPct },
  };
}

/**
 * Preview chính sách huỷ TRƯỚC khi khách bấm đặt — minh bạch, tránh khiếu nại.
 */
export function cancellationPreview({ checkIn, subtotal, nights = 1, policy }) {
  const firstNight = Math.round(subtotal / Math.max(1, nights));
  const now = new Date();
  const make = (hoursAhead) => computeRefund(
    { check_in: checkIn, subtotal, nights, paid_amount: subtotal, policy },
    { now: new Date(now.getTime() + hoursAhead * 3_600_000) }
  );
  return {
    free_until_hours: policy.cancel_free_hours,
    no_refund_after_hours: policy.cancel_no_refund_hours,
    penalty_pct: policy.cancel_penalty_pct,
    first_night_price: firstNight,
    tiers: [
      { label: `Huỷ trước ${policy.cancel_free_hours} giờ`, refund_pct: 100, example: make(policy.cancel_free_hours + 1) },
      { label: `Huỷ trong ${policy.cancel_no_refund_hours + 1}–${policy.cancel_free_hours} giờ`, refund_pct: null, example: make(policy.cancel_no_refund_hours + 1) },
      { label: `Huỷ trong ${policy.cancel_no_refund_hours} giờ cuối`, refund_pct: 0, example: make(1) },
    ],
  };
}

/** Số đêm đã dùng (để tính tiền khi trả phòng sớm) */
export const usedNights = (checkIn, checkOut, actualOut) =>
  Math.max(1, diffDays(checkIn, actualOut || checkOut));
