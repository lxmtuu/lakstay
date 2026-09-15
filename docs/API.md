# 🔌 API Reference

Base: `http://localhost:3000/api`. Response chuẩn:

```json
{ "success": true,  "data": {...}, "meta": { "page":1,"limit":20,"total":13,"totalPages":1 } }
{ "success": false, "error": { "code":"...", "message":"...", "details":[...] }, "requestId":"req_..." }
```

Xác thực: cookie phiên (httpOnly). Request mutating cần header `X-CSRF-Token` (lấy từ `GET /auth/csrf`).
Request tạo booking/thanh toán nên gửi header `Idempotency-Key`.

## Public

| Method | Path | Mô tả |
|---|---|---|
| GET | `/site` | Cấu hình công khai: tên, liên hệ, mạng xã hội, phương thức thanh toán |
| GET | `/rooms` | Danh sách hạng phòng + tồn kho theo kỳ ở (`checkIn, checkOut, guests, maxPrice, sort, page, limit`) |
| GET | `/rooms/:slug` | Chi tiết phòng: tiện nghi, lịch trống 30 ngày, preview chính sách huỷ, review |
| GET | `/rooms/:id/availability?checkIn&checkOut` | Tồn kho từng đêm |
| POST | `/rooms/quote` | Báo giá chi tiết từng đêm (+coupon) — không cần đăng nhập |
| GET | `/reviews` | Đánh giá công khai + phân bố điểm |
| GET | `/healthz` | Health check |

## Auth `/auth`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/csrf` | – | Cấp CSRF token |
| POST | `/register` | – | Đăng ký (luôn role customer) |
| POST | `/login` | – | Đăng nhập (có lockout) |
| POST | `/refresh` | cookie | Làm mới access token (rotation) |
| POST | `/logout` | – | Đăng xuất |
| GET | `/me` | ✅ | Thông tin + thống kê cá nhân |
| POST | `/change-password` | ✅ | Đổi mật khẩu, thu hồi phiên khác |
| GET | `/sessions` · POST `/sessions/revoke-all` | ✅ | Quản lý phiên |

## Bookings `/bookings` (cần đăng nhập)

| Method | Path | Mô tả |
|---|---|---|
| POST | `/` | Tạo booking. Body: `checkIn, checkOut, guests, lines[{roomTypeId,qty}], guestName, guestPhone, guestEmail, specialRequest?, couponCode?, clientExpectedTotal?` |
| GET | `/` | Danh sách của tôi (customer) / tất cả (staff, admin). Filter: `status, q, from, to, sort` |
| GET | `/:id` | Chi tiết (chống IDOR) |
| GET | `/code/:code` | Tra theo mã đặt phòng |
| GET | `/:id/cancel-policy` | Xem trước tiền hoàn nếu huỷ bây giờ |
| POST | `/:id/cancel` | Huỷ + tự tạo giao dịch hoàn |
| POST | `/:id/transition` | staff/admin đổi trạng thái (`to: CHECKED_IN/COMPLETED/...`) |
| GET | `/meta/status` | Metadata trạng thái cho UI |

## Payments `/payments`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/providers` | – | Danh sách phương thức + thông tin thụ hưởng |
| POST | `/` | ✅ | Tạo payment + QR. Body `{bookingId, provider, amount?}` |
| GET | `/:id/status` | ✅ | Trạng thái (client poll) |
| GET | `/mine/list` | ✅ | Lịch sử giao dịch của tôi |
| POST | `/webhook/:provider` | chữ ký | Cổng thanh toán báo kết quả (HMAC) |
| POST | `/simulate/success` | ✅ | **chỉ dev/demo**: giả lập bank callback hợp lệ |
| POST | `/reconcile` | staff | Đối soát bằng nội dung chuyển khoản |
| POST | `/:id/confirm-manual` | staff | Xác nhận thu tiền mặt |
| POST | `/:bookingId/refund` | staff | Hoàn tiền |
| GET | `/qr/verify?q=` | staff | Kiểm tra chuỗi QR EMVCo |

## Reviews `/reviews`

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| GET | `/eligible` | ✅ | Booking đã hoàn tất chưa đánh giá |
| POST | `/` | ✅ | Tạo đánh giá (`bookingId, roomTypeId, rating, title?, content`) |
| GET | `/` | – | Danh sách công khai |
| POST | `/:id/reply` | staff | Phản hồi |
| PATCH | `/:id/moderate` | staff | Duyệt/ẩn |

## Admin `/admin` (staff; một số chỉ admin)

| Method | Path | Quyền | Mô tả |
|---|---|---|---|
| GET | `/dashboard?days=` | staff | KPI + lịch công suất + cảnh báo + gần đây |
| GET | `/bookings` · GET `/bookings/:id` | staff | Danh sách / chi tiết + audit |
| POST | `/bookings/:id/transition` | staff | Đổi trạng thái |
| POST | `/bookings/:id/refund` | admin | Hoàn tiền |
| GET | `/front-desk?date=` | staff | Đến / đi / đang ở trong ngày |
| GET/POST/PUT | `/room-types[/:id]` | đọc: staff · ghi: admin | CRUD hạng phòng |
| GET/POST/PATCH | `/rooms[/:id]` | đọc: staff · tạo: admin | Phòng vật lý + trạng thái |
| GET/POST/DELETE | `/blocks` | admin | Chặn/bỏ chặn phòng theo ngày |
| GET/POST/DELETE | `/price-rules[/:id]` | admin | Rule giá mùa |
| GET/POST/PATCH | `/coupons[/:id]` | admin | Coupon |
| GET/PATCH | `/users[/:id]` | admin | Người dùng, phân quyền, khoá |
| GET | `/payments` | staff | Giao dịch |
| GET | `/reports/occupancy?days=` | staff | Báo cáo công suất |
| GET | `/reports/revenue.csv?days=` | admin | Xuất CSV doanh thu |
| GET | `/audit-logs` | admin | Nhật ký nghiệp vụ |
| GET | `/security-events` | admin | Sự kiện an ninh |
| POST | `/jobs/run` | admin | Chạy job thủ công |

## Mã lỗi thường gặp

| code | HTTP | Ý nghĩa |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Input sai (kèm `details` từng field) |
| `UNAUTHORIZED` / `TOKEN_EXPIRED` | 401 | Chưa đăng nhập / hết phiên |
| `FORBIDDEN` | 403 | Không đủ quyền / CSRF sai / IDOR |
| `NOT_FOUND` | 404 | Không tồn tại |
| `CONFLICT` / `ALREADY_BOOKED` | 409 | Hết phòng / trạng thái không hợp lệ / version conflict |
| `RATE_LIMITED` | 429 | Vượt giới hạn tần suất |
| `PAYMENT_MISMATCH` | 422 | Nhận thiếu tiền |
