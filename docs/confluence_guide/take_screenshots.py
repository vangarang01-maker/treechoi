"""
스벅 Jira 도우미 - Confluence 가이드 스크린샷 자동 캡처 스크립트
실행: python take_screenshots.py
"""
import asyncio
import os
from pathlib import Path

OUT_DIR = Path(__file__).parent / "screenshots"
OUT_DIR.mkdir(exist_ok=True)

BASE_URL = "http://localhost:8765"

try:
    from pyppeteer import launch
    USE_PYPPETEER = True
except ImportError:
    USE_PYPPETEER = False

async def capture():
    browser = await launch(
        headless=True,
        args=["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1400,900"]
    )
    page = await browser.newPage()
    await page.setViewport({"width": 1400, "height": 900})

    pages = [
        ("01_홈_안내데스크", "gemini", None),
        ("02_환경설정", "settings", None),
        ("03_Jira테스트", "chat", None),
        ("04_유사이슈검색", "similar", ".collapsible-header"),
        ("05_처리마법사", "wizard", None),
    ]

    for filename, page_key, click_sel in pages:
        await page.goto(BASE_URL)
        await page.waitForTimeout(500)
        # 해당 탭으로 이동
        await page.evaluate(f"switchPage('{page_key}', document.querySelector('[data-page=\"{page_key}\"]'))")
        await page.waitForTimeout(400)
        if click_sel:
            await page.click(click_sel)
            await page.waitForTimeout(300)
        out = OUT_DIR / f"{filename}.png"
        await page.screenshot({"path": str(out), "fullPage": False})
        print(f"  저장: {out}")

    # 라이트 모드
    await page.goto(BASE_URL)
    await page.waitForTimeout(500)
    await page.evaluate("switchPage('wizard', document.querySelector('[data-page=\"wizard\"]'))")
    await page.click("#theme-toggle-btn")
    await page.waitForTimeout(300)
    out = OUT_DIR / "06_라이트모드.png"
    await page.screenshot({"path": str(out), "fullPage": False})
    print(f"  저장: {out}")

    await browser.close()
    print("완료!")

if USE_PYPPETEER:
    asyncio.get_event_loop().run_until_complete(capture())
else:
    print("pyppeteer not installed. pip install pyppeteer")
