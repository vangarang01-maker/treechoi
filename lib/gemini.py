"""Gemini API — 채팅 및 상태 확인"""
import json
import re
import ssl
import time
import urllib.request

from .settings import api_read


def api_gemini_chat(history: list, message: str, api_key: str = None, model: str = None) -> dict:
    """Gemini와 실시간 채팅 — 대화 히스토리 유지"""
    if not api_key or not model:
        cfg = api_read()
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
    payload = json.dumps({
        "contents": contents,
        "generationConfig": {"temperature": 0.7, "maxOutputTokens": 2048},
    }).encode("utf-8")
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
        cfg = api_read()
        if not cfg.get("ok"):
            return {"ok": False, "error": cfg.get("error")}
        env = cfg.get("env", {})
        api_key = api_key or env.get("GEMINI_API_KEY", "").strip()
        model = model or env.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
    if not api_key:
        return {"ok": False, "error": "GEMINI_API_KEY가 설정되지 않았습니다."}

    lines = [
        "당신은 Jira 이슈 분류 전문가입니다.\n\n",
        "[현재 미해결 이슈]\n",
        f"키: {open_issue['key']}  타입: {open_issue['issuetype']}\n",
        f"제목: {open_issue['summary']}\n",
        f"내용: {open_issue['description']}\n\n",
        "[유사 완료 이슈 후보]\n",
    ]
    for i, iss in enumerate(similar_issues):
        label = ['①', '②', '③'][i] if i < 3 else f"({i+1})"
        blossom = f"결재요청: {iss['blossom']}\n" if iss.get('blossom') else ""
        lines.append(
            f"{label} {iss['key']} — {iss['summary']}\n"
            f"내용: {iss['description']}\n"
            f"{blossom}\n"
        )
    lines.append(
        "위 후보 중 현재 미해결 이슈와 가장 유사하여 처리 참고가 될 이슈 1건을 선택하고, "
        "이유를 2~3문장으로 설명해주세요.\n"
        "응답 형식:\n선택: {이슈키}\n이유: {설명}"
    )
    prompt = ''.join(lines)

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    payload = json.dumps({
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "maxOutputTokens": 512},
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
        reply = (data.get("candidates", [{}])[0]
                 .get("content", {}).get("parts", [{}])[0].get("text", ""))

        best_key = ""
        reason = reply
        # 마크다운 볼드(**) 포함 유연 파싱
        m = re.search(r'선택\s*[:：]\s*\*{0,2}([A-Z]+-\d+)\*{0,2}', reply)
        if m:
            best_key = m.group(1)
        # 못 찾으면 응답 전체에서 첫 번째 이슈 키 추출
        if not best_key:
            keys = re.findall(r'[A-Z]+-\d+', reply)
            if keys:
                best_key = keys[0]
        m2 = re.search(r'이유\s*[:：]\s*(.+)', reply, re.DOTALL)
        if m2:
            reason = m2.group(1).strip()

        return {"ok": True, "best_key": best_key, "reason": reason}
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode("utf-8", errors="replace"))
            msg = err.get("error", {}).get("message", f"HTTP {e.code}")
        except Exception:
            msg = f"HTTP {e.code}"
        return {"ok": False, "error": msg}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def api_gemini_process_agent(message: str, api_key: str = None, model: str = None) -> dict:
    """사용자 메시지를 분석하여 의도(검색, 채팅, 액션) 및 상세 파라미터 추출"""
    if not api_key or not model:
        cfg = api_read()
        if not cfg.get("ok"):
            return {"ok": False, "error": cfg.get("error")}
        env = cfg.get("env", {})
        api_key = api_key or env.get("GEMINI_API_KEY", "").strip()
        model = model or env.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
    
    if not api_key:
        return {"ok": False, "error": "GEMINI_API_KEY가 설정되지 않았습니다."}

    prompt = f"""당신은 Jira 업무 보조 AI 에이전트입니다. 사용자의 자연어 입력을 분석하여 의도와 필요한 파라미터를 JSON 형식으로 응답하세요.

의도 종류:
1. SEARCH: Jira 이슈 검색 (JQL 생성 필요)
2. ACTION: Jira 이슈 수정 (상태 변경, 담당자 변경, 댓글 추가 등)
3. CHAT: 단순 대화 또는 도움말 요청

필드 가이드 (JQL 생성 시):
- 프로젝트: SCM3
- 상태: "미해결", "Open", "진행중", "완료", "반려", "중단" 등
- 이슈타입: "서비스요청관리", "변경관리" 등
- 담당자: assignee = currentUser() 또는 특정 이름/사번(예: 223733)

응답 JSON 형식:
{{
  "intent": "SEARCH" | "ACTION" | "CHAT",
  "jql": "생성된 JQL (SEARCH인 경우)",
  "action": {{
    "issue_key": "이슈 키 (예: SCM3-1234)",
    "fields": {{ "assignee": "사번" }},
    "transition": "상태명 (예: 진행중)",
    "comment": "추가할 댓글 내용"
  }},
  "reason": "분석 이유"
}}

사용자 입력: {message}

JSON 응답:"""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    payload = json.dumps({
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 1024,
            "response_mime_type": "application/json"
        },
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
        
        raw_reply = (data.get("candidates", [{}])[0]
                     .get("content", {}).get("parts", [{}])[0].get("text", ""))
        
        result = json.loads(raw_reply)
        return {"ok": True, "result": result}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def api_gemini_check(api_key: str = None, model: str = None) -> dict:
    """Gemini API 상태 확인 (countTokens로 ping)"""
    if not api_key or not model:
        cfg = api_read()
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
