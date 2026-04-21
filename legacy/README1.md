# legacy/

런타임에 사용되지 않는 **참조용 보존 파일**들이다.
운영/개발 코드는 `server/`와 `client/`에만 존재한다.

## 폴더 구성

### `gas/` — 옛 Google Apps Script 백엔드
SQLite 마이그레이션 이전, 데이터 저장소가 Google Sheets였을 때의 GAS 코드.
- `Code.gs`, `auth.gs`, `photo.gs`, `records.gs`, `appsscript.json`
- 새 백엔드(`server/`)는 동일한 함수명(`getInitialData`, `saveDraft` 등)을 Express 라우트로 재구현했다.
- API 시그니처를 비교하거나 비즈니스 로직을 검증할 때 참고용으로 열어볼 것.

### `forms-html/` — 옛 양식 HTML 파일
동적 폼 엔진(`client/js_form_engine.html`) 도입 이전, 양식별로 분리되어 있던 HTML 파일.
- `log_pb2_si0201.html` — 이물관리점검표(51개 항목). 현재는 SQLite `log_templates` 테이블의 `si0201` 행 JSON으로 이전됨.
- 시드 데이터 검증·항목 라벨 대조용으로 보존한다.

## 규칙

- **이 폴더의 파일을 import/include하지 마라.**
- 양식을 추가/수정할 때는 `log_templates` 테이블에 INSERT/UPDATE 하라. HTML 파일을 새로 만들지 마라.
- 백엔드 변경은 `server/`에서만, 프론트 변경은 `client/`에서만 한다.
