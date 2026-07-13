"""helper: 최신 puppeteer screenshot tool-result 파일에서 PNG 추출"""
import json, base64, re, sys
from pathlib import Path

def save_latest(tool_result_path: str, out_path: str):
    with open(tool_result_path, encoding='utf-8') as f:
        data = json.load(f)
    # base64 data URI 찾기
    for item in data:
        text = item.get('text', '')
        match = re.search(r'base64,([A-Za-z0-9+/=]+)', text)
        if match:
            img_data = base64.b64decode(match.group(1))
            Path(out_path).parent.mkdir(parents=True, exist_ok=True)
            with open(out_path, 'wb') as f:
                f.write(img_data)
            print(f"저장: {out_path} ({len(img_data):,} bytes)")
            return True
    print("base64 not found")
    return False

if __name__ == '__main__':
    save_latest(sys.argv[1], sys.argv[2])
