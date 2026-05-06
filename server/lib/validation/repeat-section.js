// server/lib/validation/repeat-section.js
// 반복 섹션(차량 등) 데이터 검증. 순수 함수.

const { isBlankRequiredValue } = require('./helpers');

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

module.exports = { validateRepeatSectionData };
