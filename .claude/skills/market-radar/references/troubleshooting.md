# Troubleshooting log (problems already seen, with fixes)

| Symptom | Cause | Fix |
|---|---|---|
| Browser: "localhost refused to connect" | App not running on the PC (it ran only in Claude's sandbox) | Start it: autostart shortcut, or `npm.cmd start` in the folder |
| `npm : File …npm.ps1 cannot be loaded because running scripts is disabled` | PowerShell execution policy | Use `npm.cmd install` / `npm.cmd start` |
| `Set-ExecutionPolicy : …'Scope' is specified more than once` | Command pasted twice on one line | Type it by hand once |
| `Cannot convert value "-"…` | Space after a dash (`- ExecutionPolicy`) | No spaces after dashes, or skip and use npm.cmd |
| "Terminate batch job (Y/N)?" | Ctrl+C on the running app | Type Y |
| User asks "where is the download" | Didn't realise `git pull` updates the folder | Explain git pull downloads into the existing folder; ZIP link as backup |
| New feature missing in Settings after update | (1) didn't pull / old process still running; (2) old service worker served cached page | Remove autostart → git pull → Install autostart → Ctrl+Shift+R. (Network-first SW since commit 29b3ca0 prevents this going forward.) |
| Stock list says "Built-in list (65)" or "symbols only" | NSE downloads failed on his network | Wait a minute, reopen Settings; data/stocks.csv fallback; STOCK_LIST_URLS override |
| Feed shows `HTTP 404` | Source moved its RSS (NSE did) | Find the new URL (web search "nsearchives.nseindia.com/content/RSS"), add as `url` with old ones in `fallbacks` |
| Feed shows `HTTP 403` / blocked | Site blocks bots or data-centre IPs | Browser headers already sent; NSE cookie warm-up; otherwise `FEED_<ID>_URL` to a proxy |
| Phone "not working" | Usually: typed localhost on the phone, Funnel not enabled, DNS not propagated yet, PC off/asleep | `tailscale funnel status` on PC; open the .ts.net URL on the PC; then phone on mobile data; Chrome secure DNS |
| Alerts not arriving on phone | Notifications blocked in Android Chrome settings, or PC off | Settings → Apps → Chrome → Notifications on; Settings → Breaking news alerts → Send test alert |
| News_Live M1 shows "Update failed … is the PC on?" | Script couldn't reach the .ts.net address | PC on + funnel on; check MARKET_RADAR_URL |
| A sheet row shows Tab 4 text instead of news | No matching news in the last 7 days (rows without news are omitted on purpose) | Expected |

## Diagnostic commands for the user
```powershell
# Is the app running and which version/data?
start http://localhost:8080/api/status
# Phone access
tailscale funnel status
# Restart the app
#   windows\Remove autostart.cmd  then  windows\Install autostart.cmd
# Logs
notepad C:\Users\soume\OneDrive\Desktop\market-radar\data\server.log
```

## New access code
Delete `data\access-code.txt`, then Remove autostart → Install autostart. Re-enter it on the phone
(and in `MARKET_RADAR_CODE` in the Apps Script if used).
