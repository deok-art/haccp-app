// server/lib/calendar/strategies.js
// 미작성 대시보드의 주기별 처리 전략. 순수 함수 — DB·세션 의존 없음.
//
// 각 전략은 (template, ctx) → 미작성 알림 항목 배열을 반환한다.
// ctx에 필요한 데이터·콜백은 모두 호출자가 주입한다:
//   - monthKey, monthEnd
//   - monthDates, monthWeeks, biweeklyPeriods (해당 월에 속한 날짜·주·격주 목록)
//   - isWorkday(date)         → boolean (factoryId·DB는 호출자 closure에 캡슐화)
//   - periodMaps              → { daily, weekly, biweekly, monthly, quarterly }
//                               각각 `${log_id}::${periodKey}` → record
//   - quarterBounds           → 현재 보이는 분기 경계 { from, to }
//   - logHelpers              → { listDates, toMonthKey, getQuarterBounds, isSummerMonth, parseMeta }
//                               순수 helpers. 호출자가 factory-calendar에서 받아 주입한다.

const MISSING_STATUSES = new Set(['미작성', '작성중']);
const COMPLETED_OR_PENDING_STATUSES = new Set(['작성완료', '검토완료', '승인완료']);

function isMissingStatus(status) {
  return !status || MISSING_STATUSES.has(status);
}

function isSatisfiedStatus(status) {
  return COMPLETED_OR_PENDING_STATUSES.has(status);
}

function buildAlertItem(template, periodKey, dueDate, rec, extras = {}) {
  return {
    logId: template.log_id,
    title: template.title,
    interval: extras.interval || template.interval,
    periodKey,
    dueDate,
    status: rec ? rec.status : '',
    recordId: rec ? rec.record_id : '',
    reason: rec && isMissingStatus(rec.status) ? rec.status : '미작성',
    ...extras,
  };
}

// 한 주(혹은 격주) 기간 안에 작업일이 하나라도 있으면 true.
// monthKey와 일치하는 날짜만 카운트한다.
function hasWorkdayInRange(from, to, monthKey, ctx) {
  return ctx.logHelpers.listDates(from, to).some(date => {
    if (ctx.logHelpers.toMonthKey(date) !== monthKey) return false;
    return ctx.isWorkday(date);
  });
}

// ───── 일별 ─────
function dailyStrategy(template, ctx) {
  const items = [];
  for (const date of ctx.monthDates) {
    if (!ctx.isWorkday(date)) continue;
    const rec = ctx.periodMaps.daily[`${template.log_id}::${date}`];
    if (rec && isSatisfiedStatus(rec.status)) continue;
    items.push(buildAlertItem(template, date, date, rec));
  }
  return items;
}

// ───── 주별 ─────
function weeklyStrategy(template, ctx) {
  const items = [];
  for (const week of ctx.monthWeeks) {
    if (!hasWorkdayInRange(week.from, week.to, ctx.monthKey, ctx)) continue;
    const rec = ctx.periodMaps.weekly[`${template.log_id}::${week.from}`];
    if (rec && isSatisfiedStatus(rec.status)) continue;
    items.push(buildAlertItem(template, week.from, week.to, rec, {
      rangeLabel: `${week.from} ~ ${week.to}`,
    }));
  }
  return items;
}

// ───── 월별 ─────
function monthlyStrategy(template, ctx) {
  const hasWorkday = ctx.monthDates.some(date => ctx.isWorkday(date));
  if (!hasWorkday) return [];
  const rec = ctx.periodMaps.monthly[`${template.log_id}::${ctx.monthKey}`];
  if (rec && isSatisfiedStatus(rec.status)) return [];
  return [buildAlertItem(template, ctx.monthKey, ctx.monthEnd, rec)];
}

// ───── 분기별 ─────
// 분기의 마지막 월(3·6·9·12)에서만 알림 표시.
function quarterlyStrategy(template, ctx) {
  const quarter = ctx.quarterBounds;
  const monthKey = ctx.monthKey;
  if (monthKey !== ctx.logHelpers.toMonthKey(quarter.to)) return [];

  const monthQuarterDates = ctx.logHelpers.listDates(quarter.from, quarter.to)
    .filter(date => ctx.logHelpers.toMonthKey(date) === monthKey);
  const hasWorkday = monthQuarterDates.some(date => ctx.isWorkday(date));
  if (!hasWorkday) return [];

  const rec = ctx.periodMaps.quarterly[`${template.log_id}::${quarter.from}`];
  if (rec && isSatisfiedStatus(rec.status)) return [];
  return [buildAlertItem(template, quarter.from, quarter.to, rec, {
    rangeLabel: `${quarter.from} ~ ${quarter.to}`,
  })];
}

// ───── 격주별 ─────
function biweeklyStrategy(template, ctx) {
  const items = [];
  for (const period of ctx.biweeklyPeriods) {
    const periodDates = ctx.logHelpers.listDates(period.from, period.to)
      .filter(date => ctx.logHelpers.toMonthKey(date) === ctx.monthKey);
    const hasWorkday = periodDates.some(date => ctx.isWorkday(date));
    if (!hasWorkday) continue;
    const rec = ctx.periodMaps.biweekly[`${template.log_id}::${period.from}`];
    if (rec && isSatisfiedStatus(rec.status)) continue;
    items.push(buildAlertItem(template, period.from, period.to, rec, {
      rangeLabel: `${period.from} ~ ${period.to}`,
    }));
  }
  return items;
}

// ───── 계절별 ─────
// 여름(metaInfo.summerInterval, 기본 weekly) / 겨울(metaInfo.winterInterval, 기본 biweekly)
// 결정된 effectiveInterval에 따라 weekly 또는 biweekly 패턴을 적용.
function seasonalStrategy(template, ctx) {
  const metaInfo = ctx.logHelpers.parseMeta(template.meta_info);
  const summer = ctx.logHelpers.isSummerMonth(ctx.monthKey);
  const effectiveInterval = summer
    ? (metaInfo.summerInterval || 'weekly')
    : (metaInfo.winterInterval || 'biweekly');

  const items = [];
  if (effectiveInterval === 'weekly') {
    for (const week of ctx.monthWeeks) {
      if (!hasWorkdayInRange(week.from, week.to, ctx.monthKey, ctx)) continue;
      const rec = ctx.periodMaps.weekly[`${template.log_id}::${week.from}`];
      if (rec && isSatisfiedStatus(rec.status)) continue;
      items.push(buildAlertItem(template, week.from, week.to, rec, {
        interval: 'seasonal',
        effectiveInterval: 'weekly',
        rangeLabel: `${week.from} ~ ${week.to}`,
      }));
    }
  } else {
    for (const period of ctx.biweeklyPeriods) {
      const periodDates = ctx.logHelpers.listDates(period.from, period.to)
        .filter(date => ctx.logHelpers.toMonthKey(date) === ctx.monthKey);
      const hasWorkday = periodDates.some(date => ctx.isWorkday(date));
      if (!hasWorkday) continue;
      const rec = ctx.periodMaps.biweekly[`${template.log_id}::${period.from}`];
      if (rec && isSatisfiedStatus(rec.status)) continue;
      items.push(buildAlertItem(template, period.from, period.to, rec, {
        interval: 'seasonal',
        effectiveInterval: 'biweekly',
        rangeLabel: `${period.from} ~ ${period.to}`,
      }));
    }
  }
  return items;
}

const STRATEGIES = {
  daily: dailyStrategy,
  weekly: weeklyStrategy,
  monthly: monthlyStrategy,
  quarterly: quarterlyStrategy,
  biweekly: biweeklyStrategy,
  seasonal: seasonalStrategy,
};

// 디스패처 — template.interval 키로 전략 선택, 없으면 빈 배열.
function buildAlertItems(template, ctx) {
  const strategy = STRATEGIES[template.interval];
  return strategy ? strategy(template, ctx) : [];
}

module.exports = {
  buildAlertItems,
  // 전략 개별 — 단위 테스트에서 직접 호출
  dailyStrategy,
  weeklyStrategy,
  monthlyStrategy,
  quarterlyStrategy,
  biweeklyStrategy,
  seasonalStrategy,
  // 상태 헬퍼 — 호출자가 별도 사용 (factory-calendar.js의 export 호환을 위해)
  isMissingStatus,
  isSatisfiedStatus,
};
