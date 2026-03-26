# sbe-jira-ui DevX AI 연동 기획서

**작성일**: 2026-03-24
**방향**: Gemini API → DevX AI API 전환
**목적**: 외부 API 키 의존성 제거, 사내 AI 인프라 활용

---

## 1. 현황 분석

### 현재 AI 사용 구조

```
사용자 → config_ui.py → wizard.py → gemini.py → Google Gemini API
```

- **Gemini 함수 11개**, 각각 `prompts/*.txt`에서 프롬프트 로드
- 환경변수 `GEMINI_API_KEY` 필수 → **팀원 각자 발급 필요**
- 외부망(googleapis.com) 통신 → **사내망 환경에서 불안정**

### Gemini 함수 목록

| 함수명 | 용도 | 프롬프트 파일 |
|--------|------|------------|
| `api_gemini_chat` | 안내데스크 채팅 | `helpdesk_system.txt` |
| `api_gemini_requirements` | 요건정의서 초안 | `requirements.txt` |
| `api_gemini_review` | 변경검토회의 초안 | `review.txt` |
| `api_gemini_test` | 테스트케이스 초안 | `test.txt` |
| `api_gemini_procedure` | 배포절차 초안 | `procedure_db.txt` / `procedure_program.txt` |
| `api_gemini_approval` | 배포결재 멘트 초안 | `approval.txt` |
| `api_gemini_sr_draft` | SR 처리내역 초안 | `sr_account/data/code/etc.txt` |
| `api_ai_verify` | 유사 이슈 선택 | `ai_verify.txt` |
| `api_draft_comment` | 댓글 초안 | `draft_comment.txt` |
| `api_gemini_process_agent` | 자연어 의도 분석 (JSON) | `agent_query.txt` |
| `api_gemini_check` | API 상태 확인 (ping) | 없음 |

### 문제점

| 문제 | 내용 |
|------|------|
| 개인 API 키 필요 | 팀원마다 Google AI Studio에서 발급해야 함 |
| 외부망 의존 | 사내망에서 googleapis.com 연결이 불안정한 경우 있음 |
| 모델 분산 관리 | 모델 버전 업그레이드 시 코드 수정 필요 |
| 프롬프트 코드 내 관리 | 프롬프트 수정이 곧 배포를 의미 |

---

## 2. 목표

### 전환 후 구조

```
사용자 → config_ui.py → wizard.py → devx_ai.py → DevX AI API (사내)
```

- `DEVX_API_KEY` 하나로 전 팀원 공유 사용
- 사내망 전용 API → 안정적
- DevX Portal에서 에이전트 관리 → **프롬프트 수정이 코드 배포 없이 가능**

---

## 3. DevX AI API 스펙 요약

```
POST https://devx-mcp-api.shinsegae-inc.com/api/v1/mcp-command/chat
Authorization: Bearer {DEVX_API_KEY}

Body:
{
  "agent_code": "custom_xxx..." | "playground",
  "query": "프롬프트 내용",
  "response_mode": "blocking"
}

응답:
{
  "external_response": {
    "answer": "AI 생성 텍스트"
  }
}
```

자세한 사용법 → [`/d/projects/00.devx/08-DevX-AI-API-활용가이드.md`](/d/projects/00.devx/08-DevX-AI-API-활용가이드.md)

---

## 4. 에이전트 설계

### 전략: 용도별 개별 에이전트

각 초안 유형마다 DevX Portal에서 에이전트를 하나씩 만들고, 시스템 프롬프트에 기존 `prompts/*.txt` 내용을 붙여넣는 방식.

> 코드에서 프롬프트가 완전히 분리됨. 이후 프롬프트 개선은 DevX Portal에서만 하면 됨.

### 만들 에이전트 목록 (7개)

| 에이전트 이름 | agent_code 변수명 | 기존 프롬프트 파일 | 용도 |
|-------------|-----------------|----------------|------|
| `sbe-jira-요건정의서` | `DEVX_AGENT_REQUIREMENTS` | `requirements.txt` | 요건정의서 Jira 마크업 생성 |
| `sbe-jira-변경검토회의` | `DEVX_AGENT_REVIEW` | `review.txt` | 변경검토회의 5섹션 생성 |
| `sbe-jira-테스트케이스` | `DEVX_AGENT_TEST` | `test.txt` | 테스트케이스 표 생성 |
| `sbe-jira-배포절차` | `DEVX_AGENT_PROCEDURE` | `procedure_db.txt` / `procedure_program.txt` | 배포절차 생성 |
| `sbe-jira-배포결재멘트` | `DEVX_AGENT_APPROVAL` | `approval.txt` | 배포결재 멘트 생성 |
| `sbe-jira-SR처리내역` | `DEVX_AGENT_SR` | `sr_account/data/code/etc.txt` (4개 통합) | SR 유형별 처리내역 |
| `sbe-jira-안내데스크` | `DEVX_AGENT_CHAT` | `helpdesk_system.txt` | 채팅 안내 |

> `api_ai_verify`, `api_draft_comment`, `api_gemini_process_agent` 3개는 **에이전트 없이 `playground`로 처리** (쿼리에 전체 프롬프트 포함).

---

## 5. 코드 변경 계획

### 5-1. 새 파일: `lib/devx_ai.py`

기존 `lib/gemini.py`와 동일한 함수 시그니처를 유지하되, 내부 구현만 DevX API로 교체.

```python
# lib/devx_ai.py

def _call_devx(agent_code, prompt, json_mode=False):
    """DevX AI 단일 호출 헬퍼 (기존 _call_gemini 대체)"""
    ...
    return (ok, text)

def api_devx_requirements(summary, description, change_type, **kwargs):
    """기존 api_gemini_requirements와 동일한 시그니처"""
    ...

# 나머지 함수도 동일 패턴
```

### 5-2. `lib/wizard.py` import 교체

```python
# 변경 전
from .gemini import api_gemini_requirements, api_gemini_review, ...

# 변경 후
from .devx_ai import api_devx_requirements, api_devx_review, ...
```

### 5-3. `lib/settings.py` 환경변수 교체

```python
# 변경 전
_ENV_KEYS = ["GEMINI_API_KEY", "GEMINI_MODEL", "JIRA_PAT_TOKEN", "JIRA_USERNAME"]

# 변경 후
_ENV_KEYS = ["DEVX_API_KEY", "JIRA_PAT_TOKEN", "JIRA_USERNAME",
             "DEVX_AGENT_REQUIREMENTS", "DEVX_AGENT_REVIEW", ...]
```

### 5-4. `config_ui.py` 상태 확인 엔드포인트

`/api/gemini-check` → `/api/ai-check` 로 rename (또는 동일 엔드포인트 유지하되 DevX ping으로 교체)

---

## 6. 환경변수 설계

### Docker 환경 (`docker-compose.yml`)

```yaml
environment:
  DEVX_API_KEY: "DKx5VXoZeLhDk8e8V9bZE2D3xXDPAJ77"
  DEVX_AGENT_REQUIREMENTS: "custom_xxxxxxxxxxxxxxxx"
  DEVX_AGENT_REVIEW: "custom_xxxxxxxxxxxxxxxx"
  DEVX_AGENT_TEST: "custom_xxxxxxxxxxxxxxxx"
  DEVX_AGENT_PROCEDURE: "custom_xxxxxxxxxxxxxxxx"
  DEVX_AGENT_APPROVAL: "custom_xxxxxxxxxxxxxxxx"
  DEVX_AGENT_SR: "custom_xxxxxxxxxxxxxxxx"
  DEVX_AGENT_CHAT: "custom_xxxxxxxxxxxxxxxx"
  JIRA_PAT_TOKEN: "..."
  JIRA_USERNAME: "..."
```

### 에이전트 미설정 시 동작

`DEVX_AGENT_XXX`가 비어있으면 → `"playground"` 에이전트로 fallback
→ 에이전트를 점진적으로 만들면서 배포 가능

---

## 7. 마이그레이션 전략 (단계별)

### Phase 1 — 에이전트 생성 및 프롬프트 검증
> 코드 변경 없음

1. DevX Portal(`devx-mcp.shinsegae-inc.com`)에서 에이전트 7개 생성
2. 각 에이전트 시스템 프롬프트에 기존 `prompts/*.txt` 내용 복사
3. playground curl로 각 에이전트 응답 품질 검증
4. agent_code 7개 수집

### Phase 2 — `lib/devx_ai.py` 작성
> 코드 추가, 기존 gemini.py 유지

1. `_call_devx()` 헬퍼 구현
2. 각 `api_devx_*()` 함수 구현 (gemini.py와 동일 시그니처)
3. 로컬에서 직접 테스트 (`python -c "from lib.devx_ai import ..."`)

### Phase 3 — wizard.py 스위칭
> 이 시점부터 Gemini 불필요

1. `wizard.py` import를 `devx_ai`로 교체
2. `settings.py` 환경변수 목록 업데이트
3. Docker 재빌드 및 배포
4. 기존 `lib/gemini.py`는 잠시 유지 (롤백 대비)

### Phase 4 — 정리
1. Gemini 관련 환경변수 제거
2. `lib/gemini.py` 및 `prompts/*.txt` 아카이브 또는 삭제
3. UI 설정 화면에서 GEMINI_API_KEY 입력란 제거

---

## 8. 주의사항 및 미결 사항

| 항목 | 내용 | 결정 필요 |
|------|------|---------|
| `api_gemini_process_agent` (JSON 모드) | DevX API는 JSON 모드 미지원 → query에 "JSON으로만 응답하라" 명시 후 파싱 | 응답 안정성 검증 필요 |
| `embedding.py` | Gemini embedding 모델 사용 여부 확인 필요 → 별도 처리 | 조사 필요 |
| 배포절차 에이전트 | DB/프로그램 두 종류 → 하나의 에이전트로 통합 가능 (query에 유형 포함) | 통합 vs 분리 결정 |
| 응답 속도 | DevX blocking 모드 평균 3~10초, Gemini와 유사 | 허용 가능 |
| fallback 템플릿 | AI 실패 시 기존 hardcoded 템플릿 유지 여부 | 유지 권장 |
