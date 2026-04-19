const express = require('express');
const { db, safeJson, today } = require('../db');
const { requireAuth }         = require('../middleware/session');

const router = express.Router();

const FACTORIES = [
  { id: 'pb1', name: '1공장(PBⅠ)' },
  { id: 'pb2', name: '2공장(PBⅡ)' },
];

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

function getUserByName(name) {
  return db.prepare('SELECT * FROM users WHERE name = ?').get(name) || null;
}

function deriveTitle(user) {
  if (!user) return '';
  const deps = safeJson(user.factory_deputies, {});
  for (const fid of Object.keys(deps)) {
    if (deps[fid] !== null && deps[fid] !== undefined) return 'HACCP팀장 대행';
  }
  const roles = safeJson(user.factory_roles, {});
  for (const fid of Object.keys(roles)) {
    if (roles[fid] >= 3) return 'HACCP팀장';
  }
  return user.rank || '';
}

// POST /api/getInitialData
router.post('/getInitialData', requireAuth, (req, res) => {
  const caller = req.session.user;
  const todayStr = today();

  const logTemplates = db.prepare('SELECT * FROM log_templates').all().map(t => ({
    logId:     t.log_id,
    title:     t.title,
    docNo:     t.doc_no,
    revision:  t.revision,
    factoryId: t.factory_id,
    interval:  t.interval,
    metaInfo:  safeJson(t.meta_info, {}),
    approval:  safeJson(t.approval, []),
    items:     safeJson(t.items, []),
  }));

  // logs 배열 (Log_Templates 기반)
  const logs = logTemplates.map(t => ({
    id:        t.logId,
    title:     t.title,
    interval:  t.interval,
    docNo:     t.docNo,
    version:   t.revision,
    factoryId: t.factoryId,
  }));

  // 미결 레코드 — 오늘 레코드 + 미완료 레코드
  const userFactories = caller.isMaster
    ? FACTORIES.map(f => f.id)
    : Object.keys(caller.factoryRoles || {});

  const placeholders = userFactories.map(() => '?').join(',');
  const rawRecords = userFactories.length
    ? db.prepare(
        `SELECT r.*, u.factory_roles as wr_roles FROM records r
         LEFT JOIN users u ON r.writer_id = u.id
         WHERE r.factory_id IN (${placeholders})
           AND (r.date = ? OR r.status NOT IN ('승인완료'))
         ORDER BY r.date DESC, r.created_at DESC`
      ).all(...userFactories, todayStr)
    : [];

  const records = rawRecords.map(r => {
    const wrRoles = safeJson(r.wr_roles, {});
    return {
      recordId:     r.record_id,
      logId:        r.log_id,
      title:        r.title,
      date:         r.date,
      writerId:     r.writer_id,
      writerName:   r.writer_name,
      reviewerId:   r.reviewer_id,
      reviewerName: r.reviewer_name,
      approverId:   r.approver_id,
      approverName: r.approver_name,
      status:       r.status,
      defectInfo:   r.defect_info,
      factoryId:    r.factory_id,
      writerRole:   wrRoles[r.factory_id] || 0,
    };
  });

  res.json({
    success: true,
    settings: {},
    logs,
    factories: FACTORIES,
    records,
    serverToday: todayStr,
    logTemplates,
  });
});

// POST /api/getRecordDetail
router.post('/getRecordDetail', requireAuth, (req, res) => {
  const [recordId] = req.body;
  if (!recordId) return res.json({ success: false, message: '레코드 ID가 없습니다.' });

  const rec = db.prepare('SELECT * FROM records WHERE record_id = ?').get(recordId);
  if (!rec) return res.json({ success: false, message: '레코드를 찾을 수 없습니다.' });

  const writerUser   = getUserById(rec.writer_id)   || getUserByName(rec.writer_name);
  const reviewerUser = getUserById(rec.reviewer_id) || getUserByName(rec.reviewer_name);
  const approverUser = getUserById(rec.approver_id) || getUserByName(rec.approver_name);

  res.json({
    success:            true,
    dataJson:           safeJson(rec.data_json, {}),
    writerId:           rec.writer_id,
    writerName:         rec.writer_name,
    reviewerName:       rec.reviewer_name,
    approverName:       rec.approver_name,
    writerSignature:    writerUser   ? writerUser.signature   : '',
    reviewerSignature:  reviewerUser ? reviewerUser.signature : '',
    approverSignature:  approverUser ? approverUser.signature : '',
    writerTitle:        writerUser   ? deriveTitle(writerUser)   : '',
    reviewerTitle:      reviewerUser ? deriveTitle(reviewerUser) : '',
    approverTitle:      approverUser ? deriveTitle(approverUser) : '',
  });
});

// POST /api/getRecordsForDateRange
router.post('/getRecordsForDateRange', requireAuth, (req, res) => {
  const [factoryId, fromDate, toDate] = req.body;
  if (!factoryId || !fromDate || !toDate) {
    return res.json({ success: false, message: '파라미터가 올바르지 않습니다.' });
  }

  const records = db.prepare(
    `SELECT * FROM records
     WHERE factory_id = ? AND date >= ? AND date <= ? AND status = '승인완료'
     ORDER BY date DESC`
  ).all(factoryId, fromDate, toDate).map(r => ({
    recordId:     r.record_id,
    logId:        r.log_id,
    title:        r.title,
    date:         r.date,
    writerId:     r.writer_id,
    writerName:   r.writer_name,
    reviewerId:   r.reviewer_id,
    reviewerName: r.reviewer_name,
    approverId:   r.approver_id,
    approverName: r.approver_name,
    status:       r.status,
    defectInfo:   r.defect_info,
    factoryId:    r.factory_id,
  }));

  res.json({ success: true, records });
});

module.exports = router;
