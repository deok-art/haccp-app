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

module.exports = { db, DB_PATH, UPLOAD_DIR, safeJson, now, today };
