import { analyzeArticle, setStockUniverse, stockUniverseSize, tradingViewSymbol } from './analyzer.js';
import { clearArticles, loadArticles, OFFLINE_LIMIT, saveArticles } from './db.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const POLL_MS = 3 * 60_000;
const RENDER_LIMIT = 300;
const mobileMq = matchMedia('(max-width: 760px)');

const state = {
  articles: new Map(),
  mode: 'loading', // server | static | offline
  status: null,
  connected: false,
  lastSync: null,
  filters: { cat: 'All', impact: null, sentiment: null, sector: null, source: null, ticker: null, q: '' },
  selectedId: null,
  chartSymbol: null,
  view: 'feed',
  fresh: new Set(),
  unseen: 0,
  pushSub: null,
  installPrompt: null,
  speaking: false,
  cacheCount: null,
};

const prefs = (() => {
  const defaults = { alerts: false, voiceURI: '', rate: 1, token: '' };
  try { return { ...defaults, ...JSON.parse(localStorage.getItem('mr.prefs') || '{}') }; } catch { return defaults; }
})();
function savePrefs() {
  try { localStorage.setItem('mr.prefs', JSON.stringify(prefs)); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function highlight(text) {
  const safe = esc(text);
  const q = state.filters.q.trim();
  if (q.length < 2) return safe;
  return safe.replace(new RegExp(`(${reEsc(esc(q))})`, 'gi'), '<mark>$1</mark>');
}

function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const istFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });
function ago(iso) {
  const t = new Date(iso).getTime();
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return istFmt.format(t).replace(',', '');
}
function agoPhrase(iso) {
  const t = ago(iso);
  if (t === 'now') return 'just now';
  return /^\d+[mh]$/.test(t) ? `${t} ago` : `on ${t}`;
}
const fullTime = (iso) => `${istFmt.format(new Date(iso))} IST`;

let toastTimer;
function toast(msg, ms = 3200) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

async function fetchJson(url, opts = {}, timeout = 8000) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (prefs.token) headers['X-App-Token'] = prefs.token;
  const res = await fetch(url, { cache: 'no-store', ...opts, headers, signal: AbortSignal.timeout(timeout) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

function tvSymbolFor(name) {
  if (!name) return 'NSE:NIFTY';
  return tradingViewSymbol(name) || (/^[A-Z0-9&_-]+$/.test(name) ? `BSE:${name.replace('-', '_')}` : 'NSE:NIFTY');
}

// ---------------------------------------------------------------------------
// Data ingestion
// ---------------------------------------------------------------------------
function ingest(list, { live = false } = {}) {
  const added = [];
  const updated = [];
  for (const a of list || []) {
    if (!a?.id || !a.title) continue;
    const prev = state.articles.get(a.id);
    if (!prev) {
      state.articles.set(a.id, a);
      added.push(a);
    } else if ((a.updatedAt || '') > (prev.updatedAt || '')) {
      state.articles.set(a.id, { ...prev, ...a });
      updated.push(a);
    }
  }
  if (!added.length && !updated.length) return added;

  if (live && added.length) {
    for (const a of added) state.fresh.add(a.id);
    const feedEl = $('#feed');
    if (feedEl.scrollTop > 160) {
      state.unseen += added.length;
      const banner = $('#newBanner');
      banner.textContent = `↑ ${state.unseen} new ${state.unseen === 1 ? 'story' : 'stories'}`;
      banner.hidden = false;
    }
    for (const a of added) maybeNotifyLocal(a);
  }
  if (live) for (const a of updated) maybeNotifyLocal(state.articles.get(a.id));

  renderAll();
  if (updated.some((a) => a.id === state.selectedId)) renderDetail();
  persistSoon();
  return added;
}

const persistSoon = debounce(async () => {
  state.cacheCount = await saveArticles([...state.articles.values()]);
  renderSettingsAll();
}, 800);

async function syncFromServer() {
  const since = state.lastSync;
  const url = since ? `./api/news?limit=500&since=${encodeURIComponent(since)}` : './api/news?limit=300';
  const data = await fetchJson(url);
  state.lastSync = data.generatedAt;
  ingest(data.articles, { live: Boolean(since) });
}

async function syncFromStatic() {
  const data = await fetchJson(`./news.json?t=${Date.now()}`, {}, 10_000);
  state.status = { ...(state.status || {}), mode: 'static', lastPoll: data.generatedAt, feeds: data.feeds, ai: data.ai };
  ingest(data.articles, { live: state.lastSync !== null });
  state.lastSync = data.generatedAt;
  updateLive();
}

let es = null;
function connectStream() {
  if (es) es.close();
  es = new EventSource('./api/stream');
  es.addEventListener('open', () => {
    const wasDown = !state.connected;
    state.connected = true;
    updateLive();
    if (wasDown && state.lastSync) syncFromServer().catch(() => {});
  });
  es.addEventListener('error', () => { state.connected = false; updateLive(); });
  es.addEventListener('article', (e) => ingest([JSON.parse(e.data)], { live: true }));
  es.addEventListener('update', (e) => ingest([JSON.parse(e.data)], { live: true }));
  es.addEventListener('status', (e) => {
    const prevStocks = state.status?.stocks;
    state.status = JSON.parse(e.data);
    const st = state.status.stocks;
    if (prevStocks && st && (st.count !== prevStocks.count || st.updatedAt !== prevStocks.updatedAt)) {
      // The server re-tagged articles with a new stock list: pick up the changes.
      loadStocks();
      syncFromServer().catch(() => {});
    }
    updateMeta();
    renderSettingsAll();
  });
}

// Load the NSE stock list so manual posts and charts recognise all ~750 companies.
async function loadStocks() {
  const url = state.mode === 'server' ? './api/stocks' : './stocks.json';
  try {
    const data = await fetchJson(url, {}, 10_000);
    if (data?.stocks?.length) setStockUniverse(data.stocks.map(([symbol, name, industry]) => ({ symbol, name, industry })));
  } catch { /* built-in list only */ }
  renderSettingsAll();
}

async function detectMode() {
  try {
    const status = await fetchJson('./api/status', {}, 4000);
    if (status?.mode === 'server') {
      state.mode = 'server';
      state.status = status;
      await syncFromServer();
      connectStream();
      return;
    }
  } catch { /* not running behind the server */ }
  try {
    state.mode = 'static';
    await syncFromStatic();
    setInterval(() => syncFromStatic().catch(() => {}), POLL_MS);
  } catch {
    state.mode = 'offline';
  }
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------
function baseList() {
  const f = state.filters;
  let list = [...state.articles.values()];
  if (f.cat !== 'All') list = list.filter((a) => a.assetClass === f.cat);
  if (f.q.trim()) {
    const q = f.q.trim().toLowerCase();
    list = list.filter((a) => `${a.title} ${a.description || ''} ${a.subSector} ${a.source} ${(a.instruments || []).join(' ')} ${(a.summary || []).join(' ')}`.toLowerCase().includes(q));
  }
  return list;
}

function visibleList() {
  const f = state.filters;
  let list = baseList();
  if (f.impact) list = list.filter((a) => a.impact === f.impact);
  if (f.sentiment) list = list.filter((a) => a.sentiment === f.sentiment);
  if (f.sector) list = list.filter((a) => a.subSector === f.sector);
  if (f.source) list = list.filter((a) => a.source === f.source);
  if (f.ticker) list = list.filter((a) => (a.instruments || []).includes(f.ticker));
  return list.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

function setFilter(key, value) {
  state.filters[key] = state.filters[key] === value ? null : value;
  if (key === 'ticker') state.chartSymbol = state.filters.ticker ? tvSymbolFor(state.filters.ticker) : null;
  syncNav();
  renderAll();
  $('#feed').scrollTop = 0;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function cardHtml(a) {
  const snippet = a.summary?.[0] && a.summary[0] !== a.title ? a.summary[0] : (a.description || a.summary?.[1] || '');
  const inst = (a.instruments || []).slice(0, 4).map((i) => `<span class="inst">${esc(i)}</span>`).join('');
  return `<article class="card imp-${esc(a.impact)}${a.id === state.selectedId ? ' selected' : ''}${state.fresh.has(a.id) ? ' fresh' : ''}" data-id="${esc(a.id)}" tabindex="0" role="button" aria-label="${esc(a.impact)} impact: ${esc(a.title)}">
    <div class="card-top">
      <span class="badge badge-${esc(a.impact)}">${esc(a.impact)}</span>
      <span class="tag tag-asset">${esc(a.assetClass)}</span>
      <span class="tag">${esc(a.subSector)}</span>
      <span class="sent sent-${esc(a.sentiment)}">${esc(a.sentiment)}</span>
      <time class="card-time" datetime="${esc(a.publishedAt)}" title="${esc(fullTime(a.publishedAt))}">${ago(a.publishedAt)}</time>
    </div>
    <h3 class="card-title">${highlight(a.title)}</h3>
    ${snippet ? `<p class="card-snippet">${highlight(snippet)}</p>` : ''}
    <div class="card-foot">
      ${a.sourceId === 'manual' ? '<span class="tag tag-manual">Manual</span>' : `<span class="card-src">${esc(a.source)}</span>`}
      ${inst}
    </div>
  </article>`;
}

function renderFeed() {
  const list = visibleList();
  const feed = $('#feed');
  if (!list.length) {
    if (state.mode === 'loading') {
      feed.innerHTML = '<div class="skeleton"></div>'.repeat(6);
    } else {
      const hasAny = state.articles.size > 0;
      feed.innerHTML = `<div class="feed-empty"><b>${hasAny ? 'No stories match these filters' : 'No stories yet'}</b>${hasAny ? 'Try clearing a filter or the search.' : state.mode === 'offline' ? 'You are offline and nothing is cached yet.' : 'Waiting for the first feed poll…'}</div>`;
    }
  } else {
    feed.innerHTML = list.slice(0, RENDER_LIMIT).map(cardHtml).join('');
  }
  // Freshness animation should only play once.
  setTimeout(() => state.fresh.clear(), 2500);
  updateMeta(list);
}

function countBy(list, fn) {
  const m = new Map();
  for (const a of list) {
    for (const k of [].concat(fn(a) || [])) m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}

function chipsHtml(key, entries, dots = {}) {
  if (!entries.length) return '<span class="empty-note">—</span>';
  return entries.map(([k, n]) => `<button class="chip${state.filters[key] === k ? ' active' : ''}" type="button" data-filter="${key}" data-value="${esc(k)}">${dots[k] ? `<i class="dot" style="background:${dots[k]}"></i>` : ''}${esc(k)} <span class="n">${n}</span></button>`).join('');
}

function renderSidebar() {
  const list = baseList();
  const impact = countBy(list, (a) => a.impact);
  $('#impactFilters').innerHTML = chipsHtml('impact', ['High', 'Medium', 'Low'].map((k) => [k, impact.get(k) || 0]), { High: 'var(--high)', Medium: 'var(--med)', Low: 'var(--low)' });
  const sent = countBy(list, (a) => a.sentiment);
  $('#sentimentFilters').innerHTML = chipsHtml('sentiment', ['Bullish', 'Bearish', 'Neutral'].map((k) => [k, sent.get(k) || 0]), { Bullish: 'var(--bull)', Bearish: 'var(--bear)', Neutral: 'var(--neutral)' });
  const sectors = [...countBy(list, (a) => a.subSector)].sort((a, b) => b[1] - a[1]).slice(0, 16);
  $('#sectorFilters').innerHTML = chipsHtml('sector', sectors);
  const sources = [...countBy(list, (a) => a.source)].sort((a, b) => b[1] - a[1]);
  $('#sourceFilters').innerHTML = chipsHtml('source', sources);

  // Tickers with sentiment split
  const tick = new Map();
  for (const a of list) {
    for (const i of a.instruments || []) {
      const t = tick.get(i) || { n: 0, Bullish: 0, Bearish: 0, Neutral: 0 };
      t.n++; t[a.sentiment] = (t[a.sentiment] || 0) + 1;
      tick.set(i, t);
    }
  }
  for (const d of ['NIFTY 50', 'SENSEX', 'BANK NIFTY', 'GOLD', 'BRENT', 'USD/INR']) if (!tick.has(d)) tick.set(d, { n: 0, Bullish: 0, Bearish: 0, Neutral: 0 });
  const rows = [...tick].sort((a, b) => b[1].n - a[1].n).slice(0, 16);
  $('#tickerList').innerHTML = rows.map(([sym, t]) => {
    const tot = t.n || 1;
    return `<li><button type="button" class="${state.filters.ticker === sym ? 'active' : ''}" data-filter="ticker" data-value="${esc(sym)}" title="${t.n} stories · ${t.Bullish} bullish · ${t.Bearish} bearish">
      <span class="tk-sym">${esc(sym)}</span><span class="tk-count">${t.n}</span>
      <span class="tk-bar">${t.n ? `<i class="b" style="width:${(t.Bullish / tot) * 100}%"></i><i class="n" style="width:${(t.Neutral / tot) * 100}%"></i><i class="r" style="width:${(t.Bearish / tot) * 100}%"></i>` : ''}</span>
    </button></li>`;
  }).join('');
}

function renderActiveFilters() {
  const f = state.filters;
  const labels = { impact: 'Impact', sentiment: 'Sentiment', sector: 'Sector', source: 'Source', ticker: 'Ticker' };
  const html = Object.keys(labels).filter((k) => f[k]).map((k) => `<button class="chip active" type="button" data-filter="${k}" data-value="${esc(f[k])}" title="Remove filter">${esc(f[k])} ✕</button>`).join('');
  $('#activeFilters').innerHTML = html;
  const title = f.impact === 'High' && f.cat === 'All' ? 'High-Impact Alerts' : f.cat !== 'All' ? `${f.cat} Feed` : 'Live Feed';
  $('#feedTitle').textContent = title;
}

function updateMeta(list = visibleList()) {
  const high = list.filter((a) => a.impact === 'High').length;
  const parts = [`${list.length} stories`, `${high} high impact`];
  const st = state.status;
  if (state.mode === 'server' && st?.lastPoll) parts.push(`polled ${agoPhrase(st.lastPoll)}`);
  if (state.mode === 'server' && st?.nextPoll) {
    const s = Math.max(0, Math.round((new Date(st.nextPoll) - Date.now()) / 1000));
    parts.push(`next ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  }
  if (state.mode === 'static' && st?.lastPoll) parts.push(`snapshot ${agoPhrase(st.lastPoll)}`);
  if (state.mode === 'offline') parts.push('offline cache');
  $('#feedMeta').textContent = parts.join(' · ');

  const allHigh = [...state.articles.values()].filter((a) => a.impact === 'High' && Date.now() - new Date(a.publishedAt) < 6 * 3600_000).length;
  const badge = $('#highBadge');
  badge.hidden = !allHigh;
  badge.textContent = allHigh > 99 ? '99+' : allHigh;
}

function updateLive() {
  const el = $('#liveStatus');
  el.className = 'live';
  let label = 'Connecting';
  if (state.mode === 'server') {
    el.classList.add(state.connected ? 'on' : 'off');
    label = state.connected ? 'Live' : 'Reconnecting';
  } else if (state.mode === 'static') {
    el.classList.add('static');
    label = 'Snapshot';
  } else if (state.mode === 'offline') {
    el.classList.add('off');
    label = 'Offline';
  }
  if (!navigator.onLine) { el.className = 'live off'; label = 'Offline'; }
  el.querySelector('span').textContent = label;
}

function renderAll() {
  renderFeed();
  renderSidebar();
  renderActiveFilters();
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------
const BULLET_LABELS = ['What happened', 'Market impact', 'In focus'];

function meter(value, colour) {
  return `<div class="meter"><i style="left:0;width:${Math.max(4, Math.min(100, value))}%;background:${colour}"></i></div>`;
}

function renderDetail() {
  const a = state.articles.get(state.selectedId);
  const body = $('#detailBody');
  $('#detailEmpty').hidden = Boolean(a);
  body.hidden = !a;
  if (!a) return;

  const symbol = state.chartSymbol || a.tvSymbol || tvSymbolFor(a.instruments?.[0]);
  const impactPct = a.scores?.impact != null ? (a.scores.impact / 10) * 100 : { High: 85, Medium: 50, Low: 20 }[a.impact];
  const sentScore = a.scores?.sentiment ?? { Bullish: 3, Bearish: -3, Neutral: 0 }[a.sentiment];
  const sentColour = sentScore > 0 ? 'var(--bull)' : sentScore < 0 ? 'var(--bear)' : 'var(--neutral)';
  const nums = (a.keyNumbers || []).map((k) => `<div class="num"><b>${esc(k.value)}</b><span>${esc(k.context)}</span></div>`).join('');

  body.innerHTML = `
    <button class="btn btn-ghost btn-sm detail-back" type="button" data-action="back">← Back</button>
    <div class="detail-badges">
      <span class="badge badge-${esc(a.impact)}">${esc(a.impact)} impact</span>
      <span class="tag tag-asset">${esc(a.assetClass)}</span>
      <span class="tag">${esc(a.subSector)}</span>
      <span class="sent sent-${esc(a.sentiment)}">${esc(a.sentiment)}</span>
    </div>
    <h2 class="detail-title">${esc(a.title)}</h2>
    <div class="detail-meta">
      <span>${esc(a.source)}</span>
      <time datetime="${esc(a.publishedAt)}">${esc(fullTime(a.publishedAt))}</time>
      ${a.url ? `<a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : ''}
    </div>
    <div class="detail-actions">
      <button class="btn btn-sm ${state.speaking ? 'speaking' : ''}" type="button" data-action="speak">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>
        ${state.speaking ? 'Stop' : 'Audio Brief'}
      </button>
      <button class="btn btn-sm btn-ghost" type="button" data-action="copy">Copy summary</button>
      ${navigator.share ? '<button class="btn btn-sm btn-ghost" type="button" data-action="share">Share</button>' : ''}
    </div>

    <section class="section">
      <h3 class="section-title">Executive summary <span class="eng">${a.engine === 'claude' ? 'AI analysis' : 'Rules engine'}</span></h3>
      <ol class="summary">
        ${(a.summary || []).slice(0, 3).map((s, i) => `<li data-i="${i}"><small>${BULLET_LABELS[i]}</small>${esc(i === 2 ? s.replace(/^In focus:\s*/i, '') : s)}</li>`).join('')}
      </ol>
    </section>

    <section class="section">
      <h3 class="section-title">Signal strength</h3>
      <div class="gauges">
        <div class="gauge"><small>Impact · ${esc(a.impact)}</small>${meter(impactPct, `var(--${a.impact === 'High' ? 'high' : a.impact === 'Medium' ? 'med' : 'low'})`)}</div>
        <div class="gauge"><small>Sentiment · ${sentScore > 0 ? '+' : ''}${sentScore}</small>${meter(50 + Math.max(-50, Math.min(50, sentScore * 8)), sentColour)}</div>
      </div>
    </section>

    ${nums ? `<section class="section"><h3 class="section-title">Key numbers</h3><div class="numbers">${nums}</div></section>` : ''}

    <section class="section">
      <h3 class="section-title">Chart</h3>
      <div class="inst-row">${(a.instruments || []).map((i) => `<button class="inst${tvSymbolFor(i) === symbol ? ' active' : ''}" type="button" data-symbol="${esc(tvSymbolFor(i))}">${esc(i)}</button>`).join('')}</div>
      <div class="chart-box" id="chartBox"><div class="chart-fallback">Chart loads when online · ${esc(symbol)}</div></div>
    </section>

    ${a.description ? `<section class="section"><h3 class="section-title">Original text</h3><div class="original">${esc(a.description)}</div></section>` : ''}
  `;
  mountMiniChart($('#chartBox'), symbol);
}

function selectArticle(id, { open = true, scroll = false } = {}) {
  if (!state.articles.has(id)) return;
  if (state.selectedId !== id) {
    stopSpeaking();
    state.chartSymbol = state.filters.ticker ? tvSymbolFor(state.filters.ticker) : null;
  }
  state.selectedId = id;
  $$('.card.selected').forEach((c) => c.classList.remove('selected'));
  const card = $(`.card[data-id="${CSS.escape(id)}"]`);
  card?.classList.add('selected');
  if (scroll) card?.scrollIntoView({ block: 'nearest' });
  renderDetail();
  $('#detail').scrollTop = 0;
  if (open && mobileMq.matches && !document.body.classList.contains('show-detail')) {
    document.body.classList.add('show-detail');
    history.pushState({ detail: id }, '', `?id=${encodeURIComponent(id)}`);
  }
}

function closeDetail() {
  document.body.classList.remove('show-detail');
  stopSpeaking();
}

// ---------------------------------------------------------------------------
// TradingView widgets
// ---------------------------------------------------------------------------
function tvWidget(el, name, config) {
  if (!el) return;
  const wrap = document.createElement('div');
  wrap.className = 'tradingview-widget-container';
  wrap.innerHTML = '<div class="tradingview-widget-container__widget"></div>';
  const s = document.createElement('script');
  s.src = `https://s3.tradingview.com/external-embedding/embed-widget-${name}.js`;
  s.async = true;
  s.textContent = JSON.stringify(config);
  el.classList.remove('tv-failed');
  s.onerror = () => el.classList.add('tv-failed');
  wrap.appendChild(s);
  el.querySelector('.tradingview-widget-container')?.remove();
  el.appendChild(wrap);
}

function mountMiniChart(el, symbol) {
  if (!navigator.onLine) return;
  tvWidget(el, 'mini-symbol-overview', {
    symbol, width: '100%', height: '100%', locale: 'en', dateRange: '1D', colorTheme: 'dark',
    isTransparent: true, autosize: true, largeChartUrl: '', chartOnly: false, noTimeScale: false,
  });
}

function mountTape() {
  if (mobileMq.matches) return;
  if (!navigator.onLine) { $('#tickerTape').classList.add('tv-failed'); return; }
  tvWidget($('#tickerTape'), 'ticker-tape', {
    symbols: [
      { proName: 'BSE:SENSEX', title: 'SENSEX' },
      { proName: 'NSE:NIFTY', title: 'NIFTY 50' },
      { proName: 'NSE:BANKNIFTY', title: 'BANK NIFTY' },
      { proName: 'FX_IDC:USDINR', title: 'USD/INR' },
      { proName: 'TVC:GOLD', title: 'GOLD' },
      { proName: 'TVC:SILVER', title: 'SILVER' },
      { proName: 'TVC:UKOIL', title: 'BRENT' },
      { proName: 'TVC:IN10Y', title: 'IN 10Y' },
      { proName: 'TVC:DXY', title: 'DXY' },
      { proName: 'FOREXCOM:SPXUSD', title: 'S&P 500' },
    ],
    showSymbolLogo: false, isTransparent: true, displayMode: 'compact', colorTheme: 'dark', locale: 'en',
  });
}

// ---------------------------------------------------------------------------
// Audio brief (SpeechSynthesis)
// ---------------------------------------------------------------------------
function speakable(text) {
  return String(text)
    .replace(/USD\/INR/g, 'dollar rupee')
    .replace(/\bIN 10Y\b/g, 'India ten year yield')
    .replace(/\bUS 10Y\b/g, 'U S ten year yield')
    .replace(/₹\s?/g, 'rupees ')
    .replace(/\bRs\.?\s?/g, 'rupees ')
    .replace(/\$\s?([\d,.]+)/g, '$1 dollars')
    .replace(/(\d)\s?%/g, '$1 percent')
    .replace(/\bbps\b/gi, 'basis points')
    .replace(/\bcr\b/gi, 'crore')
    .replace(/[—–]/g, ', ')
    .replace(/&/g, ' and ')
    .replace(/\s+/g, ' ');
}

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  return voices.find((v) => v.voiceURI === prefs.voiceURI)
    || voices.find((v) => v.lang === 'en-IN')
    || voices.find((v) => v.lang?.startsWith('en-GB'))
    || voices.find((v) => v.lang?.startsWith('en'))
    || null;
}

function stopSpeaking() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  setSpeaking(false);
}

function setSpeaking(on) {
  state.speaking = on;
  $('#audioBtn').classList.toggle('speaking', on);
  $('#audioBtn .lbl').textContent = on ? 'Stop Brief' : 'Audio Brief';
  const b = $('[data-action="speak"]');
  if (b) {
    b.classList.toggle('speaking', on);
    b.lastChild.textContent = on ? ' Stop' : ' Audio Brief';
  }
  if (!on) $$('.summary li.reading').forEach((li) => li.classList.remove('reading'));
}

function audioBrief() {
  if (!('speechSynthesis' in window)) return toast('Speech is not supported in this browser');
  if (state.speaking) return stopSpeaking();
  speechSynthesis.cancel();

  let parts;
  const a = state.articles.get(state.selectedId);
  if (a) {
    parts = [
      { text: `${a.impact} impact, ${a.sentiment}. ${a.title}.` },
      ...(a.summary || []).slice(0, 3).map((s, i) => ({ text: `${BULLET_LABELS[i]}: ${s}`, i })),
    ];
  } else {
    const top = visibleList().filter((x) => x.impact === 'High').slice(0, 5);
    const list = top.length ? top : visibleList().slice(0, 5);
    if (!list.length) return toast('Nothing to read yet');
    parts = [{ text: `Market Radar brief. ${list.length} top stories.` }, ...list.map((x, n) => ({ text: `Story ${n + 1}. ${x.title}. ${x.summary?.[1] || ''}` }))];
  }

  const voice = pickVoice();
  setSpeaking(true);
  parts.forEach((p, idx) => {
    const u = new SpeechSynthesisUtterance(speakable(p.text));
    if (voice) u.voice = voice;
    u.lang = voice?.lang || 'en-IN';
    u.rate = Number(prefs.rate) || 1;
    u.onstart = () => {
      $$('.summary li.reading').forEach((li) => li.classList.remove('reading'));
      if (p.i !== undefined) $(`.summary li[data-i="${p.i}"]`)?.classList.add('reading');
    };
    if (idx === parts.length - 1) u.onend = () => setSpeaking(false);
    u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') setSpeaking(false); };
    speechSynthesis.speak(u);
  });
}

// ---------------------------------------------------------------------------
// Notifications (Notification API + Web Push)
// ---------------------------------------------------------------------------
function urlB64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function alertsSupported() {
  return 'Notification' in window && 'serviceWorker' in navigator;
}

function syncAlertToggles() {
  const on = prefs.alerts && alertsSupported() && Notification.permission === 'granted';
  $('#alertsToggle').checked = on;
  $$('[data-role="alerts-toggle"]').forEach((t) => { t.checked = on; });
  renderSettingsAll();
}

async function enableAlerts() {
  if (!alertsSupported()) {
    toast('Notifications are not supported here. On Android use Chrome; on iOS add to Home Screen first.');
    return false;
  }
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') {
    toast(perm === 'denied' ? 'Notifications are blocked — allow them in the browser site settings.' : 'Permission not granted');
    return false;
  }
  prefs.alerts = true;
  savePrefs();
  if (state.mode === 'server' && 'PushManager' in window) {
    try {
      const reg = await navigator.serviceWorker.ready;
      const { publicKey } = await fetchJson('./api/push/key');
      let sub = await reg.pushManager.getSubscription();
      if (sub && sub.options?.applicationServerKey) {
        const current = btoa(String.fromCharCode(...new Uint8Array(sub.options.applicationServerKey))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        if (current !== publicKey) { await sub.unsubscribe(); sub = null; }
      }
      sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(publicKey) });
      await fetchJson('./api/push/subscribe', { method: 'POST', body: JSON.stringify(sub) });
      state.pushSub = sub;
      toast('Breaking news alerts on — High impact stories will notify this device.');
    } catch (err) {
      console.warn('Push subscription failed', err);
      toast('Alerts on (while the app is open). Background push unavailable: needs HTTPS.');
    }
  } else {
    toast('Alerts on — High impact stories notify while the app is open.');
  }
  return true;
}

async function disableAlerts() {
  prefs.alerts = false;
  savePrefs();
  try {
    const reg = await navigator.serviceWorker?.ready;
    const sub = await reg?.pushManager?.getSubscription();
    if (sub) {
      if (state.mode === 'server') await fetchJson('./api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
      await sub.unsubscribe();
    }
  } catch { /* ignore */ }
  state.pushSub = null;
  toast('Breaking news alerts off');
}

async function onAlertsToggle(e) {
  const want = e.target.checked;
  if (want) {
    const ok = await enableAlerts();
    if (!ok) prefs.alerts = false;
  } else {
    await disableAlerts();
  }
  syncAlertToggles();
}

const notified = new Set();
async function maybeNotifyLocal(a) {
  // With an active Web Push subscription the server delivers alerts (also when the app is closed).
  if (!a || a.impact !== 'High' || !prefs.alerts || state.pushSub || notified.has(a.id)) return;
  if (!alertsSupported() || Notification.permission !== 'granted') return;
  if (Date.now() - new Date(a.publishedAt).getTime() > 12 * 3600_000) return;
  notified.add(a.id);
  const title = `🔴 HIGH IMPACT · ${a.assetClass} · ${a.sentiment}`;
  const opts = {
    body: `${a.title}\n${a.summary?.[1] || ''}`.slice(0, 240),
    tag: `radar-${a.id}`,
    icon: './icons/icon-192.png',
    badge: './icons/badge-96.png',
    data: { url: `./?id=${encodeURIComponent(a.id)}` },
    requireInteraction: false,
  };
  try {
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification(title, opts);
  } catch {
    try { new Notification(title, opts); } catch { /* ignore */ }
  }
}

async function testAlert() {
  if (!prefs.alerts || Notification.permission !== 'granted') return toast('Turn alerts on first');
  if (state.pushSub && state.mode === 'server') {
    await fetchJson('./api/push/test', { method: 'POST', body: JSON.stringify({ endpoint: state.pushSub.endpoint }) })
      .then(() => toast('Test push sent'))
      .catch((e) => toast(`Test failed: ${e.message}`));
    return;
  }
  const reg = await navigator.serviceWorker.ready;
  reg.showNotification('🔴 HIGH IMPACT · Test alert', { body: 'Breaking news alerts are working on this device.', tag: 'radar-test', icon: './icons/icon-192.png', badge: './icons/badge-96.png' });
}

// ---------------------------------------------------------------------------
// Manual post
// ---------------------------------------------------------------------------
async function submitManual(form) {
  const fd = new FormData(form);
  const payload = { title: String(fd.get('title') || '').trim(), text: String(fd.get('text') || '').trim(), url: String(fd.get('url') || '').trim() };
  if (!payload.text && !payload.title) return toast('Paste some text first');
  const status = $('#manualStatus');
  const btn = $('#manualSubmit');
  btn.disabled = true;
  status.textContent = 'Analysing…';
  try {
    let article;
    if (state.mode === 'server') {
      try {
        ({ article } = await fetchJson('./api/manual', { method: 'POST', body: JSON.stringify(payload) }, 90_000));
      } catch (err) {
        if (err.status !== 401) throw err;
        const token = prompt('This server requires an app token for manual posts:');
        if (!token) throw err;
        prefs.token = token;
        savePrefs();
        ({ article } = await fetchJson('./api/manual', { method: 'POST', body: JSON.stringify(payload) }, 90_000));
      }
    } else {
      article = localManual(payload);
    }
    ingest([article], { live: true });
    $('#manualModal').close();
    form.reset();
    selectArticle(article.id, { scroll: true });
    toast(`Posted · ${article.impact} impact · ${article.sentiment} · ${article.assetClass}`);
  } catch (err) {
    status.textContent = `Failed: ${err.message}`;
    return;
  } finally {
    btn.disabled = false;
  }
  status.textContent = '';
}

function localManual({ title, text, url }) {
  const headline = title || text.split(/(?<=[.!?])\s|\n/)[0].slice(0, 160) || 'Manual post';
  const now = new Date().toISOString();
  const item = { title: headline, description: text.slice(0, 6000), url: url || null, publishedAt: now, source: 'Manual Post', sourceId: 'manual' };
  return { id: `m${fnv(`${url}|${headline}|${text.slice(0, 200)}`)}`, ...item, ...analyzeArticle(item), ingestedAt: now, updatedAt: now };
}

const updateManualPreview = debounce(() => {
  const form = $('#manualForm');
  const text = form.text.value.trim();
  const preview = $('#manualPreview');
  if (text.length < 40) { preview.hidden = true; return; }
  const a = analyzeArticle({ title: form.title.value || text.split(/(?<=[.!?])\s|\n/)[0], description: text });
  preview.hidden = false;
  preview.innerHTML = `<div class="card-top" style="margin:0"><span class="badge badge-${a.impact}">${a.impact}</span><span class="tag tag-asset">${a.assetClass}</span><span class="tag">${esc(a.subSector)}</span><span class="sent sent-${a.sentiment}">${a.sentiment}</span><span class="card-time">live preview</span></div>`;
}, 300);

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
function renderSettings(root) {
  if (!root) return;
  if (!root.firstElementChild) {
    root.appendChild($('#settingsTpl').content.cloneNode(true));
    root.querySelector('[data-role="alerts-toggle"]').addEventListener('change', onAlertsToggle);
    root.querySelector('[data-role="test-alert"]').addEventListener('click', testAlert);
    root.querySelector('[data-role="clear"]').addEventListener('click', async () => {
      await clearArticles();
      if ('caches' in window) for (const k of await caches.keys()) await caches.delete(k);
      toast('Offline cache cleared');
      renderSettingsAll();
    });
    root.querySelector('[data-role="install"]').addEventListener('click', async () => {
      if (!state.installPrompt) return;
      state.installPrompt.prompt();
      await state.installPrompt.userChoice;
      state.installPrompt = null;
      renderSettingsAll();
    });
    const voiceSel = root.querySelector('[data-role="voice"]');
    voiceSel.addEventListener('change', () => { prefs.voiceURI = voiceSel.value; savePrefs(); });
    const rate = root.querySelector('[data-role="rate"]');
    rate.addEventListener('input', () => { prefs.rate = Number(rate.value); savePrefs(); });
  }
  const st = state.status || {};
  const set = (role, text) => { const el = root.querySelector(`[data-role="${role}"]`); if (el) el.textContent = text; };
  root.querySelector('[data-role="alerts-toggle"]').checked = $('#alertsToggle').checked;
  set('perm', alertsSupported() ? Notification.permission : 'unsupported');
  set('delivery', state.pushSub ? 'Web Push (works when app is closed)' : prefs.alerts ? 'In-app (while open)' : 'Off');
  set('mode', { server: 'Live server (SSE)', static: 'Static snapshot (news.json)', offline: 'Offline cache', loading: 'Connecting…' }[state.mode]);
  set('engine', st.ai?.enabled ? `Claude (${st.ai.model}) + rules fallback` : 'Rules engine');
  const nStocks = st.stocks?.count || stockUniverseSize();
  set('stocks', nStocks ? `${nStocks} NSE stocks${st.stocks?.source ? ` · ${st.stocks.source}` : ''}` : `Built-in list (65)${st.stocks?.error ? ' · NSE download failed' : ''}`);
  set('cache', state.cacheCount != null ? `${state.cacheCount} articles saved (newest ${OFFLINE_LIMIT} + manual posts)` : '—');
  set('poll', state.mode === 'server' ? `Every ${Math.round((st.pollIntervalMs || POLL_MS) / 60000)} min on the server` : state.mode === 'static' ? 'Snapshot re-checked every 3 min' : '—');
  root.querySelector('[data-role="feeds"]').innerHTML = (st.feeds || []).map((f) => `<li class="${f.ok ? 'ok' : f.ok === false ? 'err' : ''}"><i></i>${esc(f.name)}<span title="${esc(f.lastError || '')}">${f.ok ? `${f.items} items` : esc(f.lastError || 'pending')}</span></li>`).join('');
  root.querySelector('[data-role="install"]').hidden = !state.installPrompt;

  const voiceSel = root.querySelector('[data-role="voice"]');
  const voices = 'speechSynthesis' in window ? speechSynthesis.getVoices().filter((v) => v.lang?.startsWith('en')) : [];
  if (voiceSel.options.length !== voices.length + 1) {
    voiceSel.innerHTML = `<option value="">Auto (English – India)</option>${voices.map((v) => `<option value="${esc(v.voiceURI)}">${esc(v.name)} (${esc(v.lang)})</option>`).join('')}`;
  }
  voiceSel.value = prefs.voiceURI || '';
  root.querySelector('[data-role="rate"]').value = prefs.rate;
}

function renderSettingsAll() {
  if (!$('#settingsView').hidden) renderSettings($('#settingsView'));
  if ($('#settingsModal').open) renderSettings($('#settingsModalBody'));
}

// ---------------------------------------------------------------------------
// Navigation (pills + mobile bottom nav)
// ---------------------------------------------------------------------------
function syncNav() {
  const f = state.filters;
  $$('#categoryPills [data-cat]').forEach((p) => p.classList.toggle('active', p.dataset.cat === f.cat));
  $('#categoryPills [data-impact]').classList.toggle('active', f.impact === 'High');
  let view = 'feed';
  if (state.view === 'settings') view = 'settings';
  else if (f.impact === 'High' && f.cat === 'All') view = 'high';
  else if (f.cat === 'Commodities') view = 'commodities';
  else if (f.cat === 'Macro') view = 'macro';
  $$('#bottomNav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
}

function setView(view) {
  state.view = view;
  const settings = view === 'settings';
  document.body.classList.toggle('view-settings', settings);
  $('#settingsView').hidden = !settings;
  if (settings) renderSettings($('#settingsView'));
  else {
    const f = state.filters;
    if (view === 'feed') { f.cat = 'All'; f.impact = null; }
    if (view === 'high') { f.cat = 'All'; f.impact = 'High'; }
    if (view === 'commodities') { f.cat = 'Commodities'; f.impact = null; }
    if (view === 'macro') { f.cat = 'Macro'; f.impact = null; }
    renderAll();
    $('#feed').scrollTop = 0;
  }
  syncNav();
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
function bindEvents() {
  $('#categoryPills').addEventListener('click', (e) => {
    const p = e.target.closest('.pill');
    if (!p) return;
    if (p.dataset.cat) state.filters.cat = p.dataset.cat;
    if (p.dataset.impact) state.filters.impact = state.filters.impact === 'High' ? null : 'High';
    if (state.view === 'settings') setView('feed');
    syncNav();
    renderAll();
    $('#feed').scrollTop = 0;
  });

  document.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (chip) setFilter(chip.dataset.filter, chip.dataset.value);
  });

  $('#feed').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card) selectArticle(card.dataset.id);
  });
  $('#feed').addEventListener('keydown', (e) => {
    const card = e.target.closest('.card');
    if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); selectArticle(card.dataset.id); }
  });
  $('#feed').addEventListener('scroll', () => {
    if ($('#feed').scrollTop < 80 && state.unseen) { state.unseen = 0; $('#newBanner').hidden = true; }
  }, { passive: true });
  $('#newBanner').addEventListener('click', () => {
    $('#feed').scrollTo({ top: 0, behavior: 'smooth' });
    state.unseen = 0;
    $('#newBanner').hidden = true;
  });

  $('#detail').addEventListener('click', async (e) => {
    const sym = e.target.closest('[data-symbol]');
    if (sym) {
      state.chartSymbol = sym.dataset.symbol;
      $$('.inst-row .inst').forEach((b) => b.classList.toggle('active', b === sym));
      mountMiniChart($('#chartBox'), state.chartSymbol);
      return;
    }
    const act = e.target.closest('[data-action]')?.dataset.action;
    const a = state.articles.get(state.selectedId);
    if (act === 'back') history.back();
    if (act === 'speak') audioBrief();
    if (act === 'copy' && a) {
      const text = `${a.title}\n[${a.impact} impact · ${a.assetClass} · ${a.subSector} · ${a.sentiment}]\n${(a.summary || []).map((s) => `• ${s}`).join('\n')}${a.url ? `\n${a.url}` : ''}`;
      await navigator.clipboard.writeText(text).then(() => toast('Summary copied'), () => toast('Copy failed'));
    }
    if (act === 'share' && a) {
      navigator.share({ title: a.title, text: (a.summary || []).join('\n'), url: a.url || location.href }).catch(() => {});
    }
  });

  const onSearch = debounce(() => { renderAll(); $('#feed').scrollTop = 0; }, 120);
  $('#search').addEventListener('input', (e) => { state.filters.q = e.target.value; onSearch(); });

  $('#audioBtn').addEventListener('click', audioBrief);
  $('#refreshBtn').addEventListener('click', refreshNow);
  $('#alertsToggle').addEventListener('change', onAlertsToggle);

  const manualModal = $('#manualModal');
  $('#manualBtn').addEventListener('click', () => { manualModal.showModal(); $('#manualForm').text.focus(); });
  $('#manualForm').addEventListener('submit', (e) => {
    if (e.submitter?.value === 'cancel') return; // native dialog close
    e.preventDefault();
    submitManual(e.target);
  });
  $('#manualForm').addEventListener('input', updateManualPreview);

  const settingsModal = $('#settingsModal');
  $('#settingsBtn').addEventListener('click', () => { renderSettings($('#settingsModalBody')); settingsModal.showModal(); });
  settingsModal.addEventListener('click', (e) => { if (e.target === settingsModal || e.target.closest('[data-close]')) settingsModal.close(); });
  manualModal.addEventListener('click', (e) => { if (e.target === manualModal) manualModal.close(); });

  $('#bottomNav').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b) { closeDetail(); setView(b.dataset.view); }
  });

  window.addEventListener('popstate', () => {
    if (document.body.classList.contains('show-detail')) closeDetail();
  });

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
    if (e.key === 'Escape') {
      if (typing) document.activeElement.blur();
      else if (document.body.classList.contains('show-detail')) history.back();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || $('dialog[open]')) return;
    if (e.key === '/') { e.preventDefault(); $('#search').focus(); }
    if (e.key === 'j' || e.key === 'k') {
      const list = visibleList().slice(0, RENDER_LIMIT);
      const idx = list.findIndex((a) => a.id === state.selectedId);
      const next = list[Math.max(0, Math.min(list.length - 1, idx + (e.key === 'j' ? 1 : -1)))];
      if (next) selectArticle(next.id, { open: false, scroll: true });
    }
    if (e.key === 'a') audioBrief();
    if (e.key === 'm') $('#manualBtn').click();
  });

  window.addEventListener('online', () => { updateLive(); refreshNow(); mountTape(); });
  window.addEventListener('offline', updateLive);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.mode === 'server') syncFromServer().catch(() => {});
  });
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); state.installPrompt = e; renderSettingsAll(); });
  if ('speechSynthesis' in window) speechSynthesis.addEventListener?.('voiceschanged', renderSettingsAll);
  mobileMq.addEventListener('change', () => { if (!mobileMq.matches) closeDetail(); mountTape(); });

  // Keep layout offsets in sync with the real top bar height.
  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--topbar-h', `${$('.topbar').offsetHeight}px`);
  }).observe($('.topbar'));

  // Refresh relative timestamps and countdown.
  setInterval(() => {
    $$('.card-time[datetime]').forEach((t) => { t.textContent = ago(t.getAttribute('datetime')); });
    updateMeta();
  }, 1000 * 15);
}

async function refreshNow() {
  const btn = $('#refreshBtn');
  btn.disabled = true;
  try {
    if (state.mode === 'server') {
      await fetchJson('./api/refresh', { method: 'POST' }, 60_000).catch((e) => { if (e.status !== 401) throw e; });
      await syncFromServer();
    } else {
      await syncFromStatic();
      if (state.mode === 'offline') state.mode = 'static';
    }
    toast('Feeds refreshed');
  } catch (err) {
    toast(`Refresh failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    updateLive();
  }
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function registerSw() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data?.type === 'open-article' && e.data.id) selectArticle(e.data.id);
    });
    const reg = await navigator.serviceWorker.ready;
    state.pushSub = await reg.pushManager?.getSubscription() || null;
  } catch (err) {
    console.warn('Service worker registration failed', err);
  }
}

async function boot() {
  bindEvents();
  renderAll();

  // 1) Instant start from the offline cache.
  const cached = await loadArticles();
  if (cached.length) {
    ingest(cached);
    state.mode = 'offline';
    updateLive();
  }

  const swReady = registerSw();
  mountTape();

  // 2) Live data.
  state.mode = 'loading';
  await detectMode();
  loadStocks();
  updateLive();
  renderAll();
  await swReady;
  if (state.mode !== 'server') state.pushSub = null; // push needs the server
  syncAlertToggles();

  // Re-subscribe silently if alerts were on (e.g. server rotated keys).
  if (prefs.alerts && state.mode === 'server' && Notification.permission === 'granted' && !state.pushSub) {
    enableAlerts().then(syncAlertToggles);
  }

  // 3) Deep link (?id=) e.g. from a notification; otherwise preselect the top story on desktop.
  const params = new URLSearchParams(location.search);
  const view = params.get('view');
  if (['high', 'commodities', 'macro', 'settings'].includes(view)) setView(view);
  const id = params.get('id');
  if (id && state.articles.has(id)) {
    history.replaceState(null, '', location.pathname);
    selectArticle(id, { scroll: true });
  } else if (!mobileMq.matches) {
    const first = visibleList()[0];
    if (first) selectArticle(first.id, { open: false });
  }
}

boot();
