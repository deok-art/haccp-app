// ── 사진 드라이브 저장 ─────────────────────────────────

/**
 * Base64 이미지를 구글 드라이브에 저장하고 공유 URL 반환
 * @param {string} recordId
 * @param {string} logId
 * @param {string} logTitle
 * @param {string} itemLabel  - 항목명 (파일명에 포함)
 * @param {string} photoType  - 'defect' | 'action'
 * @param {string} base64Data - data:image/... 포함 또는 순수 Base64
 * @returns {{ success: boolean, url?: string, fileId?: string, message?: string }}
 */
function savePhoto(recordId, logId, logTitle, itemLabel, photoType, base64Data) {
  try {
    const settings     = getSafeData('Settings');
    const rootFolderId = settings[PHOTO_FOLDER_ID_KEY];
    if (!rootFolderId) return { success: false, message: 'PhotoFolderId가 Settings 시트에 없습니다.' };

    const rootFolder = DriveApp.getFolderById(rootFolderId);

    // 일지별 하위 폴더 (없으면 생성)
    const subFolderName = `${logId}_${logTitle}`;
    const subIter       = rootFolder.getFoldersByName(subFolderName);
    const subFolder     = subIter.hasNext() ? subIter.next() : rootFolder.createFolder(subFolderName);

    // 파일명: yyyyMMdd_RecordID_항목명_타입.jpg
    const dateStr   = Utilities.formatDate(new Date(), 'GMT+9', 'yyyyMMdd');
    const safeLabel = itemLabel.replace(/[\/\\\:\*\?\"\<\>\|]/g, '_');
    const typeLabel = photoType === 'defect' ? '부적합' : '개선조치';
    const fileName  = `${dateStr}_${recordId}_${safeLabel}_${typeLabel}.jpg`;

    // Base64 디코딩 → Blob → 파일 저장
    const base64Clean = base64Data.replace(/^data:image\/\w+;base64,/, '');
    const blob        = Utilities.newBlob(Utilities.base64Decode(base64Clean), 'image/jpeg', fileName);
    const file        = subFolder.createFile(blob);

    // 링크 공유 설정 (뷰 전용)
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    const fileId = file.getId();
    const viewUrl = `https://lh3.googleusercontent.com/d/${fileId}`;

    return { success: true, url: viewUrl, fileId };
  } catch (e) {
    return { success: false, message: e.toString() };
  }
}

/**
 * 드라이브 접근 권한 테스트 (스크립트 에디터에서 수동 1회 실행)
 */
function testDriveAccess() {
  const settings  = getSafeData('Settings');
  const folderId  = settings[PHOTO_FOLDER_ID_KEY];
  if (!folderId) { Logger.log('PhotoFolderId 없음'); return; }
  const folder = DriveApp.getFolderById(folderId);
  Logger.log('드라이브 접근 성공: ' + folder.getName());
}