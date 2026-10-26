@echo off
rem Turns off the public https address (Tailscale Funnel). The app keeps running on this PC.
set "TS=tailscale"
where tailscale >nul 2>nul || set "TS=%ProgramFiles%\Tailscale\tailscale.exe"
"%TS%" funnel reset
echo Phone access is off. Market Radar still works on this PC at http://localhost:8080
pause
