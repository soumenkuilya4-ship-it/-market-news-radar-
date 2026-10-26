import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { analyzeArticle, cleanText } from '../docs/js/analyzer.js';
import { parseDate, parseFeed } from '../server/feeds.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const feed = (id, category = 'Equities') => ({ id, name: id, category });

test('parses RSS items with CDATA, entities and tracking params', () => {
  const items = parseFeed(fixture('moneycontrol.xml'), feed('moneycontrol'));
  assert.equal(items.length, 3);
  const [first] = items;
  assert.equal(first.title, 'Tata Motors shares fall 6% after Q2 net profit misses estimates');
  assert.equal(first.url, 'https://www.moneycontrol.com/news/business/tata-motors-q2-123.html');
  assert.match(first.description, /₹3,450 crore/);
  assert.equal(first.publishedAt, '2026-10-13T04:45:00.000Z');
});

test('duplicate items share a URL hash', () => {
  const items = parseFeed(fixture('moneycontrol.xml'), feed('moneycontrol'));
  assert.equal(items[0].urlHash, items[2].urlHash);
  assert.notEqual(items[0].urlHash, items[1].urlHash);
});

test('parses NSE IST timestamps', () => {
  assert.equal(parseDate('13-Oct-2026 17:05:00'), '2026-10-13T11:35:00.000Z');
  const items = parseFeed(fixture('nse.xml'), feed('nse'));
  assert.equal(items[0].publishedAt, '2026-10-13T11:35:00.000Z');
});

test('parses Atom feeds', () => {
  const items = parseFeed(fixture('atom.xml'), feed('atom', 'Geopolitics'));
  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://example.com/a1');
  assert.equal(items[0].description, 'Brent crude jumped 3% after the announcement.');
});

test('cleanText strips markup and decodes entities', () => {
  assert.equal(cleanText('<p>Rs&nbsp;100 &amp; <b>more</b></p>'), 'Rs 100 & more.');
});

test('RBI rate cut is Macro / Central Bank / High / Bullish', () => {
  const [item] = parseFeed(fixture('rbi.xml'), feed('rbi', 'Macro'));
  const a = analyzeArticle(item);
  assert.equal(a.assetClass, 'Macro');
  assert.equal(a.subSector, 'Central Bank');
  assert.equal(a.impact, 'High');
  assert.equal(a.sentiment, 'Bullish');
  assert.equal(a.summary.length, 3);
});

test('routine RBI operations notice is Low impact', () => {
  const items = parseFeed(fixture('rbi.xml'), feed('rbi', 'Macro'));
  assert.equal(analyzeArticle(items[1]).impact, 'Low');
});

test('gold record is Commodities / Precious Metals / Bullish with GOLD in focus', () => {
  const [item] = parseFeed(fixture('investing.xml'), feed('investing', 'Commodities'));
  const a = analyzeArticle(item);
  assert.equal(a.assetClass, 'Commodities');
  assert.equal(a.subSector, 'Precious Metals');
  assert.equal(a.sentiment, 'Bullish');
  assert.ok(a.instruments.includes('GOLD'));
  assert.equal(a.tvSymbol, 'TVC:GOLD');
});

test('earnings miss is Equities / Auto / Bearish', () => {
  const [item] = parseFeed(fixture('moneycontrol.xml'), feed('moneycontrol'));
  const a = analyzeArticle(item);
  assert.equal(a.assetClass, 'Equities');
  assert.equal(a.subSector, 'Auto');
  assert.equal(a.sentiment, 'Bearish');
  assert.deepEqual(a.instruments, ['TATAMOTORS']);
  assert.ok(a.keyNumbers.some((k) => k.value === '₹3,450 crore'));
});

test('bank results beat is Banking / Bullish', () => {
  const items = parseFeed(fixture('moneycontrol.xml'), feed('moneycontrol'));
  const a = analyzeArticle(items[1]);
  assert.equal(a.subSector, 'Banking');
  assert.equal(a.sentiment, 'Bullish');
  assert.ok(a.instruments.includes('HDFCBANK'));
});

test('sanctions story is Geopolitics / High', () => {
  const [item] = parseFeed(fixture('atom.xml'), feed('atom', 'Equities'));
  const a = analyzeArticle(item);
  assert.equal(a.assetClass, 'Geopolitics');
  assert.equal(a.impact, 'High');
});

test('word matching does not confuse "bank" with "ban"', () => {
  const a = analyzeArticle({ title: 'State Bank of India opens new branch in Pune', description: '' });
  assert.equal(a.sentiment, 'Neutral');
});

test('falls back to the next feed address when one fails', async () => {
  const { createServer } = await import('node:http');
  const { fetchFeed } = await import('../server/feeds.js');
  const xml = readFileSync(new URL('./fixtures/nse.xml', import.meta.url), 'utf8');
  const srv = createServer((req, res) => {
    if (req.url === '/new.xml') { res.writeHead(200, { 'Content-Type': 'application/rss+xml' }); res.end(xml); } else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => srv.listen(0, r));
  const base = `http://localhost:${srv.address().port}`;
  try {
    const items = await fetchFeed({ id: 'nse', name: 'NSE', category: 'Equities', url: `${base}/old.xml`, fallbacks: [`${base}/new.xml`] });
    assert.equal(items.length, 2);
    await assert.rejects(fetchFeed({ id: 'x', name: 'x', url: `${base}/gone.xml` }), /HTTP 404/);
  } finally {
    srv.close();
  }
});
