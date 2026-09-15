import QRCode from 'qrcode';
import { config } from '../config/index.js';

/**
 * ============================================================================
 *  VIETQR / EMVCo MERCHANT-PRESENTED QR GENERATOR
 * ============================================================================
 *  Tự sinh chuỗi QR theo chuẩn EMVCo + NAPAS (VietQR) thay vì gọi dịch vụ ngoài:
 *   - Không phụ thuộc bên thứ 3, không rate-limit, không lộ thông tin.
 *   - Hiểu rõ format => có thể tự verify/reconcile.
 *
 *  Cấu trúc TLV: [2 ký tự ID][2 ký tự độ dài][giá trị]
 *
 *  00 Payload Format Indicator = "01"
 *  01 Point of Initiation      = "12" (dynamic — mỗi QR 1 giao dịch)
 *  38 Merchant Account Info (NAPAS)
 *      00 AID                  = "A000000727"
 *      01 Bank BIN             = "970436" (Vietcombank)
 *      02 Account number
 *      03 Service code         = "QRIBFTTC" (chuyển khoản tới tài khoản)
 *  53 Currency                 = "704" (VND)
 *  54 Amount
 *  58 Country                  = "VN"
 *  62 Additional Data
 *      08 Purpose of transaction (nội dung CK — đây là khoá để reconcile tự động)
 *  63 CRC16-CCITT (0x1021, init 0xFFFF), 4 ký tự hex HOA
 * ============================================================================
 */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i << 8;
    for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    t[i] = crc;
  }
  return t;
})();

export function crc16(data) {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 8) ^ data.charCodeAt(i)) & 0xff]) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

const tlv = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/**
 * Nội dung chuyển khoản: CHỈ dùng A-Z 0-9 (chuẩn NAPAS không nhận dấu/ký tự lạ).
 * Đây chính là "khoá" để hệ thống tự đối soát khi webhook/bank gửi về.
 */
export function normalizeTransferContent(s) {
  return String(s || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')       // bỏ dấu
    .replace(/Đ/g, 'D')
    .replace(/[^A-Z0-9]/g, ' ')            // chỉ giữ A-Z 0-9 + space
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90);                         // NAPAS giới hạn độ dài
}

/**
 * Sinh chuỗi payload EMVCo.
 * @returns {string} chuỗi nhúng vào QR
 */
export function buildVietQRPayload({
  amount,
  content,
  bankBin = config.bank.bin,
  accountNumber = config.bank.account,
  serviceName = 'QRIBFTTC',
}) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('amount phải là số nguyên dương');
  if (amount > 999_999_999) throw new Error('amount vượt giới hạn QR');

  const merchantInfo =
    tlv('00', 'A000000727') +
    tlv('01', bankBin) +
    tlv('02', accountNumber) +
    tlv('03', serviceName);

  const additional = tlv('08', normalizeTransferContent(content));

  let payload =
    tlv('00', '01') +
    tlv('01', '12') +
    tlv('38', merchantInfo) +
    tlv('53', '704');

  if (amount) payload += tlv('54', String(amount));
  payload += tlv('58', 'VN');
  payload += tlv('62', additional);
  payload += '6304';

  return payload + crc16(payload);
}

/** Verify CRC của 1 payload (dùng khi nhận QR từ bên ngoài) */
export function verifyVietQRPayload(payload) {
  if (!payload || payload.length < 8) return false;
  const body = payload.slice(0, -4);
  const crc = payload.slice(-4);
  return crc16(body) === crc.toUpperCase();
}

/** Parse payload thành object để hiển thị/đối soát */
export function parseVietQRPayload(payload) {
  const out = {};
  let i = 0;
  const walk = (str, target) => {
    let p = 0;
    while (p < str.length - 4) {
      const id = str.slice(p, p + 2);
      const len = parseInt(str.slice(p + 2, p + 4), 10);
      const val = str.slice(p + 4, p + 4 + len);
      target[id] = val;
      if (id === '38' || id === '62' || id === '26') {
        target[id] = {};
        walk(val, target[id]);
      }
      p += 4 + len;
    }
  };
  walk(payload, out);
  return {
    valid: verifyVietQRPayload(payload),
    amount: out['54'] ? Number(out['54']) : null,
    currency: out['53'],
    country: out['58'],
    bank_bin: out['38']?.['01'],
    account_number: out['38']?.['02'],
    content: out['62']?.['08'],
  };
}

/** Sinh ảnh QR dạng data-URI (SVG) — nhúng thẳng vào JSON/HTML, không cần file */
export async function buildQRDataUri(payload, { type = 'svg', margin = 1, width = 320 } = {}) {
  if (type === 'svg') {
    const svg = await QRCode.toString(payload, { type: 'svg', margin, width, errorCorrectionLevel: 'M' });
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  }
  return QRCode.toDataURL(payload, { margin, width, errorCorrectionLevel: 'M' });
}

/**
 * Fallback/alt: URL ảnh VietQR công khai (Casso/Napas) — dùng khi muốn hiển thị
 * QR "chính chủ" có logo ngân hàng. Frontend có thể chọn 1 trong 2.
 */
export function vietqrImageUrl({ amount, content, bankBin = config.bank.bin, accountNumber = config.bank.account, accountName = config.bank.accountName }) {
  const q = new URLSearchParams({
    amount: String(amount),
    addInfo: normalizeTransferContent(content),
    accountName,
  });
  return `https://img.vietqr.io/image/${bankBin}-${accountNumber}-compact2.png?${q.toString()}`;
}

export const bankInfo = () => ({
  bin: config.bank.bin,
  bank_name: config.bank.bankName,
  account_number: config.bank.account,
  account_name: config.bank.accountName,
  transfer_content_note: 'Nội dung chuyển khoản là BẮT BUỘC — hệ thống dùng nó để tự động xác nhận thanh toán.',
});
