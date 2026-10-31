#!/bin/bash
export PYTHONUTF8=1
export PYTHONIOENCODING=utf-8

echo "========================================================"
echo "Starting Zigmaa CRM Enterprise Stack"
echo "========================================================"

PYTHON_BIN="python"
if [ -f "./.venv/bin/python" ]; then
    PYTHON_BIN="./.venv/bin/python"
elif [ -f "./.venv/Scripts/python.exe" ]; then
    PYTHON_BIN="./.venv/Scripts/python.exe"
fi

echo "[1/3] Running Database Seed Script..."
"$PYTHON_BIN" backend/seed.py

echo "[2/3] Starting FastAPI Backend on http://localhost:8000 ..."
"$PYTHON_BIN" -m uvicorn app.main:app --app-dir backend --reload --port 8000 &

echo "[3/3] Starting Next.js Frontend on http://localhost:3000 ..."
npm run dev --prefix frontend
