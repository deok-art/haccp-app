# HACCP 스마트 관리 시스템 - 2공장 (PBⅡ)

## 프로젝트 개요
- 식품공장 HACCP 관리 전산화 시스템
- 현재: 2공장(PBⅡ) 시범 운영 중
- 플랫폼: Google Apps Script (GAS) + Google Sheets
- 향후: 자체 서버 + SQLite DB 이전 예정

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
- log_si0201.html  일일이물관리점검표 ← 현재 log_fo01.html (이름 변경 필요)
- log_si0202.html  작업장위생 및 온도 점검표
- log_si0203.html  방충방서 점검표
- log_si0204.html  개인위생점검일지
- log_si0205.html  공정 점검표
- log_si0206.html  폐기물처리점검표
- log_si0301.html  제조시설·설비 점검표
- log_si0401.html  냉장·냉동창고 점검표
- log_si0502.html  용수관리점검표

## 권한 체계
- 권한1: 일지 작성만 가능
- 권한2: 작성 + 검토
- 권한3: 작성 + 검토 + 승인 + 관리자

## 개발 규칙
- 모든 응답과 주석은 한국어로 작성
- 데이터 처리 로직은 .gs 파일에만 작성 (SQLite 이전 대비)
- 새 양식 추가 시 README의 "새 일지 추가 방법" 절차 따를 것
- 공장별 완전 독립 운영 (데이터 공유 없음)
