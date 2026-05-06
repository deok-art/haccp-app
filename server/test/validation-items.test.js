// 단위 테스트 — server/lib/validation/items.js (타입별 validator + 디스패처)
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateItem,
  validateTemplateItems,
  validateLegacyData,
  validateSi0302FilterRows,
  validateNumericTempItem,
  validateTextDateItem,
  validateDefaultItem,
  validateNgRequirements,
} = require('../lib/validation/items');

// ───── validateNumericTempItem ─────
test('validateNumericTempItem: 빈 측정값 거부', () => {
  const err = validateNumericTempItem({ key: 'k', label: '온도', type: 'temp' }, {});
  assert.match(err, /측정값을 입력/);
});

test('validateNumericTempItem: 숫자 아닌 값 거부', () => {
  const err = validateNumericTempItem({ key: 'k', label: '온도' }, { tempValue: 'abc', result: 'ok' });
  assert.match(err, /숫자로 입력/);
});

test("validateNumericTempItem: '-' 입력은 result='na'여야 함", () => {
  const err = validateNumericTempItem({ key: 'k', label: '온도' }, { tempValue: '-', result: 'ok' });
  assert.match(err, /해당없음/);
  const ok = validateNumericTempItem({ key: 'k', label: '온도' }, { tempValue: '-', result: 'na' });
  assert.equal(ok, '');
});

test('validateNumericTempItem: 정상 측정값과 결과는 통과', () => {
  const err = validateNumericTempItem(
    { key: 'k', label: '온도', criteria: { min: 0, max: 10 } },
    { tempValue: 5, result: 'ok' }
  );
  assert.equal(err, '');
});

test('validateNumericTempItem: 기준 벗어났는데 ok면 부적합으로 작성하라고 거부', () => {
  const err = validateNumericTempItem(
    { key: 'k', label: '온도', criteria: { min: 0, max: 10 } },
    { tempValue: 99, result: 'ok' }
  );
  assert.match(err, /부적합으로 작성/);
});

test('validateNumericTempItem: 기준 벗어나도 ng면 통과 (ng 사유는 별도 검증)', () => {
  const err = validateNumericTempItem(
    { key: 'k', label: '온도', criteria: { min: 0, max: 10 } },
    { tempValue: 99, result: 'ng' }
  );
  assert.equal(err, '');
});

// ───── validateTextDateItem ─────
test('validateTextDateItem: required 항목 빈값 거부', () => {
  const err = validateTextDateItem({ key: 'k', label: '비고', required: true }, { value: '' });
  assert.match(err, /값을 입력/);
});

test('validateTextDateItem: required 아니면 빈값 통과', () => {
  const err = validateTextDateItem({ key: 'k', label: '비고' }, { value: '' });
  assert.equal(err, '');
});

// ───── validateDefaultItem ─────
test('validateDefaultItem: result 없으면 거부', () => {
  const err = validateDefaultItem({ key: 'k', label: '점검' }, {});
  assert.match(err, /점검 결과/);
});

test('validateDefaultItem: 유효 result는 통과', () => {
  assert.equal(validateDefaultItem({ key: 'k', label: '점검' }, { result: 'ok' }), '');
  assert.equal(validateDefaultItem({ key: 'k', label: '점검' }, { result: 'ng' }), '');
  assert.equal(validateDefaultItem({ key: 'k', label: '점검' }, { result: 'na' }), '');
});

// ───── validateNgRequirements ─────
test('validateNgRequirements: ng일 때 사유·개선조치 필수', () => {
  const err1 = validateNgRequirements(
    { key: 'k', label: '점검' },
    { result: 'ng', defectText: '', actionText: '조치' }
  );
  assert.match(err1, /부적합 내용/);

  const err2 = validateNgRequirements(
    { key: 'k', label: '점검' },
    { result: 'ng', defectText: '사유', actionText: '' }
  );
  assert.match(err2, /개선조치/);
});

test('validateNgRequirements: ng가 아니면 항상 통과', () => {
  assert.equal(
    validateNgRequirements({ key: 'k', label: '점검' }, { result: 'ok' }),
    ''
  );
});

test('validateNgRequirements: ng + 사유·조치 모두 있으면 통과', () => {
  assert.equal(
    validateNgRequirements(
      { key: 'k', label: '점검' },
      { result: 'ng', defectText: '사유', actionText: '조치' }
    ),
    ''
  );
});

// ───── validateItem (디스패처) ─────
test('validateItem: numeric 타입을 적절히 라우팅', () => {
  const err = validateItem(
    { key: 'k', label: '온도', type: 'numeric' },
    { items: { k: {} } }
  );
  assert.match(err, /측정값을 입력/);
});

test('validateItem: text 타입을 적절히 라우팅', () => {
  const err = validateItem(
    { key: 'k', label: '비고', type: 'text', required: true },
    { items: { k: { value: '' } } }
  );
  assert.match(err, /값을 입력/);
});

test('validateItem: ng일 때 사유·조치 필수 (디스패처가 ng 검사도 적용)', () => {
  const err = validateItem(
    { key: 'k', label: '점검', type: 'check' },
    { items: { k: { result: 'ng', defectText: '', actionText: '조치' } } }
  );
  assert.match(err, /부적합 내용/);
});

// ───── validateTemplateItems (group_header 처리) ─────
test('validateTemplateItems: group_header가 processType과 안 맞으면 그룹 스킵', () => {
  const items = [
    { type: 'group_header', processTypes: ['A'] },
    { key: 'k1', label: 'A전용', type: 'check' },
  ];
  // processType이 'B'면 그룹 스킵 → 검증 통과
  const err = validateTemplateItems(items, { processType: 'B', items: {} });
  assert.equal(err, '');
});

test('validateTemplateItems: processType 일치하면 그룹 검증 진행', () => {
  const items = [
    { type: 'group_header', processTypes: ['A'] },
    { key: 'k1', label: 'A전용', type: 'check' },
  ];
  const err = validateTemplateItems(items, { processType: 'A', items: {} });
  assert.match(err, /점검 결과/);
});

// ───── validateLegacyData ─────
test('validateLegacyData: 빈 temperature 거부', () => {
  const err = validateLegacyData({ temperature: '', items: {} });
  assert.match(err, /온도를 입력/);
});

test('validateLegacyData: 숫자 아닌 temperature 거부', () => {
  const err = validateLegacyData({ temperature: 'abc', items: {} });
  assert.match(err, /숫자로 입력/);
});

test("validateLegacyData: temperature='-'는 통과 (해당없음)", () => {
  const err = validateLegacyData({ temperature: '-', items: {} });
  assert.equal(err, '');
});

test('validateLegacyData: ng entry는 사유·조치 필수', () => {
  const err = validateLegacyData({ items: { x: { result: 'ng', defectText: '', actionText: 'a' } } });
  assert.match(err, /부적합 내용/);
});

// ───── validateSi0302FilterRows ─────
test('validateSi0302FilterRows: 행이 없으면 거부', () => {
  const err = validateSi0302FilterRows({ filterRows: [] });
  assert.match(err, /필터 설치/);
});

test('validateSi0302FilterRows: 빈 날짜 거부', () => {
  const err = validateSi0302FilterRows({
    filterRows: [{ installDate: '2026-01-01', replacementDate: '' }],
  });
  assert.match(err, /필터 설치/);
});

test('validateSi0302FilterRows: 정상 입력 통과', () => {
  const err = validateSi0302FilterRows({
    filterRows: [{ installDate: '2026-01-01', replacementDate: '2026-04-01' }],
  });
  assert.equal(err, '');
});
