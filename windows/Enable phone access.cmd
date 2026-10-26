@echo off
setlocal
rem Gives Market Radar a permanent https:// address with Tailscale Funnel (free),
rem so your Android phone and Google Sheets can reach it while this PC is on.
set "TS=tailscale"
where tailscale >nul 2>nul
if errorlevel 1 (
  if exist "%ProgramFiles%\Tailscale\tailscale.exe" (
    set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
  ) else (
    echo Tailscale is not installed yet.
    echo 1. Install it from the page that is opening now.
    echo 2. Sign in ^(a Google account is fine^).
    echo 3. Run this file again.
    start "" https://tailscale.com/download/windows
    pause
    exit /b 1
  )
)

echo Turning on the public https address for Market Radar...
echo If a link appears below, open it, click "Enable", then come back here.
echo.
"%TS%" funnel --bg 8080
if errorlevel 1 (
  echo.
  echo Could not turn it on. Make sure you are signed in to Tailscale and try again.
  pause
  exit /b 1
)
echo.
echo ================================================================
"%TS%" funnel status
echo ================================================================
echo.
echo Your Market Radar address is the https://....ts.net line above.
echo  - On your phone: open it in Chrome, then menu ^> Add to Home screen.
echo  - In Google Sheets: paste it into MARKET_RADAR_URL in the script.
echo It stays on after restarts. Run "Disable phone access.cmd" to turn it off.
pause
