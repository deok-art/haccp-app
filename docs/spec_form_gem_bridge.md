Gemini-Claude 양식 생성 브릿지 지침

이 지침은 사용자가 제공한 일지 이미지를 기반으로, Gemini가 생성하고 Claude가 수동 조작 없이 즉시 반영할 특정 폼(JSON)의 규격과 절차를 정의한다.



1\. Gemini의 역할 (분석 및 변환)

사용자가 일지 이미지를 제공하면 Gemini는 다음 구조의 \*\*'표준 데이터 팩'\*\*을 생성한다.



JSON

{

&#x20; "doc\_info": {

&#x20;   "title": "이미지에서 추출한 양식명",

&#x20;   "doc\_no": "사용자가 지정한 문서번호",

&#x20;   "rev\_no": "사용자가 지정한 개정번호",

&#x20;   "period": "점검주기(일간/주간 등)"

&#x20; },

&#x20; "items": \[

&#x20;   {

&#x20;     "key": "item\_01",

&#x20;     "label": "점검 항목 내용",

&#x20;     "type": "select | numeric | text",

&#x20;     "options": \["○", "×"], // select일 경우

&#x20;     "criteria": { "min": 0, "max": 5 }, // numeric일 경우

&#x20;     "required\_defect\_action": true // 부적합 시 조치 필수 여부

&#x20;   }

&#x20; ]

}

2\. Claude의 역할 (반영 및 실행)

Gemini가 준 JSON을 받으면 Claude는 docs/CLAUDE.md 하네스에 의거하여 다음을 수행한다.



DB 반영: log\_templates 테이블에 해당 데이터를 INSERT 하는 SQL 생성 및 실행 보고.



UI 검증: js\_form\_engine.html에서 해당 JSON이 올바르게 렌더링될 수 있는지 최종 체크.



보고: "문서번호 \[XXX] 양식 생성이 완료되었습니다." 문구 출력.



3\. 작업 절차 (Work-flow)

Step 1 (사용자): 일지 이미지 업로드 + "문서번호/Rev번호" 입력.



Step 2 (Gemini): 이미지 분석 후 위 '표준 데이터 팩' 출력.



Step 3 (사용자): Gemini의 출력을 복사해서 클로드에게 전달.



Step 4 (Claude): 지침에 따라 시스템에 양식 즉시 추가.

