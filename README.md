# Market Radar

Market Radar is a financial market news app for Indian markets. You can install it as an app (PWA) on Windows 11 and Android. It pulls four RSS feeds every 3 minutes and tags each story automatically. You can also paste articles in yourself.

| Feed | Default asset class |
|---|---|
| Moneycontrol Business: `moneycontrol.com/rss/business.xml` | Equities |
| NSE Corporate Announcements: `nsearchives.nseindia.com/content/RSS/Online_announcements.xml` | Equities |
| Investing.com Commodities: `in.investing.com/rss/commodities.rss` | Commodities |
| RBI Press Releases: `rbi.org.in/pressreleases_rss.xml` | Macro |

## Features

- **Data ingestion.** The server polls the feeds every 3 minutes. It reads RSS 2.0, RDF and Atom, pulling out the title, description, timestamp and URL. NSE timestamps are read as IST. Stories are de-duplicated by GUID and URL hash, and tracking parameters are removed from URLs first.
- **Manual post.** The **+ Manual Post** modal takes text you paste (for example from your Moneycontrol subscription). It runs that text through the same analysis as the feeds and shows a live preview of the tags while you paste.
- **Story tagging.** Each story gets:
  - an asset class: Equities, Commodities, Macro or Geopolitics
  - a sub-sector, such as Banking, Auto, Energy, Metals or Central Bank
  - an impact level: High (red), Medium (amber) or Low (slate)
  - a sentiment pill: Bullish, Bearish or Neutral
  - a 3-bullet summary: what happened, the direct market impact, and the stocks or instruments in focus
  - extracted key numbers (₹/$ amounts, %, bps)
- **Two analysis engines.**
  - A built-in rules engine (`docs/js/analyzer.js`) always runs. It needs no API key and works offline in the browser.
  - If you set `ANTHROPIC_API_KEY`, Claude also analyses new stories and its tags replace the rules engine's. If Claude fails, the rules result stays.
- **Notifications.** Turn on **Enable Breaking News Alerts** in the header. Only **High impact** stories trigger a native notification: a toast on Windows 11, or a lock-screen notification on Android. Delivery uses Web Push (VAPID), so alerts arrive even when the app is closed.
- **Interface.**
  - Dark slate theme (`#0f172a` / `#1e293b`).
  - Desktop has 3 columns:
    - Left: tickers in the news and filter shortcuts.
    - Middle: a real-time feed, pushed over Server-Sent Events.
    - Right: the full analysis, key numbers and a TradingView mini chart.
  - Mobile has full-width cards, a bottom nav (Feed, High-Impact, Commodities, Macro, Settings) and a slide-in detail sheet.
- **Top bar.** Real-time search, category pills, and an **Audio Brief** button. Audio Brief reads the selected story's 3 bullets aloud using SpeechSynthesis, preferring an en-IN voice. With no story selected, it reads the top High-impact headlines.
- **Offline.** The last 100 articles (plus your manual posts) are saved in IndexedDB, so the app opens instantly. A service worker caches the app shell.
- **Keyboard shortcuts:** `/` search, `j`/`k` next/previous story, `a` audio brief, `m` manual post, `Esc` close.

## Run it

```bash
npm install
npm start            # http://localhost:8080
```

Open the URL in Edge or Chrome and use **Install app** (address bar icon or ⋯ menu). On Windows 11 it becomes a standalone app with native toasts.

### Start automatically on Windows (no terminal needed)

In the project folder, open `windows` and double-click **Install autostart.cmd**. After that:

- Market Radar starts hidden in the background every time you log in to Windows.
- A **Market Radar** shortcut on your Desktop opens the app, and starts it first if it isn't running.
- Logs go to `data\server.log`.

To undo it, double-click **windows\Remove autostart.cmd**. That stops the app and removes both shortcuts.

Web Push needs **HTTPS**. `localhost` is the one exception, so it works for desktop testing. For Android, deploy the server behind HTTPS on any Node host, such as Render, Railway, Fly.io, or a VPS with Caddy or nginx. Then open the site in Chrome on Android, choose **Add to Home screen**, and turn on alerts.

### Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP port |
| `POLL_INTERVAL_MS` | `180000` | Feed polling interval (3 min) |
| `DATA_DIR` | `./data` | Where articles, push subscriptions and VAPID keys are stored |
| `ANTHROPIC_API_KEY` | — | Turns on Claude analysis of new items. Leave it unset to use the rules engine only |
| `AI_MODEL` | `claude-opus-5-5` | Model used for Claude analysis |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | auto-generated | Set these in production so subscriptions survive redeploys |
| `VAPID_SUBJECT` | `mailto:alerts@market-radar.local` | Contact address for the push services. Use your own email |
| `APP_TOKEN` | — | If set, manual posts and refresh need this token. The app asks for it once |
| `FEED_<ID>_URL` | — | Override a feed URL (the NSE feed also tries backup addresses on its own), e.g. `FEED_NSE_URL` (IDs: `MONEYCONTROL`, `NSE`, `INVESTING`, `RBI`) |

**About the feeds.** NSE and Investing.com block many non-browser and data-centre requests. The server sends browser-like headers, and for NSE it fetches session cookies first. If a feed still fails from your host, its status shows red under **Settings → Data**. You can then point that feed at a proxy with `FEED_<ID>_URL`.

**Stock list.** The app recognises about 1,200+ stocks:

- **Your universe:** the 1,171 symbols from the RS Scanner tab of your RS Model sheet, bundled as `server/my-universe.csv`. To update it, export the tab's Symbol and Industry columns as CSV and save it as `data/my-universe.csv`, which overrides the bundled copy.
- **NSE index lists:** NIFTY 500 and NIFTY Microcap 250 members are added on top of your universe.
- **Company names:** come from NSE's index files and its full equity list (`EQUITY_L.csv`).

How it loads and matches:
- It downloads the NSE files in the background, caches the result in `data/stocks.json`, and refreshes it weekly. Stored stories are re-tagged when the list changes.
- It matches each company by its full name (e.g. "Dixon Technologies"), a distinctive short name (e.g. "Suzlon", "Tips Music"), or its NSE symbol in capitals (e.g. "IRCTC", "KROSS").
- When the industry keywords don't give a clear sector, the company's industry sets the sub-sector.
- If NSE can't be reached, it uses the last saved copy. With no saved copy, it uses your universe with symbols only, plus any `data/stocks.csv` you provide (columns: Company Name, Industry, Symbol).
- **Settings → Data → Stock list** shows what is loaded.
- `STOCK_LIST_URLS` (comma-separated) overrides the index-list download links.

**Claude cost.** Claude analyses at most 25 new items per poll, one at a time, at low effort. To use a cheaper model, set `AI_MODEL`.

## Phone access and Android alerts (Tailscale Funnel)

The app keeps running on your PC. A free Tailscale Funnel gives it a permanent `https://<pc-name>.<tailnet>.ts.net` address. Android push alerts and Google Sheets both need that address.

1. Install Tailscale for Windows (https://tailscale.com/download/windows) and sign in.
2. Double-click `windows\Enable phone access.cmd`. If it shows a link, open it and click **Enable Funnel**. The script then prints your `https://….ts.net` address.
3. On your Android phone, open that address in Chrome, tap ⋮ → **Add to Home screen**, then turn on **Enable Breaking News Alerts**. High-impact alerts reach the lock screen even when the app is closed, as long as the PC is on.

Anyone with the address can read the news. Posting and refreshing from outside the PC need the **Phone access code**, shown under Settings → Data only when you open the app on the PC itself. To turn the address off, run `windows\Disable phone access.cmd`.

## Google Sheets: MASTER SHEET → 9_News_Radar

`sheets/NewsRadar.gs` is a Google Apps Script. Every 15 minutes it sends the Type, Symbol and Name rows of **9_News_Radar** to `POST /api/radar` and writes the results to a **News_Live** tab. For each row it writes:

- the latest headline
- sentiment over the last 7 days
- catalysts
- risks, with 🚩 red flags such as probes, penalties, pledges, stake sales or downgrades
- a suggested action

Columns D–H of 9_News_Radar show News_Live first and fall back to the Tab 4 lookup when a row has no news. Rows without news aren't written, so your own data stays in place. Setup steps are at the top of the script file. `RADAR_DAYS` sets the look-back window (default 7 days).

## GitHub Pages (static snapshot)

The `docs/` folder is the PWA, so it can also be served by GitHub Pages (Settings → Pages → `main` / `docs`). In that mode there is no server:

- `.github/workflows/update-news.yml` runs `scripts/build-static.js` on a schedule. The script polls the feeds, analyses new items, updates `docs/news.json`, and sends a Telegram digest if `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set. It also adds an `ANTHROPIC_API_KEY` secret if one is present.
- The app sees there is no server and reads `news.json` instead. It re-checks the file every 3 minutes.
- Manual posts are analysed in the browser.
- Alerts fire only while the app is open.

The Node server is the full real-time setup: 3-minute polling, live streaming and background push.

## API

| Method & path | Description |
|---|---|
| `GET /api/status` | Feed health, poll times, AI mode and subscriber count |
| `GET /api/news?limit=&since=&q=&assetClass=&impact=` | Analysed articles, newest first |
| `GET /api/stream` | Server-Sent Events: `article`, `update`, `status` |
| `POST /api/manual` `{title?, text, url?}` | Analyse and store a pasted article |
| `POST /api/refresh` | Poll all feeds now |
| `GET /api/push/key` | VAPID public key |
| `POST /api/push/subscribe` / `unsubscribe` / `test` | Manage Web Push subscriptions |

## Project layout

```
server/
  index.js      HTTP server, static hosting, SSE, poll loop, API
  feeds.js      Feed list, fetch (with NSE cookie warm-up), RSS/Atom parsing, hashing
  pipeline.js   Poll → de-dup → analyse → Claude enrichment
  ai.js         Optional Claude analysis (structured JSON output)
  push.js       VAPID keys, subscriptions, Web Push delivery
  store.js      JSON-file persistence
docs/           The PWA (also deployable to GitHub Pages)
  index.html, css/app.css, js/app.js, js/analyzer.js, js/db.js, sw.js, manifest.webmanifest, icons/
scripts/
  build-static.js   Static snapshot and Telegram digest (used by the GitHub Action)
  make-icons.js     Regenerates the PNG icons
test/           node:test suite with feed fixtures (`npm test`)
```
