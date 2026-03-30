"""주간보고 자동 생성"""
import urllib.parse
from datetime import datetime

from .jira import jira_get, JIRA_BASE_URL

# 합의완료일 후보 커스텀 필드 (여러 프로젝트 대응)
_DEADLINE_CANDIDATES = [
    "duedate",
    "customfield_13700",
    "customfield_14400",
    "customfield_15000",
    "customfield_15100",
    "customfield_16700",
    "customfield_17200",
    "customfield_17500",
]

_EXCLUDED_STATUSES = {"변경이관", "작업이관", "반려", "팀이관", "프로젝트이관"}

_DEPLOY_COMPLETE_FIELD = "customfield_11304"  # 변경관리 배포완료일시

_SEARCH_FIELDS = ",".join([
    "summary", "status", "issuetype", "created", "reporter", "description",
    "comment",
    _DEPLOY_COMPLETE_FIELD,
    *_DEADLINE_CANDIDATES,
])


def _clean_name(name: str) -> str:
    """displayName의 ∙ 문자를 _ 로 치환"""
    return name.replace("\u2219", "_").replace("\u00b7", "_").replace("\u2022", "_").replace("∙", "_")


def _get_deadline(fields: dict, issue_type: str = "") -> str | None:
    # 변경관리: 배포완료일시 우선
    if issue_type == "변경관리":
        val = fields.get(_DEPLOY_COMPLETE_FIELD)
        if val and isinstance(val, str) and len(val) >= 10:
            return val[:10]
    # 공통: 합의완료일 후보 필드 순서대로
    for cf in _DEADLINE_CANDIDATES:
        val = fields.get(cf)
        if val and isinstance(val, str) and len(val) >= 10 and val[:4].isdigit():
            return val[:10]
    return None


def _filter_comments(comments_data: dict, date_from: str, date_to: str) -> list:
    result = []
    try:
        from_dt = datetime.fromisoformat(date_from)
        to_dt = datetime.fromisoformat(date_to).replace(hour=23, minute=59, second=59)
        for c in (comments_data or {}).get("comments", []):
            created_str = (c.get("created") or "")[:10]
            try:
                if from_dt <= datetime.fromisoformat(created_str) <= to_dt:
                    result.append({
                        "date": created_str,
                        "author": (c.get("author") or {}).get("displayName", ""),
                        "body": (c.get("body") or "")[:400],
                    })
            except Exception:
                pass
    except Exception:
        pass
    return result


def api_weekly_fetch(token: str, date_from: str, date_to: str) -> dict:
    """기간 내 내 이슈 조회 (서비스요청관리 + 변경관리)"""
    try:
        jql = (
            f'assignee = currentUser() AND issuetype in ("서비스요청관리","변경관리") '
            f'AND updated >= "{date_from}" AND updated <= "{date_to}" '
            f'ORDER BY updated ASC'
        )
        url = (
            f"{JIRA_BASE_URL}/rest/api/2/search"
            f"?jql={urllib.parse.quote(jql)}"
            f"&fields={_SEARCH_FIELDS}"
            f"&maxResults=50"
        )
        data = jira_get(token, url)

        issues = []
        for issue in data.get("issues", []):
            f = issue.get("fields", {})
            key = issue.get("key", "")
            issue_type = (f.get("issuetype") or {}).get("name", "")
            comments_in_range = (
                _filter_comments(f.get("comment"), date_from, date_to)
                if issue_type == "변경관리" else []
            )
            status_name = (f.get("status") or {}).get("name", "")
            if status_name in _EXCLUDED_STATUSES:
                continue
            issues.append({
                "key": key,
                "summary": f.get("summary", ""),
                "issue_type": issue_type,
                "status": status_name,
                "created": (f.get("created") or "")[:10],
                "reporter": _clean_name((f.get("reporter") or {}).get("displayName", "")),
                "description": (f.get("description") or "")[:500],
                "deadline": _get_deadline(f, issue_type),
                "comments": comments_in_range,
            })

        return {"ok": True, "issues": issues, "total": len(issues)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _fmt_date(d: str) -> str:
    """2025-03-20 → 3/20"""
    if not d or len(d) < 10:
        return d or ""
    try:
        parts = d[:10].split("-")
        return f"{int(parts[1])}/{int(parts[2])}"
    except Exception:
        return d


def api_weekly_generate(
    issues: list,
    overrides: dict,
    status_map: dict,
    date_from: str,
    date_to: str,
    api_key: str = None,
    model: str = None,
    provider: str = "gemini",
) -> dict:
    """AI 주간보고 초안 생성"""

    def _get_group(status_name: str) -> str:
        for group, statuses in status_map.items():
            if status_name in statuses:
                return group
        return "기타"

    # 그룹별 분류
    group_order = ["검토중", "진행중", "완료"]
    grouped: dict = {g: [] for g in group_order}
    grouped["기타"] = []
    for issue in issues:
        grouped.setdefault(_get_group(issue["status"]), []).append(issue)

    # 이슈 블록 구성 (제외 상태 및 기타 그룹 제외)
    issue_blocks = []
    for issue in issues:
        if issue["status"] in _EXCLUDED_STATUSES:
            continue
        if _get_group(issue["status"]) == "기타":
            continue
        key = issue["key"]
        deadline = (overrides.get(key) or {}).get("deadline") or issue.get("deadline") or ""
        deadline_fmt = f"~{_fmt_date(deadline)}" if deadline else "~(목표일 미입력)"
        created_fmt = _fmt_date(issue.get("created", ""))
        group = _get_group(issue["status"])

        block = (
            f"=== {key} | {issue['issue_type']} | 그룹:{group} ===\n"
            f"제목: {issue['summary']}\n"
            f"요청자: {issue['reporter']}\n"
            f"생성일: {created_fmt}\n"
            f"현재상태: {issue['status']}\n"
            f"목표일: {deadline_fmt}\n"
            f"내용: {issue['description'][:400]}\n"
        )
        if issue.get("comments"):
            comments_txt = "\n".join(
                f"  [{_fmt_date(c['date'])}] {c['body'][:200]}"
                for c in issue["comments"]
            )
            block += f"기간내 댓글:\n{comments_txt}\n"
        issue_blocks.append(block)

    prompt = f"""다음 Jira 이슈들을 바탕으로 주간보고 초안을 작성하세요.
조회기간: {date_from} ~ {date_to}

## 이슈 목록
{"".join(issue_blocks)}

## 작성 규칙
1. 이슈를 그룹(검토중→진행중→완료) 순으로 출력. 각 그룹 앞에 "■ 검토중", "■ 진행중", "■ 완료" 헤더 표시.
2. 서비스요청관리 → 양식A, 변경관리 → 양식B 사용.
3. 자연스러운 주간보고 문체 (예: ~검토 진행중, ~개발 진행중, ~배포 예정 등).
4. 이슈키는 제목 앞에: "SCM3-XXXX 제목 (M/D~)"
5. 기타 그룹 이슈는 생략.

## 양식A (서비스요청관리)
SCM3-XXXX 제목 (M/D~)
- 요청자 : 이름
- 내용 : 내용 1~2줄 요약
- 진행 : 현재 상태 기반 진행 문구 (목표일)

## 양식B (변경관리)
SCM3-XXXX 제목 (M/D~)
- 요청자 : 이름
- 내용 : 내용 한줄 요약
- 진행 :
  (M/D) 기간내 댓글 한줄 요약 (댓글 없으면 현재 상태로 진행문구)
  (목표일)

주간보고 본문만 출력하세요. 서론, 설명 없이 바로 시작하세요."""

    try:
        if provider == "devx":
            from .devx_ai import api_devx_chat
            result = api_devx_chat([], prompt, api_key=api_key)
        else:
            from .gemini import api_gemini_chat
            result = api_gemini_chat([], prompt, api_key=api_key, model=model)

        if not result.get("ok"):
            return {"ok": False, "error": result.get("error", "AI 생성 실패")}

        return {"ok": True, "report": result.get("reply", "").strip()}
    except Exception as e:
        return {"ok": False, "error": str(e)}
