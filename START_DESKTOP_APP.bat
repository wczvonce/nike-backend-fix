@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

if not exist "desktop\assets\app-icon.ico" (
  call npm run desktop:icon
)

call npm run desktop
if errorlevel 1 (
  echo Desktop app exited with error.
  pause
  exit /b 1
)

endlocal
