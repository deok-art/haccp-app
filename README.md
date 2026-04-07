# HACCP 스마트 관리 시스템 v3.0

## 파일 구조

```
GAS 프로젝트 (공장별 독립 운영)
│
├── [서버 로직]
│   ├── code.gs       진입점(doGet, include), 공통 데이터 조회
│   ├── auth.gs       로그인, 비밀번호 변경, 서명 저장
│   ├── records.gs    일지 CRUD, 결재 처리 (검토/승인/취소)
│   └── photo.gs      사진 드라이브 저장
│
├── [프론트엔드 공통]
│   ├── index.html    HTML 뼈대 (include 순서 관리)
│   ├── css.html      전체 스타일
│   ├── js_core.html  전역 state, IndexedDB, 초기화, 인증/세션
│   ├── js_render.html  todo/done 목록 렌더링, 카드 빌드
│   ├── js_form.html  폼 라우팅, 수집·검증·제출, 뷰어
│   ├── js_ui.html    모달, 서명, 배치처리, 관리자 기능
│   └── js_photo.html 사진 업로드, 이미지 편집
│
└── [일지별 파일]
    └── log_fo01.html  이물관리 점검표 (PBⅡ-FO-01)
```

---

## 새 일지 추가 방법

### 1. 일지 파일 생성
`log_fo01.html`을 복사해서 `log_[유형코드].html`로 저장

### 2. 파일 내 수정 항목
- `FB_CHECK_ITEMS` → 해당 일지 점검항목 배열로 교체
- 함수명 prefix `Fb` → 일지 구분 문자로 변경 (겹치지 않게)
- 템플릿 id `tpl-fo01` → `tpl-[logId]`로 변경

### 3. js_form.html 라우터 수정
`openForm()` 함수 내 분기 추가:
```javascript
} else if (logId === '[신규logId]') {
  var tpl = document.getElementById('tpl-[신규logId]');
  if (tpl) formArea.innerHTML = tpl.innerHTML;
  if (typeof init[신규]Form === 'function') init[신규]Form(date);
}
```

`viewRecord()` 함수 내 뷰어 분기 추가:
```javascript
} else if (rec.logId === '[신규logId]' && typeof build[신규]ViewHtml === 'function') {
  html = build[신규]ViewHtml(rec, res.dataJson, title);
}
```

### 4. index.html include 추가
```html
<?!= include('log_[신규logId]'); ?>
```

### 5. Logs 시트에 행 추가
| id | title | interval | summer | winter | docNo | version |
|---|---|---|---|---|---|---|
| [신규logId] | 일지명 | 일간 | | | PBⅡ-XX-01 | v1.0 |

---

## GAS 초기 설정 순서

1. 스크립트 에디터에서 `setupPermissions()` 실행 (권한 사전 획득)
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
