# Market Radar — architecture and code map

## Files

```
server/
  index.js      HTTP server: static docs/, API routes, SSE, 3-min poll loop, access-code checks,
                re-tagging stored articles when the stock list changes
  feeds.js      FEEDS list (with fallback URLs), fetch with browser headers + NSE cookie warm-up,
                RSS/RDF/Atom parsing, GUID/URL hashing, NSE "13-Oct-2026 17:05:00" = IST dates
  pipeline.js   pollFeeds(): fetch → de-dup → analyse → optional Claude enrichment; analyzeManual()
  analyzer (docs/js/analyzer.js) — shared rules engine, see below
  stocks.js     Stock universe: server/my-universe.csv (his RS Scanner list, 1,171 symbols + industry)
                + NIFTY 500 + Microcap 250 (NSE index CSVs) + names from NSE EQUITY_L.csv.
                Cached data/stocks.json (CACHE_VERSION), refreshed weekly, background download;
                fallbacks: cache → data/stocks.csv → symbols-only → built-in 65.
                data/my-universe.csv overrides the bundled list.
  radar.js      buildRadar(rows): per MARKET/SECTOR/HOLDING/QUALIFIER row → latest headline,
                7-day sentiment, catalysts, 🚩 red-flag risks, action; rows without news omitted
  ai.js         Optional Claude analysis (claude-opus-5-5 default, AI_MODEL to override,
                structured JSON output, server-side fallbacks beta). Off unless ANTHROPIC_API_KEY set.
  push.js       VAPID keys (data/vapid.json or env), subscriptions, web-push, prune 404/410
  store.js      JSON-file stores with debounced atomic writes; ArticleStore (max 1000)
docs/           The PWA (also GitHub-Pages-ready static mode reading docs/news.json)
  index.html, css/app.css, js/app.js (UI), js/analyzer.js, js/db.js (IndexedDB, 100 articles),
  sw.js (network-first app shell, push handler), manifest.webmanifest, icons/
windows/        Install/Remove autostart.cmd, start-hidden.vbs, Enable/Disable phone access.cmd
sheets/NewsRadar.gs   Apps Script for the MASTER SHEET (News_Live tab)
scripts/        build-static.js (GitHub Action snapshot + Telegram digest), make-icons.js
test/           node:test suites + fixtures (npm test)
.github/workflows/update-news.yml   twice-daily static build (Node) — optional path
```

## API

| Route | Notes |
|---|---|
| GET /api/status | feeds health, poll times, ai, stocks {count, source, error}, push subscribers |
| GET /api/news?limit&since&q&assetClass&impact | manual posts hidden unless local or access code (header X-App-Token or ?code=) |
| GET /api/stream | SSE `article`/`update`/`status`; manual posts only to private-capable clients |
| POST /api/manual {title?, text, url?} | needs access code when remote |
| POST /api/refresh | needs access code when remote |
| GET /api/stocks | [symbol, name, industry] list for the browser |
| GET /api/access-code | only answers on the PC itself (localhost, no forwarding headers) |
| POST /api/radar {rows:[{type,key,name}]} | used by the Sheets script; public |
| GET /api/push/key, POST /api/push/subscribe, /unsubscribe, /test | Web Push |

## Analyzer essentials (docs/js/analyzer.js)

- Whole-word matching with simple inflections (fixes "ban" matching "bank").
- Asset class = keyword scores + feed-category prior + sub-sector vote.
- Impact = High/Medium keyword hits + biggest % move + policy-rate boost (≥4.5 High, ≥1.8 Medium).
- Sentiment = bullish/bearish lexicon with negation + policy-rate direction regex; headline counts double.
- Stocks: built-in INSTRUMENTS (indices, commodities, FX, ~50 large caps with aliases) + universe
  matching by full name, short name (generic tail words stripped, stop-list, unique only), capitalised
  first word, and capitalised NSE symbol (SYMBOL_STOP excludes English-word symbols like GLOBAL, STAR).
  NAME_BLOCKERS stop "Reserve Bank of India" matching Bank of India.
- When keywords give no clear sector, the first matched company's industry sets the sub-sector
  (INDUSTRY_SUBSECTOR maps NSE industries and his sheet's labels like "i.t", "fmcg", "aerospace & defence").
- If no stock is named, SECTOR_PROXIES supply "Watch (sector proxies)".

## Feeds

| id | URL (current) | notes |
|---|---|---|
| moneycontrol | moneycontrol.com/rss/business.xml | |
| nse | nsearchives.nseindia.com/content/RSS/Online_announcements.xml | fallbacks: archives.nseindia.com/…, old www.nseindia.com/static/rss/announcements.xml (404 since Oct 2026) |
| investing | in.investing.com/rss/commodities.rss | may block data-centre IPs |
| rbi | rbi.org.in/pressreleases_rss.xml | |

Override any with env `FEED_<ID>_URL` (drops fallbacks).

## Testing without internet

The sandbox can't reach the real feeds. Pattern used: a tiny local HTTP server serving `test/fixtures/*.xml`,
then run the server with `FEED_*_URL=http://localhost:<port>/<file>` and a scratch `DATA_DIR`, and drive the UI with
Playwright (`/opt/node-tools/node_modules/playwright`, Chromium preinstalled) at desktop 1440×900 and mobile 412×915.
To test tunnel behaviour, send `Host: x.ts.net` + `X-Forwarded-For` headers to localhost.

## History (commits on the branch)

1. Build PWA (feeds, analyzer, push, UI, offline, static build, tests)
2. Windows autostart (hidden VBS, desktop shortcut, login start)
3. ~750 NSE stocks → 4. RS Scanner universe 1,171 + EQUITY_L names
5. Service worker network-first (stale page after updates)
6. NSE feed new address + fallbacks
7. Tailscale Funnel phone access + /api/radar + Sheets script + access code
8. Manual posts private through the tunnel
