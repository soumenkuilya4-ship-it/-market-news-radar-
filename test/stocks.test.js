import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { analyzeArticle, setStockUniverse, stockAliases, tradingViewSymbol } from '../docs/js/analyzer.js';
import { parseConstituentsCsv } from '../server/stocks.js';

const rows = parseConstituentsCsv(readFileSync(new URL('./fixtures/nifty_sample.csv', import.meta.url), 'utf8'));

test('parses the NSE constituents CSV', () => {
  assert.equal(rows.length, 13);
  assert.deepEqual(rows.find((r) => r.symbol === 'DRREDDY'), { symbol: 'DRREDDY', name: "Dr. Reddy's Laboratories Ltd.", industry: 'Healthcare' });
});

test('builds short aliases only when they are distinctive', () => {
  assert.deepEqual(stockAliases('Polycab India Ltd.'), ['polycab india', 'polycab']);
  assert.deepEqual(stockAliases('Container Corporation of India Ltd.'), ['container corporation of india']);
  assert.deepEqual(stockAliases('Tata Power Co. Ltd.'), ['tata power co.', 'tata power']);
});

test('recognises mid-cap companies and uses their NSE industry', () => {
  setStockUniverse(rows);
  const a = analyzeArticle({ title: 'Dixon Technologies bags new smartphone manufacturing contract', description: '' });
  assert.ok(a.instruments.includes('DIXON'));
  assert.equal(a.subSector, 'FMCG & Consumer');
  assert.equal(tradingViewSymbol('DIXON'), 'BSE:DIXON');
  const b = analyzeArticle({ title: 'Polycab shares rally 7% after strong quarter', description: '' });
  assert.ok(b.instruments.includes('POLYCAB'));
  assert.equal(b.subSector, 'Infra & Capital Goods');
});

test('matches capitalised NSE symbols such as IRCTC', () => {
  setStockUniverse(rows);
  const a = analyzeArticle({ title: 'IRCTC raises convenience fee on online tickets', description: '' });
  assert.ok(a.instruments.includes('IRCTC'));
});

test('does not mistake the Reserve Bank of India for Bank of India', () => {
  setStockUniverse(rows);
  const a = analyzeArticle({ title: 'Reserve Bank of India keeps repo rate unchanged', description: '' });
  assert.ok(!a.instruments.includes('BANKINDIA'));
  const b = analyzeArticle({ title: 'Bank of India cuts lending rates', description: '' });
  assert.ok(b.instruments.includes('BANKINDIA'));
  const c = analyzeArticle({ title: 'Central Bank of India Q2 profit jumps', description: '' });
  assert.ok(c.instruments.includes('CENTRALBK'));
  assert.ok(!c.instruments.includes('BANKINDIA'));
});

test('does not duplicate stocks already in the built-in list', () => {
  setStockUniverse(rows);
  const a = analyzeArticle({ title: 'Mahindra & Mahindra SUV sales rise 20%', description: '' });
  assert.equal(a.instruments.filter((i) => i === 'M&M').length, 1);
});

test('recognises a distinctive first word only when capitalised', () => {
  setStockUniverse(rows);
  assert.ok(analyzeArticle({ title: 'Suzlon wins 400 MW wind order', description: '' }).instruments.includes('SUZLON'));
  assert.ok(analyzeArticle({ title: 'Tata Power commissions solar plant', description: '' }).instruments.includes('TATAPOWER'));
  assert.ok(!analyzeArticle({ title: 'dixon is a surname here', description: '' }).instruments.includes('DIXON'));
});

test('loads the bundled RS Scanner universe', async () => {
  const { loadMyUniverse } = await import('../server/stocks.js');
  const mine = await loadMyUniverse('/nonexistent');
  assert.equal(mine.length, 1171);
  assert.deepEqual(mine.find((r) => r.symbol === 'KROSS'), { symbol: 'KROSS', name: '', industry: 'auto' });
});

test('names your symbols from the NSE equity list without adding other companies', async () => {
  const { buildUniverse } = await import('../server/stocks.js');
  const nameRows = parseConstituentsCsv(readFileSync(new URL('./fixtures/equity_l_sample.csv', import.meta.url), 'utf8'));
  assert.equal(nameRows.length, 4);
  const mine = [{ symbol: 'KROSS', name: '', industry: 'auto' }, { symbol: 'TIPSMUSIC', name: '', industry: 'media' }];
  const uni = buildUniverse(mine, rows, nameRows);
  assert.equal(uni.find((r) => r.symbol === 'KROSS').name, 'Kross Limited');
  assert.ok(!uni.some((r) => r.symbol === 'ZZZNOTMINE'));
  assert.equal(uni.length, rows.length + 2);
  setStockUniverse(uni);
  const a = analyzeArticle({ title: 'Tips Music signs licensing deal with global streaming platform', description: '' });
  assert.ok(a.instruments.includes('TIPSMUSIC'));
  assert.equal(a.subSector, 'Telecom & Media');
});

test('symbols without names still match in capitals', () => {
  setStockUniverse([{ symbol: 'KROSS', name: '', industry: 'auto' }, { symbol: 'GLOBAL', name: '', industry: 'services' }]);
  assert.ok(analyzeArticle({ title: 'KROSS bags axle order from Tata', description: '' }).instruments.includes('KROSS'));
  assert.ok(!analyzeArticle({ title: 'GLOBAL markets slide', description: '' }).instruments.includes('GLOBAL'));
});
