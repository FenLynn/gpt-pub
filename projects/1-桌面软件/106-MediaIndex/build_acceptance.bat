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
echo.
echo Build finished successfully.
pause
