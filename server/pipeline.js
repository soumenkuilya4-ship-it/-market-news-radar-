// Ingestion pipeline shared by the live server and the static (GitHub Actions) build.
import { analyzeArticle } from '../docs/js/analyzer.js';
import { aiAnalyze } from './ai.js';
import { FEEDS, fetchFeed, hashId } from './feeds.js';

export const feedStatus = Object.fromEntries(FEEDS.map((f) => [f.id, {
  id: f.id, name: f.name, category: f.category, url: f.url, ok: null, lastFetch: null, lastError: null, items: 0,
}]));

/** Build a stored article from a raw item using the rules engine. */
export function toArticle(item) {
  const analysis = analyzeArticle(item);
  const now = new Date().toISOString();
  return { ...item, ...analysis, ingestedAt: now, updatedAt: now };
}

/** Merge a Claude analysis into an article, keeping rules values for anything missing. */
export function mergeAi(article, ai) {
  if (!ai) return null;
  const patch = {};
  for (const [k, v] of Object.entries(ai)) if (v !== undefined && v !== null && v !== '') patch[k] = v;
  patch.updatedAt = new Date().toISOString();
  return patch;
}

/**
 * Poll every feed once.
 * @param {import('./store.js').ArticleStore} store
 * @param {{onNew?: (a) => void, onUpdate?: (a) => void, aiLimit?: number}} hooks
 */
export async function pollFeeds(store, { onNew, onUpdate, aiLimit = 25 } = {}) {
  const results = await Promise.allSettled(FEEDS.map(async (feed) => {
    const status = feedStatus[feed.id];
    status.lastFetch = new Date().toISOString();
    try {
      const items = await fetchFeed(feed);
      status.ok = true;
      status.lastError = null;
      status.items = items.length;
      return items;
    } catch (err) {
      status.ok = false;
      status.lastError = err.cause?.code || err.message;
      console.warn(`[feeds] ${feed.name}: ${status.lastError}`);
      return [];
    }
  }));

  const fresh = [];
  for (const r of results) {
    for (const item of r.value || []) {
      if (store.has(item)) continue;
      const article = toArticle(item);
      if (store.add(article)) fresh.push(article);
    }
  }
  fresh.sort((a, b) => a.publishedAt.localeCompare(b.publishedAt));
  for (const a of fresh) onNew?.(a);

  // Claude enrichment for the newest items (bounded per cycle to keep cost predictable).
  const aiTargets = fresh.slice(-aiLimit).reverse();
  await Promise.all(aiTargets.map(async (a) => {
    const prevImpact = a.impact;
    const patch = mergeAi(a, await aiAnalyze(a));
    if (patch) onUpdate?.(store.update(a.id, patch), prevImpact);
  }));

  return fresh;
}

/** Analyse a manually pasted article. */
export async function analyzeManual({ title, text, url }) {
  const body = String(text || '').trim();
  let headline = String(title || '').trim();
  if (!headline) headline = body.split(/(?<=[.!?])\s|\n/)[0].slice(0, 160) || 'Manual post';
  const item = {
    id: hashId(url, `${headline}|${body.slice(0, 200)}`),
    urlHash: url ? hashId(url) : undefined,
    title: headline,
    description: body.slice(0, 6000),
    url: url || null,
    publishedAt: new Date().toISOString(),
    source: 'Manual Post',
    sourceId: 'manual',
    category: undefined,
  };
  const article = toArticle(item);
  const ai = mergeAi(article, await aiAnalyze(article));
  return ai ? { ...article, ...ai } : article;
}
