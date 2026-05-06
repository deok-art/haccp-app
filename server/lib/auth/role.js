// server/lib/auth/role.js
// 사용자 역할 검사의 정본. 모든 라우트와 template-access.js가 이걸 import한다.
//
// 역할 의미
//   ROLE.NONE    (0)  비할당 — 해당 공장에 권한 없음
//   ROLE.WORKER  (1)  작업자 — 작성·조회 가능
//   ROLE.VIEWER  (2)  조회 전용
//   ROLE.MANAGER (3)  관리자 (HACCP팀장) — 검토·승인 가능
//   ROLE.MASTER  (99) 마스터 — 모든 공장의 모든 권한
//
// 마스터는 어떤 factoryId에서도 ROLE.MASTER(99)를 반환한다.
// 일반 사용자는 user.factoryRoles[factoryId] 정수값 또는 0을 반환한다.

const ROLE = Object.freeze({
  NONE: 0,
  WORKER: 1,
  VIEWER: 2,
  MANAGER: 3,
  MASTER: 99,
});

function getCallerRole(user, factoryId) {
  if (!user || !factoryId) return ROLE.NONE;
  if (user.isMaster) return ROLE.MASTER;
  return parseInt((user.factoryRoles || {})[factoryId] || 0, 10);
}

// 권한 부족 시 res에 403 응답을 보내고 false 반환. 권한 충분 시 true 반환.
// 호출자는 false 시 곧바로 return한다.
function requireRole(caller, factoryId, minRole, res, message) {
  if (getCallerRole(caller, factoryId) >= minRole) return true;
  res.status(403).json({
    success: false,
    error: message || '권한이 없습니다.',
  });
  return false;
}

module.exports = { ROLE, getCallerRole, requireRole };
