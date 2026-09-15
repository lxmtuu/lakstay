# 🏔 LakStay — Hệ thống đặt phòng khách sạn (Hotel Booking System)

Project **backend-first** thể hiện trọn vẹn tư duy xây dựng một hệ thống booking thật:
chống double-booking 4 lớp, transaction + optimistic locking, state machine đơn phòng,
RBAC & bảo mật nhiều tầng, thanh toán **VietQR chuẩn EMVCo**, email + voucher PDF,
realtime SSE, chương trình thành viên, i18n vi/en, báo cáo biểu đồ và trang quản trị hoàn chỉnh.

> **Stack:** Node.js 20+ · Express · SQLite (`better-sqlite3`, WAL) · Vanilla-JS SPA (không framework)
> · pdfkit · qrcode · zod · helmet · JWT httpOnly cookies.
> Không bắt buộc Docker/Redis — nhưng có sẵn cả hai cấu hình.

**Mục lục**
1. [Khởi động nhanh](#-khởi-động-nhanh-60-giây)
2. [Tài khoản & dữ liệu demo](#-tài-khoản--dữ-liệu-demo)
3. [Tính năng](#-tính-năng)
4. [Điểm nhấn backend](#-điểm-nhấn-backend)
5. [Cấu trúc project](#-cấu-trúc-project)
6. [Kiểm thử & CI/CD](#-kiểm-thử--cicd)
7. [Biến môi trường](#-biến-môi-trường)
8. [Setup chi tiết theo hệ điều hành](#-setup-chi-tiết-theo-hệ-điều-hành)
9. [Chạy bằng Docker](#-chạy-bằng-docker)
10. [Troubleshooting](#-troubleshooting)
11. [API tổng quan](#-api-tổng-quân)
12. [Tài liệu đi kèm](#-tài-liệu-đi-kèm)

---

## ⚡ Khởi động nhanh (60 giây)

Yêu cầu: **Node.js ≥ 20** và npm.

```bash
npm install                 # 1. cài dependency
cp .env.example .env        # 2. tạo env (dev dùng nguyên giá trị mẫu là chạy)
npm run setup               # 3. = db:init + db:seed (tạo schema + dữ liệu mẫu)
npm start                   # 4. chạy server → http://localhost:3000
```

| URL | Nội dung |
|---|---|
| `http://localhost:3000` | Website khách (SPA, hỗ trợ **vi/en**) |
| `http://localhost:3000/admin.html` | Trang quản trị (staff/admin) |

Lệnh hữu ích khác: `npm run dev` (tự reload khi sửa code) · `npm run db:reset` (xoá trắng + seed lại).

---

## 🔑 Tài khoản & dữ liệu demo

Mật khẩu chung: **`Lakstay@2026`**

| Email | Vai trò | Dùng để thử |
|---|---|---|
| `admin@lakstay.vn` | admin | Toàn quyền: giá mùa, coupon, user, hoàn tiền, audit, an ninh, thành viên, outbox email |
| `staff@lakstay.vn` | staff | Lễ tân: check-in/out, front-desk, xác nhận thu tiền thủ công, duyệt review |
| `khach@example.com` | customer | Đặt phòng, thanh toán QR, huỷ, đánh giá, thẻ thành viên |
| `demo@example.com` | customer | Luồng khách mới |

**Coupon mẫu:** `DALAT10` (−10%, tối đa 500k) · `WELCOME200K` (−200k) · `MUAHE15` (−15%) · `HETHANG` (hết hạn — để test validate).

Seed tạo sẵn 6 hạng phòng (35 phòng vật lý), giá mùa, review, vài đơn ở nhiều trạng thái để admin có số liệu biểu đồ ngay.

---

## ✅ Tính năng

### Phía khách (website, song ngữ vi/en)
- **Trang chủ**: hero parallax + sương mù trôi, đếm số, scroll-reveal; tìm phòng ngay trên hero.
- **Danh sách phòng**: tồn kho thực tế theo kỳ ở, lọc tiện nghi (chọn nhiều, AND) / khoảng giá / điểm đánh giá ≥, sắp xếp, gợi ý **"ngày rẻ nhất tháng"** (bấm chip là chọn ngày).
- **Chi tiết phòng**: lịch trống 30 ngày, báo giá từng đêm (giá mùa + phụ thu cuối tuần), chính sách huỷ 3 tầng hiển thị minh bạch.
- **Wizard đặt phòng 5 bước**: chọn phòng → thông tin khách → xác nhận → thanh toán → hoàn tất.
- **Thanh toán VietQR**: payload EMVCo/NAPAS tự build + CRC16, đếm ngược hết hạn, **trang QR tự xác nhận tức thì qua SSE** (không cần refresh), kèm mô phỏng MoMo/VNPAY/thẻ.
- **Voucher PDF A4** (pdfkit, font DejaVu nhúng sẵn cho tiếng Việt): QR tra cứu đơn, bảng phòng/tiền, chính sách; tải được từ web và đính kèm email xác nhận.
- **Email sự kiện**: giữ chỗ / xác nhận (kèm PDF) / huỷ đơn — dev-mode ghi vào *outbox* xem được trong admin; có SMTP thì gửi thật.
- **Chương trình thành viên**: tích 1 điểm/10.000₫ khi PAID, 4 hạng MEMBER→PLATINUM giảm 0–8%, thẻ thành viên + tiến trình lên hạng + lịch sử điểm trong trang cá nhân.
- **Quản lý đặt phòng**: chi tiết, in voucher, huỷ kèm **xem trước tiền hoàn**, thanh toán nốt.
- **Đánh giá** chỉ cho khách đã hoàn tất kỳ nghỉ (chống review ảo).
- **Tài khoản**: đổi mật khẩu, xem & thu hồi phiên đăng nhập.
- Footer liên hệ đầy đủ + mạng xã hội (Facebook, Instagram, TikTok, YouTube, Zalo, X).

### Phía quản trị (`/admin.html`)
- **Dashboard**: doanh thu, công suất, cảnh báo hết phòng / đơn sắp hết hạn / review chờ duyệt / sự cố an ninh.
- **Báo cáo biểu đồ**: area-line doanh thu & số đơn theo ngày, công suất %, donut doanh thu theo hạng phòng, bar theo trạng thái; chọn kỳ 14/30/60/90 ngày; **xuất CSV**; SVG tự vẽ không thư viện.
- **Đặt phòng**: bảng lọc/tìm, drawer chi tiết + lịch sử audit, chuyển trạng thái theo state machine, hoàn tiền.
- **Lễ tân hôm nay**: danh sách đến / đi / đang ở, check-in-out 1 chạm.
- **Phòng & tồn kho**: CRUD hạng phòng & phòng vật lý, bảo trì, **chặn phòng theo ngày** (đoàn/bảo trì).
- **Giá theo mùa**, **coupon**, **người dùng (phân quyền/khoá)**, **duyệt & phản hồi đánh giá**.
- **Giao dịch** + đối soát theo nội dung chuyển khoản + giả lập thanh toán (test).
- **Thành viên (loyalty)**: thống kê 4 hạng, điều chỉnh điểm có lý do bắt buộc + audit.
- **Email đã gửi (outbox)**: xem HTML + tải đính kèm PDF.
- **Nhật ký hoạt động (audit)** và **bản tin an ninh** (chỉ admin).

---

## 🧠 Điểm nhấn backend

Chi tiết đầy đủ: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) và [`docs/SECURITY.md`](docs/SECURITY.md).

| Vấn đề | Cách giải quyết |
|---|---|
| **Double booking** | 4 lớp: validate → idempotency-key → transaction `BEGIN IMMEDIATE` → **PRIMARY KEY `(room_id, stay_date)`** bảng `room_calendar`. Test 40 request đồng thời → đúng 1 thắng |
| **Giá** | Server tự tính lại 100%, không tin client; snapshot bất biến lưu vào đơn; giá mùa + cuối tuần + khách vượt chuẩn |
| **Trạng thái đơn** | State machine tường minh + optimistic locking (`version`), mỗi chuyển trạng thái kiểm tra vai trò |
| **Huỷ phòng** | Chính sách 3 tầng theo hạng phòng, preview tiền hoàn trước khi xác nhận, tự tạo giao dịch hoàn |
| **Giữ chỗ** | TTL + background job tự nhả phòng / auto-complete / no-show |
| **Thanh toán** | Webhook idempotent (gọi lại không cộng tiền 2 lần), amount-matching, reconciliation theo nội dung CK, chữ ký HMAC |
| **Loyalty** | Cộng điểm *trong cùng transaction* với PAID; unique index `(booking_id, type)` chống nhân điểm; huỷ đơn thu hồi điểm + trừ chi tiêu (rớt hạng được); ưu đãi hạng server tự tính |
| **Bảo mật** | bcrypt, JWT access 15p + refresh rotation + reuse-detection, CSRF double-submit, lockout brute-force, rate limit, RBAC + chống IDOR, helmet/CSP, zod, audit + security events |
| **i18n** | Core riêng ~150 keys vi/en, nội dung phòng song ngữ từ DB (`description_en`), tiện nghi có map dịch |
| **Đường dẫn file** | Mọi path qua `fileURLToPath` (`src/utils/paths.js`) — chạy đúng trên Windows kể cả thư mục có dấu cách; CI có step guard chặn hồi quy |
| **Nâng cấp DB** | Migration tự động (`schema_migrations`) — DB cũ mở lên tự thêm bảng/cột, không mất dữ liệu |

---

## 📁 Cấu trúc project

```
lakstay/
├── db/                  schema.sql (16+ bảng), init.js, seed.js
├── src/
│   ├── config/          biến môi trường có kiểm chứng
│   ├── db.js            connection + withTransaction (BEGIN IMMEDIATE) + migration
│   ├── jobs.js          background jobs (expire holds, auto-complete, no-show)
│   ├── middlewares/     auth, rbac, validate, error, ratelimit
│   ├── services/        availability, pricing, booking, booking-state, cancellation,
│   │                    payment, vietqr, voucher (PDF), mail (outbox/SMTP),
│   │                    loyalty, audit
│   ├── modules/         auth, rooms, bookings, payments, reviews, loyalty, admin (routes)
│   ├── utils/           errors, date, id, http, logger, format, paths (Windows-safe)
│   └── assets/fonts/    DejaVuSans (.ttf) nhúng cho voucher PDF tiếng Việt
├── public/              SPA khách + admin.html + css + js (i18n.js, charts SVG) + ảnh
├── tests/               unit.test.js, smoke.js, concurrency.test.js
├── docs/                SETUP, ARCHITECTURE, API, SECURITY, ROADMAP
├── .github/workflows/   ci.yml (matrix Ubuntu + Windows, Docker build)
├── Dockerfile           node:20-bookworm-slim, non-root, healthcheck
└── docker-compose.yml   app + volume dữ liệu + service seed một lần
```

---

## 🧪 Kiểm thử & CI/CD

```bash
npm test                  # 19 unit test (node:test): lịch, giá, phạt huỷ, EMVCo, loyalty…
npm run test:smoke        # 89 kiểm thử end-to-end qua HTTP thật (cần server đang chạy)
npm run test:concurrency  # 40 khách giành cùng 1 phòng → không overbook (RACERS=40)
```

**CI/CD** (`.github/workflows/ci.yml`): mỗi push/PR chạy trên **Ubuntu + Windows**:
guard đường dẫn → `npm ci` → audit → init+seed → unit → smoke → concurrency;
job riêng build + boot Docker image kèm healthcheck; upload log khi fail.

---

## 🔧 Biến môi trường

Copy `.env.example` → `.env`. Dev có thể để nguyên giá trị mẫu; **production bắt buộc đổi 3 secret** (server từ chối khởi động nếu thiếu).

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `NODE_ENV` | `development` | `production` bật kiểm tra secret chặt |
| `PORT` / `HOST` | `3000` / `0.0.0.0` | cổng & interface lắng nghe |
| `PUBLIC_URL` | `http://localhost:3000` | URL tuyệt đối dùng trong email/QR |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | — | **bắt buộc** ở production |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL_DAYS` | `15m` / `30` | tuổi thọ token |
| `DB_FILE` | `src/data/lakstay.db` | đường dẫn SQLite (tự tạo thư mục) |
| `BOOKING_HOLD_MINUTES` | `15` | thời gian giữ chỗ chưa thanh toán |
| `MAX_ROOMS_PER_BOOKING` | `5` | số loại phòng tối đa/đơn |
| `QR_EXPIRE_MINUTES` | `15` | hạn QR thanh toán |
| `TAX_PCT` / `SERVICE_FEE_PCT` / `WEEKEND_SURCHARGE_PCT` | `10` / `5` / `15` | cấu phần giá |
| `RL_GLOBAL_MAX` / `RL_AUTH_MAX` / `RL_BOOKING_MAX` / `RL_REGISTER_MAX` | `600/20/10/10` | rate limit |
| `BANK_BIN` / `BANK_ACCOUNT` / `BANK_ACCOUNT_NAME` | mẫu Vietcombank | thụ hưởng VietQR |
| `PAYMENT_WEBHOOK_SECRET` | — | **bắt buộc**: chữ ký HMAC webhook |
| `CORS_ORIGINS` | `http://localhost:3000` | danh sách origin cho phép |
| `DISABLE_JOBS` | — | `true` để tắt background job (test song song) |
| `LOG_LEVEL` | `info` | debug/info/warn/error |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | — | *tuỳ chọn*: bật gửi email thật; không cấu hình thì email ghi vào `src/data/outbox/` (xem trong admin) |

---

## 💻 Setup chi tiết theo hệ điều hành

### Windows (Git Bash / PowerShell / CMD)
Hỗ trợ chính thức — kể cả đường dẫn có dấu cách (`C:\protect code\...`): mọi path nội bộ đi qua `fileURLToPath`.
```powershell
npm install
copy .env.example .env     # PowerShell (CMD: copy, Git Bash: cp)
npm run setup
npm start
```
`better-sqlite3` có prebuild cho Windows nên **không cần trình biên dịch C++**.

### macOS / Linux
```bash
npm install && cp .env.example .env && npm run setup && npm start
```

### Production (gợi ý tối thiểu)
1. Đặt `NODE_ENV=production` + 3 secret mạnh (`openssl rand -hex 32`).
2. `CORS_ORIGINS` trỏ đúng domain thật; bật HTTPS ở reverse-proxy (nginx/Caddy) → cookie `Secure`.
3. Backup file SQLite định kỳ (hoặc trỏ `DB_FILE` ra volume riêng).
4. Cấu hình SMTP thật để email đến khách (nếu không chỉ có outbox dev).
5. Xem thêm checklist bảo mật: [`docs/SECURITY.md`](docs/SECURITY.md).

---

## 🐳 Chạy bằng Docker

```bash
cp .env.example .env                      # điền 3 secret bất kỳ
docker compose --profile init run --rm seed   # tạo schema + seed (chạy 1 lần)
docker compose up --build                 # http://localhost:3000
```
- Image `node:20-bookworm-slim`, chạy **non-root**, có `HEALTHCHECK`.
- Dữ liệu SQLite trong volume `lakstay-data` → không mất khi rebuild image.

---

## 🔩 Troubleshooting

| Triệu chứng | Nguyên nhân / cách sửa |
|---|---|
| `Error: ENOENT ... mkdir 'C:\C:\...'` | Bản cũ chứa bug `.pathname` trên Windows — dùng bản mới (đã sửa bằng `src/utils/paths.js`); CI có guard chặn tái diễn |
| `Missing required env: JWT_...` khi `NODE_ENV=production` | Chưa đặt secret trong `.env` |
| Cổng 3000 đã dùng | Đổi `PORT` trong `.env` |
| Muốn xoá sạch dữ liệu | `npm run db:reset` (xoá DB + seed lại) |
| Smoke test báo lỗi kết nối | Chưa chạy `npm start` ở terminal khác trước khi `npm run test:smoke` |
| `npm install` lỗi mạng thử lại | `npm ci --no-audit --no-fund` hoặc xoá `node_modules` + `package-lock.json` rồi cài lại |

---

## 🌐 API tổng quan

Chi tiết từng endpoint + payload: [`docs/API.md`](docs/API.md).

| Nhóm | Endpoint chính |
|---|---|
| Auth | `POST /api/auth/register·login·refresh·logout`, `GET /me·sessions`, CSRF |
| Rooms | `GET /api/rooms` (lọc tiện nghi/giá/điểm), `/:slug`, `POST /quote`, `GET /meta/price-calendar·amenities` |
| Bookings | `POST /api/bookings`, `GET /:id`, `/:id/cancel` (+preview hoàn), `/:id/voucher.pdf`, chuyển trạng thái |
| Payments | `POST /api/payments` (tạo QR), `POST /webhook/VIETQR` (HMAC), `/:id/stream` (**SSE**), simulate/reconcile |
| Loyalty | `GET /api/loyalty/me`; admin: danh sách + điều chỉnh điểm |
| Reviews | eligible list, create, admin duyệt/phản hồi |
| Admin | dashboard, front-desk, tồn kho, chặn phòng, giá mùa, coupon, user, giao dịch, báo cáo + `reports/charts` + CSV, audit, security, outbox |

---

## 📚 Tài liệu đi kèm

| File | Nội dung |
|---|---|
| [`docs/SETUP.md`](docs/SETUP.md) | Setup mở rộng, ghi chú Windows, deploy |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Sơ đồ luồng đặt phòng/thanh toán, vì sao dùng BEGIN IMMEDIATE, state machine |
| [`docs/API.md`](docs/API.md) | Tham chiếu endpoint đầy đủ |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Mô hình bảo mật & checklist production |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Việc đã làm vượt MVP + hướng phát triển tiếp (PostgreSQL, Redis, OTA channel manager…) |

---

## 🧭 Gợi ý trình bày project (phỏng vấn / báo cáo)

1. Bài toán double-booking và 4 lớp phòng thủ → demo `npm run test:concurrency`.
2. State machine + optimistic locking → mở 2 tab cùng sửa một đơn.
3. Idempotency → bấm thanh toán 2 lần / webhook gọi lại.
4. Chính sách huỷ minh bạch → preview tiền hoàn trước khi xác nhận.
5. Bảo mật → chỉ vào các test CSRF/IDOR/refresh-rotation trong `tests/smoke.js`.

Mỗi mục đều có **test chạy được** để chứng minh, không chỉ nói lý thuyết.

---

*Bản quyền MIT — tự do sử dụng cho mục đích học tập & thương mại.*
