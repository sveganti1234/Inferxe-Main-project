@echo off
rem Starts the Inferxe website locally and opens it in your browser.
cd /d "%~dp0"
if not exist frontend\node_modules (
  if not exist node_modules (
    echo Installing frontend dependencies - first run only...
    call npm --prefix frontend install
  )
)
start "" "http://127.0.0.1:5173"
call npm run dev
