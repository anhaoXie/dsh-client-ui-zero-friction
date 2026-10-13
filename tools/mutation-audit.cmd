@echo off
rem Wrapper: bypass the PowerShell execution policy (unsigned .ps1 files are blocked).
rem Runs the mutation audit: revert each fix, confirm the guard test goes red.
setlocal
set "PS=powershell"
where pwsh >nul 2>nul && set "PS=pwsh"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0mutation-audit.ps1" %*
exit /b %errorlevel%
