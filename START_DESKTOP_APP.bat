@echo off
setlocal
REM Vzdy bezat z priečinka, kde je tento .bat (projekt)
set "PROJECT_ROOT=%~dp0"
set "PROJECT_ROOT=%PROJECT_ROOT:~0,-1%"
cd /d "%PROJECT_ROOT%"

if not exist "package.json" (
  echo Chyba: package.json sa nenasiel v: %PROJECT_ROOT%
  echo Spustaj tento subor cez zastupcu z projektu alebo z tohto priečinka.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Inštalujem závislosti...
  call npm install
  if errorlevel 1 (
    echo Inštalácia zlyhala.
    pause
    exit /b 1
  )
)

if not exist "desktop\assets\app-icon.ico" (
  call npm run desktop:icon
)

call npm run desktop
if errorlevel 1 (
  echo Aplikácia skončila s chybou.
  pause
  exit /b 1
)

endlocal
