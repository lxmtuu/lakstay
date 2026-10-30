import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config/index.js';
import { logger } from './utils/logger.js';
import { fromHere } from './utils/paths.js';

const dbFile = config.db.file;
fs.mkdirSync(path.dirname(dbFile), { recursive: true });

export const db = new Database(dbFile);

// WAL: cho phép đọc song song trong khi đang ghi — cần cho hệ booking có traffic
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');       // BẮT BẬT, nếu không FK chỉ là "trang trí"
db.pragma('busy_timeout = 5000');     // chờ lock thay vì fail ngay
db.pragma('cache_size = -16000');

/** Khởi tạo schema từ file SQL (idempotent: CREATE IF NOT EXISTS) */
export function initSchema() {
  const schemaPath = fromHere(import.meta.url, '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  db.exec(sql);
  migrate();
  logger.info('DB schema ensured', { file: dbFile });
}

/**
 * Migration tối giản cho DB đã tồn tại từ phiên bản cũ.
 * (Prod thật sẽ dùng bảng schema_migrations + file migrate đánh số.)
 */
const ROOM_EN_DESCRIPTIONS = {
  'standard-pine': 'Warm 20m² room crafted in light oak, slatted wood panelling and natural stone accents, featuring a plush 1.8m double bed, touch-lit round vanity desk and full modern amenities.',
  'deluxe-valley': 'Sunlit 26m² deluxe room with floor-to-ceiling sheer-curtained glass doors opening onto a breezy balcony, complete with a wooden tea set for two and a private soaking bathtub.',
  'premium-garden': 'Light-filled 32m² retreat overlooking lush greenery with a wrought-iron balcony, dual window-side desk and an open-plan bathroom featuring a soaking tub right beside the window.',
  'family-suite': 'Spacious 35m² family room with two plush 1.8m double beds, full-height multi-bay wooden wardrobes, an extended LED vanity desk, airy balcony and a bathroom with soaking tub.',
  'executive-lake': 'Elegant 45m² corner suite dressed in dark walnut, featuring a classic Chesterfield leather sofa, glass display cabinet, dedicated work desk and a wrought-iron balcony overlooking Xuan Huong Lake and hillside villas.',
  'presidential-villa': 'Our signature 52m² flagship suite highlighted by a backlit marble feature wall, two luxury 1.8m double beds, panoramic corner windows and a statement soaking tub looking straight into Da Lat’s lush pine forest.',
};

function backfillRoomDescriptionsEn() {
  const upd = db.prepare(`UPDATE room_types SET description_en = ? WHERE slug = ? AND (description_en IS NULL OR description_en = '')`);
  for (const [slug, text] of Object.entries(ROOM_EN_DESCRIPTIONS)) upd.run(text, slug);
}

const ROOM_GALLERY_IMAGES = {
  'standard-pine': ['/img/room-standard.jpg', '/img/rooms/double-4.jpg', '/img/rooms/double-3.jpg', '/img/rooms/superior-1.jpg'],
  'deluxe-valley': ['/img/room-deluxe.jpg', '/img/rooms/balcony-1.jpg', '/img/rooms/balcony-3.jpg', '/img/rooms/balcony-4.jpg'],
  'premium-garden': ['/img/room-premium.jpg', '/img/rooms/garden-suite-3.jpg', '/img/rooms/bathtub-1.jpg', '/img/rooms/bathtub-2.jpg'],
  'family-suite': ['/img/room-family.jpg', '/img/rooms/family-balcony-1.jpg', '/img/rooms/family-balcony-4.jpg', '/img/rooms/family-window-1.jpg'],
  'executive-lake': ['/img/room-executive.jpg', '/img/rooms/suite-balcony-4.jpg', '/img/rooms/suite-balcony-3.jpg', '/img/rooms/deluxe-window-2.jpg'],
  'presidential-villa': ['/img/room-villa.jpg', '/img/rooms/family-garden-1.jpg', '/img/rooms/family-garden-4.jpg', '/img/rooms/bathtub-3.jpg'],
};

const ROOM_CATALOG_CONTENT = {
  'standard-pine': {
    name: 'Superior Cozy Double', nameVi: 'Phòng Superior Đôi Ấm Cúng',
    description: 'Không gian 20m² ấm cúng với tông gỗ sáng kết hợp vách lam gỗ và vân đá tự nhiên. Trang bị giường đôi 1m8 đầu giường bọc da êm ái, bàn trang điểm gương tròn LED cảm ứng và đầy đủ tiện nghi cho cặp đôi hoặc khách công tác.',
    capacity: 2, bed: '1 giường đôi 1m8', size: 20, price: 890_000,
    amenities: ['Wifi tốc độ cao', 'Điều hoà âm trần', 'Bàn trang điểm gương LED', 'Nước nóng 24/7', 'Minibar', 'Ấm siêu tốc', 'Máy sấy tóc', 'Khóa thẻ từ'],
  },
  'deluxe-valley': {
    name: 'Deluxe Double with Balcony', nameVi: 'Phòng Deluxe Ban Công',
    description: 'Phòng 26m² thoáng sáng với hệ cửa kính sát trần phủ rèm voan trắng mở ra ban công đón nắng sớm Đà Lạt. Có bộ bàn trà gỗ đôi cạnh cửa sổ, tủ âm tường cỡ lớn và phòng tắm riêng tích hợp bồn tắm nằm thư giãn.',
    capacity: 2, bed: '1 giường đôi 1m8', size: 26, price: 1_390_000,
    amenities: ['Ban công riêng', 'Bồn tắm nằm', 'Bàn trà đôi cạnh cửa sổ', 'Wifi tốc độ cao', 'TV thông minh', 'Điều hoà âm trần', 'Minibar', 'Khóa thẻ từ', 'Trà & cà phê'],
  },
  'premium-garden': {
    name: 'Premium Garden Bathtub', nameVi: 'Phòng Premium Bồn Tắm Hướng Vườn',
    description: 'Phòng nghỉ 32m² ngập tràn ánh sáng tự nhiên với khung cửa sổ đôi nhìn ra rặng cây xanh mát và ban công lan can sắt cổ điển. Điểm nhấn là không gian phòng tắm mở có bồn tắm nằm đặt ngay cạnh cửa sổ để ngâm mình thư giãn.',
    capacity: 3, bed: '1 giường đôi 1m8', size: 32, price: 1_790_000,
    amenities: ['Hướng vườn cây xanh', 'Bồn tắm nằm cạnh cửa sổ', 'Ban công riêng', 'Bàn làm việc hướng vườn', 'Wifi tốc độ cao', 'TV 50"', 'Điều hoà âm trần', 'Minibar', 'Trà & cà phê'],
  },
  'family-suite': {
    name: 'Family Room with Balcony', nameVi: 'Phòng Gia Đình Ban Công',
    description: 'Phòng gia đình rộng 35m² bố trí 2 giường đôi 1m8 êm ái cho 4 người lớn và trẻ nhỏ. Trang bị hệ tủ gỗ kịch trần nhiều ngăn, bàn trang điểm dài kèm gương LED, ban công thoáng gió và phòng tắm có bồn tắm nằm.',
    capacity: 4, bed: '2 giường đôi 1m8', size: 35, price: 2_290_000,
    amenities: ['2 giường đôi 1m8', 'Ban công riêng', 'Bồn tắm nằm', 'Hệ tủ gỗ kịch trần', 'Bàn trang điểm gương LED', 'Wifi tốc độ cao', 'TV 55"', 'Điều hoà âm trần', 'Minibar'],
  },
  'executive-lake': {
    name: 'Deluxe Lake & Town Suite', nameVi: 'Deluxe Suite Ban Công Hướng Hồ',
    description: 'Suite góc rộng 45m² mang phong cách cổ điển ấm lịch lãm với gỗ trầm, ghế sofa da Chesterfield tiếp khách, hệ tủ kính trưng bày và bàn làm việc riêng. Ban công sắt mỹ thuật mở ra tầm nhìn thoáng đãng về phía Hồ Xuân Hương và mái ngói phố núi.',
    capacity: 2, bed: '1 giường King 1m8 + Sofa da', size: 45, price: 2_890_000,
    amenities: ['View hồ Xuân Hương', 'Ban công sắt mỹ thuật', 'Sofa da Chesterfield', 'Bàn làm việc riêng', 'Tủ rượu cánh kính', 'Wifi tốc độ cao', 'TV 55"', 'Điều hoà âm trần', 'Minibar'],
  },
  'presidential-villa': {
    name: 'Grand Pine Forest Suite', nameVi: 'Grand Suite Bồn Tắm Rừng Thông',
    description: 'Hạng Suite cao cấp nhất rộng 52m² nổi bật với vách đá cẩm thạch hắt sáng, 2 giường đôi 1m8 êm ái và hệ cửa kính góc toàn cảnh. Đặc biệt sở hữu bồn tắm nằm lớn đặt ngay khung cửa sổ mở thẳng ra rặng thông xanh rì đặc trưng của Đà Lạt.',
    capacity: 4, bed: '2 giường đôi 1m8 cao cấp', size: 52, price: 3_690_000,
    amenities: ['View rừng thông toàn cảnh', 'Bồn tắm panorama rừng thông', '2 giường đôi 1m8', 'Vách đá cẩm thạch hắt sáng', 'Ban công góc rộng', 'Bàn trà đôi đón nắng', 'Wifi tốc độ cao', 'TV 65"', 'Điều hoà âm trần'],
  },
};

function syncBrumeRoomContent() {
  const upd = db.prepare(`
    UPDATE room_types
    SET name = ?, name_vi = ?, description = ?, description_en = ?,
        capacity = ?, bed_type = ?, size_m2 = ?, base_price = ?, amenities = ?, images = ?
    WHERE slug = ?`);
  for (const [slug, c] of Object.entries(ROOM_CATALOG_CONTENT)) {
    upd.run(
      c.name, c.nameVi, c.description, ROOM_EN_DESCRIPTIONS[slug],
      c.capacity, c.bed, c.size, c.price,
      JSON.stringify(c.amenities), JSON.stringify(ROOM_GALLERY_IMAGES[slug]),
      slug,
    );
  }
}

function backfillRoomImages() {
  const sel = db.prepare(`SELECT slug, images FROM room_types WHERE slug = ?`);
  const upd = db.prepare(`UPDATE room_types SET images = ? WHERE slug = ?`);
  for (const [slug, gallery] of Object.entries(ROOM_GALLERY_IMAGES)) {
    const row = sel.get(slug);
    if (!row) continue;
    let cur = [];
    try { cur = JSON.parse(row.images || '[]'); } catch { cur = []; }
    if (!Array.isArray(cur) || cur.length <= 1) {
      upd.run(JSON.stringify(gallery), slug);
    }
  }
}

const MIGRATIONS = [
  { id: '20260915_coupons_created_at', run: () => {
      const cols = db.prepare(`PRAGMA table_info(coupons)`).all().map((c) => c.name);
      if (!cols.includes('created_at')) {
        // SQLite không cho ADD COLUMN với default không phải hằng số => dùng hằng số rồi backfill
        db.exec(`ALTER TABLE coupons ADD COLUMN created_at TEXT NOT NULL DEFAULT ''`);
        db.exec(`UPDATE coupons SET created_at = COALESCE(starts_at, datetime('now')) WHERE created_at = ''`);
      }
    } },
  { id: '20260915_room_blocks', run: () => {
      const t = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='room_blocks'`).get();
      if (!t) db.exec(`CREATE TABLE room_blocks (room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        block_date TEXT NOT NULL, reason TEXT NOT NULL, created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (room_id, block_date))`);
    } },
  { id: '20260915_loyalty', run: () => {
      db.exec(`CREATE TABLE IF NOT EXISTS loyalty_accounts (
        user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        tier           TEXT NOT NULL DEFAULT 'MEMBER',
        points         INTEGER NOT NULL DEFAULT 0,
        lifetime_spend INTEGER NOT NULL DEFAULT 0,
        updated_at     TEXT NOT NULL DEFAULT (datetime('now')))`);
      db.exec(`CREATE TABLE IF NOT EXISTS loyalty_transactions (
        id            TEXT PRIMARY KEY,
        user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        booking_id    TEXT REFERENCES bookings(id) ON DELETE SET NULL,
        type          TEXT NOT NULL CHECK (type IN ('EARN','REVOKE','ADJUST')),
        points        INTEGER NOT NULL,
        balance_after INTEGER NOT NULL,
        note          TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL DEFAULT (datetime('now')))`);
      // Mỗi booking chỉ EARN 1 lần / REVOKE 1 lần => chống nhân điểm khi webhook lặp
      db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ux_loyalty_booking_type
               ON loyalty_transactions(booking_id, type)`);
      const cols = db.prepare(`PRAGMA table_info(bookings)`).all().map((c) => c.name);
      if (!cols.includes('member_discount')) {
        db.exec(`ALTER TABLE bookings ADD COLUMN member_discount INTEGER NOT NULL DEFAULT 0`);
      }
    } },
  { id: '20260915_i18n_rooms', run: () => {
      const cols = db.prepare(`PRAGMA table_info(room_types)`).all().map((c) => c.name);
      if (!cols.includes('description_en')) {
        db.exec(`ALTER TABLE room_types ADD COLUMN description_en TEXT`);
      }
      backfillRoomDescriptionsEn();
    } },
  { id: '20261030_i18n_rooms_backfill', run: () => {
      backfillRoomDescriptionsEn();
    } },
  { id: '20261030_brume_room_images', run: () => {
      backfillRoomImages();
    } },
  { id: '20261030_brume_room_content', run: () => {
      syncBrumeRoomContent();
    } },
];

function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (datetime('now')))`);
  const done = new Set(db.prepare(`SELECT id FROM schema_migrations`).all().map((r) => r.id));
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    try {
      withTransaction(() => { m.run(); db.prepare(`INSERT INTO schema_migrations (id) VALUES (?)`).run(m.id); });
      logger.info('migration applied', { id: m.id });
    } catch (err) { logger.error('migration failed', { id: m.id, err: err.message }); }
  }
}

/**
 * TRANSACTION wrapper.
 *
 * Điểm mấu chốt chống double-booking: dùng `BEGIN IMMEDIATE`.
 *  - BEGIN thường (DEFERRED) chỉ lấy SHARED lock lúc đọc, tới lúc ghi mới nâng lên
 *    EXCLUSIVE => 2 transaction có thể cùng đọc "còn phòng" rồi cùng ghi => race.
 *  - BEGIN IMMEDIATE lấy RESERVED lock NGAY từ đầu => writer thứ 2 phải CHỜ,
 *    đọc lại trạng thái mới nhất. Đây là "serializable" cho luồng ghi.
 */
export function withTransaction(fn, { immediate = true } = {}) {
  if (db.inTransaction) return fn(db); // nested: dùng chung transaction ngoài
  db.exec(immediate ? 'BEGIN IMMEDIATE' : 'BEGIN');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  }
}

export default db;
