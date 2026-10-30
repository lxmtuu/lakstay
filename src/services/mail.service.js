import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { fmtVND, dmyVN, fmtDateTimeVN } from '../utils/format.js';
import { Errors } from '../utils/errors.js';
import { fromHere } from '../utils/paths.js';
import { STATUS_META } from './booking-state.js';

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

/**
 * ============================================================================
 *  MAIL SERVICE
 * ============================================================================
 *  Hai chế độ giao thư:
 *   - Có cấu hình SMTP (SMTP_HOST...)  → gửi thật qua nodemailer (dynamic import,
 *     không bắt buộc cài nếu không dùng).
 *   - Không cấu hình (mặc định khi dev) → ghi vào "outbox" src/data/outbox/*.html
 *     kèm file đính kèm, và xem được ngay trong trang quản trị (#/outbox).
 *     => Dev vẫn kiểm tra được email mà không cần mailbox thật.
 * ============================================================================
 */

const OUTBOX = process.env.OUTBOX_DIR
  ? path.resolve(process.env.OUTBOX_DIR)
  : (config.isVercel ? '/tmp/lakstay-outbox' : fromHere(import.meta.url, '..', 'data', 'outbox'));
fs.mkdirSync(OUTBOX, { recursive: true });

let transporterPromise = null;
async function getTransport() {
  if (!process.env.SMTP_HOST) return null;
  if (!transporterPromise) {
    transporterPromise = (async () => {
      try {
        const nodemailer = await import('nodemailer');
        return nodemailer.default.createTransport({
          host: process.env.SMTP_HOST,
          port: Number(process.env.SMTP_PORT || 587),
          secure: process.env.SMTP_SECURE === 'true',
          auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        });
      } catch (err) {
        logger.warn('nodemailer không khả dụng, dùng outbox', { err: err.message });
        return null;
      }
    })();
  }
  return transporterPromise;
}

const FROM = process.env.MAIL_FROM || '"LakStay Đà Lạt" <booking@lakstay.vn>';

/**
 * Gửi email. Luôn resolve (không ném lỗi) để không phá luồng nghiệp vụ chính.
 * @returns {{delivered:'smtp'|'outbox', file?:string}}
 */
export async function sendMail({ to, subject, html, attachments = [] }) {
  const safeName = `${Date.now()}-${String(to).replace(/[^a-z0-9]/gi, '_')}-${subject.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}`;
  try {
    const t = await getTransport();
    if (t) {
      await t.sendMail({
        from: FROM, to, subject, html,
        attachments: attachments.map((a) => ({ filename: a.filename, content: a.content })),
      });
      logger.info('mail sent (smtp)', { to, subject });
      return { delivered: 'smtp' };
    }
  } catch (err) {
    logger.warn('smtp send failed, fallback outbox', { to, err: err.message });
  }

  // ---- outbox (dev) ----
  const dir = path.join(OUTBOX, safeName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'email.html'), wrapPreview(to, subject, html));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ to, subject, at: new Date().toISOString(), attachments: attachments.map((a) => a.filename) }, null, 2));
  for (const a of attachments) fs.writeFileSync(path.join(dir, a.filename), a.content);
  logger.info('mail written to outbox', { to, subject, dir });
  return { delivered: 'outbox', file: safeName };
}

const wrapPreview = (to, subject, html) => `<!doctype html><html><head><meta charset="utf-8">
<div style="font:12px/1.5 system-ui;background:#f4f2ec;padding:10px 14px;color:#555">
  <b>To:</b> ${escHtml(to)} &nbsp;·&nbsp; <b>Subject:</b> ${escHtml(subject)} &nbsp;·&nbsp; (bản xem trước ở outbox dev)
</div></head><body style="margin:0">${html}</body></html>`;

/* ============================= TEMPLATES ============================= */

const shell = (title, body) => `
<div style="background:#f4f2ec;padding:28px 12px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:620px;margin:auto;background:#fffdf7;border-radius:14px;overflow:hidden;box-shadow:0 8px 30px rgba(12,53,39,.12)">
    <div style="background:#0c3527;padding:26px 30px;color:#fff">
      <div style="font-size:22px;font-weight:700">LakStay <span style="color:#e3c47e;font-size:11px;letter-spacing:3px">ĐÀ LẠT</span></div>
      <div style="margin-top:6px;font-size:13px;color:#cfd8d3">${escHtml(title)}</div>
    </div>
    <div style="padding:28px 30px;color:#15201a;font-size:14px;line-height:1.65">${body}</div>
    <div style="background:#0c3527;padding:16px 30px;color:#9fb3a8;font-size:11px">
      18 Trần Phú, P.3, TP. Đà Lạt · Hotline 1900 6789 · booking@lakstay.vn<br>
      Facebook · Instagram · TikTok · Zalo: @lakstay.hotel
    </div>
  </div>
</div>`;

const kv = (rows) => `
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px">
  ${rows.map(([k, v]) => `<tr>
    <td style="padding:7px 10px;color:#6b7a71;border-bottom:1px solid #efe6d6;width:42%">${escHtml(k)}</td>
    <td style="padding:7px 10px;font-weight:600;border-bottom:1px solid #efe6d6">${v}</td></tr>`).join('')}
</table>`;

const btn = (href, label, gold = true) => `
<a href="${escHtml(href)}" style="display:inline-block;margin-top:18px;padding:12px 26px;border-radius:999px;text-decoration:none;font-weight:700;font-size:14px;
   background:${gold ? 'linear-gradient(135deg,#c9a24b,#e3c47e)' : '#0c3527'};color:${gold ? '#3a2c0d' : '#fff'}">${escHtml(label)}</a>`;

export const templates = {
  booking_hold({ booking, url }) {
    return {
      subject: `[LakStay] Giữ chỗ thành công — mã ${booking.code}`,
      html: shell('Chúng tôi đã giữ phòng cho bạn', `
        <p>Xin chào <b>${escHtml(booking.guest_name)}</b>,</p>
        <p>Yêu cầu đặt phòng của bạn đã được ghi nhận và <b>giữ chỗ trong 15 phút</b>.
           Hoàn tất thanh toán trong thời gian này để xác nhận chính thức.</p>
        ${kv([
          ['Mã đặt phòng', `<b style="color:#0c3527">${escHtml(booking.code)}</b>`],
          ['Kỳ nghỉ', `${escHtml(dmyVN(booking.check_in))} → ${escHtml(dmyVN(booking.check_out))} (${Number(booking.nights)} đêm)`],
          ['Số khách', Number(booking.guests)],
          ['Tổng tạm tính', `<b>${escHtml(fmtVND(booking.total_amount))}</b>`],
        ])}
        ${btn(url, 'Thanh toán ngay')}
        <p style="color:#6b7a71;font-size:12px;margin-top:20px">Quá thời gian giữ chỗ mà chưa thanh toán, hệ thống sẽ tự động nhả phòng cho khách khác.</p>`),
    };
  },

  booking_confirmed({ booking, url }) {
    return {
      subject: `[LakStay] XÁC NHẬN đặt phòng ${booking.code} — hẹn gặp bạn ở Đà Lạt!`,
      html: shell('Đặt phòng đã được xác nhận', `
        <p>Xin chào <b>${escHtml(booking.guest_name)}</b>,</p>
        <p>Cảm ơn bạn đã thanh toán. Đặt phòng của bạn đã <b>xác nhận thành công</b>.
           Phiếu xác nhận (voucher) đính kèm email này — hãy xuất trình khi làm thủ tục.</p>
        ${kv([
          ['Mã đặt phòng', `<b style="color:#0c3527">${escHtml(booking.code)}</b>`],
          ['Nhận phòng', `${escHtml(dmyVN(booking.check_in))} từ 14:00`],
          ['Trả phòng', `${escHtml(dmyVN(booking.check_out))} trước 12:00`],
          ['Hạng phòng', escHtml((booking.lines || []).map((l) => `${l.qty}× ${l.room_type_name || l.name_vi}`).join(', '))],
          ['Đã thanh toán', `<b style="color:#1d6a4e">${escHtml(fmtVND(booking.paid_amount ?? booking.total_amount))}</b>`],
        ])}
        ${btn(url, 'Xem chi tiết đặt phòng')}
        <p style="color:#6b7a71;font-size:12px;margin-top:20px">Cần thay đổi? Bạn có thể huỷ miễn phí trước mốc chính sách trong trang "Đặt phòng của tôi".</p>`),
    };
  },

  booking_cancelled({ booking, refund, url }) {
    return {
      subject: `[LakStay] Đã huỷ đặt phòng ${booking.code}`,
      html: shell('Thông báo huỷ đặt phòng', `
        <p>Xin chào <b>${escHtml(booking.guest_name)}</b>,</p>
        <p>Đặt phòng <b>${escHtml(booking.code)}</b> (${escHtml(dmyVN(booking.check_in))} → ${escHtml(dmyVN(booking.check_out))}) đã được huỷ theo yêu cầu.</p>
        ${kv([
          ['Trạng thái', escHtml(STATUS_META[booking.status]?.vi || booking.status)],
          ['Số tiền hoàn', `<b style="color:${refund?.refund_amount ? '#1d6a4e' : '#c0392b'}">${escHtml(fmtVND(refund?.refund_amount || 0))}</b>`],
          ['Phí huỷ', escHtml(fmtVND(refund?.penalty || 0))],
          ['Ghi chú', escHtml(refund?.message || '')],
        ])}
        <p style="color:#6b7a71;font-size:12px">Tiền hoàn (nếu có) sẽ về tài khoản đã thanh toán trong 3–5 ngày làm việc.</p>
        ${btn(url, 'Xem lại đặt phòng', false)}`),
    };
  },
};

/** Tiện ích: gửi theo template, fire-and-forget an toàn */
export function notify(template, data) {
  try {
    const t = templates[template](data);
    sendMail({ to: data.booking.guest_email, ...t, attachments: data.attachments || [] })
      .catch((err) => logger.warn('notify failed', { template, err: err.message }));
  } catch (err) {
    logger.warn('notify build failed', { template, err: err.message });
  }
}

/* ============================= OUTBOX (admin) ============================= */
export function listOutbox() {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs.readdirSync(OUTBOX, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(OUTBOX, d.name, 'meta.json'), 'utf8'));
        return { id: d.name, ...meta };
      } catch { return { id: d.name, to: '?', subject: '?' }; }
    })
    .sort((a, b) => (a.id < b.id ? 1 : -1))
    .slice(0, 60);
}

export function readOutbox(id, file = 'email.html') {
  const safe = String(id || '').replace(/[^a-z0-9_-]/gi, '');
  const safeFile = String(file || '').replace(/[^a-z0-9._-]/gi, '');
  if (!safe || !safeFile || safeFile === '.' || safeFile === '..') {
    throw Errors.badRequest('Đường dẫn không hợp lệ');
  }
  const root = path.resolve(OUTBOX);
  const p = path.resolve(root, safe, safeFile);
  if (!p.startsWith(root + path.sep)) throw Errors.badRequest('Đường dẫn không hợp lệ');
  if (!fs.existsSync(p)) throw Errors.notFound('Không tìm thấy nội dung outbox');
  return fs.readFileSync(p);
}

export { fmtDateTimeVN };
