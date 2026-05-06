// server/lib/utils/user.js
// 사용자 객체에서 파생 표시값을 만든다. SQL 의존 없음.

const { safeJson } = require('../../db');

// 직책 문자열을 사용자 객체에서 파생한다.
//  1) factory_deputies에 위임이 등록돼 있으면 'HACCP팀장 대행'
//  2) factory_roles 중 어느 공장이든 역할 3 이상이면 'HACCP팀장'
//  3) 그 외에는 user.rank 그대로 (없으면 빈 문자열)
function deriveTitle(user) {
  if (!user) return '';
  const deps = safeJson(user.factory_deputies, {});
  for (const fid of Object.keys(deps)) {
    if (deps[fid] !== null && deps[fid] !== undefined) return 'HACCP팀장 대행';
  }
  const roles = safeJson(user.factory_roles, {});
  for (const fid of Object.keys(roles)) {
    if (roles[fid] >= 3) return 'HACCP팀장';
  }
  return user.rank || '';
}

module.exports = { deriveTitle };
