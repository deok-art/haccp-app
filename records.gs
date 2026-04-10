// ── 일지 생성 / 저장 / 결재 처리 ────────────────────────

/**
 * 새 일지 레코드 생성
 */
function createNewLog(logId, title, writerId, writerName, targetDate, factoryId) {
  const master  = SS.getSheetByName('MasterRecords') || SS.insertSheet('MasterRecords');
  const dateStr = targetDate || Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
  const fid     = factoryId || 'pb2';

  // 같은 날짜/logId/공장의 미작성 플레이스홀더가 있으면 재사용
  const rows = master.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const r     = rows[i];
    const rDate = r[3] instanceof Date ? Utilities.formatDate(r[3], 'GMT+9', 'yyyy-MM-dd') : String(r[3]);
    if (String(r[1]) === logId && rDate === dateStr && String(r[14] || 'pb2') === fid && String(r[8]) === '미작성') {
      master.getRange(i + 1, 5).setValue(writerId);
      master.getRange(i + 1, 6).setValue(writerName);
      master.getRange(i + 1, 9).setValue('작성중');
      return { success: true, recordId: String(r[0]) };
    }
  }

  const recordId    = 'REC-' + new Date().getTime();
  master.appendRow([recordId, logId, title, dateStr, writerId, writerName, '', '', '작성중', '', '', dateStr, '', '', fid]);

  const detailSheet = SS.getSheetByName('Log_' + logId) || SS.insertSheet('Log_' + logId);
  if (detailSheet.getLastRow() === 0) {
    detailSheet.appendRow(['RecordID', 'Date', 'Writer', 'DataJson']);
  }
  detailSheet.appendRow([recordId, dateStr, writerName, JSON.stringify({})]);

  return { success: true, recordId };
}

/**
 * 임시저장
 */
function saveDraft(recordId, logId, dataJson) {
  try {
    _updateDetailJson(logId, recordId, dataJson);
    return { success: true };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

/**
 * 최종 제출 저장
 */
function saveFormData(recordId, logId, dataJson, defectInfo) {
  try {
    _updateDetailJson(logId, recordId, dataJson);
    const master = SS.getSheetByName('MasterRecords');
    if (master) {
      const data = master.getDataRange().getValues();
      const now = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][0]) === recordId) {
          master.getRange(i + 1, 9).setValue('작성완료');
          master.getRange(i + 1, 11).setValue(defectInfo);
          master.getRange(i + 1, 12).setValue(now); // WriteDate 기록
          break;
        }
      }
    }

    // 빈 양식 PDF 템플릿 자동 생성 (최초 제출 시)
    checkAndGenerateTemplate(logId);
    return { success: true };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}


/**
 * 단건 결재 처리 (CANCEL / REVIEW / CANCEL_REVIEW / APPROVE / REVOKE)
 */
function processRecordAction(recordId, action, userId, userName, userRole) {
  const sheet = SS.getSheetByName('MasterRecords');
  const data  = sheet.getDataRange().getValues();
  const now   = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) !== recordId) continue;
    const status   = String(data[i][8]);
    const writerId = String(data[i][4]);
    const role     = parseInt(userRole);
    
    switch (action) {
      case 'CANCEL':
        if (writerId !== userId)      return { success: false, message: '본인 작성 문서만 취소할 수 있습니다.' };
        if (status !== '작성완료')    return { success: false, message: '작성완료 상태에서만 취소 가능합니다.' };
        sheet.getRange(i + 1, 7, 1, 3).setValues([['', '', '작성중']]);
        sheet.getRange(i + 1, 12, 1, 3).setValues([['', '', '']]); // 모든 날짜 초기화
        return { success: true };
        
      case 'CANCEL_REVIEW':
        if (role < 2)              return { success: false, message: '검토 권한이 없습니다.' };
        if (status !== '검토완료') return { success: false, message: '검토완료 상태에서만 취소 가능합니다.' };
        sheet.getRange(i + 1, 7).setValue('');
        sheet.getRange(i + 1, 9).setValue('작성완료');
        sheet.getRange(i + 1, 13).setValue(''); // ReviewDate 초기화
        return { success: true };

      case 'REVIEW': {
        if (role < 2) return { success: false, message: '검토 권한이 없습니다.' };
        if (writerId === userId) return { success: false, message: '본인 작성 문서는 검토할 수 없습니다.' };
        const factoryId  = String(data[i][14] || 'pb2');
        const writerRole = getUserRoleById(writerId, factoryId);
        if (role < 3 && parseInt(writerRole) >= 3) return { success: false, message: '상위 권한자의 문서는 검토할 수 없습니다.' };
        sheet.getRange(i + 1, 7).setValue(userName);
        sheet.getRange(i + 1, 9).setValue('검토완료');
        sheet.getRange(i + 1, 13).setValue(now); // ReviewDate 기록
        return { success: true };
      }
        
      case 'APPROVE':
        if (role < 3) return { success: false, message: '승인 권한이 없습니다.' };
        sheet.getRange(i + 1, 8).setValue(userName);
        sheet.getRange(i + 1, 9).setValue('승인완료');
        sheet.getRange(i + 1, 14).setValue(now); // ApproveDate 기록
        return { success: true };
        
      case 'REVOKE':
        if (role < 3) return { success: false, message: '승인취소 권한이 없습니다.' };
        const hadReviewer = String(data[i][6] || '') !== '';
        sheet.getRange(i + 1, 8).setValue('');
        sheet.getRange(i + 1, 9).setValue(hadReviewer ? '검토완료' : '작성완료');
        sheet.getRange(i + 1, 14).setValue(''); // ApproveDate 초기화
        return { success: true };
    }
  }

  return { success: false, message: '일지를 찾을 수 없습니다.' };
}

/**
 * 선택 ID 목록 일괄 결재 처리
 */
function batchActionByIds(ids, action, userName, userRole) {
  const sheet = SS.getSheetByName('MasterRecords');
  const data  = sheet.getDataRange().getValues();
  const role  = parseInt(userRole);
  const now   = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
  
  for (let i = 1; i < data.length; i++) {
    if (!ids.includes(String(data[i][0]))) continue;
    if (action === 'APPROVE') {
      sheet.getRange(i + 1, 8).setValue(userName);
      sheet.getRange(i + 1, 9).setValue('승인완료');
      sheet.getRange(i + 1, 14).setValue(now);
    }
    if (action === 'REVOKE' && role >= 3) {
      const hadReviewer = String(data[i][6] || '') !== '';
      sheet.getRange(i + 1, 8).setValue('');
      sheet.getRange(i + 1, 9).setValue(hadReviewer ? '검토완료' : '작성완료');
      sheet.getRange(i + 1, 14).setValue('');
    }
  }
  return { success: true };
}

/**
 * 미작성 일지 일괄 자동 작성
 */
function batchWriteAllRecords(userId, userName) {
  const logs     = getSafeData('Logs');
  const todayStr = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
  const doneIds  = getTodayMasterRecords(todayStr).map(r => r.logId);
  const master   = SS.getSheetByName('MasterRecords');
  
  logs.forEach(log => {
    if (doneIds.includes(log.id)) return;
    const recordId = 'REC-' + new Date().getTime() + Math.floor(Math.random() * 1000);
    master.appendRow([recordId, log.id, log.title, todayStr, userId, userName, '', '', '작성완료', '', '', todayStr, '', '', log.factoryId || 'pb2']);
    const ds = SS.getSheetByName('Log_' + log.id) || SS.insertSheet('Log_' + log.id);
    if (ds.getLastRow() === 0) ds.appendRow(['RecordID', 'Date', 'Writer', 'DataJson']);
    ds.appendRow([recordId, todayStr, userName, JSON.stringify({ autoFilled: true })]);
  });
  return { success: true };
}

/**
 * 오늘 일간 일지를 작성중 상태로 일괄 생성 (수동 트리거용)
 * - 현재 공장(factoryId)의 interval='일간'만 생성
 * - 같은 날짜/공장/logId가 이미 있으면 생성하지 않음
 */
function createTodayDailyLogsBatch(factoryId, writerId, writerName, forceLogIds, selectedLogIds) {
  const fid      = factoryId || 'pb2';
  const force    = Array.isArray(forceLogIds) ? forceLogIds : [];
  const selected = Array.isArray(selectedLogIds) && selectedLogIds.length > 0 ? selectedLogIds : null;
  const todayStr = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');
  let   logs     = getSafeData('Logs').filter(function(l) {
    return (l.factoryId || 'pb2') === fid && String(l.interval) === '일간';
  });
  // 선택된 일지만 처리 (클라이언트에서 선택 모달 사용 시)
  if (selected) logs = logs.filter(function(l) { return selected.indexOf(l.id) !== -1; });

  const master = SS.getSheetByName('MasterRecords') || SS.insertSheet('MasterRecords');
  const rows   = master.getDataRange().getValues().slice(1);

  const existing = {};
  rows.forEach(function(r) {
    const d   = r[3] instanceof Date ? Utilities.formatDate(r[3], 'GMT+9', 'yyyy-MM-dd') : String(r[3]);
    const lid = String(r[1] || '');
    const rf  = String(r[14] || 'pb2');
    if (d === todayStr && rf === fid && lid) existing[lid] = true;
  });

  let created = 0;
  let skipped = 0;
  const skippedLogs = [];
  logs.forEach(function(log) {
    const shouldForce = force.indexOf(log.id) !== -1;
    if (existing[log.id] && !shouldForce) {
      skipped++;
      skippedLogs.push({ id: log.id, title: log.title });
      return;
    }
    const recordId = 'REC-' + new Date().getTime() + Math.floor(Math.random() * 1000);
    master.appendRow([recordId, log.id, log.title, todayStr, '', '', '', '', '미작성', '', '', todayStr, '', '', fid]);

    const ds = SS.getSheetByName('Log_' + log.id) || SS.insertSheet('Log_' + log.id);
    if (ds.getLastRow() === 0) ds.appendRow(['RecordID', 'Date', 'Writer', 'DataJson']);
    ds.appendRow([recordId, todayStr, '', JSON.stringify({})]);
    created++;
  });

  return { success: true, created: created, skipped: skipped, skippedLogs: skippedLogs, total: logs.length };
}

/**
 * 날짜 무관 일괄 검토/승인
 */
function batchProcessRecords(action, userName, userRole) {
  const role = parseInt(userRole);
  if (action === 'REVIEW'  && role < 2) return { success: false, message: '검토 권한이 없습니다.' };
  if (action === 'APPROVE' && role < 3) return { success: false, message: '승인 권한이 없습니다.' };
  
  const sheet    = SS.getSheetByName('MasterRecords');
  const data     = sheet.getDataRange().getValues();
  const now      = Utilities.formatDate(new Date(), 'GMT+9', 'yyyy-MM-dd');

  for (let i = 1; i < data.length; i++) {
    if (action === 'REVIEW'  && data[i][8] === '작성완료') {
      sheet.getRange(i + 1, 7).setValue(userName);
      sheet.getRange(i + 1, 9).setValue('검토완료');
      sheet.getRange(i + 1, 13).setValue(now);
    }
    if (action === 'APPROVE' && (data[i][8] === '검토완료' || data[i][8] === '작성완료')) {
      sheet.getRange(i + 1, 8).setValue(userName);
      sheet.getRange(i + 1, 9).setValue('승인완료');
      sheet.getRange(i + 1, 14).setValue(now);
    }
  }
  return { success: true };
}

// ── 내부 헬퍼 ──────────────────────────────────────────

function _updateDetailJson(logId, recordId, dataJson) {
  const sheet = SS.getSheetByName('Log_' + logId);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0]) === recordId) {
      sheet.getRange(i + 1, 4).setValue(dataJson);
      break;
    }
  }
}

function checkAndGenerateTemplate(logId) {
  const logs    = getSafeData('Logs');
  const logMeta = logs.find(l => l.id === logId);
  if (!logMeta || !logMeta.docNo) return;

  const folderName = 'HACCP_양식';
  const folders    = DriveApp.getFoldersByName(folderName);
  const folder     = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);
  const fileName = `${logMeta.docNo}_빈양식_${logMeta.version}.pdf`;
  if (folder.getFilesByName(fileName).hasNext()) return; // 이미 존재하면 스킵

  const html = `<h1>${logMeta.title} 빈 양식</h1><p>문서번호: ${logMeta.docNo}</p>`;
  const blob = Utilities.newBlob(html, 'text/html').getAs('application/pdf');
  blob.setName(fileName);
  folder.createFile(blob);
}