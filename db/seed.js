#!/usr/bin/env node
/**
 * Seed dữ liệu mẫu: khách sạn Đà Lạt, 6 loại phòng, user các role, coupon, booking mẫu.
 * Dùng: npm run db:seed
 *
 * QUAN TRỌNG: seed dùng CHUNG connection với app (src/db.js) để có thể gọi
 * trực tiếp các service thật (createBooking, handlePaymentSuccess...).
 * => Dữ liệu seed luôn nhất quán với logic nghiệp vụ, không "làm giả" bằng INSERT tay.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import { db, initSchema } from '../src/db.js';
import { createBooking, transitionBooking } from '../src/services/booking.service.js';
import { createPayment, handlePaymentSuccess } from '../src/services/payment.service.js';
import { newId } from '../src/utils/id.js';
import { todayISO, addDays as addDaysISO } from '../src/utils/date.js';

const id = (p, i) => `${p}_seed_${String(i).padStart(3, '0')}`;
const addDays = (n) => addDaysISO(todayISO(), n);

/* ===================== ROOM TYPES ===================== */
const ROOM_TYPES = [
  {
    slug: 'standard-pine', name: 'Superior Cozy Double', nameVi: 'Phòng Superior Đôi Ấm Cúng',
    description: 'Không gian 20m² ấm cúng với tông gỗ sáng kết hợp vách lam gỗ và vân đá tự nhiên. Trang bị giường đôi 1m8 đầu giường bọc da êm ái, bàn trang điểm gương tròn LED cảm ứng và đầy đủ tiện nghi cho cặp đôi hoặc khách công tác.',
    descriptionEn: 'Warm 20m² room crafted in light oak, slatted wood panelling and natural stone accents, featuring a plush 1.8m double bed, touch-lit round vanity desk and full modern amenities.',
    capacity: 2, bed: '1 giường đôi 1m8', size: 20, price: 890_000, rooms: 8, floors: [1, 2],
    amenities: ['Wifi tốc độ cao', 'Điều hoà âm trần', 'Bàn trang điểm gương LED', 'Nước nóng 24/7', 'Minibar', 'Ấm siêu tốc', 'Máy sấy tóc', 'Khóa thẻ từ'],
    images: ['/img/room-standard.jpg', '/img/rooms/double-4.jpg', '/img/rooms/double-3.jpg', '/img/rooms/superior-1.jpg'],
  },
  {
    slug: 'deluxe-valley', name: 'Deluxe Double with Balcony', nameVi: 'Phòng Deluxe Ban Công',
    description: 'Phòng 26m² thoáng sáng với hệ cửa kính sát trần phủ rèm voan trắng mở ra ban công đón nắng sớm Đà Lạt. Có bộ bàn trà gỗ đôi cạnh cửa sổ, tủ âm tường cỡ lớn và phòng tắm riêng tích hợp bồn tắm nằm thư giãn.',
    descriptionEn: 'Sunlit 26m² deluxe room with floor-to-ceiling sheer-curtained glass doors opening onto a breezy balcony, complete with a wooden tea set for two and a private soaking bathtub.',
    capacity: 2, bed: '1 giường đôi 1m8', size: 26, price: 1_390_000, rooms: 10, floors: [2, 3],
    amenities: ['Ban công riêng', 'Bồn tắm nằm', 'Bàn trà đôi cạnh cửa sổ', 'Wifi tốc độ cao', 'TV thông minh', 'Điều hoà âm trần', 'Minibar', 'Khóa thẻ từ', 'Trà & cà phê'],
    images: ['/img/room-deluxe.jpg', '/img/rooms/balcony-1.jpg', '/img/rooms/balcony-3.jpg', '/img/rooms/balcony-4.jpg'],
  },
  {
    slug: 'premium-garden', name: 'Premium Garden Bathtub', nameVi: 'Phòng Premium Bồn Tắm Hướng Vườn',
    description: 'Phòng nghỉ 32m² ngập tràn ánh sáng tự nhiên với khung cửa sổ đôi nhìn ra rặng cây xanh mát và ban công lan can sắt cổ điển. Điểm nhấn là không gian phòng tắm mở có bồn tắm nằm đặt ngay cạnh cửa sổ để ngâm mình thư giãn.',
    descriptionEn: 'Light-filled 32m² retreat overlooking lush greenery with a wrought-iron balcony, dual window-side desk and an open-plan bathroom featuring a soaking tub right beside the window.',
    capacity: 3, bed: '1 giường đôi 1m8', size: 32, price: 1_790_000, rooms: 6, floors: [2, 3],
    amenities: ['Hướng vườn cây xanh', 'Bồn tắm nằm cạnh cửa sổ', 'Ban công riêng', 'Bàn làm việc hướng vườn', 'Wifi tốc độ cao', 'TV 50"', 'Điều hoà âm trần', 'Minibar', 'Trà & cà phê'],
    images: ['/img/room-premium.jpg', '/img/rooms/garden-suite-3.jpg', '/img/rooms/bathtub-1.jpg', '/img/rooms/bathtub-2.jpg'],
  },
  {
    slug: 'family-suite', name: 'Family Room with Balcony', nameVi: 'Phòng Gia Đình Ban Công',
    description: 'Phòng gia đình rộng 35m² bố trí 2 giường đôi 1m8 êm ái cho 4 người lớn và trẻ nhỏ. Trang bị hệ tủ gỗ kịch trần nhiều ngăn, bàn trang điểm dài kèm gương LED, ban công thoáng gió và phòng tắm có bồn tắm nằm.',
    descriptionEn: 'Spacious 35m² family room with two plush 1.8m double beds, full-height multi-bay wooden wardrobes, an extended LED vanity desk, airy balcony and a bathroom with soaking tub.',
    capacity: 4, bed: '2 giường đôi 1m8', size: 35, price: 2_290_000, rooms: 5, floors: [2, 3, 4],
    amenities: ['2 giường đôi 1m8', 'Ban công riêng', 'Bồn tắm nằm', 'Hệ tủ gỗ kịch trần', 'Bàn trang điểm gương LED', 'Wifi tốc độ cao', 'TV 55"', 'Điều hoà âm trần', 'Minibar'],
    images: ['/img/room-family.jpg', '/img/rooms/family-balcony-1.jpg', '/img/rooms/family-balcony-4.jpg', '/img/rooms/family-window-1.jpg'],
  },
  {
    slug: 'executive-lake', name: 'Deluxe Lake & Town Suite', nameVi: 'Deluxe Suite Ban Công Hướng Hồ',
    description: 'Suite góc rộng 45m² mang phong cách cổ điển ấm lịch lãm với gỗ trầm, ghế sofa da Chesterfield tiếp khách, hệ tủ kính trưng bày và bàn làm việc riêng. Ban công sắt mỹ thuật mở ra tầm nhìn thoáng đãng về phía Hồ Xuân Hương và mái ngói phố núi.',
    descriptionEn: 'Elegant 45m² corner suite dressed in dark walnut, featuring a classic Chesterfield leather sofa, glass display cabinet, dedicated work desk and a wrought-iron balcony overlooking Xuan Huong Lake and hillside villas.',
    capacity: 2, bed: '1 giường King 1m8 + Sofa da', size: 45, price: 2_890_000, rooms: 4, floors: [4, 5],
    amenities: ['View hồ Xuân Hương', 'Ban công sắt mỹ thuật', 'Sofa da Chesterfield', 'Bàn làm việc riêng', 'Tủ rượu cánh kính', 'Wifi tốc độ cao', 'TV 55"', 'Điều hoà âm trần', 'Minibar'],
    images: ['/img/room-executive.jpg', '/img/rooms/suite-balcony-4.jpg', '/img/rooms/suite-balcony-3.jpg', '/img/rooms/deluxe-window-2.jpg'],
  },
  {
    slug: 'presidential-villa', name: 'Grand Pine Forest Suite', nameVi: 'Grand Suite Bồn Tắm Rừng Thông',
    description: 'Hạng Suite cao cấp nhất rộng 52m² nổi bật với vách đá cẩm thạch hắt sáng, 2 giường đôi 1m8 êm ái và hệ cửa kính góc toàn cảnh. Đặc biệt sở hữu bồn tắm nằm lớn đặt ngay khung cửa sổ mở thẳng ra rặng thông xanh rì đặc trưng của Đà Lạt.',
    descriptionEn: 'Our signature 52m² flagship suite highlighted by a backlit marble feature wall, two luxury 1.8m double beds, panoramic corner windows and a statement soaking tub looking straight into Da Lat’s lush pine forest.',
    capacity: 4, bed: '2 giường đôi 1m8 cao cấp', size: 52, price: 3_690_000, rooms: 2, floors: [4, 5],
    amenities: ['View rừng thông toàn cảnh', 'Bồn tắm panorama rừng thông', '2 giường đôi 1m8', 'Vách đá cẩm thạch hắt sáng', 'Ban công góc rộng', 'Bàn trà đôi đón nắng', 'Wifi tốc độ cao', 'TV 65"', 'Điều hoà âm trần'],
    images: ['/img/room-villa.jpg', '/img/rooms/family-garden-1.jpg', '/img/rooms/family-garden-4.jpg', '/img/rooms/bathtub-3.jpg'],
  },
];

export async function seedDatabase({ silent = false } = {}) {
initSchema();
const insRoomType = db.prepare(`
  INSERT OR REPLACE INTO room_types
  (id, slug, name, name_vi, description, description_en, capacity, bed_type, size_m2, base_price, total_rooms,
   amenities, images, cancel_free_hours, cancel_penalty_pct, cancel_no_refund_hours,
   min_stay, max_stay, max_advance_days, is_active)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)`);
const insRoom = db.prepare(`INSERT OR REPLACE INTO rooms (id, room_type_id, room_number, floor, status) VALUES (?,?,?,?,?)`);

ROOM_TYPES.forEach((rt, idx) => {
  const rtId = id('rt', idx + 1);
  const policy = rt.price > 3_000_000
    ? { free: 72, penalty: 100, norefund: 72, min: 2 }
    : rt.price > 2_000_000
      ? { free: 48, penalty: 50, norefund: 24, min: 1 }
      : { free: 24, penalty: 50, norefund: 6, min: 1 };

  insRoomType.run(rtId, rt.slug, rt.name, rt.nameVi, rt.description, rt.descriptionEn, rt.capacity, rt.bed, rt.size,
    rt.price, rt.rooms, JSON.stringify(rt.amenities), JSON.stringify(rt.images),
    policy.free, policy.penalty, policy.norefund, policy.min, 30, 365);

  let n = 0;
  const perFloor = Math.ceil(rt.rooms / rt.floors.length);
  for (const floor of rt.floors) {
    for (let k = 1; k <= perFloor && n < rt.rooms; k++, n++) {
      const num = floor === 0 ? `V${k}` : `${floor}${String(k).padStart(2, '0')}`;
      insRoom.run(id('rom', `${idx + 1}_${n + 1}`), rtId, num, floor, 'available');
    }
  }
});

/* ===================== PRICE RULES ===================== */
// Ghi chú: phụ thu cuối tuần (T6/T7/CN) đã do pricing.service.js tính theo WEEKEND_SURCHARGE_PCT,
// nên chỉ seed các rule theo mùa lễ để tránh nhân đôi phụ thu cuối tuần.
db.prepare(`DELETE FROM price_rules WHERE id LIKE 'pr_seed_%'`).run();
const insRule = db.prepare(`
  INSERT OR REPLACE INTO price_rules (id, room_type_id, name, start_date, end_date, multiplier, priority, days_of_week)
  VALUES (?,?,?,?,?,?,?,?)`);
const year = new Date().getUTCFullYear();
const SEASONS = [
  { name: 'Mùa hoa dã quỳ', start: `${year}-10-15`, end: `${year}-12-15`, mult: 1.15 },
  { name: 'Lễ Giáng sinh', start: `${year}-12-20`, end: `${year}-12-27`, mult: 1.35 },
  { name: 'Tết Dương lịch', start: `${year}-12-28`, end: `${year + 1}-01-02`, mult: 1.5 },
  { name: 'Mùa mai anh đào', start: `${year + 1}-01-10`, end: `${year + 1}-02-10`, mult: 1.25 },
];
let ruleIdx = 0;
ROOM_TYPES.forEach((rt, rtIdx) => {
  for (const s of SEASONS) {
    ruleIdx++;
    insRule.run(id('pr', ruleIdx), id('rt', rtIdx + 1), s.name, s.start, s.end, s.mult,
      s.dow ? 5 : 10, s.dow ? JSON.stringify(s.dow) : null);
  }
});

/* ===================== USERS ===================== */
const insUser = db.prepare(`
  INSERT OR REPLACE INTO users (id, email, phone, password_hash, full_name, role, status, email_verified, created_at)
  VALUES (?,?,?,?,?,?,?,1,?)`);
const PWD = 'Lakstay@2026';
const hash = bcrypt.hashSync(PWD, 10);
const USERS = [
  { i: 1, email: 'admin@lakstay.vn', name: 'Nguyễn Minh Quân', role: 'admin', phone: '0908123456' },
  { i: 2, email: 'staff@lakstay.vn', name: 'Trần Thị Lan Anh', role: 'staff', phone: '0912345678' },
  { i: 3, email: 'le.tan@lakstay.vn', name: 'Phạm Đức Huy', role: 'staff', phone: '0913456789' },
  { i: 4, email: 'khach@example.com', name: 'Lê Hoàng Nam', role: 'customer', phone: '0987654321' },
  { i: 5, email: 'mai@example.com', name: 'Vũ Thị Mai', role: 'customer', phone: '0976543210' },
  { i: 6, email: 'demo@example.com', name: 'Khách Demo', role: 'customer', phone: '0901234567' },
];
for (const u of USERS) insUser.run(id('usr', u.i), u.email, u.phone, hash, u.name, u.role, 'active', addDays(-90 + u.i) + ' 08:00:00');

/* ===================== COUPONS ===================== */
const insCoupon = db.prepare(`
  INSERT OR REPLACE INTO coupons (id, code, type, value, max_discount, min_amount, starts_at, ends_at,
                                   usage_limit, per_user_limit, used_count, is_active)
  VALUES (?,?,?,?,?,?,?,?,?,?,0,1)`);
const stamp = (offsetDays) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 19).replace('T', ' ');
};
insCoupon.run(id('cpn', 1), 'DALAT10', 'PERCENT', 10, 500_000, 1_000_000, stamp(-30), stamp(120), 1000, 3);
insCoupon.run(id('cpn', 2), 'WELCOME200K', 'FIXED', 200_000, null, 1_500_000, stamp(-10), stamp(90), 500, 1);
insCoupon.run(id('cpn', 3), 'MUAHE15', 'PERCENT', 15, 1_000_000, 3_000_000, stamp(-5), stamp(60), 200, 2);
insCoupon.run(id('cpn', 4), 'HETHANG', 'PERCENT', 50, 300_000, 500_000, stamp(-60), stamp(-1), 100, 1);

/* ===================== SAMPLE BOOKINGS (qua service thật) ===================== */
const SAMPLES = [
  { u: 6, offset: 2,   nights: 2, rt: 2, qty: 1, guests: 2, coupon: null,         pay: true,  then: 'CONFIRMED' },
  { u: 4, offset: 6,   nights: 3, rt: 3, qty: 2, guests: 4, coupon: 'WELCOME200K',pay: true,  then: 'CONFIRMED' },
  { u: 5, offset: 11,  nights: 1, rt: 1, qty: 1, guests: 2, coupon: null,         pay: false, then: 'PENDING' },
  { u: 6, offset: 18,  nights: 4, rt: 5, qty: 1, guests: 2, coupon: null,         pay: true,  then: 'CONFIRMED' },
  { u: 4, offset: 30,  nights: 2, rt: 6, qty: 1, guests: 4, coupon: 'MUAHE15',    pay: true,  then: 'CONFIRMED' },
];

const made = [];
for (const s of SAMPLES) {
  try {
    const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id('usr', s.u));
    const checkIn = addDays(s.offset);
    const { booking } = createBooking({
      user, checkIn, checkOut: addDays(s.offset + s.nights), guests: s.guests,
      lines: [{ roomTypeId: id('rt', s.rt), qty: s.qty, guests: s.guests }],
      couponCode: s.coupon,
      guestName: user.full_name, guestPhone: user.phone, guestEmail: user.email,
      specialRequest: s.offset === 2 ? 'Xin phòng tầng cao, view thung lũng.' : null,
    }, { req: null });

    if (s.pay) {
      const { payment } = await createPayment({
        bookingId: booking.id, provider: 'VIETQR', userId: user.id,
        req: { user, headers: {} },
      });
      handlePaymentSuccess({
        txnRef: payment.txn_ref, amount: payment.amount,
        providerTxnId: `SEED${made.length + 1}`,
        rawPayload: { seed: true, note: 'Thanh toán mẫu' }, provider: 'VIETQR', req: null,
      });
      if (s.then === 'COMPLETED') {
        transitionBooking({ bookingId: booking.id, to: 'CHECKED_IN', actor: { id: user.id, role: 'staff' }, note: 'seed' });
        transitionBooking({ bookingId: booking.id, to: 'COMPLETED', actor: { id: user.id, role: 'staff' }, note: 'seed' });
      }
    }
    made.push({ code: booking.code, status: s.then, total: booking.total_amount, checkIn });
  } catch (err) {
    console.warn(`  ! seed booking ${s.offset}d failed: ${err.message}`);
  }
}

/* ===================== BOOKING LỊCH SỬ (đã hoàn tất) ===================== */
/**
 * Seed dữ liệu QUÁ KHỨ không thể đi qua createBooking (service sẽ chặn
 * "không thể đặt phòng trong quá khứ" — đúng nghiệp vụ).
 * => Ghi trực tiếp, nhưng VẪN tôn trọng mọi constraint của DB.
 * room_calendar KHÔNG được ghi vì kỳ nghỉ đã kết thúc (phòng đã nhả).
 */
const insBooking = db.prepare(`
  INSERT INTO bookings (id, code, user_id, status, check_in, check_out, nights, guests,
    guest_name, guest_phone, guest_email, currency, subtotal, discount_total, service_fee, tax,
    total_amount, price_breakdown, confirmed_at, checkin_at, checkout_at, created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
const insBookingRoom = db.prepare(`
  INSERT INTO booking_rooms (id, booking_id, room_type_id, qty, nights, unit_price, line_total, price_detail)
  VALUES (?,?,?,?,?,?,?,?)`);
const insPaymentHist = db.prepare(`
  INSERT INTO payments (id, booking_id, user_id, provider, type, status, amount, currency, txn_ref,
                        metadata, paid_at, created_at, updated_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const randCode = () => 'LKS-' + Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('');

const HISTORY = [
  { u: 4, offset: -45, nights: 2, rt: 1, qty: 1, guests: 2 },
  { u: 5, offset: -38, nights: 3, rt: 3, qty: 1, guests: 3 },
  { u: 6, offset: -30, nights: 1, rt: 2, qty: 1, guests: 2 },
  { u: 4, offset: -22, nights: 4, rt: 5, qty: 1, guests: 2 },
  { u: 5, offset: -15, nights: 2, rt: 4, qty: 1, guests: 4 },
  { u: 6, offset: -9,  nights: 2, rt: 6, qty: 1, guests: 4 },
  { u: 4, offset: -5,  nights: 3, rt: 2, qty: 2, guests: 4 },
  { u: 5, offset: -2,  nights: 1, rt: 1, qty: 1, guests: 1 },
];

const histMade = [];
for (const h of HISTORY) {
  const user = db.prepare(`SELECT * FROM users WHERE id = ?`).get(id('usr', h.u));
  const rt = db.prepare(`SELECT * FROM room_types WHERE id = ?`).get(id('rt', h.rt));
  const checkIn = addDays(h.offset), checkOut = addDays(h.offset + h.nights);

  const perNight = Math.round(rt.base_price * (h.offset % 3 === 0 ? 1.15 : 1));
  const subtotal = perNight * h.nights * h.qty;
  const serviceFee = Math.round(subtotal * 0.05 / 1000) * 1000;
  const tax = Math.round((subtotal + serviceFee) * 0.10 / 1000) * 1000;
  const total = subtotal + serviceFee + tax;

  const bookingId = newId('bkg');
  const created = `${checkIn} 09:${String(10 + h.u).padStart(2, '0')}:00`;
  insBooking.run(bookingId, randCode(), user.id, 'COMPLETED', checkIn, checkOut, h.nights, h.guests,
    user.full_name, user.phone, user.email, 'VND', subtotal, 0, serviceFee, tax, total,
    JSON.stringify([{ room_type_id: rt.id, room_type_name: rt.name_vi, qty: h.qty, nights: h.nights,
      subtotal, extra_guest_fee: 0, total: subtotal,
      per_night: Array.from({ length: h.nights }, (_, i) => ({
        date: addDays(h.offset + i), base_price: rt.base_price, multiplier: perNight / rt.base_price,
        weekend: false, weekend_surcharge: 0, unit_price: perNight, line_total: perNight * h.qty })) }]),
    `${checkIn} 10:00:00`, `${checkIn} 14:30:00`, `${checkOut} 11:45:00`, created);

  insBookingRoom.run(newId('blr'), bookingId, rt.id, h.qty, h.nights, perNight, subtotal, '[]');
  insPaymentHist.run(newId('pay'), bookingId, user.id, 'VIETQR', 'CHARGE', 'PAID', total, 'VND',
    newId('txn').toUpperCase().slice(0, 16), JSON.stringify({ historical: true }),
    `${checkIn} 10:05:00`, created, `${checkIn} 10:05:00`);

  histMade.push({ bookingId, userId: user.id, roomTypeId: rt.id, checkOut, rt: rt.name_vi, total });
}

/* ===================== REVIEWS ===================== */
const insReview = db.prepare(`
  INSERT INTO reviews (id, booking_id, user_id, room_type_id, rating, title, content, is_approved, created_at)
  VALUES (?,?,?,?,?,?,?,?,?)`);
const REVIEWS = [
  { r: 5, t: 'Phòng gỗ ấm áp, y hệt ảnh chụp', c: 'Phòng ốp gỗ sáng rất sạch và ấm, gương tròn cảm ứng đẹp, giường 1m8 êm. Nhân viên nhiệt tình, check-in nhanh gọn.' },
  { r: 4, t: 'Bồn tắm hướng vườn cực thư giãn', c: 'Thích nhất là bồn tắm nằm ngay cạnh cửa sổ nhìn ra mảng cây xanh bên ngoài. Vị trí thuận tiện đi dạo phố núi buổi tối.' },
  { r: 5, t: 'Ban công đón nắng sáng rất thơ', c: 'Ngồi uống trà bên bộ bàn gỗ cạnh rèm voan trắng buổi sáng rất chill. Phòng Deluxe rộng rãi, nước nóng mạnh.' },
  { r: 5, t: 'Ban công nhìn ra Hồ Xuân Hương đẹp mê', c: 'Phòng Deluxe Suite có sofa da ngồi đọc sách cực thích, bước ra ban công là thấy mặt nước Hồ Xuân Hương và mái ngói Đà Lạt.' },
  { r: 5, t: 'Phòng gia đình 2 giường 1m8 quá thoải mái', c: 'Đi gia đình 4 người ở phòng 2 giường đôi 1m8 rất rộng, hệ tủ gỗ kịch trần để đồ thoải mái, phòng tắm có cả bồn tắm nằm.' },
  { r: 5, t: 'Grand Suite nhìn thẳng rừng thông xuất sắc', c: 'Ấn tượng nhất là bồn tắm nằm sát khung kính lớn mở thẳng ra rặng thông xanh ngắt và vách đá cẩm thạch sang trọng.' },
  { r: 4, t: 'Kỳ nghỉ trọn vẹn tại Đà Lạt', c: 'Lần thứ 2 quay lại LakStay và vẫn rất hài lòng từ chất lượng phòng ốc đúng ảnh thực tế đến sự chu đáo của lễ tân.' },
];
// Booking cuối cùng giữ lại để làm review "chờ duyệt" (demo tính năng moderation)
const reviewed = histMade.slice(0, -1);
reviewed.forEach((h, i) => {
  const rv = REVIEWS[i % REVIEWS.length];
  insReview.run(id('rev', i + 1), h.bookingId, h.userId, h.roomTypeId, rv.r, rv.t, rv.c, 1, `${h.checkOut} 20:15:00`);
});
const pendingReview = histMade[histMade.length - 1];
if (pendingReview) {
  insReview.run(id('rev', 'pending'), pendingReview.bookingId, pendingReview.userId, pendingReview.roomTypeId,
    2, 'Cần xem lại', 'Phòng hơi cũ so với ảnh chụp. Đã phản ánh với lễ tân và được giảm giá một phần.',
    0, `${pendingReview.checkOut} 21:00:00`);
}

/* ===================== AUDIT mẫu ===================== */
const insAudit = db.prepare(`INSERT OR REPLACE INTO audit_logs (id, actor_id, actor_role, action, entity_type, entity_id, after_data, created_at)
  VALUES (?,?,?,?,?,?,?,?)`);
insAudit.run(newId('aud'), id('usr', 1), 'admin', 'SYSTEM_SEEDED', 'system', null,
  JSON.stringify({ bookings: made.length }), stamp(0));

/* ===================== SUMMARY ===================== */
if (!silent) {
  const count = (t) => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║  ✓ SEED HOÀN TẤT                                                  ║
╚═══════════════════════════════════════════════════════════════════╝
  room_types  : ${String(count('room_types')).padStart(4)}      bookings      : ${String(count('bookings')).padStart(4)}
  rooms       : ${String(count('rooms')).padStart(4)}      room_calendar : ${String(count('room_calendar')).padStart(4)}
  price_rules : ${String(count('price_rules')).padStart(4)}      payments      : ${String(count('payments')).padStart(4)}
  users       : ${String(count('users')).padStart(4)}      reviews       : ${String(count('reviews')).padStart(4)}
  coupons     : ${String(count('coupons')).padStart(4)}

  ── TÀI KHOẢN DEMO (mật khẩu chung: ${PWD}) ──────────────────────
    admin@lakstay.vn    →  Quản trị toàn quyền
    staff@lakstay.vn    →  Lễ tân / vận hành
    khach@example.com   →  Khách hàng
    demo@example.com    →  Khách hàng

  ── COUPON ────────────────────────────────────────────────────────
    DALAT10      giảm 10% (tối đa 500.000₫, đơn từ 1.000.000₫)
    WELCOME200K  giảm 200.000₫ (đơn từ 1.500.000₫)
    MUAHE15      giảm 15% (tối đa 1.000.000₫, đơn từ 3.000.000₫)
    HETHANG      đã hết hạn — dùng để test validation

  ── BOOKING MẪU ───────────────────────────────────────────────────
${made.map((m) => `    ${m.code}  ${m.status.padEnd(10)} ${m.checkIn}  ${m.total.toLocaleString('vi-VN')}₫`).join('\n')}
`);
}
}

const isDirectRun = Boolean(process.argv[1]) && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isDirectRun) {
  await seedDatabase();
  db.close();
}
