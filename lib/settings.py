"""claude.json 설정 읽기/쓰기"""
import json
from pathlib import Path

CLAUDE_JSON = Path.home() / ".claude.json"
MCP_NAME = "sbe-jira-mcp"

ENV_FIELDS = [
    {"key": "JIRA_PAT_TOKEN", "label": "Jira PAT Token",    "sensitive": True,  "placeholder": "Personal Access Token"},
    {"key": "JIRA_USERNAME",  "label": "Jira 사용자명(사번)", "sensitive": False, "placeholder": "223733"},
    {"key": "GEMINI_API_KEY", "label": "Gemini API Key",    "sensitive": True,  "placeholder": "AIzaSy..."},
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


def api_read() -> dict:
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
