# 🏗 Kiến trúc hệ thống (Architecture)

Tài liệu giải thích **vì sao** hệ thống được thiết kế như hiện tại — phần thể hiện tư duy backend.

---

## 1. Tổng quan

```
            ┌────────────────────────── Browser (SPA vanilla JS) ─────────────────────────┐
            │  index.html (khách)            admin.html (quản trị)                          │
            │  js/api.js  → fetch + CSRF + idempotency-key + retry                         │
            └───────────────┬───────────────────────────────┬──────────────────────────────┘
                            │ HTTPS (JSON, cookie httpOnly) │
            ┌───────────────▼───────────────────────────────▼──────────────────────────────┐
            │                        Express app (src/app.js)                              │
            │  helmet/CSP → json(rawBody) → cookies → requestContext → CORS → rateLimit    │
            ├───────────────┬──────────────────────────────────────────────────────────────┤
            │  middlewares  │ requireAuth · requireRole/requirePermission · validate(zod)  │
            │               │ assertOwnershipOrStaff (chống IDOR) · errorHandler           │
            ├───────────────┼──────────────────────────────────────────────────────────────┤
            │  modules      │ auth · rooms · bookings · payments · reviews · admin         │
            │  (routes)     │   chỉ parse request + gọi service + trả response             │
            ├───────────────┼──────────────────────────────────────────────────────────────┤
            │  services     │ availability · pricing · booking · payment · cancellation    │
            │  (nghiệp vụ)  │ booking-state · vietqr · audit                               │
            ├───────────────┼──────────────────────────────────────────────────────────────┤
            │  db.js        │ better-sqlite3 (WAL) + withTransaction(BEGIN IMMEDIATE)       │
            │               │ + schema_migrations                                          │
            ├───────────────┼──────────────────────────────────────────────────────────────┤
            │  jobs.js      │ expire-holds (1p) · nightly-close (15p)                      │
            └───────────────┴──────────────────────────────────────────────────────────────┘
                                             │
                                   src/data/lakstay.db (SQLite)
```

Nguyên tắc phân lớp:
- **Route không chứa nghiệp vụ.** Route chỉ: validate input → gọi service → trả JSON.
- **Service chứa nghiệp vụ** và là nơi duy nhất mở transaction.
- **DB là chốt chặn cuối**: mọi ràng buộc quan trọng đều có constraint tương ứng, để kể cả khi code có bug thì dữ liệu vẫn không thể sai.

---

## 2. Mô hình dữ liệu

### 2.1 Tách "loại phòng" và "phòng vật lý"
- `room_types`: thông tin bán hàng (tên, giá gốc, sức chứa, chính sách huỷ, ảnh…).
- `rooms`: từng phòng thật (số phòng, tầng, trạng thái bảo trì…).
- `room_types.total_rooms` là bản sao denormalized, được **trigger** tự sync khi thêm/xoá `rooms` → không bao giờ lệch.

### 2.2 `room_calendar` — trái tim của chống double-booking

Mỗi dòng = **1 phòng vật lý × 1 đêm**:

```sql
CREATE TABLE room_calendar (
  room_id    TEXT NOT NULL REFERENCES rooms(id),
  stay_date  TEXT NOT NULL,
  booking_id TEXT NOT NULL REFERENCES bookings(id),
  status     TEXT CHECK (status IN ('HELD','CONFIRMED','BLOCKED')),
  PRIMARY KEY (room_id, stay_date)      -- ← bất biến vật lý
);
```

Vì `(room_id, stay_date)` là khoá chính, **không tồn tại cách nào** để hai booking cùng giữ một phòng trong một đêm — kể cả khi mọi lớp kiểm tra phía trên đều hỏng.

### 2.3 Tính tồn kho
```
available(room_type, [checkIn, checkOut)) =
    MIN theo từng đêm của ( total_rooms − out_of_service − occupied − blocked )
```
Dùng **MIN** chứ không phải tổng/trung bình: khách ở cả kỳ, nên chỉ cần **một đêm hết phòng** là không nhận được booking cho cả kỳ.

### 2.4 Snapshot giá bất biến
Khi tạo booking, server tính giá từng đêm và lưu toàn bộ vào `bookings.price_breakdown` (JSON). Sau này đổi giá gốc hay thêm rule mùa cũng **không** làm sai lệch đơn cũ — đúng như hoá đơn đã phát hành.

### 2.5 Các bảng hỗ trợ
`payments` (thu + hoàn, idempotency_key & provider_txn_id UNIQUE), `payment_webhook_logs` (raw payload để debug/replay), `coupons` + `coupon_usages` (UNIQUE coupon×booking), `reviews` (UNIQUE booking×room_type), `room_blocks` (chặn phòng bảo trì/đoàn), `audit_logs`, `security_events`, `refresh_tokens`, `schema_migrations`.

---

## 3. Chống double-booking: 4 lớp

```
Request ─► [1] VALIDATE ngày/sức chứa/min-max stay/max advance
        ─► [2] IDEMPOTENCY-KEY  (gửi lại request cũ → trả đúng booking cũ)
        ─► [3] BEGIN IMMEDIATE  (chỉ 1 writer tại 1 thời điểm; đọc-lại-trong-transaction)
        ─► [4] PK room_calendar (DB ném UNIQUE constraint nếu vẫn lọt)
```

- **Lớp 3 quan trọng nhất về mặt đúng đắn**: `BEGIN` thường (deferred) chỉ khoá SHARED khi đọc, đến lúc ghi mới nâng cấp → hai transaction có thể cùng đọc "còn phòng". `BEGIN IMMEDIATE` lấy khoá RESERVED ngay từ đầu nên writer thứ hai phải chờ và đọc trạng thái mới nhất.
- **Lớp 4 là lưới an toàn**: kể cả khi có bug ở lớp 1–3, DB vẫn từ chối ghi trùng.

Chọn phòng vật lý dùng chiến lược *wear-levelling*: ưu tiên phòng ít bị chiếm nhất trong kỳ để các phòng mòn đều nhau.

> Bằng chứng: `npm run test:concurrency` bắn **40 user đồng thời** vào 1 phòng duy nhất → đúng **1** thành công, 39 nhận `409 CONFLICT`, và truy vấn DB xác nhận không có `(room, stay_date)` nào xuất hiện 2 lần.

---

## 4. State machine của booking

```
            pay ok                check-in              check-out
 PENDING ───────────► CONFIRMED ───────────► CHECKED_IN ───────────► COMPLETED
   │  │                  │                        │
   │  └─ user cancel ──► │                        │
   │                     ├─ user cancel ──► CANCELLED ◄── (huỷ muộn)
   ├─ hết hạn giữ ─► EXPIRED
   │                     ├─ không đến ──► NO_SHOW
   └─────────────────────┴─ refund ──► REFUNDED
```

- Bảng `TRANSITIONS` khai báo rõ: từ trạng thái nào → trạng thái nào, **vai trò nào** được phép, trigger là gì.
- Mọi cập nhật trạng thái dùng **optimistic locking** (`WHERE version = ?`): 0 dòng ảnh hưởng nghĩa là có người khác vừa sửa → báo `409 VERSION_CONFLICT` thay vì ghi đè.
- Side-effect đi kèm chuyển trạng thái: nhả phòng khi huỷ/hết hạn, nâng `HELD→CONFIRMED` khi trả tiền, v.v. — tất cả trong cùng transaction.

---

## 5. Engine giá

```
giá đêm = round( base_price × multiplier(mùa) ) + phụ thu cuối tuần
phụ thu cuối tuần = base×multiplier × WEEKEND_SURCHARGE_PCT   (T6, T7, CN)
subtotal  = Σ giá đêm × số phòng  +  phụ thu khách vượt chuẩn (200k/khách/đêm)
discount  = coupon (PERCENT có trần / FIXED), không vượt subtotal
service_fee = (subtotal − discount) × SERVICE_FEE_PCT
tax         = (subtotal − discount + service_fee) × TAX_PCT
total       = subtotal − discount + service_fee + tax
```

- Rule mùa có `priority`; rule nào khớp ngày + thứ trong tuần với priority cao nhất thắng.
- Server **không bao giờ** nhận giá từ client. Client chỉ gửi `roomTypeId/qty/dates`; client có gửi `clientExpectedTotal` thì chỉ để **cảnh báo** nếu giá đã đổi giữa chừng.

---

## 6. Chính sách huỷ & hoàn tiền

Ba tầng tính theo số giờ còn lại tới 14:00 ngày nhận phòng:

| Còn lại | Hậu quả |
|---|---|
| ≥ `cancel_free_hours` | hoàn 100% |
| > `cancel_no_refund_hours` | phạt `cancel_penalty_pct`% đêm đầu |
| ≤ `cancel_no_refund_hours` | mất 100% |

- Trước khi khách bấm huỷ, API `/bookings/:id/cancel-policy` trả **đúng con số sẽ hoàn** để hiển thị — minh bạch, tránh khiếu nại.
- Khi huỷ: cập nhật trạng thái + nhả phòng + tạo giao dịch `REFUND` trong **một** transaction.
- Chính sách khác nhau theo hạng phòng (villa cao cấp chặt hơn phòng thường) — giống khách sạn thật.

---

## 7. Thanh toán

### 7.1 VietQR tự sinh (EMVCo / NAPAS)
`services/vietqr.service.js` tự dựng chuỗi TLV `00/01/38/53/54/58/62/63` và tính **CRC16-CCITT (0x1021, init 0xFFFF)**. Nội dung chuyển khoản (`LAKSTAY <TXN_REF>`) chính là khoá để đối soát tự động. Ảnh QR sinh cục bộ (data-URI) nên không phụ thuộc mạng; kèm URL `img.vietqr.io` làm phương án hiển thị "chính chủ".

### 7.2 Ba quy tắc sống còn
1. **Idempotency** — webhook bị gọi lại bao nhiêu lần cũng chỉ ghi nhận tiền một lần (`provider_txn_id` UNIQUE + kiểm tra trạng thái trước khi update). Test: 5 webhook đồng thời → 1 lần ghi nhận.
2. **Reconciliation** — nguồn sự thật là sao kê ngân hàng. Endpoint `/payments/reconcile` cho phép staff dán nội dung chuyển khoản, hệ tự tách `TXN_REF` và khớp đơn.
3. **Amount matching** — nhận thiếu tiền thì KHÔNG xác nhận; ghi `underpaid` vào metadata để CSKH xử lý.

### 7.3 Chữ ký webhook
Webhook không dùng JWT (vì bên gọi là cổng thanh toán) mà dùng **HMAC-SHA256** trên raw body. Server giữ `req.rawBody` từ `express.json({verify})` để ký/kiểm tra trên đúng từng byte nhận được (parse rồi stringify lại sẽ sai chữ ký).

---

## 8. Bảo mật (tóm tắt — chi tiết ở SECURITY.md)

- Mật khẩu: bcrypt (12 rounds ở prod). Không bao giờ lưu plaintext.
- Phiên: access JWT 15 phút (httpOnly cookie) + refresh token **rotation** + **reuse detection** (dùng lại token đã thu hồi → thu hồi toàn bộ phiên).
- CSRF: double-submit token; mọi mutating request từ cookie bắt buộc header khớp.
- Brute-force: đếm lần sai, khoá tài khoản 15 phút sau 5 lần; message đăng nhập không tiết lộ email tồn tại.
- Phân quyền: role (`customer/staff/admin`) + permission; **chống IDOR** bằng `assertOwnershipOrStaff` ở từng resource.
- Input: zod ở mọi endpoint; strip field lạ (chống mass-assignment, vd client gửi `role:'admin'`).
- Output: sanitize bỏ `password_hash`, `token_hash`…; error handler không leak stack/SQL.
- Giới hạn: rate-limit theo từng nhóm endpoint; body tối đa 100kb; `limit` query bị chặn ≤100.
- Ghi vết: `audit_logs` (nghiệp vụ) + `security_events` (CSRF blocked, login fail, webhook sai chữ ký…).

---

## 9. Background jobs (compensating transactions)

Hệ booking không thể chỉ dựa vào request của người dùng:
- `expire-holds` (mỗi phút): booking `PENDING` quá 15 phút → `EXPIRED` + nhả phòng + trả coupon + huỷ QR.
- `nightly-close` (15 phút): tự `COMPLETED` đơn đã qua ngày trả; đánh `NO_SHOW` đơn đã qua ngày nhận mà chưa check-in.

Prod nhiều instance: chuyển sang queue/cron tập trung (BullMQ+Redis hoặc pg_cron) để không chạy trùng.

---

## 10. Những đánh đổi đã chấp nhận (và vì sao)

| Quyết định | Lý do |
|---|---|
| SQLite thay vì PostgreSQL | Zero-ops cho demo/học; WAL + `BEGIN IMMEDIATE` đủ an toàn cho 1 node. Schema viết chuẩn SQL nên migrate sang Postgres dễ. |
| Vanilla JS thay vì React | Không build step → clone là chạy; tập trung ngân sách vào backend. |
| SSE realtime + fallback polling cho thanh toán | Server-Sent Events (`/api/payments/:id/stream`) đẩy trạng thái tức thì trên 1 node, tự lùi về polling 3s nếu mạng chặn SSE; cần Redis Pub/Sub khi scale nhiều replica. |
| Rate-limit in-memory | Đủ cho 1 node; ghi chú chuyển Redis khi scale. |
| QR mock cho MoMo/VNPAY | Không có sandbox thật; cấu trúc service đã tách để gắn SDK thật sau. |
