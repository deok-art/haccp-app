// 단위 테스트 — server/lib/auth/role.js (DB 의존 없음, 순수 함수)
const test = require('node:test');
const assert = require('node:assert/strict');
const { ROLE, getCallerRole, requireRole } = require('../lib/auth/role');

test('ROLE 상수: 의미 있는 값으로 동결', () => {
  assert.equal(ROLE.NONE, 0);
  assert.equal(ROLE.WORKER, 1);
  assert.equal(ROLE.VIEWER, 2);
  assert.equal(ROLE.MANAGER, 3);
  assert.equal(ROLE.MASTER, 99);
  assert.equal(Object.isFrozen(ROLE), true);
});

test('getCallerRole: null 사용자는 NONE', () => {
  assert.equal(getCallerRole(null, 'pb1'), ROLE.NONE);
  assert.equal(getCallerRole(undefined, 'pb1'), ROLE.NONE);
});

test('getCallerRole: factoryId 없으면 NONE', () => {
  assert.equal(getCallerRole({ isMaster: true }, null), ROLE.NONE);
  assert.equal(getCallerRole({ factoryRoles: { pb1: 3 } }, ''), ROLE.NONE);
});

test('getCallerRole: 마스터는 어떤 factoryId에서도 MASTER(99)', () => {
  const master = { isMaster: true, factoryRoles: {} };
  assert.equal(getCallerRole(master, 'pb1'), ROLE.MASTER);
  assert.equal(getCallerRole(master, 'pb2'), ROLE.MASTER);
  assert.equal(getCallerRole(master, 'unknown-factory'), ROLE.MASTER);
});

test('getCallerRole: factoryRoles에서 정수 반환', () => {
  const user = { isMaster: false, factoryRoles: { pb1: 3, pb2: 1 } };
  assert.equal(getCallerRole(user, 'pb1'), 3);
  assert.equal(getCallerRole(user, 'pb2'), 1);
});

test('getCallerRole: 미할당 공장은 NONE', () => {
  const user = { isMaster: false, factoryRoles: { pb1: 3 } };
  assert.equal(getCallerRole(user, 'pb2'), ROLE.NONE);
});

test('getCallerRole: 문자열 역할도 정수로 파싱 (parseInt)', () => {
  const user = { isMaster: false, factoryRoles: { pb1: '3' } };
  assert.equal(getCallerRole(user, 'pb1'), 3);
});

test('getCallerRole: factoryRoles 자체가 없어도 NONE', () => {
  assert.equal(getCallerRole({ isMaster: false }, 'pb1'), ROLE.NONE);
});

test('requireRole: 권한 충분 시 true 반환, 응답 없음', () => {
  const user = { isMaster: false, factoryRoles: { pb1: 3 } };
  let called = false;
  const res = {
    status() { called = true; return this; },
    json() { called = true; return this; },
  };
  assert.equal(requireRole(user, 'pb1', ROLE.MANAGER, res), true);
  assert.equal(called, false);
});

test('requireRole: 권한 부족 시 403 + false 반환', () => {
  const user = { isMaster: false, factoryRoles: { pb1: 1 } };
  const captured = {};
  const res = {
    status(code) { captured.code = code; return this; },
    json(body) { captured.body = body; return this; },
  };
  assert.equal(requireRole(user, 'pb1', ROLE.MANAGER, res), false);
  assert.equal(captured.code, 403);
  assert.equal(captured.body.success, false);
  assert.match(captured.body.error, /권한/);
});

test('requireRole: 마스터는 항상 허용', () => {
  const master = { isMaster: true };
  let called = false;
  const res = {
    status() { called = true; return this; },
    json() { called = true; return this; },
  };
  assert.equal(requireRole(master, 'pb1', ROLE.MANAGER, res), true);
  assert.equal(requireRole(master, 'pb2', ROLE.MASTER, res), true);
  assert.equal(called, false);
});

test('requireRole: 사용자 정의 메시지 사용', () => {
  const user = { isMaster: false, factoryRoles: {} };
  const captured = {};
  const res = {
    status() { return this; },
    json(body) { captured.body = body; return this; },
  };
  requireRole(user, 'pb1', ROLE.MANAGER, res, '관리자만 가능합니다');
  assert.equal(captured.body.error, '관리자만 가능합니다');
});
