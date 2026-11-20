@echo off
rem Starts all Inferxe backend services and the frontend dev server locally, then opens the browser.
rem "npm run dev" already starts the backend launcher (ports 8000 and 8001), which reuses services
rem that are already running and healthy, so the backend is not started separately here.
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [Inferxe] Node.js was not found in PATH. Install Node.js, then run this script again.
  exit /b 1
)

rem The root install covers the frontend workspace. backend\package.json (auth server: dotenv,
rem Cognito SDK) is not a workspace, so it is installed separately.
if not exist node_modules (
  echo [Inferxe] Installing Node dependencies - first run only...
  call npm install
  if errorlevel 1 exit /b 1
)
if not exist backend\node_modules (
  echo [Inferxe] Installing backend Node dependencies - first run only...
  call npm --prefix backend install
  if errorlevel 1 exit /b 1
)

echo [Inferxe] Checking Backend Services on ports 8002 and 8001...
netstat -ano | findstr /R /C:":8002 " >nul 2>&1
set PORT8002_CHECK=%ERRORLEVEL%
netstat -ano | findstr /R /C:":8001 " >nul 2>&1
set PORT8001_CHECK=%ERRORLEVEL%

if %PORT8002_CHECK% neq 0 (
  set NEED_BACKEND=1
) else if %PORT8001_CHECK% neq 0 (
  set NEED_BACKEND=1
) else (
  set NEED_BACKEND=0
)

if %NEED_BACKEND% equ 1 (
  where node >nul 2>&1
  if %ERRORLEVEL% equ 0 (
    echo [Inferxe] Starting Unified Backend Launcher ^(Ports 8002 & 8001^)...
    start "Inferxe Backend Services (8002 & 8001)" cmd /c "npm run dev:backend"
    timeout /t 4 /nobreak >nul
  ) else (
    echo [Inferxe] Warning: Node.js not found in PATH. Backend services not auto-started.
  )
) else (
  echo [Inferxe] Backend services are already running on ports 8002 and 8001.
)

echo [Inferxe] Opening browser to http://127.0.0.1:5173...
start "" "http://127.0.0.1:5173"

echo [Inferxe] Starting Frontend Dev Server on port 5173...
call npm run dev
