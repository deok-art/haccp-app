/**
 * seed.js — 초기 데이터 투입
 * 사용법:
 *   node seed.js                        → 기본 데이터만 투입
 *   node seed.js path/to/users.csv      → 사용자 CSV 투입
 *   node seed.js path/to/factories.csv  → 공장 CSV 투입
 *   node seed.js path/to/settings.csv   → 설정 CSV 투입
 *   node seed.js path/to/templates.csv  → 양식 템플릿 CSV 투입
 */

const { db, now } = require('./db');
const { ensureDefaultTemplates } = require('./ensure-default-templates');
const { ensureFactoryCalendarDefaults } = require('./factory-calendar');
const bcrypt = require('bcrypt');
const fs     = require('fs');
const path   = require('path');

function hashPassword(pw) {
  return bcrypt.hashSync(pw, 12);
}

function isAlreadyHashed(str) {
  return typeof str === 'string' && /^\$2[aby]\$/.test(str);
}

// ── CSV 파서 (의존성 없는 구현, quoted field 지원) ─────
function parseCsv(text) {
  const lines = splitCsvLines(text.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvRow(lines[0]);

  return lines.slice(1).map(line => {
    const values = parseCsvRow(line);
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = values[i] !== undefined ? values[i] : '';
    });
    return obj;
  });
}

// 큰따옴표 안의 줄바꿈을 고려한 행 분리
function splitCsvLines(text) {
  const lines = [];
  let current = '';
  let inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      inQuote = !inQuote;
      current += ch;
    } else if ((ch === '\n' || ch === '\r') && !inQuote) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      if (current.trim()) lines.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) lines.push(current);
  return lines;
}

// 한 행을 필드 배열로 파싱 (quoted field 내 쉼표/줄바꿈 처리)
function parseCsvRow(line) {
  const fields = [];
  let field = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { // escaped quote
        field += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === ',' && !inQuote) {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

// ── 기본 공장 투입 ────────────────────────────────────
function seedDefaultFactories() {
  const existing = db.prepare('SELECT COUNT(*) as cnt FROM factories').get();
  if (existing.cnt > 0) {
    console.log('factories 테이블에 이미 데이터 있음 — 건너뜀');
    return;
  }
  const insert = db.prepare('INSERT OR IGNORE INTO factories (factory_id, name) VALUES (?, ?)');
  const defaults = [
    ['pb1', '1공장(PBⅡ)'],
    ['pb2', '2공장(PBⅡ)'],
    ['pb3', '3공장(PBⅡ)'],
  ];
  const tx = db.transaction(rows => rows.forEach(([id, name]) => insert.run(id, name)));
  tx(defaults);
  console.log(`기본 공장 ${defaults.length}개 투입 완료`);
}

// ── 기본 사용자 투입 ──────────────────────────────────
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
    { id: 'admin',   name: '관리자',  factory_roles: '{"pb1":3,"pb2":3,"pb3":3}', password_hash: hashPassword('1234'), is_master: 1 },
    { id: 'worker1', name: '작업자1', factory_roles: '{"pb2":1}',                 password_hash: hashPassword('1234'), is_master: 0 },
    { id: 'review1', name: '검토자1', factory_roles: '{"pb2":2}',                 password_hash: hashPassword('1234'), is_master: 0 },
  ];

  const tx = db.transaction(rows => rows.forEach(r => insert.run(r)));
  tx(defaults);
  console.log(`기본 사용자 ${defaults.length}명 투입 완료`);
}

// ── CSV → factories 테이블 ────────────────────────────
function seedFactoriesFromCsv(filePath) {
  const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
  const insert = db.prepare('INSERT OR REPLACE INTO factories (factory_id, name) VALUES (@factory_id, @name)');
  const tx = db.transaction(rows => rows.forEach(r => insert.run(r)));
  tx(rows.map(r => ({
    factory_id: r.factoryId || r.factory_id || r['공장ID'],
    name:       r.name      || r['공장명'],
  })));
  console.log(`공장 ${rows.length}개 CSV 투입 완료`);
}

// ── CSV → settings 테이블 ─────────────────────────────
function seedSettingsFromCsv(filePath) {
  const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
  const insert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (@key, @value)');
  const SKIP_KEYS = new Set(['PhotoFolderId']); // GDrive 레거시 — DB에 저장할 필요 없음
  const filtered = rows.filter(r => !SKIP_KEYS.has(r.Key || r.key));
  const tx = db.transaction(rows => rows.forEach(r => insert.run(r)));
  tx(filtered.map(r => ({
    key:   r.Key   || r.key,
    value: r.Value || r.value || '',
  })));
  console.log(`설정 ${filtered.length}개 CSV 투입 완료 (${rows.length - filtered.length}개 건너뜀)`);
}

// ── CSV → users 테이블 ────────────────────────────────
function seedUsersFromCsv(filePath) {
  const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
  const insert = db.prepare(`
    INSERT OR REPLACE INTO users
      (id, name, factory_roles, factory_deputies, password_hash, signature, rank, is_master)
    VALUES
      (@id, @name, @factory_roles, @factory_deputies, @password_hash, @signature, @rank, @is_master)
  `);
  const tx = db.transaction(rows => rows.forEach(r => insert.run(r)));

  tx(rows.map(r => {
    const rawPw = r.PW || r.pw || r['비밀번호'] || '';
    // 이미 SHA-256 hex(64자)면 그대로 사용, 아니면 해시
    const passwordHash = isAlreadyHashed(rawPw) ? rawPw : hashPassword(rawPw || '1234');

    const rawMaster = r['마스터'] || r.isMaster || r.is_master || '';
    const isMaster = rawMaster === '1' || rawMaster === 'true' || rawMaster === 'TRUE' ? 1 : 0;

    return {
      id:               r.ID       || r.id       || r['아이디'],
      name:             r.Name     || r.name     || r['이름'],
      factory_roles:    r.Role     || r.role     || r.factory_roles  || r['공장권한'] || '{}',
      factory_deputies: r.factoryDeputies || r.factory_deputies || r['대리권한'] || '{}',
      password_hash:    passwordHash,
      signature:        r.Signature || r.signature || r['서명'] || '',
      rank:             r.Rank      || r.rank      || r['직급'] || r['직책'] || '',
      is_master:        isMaster,
    };
  }));
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
  const tx = db.transaction(rows => rows.forEach(r => insert.run(r)));
  tx(rows.map(r => ({
    log_id:     r.log_id     || r['logId'],
    title:      r.title      || r['제목'],
    doc_no:     r.doc_no     || r['문서번호'] || '',
    revision:   r.revision   || 'Rev.1',
    factory_id: r.factory_id || r['공장'] || 'pb2',
    interval:   r.interval   || 'daily',
    meta_info:  r.meta_info  || '{}',
    approval:   r.approval   || '[]',
    items:      r.items      || '[]',
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

// ── 테스트용 온도·위생 점검 템플릿 투입 ──────────────
function seedTest001Template() {
  const exists = db.prepare("SELECT 1 FROM log_templates WHERE log_id='test001'").get();
  if (exists) { console.log('test001 템플릿 이미 존재 — 건너뜀'); return; }

  const items = [
    { type:'group_header', key:'g_hygiene',   label:'위생 점검' },
    { type:'check', key:'c_hygiene',  label:'위생복 상태 (앞치마·토시 착용 여부)' },
    { type:'check', key:'c_clean',    label:'작업장 청결 (바닥·벽면·배수구)' },
    { type:'check', key:'c_foreign',  label:'이물 혼입 방지 (뚜껑 닫힘·망 설치)' },
    { type:'group_header', key:'g_cold',      label:'냉장 보관 온도' },
    { type:'temp',  key:'t_cold1',    label:'냉장고 1호기', unit:'°C', min:0,    max:10  },
    { type:'temp',  key:'t_cold2',    label:'냉장고 2호기', unit:'°C', min:0,    max:10  },
    { type:'group_header', key:'g_freeze',    label:'냉동 보관 온도' },
    { type:'temp',  key:'t_frz1',     label:'냉동고 1호기', unit:'°C', min:null, max:-18 },
    { type:'temp',  key:'t_frz2',     label:'냉동고 2호기', unit:'°C', min:null, max:-18 },
  ];

  db.prepare(`
    INSERT INTO log_templates (log_id, title, doc_no, revision, factory_id, interval, approval, items)
    VALUES ('test001','온도·위생 점검표 (테스트)','PBⅡ-TEST-01','Rev.1','pb2','daily',
      '[{"role":"작성","name":""},{"role":"검토","name":""},{"role":"승인","name":""}]',
      ?)
  `).run(JSON.stringify(items));

  console.log('test001 템플릿 투입 완료 (항목 ' + items.filter(i => i.type !== 'group_header').length + '개)');
}

// ── 조도 점검표 템플릿 투입 ───────────────────────────
function seedSi0101Template() {
  const exists = db.prepare("SELECT 1 FROM log_templates WHERE log_id='si0101'").get();
  if (exists) { console.log('si0101 템플릿 이미 존재 — 건너뜀'); return; }

  const items = [
    { type:'group_header', key:'g_crush',   label:'파쇄실' },
    { type:'numeric', key:'item_01', label:'파쇄실 - 파쇄기',         unit:'Lux', criteria:{ min:540, max:null }, required_defect_action:true },
    { type:'numeric', key:'item_02', label:'파쇄실 - 작업대1',        unit:'Lux', criteria:{ min:540, max:null }, required_defect_action:true },
    { type:'group_header', key:'g_inpack',  label:'내포장실' },
    { type:'numeric', key:'item_03', label:'내포장실 - 내포장기1',    unit:'Lux', criteria:{ min:540, max:null }, required_defect_action:true },
    { type:'numeric', key:'item_04', label:'내포장실 - 내포장기2',    unit:'Lux', criteria:{ min:540, max:null }, required_defect_action:true },
    { type:'numeric', key:'item_05', label:'내포장실 - 내포장기3',    unit:'Lux', criteria:{ min:540, max:null }, required_defect_action:true },
    { type:'numeric', key:'item_06', label:'내포장실 - 내포장기4',    unit:'Lux', criteria:{ min:540, max:null }, required_defect_action:true },
    { type:'group_header', key:'g_measure', label:'계량실' },
    { type:'numeric', key:'item_07', label:'계량실 - 전자저울',       unit:'Lux', criteria:{ min:540, max:null }, required_defect_action:true },
    { type:'group_header', key:'g_pre',     label:'전처리실' },
    { type:'numeric', key:'item_08', label:'전처리실 - 작업대1',      unit:'Lux', criteria:{ min:540, max:null }, required_defect_action:true },
    { type:'numeric', key:'item_09', label:'전처리실 - 작업대2',      unit:'Lux', criteria:{ min:540, max:null }, required_defect_action:true },
    { type:'group_header', key:'g_boil',    label:'자숙실' },
    { type:'numeric', key:'item_10', label:'자숙실 - 자숙탱크1~2호', unit:'Lux', criteria:{ min:220, max:null }, required_defect_action:true },
    { type:'numeric', key:'item_11', label:'자숙실 - 자숙탱크3~4호', unit:'Lux', criteria:{ min:220, max:null }, required_defect_action:true },
    { type:'numeric', key:'item_12', label:'자숙실 - 자숙탱크5~6호', unit:'Lux', criteria:{ min:220, max:null }, required_defect_action:true },
    { type:'numeric', key:'item_13', label:'자숙실 - 소스가열탱크',   unit:'Lux', criteria:{ min:220, max:null }, required_defect_action:true },
    { type:'group_header', key:'g_thaw',    label:'해동실' },
    { type:'numeric', key:'item_14', label:'해동실 - 고주파해동기',   unit:'Lux', criteria:{ min:220, max:null }, required_defect_action:true },
    { type:'group_header', key:'g_bleed',   label:'방혈실' },
    { type:'numeric', key:'item_15', label:'방혈실 - 방혈대차1',      unit:'Lux', criteria:{ min:220, max:null }, required_defect_action:true },
    { type:'numeric', key:'item_16', label:'방혈실 - 방혈대차2',      unit:'Lux', criteria:{ min:220, max:null }, required_defect_action:true },
    { type:'group_header', key:'g_outpack', label:'외포장실' },
    { type:'numeric', key:'item_17', label:'외포장실 - 멸균기',       unit:'Lux', criteria:{ min:220, max:null }, required_defect_action:true },
    { type:'numeric', key:'item_18', label:'외포장실 - 제수기',       unit:'Lux', criteria:{ min:220, max:null }, required_defect_action:true },
    { type:'numeric', key:'item_19', label:'외포장실 - 제함기',       unit:'Lux', criteria:{ min:220, max:null }, required_defect_action:true },
    { type:'group_header', key:'g_ship',    label:'입·출고장' },
    { type:'numeric', key:'item_20', label:'입·출고장 - 검수위치',    unit:'Lux', criteria:{ min:540, max:null }, required_defect_action:true },
    { type:'group_header', key:'g_cold',    label:'냉장·냉동창고' },
    { type:'numeric', key:'item_21', label:'냉장창고 - 중앙',         unit:'Lux', criteria:{ min:110, max:null }, required_defect_action:true },
    { type:'numeric', key:'item_22', label:'냉동창고 - 중앙',         unit:'Lux', criteria:{ min:110, max:null }, required_defect_action:true },
    { type:'group_header', key:'g_sauce',   label:'소스저장실' },
    { type:'numeric', key:'item_23', label:'소스저장실 - 중앙',       unit:'Lux', criteria:{ min:110, max:null }, required_defect_action:true },
    { type:'group_header', key:'g_lab',     label:'실험실' },
    { type:'numeric', key:'item_24', label:'실험실 - 클린벤치',       unit:'Lux', criteria:{ min:540, max:null }, required_defect_action:true },
  ];

  db.prepare(`
    INSERT INTO log_templates (log_id, title, doc_no, revision, factory_id, interval, approval, items)
    VALUES ('si0101','조도 점검표','PBⅡ-SI-01-01','Rev.1','pb2','monthly',
      '[{"role":"작성","name":""},{"role":"검토","name":""},{"role":"승인","name":""}]',
      ?)
  `).run(JSON.stringify(items));

  console.log('si0101 템플릿 투입 완료 (항목 24개)');
}

// ── 진입점 ────────────────────────────────────────────
const arg = process.argv[2];

if (arg && fs.existsSync(arg)) {
  const ext = path.extname(arg).toLowerCase();
  if (ext !== '.csv') { console.error('CSV 파일만 지원합니다.'); process.exit(1); }

  const basename = path.basename(arg, '.csv').toLowerCase();
  if (basename.includes('user') || basename.includes('사용자')) {
    seedUsersFromCsv(arg);
  } else if (basename.includes('factor') || basename.includes('공장')) {
    seedFactoriesFromCsv(arg);
  } else if (basename.includes('setting') || basename.includes('설정')) {
    seedSettingsFromCsv(arg);
  } else if (basename.includes('template') || basename.includes('양식')) {
    seedTemplatesFromCsv(arg);
  } else {
    console.error('파일명에 "user", "factor", "setting", "template" 중 하나가 포함되어야 합니다.');
    process.exit(1);
  }
} else {
  seedDefaultFactories();
  seedDefaultUsers();
  seedSi0201Template();
  seedTest001Template();
  seedSi0101Template();
  ensureDefaultTemplates(db);
  ensureFactoryCalendarDefaults(db);
}

console.log('✓ 시드 완료');
