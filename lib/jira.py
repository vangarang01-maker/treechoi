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


def jira_get(token: str, url: str) -> dict:
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))


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
