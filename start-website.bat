@echo off
rem Starts all Inferxe backend services and frontend dev server locally, then opens the browser.
cd /d "%~dp0"

if not exist node_modules (
  if not exist frontend\node_modules (
    echo [Inferxe] Installing Node dependencies - first run only...
    call npm install
  )
)

echo [Inferxe] Checking Backend Services on ports 8000 and 8001...
netstat -ano | findstr /R /C:":8000 " >nul 2>&1
set PORT8000_CHECK=%ERRORLEVEL%
netstat -ano | findstr /R /C:":8001 " >nul 2>&1
set PORT8001_CHECK=%ERRORLEVEL%

if %PORT8000_CHECK% neq 0 (
  set NEED_BACKEND=1
) else if %PORT8001_CHECK% neq 0 (
  set NEED_BACKEND=1
) else (
  set NEED_BACKEND=0
)

if %NEED_BACKEND% equ 1 (
  where node >nul 2>&1
  if %ERRORLEVEL% equ 0 (
    echo [Inferxe] Starting Unified Backend Launcher ^(Ports 8000 & 8001^)...
    start "Inferxe Backend Services (8000 & 8001)" cmd /c "npm run dev:backend"
    timeout /t 4 /nobreak >nul
  ) else (
    echo [Inferxe] Warning: Node.js not found in PATH. Backend services not auto-started.
  )
) else (
  echo [Inferxe] Backend services are already running on ports 8000 and 8001.
)

echo [Inferxe] Opening browser to http://127.0.0.1:5173...
start "" "http://127.0.0.1:5173"

echo [Inferxe] Starting Frontend Dev Server on port 5173...
call npm run dev
