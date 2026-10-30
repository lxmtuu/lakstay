-- =============================================================================
--  LakStay Booking System — SCHEMA
--  Thiết kế có chủ đích: mọi ràng buộc nghiệp vụ QUAN TRỌNG đều được đẩy xuống
--  tầng DATABASE (constraint) thay vì chỉ kiểm tra ở tầng application.
--  Lý do: application code có thể bị bug / bị race condition / bị bypass,
--         còn DB constraint thì KHÔNG.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- -----------------------------------------------------------------------------
-- 1. USERS & RBAC
--    role: customer (đặt phòng) | staff (vận hành) | admin (toàn quyền)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,                    -- usr_xxx (UUID-like, không lộ số lượng user)
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE, -- UNIQUE => chống đăng ký trùng ngay ở DB
  phone           TEXT UNIQUE,
  password_hash   TEXT NOT NULL,                       -- KHÔNG BAO GIỜ lưu plain text
  full_name       TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'customer'
                  CHECK (role IN ('customer','staff','admin')),
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','suspended','deleted')),
  email_verified  INTEGER NOT NULL DEFAULT 0,
  failed_logins   INTEGER NOT NULL DEFAULT 0,          -- chống brute-force
  locked_until    TEXT,                                -- ISO timestamp
  last_login_at   TEXT,
  last_login_ip   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Refresh token: lưu HASH của token, không lưu token thô (nếu DB leak vẫn an toàn)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    TEXT NOT NULL UNIQUE,
  user_agent    TEXT,
  ip            TEXT,
  expires_at    TEXT NOT NULL,
  revoked_at    TEXT,
  replaced_by   TEXT,          -- hỗ trợ rotation & reuse detection
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

-- -----------------------------------------------------------------------------
-- 2. ROOM TYPES & ROOMS
--    Tách "loại phòng" (bán hàng, giá, mô tả) khỏi "phòng vật lý" (tồn kho).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_types (
  id                TEXT PRIMARY KEY,
  slug              TEXT NOT NULL UNIQUE,
  name              TEXT NOT NULL,
  name_vi           TEXT NOT NULL,
  description_en    TEXT,                      -- i18n: mô tả tiếng Anh
  description       TEXT,
  capacity          INTEGER NOT NULL CHECK (capacity > 0),
  bed_type          TEXT NOT NULL,
  size_m2           INTEGER NOT NULL CHECK (size_m2 > 0),
  base_price        INTEGER NOT NULL CHECK (base_price >= 0),   -- VND / đêm
  total_rooms       INTEGER NOT NULL CHECK (total_rooms >= 0),  -- denormalized, sync bằng trigger
  amenities         TEXT NOT NULL DEFAULT '[]',                 -- JSON array
  images            TEXT NOT NULL DEFAULT '[]',                 -- JSON array
  -- CHÍNH SÁCH HUỶ (theo loại phòng, đúng nghiệp vụ khách sạn)
  cancel_free_hours INTEGER NOT NULL DEFAULT 48,   -- huỷ miễn phí trước X giờ
  cancel_penalty_pct INTEGER NOT NULL DEFAULT 50,  -- sau mốc free => phạt Y% đêm đầu
  cancel_no_refund_hours INTEGER NOT NULL DEFAULT 24, -- sát ngày => mất 100%
  min_stay          INTEGER NOT NULL DEFAULT 1,
  max_stay          INTEGER NOT NULL DEFAULT 30,
  max_advance_days  INTEGER NOT NULL DEFAULT 365,  -- không cho đặt quá xa
  version           INTEGER NOT NULL DEFAULT 1,    -- OPTIMISTIC LOCKING
  is_active         INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS rooms (
  id            TEXT PRIMARY KEY,
  room_type_id  TEXT NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  room_number   TEXT NOT NULL,
  floor         INTEGER NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'available'
                CHECK (status IN ('available','maintenance','blocked')),
  version       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (room_type_id, room_number)   -- không trùng số phòng trong cùng loại
);
CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms(room_type_id);

-- Trigger giữ total_rooms LUÔN đúng (single source of truth = bảng rooms)
CREATE TRIGGER IF NOT EXISTS trg_rooms_count_ai AFTER INSERT ON rooms BEGIN
  UPDATE room_types SET total_rooms = (SELECT COUNT(*) FROM rooms WHERE room_type_id = NEW.room_type_id)
  WHERE id = NEW.room_type_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_rooms_count_ad AFTER DELETE ON rooms BEGIN
  UPDATE room_types SET total_rooms = (SELECT COUNT(*) FROM rooms WHERE room_type_id = OLD.room_type_id)
  WHERE id = OLD.room_type_id;
END;
CREATE TRIGGER IF NOT EXISTS trg_rooms_count_au AFTER UPDATE OF room_type_id ON rooms BEGIN
  UPDATE room_types SET total_rooms = (SELECT COUNT(*) FROM rooms WHERE room_type_id = OLD.room_type_id)
  WHERE id = OLD.room_type_id;
  UPDATE room_types SET total_rooms = (SELECT COUNT(*) FROM rooms WHERE room_type_id = NEW.room_type_id)
  WHERE id = NEW.room_type_id;
END;

-- Giá theo mùa / theo ngày cụ thể (override base_price)
CREATE TABLE IF NOT EXISTS price_rules (
  id            TEXT PRIMARY KEY,
  room_type_id  TEXT NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  start_date    TEXT NOT NULL,           -- YYYY-MM-DD
  end_date      TEXT NOT NULL,           -- inclusive
  multiplier    REAL NOT NULL DEFAULT 1.0 CHECK (multiplier > 0),
  priority      INTEGER NOT NULL DEFAULT 10,
  days_of_week  TEXT,                    -- JSON [0..6] hoặc NULL = mọi ngày
  CHECK (end_date >= start_date)         -- DB tự chặn rule sai
);
CREATE INDEX IF NOT EXISTS idx_price_rules_type ON price_rules(room_type_id, start_date, end_date);

-- -----------------------------------------------------------------------------
-- 3. BOOKING
--    Booking là "header", booking_rooms là "line items" (1 booking đặt nhiều loại phòng)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bookings (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,          -- mã đọc được: LKS-8F3K2Q
  user_id           TEXT NOT NULL REFERENCES users(id),
  status            TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','CONFIRMED','CHECKED_IN','COMPLETED','CANCELLED','NO_SHOW','EXPIRED','REFUNDED')),
  check_in          TEXT NOT NULL,                 -- YYYY-MM-DD
  check_out         TEXT NOT NULL,                 -- YYYY-MM-DD
  nights            INTEGER NOT NULL CHECK (nights > 0),
  guests            INTEGER NOT NULL CHECK (guests > 0),
  guest_name        TEXT NOT NULL,
  guest_phone       TEXT NOT NULL,
  guest_email       TEXT NOT NULL,
  special_request   TEXT,

  -- PRICE SNAPSHOT: giá tại thời điểm đặt, KHÔNG tính lại sau này (bất biến)
  currency          TEXT NOT NULL DEFAULT 'VND',
  subtotal          INTEGER NOT NULL CHECK (subtotal >= 0),
  discount_total    INTEGER NOT NULL DEFAULT 0,
  member_discount   INTEGER NOT NULL DEFAULT 0,  -- ưu đãi hạng thành viên (loyalty)
  service_fee       INTEGER NOT NULL DEFAULT 0,
  tax               INTEGER NOT NULL DEFAULT 0,
  total_amount      INTEGER NOT NULL CHECK (total_amount >= 0),
  price_breakdown   TEXT NOT NULL,                 -- JSON chi tiết từng đêm

  coupon_code       TEXT,
  coupon_id         TEXT,

  -- Idempotency: client gửi lại request => không tạo booking trùng
  idempotency_key   TEXT UNIQUE,

  hold_expires_at   TEXT,                          -- TTL của booking PENDING
  confirmed_at      TEXT,
  cancelled_at      TEXT,
  cancel_reason     TEXT,
  cancelled_by      TEXT,
  checkin_at        TEXT,
  checkout_at       TEXT,
  version           INTEGER NOT NULL DEFAULT 1,    -- optimistic locking
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (check_out > check_in)                     -- DB tự chặn ngày sai
);
CREATE INDEX IF NOT EXISTS idx_bookings_user    ON bookings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_status  ON bookings(status, hold_expires_at);
CREATE INDEX IF NOT EXISTS idx_bookings_dates   ON bookings(check_in, check_out);

CREATE TABLE IF NOT EXISTS booking_rooms (
  id            TEXT PRIMARY KEY,
  booking_id    TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  room_type_id  TEXT NOT NULL REFERENCES room_types(id),
  qty           INTEGER NOT NULL CHECK (qty > 0),
  unit_price    INTEGER NOT NULL,
  nights        INTEGER NOT NULL,
  line_total    INTEGER NOT NULL,
  price_detail  TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_booking_rooms_booking ON booking_rooms(booking_id);

-- =============================================================================
-- 4. *** CHỐNG DOUBLE BOOKING — LỚP BẢO VỆ MẠNH NHẤT ***
--    room_calendar: 1 dòng = 1 phòng vật lý × 1 đêm.
--    PRIMARY KEY (room_id, stay_date) => về mặt vật lý KHÔNG THỂ có 2 booking
--    cùng giữ 1 phòng trong 1 đêm, dù có 10.000 request đồng thời.
-- =============================================================================
CREATE TABLE IF NOT EXISTS room_calendar (
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  stay_date   TEXT NOT NULL,                 -- YYYY-MM-DD
  booking_id  TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  room_type_id TEXT NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  status      TEXT NOT NULL DEFAULT 'HELD'
              CHECK (status IN ('HELD','CONFIRMED','BLOCKED')),
  locked_at   TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, stay_date)           -- <<< CONSTRAINT CHỐNG DOUBLE BOOKING
);
CREATE INDEX IF NOT EXISTS idx_calendar_booking ON room_calendar(booking_id);
CREATE INDEX IF NOT EXISTS idx_calendar_date    ON room_calendar(stay_date, room_type_id);

-- Chặn phòng theo ngày (bảo trì, đoàn VIP, overbooking phòng thủ)
-- PK (room_id, block_date) => 1 phòng 1 đêm chỉ có 1 lý do chặn
CREATE TABLE IF NOT EXISTS room_blocks (
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  block_date  TEXT NOT NULL,
  reason      TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (room_id, block_date)
);
CREATE INDEX IF NOT EXISTS idx_blocks_date ON room_blocks(block_date);

-- -----------------------------------------------------------------------------
-- 5. PAYMENTS  (1 booking có thể nhiều lần: đặt cọc, thanh toán nốt, refund)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
  id                TEXT PRIMARY KEY,
  booking_id        TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id           TEXT NOT NULL REFERENCES users(id),
  provider          TEXT NOT NULL CHECK (provider IN ('VIETQR','MOMO','VNPAY','CASH','CARD','MANUAL')),
  type              TEXT NOT NULL DEFAULT 'CHARGE' CHECK (type IN ('CHARGE','REFUND')),
  status            TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','PAID','FAILED','EXPIRED','REFUNDED')),
  amount            INTEGER NOT NULL CHECK (amount > 0),
  currency          TEXT NOT NULL DEFAULT 'VND',
  -- Mã giao dịch nội bộ dùng làm "nội dung chuyển khoản" => reconcile tự động
  txn_ref           TEXT NOT NULL UNIQUE,
  provider_txn_id   TEXT UNIQUE,             -- idempotency phía gateway (webhook gọi 2 lần vẫn an toàn)
  qr_payload        TEXT,                    -- chuỗi EMVCo VietQR
  qr_image          TEXT,                    -- data URI / URL
  bank_bin          TEXT,
  bank_account      TEXT,
  bank_account_name TEXT,
  metadata          TEXT NOT NULL DEFAULT '{}',
  idempotency_key   TEXT UNIQUE,
  paid_at           TEXT,
  expired_at        TEXT,
  refunded_amount   INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_booking ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_status  ON payments(status, expired_at);

-- Webhook log: ghi lại RAW payload để debug + replay
CREATE TABLE IF NOT EXISTS payment_webhook_logs (
  id            TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  event_id      TEXT,
  payload       TEXT NOT NULL,
  signature     TEXT,
  processed     INTEGER NOT NULL DEFAULT 0,
  error         TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_webhook_event ON payment_webhook_logs(provider, event_id);

-- -----------------------------------------------------------------------------
-- 6. COUPONS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coupons (
  id             TEXT PRIMARY KEY,
  code           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  type           TEXT NOT NULL CHECK (type IN ('PERCENT','FIXED')),
  value          INTEGER NOT NULL CHECK (value > 0),
  max_discount   INTEGER,                    -- trần giảm giá cho PERCENT
  min_amount     INTEGER NOT NULL DEFAULT 0,
  starts_at      TEXT NOT NULL,
  ends_at        TEXT NOT NULL,
  usage_limit    INTEGER,                    -- NULL = không giới hạn
  per_user_limit INTEGER NOT NULL DEFAULT 1,
  used_count     INTEGER NOT NULL DEFAULT 0,
  is_active      INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (ends_at >= starts_at)
);
CREATE TABLE IF NOT EXISTS coupon_usages (
  id          TEXT PRIMARY KEY,
  coupon_id   TEXT NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id  TEXT REFERENCES bookings(id) ON DELETE SET NULL,
  discount    INTEGER NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (coupon_id, booking_id)
);

-- -----------------------------------------------------------------------------
-- 7. REVIEWS (chỉ người ĐÃ HOÀN THÀNH booking mới được đánh giá)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reviews (
  id            TEXT PRIMARY KEY,
  booking_id    TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_type_id  TEXT NOT NULL REFERENCES room_types(id) ON DELETE CASCADE,
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title         TEXT,
  content       TEXT NOT NULL,
  is_approved   INTEGER NOT NULL DEFAULT 1,
  owner_reply   TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (booking_id, room_type_id)          -- 1 booking chỉ review 1 lần / loại phòng
);
CREATE INDEX IF NOT EXISTS idx_reviews_type ON reviews(room_type_id, is_approved);

-- -----------------------------------------------------------------------------
-- 8. AUDIT LOG — bắt buộc với hệ thống có tiền & quyền
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  actor_id    TEXT,
  actor_role  TEXT,
  action      TEXT NOT NULL,                 -- BOOKING_CREATED, PAYMENT_PAID, ...
  entity_type TEXT,
  entity_id   TEXT,
  before_data TEXT,
  after_data  TEXT,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor  ON audit_logs(actor_id, created_at DESC);

-- Security events (login fail, rate limit hit, CSRF blocked...)
CREATE TABLE IF NOT EXISTS security_events (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  severity    TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warn','critical')),
  ip          TEXT,
  user_agent  TEXT,
  email       TEXT,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sec_type ON security_events(type, created_at DESC);

/* ------------------------------------------------------------------ */
/*  LOYALTY — chương trình thành viên                                  */
/* ------------------------------------------------------------------ */
CREATE TABLE IF NOT EXISTS loyalty_accounts (
  user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier           TEXT NOT NULL DEFAULT 'MEMBER',       -- MEMBER/SILVER/GOLD/PLATINUM
  points         INTEGER NOT NULL DEFAULT 0,           -- 1 điểm / 10.000đ thực trả
  lifetime_spend INTEGER NOT NULL DEFAULT 0,           -- tổng chi tiêu (trừ refund) => xét hạng
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  booking_id    TEXT REFERENCES bookings(id) ON DELETE SET NULL,
  type          TEXT NOT NULL CHECK (type IN ('EARN','REVOKE','ADJUST')),
  points        INTEGER NOT NULL,                      -- có dấu (+cộng / −trừ)
  balance_after INTEGER NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
-- IDEMPOTENCY: mỗi booking chỉ EARN 1 lần, REVOKE 1 lần (webhook lặp không nhân điểm)
CREATE UNIQUE INDEX IF NOT EXISTS ux_loyalty_booking_type ON loyalty_transactions(booking_id, type);
CREATE INDEX IF NOT EXISTS idx_loyalty_user ON loyalty_transactions(user_id, created_at DESC);
