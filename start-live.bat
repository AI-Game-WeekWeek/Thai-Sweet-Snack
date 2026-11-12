@echo off
rem Starts the game bridge for a live stream. ASCII only on purpose: cmd misreads UTF-8 batch files.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 goto nonode
if not exist node_modules call npm.cmd install
if exist dist rmdir /s /q dist
call npm.cmd run live
echo.
echo The bridge stopped. Read the messages above.
pause
goto :eof
:nonode
echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this file again.
pause
