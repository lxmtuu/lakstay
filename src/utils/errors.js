/**
 * Lỗi nghiệp vụ có mã + HTTP status.
 * Toàn bộ error đi qua đây => errorHandler trả JSON đồng nhất, KHÔNG leak stack trace.
 */
export class AppError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expected = true; // lỗi "đã lường trước" => không cần log ERROR
  }
}

export const Errors = {
  badRequest:      (msg, d) => new AppError(400, 'BAD_REQUEST', msg, d),
  validation:      (msg, d) => new AppError(422, 'VALIDATION_ERROR', msg, d),
  unauthorized:    (msg = 'Bạn cần đăng nhập') => new AppError(401, 'UNAUTHORIZED', msg),
  forbidden:       (msg = 'Bạn không có quyền thực hiện thao tác này') => new AppError(403, 'FORBIDDEN', msg),
  notFound:        (msg = 'Không tìm thấy dữ liệu') => new AppError(404, 'NOT_FOUND', msg),
  conflict:        (msg, d) => new AppError(409, 'CONFLICT', msg, d),
  locked:          (msg, d) => new AppError(423, 'LOCKED', msg, d),
  tooManyRequests: (msg = 'Quá nhiều yêu cầu, vui lòng thử lại sau') => new AppError(429, 'RATE_LIMITED', msg),
  unprocessable:   (msg, d) => new AppError(422, 'UNPROCESSABLE', msg, d),
  internal:        (msg = 'Lỗi hệ thống') => new AppError(500, 'INTERNAL_ERROR', msg),
};

// Mã lỗi chuyên biệt để client hiển thị thông điệp chính xác
export const BizCode = {
  NO_ROOM_AVAILABLE: 'NO_ROOM_AVAILABLE',
  DATE_INVALID: 'DATE_INVALID',
  ALREADY_BOOKED: 'ALREADY_BOOKED',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  CANCEL_TOO_LATE: 'CANCEL_TOO_LATE',
  HOLD_EXPIRED: 'HOLD_EXPIRED',
  IDEMPOTENT_REPLAY: 'IDEMPOTENT_REPLAY',
  COUPON_INVALID: 'COUPON_INVALID',
  PAYMENT_MISMATCH: 'PAYMENT_MISMATCH',
};
