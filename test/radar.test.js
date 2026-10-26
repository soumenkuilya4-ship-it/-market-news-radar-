import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setStockUniverse } from '../docs/js/analyzer.js';
import { toArticle } from '../server/pipeline.js';
import { buildRadar } from '../server/radar.js';

const NOW = Date.parse('2026-10-26T10:00:00Z');
const at = (h) => new Date(NOW - h * 3600_000).toISOString();
const art = (title, hoursAgo, extra = {}) => ({ ...toArticle({ id: title, title, description: '', publishedAt: at(hoursAgo), source: 'Test', category: 'Equities', ...extra }), publishedAt: at(hoursAgo) });

setStockUniverse([
  { symbol: 'TIPSMUSIC', name: 'Tips Music Limited', industry: 'media' },
  { symbol: 'KROSS', name: 'Kross Limited', industry: 'auto' },
]);

const articles = [
  art('Tips Music Q2 profit jumps 40%, declares interim dividend', 5),
  art('Tips Music shares fall 6% after promoter stake sale', 2),
  art('Kross bags large axle order from Tata Motors', 30),
  art('Old news: Kross wins order', 24 * 10),
  art('HDFC Bank Q2 net profit rises 12%, beats estimates', 3),
  art('RBI cuts repo rate by 25 bps to 5.25%', 1, { category: 'Macro' }),
];

test('summarises a holding with red flags first', () => {
  const { rows } = buildRadar([{ type: 'HOLDING', key: 'TIPSMUSIC', name: 'TIPSMUSIC' }], articles, NOW);
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.key, 'HOLDING-TIPSMUSIC');
  assert.equal(r.stories, 2);
  assert.match(r.headline, /promoter stake sale/);
  assert.match(r.risks, /^🚩/);
  assert.match(r.action, /REVIEW/);
});

test('matches by company name and ignores news older than the window', () => {
  const { rows } = buildRadar([{ type: 'QUALIFIER', key: 'KROSS', name: 'Kross Ltd' }], articles, NOW);
  assert.equal(rows[0].stories, 1);
  assert.match(rows[0].sentiment, /POSITIVE/);
});

test('maps sheet sectors and the market row', () => {
  const { rows } = buildRadar([
    { type: 'SECTOR', key: 'BANK' }, { type: 'SECTOR', key: 'FINANCIALS' }, { type: 'MARKET', key: 'NIFTY' }, { type: 'SECTOR', key: 'UNKNOWN' },
  ], articles, NOW);
  const keys = rows.map((r) => r.key);
  assert.deepEqual(keys, ['SECTOR-BANK', 'SECTOR-FINANCIALS', 'MARKET-NIFTY']);
  assert.match(rows[2].headline, /repo rate/);
});

test('omits rows with no news and duplicate keys', () => {
  const { rows } = buildRadar([{ type: 'HOLDING', key: 'NOPE', name: 'NOPE' }, { type: 'QUALIFIER', key: 'KROSS', name: 'Kross Ltd' }, { type: 'QUALIFIER', key: 'KROSS', name: 'Kross Ltd' }], articles, NOW);
  assert.deepEqual(rows.map((r) => r.key), ['QUALIFIER-KROSS']);
});
