@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build\BuildAcceptancePortable.ps1"
if errorlevel 1 (
  echo.
  echo BUILD FAILED. See the message above.
  pause
  exit /b 1
)
set "APP=%~dp0dist\MediaIndex-Acceptance-v0.0.1-win-x64\MediaIndex Acceptance.exe"
if exist "%APP%" (
  start "" "%APP%"
  exit /b 0
)
echo.
echo Build finished, but the app was not found at the expected path.
pause
