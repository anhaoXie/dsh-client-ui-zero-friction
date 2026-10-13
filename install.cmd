@echo off
rem Wrapper: bypass the PowerShell execution policy (unsigned .ps1 files are blocked).
rem Prefer pwsh (PowerShell 7) when present; fall back to Windows PowerShell.
rem Usage: install.cmd   [extra args are forwarded to install.ps1]
setlocal
set "PS=powershell"
where pwsh >nul 2>nul && set "PS=pwsh"
"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
exit /b %errorlevel%
