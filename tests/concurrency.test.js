#!/usr/bin/env node
/**
 * ============================================================================
 *  CONCURRENCY TEST — chứng minh hệ thống KHÔNG THỂ overbook
 * ============================================================================
 *  Kịch bản: tạo 1 loại phòng chỉ có ĐÚNG 1 phòng. Bắn N request đặt phòng
 *  ĐỒNG THỜI vào cùng 1 khoảng ngày. Kỳ vọng: đúng 1 thành công, N-1 thất bại.
 *
 *  Sau đó kiểm tra trực tiếp DB:
 *   - số dòng room_calendar cho (room, date) phải = 1  (PK đảm bảo)
 *   - không có đêm nào bị chiếm bởi 2 booking
 *
 *  Chạy:  npm run test:concurrency      (cần server đang chạy)
 * ============================================================================
 */
import { db } from '../src/db.js';
import { signAccessToken } from '../src/middlewares/auth.js';
import { newId, randomToken } from '../src/utils/id.js';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.PAYMENT_WEBHOOK_SECRET || 'dev-webhook-secret';
const PWD = 'Lakstay@2026';
let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
};

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (n) => {
  const vnNow = new Date(Date.now() + 7 * 3_600_000);
  vnNow.setUTCDate(vnNow.getUTCDate() + n);
  return iso(vnNow);
};

function jar() {
  const jar = new Map();
  return {
    header() { return [...jar].map(([k, v]) => `${k}=${v}`).join('; '); },
    absorb(res) { for (const c of res.headers.getSetCookie?.() || []) { const [kv] = c.split(';'); const i = kv.indexOf('='); jar.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } },
    get: (k) => jar.get(k),
    set: (k, v) => jar.set(k, v),
  };
}
async function api(j, method, path, body, headers = {}) {
  const res = await fetch(BASE + path, { method, headers: { 'Content-Type': 'application/json', Cookie: j.header(), ...headers }, body: body ? JSON.stringify(body) : undefined });
  j.absorb(res);
  const t = await res.text();
  try { return { status: res.status, body: JSON.parse(t) }; } catch { return { status: res.status, body: { raw: t } }; }
}
async function loginAs(email) {
  const j = jar();
  await api(j, 'GET', '/api/auth/csrf');
  const r = await api(j, 'POST', '/api/auth/login', { email, password: PWD });
  if (r.status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(r.body)}`);
  return { jar: j, csrf: j.get('lks_csrf'), user: r.body.data.user };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log('\n═══ CONCURRENCY / DOUBLE-BOOKING TEST ═══\n');

  /* ---------- Chuẩn bị: 1 room type chỉ có 1 phòng ---------- */
  const admin = await loginAs('admin@lakstay.vn');
  const stamp = Date.now();
  const slug = `test-single-${stamp}`;
  let r = await api(admin.jar, 'POST', '/api/admin/room-types', {
    name: `Test Single ${stamp}`, nameVi: `Phòng Test Đơn ${stamp}`,
    description: 'Phòng chỉ có 1 căn — dùng để test chống double booking.',
    capacity: 2, bedType: '1 giường đôi', sizeM2: 20, basePrice: 1_000_000,
    amenities: ['Test'], images: [], slug,
    cancelFreeHours: 24, cancelPenaltyPct: 50, cancelNoRefundHours: 6,
    minStay: 1, maxStay: 10, maxAdvanceDays: 365,
  }, { 'x-csrf-token': admin.csrf });
  check('admin tạo được room type test', r.status === 201, JSON.stringify(r.body).slice(0, 200));
  const roomTypeId = r.body.data.id;

  r = await api(admin.jar, 'POST', '/api/admin/rooms', { roomTypeId, roomNumber: `T${stamp % 100}`, floor: 9 }, { 'x-csrf-token': admin.csrf });
  check('tạo đúng 1 phòng vật lý', r.status === 201);
  const roomId = r.body.data.id;

  const checkIn = addDays(60), checkOut = addDays(63); // 3 đêm
  r = await api(admin.jar, 'GET', `/api/rooms/${roomTypeId}/availability?checkIn=${checkIn}&checkOut=${checkOut}`);
  check('tồn kho ban đầu = 1', r.body.data.inventory.every((i) => i.available === 1));

  /* ---------- Tạo N user thật trong DB + ký phiên để đủ N racer thực sự đua tranh ---------- */
  const N = Number(process.env.RACERS || 40);
  const users = [];
  const insUser = db.prepare(`
    INSERT INTO users (id, email, phone, password_hash, full_name, role, status)
    VALUES (?, ?, ?, '!', ?, 'customer', 'active')`);
  const seedRacers = db.transaction(() => {
    for (let i = 0; i <= N; i++) {
      const uid = newId('usr');
      const email = `racer${stamp}_${i}@test.local`;
      const phone = `09${String(10000000 + i).slice(0, 8)}`;
      insUser.run(uid, email, phone, `Racer ${i}`);
      const jr = jar();
      const csrf = randomToken(16);
      jr.set('lks_csrf', csrf);
      jr.set('lks_at', signAccessToken({ id: uid, role: 'customer', email }));
      users.push({ userId: uid, email, jar: jr, csrf });
    }
  });
  seedRacers();
  const idemUser = users.pop();
  check(`tạo được ${N} user đã xác thực để đua tranh thực sự`,
    users.length === N && users.every((u) => u.userId && u.csrf && u.jar.get('lks_at')));

  /* ---------- Bắn N request ĐỒNG THỜI (có barrier thật) ---------- */
  const fireWave = async (offsetDays, label) => {
    const ci = addDays(offsetDays), co = addDays(offsetDays + 3);
    // Barrier: mọi request chỉ xuất phát khi tất cả đã sẵn sàng
    let release;
    const gate = new Promise((res) => { release = res; });
    const ready = [];

    const tasks = users.map(async (u, i) => {
      ready.push(1);
      await gate;                       // chờ hiệu lệnh
      const t0 = Date.now();
      const res = await api(u.jar, 'POST', '/api/bookings', {
        checkIn: ci, checkOut: co, guests: 2,
        lines: [{ roomTypeId, qty: 1 }],
        guestName: `Racer ${i}`, guestPhone: `09${String(10000000 + i).slice(0, 8)}`,
        guestEmail: `racer${stamp}_${i}@test.local`,
      }, { 'x-csrf-token': u.csrf });
      return {
        i, status: res.status, code: res.body?.error?.code,
        booking: res.body?.data?.booking, ms: Date.now() - t0,
      };
    });

    while (ready.length < N) await sleep(5);   // đợi tất cả vào vị trí
    release();                                  // BẮN!
    const rs = await Promise.all(tasks);

    const okRs = rs.filter((x) => x.status === 201);
    const rejected = rs.filter((x) => x.status !== 201);
    const codes = {};
    for (const x of rejected) codes[x.code || `HTTP${x.status}`] = (codes[x.code || `HTTP${x.status}`] || 0) + 1;

    console.log(`  ${label}: ${okRs.length} thành công / ${rejected.length} bị từ chối`
      + `   [${Math.min(...rs.map((x) => x.ms))}–${Math.max(...rs.map((x) => x.ms))}ms]`);
    if (Object.keys(codes).length) console.log(`        lý do: ${JSON.stringify(codes)}`);
    check(`${label}: ĐÚNG 1 booking thành công — không overbook`, okRs.length === 1, `got ${okRs.length}`);
    check(`${label}: Mọi racer còn lại đều bị chặn ở tầng kho phòng (409), không rơi rụng 401/429`,
      rejected.length === N - 1 && rejected.every((x) => x.status === 409), JSON.stringify(codes));
    return { ok: okRs, rejected, rs };
  };

  console.log(`\n  → ${N} user cùng đặt 1 phòng duy nhất, 3 đêm\n`);
  const wave1 = await fireWave(60, 'ĐỢT 1');
  const wave2 = await fireWave(70, 'ĐỢT 2');
  console.log();

  const firstBooking = [...wave1.ok, ...wave2.ok][0]?.booking;

  /* ---------- Kiểm tra trực tiếp DB: bất biến của room_calendar ---------- */
  const dup = db.prepare(`
    SELECT room_id, stay_date, COUNT(*) n FROM room_calendar
    GROUP BY room_id, stay_date HAVING n > 1`).all();
  check('DB: không có (room, date) nào bị 2 booking chiếm', dup.length === 0, JSON.stringify(dup));

  const calRows = db.prepare(`
    SELECT COUNT(*) n FROM room_calendar rc
    JOIN bookings b ON b.id = rc.booking_id
    WHERE rc.room_type_id = ? AND b.status = 'PENDING'`).get(roomTypeId).n;
  check('DB: tổng room-night bị chiếm = đúng 6 (2 đợt × 1 booking × 3 đêm)', calRows === 6, `got ${calRows}`);

  const confirmedBookings = db.prepare(`
    SELECT COUNT(*) n FROM bookings b
    JOIN booking_rooms br ON br.booking_id = b.id
    WHERE br.room_type_id = ? AND b.status NOT IN ('CANCELLED','EXPIRED')`).get(roomTypeId).n;
  check('DB: đúng 2 booking hợp lệ cho phòng đơn này', confirmedBookings === 2, `got ${confirmedBookings}`);

  /* ---------- Idempotency dưới áp lực ---------- */
  const idemKey = 'concurrency-' + stamp;
  const idemResults = await Promise.all(Array.from({ length: 10 }, () =>
    api(idemUser.jar, 'POST', '/api/bookings', {
      checkIn: addDays(80), checkOut: addDays(81), guests: 2,
      lines: [{ roomTypeId, qty: 1 }],
      guestName: 'Idem Test', guestPhone: '0911111111', guestEmail: `idem${stamp}@test.local`,
    }, { 'x-csrf-token': idemUser.csrf, 'Idempotency-Key': idemKey })
  ));
  const uniqIds = new Set(idemResults.filter((x) => x.body?.data?.booking).map((x) => x.body.data.booking.id));
  check('Idempotency: 10 request cùng key => đúng 1 booking',
    uniqIds.size === 1 && idemResults.every((x) => x.status === 200 || x.status === 201), `got ${uniqIds.size}`);

  /* ---------- Payment race: 5 webhook cùng lúc ---------- */
  const targetWinner = [...wave1.ok, ...wave2.ok][0];
  const targetBooking = targetWinner?.booking;
  const ownerRacer = targetWinner ? users[targetWinner.i] : admin;
  if (targetBooking) {
    const pr = await api(ownerRacer.jar, 'POST', '/api/payments', { bookingId: targetBooking.id, provider: 'VIETQR' }, { 'x-csrf-token': ownerRacer.csrf });
    check('Tạo yêu cầu thanh toán cho booking thắng cuộc => 200', pr.status === 200, `got ${pr.status}`);
    if (pr.status === 200) {
      const payment = pr.body.data.payment;
      const crypto = await import('node:crypto');
      const body = JSON.stringify({ txnRef: payment.txn_ref, amount: payment.amount, providerTxnId: `RACE_${stamp}` });
      const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
      const whResults = await Promise.all(Array.from({ length: 5 }, () =>
        fetch(`${BASE}/api/payments/webhook/VIETQR`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-signature': sig }, body,
        }).then(async (x) => ({ status: x.status, body: await x.json() }))
      ));
      const paidCount = whResults.filter((x) => x.body?.data?.duplicate === false).length;
      check('Webhook race: 5 notify cùng lúc => chỉ 1 lần ghi nhận tiền', paidCount === 1, `got ${paidCount}`);

      const totalPaid = db.prepare(`SELECT COALESCE(SUM(amount),0) n FROM payments WHERE booking_id = ? AND type='CHARGE' AND status='PAID'`).get(targetBooking.id).n;
      check('DB: tổng tiền PAID = đúng 1 lần tổng booking', totalPaid === targetBooking.money.total, `${totalPaid} vs ${targetBooking.money.total}`);
    }
  }

  /* ---------- Dọn dẹp ---------- */
  db.prepare(`DELETE FROM room_calendar WHERE room_type_id = ?`).run(roomTypeId);
  db.prepare(`DELETE FROM bookings WHERE id IN (SELECT booking_id FROM booking_rooms WHERE room_type_id = ?)`).run(roomTypeId);
  db.prepare(`DELETE FROM rooms WHERE id = ?`).run(roomId);
  db.prepare(`DELETE FROM room_types WHERE id = ?`).run(roomTypeId);
  db.prepare(`DELETE FROM users WHERE email LIKE ?`).run(`racer${stamp}%@test.local`);

  console.log(`\n${'─'.repeat(60)}\n  PASS: ${pass}   FAIL: ${fail}\n${'─'.repeat(60)}\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('CRASH:', e); process.exit(2); });
