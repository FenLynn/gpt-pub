@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

where python >nul 2>&1 && goto use_python
where py >nul 2>&1 && goto use_py

echo ERROR: Python 3 was not found.
echo Install Python 3.12 or newer and enable Add Python to PATH.
pause
exit /b 1

:use_python
set "PY_CMD=python"
goto create_env

:use_py
set "PY_CMD=py -3"
goto create_env

:create_env
if not exist ".venv\Scripts\python.exe" (
  %PY_CMD% -m venv ".venv"
  if errorlevel 1 goto failed
)

".venv\Scripts\python.exe" -m pip install --upgrade pip
if errorlevel 1 goto failed
".venv\Scripts\python.exe" -m pip install opencv-python numpy pillow pillow-heif
if errorlevel 1 goto failed

echo.
echo Acceptance environment is ready.
pause
exit /b 0

:failed
echo.
echo ERROR: Environment setup failed.
pause
exit /b 1
