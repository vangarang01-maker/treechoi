"""설정 읽기/쓰기 — 환경변수(.env) 우선, 없으면 claude.json 폴백"""
import json
import os
from pathlib import Path

CLAUDE_JSON = Path.home() / ".claude.json"
MCP_NAME = "sbe-jira-mcp"

# Docker 환경변수 키 목록
_ENV_KEYS = ["GEMINI_API_KEY", "GEMINI_MODEL", "JIRA_PAT_TOKEN", "JIRA_USERNAME"]


def _is_docker_env() -> bool:
    """환경변수에 핵심 키가 있으면 Docker/env 모드로 판단"""
    return any(os.environ.get(k) for k in _ENV_KEYS)

ENV_FIELDS = [
    {"key": "JIRA_PAT_TOKEN", "label": "Jira PAT Token",    "sensitive": True,  "placeholder": "Personal Access Token",
     "docker_placeholder": "내 Jira PAT 입력 (Jira 프로필 → 개인 액세스 토큰 메뉴에서 발급)"},
    {"key": "JIRA_USERNAME",  "label": "Jira 사용자명(사번)", "sensitive": False, "placeholder": "223733",
     "docker_placeholder": "내 사번 입력 (예: 223733)"},
    {"key": "GEMINI_API_KEY", "label": "Gemini API Key",    "sensitive": True,  "placeholder": "AIzaSy...",
     "docker_placeholder": "내 Gemini API 키 입력 (aistudio.google.com → Get API key에서 발급)"},
    {"key": "GEMINI_MODEL",   "label": "Gemini 모델",        "sensitive": False, "type": "select", "placeholder": "",
     "options": [
         {"value": "gemini-2.5-flash",      "label": "gemini-2.5-flash (기본값)"},
         {"value": "gemini-2.5-flash-lite",  "label": "gemini-2.5-flash-lite"},
         {"value": "gemini-3-flash-preview", "label": "gemini-3-flash-preview"},
     ]},
]


def _load() -> dict:
    return json.loads(CLAUDE_JSON.read_text(encoding="utf-8"))


def _save(data: dict) -> None:
    CLAUDE_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _find_project_key(data: dict) -> str | None:
    for k, v in data.get("projects", {}).items():
        if MCP_NAME in v.get("mcpServers", {}):
            return k
    return None


_SENSITIVE_KEYS = {"GEMINI_API_KEY", "JIRA_PAT_TOKEN", "JIRA_USERNAME"}


def _docker_env_raw() -> dict:
    """Docker 환경변수를 마스킹 없이 그대로 반환 (서버 내부 전용)"""
    return {k: os.environ.get(k, "") for k in _ENV_KEYS}


def api_read(mask_sensitive: bool = True) -> dict:
    # ── Docker / 환경변수 모드 ─────────────────────────────
    if _is_docker_env():
        env = {}
        for k in _ENV_KEYS:
            v = os.environ.get(k, "")
            # 민감 정보는 값이 있어도 "__set__"으로 마스킹 — 평문 노출 방지
            env[k] = ("__set__" if (k in _SENSITIVE_KEYS and v) else v) if mask_sensitive else v
        return {"ok": True, "env": env, "projectKey": "__env__"}
    # ── 로컬 개발: claude.json 폴백 ───────────────────────
    try:
        data = _load()
        pk = _find_project_key(data)
        if not pk:
            return {"error": f"'{MCP_NAME}' MCP 서버를 claude.json에서 찾을 수 없습니다."}
        env = data["projects"][pk]["mcpServers"][MCP_NAME].get("env", {})
        return {"ok": True, "env": env, "projectKey": pk}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def api_write(env_updates: dict) -> dict:
    # Docker 환경에서는 .env 파일이 읽기 전용 — 저장 불가 안내
    if _is_docker_env():
        return {"ok": False, "error": "Docker 환경에서는 설정을 UI에서 변경할 수 없습니다. .env 파일을 직접 수정 후 컨테이너를 재시작하세요."}
    try:
        data = _load()
        pk = _find_project_key(data)
        if not pk:
            return {"ok": False, "error": f"'{MCP_NAME}' MCP 서버를 찾을 수 없습니다."}
        mcp_env = data["projects"][pk]["mcpServers"][MCP_NAME].setdefault("env", {})
        for k, v in env_updates.items():
            if v != "":
                mcp_env[k] = v
        _save(data)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}
