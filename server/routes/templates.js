const express = require('express');
const { db } = require('../db');
const { logAudit } = require('../audit');
const { normalizeDepartment, parseResponsibleDepartments, uniqueDepartments } = require('../template-access');

const router = express.Router();

const DOC_NO_PREFIX = { pb1: 'PB-', pb2: 'PBⅡ-' };
const DEFAULT_REVISION = 'rev.0';
const VALID_INTERVALS = ['daily', 'weekly', 'biweekly', 'monthly', 'quarterly', 'seasonal'];
const VALID_ITEM_TYPES = ['group_header', 'check', 'numeric', 'select', 'text', 'date'];

function normalizeUserIds(userIds) {
  return [...new Set((Array.isArray(userIds) ? userIds : []).map(v => String(v || '').trim()).filter(Boolean))];
}

function normalizeDepartmentList(values) {
  return uniqueDepartments(Array.isArray(values) ? values : [values]);
}

function getTemplateRowsForAdmin(caller, factoryId) {
  return caller.isMaster
    ? db.prepare('SELECT log_id, title, doc_no, revision, interval, factory_id, responsible_department, responsible_departments FROM log_templates ORDER BY factory_id, log_id').all()
    : db.prepare('SELECT log_id, title, doc_no, revision, interval, factory_id, responsible_department, responsible_departments FROM log_templates WHERE factory_id = ? ORDER BY log_id').all(factoryId);
}

function decorateTemplateRows(templates) {
  const assignments = db.prepare(`
    SELECT a.factory_id, a.log_id, a.user_id, u.name, u.department, u.rank
    FROM log_assignments a
    LEFT JOIN users u ON u.id = a.user_id
  `).all();
  const assignmentMap = new Map();
  for (const row of assignments) {
    const key = `${row.factory_id}:${row.log_id}`;
    if (!assignmentMap.has(key)) assignmentMap.set(key, []);
    assignmentMap.get(key).push({
      id: row.user_id,
      name: row.name || row.user_id,
      department: row.department || '',
      rank: row.rank || '',
    });
  }

  return templates.map(t => {
    const responsibleDepartments = parseResponsibleDepartments(t);
    const assignedUsers = assignmentMap.get(`${t.factory_id}:${t.log_id}`) || [];
    return {
      ...t,
      responsibleDepartment: responsibleDepartments[0] || '',
      responsibleDepartments,
      assignedUsers,
      assignedUserIds: assignedUsers.map(u => u.id),
      assignmentCount: assignedUsers.length,
    };
  });
}

const { ROLE, requireRole } = require('../lib/auth/role');

function requireRole3(caller, factoryId, res) {
  return requireRole(caller, factoryId, ROLE.MANAGER, res, '권한이 없습니다. (role 3 이상 필요)');
}

function validateItems(items) {
  if (!Array.isArray(items)) return '항목(items)은 배열이어야 합니다.';
  const keys = [];
  for (const item of items) {
    if (!item.key) return '모든 항목에 key가 필요합니다.';
    if (keys.includes(item.key)) return `항목 key 중복: ${item.key}`;
    keys.push(item.key);
    if (item.type && !VALID_ITEM_TYPES.includes(item.type)) {
      return `유효하지 않은 항목 타입: ${item.type}`;
    }
  }
  return null;
}

// POST /api/getTemplateAdminList
router.post('/getTemplateAdminList', (req, res) => {
  const [factoryId] = req.body;
  const caller = req.session.user;

  if (!factoryId) return res.json({ success: false, error: '공장 ID 필요' });
  if (!requireRole3(caller, factoryId, res)) return;

  res.json({ success: true, templates: decorateTemplateRows(getTemplateRowsForAdmin(caller, factoryId)) });
});

// POST /api/createTemplate
router.post('/createTemplate', (req, res) => {
  const [factoryId, payload] = req.body;
  const caller = req.session.user;

  if (!factoryId || !payload) return res.json({ success: false, error: '필수 항목 누락' });
  if (!requireRole3(caller, factoryId, res)) return;

  const { log_id, title, doc_no_suffix, interval, approval, items, responsibleDepartment, responsibleDepartments } = payload;
  const departmentList = normalizeDepartmentList(responsibleDepartments !== undefined ? responsibleDepartments : responsibleDepartment);

  if (!log_id || !log_id.trim()) return res.json({ success: false, error: 'log_id가 필요합니다.' });
  if (!title || !title.trim()) return res.json({ success: false, error: '양식명이 필요합니다.' });
  if (!doc_no_suffix || !doc_no_suffix.trim()) return res.json({ success: false, error: '문서번호가 필요합니다.' });
  if (interval && !VALID_INTERVALS.includes(interval)) return res.json({ success: false, error: '유효하지 않은 주기입니다.' });

  const itemErr = validateItems(items || []);
  if (itemErr) return res.json({ success: false, error: itemErr });

  const prefix = DOC_NO_PREFIX[factoryId] || '';
  const doc_no = prefix + doc_no_suffix.trim();

  const existing = db.prepare('SELECT log_id FROM log_templates WHERE factory_id = ? AND log_id = ?').get(factoryId, log_id.trim());
  if (existing) return res.json({ success: false, error: `log_id 중복: ${log_id}` });

  const dupDocNo = db.prepare('SELECT log_id FROM log_templates WHERE doc_no = ?').get(doc_no);
  if (dupDocNo) return res.json({ success: false, error: `문서번호 중복: ${doc_no}` });

  db.prepare(`
    INSERT INTO log_templates (log_id, factory_id, title, doc_no, revision, responsible_department, responsible_departments, interval, approval, items)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    log_id.trim(),
    factoryId,
    title.trim(),
    doc_no,
    DEFAULT_REVISION,
    departmentList[0] || '',
    JSON.stringify(departmentList),
    interval || 'daily',
    approval ? JSON.stringify(approval) : '[]',
    JSON.stringify(items || [])
  );

  logAudit('CREATE', 'template', log_id.trim(), factoryId, caller, { title: title.trim(), doc_no });

  res.json({ success: true, log_id: log_id.trim(), doc_no });
});

// POST /api/updateTemplate
router.post('/updateTemplate', (req, res) => {
  const [factoryId, payload] = req.body;
  const caller = req.session.user;

  if (!factoryId || !payload) return res.json({ success: false, error: '필수 항목 누락' });
  if (!requireRole3(caller, factoryId, res)) return;

  const { log_id, title, doc_no_suffix, interval, approval, items, responsibleDepartment, responsibleDepartments } = payload;

  if (!log_id) return res.json({ success: false, error: 'log_id가 필요합니다.' });

  const existing = db.prepare('SELECT log_id, factory_id FROM log_templates WHERE log_id = ?').get(log_id);
  if (!existing) return res.json({ success: false, error: '존재하지 않는 양식입니다.' });

  if (!caller.isMaster && existing.factory_id !== factoryId) {
    return res.status(403).json({ success: false, error: '다른 공장의 양식은 수정할 수 없습니다.' });
  }

  if (interval && !VALID_INTERVALS.includes(interval)) {
    return res.json({ success: false, error: '유효하지 않은 주기입니다.' });
  }

  const updates = {};
  const before = db.prepare('SELECT title, doc_no, revision, interval, responsible_department, responsible_departments FROM log_templates WHERE log_id = ?').get(log_id);

  if (title !== undefined) {
    if (!title.trim()) return res.json({ success: false, error: '양식명은 비울 수 없습니다.' });
    updates.title = title.trim();
  }

  if (doc_no_suffix !== undefined) {
    if (!doc_no_suffix.trim()) return res.json({ success: false, error: '문서번호는 비울 수 없습니다.' });
    const prefix = DOC_NO_PREFIX[existing.factory_id] || '';
    const newDocNo = prefix + doc_no_suffix.trim();
    const dupDocNo = db.prepare('SELECT log_id FROM log_templates WHERE doc_no = ? AND log_id != ?').get(newDocNo, log_id);
    if (dupDocNo) return res.json({ success: false, error: `문서번호 중복: ${newDocNo}` });
    updates.doc_no = newDocNo;
  }

  updates.revision = DEFAULT_REVISION;
  if (interval !== undefined) updates.interval = interval;
  if (responsibleDepartment !== undefined || responsibleDepartments !== undefined) {
    const departmentList = normalizeDepartmentList(responsibleDepartments !== undefined ? responsibleDepartments : responsibleDepartment);
    updates.responsible_department = departmentList[0] || '';
    updates.responsible_departments = JSON.stringify(departmentList);
  }
  if (approval !== undefined) updates.approval = approval ? JSON.stringify(approval) : '[]';

  if (items !== undefined) {
    const itemErr = validateItems(items);
    if (itemErr) return res.json({ success: false, error: itemErr });
    updates.items = JSON.stringify(items);
  }

  if (Object.keys(updates).length === 0) {
    return res.json({ success: true });
  }

  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE log_templates SET ${setClauses} WHERE log_id = ?`)
    .run(...Object.values(updates), log_id);

  logAudit('UPDATE', 'template', log_id, existing.factory_id, caller, { before, after: updates });

  res.json({ success: true });
});

// POST /api/getLogAssignments
router.post('/getLogAssignments', (req, res) => {
  const [factoryId, logId] = req.body;
  const caller = req.session.user;
  if (!factoryId || !logId) return res.json({ success: false, error: '필수 항목 누락' });
  if (!requireRole3(caller, factoryId, res)) return;

  const rows = db.prepare('SELECT user_id FROM log_assignments WHERE factory_id = ? AND log_id = ?').all(factoryId, logId);
  res.json({ success: true, userIds: rows.map(r => r.user_id) });
});

// POST /api/setLogAssignments
router.post('/setLogAssignments', (req, res) => {
  const [factoryId, logId, userIds] = req.body;
  const caller = req.session.user;
  if (!factoryId || !logId) return res.json({ success: false, error: '필수 항목 누락' });
  if (!requireRole3(caller, factoryId, res)) return;
  if (!Array.isArray(userIds)) return res.json({ success: false, error: 'userIds는 배열이어야 합니다.' });

  const doSet = db.transaction(() => {
    db.prepare('DELETE FROM log_assignments WHERE factory_id = ? AND log_id = ?').run(factoryId, logId);
    const ins = db.prepare('INSERT INTO log_assignments (factory_id, log_id, user_id) VALUES (?, ?, ?)');
    for (const uid of userIds) ins.run(factoryId, logId, uid);
  });
  doSet();

  logAudit('UPDATE', 'template', logId, factoryId, caller, { action: 'setAssignments', userIds });
  res.json({ success: true });
});

// POST /api/bulkUpdateTemplatePermissions
router.post('/bulkUpdateTemplatePermissions', (req, res) => {
  const [factoryId, payload] = req.body;
  const caller = req.session.user;
  if (!factoryId || !payload) return res.json({ success: false, error: '필수 항목 누락' });
  if (!requireRole3(caller, factoryId, res)) return;

  const mode = payload.mode === 'replace' ? 'replace' : 'append';
  const departments = normalizeDepartmentList(payload.departmentNames || payload.responsibleDepartments || []);
  const userIds = normalizeUserIds(payload.userIds);
  const targets = Array.isArray(payload.targets) && payload.targets.length
    ? payload.targets.map(t => ({ factoryId: t.factoryId || t.factory_id || factoryId, logId: t.logId || t.log_id })).filter(t => t.logId)
    : normalizeUserIds(payload.logIds).map(logId => ({ factoryId, logId }));

  if (!targets.length) return res.json({ success: false, error: '선택된 양식이 없습니다.' });

  const updateTx = db.transaction(() => {
    for (const target of targets) {
      if (!caller.isMaster && target.factoryId !== factoryId) {
        throw new Error('다른 공장의 양식은 수정할 수 없습니다.');
      }
      const tpl = db.prepare('SELECT * FROM log_templates WHERE factory_id = ? AND log_id = ?').get(target.factoryId, target.logId);
      if (!tpl) throw new Error(`존재하지 않는 양식: ${target.logId}`);

      const nextDepartments = mode === 'replace'
        ? departments
        : uniqueDepartments([...parseResponsibleDepartments(tpl), ...departments]);
      db.prepare(`
        UPDATE log_templates
           SET responsible_department = ?, responsible_departments = ?
         WHERE factory_id = ? AND log_id = ?
      `).run(nextDepartments[0] || '', JSON.stringify(nextDepartments), target.factoryId, target.logId);

      if (mode === 'replace') {
        db.prepare('DELETE FROM log_assignments WHERE factory_id = ? AND log_id = ?').run(target.factoryId, target.logId);
      }

      const existingUsers = mode === 'replace'
        ? []
        : db.prepare('SELECT user_id FROM log_assignments WHERE factory_id = ? AND log_id = ?').all(target.factoryId, target.logId).map(r => r.user_id);
      const nextUserIds = normalizeUserIds([...existingUsers, ...userIds]);
      const ins = db.prepare('INSERT OR IGNORE INTO log_assignments (factory_id, log_id, user_id) VALUES (?, ?, ?)');
      for (const uid of nextUserIds) ins.run(target.factoryId, target.logId, uid);

      logAudit('UPDATE', 'template', target.logId, target.factoryId, caller, {
        action: 'bulkUpdatePermissions',
        mode,
        departments: nextDepartments,
        userIds: nextUserIds,
      });
    }
  });

  try {
    updateTx();
    res.json({ success: true, updated: targets.length });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// POST /api/getLogIdSeq
router.post('/getLogIdSeq', (req, res) => {
  const [factoryId] = req.body;
  const caller = req.session.user;
  if (!factoryId) return res.json({ success: false, error: '공장 ID 필요' });
  if (!requireRole3(caller, factoryId, res)) return;

  const rows = db.prepare('SELECT * FROM log_id_seq WHERE factory_id = ? ORDER BY prefix').all(factoryId);
  res.json({ success: true, rows });
});

// POST /api/saveLogIdSeq
router.post('/saveLogIdSeq', (req, res) => {
  const [factoryId, prefix, zeroPad, nextSeq] = req.body;
  const caller = req.session.user;
  if (!factoryId) return res.json({ success: false, error: '공장 ID 필요' });
  if (!requireRole3(caller, factoryId, res)) return;

  const pfx = (prefix || 'si').toLowerCase().trim();
  const pad = Math.max(1, Math.min(8, parseInt(zeroPad, 10) || 4));
  const seq = Math.max(1, parseInt(nextSeq, 10) || 1);

  db.prepare(`
    INSERT INTO log_id_seq (factory_id, prefix, zero_pad, next_seq)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(factory_id, prefix) DO UPDATE SET zero_pad = excluded.zero_pad, next_seq = excluded.next_seq
  `).run(factoryId, pfx, pad, seq);

  res.json({ success: true });
});

// POST /api/getNextLogIdSuggestion
router.post('/getNextLogIdSuggestion', (req, res) => {
  const [factoryId, prefix] = req.body;
  const caller = req.session.user;
  if (!factoryId) return res.json({ success: false, error: '공장 ID 필요' });
  if (!requireRole3(caller, factoryId, res)) return;

  const pfx = (prefix || 'si').toLowerCase().trim();
  const seq = db.prepare('SELECT * FROM log_id_seq WHERE factory_id = ? AND prefix = ?').get(factoryId, pfx);

  if (!seq) return res.json({ success: true, suggestion: `${pfx}0101` });

  const padded = String(seq.next_seq).padStart(seq.zero_pad, '0');
  res.json({ success: true, suggestion: `${pfx}${padded}` });
});

module.exports = router;
