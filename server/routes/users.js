const express = require('express');
const { db, safeJson, now, today } = require('../db');
const { getDatabasePath, isExplicitTestMode, isTestDbPath } = require('../test-safety');

const router = express.Router();

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

function formatUser(u) {
  return {
    id:              u.id,
    name:            u.name,
    factoryRoles:    safeJson(u.factory_roles, {}),
    factoryDeputies: safeJson(u.factory_deputies, {}),
    isMaster:        u.is_master === 1,
    signature:       u.signature || '',
    rank:            u.rank || '',
    title:           deriveTitle(u),
  };
}

function getFactories() {
  return db.prepare('SELECT factory_id as id, name FROM factories ORDER BY factory_id').all();
}

// POST /api/getUserList
router.post('/getUserList', (req, res) => {
  const [requesterId] = req.body;
  const caller = req.session.user;
  const factories = getFactories();

  let users;
  if (caller.isMaster) {
    users = db.prepare('SELECT * FROM users ORDER BY name').all();
  } else {
    // role-3 이상이면 자기 공장 사용자만
    const myFactories = Object.entries(caller.factoryRoles || {})
      .filter(([, r]) => r >= 3).map(([fid]) => fid);

    if (!myFactories.length) {
      return res.json({
        success: true,
        users: [formatUser(db.prepare('SELECT * FROM users WHERE id = ?').get(caller.id))],
        factories,
        requesterIsMaster: !!caller.isMaster,
      });
    }

    const all = db.prepare('SELECT * FROM users').all();
    users = all.filter(u => {
      const roles = safeJson(u.factory_roles, {});
      return myFactories.some(fid => roles[fid] !== undefined);
    });
  }

  res.json({
    success: true,
    users: users.map(formatUser),
    factories,
    requesterIsMaster: !!caller.isMaster,
  });
});

// POST /api/updateUserInfo
router.post('/updateUserInfo', (req, res) => {
  const [requesterId, targetId, updates] = req.body;
  const caller = req.session.user;

  if (!caller.isMaster) {
    const myFactories = Object.entries(caller.factoryRoles || {})
      .filter(([, r]) => r >= 3).map(([fid]) => fid);
    if (!myFactories.length) return res.json({ success: false, message: '권한이 없습니다.' });
  }

  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!target) return res.json({ success: false, message: '사용자를 찾을 수 없습니다.' });

  const factoryRoles    = safeJson(target.factory_roles, {});
  const factoryDeputies = safeJson(target.factory_deputies, {});

  if (updates.factoryRoles    !== undefined) Object.assign(factoryRoles,    updates.factoryRoles);
  if (updates.factoryDeputies !== undefined) Object.assign(factoryDeputies, updates.factoryDeputies);

  const newName   = updates.name  !== undefined ? updates.name  : target.name;
  const newRank   = updates.rank  !== undefined ? updates.rank  : target.rank;
  const newMaster = updates.isMaster !== undefined ? (updates.isMaster ? 1 : 0) : target.is_master;

  db.prepare(
    `UPDATE users SET name=?, factory_roles=?, factory_deputies=?, rank=?, is_master=? WHERE id=?`
  ).run(newName, JSON.stringify(factoryRoles), JSON.stringify(factoryDeputies), newRank, newMaster, targetId);

  res.json({ success: true });
});

// POST /api/getDeputiesByFactories
router.post('/getDeputiesByFactories', (req, res) => {
  const [factoryIds] = req.body;
  if (!Array.isArray(factoryIds) || !factoryIds.length) {
    return res.json({ success: true, deputies: [] });
  }

  const placeholders = factoryIds.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT d.*, u.name, u.factory_roles, u.factory_deputies
     FROM deputies d JOIN users u ON d.user_id = u.id
     WHERE d.factory_id IN (${placeholders})`
  ).all(...factoryIds);

  const deputies = rows.map(r => ({
    id:        r.id,
    factoryId: r.factory_id,
    userId:    r.user_id,
    userName:  r.name,
    role:      r.role,
    expiresAt: r.expires_at,
  }));

  res.json({ success: true, deputies });
});

// POST /api/clearDeputiesByFactories
router.post('/clearDeputiesByFactories', (req, res) => {
  const [factoryIds] = req.body;
  if (!Array.isArray(factoryIds) || !factoryIds.length) {
    return res.json({ success: true });
  }

  const clearTx = db.transaction(() => {
    for (const fid of factoryIds) {
      // deputy 테이블에서 해당 공장 대리인 조회
      const rows = db.prepare('SELECT * FROM deputies WHERE factory_id = ?').all(fid);
      for (const dep of rows) {
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(dep.user_id);
        if (!user) continue;
        const factoryDeputies = safeJson(user.factory_deputies, {});
        const factoryRoles    = safeJson(user.factory_roles, {});

        // 원본 역할 복원
        if (factoryDeputies[fid] !== undefined) {
          factoryRoles[fid] = factoryDeputies[fid];
          delete factoryDeputies[fid];
        }

        db.prepare(
          `UPDATE users SET factory_roles=?, factory_deputies=? WHERE id=?`
        ).run(JSON.stringify(factoryRoles), JSON.stringify(factoryDeputies), dep.user_id);
      }
      db.prepare('DELETE FROM deputies WHERE factory_id = ?').run(fid);
    }
  });

  clearTx();
  res.json({ success: true });
});

// POST /api/generateTestRecords  (개발용 — 테스트 데이터 생성)
router.post('/generateTestRecords', (req, res) => {
  if (!isExplicitTestMode() || !isTestDbPath(getDatabasePath(db))) {
    return res.status(403).json({ success: false, message: '테스트 환경에서만 사용할 수 있습니다.' });
  }
  const caller = req.session.user;
  if (!caller.isMaster) return res.json({ success: false, message: '마스터만 사용 가능합니다.' });

  const [factoryId, count] = req.body;
  const templates = db.prepare('SELECT log_id, title FROM log_templates WHERE factory_id = ?').all(factoryId || 'pb2');
  const todayStr  = today();
  const created   = [];

  const tx = db.transaction(() => {
    for (let i = 0; i < (count || 5); i++) {
      const tpl = templates[i % templates.length];
      if (!tpl) continue;
      const recordId = `REC-TEST-${Date.now()}-${i}`;
      db.prepare(
        `INSERT OR IGNORE INTO records (record_id, log_id, title, date, writer_id, writer_name, status, factory_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'admin', '관리자', '미작성', ?, ?, ?)`
      ).run(recordId, tpl.log_id, tpl.title, todayStr, factoryId || 'pb2', now(), now());
      created.push(recordId);
    }
  });
  tx();

  res.json({ success: true, created });
});

module.exports = router;
