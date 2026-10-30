import { db } from '../db.js';
import { newId } from '../utils/id.js';
import { clientIp } from '../utils/http.js';
import { logger } from '../utils/logger.js';

/**
 * AUDIT LOG — ghi lại MỌI thay đổi trạng thái quan trọng.
 * Với hệ thống có tiền + nhiều role, đây là thứ duy nhất cứu bạn khi có tranh chấp:
 * "Ai đã huỷ booking này? Lúc nào? Từ IP nào? Giá trước/sau là gì?"
 */
export function audit({ req, actor, action, entityType, entityId, before, after, meta }) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (id, actor_id, actor_role, action, entity_type, entity_id, before_data, after_data, ip, user_agent)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      newId('aud'),
      actor?.id ?? req?.user?.id ?? null,
      actor?.role ?? req?.user?.role ?? 'anonymous',
      action,
      entityType ?? null,
      entityId ?? null,
      before ? JSON.stringify(before) : null,
      after ? JSON.stringify({ ...(after || {}), ...(meta || {}) }) : (meta ? JSON.stringify(meta) : null),
      req ? clientIp(req) : 'system',
      req?.headers?.['user-agent'] ?? 'system',
    );
  } catch (err) {
    // Audit fail KHÔNG được làm hỏng nghiệp vụ chính — nhưng phải log to.
    logger.error('Audit write failed', { action, entityId, err: err.message });
  }
}

export function securityEvent({ type, severity = 'warn', ip, userAgent, email, detail }) {
  try {
    db.prepare(`INSERT INTO security_events (id, type, severity, ip, user_agent, email, detail)
                VALUES (?,?,?,?,?,?,?)`)
      .run(newId('sec'), type, severity, ip || null, userAgent || null, email || null, detail || null);
  } catch (err) {
    logger.error('Security event write failed', { type, err: err.message });
  }
}

function buildAuditWhere({ action, entityType, entityId, actorId } = {}) {
  const where = [];
  const params = [];
  if (action) { where.push('action = ?'); params.push(action); }
  if (entityType) { where.push('entity_type = ?'); params.push(entityType); }
  if (entityId) { where.push('entity_id = ?'); params.push(entityId); }
  if (actorId) { where.push('actor_id = ?'); params.push(actorId); }
  return { whereSql: where.length ? 'WHERE ' + where.join(' AND ') : '', params };
}

export const listAudit = ({ action, entityType, entityId, actorId, limit = 50, offset = 0 } = {}) => {
  const { whereSql, params } = buildAuditWhere({ action, entityType, entityId, actorId });
  return db.prepare(`SELECT * FROM audit_logs ${whereSql} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
};

export const countAudit = (filters = {}) => {
  const { whereSql, params } = buildAuditWhere(filters);
  return db.prepare(`SELECT COUNT(*) n FROM audit_logs ${whereSql}`).get(...params).n;
};
