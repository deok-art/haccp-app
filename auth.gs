// ── 인증 및 사용자 관리 ──────────────────────────────────

/**
 * 로그인 처리
 * Users 시트 컬럼: ID(0) | PW(1) | 이름(2) | factoryRoles JSON(3) | 서명(4) | 직책(5)
 * factoryRoles 예시: {"pb2": 3, "pb1": 1}
 *
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

    // factoryRoles: JSON 문자열 또는 레거시 숫자 권한 모두 지원
    const rawRoles     = data[i][3];
    const factoryRoles = parseFactoryRoles(rawRoles);

    const isMaster = String(data[i][8] || '').toLowerCase() === 'true';

    // factoryDeputies: 대행 중인 공장 {factoryId: 원래권한} 형태
    const rawDeputies = String(data[i][9] || '');
    let factoryDeputies = {};
    try { factoryDeputies = rawDeputies.startsWith('{') ? JSON.parse(rawDeputies) : {}; } catch(e) {}

    // title 파생: factoryDeputies에 항목이 있으면 팀장대행, factoryRoles에 3이 있으면 팀장
    const isDeputy = Object.keys(factoryDeputies).length > 0;
    const isLeader = !isDeputy && Object.values(factoryRoles).some(r => parseInt(r) >= 3);
    const title    = isDeputy ? 'HACCP팀장 대행' : (isLeader ? 'HACCP팀장' : '');

    const userInfo = {
      id:              id,
      name:            data[i][2],
      factoryRoles:    factoryRoles,
      factoryDeputies: factoryDeputies, // 대행 중인 공장 정보
      isMaster:        isMaster,
      signature:       data[i][4],
      rank:            data[i][5] || '',
      title:           title
    };

    // 비밀번호 미설정 + 초기값(0000) 입력 → 비밀번호 변경 강제
    if (data[i][1] === '' && pw === '0000') {
      return { success: true, mustChangePw: true, userInfo: userInfo };
    }

    if (data[i][1] === hashedInput) {
      return { success: true, mustChangePw: false, userInfo: userInfo };
    }
  }

  return { success: false, message: '아이디 또는 비밀번호가 일치하지 않습니다.' };
}

/**
 * factoryRoles 파싱
 * - JSON 문자열이면 파싱
 * - 레거시 숫자면 현재 운영 공장(pb2) 권한으로 변환
 * @param {*} raw
 * @returns {Object} { factoryId: roleLevel, ... }
 */
function parseFactoryRoles(raw) {
  if (!raw && raw !== 0) return {};
  const str = String(raw).trim();

  // JSON 형식
  if (str.startsWith('{')) {
    try { return JSON.parse(str); } catch (e) { return {}; }
  }

  // 레거시 숫자 권한 → pb2 기본 공장으로 매핑
  const num = parseInt(str);
  if (!isNaN(num) && num > 0) return { pb2: num };

  return {};
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
