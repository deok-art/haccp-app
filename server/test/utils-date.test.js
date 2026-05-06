// 단위 테스트 — server/lib/utils/date.js (DB 의존 없음, 순수 함수)
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createUtcDate,
  formatUtcDate,
  getWeekBounds,
  getQuarterBounds,
} = require('../lib/utils/date');

test('createUtcDate / formatUtcDate 왕복 변환', () => {
  assert.equal(formatUtcDate(createUtcDate('2026-05-06')), '2026-05-06');
  assert.equal(formatUtcDate(createUtcDate('2024-01-01')), '2024-01-01');
  assert.equal(formatUtcDate(createUtcDate('2024-12-31')), '2024-12-31');
});

test('getWeekBounds: 월요일 입력은 같은 주 월~일을 반환', () => {
  // 2026-05-04 는 월요일
  assert.deepEqual(getWeekBounds('2026-05-04'), { from: '2026-05-04', to: '2026-05-10' });
});

test('getWeekBounds: 일요일 입력은 직전 월요일이 시작', () => {
  // 2026-05-10 일요일 → 같은 주의 2026-05-04 월요일이 시작
  assert.deepEqual(getWeekBounds('2026-05-10'), { from: '2026-05-04', to: '2026-05-10' });
});

test('getWeekBounds: 주 중간(수요일) 입력', () => {
  // 2026-05-06 수요일
  assert.deepEqual(getWeekBounds('2026-05-06'), { from: '2026-05-04', to: '2026-05-10' });
});

test('getWeekBounds: 월 경계 — 1월 1일이 목요일인 해', () => {
  // 2026-01-01 은 목요일 → 같은 주 시작은 2025-12-29 (월)
  assert.deepEqual(getWeekBounds('2026-01-01'), { from: '2025-12-29', to: '2026-01-04' });
});

test('getWeekBounds: 연말 — 12월 31일이 화요일인 해', () => {
  // 2024-12-31 은 화요일 → 같은 주 시작은 2024-12-30 (월)
  assert.deepEqual(getWeekBounds('2024-12-31'), { from: '2024-12-30', to: '2025-01-05' });
});

test('getQuarterBounds: 1분기 (1월 입력)', () => {
  assert.deepEqual(getQuarterBounds('2026-01-15'), { from: '2026-01-01', to: '2026-03-31' });
});

test('getQuarterBounds: 1분기 (3월 입력)', () => {
  assert.deepEqual(getQuarterBounds('2026-03-31'), { from: '2026-01-01', to: '2026-03-31' });
});

test('getQuarterBounds: 2분기 경계 (4월 1일)', () => {
  assert.deepEqual(getQuarterBounds('2026-04-01'), { from: '2026-04-01', to: '2026-06-30' });
});

test('getQuarterBounds: 3분기 (8월)', () => {
  assert.deepEqual(getQuarterBounds('2026-08-15'), { from: '2026-07-01', to: '2026-09-30' });
});

test('getQuarterBounds: 4분기 (12월)', () => {
  assert.deepEqual(getQuarterBounds('2026-12-31'), { from: '2026-10-01', to: '2026-12-31' });
});

test('getQuarterBounds: 윤년 1분기 (2024년)', () => {
  assert.deepEqual(getQuarterBounds('2024-02-29'), { from: '2024-01-01', to: '2024-03-31' });
});
