# 🚀 Lộ trình & hướng phát triển

## A. Những gì ĐÃ làm vượt khỏi MVP (đã implement trong bản này)

Ngoài luồng cơ bản *tìm phòng → chọn ngày → kiểm tra trống → đặt → thanh toán → xác nhận*, bản này đã bao gồm:

1. **Chống double-booking 4 lớp** + test chứng minh 40 request đồng thời.
2. **Idempotency** cho cả tạo booking lẫn webhook thanh toán.
3. **State machine** + optimistic locking cho mọi chuyển trạng thái.
4. **Chính sách huỷ 3 tầng** có preview số tiền hoàn trước khi xác nhận.
5. **Engine giá** theo mùa/cuối tuần/khách vượt chuẩn + snapshot bất biến.
6. **Giữ chỗ có TTL** + background job tự nhả phòng / auto complete / no-show.
7. **VietQR chuẩn EMVCo** tự sinh payload + CRC16, reconciliation theo nội dung CK.
8. **RBAC + chống IDOR + CSRF + lockout + refresh rotation/reuse-detection**.
9. **Audit log + security events** có trang xem trong admin.
10. **Trang quản trị đầy đủ**: dashboard, front-desk, tồn kho, chặn phòng, giá mùa, coupon, user, review, giao dịch, báo cáo + xuất CSV.
11. **Migration tự động** (`schema_migrations`) để nâng cấp DB cũ không mất dữ liệu.
12. Frontend có hiệu ứng: parallax hero, sương mù trôi, scroll-reveal, đếm số, skeleton, toast, modal, QR quét + đếm ngược, in voucher.

## B. Việc nên làm tiếp (theo giá trị / độ khó)

### Nhóm 1 — Hoàn thiện sản phẩm (ưu tiên cao)
- [x] **Email xác nhận + voucher PDF** *(đã làm)*: pdfkit render voucher A4 (QR tra cứu đơn, bảng phòng/tiền, chính sách); mail.service gửi khi giữ đơn / PAID (kèm PDF) / huỷ đơn. Không có SMTP thì ghi ra `src/data/outbox/` + admin xem được tại menu "Email đã gửi". SMS/ZNS: để mở rộng tiếp.
- [x] **Realtime thanh toán** *(đã làm)*: SSE `GET /api/payments/:id/stream` (auth qua cookie, heartbeat 25s, tự đóng khi PAID/EXPIRED/FAILED); frontend dùng EventSource, giữ poll 5s làm fallback.
- [x] **Tìm kiếm nâng cao** *(đã làm)*: bộ lọc tiện nghi (AND), khoảng giá, điểm đánh giá ≥; gợi ý **ngày rẻ nhất trong tháng** qua `GET /api/rooms/meta/price-calendar` (chip bấm là đặt luôn ngày đó).
- [ ] **Giỏ nhiều kỳ / nhiều khách sạn**: mở rộng `bookings` thành multi-property (thêm `property_id`).
- [x] **Chương trình thành viên** *(đã làm)*: 1 điểm/10.000₫ khi PAID (idempotent), 4 hạng MEMBER/SILVER/GOLD/PLATINUM giảm 0/2/5/8% áp sau coupon, thu hồi điểm + trừ chi tiêu khi huỷ đơn (rớt hạng được), trang "Thành viên" cho khách + admin điều chỉnh điểm có audit.

### Nhóm 2 — Kỹ thuật hạ tầng
- [ ] **PostgreSQL**: chuyển schema (gần như giữ nguyên) + dùng `SELECT ... FOR UPDATE` / unique partial index; bật connection pool.
- [ ] **Queue thật**: BullMQ + Redis cho job & email & webhook retry có backoff; dead-letter queue.
- [ ] **Cache**: Redis cho `/rooms` public (TTL 30s) + invalidate khi có booking; giảm tải DB.
- [ ] **Observability**: OpenTelemetry traces, Prometheus metrics (`/metrics`), structured log đẩy về Loki/ELK; dashboard Grafana.
- [x] **Báo cáo biểu đồ** *(đã làm)*: `GET /api/admin/reports/charts?days=N` (chuỗi doanh thu/đơn theo ngày liền mạch, split trạng thái, doanh thu theo hạng phòng) + bộ vẽ SVG thuần không thư viện (area/donut/bar) trong trang Báo cáo admin, chọn kỳ 14/30/60/90 ngày.
- [x] **CI/CD** *(đã làm)*: `.github/workflows/ci.yml` — mỗi push/PR chạy unit → smoke → concurrency (40 racers) trên server thật + build & boot Docker image kèm healthcheck; upload server.log khi fail. Deploy tự động: tuỳ hạ tầng, để mở rộng tiếp.
- [x] **Docker** *(đã làm — bản gọn)*: `Dockerfile` (node:20-bookworm-slim, non-root, healthcheck) + `docker-compose.yml` (volume `lakstay-data`, service `--profile init` để seed một lần). Postgres/Redis: để mở rộng tiếp khi cần scale.
- [ ] **API contract test**: sinh OpenAPI 3 từ zod schema (zod-to-openapi) + contract test với consumer.

### Nhóm 3 — Nghiệp vụ nâng cao
- [ ] **Overbooking có kiểm soát**: cho phép bán vượt N% theo phân tích no-show lịch sử (revenue management).
- [ ] **Dynamic pricing**: hệ số theo cầu thực tế (công suất dự báo) thay vì rule cố định.
- [ ] **Channel manager**: đồng bộ tồn kho với OTA (Booking.com/Agoda) qua iCal/ARI để tránh lệch kho.
- [ ] **Housekeeping**: trạng thái dọn phòng theo thời gian thực, gán việc cho buồng phòng.
- [x] **i18n vi/en** *(đã làm — phần khách)*: core `public/js/i18n.js` (~150 keys, localStorage, tự dò ngôn ngữ trình duyệt), nút VI/EN trên header; dịch nav/footer/trang chủ/rooms/chi tiết phòng/luồng đặt phòng/profile/trạng thái đơn; nội dung phòng song ngữ qua cột `description_en` (migration tự backfill) + tên EN có sẵn; tiện nghi có map vi→en. Đa tiền tệ & múi giờ: để mở rộng tiếp. Admin panel giữ tiếng Việt (công cụ nội bộ).
- [ ] **Xuất hoá đơn điện tử** chuẩn quy định thuế.

### Nhóm 4 — Bảo mật nâng cao
- [ ] OAuth2 social login (Google/Zalo) + xác thực email bắt buộc.
- [ ] 2FA TOTP cho tài khoản staff/admin.
- [ ] Device fingerprint + phát hiện đăng nhập bất thường.
- [ ] Mã hoá cột nhạy cảm (PII) ở rest + quản lý khoá (KMS).
- [ ] Pentest định kỳ + dependency scan (npm audit, Snyk) trong CI.

## C. Gợi ý lộ trình học / trình bày project

Nếu dùng project này để **phỏng vấn / báo cáo**, thứ tự kể chuyện thuyết phục nhất:

1. Bài toán double-booking và 4 lớp phòng thủ → demo `npm run test:concurrency`.
2. Vì sao dùng `BEGIN IMMEDIATE` và vì sao vẫn cần PK ở DB.
3. State machine + optimistic locking: demo hai tab cùng sửa một đơn.
4. Idempotency: demo bấm nút thanh toán 2 lần / webhook gọi lại.
5. Chính sách huỷ & cách tính tiền hoàn minh bạch.
6. Bảo mật: CSRF, IDOR, refresh rotation — chỉ vào test tương ứng trong `tests/smoke.js`.

Mỗi mục đều có **test chạy được** để chứng minh, không chỉ nói lý thuyết.
