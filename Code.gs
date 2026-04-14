// ── 전역 상수 ──────────────────────────────────────────
const SS = SpreadsheetApp.getActiveSpreadsheet();
const PHOTO_FOLDER_ID_KEY = 'PhotoFolderId';

/**
 * 사용자 목록 조회 (관리자/마스터용)
 * @param {string} requesterId - 요청자 ID (권한 필터링용)
 */
function getUserList(requesterId) {
  const sheet = SS.getSheetByName('Users');
  if (!sheet) return { success: false, message: 'Users 시트 없음' };

  const data      = sheet.getDataRange().getValues();
  const factories = getFactories();
  const today     = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');

  // 요청자 정보 조회
  let requesterIsMaster = false;
  let requesterFactories = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== requesterId) continue;
    requesterIsMaster  = String(data[i][8] || '').toLowerCase() === 'true';
    requesterFactories = parseFactoryRolesInternal(data[i][3]);
    break;
  }

  const users = data.slice(1).filter(r => r[0]).map(r => {
    const roles      = parseFactoryRolesInternal(r[3]);
    const deputies   = parseFactoryRolesInternal(r[9] || '{}');
    const isMaster   = String(r[8] || '').toLowerCase() === 'true';

    return {
      id:            String(r[0]),
      name:          String(r[2]),
      rank:          String(r[5] || ''),
      isMaster:      isMaster,
      factoryRoles:  roles,
      factoryDeputies: deputies
    };
  });

  // 팀장(권한3)은 자기 공장 소속 사용자만 봄, 마스터는 전체
  const filtered = requesterIsMaster ? users : users.filter(u => {
    const requesterRole3Factories = Object.keys(requesterFactories).filter(fid => 
      parseInt(requesterFactories[fid]) === 3
    );
    // 팀장이 있는 공장에서만 그 공장의 사용자를 볼 수 있음
    return requesterRole3Factories.some(fid => parseInt(u.factoryRoles[fid] || 0) > 0);
  });

  return { success: true, users: filtered, factories, requesterIsMaster };
}

/**
 * 사용자 정보 수정 (관리자/마스터용)
 */
function updateUserInfo(requesterId, targetId, updates) {
  const sheet = SS.getSheetByName('Users');
  if (!sheet) return { success: false, message: 'Users 시트 없음' };

  const data = sheet.getDataRange().getValues();
  const today = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');

  // 요청자 권한 확인
  let requesterIsMaster = false, requesterFactories = {};
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== requesterId) continue;
    requesterIsMaster  = String(data[i][8] || '').toLowerCase() === 'true';
    requesterFactories = parseFactoryRolesInternal(data[i][3]);
    break;
  }

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== targetId) continue;
    const currentRoles    = parseFactoryRolesInternal(data[i][3]);
    const currentDeputies = parseFactoryRolesInternal(data[i][9] || '{}');

    if (updates.factoryRoles !== undefined) {
      const rawNewRoles = updates.factoryRoles; // {fid: number | "dep"}
      const cleanRoles    = {};
      const cleanDeputies = {};

      for (const fid of Object.keys(rawNewRoles)) {
        const val = rawNewRoles[fid];

        if (val === 'dep') {
          // 대행 지정
          if (targetId === requesterId && !requesterIsMaster)
            return { success: false, message: '자신을 팀장대행으로 지정할 수 없습니다.' };
          if (!requesterIsMaster && parseInt(requesterFactories[fid] || 0) !== 3)
            return { success: false, message: '팀장만 대행을 지정할 수 있습니다.' };
          // 공장당 대행 1명 제한
          for (let j = 1; j < data.length; j++) {
            if (String(data[j][0]) === targetId) continue;
            const otherDep = parseFactoryRolesInternal(data[j][9] || '{}');
            if (otherDep[fid] !== undefined)
              return { success: false, message: String(data[j][2]) + '이(가) 이미 해당 공장 팀장대행입니다.' };
          }
          // 원래 권한 보존 (이미 대행이면 기존 값 유지)
          const originalRole = currentDeputies[fid] !== undefined
            ? parseInt(currentDeputies[fid])
            : parseInt(currentRoles[fid] || 0);
          cleanDeputies[fid] = originalRole;
          cleanRoles[fid]    = 3;

        } else {
          const numVal = parseInt(val) || 0;
          // 팀장(3) 중복 확인
          if (numVal === 3) {
            if (targetId === requesterId && !requesterIsMaster)
              return { success: false, message: '자신을 팀장으로 지정할 수 없습니다.' };
            for (let j = 1; j < data.length; j++) {
              if (String(data[j][0]) === targetId) continue;
              const otherRoles = parseFactoryRolesInternal(data[j][3]);
              const otherDep   = parseFactoryRolesInternal(data[j][9] || '{}');
              if (parseInt(otherRoles[fid]) === 3 && otherDep[fid] === undefined)
                return { success: false, message: String(data[j][2]) + '이(가) 이미 해당 공장 팀장입니다.' };
            }
          }
          if (!requesterIsMaster && parseInt(requesterFactories[fid] || 0) !== 3)
            return { success: false, message: '팀장만 다른 사용자의 권한을 수정할 수 있습니다.' };
          cleanRoles[fid] = numVal;
          // dep → 일반 권한으로 변경 시 cleanDeputies에 미포함 → 대행 해제됨
        }
      }

      sheet.getRange(i + 1, 4).setValue(JSON.stringify(cleanRoles));
      sheet.getRange(i + 1, 10).setValue(JSON.stringify(cleanDeputies));
    }

    if (updates.rank !== undefined) sheet.getRange(i + 1, 6).setValue(updates.rank);

    // 마스터만 마스터 부여 가능
    if (updates.isMaster !== undefined && requesterIsMaster) {
      sheet.getRange(i + 1, 9).setValue(updates.isMaster ? 'true' : '');
    }

    return { success: true };
  }
  return { success: false, message: '사용자를 찾을 수 없습니다.' };
}

/**
 * 특정 공장들의 현재 대행자 목록 반환 (팀장 복귀 팝업용)
 * @param {string[]} factoryIds
 */
function getDeputiesByFactories(factoryIds) {
  const sheet = SS.getSheetByName('Users');
  if (!sheet) return [];
  const factories = getFactories();
  const data      = sheet.getDataRange().getValues();
  const result    = [];

  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const deputies     = parseFactoryRolesInternal(data[i][9] || '{}');
    const matchFactory = factoryIds.find(function(fid) { return deputies[fid] !== undefined; });
    if (!matchFactory) continue;

    const factory = factories.find(function(f) { return f.id === matchFactory; });
    result.push({
      id:          String(data[i][0]),
      name:        String(data[i][2]),
      factoryName: factory ? factory.name : matchFactory
    });
  }
  return result;
}

/**
 * 지정 공장들의 대행 직책 일괄 해제 (팀장 복귀 시)
 * @param {string[]} factoryIds
 */
function clearDeputiesByFactories(factoryIds) {
  const sheet = SS.getSheetByName('Users');
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    const deputies = parseFactoryRolesInternal(data[i][9] || '{}');
    const roles    = parseFactoryRolesInternal(data[i][3]);

    let changed = false;
    for (const fid of factoryIds) {
      if (deputies[fid] !== undefined) {
        roles[fid] = deputies[fid]; // 원래 권한으로 복원
        delete deputies[fid];
        changed = true;
      }
    }
    if (changed) {
      sheet.getRange(i + 1, 4).setValue(JSON.stringify(roles));
      sheet.getRange(i + 1, 10).setValue(JSON.stringify(deputies));
    }
  }
}

/**
 * 대행 직책 해제 (대행자 본인이 직접 종료 시)
 * @param {string} userId
 */
function clearDeputyTitle(userId) {
  const sheet = SS.getSheetByName('Users');
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === userId) {
      sheet.getRange(i + 1, 7).setValue('');
      sheet.getRange(i + 1, 8).setValue('');
      return;
    }
  }
}

/**
 * [최초 1회 실행] 다중 공장 지원을 위한 시트 자동 세팅
 * GAS 에디터에서 이 함수를 선택 후 실행 버튼 클릭
 */
function setupFactorySheets() {
  // 1. Factories 시트 생성
  var factoriesSheet = SS.getSheetByName('Factories');
  if (!factoriesSheet) {
    factoriesSheet = SS.insertSheet('Factories');
    factoriesSheet.appendRow(['factoryId', '공장명']);
    factoriesSheet.appendRow(['pb2', '2공장(PBⅡ)']);
    Logger.log('Factories 시트 생성 완료');
  } else {
    Logger.log('Factories 시트 이미 존재 - 건너뜀');
  }

  // 2. Logs 시트 H열 factoryId 추가
  var logsSheet = SS.getSheetByName('Logs');
  if (logsSheet) {
    var logsData = logsSheet.getDataRange().getValues();
    // 헤더에 factoryId 없으면 추가
    if (String(logsData[0][7] || '') !== 'factoryId') {
      logsSheet.getRange(1, 8).setValue('factoryId');
    }
    // 기존 행에 pb2 입력 (빈 경우만)
    for (var i = 1; i < logsData.length; i++) {
      if (logsData[i][0] && !logsData[i][7]) {
        logsSheet.getRange(i + 1, 8).setValue('pb2');
      }
    }
    Logger.log('Logs 시트 factoryId 컬럼 추가 완료');
  }

  // 3. MasterRecords 시트 O열 FactoryId 추가
  var masterSheet = SS.getSheetByName('MasterRecords');
  if (masterSheet) {
    var masterData = masterSheet.getDataRange().getValues();
    if (String(masterData[0][14] || '') !== 'FactoryId') {
      masterSheet.getRange(1, 15).setValue('FactoryId');
    }
    for (var i = 1; i < masterData.length; i++) {
      if (masterData[i][0] && !masterData[i][14]) {
        masterSheet.getRange(i + 1, 15).setValue('pb2');
      }
    }
    Logger.log('MasterRecords 시트 FactoryId 컬럼 추가 완료');
  }

  // 4. Users 시트 G열(직책), H열(대행종료일) 헤더 추가
  var usersSheetForHeader = SS.getSheetByName('Users');
  if (usersSheetForHeader) {
    var headerRow = usersSheetForHeader.getRange(1, 1, 1, 8).getValues()[0];
    if (!headerRow[6]) usersSheetForHeader.getRange(1, 7).setValue('직책');
    if (!headerRow[7]) usersSheetForHeader.getRange(1, 8).setValue('대행종료일');
    if (!headerRow[8]) usersSheetForHeader.getRange(1, 9).setValue('마스터');
    Logger.log('Users 시트 직책/대행종료일/마스터 컬럼 추가 완료');
  }

  // 5. Users 시트 D열 권한 → JSON 변환
  var usersSheet = SS.getSheetByName('Users');
  if (usersSheet) {
    var usersData = usersSheet.getDataRange().getValues();
    for (var i = 1; i < usersData.length; i++) {
      if (!usersData[i][0]) continue;
      var raw = String(usersData[i][3] || '').trim();
      // 숫자 형식이면 JSON으로 변환
      if (raw && !raw.startsWith('{')) {
        var num = parseInt(raw);
        if (!isNaN(num) && num > 0) {
          usersSheet.getRange(i + 1, 4).setValue(JSON.stringify({ pb2: num }));
        }
      }
    }
    Logger.log('Users 시트 권한 JSON 변환 완료');
  }

  Logger.log('✅ 시트 세팅 완료! 앱을 새로고침하세요.');
}

/**
 * [최초 1회 실행] Logs 시트에 일지 항목 등록
 * GAS 에디터에서 setupLogs() 선택 후 실행
 * 이미 등록된 logId는 건너뜀 (멱등성 보장)
 */
function setupLogs() {
  const sheet = SS.getSheetByName('Logs');
  if (!sheet) { Logger.log('Logs 시트 없음'); return; }

  const LOG_ENTRIES = [
    // logId        | title              | interval | summerFreq | winterFreq | docNo              | version | factoryId
    ['si0201', '이물관리 점검표',       '일간',   1,          1,          'PBⅡ-SI-02-01', '1.0', 'pb2'],
  ];

  const data      = sheet.getDataRange().getValues();
  const headerRow = data[0].map(function(h) { return String(h).toLowerCase(); });

  // 헤더 인덱스 확인
  const colLogId     = headerRow.indexOf('logid');
  const colTitle     = headerRow.indexOf('title');
  const colInterval  = headerRow.indexOf('interval');
  const colSummerF   = headerRow.indexOf('summerfreq');
  const colWinterF   = headerRow.indexOf('winterfreq');
  const colDocNo     = headerRow.indexOf('docno');
  const colVersion   = headerRow.indexOf('version');
  const colFactory   = headerRow.indexOf('factoryid');

  // 기존 logId 목록
  const existingIds = data.slice(1).map(function(r) { return String(r[colLogId] || '').toLowerCase(); });

  LOG_ENTRIES.forEach(function(entry) {
    var logId = entry[0];
    if (existingIds.indexOf(logId.toLowerCase()) > -1) {
      Logger.log(logId + ' 이미 존재 - 건너뜀');
      return;
    }
    var newRow = [];
    newRow[colLogId]    = entry[0];
    newRow[colTitle]    = entry[1];
    newRow[colInterval] = entry[2];
    newRow[colSummerF]  = entry[3];
    newRow[colWinterF]  = entry[4];
    newRow[colDocNo]    = entry[5];
    newRow[colVersion]  = entry[6];
    newRow[colFactory]  = entry[7];
    sheet.appendRow(newRow);
    Logger.log(logId + ' 등록 완료: ' + entry[1]);
  });

  Logger.log('✅ Logs 시트 등록 완료');
}

/**
 * [최초 1회 실행] MasterRecords·DetailRecords 전체 초기화
 * GAS 에디터에서 clearAllRecords() 선택 후 실행
 */
function clearAllRecords() {
  var master = SS.getSheetByName('MasterRecords');
  if (master) {
    var lastRow = master.getLastRow();
    if (lastRow > 1) {
      master.deleteRows(2, lastRow - 1);
      Logger.log('MasterRecords 초기화 완료 (' + (lastRow - 1) + '행 삭제)');
    } else {
      Logger.log('MasterRecords 데이터 없음 - 건너뜀');
    }
  }

  var detail = SS.getSheetByName('DetailRecords');
  if (detail) {
    var lastRow2 = detail.getLastRow();
    if (lastRow2 > 1) {
      detail.deleteRows(2, lastRow2 - 1);
      Logger.log('DetailRecords 초기화 완료 (' + (lastRow2 - 1) + '행 삭제)');
    } else {
      Logger.log('DetailRecords 데이터 없음 - 건너뜀');
    }
  }

  Logger.log('✅ 전체 일지 데이터 초기화 완료');
}

/**
 * [최초 1회 실행] factoryDeputies 컬럼 추가 (팀장 대행 만료일)
 */
function setupFactoryDeputies() {
  const usersSheet = SS.getSheetByName('Users');
  if (!usersSheet) return Logger.log('Users 시트 없음');

  const data = usersSheet.getDataRange().getValues();
  const headerRow = data[0];

  // J열(10번째)에 factoryDeputies 컬럼 추가
  if (String(headerRow[9] || '') !== 'factoryDeputies') {
    usersSheet.getRange(1, 10).setValue('factoryDeputies');
    Logger.log('factoryDeputies 컬럼 추가 완료');
  } else {
    Logger.log('factoryDeputies 컬럼 이미 존재 - 건너뜀');
  }
}

/**
 * [권한 사전 획득용] 배포 전 스크립트 에디터에서 한 번만 실행
 */
function setupPermissions() {
  const doc = DocumentApp.create('TempDoc_For_Permission');
  DriveApp.getFileById(doc.getId()).setTrashed(true);
  Logger.log('권한 획득 완료');
}

/**
 * 웹앱 진입점
 */
function doGet() {
  return HtmlService.createTemplateFromFile('index').evaluate()
    .setTitle('HACCP 스마트 관리 시스템')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * HTML 파일 인클루드 헬퍼
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * 초기 데이터 일괄 로드 (앱 시작 시 1회 호출)
 * factories: Factories 시트 목록 반환 (공장 선택 화면용)
 */
function getInitialData() {
  try {
    const settings  = getSafeData('Settings');
    const logs      = getSafeData('Logs');
    const factories = getFactories();
    const todayStr  = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
    const records   = getAllPendingRecords();
    return { success: true, settings, logs, factories, records, serverToday: todayStr };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

/**
 * 공장 목록 반환
 * Factories 시트 컬럼: factoryId(0) | 공장명(1)
 * 시트 없으면 기본값(pb2) 반환
 */
function getFactories() {
  const sheet = SS.getSheetByName('Factories');
  if (!sheet) return [{ id: 'pb2', name: '2공장(PBⅡ)' }];
  return sheet.getDataRange().getValues().slice(1)
    .filter(r => r[0])
    .map(r => ({ id: String(r[0]), name: String(r[1]) }));
}

/**
 * Settings / Logs 시트 데이터를 안전하게 읽어 반환
 * Logs 시트 컬럼: id(0) | title(1) | interval(2) | summer(3) | winter(4) | docNo(5) | version(6) | factoryId(7)
 */
function getSafeData(name) {
  const sheet = SS.getSheetByName(name);
  if (!sheet) return name === 'Settings' ? {} : [];

  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return name === 'Settings' ? {} : [];

  if (name === 'Settings') {
    const obj = {};
    data.forEach(row => { if (row[0]) obj[row[0]] = String(row[1]); });
    return obj;
  }

  return data.slice(1).filter(r => r[0]).map(r => ({
    id:        String(r[0]),
    title:     String(r[1]),
    interval:  String(r[2]),
    summer:    String(r[3]),
    winter:    String(r[4]),
    docNo:     String(r[5] || ''),
    version:   String(r[6] || ''),
    factoryId: String(r[7] || 'pb2')  // 공장 미지정 시 pb2 기본값
  }));
}

/**
 * 오늘 날짜 또는 미완료 레코드 전체 반환
 * MasterRecords 컬럼: RecordID(0) | LogID(1) | Title(2) | Date(3) | WriterID(4) | WriterName(5)
 *                     Reviewer(6) | Approver(7) | Status(8) | PDFLink(9) | DefectInfo(10)
 *                     WriteDate(11) | ReviewDate(12) | ApproveDate(13) | FactoryId(14)
 */
function getAllPendingRecords() {
  const sheet = SS.getSheetByName('MasterRecords');
  if (!sheet) return [];

  const todayStr = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');

  // userId → factoryRoles 맵 구성
  const usersSheet  = SS.getSheetByName('Users');
  const userRoleMap = {};  // { userId: { pb2: 3, pb1: 1 } }
  if (usersSheet) {
    usersSheet.getDataRange().getValues().slice(1).forEach(u => {
      if (u[0]) userRoleMap[String(u[0])] = parseFactoryRolesInternal(u[3]);
    });
  }

  return sheet.getDataRange().getValues().slice(1)
    .filter(r => r[0])
    .map(r => {
      let rowDate = r[3] instanceof Date
        ? Utilities.formatDate(r[3], 'GMT+9', 'yyyy-MM-dd')
        : String(r[3]);
      const writerId  = String(r[4]);
      const factoryId = String(r[14] || 'pb2');
      const writerFactoryRoles = userRoleMap[writerId] || {};
      const writerRole = String(writerFactoryRoles[factoryId] || 1);

      return {
        recordId:   String(r[0]),
        logId:      String(r[1]),
        title:      String(r[2]),
        date:       rowDate,
        writerId:   writerId,
        writerName: String(r[5]),
        writerRole: writerRole,
        reviewer:   String(r[6]),
        approver:   String(r[7]),
        status:     String(r[8]),
        pdfLink:    String(r[9]  || ''),
        defectInfo: String(r[10] || ''),
        factoryId:  factoryId
      };
    })
    .filter(rec => rec.date === todayStr || rec.status !== '승인완료');
}

/**
 * 특정 날짜의 MasterRecords logId 목록 반환
 */
function getTodayMasterRecords(todayStr) {
  const sheet = SS.getSheetByName('MasterRecords');
  if (!sheet) return [];

  return sheet.getDataRange().getValues().slice(1)
    .filter(r => {
      if (!r[0]) return false;
      const d = r[3] instanceof Date
        ? Utilities.formatDate(r[3], 'GMT+9', 'yyyy-MM-dd')
        : String(r[3]);
      return d === todayStr;
    })
    .map(r => ({ logId: String(r[1]), factoryId: String(r[14] || 'pb2') }));
}

/**
 * Users 시트에서 ID로 특정 공장의 권한(role) 조회
 * @param {string} id - 사용자 ID
 * @param {string} factoryId - 공장 ID (미입력 시 pb2)
 * @returns {string} 권한 레벨 문자열
 */
function getUserRoleById(id, factoryId) {
  if (!id) return '1';
  const fid   = factoryId || 'pb2';
  const sheet = SS.getSheetByName('Users');
  if (!sheet) return '1';
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === id) {
      const roles = parseFactoryRolesInternal(data[i][3]);
      return String(roles[fid] || 1);
    }
  }
  return '1';
}

/**
 * Users 시트에서 ID로 서명 조회
 */
function getUserSignatureById(userId) {
  if (!userId) return '';
  const sheet = SS.getSheetByName('Users');
  if (!sheet) return '';
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === String(userId)) return String(data[i][4] || '');
  }
  return '';
}

/**
 * Users 시트에서 이름으로 서명 조회
 */
function getUserSignatureByName(name) {
  if (!name) return '';
  const trimmed = name.trim();
  const sheet = SS.getSheetByName('Users');
  if (!sheet) return '';
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]).trim() === trimmed) return String(data[i][4] || '');
  }
  return '';
}

/**
 * Users 시트에서 이름으로 직책/계급 조회 (결재란 역할명 표시용)
 * 직책 있으면 직책, 없으면 계급 반환
 */
function getUserTitleByName(name) {
  if (!name) return '';
  const sheet = SS.getSheetByName('Users');
  if (!sheet) return '';
  const data  = sheet.getDataRange().getValues();
  const today = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) !== name) continue;
    const rawTitle = String(data[i][6] || '');
    const until    = String(data[i][7] || '');
    // 대행 기간 만료 여부 확인
    if (rawTitle === 'HACCP팀장 대행' && until && until < today) return String(data[i][5] || '');
    return rawTitle || String(data[i][5] || '');
  }
  return '';
}

/**
 * factoryRoles 파싱 (내부 공유 헬퍼)
 * auth.gs의 parseFactoryRoles와 동일 로직 — GAS는 파일 간 함수 공유 가능하나
 * 명시적으로 각 파일에 선언하면 충돌 위험이 있으므로 Internal 접미사 사용
 */
function parseFactoryRolesInternal(raw) {
  if (!raw && raw !== 0) return {};
  const str = String(raw).trim();
  if (str.startsWith('{')) {
    try { return JSON.parse(str); } catch (e) { return {}; }
  }
  const num = parseInt(str);
  if (!isNaN(num) && num > 0) return { pb2: num };
  return {};
}

/**
 * 레코드 상세 데이터 조회 — 검토자/승인자 서명 포함
 */
function getRecordDetail(recordId, logId) {
  try {
    const master = SS.getSheetByName('MasterRecords');
    if (!master) return { success: false, message: 'MasterRecords 시트 없음' };

    const data = master.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== recordId) continue;

      const writerId     = String(data[i][4]  || '');
      const writerName   = String(data[i][5]  || '');
      const reviewerName = String(data[i][6]  || '');
      const approverName = String(data[i][7]  || '');
      const dataJson     = String(data[i][15] || '{}'); // col16: DataJson (index 15)

      // 작성자 서명: ID 우선, 없으면 이름으로 폴백
      const writerSignature = writerId
        ? getUserSignatureById(writerId)
        : getUserSignatureByName(writerName);

      return {
        success:           true,
        dataJson:          dataJson,
        writerId:          writerId,
        writerName:        writerName,
        reviewerName:      reviewerName,
        approverName:      approverName,
        writerSignature:   writerSignature,
        reviewerSignature: getUserSignatureByName(reviewerName),
        approverSignature: getUserSignatureByName(approverName),
        writerTitle:       getUserTitleByName(writerName),
        reviewerTitle:     getUserTitleByName(reviewerName),
        approverTitle:     getUserTitleByName(approverName)
      };
    }
    return { success: false, message: '데이터 없음' };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

/**
 * 인쇄용 날짜 범위 레코드 조회
 * @param {string} factoryId - 공장 ID
 * @param {string} fromDate  - 시작일 (yyyy-MM-dd)
 * @param {string} toDate    - 종료일 (yyyy-MM-dd)
 */
function getRecordsForDateRange(factoryId, fromDate, toDate) {
  try {
    const sheet = SS.getSheetByName('MasterRecords');
    if (!sheet) return { success: false, message: 'MasterRecords 없음' };

    const rows = sheet.getDataRange().getValues().slice(1).filter(r => r[0]);
    const results = rows
      .map(r => {
        const d = r[3] instanceof Date
          ? Utilities.formatDate(r[3], 'GMT+9', 'yyyy-MM-dd')
          : String(r[3]);
        return {
          recordId:   String(r[0]),
          logId:      String(r[1]),
          title:      String(r[2]),
          date:       d,
          writerName: String(r[5]),
          reviewer:   String(r[6] || ''),
          approver:   String(r[7] || ''),
          status:     String(r[8]),
          defectInfo: String(r[10] || ''),
          factoryId:  String(r[14] || 'pb2')
        };
      })
      .filter(r => r.factoryId === factoryId && r.date >= fromDate && r.date <= toDate)
      // 인쇄는 승인완료 문서만 허용
      .filter(r => r.status === '승인완료');

    return { success: true, records: results };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

/**
 * 테스트용 샘플 레코드 5건 생성
 */
function generateTestRecords() {
  const master   = SS.getSheetByName('MasterRecords') || SS.insertSheet('MasterRecords');
  const logSheet = SS.getSheetByName('Log_P01')       || SS.insertSheet('Log_P01');

  master.clear();
  master.appendRow(['RecordID','LogID','Title','Date','WriterID','WriterName','Reviewer','Approver','Status','PDFLink','DefectInfo','WriteDate','ReviewDate','ApproveDate','FactoryId']);
  logSheet.clear();
  logSheet.appendRow(['RecordID','Date','Writer','DataJson']);

  const today      = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
  const sampleImg  = 'https://picsum.photos/seed/haccp/400/300';
  const sampleData = JSON.stringify({
    temperature: '18.5', memo: '특이사항 없음',
    items: {
      floor:   { result:'ok',  defectText:'', actionText:'', defectPhoto:'', actionPhoto:'' },
      hygiene: { result:'ok',  defectText:'', actionText:'', defectPhoto:'', actionPhoto:'' },
      hands:   { result:'ng',  defectText:'배수구 파손 발견', actionText:'즉시 보수 조치 완료', defectPhoto:sampleImg, actionPhoto:sampleImg },
      equip:   { result:'ok',  defectText:'', actionText:'', defectPhoto:'', actionPhoto:'' },
      pest:    { result:'ok',  defectText:'', actionText:'', defectPhoto:'', actionPhoto:'' }
    }
  });
  const defectJson = JSON.stringify({ item:'작업 전 손세정 여부', content:'배수구 파손 발견', action:'즉시 보수 조치 완료' });

  [
    { id:'REC-TEST-1', status:'작성중',   rev:'',     app:'',         defect:'',        data:'{}' },
    { id:'REC-TEST-2', status:'작성완료', rev:'',     app:'',         defect:'',        data:sampleData },
    { id:'REC-TEST-3', status:'작성완료', rev:'',     app:'',         defect:defectJson, data:sampleData },
    { id:'REC-TEST-4', status:'검토완료', rev:'관리자', app:'',         defect:'',        data:sampleData },
    { id:'REC-TEST-5', status:'승인완료', rev:'관리자', app:'최고관리자', defect:'',        data:sampleData }
  ].forEach(t => {
    master.appendRow([t.id,'P01','위생 점검(테스트)',today,'admin','관리자',t.rev,t.app,t.status,'',t.defect,today,'','','pb2']);
    logSheet.appendRow([t.id, today, '관리자', t.data]);
  });

  return { success: true };
}

/**
 * [최초 1회 실행] MasterRecords에 DataJson 컬럼(16번째) 추가 및 기존 Log_xxx 시트 데이터 마이그레이션
 * - MasterRecords 헤더에 DataJson 컬럼이 없으면 추가
 * - 기존 Log_xxx 시트에서 각 레코드의 DataJson을 MasterRecords col16으로 이전
 * - 이미 col16에 값이 있는 행은 건너뜀 (멱등성 보장)
 */
function setupMigrateToMaster() {
  const master = SS.getSheetByName('MasterRecords');
  if (!master) {
    Logger.log('[MigrateToMaster] MasterRecords 시트 없음 — 중단');
    return;
  }

  // 헤더 행에 DataJson 컬럼 추가 (col16이 비어있을 경우)
  const header = master.getRange(1, 1, 1, master.getLastColumn()).getValues()[0];
  if (header.length < 16 || !header[15]) {
    master.getRange(1, 16).setValue('DataJson');
    Logger.log('[MigrateToMaster] 헤더에 DataJson 컬럼 추가');
  }

  const data   = master.getDataRange().getValues();
  let migrated = 0;
  let skipped  = 0;

  for (let i = 1; i < data.length; i++) {
    const recordId = String(data[i][0] || '');
    const logId    = String(data[i][1] || '');
    if (!recordId || !logId) continue;

    // 이미 col16에 값이 있으면 건너뜀
    if (data[i][15] && String(data[i][15]).trim() !== '' && String(data[i][15]) !== '{}') {
      skipped++;
      continue;
    }

    // 기존 Log_xxx 시트에서 DataJson 조회
    const logSheet = SS.getSheetByName('Log_' + logId);
    if (!logSheet) {
      master.getRange(i + 1, 16).setValue('{}');
      migrated++;
      continue;
    }

    const logData = logSheet.getDataRange().getValues();
    let found = false;
    for (let j = 1; j < logData.length; j++) {
      if (String(logData[j][0]) === recordId) {
        const json = String(logData[j][3] || '{}');
        master.getRange(i + 1, 16).setValue(json);
        migrated++;
        found = true;
        break;
      }
    }
    if (!found) {
      master.getRange(i + 1, 16).setValue('{}');
      migrated++;
    }
  }

  Logger.log('[MigrateToMaster] 완료 — 마이그레이션: ' + migrated + '건, 건너뜀: ' + skipped + '건');
}
