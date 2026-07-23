@echo off
setlocal EnableExtensions
cd /d "%~dp0"

rem `call` is required so control returns to this script after npm.cmd.
call npm.cmd install
set "EXITCODE=%ERRORLEVEL%"

echo.
if not "%EXITCODE%"=="0" (
  echo npm install failed with exit code %EXITCODE%.
) else (
  echo npm install completed.
)
endlocal & exit /b %EXITCODE%
