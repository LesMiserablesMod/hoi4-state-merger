@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js/npm not found. Install Node.js 20 or newer first.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

start "HOI4 State Merger Server" cmd /k "cd /d ""%~dp0"" && npm run dev"
timeout /t 2 /nobreak >nul
start "" "http://localhost:5173"
endlocal
