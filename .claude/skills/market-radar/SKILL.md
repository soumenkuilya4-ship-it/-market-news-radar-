---
name: market-radar
description: Everything about Soumen's "Market Radar" app — the Indian market-news PWA in the GitHub repo soumenkuilya4-ship-it/-market-news-radar- (RSS feeds from Moneycontrol, NSE, Investing.com and RBI, auto-tagging, High-impact alerts, Windows autostart, phone access via Tailscale Funnel, and the Google Sheets News Radar link to the MASTER SHEET). Use this skill whenever the user mentions Market Radar, the news radar app, localhost:8080, the .ts.net phone address, news alerts or notifications, the 9_News_Radar or News_Live tabs, the RS Scanner stock universe, adding or changing a news feed or stock list, updating or restarting the app, or says something on the PC or phone "isn't working" — even if they don't name the app.
---

# Market Radar

Market Radar is a news-intelligence app built for Soumen (an Indian equity swing trader, Windows 11 PC + Android phone, not a programmer). It pulls Indian market news, tags every story, sends native alerts for High-impact news, and feeds a summary into his Google Sheets trading system.

**Talk to the user in plain, step-by-step language.** He follows instructions exactly as written, so give one command per line, say which window to type it in, and say what he should see afterwards. Avoid jargon (or explain it in a few words). When something fails, ask for the exact on-screen text or a screenshot.

## Where things are

- **Code:** GitHub `soumenkuilya4-ship-it/-market-news-radar-`, branch `claude/keen-ramanujan-cp0lib` (PR #1 into `main`, not yet merged when this skill was written — check). The repo is **public**: never commit personal data (sheet IDs, holdings, the access code, the .ts.net address).
- **On his PC:** `C:\Users\soume\OneDrive\Desktop\market-radar` (a git clone of that branch). Data lives in `market-radar\data\` (articles, stock cache, push subscriptions, VAPID keys, `access-code.txt`) — never committed.
- Personal details (sheet IDs and tab layout, phone address, pending decisions) are in `references/personal.md` when that file exists (private copy of this skill only).

## How it works (one paragraph)

A small Node.js server (`server/`) polls 4 RSS feeds every 3 minutes, de-duplicates by GUID/URL hash, and tags each item with a rules engine (`docs/js/analyzer.js`, shared by server and browser): asset class, sub-sector, impact (High/Medium/Low), sentiment, a 3-bullet summary, key numbers, and stocks in focus (matched against a ~1,200-stock universe: his RS Scanner list + NIFTY 500 + Microcap 250, names from NSE's EQUITY_L.csv). Optional Claude analysis replaces the tags when `ANTHROPIC_API_KEY` is set (off by default — it costs money). The PWA in `docs/` shows a 3-column desktop / bottom-nav mobile UI, live via Server-Sent Events, caches 100 articles in IndexedDB, reads summaries aloud, and receives Web Push alerts. `POST /api/radar` summarises news per symbol/sector for the Google Sheet. Read `references/architecture.md` before changing code.

## The update routine (use every time code changes)

The app runs hidden in the background (Windows autostart), so it must be stopped before pulling, or the old version keeps running:

1. Double-click `market-radar\windows\Remove autostart.cmd`
2. In PowerShell:
   ```powershell
   cd C:\Users\soume\OneDrive\Desktop\market-radar
   git pull
   ```
   (Confirm it lists changed files — "Already up to date" means the push didn't happen or he's on another branch.)
3. Double-click `windows\Install autostart.cmd`
4. In the app press **Ctrl + Shift + R** once if the screen looks old.

Before asking him to pull: run `npm test` (all tests must pass), check the change in a headless browser where possible, commit with a clear message, and push to the branch.

## Daily use (what to tell him)

- Open via the desktop **Market Radar** shortcut, the installed Chrome app, or http://localhost:8080 (PC) / his `https://….ts.net` address (phone).
- **Settings → Data** shows: mode, analysis engine, stock list (expect "~1199 NSE stocks · … named"), feed health per source, offline cache, and (on the PC only) the **Phone access code**.
- Manual posts (pasted paid articles) are private: only the PC, or a device that entered the access code, can see them.

## Setup pieces (already done once — for re-installs or a new PC)

See `references/windows-setup.md` for: installing Node/Git, the PowerShell execution-policy problem (`npm.cmd`), autostart, Tailscale Funnel phone access, Android install + alerts, and the Google Apps Script for the MASTER SHEET (`sheets/NewsRadar.gs`, which fills the `News_Live` tab every 15 min; tab 9 formulas show News_Live first and fall back to Tab 4).

## When something doesn't work

Read `references/troubleshooting.md` — it lists every problem hit so far with the fix (execution policy, pasted commands doubling, stale page after update, NSE feed 404, phone can't open the .ts.net address, "localhost" typed on the phone, etc.). Diagnose with:
- PC app running? → open http://localhost:8080/api/status in Chrome (shows version-relevant fields: stocks, feeds, push subscribers).
- Phone access on? → PowerShell `tailscale funnel status` (should show `https://<name>.ts.net (Funnel on)` → `proxy http://127.0.0.1:8080`).

**Your sandbox cannot reach NSE, niftyindices, TradingView, Moneycontrol, or his .ts.net address** (the egress proxy blocks them). Don't conclude a site is down from that; test with local fixtures/mocks and ask him to check on his PC.

## Safety points to keep in mind

- The app has **no broker or bank connection**; it cannot trade or move money. The realistic risk is acting on wrong/late/fake news — tags are keyword-based, not advice. Say so if he asks about risk.
- Write endpoints (manual post, refresh) need the access code when reached through the tunnel (detected by public Host or forwarding headers). Keep that check if you touch `server/index.js`.
- Changing what tab 9 writes can change his trading dashboard: `0_Home` row 16 counts holdings whose tab-9 Sentiment contains "NEGATIVE" or Action contains "EXIT-RISK". Ask before changing those words.
- Don't change Google Sheets formulas he relies on without showing him what changes and keeping the old behaviour as a fallback.
