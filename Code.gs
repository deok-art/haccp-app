// ── 전역 상수 ──────────────────────────────────────────
const SS = SpreadsheetApp.getActiveSpreadsheet();
const PHOTO_FOLDER_ID_KEY = 'PhotoFolderId';

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
 */
function getInitialData() {
  try {
    const settings = getSafeData('Settings');
    const logs     = getSafeData('Logs');
    const todayStr = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
    const records  = getAllPendingRecords();
    return { success: true, settings, logs, records, serverToday: todayStr };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

/**
 * Settings / Logs 시트 데이터를 안전하게 읽어 반환
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
    id:      String(r[0]),
    title:   String(r[1]),
    interval:String(r[2]),
    summer:  String(r[3]),
    winter:  String(r[4]),
    docNo:   String(r[5] || ''),
    version: String(r[6] || '')
  }));
}

/**
 * 오늘 날짜 또는 미완료 레코드 전체 반환
 */
function getAllPendingRecords() {
  const sheet = SS.getSheetByName('MasterRecords');
  if (!sheet) return [];

  const todayStr = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
  return sheet.getDataRange().getValues().slice(1)
    .filter(r => r[0])
    .map(r => {
      let rowDate = r[3] instanceof Date
        ? Utilities.formatDate(r[3], 'GMT+9', 'yyyy-MM-dd')
        : String(r[3]);
      return {
        recordId:   String(r[0]),
        logId:      String(r[1]),
        title:      String(r[2]),
        date:       rowDate,
        writerId:   String(r[4]),
        writerName: String(r[5]),
        reviewer:   String(r[6]),
        approver:   String(r[7]),
        status:     String(r[8]),
        pdfLink:    String(r[9]  || ''),
        defectInfo: String(r[10] || '')
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
    .map(r => ({ logId: String(r[1]) }));
}

/**
 * Users 시트에서 이름으로 서명 조회
 */
function getUserSignatureByName(name) {
  if (!name) return '';
  const sheet = SS.getSheetByName('Users');
  if (!sheet) return '';
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][2]) === name) return String(data[i][4] || '');
  }
  return '';
}

/**
 * 레코드 상세 데이터 조회 — 검토자/승인자 서명 포함
 */
function getRecordDetail(recordId, logId) {
  try {
    const sheet = SS.getSheetByName('Log_' + logId);
    if (!sheet) return { success: false, message: '시트 없음' };

    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0]) !== recordId) continue;

      // MasterRecords에서 검토자/승인자 이름 조회
      const master     = SS.getSheetByName('MasterRecords');
      let reviewerName = '', approverName = '';
      if (master) {
        const mData = master.getDataRange().getValues();
        for (let j = 1; j < mData.length; j++) {
          if (String(mData[j][0]) === recordId) {
            reviewerName = String(mData[j][6] || '');
            approverName = String(mData[j][7] || '');
            break;
          }
        }
      }

      return {
        success:          true,
        dataJson:         String(data[i][3]),
        reviewerName:     reviewerName,
        approverName:     approverName,
        reviewerSignature: getUserSignatureByName(reviewerName),
        approverSignature: getUserSignatureByName(approverName)
      };
    }
    return { success: false, message: '데이터 없음' };
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
  master.appendRow(['RecordID','LogID','Title','Date','WriterID','WriterName','Reviewer','Approver','Status','PDFLink','DefectInfo']);
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
    master.appendRow([t.id,'P01','위생 점검(테스트)',today,'admin','관리자',t.rev,t.app,t.status,'',t.defect]);
    logSheet.appendRow([t.id, today, '관리자', t.data]);
  });

  return { success: true };
}