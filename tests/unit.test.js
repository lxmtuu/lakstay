/**
 * Unit test cho các hàm nghiệp vụ thuần (không cần server).
 * Chạy: npm test
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isValidDateString, stayDates, diffDays, rangesOverlap, addDays, isWeekend,
} from '../src/utils/date.js';
import { buildVietQRPayload, verifyVietQRPayload, parseVietQRPayload, crc16, normalizeTransferContent } from '../src/services/vietqr.service.js';
import { canTransition, nextStates, STATUS } from '../src/services/booking-state.js';
import { computeRefund, hoursUntilCheckIn } from '../src/services/cancellation.service.js';
import { pointsForAmount, tierForSpend } from '../src/services/loyalty.service.js';

/* ---------------------------- DATE ---------------------------- */
test('date: chặn ngày không tồn tại', () => {
  assert.equal(isValidDateString('2026-02-30'), false);
  assert.equal(isValidDateString('2026-13-01'), false);
  assert.equal(isValidDateString('2026-12-31'), true);
  assert.equal(isValidDateString('31/12/2026'), false);
});

test('date: số đêm và danh sách đêm [checkIn, checkOut)', () => {
  assert.equal(diffDays('2026-10-01', '2026-10-04'), 3);
  assert.deepEqual(stayDates('2026-10-01', '2026-10-04'), ['2026-10-01', '2026-10-02', '2026-10-03']);
});

test('date: overlap hai khoảng nửa mở', () => {
  assert.equal(rangesOverlap('2026-10-01', '2026-10-03', '2026-10-03', '2026-10-05'), false); // chạm nhau nhưng không giao
  assert.equal(rangesOverlap('2026-10-01', '2026-10-04', '2026-10-03', '2026-10-05'), true);
  assert.equal(rangesOverlap('2026-10-01', '2026-10-10', '2026-10-02', '2026-10-03'), true); // chứa nhau
});

test('date: cuối tuần gồm T6/T7/CN', () => {
  assert.equal(isWeekend('2026-09-18'), true);  // Thứ 6
  assert.equal(isWeekend('2026-09-19'), true);  // Thứ 7
  assert.equal(isWeekend('2026-09-20'), true);  // CN
  assert.equal(isWeekend('2026-09-21'), false); // T2
});

/* ---------------------------- VIETQR ---------------------------- */
test('vietqr: CRC16 khớp giá trị biết trước', () => {
  // Chuỗi mẫu phổ biến trong tài liệu EMVCo
  assert.equal(crc16('123456789'), '29B1');
});

test('vietqr: payload hợp lệ tự kiểm tra được CRC', () => {
  const p = buildVietQRPayload({ amount: 3728000, content: 'LAKSTAY TEST123' });
  assert.match(p, /^000201/);
  assert.match(p, /6304[0-9A-F]{4}$/);
  assert.equal(verifyVietQRPayload(p), true);
  // sai 1 ký tự => CRC fail
  assert.equal(verifyVietQRPayload(p.slice(0, -1) + (p.slice(-1) === 'A' ? 'B' : 'A')), false);
});

test('vietqr: parse ra đúng số tiền / ngân hàng / nội dung', () => {
  const p = buildVietQRPayload({ amount: 1500000, content: 'LAKSTAY ABC123' });
  const parsed = parseVietQRPayload(p);
  assert.equal(parsed.valid, true);
  assert.equal(parsed.amount, 1500000);
  assert.equal(parsed.currency, '704');
  assert.equal(parsed.country, 'VN');
  assert.equal(parsed.content, 'LAKSTAY ABC123');
});

test('vietqr: nội dung CK bị chuẩn hoá bỏ dấu/ký tự lạ', () => {
  assert.equal(normalizeTransferContent('Lakstay Đà-Lạt #2026!'), 'LAKSTAY DA LAT 2026');
});

/* ---------------------------- STATE MACHINE ---------------------------- */
test('state: PENDING -> CONFIRMED cho customer; PENDING -> CHECKED_IN thì không', () => {
  assert.equal(canTransition(STATUS.PENDING, STATUS.CONFIRMED, 'customer').allowed, true);
  assert.equal(canTransition(STATUS.PENDING, STATUS.CHECKED_IN, 'staff').allowed, false);
});

test('state: customer không được check-in; staff được', () => {
  assert.equal(canTransition(STATUS.CONFIRMED, STATUS.CHECKED_IN, 'customer').allowed, false);
  assert.equal(canTransition(STATUS.CONFIRMED, STATUS.CHECKED_IN, 'staff').allowed, true);
});

test('state: trạng thái cuối không đi tiếp được', () => {
  assert.equal(canTransition(STATUS.COMPLETED, STATUS.PENDING, 'admin').allowed, false);
  assert.equal(canTransition(STATUS.EXPIRED, STATUS.CONFIRMED, 'admin').allowed, false);
  assert.deepEqual(nextStates(STATUS.REFUNDED, 'admin'), []);
});

/* ---------------------------- CANCELLATION ---------------------------- */
const policy = { cancel_free_hours: 48, cancel_penalty_pct: 50, cancel_no_refund_hours: 24 };

test('cancel: huỷ sớm hoàn 100%', () => {
  const now = new Date('2026-10-01T00:00:00Z');
  const r = computeRefund({ check_in: '2026-10-10', nights: 2, subtotal: 4_000_000, paid_amount: 4_000_000, policy }, { now });
  assert.equal(r.tier, 'FREE');
  assert.equal(r.refund_amount, 4_000_000);
  assert.equal(r.penalty, 0);
});

test('cancel: huỷ giữa chừng phạt 50% đêm đầu', () => {
  // check_in 2026-10-10 14:00 (+07). now cách đó 30 giờ => tầng PARTIAL
  const now = new Date(new Date('2026-10-10T14:00:00+07:00').getTime() - 30 * 3_600_000);
  const r = computeRefund({ check_in: '2026-10-10', nights: 2, subtotal: 4_000_000, paid_amount: 4_000_000, policy }, { now });
  assert.equal(r.tier, 'PARTIAL');
  assert.equal(r.penalty, 1_000_000);           // 50% của đêm đầu 2tr
  assert.equal(r.refund_amount, 3_000_000);
});

test('cancel: sát ngày mất hết', () => {
  const now = new Date(new Date('2026-10-10T14:00:00+07:00').getTime() - 5 * 3_600_000);
  const r = computeRefund({ check_in: '2026-10-10', nights: 2, subtotal: 4_000_000, paid_amount: 4_000_000, policy }, { now });
  assert.equal(r.tier, 'NONE');
  assert.equal(r.refund_amount, 0);
});

test('cancel: chưa trả tiền thì không hoàn', () => {
  const r = computeRefund({ check_in: '2026-10-10', nights: 2, subtotal: 4_000_000, paid_amount: 0, policy });
  assert.equal(r.eligible, false);
  assert.equal(r.refund_amount, 0);
});

test('cancel: no-show mất toàn bộ', () => {
  const r = computeRefund({ check_in: '2026-10-10', nights: 2, subtotal: 4_000_000, paid_amount: 4_000_000, policy }, { isNoShow: true });
  assert.equal(r.tier, 'NO_SHOW');
  assert.equal(r.refund_amount, 0);
});

test('cancel: giờ tới check-in luôn dương khi còn xa', () => {
  const h = hoursUntilCheckIn(addDays(new Date().toISOString().slice(0, 10), 3));
  assert.ok(h > 48);
});

/* ---------------------------- LOYALTY ---------------------------- */
test('loyalty: điểm = 1đ/10.000₫, làm tròn xuống, không âm', () => {
  assert.equal(pointsForAmount(3_812_000), 381);
  assert.equal(pointsForAmount(9_999), 0);
  assert.equal(pointsForAmount(10_000), 1);
  assert.equal(pointsForAmount(-50_000), 0);
});

test('loyalty: hạng theo chi tiêu tích luỹ (ngưỡng 0/10tr/30tr/80tr)', () => {
  assert.equal(tierForSpend(0).key, 'MEMBER');
  assert.equal(tierForSpend(9_999_999).key, 'MEMBER');
  assert.equal(tierForSpend(10_000_000).key, 'SILVER');
  assert.equal(tierForSpend(29_999_999).key, 'SILVER');
  assert.equal(tierForSpend(30_000_000).key, 'GOLD');
  assert.equal(tierForSpend(80_000_000).key, 'PLATINUM');
  assert.equal(tierForSpend(1e12).key, 'PLATINUM');
  assert.equal(tierForSpend(30_000_000).discount_pct, 5);
});
