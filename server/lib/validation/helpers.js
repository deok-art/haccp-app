// server/lib/validation/helpers.js
// 폼 데이터 검증에서 공통으로 쓰이는 순수 헬퍼들. DB·세션 의존 없음.

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

// 측정값이 기준 범위(criteria.min ~ criteria.max)를 벗어났는지.
// '-' 입력은 범위 밖으로 보지 않는다 (해당없음 처리).
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

// 'YYYY-MM-DD' 두 날짜의 차이(일). 잘못된 입력은 null.
function dateDiffDays(fromDate, toDate) {
  const [fromYear, fromMonth, fromDay] = String(fromDate || '').split('-').map(Number);
  const [toYear, toMonth, toDay] = String(toDate || '').split('-').map(Number);
  const from = new Date(Date.UTC(fromYear || 1970, (fromMonth || 1) - 1, fromDay || 1));
  const to = new Date(Date.UTC(toYear || 1970, (toMonth || 1) - 1, toDay || 1));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

module.exports = {
  normalizeSubmittedData,
  isBlankRequiredValue,
  isValidInspectionResult,
  isOutOfCriteria,
  dateDiffDays,
};
