/**
 * seed.js — 초기 데이터 투입
 * 사용법:
 *   node seed.js               → 기본 데이터만 투입
 *   node seed.js users.csv     → 사용자 CSV 투입
 *   node seed.js templates.csv → 양식 템플릿 CSV 투입
 */

const { db, now } = require('./db');
const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

// ── CSV 파서 (의존성 없는 간단 구현) ──────────────────────
function parseCsv(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).map(line => {
    const values = line.match(/(".*?"|[^,]+|(?<=,)(?=,)|(?<=,)$|^(?=,))/g) || [];
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (values[i] || '').trim().replace(/^"|"$/g, '');
    });
    return obj;
  });
}

// ── 기본 사용자 투입 ──────────────────────────────────────
function seedDefaultUsers() {
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  if (existing.cnt > 0) {
    console.log('users 테이블에 이미 데이터 있음 — 건너뜀');
    return;
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO users (id, name, factory_roles, password_hash, is_master)
    VALUES (@id, @name, @factory_roles, @password_hash, @is_master)
  `);

  const defaults = [
    { id: 'admin',   name: '관리자',   factory_roles: '{"pb1":3,"pb2":3}', password_hash: hashPassword('1234'), is_master: 1 },
    { id: 'worker1', name: '작업자1',  factory_roles: '{"pb2":1}',         password_hash: hashPassword('1234'), is_master: 0 },
    { id: 'review1', name: '검토자1',  factory_roles: '{"pb2":2}',         password_hash: hashPassword('1234'), is_master: 0 },
  ];

  const insertMany = db.transaction(rows => rows.forEach(r => insert.run(r)));
  insertMany(defaults);
  console.log(`기본 사용자 ${defaults.length}명 투입 완료`);
}

// ── CSV → users 테이블 ─────────────────────────────────
function seedUsersFromCsv(filePath) {
  const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
  const insert = db.prepare(`
    INSERT OR REPLACE INTO users (id, name, factory_roles, password_hash)
    VALUES (@id, @name, @factory_roles, @password_hash)
  `);
  const insertMany = db.transaction(rows => rows.forEach(r => insert.run(r)));
  insertMany(rows.map(r => ({
    id:            r.id || r['아이디'],
    name:          r.name || r['이름'],
    factory_roles: r.factory_roles || r['공장권한'] || '{"pb2":1}',
    password_hash: hashPassword(r.password || r['비밀번호'] || '1234'),
  })));
  console.log(`사용자 ${rows.length}명 CSV 투입 완료`);
}

// ── CSV → log_templates 테이블 ────────────────────────
function seedTemplatesFromCsv(filePath) {
  const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
  const insert = db.prepare(`
    INSERT OR REPLACE INTO log_templates
      (log_id, title, doc_no, revision, factory_id, interval, meta_info, approval, items)
    VALUES
      (@log_id, @title, @doc_no, @revision, @factory_id, @interval, @meta_info, @approval, @items)
  `);
  const insertMany = db.transaction(rows => rows.forEach(r => insert.run(r)));
  insertMany(rows.map(r => ({
    log_id:     r.log_id || r['logId'],
    title:      r.title  || r['제목'],
    doc_no:     r.doc_no || r['문서번호'] || '',
    revision:   r.revision || 'Rev.1',
    factory_id: r.factory_id || r['공장'] || 'pb2',
    interval:   r.interval || 'daily',
    meta_info:  r.meta_info || '{}',
    approval:   r.approval  || '[]',
    items:      r.items     || '[]',
  })));
  console.log(`양식 템플릿 ${rows.length}개 CSV 투입 완료`);
}

// ── si0201 기본 템플릿 투입 ────────────────────────────
function seedSi0201Template() {
  const exists = db.prepare("SELECT 1 FROM log_templates WHERE log_id='si0201'").get();
  if (exists) { console.log('si0201 템플릿 이미 존재 — 건너뜀'); return; }

  const items = [
    { type:'group_header', key:'g_common',    label:'공통' },
    { type:'check', key:'c_hygiene',  label:'위생복 — 앞치마·토시 등 이물 발생 확인' },
    { type:'check', key:'c_pest',     label:'방충·방서 — 포충등·트랩 이상 여부' },
    { type:'check', key:'c_equip',    label:'설비/도구 — 작업·청소도구 파손 여부' },
    { type:'check', key:'c_clean',    label:'위생점검 — Clean time 2회/일 실시 여부' },
    { type:'group_header', key:'g_in',        label:'입고' },
    { type:'check', key:'in_exterior', label:'외관 — 이물 및 외포장 상태 확인' },
    { type:'check', key:'in_equip',    label:'작업설비 — 파렛트 파손 여부 확인' },
    { type:'check', key:'in_etc',      label:'기타 — 외부 출입 도크 밀폐 여부' },
    { type:'group_header', key:'g_store',     label:'보관' },
    { type:'check', key:'st_cold', label:'냉장·냉동보관 — 이물 혼입 여부 확인' },
    { type:'check', key:'st_tool', label:'도구 — 이동도구·파렛트 파손 여부' },
    { type:'group_header', key:'g_thaw',      label:'해동' },
    { type:'check', key:'th_raw',   label:'원재료 — 외포장 이물 제거 확인' },
    { type:'check', key:'th_equip', label:'설비/도구 — 고주파해동기 청결·파손 확인' },
    { type:'group_header', key:'g_bleed',     label:'방혈' },
    { type:'check', key:'bl_raw',   label:'원재료 — 내포장 청결·이물 확인' },
    { type:'check', key:'bl_equip', label:'설비/도구 — 해동 대차 청결·파손 확인' },
    { type:'group_header', key:'g_pre',       label:'전처리' },
    { type:'check', key:'pr_raw',  label:'원재료 — 비가식부·이물 제거 확인' },
    { type:'check', key:'pr_pack', label:'포장재 — 내포장재 조각·이물 유입 확인' },
    { type:'group_header', key:'g_boil',      label:'자숙' },
    { type:'check', key:'bo_raw',   label:'원재료 — 이물 유입·작업환경 확인' },
    { type:'check', key:'bo_equip', label:'설비/도구 — 자숙탱크 청결·파손 확인' },
    { type:'group_header', key:'g_crush',     label:'파쇄' },
    { type:'check', key:'cr_raw',   label:'원재료 — 규격·이물 유입 확인' },
    { type:'check', key:'cr_equip', label:'설비/도구 — 파쇄기 청결·파손 확인' },
    { type:'group_header', key:'g_smeasure',  label:'(소스)계량' },
    { type:'check', key:'sm_sub',   label:'부재료 — 이물 유입·작업환경 확인' },
    { type:'check', key:'sm_equip', label:'설비/도구 — 자숙탱크 청결·파손 확인' },
    { type:'group_header', key:'g_sheat',     label:'(소스)배합/가열' },
    { type:'check', key:'sh_sub',   label:'부재료 — 이물 유입·작업환경 확인' },
    { type:'check', key:'sh_equip', label:'설비/도구 — 배합탱크 청결·파손 확인' },
    { type:'group_header', key:'g_inpack',    label:'내포장' },
    { type:'check', key:'ip_raw',    label:'원재료 — 충진 이물·작업환경 확인' },
    { type:'check', key:'ip_equip1', label:'설비/도구 — 내·외부 이물제거 청소상태' },
    { type:'check', key:'ip_equip2', label:'설비/도구 — 정상작동·부식·마모 여부' },
    { type:'check', key:'ip_pack',   label:'포장재 — 파손·이물 유입 확인' },
    { type:'group_header', key:'g_xray',      label:'X-ray 검출' },
    { type:'check', key:'xr_equip1', label:'설비/도구 — 내·외부 이물제거 청소상태' },
    { type:'check', key:'xr_equip2', label:'설비/도구 — 정상작동·부식·마모 여부' },
    { type:'group_header', key:'g_weight',    label:'중량선별' },
    { type:'check', key:'ws_equip1', label:'설비/도구 — 내·외부 이물제거 청소상태' },
    { type:'check', key:'ws_equip2', label:'설비/도구 — 정상작동·부식·마모 여부' },
    { type:'group_header', key:'g_steril',    label:'멸균/살균' },
    { type:'check', key:'st2_equip1', label:'설비/도구 — 내·외부 이물제거 청소상태' },
    { type:'check', key:'st2_equip2', label:'설비/도구 — 정상작동·부식·마모 여부' },
    { type:'group_header', key:'g_drain',     label:'제수' },
    { type:'check', key:'dr_equip1', label:'설비/도구 — 내·외부 이물제거 청소상태' },
    { type:'check', key:'dr_equip2', label:'설비/도구 — 정상작동·부식·마모 여부' },
    { type:'group_header', key:'g_outpack',   label:'외포장' },
    { type:'check', key:'op_equip1', label:'설비/도구 — 내·외부 이물제거 청소상태' },
    { type:'check', key:'op_equip2', label:'설비/도구 — 정상작동·부식·마모 여부' },
    { type:'group_header', key:'g_finished',  label:'완제품보관' },
    { type:'check', key:'fp_product', label:'완제품 — 구획·식별·적재 기준 확인' },
    { type:'check', key:'fp_env',     label:'환경 — 보관기준(온도·청결) 확인' },
    { type:'check', key:'fp_equip',   label:'설비/도구 — 파렛트 파손·청결 확인' },
    { type:'group_header', key:'g_ship',      label:'출하' },
    { type:'check', key:'sh2_equip', label:'설비/도구 — 운반기구·차량 청결상태 확인' },
    { type:'check', key:'sh2_pack',  label:'포장재 — 포장재 파손 여부 확인' },
  ];

  db.prepare(`
    INSERT INTO log_templates (log_id, title, doc_no, revision, factory_id, interval, approval, items)
    VALUES ('si0201','이물관리 점검표','PBⅡ-SI-02-01','Rev.1','pb2','daily',
      '[{"role":"작성","name":""},{"role":"검토","name":""},{"role":"승인","name":""}]',
      ?)
  `).run(JSON.stringify(items));

  console.log('si0201 템플릿 투입 완료 (항목 ' + items.filter(i => i.type === 'check').length + '개)');
}

// ── 진입점 ────────────────────────────────────────────
const arg = process.argv[2];

if (arg && fs.existsSync(arg)) {
  const ext = path.extname(arg).toLowerCase();
  if (ext !== '.csv') { console.error('CSV 파일만 지원합니다.'); process.exit(1); }

  const basename = path.basename(arg, '.csv').toLowerCase();
  if (basename.includes('user') || basename.includes('사용자')) {
    seedUsersFromCsv(arg);
  } else if (basename.includes('template') || basename.includes('양식')) {
    seedTemplatesFromCsv(arg);
  } else {
    console.error('파일명에 "user" 또는 "template" 이 포함되어야 합니다.');
    process.exit(1);
  }
} else {
  seedDefaultUsers();
  seedSi0201Template();
}

console.log('✓ 시드 완료');
