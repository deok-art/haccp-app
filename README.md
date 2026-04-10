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
│   ├── index.html      HTML 뼈대 (include 순서 관리)
│   ├── css.html        전체 스타일
│   ├── js_core.html    전역 state, IndexedDB, 초기화, 인증/세션
│   ├── js_render.html  todo/done 목록 렌더링, 카드 빌드
│   ├── js_form.html    폼 라우팅, 수집·검증·제출, 뷰어
│   ├── js_ui.html      모달, 서명, 배치처리, 관리자 기능
│   ├── js_photo.html   사진 업로드, 이미지 편집
│   └── js_print.html   인쇄/PDF 출력
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
  <!-- 폼 화면에 삽입될 HTML -->
  <div class="form-section">
    <h3>1. 점검 기본 정보</h3>
    <!-- 점검일자, 점검자 (readonly), 추가 헤더 필드들 -->
    <input type="text" id="{logId}-date" readonly ...>
    <input type="text" id="{logId}-writer" readonly ...>
  </div>

  <div class="form-section">
    <h3>2. [점검 섹션명]</h3>
    <!-- "전체 적합" 버튼 -->
    <button onclick="setAll{Prefix}Ok()" class="btn-all-ok">✔ 전체 적합</button>
    <!-- 점검 항목 컨테이너 -->
    <div id="{logId}-groups-container"></div>
  </div>
</script>
```

**DOM id 네이밍 규칙**: 모든 id에 반드시 `{logId}-` 접두사를 붙인다.
- `{logId}-date`, `{logId}-writer`, `{logId}-groups-container`
- 항목별: `{logId}-item-{key}`, `{logId}-ok-{key}`, `{logId}-ng-{key}`, `{logId}-ng-area-{key}`
- 텍스트: `{logId}-defect-text-{key}`, `{logId}-action-text-{key}`
- 사진: `defect-photo-preview-{key}`, `action-photo-preview-{key}`
- 사진 input: `photo-input-defect-camera-{key}`, `photo-input-defect-gallery-{key}`
- 사진 input: `photo-input-action-camera-{key}`, `photo-input-action-gallery-{key}`

---

#### 블록 2 — JavaScript 로직

**함수명 접두사**: logId를 PascalCase로 변환. 예: `si0202` → `Si0202`

```javascript
// ════════════════════════════════════════════════════════
//  log_si0202.html — [일지명] ([문서번호])
// ════════════════════════════════════════════════════════
```

##### 2-1. 점검항목 데이터

그룹 구조가 있는 경우 (si0201 방식):
```javascript
var SI0202_GROUPS = [
  { group: '그룹명', items: [
    { key: 'unique_key', sub: '소분류명', desc: '점검 내용 설명' },
    // ...
  ]},
  // ...
];
```

그룹 없이 단순 목록인 경우:
```javascript
var SI0202_ITEMS = [
  { key: 'unique_key', label: '항목명' },
  // ...
];
```

**key 네이밍**: 영문 소문자 + 언더스코어, 파일 내 유일해야 함. (다른 양식과 겹쳐도 무방 — 각 logId별 독립 DOM)

---

##### 2-2. 필수 함수 목록 (10개)

모든 양식은 아래 함수를 반드시 구현한다.

| 함수 | 역할 | 호출 위치 |
|---|---|---|
| `init{Prefix}Form(date, savedJson)` | 폼 초기화, 저장 데이터 복원 | `js_form.html > openForm()` |
| `render{Prefix}Groups()` | 점검 항목 DOM 렌더링 | `init{Prefix}Form` 내부 |
| `build{Prefix}ItemEl(item)` | 항목 1개 엘리먼트 생성 | `render{Prefix}Groups` 내부 |
| `toggle{Prefix}Group(header)` | 그룹 접기/펼치기 | 그룹 헤더 onclick |
| `select{Prefix}Result(key, result)` | 적합/부적합 선택 → DOM 업데이트 | 토글 버튼 onclick |
| `setAll{Prefix}Ok()` | 전체 항목 적합 처리 | "전체 적합" 버튼 onclick |
| `collect{Prefix}Data()` | 폼 → JSON 수집 | `js_form.html > collectFormData()` |
| `validate{Prefix}(data)` | 부적합 시 필수 입력 검증 | `js_form.html > validateForm()` |
| `get{Prefix}DefectSummary(data)` | 부적합 요약 JSON 문자열 반환 | `js_form.html > getDefectSummary()` |
| `build{Prefix}ViewHtml(rec, dataJsonStr, title, sigRes)` | 뷰어 모달 HTML 생성 | `js_form.html > viewRecord()` |
| `build{Prefix}PrintHtml(rec, dataJsonStr, sigRes)` | 인쇄용 A4 HTML 생성 | `js_print.html` |

> 그룹이 없는 단순 목록 양식은 `render{Prefix}Groups`와 `toggle{Prefix}Group` 생략 가능.

---

##### 2-3. 데이터 저장 구조 (collectData 반환값)

```javascript
// 그룹 구조 양식
{
  location: '작업장',   // 추가 헤더 필드 (필요한 것만)
  items: {
    '{key}': {
      result:      'ok' | 'ng',
      defectText:  '',
      actionText:  '',
      defectPhoto: '',   // base64 or Drive URL
      actionPhoto: ''
    },
    // ...
  }
}
```

**formState 활용**:
- `formState.checkData[key]` — 현재 결과값 ('ok'|'ng')
- `formState.defectTexts[key]` — 부적합 내용
- `formState.actionTexts[key]` — 개선조치 내용
- `formState.defectPhotos[key]` — 부적합 사진
- `formState.actionPhotos[key]` — 조치 사진

---

##### 2-4. 초기화 함수 패턴

```javascript
function init{Prefix}Form(date, savedJson) {
  // 1. 헤더 필드 세팅
  document.getElementById('{logId}-date').value   = date || state.serverToday;
  document.getElementById('{logId}-writer').value = state.user.name;

  // 2. 저장 데이터 복원
  var saved = {};
  if (savedJson) { try { saved = JSON.parse(savedJson); } catch(e) {} }

  // 3. formState 초기화
  {PREFIX}_GROUPS.forEach(function(grp) {
    grp.items.forEach(function(item) {
      var s = (saved.items || {})[item.key] || {};
      formState.checkData[item.key]    = s.result      || 'ok';
      formState.defectTexts[item.key]  = s.defectText  || '';
      formState.actionTexts[item.key]  = s.actionText  || '';
      formState.defectPhotos[item.key] = s.defectPhoto || '';
      formState.actionPhotos[item.key] = s.actionPhoto || '';
    });
  });

  // 4. 추가 필드 복원 (필요 시)
  if (saved.location) document.getElementById('{logId}-location').value = saved.location;

  // 5. 렌더링
  render{Prefix}Groups();
}
```

---

##### 2-5. 부적합 항목 UI 패턴

부적합 선택 시 표시되는 상세 입력 영역 구조:

```html
<!-- 부적합 내용 -->
<label>🚨 부적합 내용 <span>*</span></label>
<textarea id="{logId}-defect-text-{key}"></textarea>

<!-- 부적합 사진 -->
<label>📷 부적합 사진 (선택)</label>
<div id="defect-photo-preview-{key}"></div>
<button onclick="triggerPhoto('defect','{key}','camera')">📷 카메라</button>
<button onclick="triggerPhoto('defect','{key}','gallery')">🖼 갤러리</button>
<input type="file" accept="image/*" capture="environment"
  id="photo-input-defect-camera-{key}"
  onchange="handlePhoto('defect','{key}',this,'{sub}_부적합')">
<input type="file" accept="image/*"
  id="photo-input-defect-gallery-{key}"
  onchange="handlePhoto('defect','{key}',this,'{sub}_부적합')">

<!-- 개선조치 내용 -->
<label>🔧 개선조치 내용 <span>*</span></label>
<textarea id="{logId}-action-text-{key}"></textarea>

<!-- 개선조치 사진 (동일 패턴, 'action' 으로 변경) -->
```

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
