# HACCP 스마트 관리 시스템 v3.0

## 파일 구조

```
GAS 프로젝트 (공장별 독립 운영)
│
├── [서버 로직]
│   ├── Code.gs       진입점(doGet, include), 공통 데이터 조회, setupLogs()
│   ├── auth.gs       로그인, 비밀번호 변경, 서명 저장
│   ├── records.gs    일지 CRUD, 결재 처리 (검토/승인/취소)
│   └── photo.gs      사진 드라이브 저장
│
├── [프론트엔드 공통]
│   ├── index.html           HTML 뼈대 (include 순서 관리)
│   ├── css.html             전체 스타일
│   ├── js_core.html         전역 state, IndexedDB, 초기화, 인증/세션
│   ├── js_render.html       todo/done 목록 렌더링, 카드 빌드
│   ├── js_form.html         폼 라우팅, 수집·검증·제출, 뷰어
│   ├── js_ui.html           모달, 서명, 배치처리, 관리자 기능
│   ├── js_photo.html        사진 업로드, 이미지 편집
│   ├── js_form_engine.html  적합/부적합 체크리스트 폼 공통 엔진 (렌더링·수집·인쇄·뷰어)
│   ├── js_print_template.html  인쇄 헤더·결재란·바닥글 공통 빌더
│   └── js_print.html        인쇄/PDF 출력
│
└── [일지별 파일] — 네이밍: log_[양식번호소문자 하이픈제거].html
    └── log_si0201.html  이물관리 점검표 (PBⅡ-SI-02-01) ← 기준 양식
```

---

## 1단계 양식 목록

| 파일명 | 일지명 | 문서번호 | 상태 |
|---|---|---|---|
| log_si0101.html | 조도점검표 | PBⅡ-SI-01-01 | 미작성 |
| log_si0102.html | 부대시설 위생점검일지 | PBⅡ-SI-01-02 | 미작성 |
| log_si0103.html | 영업장위생점검일지 | PBⅡ-SI-01-03 | 미작성 |
| log_si0201.html | 일일이물관리점검표 | PBⅡ-SI-02-01 | **완성** |
| log_si0202.html | 작업장위생 및 온도 점검표 | PBⅡ-SI-02-02 | 미작성 |
| log_si0203.html | 방충방서 점검표 | PBⅡ-SI-02-03 | 미작성 |
| log_si0204.html | 개인위생점검일지 | PBⅡ-SI-02-04 | 미작성 |
| log_si0205.html | 공정 점검표 | PBⅡ-SI-02-05 | 미작성 |
| log_si0206.html | 폐기물처리점검표 | PBⅡ-SI-02-06 | 미작성 |
| log_si0301.html | 제조시설·설비 점검표 | PBⅡ-SI-03-01 | 미작성 |
| log_si0401.html | 냉장·냉동창고 점검표 | PBⅡ-SI-04-01 | 미작성 |
| log_si0502.html | 용수관리점검표 | PBⅡ-SI-05-02 | 미작성 |

---

## 새 일지 추가 방법

> **기준 양식**: `log_si0201.html` — 이 파일의 구조와 함수 패턴을 그대로 따를 것.
>
> **엔진 활용**: 렌더링·수집·인쇄·뷰어는 `js_form_engine.html`이 처리한다. 각 양식 파일은 `FORM_CONFIG`와 얇은 래퍼 함수 7개만 작성하면 된다.

### Step 1. 일지 파일 생성

`log_si0201.html`을 복사해서 `log_[logId].html`로 저장.

파일 맨 위 주석 수정:
```html
<!--
  log_si0202.html — [일지명]
  문서번호: PBⅡ-XX-XX
  logId:    si0202
-->
```

---

### Step 2. 양식 파일 내부 구조

파일은 **두 개의 블록**으로 구성된다.

#### 블록 1 — HTML 템플릿

```html
<script type="text/template" id="tpl-{logId}">
  <div class="form-section">
    <h3>1. 점검 기본 정보</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div>
        <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">점검일자</label>
        <input type="text" id="{logId}-date" readonly
          style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;background:#f5f5f5;">
      </div>
      <div>
        <label style="font-size:12px;color:#666;display:block;margin-bottom:4px;">점검자</label>
        <input type="text" id="{logId}-writer" readonly
          style="width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;box-sizing:border-box;background:#f5f5f5;">
      </div>
      <!-- 추가 헤더 필드가 있으면 여기에 -->
    </div>
    <div style="font-size:11px;color:#888;padding:6px 10px;background:#fffbea;border-radius:6px;border:1px solid #ffe082;">
      범례: ○ 적합 &nbsp;|&nbsp; × 부적합
    </div>
  </div>

  <div class="form-section">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;">2. [점검 섹션명]</h3>
      <button type="button" onclick="setAll{Prefix}Ok()" class="btn-all-ok"
        style="padding:8px 12px;border-radius:8px;border:none;background:#f39c12;color:white;font-weight:bold;cursor:pointer;">
        ✔ 전체 적합
      </button>
    </div>
    <!-- 엔진이 여기에 점검 항목을 렌더링한다 -->
    <div id="{logId}-groups-container"></div>
  </div>
</script>
```

**DOM id 네이밍 규칙**: 모든 id에 반드시 `{logId}-` 접두사를 붙인다.
- 필수: `{logId}-date`, `{logId}-writer`, `{logId}-groups-container`
- 추가 헤더 필드 예시: `{logId}-location`, `{logId}-period`

항목별 id는 `js_form_engine.html`이 자동 생성하므로 직접 작성하지 않는다.

---

#### 블록 2 — JavaScript 로직

**함수명 접두사**: logId를 PascalCase로 변환. 예: `si0202` → `Si0202`

##### 2-1. FORM_CONFIG 정의

모든 양식 설정과 점검항목을 하나의 객체에 담는다.

```javascript
var SI0202_CONFIG = {
  formId:   'si0202',              // logId와 동일
  title:    '[일지명]',
  docNo:    'PBⅡ-XX-XX',
  revision: 'Rev.1',
  period:   '일 1회',             // 점검주기 (헤더 표시용)
  location: '작업장',             // 기본 점검위치 (헤더 표시용, 불필요하면 생략)
  groups: [
    { group: '그룹명', items: [
      { key: 'unique_key', sub: '소분류명', desc: '점검 내용 설명' },
      // ...
    ]},
    // ...
  ]
};
```

**key 네이밍**: 영문 소문자 + 언더스코어, 파일 내 유일해야 함.

##### 2-2. 래퍼 함수 7개

엔진 함수를 그대로 위임하는 얇은 래퍼다. 아래 패턴을 그대로 복사하고 `Si0202` / `si0202` / `SI0202_CONFIG`만 교체한다.

```javascript
// ── 폼 초기화 ──────────────────────────────────────────
function initSi0202Form(date, savedJson) {
  var saved = {};
  try { if (savedJson) saved = JSON.parse(savedJson); } catch(e) {}
  document.getElementById('si0202-date').value     = date || state.serverToday;
  document.getElementById('si0202-writer').value   = state.user.name;
  // 추가 헤더 필드가 있으면 여기서 세팅
  // document.getElementById('si0202-location').value = saved.location || SI0202_CONFIG.location;
  initFormEngine(SI0202_CONFIG, 'si0202-groups-container', savedJson);
}

// ── 래퍼 함수 (엔진 위임) ─────────────────────────────
function setAllSi0202Ok()             { setAllFormOk(SI0202_CONFIG); }
function collectSi0202Data() {
  var data = collectFormData(SI0202_CONFIG);
  // 추가 헤더 필드가 있으면 여기서 병합
  // data.location = (document.getElementById('si0202-location') || {}).value || SI0202_CONFIG.location;
  return data;
}
function validateSi0202(data)         { return validateFormData(data, SI0202_CONFIG); }
function getSi0202DefectSummary(data) { return getFormDefectSummary(data, SI0202_CONFIG); }
function buildSi0202PrintHtml(r,j,s)  { return buildFormPrintHtml(r, j, s, SI0202_CONFIG); }
function buildSi0202ViewHtml(r,j,t,s) { return buildFormViewHtml(r, j, t, s, SI0202_CONFIG); }
```

> 양식에 특수한 필드(온도 측정, 수치 기록 등)가 있을 때만 해당 부분만 커스터마이징한다. 나머지는 엔진에 위임한다.

---

### Step 3. js_form.html 라우터 4곳 수정

각 라우터에 `else if` 분기 추가. **기존 si0201 분기 바로 아래**에 추가할 것.

#### openForm() — 템플릿 삽입 + 초기화

```javascript
} else if (logId === 'si0202') {
  var tpl = document.getElementById('tpl-si0202');
  if (tpl) formArea.innerHTML = tpl.innerHTML;
  if (typeof initSi0202Form === 'function') initSi0202Form(date, res && res.dataJson);
```

#### collectFormData() — 데이터 수집

```javascript
function collectFormData() {
  if (currentLogInfo.logId === 'si0201') return collectSi0201Data();
  if (currentLogInfo.logId === 'si0202') return collectSi0202Data();
  // ...
```

#### validateForm() — 검증

```javascript
function validateForm(data) {
  if (currentLogInfo.logId === 'si0201') return validateSi0201(data);
  if (currentLogInfo.logId === 'si0202') return validateSi0202(data);
  // ...
```

#### getDefectSummary() — 부적합 요약

```javascript
function getDefectSummary(data) {
  if (currentLogInfo.logId === 'si0201') return getSi0201DefectSummary(data);
  if (currentLogInfo.logId === 'si0202') return getSi0202DefectSummary(data);
  // ...
```

#### viewRecord() — 뷰어

```javascript
if (rec && rec.logId === 'si0201' && typeof buildSi0201ViewHtml === 'function') {
  html = buildSi0201ViewHtml(rec, res.dataJson, title, res);
} else if (rec && rec.logId === 'si0202' && typeof buildSi0202ViewHtml === 'function') {
  html = buildSi0202ViewHtml(rec, res.dataJson, title, res);
} else {
  html = buildGenericViewHtml(rec, res.dataJson, title, res);
}
```

---

### Step 4. index.html에 include 추가

```html
<?!= include('log_si0202'); ?>
```

---

### Step 5. Code.gs setupLogs() 에 항목 추가

```javascript
var LOG_ENTRIES = [
  // ... 기존 항목 ...
  { id: 'si0202', title: '작업장위생 및 온도 점검표', interval: '일간', docNo: 'PBⅡ-SI-02-02', version: 'v1.0' },
];
```

> 시트 구조 변경이 필요하면 `setup[기능명]()` 마이그레이션 함수 작성 후 GAS 에디터에서 실행.

---

## GAS 초기 설정 순서

1. `setupPermissions()` 실행 (권한 사전 획득)
2. Settings 시트에 `PhotoFolderId` 키 추가 (사진 저장 드라이브 폴더 ID)
3. Settings 시트에 `CompanyName`, `Logo` 추가 (선택)
4. Users 시트에 계정 추가 (id / pw_hash / name / role / signature)
5. Logs 시트에 일지 목록 추가
6. 웹앱 배포 (액세스 권한: 조직 내 모든 사용자)

---

## 공장 분리 운영

1공장 / 2공장은 GAS 프로젝트 자체를 분리해서 운영
- 별도 스프레드시트
- 별도 배포 URL
- 공유 데이터 없음 (완전 독립)

---

## 권한 체계

| 권한 등급 | 가능한 작업 |
|---|---|
| 1 | 일지 작성(입력)만 가능 |
| 2 | 작성 + 검토 가능 |
| 3 | 작성 + 검토 + 승인 + 관리자 기능 |

권한은 Users 시트 `factoryRoles` 컬럼에 JSON으로 저장.
예: `{"pb2": 1, "pb1": 3}` → 2공장 작성자, 1공장 승인자
