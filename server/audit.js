const { db, now } = require('./db');

function logAudit(action, targetType, targetId, factoryId, user, detail) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (action, target_type, target_id, factory_id, user_id, user_name, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      action,
      targetType || null,
      targetId   || null,
      factoryId  || null,
      user.id,
      user.name || '',
      detail ? JSON.stringify(detail) : null,
      now()
    );
  } catch (_) {
    // 감사 로그 실패가 주요 작업을 막아선 안 된다
  }
}

module.exports = { logAudit };
