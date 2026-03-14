"""Jira REST API 호출"""
import html as _html
import json
import re
import ssl
import urllib.request
from urllib.parse import urlencode

from .settings import api_read

JIRA_BASE_URL = "https://jira.sinc.co.kr"

SHORTCUTS = {
    "내 미해결 이슈": 'assignee = currentUser() AND status = "미해결" ORDER BY updated DESC',
    "EP 이슈":        'assignee = currentUser() AND status in ("미해결","Open") AND issuetype = "서비스요청관리" AND (summary ~ "EP" OR summary ~ "권한") ORDER BY updated DESC',
    "변경관리":       'assignee = currentUser() AND issuetype = "변경관리" AND status not in ("완료", "반려", "중단") ORDER BY updated DESC',
}


def _jira_request(token: str, url: str, method: str = "GET", data: dict = None) -> dict:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    payload = None
    if data:
        payload = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"
    
    req = urllib.request.Request(url, data=payload, headers=headers, method=method)
    with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
        content = resp.read().decode("utf-8")
        return json.loads(content) if content else {"ok": True}


def jira_get(token: str, url: str) -> dict:
    return _jira_request(token, url, "GET")


def jira_update_issue(token: str, key: str, fields: dict = None, transition: str = None, comment: str = None) -> dict:
    """이슈 업데이트: 필드 수정, 상태 변경, 댓글 추가"""
    try:
        results = {"key": key}
        
        # 1. 필드 수정 (담당자 등)
        if fields:
            url = f"{JIRA_BASE_URL}/rest/api/2/issue/{key}"
            _jira_request(token, url, "PUT", {"fields": fields})
            results["fields_updated"] = True

        # 2. 상태 변경 (Transition)
        if transition:
            # 먼저 사용 가능한 transition ID 조회
            trans_url = f"{JIRA_BASE_URL}/rest/api/2/issue/{key}/transitions"
            trans_data = _jira_request(token, trans_url, "GET")
            tid = ""
            for t in trans_data.get("transitions", []):
                if t.get("name") == transition or t.get("id") == transition:
                    tid = t.get("id")
                    break
            
            if tid:
                _jira_request(token, trans_url, "POST", {"transition": {"id": tid}})
                results["transition_updated"] = True
            else:
                results["transition_error"] = f"Transition '{transition}'을(를) 찾을 수 없습니다."

        # 3. 댓글 추가
        if comment:
            comment_url = f"{JIRA_BASE_URL}/rest/api/2/issue/{key}/comment"
            _jira_request(token, comment_url, "POST", {"body": comment})
            results["comment_added"] = True

        return {"ok": True, "results": results}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _extract_blossom_body(xml_str: str) -> str:
    """customfield_10848 XML에서 요청내용 + 기안의견 텍스트 추출"""
    if not xml_str:
        return ""
    m = re.search(r'<BODY>(.*?)</BODY>', xml_str, re.DOTALL)
    if not m:
        return ""
    body_html = _html.unescape(m.group(1))
    body_html = re.sub(r'<br\s*/?>', '\n', body_html, flags=re.IGNORECASE)
    cells = re.findall(r'<td[^>]*>(.*?)</td>', body_html, re.DOTALL | re.IGNORECASE)

    def strip_tags(s: str) -> str:
        return re.sub(r'<[^>]+>', ' ', s).strip()

    result_parts = []
    for i, cell in enumerate(cells):
        text = re.sub(r'\s+', ' ', strip_tags(cell)).strip()
        if text in ('요청내용', '기안의견') and i + 1 < len(cells):
            next_text = re.sub(r'\s+', ' ', strip_tags(cells[i + 1])).strip()
            if next_text:
                result_parts.append(f"[{text}] {next_text}")
    return '\n'.join(result_parts)[:600]


def jira_get_issue_detail(token: str, key: str) -> dict:
    """이슈 상세 조회 — description + 결재요청 내용(customfield_10848)"""
    url = (f"{JIRA_BASE_URL}/rest/api/2/issue/{key}"
           f"?fields=summary,description,issuetype,customfield_10848")
    data = jira_get(token, url)
    f = data.get("fields", {})
    description = (f.get("description") or "").strip()[:300]
    blossom_raw = f.get("customfield_10848") or ""
    return {
        "key": key,
        "summary": f.get("summary", ""),
        "issuetype": (f.get("issuetype") or {}).get("name", ""),
        "description": description,
        "blossom": _extract_blossom_body(blossom_raw),
    }


def api_chat(query: str) -> dict:
    """이슈 키 또는 JQL로 Jira 검색"""
    cfg = api_read()
    if not cfg.get("ok"):
        return {"error": cfg.get("error", "설정 로드 실패")}

    env = cfg.get("env", {})
    token = env.get("JIRA_PAT_TOKEN", "")
    if not token:
        return {"error": "JIRA_PAT_TOKEN이 설정되지 않았습니다."}

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    q = query.strip()

    if re.match(r'^[A-Z]+-\d+$', q):
        url = f"{JIRA_BASE_URL}/rest/api/2/issue/{q}"
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            return {"type": "issue", "data": data}
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="replace")
            return {"error": f"HTTP {e.code}: {body[:300]}"}
        except Exception as e:
            return {"error": str(e)}

    jql = SHORTCUTS.get(q) or q
    params = urlencode({
        "jql": jql,
        "maxResults": 30,
        "fields": "summary,status,assignee,issuetype,priority,updated",
    })
    url = f"{JIRA_BASE_URL}/rest/api/2/search?{params}"
    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return {"type": "search", "data": data, "jql": jql}
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        return {"error": f"HTTP {e.code}: {body[:300]}"}
    except Exception as e:
        return {"error": str(e)}
