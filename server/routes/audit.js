const express = require('express');
const { db }  = require('../db');

const router = express.Router();

function requireMaster(req, res) {
  if (req.session.user && req.session.user.isMaster) return true;
  res.status(403).json({ success: false, message: '마스터 권한이 필요합니다.' });
  return false;
}

// POST /api/getAuditLogs
router.post('/getAuditLogs', (req, res) => {
  if (!requireMaster(req, res)) return;

  const { page = 1, limit = 20, factory_id, user_id, action, dateFrom, dateTo } = req.body || {};

  const conditions = [];
  const params = [];

  if (factory_id) { conditions.push('factory_id = ?'); params.push(factory_id); }
  if (user_id)    { conditions.push('user_id = ?');    params.push(user_id); }
  if (action)     { conditions.push('action = ?');     params.push(action); }
  if (dateFrom)   { conditions.push('created_at >= ?'); params.push(dateFrom); }
  if (dateTo)     { conditions.push('created_at <= ?'); params.push(dateTo + ' 23:59:59'); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
  const offset = (Math.max(1, page) - 1) * limit;

  const total = db.prepare(`SELECT COUNT(*) as cnt FROM audit_logs ${where}`).get(...params).cnt;
  const logs  = db.prepare(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);

  res.json({ success: true, logs, total, page, limit });
});

// POST /api/updateAuditLog  (마스터: detail 수정)
router.post('/updateAuditLog', (req, res) => {
  if (!requireMaster(req, res)) return;

  const { id, detail } = req.body || {};
  if (!id) return res.json({ success: false, message: 'id가 필요합니다.' });

  const existing = db.prepare('SELECT id FROM audit_logs WHERE id = ?').get(id);
  if (!existing) return res.json({ success: false, message: '존재하지 않는 항목입니다.' });

  db.prepare('UPDATE audit_logs SET detail = ? WHERE id = ?')
    .run(detail ? JSON.stringify(detail) : null, id);

  res.json({ success: true });
});

// POST /api/deleteAuditLog  (마스터: 단건 삭제)
router.post('/deleteAuditLog', (req, res) => {
  if (!requireMaster(req, res)) return;

  const { id } = req.body || {};
  if (!id) return res.json({ success: false, message: 'id가 필요합니다.' });

  db.prepare('DELETE FROM audit_logs WHERE id = ?').run(id);
  res.json({ success: true });
});

module.exports = router;
