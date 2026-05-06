// 단위 테스트 — server/lib/validation/helpers.js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeSubmittedData,
  isBlankRequiredValue,
  isValidInspectionResult,
  isOutOfCriteria,
  dateDiffDays,
} = require('../lib/validation/helpers');

test('normalizeSubmittedData: JSON 문자열 파싱', () => {
  assert.deepEqual(normalizeSubmittedData('{"a":1}'), { a: 1 });
});

test('normalizeSubmittedData: 객체는 그대로 반환', () => {
  const obj = { x: 'y' };
  assert.equal(normalizeSubmittedData(obj), obj);
});

test('normalizeSubmittedData: 잘못된 JSON은 null', () => {
  assert.equal(normalizeSubmittedData('{not-json'), null);
});

test('normalizeSubmittedData: null/undefined/배열 등은 null', () => {
  assert.equal(normalizeSubmittedData(null), null);
  assert.equal(normalizeSubmittedData(undefined), null);
  assert.equal(normalizeSubmittedData(123), null);
});

test('isBlankRequiredValue: 빈 문자열·null·undefined·공백만은 모두 blank', () => {
  assert.equal(isBlankRequiredValue(''), true);
  assert.equal(isBlankRequiredValue('   '), true);
  assert.equal(isBlankRequiredValue(null), true);
  assert.equal(isBlankRequiredValue(undefined), true);
});

test('isBlankRequiredValue: 0과 비공백 문자열은 blank 아님', () => {
  assert.equal(isBlankRequiredValue(0), false);
  assert.equal(isBlankRequiredValue('값'), false);
  assert.equal(isBlankRequiredValue('-'), false);
});

test('isValidInspectionResult: ok/ng/na만 유효', () => {
  assert.equal(isValidInspectionResult('ok'), true);
  assert.equal(isValidInspectionResult('ng'), true);
  assert.equal(isValidInspectionResult('na'), true);
  assert.equal(isValidInspectionResult(''), false);
  assert.equal(isValidInspectionResult('OK'), false);
  assert.equal(isValidInspectionResult(undefined), false);
});

test('isOutOfCriteria: 범위 내는 false', () => {
  assert.equal(isOutOfCriteria(50, { min: 0, max: 100 }), false);
  assert.equal(isOutOfCriteria(0, { min: 0, max: 100 }), false);
  assert.equal(isOutOfCriteria(100, { min: 0, max: 100 }), false);
});

test('isOutOfCriteria: 범위 밖은 true', () => {
  assert.equal(isOutOfCriteria(-1, { min: 0, max: 100 }), true);
  assert.equal(isOutOfCriteria(101, { min: 0, max: 100 }), true);
});

test("isOutOfCriteria: '-' 입력은 항상 false (해당없음)", () => {
  assert.equal(isOutOfCriteria('-', { min: 0, max: 100 }), false);
});

test('isOutOfCriteria: 숫자가 아닌 값은 false', () => {
  assert.equal(isOutOfCriteria('abc', { min: 0, max: 100 }), false);
});

test('isOutOfCriteria: min/max 한쪽만 있어도 동작', () => {
  assert.equal(isOutOfCriteria(50, { min: 60 }), true);
  assert.equal(isOutOfCriteria(50, { max: 40 }), true);
  assert.equal(isOutOfCriteria(50, {}), false);
});

test('dateDiffDays: 같은 날 0', () => {
  assert.equal(dateDiffDays('2026-05-06', '2026-05-06'), 0);
});

test('dateDiffDays: 정상 차이', () => {
  assert.equal(dateDiffDays('2026-05-01', '2026-05-06'), 5);
});

test('dateDiffDays: 음수 (toDate가 이전)', () => {
  assert.equal(dateDiffDays('2026-05-06', '2026-05-01'), -5);
});

test('dateDiffDays: 빈 입력은 1970-01-01 기준으로 폴백', () => {
  // 기존 동작 유지: 잘못된 입력은 epoch로 폴백 (null이 아님)
  assert.equal(dateDiffDays('', ''), 0);
});

test('dateDiffDays: 월 경계 넘는 차이', () => {
  assert.equal(dateDiffDays('2026-04-30', '2026-05-02'), 2);
});
