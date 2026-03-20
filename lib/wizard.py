"""이슈 처리 마법사 — 이슈 감지 및 AI 초안 생성"""
import re
from datetime import date

from .jira import jira_get, JIRA_BASE_URL
from .gemini import api_gemini_requirements, api_gemini_review, api_gemini_test, api_gemini_procedure, api_gemini_approval, api_gemini_sr_draft
from .settings import api_read

# 변경관리 상태 → (다음 할 일 안내, 생성 가능한 초안 목록)
_CHANGE_STATUS_MAP = {
    "미해결":     ("요건정의서를 작성하고, 영향도분석 상태로 전환하세요.", ["requirements"]),
    "영향도 분석":  ("변경검토회의 내용을 작성하고, 필수 산출물 탭을 직접 입력한 후 변경계획결재 상신하세요.", ["review"]),
    "개발 중":      ("테스트케이스를 작성하세요.", ["test"]),
    "배포계획수립": ("배포결재 멘트·배포절차·원복계획을 작성하세요.", ["approval", "procedure", "rollback"]),
    "현업확인":   ("현업 확인을 진행하세요.", []),
    "배포":       ("배포를 진행하세요.", []),
    "배포완료":   ("배포가 완료되었습니다.", []),
    "긴급 배포":  ("긴급 배포 단계입니다. 테스트케이스·배포절차·원복계획을 작성하세요.", ["test", "procedure", "rollback"]),
    "완료":       ("이슈 처리가 완료되었습니다.", []),
    "반려":       ("이슈가 반려되었습니다.", []),
    "중단":       ("이슈가 중단되었습니다.", []),
}

_SR_STATUS_MAP = {
    "미해결": ("업무유형을 확인하고 처리 내용을 작성한 후 완료 전환하세요.", ["sr_draft"]),
    "처리중": ("업무유형을 확인하고 처리 내용을 작성한 후 완료 전환하세요.", ["sr_draft"]),
    "완료":   ("서비스 요청이 완료되었습니다.", []),
    "반려":   ("이슈가 반려되었습니다.", ["sr_draft"]),
    "중단":   ("이슈가 중단되었습니다.", ["sr_draft"]),
}

_SR_WORK_TYPES = ["계정/권한 처리", "데이터추출", "공통코드 단순변경", "기타"]

_DRAFT_LABEL = {
    "requirements": "요건정의서",
    "review":       "변경검토회의",
    "test":         "테스트케이스",
    "approval":     "배포결재 멘트",
    "procedure":    "배포절차",
    "rollback":     "원복계획",
    "sr_draft":     "처리 내용 초안",
}


def _detect_sr_work_type(fields: dict) -> str | None:
    """서비스요청관리 업무유형 감지 — 알려진 customfield 순서로 시도"""
    # 업무유형 후보 customfield 목록 (값이 _SR_WORK_TYPES 중 하나와 일치하면 채택)
    for cf in ("customfield_16460", "customfield_15900", "customfield_16100",
               "customfield_16200", "customfield_16300"):
        raw = fields.get(cf)
        if not raw:
            continue
        if isinstance(raw, list) and raw:
            val = raw[0].get("value", "") if isinstance(raw[0], dict) else str(raw[0])
        elif isinstance(raw, dict):
            val = raw.get("value", "")
        else:
            val = str(raw)
        if val in _SR_WORK_TYPES:
            return val
    return None


def api_wizard_detect(token: str, issue_key: str) -> dict:
    """이슈 유형/상태/다음 할 일 감지"""
    try:
        fields = ("summary,description,status,issuetype,customfield_16460,"
                  "customfield_15900,customfield_16100,customfield_16200,customfield_16300")
        url = f"{JIRA_BASE_URL}/rest/api/2/issue/{issue_key}?fields={fields}"
        data = jira_get(token, url)
    except Exception as e:
        return {"ok": False, "error": str(e)}

    f = data.get("fields", {})
    summary = f.get("summary", "")
    description = (f.get("description") or "").strip()[:600]
    issue_type = (f.get("issuetype") or {}).get("name", "")
    status = (f.get("status") or {}).get("name", "")

    work_type_vals = f.get("customfield_16460") or []
    change_type = work_type_vals[0].get("value", "") if work_type_vals else ""

    is_urgent = bool(re.search(r'[\[\(]긴급[\]\)]', summary))

    sr_work_type = _detect_sr_work_type(f) if issue_type == "서비스요청관리" else None

    def _match_status(status_map: dict, status_name: str):
        # 1) 정확히 일치
        if status_name in status_map:
            return status_map[status_name]
        # 2) 키가 status_name에 포함 (예: "영향도분석" in "영향도분석 중")
        for key, val in status_map.items():
            if key in status_name or status_name in key:
                return val
        return None

    if issue_type == "변경관리":
        matched = _match_status(_CHANGE_STATUS_MAP, status)
        next_action, available_drafts = matched or (f"현재 상태 '{status}' — 다음 단계를 확인하세요.", [])
    elif issue_type == "서비스요청관리":
        matched = _match_status(_SR_STATUS_MAP, status)
        # 완료가 아닌 미지정 상태도 초안 버튼 표시
        next_action, available_drafts = matched or (f"현재 상태 '{status}' — 처리 내용을 작성하세요.", ["sr_draft"])
    else:
        next_action = "지원되지 않는 이슈 유형입니다."
        available_drafts = []

    return {
        "ok": True,
        "key": issue_key,
        "summary": summary,
        "description": description,
        "issue_type": issue_type,
        "status": status,
        "change_type": change_type,
        "is_urgent": is_urgent,
        "sr_work_type": sr_work_type,
        "sr_work_types": _SR_WORK_TYPES,
        "next_action": next_action,
        "available_drafts": available_drafts,
        "draft_labels": {k: _DRAFT_LABEL[k] for k in available_drafts},
    }


# ── Fallback 템플릿 ──────────────────────────────────────────────────────────

def _fallback_requirements(summary: str, description: str, is_db: bool) -> str:
    row_type = "DB 데이터 변경" if is_db else "기능 수정"
    return (
        "||번호||구분||요구사항 내용||검증결과||\n"
        f"|1|{row_type}|{summary}|(직접 입력 필요)|\n"
        "|2|기능(정상)|변경 후 정상 동작 확인|(직접 입력 필요)|\n"
        "|3|기능(비정상)|오류 발생 시 처리 확인|(직접 입력 필요)|"
    )


def _fallback_review(summary: str) -> str:
    today = date.today().strftime("%Y-%m-%d")
    return (
        f"|회의일시|{today} 10:00|\n"
        "|참석자| |\n"
        "|검토결과|1. 영향범위:\n"
        f"-. {summary}\n"
        "2. 타시스템 영향도(데이터/IF 연계) 여부: 없음\n"
        "3. 영향분석결과:\n"
        " 3-1. 영향도 분석 방법\n"
        "  -. (직접 입력 필요)\n"
        " 3-2. 영향도 분석 결과\n"
        "  -. (직접 입력 필요)\n"
        "4. 변경검토회의결과\n"
        " -. 변경계획 및 영향분석 검토결과 특이사항 없음.\n"
        "5. 변경내용\n"
        " -. (직접 입력 필요)|"
    )


def _fallback_test(summary: str, is_db: bool) -> str:
    today = date.today().strftime("%Y/%m/%d")
    if is_db:
        return (
            f"○ 테스트 담당자 : (직접 입력 필요)\n"
            f"○ 테스트 일자 : {today}\n"
            f"1. 요건1) 시나리오 : {summary}\n"
            "||테스트유형||TC||테스트 항목||입력데이터\n"
            "(버튼, 아이콘 선택 등 모든 행위)||예상 결과||테스트 결과||\n"
            f"|기능(정상)|1|변경 SQL 실행|변경 대상 데이터 조회 후 SQL 스크립트 실행|변경된 값이 정상 반영됨|PASS|\n"
            f"| |2|변경 결과 검증|변경 후 데이터 재조회|예상 값과 일치함|PASS|\n"
            f"|기능(비정상)|1|원복 처리 확인|원복 SQL 실행|이전 값으로 정상 복구됨|PASS|"
        )
    return (
        f"○ 테스트 담당자 : (직접 입력 필요)\n"
        f"○ 테스트 일자 : {today}\n"
        f"1. 요건1) 시나리오 : {summary}\n"
        "||테스트유형||TC||테스트 항목||입력데이터\n"
        "(버튼, 아이콘 선택 등 모든 행위)||예상 결과||테스트 결과||\n"
        f"|기능(정상)|1|변경 후 정상 동작 확인|변경 항목 접속 및 기능 수행|오류 없이 정상 처리됨|PASS|\n"
        f"| |2|화면 반영 확인|변경 대상 화면 조회|변경 내용이 정상 표시됨|PASS|\n"
        f"| |3|데이터 정합성 확인|변경 전후 데이터 조회|변경 내용 일치|PASS|\n"
        f"|기능(비정상)|1|오류 입력 시 처리|잘못된 값 또는 경계값 입력|오류 메시지 표시 또는 정상 처리|PASS|"
    )


def _fallback_procedure(summary: str) -> str:
    return (
        f"1. 변경 내용\n"
        f"  - {summary}\n"
        "2. 배포 절차\n"
        "  - 대상 서버: (직접 입력 필요)\n"
        "  - 배포 시스템을 통한 자동 배포\n"
        "  - 2인 1조 배포 작업 (정: (직접 입력 필요) / 부: (직접 입력 필요))\n"
        "3. 배포 대상 소스:\n"
        "  [변경] (변경 소스 파일명 직접 입력 필요)\n"
        "4. 배포 전 작업:\n"
        "  - 운영 서버 소스 백업\n"
        "  - 파일 비교 및 변경 이력 확인\n"
        "5. 배포 방식:\n"
        "  - 배포 시스템을 통한 자동 배포\n"
        "  - 2인 1조 배포 작업 (정: (직접 입력 필요) / 부: (직접 입력 필요))\n"
        "6. 철회 계획\n"
        "  - 배포 후 이슈 발생 시, 배포 시스템을 통해 즉시 원복\n"
        "  - 원인 분석 후 재배포 여부 판단\n"
        "7. 배포 후 모니터링 계획\n"
        "  - 배포 후 변경 기능 정상 동작 확인\n"
        "  - 오류 로그 모니터링"
    )


def _fallback_approval(summary: str) -> str:
    return (
        f"{summary}\n\n"
        "해당 변경 사항을 운영에 반영하고자 배포 결재를 요청드립니다."
    )


def _fallback_sr_draft(work_type: str, summary: str) -> str:
    if work_type == "계정/권한 처리":
        return (
            f"- 요청내용: {summary}\n"
            "- 대상시스템: (확인 필요)\n"
            "- 대상자: (확인 필요)\n"
            "- 사번: (확인 필요)\n"
            "- 사유: (확인 필요)\n"
            "- 처리결과: (처리 완료 후 직접 입력)"
        )
    elif work_type == "데이터추출":
        return (
            "- 대상시스템: (확인 필요)\n"
            f"- 추출내용: {summary}\n"
            "- 사유: (확인 필요)\n"
            "- 개인정보포함여부: (확인 필요)\n"
            "- SQL:\n(직접 입력 필요)\n"
            "- 결과파일: (직접 입력 필요)\n"
            "- 처리결과: (처리 완료 후 직접 입력)"
        )
    elif work_type == "공통코드 단순변경":
        return (
            "- 대상시스템: (확인 필요)\n"
            f"- 작업내용: {summary}\n"
            "- 영향도: (확인 필요)\n"
            "- 작업절차(정상):\n1. \n2. \n"
            "- 작업절차(비정상):\n1. \n"
            "- 확인방안: (확인 필요)\n"
            "- 이슈대응방안: (확인 필요)\n"
            "- 처리결과: (처리 완료 후 직접 입력)"
        )
    else:
        return (
            "- 대상시스템: (확인 필요)\n"
            f"- 요청내용: {summary}\n"
            "- 요청사유: (확인 필요)\n"
            "- 기타특이사항: 없음\n"
            "- 처리결과: (처리 완료 후 직접 입력)"
        )


def _fallback_rollback() -> str:
    return (
        "1. 원복계획\n"
        "  1) 배포 전 백업한 소스로 재배포\n"
        "  2) 원복 후 정상 동작 여부 확인"
    )


# ── 메인 초안 생성 ────────────────────────────────────────────────────────────

def api_wizard_draft(
    token: str,
    issue_key: str,
    draft_type: str,
    overrides: dict = None,
    api_key: str = None,
    model: str = None,
) -> dict:
    """AI 초안 생성"""
    if not api_key or not model:
        cfg = api_read(mask_sensitive=False)
        if not cfg.get("ok"):
            return {"ok": False, "error": cfg.get("error", "설정 로드 실패")}
        env = cfg.get("env", {})
        api_key = api_key or env.get("GEMINI_API_KEY", "").strip()
        model = model or env.get("GEMINI_MODEL", "gemini-2.5-flash").strip()

    try:
        fields = "summary,description,customfield_16460,customfield_16601,customfield_17901,customfield_17903"
        url = f"{JIRA_BASE_URL}/rest/api/2/issue/{issue_key}?fields={fields}"
        data = jira_get(token, url)
    except Exception as e:
        return {"ok": False, "error": f"이슈 조회 실패: {e}"}

    f = data.get("fields", {})
    summary = f.get("summary", "")
    description = (f.get("description") or "").strip()[:600]
    work_type_vals = f.get("customfield_16460") or []
    change_type = work_type_vals[0].get("value", "") if work_type_vals else ""
    review_content = (f.get("customfield_16601") or "").strip()[:800]

    # 배포 서버 정보 (CMDB 시스템 필드 기반)
    DEPLOY_SERVER_BY_PROFILE = {
        "SINCASN-221392":      "EP(EPP) #1, #2번기 (10.102.49.91, 10.102.49.92)",
        "SINCASN-168399":      "EP(EPP) #1, #2번기 (10.102.49.91, 10.102.49.92)",
        "SINCASN-221391-PROG": "통합정보 WEB/WAS #1, #2 (10.101.49.57, 10.101.49.58)",
        "SINCASN-168428":      "통합정보 WEB/WAS #1, #2 (10.101.49.57, 10.101.49.58)",
    }
    DEPLOY_SERVER_DEFAULT = "EP(EPP) #1, #2번기 (10.102.49.91, 10.102.49.92)"
    def _extract_sincasn(vals):
        for v in vals:
            if not isinstance(v, dict):
                continue
            key = v.get("key") or v.get("value") or ""
            if key.startswith("SINCASN-"):
                return key
        return ""
    sincasn = _extract_sincasn(f.get("customfield_17901") or []) or \
              _extract_sincasn(f.get("customfield_17903") or [])
    server_info = DEPLOY_SERVER_BY_PROFILE.get(sincasn, DEPLOY_SERVER_DEFAULT)

    sr_work_type = (f.get("customfield_16460") or [{}])[0].get("value", "") if False else None
    # SR 업무유형 — overrides 우선, 없으면 자동 감지
    if overrides:
        change_type = overrides.get("change_type", change_type)
        sr_work_type = overrides.get("sr_work_type") or _detect_sr_work_type(f)
    else:
        sr_work_type = _detect_sr_work_type(f)
    is_db = "DB" in change_type.upper()

    content = None
    fallback_used = False   # AI 시도했으나 실패한 경우만 True

    if draft_type == "requirements":
        result = api_gemini_requirements(summary, description, change_type, api_key, model)
        if result.get("ok"):
            content = result["content"]
        else:
            content = _fallback_requirements(summary, description, is_db)
            fallback_used = True

    elif draft_type == "review":
        result = api_gemini_review(summary, description, change_type, api_key, model)
        if result.get("ok"):
            content = result["content"]
        else:
            content = _fallback_review(summary)
            fallback_used = True

    elif draft_type == "test":
        result = api_gemini_test(summary, review_content, change_type, api_key, model)
        if result.get("ok"):
            content = result["content"]
        else:
            content = _fallback_test(summary, is_db)
            fallback_used = True

    elif draft_type == "procedure":
        result = api_gemini_procedure(summary, change_type, server_info, api_key, model)
        if result.get("ok"):
            content = result["content"]
        else:
            content = _fallback_procedure(summary)
            fallback_used = True

    elif draft_type == "approval":
        result = api_gemini_approval(summary, description, change_type, api_key, model)
        if result.get("ok"):
            content = result["content"]
        else:
            content = _fallback_approval(summary)
            fallback_used = True

    elif draft_type == "rollback":
        content = _fallback_rollback()

    elif draft_type == "sr_draft":
        work_type = sr_work_type or "기타"
        result = api_gemini_sr_draft(work_type, summary, description, api_key, model)
        if result.get("ok"):
            content = result["content"]
        else:
            content = _fallback_sr_draft(work_type, summary)
            fallback_used = True

    else:
        return {"ok": False, "error": f"지원되지 않는 초안 유형: {draft_type}"}

    return {
        "ok": True,
        "draft_type": draft_type,
        "label": _DRAFT_LABEL.get(draft_type, draft_type),
        "content": content,
        "fallback": fallback_used,
    }
