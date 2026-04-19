-- HACCP 스마트 관리 시스템 v3.0 — SQLite 스키마
-- 기존 Google Sheets 구조를 SQL 테이블로 변환

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ── 사용자 ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  factory_roles  TEXT NOT NULL DEFAULT '{}',   -- JSON: {"pb2":3,"pb1":1}
  factory_deputies TEXT NOT NULL DEFAULT '{}', -- JSON: {"pb2":2}  대리 원복 데이터
  password_hash  TEXT NOT NULL DEFAULT '',
  signature      TEXT NOT NULL DEFAULT '',     -- Base64 canvas 서명
  rank           TEXT NOT NULL DEFAULT '',     -- 직급 (예: 생산1팀 팀장)
  is_master      INTEGER NOT NULL DEFAULT 0,   -- 1이면 마스터 관리자
  created_at     TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ── 레코드 (일지) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS records (
  record_id     TEXT PRIMARY KEY,
  log_id        TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  date          TEXT NOT NULL,               -- yyyy-MM-dd
  writer_id     TEXT NOT NULL DEFAULT '',
  writer_name   TEXT NOT NULL DEFAULT '',
  reviewer_id   TEXT NOT NULL DEFAULT '',
  reviewer_name TEXT NOT NULL DEFAULT '',
  approver_id   TEXT NOT NULL DEFAULT '',
  approver_name TEXT NOT NULL DEFAULT '',
  status        TEXT NOT NULL DEFAULT '미작성',
  defect_info   TEXT NOT NULL DEFAULT '',
  data_json     TEXT NOT NULL DEFAULT '{}',  -- 양식 내용 JSON
  factory_id    TEXT NOT NULL DEFAULT 'pb2',
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX IF NOT EXISTS idx_records_factory_date ON records(factory_id, date);
CREATE INDEX IF NOT EXISTS idx_records_log_status   ON records(log_id, status);
CREATE INDEX IF NOT EXISTS idx_records_factory_log  ON records(factory_id, log_id, date);

-- ── 동적 양식 템플릿 ──────────────────────────────────
CREATE TABLE IF NOT EXISTS log_templates (
  log_id      TEXT PRIMARY KEY,
  title       TEXT NOT NULL DEFAULT '',
  doc_no      TEXT NOT NULL DEFAULT '',
  revision    TEXT NOT NULL DEFAULT 'Rev.1',
  factory_id  TEXT NOT NULL DEFAULT 'pb2',
  interval    TEXT NOT NULL DEFAULT 'daily',  -- daily|weekly|monthly
  meta_info   TEXT NOT NULL DEFAULT '{}',     -- JSON (period, location 등)
  approval    TEXT NOT NULL DEFAULT '[]',     -- JSON 결재란 배열
  items       TEXT NOT NULL DEFAULT '[]'      -- JSON 항목 배열 (flat)
);

-- ── 대리인 (Deputy) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS deputies (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  factory_id  TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  role        INTEGER NOT NULL,
  expires_at  TEXT                             -- NULL이면 만료 없음
);
