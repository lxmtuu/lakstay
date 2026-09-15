import { expireStaleHolds, autoCompletePastBookings, markNoShows } from './services/booking.service.js';
import { expireStalePayments } from './services/payment.service.js';
import { logger } from './utils/logger.js';

/**
 * ============================================================================
 *  BACKGROUND JOBS (compensating transactions)
 * ============================================================================
 *  Hệ booking KHÔNG THỂ chỉ dựa vào request của user:
 *   - User mở trang thanh toán rồi đóng tab => booking PENDING giữ phòng mãi mãi.
 *   - Đã qua ngày trả phòng mà không ai bấm "checkout" => phòng không bao giờ trống.
 *  => Cần job chạy nền để đưa hệ thống về trạng thái nhất quán.
 *
 *  Prod: thay setInterval bằng cron/queue (BullMQ + Redis, hoặc pg_cron)
 *  để không chạy trùng khi scale nhiều instance. Ở đây dùng `leader lock` đơn giản
 *  qua DB để demo ý tưởng.
 * ============================================================================
 */

const JOBS = [
  {
    name: 'expire-holds',
    everyMs: 60_000,          // mỗi phút
    fn: () => {
      const n = expireStaleHolds();
      const p = expireStalePayments();
      if (n || p) logger.info('job:expire-holds', { bookings: n, payments: p });
    },
  },
  {
    name: 'nightly-close',
    everyMs: 15 * 60_000,     // mỗi 15 phút (prod: chạy lúc 02:00)
    fn: () => {
      const c = autoCompletePastBookings();
      const ns = markNoShows();
      if (c || ns) logger.info('job:nightly-close', { completed: c, no_shows: ns });
    },
  },
];

export function startJobs() {
  const timers = [];
  if (process.env.DISABLE_JOBS === 'true') {
    logger.warn('Background jobs disabled (DISABLE_JOBS=true)');
    return { stop() {} };
  }
  for (const job of JOBS) {
    const run = () => {
      try { job.fn(); }
      catch (err) { logger.error(`job ${job.name} failed`, { err: err.message }); }
    };
    // Chạy ngay lần đầu sau 5s (để server start xong đã) rồi lặp
    const t0 = setTimeout(run, 5_000);
    const t = setInterval(run, job.everyMs);
    t.unref?.(); t0.unref?.();
    timers.push(t, t0);
    logger.info(`job registered: ${job.name}`, { every_ms: job.everyMs });
  }
  return {
    stop() { timers.forEach(clearInterval); timers.forEach(clearTimeout); },
    runNow(name) { JOBS.find((j) => j.name === name)?.fn(); },
  };
}
