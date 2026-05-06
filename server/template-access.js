const { getCallerRole } = require('./lib/auth/role');

function normalizeDepartment(value) {
  return String(value || '').trim();
}

function uniqueDepartments(values) {
  return [...new Set((values || []).map(normalizeDepartment).filter(Boolean))];
}

function parseResponsibleDepartments(template) {
  if (!template) return [];
  let departments = [];
  const rawList = template.responsible_departments !== undefined
    ? template.responsible_departments
    : template.responsibleDepartments;
  if (Array.isArray(rawList)) {
    departments = rawList;
  } else if (rawList) {
    try {
      const parsed = JSON.parse(rawList);
      if (Array.isArray(parsed)) departments = parsed;
    } catch (_err) {
      departments = [];
    }
  }
  const legacy = template.responsible_department !== undefined
    ? template.responsible_department
    : template.responsibleDepartment;
  return uniqueDepartments([...departments, legacy]);
}

function getUserDepartment(database, user) {
  if (!user) return '';
  if (user.department !== undefined) return normalizeDepartment(user.department);
  const row = database.prepare('SELECT department FROM users WHERE id = ?').get(user.id);
  return normalizeDepartment(row && row.department);
}

function getTemplateAssignments(database, factoryId, logId) {
  return database.prepare(
    'SELECT user_id FROM log_assignments WHERE factory_id = ? AND log_id = ?'
  ).all(factoryId, logId).map(row => row.user_id);
}

function canAccessTemplate(database, user, template, options = {}) {
  if (!user || !template) return false;
  const factoryId = template.factory_id || template.factoryId;
  const logId = template.log_id || template.logId;

  if (user.isMaster || getCallerRole(user, factoryId) >= 3) return true;
  if (options.recordWriterId && options.recordWriterId === user.id) return true;

  const assignedUserIds = options.assignedUserIds || getTemplateAssignments(database, factoryId, logId);
  if (assignedUserIds.includes(user.id)) return true;

  const templateDepartments = parseResponsibleDepartments(template);
  if (templateDepartments.length === 0 && assignedUserIds.length === 0) return true;

  return templateDepartments.includes(getUserDepartment(database, user));
}

function filterAccessibleTemplates(database, user, templates) {
  if (!user) return [];
  if (user.isMaster) return templates;

  const role3Factories = new Set(
    Object.entries(user.factoryRoles || {})
      .filter(([, role]) => parseInt(role, 10) >= 3)
      .map(([factoryId]) => factoryId)
  );
  const userDepartment = getUserDepartment(database, user);
  const factoryIds = [...new Set(templates.map(t => t.factory_id || t.factoryId).filter(Boolean))];

  let assignments = [];
  if (factoryIds.length) {
    const placeholders = factoryIds.map(() => '?').join(',');
    assignments = database.prepare(
      `SELECT factory_id, log_id, user_id FROM log_assignments WHERE factory_id IN (${placeholders})`
    ).all(...factoryIds);
  }

  const assignmentMap = new Map();
  for (const row of assignments) {
    const key = `${row.factory_id}:${row.log_id}`;
    if (!assignmentMap.has(key)) assignmentMap.set(key, []);
    assignmentMap.get(key).push(row.user_id);
  }

  return templates.filter(template => {
    const factoryId = template.factory_id || template.factoryId;
    const logId = template.log_id || template.logId;
    if (role3Factories.has(factoryId)) return true;

    const assignedUserIds = assignmentMap.get(`${factoryId}:${logId}`) || [];
    if (assignedUserIds.includes(user.id)) return true;

    const templateDepartments = parseResponsibleDepartments(template);
    if (templateDepartments.length === 0 && assignedUserIds.length === 0) return true;
    return templateDepartments.includes(userDepartment);
  });
}

function getTemplateForRecord(database, record) {
  if (!record) return null;
  return database.prepare(
    'SELECT * FROM log_templates WHERE log_id = ? AND factory_id = ?'
  ).get(record.log_id, record.factory_id)
    || database.prepare('SELECT * FROM log_templates WHERE log_id = ?').get(record.log_id);
}

module.exports = {
  canAccessTemplate,
  filterAccessibleTemplates,
  getCallerRole,
  getTemplateForRecord,
  getUserDepartment,
  normalizeDepartment,
  parseResponsibleDepartments,
  uniqueDepartments,
};
