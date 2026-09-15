import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/index.js';
import { getBookingById } from './booking.service.js';
import { STATUS_META } from './booking-state.js';
import { dmyVN, fmtVND, fmtDateTimeVN } from '../utils/format.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONT = path.resolve(__dirname, '../assets/fonts/DejaVuSans.ttf');
const FONT_BOLD = path.resolve(__dirname, '../assets/fonts/DejaVuSans-Bold.ttf');

/* Màu thương hiệu (RGB) */
const PINE = [12, 53, 39];
const PINE_LIGHT = [29, 106, 78];
const GOLD = [201, 162, 75];
const INK = [21, 32, 26];
const MUTED = [107, 122, 113];
const SAND = [239, 230, 214];
const CREAM = [247, 242, 232];

/**
 * Sinh voucher PDF (A4) cho 1 booking.
 * Font DejaVuSans được bundle kèm repo => tiếng Việt render đúng trên mọi máy.
 * QR nhúng trong voucher chứa mã xác thực để lễ tân quét ở quầy.
 */
export async function renderVoucherPDF(bookingId) {
  const b = getBookingById(bookingId);
  if (!b) throw new Error('Không tìm thấy booking');

  const verifyPayload = JSON.stringify({
    c: b.code, in: b.check_in, out: b.check_out, g: b.guest_name,
  });
  const qrDataUrl = await QRCode.toDataURL(`${config.publicUrl}/verify/${b.code}`, {
    margin: 1, width: 220, errorCorrectionLevel: 'M',
  });

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: {
      Title: `LakStay Voucher ${b.code}`, Author: 'LakStay Hotel', Subject: 'Xác nhận đặt phòng',
    } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const W = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const L = doc.page.margins.left;

    /* ---------- header band ---------- */
    doc.rect(0, 0, doc.page.width, 118).fill(PINE);
    doc.rect(0, 118, doc.page.width, 4).fill(GOLD);
    doc.font(FONT_BOLD).fontSize(24).fillColor([255, 255, 255]).text('LakStay', L, 34);
    doc.font(FONT).fontSize(8.5).fillColor(GOLD)
      .text('ĐÀ LẠT · BOUTIQUE HOTEL & RESORT', L, 62, { characterSpacing: 2 });
    doc.font(FONT).fontSize(9).fillColor([220, 228, 224])
      .text('18 Trần Phú, P.3, TP. Đà Lạt, Lâm Đồng\nHotline 1900 6789 · booking@lakstay.vn', L, 78, { lineGap: 2 });

    doc.font(FONT_BOLD).fontSize(15).fillColor([255, 255, 255])
      .text('PHIẾU XÁC NHẬN ĐẶT PHÒNG', doc.page.width - doc.page.margins.right, 40, { align: 'right', width: 260 });
    doc.font(FONT).fontSize(9).fillColor(GOLD)
      .text(`Mã: ${b.code}`, doc.page.width - doc.page.margins.right, 62, { align: 'right', width: 260 });
    doc.font(FONT).fontSize(8.5).fillColor([200, 210, 205])
      .text(`Phát hành: ${fmtDateTimeVN(new Date().toISOString())}`, doc.page.width - doc.page.margins.right, 76, { align: 'right', width: 260 });

    doc.y = 150;

    /* ---------- status pill ---------- */
    const meta = STATUS_META[b.status] || { vi: b.status };
    const paid = (b.payments || []).filter((p) => p.type === 'CHARGE' && p.status === 'PAID').reduce((s, p) => s + p.amount, 0);
    doc.roundedRect(L, doc.y, W, 40, 6).fill(CREAM);
    doc.font(FONT_BOLD).fontSize(10).fillColor(PINE)
      .text(`Trạng thái: ${meta.vi.toUpperCase()}`, L + 14, doc.y + 13);
    doc.font(FONT).fontSize(9).fillColor(MUTED)
      .text(paid >= b.total_amount ? 'Đã thanh toán đầy đủ' : paid > 0 ? `Đã trả ${fmtVND(paid)} / ${fmtVND(b.total_amount)}` : 'Chưa thanh toán',
        L + 14, doc.y + 26);
    doc.font(FONT_BOLD).fontSize(11).fillColor(paid >= b.total_amount ? PINE_LIGHT : GOLD)
      .text(fmtVND(b.total_amount), L + W - 14, doc.y + 15, { align: 'right', width: 200 });
    doc.y += 58;

    /* ---------- QR + khách ---------- */
    const qrTop = doc.y;
    doc.image(qrDataUrl, L, qrTop, { width: 108 });
    doc.font(FONT).fontSize(7.5).fillColor(MUTED)
      .text('Lễ tân quét mã để xác thực', L, qrTop + 112, { width: 108, align: 'center' });

    const colX = L + 130;
    const colW = W - 130;
    doc.font(FONT_BOLD).fontSize(11).fillColor(INK).text('KHÁCH LƯU TRÚ', colX, qrTop);
    doc.font(FONT).fontSize(10).fillColor(INK)
      .text(`${b.guest_name}`, colX, qrTop + 18);
    doc.font(FONT).fontSize(9).fillColor(MUTED)
      .text(`ĐT: ${b.guest_phone}   ·   Email: ${b.guest_email}`, colX, qrTop + 34, { width: colW });
    if (b.special_request) {
      doc.font(FONT).fontSize(9).fillColor(MUTED)
        .text(`Yêu cầu: ${b.special_request}`, colX, qrTop + 50, { width: colW });
    }
    doc.y = qrTop + 132;

    /* ---------- kỳ nghỉ ---------- */
    sectionTitle(doc, L, W, 'KỲ NGHỈ');
    const stayTop = doc.y;
    doc.roundedRect(L, stayTop, W / 3 - 8, 52, 5).fill(CREAM);
    doc.roundedRect(L + W / 3 + 4, stayTop, W / 3 - 8, 52, 5).fill(CREAM);
    doc.roundedRect(L + (2 * W) / 3 + 8, stayTop, W / 3 - 8, 52, 5).fill(CREAM);
    const cells = [
      ['NHẬN PHÒNG', `${dmyVN(b.check_in)}  ·  14:00`],
      ['TRẢ PHÒNG', `${dmyVN(b.check_out)}  ·  12:00`],
      ['THỜI GIAN', `${b.nights} đêm  ·  ${b.guests} khách`],
    ];
    cells.forEach(([label, val], i) => {
      const x = L + (i * W) / 3 + (i === 0 ? 0 : i === 1 ? 4 : 8);
      doc.font(FONT).fontSize(7.5).fillColor(MUTED).text(label, x + 12, stayTop + 10, { characterSpacing: 1 });
      doc.font(FONT_BOLD).fontSize(11).fillColor(PINE).text(val, x + 12, stayTop + 26);
    });
    doc.y = stayTop + 68;

    /* ---------- phòng ---------- */
    sectionTitle(doc, L, W, 'HẠNG PHÒNG ĐÃ ĐẶT');
    (b.lines || []).forEach((l) => {
      doc.font(FONT_BOLD).fontSize(10).fillColor(INK).text(`${l.qty} × ${l.room_type_name || l.name_vi}`, L, doc.y);
      doc.font(FONT).fontSize(9).fillColor(MUTED).text(fmtVND(l.line_total), L + W, doc.y - 13, { align: 'right', width: 120 });
      doc.moveDown(0.4);
    });
    const rooms = [...new Set((b.assigned_rooms || []).map((r) => r.room_number))];
    if (rooms.length) {
      doc.font(FONT).fontSize(9).fillColor(PINE_LIGHT).text(`Phòng được xếp: ${rooms.map((r) => 'P.' + r).join(', ')}`, L, doc.y + 2);
      doc.moveDown(0.8);
    }
    doc.moveDown(0.6);

    /* ---------- tiền ---------- */
    sectionTitle(doc, L, W, 'CHI TIẾT THANH TOÁN');
    const money = [
      ['Tạm tính tiền phòng', b.subtotal],
      ...(b.discount_total ? [[`Giảm giá${b.coupon_code ? ` (${b.coupon_code})` : ''}`, -b.discount_total]] : []),
      ...(b.member_discount ? [['Ưu đãi hạng thành viên', -b.member_discount]] : []),
      ['Phí phục vụ', b.service_fee],
      ['Thuế GTGT', b.tax],
    ];
    money.forEach(([label, val]) => {
      doc.font(FONT).fontSize(9.5).fillColor(INK).text(label, L, doc.y);
      doc.font(FONT).fontSize(9.5).fillColor(val < 0 ? PINE_LIGHT : INK)
        .text((val < 0 ? '−' : '') + fmtVND(Math.abs(val)), L + W, doc.y - 12, { align: 'right', width: 130 });
      doc.moveDown(0.35);
    });
    doc.moveTo(L, doc.y + 2).lineTo(L + W, doc.y + 2).strokeColor(SAND).lineWidth(1).stroke();
    doc.moveDown(0.6);
    doc.font(FONT_BOLD).fontSize(12).fillColor(PINE).text('TỔNG CỘNG', L, doc.y);
    doc.font(FONT_BOLD).fontSize(13).fillColor(PINE).text(fmtVND(b.total_amount), L + W, doc.y - 2, { align: 'right', width: 140 });
    doc.moveDown(1.4);

    /* ---------- chính sách ---------- */
    doc.roundedRect(L, doc.y, W, 64, 6).fill([253, 243, 220]);
    doc.font(FONT_BOLD).fontSize(9).fillColor([122, 90, 10]).text('CHÍNH SÁCH HUỶ & LƯU Ý', L + 12, doc.y + 10);
    doc.font(FONT).fontSize(8.5).fillColor([122, 90, 10]).text(
      'Huỷ miễn phí trước mốc cho phép của từng hạng phòng; sau mốc này phí huỷ được tính theo chính sách đã đồng ý khi đặt.\n' +
      'Nhận phòng từ 14:00, trả phòng trước 12:00. Vui lòng mang theo CCCD/hộ chiếu và mã phiếu này khi làm thủ tục.\n' +
      'Giá đã gồm thuế phí niêm yết; phụ thu phát sinh (giường phụ, khách vượt chuẩn) sẽ được thông báo trước khi xác nhận.',
      L + 12, doc.y + 24, { width: W - 24, lineGap: 2 });
    doc.y += 84;

    /* ---------- footer ---------- */
    const fy = doc.page.height - doc.page.margins.bottom - 34;
    doc.moveTo(L, fy - 10).lineTo(L + W, fy - 10).strokeColor(SAND).lineWidth(1).stroke();
    doc.font(FONT).fontSize(8).fillColor(MUTED)
      .text('LakStay Hotel JSC · MST 0123456789 · Phiếu này được tạo tự động bởi hệ thống đặt phòng và có giá trị xác nhận tại quầy.',
        L, fy, { width: W - 120, lineGap: 1.5 });
    doc.font(FONT_BOLD).fontSize(8).fillColor(GOLD)
      .text('lakstay.vn', L + W, fy, { align: 'right', width: 110 });

    doc.end();
    void verifyPayload;
  });
}

function sectionTitle(doc, x, w, text) {
  doc.font(FONT_BOLD).fontSize(8.5).fillColor(GOLD).text(text, x, doc.y, { characterSpacing: 1.6 });
  doc.moveTo(x, doc.y + 4).lineTo(x + w, doc.y + 4).strokeColor(SAND).lineWidth(1).stroke();
  doc.y += 12;
}
