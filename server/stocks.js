// NSE stock universe: NIFTY 500 + NIFTY Microcap 250 constituents (~750 companies).
// Downloaded from NSE, cached in data/stocks.json and refreshed weekly. A CSV you
// place at data/stocks.csv (same columns as NSE's index files) is used if downloads fail.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setStockUniverse } from '../docs/js/analyzer.js';
import { JsonStore } from './store.js';

const LISTS = (process.env.STOCK_LIST_URLS
  ? [process.env.STOCK_LIST_URLS.split(',').map((u) => u.trim()).filter(Boolean)]
  : [
    ['https://archives.nseindia.com/content/indices/ind_nifty500list.csv', 'https://niftyindices.com/IndexConstituent/ind_nifty500list.csv'],
    ['https://archives.nseindia.com/content/indices/ind_niftymicrocap250_list.csv', 'https://niftyindices.com/IndexConstituent/ind_niftymicrocap250_list.csv'],
  ]);

const MAX_AGE_MS = 7 * 24 * 3600_000;
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
  const iName = col(/company|name of company|^name$/);
  const iSym = col(/^symbol$|symbol/);
  const iInd = col(/industry|sector/);
  if (iName < 0 || iSym < 0) return [];
  const out = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    const symbol = (cells[iSym] || '').toUpperCase();
    const name = cells[iName] || '';
    if (!symbol || !name || !/^[A-Z0-9&_-]+$/.test(symbol)) continue;
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

function merge(groups) {
  const bySymbol = new Map();
  for (const rows of groups) for (const r of rows) if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, r);
  return [...bySymbol.values()];
}

/** Download every list (trying mirrors in order). Throws if none could be fetched. */
export async function downloadStockLists() {
  const groups = [];
  const errors = [];
  for (const mirrors of LISTS) {
    for (const url of mirrors) {
      try {
        groups.push(await download(url));
        break;
      } catch (err) {
        errors.push(`${url.split('/').pop()} from ${new URL(url).host}: ${err.cause?.code || err.message}`);
      }
    }
  }
  if (!groups.length) throw new Error(errors.join('; '));
  return merge(groups);
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
  const fresh = cached?.stocks?.length && Date.now() - new Date(cached.updatedAt).getTime() < MAX_AGE_MS;
  if (fresh && !force) return apply(cached.stocks, cached.source, cached.updatedAt);

  if (download) try {
    const stocks = await downloadStockLists();
    const updatedAt = new Date().toISOString();
    cache.data = { updatedAt, source: 'NSE (NIFTY 500 + Microcap 250)', stocks };
    await cache.flush();
    stockInfo.error = null;
    console.log(`[stocks] downloaded ${stocks.length} NSE stocks`);
    return apply(stocks, cache.data.source, updatedAt);
  } catch (err) {
    stockInfo.error = err.message;
    console.warn(`[stocks] download failed (${err.message})`);
  }

  if (cached?.stocks?.length) return apply(cached.stocks, `${cached.source} (cached)`, cached.updatedAt);
  try {
    const rows = parseConstituentsCsv(await readFile(join(dataDir, 'stocks.csv'), 'utf8'));
    if (rows.length) return apply(rows, 'data/stocks.csv', null);
  } catch { /* no local CSV */ }
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
