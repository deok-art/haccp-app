// 단위 테스트 — server/lib/utils/user.js (deriveTitle)
//
// safeJson을 통해 동작하므로 db.js를 import하지만 SQL은 호출하지 않는다.
// 입력은 모두 user 객체 한 개.
const test = require('node:test');
const assert = require('node:assert/strict');
const { deriveTitle } = require('../lib/utils/user');

test('deriveTitle: null/undefined 사용자는 빈 문자열', () => {
  assert.equal(deriveTitle(null), '');
  assert.equal(deriveTitle(undefined), '');
});

test('deriveTitle: 위임자가 등록돼 있으면 "HACCP팀장 대행" (공백 포함)', () => {
  const user = {
    factory_deputies: JSON.stringify({ pb1: 'someone' }),
    factory_roles: '{}',
    rank: '주임',
  };
  assert.equal(deriveTitle(user), 'HACCP팀장 대행');
});

test('deriveTitle: 역할 3 이상이면 "HACCP팀장"', () => {
  const user = {
    factory_deputies: '{}',
    factory_roles: JSON.stringify({ pb1: 3 }),
    rank: '주임',
  };
  assert.equal(deriveTitle(user), 'HACCP팀장');
});

test('deriveTitle: 위임자와 역할 둘 다 있으면 위임 우선', () => {
  const user = {
    factory_deputies: JSON.stringify({ pb2: 'deputy-id' }),
    factory_roles: JSON.stringify({ pb1: 3 }),
    rank: '주임',
  };
  assert.equal(deriveTitle(user), 'HACCP팀장 대행');
});

test('deriveTitle: 위임 값이 null/undefined면 무시', () => {
  const user = {
    factory_deputies: JSON.stringify({ pb1: null, pb2: undefined }),
    factory_roles: JSON.stringify({ pb1: 2 }),
    rank: '대리',
  };
  assert.equal(deriveTitle(user), '대리');
});

test('deriveTitle: 역할 2 이하면 rank 반환', () => {
  const user = {
    factory_deputies: '{}',
    factory_roles: JSON.stringify({ pb1: 2 }),
    rank: '대리',
  };
  assert.equal(deriveTitle(user), '대리');
});

test('deriveTitle: rank 없으면 빈 문자열', () => {
  const user = {
    factory_deputies: '{}',
    factory_roles: JSON.stringify({ pb1: 1 }),
  };
  assert.equal(deriveTitle(user), '');
});

test('deriveTitle: 잘못된 JSON은 fallback으로 빈 객체 처리 (safeJson 동작)', () => {
  const user = {
    factory_deputies: '{not-json',
    factory_roles: '{not-json',
    rank: '사원',
  };
  assert.equal(deriveTitle(user), '사원');
});
