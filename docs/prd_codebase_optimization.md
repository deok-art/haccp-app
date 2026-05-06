# PRD: 전체 코드베이스 아키텍처 최적화

> **이슈 트래커 게시 대기중**
> GitHub Issues에 `needs-triage` 라벨로 등록 필요.
> 명령: `gh issue create --title "PRD: 전체 코드베이스 아키텍처 최적화" --label "needs-triage" --body-file docs/prd_codebase_optimization.md`

---

## Problem Statement

현재 HACCP 스마트 관리 시스템의 서버 코드베이스는 기능 추가와 버그 수정이 반복되면서 아키텍처 부채가 누적됐다. 핵심 로직이 여러 파일에 분산·중복되어 있어 한 곳을 수정하면 다른 곳의 유사 코드도 찾아서 고쳐야 하는 상황이 반복된다. 권한 검사 로직, 날짜 계산, 결재 상태 전이 등 비즈니스 규칙이 흩어져 있어 변경 비용이 높고 버그 재현 경로가 불투명하다.

구체적으로:
- 동일한 유틸리티 함수가 6개 이상의 파일에 각각 재구현되어 있다.
- 권한 검사 코드가 `template-access.js`, 각 라우트 파일에 산발적으로 구현돼 있어 일관성을 보장할 수 없다.
- 결재 상태 전이(8가지 액션)가 `if` 문으로 분산돼 있어 전체 흐름을 파악하려면 코드 전체를 추적해야 한다.
- 항목 타입별 검증 로직이 114줄짜리 단일 함수에 뭉쳐 있어 새 타입 추가 시 기존 로직을 건드려야 한다.
- 미작성 현황 대시보드 생성 로직이 6가지 주기(daily/weekly/monthly/quarterly/biweekly/seasonal)를 하나의 209줄 함수에서 처리한다.

## Solution

코드베이스를 5개의 독립적인 리팩터링 단위로 분리하여 순차적으로 개선한다. 각 단위는 외부 API 계약을 유지하면서 내부 구조만 정리하므로, 기능 동작 변경 없이 진행할 수 있다.

1. **유틸리티 공유 모듈 도입**: 중복 함수를 `server/lib/` 아래 단일 모듈로 통합한다.
2. **권한 검사 미들웨어 통합**: 라우트별 재구현을 제거하고 Express 미들웨어로 중앙화한다.
3. **항목 검증 로직 분리**: 타입별 validator 함수를 독립 모듈로 분리한다.
4. **주기별 전략 분리**: 미작성 대시보드의 주기 처리를 전략 객체로 분리한다.
5. **결재 상태 머신 명시화**: 상태 전이를 선언적 테이블로 추출한다.

## User Stories

1. As a 개발자, I want `deriveTitle()` 함수가 단일 위치에 정의되기를 원한다, so that 직함 파생 규칙이 변경될 때 한 파일만 수정하면 된다.
2. As a 개발자, I want `getFactories()` 함수가 공유 모듈에서 export되기를 원한다, so that 공장 목록 조회 로직이 여러 라우트에 중복되지 않는다.
3. As a 개발자, I want 날짜·주기 계산 함수(`getWeekBounds`, `getQuarterBounds` 등)가 공유 모듈에 있기를 원한다, so that 주/분기 경계 버그를 한 곳에서 수정하면 전체 시스템에 반영된다.
4. As a 개발자, I want `safeJson()` 유틸리티가 모든 라우트에서 일관되게 사용되기를 원한다, so that JSON 파싱 에러가 사일런트하게 발생하지 않는다.
5. As a 개발자, I want 권한 검사가 Express 미들웨어로 제공되기를 원한다, so that 라우트 핸들러에 역할 계산 코드가 없어도 `req.callerRole`을 바로 읽을 수 있다.
6. As a 개발자, I want 역할 숫자(0, 1, 2, 3, 99)가 명명된 상수로 정의되기를 원한다, so that 역할 값의 의미를 코드 맥락 없이 이해할 수 있다.
7. As a 개발자, I want `routes/templates.js`와 `routes/workers.js`에서 로컬 `getCallerRole()` 구현이 제거되기를 원한다, so that 권한 정책 변경이 한 곳에서만 이루어진다.
8. As a 개발자, I want `routes/calendar.js`의 `getFactoryRole()` 구현이 공유 미들웨어로 통합되기를 원한다, so that 공장별 역할 계산이 파일마다 다르게 동작하는 위험이 없다.
9. As a 개발자, I want `validateTemplateRequiredItems`가 타입별 함수(`validateCheckItem`, `validateTempItem`, `validateCertificateItem` 등)로 분리되기를 원한다, so that 새 항목 타입 추가 시 기존 타입 검증 로직에 영향을 주지 않는다.
10. As a 개발자, I want 각 타입 validator가 독립적으로 테스트 가능하기를 원한다, so that `certificate` 타입 검증 버그를 전체 함수를 이해하지 않고도 재현·수정할 수 있다.
11. As a 개발자, I want `repeat_section` 항목의 중첩 검증이 별도 함수로 분리되기를 원한다, so that 반복 섹션의 동작을 격리된 테스트로 검증할 수 있다.
12. As a 개발자, I want `getMissingDashboard`의 주기별 처리 로직이 전략 객체로 분리되기를 원한다, so that 새 주기를 추가할 때 기존 주기 코드를 건드리지 않아도 된다.
13. As a 개발자, I want `seasonal` 주기의 summer/winter 분기가 독립 전략으로 구현되기를 원한다, so that 계절 조건 변경이 다른 주기 로직에 영향을 주지 않는다.
14. As a 개발자, I want 각 주기 전략이 날짜 범위 생성·작업일 필터·상태 맵 조회를 캡슐화하기를 원한다, so that 단위 테스트에서 주기 로직을 독립적으로 검증할 수 있다.
15. As a 개발자, I want 결재 상태 전이가 선언적 테이블로 정의되기를 원한다, so that "이 상태에서 이 액션이 유효한가?"라는 질문에 코드 추적 없이 답할 수 있다.
16. As a 개발자, I want 2단 결재와 3단 결재 흐름이 상태 테이블에서 명시적으로 분리되기를 원한다, so that 결재 단계 변경 시 영향 범위가 즉시 파악된다.
17. As a 개발자, I want 유효하지 않은 상태 전이 시도가 테이블 조회만으로 거부되기를 원한다, so that 허용되지 않은 전이 경로가 런타임 예외 대신 설계 단계에서 드러난다.
18. As a 시스템 관리자, I want 감사 로그 저장 실패가 사일런트하게 무시되지 않기를 원한다, so that 감사 기록 누락을 인지하고 대응할 수 있다.
19. As a 개발자, I want 주기·상태값·역할 번호 등 매직 상수가 명명된 상수로 교체되기를 원한다, so that 값의 의미를 주석 없이 코드에서 파악할 수 있다.
20. As a 개발자, I want 각 리팩터링 단계 후에도 기존 API 계약이 유지되기를 원한다, so that 클라이언트 코드를 수정하지 않아도 서버 리팩터링이 가능하다.

## Implementation Decisions

### 모듈 구성

**신규 모듈 (server/lib/)**

- `utils/date.js` — `getWeekBounds`, `getQuarterBounds`, `getBiweekBounds`, `now`, `today`, `toLocalDate` 통합. 날짜 함수는 현재 시각을 매개변수로 받을 수 있게 설계해 테스트에서 고정값을 주입 가능하게 한다.
- `utils/json.js` — `safeJson` 단일 export. 모든 라우트의 직접 `JSON.parse` 호출을 이것으로 교체.
- `utils/user.js` — `deriveTitle`, `getFactories`. 사용자·공장 관련 공통 로직 전용.
- `middleware/callerRole.js` — Express 미들웨어. `req.session.user`와 `req.body.factoryId`(또는 `req.query.factoryId`)를 읽어 `req.callerRole`과 `req.callerFactory`를 설정. 역할 숫자는 이 파일에서 명명된 상수(`ROLE_READER`, `ROLE_WORKER`, `ROLE_MANAGER`, `ROLE_MASTER`)로 정의.
- `validation/items.js` — 타입별 validator 함수 모음. `validateCheckItem`, `validateTempItem`, `validateNumericItem`, `validateCertificateItem`, `validateRepeatSection` 등. 최상위 `validateTemplateRequiredItems`는 타입을 보고 해당 함수를 디스패치.
- `calendar/strategies.js` — 주기별 전략 객체. `DailyStrategy`, `WeeklyStrategy`, `MonthlyStrategy`, `QuarterlyStrategy`, `BiweeklyStrategy`, `SeasonalStrategy`. 각 전략은 `getDateRange(baseDate)`, `filterWorkdays(dates, calendar)`, `buildAlertItems(records, templates)` 메서드를 구현.
- `workflow/approval.js` — 결재 상태 전이 테이블. `TRANSITIONS[currentStatus][action]` 형태로 다음 상태와 검증 조건을 선언. 2단/3단 결재 설정을 입력받아 유효 전이 집합을 반환하는 함수 포함.

**수정 모듈 (기존 파일)**

- `routes/records.js` — `validateTemplateRequiredItems`를 `validation/items.js`에서 import. 상태 전이 로직을 `workflow/approval.js`에서 import. 날짜 유틸을 `utils/date.js`에서 import.
- `routes/auth.js`, `routes/data.js`, `routes/users.js`, `routes/templates.js` — `deriveTitle`, `getFactories`를 `utils/user.js`에서 import. 로컬 구현 제거.
- `routes/templates.js`, `routes/workers.js`, `routes/calendar.js` — 로컬 `getCallerRole`/`getFactoryRole` 제거. `callerRole` 미들웨어 적용.
- `server/factory-calendar.js` — `getMissingDashboard` 내부를 전략 패턴으로 교체. 날짜 유틸을 `utils/date.js`에서 import.

### API 계약 유지

모든 엔드포인트의 요청·응답 형식은 변경하지 않는다. 리팩터링은 서버 내부 구조에만 적용된다.

### 매직 상수 교체

| 현재 | 교체 대상 |
|------|-----------|
| `role >= 3` | `role >= ROLE_MANAGER` |
| `status === '작성완료'` | `status === STATUS.SUBMITTED` |
| `interval === 'daily'` | `INTERVAL.DAILY` |

### 감사 로그 에러 처리

`audit.js`의 빈 catch 블록을 제거하고, 에러를 `console.error`로 기록한다. 감사 로그 저장 실패가 레코드 처리 자체를 롤백하지는 않는다(선택적 관심사).

## Testing Decisions

**좋은 테스트 기준**
- 외부 동작(입력→출력)을 검증하고 내부 구현에 의존하지 않는다.
- 데이터베이스·세션·현재 시각 등 외부 의존성은 매개변수 주입 또는 test fixture로 대체한다.
- 단일 시나리오당 하나의 assertion focus.

**테스트 대상 모듈 (우선순위 순)**

1. `utils/date.js` — `getWeekBounds`, `getQuarterBounds` 등의 경계값 테스트 (월초, 분기초, 연말). 현재 시각을 매개변수로 주입받으므로 DB 없이 순수 함수 테스트 가능.
2. `validation/items.js` — 타입별 validator를 독립 단위 테스트. 필수값 누락, 범위 초과, 부적합 선택 시 사유 미입력 등 엣지 케이스.
3. `workflow/approval.js` — 상태 전이 테이블 테스트. 각 `[currentStatus][action]` 조합의 허용/거부 여부, 다음 상태값 확인. 2단/3단 결재 분기별 테스트.
4. `calendar/strategies.js` — 전략별 `getDateRange`, `filterWorkdays` 단위 테스트. 주간 경계, 공휴일 포함 여부, seasonal summer/winter 전환 날짜.
5. `middleware/callerRole.js` — 역할 숫자 매핑, 다중 공장 사용자의 공장별 역할 파생.

**기존 테스트 참조**
- `server/test/api.test.js` — 통합 테스트 패턴 (실제 DB 사용, 세션 스텁). 신규 단위 테스트는 이 파일과 동일한 test-db helper를 재사용한다.
- `server/test/helpers/test-db.js` — DB 픽스처 헬퍼. 신규 테스트에서도 동일하게 사용.

## Out of Scope

- 클라이언트(HTML/JS) 코드 변경: 이번 PRD는 서버 아키텍처에만 집중한다.
- 새로운 기능 추가: 기존 동작을 보존하는 리팩터링만 포함한다.
- 데이터베이스 스키마 변경: 테이블 구조나 컬럼 변경은 포함하지 않는다.
- ORM 도입: SQLite 직접 쿼리 방식을 유지한다.
- 성능 최적화 (쿼리 튜닝, 캐싱 전략): 별도 PRD로 다룬다.
- 한글 인코딩 오류 수정 (`records.js` 라인 512, 522, 530, 532): 별도 버그 이슈로 처리한다.

## Further Notes

- 리팩터링은 5개 단위를 독립적으로 진행할 수 있다. 각 단계는 별도 PR로 분리해 리뷰 부담을 줄인다.
- `server/lib/` 디렉토리 생성이 첫 번째 선행 작업이다. 이후 각 모듈이 이 디렉토리를 import 기준으로 삼는다.
- 공장 격리(`factory_id` WHERE 조건)는 리팩터링 대상이 아니다. 현재 격리 메커니즘은 유지한다.
- 결재 흐름 테이블 추출 후, 2단/3단 결재 검증 로직(`approval` JSON 컬럼 참조)이 올바르게 동작하는지 별도 QA가 필요하다.
