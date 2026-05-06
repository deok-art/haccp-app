const express = require('express');
const { db, safeJson, now, today } = require('../db');
const { logAudit } = require('../audit');
const { canAccessTemplate, filterAccessibleTemplates, getTemplateForRecord } = require('../template-access');
const { getWeekBounds, getQuarterBounds } = require('../lib/utils/date');
const { getCallerRole } = require('../lib/auth/role');
const { normalizeSubmittedData } = require('../lib/validation/helpers');
const { validateCertificateData } = require('../lib/validation/certificate');
const { validateRepeatSectionData } = require('../lib/validation/repeat-section');
const {
  validateTemplateItems,
  validateLegacyData,
  validateSi0302FilterRows,
} = require('../lib/validation/items');

const router = express.Router();

// ── 헬퍼 ────────────────────────────────────────────────
function hasFactoryAccess(user, factoryId, minRole = 1) {
  return getCallerRole(user, factoryId) >= minRole;
}

function getRecord(recordId) {
  return db.prepare('SELECT * FROM records WHERE record_id = ?').get(recordId);
}

function getTemplate(logId, factoryId) {
  if (factoryId) {
    return db.prepare('SELECT * FROM log_templates WHERE log_id = ? AND factory_id = ?').get(logId, factoryId)
      || db.prepare('SELECT * FROM log_templates WHERE log_id = ?').get(logId);
  }
  return db.prepare('SELECT * FROM log_templates WHERE log_id = ?').get(logId);
}

function requireTemplateWriteAccess(caller, template, res, recordWriterId = '') {
  if (canAccessTemplate(db, caller, template, { recordWriterId })) return true;
  res.json({ success: false, message: '담당부서 또는 담당자 권한이 없습니다.' });
  return false;
}

function getTemplateMetaInfo(template) {
  return safeJson(template && template.meta_info, {});
}

// 양식 제출 데이터 검증 — 디스패처. 실제 검증 로직은 lib/validation/* 에 분리.
function validateTemplateRequiredItems(logId, dataJson, factoryId) {
  const data = normalizeSubmittedData(dataJson);
  if (!data) return '제출 데이터 형식이 올바르지 않습니다.';

  const template = getTemplate(logId, factoryId);
  const metaInfo = getTemplateMetaInfo(template);

  if (metaInfo.certificateSpec) {
    return validateCertificateData(data, metaInfo.certificateSpec, today());
  }
  if (metaInfo.repeatSection) {
    return validateRepeatSectionData(data);
  }

  if (logId === 'si0302') {
    const err = validateSi0302FilterRows(data);
    if (err) return err;
  }

  const templateItems = safeJson(template && template.items, []);
  if (templateItems.length) {
    return validateTemplateItems(templateItems, data);
  }

  return validateLegacyData(data);
}

function getCertificateActionDateError(rec, actionDate) {
  const template = getTemplateForRecord(db, rec) || getTemplate(rec.log_id, rec.factory_id);
  const metaInfo = getTemplateMetaInfo(template);
  const certificateSpec = metaInfo.certificateSpec;
  if (!certificateSpec) return '';
  const data = normalizeSubmittedData(rec.data_json) || {};
  const certificate = data.certificate || {};
  const judgementDate = certificate.judgementDate || '';
  if (judgementDate && actionDate < judgementDate) {
    return `판정일자(${judgementDate}) 이후에 서명할 수 있습니다.`;
  }
  return '';
}

function getExistingPeriodRecord(logId, factoryId, targetDate, interval) {
  if (interval === 'weekly') {
    const week = getWeekBounds(targetDate);
    return db.prepare(
      `SELECT record_id, status FROM records
       WHERE log_id = ? AND factory_id = ? AND date >= ? AND date <= ?
       ORDER BY date DESC, created_at DESC
       LIMIT 1`
    ).get(logId, factoryId, week.from, week.to);
  }

  if (interval === 'monthly') {
    const monthKey = String(targetDate || '').slice(0, 7);
    return db.prepare(
      `SELECT record_id, status FROM records
       WHERE log_id = ? AND factory_id = ? AND substr(date, 1, 7) = ?
       ORDER BY date DESC, created_at DESC
       LIMIT 1`
    ).get(logId, factoryId, monthKey);
  }

  if (interval === 'quarterly') {
    const quarter = getQuarterBounds(targetDate);
    return db.prepare(
      `SELECT record_id, status FROM records
       WHERE log_id = ? AND factory_id = ? AND date >= ? AND date <= ?
       ORDER BY date DESC, created_at DESC
       LIMIT 1`
    ).get(logId, factoryId, quarter.from, quarter.to);
  }

  return db.prepare(
    `SELECT record_id, status FROM records
     WHERE log_id = ? AND date = ? AND factory_id = ? AND status IN ('미작성', '작성중')
     ORDER BY created_at DESC
     LIMIT 1`
  ).get(logId, targetDate, factoryId);
}

// ── POST /api/createNewLog ───────────────────────────────
router.post('/createNewLog', (req, res) => {
  const [logId, title, , , targetDate, factoryId] = req.body;
  const caller = req.session.user;
  if (!hasFactoryAccess(caller, factoryId)) {
    return res.json({ success: false, message: '권한이 없습니다.' });
  }
  const writerId = caller.id;
  const writerName = caller.name;
  const template = getTemplate(logId, factoryId);
  if (template && !requireTemplateWriteAccess(caller, template, res)) return;
  const interval = template ? template.interval : 'daily';

  // 같은 주기 구간 안의 기존 레코드를 재사용해 중복 생성을 막는다.
  const existing = getExistingPeriodRecord(logId, factoryId, targetDate, interval);

  if (existing) {
    if (existing.status === '미작성') {
      db.prepare(
        `UPDATE records SET writer_id = ?, writer_name = ?, writer_date = ?, updated_at = ? WHERE record_id = ?`
      ).run(writerId, writerName, targetDate || '', now(), existing.record_id);
    }
    return res.json({ success: true, recordId: existing.record_id });
  }

  const recordId = `REC-${Date.now()}`;
  db.prepare(
    `INSERT INTO records (record_id, log_id, title, date, writer_id, writer_name, writer_date, status, factory_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, '미작성', ?, ?, ?)`
  ).run(recordId, logId, title, targetDate, writerId, writerName, targetDate || '', factoryId, now(), now());

  logAudit('CREATE', 'record', recordId, factoryId, caller, { logId, date: targetDate });
  res.json({ success: true, recordId });
});

// ── POST /api/saveDraft ─────────────────────────────────
router.post('/saveDraft', (req, res) => {
  const [recordId, , dataJson] = req.body;
  const rec = getRecord(recordId);
  if (!rec) return res.json({ success: false, message: '레코드를 찾을 수 없습니다.' });
  if (!hasFactoryAccess(req.session.user, rec.factory_id)) {
    return res.json({ success: false, message: '권한이 없습니다.' });
  }
  const template = getTemplateForRecord(db, rec);
  if (template && !requireTemplateWriteAccess(req.session.user, template, res, rec.writer_id)) return;
  const normalizedData = normalizeSubmittedData(dataJson);
  if (!normalizedData) return res.json({ success: false, message: '저장 데이터 형식이 올바르지 않습니다.' });

  db.prepare(
    `UPDATE records SET data_json = ?, status = '작성중', updated_at = ? WHERE record_id = ?`
  ).run(JSON.stringify(normalizedData), now(), recordId);

  res.json({ success: true });
});

// ── POST /api/saveFormData ──────────────────────────────
router.post('/saveFormData', (req, res) => {
  const [recordId, logId, dataJson, defectInfo] = req.body;
  const caller = req.session.user;
  const rec = getRecord(recordId);
  if (!rec) return res.json({ success: false, message: '레코드를 찾을 수 없습니다.' });
  if (!hasFactoryAccess(caller, rec.factory_id)) {
    return res.json({ success: false, message: '권한이 없습니다.' });
  }
  const template = getTemplateForRecord(db, rec);
  if (template && !requireTemplateWriteAccess(caller, template, res, rec.writer_id)) return;
  const { id: writerId, name: writerName } = caller;
  const normalizedData = normalizeSubmittedData(dataJson);
  if (!normalizedData) return res.json({ success: false, message: '제출 데이터 형식이 올바르지 않습니다.' });

  const validationMessage = validateTemplateRequiredItems(logId || rec.log_id, normalizedData, rec.factory_id);
  if (validationMessage) {
    return res.json({ success: false, message: validationMessage });
  }

  db.prepare(
    `UPDATE records
     SET data_json = ?, defect_info = ?, writer_id = ?, writer_name = ?, writer_date = COALESCE(NULLIF(writer_date, ''), date),
         status = '작성완료', updated_at = ?
     WHERE record_id = ?`
  ).run(JSON.stringify(normalizedData), defectInfo || '', writerId, writerName, now(), recordId);

  logAudit('SAVE', 'record', recordId, rec.factory_id, caller, { logId: rec.log_id });
  res.json({ success: true });
});

// ── POST /api/processRecordAction ──────────────────────
router.post('/processRecordAction', (req, res) => {
  const [recordId, action, , , , actionDate] = req.body;
  const caller = req.session.user;
  const rec = getRecord(recordId);
  if (!rec) return res.json({ success: false, message: '레코드를 찾을 수 없습니다.' });
  if (!hasFactoryAccess(caller, rec.factory_id)) {
    return res.json({ success: false, message: '권한이 없습니다.' });
  }
  const userId   = caller.id;
  const userName = caller.name;
  const userRole = getCallerRole(caller, rec.factory_id);

  if (actionDate && !/^\d{4}-\d{2}-\d{2}$/.test(actionDate)) {
    return res.json({ success: false, message: '?? ??? ???? ????. YYYY-MM-DD ???? ??????.' });
  }

  const n = now();
  const STATUS = rec.status;
  const normalizedActionDate = actionDate || rec.date;
  const writerDate = rec.writer_date || rec.date || '';
  const reviewerDate = rec.reviewer_date || '';

  if ((action === 'REVIEW' || action === 'SUBMIT') && writerDate && normalizedActionDate < writerDate) {
    return res.json({ success: false, message: `???? ???(${writerDate}) ???? ??? ? ????.` });
  }
  const certificateActionError = getCertificateActionDateError(rec, normalizedActionDate);
  if (certificateActionError && ['SUBMIT', 'REVIEW', 'APPROVE'].includes(action)) {
    return res.json({ success: false, message: certificateActionError });
  }
  if (action === 'APPROVE') {
    const approveMinDate = reviewerDate || writerDate;
    const approveMinLabel = reviewerDate ? '???' : '???';
    if (approveMinDate && normalizedActionDate < approveMinDate) {
      return res.json({ success: false, message: `???? ${approveMinLabel}(${approveMinDate}) ???? ??? ? ????.` });
    }
  }


  const actions = {
    SUBMIT: () => {
      if (STATUS !== '작성완료') return '작성완료 상태의 일지만 제출할 수 있습니다.';
      if (rec.writer_id !== userId && userRole < 2) return '권한이 없습니다.';
      db.prepare(`UPDATE records SET status='검토완료', reviewer_id=?, reviewer_name=?, reviewer_date=?, updated_at=? WHERE record_id=?`)
        .run(userId, userName, normalizedActionDate, n, recordId);
    },
    REVIEW: () => {
      if (STATUS !== '작성완료') return '작성완료 상태의 일지만 검토할 수 있습니다.';
      if (userRole < 2) return '검토 권한이 없습니다.';
      db.prepare(`UPDATE records SET status='검토완료', reviewer_id=?, reviewer_name=?, reviewer_date=?, updated_at=? WHERE record_id=?`)
        .run(userId, userName, normalizedActionDate, n, recordId);
    },
    APPROVE: () => {
      if (!['검토완료', '작성완료'].includes(STATUS)) return '검토완료 이상의 상태여야 합니다.';
      if (userRole < 3) return '승인 권한이 없습니다.';
      db.prepare(`UPDATE records SET status='승인완료', approver_id=?, approver_name=?, approver_date=?, updated_at=? WHERE record_id=?`)
        .run(userId, userName, normalizedActionDate, n, recordId);
    },
    REVOKE: () => {
      if (STATUS === '미작성') return '이미 미작성 상태입니다.';
      db.prepare(`UPDATE records SET status='작성완료', reviewer_id='', reviewer_name='', reviewer_date='', approver_id='', approver_name='', approver_date='', updated_at=? WHERE record_id=?`)
        .run(n, recordId);
    },
    REVOKE_APPROVE: () => {
      if (STATUS !== '승인완료') return '승인완료 상태의 일지만 승인취소할 수 있습니다.';
      if (userRole < 3) return '승인취소 권한이 없습니다.';
      db.prepare(`UPDATE records SET status='검토완료', approver_id='', approver_name='', approver_date='', updated_at=? WHERE record_id=?`)
        .run(n, recordId);
    },
    REJECT: () => {
      if (!['검토완료', '승인완료'].includes(STATUS)) return '검토완료 이상의 상태여야 합니다.';
      if (userRole < 2) return '반려 권한이 없습니다.';
      db.prepare(`UPDATE records SET status='작성완료', reviewer_id='', reviewer_name='', reviewer_date='', approver_id='', approver_name='', approver_date='', updated_at=? WHERE record_id=?`)
        .run(n, recordId);
    },
    RESET_TO_WRITING: () => {
      db.prepare(`UPDATE records SET status='작성중', updated_at=? WHERE record_id=?`).run(n, recordId);
    },
    RESET_TO_DRAFT: () => {
      db.prepare(`UPDATE records SET status='미작성', writer_id='', writer_name='', writer_date='', reviewer_id='', reviewer_name='', reviewer_date='', approver_id='', approver_name='', approver_date='', data_json='{}', defect_info='', updated_at=? WHERE record_id=?`)
        .run(n, recordId);
    },
  };

  const handler = actions[action];
  if (!handler) return res.json({ success: false, message: `알 수 없는 액션: ${action}` });

  const errMsg = handler();
  if (errMsg) return res.json({ success: false, message: errMsg });

  logAudit(action, 'record', recordId, rec.factory_id, caller, { before: STATUS });
  res.json({ success: true });
});

// ── POST /api/deleteRecord ──────────────────────────────
router.post('/deleteRecord', (req, res) => {
  const [recordId] = req.body;
  const rec = getRecord(recordId);
  if (!rec) return res.json({ success: false, message: '레코드를 찾을 수 없습니다.' });
  if (!hasFactoryAccess(req.session.user, rec.factory_id)) {
    return res.json({ success: false, message: '권한이 없습니다.' });
  }
  if (!['미작성', '작성중', '작성완료'].includes(rec.status)) {
    return res.json({ success: false, message: '검토완료 이상은 삭제할 수 없습니다.' });
  }

  db.prepare('DELETE FROM records WHERE record_id = ?').run(recordId);
  logAudit('DELETE', 'record', recordId, rec.factory_id, req.session.user, { logId: rec.log_id, date: rec.date });
  res.json({ success: true });
});

// ── POST /api/batchActionByIds ──────────────────────────
router.post('/batchActionByIds', (req, res) => {
  const [ids, action] = req.body;
  if (!Array.isArray(ids) || !ids.length) return res.json({ success: false, message: '대상 없음.' });

  const n = now();
  const caller = req.session.user;
  const results = [];

  const batchStmt = db.transaction((idList) => {
    for (const id of idList) {
      const rec = getRecord(id);
      if (!rec) { results.push({ id, ok: false, msg: '없는 레코드' }); continue; }
      if (!hasFactoryAccess(caller, rec.factory_id)) { results.push({ id, ok: false, msg: '권한 없음' }); continue; }

      const userRole = getCallerRole(caller, rec.factory_id);
      if (action === 'APPROVE') {
        if (userRole < 3) { results.push({ id, ok: false, msg: '권한 없음' }); continue; }
        if (!['검토완료', '작성완료'].includes(rec.status)) { results.push({ id, ok: false, msg: '상태 불일치' }); continue; }
        db.prepare(`UPDATE records SET status='승인완료', approver_id=?, approver_name=?, approver_date=?, updated_at=? WHERE record_id=?`)
          .run(caller.id, caller.name, rec.date, n, id);
        logAudit('BATCH_APPROVE', 'record', id, rec.factory_id, caller, { before: rec.status });
        results.push({ id, ok: true });
      } else if (action === 'REVOKE') {
        db.prepare(`UPDATE records SET status='작성완료', reviewer_id='', reviewer_name='', reviewer_date='', approver_id='', approver_name='', approver_date='', updated_at=? WHERE record_id=?`)
          .run(n, id);
        logAudit('BATCH_REVOKE', 'record', id, rec.factory_id, caller, { before: rec.status });
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
router.post('/createTodayDailyLogsBatch', (req, res) => {
  const [factoryId, , , forceLogIds, selectedLogIds] = req.body;
  const caller = req.session.user;
  if (!hasFactoryAccess(caller, factoryId)) {
    return res.json({ success: false, message: '권한이 없습니다.' });
  }
  const writerId   = caller.id;
  const writerName = caller.name;
  const dateStr = today();
  const forceSet    = new Set(Array.isArray(forceLogIds)    ? forceLogIds    : []);
  const selectedSet = new Set(Array.isArray(selectedLogIds) ? selectedLogIds : []);

  const templates = filterAccessibleTemplates(
    db,
    caller,
    db.prepare(
      `SELECT log_id, title, factory_id, responsible_department, responsible_departments FROM log_templates WHERE factory_id = ? AND interval = 'daily'`
    ).all(factoryId)
  );

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
          `UPDATE records SET writer_id=?, writer_name=?, writer_date=?, status='미작성', data_json='{}', defect_info='', updated_at=? WHERE record_id=?`
        ).run(writerId, writerName, dateStr, now(), existing.record_id);
        created.push(logId);
        continue;
      }

      const recordId = `REC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      db.prepare(
        `INSERT INTO records (record_id, log_id, title, date, writer_id, writer_name, writer_date, status, factory_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, '미작성', ?, ?, ?)`
      ).run(recordId, logId, title, dateStr, writerId, writerName, dateStr, factoryId, now(), now());
      created.push(logId);
    }
  });

  batchInsert();
  res.json({ success: true, created, skipped });
});

// ── POST /api/batchProcessRecords ──────────────────────
router.post('/batchProcessRecords', (req, res) => {
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
        db.prepare(`UPDATE records SET status='검토완료', reviewer_id=?, reviewer_name=?, reviewer_date=?, updated_at=? WHERE record_id=?`)
          .run(caller.id, userName, today(), n, row.record_id);
      } else {
        db.prepare(`UPDATE records SET status='승인완료', approver_id=?, approver_name=?, approver_date=?, updated_at=? WHERE record_id=?`)
          .run(caller.id, userName, today(), n, row.record_id);
      }
    }
  });
  stmt();

  res.json({ success: true, count: rows.length });
});

module.exports = router;
