// 단위 테스트 — server/lib/calendar/strategies.js
//
// ctx 객체를 페이크로 만들어 각 전략을 격리 검증한다.
// DB·factoryId 의존은 ctx.isWorkday로 주입되므로 이 테스트는 순수.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAlertItems,
  dailyStrategy,
  weeklyStrategy,
  monthlyStrategy,
  quarterlyStrategy,
  biweeklyStrategy,
  seasonalStrategy,
  isMissingStatus,
  isSatisfiedStatus,
} = require('../lib/calendar/strategies');

// 공용 페이크 logHelpers — 실제 factory-calendar에서 가져오는 동작과 동일
function makeLogHelpers() {
  return {
    listDates(from, to) {
      const dates = [];
      const cursor = new Date(`${from}T00:00:00Z`);
      const end = new Date(`${to}T00:00:00Z`);
      while (cursor <= end) {
        dates.push(cursor.toISOString().slice(0, 10));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
      }
      return dates;
    },
    toMonthKey(date) { return String(date || '').slice(0, 7); },
    getQuarterBounds(date) {
      const [y, m] = String(date).slice(0, 7).split('-').map(Number);
      const qs = Math.floor((m - 1) / 3) * 3;
      const start = new Date(Date.UTC(y, qs, 1));
      const end = new Date(Date.UTC(y, qs + 3, 0));
      return {
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
      };
    },
    isSummerMonth(monthKey) {
      const m = Number(String(monthKey).slice(5, 7));
      return m >= 6 && m <= 9;
    },
    parseMeta(raw) { try { return JSON.parse(raw || '{}'); } catch (e) { return {}; } },
  };
}

function makeCtx(overrides = {}) {
  return {
    monthKey: '2026-05',
    monthEnd: '2026-05-31',
    monthDates: ['2026-05-04', '2026-05-05', '2026-05-06'],
    monthWeeks: [{ from: '2026-05-04', to: '2026-05-10' }],
    biweeklyPeriods: [
      { from: '2026-05-01', to: '2026-05-14' },
      { from: '2026-05-15', to: '2026-05-28' },
    ],
    quarterBounds: { from: '2026-04-01', to: '2026-06-30' },
    isWorkday: () => true,
    periodMaps: { daily: {}, weekly: {}, biweekly: {}, monthly: {}, quarterly: {} },
    logHelpers: makeLogHelpers(),
    ...overrides,
  };
}

function tpl(overrides = {}) {
  return { log_id: 'TEST', title: 'Test Log', interval: 'daily', meta_info: '{}', ...overrides };
}

// ───── isMissingStatus / isSatisfiedStatus ─────
test('isMissingStatus: 빈값/미작성/작성중은 missing', () => {
  assert.equal(isMissingStatus(''), true);
  assert.equal(isMissingStatus(null), true);
  assert.equal(isMissingStatus('미작성'), true);
  assert.equal(isMissingStatus('작성중'), true);
  assert.equal(isMissingStatus('작성완료'), false);
});

test('isSatisfiedStatus: 작성완료/검토완료/승인완료는 satisfied', () => {
  assert.equal(isSatisfiedStatus('작성완료'), true);
  assert.equal(isSatisfiedStatus('검토완료'), true);
  assert.equal(isSatisfiedStatus('승인완료'), true);
  assert.equal(isSatisfiedStatus('미작성'), false);
});

// ───── dailyStrategy ─────
test('dailyStrategy: 작업일마다 미작성 항목 생성', () => {
  const items = dailyStrategy(tpl(), makeCtx());
  assert.equal(items.length, 3);
  assert.equal(items[0].interval, 'daily');
  assert.equal(items[0].periodKey, '2026-05-04');
  assert.equal(items[0].dueDate, '2026-05-04');
  assert.equal(items[0].reason, '미작성');
});

test('dailyStrategy: 비작업일은 스킵', () => {
  const ctx = makeCtx({ isWorkday: (date) => date !== '2026-05-05' });
  const items = dailyStrategy(tpl(), ctx);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(i => i.periodKey), ['2026-05-04', '2026-05-06']);
});

test('dailyStrategy: 이미 작성완료된 날은 제외', () => {
  const ctx = makeCtx({
    periodMaps: {
      daily: { 'TEST::2026-05-05': { record_id: 'R1', status: '작성완료' } },
      weekly: {}, biweekly: {}, monthly: {}, quarterly: {},
    },
  });
  const items = dailyStrategy(tpl(), ctx);
  assert.equal(items.length, 2);
});

test('dailyStrategy: 작성중 상태는 reason에 그 상태 표시', () => {
  const ctx = makeCtx({
    periodMaps: {
      daily: { 'TEST::2026-05-04': { record_id: 'R1', status: '작성중' } },
      weekly: {}, biweekly: {}, monthly: {}, quarterly: {},
    },
  });
  const items = dailyStrategy(tpl(), ctx);
  assert.equal(items[0].reason, '작성중');
  assert.equal(items[0].recordId, 'R1');
});

// ───── weeklyStrategy ─────
test('weeklyStrategy: 작업일이 있는 주만 알림', () => {
  const items = weeklyStrategy(tpl({ interval: 'weekly' }), makeCtx());
  assert.equal(items.length, 1);
  assert.equal(items[0].rangeLabel, '2026-05-04 ~ 2026-05-10');
  assert.equal(items[0].dueDate, '2026-05-10');
});

test('weeklyStrategy: 작업일 없는 주는 스킵', () => {
  const ctx = makeCtx({ isWorkday: () => false });
  const items = weeklyStrategy(tpl({ interval: 'weekly' }), ctx);
  assert.equal(items.length, 0);
});

// ───── monthlyStrategy ─────
test('monthlyStrategy: 작업일이 있으면 1개 알림', () => {
  const items = monthlyStrategy(tpl({ interval: 'monthly' }), makeCtx());
  assert.equal(items.length, 1);
  assert.equal(items[0].periodKey, '2026-05');
  assert.equal(items[0].dueDate, '2026-05-31');
});

test('monthlyStrategy: 작업일 0이면 스킵', () => {
  const ctx = makeCtx({ isWorkday: () => false });
  const items = monthlyStrategy(tpl({ interval: 'monthly' }), ctx);
  assert.equal(items.length, 0);
});

// ───── quarterlyStrategy ─────
test('quarterlyStrategy: 분기 마지막 월에서만 알림 (2026-06 = Q2 마지막)', () => {
  const ctx = makeCtx({
    monthKey: '2026-06',
    monthDates: ['2026-06-01', '2026-06-30'],
    monthEnd: '2026-06-30',
    monthWeeks: [],
    quarterBounds: { from: '2026-04-01', to: '2026-06-30' },
  });
  const items = quarterlyStrategy(tpl({ interval: 'quarterly' }), ctx);
  assert.equal(items.length, 1);
  assert.equal(items[0].periodKey, '2026-04-01');
  assert.equal(items[0].dueDate, '2026-06-30');
});

test('quarterlyStrategy: 분기 중간 월에서는 스킵 (2026-05 = Q2 중간)', () => {
  const items = quarterlyStrategy(tpl({ interval: 'quarterly' }), makeCtx());
  assert.equal(items.length, 0);
});

// ───── biweeklyStrategy ─────
test('biweeklyStrategy: 작업일이 있는 격주마다 알림', () => {
  const items = biweeklyStrategy(tpl({ interval: 'biweekly' }), makeCtx());
  assert.equal(items.length, 2);
  assert.equal(items[0].rangeLabel, '2026-05-01 ~ 2026-05-14');
  assert.equal(items[1].rangeLabel, '2026-05-15 ~ 2026-05-28');
});

// ───── seasonalStrategy ─────
test('seasonalStrategy: 여름(2026-07)은 weekly 패턴 적용', () => {
  const ctx = makeCtx({
    monthKey: '2026-07',
    monthDates: ['2026-07-06'],
    monthEnd: '2026-07-31',
    monthWeeks: [{ from: '2026-07-06', to: '2026-07-12' }],
  });
  const items = seasonalStrategy(tpl({ interval: 'seasonal' }), ctx);
  assert.equal(items.length, 1);
  assert.equal(items[0].interval, 'seasonal');
  assert.equal(items[0].effectiveInterval, 'weekly');
});

test('seasonalStrategy: 겨울(2026-01)은 biweekly 패턴 적용', () => {
  const ctx = makeCtx({
    monthKey: '2026-01',
    monthDates: ['2026-01-05'],
    monthEnd: '2026-01-31',
    biweeklyPeriods: [{ from: '2026-01-01', to: '2026-01-14' }],
  });
  const items = seasonalStrategy(tpl({ interval: 'seasonal' }), ctx);
  assert.equal(items.length, 1);
  assert.equal(items[0].effectiveInterval, 'biweekly');
});

test('seasonalStrategy: meta_info의 summerInterval 오버라이드 사용', () => {
  const ctx = makeCtx({
    monthKey: '2026-08',
    monthDates: ['2026-08-03'],
    monthEnd: '2026-08-31',
    biweeklyPeriods: [{ from: '2026-08-01', to: '2026-08-14' }],
  });
  // 여름이지만 summerInterval='biweekly'로 강제
  const template = tpl({ interval: 'seasonal', meta_info: '{"summerInterval":"biweekly"}' });
  const items = seasonalStrategy(template, ctx);
  assert.equal(items[0].effectiveInterval, 'biweekly');
});

// ───── buildAlertItems (디스패처) ─────
test('buildAlertItems: interval이 알려지지 않으면 빈 배열', () => {
  const items = buildAlertItems(tpl({ interval: 'unknown' }), makeCtx());
  assert.deepEqual(items, []);
});

test('buildAlertItems: daily는 dailyStrategy로 라우팅', () => {
  const items = buildAlertItems(tpl({ interval: 'daily' }), makeCtx());
  assert.equal(items.length, 3);
  assert.equal(items[0].interval, 'daily');
});
