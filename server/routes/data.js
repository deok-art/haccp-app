const express = require('express');
const { db, safeJson, today, getFactories } = require('../db');
const { buildCalendarSummary, ensureFactoryCalendarDefaults } = require('../factory-calendar');
const { filterAccessibleTemplates } = require('../template-access');
const { deriveTitle } = require('../lib/utils/user');
const { getWeekBounds, getQuarterBounds } = require('../lib/utils/date');

const router = express.Router();

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

function dateDiffDays(fromDate, toDate) {
  const from = new Date(`${fromDate || ''}T00:00:00Z`);
  const to = new Date(`${toDate || ''}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.ceil((to.getTime() - from.getTime()) / 86400000);
}

function buildMaintenanceAlerts(factoryIds, todayStr) {
  const alerts = [];
  for (const factoryId of factoryIds) {
    const template = db.prepare(`
      SELECT title, meta_info
        FROM log_templates
       WHERE log_id = 'si0502' AND factory_id = ?
    `).get(factoryId);
    if (!template) continue;

    const latest = db.prepare(`
      SELECT record_id, title, date, data_json
        FROM records
       WHERE log_id = 'si0502'
         AND factory_id = ?
         AND data_json IS NOT NULL
         AND data_json != '{}'
       ORDER BY date DESC, updated_at DESC
       LIMIT 1
    `).get(factoryId);
    if (!latest) continue;

    const data = safeJson(latest.data_json, {});
    const items = data.items || {};
    const dueDate = items.MNG_03 && items.MNG_03.value;
    if (!dueDate) continue;

    const daysRemaining = dateDiffDays(todayStr, dueDate);
    if (daysRemaining === null) continue;

    const metaInfo = safeJson(template.meta_info, {});
    const alertDays = Number(metaInfo.cleaningAlertDays || 30);
    if (daysRemaining > alertDays) continue;

    let text = '탱크청소 예정일';
    let level = 'due';
    if (daysRemaining < 0) {
      text = `탱크청소 예정일 ${Math.abs(daysRemaining)}일 초과`;
      level = 'overdue';
    } else if (daysRemaining > 0) {
      text = `탱크청소 예정 D-${daysRemaining}`;
      level = 'soon';
    }

    alerts.push({
      factoryId,
      logId: 'si0502',
      title: template.title || latest.title || '용수관리 점검표',
      recordId: latest.record_id,
      dueDate,
      daysRemaining,
      level,
      text,
    });
  }
  return alerts;
}

function carryOverSi0502ManagementData(rec, dataJson) {
  if (!rec || rec.log_id !== 'si0502') return dataJson;
  const items = dataJson.items && typeof dataJson.items === 'object' ? dataJson.items : {};
  const hasManagementValues = ['MNG_01', 'MNG_02', 'MNG_03'].some(key => items[key] && items[key].value);
  if (hasManagementValues) return dataJson;

  const previous = db.prepare(`
    SELECT data_json
      FROM records
     WHERE log_id = 'si0502'
       AND factory_id = ?
       AND date < ?
       AND data_json IS NOT NULL
       AND data_json != '{}'
     ORDER BY date DESC, updated_at DESC
     LIMIT 1
  `).get(rec.factory_id, rec.date);
  const previousData = previous ? safeJson(previous.data_json, {}) : {};
  const previousItems = previousData.items || {};
  const nextItems = { ...items };
  ['MNG_01', 'MNG_02', 'MNG_03'].forEach(key => {
    if (previousItems[key] && previousItems[key].value && (!nextItems[key] || !nextItems[key].value)) {
      nextItems[key] = { ...previousItems[key], result: 'ok', defectText: '', actionText: '' };
    }
  });
  return { ...dataJson, items: nextItems };
}

function getPreviousRecordData(rec) {
  if (!rec || !rec.log_id || !rec.factory_id || !rec.date) return {};
  const previous = db.prepare(`
    SELECT data_json
      FROM records
     WHERE log_id = ?
       AND factory_id = ?
       AND date < ?
       AND data_json IS NOT NULL
       AND data_json != '{}'
     ORDER BY date DESC, updated_at DESC
     LIMIT 1
  `).get(rec.log_id, rec.factory_id, rec.date);
  return previous ? safeJson(previous.data_json, {}) : {};
}

// POST /api/getInitialData
router.post('/getInitialData', (req, res) => {
  Promise.resolve().then(async () => {
    const caller = req.session.user;
    const todayStr = today();
    const currentWeek = getWeekBounds(todayStr);
    const currentMonth = todayStr.slice(0, 7);
    const currentQuarter = getQuarterBounds(todayStr);
    ensureFactoryCalendarDefaults(db);

    const allLogTemplates = db.prepare('SELECT * FROM log_templates').all().map(t => ({
      logId:     t.log_id,
      title:     t.title,
      docNo:     t.doc_no,
      revision:  t.revision,
      factoryId: t.factory_id,
      responsibleDepartment: t.responsible_department || '',
      responsibleDepartments: safeJson(t.responsible_departments, []),
      interval:  t.interval,
      metaInfo:  safeJson(t.meta_info, {}),
      approval:  safeJson(t.approval, []),
      items:     safeJson(t.items, []),
    }));

    // 誘멸껐 ?덉퐫?????ㅻ뒛 ?덉퐫??+ 誘몄셿猷??덉퐫??
    const allFactories  = getFactories();
    const userFactories = caller.isMaster
      ? allFactories.map(f => f.id)
      : Object.keys(caller.factoryRoles || {});

    const logTemplates = filterAccessibleTemplates(db, caller, allLogTemplates);

    // logs 諛곗뿴 (Log_Templates 湲곕컲)
    const logs = logTemplates.map(t => ({
      id:        t.logId,
      title:     t.title,
      interval:  t.interval,
      docNo:     t.docNo,
      version:   t.revision,
      factoryId: t.factoryId,
      responsibleDepartment: t.responsibleDepartment || '',
      responsibleDepartments: t.responsibleDepartments || [],
    }));

    const placeholders = userFactories.map(() => '?').join(',');
    const rawRecords = userFactories.length
      ? db.prepare(
          `SELECT r.*, u.factory_roles as wr_roles, COALESCE(t.interval, 'daily') as template_interval FROM records r
           LEFT JOIN users u ON r.writer_id = u.id
           LEFT JOIN log_templates t ON r.log_id = t.log_id AND r.factory_id = t.factory_id
           WHERE r.factory_id IN (${placeholders})
             AND (
               r.status NOT IN ('?뱀씤?꾨즺')
               OR (COALESCE(t.interval, 'daily') = 'daily' AND r.date = ?)
               OR (COALESCE(t.interval, 'daily') = 'weekly' AND r.date >= ? AND r.date <= ?)
               OR (COALESCE(t.interval, 'daily') = 'monthly' AND substr(r.date, 1, 7) = ?)
               OR (COALESCE(t.interval, 'daily') = 'quarterly' AND r.date >= ? AND r.date <= ?)
             )
           ORDER BY r.date DESC, r.created_at DESC`
        ).all(...userFactories, todayStr, currentWeek.from, currentWeek.to, currentMonth, currentQuarter.from, currentQuarter.to)
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
    const maintenanceAlerts = buildMaintenanceAlerts(userFactories, todayStr);

    res.json({
      success: true,
      settings: getSettings(),
      logs,
      factories: allFactories,
      records,
      serverToday: todayStr,
      logTemplates,
      calendarSummary,
      maintenanceAlerts,
    });
  }).catch(err => {
    console.error('[getInitialData]', err);
    res.json({ success: false, message: err.message });
  });
});

// POST /api/getRecordDetail
router.post('/getRecordDetail', (req, res) => {
  const [recordId] = req.body;
  if (!recordId) return res.json({ success: false, message: '?덉퐫??ID媛 ?놁뒿?덈떎.' });

  const rec = db.prepare('SELECT * FROM records WHERE record_id = ?').get(recordId);
  if (!rec) return res.json({ success: false, message: '?덉퐫?쒕? 李얠쓣 ???놁뒿?덈떎.' });

  const writerUser   = getUserById(rec.writer_id)   || getUserByName(rec.writer_name);
  const reviewerUser = getUserById(rec.reviewer_id) || getUserByName(rec.reviewer_name);
  const approverUser = getUserById(rec.approver_id) || getUserByName(rec.approver_name);
  let dataJson = safeJson(rec.data_json, {});
  const previousDataJson = getPreviousRecordData(rec);

  if (rec.log_id === 'si0302' && (!Array.isArray(dataJson.filterRows) || !dataJson.filterRows.length)) {
    if (Array.isArray(previousDataJson.filterRows) && previousDataJson.filterRows.length) {
      dataJson.filterRows = previousDataJson.filterRows;
      dataJson.filterCarryoverFromPrevious = true;
    }
  }
  dataJson = carryOverSi0502ManagementData(rec, dataJson);

  res.json({
    success:            true,
    dataJson:           dataJson,
    previousDataJson:   previousDataJson,
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
router.post('/getRecordsForDateRange', (req, res) => {
  const [factoryId, fromDate, toDate] = req.body;
  if (!factoryId || !fromDate || !toDate) {
    return res.json({ success: false, message: '?뚮씪誘명꽣媛 ?щ컮瑜댁? ?딆뒿?덈떎.' });
  }

  const records = db.prepare(
    `SELECT * FROM records
     WHERE factory_id = ? AND date >= ? AND date <= ? AND approver_id != ''
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


