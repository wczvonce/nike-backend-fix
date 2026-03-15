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

echo Building Windows installer...
call npm run desktop:build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

echo.
echo Done. Installer is in dist-desktop folder.
pause
endlocal
