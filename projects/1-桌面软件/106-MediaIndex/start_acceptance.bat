@echo off
setlocal
cd /d "%~dp0"
set "APP=%~dp0dist\MediaIndex-Acceptance-v0.0.2-win-x64\MediaIndex Acceptance.exe"
if exist "%APP%" (
  start "" "%APP%"
  exit /b 0
)
call "%~dp0build_acceptance.bat"
