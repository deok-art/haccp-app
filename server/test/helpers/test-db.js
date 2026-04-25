const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const {
  assertTestDatabase,
  assertTestDbPath,
  assertTestUploadPath,
} = require('../../test-safety');

const ONE_PIXEL_SIGNATURE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ6EAAAAASUVORK5CYII=';
function getUploadDir() {
  return process.env.HACCP_UPLOAD_DIR || path.join(__dirname, '..', '._invalid_upload_dir');
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function removeDbFiles(dbPath) {
  [dbPath, `${dbPath}-shm`, `${dbPath}-wal`].forEach(filePath => {
    if (fs.existsSync(filePath)) fs.rmSync(filePath, { force: true });
  });
}

function applySchema(db) {
  const schemaPath = path.join(__dirname, '..', '..', 'schema.sql');
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
}

function clearAllTables(db) {
  const tableNames = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  ).all().map(row => row.name);

  const reset = db.transaction(() => {
    for (const tableName of tableNames) {
      db.prepare(`DELETE FROM ${tableName}`).run();
    }
  });

  reset();
}

function seedFixtures(db) {
  const today = db.prepare("SELECT date('now','localtime') AS d").get().d;
  const yesterday = db.prepare("SELECT date('now','localtime','-1 day') AS d").get().d;

  const insertFactory = db.prepare(
    'INSERT INTO factories (factory_id, name) VALUES (?, ?)'
  );
  insertFactory.run('pb1', '테스트1공장');
  insertFactory.run('pb2', '테스트2공장');

  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?)'
  ).run('CompanyName', '테스트 HACCP');

  const insertTemplate = db.prepare(`
    INSERT INTO log_templates (log_id, title, doc_no, revision, factory_id, interval, meta_info, approval, items)
    VALUES (@log_id, @title, @doc_no, @revision, @factory_id, @interval, @meta_info, @approval, @items)
  `);

  insertTemplate.run({
    log_id: 'LOG-PB1-DAILY',
    title: '1공장 일일 점검',
    doc_no: 'DOC-PB1-001',
    revision: 'Rev.1',
    factory_id: 'pb1',
    interval: 'daily',
    meta_info: '{}',
    approval: '[]',
    items: '[]',
  });
  insertTemplate.run({
    log_id: 'LOG-PB2-DAILY',
    title: '2공장 일일 점검',
    doc_no: 'DOC-PB2-001',
    revision: 'Rev.1',
    factory_id: 'pb2',
    interval: 'daily',
    meta_info: '{}',
    approval: '[]',
    items: '[]',
  });
  insertTemplate.run({
    log_id: 'LOG-PB2-WEEKLY',
    title: '2공장 주간 점검',
    doc_no: 'DOC-PB2-002',
    revision: 'Rev.1',
    factory_id: 'pb2',
    interval: 'weekly',
    meta_info: '{}',
    approval: '[]',
    items: '[]',
  });

  const insertUser = db.prepare(`
    INSERT INTO users (id, name, factory_roles, factory_deputies, password_hash, signature, rank, is_master)
    VALUES (@id, @name, @factory_roles, @factory_deputies, @password_hash, @signature, @rank, @is_master)
  `);

  insertUser.run({
    id: 'admin',
    name: '관리자',
    factory_roles: '{"pb1":3,"pb2":3}',
    factory_deputies: '{}',
    password_hash: sha256('1234'),
    signature: ONE_PIXEL_SIGNATURE,
    rank: '팀장',
    is_master: 1,
  });

  insertUser.run({
    id: 'writer1',
    name: '작성자1',
    factory_roles: '{"pb2":1}',
    factory_deputies: '{}',
    password_hash: sha256('1234'),
    signature: '',
    rank: '사원',
    is_master: 0,
  });

  insertUser.run({
    id: 'leader1',
    name: '팀장1',
    factory_roles: '{"pb1":3}',
    factory_deputies: '{}',
    password_hash: sha256('1234'),
    signature: ONE_PIXEL_SIGNATURE,
    rank: '팀장',
    is_master: 0,
  });

  insertUser.run({
    id: 'reviewer1',
    name: '검토자1',
    factory_roles: '{"pb2":2}',
    factory_deputies: '{}',
    password_hash: sha256('1234'),
    signature: ONE_PIXEL_SIGNATURE,
    rank: '주임',
    is_master: 0,
  });

  insertUser.run({
    id: 'multi1',
    name: '다공장사용자',
    factory_roles: '{"pb1":1,"pb2":1}',
    factory_deputies: '{}',
    password_hash: sha256('1234'),
    signature: ONE_PIXEL_SIGNATURE,
    rank: '사원',
    is_master: 0,
  });

  insertUser.run({
    id: 'pb1user',
    name: '1공장작성자',
    factory_roles: '{"pb1":1}',
    factory_deputies: '{}',
    password_hash: sha256('1234'),
    signature: ONE_PIXEL_SIGNATURE,
    rank: '사원',
    is_master: 0,
  });

  const insertRecord = db.prepare(`
    INSERT INTO records (
      record_id, log_id, title, date, writer_id, writer_name,
      reviewer_id, reviewer_name, approver_id, approver_name,
      status, defect_info, data_json, factory_id, created_at, updated_at
    ) VALUES (
      @record_id, @log_id, @title, @date, @writer_id, @writer_name,
      @reviewer_id, @reviewer_name, @approver_id, @approver_name,
      @status, @defect_info, @data_json, @factory_id, datetime('now','localtime'), datetime('now','localtime')
    )
  `);

  insertRecord.run({
    record_id: 'REC-PB2-APPROVED',
    log_id: 'LOG-PB2-DAILY',
    title: '2공장 일일 점검',
    date: today,
    writer_id: 'writer1',
    writer_name: '작성자1',
    reviewer_id: 'reviewer1',
    reviewer_name: '검토자1',
    approver_id: 'admin',
    approver_name: '관리자',
    status: '승인완료',
    defect_info: '',
    data_json: JSON.stringify({
      temperature: '4.5',
      memo: '승인 완료 기록',
      items: {
        floor: { result: 'ok', defectText: '', actionText: '', defectPhoto: '', actionPhoto: '' },
      },
    }),
    factory_id: 'pb2',
  });

  insertRecord.run({
    record_id: 'REC-PB2-REVIEWED',
    log_id: 'LOG-PB2-WEEKLY',
    title: '2공장 주간 점검',
    date: yesterday,
    writer_id: 'writer1',
    writer_name: '작성자1',
    reviewer_id: 'reviewer1',
    reviewer_name: '검토자1',
    approver_id: '',
    approver_name: '',
    status: '검토완료',
    defect_info: JSON.stringify({ item: '주간 점검', content: '이상 없음', action: '확인 완료' }),
    data_json: JSON.stringify({
      temperature: '5.1',
      memo: '검토 완료 기록',
      items: {
        floor: { result: 'ok', defectText: '', actionText: '', defectPhoto: '', actionPhoto: '' },
      },
    }),
    factory_id: 'pb2',
  });

  insertRecord.run({
    record_id: 'REC-PB1-APPROVED',
    log_id: 'LOG-PB1-DAILY',
    title: '1공장 일일 점검',
    date: today,
    writer_id: 'pb1user',
    writer_name: '1공장작성자',
    reviewer_id: 'leader1',
    reviewer_name: '팀장1',
    approver_id: 'admin',
    approver_name: '관리자',
    status: '승인완료',
    defect_info: '',
    data_json: JSON.stringify({
      temperature: '3.9',
      memo: '1공장 승인 기록',
      items: {
        floor: { result: 'ok', defectText: '', actionText: '', defectPhoto: '', actionPhoto: '' },
      },
    }),
    factory_id: 'pb1',
  });

  require('../../factory-calendar').ensureFactoryCalendarDefaults(db);
}

function createPreparedTestDb(dbPath) {
  assertTestDbPath(dbPath, 'test database');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  removeDbFiles(dbPath);

  const db = new Database(dbPath);
  applySchema(db);
  clearAllTables(db);
  seedFixtures(db);
  db.close();
}

function resetTestDb(db) {
  assertTestDatabase(db, 'test database');
  clearAllTables(db);
  seedFixtures(db);
}

function cleanUploads() {
  const uploadDir = getUploadDir();
  assertTestUploadPath(uploadDir, 'test upload dir');
  fs.mkdirSync(uploadDir, { recursive: true });
  for (const name of fs.readdirSync(uploadDir)) {
    if (name === '.gitkeep') continue;
    fs.rmSync(path.join(uploadDir, name), { force: true });
  }
}

module.exports = {
  ONE_PIXEL_SIGNATURE,
  cleanUploads,
  createPreparedTestDb,
  resetTestDb,
};
