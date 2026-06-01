@echo off
chcp 65001 >nul
setlocal

echo ============================================
echo  YouTube Karaoke - first-time install
echo ============================================
echo.

echo [1/3] Installing yt-dlp via winget...
winget install --id yt-dlp.yt-dlp -e --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
  echo.
  echo yt-dlp install may have failed. If you already have it, continue.
  echo.
)

echo.
echo [2/3] Installing ffmpeg via winget...
winget install --id Gyan.FFmpeg -e --accept-source-agreements --accept-package-agreements
if errorlevel 1 (
  echo.
  echo ffmpeg install may have failed. If you already have it, continue.
  echo.
)

echo.
echo [3/3] Installing npm dependencies...
call npm install
if errorlevel 1 (
  echo.
  echo npm install failed. See the error above.
  pause
  exit /b 1
)

echo.
echo ============================================
echo  Done. Now double-click start.bat to run.
echo ============================================
pause
