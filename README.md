# HACCP 스마트 관리 시스템 v3.0

대한민국 식품공장(1공장: 이유식, 2공장: 장조림)용 HACCP 일지 관리 시스템.
단일 웹앱·다중 공장 라우팅, Repository Pattern, 동적 폼 엔진.

## 폴더 구조

```
haccp-app/
├── server/         # Node.js + Express + SQLite 백엔드 (운영)
├── client/         # 프론트엔드 셸 + 동적 폼 엔진 (운영)
├── legacy/         # 옛 GAS 코드 + 옛 양식 HTML (참조 전용, 런타임 미사용)
├── docs/           # CLAUDE.md, 설계 문서
└── .backup/        # 자동 백업 (gitignore)
```

## 빠른 시작

```bash
cd server
npm install
node seed.js   # 최초 1회: 스키마 + 시드 데이터
node index.js  # http://localhost:3000
```

## 핵심 원칙

1. **Repository Pattern 격리** — 데이터 접근(`server/db.js`, `server/routes/*`) 외부에서 SQL을 직접 쓰지 마라.
2. **동적 폼 엔진** — 양식은 `log_templates` 테이블의 JSON으로 정의된다. 양식별 HTML 파일을 새로 만들지 마라.
3. **공장 격리** — `factoryRoles` JSON으로 권한 검증, 1공장/2공장 데이터는 백엔드에서 분리.
4. **선보고 후조치** — 코드 수정 전 계획을 먼저 보고하고 승인을 받아라.

자세한 컨벤션은 [`docs/CLAUDE.md`](docs/CLAUDE.md) 참조.
[`legacy/README.md`](legacy/README.md)도 함께 읽어라.
