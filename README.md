# sbe-jira-ui

Jira 업무 보조 웹 UI — 설정 관리, Gemini 채팅, Jira 검색, 유사 이슈 검색 통합

```bash
# 실행
python config_ui.py
# 브라우저: http://localhost:8765
```

---

## 화면 구성

사이드바 메뉴로 4개 페이지 전환 (SPA 방식, 별도 HTML 파일 없음)

```
┌─────────────┬──────────────────────────────────┐
│  sbe-jira   │                                  │
│             │     선택된 페이지 콘텐츠          │
│ ⚙ 환경설정  │                                  │
│ ─────────── │                                  │
│ 🤖 Gemini   │                                  │
│ 💬 Jira     │                                  │
│ 🔍 유사이슈  │                                  │
└─────────────┴──────────────────────────────────┘
```

---

## ⚙ 환경설정

Gemini와 Jira 연결에 필요한 키를 한 곳에서 관리합니다.

### Gemini 설정

| 항목 | 설명 |
|------|------|
| API Key | Google AI Studio에서 발급한 Gemini API 키 |
| 모델 | 사용할 Gemini 모델 선택 (기본: gemini-2.5-flash) |
| ⚡ 상태 확인 | API 키 유효 여부 즉시 확인 (countTokens API ping) |

**상태 확인 판단 기준:**
- 🟢 정상 — API 키 유효, 모델 존재
- 🟡 할당량 초과 (429) — quota 소진
- 🔴 모델 없음 (404) — 모델명 오류
- 🔴 API 키 오류 (400/401/403)

### Jira 설정

| 항목 | 설명 |
|------|------|
| PAT Token | Jira 프로필 → 개인 액세스 토큰에서 발급 |
| 사용자명 | Jira 사용자 ID (사번, 예: 223733) |

> Jira 서버 주소(`https://jira.sinc.co.kr`)는 내부 고정값으로 별도 설정 불필요

---

## 🤖 Gemini 채팅

Gemini와 자유 대화합니다. 이전 대화 내용이 컨텍스트로 유지됩니다.

---

## 💬 Jira 테스트

이슈 키 또는 JQL을 직접 입력해 Jira를 조회합니다.

**사용 예시:**
```
SCM3-15200
```
```
project = SCM3 AND assignee = currentUser() AND status != 완료 ORDER BY updated DESC
```

---

## 🔍 유사 이슈 검색

미해결 이슈와 비슷한 **과거 완료 이슈 Top 3**를 찾아줍니다.
처리 방법을 참고하거나 중복 이슈 여부를 확인할 때 사용합니다.

### 동작 원리

```
[캐시 구축]  지정 사용자들의 완료 이슈 → Gemini Embedding → 벡터 저장
[유사 검색]  미해결 이슈 → 임베딩 → 완료 이슈 벡터와 코사인 유사도 계산 → Top 3
```

- 이슈 타입별 비교 (서비스요청관리 ↔ 서비스요청관리, 변경관리 ↔ 변경관리)
- 임베딩 텍스트: `[이슈타입] 제목 + 설명 앞 300자` (양쪽 동일 구조로 공평한 비교)
- 변경이관/팀이관 상태 이슈는 유사검색 대상에서 제외

### 사용 방법

**1단계 — 검색 대상 사용자 지정**

나(자동 포함) + 추가로 비교할 팀원 사번 최대 2명 입력

**2단계 — 캐시 구축**

`[🔄 캐시 구축 / 갱신]` 버튼 클릭
완료 이슈들의 임베딩 벡터를 `data/embedding_cache.json`에 저장합니다.
최초 1회 또는 완료 이슈가 많이 쌓였을 때 갱신합니다.

**3단계 — 유사 이슈 검색**

`[🔍 유사 이슈 검색]` 버튼 클릭
미해결 이슈 목록과 각 이슈별 유사 완료 이슈 Top 3가 표시됩니다.

```
[SCM3-15300] EP 권한 신청 - 이철수
 🟡 미해결  서비스요청관리
 ┌─ 유사 완료 이슈 Top 3 ─────────────────┐
 │ 98%  SCM3-14200  EP 권한 신청 - 박영수 │
 │ 91%  SCM3-13890  EP 계정 생성 요청     │
 │ 87%  SCM3-13201  EP 권한 해제 신청     │
 └────────────────────────────────────────┘
 [🤖 AI검증]
```

### AI검증

Top 3는 벡터 유사도 기준이라 표면적 유사도만 측정합니다.
`[🤖 AI검증]` 버튼을 누르면 Gemini가 이슈 내용을 직접 읽고 **가장 유사한 1건과 이유**를 설명합니다.

```
✅ 최적 매칭: SCM3-14200
💬 "두 이슈 모두 EP 시스템 신규 권한 신청이며,
    동일한 처리 절차(결재양식 첨부 후 접수)가 적용됩니다."
```

> AI검증 결과는 `data/ai_verify_cache.json`에 캐싱되어 같은 이슈 재검증 시 Gemini를 재호출하지 않습니다.

---

## 파일 구조

```
sbe-jira-ui/
├── config_ui.py          # 웹 서버 (HTTP API + 진입점)
├── lib/
│   ├── settings.py       # 환경변수 읽기/쓰기 (.env 관리)
│   ├── jira.py           # Jira API 호출
│   ├── gemini.py         # Gemini API 호출 (채팅, 상태확인, AI검증)
│   └── embedding.py      # Embedding 기반 유사 이슈 검색
├── ui/
│   ├── index.html        # 단일 페이지 (사이드바 SPA)
│   ├── script.js         # 클라이언트 로직
│   └── style.css         # 스타일
└── data/
    ├── embedding_cache.json   # 완료 이슈 임베딩 벡터 캐시
    └── ai_verify_cache.json   # AI검증 결과 캐시
```

---

## 미구현 기능

- **Gemini 기반 자연어 Jira 검색** — 자연어 입력 → Gemini가 JQL 변환 → Jira 검색
  (`plan_MCP환경설정.md` 항목 5 참고)

---
### Hi there 👋, I'm treechoi (Applied AI Engineer)

**비즈니스 임팩트를 창출하는 AI Agent Orchestrator**
저는 사내망 및 레거시 시스템의 제약을 극복하고, AI 에이전트를 도입하여 현업의 페인포인트를 실질적으로 해결하는 것을 즐깁니다.

---

### 🚀 Core Strengths & Experience

* **AI Agent Orchestration & RAG 파이프라인 구축**
  * **Jira 유사이슈 대시보드 구축**: 단순 벡터 검색의 한계를 극복하기 위해 `Top-K Retrieval` + `LLM-as-Judge` 형태의 Two-Stage RAG 파이프라인을 설계하여 검색 정밀도 대폭 향상. (ReAct 패턴 적용)
  * **사내망 DevX 에이전트 3종 배포**:
    * **긴급 배포 보고서 초안 작성기**: 사내 템플릿(Context) 주입 및 추론 가드레일 설계를 통해 작업 메모를 포멀한 보고서로 변환 (보고서 작성 시간 **90% 단축**)
    * **결재용 롤백 쿼리 자동 생성기**: DBA 페르소나 및 쿼리 안정성 검증 분기(If/Else) 노드를 통해 백업-수정-복구 3단 쿼리 세트 자동 생성 (생성 시간 **98% 단축**)
    * **현업 문의 자동 라우터**: 장애/일반 문의 심각도 판별 및 R&R 매핑 지식 베이스(RAG) 연동으로 파트장 CS 대응 시간 **50% 감소**
* **Tool Integration & Legacy System Integration**
  * **Jira MCP 구축**: LLM이 내부 사내망 이슈 트래커를 직접 읽고 쓸 수 있도록 Model Context Protocol 연동, Context Switching 비용 제로화.
  * **레거시 데이터 마이그레이션**: VDI 폐쇄망 환경에서 10년 이상 된 Oracle DB의 인코딩 이슈(US7ASCII -> UTF-8)를 SQL 레벨 `UTL_RAW` 추출 방식으로 해결, 사용자가 쿼리 수정 없이 투명하게 사용하는 자동화 파이프라인 셋업.

---

### 🛠 Tech Stack

<!-- shields.io 뱃지 아이콘들 -->
* **Language**: <img src="https://img.shields.io/badge/Python-3776AB?style=flat-square&logo=python&logoColor=white"/> <img src="https://img.shields.io/badge/SQL-4479A1?style=flat-square&logo=mysql&logoColor=white"/>
* **AI & LLM**: <img src="https://img.shields.io/badge/LangChain-1C3C3C?style=flat-square&logo=langchain&logoColor=white"/> <img src="https://img.shields.io/badge/Gemini-8E75B2?style=flat-square&logo=googlebard&logoColor=white"/> <img src="https://img.shields.io/badge/OpenAI-412991?style=flat-square&logo=openai&logoColor=white"/>
* **Data & Backend**: <img src="https://img.shields.io/badge/Oracle-F80000?style=flat-square&logo=oracle&logoColor=white"/> <img src="https://img.shields.io/badge/Vector%20DB-000000?style=flat-square&logo=database&logoColor=white"/>
* **Tools**: <img src="https://img.shields.io/badge/Jira-0052CC?style=flat-square&logo=jira&logoColor=white"/> <img src="https://img.shields.io/badge/Git-F05032?style=flat-square&logo=git&logoColor=white"/>

---

### 💬 Contact
* **LinkedIn**: -
* **Email**: vangarang@naver.com

> *"실제 현업의 페인포인트를 분석하고, 가장 적합하고 현실적인 AI 아키텍처를 고민합니다."*
