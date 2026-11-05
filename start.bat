@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

echo ========================================================
echo Starting Zigmaa CRM Enterprise Stack
echo ========================================================

echo [0/4] Freeing stale port listeners (3000, 5001, 8000)...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000,5001,8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Start-Sleep -Milliseconds 500" >nul 2>&1
if not exist "%~dp0frontend\.next\routes-manifest.json" if exist "%~dp0frontend\.next" rd /s /q "%~dp0frontend\.next" >nul 2>&1
if exist "%~dp0frontend\.next\trace" del /f /q "%~dp0frontend\.next\trace" >nul 2>&1
if exist "%~dp0frontend\.next\cache\webpack" rd /s /q "%~dp0frontend\.next\cache\webpack" >nul 2>&1

set "PYTHON_BIN=python"
if exist "%~dp0.venv\Scripts\python.exe" (
    set "PYTHON_BIN=%~dp0.venv\Scripts\python.exe"
)

echo [1/4] Running Database Seed Script...
"%PYTHON_BIN%" "%~dp0backend\seed.py"

echo [2/4] Starting FastAPI Backend on http://localhost:8000 ...
start "FastAPI Backend" cmd /k "cd /d "%~dp0" && "%PYTHON_BIN%" -m uvicorn app.main:app --app-dir backend --reload --port 8000"

echo [3/4] Starting WhatsApp QR Gateway on http://localhost:5001 ...
start "WhatsApp QR Gateway" cmd /k "cd /d "%~dp0whatsapp-bridge" && node server.js"

echo [4/4] Starting Next.js Frontend on http://localhost:3000 ...
cd /d "%~dp0frontend" && npm run dev -- -p 3000

pause
