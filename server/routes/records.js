const express = require('express');
const { db, safeJson, now, today } = require('../db');

const router = express.Router();

// ── 헬퍼 ────────────────────────────────────────────────
function getRecord(recordId) {
  return db.prepare('SELECT * FROM records WHERE record_id = ?').get(recordId);
}

function getTemplate(logId) {
  return db.prepare('SELECT * FROM log_templates WHERE log_id = ?').get(logId);
}

function normalizeSubmittedData(dataJson) {
  if (typeof dataJson === 'string') {
    try { return JSON.parse(dataJson); }
    catch (e) { return null; }
  }
  return dataJson && typeof dataJson === 'object' ? dataJson : null;
}

function isBlankRequiredValue(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function isOutOfCriteria(value, criteria) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return false;

  const min = criteria && criteria.min !== undefined ? criteria.min : null;
  const max = criteria && criteria.max !== undefined ? criteria.max : null;

  if (min !== null && min !== undefined && numericValue < Number(min)) return true;
  if (max !== null && max !== undefined && numericValue > Number(max)) return true;
  return false;
}

function validateTemplateRequiredItems(logId, dataJson) {
  const data = normalizeSubmittedData(dataJson);
  if (!data) return '제출 데이터 형식이 올바르지 않습니다.';

  const template = getTemplate(logId);
  const templateItems = safeJson(template && template.items, []);
  const items = data.items && typeof data.items === 'object' ? data.items : {};

  if (templateItems.length) {
    for (const item of templateItems) {
      if (item.type === 'group_header') continue;

      const entry = items[item.key] || {};
      const label = item.label || item.key;

      if (item.type === 'numeric' || item.type === 'temp') {
        if (isBlankRequiredValue(entry.tempValue)) {
          return `[${label}] 측정값을 입력해주세요.`;
        }
        if (!Number.isFinite(Number(entry.tempValue))) {
          return `[${label}] 측정값은 숫자로 입력해주세요.`;
        }
        if (!['ok', 'ng'].includes(entry.result)) {
          return `[${label}] 점검 결과를 입력해주세요.`;
        }
        if (isOutOfCriteria(entry.tempValue, item.criteria || item)) {
          if (entry.result !== 'ng') {
            return `[${label}] 기준을 벗어난 값은 부적합으로 작성해주세요.`;
          }
        }
      } else if (!['ok', 'ng'].includes(entry.result)) {
        return `[${label}] 점검 결과를 입력해주세요.`;
      }

      if (entry.result === 'ng') {
        if (isBlankRequiredValue(entry.defectText)) {
          return `[${label}] 부적합 내용을 입력해주세요.`;
        }
        if (isBlankRequiredValue(entry.actionText)) {
          return `[${label}] 개선조치 내용을 입력해주세요.`;
        }
      }
    }

    return '';
  }

  if (Object.prototype.hasOwnProperty.call(data, 'temperature')) {
    if (isBlankRequiredValue(data.temperature)) return '온도를 입력해주세요.';
    if (!Number.isFinite(Number(data.temperature))) return '온도는 숫자로 입력해주세요.';
  }

  for (const entry of Object.values(items)) {
    if (entry && entry.result === 'ng') {
      if (isBlankRequiredValue(entry.defectText)) return '부적합 내용을 입력해주세요.';
      if (isBlankRequiredValue(entry.actionText)) return '개선조치 내용을 입력해주세요.';
    }
  }

  return '';
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

  return db.prepare(
    `SELECT record_id, status FROM records
     WHERE log_id = ? AND date = ? AND factory_id = ? AND status = '미작성'
     ORDER BY created_at DESC
     LIMIT 1`
  ).get(logId, targetDate, factoryId);
}

// ── POST /api/createNewLog ───────────────────────────────
router.post('/createNewLog', (req, res) => {
  const [logId, title, writerId, writerName, targetDate, factoryId] = req.body;
  const template = getTemplate(logId);
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

  res.json({ success: true, recordId });
});

// ── POST /api/saveDraft ─────────────────────────────────
router.post('/saveDraft', (req, res) => {
  const [recordId, , dataJson] = req.body;
  const rec = getRecord(recordId);
  if (!rec) return res.json({ success: false, message: '레코드를 찾을 수 없습니다.' });
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
  const { id: writerId, name: writerName } = req.session.user;
  const rec = getRecord(recordId);
  if (!rec) return res.json({ success: false, message: '레코드를 찾을 수 없습니다.' });
  const normalizedData = normalizeSubmittedData(dataJson);
  if (!normalizedData) return res.json({ success: false, message: '제출 데이터 형식이 올바르지 않습니다.' });

  const validationMessage = validateTemplateRequiredItems(logId || rec.log_id, normalizedData);
  if (validationMessage) {
    return res.json({ success: false, message: validationMessage });
  }

  db.prepare(
    `UPDATE records
     SET data_json = ?, defect_info = ?, writer_id = ?, writer_name = ?, writer_date = COALESCE(NULLIF(writer_date, ''), date),
         status = '작성완료', updated_at = ?
     WHERE record_id = ?`
  ).run(JSON.stringify(normalizedData), defectInfo || '', writerId, writerName, now(), recordId);

  res.json({ success: true });
});

// ── POST /api/processRecordAction ──────────────────────
router.post('/processRecordAction', (req, res) => {
  const [recordId, action, userId, userName, userRole, actionDate] = req.body;
  const rec = getRecord(recordId);
  if (!rec) return res.json({ success: false, message: '레코드를 찾을 수 없습니다.' });

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

  res.json({ success: true });
});

// ── POST /api/deleteRecord ──────────────────────────────
router.post('/deleteRecord', (req, res) => {
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
router.post('/batchActionByIds', (req, res) => {
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
        db.prepare(`UPDATE records SET status='승인완료', approver_id=?, approver_name=?, approver_date=?, updated_at=? WHERE record_id=?`)
          .run(caller.id, userName, rec.date, n, id);
        results.push({ id, ok: true });
      } else if (action === 'REVOKE') {
        db.prepare(`UPDATE records SET status='작성완료', reviewer_id='', reviewer_name='', reviewer_date='', approver_id='', approver_name='', approver_date='', updated_at=? WHERE record_id=?`)
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
router.post('/createTodayDailyLogsBatch', (req, res) => {
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
