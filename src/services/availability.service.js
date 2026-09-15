import { db } from '../db.js';
import { stayDates, diffDays, isValidDateString, todayISO, addDays, isWeekend } from '../utils/date.js';
import { Errors, BizCode } from '../utils/errors.js';

/**
 * ============================================================================
 *  AVAILABILITY SERVICE — "còn phòng hay không?"
 * ============================================================================
 *
 *  Mô hình tồn kho: room_calendar (room_id, stay_date) là PK.
 *  => Mỗi phòng vật lý mỗi đêm chỉ có THỂ thuộc về 1 booking.
 *
 *  Số phòng còn trống của 1 room_type trong khoảng [checkIn, checkOut):
 *      available(date) = totalRooms - count(occupied rooms of that type on date)
 *      available(range) = MIN over all dates   <-- vì khách ở CẢ kỳ, không ở 1 đêm
 *
 *  Dùng MIN chứ không dùng AVG/SUM: nếu 1/10 - 3/10 còn 5 phòng nhưng 2/10 hết,
 *  thì KHÔNG THỂ nhận booking 2 đêm cho 2 khách.
 * ============================================================================
 */

const ACTIVE_STATUSES = "('HELD','CONFIRMED','BLOCKED')";

/** Tồn kho theo từng đêm cho 1 room type */
export function getInventoryByDate(roomTypeId, checkIn, checkOut) {
  const dates = stayDates(checkIn, checkOut);
  if (!dates.length) return [];

  const rt = db.prepare(`SELECT id, total_rooms FROM room_types WHERE id = ? AND is_active = 1`).get(roomTypeId);
  if (!rt) throw Errors.notFound('Loại phòng không tồn tại');

  // 1 query cho cả kỳ thay vì N query cho N đêm (tránh N+1)
  const placeholders = dates.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT stay_date, COUNT(*) AS occupied
    FROM room_calendar
    WHERE room_type_id = ? AND status IN ${ACTIVE_STATUSES}
      AND stay_date IN (${placeholders})
    GROUP BY stay_date
  `).all(roomTypeId, ...dates);

  // Phòng bị BLOCK (bảo trì...) cũng phải trừ khỏi tồn kho
  const blocked = db.prepare(`
    SELECT rb.block_date, COUNT(*) AS n
    FROM room_blocks rb JOIN rooms r ON r.id = rb.room_id
    WHERE r.room_type_id = ? AND rb.block_date IN (${placeholders})
    GROUP BY rb.block_date
  `).all(roomTypeId, ...dates);

  // Phòng đang ở trạng thái maintenance/blocked (toàn thời gian)
  const outOfService = db.prepare(`
    SELECT COUNT(*) n FROM rooms WHERE room_type_id = ? AND status <> 'available'`).get(roomTypeId).n;

  const map = new Map(rows.map((r) => [r.stay_date, r.occupied]));
  const blockMap = new Map(blocked.map((r) => [r.block_date, r.n]));
  const sellable = Math.max(0, rt.total_rooms - outOfService);

  return dates.map((d) => {
    const occupied = map.get(d) || 0;
    const blockedN = blockMap.get(d) || 0;
    return {
      date: d,
      total: rt.total_rooms,
      sellable,
      occupied,
      blocked: blockedN,
      out_of_service: outOfService,
      available: Math.max(0, sellable - occupied - blockedN),
      weekend: isWeekend(d),
    };
  });
}

/** Số phòng còn trống cho CẢ kỳ (min theo đêm) */
export function countAvailable(roomTypeId, checkIn, checkOut) {
  const inv = getInventoryByDate(roomTypeId, checkIn, checkOut);
  if (!inv.length) return 0;
  return Math.min(...inv.map((i) => i.available));
}

/** Tồn kho của TẤT CẢ room types (dùng cho trang search) */
export function searchAvailability({ checkIn, checkOut, guests = 1 }) {
  const types = db.prepare(`SELECT * FROM room_types WHERE is_active = 1 ORDER BY base_price ASC`).all();
  return types.map((t) => {
    const inventory = getInventoryByDate(t.id, checkIn, checkOut);
    const available = inventory.length ? Math.min(...inventory.map((i) => i.available)) : 0;
    return {
      room_type: t,
      inventory,
      available,
      fits_guests: t.capacity >= guests,
    };
  });
}

/**
 * Chọn phòng vật lý cụ thể cho N phòng của 1 room type trong kỳ.
 *
 * Chiến lược: chọn phòng có ÍT lần bị chiếm nhất trong kỳ (wear-levelling)
 * để các phòng được dùng đều nhau — chi tiết vận hành thực tế.
 *
 * QUAN TRỌNG: hàm này PHẢI được gọi bên trong withTransaction(BEGIN IMMEDIATE)
 * để không có 2 request cùng chọn trùng 1 phòng.
 */
export function pickRooms(roomTypeId, checkIn, checkOut, qty) {
  const dates = stayDates(checkIn, checkOut);
  const placeholders = dates.map(() => '?').join(',');

  const candidates = db.prepare(`
    SELECT r.id,
      (SELECT COUNT(*) FROM room_calendar rc
        WHERE rc.room_id = r.id AND rc.stay_date IN (${placeholders})) AS busy_nights
    FROM rooms r
    WHERE r.room_type_id = ? AND r.status = 'available'
      -- phòng không bị chiếm đêm nào trong kỳ
      AND NOT EXISTS (
        SELECT 1 FROM room_calendar rc2
        WHERE rc2.room_id = r.id AND rc2.stay_date IN (${placeholders})
      )
      -- phòng không bị block (bảo trì/VIP) đêm nào trong kỳ
      AND NOT EXISTS (
        SELECT 1 FROM room_blocks rb
        WHERE rb.room_id = r.id AND rb.block_date IN (${placeholders})
      )
    ORDER BY busy_nights ASC, r.room_number ASC
    LIMIT ?
  `).all(...dates, roomTypeId, ...dates, ...dates, qty);

  if (candidates.length < qty) {
    throw Errors.conflict(
      `Chỉ còn ${candidates.length}/${qty} phòng trống cho khoảng ngày này`,
      { code: BizCode.NO_ROOM_AVAILABLE }
    );
  }
  return candidates.map((c) => c.id);
}

/** Ghi chiếm phòng vào room_calendar — PK sẽ ném lỗi nếu trùng (lớp bảo vệ cuối) */
export function holdRooms(roomIds, dates, bookingId, roomTypeId, status = 'HELD') {
  const ins = db.prepare(`
    INSERT INTO room_calendar (room_id, stay_date, booking_id, room_type_id, status)
    VALUES (?,?,?,?,?)
  `);
  for (const roomId of roomIds) for (const date of dates) ins.run(roomId, date, bookingId, roomTypeId, status);
}

/** Nhả phòng (huỷ / hết hạn giữ chỗ) */
export function releaseRooms(bookingId) {
  return db.prepare(`DELETE FROM room_calendar WHERE booking_id = ?`).run(bookingId).changes;
}

/**
 * VALIDATE NGÀY — tất cả quy tắc thời gian của nghiệp vụ booking.
 * Trả về lỗi rõ ràng, cụ thể (không phải "ngày không hợp lệ" chung chung).
 */
export function validateStayDates({ checkIn, checkOut, minStay = 1, maxStay = 30, maxAdvanceDays = 365 }) {
  if (!isValidDateString(checkIn) || !isValidDateString(checkOut)) {
    throw Errors.badRequest('Định dạng ngày phải là YYYY-MM-DD', { code: BizCode.DATE_INVALID });
  }
  if (checkOut <= checkIn) {
    throw Errors.badRequest('Ngày trả phòng phải sau ngày nhận phòng', { code: BizCode.DATE_INVALID });
  }
  const nights = diffDays(checkIn, checkOut);
  const today = todayISO();

  if (checkIn < today) {
    throw Errors.badRequest('Không thể đặt phòng trong quá khứ', { code: BizCode.DATE_INVALID });
  }
  if (nights > maxStay) {
    throw Errors.badRequest(`Tối đa ${maxStay} đêm cho một lần đặt`, { code: BizCode.DATE_INVALID });
  }
  if (nights < minStay) {
    throw Errors.badRequest(`Loại phòng này yêu cầu tối thiểu ${minStay} đêm`, { code: BizCode.DATE_INVALID });
  }
  if (checkIn > addDays(today, maxAdvanceDays)) {
    throw Errors.badRequest(`Chỉ nhận đặt trước tối đa ${maxAdvanceDays} ngày`, { code: BizCode.DATE_INVALID });
  }
  // Cho phép đặt "hôm nay" nhưng check-in phải còn trong tương lai gần
  if (checkIn === today) {
    const hour = new Date().getUTCHours() + 7; // Asia/Ho_Chi_Minh = UTC+7
    if (hour >= 22) {
      throw Errors.badRequest('Đã quá 22:00, vui lòng chọn ngày nhận phòng khác', { code: BizCode.DATE_INVALID });
    }
  }
  return { nights };
}

/** Lịch phòng trống 30 ngày cho dashboard admin */
export function occupancyCalendar({ from = todayISO(), days = 30 } = {}) {
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const placeholders = dates.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT stay_date, room_type_id, COUNT(*) AS occupied
    FROM room_calendar
    WHERE status IN ${ACTIVE_STATUSES} AND stay_date IN (${placeholders})
    GROUP BY stay_date, room_type_id
  `).all(...dates);

  const types = db.prepare(`SELECT id, name_vi, slug, total_rooms FROM room_types WHERE is_active = 1`).all();
  const lookup = new Map();
  for (const r of rows) lookup.set(`${r.stay_date}|${r.room_type_id}`, r.occupied);

  const totalRooms = types.reduce((s, t) => s + t.total_rooms, 0);
  return {
    dates: dates.map((d) => {
      const byType = types.map((t) => ({
        id: t.id, slug: t.slug, name: t.name_vi,
        total: t.total_rooms,
        occupied: lookup.get(`${d}|${t.id}`) || 0,
      }));
      const occupied = byType.reduce((s, b) => s + b.occupied, 0);
      return {
        date: d,
        weekend: isWeekend(d),
        by_type: byType,
        total_rooms: totalRooms,
        occupied,
        available: totalRooms - occupied,
        occupancy_pct: totalRooms ? Math.round((occupied / totalRooms) * 100) : 0,
      };
    }),
  };
}
