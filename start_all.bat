@echo off
title Nike Tipsport + Flashscore Monitor + ngrok
echo.
echo ============================================
echo   Starting all services...
echo ============================================
echo.

:: 1. Start Flashscore Monitor (Python) on port 8500
echo   [1/3] Starting Flashscore Monitor (port 8500)...
start /min "FS-Monitor" cmd /c "cd /d C:\Users\Ivlik\flashscore-monitor && python dashboard.py 8500"
timeout /t 3 /nobreak >nul

:: 2. Start Nike Tipsport backend (Node) on port 3001
echo   [2/3] Starting Nike Tipsport backend (port 3001)...
cd /d "C:\Users\Ivlik\.cursor\worktrees\nike-backend-fix\fhr"
start /min "Nike-Backend" cmd /c "npm start"
timeout /t 4 /nobreak >nul

:: 3. Start ngrok tunnel on port 3001
echo   [3/3] Starting ngrok tunnel...
echo.
echo ============================================
echo   All services running!
echo   Nike Tipsport: http://localhost:3001
echo   Flashscore Monitor: http://localhost:8500
echo   Flashscore via Nike: http://localhost:3001 (tab)
echo.
echo   ngrok tunnel starting below...
echo   Copy the https://...ngrok-free.app URL
echo   and open it on your phone!
echo ============================================
echo.

"C:\Users\Ivlik\flashscore-monitor\ngrok.exe" http 3001
