// Stock universe = your own list (server/my-universe.csv, from the RS Scanner sheet)
// + NIFTY 500 + NIFTY Microcap 250. Company names come from NSE's index files and its
// full equity list (EQUITY_L.csv), downloaded in the background, cached in
// data/stocks.json and refreshed weekly. data/my-universe.csv overrides the bundled
// list; data/stocks.csv (Company Name, Industry, Symbol) is used if downloads fail.
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setStockUniverse } from '../docs/js/analyzer.js';
import { JsonStore } from './store.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// Index lists: their members join the universe.
const INDEX_LISTS = (process.env.STOCK_LIST_URLS
  ? [process.env.STOCK_LIST_URLS.split(',').map((u) => u.trim()).filter(Boolean)]
  : [
    ['https://archives.nseindia.com/content/indices/ind_nifty500list.csv', 'https://niftyindices.com/IndexConstituent/ind_nifty500list.csv'],
    ['https://archives.nseindia.com/content/indices/ind_niftymicrocap250_list.csv', 'https://niftyindices.com/IndexConstituent/ind_niftymicrocap250_list.csv'],
  ]);
// Full NSE equity list: used only to look up company names for your symbols.
const NAME_LIST = ['https://archives.nseindia.com/content/equities/EQUITY_L.csv', 'https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv'];

const MAX_AGE_MS = 7 * 24 * 3600_000;
const CACHE_VERSION = 2; // bump when the universe definition changes
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'text/csv,text/plain,*/*',
  'Accept-Language': 'en-IN,en;q=0.9',
};

export const stockInfo = { count: 0, source: 'built-in list', updatedAt: null, error: null };
let current = [];

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

/** Parse an NSE index constituents CSV (Company Name, Industry, Symbol, Series, ISIN Code). */
export function parseConstituentsCsv(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const head = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (re) => head.findIndex((h) => re.test(h));
  const iName = col(/company|^name$|stock name/);
  const iSym = col(/^symbol$|symbol/);
  const iInd = col(/industry|sector/);
  if (iSym < 0) return [];
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const symbol = (cells[iSym] || '').toUpperCase();
    const name = iName >= 0 ? cells[iName] || '' : '';
    if (!symbol || !/^[A-Z0-9&_-]+$/.test(symbol)) continue;
    out.push({ symbol, name, industry: iInd >= 0 ? cells[iInd] || '' : '' });
  }
  return out;
}

async function download(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const rows = parseConstituentsCsv(await res.text());
  if (rows.length < 50) throw new Error('unexpected file format');
  return rows;
}

async function downloadFirst(mirrors, errors) {
  for (const url of mirrors) {
    try {
      return await download(url);
    } catch (err) {
      errors.push(`${url.split('/').pop()} from ${new URL(url).host}: ${err.cause?.code || err.message}`);
    }
  }
  return null;
}

/** Your own universe: data/my-universe.csv if present, else the bundled server/my-universe.csv. */
export async function loadMyUniverse(dataDir) {
  for (const file of [join(dataDir, 'my-universe.csv'), join(HERE, 'my-universe.csv')]) {
    try {
      const rows = parseConstituentsCsv(await readFile(file, 'utf8'));
      if (rows.length) return rows;
    } catch { /* try next */ }
  }
  return [];
}

/**
 * Combine your list with index members; fill in names and industries.
 * Index rows win for name/industry; the full NSE list supplies remaining names.
 */
export function buildUniverse(mine, indexRows, nameRows = []) {
  const names = new Map(nameRows.map((r) => [r.symbol, r.name]));
  const out = new Map();
  for (const r of indexRows) out.set(r.symbol, { ...r });
  for (const r of mine) {
    const prev = out.get(r.symbol);
    if (prev) { if (!prev.industry) prev.industry = r.industry; continue; }
    out.set(r.symbol, { symbol: r.symbol, name: r.name || '', industry: r.industry || '' });
  }
  for (const r of out.values()) if (!r.name && names.has(r.symbol)) r.name = names.get(r.symbol);
  return [...out.values()];
}

/** Download the lists (trying mirrors in order). Throws if nothing could be fetched. */
export async function downloadStockLists(mine = []) {
  const errors = [];
  const indexRows = [];
  for (const mirrors of INDEX_LISTS) indexRows.push(...((await downloadFirst(mirrors, errors)) || []));
  const nameRows = (await downloadFirst(NAME_LIST, errors)) || [];
  if (!indexRows.length && !nameRows.length) throw new Error(errors.join('; '));
  return buildUniverse(mine, indexRows, nameRows);
}

function apply(stocks, source, updatedAt) {
  current = stocks;
  stockInfo.count = setStockUniverse(stocks);
  stockInfo.source = source;
  stockInfo.updatedAt = updatedAt;
  return stockInfo;
}

/**
 * Load the stock universe: fresh cache → download → stale cache → data/stocks.csv → built-in list.
 * With `download: false` it never touches the network (instant start-up from what is on disk).
 * @param {string} dataDir
 * @param {{force?: boolean, download?: boolean}} opts
 */
export async function loadStockUniverse(dataDir, { force = false, download = true } = {}) {
  const cache = new JsonStore(join(dataDir, 'stocks.json'), null);
  const cached = await cache.load();
  const mine = await loadMyUniverse(dataDir);
  const fresh = cached?.stocks?.length && cached.version === CACHE_VERSION && Date.now() - new Date(cached.updatedAt).getTime() < MAX_AGE_MS;
  if (fresh && !force) return apply(cached.stocks, cached.source, cached.updatedAt);

  if (download) try {
    const stocks = await downloadStockLists(mine);
    const updatedAt = new Date().toISOString();
    const named = stocks.filter((s) => s.name).length;
    cache.data = { version: CACHE_VERSION, updatedAt, source: `Your list + NIFTY 500/Microcap 250 · ${named} named`, stocks };
    await cache.flush();
    stockInfo.error = null;
    console.log(`[stocks] downloaded ${stocks.length} NSE stocks`);
    return apply(stocks, cache.data.source, updatedAt);
  } catch (err) {
    stockInfo.error = err.message;
    console.warn(`[stocks] download failed (${err.message})`);
  }

  if (cached?.stocks?.length) return apply(buildUniverse(mine, cached.stocks), `${cached.source} (cached)`, cached.updatedAt);
  let extra = [];
  try {
    extra = parseConstituentsCsv(await readFile(join(dataDir, 'stocks.csv'), 'utf8'));
  } catch { /* no local CSV */ }
  if (mine.length || extra.length) {
    return apply(buildUniverse(mine, extra), extra.length ? 'Your list + data/stocks.csv' : 'Your list (symbols only — names not downloaded yet)', null);
  }
  return apply([], 'built-in list', null);
}

/** The universe in the compact form served to browsers: [symbol, name, industry]. */
export function stockPayload() {
  return {
    updatedAt: stockInfo.updatedAt,
    source: stockInfo.source,
    stocks: current.map((s) => [s.symbol, s.name, s.industry || '']),
  };
}
