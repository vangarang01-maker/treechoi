#!/usr/bin/env python3
"""
config_ui.py — sbe-jira-mcp 설정 관리 웹 UI

실행: python config_ui.py
브라우저: http://localhost:8765
종료: Ctrl+C
"""

import json
import os
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from lib.settings import api_read, api_write, ENV_FIELDS, _is_docker_env
from lib.jira import api_chat, SHORTCUTS, jira_get_issue_detail, jira_update_issue, jira_get_transitions, api_jira_check
from lib.gemini import api_gemini_chat, api_gemini_check, api_ai_verify, api_draft_comment, api_gemini_process_agent
from lib.embedding import api_embedding_cache_status, api_embedding_build, api_embedding_build_stream, api_similar_issues
from lib.wizard import api_wizard_detect, api_wizard_draft
from lib.prompts import load_prompt, PROMPTS_DIR

PORT = 8765
UI_DIR = Path(__file__).parent / "ui"

_SHORTCUTS_KEYS = list(SHORTCUTS.keys())

# ── 안내데스크봇 시스템 프롬프트 (파일에서 로드) ─────────────────────────────

def _get_helpdesk_system_prompt() -> str:
    """prompts/helpdesk_system.txt 에서 로드. 파일 없으면 빈 문자열 반환."""
    try:
        return load_prompt("helpdesk_system")
    except FileNotFoundError:
        return ""


def _resolve_token(env_in: dict) -> str:
    """Docker 모드면 클라이언트 값만 사용, 로컬이면 .env fallback 허용"""
    token = env_in.get("JIRA_PAT_TOKEN", "")
    if token or _is_docker_env():
        return token
    cfg = api_read(mask_sensitive=False)
    return (cfg.get("env", {}) if cfg.get("ok") else {}).get("JIRA_PAT_TOKEN", "")


# ── HTML 빌드 ─────────────────────────────────────────────────────────────────

def build_html() -> bytes:
    template = (UI_DIR / "index.html").read_text(encoding="utf-8")
    html = (
        template
        .replace("__FIELDS_JSON__", json.dumps(ENV_FIELDS, ensure_ascii=False))
        .replace("__SHORTCUTS_JSON__", json.dumps(_SHORTCUTS_KEYS, ensure_ascii=False))
    )
    return html.encode("utf-8")


# ── HTTP 서버 ─────────────────────────────────────────────────────────────────

_STATIC = {
    "/style.css": ("text/css", "style.css"),
    "/script.js": ("application/javascript", "script.js"),
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # 콘솔 로그 억제

    def _send(self, data: bytes, content_type: str, status: int = 200) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_json(self, data: dict, status: int = 200) -> None:
        self._send(json.dumps(data, ensure_ascii=False).encode("utf-8"), "application/json", status)

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/":
            self._send(build_html(), "text/html")
        elif path in _STATIC:
            mime, filename = _STATIC[path]
            self._send((UI_DIR / filename).read_bytes(), mime)
        elif path == "/api/config":
            self._send_json(api_read())
        elif path == "/api/gemini-check":
            self._send_json(api_gemini_check())
        elif path == "/api/embedding-cache-status":
            self._send_json(api_embedding_cache_status())
        elif path == "/api/embedding-build-stream":
            parsed = urlparse(self.path)
            qs = parse_qs(parsed.query)
            users = qs.get("users", [])
            issuetype = qs.get("issuetype", [None])[0]

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()

            for progress in api_embedding_build_stream(users, issuetype=issuetype):
                self.wfile.write(f"data: {json.dumps(progress, ensure_ascii=False)}\n\n".encode("utf-8"))
                self.wfile.flush()
        elif path == "/api/jira-transitions":
            parsed = urlparse(self.path)
            qs = parse_qs(parsed.query)
            key = qs.get("key", [None])[0]
            if not key:
                self._send_json({"error": "key가 필요합니다."}, 400)
                return
            cfg = api_read(mask_sensitive=False)
            token = cfg.get("env", {}).get("JIRA_PAT_TOKEN", "")
            self._send_json(jira_get_transitions(token, key))
        elif path == "/api/wizard-detect":
            parsed = urlparse(self.path)
            qs = parse_qs(parsed.query)
            key = qs.get("key", [None])[0]
            if not key:
                self._send_json({"ok": False, "error": "key가 필요합니다."}, 400)
                return
            cfg = api_read(mask_sensitive=False)
            token = (cfg.get("env", {}) if cfg.get("ok") else {}).get("JIRA_PAT_TOKEN", "")
            self._send_json(api_wizard_detect(token, key))
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length)) if length else {}
        except Exception as e:
            self._send_json({"error": f"요청 파싱 실패: {e}"}, 400)
            return

        try:
            if path == "/api/config":
                self._send_json(api_write(body.get("env", {})))
            elif path == "/api/gemini-check":
                env_in = body.get("env", {})
                self._send_json(api_gemini_check(
                    model=env_in.get("GEMINI_MODEL")
                ))
            elif path == "/api/jira-check":
                env_in = body.get("env", {})
                self._send_json(api_jira_check(token=_resolve_token(env_in)))
            elif path == "/api/chat":
                query = body.get("query", "").strip()
                env_in = body.get("env", {})
                if not query:
                    self._send_json({"error": "query가 비어있습니다."}, 400)
                else:
                    self._send_json(api_chat(query, token=env_in.get("JIRA_PAT_TOKEN")))
            elif path == "/api/gemini-chat":
                message = body.get("message", "").strip()
                history = body.get("history", [])
                env_in = body.get("env", {})
                if not message:
                    self._send_json({"error": "message가 비어있습니다."}, 400)
                else:
                    self._send_json(api_gemini_chat(
                        history, message,
                        api_key=env_in.get("GEMINI_API_KEY"),
                        model=env_in.get("GEMINI_MODEL"),
                        system_prompt=_get_helpdesk_system_prompt(),
                    ))
            elif path == "/api/embedding-build":
                users = body.get("users", [])
                env_in = body.get("env", {})
                self._send_json(api_embedding_build(
                    users,
                    api_key=env_in.get("GEMINI_API_KEY"),
                    token=env_in.get("JIRA_PAT_TOKEN")
                ))
            elif path == "/api/similar-issues":
                users = body.get("users", [])
                env_in = body.get("env", {})
                self._send_json(api_similar_issues(
                    users,
                    api_key=env_in.get("GEMINI_API_KEY"),
                    token=env_in.get("JIRA_PAT_TOKEN")
                ))
            elif path == "/api/jira-update":
                key = body.get("key")
                fields = body.get("fields")
                transition = body.get("transition")
                comment = body.get("comment")
                env_in = body.get("env", {})
                if not key:
                    self._send_json({"error": "key가 필요합니다."}, 400)
                else:
                    self._send_json(jira_update_issue(
                        token=env_in.get("JIRA_PAT_TOKEN"),
                        key=key, fields=fields, transition=transition, comment=comment
                    ))
            elif path == "/api/ai-verify":
                issue_key = body.get("issue_key", "").strip()
                similar_keys = body.get("similar_keys", [])
                env_in = body.get("env", {})
                if not issue_key or not similar_keys:
                    self._send_json({"ok": False, "error": "issue_key와 similar_keys가 필요합니다."}, 400)
                else:
                    token = _resolve_token(env_in)
                    if not token:
                        self._send_json({"ok": False, "error": "JIRA_PAT_TOKEN이 설정되지 않았습니다."}, 400)
                    else:
                        open_issue = jira_get_issue_detail(token, issue_key)
                        sim_issues = [jira_get_issue_detail(token, k) for k in similar_keys]
                        self._send_json(api_ai_verify(
                            open_issue, sim_issues,
                            api_key=env_in.get("GEMINI_API_KEY"),
                            model=env_in.get("GEMINI_MODEL")
                        ))
            elif path == "/api/draft-comment":
                issue_key = body.get("issue_key", "").strip()
                best_key = body.get("best_key", "").strip()
                env_in = body.get("env", {})
                if not issue_key or not best_key:
                    self._send_json({"ok": False, "error": "issue_key와 best_key가 필요합니다."}, 400)
                else:
                    token = _resolve_token(env_in)
                    if not token:
                        self._send_json({"ok": False, "error": "JIRA_PAT_TOKEN이 설정되지 않았습니다."}, 400)
                    else:
                        open_issue = jira_get_issue_detail(token, issue_key)
                        best_issue = jira_get_issue_detail(token, best_key)
                        self._send_json(api_draft_comment(
                            open_issue, best_issue,
                            api_key=env_in.get("GEMINI_API_KEY"),
                            model=env_in.get("GEMINI_MODEL")
                        ))
            elif path == "/api/agent-query":
                message = body.get("message", "").strip()
                env_in = body.get("env", {})
                if not message:
                    self._send_json({"ok": False, "error": "message가 비어있습니다."}, 400)
                else:
                    self._send_json(api_gemini_process_agent(
                        message,
                        api_key=env_in.get("GEMINI_API_KEY"),
                        model=env_in.get("GEMINI_MODEL")
                    ))
            elif path == "/api/agent-execute":
                action = body.get("action", {})
                env_in = body.get("env", {})
                if not action or not action.get("issue_key"):
                    self._send_json({"ok": False, "error": "action 파라미터가 유효하지 않습니다."}, 400)
                else:
                    token = _resolve_token(env_in)
                    if not token:
                        self._send_json({"ok": False, "error": "JIRA_PAT_TOKEN이 설정되지 않았습니다."}, 400)
                    else:
                        self._send_json(jira_update_issue(
                            token,
                            action["issue_key"],
                            fields=action.get("fields"),
                            transition=action.get("transition"),
                            comment=action.get("comment")
                        ))
            elif path == "/api/wizard-draft":
                issue_key = body.get("issue_key", "").strip()
                draft_type = body.get("draft_type", "").strip()
                overrides = body.get("overrides", {})
                env_in = body.get("env", {})
                if not issue_key or not draft_type:
                    self._send_json({"ok": False, "error": "issue_key와 draft_type이 필요합니다."}, 400)
                else:
                    token = _resolve_token(env_in)
                    if not token:
                        self._send_json({"ok": False, "error": "JIRA_PAT_TOKEN이 설정되지 않았습니다."}, 400)
                    else:
                        self._send_json(api_wizard_draft(
                            token, issue_key, draft_type, overrides,
                            api_key=env_in.get("GEMINI_API_KEY"),
                            model=env_in.get("GEMINI_MODEL"),
                        ))
            else:
                self.send_response(404)
                self.end_headers()
        except Exception as e:
            import traceback
            print(traceback.format_exc())
            try:
                self._send_json({"ok": False, "error": f"서버 오류: {e}"}, 500)
            except Exception:
                pass


# ── 진입점 ────────────────────────────────────────────────────────────────────

def main() -> None:
    import os
    is_docker = os.environ.get("IS_DOCKER", "").lower() in ("1", "true", "yes")
    host = "0.0.0.0" if is_docker else "localhost"

    server = ThreadingHTTPServer((host, PORT), Handler)
    local_url = f"http://localhost:{PORT}"

    print(f"[sbe-jira-ui] 서버 시작")
    if is_docker:
        print(f"  내 PC 접속:  {local_url}")
        print(f"  팀원 접속:   http://<내 PC IP>:{PORT}")
    else:
        print(f"  {local_url}")
        webbrowser.open(local_url)
    print(f"  종료: Ctrl+C\n")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()
        print("\n[sbe-jira-ui] 서버 종료 완료")


if __name__ == "__main__":
    main()
