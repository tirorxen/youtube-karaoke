@echo off
chcp 65001 >nul
setlocal

echo Starting YouTube Karaoke...
echo Front-end: http://localhost:5173/
echo Back-end : http://localhost:5174/
echo.
echo Press Ctrl+C in this window to stop both.
echo.

start "" http://localhost:5173/
call npm start
pause
