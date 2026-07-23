@echo off
setlocal EnableExtensions
cd /d "%~dp0"

if not exist "node_modules\@tauri-apps\cli\tauri.js" (
  echo [error] @tauri-apps/cli not found. Run install.bat first.
  exit /b 1
)

if not exist "scripts\tauri-dev.ps1" (
  echo [error] scripts\tauri-dev.ps1 not found.
  exit /b 1
)

echo.
echo  Opening a new console for tauri dev.
echo  In that window: close the app or press Ctrl+C to stop.
echo  ^(No Y/N batch prompt^)
echo.

rem Exit this .bat immediately. Long-running work happens in PowerShell
rem so Ctrl+C does not trigger "Terminate batch job (Y/N)?".
start "Server Manager Dev" /D "%CD%" powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\tauri-dev.ps1"

endlocal
exit /b 0
