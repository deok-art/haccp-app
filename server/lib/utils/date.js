// server/lib/utils/date.js
// 순수 날짜 유틸 — DB·세션·외부 의존 없음. 단위 테스트로 경계값 검증한다.
//
// 모든 날짜 입력은 'YYYY-MM-DD' 문자열 기준. 내부 계산은 UTC로 수행해
// 호스트 타임존에 의존하지 않는다.

function createUtcDate(dateStr) {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

// 월요일 시작 ~ 일요일 종료. 일요일 입력은 같은 주의 월~일을 반환한다.
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

// 분기(3개월) 시작일 ~ 종료일.
function getQuarterBounds(dateStr) {
  const [year, month] = String(dateStr || '').slice(0, 7).split('-').map(Number);
  const quarterStartMonth = Math.floor(((month || 1) - 1) / 3) * 3;
  const start = new Date(Date.UTC(year || 1970, quarterStartMonth, 1));
  const end = new Date(Date.UTC(year || 1970, quarterStartMonth + 3, 0));
  return {
    from: formatUtcDate(start),
    to: formatUtcDate(end),
  };
}

module.exports = {
  createUtcDate,
  formatUtcDate,
  getWeekBounds,
  getQuarterBounds,
};
