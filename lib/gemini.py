"""Gemini API — 채팅 및 상태 확인"""
import json
import re
import ssl
import time
import urllib.request

from .settings import api_read
from .prompts import load_prompt


def _call_gemini(api_key: str, model: str, prompt: str,
                 temperature: float = 0.3, max_tokens: int = 1024,
                 json_mode: bool = False) -> tuple[bool, str]:
    """Gemini API 단일 호출 공통 헬퍼. (ok, text_or_error) 반환."""
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    gen_cfg: dict = {"temperature": temperature, "maxOutputTokens": max_tokens}
    if json_mode:
        gen_cfg["response_mime_type"] = "application/json"
    payload = json.dumps({
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": gen_cfg,
    }).encode("utf-8")
    ctx = ssl.create_default_context()
    try:
        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        parts = (data.get("candidates", [{}])[0].get("content", {}).get("parts", []))
        text = next((p.get("text", "") for p in parts if not p.get("thought")), "")
        return True, text
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode("utf-8", errors="replace"))
            msg = err.get("error", {}).get("message", f"HTTP {e.code}")
        except Exception:
            msg = f"HTTP {e.code}"
        return False, msg
    except Exception as e:
        return False, str(e)


def api_gemini_chat(history: list, message: str, api_key: str = None, model: str = None,
                    system_prompt: str = None) -> dict:
    """Gemini와 실시간 채팅 — 대화 히스토리 유지"""
    if not api_key or not model:
        cfg = api_read(mask_sensitive=False)
        if not cfg.get("ok"):
            return {"ok": False, "error": cfg.get("error", "설정 로드 실패")}
        env = cfg.get("env", {})
        api_key = api_key or env.get("GEMINI_API_KEY", "").strip()
        model = model or env.get("GEMINI_MODEL", "gemini-2.5-flash").strip()

    if not api_key:
        return {"ok": False, "error": "GEMINI_API_KEY가 설정되지 않았습니다."}
    if not message.strip():
        return {"ok": False, "error": "메시지가 비어있습니다."}

    contents = []
    for turn in (history or []):
        role = turn.get("role", "user")
        text = turn.get("text", "")
        if role in ("user", "model") and text:
            contents.append({"role": role, "parts": [{"text": text}]})
    contents.append({"role": "user", "parts": [{"text": message}]})

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    body: dict = {
        "contents": contents,
        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 2048},
    }
    if system_prompt:
        body["system_instruction"] = {"parts": [{"text": system_prompt}]}
    payload = json.dumps(body).encode("utf-8")
    ctx = ssl.create_default_context()

    t0 = time.time()
    try:
        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        latency = int((time.time() - t0) * 1000)
        candidates = data.get("candidates", [])
        if not candidates:
            return {"ok": False, "error": "응답이 없습니다."}
        reply = candidates[0].get("content", {}).get("parts", [{}])[0].get("text", "")
        return {"ok": True, "reply": reply, "latency_ms": latency, "model": model}
    except urllib.error.HTTPError as e:
        latency = int((time.time() - t0) * 1000)
        try:
            err = json.loads(e.read().decode("utf-8", errors="replace"))
            msg = err.get("error", {}).get("message", f"HTTP {e.code}")
        except Exception:
            msg = f"HTTP {e.code}"
        return {"ok": False, "error": msg, "latency_ms": latency}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def api_ai_verify(open_issue: dict, similar_issues: list, api_key: str = None, model: str = None) -> dict:
    """Gemini로 Top 3 완료 이슈 중 최적 1건 선택"""
    if not api_key or not model:
        cfg = api_read(mask_sensitive=False)
        if not cfg.get("ok"):
            return {"ok": False, "error": cfg.get("error")}
        env = cfg.get("env", {})
        api_key = api_key or env.get("GEMINI_API_KEY", "").strip()
        model = model or env.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
    if not api_key:
        return {"ok": False, "error": "GEMINI_API_KEY가 설정되지 않았습니다."}

    candidate_lines = []
    for i, iss in enumerate(similar_issues):
        label = ['①', '②', '③'][i] if i < 3 else f"({i+1})"
        blossom = f"결재요청: {iss['blossom']}\n" if iss.get('blossom') else ""
        candidate_lines.append(
            f"{label} {iss['key']} — {iss['summary']}\n"
            f"내용: {iss['description']}\n"
            f"{blossom}"
        )

    try:
        prompt = load_prompt(
            "ai_verify",
            open_key=open_issue['key'],
            open_issuetype=open_issue['issuetype'],
            open_summary=open_issue['summary'],
            open_description=open_issue['description'],
            candidates="\n".join(candidate_lines),
        )
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}

    ok, reply = _call_gemini(api_key, model, prompt, temperature=0.2, max_tokens=1024)
    if not ok:
        return {"ok": False, "error": reply}

    best_key = ""
    reason = reply
    m = re.search(r'선택\s*[:：]\s*\*{0,2}([A-Z][A-Z0-9]*-\d+)\*{0,2}', reply)
    if m:
        best_key = m.group(1)
    if not best_key:
        before_reason = re.split(r'이유\s*[:：]', reply)[0]
        keys = re.findall(r'[A-Z][A-Z0-9]*-\d+', before_reason)
        if keys:
            best_key = keys[0]
    m2 = re.search(r'이유\s*[:：]\s*(.+)', reply, re.DOTALL)
    if m2:
        reason = m2.group(1).strip()

    return {"ok": True, "best_key": best_key, "reason": reason}


def api_draft_comment(open_issue: dict, best_match: dict, api_key: str = None, model: str = None) -> dict:
    """유사 완료 이슈를 참고하여 현재 이슈에 달 댓글 초안을 Gemini로 생성"""
    if not api_key or not model:
        cfg = api_read(mask_sensitive=False)
        if not cfg.get("ok"):
            return {"ok": False, "error": cfg.get("error")}
        env = cfg.get("env", {})
        api_key = api_key or env.get("GEMINI_API_KEY", "").strip()
        model = model or env.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
    if not api_key:
        return {"ok": False, "error": "GEMINI_API_KEY가 설정되지 않았습니다."}

    try:
        prompt = load_prompt(
            "draft_comment",
            open_key=open_issue['key'],
            open_issuetype=open_issue.get('issuetype', ''),
            open_summary=open_issue['summary'],
            open_description=open_issue.get('description', '(내용 없음)'),
            open_blossom=f"결재요청: {open_issue['blossom']}" if open_issue.get('blossom') else "",
            best_key=best_match['key'],
            best_issuetype=best_match.get('issuetype', ''),
            best_summary=best_match['summary'],
            best_description=best_match.get('description', '(내용 없음)'),
            best_blossom=f"결재요청: {best_match['blossom']}" if best_match.get('blossom') else "",
        )
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}

    t0 = time.time()
    ok, reply = _call_gemini(api_key, model, prompt, temperature=0.4, max_tokens=512)
    latency = int((time.time() - t0) * 1000)
    if not ok:
        return {"ok": False, "error": reply}
    return {"ok": True, "draft": reply.strip(), "latency_ms": latency, "model": model}


def api_gemini_process_agent(message: str, api_key: str = None, model: str = None) -> dict:
    """사용자 메시지를 분석하여 의도(검색, 채팅, 액션) 및 상세 파라미터 추출"""
    if not api_key or not model:
        cfg = api_read(mask_sensitive=False)
        if not cfg.get("ok"):
            return {"ok": False, "error": cfg.get("error")}
        env = cfg.get("env", {})
        api_key = api_key or env.get("GEMINI_API_KEY", "").strip()
        model = model or env.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
    if not api_key:
        return {"ok": False, "error": "GEMINI_API_KEY가 설정되지 않았습니다."}

    try:
        prompt = load_prompt("agent_query", message=message)
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}

    ok, raw_reply = _call_gemini(api_key, model, prompt,
                                  temperature=0.1, max_tokens=1024, json_mode=True)
    if not ok:
        return {"ok": False, "error": raw_reply}
    try:
        result = json.loads(raw_reply)
        return {"ok": True, "result": result}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def api_gemini_requirements(
    summary: str, description: str, change_type: str,
    api_key: str = None, model: str = None,
) -> dict:
    """description → 요건정의서 테이블 (Jira 위키 마크업) 생성"""
    if not api_key or not model:
        cfg = api_read(mask_sensitive=False)
        if not cfg.get("ok"):
            return {"ok": False, "error": cfg.get("error")}
        env = cfg.get("env", {})
        api_key = api_key or env.get("GEMINI_API_KEY", "").strip()
        model = model or env.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
    if not api_key:
        return {"ok": False, "error": "GEMINI_API_KEY가 설정되지 않았습니다."}

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

    ok, reply = _call_gemini(api_key, model, prompt, temperature=0.3, max_tokens=1024)
    if not ok:
        return {"ok": False, "error": reply}
    reply = re.sub(r"```[^\n]*\n?", "", reply).strip()
    if not reply or "||번호||" not in reply:
        return {"ok": False, "error": "응답 형식 불일치"}
    return {"ok": True, "content": reply}


def api_gemini_review(
    summary: str, description: str, change_type: str,
    api_key: str = None, model: str = None,
) -> dict:
    """변경검토회의 5섹션 초안 (Jira 위키 마크업) 생성"""
    if not api_key or not model:
        cfg = api_read(mask_sensitive=False)
        if not cfg.get("ok"):
            return {"ok": False, "error": cfg.get("error")}
        env = cfg.get("env", {})
        api_key = api_key or env.get("GEMINI_API_KEY", "").strip()
        model = model or env.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
    if not api_key:
        return {"ok": False, "error": "GEMINI_API_KEY가 설정되지 않았습니다."}

    from datetime import date
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

    ok, reply = _call_gemini(api_key, model, prompt, temperature=0.3, max_tokens=1024)
    if not ok:
        return {"ok": False, "error": reply}
    reply = re.sub(r"```[^\n]*\n?", "", reply).strip()
    if not reply or "|회의일시|" not in reply:
        return {"ok": False, "error": "응답 형식 불일치"}
    return {"ok": True, "content": reply}


def api_gemini_test(
    summary: str, review_content: str, change_type: str,
    api_key: str = None, model: str = None,
) -> dict:
    """변경검토회의 내용 기반 테스트케이스 생성 (Jira 위키 마크업)"""
    if not api_key or not model:
        cfg = api_read(mask_sensitive=False)
        if not cfg.get("ok"):
            return {"ok": False, "error": cfg.get("error")}
        env = cfg.get("env", {})
        api_key = api_key or env.get("GEMINI_API_KEY", "").strip()
        model = model or env.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
    if not api_key:
        return {"ok": False, "error": "GEMINI_API_KEY가 설정되지 않았습니다."}

    from datetime import date
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

    ok, reply = _call_gemini(api_key, model, prompt, temperature=0.3, max_tokens=2048)
    if not ok:
        return {"ok": False, "error": reply}
    reply = re.sub(r"```[^\n]*\n?", "", reply).strip()
    if not reply or "테스트유형" not in reply:
        return {"ok": False, "error": "응답 형식 불일치"}
    return {"ok": True, "content": reply}


def api_gemini_procedure(
    summary: str, change_type: str, server_info: str,
    api_key: str = None, model: str = None,
) -> dict:
    """배포절차 초안 생성 (Jira 위키 마크업)"""
    if not api_key or not model:
        cfg = api_read(mask_sensitive=False)
        if not cfg.get("ok"):
            return {"ok": False, "error": cfg.get("error")}
        env = cfg.get("env", {})
        api_key = api_key or env.get("GEMINI_API_KEY", "").strip()
        model = model or env.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
    if not api_key:
        return {"ok": False, "error": "GEMINI_API_KEY가 설정되지 않았습니다."}

    is_db = "DB" in change_type.upper()
    prompt_name = "procedure_db" if is_db else "procedure_program"

    try:
        prompt = load_prompt(
            prompt_name,
            summary=summary,
            change_type=change_type,
            server_info=server_info,
        )
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}

    ok, reply = _call_gemini(api_key, model, prompt, temperature=0.3, max_tokens=1024)
    if not ok:
        return {"ok": False, "error": reply}
    reply = re.sub(r"```[^\n]*\n?", "", reply).strip()
    if not reply or "변경 내용" not in reply:
        return {"ok": False, "error": "응답 형식 불일치"}
    return {"ok": True, "content": reply}


def api_gemini_approval(
    summary: str, description: str, change_type: str,
    api_key: str = None, model: str = None,
) -> dict:
    """배포결재 멘트 생성 (자유 텍스트)"""
    if not api_key or not model:
        cfg = api_read(mask_sensitive=False)
        if not cfg.get("ok"):
            return {"ok": False, "error": cfg.get("error")}
        env = cfg.get("env", {})
        api_key = api_key or env.get("GEMINI_API_KEY", "").strip()
        model = model or env.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
    if not api_key:
        return {"ok": False, "error": "GEMINI_API_KEY가 설정되지 않았습니다."}

    try:
        prompt = load_prompt(
            "approval",
            summary=summary,
            change_type=change_type,
            description=description or "(내용 없음)",
        )
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}

    ok, reply = _call_gemini(api_key, model, prompt, temperature=0.4, max_tokens=512)
    if not ok:
        return {"ok": False, "error": reply}
    reply = re.sub(r"```[^\n]*\n?", "", reply).strip()
    if not reply:
        return {"ok": False, "error": "빈 응답"}
    return {"ok": True, "content": reply}


_SR_WORK_TYPE_PROMPT = {
    "계정/권한 처리": "sr_account",
    "데이터추출":     "sr_data",
    "공통코드 단순변경": "sr_code",
    "기타":           "sr_etc",
}


def api_gemini_sr_draft(
    work_type: str, summary: str, description: str,
    api_key: str = None, model: str = None,
) -> dict:
    """서비스요청관리 업무유형별 처리 내역 초안 생성"""
    if not api_key or not model:
        cfg = api_read(mask_sensitive=False)
        if not cfg.get("ok"):
            return {"ok": False, "error": cfg.get("error")}
        env = cfg.get("env", {})
        api_key = api_key or env.get("GEMINI_API_KEY", "").strip()
        model = model or env.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
    if not api_key:
        return {"ok": False, "error": "GEMINI_API_KEY가 설정되지 않았습니다."}

    prompt_name = _SR_WORK_TYPE_PROMPT.get(work_type, "sr_etc")
    try:
        prompt = load_prompt(
            prompt_name,
            summary=summary,
            description=description or "(내용 없음)",
        )
    except FileNotFoundError as e:
        return {"ok": False, "error": str(e)}

    ok, reply = _call_gemini(api_key, model, prompt, temperature=0.3, max_tokens=1024)
    if not ok:
        return {"ok": False, "error": reply}
    reply = re.sub(r"```[^\n]*\n?", "", reply).strip()
    if not reply:
        return {"ok": False, "error": "빈 응답"}
    return {"ok": True, "content": reply}


def api_gemini_check(api_key: str = None, model: str = None) -> dict:
    """Gemini API 상태 확인 (countTokens로 ping)"""
    if not api_key or not model:
        cfg = api_read(mask_sensitive=False)
        if not cfg.get("ok"):
            return {"ok": False, "status": "config_error", "message": cfg.get("error")}
        env = cfg.get("env", {})
        api_key = api_key or env.get("GEMINI_API_KEY", "").strip()
        model = model or env.get("GEMINI_MODEL", "gemini-2.5-flash").strip()

    if not api_key:
        return {"ok": False, "status": "no_key", "message": "API 키가 설정되지 않았습니다."}

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:countTokens?key={api_key}"
    payload = json.dumps({"contents": [{"parts": [{"text": "test"}]}]}).encode("utf-8")
    ctx = ssl.create_default_context()

    t0 = time.time()
    try:
        req = urllib.request.Request(
            url, data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, context=ctx, timeout=10) as resp:
            json.loads(resp.read().decode("utf-8"))
        latency = int((time.time() - t0) * 1000)
        return {"ok": True, "status": "ok", "latency_ms": latency, "model": model}
    except urllib.error.HTTPError as e:
        latency = int((time.time() - t0) * 1000)
        try:
            err = json.loads(e.read().decode("utf-8", errors="replace"))
            code = err.get("error", {}).get("code", e.code)
            msg  = err.get("error", {}).get("message", "")
        except Exception:
            code, msg = e.code, ""
        if e.code == 429:
            status = "quota_exceeded"
        elif e.code == 404:
            status = "model_not_found"
        elif e.code in (400, 401, 403):
            status = "invalid_key"
        else:
            status = "error"
        return {"ok": False, "status": status, "code": code,
                "latency_ms": latency, "model": model, "message": msg[:200]}
    except Exception as e:
        return {"ok": False, "status": "error", "model": model, "message": str(e)}
