# HACCP 스마트 관리 시스템 - 2공장 (PBⅡ)

## 프로젝트 개요
- 식품공장 HACCP 관리 전산화 시스템
- 현재: 2공장(PBⅡ) 시범 운영 중, 단일 웹앱에서 다중 공장 지원 구조로 설계
- 플랫폼: Google Apps Script (GAS) + Google Sheets
- 향후: 자체 서버 확보 시점에 자체 서버 + SQLite DB로 전면 이전 예정

## 개발 단계
- 1단계 (현재): 현장 패트롤 일지 전산화
- 2단계: 입고검수, 검교정, 실험 데이터 (월단위)
- 3단계: CCP 자동화 → 스마트 HACCP (하드웨어 연동)

## 파일 구조
### 서버 로직 (.gs)
- Code.gs     진입점 (doGet, include)
- auth.gs     로그인, 비밀번호, 서명
- records.gs  일지 CRUD, 결재 처리
- photo.gs    사진 드라이브 저장

### 프론트엔드 공통 (.html)
- index.html      HTML 뼈대
- css.html        전체 스타일
- js_core.html    전역 state, IndexedDB, 인증
- js_render.html  목록 렌더링
- js_form.html    폼 라우팅, 수집, 검증, 제출
- js_ui.html      모달, 서명, 관리자 기능
- js_photo.html   사진 업로드, 이미지 편집

### 양식 파일 네이밍 규칙
log_[양식번호소문자 하이픈제거].html
예시: 일일이물관리점검표(PBⅡ-SI-02-01) → log_si0201.html

## 양식 목록 (1단계 대상)
- log_si0101.html  조도점검표
- log_si0102.html  부대시설 위생점검일지
- log_si0103.html  영업장위생점검일지
- log_si0201.html  일일이물관리점검표 ← **기준 양식** (완성)
- log_si0202.html  작업장위생 및 온도 점검표
- log_si0203.html  방충방서 점검표
- log_si0204.html  개인위생점검일지
- log_si0205.html  공정 점검표
- log_si0206.html  폐기물처리점검표
- log_si0301.html  제조시설·설비 점검표
- log_si0401.html  냉장·냉동창고 점검표
- log_si0502.html  용수관리점검표

## 권한 체계
권한은 공장별로 독립적으로 부여 (Users 시트의 factoryRoles 컬럼에 JSON으로 저장)
예: {"pb2": 1, "pb1": 3} → 2공장 작성자, 1공장 승인자

- 권한1: 일지 작성만 가능
- 권한2: 작성 + 검토
- 권한3: 작성 + 검토 + 승인 + 관리자

## 다중 공장 UX 흐름
1. 접근 가능 공장이 1개 → 로그인 후 바로 해당 공장 메인 진입
2. 접근 가능 공장이 2개 이상 → 로그인 후 공장 선택 화면
3. 공장 선택 후:
   - 작성 탭: 선택한 공장 일지만 표시 (혼선 방지)
   - 검토/승인 탭: 권한 있는 모든 공장 일지 통합 표시 (공장 뱃지로 구분)
4. 상단 공장 전환 버튼 상시 노출 (작성 중일 때는 해당 공장 고정)

## 협업 규칙
- 코드 수정 전 반드시 기능 구현 방향을 먼저 설명하고 논의할 것 (코드 설명 X, 기능 설명 O)
- 사용자가 명시적으로 "코드 수정해"라고 할 때만 코드를 수정할 것
- GitHub 푸시는 사용자가 요청할 때만 할 것 (clasp push는 코드 수정 후 자동으로 해도 됨)

## 개발 규칙
- 모든 응답과 주석은 한국어로 작성
- 데이터 처리 로직은 .gs 파일에만 작성 (자체 서버 + SQLite 이전 대비, 프론트엔드 코드 재사용 극대화)
- 새 양식 추가 시 README의 "새 일지 추가 방법" 절차 따를 것
- 기준 양식: log_si0201.html — 구조, 함수 패턴, 네이밍 규칙 모두 이 파일 기준
- 공장별 완전 독립 운영 (데이터 공유 없음)

### 폼 엔진 사용 규칙
적합/부적합 체크리스트 양식은 반드시 `js_form_engine.html`의 공통 엔진을 사용한다.
각 양식 파일에는 CONFIG 상수와 얇은 래퍼 함수만 둔다.

**FORM_CONFIG 필수 구조:**
```js
var SI0XXX_CONFIG = {
  formId:   'si0xxx',       // 양식 고유 ID (소문자, 하이픈 제거)
  title:    '양식 이름',
  docNo:    'PBⅡ-SI-XX-XX',
  revision: 'Rev.1',
  period:   '점검 주기',
  location: '기본 점검 위치',
  groups: [
    { group: '그룹명', items: [{ key: 'unique_key', sub: '항목명', desc: '점검 내용' }] }
  ]
};
```

**래퍼 함수 패턴 (log_si0201.html 참고):**
- `initXxxForm(date, savedJson)` → `initFormEngine(CONFIG, 'containerId', savedJson)` 호출
- `setAllXxxOk()` → `setAllFormOk(CONFIG)` 위임
- `collectXxxData()` → `collectFormData(CONFIG)` + 추가 필드(location 등) 병합
- `validateXxx(data)` → `validateFormData(data, CONFIG)` 위임
- `getXxxDefectSummary(data)` → `getFormDefectSummary(data, CONFIG)` 위임
- `buildXxxPrintHtml(r,j,s)` → `buildFormPrintHtml(r, j, s, CONFIG)` 위임
- `buildXxxViewHtml(r,j,t,s)` → `buildFormViewHtml(r, j, t, s, CONFIG)` 위임

온도 기록 등 양식별 특수 필드는 FORM_CONFIG 외부에 별도 처리한다.

## 시트 구조 변경 규칙
코드 변경으로 인해 Google Sheets 구조 수정이 필요한 경우 (새 컬럼 추가, 시트 생성, 기존 데이터 마이그레이션 등):
1. Code.gs에 `setup[기능명]()` 형태의 마이그레이션 함수를 작성한다
2. 함수 주석에 `[최초 1회 실행]` 표시를 달아 구분한다
3. 사용자에게 반드시 알린다: "GAS 에디터에서 `함수명()` 실행해주세요"
4. 함수는 멱등성을 보장한다 (이미 적용된 경우 건너뛰도록 조건 체크)
5. 기존 `setupFactorySheets()`처럼 Logger.log로 진행상황을 출력한다
