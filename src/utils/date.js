/**
 * Date helpers — làm việc với "ngày khách sạn" (stay date) ở dạng YYYY-MM-DD.
 *
 * NGUYÊN TẮC QUAN TRỌNG:
 *  - Không dùng Date object trực tiếp để so sánh ngày (bug timezone cực dễ xảy ra).
 *  - Luôn chuẩn hoá về chuỗi YYYY-MM-DD, parse bằng Date.UTC để tránh lệch múi giờ.
 *  - check_in là ngày ĐẦU TIÊN được ở, check_out là ngày RỜI ĐI (không tính đêm đó).
 *    => số đêm = check_out - check_in, và các đêm bị chiếm là [check_in, check_out).
 */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateString(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && toISODate(d) === s; // chặn 2024-02-30
}

export function toISODate(d) {
  return d.toISOString().slice(0, 10);
}

export function parseDate(s) {
  return new Date(`${s}T00:00:00Z`);
}

export function todayISO() {
  return toISODate(new Date());
}

export function addDays(iso, days) {
  const d = parseDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

export function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86_400_000);
}

/** Liệt kê các đêm [start, end) */
export function stayDates(checkIn, checkOut) {
  const out = [];
  const nights = diffDays(checkIn, checkOut);
  for (let i = 0; i < nights; i++) out.push(addDays(checkIn, i));
  return out;
}

/** 2 khoảng [aS,aE) và [bS,bE) có giao nhau không — dùng cho overlap check */
export function rangesOverlap(aS, aE, bS, bE) {
  return aS < bE && bS < aE;
}

/** 0=CN ... 6=T7 */
export const dayOfWeek = (iso) => parseDate(iso).getUTCDay();

export const isWeekend = (iso) => [5, 6, 0].includes(dayOfWeek(iso));

export function formatVN(iso) {
  if (!isValidDateString(iso)) return iso;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function hoursUntil(isoDateTime) {
  return (new Date(isoDateTime + (isoDateTime.endsWith('Z') ? '' : 'Z')).getTime() - Date.now()) / 3_600_000;
}

export function nowISO() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function plusMinutesISO(minutes) {
  return new Date(Date.now() + minutes * 60_000).toISOString().replace('T', ' ').slice(0, 19);
}
