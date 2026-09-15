# 🔐 Bảo mật (Security)

## 1. Ma trận quyền (RBAC)

| Tài nguyên | customer | staff | admin |
|---|---|---|---|
| Xem phòng / báo giá / review công khai | ✅ | ✅ | ✅ |
| Tạo booking của chính mình | ✅ | ✅ | ✅ |
| Xem/huỷ booking **của mình** | ✅ | ✅ | ✅ |
| Xem **mọi** booking, đổi trạng thái, check-in/out | ❌ | ✅ | ✅ |
| Thu tiền thủ công, đối soát | ❌ | ✅ | ✅ |
| Hoàn tiền | ❌ | ❌ | ✅ |
| CRUD hạng phòng / phòng / rule giá / coupon | ❌ | ❌ | ✅ |
| Chặn phòng theo ngày | ❌ | ❌ | ✅ |
| Quản lý user, phân quyền, khoá | ❌ | ❌ | ✅ |
| Audit log, security events | ❌ | ❌ | ✅ |

Chi tiết khai báo trong `src/middlewares/auth.js` (`PERMISSIONS`, `can()`, `requireRole`, `requirePermission`).

**Chống IDOR:** mọi endpoint đọc/ghi tài nguyên riêng tư đều gọi `assertOwnershipOrStaff(resource, user)` — so `resource.user_id` với `req.user.id`. Customer gọi booking người khác → `403`.

**Chống leo quyền:** `role` không bao giờ đọc từ body khi đăng ký; chỉ admin đổi được role; admin không tự hạ quyền chính mình.

## 2. Xác thực & phiên

- Mật khẩu bcrypt; số rounds theo môi trường (10 dev / 12 prod).
- Access token JWT 15 phút, cookie `httpOnly + SameSite=Lax + Secure(prod)`.
- Refresh token: lưu **hash** trong DB, rotation mỗi lần refresh; phát hiện **reuse** (token đã thu hồi bị dùng lại) → thu hồi toàn bộ phiên + ghi security event mức `critical`.
- Đổi mật khẩu → thu hồi mọi phiên khác.
- Lockout: 5 lần sai → khoá 15 phút; message không phân biệt "sai email" / "sai mật khẩu"; so sánh bcrypt kể cả khi email không tồn tại để cân bằng thời gian phản hồi.

## 3. CSRF

Double-submit: cookie `lks_csrf` (JS đọc được) + header `X-CSRF-Token`. Mọi request mutating dùng cookie session mà thiếu/khác header → `403` + ghi `CSRF_BLOCKED`. So sánh bằng `timingSafeEqual` chống timing attack.

## 4. Input / Output

- zod validate mọi endpoint; unknown keys bị strip (chống mass-assignment).
- Escape wildcard `LIKE` khi tìm kiếm; toàn bộ SQL dùng prepared statement (không nối chuỗi).
- Response luôn qua `sanitize()` loại field nhạy cảm.
- Error handler: lỗi lạ → log chi tiết nội bộ, trả message chung; không lộ stack/SQL/schema.

## 5. Rate limiting

| Nhóm | Giới hạn mặc định |
|---|---|
| Toàn cục `/api` | 600 req / phút / IP |
| Login | 20 / 15 phút / IP |
| Register | 10 / 15 phút / IP |
| Tạo booking | 10 / phút / user |
| Webhook | 120 / phút / IP |

Trả header `X-RateLimit-*` và `Retry-After`.

## 6. Header & CSP (helmet)

`Content-Security-Policy` chỉ cho phép self + Google Fonts + ảnh QR; `X-Content-Type-Options: nosniff`; `Referrer-Policy`; tắt `X-Powered-By`; `frame-ancestors 'self'`.

## 7. Thanh toán an toàn

- Webhook xác thực bằng HMAC-SHA256 trên raw body; sai chữ ký → `403` + security event.
- Idempotency ở cả client (header `Idempotency-Key`) và server (`provider_txn_id` UNIQUE).
- Không xác nhận khi nhận thiếu tiền.
- Secret webhook bắt buộc đổi ở production (fail-fast khi khởi động).

## 8. Ghi vết

- `audit_logs`: ai / vai trò / hành động / đối tượng / trước-sau / IP / UA / thời gian.
- `security_events`: mức `info|warn|critical` cho CSRF blocked, login fail, token reuse, webhook sai chữ ký, đổi quyền…
- Trang admin `/security` hiển thị cho admin để phát hiện bất thường sớm.

## 9. Việc cần làm khi lên production (checklist)

- [ ] Đặt secret ngẫu nhiên ≥ 32 byte cho JWT_ACCESS/REFRESH + PAYMENT_WEBHOOK.
- [ ] Bật HTTPS; đặt `secure` cookie (tự bật khi `NODE_ENV=production`).
- [ ] Đặt `PUBLIC_URL` đúng tên miền; cấu hình `CORS_ORIGINS` chính xác.
- [ ] Đổi `BANK_*` sang tài khoản thật; xác thực webhook bằng khoá thật của nhà cung cấp.
- [ ] Bật backup DB định kỳ + giám sát (uptime, log error, security events).
- [ ] Cân nhắc WAF + giới hạn request ở tầng reverse-proxy.
- [ ] Chuyển rate-limit & job sang Redis/queue khi chạy nhiều instance.
