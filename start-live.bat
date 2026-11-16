@echo off
rem Starts the game bridge for a live stream. ASCII only on purpose: cmd misreads UTF-8 batch files.
rem Double-click this file in the game folder: it always works in ITS OWN folder, so the right copy runs.
cd /d "%~dp0"
echo Folder: %CD%
where node >nul 2>nul
if errorlevel 1 goto nonode
rem When this folder is a git clone, fetch the latest version first (skipped quietly otherwise).
where git >nul 2>nul
if errorlevel 1 goto noupdate
if not exist .git goto noupdate
echo Updating from GitHub...
git pull --ff-only
echo Version:
git log --oneline -1
:noupdate
call npm.cmd install
rem live.ts rebuilds the game every time
call npm.cmd run live
echo.
echo The bridge stopped. Read the messages above.
pause
goto :eof
:nonode
echo Node.js is not installed. Install the LTS version from https://nodejs.org and run this file again.
pause
