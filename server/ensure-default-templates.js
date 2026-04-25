const FOREIGN_MATTER_SPEC = require('../docs/spec_forms/이물관리점검표.json');
const PEST_CONTROL_SPEC = require('../docs/spec_forms/0203 방충방서.json');
const WORKPLACE_HYGIENE_TEMP_SPEC = require('../docs/spec_forms/작업장 위생 및 온도 점검표.json');

const SI0102_WEEKLY_PRINT_LOG_IDS = ['si0102vs', 'si0102wc', 'si0102dr'];

// 비래해충 포집장치 (P5 타입) — 7대
const SI0203_P5_DEVICES = [
  { key: 'p5_01', label: 'P5-01 위생전실' },
  { key: 'p5_02', label: 'P5-02 해동실' },
  { key: 'p5_03', label: 'P5-03 전처리실' },
  { key: 'p5_04', label: 'P5-04 자숙실' },
  { key: 'p5_05', label: 'P5-05 내포장실' },
  { key: 'p5_06', label: 'P5-06 외포장실' },
  { key: 'p5_07', label: 'P5-07 복도' },
];

// 보행해충 포집장치 (B1 타입) — 6대
const SI0203_B1_DEVICES = [
  { key: 'b1_01', label: 'B1-01 방풍실1' },
  { key: 'b1_02', label: 'B1-02 방풍실2' },
  { key: 'b1_03', label: 'B1-03 위생전실' },
  { key: 'b1_04', label: 'B1-04 해동실' },
  { key: 'b1_05', label: 'B1-05 전처리실' },
  { key: 'b1_06', label: 'B1-06 외포장실' },
];

// 설치류 포획장치 (S3 타입) — 8대
const SI0203_S3_DEVICES = [
  { key: 's3_01', label: 'S3-01 영업장' },
  { key: 's3_02', label: 'S3-02 원료창고' },
  { key: 's3_03', label: 'S3-03 냉동창고' },
  { key: 's3_04', label: 'S3-04 냉장창고' },
  { key: 's3_05', label: 'S3-05 자숙실' },
  { key: 's3_06', label: 'S3-06 전처리실' },
  { key: 's3_07', label: 'S3-07 외포장실' },
  { key: 's3_08', label: 'S3-08 복도' },
];

// 설치류 먹이/포획장치 (S2 타입) — 6대
const SI0203_S2_DEVICES = [
  { key: 's2_01', label: 'S2-01 위생전실' },
  { key: 's2_02', label: 'S2-02 해동실' },
  { key: 's2_03', label: 'S2-03 전처리실' },
  { key: 's2_04', label: 'S2-04 자숙실' },
  { key: 's2_05', label: 'S2-05 내포장실' },
  { key: 's2_06', label: 'S2-06 외포장실' },
];
const SI0202_ROOM_KEY_MAP = {
  해동실: 'thaw',
  방혈실: 'bleed',
  전처리실: 'preprocess',
  계량실: 'measure',
  자숙실: 'boil',
  파쇄실: 'crush',
  내포장실: 'inner_pack',
  외포장실: 'outer_pack',
  냉장실: 'cold_storage',
};

function buildApprovalLine() {
  return JSON.stringify([
    { role: '작성', name: '' },
    { role: '검토', name: '' },
    { role: '승인', name: '' },
  ]);
}

function buildMetaInfo() {
  return JSON.stringify({ period: '1주' });
}

function buildSi0101Template() {
  return {
    log_id: 'si0101',
    title: '조도 점검표',
    doc_no: 'PBⅡ-SI-01-01',
    revision: 'Rev.1',
    factory_id: 'pb2',
    interval: 'monthly',
    meta_info: JSON.stringify({ period: '월 1회' }),
    approval: buildApprovalLine(),
    items: JSON.stringify([
      { type: 'group_header', key: 'g_crush', label: '파쇄실' },
      { type: 'numeric', key: 'item_01', label: '파쇄실 - 파쇄기', unit: 'Lux', criteria: { min: 540, max: null }, required_defect_action: true },
      { type: 'numeric', key: 'item_02', label: '파쇄실 - 작업대1', unit: 'Lux', criteria: { min: 540, max: null }, required_defect_action: true },
      { type: 'group_header', key: 'g_inpack', label: '내포장실' },
      { type: 'numeric', key: 'item_03', label: '내포장실 - 내포장기1', unit: 'Lux', criteria: { min: 540, max: null }, required_defect_action: true },
      { type: 'numeric', key: 'item_04', label: '내포장실 - 내포장기2', unit: 'Lux', criteria: { min: 540, max: null }, required_defect_action: true },
      { type: 'numeric', key: 'item_05', label: '내포장실 - 내포장기3', unit: 'Lux', criteria: { min: 540, max: null }, required_defect_action: true },
      { type: 'numeric', key: 'item_06', label: '내포장실 - 내포장기4', unit: 'Lux', criteria: { min: 540, max: null }, required_defect_action: true },
      { type: 'group_header', key: 'g_measure', label: '계량실' },
      { type: 'numeric', key: 'item_07', label: '계량실 - 전자저울', unit: 'Lux', criteria: { min: 540, max: null }, required_defect_action: true },
      { type: 'group_header', key: 'g_pre', label: '전처리실' },
      { type: 'numeric', key: 'item_08', label: '전처리실 - 작업대1', unit: 'Lux', criteria: { min: 540, max: null }, required_defect_action: true },
      { type: 'numeric', key: 'item_09', label: '전처리실 - 작업대2', unit: 'Lux', criteria: { min: 540, max: null }, required_defect_action: true },
      { type: 'group_header', key: 'g_boil', label: '자숙실' },
      { type: 'numeric', key: 'item_10', label: '자숙실 - 자숙탱크1~2호', unit: 'Lux', criteria: { min: 220, max: null }, required_defect_action: true },
      { type: 'numeric', key: 'item_11', label: '자숙실 - 자숙탱크3~4호', unit: 'Lux', criteria: { min: 220, max: null }, required_defect_action: true },
      { type: 'numeric', key: 'item_12', label: '자숙실 - 자숙탱크5~6호', unit: 'Lux', criteria: { min: 220, max: null }, required_defect_action: true },
      { type: 'numeric', key: 'item_13', label: '자숙실 - 소스가열탱크', unit: 'Lux', criteria: { min: 220, max: null }, required_defect_action: true },
      { type: 'group_header', key: 'g_thaw', label: '해동실' },
      { type: 'numeric', key: 'item_14', label: '해동실 - 고주파해동기', unit: 'Lux', criteria: { min: 220, max: null }, required_defect_action: true },
      { type: 'group_header', key: 'g_bleed', label: '방혈실' },
      { type: 'numeric', key: 'item_15', label: '방혈실 - 방혈대차1', unit: 'Lux', criteria: { min: 220, max: null }, required_defect_action: true },
      { type: 'numeric', key: 'item_16', label: '방혈실 - 방혈대차2', unit: 'Lux', criteria: { min: 220, max: null }, required_defect_action: true },
      { type: 'group_header', key: 'g_outpack', label: '외포장실' },
      { type: 'numeric', key: 'item_17', label: '외포장실 - 멸균기', unit: 'Lux', criteria: { min: 220, max: null }, required_defect_action: true },
      { type: 'numeric', key: 'item_18', label: '외포장실 - 제수기', unit: 'Lux', criteria: { min: 220, max: null }, required_defect_action: true },
      { type: 'numeric', key: 'item_19', label: '외포장실 - 제함기', unit: 'Lux', criteria: { min: 220, max: null }, required_defect_action: true },
      { type: 'group_header', key: 'g_ship', label: '입·출고장' },
      { type: 'numeric', key: 'item_20', label: '입·출고장 - 검수위치', unit: 'Lux', criteria: { min: 540, max: null }, required_defect_action: true },
      { type: 'group_header', key: 'g_cold', label: '냉장·냉동창고' },
      { type: 'numeric', key: 'item_21', label: '냉장창고 - 중앙', unit: 'Lux', criteria: { min: 110, max: null }, required_defect_action: true },
      { type: 'numeric', key: 'item_22', label: '냉동창고 - 중앙', unit: 'Lux', criteria: { min: 110, max: null }, required_defect_action: true },
      { type: 'group_header', key: 'g_sauce', label: '소스저장실' },
      { type: 'numeric', key: 'item_23', label: '소스저장실 - 중앙', unit: 'Lux', criteria: { min: 110, max: null }, required_defect_action: true },
      { type: 'group_header', key: 'g_lab', label: '실험실' },
      { type: 'numeric', key: 'item_24', label: '실험실 - 클린벤치', unit: 'Lux', criteria: { min: 540, max: null }, required_defect_action: true },
    ]),
  };
}

function buildSi0102Templates() {
  return [
    {
      log_id: 'si0102vs',
      title: '부대시설 위생점검일지 (위생전실)',
      doc_no: 'PBⅡ-SI-01-02-VS',
      revision: 'Rev.1',
      factory_id: 'pb2',
      interval: 'daily',
      meta_info: buildMetaInfo(),
      approval: buildApprovalLine(),
      items: JSON.stringify([
        { type: 'group_header', key: 'g_gen', label: '일반환경' },
        { type: 'check', key: 'vs_gen_01', label: '바닥: 이물 및 청소상태', required_defect_action: true },
        { type: 'check', key: 'vs_gen_02', label: '벽면: 파손 및 오염 청소상태', required_defect_action: true },
        { type: 'check', key: 'vs_gen_03', label: '천정: 거미줄 및 먼지 청소상태', required_defect_action: true },
        { type: 'check', key: 'vs_gen_04', label: '출입문 및 손잡이: 청결상태', required_defect_action: true },
        { type: 'check', key: 'vs_gen_05', label: '환기시설: 가동상태 및 청결상태', required_defect_action: true },
        { type: 'check', key: 'vs_gen_06', label: '에어커튼 필터: 청소상태', required_defect_action: true },
        { type: 'check', key: 'vs_gen_07', label: '조명: 점등상태 및 청결상태', required_defect_action: true },
        { type: 'group_header', key: 'g_fac', label: '시설설비' },
        { type: 'check', key: 'vs_fac_01', label: '세척조: 급배수 및 청결상태', required_defect_action: true },
        { type: 'check', key: 'vs_fac_02', label: '건조기: 가동상태 및 청결상태', required_defect_action: true },
        { type: 'check', key: 'vs_fac_03', label: '소독기: 가동상태 및 충진상태', required_defect_action: true },
        { type: 'check', key: 'vs_fac_04', label: '에어샤워기: 가동상태 및 내부 청결상태', required_defect_action: true },
        { type: 'check', key: 'vs_fac_05', label: '에어샤워기: 노즐 및 토출구 청결상태', required_defect_action: true },
        { type: 'check', key: 'vs_fac_06', label: '자동손세정기: 급배수 및 청결상태', required_defect_action: true },
        { type: 'check', key: 'vs_fac_07', label: '자동소독기: 가동상태 및 청결상태', required_defect_action: true },
        { type: 'check', key: 'vs_fac_08', label: '앞치마 보관대: 가동상태 및 청결상태', required_defect_action: true },
        { type: 'group_header', key: 'g_sup', label: '위생용품' },
        { type: 'check', key: 'vs_sup_01', label: '손세정제: 충진 및 용기 위생상태', required_defect_action: true },
        { type: 'check', key: 'vs_sup_02', label: '위생 롤러: 비치 및 청결상태', required_defect_action: true },
        { type: 'group_header', key: 'g_etc', label: '기타' },
        { type: 'check', key: 'vs_etc_01', label: '발판: 파손 및 청결상태', required_defect_action: true },
        { type: 'check', key: 'vs_etc_02', label: '쓰레기통: 정리정돈 및 청결상태', required_defect_action: true },
        { type: 'check', key: 'vs_etc_03', label: '반입관리: 비식품 보관 및 폐기물 분리상태', required_defect_action: true },
      ]),
    },
    {
      log_id: 'si0102wc',
      title: '부대시설 위생점검일지 (화장실)',
      doc_no: 'PBⅡ-SI-01-02-WC',
      revision: 'Rev.1',
      factory_id: 'pb2',
      interval: 'daily',
      meta_info: buildMetaInfo(),
      approval: buildApprovalLine(),
      items: JSON.stringify([
        { type: 'group_header', key: 'g_gen', label: '일반환경' },
        { type: 'check', key: 'wc_gen_01', label: '바닥/벽면/천정: 청결상태', required_defect_action: true },
        { type: 'check', key: 'wc_gen_02', label: '출입구 및 환기시설/에어컨/조명: 가동 및 청결상태', required_defect_action: true },
        { type: 'check', key: 'wc_gen_03', label: '창문: 방충망 관리 및 청결상태', required_defect_action: true },
        { type: 'group_header', key: 'g_fac', label: '시설설비' },
        { type: 'check', key: 'wc_fac_01', label: '세척조: 급배수 및 청결상태', required_defect_action: true },
        { type: 'check', key: 'wc_fac_02', label: '건조기: 가동상태 및 청결상태', required_defect_action: true },
        { type: 'check', key: 'wc_fac_03', label: '소독기: 가동상태 및 청결상태', required_defect_action: true },
        { type: 'check', key: 'wc_fac_04', label: '변기 및 소변기: 급배수 이상 유무', required_defect_action: true },
        { type: 'check', key: 'wc_fac_05', label: '변기 및 소변기: 악취 발생 및 청소상태', required_defect_action: true },
        { type: 'check', key: 'wc_fac_06', label: '자동소독기/앞치마 보관대: 가동 및 청결상태', required_defect_action: true },
        { type: 'group_header', key: 'g_sup', label: '위생용품' },
        { type: 'check', key: 'wc_sup_01', label: '손세정제: 충진 및 용기 위생상태', required_defect_action: true },
        { type: 'check', key: 'wc_sup_02', label: '휴지: 비치상태', required_defect_action: true },
        { type: 'group_header', key: 'g_etc', label: '기타' },
        { type: 'check', key: 'wc_etc_01', label: '실내화: 구역 구분 사용 및 청결상태', required_defect_action: true },
        { type: 'check', key: 'wc_etc_02', label: '쓰레기통: 정리정돈 및 청결상태', required_defect_action: true },
        { type: 'check', key: 'wc_etc_03', label: '청소도구 보관함: 정리정돈 및 청결상태', required_defect_action: true },
      ]),
    },
    {
      log_id: 'si0102dr',
      title: '부대시설 위생점검일지 (탈의실)',
      doc_no: 'PBⅡ-SI-01-02-DR',
      revision: 'Rev.1',
      factory_id: 'pb2',
      interval: 'daily',
      meta_info: buildMetaInfo(),
      approval: buildApprovalLine(),
      items: JSON.stringify([
        { type: 'group_header', key: 'g_lounge', label: '휴게실' },
        { type: 'check', key: 'dr_lounge_01', label: '휴게실 바닥: 이물 및 청소상태', required_defect_action: true },
        { type: 'check', key: 'dr_lounge_02', label: '휴게실 조명/에어컨/환기시설: 가동 및 청결상태', required_defect_action: true },
        { type: 'check', key: 'dr_lounge_03', label: '휴게실 사물함: 위생복 보관 및 청소상태', required_defect_action: true },
        { type: 'group_header', key: 'g_room', label: '대기실' },
        { type: 'check', key: 'dr_room_01', label: '대기실 바닥/벽면/천정/출입구: 청결상태', required_defect_action: true },
        { type: 'check', key: 'dr_room_02', label: '대기실 환기시설/에어컨/조명: 가동 및 청결상태', required_defect_action: true },
        { type: 'group_header', key: 'g_shower', label: '탈의·샤워실' },
        { type: 'check', key: 'dr_shower_01', label: '탈의실 바닥: 파손 및 청소상태', required_defect_action: true },
        { type: 'check', key: 'dr_shower_02', label: '배수로: 이물 잔존 및 청소상태', required_defect_action: true },
        { type: 'check', key: 'dr_shower_03', label: '샤워시설: 급수, 분무, 잠금 불량 상태', required_defect_action: true },
        { type: 'check', key: 'dr_shower_04', label: '실내화 및 외부화 구분관리와 청결상태', required_defect_action: true },
        { type: 'check', key: 'dr_shower_05', label: '손세정제 비치 및 용기 청결상태', required_defect_action: true },
        { type: 'group_header', key: 'g_etc', label: '기타' },
        { type: 'check', key: 'dr_etc_01', label: '쓰레기통: 정리정돈 및 청결상태', required_defect_action: true },
        { type: 'check', key: 'dr_etc_02', label: '반입금지 품목 보관 유무', required_defect_action: true },
      ]),
    },
  ];
}

function buildGroupedItems(groups) {
  const items = [];
  groups.forEach(group => {
    items.push({ type: 'group_header', key: group.key, label: group.label });
    group.items.forEach(item => {
      items.push({ required_defect_action: true, ...item });
    });
  });
  return JSON.stringify(items);
}

function buildGroupedChecklistItems(groups) {
  return buildGroupedItems(groups.map(group => ({
    key: group.key,
    label: group.label,
    items: group.items.map(item => ({
      type: 'check',
      key: item.key,
      label: item.label,
    })),
  })));
}

function buildCategoryChecklistItems(rows) {
  const groups = [];
  rows.forEach(row => {
    let group = groups.find(entry => entry.label === row.category);
    if (!group) {
      group = {
        key: 'g_' + String(groups.length + 1).padStart(2, '0'),
        label: row.category,
        items: [],
      };
      groups.push(group);
    }
    group.items.push({ key: row.key, label: row.label });
  });
  return buildGroupedChecklistItems(groups);
}

function buildSi0201Template() {
  const spec = FOREIGN_MATTER_SPEC;
  return {
    log_id: 'si0201',
    title: spec.doc_info.title,
    doc_no: spec.doc_info.doc_no,
    revision: spec.doc_info.rev_no,
    factory_id: 'pb2',
    interval: 'daily',
    meta_info: JSON.stringify({ period: spec.doc_info.period }),
    approval: buildApprovalLine(),
    items: buildCategoryChecklistItems(
      (spec.items || []).map(item => ({
        key: item.key,
        category: item.category,
        label: item.label,
      }))
    ),
  };
}

function buildSi0202Template() {
  const spec = WORKPLACE_HYGIENE_TEMP_SPEC;
  const tempItem = spec.items.find(item => item.type === 'numeric');
  const roomOrder = (tempItem && tempItem.target_rooms) || [];

  const groups = roomOrder.map((room, roomIndex) => {
    const roomKey = SI0202_ROOM_KEY_MAP[room] || `room_${String(roomIndex + 1).padStart(2, '0')}`;
    const items = spec.items
      .filter(item => (item.target_rooms || []).includes(room))
      .map(item => {
        if (item.type === 'numeric') {
          return {
            type: 'numeric',
            key: `${item.key}_${roomKey}`,
            label: item.label,
            unit: '℃',
            criteria: {
              min: null,
              max: item.criteria_mapping ? item.criteria_mapping[room] : null,
            },
          };
        }

        return {
          type: 'check',
          key: `${item.key}_${roomKey}`,
          label: item.label,
        };
      });

    return {
      key: `g_${roomKey}`,
      label: room,
      items,
    };
  }).filter(group => group.items.length);

  return {
    log_id: 'si0202',
    title: spec.doc_info.title,
    doc_no: spec.doc_info.doc_no,
    revision: spec.doc_info.rev_no,
    factory_id: 'pb2',
    interval: 'daily',
    meta_info: JSON.stringify({ period: spec.doc_info.period, location: '작업장' }),
    approval: buildApprovalLine(),
    items: buildGroupedItems(groups),
  };
}

function buildP5DeviceItems(deviceKey) {
  var flyingCounter = function(subKey, label) {
    return { type: 'numeric', key: subKey + '_' + deviceKey, label: label, unit: '마리', criteria: { min: 0, max: null }, input_mode: 'counter', default_value: '0', quick_values: [0, 1, 2, 3, 5], pest_type: 'flying' };
  };
  return [
    flyingCounter('ggaldagu', '깔다구'),
    flyingCounter('mogi', '모기'),
    flyingCounter('pari', '파리'),
    flyingCounter('nalpari', '날파리'),
    flyingCounter('nabang', '나방'),
    flyingCounter('etc_fly', '기타(비래)'),
    { type: 'select', key: `power_${deviceKey}`, label: '포충등 전원', options: ['적합', '부적합'], required_defect_action: true },
    { type: 'select', key: `clean_${deviceKey}`, label: '포충등 청소', options: ['적합', '부적합'], required_defect_action: true },
    { type: 'select', key: `uv_${deviceKey}`, label: 'UV등/커버', options: ['적합', '부적합'], required_defect_action: true },
  ];
}

function buildB1DeviceItems(deviceKey) {
  var crawlCounter = function(subKey, label) {
    return { type: 'numeric', key: subKey + '_' + deviceKey, label: label, unit: '마리', criteria: { min: 0, max: null }, input_mode: 'counter', default_value: '0', quick_values: [0, 1, 2, 3, 5], pest_type: 'crawling' };
  };
  return [
    crawlCounter('gaemi', '개미'),
    crawlCounter('grima', '그리마'),
    crawlCounter('gwittu', '귀뚜라미'),
    crawlCounter('etc_crawl', '기타(보행)'),
    { type: 'select', key: `glue_${deviceKey}`, label: '소모품 상태 끈끈이', options: ['적합', '부적합'], required_defect_action: true },
  ];
}

function buildS3DeviceItems(deviceKey) {
  return [
    { type: 'numeric', key: `rodent_${deviceKey}`, label: '설치류 포획 수', unit: '마리', criteria: { min: 0, max: null }, input_mode: 'counter', default_value: '0', quick_values: [0, 1, 2, 3, 5], pest_type: 'rodent' },
    { type: 'select', key: `cover_${deviceKey}`, label: '커버 관리', options: ['적합', '부적합'], required_defect_action: true },
    { type: 'select', key: `glue_${deviceKey}`, label: '끈끈이', options: ['적합', '부적합'], required_defect_action: true },
  ];
}

function buildS2DeviceItems(deviceKey) {
  return [
    { type: 'numeric', key: `rodent_${deviceKey}`, label: '설치류 포획 수', unit: '마리', criteria: { min: 0, max: null }, input_mode: 'counter', default_value: '0', quick_values: [0, 1, 2, 3, 5], pest_type: 'rodent' },
    { type: 'select', key: `cover_${deviceKey}`, label: '커버 관리', options: ['적합', '부적합'], required_defect_action: true },
    { type: 'select', key: `glue_${deviceKey}`, label: '끈끈이', options: ['적합', '부적합'], required_defect_action: true },
  ];
}

function buildSi0203Template() {
  const spec = PEST_CONTROL_SPEC;

  const p5Groups = SI0203_P5_DEVICES.map(d => ({ key: `g_${d.key}`, label: `[비래] ${d.label}`, items: buildP5DeviceItems(d.key) }));
  const b1Groups = SI0203_B1_DEVICES.map(d => ({ key: `g_${d.key}`, label: `[보행] ${d.label}`, items: buildB1DeviceItems(d.key) }));
  const s3Groups = SI0203_S3_DEVICES.map(d => ({ key: `g_${d.key}`, label: `[포획-S3] ${d.label}`, items: buildS3DeviceItems(d.key) }));
  const s2Groups = SI0203_S2_DEVICES.map(d => ({ key: `g_${d.key}`, label: `[포획-S2] ${d.label}`, items: buildS2DeviceItems(d.key) }));

  const allGroups = [
    { key: 'g_type_p5', label: '▶ 비래해충 포집장치 (P5)', items: [] },
    ...p5Groups,
    { key: 'g_type_b1', label: '▶ 보행해충 포집장치 (B1)', items: [] },
    ...b1Groups,
    { key: 'g_type_s3', label: '▶ 설치류 포획장치 (S3)', items: [] },
    ...s3Groups,
    { key: 'g_type_s2', label: '▶ 설치류 먹이/포획장치 (S2)', items: [] },
    ...s2Groups,
  ];

  const pestCriteria = require('../docs/spec_forms/0203 방충방서 기준.json');

  return {
    log_id: 'si0203',
    title: spec.doc_info.title,
    doc_no: spec.doc_info.doc_no,
    revision: spec.doc_info.rev_no,
    factory_id: 'pb2',
    interval: 'daily',
    meta_info: JSON.stringify({
      period: spec.doc_info.period,
      location: '포집장치',
      summerInterval: 'weekly',
      winterInterval: 'biweekly',
      pestCriteria: pestCriteria.standard_data,
      p5Keys: SI0203_P5_DEVICES.map(d => d.key),
      b1Keys: SI0203_B1_DEVICES.map(d => d.key),
      s3Keys: SI0203_S3_DEVICES.map(d => d.key),
      s2Keys: SI0203_S2_DEVICES.map(d => d.key),
    }),
    approval: buildApprovalLine(),
    items: buildGroupedItems(allGroups),
  };
}

function buildSi0103Template() {
  return {
    log_id: 'si0103',
    title: '영업장 위생점검 일지',
    doc_no: 'PBⅡ-SI-01-03',
    revision: '미표기',
    factory_id: 'pb2',
    interval: 'weekly',
    meta_info: JSON.stringify({ period: '주 1회', location: '영업장' }),
    approval: buildApprovalLine(),
    items: buildGroupedChecklistItems([
      {
        key: 'g_workplace_outside',
        label: '영업장 주변',
        items: [
          { key: 'item_01', label: '영업장은 불결한 장소와 분리되어 있는가?' },
          { key: 'item_02', label: '주위환경은 깨끗한가?' },
          { key: 'item_03', label: '유해물질(유해가스, 악취, 연기, 먼지 등)이 발생되지 않는가?' },
          { key: 'item_04', label: '홍수나 침수의 위험은 없는가?' },
          { key: 'item_05', label: '주변은 청소가 용이하며 청결한가?' },
          { key: 'item_06', label: '쥐, 해충의 유인물은 없는가?' },
          { key: 'item_07', label: '쥐, 해충의 번식장소가 되는 건물은 없는가?' },
          { key: 'item_08', label: '영업장 주변에 폐기물은 방치되어 있지 않는가?' },
          { key: 'item_09', label: '방치된 기구는 없는가?' },
        ],
      },
      {
        key: 'g_workplace_road',
        label: '영업장 진입로',
        items: [
          { key: 'item_10', label: '영업장 주변에 자르지 않은 잡초는 없는가?' },
          { key: 'item_11', label: '먼지 등을 방지할 수 있도록 포장되어 있는가?' },
          { key: 'item_12', label: '물이 고여져 있는 곳은 없는가?' },
        ],
      },
      {
        key: 'g_building',
        label: '건물 주위',
        items: [
          { key: 'item_13', label: '불결한 장소와 일정한 거리를 유지하고 있는가?' },
          { key: 'item_14', label: '바닥과 외벽은 내수처리 되어 있는가?' },
          { key: 'item_15', label: '바닥이 파인 곳이나 물이 고인 곳은 없는가?' },
        ],
      },
      {
        key: 'g_drain',
        label: '배수로',
        items: [
          { key: 'item_16', label: '폐수가 역류되지 않는가?' },
          { key: 'item_17', label: '퇴적물이 축적되어 있지 않는가?' },
        ],
      },
    ]),
  };
}

function ensureDefaultTemplates(db) {
  const templates = [buildSi0101Template()].concat(buildSi0102Templates(), [
    buildSi0201Template(),
    buildSi0202Template(),
    buildSi0203Template(),
    buildSi0103Template(),
  ]);
  const insert = db.prepare(`
    INSERT OR IGNORE INTO log_templates
      (log_id, title, doc_no, revision, factory_id, interval, meta_info, approval, items)
    VALUES
      (@log_id, @title, @doc_no, @revision, @factory_id, @interval, @meta_info, @approval, @items)
  `);

  const tx = db.transaction(rows => {
    rows.forEach(row => insert.run(row));

    const renameTargets = [
      { log_id: 'si0102vs', title: '부대시설 위생점검일지 (위생전실)' },
      { log_id: 'si0102wc', title: '부대시설 위생점검일지 (화장실)' },
      { log_id: 'si0102dr', title: '부대시설 위생점검일지 (탈의실)' },
    ];

    const updateTemplateTitle = db.prepare(`
      UPDATE log_templates
         SET title = @title
       WHERE log_id = @log_id
    `);
    const updateRecordTitle = db.prepare(`
      UPDATE records
         SET title = @title
       WHERE log_id = @log_id
    `);

    renameTargets.forEach(row => {
      updateTemplateTitle.run(row);
      updateRecordTitle.run(row);
    });

    // si0203 장치 구조 변경 시 기존 레코드도 덮어쓴다
    const si0203 = rows.find(r => r.log_id === 'si0203');
    if (si0203) {
      db.prepare(`
        UPDATE log_templates
           SET items = @items, meta_info = @meta_info
         WHERE log_id = 'si0203'
      `).run({ items: si0203.items, meta_info: si0203.meta_info });
    }
  });

  tx(templates);
  return templates;
}

module.exports = {
  ensureDefaultTemplates,
  SI0102_WEEKLY_PRINT_LOG_IDS,
};
