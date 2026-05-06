const { db, now } = require('./db');
const { filterAccessibleTemplates } = require('./template-access');
const { createUtcDate, formatUtcDate, getWeekBounds, getQuarterBounds } = require('./lib/utils/date');
const {
  buildAlertItems,
  isMissingStatus,
  isSatisfiedStatus,
} = require('./lib/calendar/strategies');

const HOLIDAY_API_BASE = 'https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo';

function toMonthKey(dateStr) {
  return String(dateStr || '').slice(0, 7);
}

function toLocDate(dateStr) {
  return String(dateStr || '').replace(/-/g, '');
}

function fromLocDate(locdate) {
  const text = String(locdate || '');
  if (text.length !== 8) return '';
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function listDates(fromDate, toDate) {
  const dates = [];
  const cursor = createUtcDate(fromDate);
  const end = createUtcDate(toDate);
  while (cursor <= end) {
    dates.push(formatUtcDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function listMonthDates(monthKey) {
  const [year, month] = String(monthKey || '').split('-').map(Number);
  const start = new Date(Date.UTC(year || 1970, (month || 1) - 1, 1));
  const end = new Date(Date.UTC(year || 1970, month || 1, 0));
  return listDates(formatUtcDate(start), formatUtcDate(end));
}

function listMonthWeeks(monthKey) {
  const dates = listMonthDates(monthKey);
  const seen = new Set();
  return dates.map(date => getWeekBounds(date))
    .filter(week => {
      if (seen.has(week.from)) return false;
      seen.add(week.from);
      return true;
    });
}

function getIsoWeekNumber(dateStr) {
  const date = createUtcDate(dateStr);
  const dayOfWeek = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayOfWeek);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
}

function getBiweeklyStartDate(dateStr) {
  const weekStart = getWeekBounds(dateStr).from;
  const weekNum = getIsoWeekNumber(weekStart);
  if (weekNum % 2 === 1) return weekStart;
  const prev = createUtcDate(weekStart);
  prev.setUTCDate(prev.getUTCDate() - 7);
  return formatUtcDate(prev);
}

function listBiweeklyPeriods(monthKey) {
  const weeks = listMonthWeeks(monthKey);
  const seen = new Set();
  const periods = [];
  weeks.forEach(week => {
    const periodStart = getBiweeklyStartDate(week.from);
    if (seen.has(periodStart)) return;
    seen.add(periodStart);
    const end = createUtcDate(periodStart);
    end.setUTCDate(end.getUTCDate() + 13);
    periods.push({ from: periodStart, to: formatUtcDate(end) });
  });
  return periods;
}

function isSummerMonth(monthKey) {
  const month = parseInt(String(monthKey || '').slice(5, 7), 10);
  return month >= 4 && month <= 9;
}

function normalizeWeekdayMask(maskText) {
  const days = String(maskText || '1,2,3,4,5')
    .split(',')
    .map(value => parseInt(value, 10))
    .filter(value => value >= 1 && value <= 7);
  const unique = Array.from(new Set(days)).sort((a, b) => a - b);
  return unique.length ? unique.join(',') : '1,2,3,4,5';
}

function parseWeekdayMask(maskText) {
  return new Set(normalizeWeekdayMask(maskText).split(',').map(Number));
}

function getIsoWeekday(dateStr) {
  const day = createUtcDate(dateStr).getUTCDay();
  return day === 0 ? 7 : day;
}

function getServiceKey() {
  const raw = process.env.PUBLIC_DATA_SERVICE_KEY
    || process.env.DATA_GO_KR_SERVICE_KEY
    || process.env.KASI_SERVICE_KEY
    || process.env.HOLIDAY_API_SERVICE_KEY
    || process.env.SERVICE_KEY
    || '';
  return normalizeServiceKey(raw);
}

function normalizeServiceKey(serviceKey) {
  let value = String(serviceKey || '').trim();
  if (!value) return '';

  value = value
    .replace(/^["']|["']$/g, '')
    .replace(/&amp;/g, '&');

  if (/%[0-9A-Fa-f]{2}/.test(value)) {
    try {
      value = decodeURIComponent(value);
    } catch (err) {
      // Keep the original value when it is not a valid percent-encoded string.
    }
  }

  return value.trim();
}

function xmlDecode(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function readXmlField(block, field) {
  const match = String(block || '').match(new RegExp(`<${field}>([\\s\\S]*?)<\\/${field}>`));
  return match ? xmlDecode(match[1]).trim() : '';
}

function parseHolidayXml(xmlText) {
  const items = [];
  const itemMatches = String(xmlText || '').match(/<item>([\s\S]*?)<\/item>/g) || [];
  itemMatches.forEach(itemBlock => {
    const holidayDate = fromLocDate(readXmlField(itemBlock, 'locdate'));
    if (!holidayDate) return;
    items.push({
      holidayDate,
      holidayName: readXmlField(itemBlock, 'dateName') || '공휴일',
      isHoliday: readXmlField(itemBlock, 'isHoliday') === 'Y' ? 1 : 0,
    });
  });
  return items;
}

function ensureFactoryCalendarDefaults(database = db) {
  const factories = database.prepare('SELECT factory_id FROM factories').all();
  if (!factories.length) return;
  const insert = database.prepare(`
    INSERT OR IGNORE INTO factory_calendar_rules
      (factory_id, default_weekday_mask, use_national_holidays, updated_by, updated_at)
    VALUES
      (?, '1,2,3,4,5', 1, '', ?)
  `);
  const transaction = database.transaction(() => {
    factories.forEach(factory => insert.run(factory.factory_id, now()));
  });
  transaction();
}

function getFactoryCalendarRule(factoryId, database = db) {
  ensureFactoryCalendarDefaults(database);
  return database.prepare(`
    SELECT factory_id, default_weekday_mask, use_national_holidays, updated_by, updated_at
    FROM factory_calendar_rules
    WHERE factory_id = ?
  `).get(factoryId) || {
    factory_id: factoryId,
    default_weekday_mask: '1,2,3,4,5',
    use_national_holidays: 1,
    updated_by: '',
    updated_at: '',
  };
}

function getNationalHolidayMapForYear(year, database = db) {
  const rows = database.prepare(`
    SELECT holiday_date, holiday_name, is_holiday
    FROM national_holidays
    WHERE source_year = ?
  `).all(year);
  return rows.reduce((acc, row) => {
    acc[row.holiday_date] = {
      holidayName: row.holiday_name,
      isHoliday: row.is_holiday === 1,
    };
    return acc;
  }, {});
}

async function syncNationalHolidaysForYear(year, database = db) {
  const numericYear = parseInt(year, 10);
  if (!numericYear) return { success: false, message: '유효한 연도가 아닙니다.', inserted: 0 };

  const cachedCount = database.prepare(
    'SELECT COUNT(*) AS cnt FROM national_holidays WHERE source_year = ?'
  ).get(numericYear).cnt;
  if (cachedCount > 0) return { success: true, inserted: 0, cached: true };

  const serviceKey = getServiceKey();
  if (!serviceKey) {
    return {
      success: false,
      message: '공휴일 자동 동기화를 위해 PUBLIC_DATA_SERVICE_KEY 또는 HOLIDAY_API_SERVICE_KEY 설정이 필요합니다.',
      inserted: 0,
      missingServiceKey: true,
    };
  }

  const collected = new Map();
  for (let month = 1; month <= 12; month += 1) {
    const url = new URL(HOLIDAY_API_BASE);
    url.searchParams.set('ServiceKey', serviceKey);
    url.searchParams.set('solYear', String(numericYear));
    url.searchParams.set('solMonth', String(month).padStart(2, '0'));
    url.searchParams.set('pageNo', '1');
    url.searchParams.set('numOfRows', '50');

    const response = await fetch(url);
    const xmlText = await response.text();
    if (!response.ok) {
      return {
        success: false,
        message: `공휴일 정보를 불러오지 못했습니다. (${response.status})`,
        inserted: 0,
      };
    }

    const resultCode = readXmlField(xmlText, 'resultCode');
    if (resultCode && resultCode !== '00') {
      return {
        success: false,
        message: readXmlField(xmlText, 'resultMsg') || '공휴일 API 호출에 실패했습니다.',
        inserted: 0,
      };
    }

    parseHolidayXml(xmlText)
      .filter(item => item.isHoliday === 1)
      .forEach(item => {
        collected.set(item.holidayDate, item);
      });
  }

  if (!collected.size) {
    return {
      success: false,
      message: '동기화된 공휴일 데이터가 없습니다.',
      inserted: 0,
    };
  }

  const insert = database.prepare(`
    INSERT INTO national_holidays (holiday_date, holiday_name, is_holiday, source_year, fetched_at)
    VALUES (@holiday_date, @holiday_name, @is_holiday, @source_year, @fetched_at)
    ON CONFLICT(holiday_date) DO UPDATE SET
      holiday_name = excluded.holiday_name,
      is_holiday = excluded.is_holiday,
      source_year = excluded.source_year,
      fetched_at = excluded.fetched_at
  `);

  const fetchedAt = now();
  const transaction = database.transaction(() => {
    collected.forEach(item => {
      insert.run({
        holiday_date: item.holidayDate,
        holiday_name: item.holidayName,
        is_holiday: item.isHoliday,
        source_year: numericYear,
        fetched_at: fetchedAt,
      });
    });
  });
  transaction();

  return { success: true, inserted: collected.size, cached: false };
}

async function ensureNationalHolidaysForYear(year, database = db) {
  const numericYear = parseInt(year, 10);
  if (!numericYear) return { success: false, inserted: 0 };
  const cachedCount = database.prepare(
    'SELECT COUNT(*) AS cnt FROM national_holidays WHERE source_year = ?'
  ).get(numericYear).cnt;
  if (cachedCount > 0) return { success: true, inserted: 0, cached: true };
  return syncNationalHolidaysForYear(numericYear, database);
}

async function ensureNationalHolidaysForMonth(monthKey, database = db) {
  const year = parseInt(String(monthKey || '').slice(0, 4), 10);
  if (!year) return { success: false, inserted: 0 };
  return ensureNationalHolidaysForYear(year, database);
}

function getCalendarDecision(factoryId, dateStr, database = db) {
  const rule = getFactoryCalendarRule(factoryId, database);
  const override = database.prepare(`
    SELECT override_type, reason, updated_by, updated_at
    FROM factory_calendar_overrides
    WHERE factory_id = ? AND date = ?
  `).get(factoryId, dateStr);
  const holiday = database.prepare(`
    SELECT holiday_name, is_holiday
    FROM national_holidays
    WHERE holiday_date = ?
  `).get(dateStr);
  const weekdaySet = parseWeekdayMask(rule.default_weekday_mask);
  const weekday = getIsoWeekday(dateStr);
  const defaultWorkday = weekdaySet.has(weekday);

  if (override) {
    return {
      date: dateStr,
      isWorkday: override.override_type === 'workday',
      source: 'override',
      defaultWorkday,
      holidayName: holiday && holiday.is_holiday === 1 ? holiday.holiday_name : '',
      overrideType: override.override_type,
      overrideReason: override.reason || '',
      updatedBy: override.updated_by || '',
      updatedAt: override.updated_at || '',
    };
  }

  if (rule.use_national_holidays === 1 && holiday && holiday.is_holiday === 1) {
    return {
      date: dateStr,
      isWorkday: false,
      source: 'national_holiday',
      defaultWorkday,
      holidayName: holiday.holiday_name || '공휴일',
      overrideType: '',
      overrideReason: '',
      updatedBy: '',
      updatedAt: '',
    };
  }

  return {
    date: dateStr,
    isWorkday: defaultWorkday,
    source: 'default_rule',
    defaultWorkday,
    holidayName: holiday && holiday.is_holiday === 1 ? holiday.holiday_name : '',
    overrideType: '',
    overrideReason: '',
    updatedBy: '',
    updatedAt: '',
  };
}

async function getFactoryCalendarMonth(factoryId, monthKey, database = db) {
  ensureFactoryCalendarDefaults(database);
  await ensureNationalHolidaysForMonth(monthKey, database);
  const rule = getFactoryCalendarRule(factoryId, database);
  const dates = listMonthDates(monthKey);
  const days = dates.map(date => {
    const decision = getCalendarDecision(factoryId, date, database);
    return {
      date,
      isWorkday: decision.isWorkday,
      source: decision.source,
      holidayName: decision.holidayName || '',
      overrideType: decision.overrideType || '',
      overrideReason: decision.overrideReason || '',
      isoWeekday: getIsoWeekday(date),
      weekdayLabel: ['월', '화', '수', '목', '금', '토', '일'][getIsoWeekday(date) - 1],
      isToday: false,
    };
  });
  return {
    monthKey,
    factoryId,
    rule: {
      defaultWeekdayMask: normalizeWeekdayMask(rule.default_weekday_mask),
      useNationalHolidays: rule.use_national_holidays === 1,
      updatedBy: rule.updated_by || '',
      updatedAt: rule.updated_at || '',
    },
    days,
  };
}

async function buildCalendarSummary(factoryIds, todayStr, database = db) {
  ensureFactoryCalendarDefaults(database);
  const currentWeek = getWeekBounds(todayStr);
  const currentMonth = toMonthKey(todayStr);
  const currentQuarter = getQuarterBounds(todayStr);
  await ensureNationalHolidaysForYear(parseInt(todayStr.slice(0, 4), 10), database);

  const summary = {};
  factoryIds.forEach(factoryId => {
    const todayDecision = getCalendarDecision(factoryId, todayStr, database);
    const weekDates = listDates(currentWeek.from, currentWeek.to);
    const monthDates = listMonthDates(currentMonth);
    const quarterDates = listDates(currentQuarter.from, currentQuarter.to);
    summary[factoryId] = {
      today: {
        date: todayStr,
        isWorkday: todayDecision.isWorkday,
        source: todayDecision.source,
        holidayName: todayDecision.holidayName || '',
      },
      currentWeek: {
        from: currentWeek.from,
        to: currentWeek.to,
        hasWorkday: weekDates.some(date => getCalendarDecision(factoryId, date, database).isWorkday),
      },
      currentMonth: {
        monthKey: currentMonth,
        hasWorkday: monthDates.some(date => getCalendarDecision(factoryId, date, database).isWorkday),
      },
      currentQuarter: {
        from: currentQuarter.from,
        to: currentQuarter.to,
        hasWorkday: quarterDates.some(date => getCalendarDecision(factoryId, date, database).isWorkday),
      },
    };
  });
  return summary;
}

function collectLatestPeriodRecords(rows, keyBuilder) {
  return rows.reduce((acc, row) => {
    const key = keyBuilder(row);
    if (!key) return acc;
    if (!acc[key]) {
      acc[key] = row;
      return acc;
    }
    const prev = acc[key];
    const prevTime = `${prev.date || ''} ${prev.created_at || ''}`;
    const nextTime = `${row.date || ''} ${row.created_at || ''}`;
    if (nextTime >= prevTime) acc[key] = row;
    return acc;
  }, {});
}

async function getMissingDashboard(factoryId, monthKey, database = db, user = null) {
  ensureFactoryCalendarDefaults(database);
  await ensureNationalHolidaysForMonth(monthKey, database);

  const [monthStart, monthEnd] = [monthKey + '-01', listMonthDates(monthKey).slice(-1)[0]];
  const visibleQuarter = getQuarterBounds(monthStart);
  let templates = database.prepare(`
    SELECT log_id, title, interval, meta_info, factory_id, responsible_department, responsible_departments
    FROM log_templates
    WHERE factory_id = ?
    ORDER BY interval, title
  `).all(factoryId);
  if (user) templates = filterAccessibleTemplates(database, user, templates);

  const monthDates = listMonthDates(monthKey);
  const monthWeeks = listMonthWeeks(monthKey);
  const rows = database.prepare(`
    SELECT record_id, log_id, title, date, status, factory_id, created_at
    FROM records
    WHERE factory_id = ?
      AND (
        (substr(date, 1, 7) = ?)
        OR (date >= ? AND date <= ?)
      )
    ORDER BY date DESC, created_at DESC
  `).all(factoryId, monthKey, monthStart, monthEnd);
  const quarterlyRows = database.prepare(`
    SELECT record_id, log_id, title, date, status, factory_id, created_at
    FROM records
    WHERE factory_id = ?
      AND date >= ? AND date <= ?
      AND log_id IN (
        SELECT log_id FROM log_templates WHERE factory_id = ? AND interval = 'quarterly'
      )
    ORDER BY date DESC, created_at DESC
  `).all(factoryId, visibleQuarter.from, monthEnd, factoryId);

  const periodMaps = {
    daily:     collectLatestPeriodRecords(rows, row => `${row.log_id}::${row.date}`),
    weekly:    collectLatestPeriodRecords(rows, row => `${row.log_id}::${getWeekBounds(row.date).from}`),
    biweekly:  collectLatestPeriodRecords(rows, row => `${row.log_id}::${getBiweeklyStartDate(row.date)}`),
    monthly:   collectLatestPeriodRecords(rows, row => `${row.log_id}::${toMonthKey(row.date)}`),
    quarterly: collectLatestPeriodRecords(quarterlyRows, row => `${row.log_id}::${getQuarterBounds(row.date).from}`),
  };

  // 전략에 주입할 컨텍스트 — 모든 DB·factoryId 의존성을 closure로 캡슐화
  const ctx = {
    monthKey,
    monthEnd,
    monthDates,
    monthWeeks,
    biweeklyPeriods: listBiweeklyPeriods(monthKey),
    quarterBounds: visibleQuarter,
    isWorkday: (date) => getCalendarDecision(factoryId, date, database).isWorkday,
    periodMaps,
    logHelpers: {
      listDates,
      toMonthKey,
      getQuarterBounds,
      isSummerMonth,
      parseMeta: (raw) => { try { return JSON.parse(raw || '{}'); } catch (e) { return {}; } },
    },
  };

  const items = [];
  templates.forEach(template => {
    items.push(...buildAlertItems(template, ctx));
  });

  items.sort((a, b) => {
    if (a.dueDate !== b.dueDate) return String(b.dueDate).localeCompare(String(a.dueDate));
    if (a.interval !== b.interval) return String(a.interval).localeCompare(String(b.interval));
    return String(a.title).localeCompare(String(b.title));
  });

  return {
    factoryId,
    monthKey,
    count: items.length,
    items,
  };
}

module.exports = {
  buildCalendarSummary,
  ensureFactoryCalendarDefaults,
  ensureNationalHolidaysForMonth,
  getCalendarDecision,
  getFactoryCalendarMonth,
  getFactoryCalendarRule,
  getMissingDashboard,
  getWeekBounds,
  getQuarterBounds,
  getBiweeklyStartDate,
  listMonthDates,
  listBiweeklyPeriods,
  isSummerMonth,
  normalizeWeekdayMask,
  normalizeServiceKey,
  syncNationalHolidaysForYear,
  toMonthKey,
  toLocDate,
  isMissingStatus,
  isSatisfiedStatus,
};
