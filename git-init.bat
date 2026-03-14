@echo off
chcp 65001 > nul
cd /d "%~dp0"
echo === git init ===
git init
echo.
echo === remote add ===
git remote add origin https://github.com/vangarang01-maker/treechoi.git
echo.
echo === git add ===
git add .
echo.
echo === git commit ===
git commit -m "Initial commit: sbe-jira-ui"
echo.
echo === git push ===
git branch -M main
git push -u origin main
echo.
echo === 완료 ===
pause
