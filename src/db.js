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
        const EN = {
          'standard-pine': 'A cosy room wrapped in pine-green tones, with a reading nook by the window and a view of the mist rolling over the treetops.',
          'deluxe-valley': 'Spacious deluxe room facing the valley, floor-to-ceiling windows, a deep bathtub and a private balcony for morning coffee.',
          'premium-garden': 'Ground-floor retreat opening onto a private garden, ideal for couples who love plants and quiet evenings outdoors.',
          'family-suite': 'Two-bedroom suite with a living area, kitchenette and board games — built for families and small groups.',
          'executive-lake': 'Executive corner room with panoramic lake view, a work desk, espresso machine and lounge access.',
          'presidential-villa': 'The flagship villa: private heated pool, sauna, butler service and a 360° view of Da Lat’s hills and forests.',
        };
        const upd = db.prepare(`UPDATE room_types SET description_en = ? WHERE slug = ?`);
        for (const [slug, text] of Object.entries(EN)) upd.run(text, slug);
      }
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
