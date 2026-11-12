@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul || (echo ยังไม่มี Node.js: ติดตั้งจาก https://nodejs.org (เลือก LTS) แล้วเปิดไฟล์นี้ใหม่ & pause & exit /b 1)
if not exist node_modules (echo กำลังติดตั้งครั้งแรก รอสักครู่... & call npm install)
call npm run live
pause
