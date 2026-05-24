@echo off
setlocal
cd /d "%~dp0"

echo Building Project Env Launcher frontend...
call npm.cmd run build
if errorlevel 1 (
  echo.
  echo Build failed. Press any key to close.
  pause >nul
  exit /b 1
)

echo.
echo Starting Project Env Launcher at http://127.0.0.1:3001
start "Project Env Launcher Server" /min cmd /d /s /c "cd /d ""%~dp0"" && npm.cmd run start"

echo Waiting for service...
for /l %%i in (1,1,60) do (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3001/api/health' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } } catch { exit 1 }"
  if not errorlevel 1 goto ready
  timeout /t 1 /nobreak >nul
)

echo.
echo Service did not start within 60 seconds. Press any key to close.
pause >nul
exit /b 1

:ready
start "" "http://127.0.0.1:3001"
echo Project Env Launcher is running at http://127.0.0.1:3001
