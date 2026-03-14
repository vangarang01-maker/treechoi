#!/usr/bin/env python3
"""
config_ui.py — sbe-jira-mcp 설정 관리 웹 UI

실행: python config_ui.py
브라우저: http://localhost:8765
종료: Ctrl+C
"""

import json
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlparse

from lib.settings import api_read, api_write, ENV_FIELDS
from lib.jira import api_chat, SHORTCUTS, jira_get_issue_detail, jira_update_issue
from lib.gemini import api_gemini_chat, api_gemini_check, api_ai_verify, api_gemini_process_agent
from lib.embedding import api_embedding_cache_status, api_embedding_build, api_similar_issues

PORT = 8765
UI_DIR = Path(__file__).parent / "ui"

_SHORTCUTS_KEYS = list(SHORTCUTS.keys())

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
            elif path == "/api/chat":
                query = body.get("query", "").strip()
                if not query:
                    self._send_json({"error": "query가 비어있습니다."}, 400)
                else:
                    self._send_json(api_chat(query))
            elif path == "/api/gemini-chat":
                message = body.get("message", "").strip()
                history = body.get("history", [])
                if not message:
                    self._send_json({"error": "message가 비어있습니다."}, 400)
                else:
                    self._send_json(api_gemini_chat(history, message))
            elif path == "/api/embedding-build":
                self._send_json(api_embedding_build(body.get("users", [])))
            elif path == "/api/similar-issues":
                self._send_json(api_similar_issues(body.get("users", [])))
            elif path == "/api/ai-verify":
                issue_key = body.get("issue_key", "").strip()
                similar_keys = body.get("similar_keys", [])
                if not issue_key or not similar_keys:
                    self._send_json({"ok": False, "error": "issue_key와 similar_keys가 필요합니다."}, 400)
                else:
                    cfg = api_read()
                    token = (cfg.get("env", {}) if cfg.get("ok") else {}).get("JIRA_PAT_TOKEN", "")
                    if not token:
                        self._send_json({"ok": False, "error": "JIRA_PAT_TOKEN이 설정되지 않았습니다."} , 400)
                    else:
                        open_issue = jira_get_issue_detail(token, issue_key)
                        sim_issues = [jira_get_issue_detail(token, k) for k in similar_keys]
                        self._send_json(api_ai_verify(open_issue, sim_issues))
            elif path == "/api/agent-query":
                message = body.get("message", "").strip()
                if not message:
                    self._send_json({"ok": False, "error": "message가 비어있습니다."}, 400)
                else:
                    self._send_json(api_gemini_process_agent(message))
            elif path == "/api/agent-execute":
                action = body.get("action", {})
                if not action or not action.get("issue_key"):
                    self._send_json({"ok": False, "error": "action 파라미터가 유효하지 않습니다."}, 400)
                else:
                    cfg = api_read()
                    token = (cfg.get("env", {}) if cfg.get("ok") else {}).get("JIRA_PAT_TOKEN", "")
                    if not token:
                        self._send_json({"ok": False, "error": "JIRA_PAT_TOKEN이 설정되지 않았습니다."} , 400)
                    else:
                        self._send_json(jira_update_issue(
                            token,
                            action["issue_key"],
                            fields=action.get("fields"),
                            transition=action.get("transition"),
                            comment=action.get("comment")
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
    url = f"http://localhost:{PORT}"
    server = HTTPServer(("localhost", PORT), Handler)
    print(f"[sbe-jira-mcp] 설정 UI 시작")
    print(f"  {url}")
    print(f"  종료: Ctrl+C\n")
    webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.shutdown()
        server.server_close()
        print("\n[sbe-jira-mcp] 서버 종료 완료")


if __name__ == "__main__":
    main()
