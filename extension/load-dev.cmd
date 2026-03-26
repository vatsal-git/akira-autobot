@echo off
setlocal EnableExtensions
REM Loads this folder as an unpacked extension in a dedicated Chrome profile.
REM Use this if chrome://extensions "Load unpacked" does not open a folder dialog.

set "EXT_DIR=%~dp0"
if "%EXT_DIR:~-1%"=="\" set "EXT_DIR=%EXT_DIR:~0,-1%"

set "PROFILE=%TEMP%\chrome-akira-ext-dev"

set "BROWSER="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
  set "BROWSER=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
  set "BROWSER=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
)
if "%BROWSER%"=="" if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
  set "BROWSER=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
)
if "%BROWSER%"=="" if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
  set "BROWSER=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
)

if "%BROWSER%"=="" (
  echo Could not find Chrome or Edge. Install one of them, or edit load-dev.cmd to set BROWSER to your browser exe.
  pause
  exit /b 1
)

echo Starting browser with unpacked extension:
echo   %EXT_DIR%
echo Profile (safe to delete): %PROFILE%
echo.

start "" "%BROWSER%" --user-data-dir="%PROFILE%" --load-extension="%EXT_DIR%"
