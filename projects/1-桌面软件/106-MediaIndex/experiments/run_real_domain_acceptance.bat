@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

if not exist ".venv\Scripts\python.exe" (
  echo ERROR: Run install_acceptance_env.bat first.
  pause
  exit /b 1
)

set "ROOT=%~1"
if "%ROOT%"=="" set "ROOT=%CD%\MediaIndex-Acceptance"

if not exist "%ROOT%\Library\Images" (
  echo ERROR: Missing %ROOT%\Library\Images
  pause
  exit /b 1
)
if not exist "%ROOT%\Library\Videos" (
  echo ERROR: Missing %ROOT%\Library\Videos
  pause
  exit /b 1
)
if not exist "%ROOT%\image_manifest.csv" (
  echo ERROR: Missing %ROOT%\image_manifest.csv
  pause
  exit /b 1
)
if not exist "%ROOT%\video_manifest.csv" (
  echo ERROR: Missing %ROOT%\video_manifest.csv
  pause
  exit /b 1
)

echo ============================================================
echo MediaIndex P106 - Real-domain Acceptance
echo ============================================================
echo Workspace: %ROOT%
echo.

".venv\Scripts\python.exe" "a004_real_image_acceptance_runner.py" ^
  --library "%ROOT%\Library\Images" ^
  --manifest "%ROOT%\image_manifest.csv" ^
  --output "%ROOT%\a004_results.json"
if errorlevel 1 goto failed

".venv\Scripts\python.exe" "v011_real_video_acceptance_runner.py" ^
  --library "%ROOT%\Library\Videos" ^
  --manifest "%ROOT%\video_manifest.csv" ^
  --output "%ROOT%\v011_results.json"
if errorlevel 1 goto failed

".venv\Scripts\python.exe" "acceptance_summary.py" ^
  --image "%ROOT%\a004_results.json" ^
  --video "%ROOT%\v011_results.json" ^
  --output "%ROOT%\real_domain_summary.json"
if errorlevel 1 goto failed

echo.
echo Completed.
echo Upload only these result JSON files if you want ChatGPT to analyze them:
echo   %ROOT%\a004_results.json
echo   %ROOT%\v011_results.json
echo   %ROOT%\real_domain_summary.json
echo.
echo Do NOT upload the private media unless you intentionally choose to.
pause
exit /b 0

:failed
echo.
echo ERROR: Acceptance run failed. Check the console output above.
pause
exit /b 1
