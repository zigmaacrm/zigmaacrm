@echo off
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

echo ========================================================
echo Starting Zigmaa CRM Enterprise Stack
echo ========================================================

set "PYTHON_BIN=python"
if exist "%~dp0.venv\Scripts\python.exe" (
    set "PYTHON_BIN=%~dp0.venv\Scripts\python.exe"
)

echo [1/3] Running Database Seed Script...
"%PYTHON_BIN%" "%~dp0backend\seed.py"

echo [2/3] Starting FastAPI Backend on http://localhost:8000 ...
start "FastAPI Backend" cmd /k "cd /d "%~dp0" && "%PYTHON_BIN%" -m uvicorn app.main:app --app-dir backend --reload --port 8000"

echo [3/3] Starting Next.js Frontend on http://localhost:3000 ...
npm run dev --prefix frontend -- -p 3000

pause
