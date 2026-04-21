const express = require('express');
const crypto  = require('crypto');
const { db }  = require('../db');
const { requireAuth } = require('../middleware/session');

const router = express.Router();

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function deriveTitle(user) {
  if (!user) return '';
  const deps = JSON.parse(user.factory_deputies || '{}');
  for (const fid of Object.keys(deps)) {
    if (deps[fid] !== null && deps[fid] !== undefined) return 'HACCP팀장 대행';
  }
  const roles = JSON.parse(user.factory_roles || '{}');
  for (const fid of Object.keys(roles)) {
    if (roles[fid] >= 3) return 'HACCP팀장';
  }
  return user.rank || '';
}

// POST /api/login
router.post('/login', (req, res) => {
  const [id, pw] = req.body;
  if (!id || pw === undefined) return res.json({ success: false, message: '아이디와 비밀번호를 입력하세요.' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return res.json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });

  // 비밀번호 미설정 + '0000' 입력 → 최초 변경 안내
  if (!user.password_hash && pw === '0000') {
    return res.json({ success: true, mustChangePw: true, userInfo: { id: user.id, name: user.name, signature: user.signature || '' } });
  }

  if (user.password_hash !== sha256(pw)) {
    return res.json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }

  const factoryRoles = JSON.parse(user.factory_roles || '{}');
  const factoryDeputies = JSON.parse(user.factory_deputies || '{}');

  const userInfo = {
    id: user.id,
    name: user.name,
    factoryRoles,
    factoryDeputies,
    isMaster: user.is_master === 1,
    signature: user.signature || '',
    rank: user.rank || '',
    title: deriveTitle(user),
  };

  req.session.user = userInfo;
  res.json({ success: true, mustChangePw: false, userInfo });
});

// POST /api/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});

// POST /api/updatePassword
router.post('/updatePassword', requireAuth, (req, res) => {
  const [id, plainPw] = req.body;
  if (!id || !plainPw) return res.json({ success: false, message: '입력값이 올바르지 않습니다.' });

  const caller = req.session.user;
  if (caller.id !== id && !caller.isMaster) {
    return res.json({ success: false, message: '권한이 없습니다.' });
  }

  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(sha256(plainPw), id);
  res.json({ success: true });
});

// POST /api/saveSignature
router.post('/saveSignature', requireAuth, (req, res) => {
  const [id, sigBase64] = req.body;
  if (!id || !sigBase64) return res.json({ success: false, message: '입력값이 올바르지 않습니다.' });

  const caller = req.session.user;
  if (caller.id !== id && !caller.isMaster) {
    return res.json({ success: false, message: '권한이 없습니다.' });
  }

  db.prepare('UPDATE users SET signature = ? WHERE id = ?').run(sigBase64, id);

  // 세션 서명도 갱신
  if (caller.id === id) req.session.user.signature = sigBase64;

  res.json({ success: true });
});

module.exports = router;
