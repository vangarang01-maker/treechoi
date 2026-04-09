"""AI 라우터 — AI_PROVIDER 환경변수 기반으로 Gemini 또는 DevX AI로 라우팅"""
import os

from .gemini import (
    api_gemini_requirements, api_gemini_review, api_gemini_test,
    api_gemini_procedure, api_gemini_approval, api_gemini_sr_draft,
    api_gemini_safe_query, api_gemini_check,
)
from .devx_ai import (
    api_devx_requirements, api_devx_review, api_devx_test,
    api_devx_procedure, api_devx_approval, api_devx_sr_draft,
    api_devx_safe_query, api_devx_check,
)


def get_provider() -> str:
    """현재 AI 제공자 반환. os.environ 우선, 없으면 설정 파일 폴백. 기본값: gemini"""
    v = os.environ.get("AI_PROVIDER", "").strip().lower()
    if v:
        return v
    try:
        from .settings import api_read
        cfg = api_read(mask_sensitive=False)
        if cfg.get("ok"):
            return cfg.get("env", {}).get("AI_PROVIDER", "gemini").lower()
    except Exception:
        pass
    return "gemini"


def api_requirements(summary, description, change_type, api_key=None, model=None, **kwargs):
    if get_provider() == "devx":
        return api_devx_requirements(summary, description, change_type)
    return api_gemini_requirements(summary, description, change_type, api_key, model)


def api_review(summary, description, change_type, api_key=None, model=None, **kwargs):
    if get_provider() == "devx":
        return api_devx_review(summary, description, change_type)
    return api_gemini_review(summary, description, change_type, api_key, model)


def api_test(summary, review_content, change_type, api_key=None, model=None, **kwargs):
    if get_provider() == "devx":
        return api_devx_test(summary, review_content, change_type)
    return api_gemini_test(summary, review_content, change_type, api_key, model)


def api_procedure(summary, change_type, server_info, api_key=None, model=None, **kwargs):
    if get_provider() == "devx":
        return api_devx_procedure(summary, change_type, server_info)
    return api_gemini_procedure(summary, change_type, server_info, api_key, model)


def api_approval(summary, description, change_type, api_key=None, model=None, **kwargs):
    if get_provider() == "devx":
        return api_devx_approval(summary, description, change_type)
    return api_gemini_approval(summary, description, change_type, api_key, model)


def api_safe_query(summary, description, dml_query="", api_key=None, model=None, **kwargs):
    if get_provider() == "devx":
        return api_devx_safe_query(summary, description, dml_query, api_key=api_key)
    return api_gemini_safe_query(summary, description, dml_query, api_key, model)


def api_sr_draft(work_type, summary, description, api_key=None, model=None, **kwargs):
    if get_provider() == "devx":
        return api_devx_sr_draft(work_type, summary, description)
    return api_gemini_sr_draft(work_type, summary, description, api_key, model)


def api_ai_check(api_key=None, model=None):
    """현재 제공자의 API 상태 확인"""
    if get_provider() == "devx":
        return api_devx_check(api_key)
    return api_gemini_check(api_key, model)
