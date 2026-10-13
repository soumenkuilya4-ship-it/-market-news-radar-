// Optional Claude enrichment. When ANTHROPIC_API_KEY (or another SDK credential) is
// configured, new articles are tagged by Claude; otherwise, or on any failure, the
// rules engine result is kept. The rules engine always runs first, so the feed never
// waits on the API.
import Anthropic from '@anthropic-ai/sdk';
import { ASSET_CLASSES, IMPACTS, SENTIMENTS, tradingViewSymbol } from '../docs/js/analyzer.js';

const MODEL = process.env.AI_MODEL || 'claude-opus-5-5';
const ENABLED = process.env.AI_ENABLED !== 'false' && Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);

let client = null;
if (ENABLED) client = new Anthropic({ maxRetries: 2, timeout: 60_000 });

export const aiInfo = { enabled: ENABLED, model: ENABLED ? MODEL : null };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['assetClass', 'subSector', 'impact', 'sentiment', 'summary', 'instruments'],
  properties: {
    assetClass: { type: 'string', enum: ASSET_CLASSES },
    subSector: { type: 'string', description: 'Short sub-sector label, e.g. Banking, Auto, Energy, Metals, Central Bank, IT & Tech, Pharma & Healthcare, Precious Metals, Trade & Tariffs' },
    impact: { type: 'string', enum: IMPACTS },
    sentiment: { type: 'string', enum: SENTIMENTS },
    summary: {
      type: 'array',
      items: { type: 'string' },
      description: 'Exactly 3 bullets: [0] what happened, [1] direct market impact, [2] key stocks/instruments in focus',
    },
    instruments: {
      type: 'array',
      items: { type: 'string' },
      description: 'Up to 5 tickers or instruments in focus, NSE symbols for Indian stocks (e.g. RELIANCE, HDFCBANK) or names like NIFTY 50, BANK NIFTY, GOLD, BRENT, USD/INR, IN 10Y',
    },
  },
};

const SYSTEM = `You are a sell-side market strategist covering Indian equities, commodities, macro and geopolitics.
Classify a single news item for a trading desk news radar.

- assetClass: the market the news moves most directly.
- impact: High only for news likely to move an index, a sector, a large-cap stock by 3%+, rates, the rupee or a major commodity today (policy rate decisions, inflation/GDP surprises, M&A, big earnings misses or beats, regulatory bans, wars and sanctions, tariffs). Medium for routine but price-relevant company or sector news. Low for procedural filings and minor updates.
- sentiment: the likely direction for the instruments in focus.
- summary: exactly three crisp bullets of at most 30 words each, no leading bullet characters: what happened; the direct market impact; the key stocks or instruments in focus.
Use only facts stated in the item. Do not invent numbers.`;

let queue = Promise.resolve();

/**
 * Ask Claude to analyse an article. Resolves to a partial analysis or null.
 */
export async function aiAnalyze(article) {
  if (!client) return null;
  // Run one request at a time so a burst of new items doesn't hit rate limits.
  const run = queue.then(() => doAnalyze(article));
  queue = run.catch(() => {});
  return run;
}

async function doAnalyze(article) {
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 2048,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages: [{
        role: 'user',
        content: `Source: ${article.source}\nPublished: ${article.publishedAt}\nHeadline: ${article.title}\n\nText:\n${article.description || '(headline only)'}`,
      }],
    });
    if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') return null;
    const text = response.content.find((b) => b.type === 'text')?.text;
    if (!text) return null;
    const data = JSON.parse(text);
    if (!Array.isArray(data.summary) || data.summary.length < 3) return null;
    const instruments = (data.instruments || []).slice(0, 5);
    return {
      assetClass: data.assetClass,
      subSector: data.subSector,
      impact: data.impact,
      sentiment: data.sentiment,
      summary: data.summary.slice(0, 3),
      instruments: instruments.length ? instruments : undefined,
      tvSymbol: tradingViewSymbol(instruments[0]) || (instruments[0] && /^[A-Z&-]+$/.test(instruments[0]) ? `BSE:${instruments[0].replace('-', '_')}` : undefined),
      engine: 'claude',
    };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) console.warn('[ai] rate limited, using rules engine');
    else if (err instanceof Anthropic.AuthenticationError) console.warn('[ai] authentication failed, check ANTHROPIC_API_KEY');
    else if (err instanceof Anthropic.APIError) console.warn(`[ai] API error ${err.status}: ${err.message}`);
    else console.warn('[ai] analysis failed:', err.message);
    return null;
  }
}
