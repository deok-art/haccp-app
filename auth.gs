// ── 인증 및 사용자 관리 ──────────────────────────────────

/**
 * 로그인 처리
 * @param {string} id
 * @param {string} pw - 평문 (서버에서 해시 비교)
 */
function login(id, pw) {
  const sheet = SS.getSheetByName('Users');
  if (!sheet) return { success: false, message: 'Users 시트가 없습니다.' };

  const data        = sheet.getDataRange().getValues();
  const hashedInput = hashPassword(pw);

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] !== id) continue;

    // 비밀번호 미설정 + 초기값(0000) 입력 → 비밀번호 변경 강제
    if (data[i][1] === '' && pw === '0000') {
      return {
        success: true,
        mustChangePw: true,
        userInfo: { id, name: data[i][2], role: String(data[i][3]), signature: data[i][4] }
      };
    }

    if (data[i][1] === hashedInput) {
      return {
        success: true,
        mustChangePw: false,
        userInfo: { id, name: data[i][2], role: String(data[i][3]), signature: data[i][4] }
      };
    }
  }

  return { success: false, message: '아이디 또는 비밀번호가 일치하지 않습니다.' };
}

/**
 * 비밀번호 변경
 * @param {string} id
 * @param {string} plainPw - 평문 비밀번호
 */
function updatePassword(id, plainPw) {
  const sheet = SS.getSheetByName('Users');
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      sheet.getRange(i + 1, 2).setValue(hashPassword(plainPw));
      return true;
    }
  }
  return false;
}

/**
 * 전자서명 이미지(Base64) 저장
 * @param {string} id
 * @param {string} sigBase64
 */
function saveSignature(id, sigBase64) {
  const sheet = SS.getSheetByName('Users');
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === id) {
      sheet.getRange(i + 1, 5).setValue(sigBase64);
      return true;
    }
  }
  return false;
}

/**
 * SHA-256 해시 (비밀번호 저장/비교용)
 * @param {string} plainText
 * @returns {string} hex 문자열
 */
function hashPassword(plainText) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, plainText)
    .map(b => ('0' + (b & 0xFF).toString(16)).slice(-2))
    .join('');
}