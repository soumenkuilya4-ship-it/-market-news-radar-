# Setting Market Radar up on Windows 11 + Android (from scratch)

Give these to the user one step at a time and wait for confirmation.

## 1. Install tools
- Node.js LTS from https://nodejs.org (defaults), Git from https://git-scm.com.
- Reopen PowerShell after installing.

## 2. Download the app
```powershell
cd C:\Users\soume\OneDrive\Desktop
git clone -b claude/keen-ramanujan-cp0lib https://github.com/soumenkuilya4-ship-it/-market-news-radar-.git market-radar
cd market-radar
npm.cmd install
```
Use `npm.cmd`, not `npm`: PowerShell blocks `npm.ps1` by default ("running scripts is disabled").
(Optional permanent fix, typed by hand, no space after dashes:
`Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`.)

## 3. Start automatically (no terminal)
Double-click `windows\Install autostart.cmd`. It adds a hidden login-startup shortcut and a Desktop
"Market Radar" shortcut, starts the app, and opens it. Undo: `windows\Remove autostart.cmd`
(also stops the app). Logs: `data\server.log`.

## 4. Install as an app
Chrome on http://localhost:8080 → ⋮ → Cast, save and share → Install page as app (or the app's
Settings → Data → Install app). Turn on **Enable Breaking News Alerts** and click Allow.

## 5. Phone access (Tailscale Funnel, free)
1. Install Tailscale for Windows, sign in (Google).
2. Double-click `windows\Enable phone access.cmd`; open any link it shows and click Enable.
   It prints `https://<pc-name>.<tailnet>.ts.net` — permanent, survives restarts.
3. Check: `tailscale funnel status` → `(Funnel on)` and `proxy http://127.0.0.1:8080`.
4. Brand-new addresses can take ~10 minutes to resolve; some ISPs/routers (Jio/Airtel broadband)
   lag longer — mobile data or Chrome "Use secure DNS → Google" helps.
Turn off: `windows\Disable phone access.cmd` (`tailscale funnel reset`).

## 6. Android
Chrome → the .ts.net address → ⋮ → Add to Home screen → open → Enable Breaking News Alerts → Allow.
Alerts arrive with the app closed as long as the PC is on. To post from the phone, enter the
**Phone access code** (PC: Settings → Data) once.

## 7. Google Sheets (MASTER SHEET)
1. Extensions → Apps Script → paste `sheets/NewsRadar.gs` (open in Notepad) replacing everything.
2. Set `MARKET_RADAR_URL` to the .ts.net address. Optional `MARKET_RADAR_CODE` = access code
   (includes his manual posts in the radar).
3. Run `updateNewsRadar` (allow permissions), then `installTrigger` (every 15 min). If triggers via
   ScriptApp fail (Advanced Protection), add by hand: clock icon → Add Trigger → updateNewsRadar →
   Time-driven → Minutes timer → Every 15 minutes.
4. `News_Live!M1` shows last update time or why it failed (usually PC off).
The tab-9 formulas (D5:H80) were already changed to: News_Live first, else the original Tab 4 logic.

## 8. Account hygiene to recommend
2-Step Verification on Google (Tailscale + Sheets), GitHub, and broker (TOTP). Keep Windows and Node
updated (`winget upgrade OpenJS.NodeJS.LTS`). Consider making the GitHub repo private (Settings →
Danger Zone) — it's public and contains his stock universe list.
