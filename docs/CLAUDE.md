# CLAUDE.md

이 저장소의 공통 규칙 원본은 `AGENTS.md`이다.
작업 전 반드시 `AGENTS.md`를 먼저 읽고 따른다.

## 읽기 순서
1. `AGENTS.md`
2. `docs/master_plan.md`
3. `docs/spec_header.md`
4. `docs/spec_approval.md`
5. `docs/spec_form_engine.md`

## Claude 작업 원칙
- 먼저 탐색한다.
- 바로 수정하지 않는다.
- 구현 방향, 수정 파일, 영향 범위를 먼저 보고한다.
- 원본을 `.backup/YYYYMMDD-HHMMSS/`에 백업한 후 수정한다.
- 가장 작은 안전한 변경만 수행한다.
- 기존 한국어 현업 문구와 필드명은 요청 없으면 바꾸지 않는다.

## Claude 절대 금지
- `factory_id` 누락
- 공장 데이터 혼합
- `server/db.js` 외 SQL 작성
- `doc_no` 자동 생성
- 개별 양식 HTML 신규 생성
- 부적합 개선조치 강제 해제
- 결재 상태 전이 임의 변경
- 승인 전 직접 수정

## 불확실할 때
추측하지 말고:
1. 관련 스펙 문서를 확인하고
2. 제약사항을 요약한 뒤
3. 가장 작은 변경안을 제안한다.