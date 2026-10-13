// RSS/Atom ingestion: fetch, parse, normalise and hash feed items.
import { createHash } from 'node:crypto';
import { XMLParser } from 'fast-xml-parser';
import { cleanText } from '../docs/js/analyzer.js';

export const FEEDS = [
  { id: 'moneycontrol', name: 'Moneycontrol', category: 'Equities', url: 'https://www.moneycontrol.com/rss/business.xml' },
  { id: 'nse', name: 'NSE Announcements', category: 'Equities', url: 'https://www.nseindia.com/static/rss/announcements.xml', warmup: 'https://www.nseindia.com/' },
  { id: 'investing', name: 'Investing.com Commodities', category: 'Commodities', url: 'https://in.investing.com/rss/commodities.rss' },
  { id: 'rbi', name: 'RBI Press Releases', category: 'Macro', url: 'https://rbi.org.in/pressreleases_rss.xml' },
];
// Allow overriding a feed URL, e.g. FEED_NSE_URL=https://proxy.example/nse.xml
for (const f of FEEDS) f.url = process.env[`FEED_${f.id.toUpperCase()}_URL`] || f.url;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
  'Accept-Language': 'en-IN,en;q=0.9',
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: false,
  processEntities: true,
  htmlEntities: true,
  trimValues: true,
  isArray: (name) => name === 'item' || name === 'entry',
});

function text(v) {
  if (v == null) return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') return text(v['#text'] ?? v['@_href'] ?? '');
  return '';
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** Parse feed timestamps, including NSE's "13-Oct-2026 17:05:00" (IST, no zone). */
export function parseDate(raw) {
  const s = text(raw).trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{4})(?:[\sT]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    const utc = Date.UTC(+m[3], MONTHS[m[2].toLowerCase()], +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    return new Date(utc - 330 * 60_000).toISOString(); // IST -> UTC
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString();
  return null;
}

export function hashId(...parts) {
  const key = parts.map((p) => String(p || '').trim().toLowerCase()).find(Boolean) || Math.random().toString();
  return createHash('sha1').update(key).digest('hex').slice(0, 16);
}

function normaliseUrl(u) {
  try {
    const url = new URL(u);
    for (const p of [...url.searchParams.keys()]) if (/^utm_|^ref$|^cmp$/i.test(p)) url.searchParams.delete(p);
    url.hash = '';
    return url.toString();
  } catch {
    return u;
  }
}

/** Parse RSS 2.0, RSS 1.0 (RDF) or Atom XML into normalised items. */
export function parseFeed(xml, feed) {
  const doc = parser.parse(xml);
  const rawItems = doc?.rss?.channel?.item
    || doc?.['rdf:RDF']?.item
    || doc?.feed?.entry
    || doc?.channel?.item
    || [];
  const items = [];
  for (const it of rawItems) {
    const title = cleanText(text(it.title));
    if (!title) continue;
    let link = text(it.link);
    if (Array.isArray(it.link)) {
      const alt = it.link.find((l) => !l['@_rel'] || l['@_rel'] === 'alternate');
      link = text(alt || it.link[0]);
    }
    link = normaliseUrl(link.trim());
    const guid = text(it.guid || it.id);
    const description = cleanText(text(it.description || it.summary || it['content:encoded'] || it.content)).slice(0, 2000);
    const publishedAt = parseDate(it.pubDate || it.published || it.updated || it['dc:date']) || new Date().toISOString();
    items.push({
      id: hashId(guid && /^https?:/i.test(guid) ? normaliseUrl(guid) : guid, link, title),
      urlHash: hashId(link, title),
      title,
      description: description === title ? '' : description,
      url: link || null,
      publishedAt,
      source: feed.name,
      sourceId: feed.id,
      category: feed.category,
    });
  }
  return items;
}

const cookieJar = new Map(); // host -> cookie header

async function fetchText(url, feed, attempt = 0) {
  const host = new URL(url).host;
  const headers = { ...BROWSER_HEADERS };
  if (cookieJar.has(host)) headers.Cookie = cookieJar.get(host);
  if (feed.warmup) headers.Referer = feed.warmup;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000), redirect: 'follow' });
  if ((res.status === 401 || res.status === 403) && feed.warmup && attempt === 0) {
    // NSE requires session cookies issued by its home page.
    const warm = await fetch(feed.warmup, { headers: { ...BROWSER_HEADERS, Accept: 'text/html' }, signal: AbortSignal.timeout(20_000) });
    const cookies = warm.headers.getSetCookie?.() || [];
    if (cookies.length) cookieJar.set(host, cookies.map((c) => c.split(';')[0]).join('; '));
    return fetchText(url, feed, 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function fetchFeed(feed) {
  const xml = await fetchText(feed.url, feed);
  if (!/<(rss|feed|rdf:RDF|channel)[\s>]/i.test(xml)) throw new Error('Response is not an RSS/Atom document');
  return parseFeed(xml, feed);
}
