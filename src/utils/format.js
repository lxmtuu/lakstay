/** Định dạng dùng chung cho email / PDF / log */
export const fmtVND = (n) => (Number(n) || 0).toLocaleString('vi-VN') + ' ₫';
export const dmyVN = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};
export const fmtDateTimeVN = (iso) => {
  const s = String(iso || '').replace('T', ' ');
  const [date, time] = s.split(' ');
  return `${dmyVN(date)} ${((time || '').slice(0, 5)) || ''}`.trim();
};
