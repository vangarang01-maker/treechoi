"""Gemini Embedding 기반 유사 이슈 검색"""
import json
import math
import ssl
import time
import urllib.request
from pathlib import Path
from urllib.parse import urlencode

from .settings import api_read
from .jira import jira_get, JIRA_BASE_URL

CACHE_FILE = Path(__file__).parent.parent / "data" / "embedding_cache.json"
EMBED_MODEL = "gemini-embedding-001"
EMBED_TYPES = ["서비스요청관리", "변경관리"]


# ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

def _embed_text(api_key: str, text: str) -> list:
    url = (f"https://generativelanguage.googleapis.com/v1beta"
           f"/models/{EMBED_MODEL}:embedContent?key={api_key}")
    payload = json.dumps({
        "model": f"models/{EMBED_MODEL}",
        "content": {"parts": [{"text": text}]},
    }).encode("utf-8")
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, data=payload,
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, context=ctx, timeout=15) as resp:
        return json.loads(resp.read().decode("utf-8"))["embedding"]["values"]


def _cosine_similarity(a: list, b: list) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na and nb else 0.0


def _make_embed_text(issue: dict) -> str:
    """summary + 최초 description 앞 300자 (양쪽 동일 구조로 비대칭 방지)"""
    f = issue.get("fields", {})
    issuetype = (f.get("issuetype") or {}).get("name", "")
    summary = f.get("summary", "")
    desc = (f.get("description") or "").replace("\n", " ").strip()[:300]
    return f"[{issuetype}] {summary}\n{desc}".strip()


def _load_cache() -> dict:
    if not CACHE_FILE.exists():
        return {}
    return json.loads(CACHE_FILE.read_text(encoding="utf-8"))


def _save_cache(cache: dict) -> None:
    CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    CACHE_FILE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")


# ── Public API ────────────────────────────────────────────────────────────────

def api_embedding_cache_status() -> dict:
    if not CACHE_FILE.exists():
        return {"ok": True, "exists": False}
    try:
        data = _load_cache()
        meta = data.get("meta", {})
        type_counts: dict = {}
        for v in data.get("issues", {}).values():
            t = v.get("issuetype", "기타")
            type_counts[t] = type_counts.get(t, 0) + 1
        return {
            "ok": True, "exists": True,
            "meta": meta,
            "type_counts": type_counts,
            "total": len(data.get("issues", {})),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


def api_embedding_build_stream(users: list, api_key: str = None, token: str = None):
    """완료 이슈 임베딩 캐시 구축 (Generator / SSE 지원)"""
    if not api_key or not token:
        cfg = api_read()
        if not cfg.get("ok"):
            yield {"ok": False, "error": cfg.get("error")}
            return
        env = cfg.get("env", {})
        token = token or env.get("JIRA_PAT_TOKEN", "")
        api_key = api_key or env.get("GEMINI_API_KEY", "")

    if not token:
        yield {"ok": False, "error": "JIRA_PAT_TOKEN이 설정되지 않았습니다."}
        return
    if not api_key:
        yield {"ok": False, "error": "GEMINI_API_KEY가 설정되지 않았습니다."}
        return

    # 기존 캐시 로드
    existing = _load_cache().get("issues", {})
    issues_data: dict = {}
    added = skipped = reused = 0
    first_embed_error: str = ""
    jira_counts: dict = {}

    user_jql = ", ".join(f'"{u}"' for u in users) if users else "currentUser()"
    
    # 1단계: 전체 이슈 목록 확보
    all_issues = []
    for issuetype in EMBED_TYPES:
        jql = (f'assignee in ({user_jql}) AND status = "완료"'
               f' AND issuetype = "{issuetype}" ORDER BY updated DESC')
        params = urlencode({
            "jql": jql, "maxResults": 200,
            "fields": "summary,description,issuetype,updated",
        })
        try:
            yield {"step": "jira_search", "issuetype": issuetype, "msg": f"{issuetype} 이슈 조회 중..."}
            resp = jira_get(token, f"{JIRA_BASE_URL}/rest/api/2/search?{params}")
            fetched = resp.get("issues", [])
            jira_counts[issuetype] = len(fetched)
            all_issues.extend(fetched)
        except Exception as e:
            yield {"ok": False, "error": f"{issuetype} 조회 실패: {e}"}
            return

    total_to_process = len(all_issues)
    yield {"step": "start", "total": total_to_process, "msg": f"총 {total_to_process}건의 이슈 처리를 시작합니다."}

    # 2단계: 개별 이슈 처리 (임베딩 등)
    for i, issue in enumerate(all_issues):
        key = issue.get("key", "")
        issuetype = (issue.get("fields", {}) or {}).get("issuetype", {}).get("name", "")
        
        # 진행률 발송
        yield {
            "step": "progress",
            "current": i + 1,
            "total": total_to_process,
            "key": key,
            "msg": f"[{i+1}/{total_to_process}] {key} 처리 중..."
        }

        if key in existing:
            issues_data[key] = existing[key]
            reused += 1
            continue

        text = _make_embed_text(issue)
        try:
            vector = _embed_text(api_key, text)
        except Exception as e:
            skipped += 1
            if not first_embed_error:
                first_embed_error = f"{key}: {e}"
            continue

        f = issue.get("fields", {})
        issues_data[key] = {
            "issuetype": issuetype,
            "summary": f.get("summary", ""),
            "vector": vector,
            "updated": (f.get("updated") or "")[:10],
        }
        added += 1

    cache = {
        "meta": {
            "users": users,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "issue_count": len(issues_data),
        },
        "issues": issues_data,
    }
    _save_cache(cache)
    
    final_result = {
        "ok": True, 
        "total": len(issues_data), 
        "added": added, 
        "reused": reused, 
        "skipped": skipped, 
        "jira_counts": jira_counts,
        "msg": "캐시 구축이 완료되었습니다."
    }
    if first_embed_error:
        final_result["embed_error"] = first_embed_error
    
    yield {"step": "done", "result": final_result}


def api_embedding_build(users: list, api_key: str = None, token: str = None) -> dict:
    """완료 이슈 임베딩 캐시 구축 (기존 동기 방식 유지용 래퍼)"""
    gen = api_embedding_build_stream(users, api_key, token)
    last_res = {}
    for item in gen:
        if item.get("step") == "done":
            return item["result"]
        if item.get("ok") is False:
            return item
    return last_res


def api_similar_issues(users: list, api_key: str = None, token: str = None) -> dict:
    """미해결 이슈별 유사 완료 이슈 Top 3"""
    if not api_key or not token:
        cfg = api_read()
        if not cfg.get("ok"):
            return {"ok": False, "error": cfg.get("error")}
        env = cfg.get("env", {})
        token = token or env.get("JIRA_PAT_TOKEN", "")
        api_key = api_key or env.get("GEMINI_API_KEY", "")

    if not token:
        return {"ok": False, "error": "JIRA_PAT_TOKEN이 설정되지 않았습니다."}
    if not api_key:
        return {"ok": False, "error": "GEMINI_API_KEY가 설정되지 않았습니다."}
    if not CACHE_FILE.exists():
        return {"ok": False, "error": "캐시가 없습니다. 먼저 캐시를 구축해주세요."}

    cached = _load_cache().get("issues", {})
    user_jql = ", ".join(f'"{u}"' for u in users) if users else "currentUser()"
    type_list = ", ".join(f'"{t}"' for t in EMBED_TYPES)
    jql = (f'assignee in ({user_jql})'
           f' AND status not in ("완료", "반려", "중단", "변경이관", "팀이관")'
           f' AND issuetype in ({type_list})'
           f' ORDER BY updated DESC')
    params = urlencode({
        "jql": jql, "maxResults": 50,
        "fields": "summary,description,issuetype,status,assignee",
    })
    try:
        resp = jira_get(token, f"{JIRA_BASE_URL}/rest/api/2/search?{params}")
    except Exception as e:
        return {"ok": False, "error": f"미해결 이슈 조회 실패: {e}"}

    results = []
    for issue in resp.get("issues", []):
        key = issue.get("key", "")
        f = issue.get("fields", {})
        issuetype = (f.get("issuetype") or {}).get("name", "")
        text = _make_embed_text(issue)
        try:
            qvec = _embed_text(api_key, text)
        except Exception as e:
            results.append({
                "key": key, "summary": f.get("summary", ""),
                "issuetype": issuetype,
                "status": (f.get("status") or {}).get("name", ""),
                "assignee": (f.get("assignee") or {}).get("displayName", ""),
                "similar": [], "error": str(e),
            })
            continue

        sims = [
            {
                "key": ck,
                "summary": cv.get("summary", ""),
                "score": round(_cosine_similarity(qvec, cv["vector"]) * 100, 1),
            }
            for ck, cv in cached.items()
            if cv.get("issuetype") == issuetype
        ]
        top3 = sorted(sims, key=lambda x: x["score"], reverse=True)[:3]
        results.append({
            "key": key,
            "summary": f.get("summary", ""),
            "issuetype": issuetype,
            "status": (f.get("status") or {}).get("name", ""),
            "assignee": (f.get("assignee") or {}).get("displayName", ""),
            "similar": top3,
        })

    return {"ok": True, "results": results, "total": len(results)}
