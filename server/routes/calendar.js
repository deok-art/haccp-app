const express = require('express');
const { db, now } = require('../db');
const {
  ensureFactoryCalendarDefaults,
  getFactoryCalendarMonth,
  getMissingDashboard,
  normalizeWeekdayMask,
  syncNationalHolidaysForYear,
} = require('../factory-calendar');

const { getCallerRole } = require('../lib/auth/role');

const router = express.Router();

function requireFactoryAccess(req, res, factoryId, minRole) {
  const role = getCallerRole(req.session.user, factoryId);
  if (role >= minRole) return true;
  res.json({ success: false, message: '권한이 없습니다.' });
  return false;
}

router.post('/getFactoryCalendarMonth', async (req, res) => {
  try {
    const [factoryId, monthKey] = req.body;
    if (!factoryId || !monthKey) {
      return res.json({ success: false, message: '파라미터가 올바르지 않습니다.' });
    }
    if (!requireFactoryAccess(req, res, factoryId, 1)) return;

    const data = await getFactoryCalendarMonth(factoryId, monthKey, db);
    res.json({ success: true, ...data });
  } catch (err) {
    console.error('[getFactoryCalendarMonth]', err);
    res.json({ success: false, message: err.message });
  }
});

router.post('/getMissingDashboard', async (req, res) => {
  try {
    const [factoryId, monthKey] = req.body;
    if (!factoryId || !monthKey) {
      return res.json({ success: false, message: '파라미터가 올바르지 않습니다.' });
    }
    if (!requireFactoryAccess(req, res, factoryId, 1)) return;

    const dashboard = await getMissingDashboard(factoryId, monthKey, db, req.session.user);
    res.json({ success: true, ...dashboard });
  } catch (err) {
    console.error('[getMissingDashboard]', err);
    res.json({ success: false, message: err.message });
  }
});

router.post('/updateFactoryCalendarRule', (req, res) => {
  const [factoryId, weekdayMask, useNationalHolidays] = req.body;
  if (!factoryId) return res.json({ success: false, message: '공장 정보가 없습니다.' });
  if (!requireFactoryAccess(req, res, factoryId, 2)) return;

  ensureFactoryCalendarDefaults(db);
  db.prepare(`
    INSERT INTO factory_calendar_rules
      (factory_id, default_weekday_mask, use_national_holidays, updated_by, updated_at)
    VALUES
      (?, ?, ?, ?, ?)
    ON CONFLICT(factory_id) DO UPDATE SET
      default_weekday_mask = excluded.default_weekday_mask,
      use_national_holidays = excluded.use_national_holidays,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(
    factoryId,
    normalizeWeekdayMask(weekdayMask),
    useNationalHolidays ? 1 : 0,
    req.session.user.name || req.session.user.id,
    now()
  );

  res.json({ success: true });
});

router.post('/updateFactoryCalendarDay', (req, res) => {
  const [factoryId, dateStr, overrideType, reason] = req.body;
  if (!factoryId || !dateStr) {
    return res.json({ success: false, message: '파라미터가 올바르지 않습니다.' });
  }
  if (!requireFactoryAccess(req, res, factoryId, 2)) return;

  if (!overrideType || overrideType === 'default') {
    db.prepare('DELETE FROM factory_calendar_overrides WHERE factory_id = ? AND date = ?')
      .run(factoryId, dateStr);
    return res.json({ success: true });
  }

  if (!['workday', 'holiday'].includes(overrideType)) {
    return res.json({ success: false, message: '허용되지 않는 상태입니다.' });
  }

  db.prepare(`
    INSERT INTO factory_calendar_overrides
      (factory_id, date, override_type, reason, updated_by, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?)
    ON CONFLICT(factory_id, date) DO UPDATE SET
      override_type = excluded.override_type,
      reason = excluded.reason,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `).run(
    factoryId,
    dateStr,
    overrideType,
    reason || '',
    req.session.user.name || req.session.user.id,
    now()
  );

  res.json({ success: true });
});

router.post('/syncNationalHolidays', async (req, res) => {
  try {
    const [year, factoryId] = req.body;
    if (factoryId && !requireFactoryAccess(req, res, factoryId, 2)) return;
    if (!factoryId && !req.session.user.isMaster) {
      return res.json({ success: false, message: '권한이 없습니다.' });
    }
    const result = await syncNationalHolidaysForYear(year, db);
    res.json(result);
  } catch (err) {
    console.error('[syncNationalHolidays]', err);
    res.json({ success: false, message: err.message });
  }
});

module.exports = router;
