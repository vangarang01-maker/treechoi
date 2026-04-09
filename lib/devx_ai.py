"""DevX AI API — 사내 AI 제공자 (Gemini 대체)"""
import json
import os
import re
import ssl
import time
import urllib.request
from datetime import date

from .settings import api_read
from .prompts import load_prompt

DEVX_API_URL = "https://devx-mcp-api.shinsegae-inc.com/api/v1/mcp-command/chat"

_SR_WORK_TYPE_PROMPT = {
    "계정/권한 처리":    "sr_account",
    "데이터추출":        "sr_data",
    "공통코드 단순변경": "sr_code",
    "기타":              "sr_etc",
}


def _get_devx_api_key(api_key: str = None) -> str:
    if api_key:
        return api_key
    v = os.environ.get("DEVX_API_KEY", "")
    if v:
        return v
    cfg = api_read(mask_sensitive=False)
    if cfg.get("ok"):
        return cfg.get("env", {}).get("DEVX_API_KEY", "").strip()
    return ""


def _call_devx(agent_env_key: str, prompt: str, api_key: str = None) -> tuple[bool, str]:
    """DevX AI 단일 호출 공통 헬퍼. (ok, text_or_error) 반환."""
    resolved_key = _get_devx_api_key(api_key)
    if not resolved_key:
        return False, "DEVX_API_KEY가 설정되지 않았습니다."

    agent_code = os.environ.get(agent_env_key, "").strip() or "playground"

    payload = json.dumps({
        "agent_code": agent_code,
        "query": prompt,
        "response_mode": "blocking",
    }).encode("utf-8")

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    try:
        req = urllib.request.Request(
            DEVX_API_URL, data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {resolved_key}",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, context=ctx, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        ext = data.get("external_response", {})
        # 실제 응답 구조: external_response.dify_response.answer (또는 external_response.answer)
        text = (ext.get("dify_response", {}).get("answer") or ext.get("answer") or "").strip()
        return True, text
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode("utf-8", errors="replace"))
            msg = err.get("message", f"HTTP {e.code}")
        except Exception:
            msg = f"HTTP {e.code}"
        return False, msg
    except Exception as e:
        return False, str(e)


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
    resolved_key = _get_devx_api_key(api_key)
    if not resolved_key:
        return {"ok": False, "error": "DEVX_API_KEY가 설정되지 않았습니다."}
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
    ok, reply = _call_devx("DEVX_AGENT_CHAT", query, resolved_key)
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
    """DevX AI API 상태 확인 (ping)"""
    resolved_key = _get_devx_api_key(api_key)
    if not resolved_key:
        return {"ok": False, "status": "no_key", "message": "DEVX_API_KEY가 설정되지 않았습니다."}

    t0 = time.time()
    ok, reply = _call_devx("", "ping", resolved_key)
    latency = int((time.time() - t0) * 1000)

    if ok:
        return {"ok": True, "status": "ok", "latency_ms": latency}
    if "API_KEY" in reply or "401" in reply or "403" in reply:
        return {"ok": False, "status": "invalid_key", "latency_ms": latency, "message": reply[:200]}
    return {"ok": False, "status": "error", "latency_ms": latency, "message": reply[:200]}
