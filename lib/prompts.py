"""프롬프트 파일 로더 — prompts/*.txt 에서 프롬프트를 읽고 변수를 치환합니다.

변수 치환 방식: {variable_name} 형식 (kwargs에 있는 키만 치환, 나머지 중괄호는 그대로)
"""
from pathlib import Path

PROMPTS_DIR = Path(__file__).parent.parent / "prompts"


def load_prompt(name: str, **kwargs) -> str:
    """prompts/{name}.txt 읽어 kwargs 변수 치환 후 반환.

    파일이 없으면 FileNotFoundError 발생 — 호출측에서 fallback 처리.
    kwargs에 없는 {...} 패턴은 치환하지 않으므로 JSON 예시 등에 안전.
    """
    path = PROMPTS_DIR / f"{name}.txt"
    template = path.read_text(encoding="utf-8")
    for key, val in kwargs.items():
        template = template.replace("{" + key + "}", str(val))
    return template
