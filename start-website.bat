@echo off
rem Starts the Inferxe website and backend API locally and opens it in your browser.
cd /d "%~dp0"

echo [Inferxe] Checking Backend API on port 8000...
netstat -ano | findstr /R /C:":8000 " >nul 2>&1
if %ERRORLEVEL% neq 0 (
  where python >nul 2>&1
  if %ERRORLEVEL% equ 0 (
    echo [Inferxe] Starting Backend API Server (FastAPI + PostgreSQL)...
    start "Inferxe Backend API (Port 8000)" cmd /c "set PYTHONPATH=.&& python -m uvicorn backend.notifications.main:app --host 127.0.0.1 --port 8000"
  ) else (
    echo [Inferxe] Warning: Python not found in PATH. Backend API not auto-started.
  )
) else (
  echo [Inferxe] Backend API is already running on port 8000.
)

if not exist frontend\node_modules (
  if not exist node_modules (
    echo [Inferxe] Installing frontend dependencies - first run only...
    call npm --prefix frontend install
  )
)

echo [Inferxe] Opening browser to http://127.0.0.1:5173...
start "" "http://127.0.0.1:5173"

echo [Inferxe] Starting Frontend Dev Server on port 5173...
call npm run dev
