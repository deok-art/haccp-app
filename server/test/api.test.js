const path = require('path');
const fs = require('fs');
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const {
  createPreparedTestDb,
  resetTestDb,
  ONE_PIXEL_SIGNATURE,
  cleanUploads,
} = require('./helpers/test-db');

const dbPath = path.join(__dirname, '.tmp', 'api.db');

process.env.HACCP_DB_PATH = dbPath;
process.env.HACCP_UPLOAD_DIR = path.join(__dirname, '.tmp', 'uploads');
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'haccp-test-secret';

createPreparedTestDb(dbPath);

const { ensureDefaultTemplates } = require('../ensure-default-templates');
const { normalizeServiceKey } = require('../factory-calendar');
const { app } = require('../app');
const { db } = require('../db');

function createUtcDate(dateStr) {
  const [year, month, day] = String(dateStr || '').split('-').map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function formatUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

function getWeekStart(dateStr) {
  const date = createUtcDate(dateStr);
  const day = date.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setUTCDate(date.getUTCDate() + diff);
  return formatUtcDate(date);
}

test.beforeEach(() => {
  resetTestDb(db);
  cleanUploads();
});

test('login succeeds for seeded admin user', async () => {
  const res = await request(app)
    .post('/api/login')
    .send(['admin', '1234']);

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.mustChangePw, false);
  assert.equal(res.body.userInfo.id, 'admin');
});

test('protected endpoints require a logged-in session', async () => {
  const res = await request(app)
    .post('/api/getInitialData')
    .send([]);

  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
});

test('getUserList returns users, factories, and requester role metadata', async () => {
  const agent = request.agent(app);

  await agent.post('/api/login').send(['admin', '1234']).expect(200);
  const res = await agent.post('/api/getUserList').send(['admin']).expect(200);

  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.users));
  assert.ok(Array.isArray(res.body.factories));
  assert.equal(typeof res.body.requesterIsMaster, 'boolean');
  assert.equal(res.body.requesterIsMaster, true);
  assert.deepEqual(res.body.factories.map(factory => factory.id), ['pb1', 'pb2']);
});

test('factory leader only sees users that belong to their factory', async () => {
  const agent = request.agent(app);

  await agent.post('/api/login').send(['leader1', '1234']).expect(200);
  const res = await agent.post('/api/getUserList').send(['leader1']).expect(200);

  assert.equal(res.body.success, true);
  assert.deepEqual(
    res.body.users.map(user => user.id).sort(),
    ['admin', 'leader1', 'multi1', 'pb1user']
  );
  assert.equal(res.body.requesterIsMaster, false);
});

test('saveSignature persists the updated signature for the current user', async () => {
  const agent = request.agent(app);
  const nextSignature = `${ONE_PIXEL_SIGNATURE}#updated`;

  await agent.post('/api/login').send(['admin', '1234']).expect(200);
  await agent.post('/api/saveSignature').send(['admin', nextSignature]).expect(200);

  const saved = db.prepare('SELECT signature FROM users WHERE id = ?').get('admin');
  assert.equal(saved.signature, nextSignature);
});

test('updatePassword changes the stored password and invalidates the old one', async () => {
  const agent = request.agent(app);

  await agent.post('/api/login').send(['admin', '1234']).expect(200);
  await agent.post('/api/updatePassword').send(['admin', '5678']).expect(200);

  const oldLogin = await request(app).post('/api/login').send(['admin', '1234']);
  const newLogin = await request(app).post('/api/login').send(['admin', '5678']);

  assert.equal(oldLogin.body.success, false);
  assert.equal(newLogin.body.success, true);
});

test('logout destroys the current session for subsequent protected requests', async () => {
  const agent = request.agent(app);

  await agent.post('/api/login').send(['admin', '1234']).expect(200);
  await agent.post('/api/logout').send([]).expect(200);
  const protectedRes = await agent.post('/api/getInitialData').send([]);

  assert.equal(protectedRes.status, 401);
  assert.equal(protectedRes.body.success, false);
});

test('getInitialData returns factories, logs, and records for the session user', async () => {
  const agent = request.agent(app);

  await agent.post('/api/login').send(['admin', '1234']).expect(200);
  const res = await agent.post('/api/getInitialData').send([]).expect(200);

  assert.equal(res.body.success, true);
  assert.ok(Array.isArray(res.body.factories));
  assert.ok(Array.isArray(res.body.logs));
  assert.ok(Array.isArray(res.body.records));
  assert.equal(res.body.factories.length, 2);
  assert.ok(res.body.logs.some(log => log.logId === undefined && log.id === 'LOG-PB2-DAILY'));
  assert.equal(typeof res.body.calendarSummary.pb2.today.isWorkday, 'boolean');
});

test('ensureDefaultTemplates seeds the si0103 weekly workplace checklist', () => {
  ensureDefaultTemplates(db);
  const template = db.prepare(
    'SELECT log_id, title, doc_no, interval FROM log_templates WHERE log_id = ?'
  ).get('si0103');

  assert.equal(template.log_id, 'si0103');
  assert.equal(template.title, '영업장 위생점검 일지');
  assert.equal(template.doc_no, 'PBⅡ-SI-01-03');
  assert.equal(template.interval, 'weekly');
});

test('ensureDefaultTemplates seeds the si0201 foreign-matter checklist when missing', () => {
  db.prepare("DELETE FROM log_templates WHERE log_id = 'si0201'").run();
  ensureDefaultTemplates(db);

  const template = db.prepare(
    'SELECT log_id, title, doc_no, interval, revision FROM log_templates WHERE log_id = ?'
  ).get('si0201');
  const items = JSON.parse(db.prepare(
    'SELECT items FROM log_templates WHERE log_id = ?'
  ).get('si0201').items);

  assert.equal(template.log_id, 'si0201');
  assert.equal(template.title, '이물관리 점검표');
  assert.equal(template.doc_no, 'PBII-SI-02-01');
  assert.equal(template.interval, 'daily');
  assert.equal(template.revision, '미표기');
  assert.equal(items.filter(item => item.type === 'check').length, 38);
});

test('ensureDefaultTemplates seeds the si0202 workplace hygiene and temperature checklist', () => {
  db.prepare("DELETE FROM log_templates WHERE log_id = 'si0202'").run();
  ensureDefaultTemplates(db);

  const template = db.prepare(
    'SELECT log_id, title, doc_no, interval, revision, meta_info FROM log_templates WHERE log_id = ?'
  ).get('si0202');
  const metaInfo = JSON.parse(template.meta_info);
  const items = JSON.parse(db.prepare(
    'SELECT items FROM log_templates WHERE log_id = ?'
  ).get('si0202').items);
  const tempItem = items.find(item => item.key === 'temp_check_thaw');

  assert.equal(template.log_id, 'si0202');
  assert.equal(template.title, '작업장 위생 및 온도 점검표');
  assert.equal(template.doc_no, 'PBⅡ-SI-02-02');
  assert.equal(template.interval, 'daily');
  assert.equal(template.revision, '미표기');
  assert.equal(metaInfo.location, '작업장');
  assert.equal(items.filter(item => item.type === 'group_header').length, 9);
  assert.equal(items.filter(item => item.type === 'check').length, 34);
  assert.equal(items.filter(item => item.type === 'numeric').length, 9);
  assert.deepEqual(tempItem.criteria, { min: null, max: 20 });
});

test('ensureDefaultTemplates seeds the si0203 pest-control checklist with device counters', () => {
  db.prepare("DELETE FROM log_templates WHERE log_id = 'si0203'").run();
  ensureDefaultTemplates(db);

  const template = db.prepare(
    'SELECT log_id, title, doc_no, interval, revision, meta_info FROM log_templates WHERE log_id = ?'
  ).get('si0203');
  const metaInfo = JSON.parse(template.meta_info);
  const items = JSON.parse(db.prepare(
    'SELECT items FROM log_templates WHERE log_id = ?'
  ).get('si0203').items);
  const firstCounter = items.find(item => item.key === 'pest_monitoring_flying_device_01');

  assert.equal(template.log_id, 'si0203');
  assert.equal(template.title, '방충·방서 점검표');
  assert.equal(template.doc_no, 'PBII-SI-02-03');
  assert.equal(template.interval, 'daily');
  assert.equal(template.revision, '미표기');
  assert.equal(metaInfo.location, '포집장치');
  assert.equal(metaInfo.deviceNames.length, 10);
  assert.equal(items.filter(item => item.type === 'group_header').length, 10);
  assert.equal(items.filter(item => item.type === 'numeric').length, 30);
  assert.equal(items.filter(item => item.type === 'check').length, 50);
  assert.deepEqual(firstCounter.criteria, { min: 0, max: 0 });
  assert.equal(firstCounter.input_mode, 'counter');
  assert.equal(firstCounter.default_value, '0');
  assert.deepEqual(firstCounter.quick_values, [0, 1, 2, 3, 5]);
});

test('normalizeServiceKey accepts encoded keys from data.go.kr', () => {
  const encoded = 'abc%2Bdef%3D%3D%2Fghi';
  assert.equal(normalizeServiceKey(encoded), 'abc+def==/ghi');
  assert.equal(normalizeServiceKey('  "abc%2Fdef"  '), 'abc/def');
});

test('createNewLog reuses an existing unstarted record for the same day and factory', async () => {
  const agent = request.agent(app);
  const todayRes = await agent.post('/api/login').send(['admin', '1234']);
  assert.equal(todayRes.body.success, true);
  const today = db.prepare("SELECT date('now','localtime') AS d").get().d;

  const first = await agent
    .post('/api/createNewLog')
    .send(['LOG-PB2-DAILY', '2공장 일일 점검', 'admin', '관리자', today, 'pb2'])
    .expect(200);

  const second = await agent
    .post('/api/createNewLog')
    .send(['LOG-PB2-DAILY', '2공장 일일 점검', 'admin', '관리자', today, 'pb2'])
    .expect(200);

  const count = db.prepare(
    "SELECT COUNT(*) AS cnt FROM records WHERE log_id = ? AND date = ? AND factory_id = ? AND status = '미작성'"
  ).get('LOG-PB2-DAILY', today, 'pb2');

  assert.equal(first.body.success, true);
  assert.equal(second.body.recordId, first.body.recordId);
  assert.equal(count.cnt, 1);
});

test('createNewLog reuses the same weekly record within one week', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send(['admin', '1234']).expect(200);

  db.prepare("DELETE FROM records WHERE log_id = 'LOG-PB2-WEEKLY'").run();

  const today = db.prepare("SELECT date('now','localtime') AS d").get().d;
  const monday = getWeekStart(today);
  const fridayDate = createUtcDate(monday);
  fridayDate.setUTCDate(fridayDate.getUTCDate() + 4);
  const friday = formatUtcDate(fridayDate);

  const first = await agent
    .post('/api/createNewLog')
    .send(['LOG-PB2-WEEKLY', '2공장 주간 점검', 'admin', '관리자', monday, 'pb2'])
    .expect(200);

  const second = await agent
    .post('/api/createNewLog')
    .send(['LOG-PB2-WEEKLY', '2공장 주간 점검', 'admin', '관리자', friday, 'pb2'])
    .expect(200);

  const rows = db.prepare(
    'SELECT record_id FROM records WHERE log_id = ? AND factory_id = ? AND date >= ? AND date <= ?'
  ).all('LOG-PB2-WEEKLY', 'pb2', monday, friday);

  assert.equal(first.body.success, true);
  assert.equal(second.body.recordId, first.body.recordId);
  assert.equal(rows.length, 1);
});

test('saveDraft stores form data for a record', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send(['admin', '1234']).expect(200);

  const today = db.prepare("SELECT date('now','localtime') AS d").get().d;
  const createRes = await agent
    .post('/api/createNewLog')
    .send(['LOG-PB2-DAILY', '2공장 일일 점검', 'admin', '관리자', today, 'pb2'])
    .expect(200);

  const payload = { temperature: '5.0', memo: 'draft saved', items: {} };
  await agent
    .post('/api/saveDraft')
    .send([createRes.body.recordId, 'LOG-PB2-DAILY', payload])
    .expect(200);

  const saved = db.prepare('SELECT data_json FROM records WHERE record_id = ?').get(createRes.body.recordId);
  assert.match(saved.data_json, /draft saved/);
});

test('saveDraft preserves engine form temperature, results, notes, and photos', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send(['admin', '1234']).expect(200);

  ensureDefaultTemplates(db);

  const today = db.prepare("SELECT date('now','localtime') AS d").get().d;
  const createRes = await agent
    .post('/api/createNewLog')
    .send(['si0202', '작업장 위생 및 온도 점검표', 'admin', '관리자', today, 'pb2'])
    .expect(200);

  const payload = {
    items: {
      hygiene_01_thaw: {
        result: 'ng',
        defectText: '해동실 바닥 오염',
        actionText: '청소 완료',
        defectPhoto: '/uploads/draft-defect.png',
        actionPhoto: '/uploads/draft-action.png',
      },
      temp_check_thaw: {
        result: 'ok',
        defectText: '',
        actionText: '',
        defectPhoto: '',
        actionPhoto: '',
        tempValue: '12.3',
      },
    },
  };

  await agent
    .post('/api/saveDraft')
    .send([createRes.body.recordId, 'si0202', JSON.stringify(payload)])
    .expect(200);

  const detailRes = await agent
    .post('/api/getRecordDetail')
    .send([createRes.body.recordId, 'si0202'])
    .expect(200);

  const saved = typeof detailRes.body.dataJson === 'string'
    ? JSON.parse(detailRes.body.dataJson)
    : detailRes.body.dataJson;

  assert.equal(saved.items.hygiene_01_thaw.result, 'ng');
  assert.equal(saved.items.hygiene_01_thaw.defectText, '해동실 바닥 오염');
  assert.equal(saved.items.hygiene_01_thaw.actionText, '청소 완료');
  assert.equal(saved.items.hygiene_01_thaw.defectPhoto, '/uploads/draft-defect.png');
  assert.equal(saved.items.hygiene_01_thaw.actionPhoto, '/uploads/draft-action.png');
  assert.equal(saved.items.temp_check_thaw.tempValue, '12.3');
});

test('saveFormData finalizes a record with defect summary and writer info', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send(['admin', '1234']).expect(200);

  const today = db.prepare("SELECT date('now','localtime') AS d").get().d;
  const createRes = await agent
    .post('/api/createNewLog')
    .send(['LOG-PB2-DAILY', '2공장 일일 점검', 'admin', '관리자', today, 'pb2'])
    .expect(200);

  const formData = {
    temperature: '4.2',
    memo: 'final submit',
    items: {
      floor: {
        result: 'ng',
        defectText: '바닥 오염',
        actionText: '청소 완료',
        defectPhoto: '',
        actionPhoto: '',
      },
    },
  };
  const defectInfo = JSON.stringify({ item: '바닥', content: '바닥 오염', action: '청소 완료' });

  await agent
    .post('/api/saveFormData')
    .send([createRes.body.recordId, 'LOG-PB2-DAILY', formData, defectInfo])
    .expect(200);

  const saved = db.prepare(
    'SELECT writer_id, writer_name, defect_info, data_json FROM records WHERE record_id = ?'
  ).get(createRes.body.recordId);

  assert.equal(saved.writer_id, 'admin');
  assert.equal(saved.writer_name, '관리자');
  assert.equal(saved.defect_info, defectInfo);
  assert.match(saved.data_json, /final submit/);
});

test('saveFormData rejects si0202 when a required temperature value is missing', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send(['admin', '1234']).expect(200);

  ensureDefaultTemplates(db);

  const today = db.prepare("SELECT date('now','localtime') AS d").get().d;
  const createRes = await agent
    .post('/api/createNewLog')
    .send(['si0202', '작업장 위생 및 온도 점검표', 'admin', '관리자', today, 'pb2'])
    .expect(200);

  const templateItems = JSON.parse(db.prepare(
    'SELECT items FROM log_templates WHERE log_id = ?'
  ).get('si0202').items);

  const formItems = {};
  templateItems.forEach(item => {
    if (item.type === 'group_header') return;
    formItems[item.key] = {
      result: 'ok',
      defectText: '',
      actionText: '',
      defectPhoto: '',
      actionPhoto: '',
    };
    if (item.type === 'numeric') formItems[item.key].tempValue = '10';
  });
  formItems.temp_check_thaw.tempValue = '';

  const res = await agent
    .post('/api/saveFormData')
    .send([createRes.body.recordId, 'si0202', { items: formItems }, ''])
    .expect(200);

  const saved = db.prepare(
    'SELECT status, data_json FROM records WHERE record_id = ?'
  ).get(createRes.body.recordId);

  assert.equal(res.body.success, false);
  assert.match(res.body.message, /측정값을 입력/);
  assert.equal(saved.status, '미작성');
  assert.equal(saved.data_json, '{}');
});

test('saveFormData rejects si0203 when insect count exceeds zero but remains marked ok', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send(['admin', '1234']).expect(200);

  ensureDefaultTemplates(db);

  const today = db.prepare("SELECT date('now','localtime') AS d").get().d;
  const createRes = await agent
    .post('/api/createNewLog')
    .send(['si0203', '방충·방서 점검표', 'admin', '관리자', today, 'pb2'])
    .expect(200);

  const templateItems = JSON.parse(db.prepare(
    'SELECT items FROM log_templates WHERE log_id = ?'
  ).get('si0203').items);

  const formItems = {};
  templateItems.forEach(item => {
    if (item.type === 'group_header') return;
    formItems[item.key] = {
      result: 'ok',
      defectText: '',
      actionText: '',
      defectPhoto: '',
      actionPhoto: '',
    };
    if (item.type === 'numeric') formItems[item.key].tempValue = '0';
  });
  formItems.pest_monitoring_flying_device_01.tempValue = '2';
  formItems.pest_monitoring_flying_device_01.result = 'ok';

  const res = await agent
    .post('/api/saveFormData')
    .send([createRes.body.recordId, 'si0203', { items: formItems }, ''])
    .expect(200);

  const saved = db.prepare(
    'SELECT status, data_json FROM records WHERE record_id = ?'
  ).get(createRes.body.recordId);

  assert.equal(res.body.success, false);
  assert.match(res.body.message, /기준을 벗어난 값은 부적합/);
  assert.equal(saved.status, '미작성');
  assert.equal(saved.data_json, '{}');
});

test('processRecordAction performs review and approve transitions', async () => {
  const admin = request.agent(app);
  const reviewer = request.agent(app);
  await admin.post('/api/login').send(['admin', '1234']).expect(200);
  await reviewer.post('/api/login').send(['reviewer1', '1234']).expect(200);

  const today = db.prepare("SELECT date('now','localtime') AS d").get().d;
  const createRes = await admin
    .post('/api/createNewLog')
    .send(['LOG-PB2-DAILY', '2공장 일일 점검', 'admin', '관리자', today, 'pb2'])
    .expect(200);

  await admin
    .post('/api/saveFormData')
    .send([createRes.body.recordId, 'LOG-PB2-DAILY', { temperature: '3', memo: '', items: {} }, ''])
    .expect(200);

  await reviewer
    .post('/api/processRecordAction')
    .send([createRes.body.recordId, 'REVIEW', 'reviewer1', '검토자1', 2])
    .expect(200);
  await admin
    .post('/api/processRecordAction')
    .send([createRes.body.recordId, 'APPROVE', 'admin', '관리자', 3])
    .expect(200);

  const saved = db.prepare(
    'SELECT reviewer_id, reviewer_name, approver_id, approver_name FROM records WHERE record_id = ?'
  ).get(createRes.body.recordId);

  assert.equal(saved.reviewer_id, 'reviewer1');
  assert.equal(saved.reviewer_name, '검토자1');
  assert.equal(saved.approver_id, 'admin');
  assert.equal(saved.approver_name, '관리자');
});

test('processRecordAction can reset a completed record back to writing state', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send(['admin', '1234']).expect(200);

  const today = db.prepare("SELECT date('now','localtime') AS d").get().d;
  const createRes = await agent
    .post('/api/createNewLog')
    .send(['LOG-PB2-WEEKLY', '2공장 주간 점검', 'admin', '관리자', today, 'pb2'])
    .expect(200);

  await agent
    .post('/api/saveFormData')
    .send([createRes.body.recordId, 'LOG-PB2-WEEKLY', { temperature: '3', memo: '', items: {} }, ''])
    .expect(200);

  const resetRes = await agent
    .post('/api/processRecordAction')
    .send([createRes.body.recordId, 'RESET_TO_WRITING', 'admin', '관리자', 3])
    .expect(200);

  const updated = db.prepare('SELECT status FROM records WHERE record_id = ?').get(createRes.body.recordId);
  assert.equal(resetRes.body.success, true);
  assert.equal(updated.status, '작성중');
});

test('createTodayDailyLogsBatch creates selected logs and skips existing ones', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send(['admin', '1234']).expect(200);

  const first = await agent
    .post('/api/createTodayDailyLogsBatch')
    .send(['pb2', 'admin', '관리자', [], ['LOG-PB2-DAILY']])
    .expect(200);
  const second = await agent
    .post('/api/createTodayDailyLogsBatch')
    .send(['pb2', 'admin', '관리자', [], ['LOG-PB2-DAILY']])
    .expect(200);

  assert.deepEqual(first.body.created, []);
  assert.deepEqual(first.body.skipped, ['LOG-PB2-DAILY']);
  assert.deepEqual(second.body.skipped, ['LOG-PB2-DAILY']);
});

test('batchProcessRecords approves all matching records in scope', async () => {
  const admin = request.agent(app);
  await admin.post('/api/login').send(['admin', '1234']).expect(200);

  const today = db.prepare("SELECT date('now','localtime') AS d").get().d;
  for (const logId of ['LOG-PB1-DAILY', 'LOG-PB2-DAILY']) {
    const title = logId === 'LOG-PB1-DAILY' ? '1공장 일일 점검' : '2공장 일일 점검';
    const factoryId = logId === 'LOG-PB1-DAILY' ? 'pb1' : 'pb2';
    const createRes = await admin
      .post('/api/createNewLog')
      .send([logId, title, 'admin', '관리자', today, factoryId])
      .expect(200);
    await admin
      .post('/api/saveFormData')
      .send([createRes.body.recordId, logId, { temperature: '3', memo: '', items: {} }, ''])
      .expect(200);
  }

  const batchRes = await admin
    .post('/api/batchProcessRecords')
    .send(['APPROVE', '관리자', 3])
    .expect(200);

  const approved = db.prepare(
    'SELECT COUNT(*) AS cnt FROM records WHERE approver_id = ? AND approver_name = ?'
  ).get('admin', '관리자');

  assert.equal(batchRes.body.success, true);
  assert.equal(batchRes.body.count, 3);
  assert.equal(approved.cnt, 5);
});

test('savePhoto writes the uploaded file and returns a public URL', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send(['admin', '1234']).expect(200);

  const res = await agent
    .post('/api/savePhoto')
    .send([
      'REC-1',
      'LOG-PB2-DAILY',
      '2공장 일일 점검',
      'floor',
      'defect',
      ONE_PIXEL_SIGNATURE,
    ])
    .expect(200);

  const filePath = path.join(process.env.HACCP_UPLOAD_DIR, path.basename(res.body.url));
  assert.equal(res.body.success, true);
  assert.ok(res.body.url.startsWith('/uploads/'));
  assert.equal(fs.existsSync(filePath), true);
});

test('updateUserInfo persists rank and factory roles for the target user', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send(['admin', '1234']).expect(200);

  const res = await agent
    .post('/api/updateUserInfo')
    .send(['admin', 'reviewer1', { rank: '대리', factoryRoles: { pb1: 1, pb2: 2 } }])
    .expect(200);

  const updated = db.prepare('SELECT rank, factory_roles FROM users WHERE id = ?').get('reviewer1');

  assert.equal(res.body.success, true);
  assert.equal(updated.rank, '대리');
  assert.match(updated.factory_roles, /"pb1":1/);
  assert.match(updated.factory_roles, /"pb2":2/);
});

test('getRecordDetail returns signatures for writer, reviewer, and approver', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send(['admin', '1234']).expect(200);

  const res = await agent
    .post('/api/getRecordDetail')
    .send(['REC-PB2-APPROVED'])
    .expect(200);

  assert.equal(res.body.success, true);
  assert.equal(res.body.writerName, '작성자1');
  assert.equal(res.body.reviewerName, '검토자1');
  assert.equal(res.body.approverName, '관리자');
  assert.equal(typeof res.body.writerSignature, 'string');
  assert.equal(typeof res.body.reviewerSignature, 'string');
  assert.equal(typeof res.body.approverSignature, 'string');
});

test('getRecordsForDateRange returns approved records for the selected factory and period', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send(['admin', '1234']).expect(200);

  const today = db.prepare("SELECT date('now','localtime') AS d").get().d;
  const yesterday = db.prepare("SELECT date('now','localtime','-1 day') AS d").get().d;
  const res = await agent
    .post('/api/getRecordsForDateRange')
    .send(['pb2', yesterday, today])
    .expect(200);

  assert.equal(res.body.success, true);
  assert.deepEqual(res.body.records.map(record => record.record_id || record.recordId), ['REC-PB2-APPROVED']);
});

test('processRecordAction supports reject and revoke approve transitions', async () => {
  const admin = request.agent(app);
  const reviewer = request.agent(app);
  await admin.post('/api/login').send(['admin', '1234']).expect(200);
  await reviewer.post('/api/login').send(['reviewer1', '1234']).expect(200);

  const rejectRes = await reviewer
    .post('/api/processRecordAction')
    .send(['REC-PB2-REVIEWED', 'REJECT', 'reviewer1', '검토자1', 2])
    .expect(200);
  const rejected = db.prepare(
    'SELECT status, reviewer_id, approver_id FROM records WHERE record_id = ?'
  ).get('REC-PB2-REVIEWED');

  const revokeApproveRes = await admin
    .post('/api/processRecordAction')
    .send(['REC-PB2-APPROVED', 'REVOKE_APPROVE', 'admin', '관리자', 3])
    .expect(200);
  const revoked = db.prepare(
    'SELECT status, approver_id FROM records WHERE record_id = ?'
  ).get('REC-PB2-APPROVED');

  assert.equal(rejectRes.body.success, true);
  assert.equal(rejected.status, '작성완료');
  assert.equal(rejected.reviewer_id, '');
  assert.equal(revokeApproveRes.body.success, true);
  assert.equal(revoked.status, '검토완료');
  assert.equal(revoked.approver_id, '');
});

test('batchActionByIds revoke clears approval data for selected records', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send(['admin', '1234']).expect(200);

  const res = await agent
    .post('/api/batchActionByIds')
    .send([['REC-PB2-APPROVED'], 'REVOKE', '관리자', 3])
    .expect(200);

  const updated = db.prepare(
    'SELECT status, approver_id, approver_name FROM records WHERE record_id = ?'
  ).get('REC-PB2-APPROVED');

  assert.equal(res.body.success, true);
  assert.equal(updated.status, '작성완료');
  assert.equal(updated.approver_id, '');
  assert.equal(updated.approver_name, '');
});

test('deleteRecord removes records that are still editable', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send(['admin', '1234']).expect(200);

  const today = db.prepare("SELECT date('now','localtime') AS d").get().d;
  const createRes = await agent
    .post('/api/createNewLog')
    .send(['LOG-PB2-DAILY', '2공장 일일 점검', 'admin', '관리자', today, 'pb2'])
    .expect(200);

  const deleteRes = await agent
    .post('/api/deleteRecord')
    .send([createRes.body.recordId])
    .expect(200);

  const deleted = db.prepare('SELECT record_id FROM records WHERE record_id = ?').get(createRes.body.recordId);
  assert.equal(deleteRes.body.success, true);
  assert.equal(deleted, undefined);
});

test('getPhotoUrl returns the provided URL as-is', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send(['admin', '1234']).expect(200);

  const res = await agent
    .post('/api/getPhotoUrl')
    .send(['/uploads/example.png'])
    .expect(200);

  assert.equal(res.body.success, true);
  assert.equal(res.body.url, '/uploads/example.png');
});

test('reviewer can update factory calendar rules for their factory', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send(['reviewer1', '1234']).expect(200);

  const res = await agent
    .post('/api/updateFactoryCalendarRule')
    .send(['pb2', '1,2,3,4,5,6', true])
    .expect(200);

  const saved = db.prepare(
    'SELECT default_weekday_mask, use_national_holidays FROM factory_calendar_rules WHERE factory_id = ?'
  ).get('pb2');

  assert.equal(res.body.success, true);
  assert.equal(saved.default_weekday_mask, '1,2,3,4,5,6');
  assert.equal(saved.use_national_holidays, 1);
});

test('calendar override removes a missing daily log from the dashboard dynamically', async () => {
  const agent = request.agent(app);
  await agent.post('/api/login').send(['reviewer1', '1234']).expect(200);

  const today = db.prepare("SELECT date('now','localtime') AS d").get().d;
  const monthKey = today.slice(0, 7);
  const monthStart = `${monthKey}-01`;
  const monthEnd = formatUtcDate(new Date(Date.UTC(
    Number(monthKey.slice(0, 4)),
    Number(monthKey.slice(5, 7)),
    0
  )));

  const dates = [];
  let cursor = createUtcDate(monthStart);
  const end = createUtcDate(monthEnd);
  while (cursor <= end) {
    dates.push(formatUtcDate(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const candidate = dates.find(dateStr => {
    const weekday = createUtcDate(dateStr).getUTCDay();
    if (weekday === 0 || weekday === 6) return false;
    const existing = db.prepare(
      'SELECT record_id FROM records WHERE factory_id = ? AND log_id = ? AND date = ?'
    ).get('pb2', 'LOG-PB2-DAILY', dateStr);
    return !existing;
  });

  assert.ok(candidate, 'expected at least one missing workday in the seeded month');

  const before = await agent
    .post('/api/getMissingDashboard')
    .send(['pb2', monthKey])
    .expect(200);

  const beforeTarget = before.body.items.find(item =>
    item.logId === 'LOG-PB2-DAILY' && item.periodKey === candidate
  );
  assert.ok(beforeTarget, 'expected the candidate date to appear as missing before override');

  await agent
    .post('/api/updateFactoryCalendarDay')
    .send(['pb2', candidate, 'holiday', '테스트 휴무'])
    .expect(200);

  const after = await agent
    .post('/api/getMissingDashboard')
    .send(['pb2', monthKey])
    .expect(200);

  const afterTarget = after.body.items.find(item =>
    item.logId === 'LOG-PB2-DAILY' && item.periodKey === candidate
  );

  assert.equal(afterTarget, undefined);
  assert.equal(after.body.count, before.body.count - 1);
});
