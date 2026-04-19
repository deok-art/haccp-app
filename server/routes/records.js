const express = require('express');
const { db, safeJson, now, today } = require('../db');
const { requireAuth }              = require('../middleware/session');

const router = express.Router();

// ── 헬퍼 ────────────────────────────────────────────────
function getRecord(recordId) {
  return db.prepare('SELECT * FROM records WHERE record_id = ?').get(recordId);
}

function getTemplate(logId) {
  return db.prepare('SELECT * FROM log_templates WHERE log_id = ?').get(logId);
}

// ── POST /api/createNewLog ───────────────────────────────
router.post('/createNewLog', requireAuth, (req, res) => {
  const [logId, title, writerId, writerName, targetDate, factoryId] = req.body;

  // 같은 날짜/양식/공장의 미작성 레코드 재사용
  const existing = db.prepare(
    `SELECT record_id FROM records
     WHERE log_id = ? AND date = ? AND factory_id = ? AND status = '미작성'`
  ).get(logId, targetDate, factoryId);

  if (existing) {
    db.prepare(
      `UPDATE records SET writer_id = ?, writer_name = ?, updated_at = ? WHERE record_id = ?`
    ).run(writerId, writerName, now(), existing.record_id);
    return res.json({ success: true, recordId: existing.record_id });
  }

  const recordId = `REC-${Date.now()}`;
  db.prepare(
    `INSERT INTO records (record_id, log_id, title, date, writer_id, writer_name, status, factory_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, '미작성', ?, ?, ?)`
  ).run(recordId, logId, title, targetDate, writerId, writerName, factoryId, now(), now());

  res.json({ success: true, recordId });
});

// ── POST /api/saveDraft ─────────────────────────────────
router.post('/saveDraft', requireAuth, (req, res) => {
  const [recordId, , dataJson] = req.body;
  const rec = getRecord(recordId);
  if (!rec) return res.json({ success: false, message: '레코드를 찾을 수 없습니다.' });

  db.prepare(
    `UPDATE records SET data_json = ?, status = '작성중', updated_at = ? WHERE record_id = ?`
  ).run(JSON.stringify(dataJson), now(), recordId);

  res.json({ success: true });
});

// ── POST /api/saveFormData ──────────────────────────────
router.post('/saveFormData', requireAuth, (req, res) => {
  const [recordId, , dataJson, defectInfo, writerId, writerName] = req.body;
  const rec = getRecord(recordId);
  if (!rec) return res.json({ success: false, message: '레코드를 찾을 수 없습니다.' });

  db.prepare(
    `UPDATE records
     SET data_json = ?, defect_info = ?, writer_id = ?, writer_name = ?,
         status = '작성완료', updated_at = ?
     WHERE record_id = ?`
  ).run(JSON.stringify(dataJson), defectInfo || '', writerId, writerName, now(), recordId);

  res.json({ success: true });
});

// ── POST /api/processRecordAction ──────────────────────
router.post('/processRecordAction', requireAuth, (req, res) => {
  const [recordId, action, userId, userName, userRole] = req.body;
  const rec = getRecord(recordId);
  if (!rec) return res.json({ success: false, message: '레코드를 찾을 수 없습니다.' });

  const n = now();
  const STATUS = rec.status;

  const actions = {
    SUBMIT: () => {
      if (STATUS !== '작성완료') return '작성완료 상태의 일지만 제출할 수 있습니다.';
      if (rec.writer_id !== userId && userRole < 2) return '권한이 없습니다.';
      db.prepare(`UPDATE records SET status='검토완료', reviewer_id=?, reviewer_name=?, updated_at=? WHERE record_id=?`)
        .run(userId, userName, n, recordId);
    },
    REVIEW: () => {
      if (STATUS !== '작성완료') return '작성완료 상태의 일지만 검토할 수 있습니다.';
      if (userRole < 2) return '검토 권한이 없습니다.';
      db.prepare(`UPDATE records SET status='검토완료', reviewer_id=?, reviewer_name=?, updated_at=? WHERE record_id=?`)
        .run(userId, userName, n, recordId);
    },
    APPROVE: () => {
      if (!['검토완료', '작성완료'].includes(STATUS)) return '검토완료 이상의 상태여야 합니다.';
      if (userRole < 3) return '승인 권한이 없습니다.';
      db.prepare(`UPDATE records SET status='승인완료', approver_id=?, approver_name=?, updated_at=? WHERE record_id=?`)
        .run(userId, userName, n, recordId);
    },
    REVOKE: () => {
      if (STATUS === '미작성') return '이미 미작성 상태입니다.';
      db.prepare(`UPDATE records SET status='작성완료', reviewer_id='', reviewer_name='', approver_id='', approver_name='', updated_at=? WHERE record_id=?`)
        .run(n, recordId);
    },
    REVOKE_APPROVE: () => {
      if (STATUS !== '승인완료') return '승인완료 상태의 일지만 승인취소할 수 있습니다.';
      if (userRole < 3) return '승인취소 권한이 없습니다.';
      db.prepare(`UPDATE records SET status='검토완료', approver_id='', approver_name='', updated_at=? WHERE record_id=?`)
        .run(n, recordId);
    },
    REJECT: () => {
      if (!['검토완료', '승인완료'].includes(STATUS)) return '검토완료 이상의 상태여야 합니다.';
      if (userRole < 2) return '반려 권한이 없습니다.';
      db.prepare(`UPDATE records SET status='작성완료', reviewer_id='', reviewer_name='', approver_id='', approver_name='', updated_at=? WHERE record_id=?`)
        .run(n, recordId);
    },
    RESET_TO_WRITING: () => {
      db.prepare(`UPDATE records SET status='작성중', updated_at=? WHERE record_id=?`).run(n, recordId);
    },
    RESET_TO_DRAFT: () => {
      db.prepare(`UPDATE records SET status='미작성', writer_id='', writer_name='', reviewer_id='', reviewer_name='', approver_id='', approver_name='', data_json='{}', defect_info='', updated_at=? WHERE record_id=?`)
        .run(n, recordId);
    },
  };

  const handler = actions[action];
  if (!handler) return res.json({ success: false, message: `알 수 없는 액션: ${action}` });

  const errMsg = handler();
  if (errMsg) return res.json({ success: false, message: errMsg });

  res.json({ success: true });
});

// ── POST /api/deleteRecord ──────────────────────────────
router.post('/deleteRecord', requireAuth, (req, res) => {
  const [recordId] = req.body;
  const rec = getRecord(recordId);
  if (!rec) return res.json({ success: false, message: '레코드를 찾을 수 없습니다.' });
  if (!['미작성', '작성중', '작성완료'].includes(rec.status)) {
    return res.json({ success: false, message: '검토완료 이상은 삭제할 수 없습니다.' });
  }

  db.prepare('DELETE FROM records WHERE record_id = ?').run(recordId);
  res.json({ success: true });
});

// ── POST /api/batchActionByIds ──────────────────────────
router.post('/batchActionByIds', requireAuth, (req, res) => {
  const [ids, action, userName, userRole] = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.json({ success: false, message: '대상 없음.' });

  const n = now();
  const caller = req.session.user;
  const results = [];

  const batchStmt = db.transaction((idList) => {
    for (const id of idList) {
      const rec = getRecord(id);
      if (!rec) { results.push({ id, ok: false, msg: '없는 레코드' }); continue; }

      if (action === 'APPROVE') {
        if (userRole < 3) { results.push({ id, ok: false, msg: '권한 없음' }); continue; }
        if (!['검토완료', '작성완료'].includes(rec.status)) { results.push({ id, ok: false, msg: '상태 불일치' }); continue; }
        db.prepare(`UPDATE records SET status='승인완료', approver_id=?, approver_name=?, updated_at=? WHERE record_id=?`)
          .run(caller.id, userName, n, id);
        results.push({ id, ok: true });
      } else if (action === 'REVOKE') {
        db.prepare(`UPDATE records SET status='작성완료', reviewer_id='', reviewer_name='', approver_id='', approver_name='', updated_at=? WHERE record_id=?`)
          .run(n, id);
        results.push({ id, ok: true });
      } else {
        results.push({ id, ok: false, msg: '지원하지 않는 배치 액션' });
      }
    }
  });

  batchStmt(ids);
  res.json({ success: true, results });
});

// ── POST /api/createTodayDailyLogsBatch ────────────────
router.post('/createTodayDailyLogsBatch', requireAuth, (req, res) => {
  const [factoryId, writerId, writerName, forceLogIds, selectedLogIds] = req.body;
  const dateStr = today();
  const forceSet    = new Set(Array.isArray(forceLogIds)    ? forceLogIds    : []);
  const selectedSet = new Set(Array.isArray(selectedLogIds) ? selectedLogIds : []);

  const templates = db.prepare(
    `SELECT log_id, title FROM log_templates WHERE factory_id = ? AND interval = 'daily'`
  ).all(factoryId);

  const created = [];
  const skipped = [];

  const batchInsert = db.transaction(() => {
    for (const tpl of templates) {
      const { log_id: logId, title } = tpl;
      if (selectedSet.size > 0 && !selectedSet.has(logId)) continue;

      const existing = db.prepare(
        `SELECT record_id, status FROM records WHERE log_id = ? AND date = ? AND factory_id = ?`
      ).get(logId, dateStr, factoryId);

      if (existing && !forceSet.has(logId)) {
        skipped.push(logId);
        continue;
      }

      if (existing && forceSet.has(logId)) {
        // 강제 재생성 — 기존 레코드를 미작성으로 초기화
        db.prepare(
          `UPDATE records SET writer_id=?, writer_name=?, status='미작성', data_json='{}', defect_info='', updated_at=? WHERE record_id=?`
        ).run(writerId, writerName, now(), existing.record_id);
        created.push(logId);
        continue;
      }

      const recordId = `REC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      db.prepare(
        `INSERT INTO records (record_id, log_id, title, date, writer_id, writer_name, status, factory_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '미작성', ?, ?, ?)`
      ).run(recordId, logId, title, dateStr, writerId, writerName, factoryId, now(), now());
      created.push(logId);
    }
  });

  batchInsert();
  res.json({ success: true, created, skipped });
});

// ── POST /api/batchProcessRecords ──────────────────────
router.post('/batchProcessRecords', requireAuth, (req, res) => {
  const [action, userName, userRole] = req.body;
  const caller = req.session.user;
  const n = now();

  const userFactories = caller.isMaster
    ? null
    : Object.keys(caller.factoryRoles || {});

  let rows;
  if (action === 'REVIEW') {
    const factoryFilter = userFactories
      ? `AND factory_id IN (${userFactories.map(() => '?').join(',')})`
      : '';
    rows = db.prepare(
      `SELECT record_id FROM records WHERE status = '작성완료' ${factoryFilter}`
    ).all(...(userFactories || []));
  } else if (action === 'APPROVE') {
    const factoryFilter = userFactories
      ? `AND factory_id IN (${userFactories.map(() => '?').join(',')})`
      : '';
    rows = db.prepare(
      `SELECT record_id FROM records WHERE status IN ('검토완료','작성완료') ${factoryFilter}`
    ).all(...(userFactories || []));
  } else {
    return res.json({ success: false, message: '지원하지 않는 액션' });
  }

  const stmt = db.transaction(() => {
    for (const row of rows) {
      if (action === 'REVIEW') {
        db.prepare(`UPDATE records SET status='검토완료', reviewer_id=?, reviewer_name=?, updated_at=? WHERE record_id=?`)
          .run(caller.id, userName, n, row.record_id);
      } else {
        db.prepare(`UPDATE records SET status='승인완료', approver_id=?, approver_name=?, updated_at=? WHERE record_id=?`)
          .run(caller.id, userName, n, row.record_id);
      }
    }
  });
  stmt();

  res.json({ success: true, count: rows.length });
});

module.exports = router;
