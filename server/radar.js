// Per-symbol / per-sector news summary for the MASTER SHEET's News Radar tab.
// Given rows like {type: 'HOLDING', key: 'TIPSMUSIC', name: 'Tips Music Ltd'} it returns
// the latest headline, overall sentiment, catalysts, risks and a suggested action,
// from stories in the last RADAR_DAYS days. Rows with no matching news are omitted so
// the sheet can fall back to its own data.
import { INDUSTRY_SUBSECTOR, stockAliases } from '../docs/js/analyzer.js';

const RADAR_DAYS = Number(process.env.RADAR_DAYS || 7);
const WEIGHT = { High: 3, Medium: 2, Low: 1 };
const RED_FLAG = /\b(fraud|probe|raid|search(es)? and seizure|sebi (order|ban|bars|notice|penalty)|penalt(y|ies)|fine[sd]?\b|default|insolven|bankrupt|resign|pledge|downgrade|auditor|forensic|show[- ]cause|lawsuit|recall|warning letter|import alert|form 483|observations?\b|promoter(s)? (sell|selling|offload)|stake sale|offer for sale|ofs\b|loss widen|guidance cut|delist)/i;

const fmtDate = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Sub-sectors (as tagged by the analyzer) that a sheet sector key covers. */
function sectorSubSectors(key) {
  const k = String(key).trim().toLowerCase();
  if (k === 'financials' || k === 'financial services') return ['NBFC & Financials', 'Banking'];
  if (k === 'bank' || k === 'banks' || k === 'banking') return ['Banking'];
  const mapped = INDUSTRY_SUBSECTOR[k];
  return mapped ? [mapped] : [];
}

function matcherFor(row) {
  const type = String(row.type || '').toUpperCase();
  const key = String(row.key || '').trim().toUpperCase();
  if (type === 'MARKET') {
    return (a) => a.assetClass === 'Macro' || ['Markets', 'Central Bank'].includes(a.subSector) || (a.impact === 'High' && a.assetClass !== 'Commodities');
  }
  if (type === 'SECTOR') {
    const subs = sectorSubSectors(row.key);
    if (!subs.length) return null;
    return (a) => subs.includes(a.subSector);
  }
  // Stock rows: tagged instrument, or the company name in the text.
  const aliases = row.name && row.name.toUpperCase() !== key ? stockAliases(row.name) : [];
  const nameRe = aliases.length ? new RegExp(`(?<![a-z0-9&])(${aliases.map(escapeRe).join('|')})(?![a-z0-9&])`, 'i') : null;
  return (a) => (a.instruments || []).includes(key)
    || (nameRe && nameRe.test(`${a.title} ${a.description || ''}`));
}

function summarise(row, list) {
  const sorted = [...list].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const latest = sorted[0];
  let score = 0;
  let bull = 0;
  let bear = 0;
  for (const a of sorted) {
    const w = WEIGHT[a.impact] || 1;
    if (a.sentiment === 'Bullish') { score += w; bull++; }
    if (a.sentiment === 'Bearish') { score -= w; bear++; }
  }
  const counts = `${bull} bullish, ${bear} bearish, ${sorted.length} stor${sorted.length === 1 ? 'y' : 'ies'} (${RADAR_DAYS}d)`;
  const sentiment = score > 0 ? `🟢 POSITIVE – ${counts}` : score < 0 ? `🔴 NEGATIVE – ${counts}` : `🟡 NEUTRAL – ${counts}`;
  const line = (a) => `${fmtDate.format(new Date(a.publishedAt))}: ${clip(a.title, 140)}`;
  const flagged = sorted.filter((a) => RED_FLAG.test(`${a.title} ${a.description || ''}`));
  const catalysts = sorted.filter((a) => a.sentiment === 'Bullish').slice(0, 2).map(line);
  const risks = [...flagged.map((a) => `🚩 ${line(a)}`), ...sorted.filter((a) => a.sentiment === 'Bearish' && !flagged.includes(a)).map(line)].slice(0, 2);
  let action = '🟡 MONITOR – no strong signal';
  if (flagged.length) action = '🚩 REVIEW – red flag in news';
  else if (score <= -3) action = '🔴 CAUTION – negative news flow';
  else if (sorted.some((a) => a.sentiment === 'Bullish' && a.impact === 'High')) action = '🟢 SUPPORTIVE – high-impact positive news';
  else if (score > 0) action = '🟢 SUPPORTIVE – positive news flow';
  return {
    key: `${String(row.type).toUpperCase()}-${String(row.key).trim().toUpperCase()}`,
    type: String(row.type).toUpperCase(),
    symbol: String(row.key).trim().toUpperCase(),
    headline: `${line(latest)} [${latest.impact} · ${latest.sentiment} · ${latest.source}]`,
    sentiment,
    catalysts: catalysts.join('\n') || 'None in news',
    risks: risks.join('\n') || 'None in news',
    action,
    stories: sorted.length,
    latestAt: latest.publishedAt,
    url: latest.url || '',
  };
}

/** Build radar rows for the requested keys from the stored articles. */
export function buildRadar(rows, articles, now = Date.now()) {
  const since = new Date(now - RADAR_DAYS * 24 * 3600_000).toISOString();
  const recent = articles.filter((a) => a.publishedAt >= since);
  const out = [];
  const seen = new Set();
  for (const row of rows || []) {
    if (!row?.type || !row?.key) continue;
    const id = `${String(row.type).toUpperCase()}-${String(row.key).trim().toUpperCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const match = matcherFor(row);
    if (!match) continue;
    const hits = recent.filter(match);
    if (hits.length) out.push(summarise(row, hits));
  }
  return { generatedAt: new Date(now).toISOString(), days: RADAR_DAYS, rows: out };
}
