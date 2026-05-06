const express = require('express');
const { db, now } = require('../db');
const { ROLE, requireRole } = require('../lib/auth/role');

const router = express.Router();

// POST /api/getWorkers — 공장별 active 작업자 목록
router.post('/getWorkers', (req, res) => {
  const [factoryId] = req.body;
  if (!factoryId) return res.json({ success: false, error: '공장 ID 필요' });

  const workers = db.prepare(
    'SELECT worker_id as workerId, name, department, position, status FROM workers WHERE factory_id = ? AND status = ? ORDER BY worker_id'
  ).all(factoryId, 'active');

  res.json({ success: true, workers });
});

// POST /api/upsertWorker — 작업자 추가/수정 (role >= 3)
router.post('/upsertWorker', (req, res) => {
  const [payload] = req.body;
  const caller = req.session.user;

  if (!payload || !payload.workerId || !payload.name || !payload.factoryId) {
    return res.json({ success: false, error: '필수 항목 누락' });
  }

  if (!requireRole(caller, payload.factoryId, ROLE.MANAGER, res, '권한 없음')) return;

  db.prepare(`
    INSERT INTO workers (worker_id, factory_id, name, department, position, status, hire_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(worker_id) DO UPDATE SET
      name       = excluded.name,
      department = excluded.department,
      position   = excluded.position,
      hire_date  = excluded.hire_date
  `).run(
    payload.workerId,
    payload.factoryId,
    payload.name,
    payload.department || '',
    payload.position   || '',
    payload.status     || 'active',
    payload.hireDate   || null
  );

  res.json({ success: true });
});

// POST /api/updateWorkerStatus — 상태 변경 (퇴사/복직) (role >= 3)
router.post('/updateWorkerStatus', (req, res) => {
  const [payload] = req.body;
  const caller = req.session.user;

  if (!payload || !payload.workerId || !payload.status) {
    return res.json({ success: false, error: '필수 항목 누락' });
  }
  if (!['active', 'inactive'].includes(payload.status)) {
    return res.json({ success: false, error: '유효하지 않은 상태값' });
  }

  const worker = db.prepare('SELECT factory_id FROM workers WHERE worker_id = ?').get(payload.workerId);
  if (!worker) return res.status(404).json({ success: false, error: '작업자 없음' });

  if (!requireRole(caller, worker.factory_id, ROLE.MANAGER, res, '권한 없음')) return;

  db.prepare('UPDATE workers SET status = ? WHERE worker_id = ?').run(payload.status, payload.workerId);
  res.json({ success: true });
});

module.exports = router;
