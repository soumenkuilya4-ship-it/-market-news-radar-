// Market Radar server: serves the PWA from docs/, polls RSS feeds on an interval,
// streams new articles to open clients (SSE) and sends Web Push for High impact news.
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeArticle } from '../docs/js/analyzer.js';
import { aiInfo } from './ai.js';
import { analyzeManual, feedStatus, pollFeeds } from './pipeline.js';
import { PushService } from './push.js';
import { buildRadar } from './radar.js';
import { loadStockUniverse, stockInfo, stockPayload } from './stocks.js';
import { ArticleStore } from './store.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = join(ROOT, 'docs');
const DATA = process.env.DATA_DIR || join(ROOT, 'data');
const PORT = Number(process.env.PORT || 8080);
const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 3 * 60_000);
const APP_TOKEN = process.env.APP_TOKEN || ''; // optional: required for write endpoints from anywhere

// Access code for write endpoints (manual post, refresh) when the app is reached from
// outside this PC, e.g. through a Tailscale Funnel. Requests to localhost don't need it.
const ACCESS_CODE = await (async () => {
  const file = join(DATA, 'access-code.txt');
  try {
    const code = (await readFile(file, 'utf8')).trim();
    if (code) return code;
  } catch { /* create below */ }
  const code = randomBytes(4).toString('hex').toUpperCase();
  await mkdir(DATA, { recursive: true });
  await writeFile(file, `${code}\n`);
  return code;
})();

const store = await new ArticleStore(join(DATA, 'articles.json'), Number(process.env.MAX_ARTICLES || 1000)).load();
const push = await new PushService(DATA).init();
await loadStockUniverse(DATA, { download: false }); // instant: whatever is saved on disk
reanalyzeRuleArticles();
const clients = new Set();
let lastPoll = null;
let nextPoll = null;
let polling = false;

// ---------------------------------------------------------------------------
// Real-time fan-out
// ---------------------------------------------------------------------------

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const isPrivate = data?.sourceId === 'manual';
  for (const res of clients) if (!isPrivate || res.canSeePrivate) res.write(msg);
}

async function maybePush(article) {
  if (article.impact !== 'High' || article.notified) return;
  store.update(article.id, { notified: true });
  await push.notifyArticle(article);
}

async function runPoll({ silent = false } = {}) {
  if (polling) return [];
  polling = true;
  try {
    const fresh = await pollFeeds(store, {
      onNew: (a) => {
        broadcast('article', a);
        if (!silent) maybePush(a);
      },
      onUpdate: (a) => {
        broadcast('update', a);
        if (!silent) maybePush(a);
      },
    });
    lastPoll = new Date().toISOString();
    if (fresh.length) console.log(`[poll] ${fresh.length} new article(s); ${store.size} stored`);
    broadcast('status', statusPayload());
    return fresh;
  } finally {
    polling = false;
    nextPoll = new Date(Date.now() + POLL_MS).toISOString();
  }
}

/** Re-tag stored rules-engine articles, e.g. after the stock list changed. */
function reanalyzeRuleArticles() {
  const now = new Date().toISOString();
  let n = 0;
  for (const a of store.list({ limit: Infinity })) {
    if (a.engine !== 'rules') continue;
    store.update(a.id, { ...analyzeArticle(a), updatedAt: now });
    n++;
  }
  if (n) console.log(`[stocks] re-tagged ${n} stored article(s) with ${stockInfo.count || 'built-in'} stocks`);
}

function statusPayload() {
  return {
    ok: true,
    mode: 'server',
    articles: store.size,
    lastPoll,
    nextPoll,
    pollIntervalMs: POLL_MS,
    feeds: Object.values(feedStatus),
    ai: aiInfo,
    stocks: { count: stockInfo.count, source: stockInfo.source, updatedAt: stockInfo.updatedAt, error: stockInfo.error },
    push: { subscribers: push.count },
    tokenRequired: Boolean(APP_TOKEN),
  };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 1_000_000) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw Object.assign(new Error('Payload too large'), { status: 413 });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(new Error('Invalid JSON'), { status: 400 });
  }
}

function isLocal(req) {
  const host = String(req.headers.host || '').toLowerCase().replace(/:\d+$/, '');
  const addr = req.socket.remoteAddress || '';
  const loopback = addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
  // A tunnel (Tailscale Funnel) also connects from loopback, but keeps the public Host name
  // and adds forwarding headers, so any of those marks the request as remote.
  const forwarded = ['x-forwarded-for', 'x-forwarded-host', 'forwarded', 'tailscale-funnel-request', 'cf-connecting-ip']
    .some((h) => req.headers[h] !== undefined);
  return loopback && !forwarded && ['localhost', '127.0.0.1', '[::1]'].includes(host);
}

// Manual posts (possibly paid articles you pasted) are only shown on this PC or to
// devices that send the access code (header, or ?code= for the live stream).
function canSeePrivate(req, url) {
  return authorised(req) || (!APP_TOKEN && url?.searchParams.get('code') === ACCESS_CODE)
    || (APP_TOKEN && url?.searchParams.get('code') === APP_TOKEN);
}
const publicOnly = (list) => list.filter((a) => a.sourceId !== 'manual');

function authorised(req) {
  const given = req.headers['x-app-token'];
  if (APP_TOKEN) return given === APP_TOKEN;
  return isLocal(req) || given === ACCESS_CODE;
}

async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = normalize(join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) return sendJson(res, 403, { error: 'Forbidden' });
  try {
    const st = await stat(file);
    if (!st.isFile()) throw new Error('not a file');
    const ext = extname(file);
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
    // The service worker and app shell must revalidate so updates roll out.
    headers['Cache-Control'] = ['.html', '.js', '.css', '.webmanifest', '.json'].includes(ext) ? 'no-cache' : 'public, max-age=86400';
    if (rel === '/sw.js') headers['Service-Worker-Allowed'] = '/';
    res.writeHead(200, headers);
    res.end(await readFile(file));
  } catch {
    sendJson(res, 404, { error: 'Not found' });
  }
}

const routes = {
  'GET /api/status': (req, res) => sendJson(res, 200, statusPayload()),

  'GET /api/news': (req, res, url) => {
    const p = url.searchParams;
    const list = store.list({
      limit: Math.min(Number(p.get('limit')) || 200, 1000),
      since: p.get('since') || undefined,
      q: p.get('q') || undefined,
      assetClass: p.get('assetClass') || undefined,
      impact: p.get('impact') || undefined,
    });
    sendJson(res, 200, {
      articles: canSeePrivate(req, url) ? list : publicOnly(list),
      generatedAt: new Date().toISOString(),
    });
  },

  'GET /api/stream': (req, res, url) => {
    res.canSeePrivate = canSeePrivate(req, url);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`retry: 5000\nevent: status\ndata: ${JSON.stringify(statusPayload())}\n\n`);
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
  },

  'POST /api/refresh': async (req, res) => {
    if (!authorised(req)) return sendJson(res, 401, { error: 'Unauthorised' });
    const fresh = await runPoll();
    sendJson(res, 200, { added: fresh.length });
  },

  'POST /api/manual': async (req, res) => {
    if (!authorised(req)) return sendJson(res, 401, { error: 'Unauthorised' });
    const body = await readBody(req);
    if (!String(body.text || body.title || '').trim()) return sendJson(res, 400, { error: 'Paste some text first' });
    const article = await analyzeManual(body);
    if (!store.add(article)) return sendJson(res, 200, { article: store.byId.get(article.id), duplicate: true });
    broadcast('article', article);
    maybePush(article);
    sendJson(res, 201, { article });
  },

  // Only shown on this PC, so you can type it into your phone once.
  'GET /api/access-code': (req, res) => (isLocal(req)
    ? sendJson(res, 200, { code: APP_TOKEN || ACCESS_CODE })
    : sendJson(res, 403, { error: 'Only available on the PC running Market Radar' })),

  // News summary per symbol / sector, used by the Google Sheets script.
  'POST /api/radar': async (req, res, url) => {
    const body = await readBody(req, 200_000);
    const rows = Array.isArray(body.rows) ? body.rows.slice(0, 500) : [];
    const all = store.list({ limit: Infinity });
    sendJson(res, 200, buildRadar(rows, canSeePrivate(req, url) ? all : publicOnly(all)));
  },

  'GET /api/stocks': (req, res) => sendJson(res, 200, stockPayload()),

  'GET /api/push/key': (req, res) => sendJson(res, 200, { publicKey: push.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const body = await readBody(req, 20_000);
    push.subscribe(body.subscription || body);
    sendJson(res, 201, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const body = await readBody(req, 20_000);
    push.unsubscribe(body.endpoint);
    sendJson(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const body = await readBody(req, 20_000);
    await push.broadcast({
      id: 'test',
      title: '🔴 HIGH IMPACT · Test alert',
      body: 'Breaking news alerts are working on this device.',
      url: './',
      tag: 'radar-test',
    }, body.endpoint);
    sendJson(res, 200, { ok: true });
  },
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const handler = routes[`${req.method} ${url.pathname}`];
  try {
    if (handler) return await handler(req, res, url);
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Unknown endpoint' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
    return await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error(`[http] ${req.method} ${url.pathname}:`, err.message);
    if (!res.headersSent) sendJson(res, err.status || 500, { error: err.message });
    else res.end();
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${PORT} is already in use — Market Radar is probably already running.`);
    process.exit(0);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`Market Radar running on http://localhost:${PORT}`);
  console.log(`Polling ${Object.keys(feedStatus).length} feeds every ${POLL_MS / 1000}s · AI: ${aiInfo.enabled ? aiInfo.model : 'rules engine'}`);
});

// First poll: when the store is empty, seed it without blasting alerts for the backlog.
runPoll({ silent: store.size === 0 }).catch((e) => console.error('[poll]', e));
setInterval(() => runPoll().catch((e) => console.error('[poll]', e)), POLL_MS);
// Download the NSE stock list in the background now, then re-check daily (it refreshes weekly).
async function refreshStocks() {
  const before = `${stockInfo.source}|${stockInfo.updatedAt}|${stockInfo.count}`;
  await loadStockUniverse(DATA).catch((e) => console.error('[stocks]', e));
  if (`${stockInfo.source}|${stockInfo.updatedAt}|${stockInfo.count}` !== before) {
    reanalyzeRuleArticles();
    broadcast('status', statusPayload());
  }
}
refreshStocks();
setInterval(refreshStocks, 24 * 3600_000);

async function shutdown() {
  await store.flush().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
