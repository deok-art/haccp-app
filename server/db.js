// db.js — SQLite 연결 + 공통 헬퍼 (Repository Pattern 진입점)
const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.HACCP_DB_PATH || path.join(DATA_DIR, 'haccp.db');
const UPLOAD_DIR = process.env.HACCP_UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 스키마 자동 적용 (멱등)
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
if (fs.existsSync(SCHEMA_PATH)) {
  db.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

function ensureColumn(table, column, sqlTypeWithDefault) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (columns.some(col => col.name === column)) return;
  db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${sqlTypeWithDefault}`).run();
}

ensureColumn('records', 'writer_date', "TEXT NOT NULL DEFAULT ''");
ensureColumn('records', 'reviewer_date', "TEXT NOT NULL DEFAULT ''");
ensureColumn('records', 'approver_date', "TEXT NOT NULL DEFAULT ''");
ensureColumn('users', 'department', "TEXT NOT NULL DEFAULT ''");
ensureColumn('log_templates', 'responsible_department', "TEXT NOT NULL DEFAULT ''");
ensureColumn('log_templates', 'responsible_departments', "TEXT NOT NULL DEFAULT '[]'");

// log_templates: TEXT PK → surrogate int PK + UNIQUE(factory_id, log_id)
(function migrateLogTemplates() {
  const cols = db.prepare('PRAGMA table_info(log_templates)').all();
  if (cols.some(c => c.name === 'id')) return;
  db.transaction(() => {
    db.exec('ALTER TABLE log_templates RENAME TO log_templates_old');
    db.exec(`
      CREATE TABLE log_templates (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        log_id     TEXT NOT NULL,
        title      TEXT NOT NULL DEFAULT '',
        doc_no     TEXT NOT NULL DEFAULT '' UNIQUE,
        revision   TEXT NOT NULL DEFAULT 'rev.0',
        factory_id TEXT NOT NULL DEFAULT 'pb2',
        responsible_department TEXT NOT NULL DEFAULT '',
        responsible_departments TEXT NOT NULL DEFAULT '[]',
        interval   TEXT NOT NULL DEFAULT 'daily',
        meta_info  TEXT NOT NULL DEFAULT '{}',
        approval   TEXT NOT NULL DEFAULT '[]',
        items      TEXT NOT NULL DEFAULT '[]',
        UNIQUE(factory_id, log_id)
      )
    `);
    db.exec(`
      INSERT INTO log_templates (log_id, title, doc_no, revision, factory_id, responsible_department, responsible_departments, interval, meta_info, approval, items)
        SELECT log_id, title, doc_no, revision, factory_id, responsible_department, responsible_departments, interval, meta_info, approval, items
        FROM log_templates_old
    `);
    db.exec('DROP TABLE log_templates_old');
  })();
})();

/**
 * JSON 문자열을 안전하게 파싱한다. 실패 시 fallback 반환.
 * @param {string|null|undefined} raw
 * @param {*} fallback
 */
function safeJson(raw, fallback) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[db.safeJson] JSON 파싱 실패, fallback 반환:', String(raw).slice(0, 80));
    return fallback;
  }
}

/** 현재 로컬 시각 'YYYY-MM-DD HH:MM:SS' */
function now() {
  return db.prepare("SELECT datetime('now','localtime') AS ts").get().ts;
}

/** 오늘 로컬 날짜 'YYYY-MM-DD' */
function today() {
  return db.prepare("SELECT date('now','localtime') AS d").get().d;
}

/** 공장 목록 [{ id, name }, ...] */
function getFactories() {
  return db.prepare('SELECT factory_id as id, name FROM factories ORDER BY factory_id').all();
}

module.exports = { db, DB_PATH, UPLOAD_DIR, safeJson, now, today, getFactories };
