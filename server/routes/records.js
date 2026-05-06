const express = require('express');
const { db, safeJson, now, today } = require('../db');
const { logAudit } = require('../audit');
const { canAccessTemplate, filterAccessibleTemplates, getTemplateForRecord } = require('../template-access');
const { getWeekBounds, getQuarterBounds } = require('../lib/utils/date');
const { getCallerRole } = require('../lib/auth/role');

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

function isValidInspectionResult(result) {
  return ['ok', 'ng', 'na'].includes(result);
}

function isOutOfCriteria(value, criteria) {
  if (String(value).trim() === '-') return false;
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return false;

  const min = criteria && criteria.min !== undefined ? criteria.min : null;
  const max = criteria && criteria.max !== undefined ? criteria.max : null;

  if (min !== null && min !== undefined && numericValue < Number(min)) return true;
  if (max !== null && max !== undefined && numericValue > Number(max)) return true;
  return false;
}

function getTemplateMetaInfo(template) {
  return safeJson(template && template.meta_info, {});
}

function dateDiffDays(fromDate, toDate) {
  const [fromYear, fromMonth, fromDay] = String(fromDate || '').split('-').map(Number);
  const [toYear, toMonth, toDay] = String(toDate || '').split('-').map(Number);
  const from = new Date(Date.UTC(fromYear || 1970, (fromMonth || 1) - 1, fromDay || 1));
  const to = new Date(Date.UTC(toYear || 1970, (toMonth || 1) - 1, toDay || 1));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

function getCertificateAreaCriteria(row, sample) {
  const byArea = row && (row.criteriaByArea || row.criteria_by_area);
  const area = sample && sample.area;
  return byArea && area && byArea[area] ? byArea[area] : null;
}

function getCertificateExpectedJudgement(row, result, sample = null) {
  const areaCriteria = getCertificateAreaCriteria(row, sample);
  const effectiveRow = areaCriteria ? { ...row, ...areaCriteria } : row;
  const value = String(result.value || '').trim();
  if (effectiveRow.input_mode === 'pass_fail') {
    if (value === '적합') return '적';
    if (value === '부적합') return '부';
    if (result.judgement === '적') return '적';
    if (result.judgement === '부') return '부';
    if (value === '적합') return '적';
    if (value === '부적합') return '부';
    if (result.judgement === '적') return '적';
    if (result.judgement === '부') return '부';
    return '';
  }
  if (effectiveRow.input_mode === 'positive_negative') {
    if (value === '음성' || value === '불검출') return '적';
    if (value === '양성' || value === '검출') return '부';
    return '';
  }
  if (effectiveRow.input_mode === 'numeric_range') {
    if (isBlankRequiredValue(value)) return '';
    const num = Number.parseFloat(value);
    if (!Number.isFinite(num)) return '';
    const minOk = effectiveRow.min === undefined || effectiveRow.min === null || num >= Number(effectiveRow.min);
    const maxOk = effectiveRow.max === undefined || effectiveRow.max === null || num <= Number(effectiveRow.max);
    if (result.judgement === '적' || result.judgement === '부') return minOk && maxOk ? '적' : '부';
    return minOk && maxOk ? '적' : '부';
  }
  return ['적', '부'].includes(result.judgement) ? result.judgement : '';
}

function validateCertificateData(data, certificateSpec) {
  const certificate = data.certificate && typeof data.certificate === 'object' ? data.certificate : null;
  if (!certificate) return '성적서 데이터를 입력해주세요.';

  const fields = certificate.fields && typeof certificate.fields === 'object' ? certificate.fields : {};
  const requiredFields = (certificateSpec.topFields || []).filter(field => field.required);
  for (const field of requiredFields) {
    if (isBlankRequiredValue(fields[field.key])) return `${field.label || field.key}을(를) 입력해주세요.`;
  }
  const todayStr = today();
  if (fields.samplingDate && dateDiffDays(fields.samplingDate, todayStr) < 0) return '채취일자는 오늘 이후로 선택할 수 없습니다.';
  if (fields.inspectionDate && dateDiffDays(fields.inspectionDate, todayStr) < 0) return '검사일자는 오늘 이후로 선택할 수 없습니다.';
  if (certificate.judgementDate && dateDiffDays(certificate.judgementDate, todayStr) < 0) return '판정일자는 오늘 이후로 선택할 수 없습니다.';
  if (fields.inspectionDate && fields.samplingDate && dateDiffDays(fields.samplingDate, fields.inspectionDate) < 0) {
    return '검사일자는 채취일자보다 빠를 수 없습니다.';
  }
  const judgementOffsetDays = Number(certificateSpec.judgementOffsetDays || 2);
  const judgementGap = dateDiffDays(fields.inspectionDate, certificate.judgementDate);
  if (judgementGap === null || judgementGap < judgementOffsetDays) {
    return `판정일자는 검사일자보다 최소 ${judgementOffsetDays}일 이상 늦어야 합니다.`;
  }

  const samples = Array.isArray(certificate.samples) ? certificate.samples : [];
  if (!samples.length) return '채취대상을 1개 이상 입력해주세요.';

  const rows = Array.isArray(certificateSpec.resultRows) ? certificateSpec.resultRows : [];
  const usesCertificatePhotos = certificateSpec.photoMode === 'certificate';
  if (usesCertificatePhotos) {
    const photos = Array.isArray(certificate.photos) ? certificate.photos : [];
    const maxPhotos = Number(certificateSpec.maxPhotos || 5);
    if (!photos.length) return '성적서 사진을 1장 이상 첨부해주세요.';
    if (photos.length > maxPhotos) return `성적서 사진은 ${maxPhotos}장까지 첨부할 수 있습니다.`;
  }
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i] || {};
    const sampleLabelName = certificateSpec.sampleLabel || '채취대상';
    const sampleLabel = sample.target || `${sampleLabelName} ${i + 1}`;
    if (certificateSpec.personLabel && isBlankRequiredValue(sample.personName)) return `[${certificateSpec.personLabel} ${i + 1}] ${certificateSpec.personLabel}을 입력해주세요.`;
    if (isBlankRequiredValue(sample.target)) return `[${sampleLabelName} ${i + 1}] ${sampleLabelName}을(를) 입력해주세요.`;
    if (!usesCertificatePhotos) {
      const photos = Array.isArray(sample.photos) ? sample.photos : [];
      if (!photos.length) return `[${sampleLabel}] 사진을 1장 이상 첨부해주세요.`;
      if (photos.length > 5) return `[${sampleLabel}] 사진은 5장까지 첨부할 수 있습니다.`;
    }
    const results = sample.results && typeof sample.results === 'object' ? sample.results : {};
    let hasSampleFailure = false;
    for (const row of rows) {
      const result = results[row.key] || {};
      if (isBlankRequiredValue(result.value)) return `[${sampleLabel}] ${row.label} 검사결과를 입력해주세요.`;
      const expectedJudgement = getCertificateExpectedJudgement(row, result, sample);
      if (!expectedJudgement) return `[${sampleLabel}] ${row.label} 검사결과가 올바르지 않습니다.`;
      if (result.judgement !== expectedJudgement) return `[${sampleLabel}] ${row.label} 판정결과가 검사결과와 일치하지 않습니다.`;
      if (expectedJudgement === '부') hasSampleFailure = true;
      if (certificateSpec.defectMode !== 'sample' && row.require_defect_text_on_fail && expectedJudgement === '부' && isBlankRequiredValue(result.defectText)) {
        return `[${sampleLabel}] ${row.label} 부적합사항을 입력해주세요.`;
      }
    }
    if (certificateSpec.defectMode === 'sample' && hasSampleFailure) {
      if (isBlankRequiredValue(sample.defectText)) return `[${sampleLabel}] 부적합사항을 입력해주세요.`;
      if (isBlankRequiredValue(sample.actionText)) return `[${sampleLabel}] 개선조치를 입력해주세요.`;
    }
  }

  const expectedOverall = samples.every(sample => rows.every(row => {
    const result = ((sample.results && sample.results[row.key]) || {});
    return getCertificateExpectedJudgement(row, result, sample) === '적';
  })) ? '적합' : '부적합';
  if (certificate.overallJudgement !== expectedOverall) {
    return '종합판정이 검사결과와 일치하지 않습니다.';
  }
  if (expectedOverall === '부적합' && certificateSpec.defectMode !== 'sample') {
    if (isBlankRequiredValue(certificate.defectText)) return '종합판정 부적합 사유를 입력해주세요.';
    if (isBlankRequiredValue(certificate.actionText)) return '종합판정 개선조치를 입력해주세요.';
  }
  return '';
}

function validateRepeatSectionData(data) {
  const vehicles = Array.isArray(data.vehicles) ? data.vehicles : [];
  if (!vehicles.length) return '차량 정보를 1대 이상 입력해주세요.';
  for (let vi = 0; vi < vehicles.length; vi++) {
    const ve = vehicles[vi];
    const carNum = (ve.values && ve.values['item_01'] && String(ve.values['item_01']).trim()) || '';
    const label = `차량 ${vi + 1}${carNum ? `(${carNum})` : ''}`;
    if (!carNum) return `[${label}] 차량번호를 입력해주세요.`;
    const checks = ve.checkData || {};
    const defects = ve.defectTexts || {};
    for (const key of Object.keys(checks)) {
      if (checks[key] === 'ng' && isBlankRequiredValue(defects[key])) {
        return `[${label}] 부적합 내용을 입력해주세요.`;
      }
    }
  }
  return '';
}

function validateTemplateRequiredItems(logId, dataJson, factoryId) {
  const data = normalizeSubmittedData(dataJson);
  if (!data) return '제출 데이터 형식이 올바르지 않습니다.';

  const template = getTemplate(logId, factoryId);
  const metaInfo = getTemplateMetaInfo(template);
  if (metaInfo.certificateSpec) {
    return validateCertificateData(data, metaInfo.certificateSpec);
  }
  if (metaInfo.repeatSection) {
    return validateRepeatSectionData(data);
  }

  const templateItems = safeJson(template && template.items, []);
  const items = data.items && typeof data.items === 'object' ? data.items : {};

  if (logId === 'si0302') {
    const filterRows = Array.isArray(data.filterRows) ? data.filterRows : [];
    if (!filterRows.length) return '필터 설치일자와 교체(예정)일자를 입력해주세요.';
    for (const row of filterRows) {
      if (isBlankRequiredValue(row.installDate) || isBlankRequiredValue(row.replacementDate)) {
        return '필터 설치일자와 교체(예정)일자를 입력해주세요.';
      }
    }
  }

  if (templateItems.length) {
    let includeCurrentGroup = true;
    for (const item of templateItems) {
      if (item.type === 'group_header') {
        const processTypes = item.process_types || item.processTypes;
        includeCurrentGroup = !data.processType || !Array.isArray(processTypes) || !processTypes.length || processTypes.includes(data.processType);
        continue;
      }
      if (!includeCurrentGroup) continue;

      const entry = items[item.key] || {};
      const label = item.label || item.key;

      if (item.type === 'worker_hygiene_table' || Array.isArray(item.check_columns)) {
        const rows = data.workerRows && Array.isArray(data.workerRows[item.key])
          ? data.workerRows[item.key]
          : [];
        const columns = Array.isArray(item.check_columns) ? item.check_columns : [];

        for (const row of rows) {
          const workerName = row.workerName || '작업자';
          const checks = row.checks || {};
          const defectNotes = row.defectNotes || {};

          for (const col of columns) {
            const result = checks[col.key];
            if (!isValidInspectionResult(result)) {
              return `[${label}] ${workerName} - ${col.label || col.key} 점검 결과를 입력해주세요.`;
            }
            if (result === 'ng' && col.required_defect_action && isBlankRequiredValue(defectNotes[col.key])) {
              return `[${label}] ${workerName} - ${col.label || col.key} 부적합 내용을 입력해주세요.`;
            }
          }
        }
      } else if (item.type === 'numeric' || item.type === 'temp') {
        if (isBlankRequiredValue(entry.tempValue)) {
          return `[${label}] 측정값을 입력해주세요.`;
        }
        if (String(entry.tempValue).trim() === '-') {
          if (entry.result !== 'na') {
            return `[${label}] - 입력값은 해당없음으로 작성해주세요.`;
          }
        } else if (!Number.isFinite(Number(entry.tempValue))) {
          return `[${label}] 측정값은 숫자로 입력해주세요.`;
        }
        if (!isValidInspectionResult(entry.result)) {
          return `[${label}] 점검 결과를 입력해주세요.`;
        }
        if (isOutOfCriteria(entry.tempValue, item.criteria || item)) {
          if (entry.result !== 'ng') {
            return `[${label}] 기준을 벗어난 값은 부적합으로 작성해주세요.`;
          }
        }
      } else if (item.type === 'text' || item.type === 'date') {
        if (item.required && isBlankRequiredValue(entry.value)) {
          return `[${label}] 값을 입력해주세요.`;
        }
      } else if (!isValidInspectionResult(entry.result)) {
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
    if (String(data.temperature).trim() !== '-' && !Number.isFinite(Number(data.temperature))) return '온도는 숫자로 입력해주세요.';
  }

  for (const entry of Object.values(items)) {
    if (entry && entry.result === 'ng') {
      if (isBlankRequiredValue(entry.defectText)) return '부적합 내용을 입력해주세요.';
      if (isBlankRequiredValue(entry.actionText)) return '개선조치 내용을 입력해주세요.';
    }
  }

  return '';
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
