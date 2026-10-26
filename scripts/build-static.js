// Static snapshot build for GitHub Pages / any static host.
// Polls the feeds once, analyses new items, merges them into docs/news.json and,
// if TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set, sends a digest of new
// High/Medium impact stories to Telegram.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { aiInfo } from '../server/ai.js';
import { FEEDS } from '../server/feeds.js';
import { feedStatus, pollFeeds } from '../server/pipeline.js';
import { loadStockUniverse, stockInfo, stockPayload } from '../server/stocks.js';

const OUT = process.env.STATIC_OUT || new URL('../docs/news.json', import.meta.url);
const KEEP = Number(process.env.STATIC_KEEP || 300);

// Minimal in-memory store with the same interface pollFeeds uses.
class MemoryStore {
  constructor(articles) {
    this.byId = new Map(articles.map((a) => [a.id, a]));
    this.urlHashes = new Set(articles.map((a) => a.urlHash).filter(Boolean));
  }
  has(item) { return this.byId.has(item.id) || (item.urlHash && this.urlHashes.has(item.urlHash)); }
  add(a) {
    if (this.has(a)) return false;
    this.byId.set(a.id, a);
    if (a.urlHash) this.urlHashes.add(a.urlHash);
    return true;
  }
  update(id, patch) { const a = this.byId.get(id); if (a) Object.assign(a, patch); return a; }
}

let previous = [];
try {
  previous = JSON.parse(await readFile(OUT, 'utf8')).articles || [];
} catch { /* first run */ }

await loadStockUniverse(process.env.DATA_DIR || fileURLToPath(new URL('../data', import.meta.url)));
if (stockInfo.count) {
  await writeFile(new URL('../docs/stocks.json', import.meta.url), JSON.stringify(stockPayload()));
}
console.log(`stocks: ${stockInfo.count || 'built-in'} (${stockInfo.source})`);

const store = new MemoryStore(previous);
const fresh = await pollFeeds(store, { aiLimit: Number(process.env.AI_LIMIT || 40) });

const articles = [...store.byId.values()]
  .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  .slice(0, KEEP);

await writeFile(OUT, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  feeds: Object.values(feedStatus),
  ai: aiInfo,
  articles,
}, null, 1)}\n`);

console.log(`news.json: ${fresh.length} new, ${articles.length} total`);
for (const f of FEEDS) {
  const s = feedStatus[f.id];
  console.log(`  ${s.ok ? 'ok ' : 'ERR'} ${f.name}: ${s.ok ? `${s.items} items` : s.lastError}`);
}

// ---------------------------------------------------------------------------
// Telegram digest (optional)
// ---------------------------------------------------------------------------
const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId, APP_URL: appUrl } = process.env;
if (token && chatId && previous.length) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const notable = fresh
    .filter((a) => a.impact !== 'Low')
    .sort((a, b) => (a.impact === b.impact ? b.publishedAt.localeCompare(a.publishedAt) : a.impact === 'High' ? -1 : 1))
    .slice(0, 12);
  if (notable.length) {
    const icon = { High: '🔴', Medium: '🟠' };
    const sent = { Bullish: '▲', Bearish: '▼', Neutral: '■' };
    let text = `<b>📡 Market Radar digest</b> — ${notable.length} notable of ${fresh.length} new\n\n`;
    for (const a of notable) {
      const line = `${icon[a.impact]} <b>${esc(a.title)}</b>\n${sent[a.sentiment]} ${esc(a.sentiment)} · ${esc(a.assetClass)} · ${esc(a.subSector)}\n• ${esc(a.summary[1])}${a.url ? `\n<a href="${esc(a.url)}">Source</a>` : ''}\n\n`;
      if (text.length + line.length > 3800) break;
      text += line;
    }
    if (appUrl) text += `<a href="${esc(appUrl)}">Open Market Radar</a>`;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    });
    console.log(`Telegram digest: ${res.ok ? 'sent' : `failed (${res.status})`}`);
  }
}
