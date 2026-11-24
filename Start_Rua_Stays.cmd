@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo This study needs Node.js 24 or later.
 pause
 exit /b 1
)
node scripts\build.mjs
if errorlevel 1 goto failed
start "" "http://127.0.0.1:4329/research"
node scripts\local.mjs --port 4329
if errorlevel 1 goto failed
exit /b 0
:failed
echo The study could not start. Check the messages above.
pause
exit /b 1
