@echo off
rem Wrapper: bypass the PowerShell execution policy (unsigned .ps1 files are blocked).
rem Prefer pwsh (PowerShell 7) when present; fall back to Windows PowerShell.
rem Usage: uninstall.cmd   [-RemoveNodeModules] [-ProfileDir <path>]
setlocal
set "PS=powershell"
where pwsh >nul 2>nul && set "PS=pwsh"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
exit /b %errorlevel%
