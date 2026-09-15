# 🔧 Hướng dẫn cài đặt chi tiết (Setup Guide)

Hướng dẫn từng bước cho **Windows / macOS / Linux**, kèm xử lý lỗi thường gặp và cách deploy.

---

## 0. Ghi chú Windows

Bản này **chạy được trên Windows** (Git Bash, PowerShell, CMD — kể cả đường dẫn có dấu cách
như `C:\protect code\...`). Mọi đường dẫn nội bộ đều qua `fileURLToPath()`
(`src/utils/paths.js`), tránh lỗi kinh điển `new URL(...).pathname` trả về `/C:/...%20...`
khiến Node ghép thành `C:\C:\...` và báo ENOENT.
Nếu máy bạn dùng Node ≥ 20 là được; `better-sqlite3` có prebuild cho Windows nên `npm install`
không cần trình biên dịch C++.

## 1. Yêu cầu hệ thống

| Thành phần | Tối thiểu | Khuyến nghị |
|---|---|---|
| Node.js | 18.17 | **20.x hoặc 22.x** |
| npm | 9 | 10+ |
| RAM trống | 512 MB | 1 GB |
| Ổ cứng | 200 MB | 500 MB |
| Trình duyệt | Chrome/Edge/Firefox/Safari bản gần đây | — |

Không cần Docker, không cần Redis, không cần database server (dùng SQLite file).

### Kiểm tra Node đã cài chưa

```bash
node -v     # phải >= v18.17, ví dụ v20.20.2
npm -v
```

**Chưa có Node?**
- Windows/macOS: tải bản LTS từ https://nodejs.org và cài như phần mềm thường.
- Linux (Debian/Ubuntu):
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
- Hoặc dùng trình quản lý phiên bản: `nvm install 20 && nvm use 20`.

---

## 2. Lấy mã nguồn về máy

**Cách A — giải nén file zip** bạn nhận được: giải nén vào thư mục bất kỳ, ví dụ `C:\projects\lakstay` hoặc `~/projects/lakstay`.

**Cách B — git** (nếu có repo):
```bash
git clone <url-repo> lakstay
cd lakstay
```

Mở terminal **tại thư mục project** (nơi có `package.json`) rồi làm tiếp các bước sau.

---

## 3. Cài dependency

```bash
npm install
```

> `better-sqlite3` có bản dựng sẵn (prebuilt) cho đa số nền tảng nên thường không cần trình biên dịch.
> Nếu báo lỗi build, xem mục **Xử lý lỗi** bên dưới.

---

## 4. Tạo file cấu hình

```bash
# macOS / Linux
cp .env.example .env

# Windows (cmd)
copy .env.example .env
# Windows (PowerShell)
Copy-Item .env.example .env
```

Với **môi trường development** bạn có thể để nguyên file `.env` mẫu.
Các giá trị quan trọng:

| Biến | Ý nghĩa | Giá trị dev nên để |
|---|---|---|
| `PORT` | Cổng chạy server | `3000` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Khoá ký token | dev giữ nguyên; **production bắt buộc đổi** |
| `PAYMENT_WEBHOOK_SECRET` | Khoá ký webhook thanh toán | dev giữ nguyên; prod bắt buộc đổi |
| `BOOKING_HOLD_MINUTES` | Thời gian giữ chỗ | `15` |
| `BANK_BIN` / `BANK_ACCOUNT` / `BANK_ACCOUNT_NAME` | Tài khoản nhận tiền VietQR | thay bằng tài khoản thật khi dùng thật |

> ⚠️ Ở `NODE_ENV=production`, server **từ chối khởi động** nếu 3 secret trên vẫn giữ giá trị `dev-...`. Đây là cơ chế chống deploy ẩu.

---

## 5. Khởi tạo database + dữ liệu mẫu

```bash
npm run db:init     # tạo schema (16 bảng) tại src/data/lakstay.db
npm run db:seed     # nạp dữ liệu mẫu: 6 hạng phòng, 35 phòng, user, coupon, booking, review
```

Muốn làm mới hoàn toàn:

```bash
npm run db:reset    # = xoá DB + init + seed
```

---

## 6. Chạy server

```bash
npm start           # chạy thường
# hoặc
npm run dev         # tự khởi động lại khi bạn sửa code (node --watch)
```

Terminal in ra:

```
LakStay API sẵn sàng { url: 'http://localhost:3000', env: 'development', ... }
```

Mở trình duyệt:

- Website khách: **http://localhost:3000**
- Trang quản trị: **http://localhost:3000/admin.html**
- Kiểm tra sức khoẻ API: **http://localhost:3000/healthz**

Đăng nhập bằng tài khoản ở README (mật khẩu chung `Lakstay@2026`).

---

## 7. Chạy kiểm thử (tuỳ chọn nhưng rất nên)

Mở **terminal thứ hai** (server vẫn chạy ở terminal đầu):

```bash
npm run smoke              # 67 kiểm thử end-to-end
npm run test:concurrency   # bắn 40 request đồng thời, chứng minh không overbook
npm test                   # unit test
```

---

## 8. Xử lý lỗi thường gặp

| Lỗi | Nguyên nhân & cách sửa |
|---|---|
| `EADDRINUSE: address already in use :::3000` | Cổng 3000 đang bị chiếm. Đổi `PORT=3001` trong `.env`, hoặc tắt tiến trình cũ (`lsof -i:3000` / `netstat -ano | findstr 3000`). |
| `Cannot find module 'better-sqlite3'` / lỗi build node-gyp | Chạy lại `npm install`. Nếu vẫn lỗi: cài toolchain (`npm i -g windows-build-tools` trên Windows cũ, hoặc `xcode-select --install` trên macOS), hoặc nâng Node lên bản LTS mới hơn để có prebuilt binary. |
| `Missing required env` | Thiếu biến trong `.env`. So sánh với `.env.example`. |
| `Refusing to start: JWT_ACCESS_SECRET chưa được cấu hình` | Bạn đang ở `NODE_ENV=production` mà chưa đặt secret thật. Đặt secret ngẫu nhiên hoặc chuyển `NODE_ENV=development`. |
| Database lỗi / dữ liệu lạ | Chạy `npm run db:reset` để dựng lại từ đầu. |
| Quên mật khẩu demo | Mọi tài khoản seed dùng `Lakstay@2026`. Hoặc `npm run db:reset`. |
| Trang trắng / lỗi font khi mở trực tiếp file HTML | Phải truy cập qua server (`http://localhost:3000`), không mở file `.html` bằng cách double-click. |
| Ảnh không hiển thị | Đảm bảo thư mục `public/img/` còn đủ 8 file jpg. |

Sinh secret mạnh để điền vào `.env`:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

---

## 9. Deploy lên server thật (tóm tắt)

1. **VPS + PM2 + Nginx** (khuyến nghị cho khởi đầu):
   ```bash
   npm ci --omit=dev
   NODE_ENV=production npm run db:init && npm run db:seed   # lần đầu
   npm i -g pm2
   pm2 start src/server.js --name lakstay
   pm2 save
   ```
   Nginx reverse-proxy `443 → 127.0.0.1:3000`, bật HTTPS (Let's Encrypt). Đặt `PUBLIC_URL=https://ten-mien-cua-ban`.
2. Đặt **secret thật** cho 3 biến JWT/webhook; đổi `BANK_*` thành tài khoản nhận tiền thật.
3. Backup: copy định kỳ file `src/data/lakstay.db*` (SQLite) — đủ để khôi phục toàn bộ.
4. Khi cần scale nhiều instance: chuyển background job sang queue tập trung (BullMQ + Redis) và SQLite → PostgreSQL (xem `docs/ROADMAP.md`).

Chi tiết kiến trúc & lý do thiết kế: `docs/ARCHITECTURE.md`. Danh sách endpoint: `docs/API.md`.
