@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

set "ROOT=%~1"
if "%ROOT%"=="" set "ROOT=%CD%\MediaIndex-Acceptance"

mkdir "%ROOT%\Library\Images" 2>nul
mkdir "%ROOT%\Library\Videos" 2>nul
mkdir "%ROOT%\Query\Images" 2>nul
mkdir "%ROOT%\Query\Videos" 2>nul

if not exist "%ROOT%\image_manifest.csv" copy /y "image_manifest_template.csv" "%ROOT%\image_manifest.csv" >nul
if not exist "%ROOT%\video_manifest.csv" copy /y "video_manifest_template.csv" "%ROOT%\video_manifest.csv" >nul

echo.
echo Created acceptance workspace:
echo %ROOT%
echo.
echo Put private media only inside this local workspace.
echo Do NOT commit the workspace to GitHub.
pause
