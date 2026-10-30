import { Errors, BizCode } from '../utils/errors.js';

/**
 * ============================================================================
 *  BOOKING STATE MACHINE
 * ============================================================================
 *  Vì sao cần state machine tường minh?
 *   - Nếu chỉ viết `booking.status = req.body.status`, hệ thống sẽ rơi vào
 *     trạng thái vô nghĩa: CANCELLED -> PAID, COMPLETED -> CHECKED_IN...
 *   - Định nghĩa rõ "chuyển trạng thái nào HỢP LỆ" + "AI được chuyển"
 *     + "side-effect gì chạy kèm" => nghiệp vụ không thể bị phá.
 *
 *      PENDING ──(pay)──► CONFIRMED ──(checkin)──► CHECKED_IN ──(checkout)──► COMPLETED
 *         │                   │                        │                        │
 *         ├─(expire)─► EXPIRED│                        │                        └─(review)
 *         └─(cancel)─► CANCELLED ◄──────────────────────┘
 *                          │
 *                          └─(refund)─► REFUNDED
 *      PENDING/CONFIRMED ─(no show)─► NO_SHOW
 * ============================================================================
 */

export const STATUS = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  CHECKED_IN: 'CHECKED_IN',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
  EXPIRED: 'EXPIRED',
  REFUNDED: 'REFUNDED',
};

/**
 * transitions[from] = { to: { by: [...roles], requires?, note } }
 */
export const TRANSITIONS = {
  PENDING: {
    CONFIRMED: { by: ['customer', 'staff', 'admin'], trigger: 'PAYMENT_SUCCESS', note: 'Thanh toán thành công' },
    CANCELLED: { by: ['customer', 'staff', 'admin'], trigger: 'USER_CANCEL', note: 'Khách huỷ khi chưa thanh toán' },
    EXPIRED:   { by: ['system'], trigger: 'HOLD_TIMEOUT', note: 'Quá thời gian giữ chỗ' },
  },
  CONFIRMED: {
    CHECKED_IN: { by: ['staff', 'admin'], trigger: 'CHECK_IN', note: 'Khách nhận phòng' },
    CANCELLED:  { by: ['customer', 'staff', 'admin'], trigger: 'USER_CANCEL', note: 'Khách huỷ sau khi đã thanh toán' },
    NO_SHOW:    { by: ['staff', 'admin', 'system'], trigger: 'NO_SHOW', note: 'Khách không đến' },
    COMPLETED:  { by: ['staff', 'admin', 'system'], trigger: 'AUTO_COMPLETE', note: 'Hoàn tất' },
  },
  CHECKED_IN: {
    COMPLETED: { by: ['staff', 'admin', 'system'], trigger: 'CHECK_OUT', note: 'Khách trả phòng' },
    NO_SHOW:   { by: [], trigger: null }, // không hợp lệ
  },
  COMPLETED: {
    REFUNDED: { by: ['admin'], trigger: 'REFUND', note: 'Hoàn tiền ngoại lệ' },
  },
  CANCELLED: {
    REFUNDED: { by: ['admin', 'system'], trigger: 'REFUND', note: 'Hoàn tiền theo chính sách' },
  },
  NO_SHOW: {
    REFUNDED: { by: ['admin'], trigger: 'REFUND', note: 'Hoàn tiền ngoại lệ' },
  },
  EXPIRED: {},
  REFUNDED: {},
};

export const TERMINAL = ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED', 'REFUNDED'];

export function canTransition(from, to, role = 'customer') {
  const t = TRANSITIONS[from]?.[to];
  if (!t || !t.trigger) return { allowed: false, reason: `Không thể chuyển ${from} → ${to}` };
  if (!t.by.includes(role)) {
    return { allowed: false, reason: `Vai trò "${role}" không được chuyển ${from} → ${to}` };
  }
  return { allowed: true, trigger: t.trigger, note: t.note };
}

export function assertTransition(from, to, role) {
  const r = canTransition(from, to, role);
  if (!r.allowed) {
    throw Errors.conflict(r.reason, { code: BizCode.INVALID_TRANSITION, from, to, role });
  }
  return r;
}

/** Danh sách trạng thái kế tiếp hợp lệ — dùng để UI render đúng nút */
export function nextStates(from, role) {
  const map = TRANSITIONS[from] || {};
  return Object.entries(map)
    .filter(([, v]) => v.trigger && v.by.includes(role))
    .map(([to, v]) => ({ to, trigger: v.trigger, note: v.note }));
}

/** Trạng thái hiển thị cho người dùng (tiếng Việt + màu) */
export const STATUS_META = {
  PENDING:   { vi: 'Chờ thanh toán', tone: 'warning', icon: 'clock' },
  CONFIRMED: { vi: 'Đã xác nhận',    tone: 'success', icon: 'check' },
  CHECKED_IN:{ vi: 'Đang lưu trú',   tone: 'info',    icon: 'key' },
  COMPLETED: { vi: 'Hoàn tất',       tone: 'muted',   icon: 'flag' },
  CANCELLED: { vi: 'Đã huỷ',         tone: 'danger',  icon: 'x' },
  NO_SHOW:   { vi: 'Không nhận phòng', tone: 'danger', icon: 'alert' },
  EXPIRED:   { vi: 'Hết hạn giữ chỗ', tone: 'muted',  icon: 'clock' },
  REFUNDED:  { vi: 'Đã hoàn tiền',   tone: 'success', icon: 'refund' },
};
