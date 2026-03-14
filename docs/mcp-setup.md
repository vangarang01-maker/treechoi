# GitHub MCP Setup Guide

이 문서는 `sbe-jira-ui` 프로젝트에서 GitHub MCP(Model Context Protocol) 서버를 연동하고 사용하는 방법을 기록합니다.

---

## 1. 사전 준비 (Prerequisites)

GitHub MCP를 사용하기 위해서는 GitHub 계정과 **Personal Access Token (PAT)**이 필요합니다.

1.  GitHub [Settings > Developer settings > Personal access tokens (classic)](https://github.com/settings/tokens)으로 이동합니다.
2.  **Generate new token (classic)**을 클릭합니다.
3.  필요한 권한(Scopes)을 선택합니다:
    *   `repo` (전체 권한)
    *   `gist`
    *   `read:org` (필요 시)
4.  생성된 토큰을 안전하게 복사해둡니다. (한 번만 표시됩니다)

---

## 2. MCP 서버 설정 (Configuration)

AI 에이전트(예: Claude Code 등)가 GitHub MCP 서버를 인식할 수 있도록 설정 파일에 추가해야 합니다.

### 환경 변수 설정
다음 환경 변수가 시스템 또는 에이전트 실행 환경에 정의되어야 합니다.
```bash
GITHUB_PERSONAL_ACCESS_TOKEN=your_github_pat_here
```

### 서버 등록
에이전트 설정(예: `config.json`)에 아래와 같이 `github-mcp-server`를 등록합니다.

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-github"
      ],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your_github_pat_here"
      }
    }
  }
}
```

---

## 3. 주요 기능 및 사용법

등록이 완료되면 AI 에이전트가 다음과 같은 기능을 수행할 수 있습니다:

*   **저장소 검색**: `search_repositories`
*   **이슈 관리**: `create_issue`, `get_issue`, `list_issues`
*   **파일 관리**: `push_files`, `get_file_contents`
*   **풀 리퀘스트**: `create_pull_request`, `review_pull_request`

### 사용 예시 (Agent 명령)
> "GitHub MCP 사용해서 현재 프로젝트의 `README.md`를 읽어보고 이슈 하나 생성해줘."

---

## 4. 트러블슈팅

*   **권한 오류 (401/403)**: PAT가 만료되었거나 `repo` 권한이 누락되었는지 확인하세요.
*   **서버 실행 실패**: 로컬 환경에 `node`와 `npx`가 설치되어 있는지 확인하세요.
*   **저장소 미검색**: `search_repositories` 쿼리에 `user:사용자명` 형식을 포함하면 더 정확합니다.
