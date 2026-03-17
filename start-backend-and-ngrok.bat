@echo off
setlocal
title Nike Backend + ngrok Launcher
cd /d "%~dp0"

set "PORT=3201"
if exist ".env" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env") do (
    if /i "%%~A"=="PORT" set "PORT=%%~B"
    if /i "%%~A"=="NGROK_AUTHTOKEN" set "NGROK_TOKEN=%%~B"
  )
)

if not defined NGROK_TOKEN set "NGROK_TOKEN=3B0BIlunMwZziqFqOqK8tiSdFIQ_73YevcY7gZ3gU5eJG3eCb"

echo Starting backend on port %PORT%...
start "Nike Backend" powershell -NoExit -Command "Set-Location '%~dp0'; npm start"
timeout /t 2 /nobreak >nul

echo Cleaning old ngrok process (if running)...
powershell -NoProfile -Command "Get-Process ngrok -ErrorAction SilentlyContinue | Stop-Process -Force"
timeout /t 1 /nobreak >nul

echo Starting ngrok tunnel for port %PORT%...
start "ngrok" powershell -NoExit -Command "Set-Location '%~dp0'; npx ngrok http %PORT% --authtoken '%NGROK_TOKEN%'"

echo Opened 2 windows: Backend and ngrok.
echo Copy the https URL from ngrok window into mobile app (Backend URL).
pause
endlocal
