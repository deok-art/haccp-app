const express = require('express');
const { db, safeJson, today } = require('../db');
const { requireAuth }         = require('../middleware/session');
const { buildCalendarSummary, ensureFactoryCalendarDefaults } = require('../factory-calendar');

const router = express.Router();

function getFactories() {
  return db.prepare('SELECT factory_id as id, name FROM factories ORDER BY factory_id').all();
}

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return rows.reduce((acc, r) => { acc[r.key] = r.value; return acc; }, {});
}

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

function createUtcDate(dateStr) {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function getWeekBounds(dateStr) {
  const date = createUtcDate(dateStr);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const monday = new Date(date);
  monday.setUTCDate(monday.getUTCDate() + diff);
  const sunday = new Date(monday);
  sunday.setUTCDate(sunday.getUTCDate() + 6);
  return {
    from: formatUtcDate(monday),
    to: formatUtcDate(sunday),
  };
}

// POST /api/getInitialData
router.post('/getInitialData', requireAuth, (req, res) => {
  Promise.resolve().then(async () => {
    const caller = req.session.user;
    const todayStr = today();
    const currentWeek = getWeekBounds(todayStr);
    const currentMonth = todayStr.slice(0, 7);
    ensureFactoryCalendarDefaults(db);

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
    const allFactories  = getFactories();
    const userFactories = caller.isMaster
      ? allFactories.map(f => f.id)
      : Object.keys(caller.factoryRoles || {});

    const placeholders = userFactories.map(() => '?').join(',');
    const rawRecords = userFactories.length
      ? db.prepare(
          `SELECT r.*, u.factory_roles as wr_roles, COALESCE(t.interval, 'daily') as template_interval FROM records r
           LEFT JOIN users u ON r.writer_id = u.id
           LEFT JOIN log_templates t ON r.log_id = t.log_id
           WHERE r.factory_id IN (${placeholders})
             AND (
               r.status NOT IN ('승인완료')
               OR (COALESCE(t.interval, 'daily') = 'daily' AND r.date = ?)
               OR (COALESCE(t.interval, 'daily') = 'weekly' AND r.date >= ? AND r.date <= ?)
               OR (COALESCE(t.interval, 'daily') = 'monthly' AND substr(r.date, 1, 7) = ?)
             )
           ORDER BY r.date DESC, r.created_at DESC`
        ).all(...userFactories, todayStr, currentWeek.from, currentWeek.to, currentMonth)
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
        writerDate:   r.writer_date || r.date,
        reviewerId:   r.reviewer_id,
        reviewerName: r.reviewer_name,
        reviewerDate: r.reviewer_date || '',
        approverId:   r.approver_id,
        approverName: r.approver_name,
        approverDate: r.approver_date || '',
        status:       r.status,
        defectInfo:   r.defect_info,
        factoryId:    r.factory_id,
        writerRole:   wrRoles[r.factory_id] || 0,
      };
    });

    const calendarSummary = await buildCalendarSummary(userFactories, todayStr, db);

    res.json({
      success: true,
      settings: getSettings(),
      logs,
      factories: allFactories,
      records,
      serverToday: todayStr,
      logTemplates,
      calendarSummary,
    });
  }).catch(err => {
    console.error('[getInitialData]', err);
    res.json({ success: false, message: err.message });
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
    writerDate:         rec.writer_date || rec.date,
    reviewerName:       rec.reviewer_name,
    reviewerDate:       rec.reviewer_date || '',
    approverName:       rec.approver_name,
    approverDate:       rec.approver_date || '',
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
    writerDate:   r.writer_date || r.date,
    reviewerId:   r.reviewer_id,
    reviewerName: r.reviewer_name,
    reviewerDate: r.reviewer_date || '',
    approverId:   r.approver_id,
    approverName: r.approver_name,
    approverDate: r.approver_date || '',
    status:       r.status,
    defectInfo:   r.defect_info,
    factoryId:    r.factory_id,
  }));

  res.json({ success: true, records });
});

module.exports = router;
