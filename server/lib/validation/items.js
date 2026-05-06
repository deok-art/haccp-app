// server/lib/validation/items.js
// 항목 타입별 validator. 각 함수는 에러 메시지 문자열 또는 '' (정상)을 반환한다.
// 디스패처가 item.type을 보고 해당 validator로 분기한다.

const {
  isBlankRequiredValue,
  isValidInspectionResult,
  isOutOfCriteria,
} = require('./helpers');

// 작업자 위생 점검표 — 행(작업자)·열(점검 항목) 매트릭스
function validateWorkerHygieneItem(item, data) {
  const label = item.label || item.key;
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
  return '';
}

// 숫자/온도 측정값 — 빈값·숫자형식·결과·기준범위 검증
function validateNumericTempItem(item, entry) {
  const label = item.label || item.key;
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
  return '';
}

// 텍스트/날짜 — required인 경우 빈값 거부
function validateTextDateItem(item, entry) {
  const label = item.label || item.key;
  if (item.required && isBlankRequiredValue(entry.value)) {
    return `[${label}] 값을 입력해주세요.`;
  }
  return '';
}

// 기본(check 등) — result만 검사
function validateDefaultItem(item, entry) {
  const label = item.label || item.key;
  if (!isValidInspectionResult(entry.result)) {
    return `[${label}] 점검 결과를 입력해주세요.`;
  }
  return '';
}

// 부적합(ng) 시 사유·개선조치 필수 — 모든 타입 공통
function validateNgRequirements(item, entry) {
  if (entry.result !== 'ng') return '';
  const label = item.label || item.key;
  if (isBlankRequiredValue(entry.defectText)) {
    return `[${label}] 부적합 내용을 입력해주세요.`;
  }
  if (isBlankRequiredValue(entry.actionText)) {
    return `[${label}] 개선조치 내용을 입력해주세요.`;
  }
  return '';
}

// 단일 항목 디스패처 — 타입을 보고 해당 validator 호출
function validateItem(item, data) {
  const items = data.items && typeof data.items === 'object' ? data.items : {};
  const entry = items[item.key] || {};

  if (item.type === 'worker_hygiene_table' || Array.isArray(item.check_columns)) {
    const err = validateWorkerHygieneItem(item, data);
    if (err) return err;
    // worker_hygiene_table은 entry 기반 ng 검사를 하지 않음
    return '';
  }

  let err = '';
  if (item.type === 'numeric' || item.type === 'temp') {
    err = validateNumericTempItem(item, entry);
  } else if (item.type === 'text' || item.type === 'date') {
    err = validateTextDateItem(item, entry);
  } else {
    err = validateDefaultItem(item, entry);
  }
  if (err) return err;

  return validateNgRequirements(item, entry);
}

// 템플릿 항목 배열 전체 검증 — group_header 처리 + 각 항목 디스패치
function validateTemplateItems(templateItems, data) {
  let includeCurrentGroup = true;
  for (const item of templateItems) {
    if (item.type === 'group_header') {
      const processTypes = item.process_types || item.processTypes;
      includeCurrentGroup = !data.processType
        || !Array.isArray(processTypes)
        || !processTypes.length
        || processTypes.includes(data.processType);
      continue;
    }
    if (!includeCurrentGroup) continue;
    const err = validateItem(item, data);
    if (err) return err;
  }
  return '';
}

// 템플릿 items가 없는 레거시 양식 — 단순 폴백 검증
function validateLegacyData(data) {
  const items = data.items && typeof data.items === 'object' ? data.items : {};
  if (Object.prototype.hasOwnProperty.call(data, 'temperature')) {
    if (isBlankRequiredValue(data.temperature)) return '온도를 입력해주세요.';
    if (String(data.temperature).trim() !== '-' && !Number.isFinite(Number(data.temperature))) {
      return '온도는 숫자로 입력해주세요.';
    }
  }
  for (const entry of Object.values(items)) {
    if (entry && entry.result === 'ng') {
      if (isBlankRequiredValue(entry.defectText)) return '부적합 내용을 입력해주세요.';
      if (isBlankRequiredValue(entry.actionText)) return '개선조치 내용을 입력해주세요.';
    }
  }
  return '';
}

// si0302 — 필터 설치/교체일자 특수 검증
function validateSi0302FilterRows(data) {
  const filterRows = Array.isArray(data.filterRows) ? data.filterRows : [];
  if (!filterRows.length) return '필터 설치일자와 교체(예정)일자를 입력해주세요.';
  for (const row of filterRows) {
    if (isBlankRequiredValue(row.installDate) || isBlankRequiredValue(row.replacementDate)) {
      return '필터 설치일자와 교체(예정)일자를 입력해주세요.';
    }
  }
  return '';
}

module.exports = {
  validateItem,
  validateTemplateItems,
  validateLegacyData,
  validateSi0302FilterRows,
  // 개별 validator는 단위 테스트에서 직접 호출하기 위해 노출
  validateWorkerHygieneItem,
  validateNumericTempItem,
  validateTextDateItem,
  validateDefaultItem,
  validateNgRequirements,
};
