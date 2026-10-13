// Market Radar server: serves the PWA from docs/, polls RSS feeds on an interval,
// streams new articles to open clients (SSE) and sends Web Push for High impact news.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiInfo } from './ai.js';
import { analyzeManual, feedStatus, pollFeeds } from './pipeline.js';
import { PushService } from './push.js';
import { ArticleStore } from './store.js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC = join(ROOT, 'docs');
const DATA = process.env.DATA_DIR || join(ROOT, 'data');
const PORT = Number(process.env.PORT || 8080);
const POLL_MS = Number(process.env.POLL_INTERVAL_MS || 3 * 60_000);
const APP_TOKEN = process.env.APP_TOKEN || ''; // optional: protects write endpoints

const store = await new ArticleStore(join(DATA, 'articles.json'), Number(process.env.MAX_ARTICLES || 1000)).load();
const push = await new PushService(DATA).init();
const clients = new Set();
let lastPoll = null;
let nextPoll = null;
let polling = false;

// ---------------------------------------------------------------------------
// Real-time fan-out
// ---------------------------------------------------------------------------

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
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

function authorised(req) {
  return !APP_TOKEN || req.headers['x-app-token'] === APP_TOKEN;
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
    sendJson(res, 200, {
      articles: store.list({
        limit: Math.min(Number(p.get('limit')) || 200, 1000),
        since: p.get('since') || undefined,
        q: p.get('q') || undefined,
        assetClass: p.get('assetClass') || undefined,
        impact: p.get('impact') || undefined,
      }),
      generatedAt: new Date().toISOString(),
    });
  },

  'GET /api/stream': (req, res) => {
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

server.listen(PORT, () => {
  console.log(`Market Radar running on http://localhost:${PORT}`);
  console.log(`Polling ${Object.keys(feedStatus).length} feeds every ${POLL_MS / 1000}s · AI: ${aiInfo.enabled ? aiInfo.model : 'rules engine'}`);
});

// First poll: when the store is empty, seed it without blasting alerts for the backlog.
runPoll({ silent: store.size === 0 }).catch((e) => console.error('[poll]', e));
setInterval(() => runPoll().catch((e) => console.error('[poll]', e)), POLL_MS);

async function shutdown() {
  await store.flush().catch(() => {});
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
