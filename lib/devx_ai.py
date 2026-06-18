"""DevX AI API — 사내 AI 제공자 (Gemini 대체)

DevX Gateway(3-Token 아키텍처) 연동.
구 MCP Hub(정적 API Key) → 신 Gateway(client_credentials → 5분 access_token) 전환.
  1) POST /api/v1/auth/token  (client_id+secret → access_token, 300초)
  2) POST /api/v1/agent/chat  (Bearer access_token)
"""
import json
import os
import re
import ssl
import threading
import time
import urllib.parse
import urllib.request
from datetime import date

from .settings import api_read
from .prompts import load_prompt

DEVX_GW_BASE = "https://devx-gw.shinsegae-inc.com/api/v1"
DEVX_TOKEN_URL = f"{DEVX_GW_BASE}/auth/token"
DEVX_CHAT_URL = f"{DEVX_GW_BASE}/agent/chat"

# 액세스 토큰 캐시 (만료 300초, 30초 여유 두고 갱신)
_token_lock = threading.Lock()
_token_cache = {"token": "", "exp": 0.0}


def _ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _get_credentials() -> tuple[str, str]:
    """(client_id, client_secret) — 환경변수 우선, .env(api_read) 폴백."""
    cid = os.environ.get("DEVX_CLIENT_ID", "").strip()
    csec = os.environ.get("DEVX_CLIENT_SECRET", "").strip()
    if cid and csec:
        return cid, csec
    cfg = api_read(mask_sensitive=False)
    env = cfg.get("env", {}) if cfg.get("ok") else {}
    return (cid or env.get("DEVX_CLIENT_ID", "").strip(),
            csec or env.get("DEVX_CLIENT_SECRET", "").strip())


def _get_user() -> str:
    """대화 이력 추적용 사용자 식별자 (사번, 최대 24자)."""
    user = os.environ.get("JIRA_USERNAME", "").strip()
    if not user:
        cfg = api_read(mask_sensitive=False)
        if cfg.get("ok"):
            user = cfg.get("env", {}).get("JIRA_USERNAME", "").strip()
    return (user or "sbe-jira-ui")[:24]


def _fetch_token() -> tuple[bool, str]:
    """Gateway에서 access_token 발급. (ok, token_or_error)."""
    cid, csec = _get_credentials()
    if not cid or not csec:
        return False, "DEVX_CLIENT_ID/DEVX_CLIENT_SECRET가 설정되지 않았습니다."
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": cid,
        "client_secret": csec,
    }).encode("utf-8")
    try:
        req = urllib.request.Request(
            DEVX_TOKEN_URL, data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=20) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        token = body.get("access_token", "")
        if not token:
            return False, "토큰 응답에 access_token이 없습니다."
        expires = int(body.get("expires_in", 300))
        with _token_lock:
            _token_cache["token"] = token
            _token_cache["exp"] = time.time() + max(expires - 30, 30)
        return True, token
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode("utf-8", errors="replace"))
            msg = err.get("detail") or err.get("message") or f"HTTP {e.code}"
        except Exception:
            msg = f"HTTP {e.code}"
        return False, f"토큰 발급 실패: {msg}"
    except Exception as e:
        return False, f"토큰 발급 실패: {e}"


def _get_token(force: bool = False) -> tuple[bool, str]:
    """캐시된 토큰 반환, 만료 시 재발급."""
    if not force:
        with _token_lock:
            if _token_cache["token"] and time.time() < _token_cache["exp"]:
                return True, _token_cache["token"]
    return _fetch_token()


_SR_WORK_TYPE_PROMPT = {
    "계정/권한 처리":    "sr_account",
    "데이터추출":        "sr_data",
    "공통코드 단순변경": "sr_code",
    "기타":              "sr_etc",
}


def _post_chat(token: str, agent_code: str, prompt: str) -> tuple[bool, str, int]:
    """/agent/chat 호출. (ok, text_or_error, http_code) 반환. http_code=0 은 네트워크 오류."""
    payload = json.dumps({
        "query": prompt,
        "user": _get_user(),
        "agent_code": agent_code,
        "response_mode": "blocking",
    }, ensure_ascii=False).encode("utf-8")
    try:
        req = urllib.request.Request(
            DEVX_CHAT_URL, data=payload,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Authorization": f"Bearer {token}",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, context=_ssl_ctx(), timeout=90) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        ext = data.get("external_response", {}) or {}
        # 응답 구조: 최상위 answer, 폴백 external_response.answer / .dify_response.answer
        text = (data.get("answer")
                or ext.get("answer")
                or ext.get("dify_response", {}).get("answer")
                or "").strip()
        return True, text, 200
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode("utf-8", errors="replace"))
            msg = err.get("detail") or err.get("message") or f"HTTP {e.code}"
        except Exception:
            msg = f"HTTP {e.code}"
        return False, msg, e.code
    except Exception as e:
        return False, str(e), 0


def _call_devx(agent_env_key: str, prompt: str, api_key: str = None) -> tuple[bool, str]:
    """DevX AI 단일 호출 공통 헬퍼. (ok, text_or_error) 반환.

    api_key 인자는 구 정적 키 호환용 — 현재는 무시하고 Gateway 토큰을 사용한다.
    agent_env_key 가 빈 문자열이거나 미설정이면 'playground' 사용.
    """
    agent_code = (os.environ.get(agent_env_key, "").strip() if agent_env_key else "") or "playground"

    ok, token = _get_token()
    if not ok:
        return False, token

    ok, text, code = _post_chat(token, agent_code, prompt)
    # 401 = 토큰 만료/무효 → 강제 재발급 후 1회 재시도
    if not ok and code == 401:
        ok2, token2 = _get_token(force=True)
        if ok2:
            ok, text, code = _post_chat(token2, agent_code, prompt)
    return ok, text


def api_devx_requirements(
    summary: str, description: str, change_type: str,
    api_key: str = None, **kwargs,
) -> dict:
    is_db = "DB" in change_type.upper()
    row_type = "DB 데이터 변경" if is_db else "기능 수정"
    try:
        prompt = load_prompt(
            "requirements",
            row_type=row_type,
            summary=summary,
            change_type=change_type,
            description=description or "(내용 없음)",
        )
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}

    ok, reply = _call_devx("DEVX_AGENT_REQUIREMENTS", prompt, api_key)
    if not ok:
        return {"ok": False, "error": reply}
    reply = re.sub(r"```[^\n]*\n?", "", reply).strip()
    if not reply or "||번호||" not in reply:
        return {"ok": False, "error": "응답 형식 불일치"}
    return {"ok": True, "content": reply}


def api_devx_review(
    summary: str, description: str, change_type: str,
    api_key: str = None, **kwargs,
) -> dict:
    today = date.today().strftime("%Y-%m-%d")
    try:
        prompt = load_prompt(
            "review",
            today=today,
            summary=summary,
            change_type=change_type,
            description=description or "(내용 없음)",
        )
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}

    ok, reply = _call_devx("DEVX_AGENT_REVIEW", prompt, api_key)
    if not ok:
        return {"ok": False, "error": reply}
    reply = re.sub(r"```[^\n]*\n?", "", reply).strip()
    if not reply or "|회의일시|" not in reply:
        return {"ok": False, "error": "응답 형식 불일치"}
    return {"ok": True, "content": reply}


def api_devx_test(
    summary: str, review_content: str, change_type: str,
    api_key: str = None, **kwargs,
) -> dict:
    today = date.today().strftime("%Y/%m/%d")
    is_db = "DB" in change_type.upper()
    db_note = "DB 데이터 변경 시나리오로 작성" if is_db else "UI/기능 테스트 시나리오로 작성"
    try:
        prompt = load_prompt(
            "test",
            today=today,
            db_note=db_note,
            summary=summary,
            change_type=change_type,
            review_content=review_content or "(내용 없음)",
        )
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}

    ok, reply = _call_devx("DEVX_AGENT_TEST", prompt, api_key)
    if not ok:
        return {"ok": False, "error": reply}
    reply = re.sub(r"```[^\n]*\n?", "", reply).strip()
    if not reply or "테스트유형" not in reply:
        return {"ok": False, "error": "응답 형식 불일치"}
    return {"ok": True, "content": reply}


def api_devx_procedure(
    summary: str, change_type: str, server_info: str,
    api_key: str = None, **kwargs,
) -> dict:
    if os.environ.get("DEVX_AGENT_PROCEDURE", "").strip():
        # 에이전트 설정됨 — 데이터만 전송 (지시문은 에이전트 시스템 프롬프트에 있음)
        prompt = f"이슈 제목: {summary}\n처리유형: {change_type}\n대상 서버: {server_info}"
    else:
        # playground fallback — 전체 프롬프트 전송
        is_db = "DB" in change_type.upper()
        prompt_name = "procedure_db" if is_db else "procedure_program"
        try:
            prompt = load_prompt(prompt_name, summary=summary, change_type=change_type, server_info=server_info)
        except FileNotFoundError as e:
            return {"ok": False, "error": str(e)}

    ok, reply = _call_devx("DEVX_AGENT_PROCEDURE", prompt, api_key)
    if not ok:
        return {"ok": False, "error": reply}
    reply = re.sub(r"```[^\n]*\n?", "", reply).strip()
    if not reply or "변경 내용" not in reply:
        return {"ok": False, "error": "응답 형식 불일치"}
    return {"ok": True, "content": reply}


def api_devx_approval(
    summary: str, description: str, change_type: str,
    api_key: str = None, **kwargs,
) -> dict:
    if os.environ.get("DEVX_AGENT_APPROVAL", "").strip():
        prompt = f"이슈 제목: {summary}\n처리유형: {change_type}\n이슈 내용:\n{description or '(내용 없음)'}"
    else:
        try:
            prompt = load_prompt("approval", summary=summary, change_type=change_type, description=description or "(내용 없음)")
        except FileNotFoundError as e:
            return {"ok": False, "error": str(e)}

    ok, reply = _call_devx("DEVX_AGENT_APPROVAL", prompt, api_key)
    if not ok:
        return {"ok": False, "error": reply}
    reply = re.sub(r"```[^\n]*\n?", "", reply).strip()
    if not reply:
        return {"ok": False, "error": "빈 응답"}
    return {"ok": True, "content": reply}


def api_devx_sr_draft(
    work_type: str, summary: str, description: str,
    api_key: str = None, **kwargs,
) -> dict:
    if os.environ.get("DEVX_AGENT_SR", "").strip():
        prompt = f"업무유형: {work_type}\n이슈 제목: {summary}\n요청 내용:\n{description or '(내용 없음)'}"
    else:
        prompt_name = _SR_WORK_TYPE_PROMPT.get(work_type, "sr_etc")
        try:
            prompt = load_prompt(prompt_name, summary=summary, description=description or "(내용 없음)")
        except FileNotFoundError as e:
            return {"ok": False, "error": str(e)}

    ok, reply = _call_devx("DEVX_AGENT_SR", prompt, api_key)
    if not ok:
        return {"ok": False, "error": reply}
    reply = re.sub(r"```[^\n]*\n?", "", reply).strip()
    if not reply:
        return {"ok": False, "error": "빈 응답"}
    return {"ok": True, "content": reply}


def api_devx_safe_query(
    summary: str, description: str,
    dml_query: str = "",
    api_key: str = None, **kwargs,
) -> dict:
    """DB HOTFIX 결재용 백업·변경·복구 쿼리 3단 세트 생성"""
    today = date.today().strftime("%Y-%m-%d")
    dml_section = f"\n\n실행할 DML 쿼리:\n{dml_query}" if dml_query.strip() else ""
    prompt = f"오늘 날짜: {today}\n이슈 제목: {summary}\n이슈 내용:\n{description or '(내용 없음)'}{dml_section}"
    ok, reply = _call_devx("DEVX_AGENT_SAFE_QUERY", prompt, api_key)
    if not ok:
        return {"ok": False, "error": reply}
    reply = re.sub(r"```[^\n]*\n?", "", reply).strip()
    if not reply:
        return {"ok": False, "error": "빈 응답"}
    return {"ok": True, "content": reply}


def api_devx_chat(history: list, message: str, api_key: str = None, **kwargs) -> dict:
    """DevX AI 안내데스크 채팅"""
    if not message.strip():
        return {"ok": False, "error": "메시지가 비어있습니다."}

    # 최근 대화 히스토리를 query에 포함 (최대 6턴)
    recent = (history or [])[-6:]
    if recent:
        history_text = "\n".join(
            f"{'사용자' if h['role'] == 'user' else '어시스턴트'}: {h['text']}"
            for h in recent
        )
        query = f"[이전 대화]\n{history_text}\n\n[현재 질문]\n{message}"
    else:
        query = message

    t0 = time.time()
    ok, reply = _call_devx("DEVX_AGENT_CHAT", query)
    latency = int((time.time() - t0) * 1000)

    if not ok:
        return {"ok": False, "error": reply}
    return {"ok": True, "reply": reply, "latency_ms": latency, "model": "DevX AI"}


def api_devx_weekly(full_prompt: str, data_query: str, api_key: str = None) -> dict:
    """DevX AI 주간보고 초안 생성.
    에이전트 설정 시 data_query만 전송 (지시문은 에이전트 시스템 프롬프트에 있음).
    미설정 시 full_prompt를 playground로 전송.
    """
    if os.environ.get("DEVX_AGENT_WEEKLY", "").strip():
        query = data_query
    else:
        query = full_prompt
    ok, reply = _call_devx("DEVX_AGENT_WEEKLY", query, api_key)
    if not ok:
        return {"ok": False, "error": reply}
    if not reply:
        return {"ok": False, "error": "빈 응답"}
    return {"ok": True, "reply": reply}


def api_devx_check(api_key: str = None) -> dict:
    """DevX AI Gateway 상태 확인 — 토큰 발급으로 자격증명·IP·연결 검증."""
    cid, csec = _get_credentials()
    if not cid or not csec:
        return {"ok": False, "status": "no_key",
                "message": "DEVX_CLIENT_ID/DEVX_CLIENT_SECRET가 설정되지 않았습니다."}

    t0 = time.time()
    ok, msg = _get_token(force=True)
    latency = int((time.time() - t0) * 1000)

    if ok:
        return {"ok": True, "status": "ok", "latency_ms": latency}
    if "401" in msg or "403" in msg or "invalid" in msg.lower():
        return {"ok": False, "status": "invalid_key", "latency_ms": latency, "message": msg[:200]}
    return {"ok": False, "status": "error", "latency_ms": latency, "message": msg[:200]}
