#!/usr/bin/env node
/**
 * SMOKE TEST end-to-end bằng fetch thật (cần server đang chạy ở :3000).
 *   npm run smoke
 */
const BASE = process.env.BASE_URL || 'http://localhost:3000';
let pass = 0, fail = 0;
const log = [];

function check(name, cond, extra = '') {
  if (cond) { pass++; log.push(`  ✓ ${name}`); }
  else { fail++; log.push(`  ✗ ${name} ${extra}`); }
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

// cookie jar đơn giản
function jar() {
  const jar = new Map();
  return {
    header() { return [...jar].map(([k, v]) => `${k}=${v}`).join('; '); },
    absorb(res) {
      const raw = res.headers.getSetCookie?.() || [];
      for (const c of raw) {
        const [kv] = c.split(';');
        const i = kv.indexOf('=');
        jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim());
      }
    },
    get: (k) => jar.get(k),
  };
}

async function api(j, method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: j.header(), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  j.absorb(res);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
  return { status: res.status, body: json };
}

const PWD = 'Lakstay@2026';

/** EventSource tối giản cho Node (đọc stream SSE bằng fetch) */
function EventSourceShim(url, cookie, onEvent) {
  const ac = new AbortController();
  (async () => {
    try {
      const res = await fetch(url, { headers: { Cookie: cookie, Accept: 'text/event-stream' }, signal: ac.signal });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const dataLine = chunk.split('\n').find((l) => l.startsWith('data:'));
          if (dataLine) { try { onEvent(JSON.parse(dataLine.slice(5).trim())); } catch {} }
        }
      }
    } catch { /* aborted */ }
  })();
  return { close: () => ac.abort() };
}

async function main() {
  console.log(`\nSMOKE TEST @ ${BASE}\n${'─'.repeat(60)}`);

  /* ---------- 1. Public ---------- */
  let r = await api(jar(), 'GET', '/healthz');
  check('healthz', r.status === 200 && r.body.status === 'ok');

  r = await api(jar(), 'GET', '/api/site');
  check('GET /api/site có socials', Array.isArray(r.body.data?.socials) && r.body.data.socials.length >= 6);

  r = await api(jar(), 'GET', `/api/rooms?checkIn=${addDays(20)}&checkOut=${addDays(22)}`);
  check('GET /api/rooms trả tồn kho', r.body.data?.items?.[0]?.available !== undefined);
  const rooms = r.body.data.items;

  /* ---------- 2. Validation ---------- */
  r = await api(jar(), 'POST', '/api/auth/register', { email: 'not-an-email', password: '123', fullName: 'x' });
  check('register chặn email/password yếu', r.status === 422);

  r = await api(jar(), 'POST', '/api/auth/login', { email: 'admin@lakstay.vn', password: 'wrong-password' });
  check('login sai mật khẩu => 401', r.status === 401);

  /* ---------- 3. Login khách ---------- */
  const cj = jar();
  r = await api(cj, 'GET', '/api/auth/csrf');
  const csrf = r.body.data.csrfToken;
  check('GET /api/auth/csrf cấp token', !!csrf);

  r = await api(cj, 'POST', '/api/auth/login', { email: 'khach@example.com', password: PWD });
  check('login khách hàng 200', r.status === 200, JSON.stringify(r.body).slice(0, 200));
  const user = r.body.data?.user;
  check('không leak password_hash', user && !('password_hash' in user));

  r = await api(cj, 'GET', '/api/auth/me');
  check('GET /api/auth/me', r.status === 200 && r.body.data.user.role === 'customer');

  /* ---------- 4. CSRF: POST không kèm header phải bị chặn ---------- */
  const deluxe = rooms.find((x) => x.slug === 'deluxe-valley');
  const ci = addDays(20), co = addDays(22);
  const bookingPayload = {
    checkIn: ci, checkOut: co, guests: 2,
    lines: [{ roomTypeId: deluxe.id, qty: 1 }],
    guestName: user.full_name, guestPhone: user.phone || '0987654321', guestEmail: user.email,
  };
  r = await api(cj, 'POST', '/api/bookings', bookingPayload);
  check('POST không có CSRF token => 403', r.status === 403, `got ${r.status}`);

  /* ---------- 5. Quote ---------- */
  r = await api(cj, 'POST', '/api/rooms/quote', { checkIn: ci, checkOut: co, guests: 2, lines: [{ roomTypeId: deluxe.id, qty: 1 }] }, { 'x-csrf-token': csrf });
  check('quote tính được giá', r.status === 200 && r.body.data.quote.total_amount > 0);
  const quoted = r.body.data.quote;
  check('quote có tax + service fee', quoted.tax > 0 && quoted.service_fee > 0);
  check('quote có chi tiết từng đêm', quoted.lines[0].per_night.length === 2);

  /* ---------- 6. Tạo booking ---------- */
  const idem = 'smoke-' + Date.now();
  r = await api(cj, 'POST', '/api/bookings', { ...bookingPayload, clientExpectedTotal: quoted.total_amount },
    { 'x-csrf-token': csrf, 'Idempotency-Key': idem });
  check('tạo booking 201', r.status === 201, JSON.stringify(r.body).slice(0, 300));
  const booking = r.body.data?.booking;
  check('booking PENDING + có hold_expires_at', booking?.status === 'PENDING' && !!booking?.timeline?.hold_expires_at);
  check('server tự tính giá (khớp quote)', booking?.money?.total === quoted.total_amount);
  check('booking được gán phòng vật lý', (booking?.rooms?.length || 0) === 2);

  /* ---------- 7. Idempotency ---------- */
  const r2 = await api(cj, 'POST', '/api/bookings', bookingPayload, { 'x-csrf-token': csrf, 'Idempotency-Key': idem });
  check('gửi lại Idempotency-Key => không tạo booking mới', r2.body.data?.replayed === true && r2.body.data?.booking?.id === booking.id);

  /* ---------- 8. Tồn kho giảm ---------- */
  r = await api(cj, 'GET', `/api/rooms/${deluxe.id}/availability?checkIn=${ci}&checkOut=${co}`);
  check('tồn kho giảm sau khi giữ chỗ', r.body.data.inventory[0].available === deluxe.available - 1);

  /* ---------- 9. Payment + QR VietQR ---------- */
  r = await api(cj, 'POST', '/api/payments', { bookingId: booking.id, provider: 'VIETQR' }, { 'x-csrf-token': csrf });
  check('tạo payment QR 200', r.status === 200, JSON.stringify(r.body).slice(0, 300));
  const payment = r.body.data?.payment;
  check('QR payload đúng chuẩn EMVCo (000201 + CRC)', /^000201/.test(payment?.qr_payload || '') && payment.qr_payload.length > 40);
  check('QR có ảnh data-uri', (payment?.qr_image || '').startsWith('data:image/svg+xml'));
  check('QR chứa đúng số tiền', payment?.qr_payload?.includes(String(payment.amount)));
  check('có nội dung chuyển khoản', !!payment?.transfer_content);

  /* ---------- 10. Webhook: chữ ký sai phải bị chặn ---------- */
  const whBody = JSON.stringify({ txnRef: payment.txn_ref, amount: payment.amount });
  let res = await fetch(`${BASE}/api/payments/webhook/VIETQR`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-signature': 'deadbeef' }, body: whBody,
  });
  check('webhook chữ ký sai => 403', res.status === 403);

  /* ---------- 11. Webhook đúng chữ ký => booking CONFIRMED ---------- */
  const crypto = await import('node:crypto');
  const sig = crypto.createHmac('sha256', 'dev-webhook-secret').update(whBody).digest('hex');
  res = await fetch(`${BASE}/api/payments/webhook/VIETQR`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-signature': sig }, body: whBody,
  });
  const whRes = await res.json();
  check('webhook hợp lệ => 200', res.status === 200, JSON.stringify(whRes).slice(0, 200));
  check('webhook set booking CONFIRMED', whRes.data?.booking_status === 'CONFIRMED');

  // idempotent: gọi lại lần 2
  res = await fetch(`${BASE}/api/payments/webhook/VIETQR`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-signature': sig }, body: whBody,
  });
  const whRes2 = await res.json();
  check('webhook gọi lại => duplicate, không cộng tiền 2 lần', whRes2.data?.duplicate === true);

  r = await api(cj, 'GET', `/api/bookings/${booking.id}`);
  check('booking đã CONFIRMED + paid = total',
    r.body.data.booking.status === 'CONFIRMED' && r.body.data.booking.money.paid === r.body.data.booking.money.total);

  /* ---------- 12. IDOR: user khác không xem được booking này ---------- */
  const oj = jar();
  await api(oj, 'GET', '/api/auth/csrf');
  r = await api(oj, 'POST', '/api/auth/login', { email: 'mai@example.com', password: PWD });
  const ocsrf = oj.get('lks_csrf');
  r = await api(oj, 'GET', `/api/bookings/${booking.id}`);
  check('IDOR bị chặn (403)', r.status === 403, `got ${r.status}`);

  /* ---------- 13. RBAC: customer không vào được admin ---------- */
  r = await api(cj, 'GET', '/api/admin/dashboard');
  check('customer vào /api/admin => 403', r.status === 403);

  /* ---------- 14. Customer tự đổi trạng thái => 403 ---------- */
  r = await api(cj, 'POST', `/api/bookings/${booking.id}/transition`, { to: 'CHECKED_IN' }, { 'x-csrf-token': csrf });
  check('customer không tự check-in được', r.status === 403 || r.status === 409, `got ${r.status}`);

  /* ---------- 15. Staff login + check-in ---------- */
  const sj = jar();
  await api(sj, 'GET', '/api/auth/csrf');
  r = await api(sj, 'POST', '/api/auth/login', { email: 'staff@lakstay.vn', password: PWD });
  const scsrf = sj.get('lks_csrf');
  check('login staff', r.status === 200 && r.body.data.user.role === 'staff');

  r = await api(sj, 'GET', '/api/admin/dashboard');
  check('staff xem được dashboard', r.status === 200 && r.body.data.stats !== undefined);

  r = await api(sj, 'GET', '/api/admin/front-desk');
  check('front-desk trả arrivals/departures', r.status === 200 && 'arrivals' in r.body.data);

  r = await api(sj, 'POST', `/api/bookings/${booking.id}/transition`, { to: 'CHECKED_IN', note: 'smoke test' }, { 'x-csrf-token': scsrf });
  check('staff check-in booking', r.status === 200 && r.body.data.booking.status === 'CHECKED_IN', JSON.stringify(r.body).slice(0, 200));

  r = await api(sj, 'POST', `/api/bookings/${booking.id}/transition`, { to: 'COMPLETED' }, { 'x-csrf-token': scsrf });
  check('staff check-out => COMPLETED', r.status === 200 && r.body.data.booking.status === 'COMPLETED');

  /* ---------- 16. State machine chặn transition sai ---------- */
  r = await api(sj, 'POST', `/api/bookings/${booking.id}/transition`, { to: 'PENDING' }, { 'x-csrf-token': scsrf });
  check('COMPLETED -> PENDING bị chặn', r.status >= 400);

  /* ---------- 17. Review ---------- */
  r = await api(cj, 'GET', '/api/reviews/eligible');
  check('booking COMPLETED xuất hiện trong danh sách được review',
    r.body.data.items.some((i) => i.booking_id === booking.id && !i.reviewed));

  r = await api(cj, 'POST', '/api/reviews', { bookingId: booking.id, roomTypeId: deluxe.id, rating: 5, title: 'Smoke test', content: 'Mọi thứ hoạt động tốt, phòng sạch và nhân viên thân thiện.' }, { 'x-csrf-token': csrf });
  check('tạo review 201', r.status === 201);

  r = await api(cj, 'POST', '/api/reviews', { bookingId: booking.id, roomTypeId: deluxe.id, rating: 4, content: 'Đánh giá lần hai phải bị chặn bởi unique constraint nhé.' }, { 'x-csrf-token': csrf });
  check('review trùng bị chặn (409)', r.status === 409, `got ${r.status}`);

  /* ---------- 18. Cancellation policy ---------- */
  const ci2 = addDays(40), co2 = addDays(42);
  r = await api(cj, 'POST', '/api/bookings', { ...bookingPayload, checkIn: ci2, checkOut: co2, lines: [{ roomTypeId: deluxe.id, qty: 1 }] }, { 'x-csrf-token': csrf });
  const b2 = r.body.data?.booking;
  check('tạo booking thứ 2 để test huỷ', !!b2);

  r = await api(cj, 'POST', '/api/payments', { bookingId: b2.id, provider: 'VIETQR' }, { 'x-csrf-token': csrf });
  const p2 = r.body.data.payment;
  r = await api(cj, 'POST', '/api/payments/simulate/success', { txnRef: p2.txn_ref }, { 'x-csrf-token': csrf });
  check('simulate thanh toán thành công', r.status === 200);

  r = await api(cj, 'GET', `/api/bookings/${b2.id}/cancel-policy`);
  check('xem trước chính sách huỷ', r.status === 200 && r.body.data.refund_if_cancel_now.refund_amount > 0);
  const preview = r.body.data.refund_if_cancel_now;

  r = await api(cj, 'POST', `/api/bookings/${b2.id}/cancel`, { reason: 'Đổi kế hoạch' }, { 'x-csrf-token': csrf });
  check('huỷ booking => CANCELLED', r.status === 200 && r.body.data.status === 'CANCELLED');
  check('refund đúng như preview', r.body.data.refund.refund_amount === preview.refund_amount);
  check('phòng đã được nhả', r.body.data.released_room_nights === 2);

  r = await api(cj, 'POST', `/api/bookings/${b2.id}/cancel`, { reason: 'Huỷ lần 2' }, { 'x-csrf-token': csrf });
  check('huỷ 2 lần bị state machine chặn', r.status >= 400);

  /* ---------- 19. Coupon ---------- */
  r = await api(cj, 'POST', '/api/rooms/quote', { checkIn: addDays(45), checkOut: addDays(47), guests: 2, lines: [{ roomTypeId: deluxe.id, qty: 1 }], couponCode: 'DALAT10' }, { 'x-csrf-token': csrf });
  check('coupon hợp lệ => có discount', r.body.data?.quote?.discount > 0);

  r = await api(cj, 'POST', '/api/rooms/quote', { checkIn: addDays(45), checkOut: addDays(47), guests: 2, lines: [{ roomTypeId: deluxe.id, qty: 1 }], couponCode: 'HETHANG' }, { 'x-csrf-token': csrf });
  check('coupon hết hạn => 400', r.status === 400);

  r = await api(cj, 'POST', '/api/rooms/quote', { checkIn: addDays(45), checkOut: addDays(47), guests: 2, lines: [{ roomTypeId: deluxe.id, qty: 1 }], couponCode: 'KHONGTONTAI' }, { 'x-csrf-token': csrf });
  check('coupon không tồn tại => 400', r.status === 400);

  /* ---------- 20. Date validation ---------- */
  r = await api(cj, 'POST', '/api/rooms/quote', { checkIn: addDays(50), checkOut: addDays(48), guests: 2, lines: [{ roomTypeId: deluxe.id, qty: 1 }] }, { 'x-csrf-token': csrf });
  check('checkOut < checkIn => 400', r.status === 400);

  r = await api(cj, 'POST', '/api/bookings', { ...bookingPayload, checkIn: '2020-01-01', checkOut: '2020-01-03' }, { 'x-csrf-token': csrf });
  check('ngày quá khứ => 400', r.status === 400);

  r = await api(cj, 'POST', '/api/bookings', { ...bookingPayload, checkIn: '2027-02-30', checkOut: '2027-03-02' }, { 'x-csrf-token': csrf });
  check('ngày không tồn tại (30/02) => 400', r.status === 400 || r.status === 422);

  /* ---------- 21. Admin ---------- */
  const aj = jar();
  await api(aj, 'GET', '/api/auth/csrf');
  r = await api(aj, 'POST', '/api/auth/login', { email: 'admin@lakstay.vn', password: PWD });
  const acsrf = aj.get('lks_csrf');
  check('login admin', r.status === 200 && r.body.data.user.role === 'admin');

  r = await api(aj, 'GET', '/api/admin/dashboard?days=30');
  check('dashboard có stats + calendar + alerts', !!(r.body.data.stats && r.body.data.calendar && r.body.data.alerts));

  r = await api(aj, 'GET', '/api/admin/security-events?limit=5');
  check('admin xem được security events', r.status === 200 && Array.isArray(r.body.data.items));

  r = await api(aj, 'GET', '/api/admin/audit-logs?limit=5');
  check('admin xem được audit logs', r.status === 200 && Array.isArray(r.body.data.items));

  r = await api(aj, 'POST', '/api/admin/coupons', { code: 'SMOKE' + Date.now().toString().slice(-6), type: 'PERCENT', value: 50, startsAt: addDays(-1) + ' 00:00:00', endsAt: addDays(10) + ' 23:59:59' }, { 'x-csrf-token': acsrf });
  check('admin tạo coupon', r.status === 201);

  r = await api(sj, 'POST', '/api/admin/coupons', { code: 'STAFFNO', type: 'PERCENT', value: 10, startsAt: addDays(-1) + ' 00:00:00', endsAt: addDays(10) + ' 23:59:59' }, { 'x-csrf-token': scsrf });
  check('staff KHÔNG tạo được coupon (admin only)', r.status === 403, `got ${r.status}`);

  r = await api(aj, 'GET', '/api/admin/reports/revenue.csv?days=60');
  check('export CSV doanh thu', r.status === 200);

  /* ---------- 21b. Bộ lọc nâng cao ---------- */
  r = await api(cj, 'GET', '/api/rooms?amenities=' + encodeURIComponent('hồ bơi nước ấm riêng') + '&limit=20');
  check('lọc theo tiện nghi chỉ trả villa', r.body.data.items.every((x) => (x.amenities || []).some((a) => /hồ bơi/i.test(a))));

  r = await api(cj, 'GET', '/api/rooms?minRating=4.5&limit=20');
  check('lọc theo điểm đánh giá', r.body.data.items.every((x) => !x.rating || x.rating >= 4.5));

  /* ---------- 21c. Voucher PDF ---------- */
  res = await fetch(`${BASE}/api/bookings/${booking.id}/voucher.pdf`, { headers: { Cookie: cj.header() } });
  const pdfBuf = Buffer.from(await res.arrayBuffer());
  check('voucher.pdf trả 200', res.status === 200, `got ${res.status}`);
  check('voucher.pdf đúng định dạng PDF', pdfBuf.slice(0, 4).toString() === '%PDF');
  check('voucher.pdf có nội dung (>20KB)', pdfBuf.length > 20_000, `size ${pdfBuf.length}`);

  const oj2 = jar();
  res = await fetch(`${BASE}/api/bookings/${booking.id}/voucher.pdf`, { headers: { Cookie: oj2.header() } });
  check('voucher.pdf chặn khách chưa đăng nhập', res.status === 401);

  /* ---------- 21d. SSE realtime thanh toán ---------- */
  {
    // tạo đơn mới để test SSE
    const ci3 = addDays(55), co3 = addDays(56);
    const rb = await api(cj, 'POST', '/api/bookings', { ...bookingPayload, checkIn: ci3, checkOut: co3, lines: [{ roomTypeId: deluxe.id, qty: 1 }] }, { 'x-csrf-token': csrf });
    const newBooking = rb.body.data.booking;
    const rp = await api(cj, 'POST', '/api/payments', { bookingId: newBooking.id, provider: 'VIETQR' }, { 'x-csrf-token': csrf });
    const newPay = rp.body.data.payment;

    const gotEvent = await new Promise((resolve) => {
      const ac = new AbortController();
      const timer = setTimeout(() => { ac.abort(); resolve(false); }, 12_000);
      const es = new EventSourceShim(`${BASE}/api/payments/${newPay.id}/stream`, cj.header(), (ev) => {
        if (ev?.status === 'PAID') { clearTimeout(timer); ac.abort(); resolve(true); }
      });
      // sau 1.5s thì simulate thanh toán để server đẩy event
      setTimeout(async () => {
        await api(cj, 'POST', '/api/payments/simulate/success', { txnRef: newPay.txn_ref }, { 'x-csrf-token': csrf });
      }, 1500);
    });
    check('SSE đẩy event PAID ngay khi thanh toán', gotEvent);
  }

  /* ---------- 21e. Email outbox ---------- */
  await new Promise((r2) => setTimeout(r2, 700)); // chờ mail fire-and-forget ghi xong
  const aj0 = jar();
  const csrfAdmin = (await api(aj0, 'GET', '/api/auth/csrf')).body.data.csrfToken;
  await api(aj0, 'POST', '/api/auth/login', { email: 'admin@lakstay.vn', password: PWD }, { 'x-csrf-token': csrfAdmin });
  r = await api(aj0, 'GET', '/api/admin/outbox');
  check('admin xem được outbox email', r.status === 200 && Array.isArray(r.body.data.items));
  check('có email xác nhận kèm voucher PDF trong outbox',
    r.body.data.items.some((m) => /XÁC NHẬN/i.test(m.subject) && (m.attachments || []).some((a) => a.endsWith('.pdf'))));

  /* ---------- 21f. Loyalty: tích điểm khi PAID ---------- */
  await new Promise((r2) => setTimeout(r2, 300));
  r = await api(cj, 'GET', '/api/loyalty/me');
  check('loyalty/me trả về hạng + điểm', r.status === 200 && r.body.data.points > 0 && !!r.body.data.tier.key,
    `points=${r.body?.data?.points}`);
  check('có giao dịch EARN cho đơn vừa thanh toán',
    (r.body.data.transactions || []).some((t) => t.type === 'EARN' && t.points > 0));

  /* ---------- 21g. Admin quản lý thành viên + điều chỉnh ---------- */
  r = await api(aj0, 'GET', '/api/admin/loyalty');
  check('admin xem danh sách thành viên', r.status === 200 && r.body.data.items.length > 0);
  const meRow = r.body.data.items.find((x) => x.email === 'khach@example.com');
  check('khach@example.com có trong danh sách', !!meRow);
  r = await api(aj0, 'POST', `/api/admin/loyalty/${meRow.user_id}/adjust`,
    { points: 100, lifetimeSpendDelta: 30_000_000, note: 'Smoke test thăng hạng' }, { 'x-csrf-token': csrfAdmin });
  check('admin điều chỉnh điểm + chi tiêu => lên hạng GOLD',
    r.status === 200 && ['GOLD', 'PLATINUM'].includes(r.body?.data?.adjusted?.tier),
    `status=${r.status} tier=${r.body?.data?.adjusted?.tier}`);

  /* ---------- 21h. Ưu đãi hạng áp vào báo giá ---------- */
  r = await api(cj, 'POST', '/api/rooms/quote', {
    checkIn: addDays(70), checkOut: addDays(72), guests: 2,
    lines: [{ roomTypeId: deluxe.id, qty: 1 }],
  }, { 'x-csrf-token': csrf });
  check('báo giá có ưu đãi thành viên (≥5% sau khi lên GOLD)',
    r.status === 200 && r.body.data.quote.member_pct >= 5 && r.body.data.quote.member_discount > 0,
    `pct=${r.body?.data?.quote?.member_pct}`);
  check('tổng tiền = tạm tính − coupon − member + phí + thuế',
    (() => { const q = r.body.data.quote;
      return q.total_amount === q.subtotal - q.discount - q.member_discount + q.service_fee + q.tax; })());

  /* ---------- 21i. Lịch giá tháng (ngày rẻ nhất) ---------- */
  {
    const nd = new Date(); nd.setUTCDate(1); nd.setUTCMonth(nd.getUTCMonth() + 1);
    const month = iso(nd).slice(0, 7);
    r = await api(jar(), 'GET', `/api/rooms/meta/price-calendar?month=${month}`);
    const cal = r.body.data;
    const daysInMonth = new Date(nd.getUTCFullYear(), nd.getUTCMonth() + 1, 0).getDate();
    check('price-calendar đủ số ngày trong tháng', r.status === 200 && cal.days.length === daysInMonth);
    check('price-calendar trả ngày rẻ nhất đã sắp xếp',
      cal.cheapest.length > 0 && cal.cheapest.every((d, i, a) => i === 0 || a[i - 1].min_price <= d.min_price));
    r = await api(jar(), 'GET', '/api/rooms/meta/price-calendar?month=2026-13');
    check('price-calendar chặn tháng sai định dạng', r.status === 400);
  }

  /* ---------- 21j. Biểu đồ báo cáo + i18n fields ---------- */
  r = await api(aj0, 'GET', '/api/admin/reports/charts?days=30');
  check('charts endpoint trả chuỗi 30 ngày', r.status === 200 && r.body.data.revenue_series.length === 30);
  check('charts có tổng doanh thu khớp chuỗi', (() => {
    const d = r.body.data;
    return d.totals.revenue === d.revenue_series.reduce((s2, x) => s2 + x.revenue, 0);
  })());
  r = await api(jar(), 'GET', '/api/rooms?limit=3');
  check('rooms trả name_en + description_en cho i18n',
    r.body.data.items.every((x) => !!x.name_en && !!x.description_en));

  /* ---------- 22. Security headers ---------- */
  res = await fetch(`${BASE}/api/site`);
  check('có header X-Content-Type-Options', res.headers.get('x-content-type-options') === 'nosniff');
  check('có header CSP', !!res.headers.get('content-security-policy'));
  check('không lộ X-Powered-By', !res.headers.get('x-powered-by'));

  /* ---------- 23. Logout + refresh ---------- */
  const lj = jar();
  await api(lj, 'GET', '/api/auth/csrf');
  await api(lj, 'POST', '/api/auth/login', { email: 'demo@example.com', password: PWD });
  const lcsrf = lj.get('lks_csrf');
  r = await api(lj, 'POST', '/api/auth/refresh', null, { 'x-csrf-token': lcsrf });
  check('refresh token hoạt động', r.status === 200 && !!r.body.data.accessToken);
  r = await api(lj, 'POST', '/api/auth/logout', null, { 'x-csrf-token': lcsrf });
  check('logout', r.status === 200);
  r = await api(lj, 'GET', '/api/auth/me');
  check('sau logout không vào được /me', r.status === 401);

  /* ---------- RESULT ---------- */
  console.log(log.join('\n'));
  console.log('─'.repeat(60));
  console.log(`  PASS: ${pass}   FAIL: ${fail}   TOTAL: ${pass + fail}`);
  console.log('─'.repeat(60) + '\n');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('SMOKE CRASH:', e); process.exit(2); });
