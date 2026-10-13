// Tiny JSON-file persistence for articles and push subscriptions.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class JsonStore {
  constructor(file, fallback) {
    this.file = file;
    this.fallback = fallback;
    this.data = structuredClone(fallback);
    this.timer = null;
  }

  async load() {
    try {
      this.data = JSON.parse(await readFile(this.file, 'utf8'));
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[store] could not read ${this.file}: ${err.message}`);
      this.data = structuredClone(this.fallback);
    }
    return this.data;
  }

  /** Debounced atomic write. */
  save(delay = 500) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush().catch((e) => console.error('[store]', e)), delay);
  }

  async flush() {
    clearTimeout(this.timer);
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(this.data));
    await rename(tmp, this.file);
  }
}

/** Article collection with GUID/URL de-duplication. */
export class ArticleStore {
  constructor(file, max = 1000) {
    this.store = new JsonStore(file, { articles: [] });
    this.max = max;
    this.byId = new Map();
    this.urlHashes = new Set();
  }

  async load() {
    await this.store.load();
    for (const a of this.store.data.articles) {
      this.byId.set(a.id, a);
      if (a.urlHash) this.urlHashes.add(a.urlHash);
    }
    return this;
  }

  get size() { return this.byId.size; }

  has(item) {
    return this.byId.has(item.id) || (item.urlHash && this.urlHashes.has(item.urlHash));
  }

  add(article) {
    if (this.has(article)) return false;
    this.byId.set(article.id, article);
    if (article.urlHash) this.urlHashes.add(article.urlHash);
    this.store.data.articles.push(article);
    this.trim();
    this.store.save();
    return true;
  }

  update(id, patch) {
    const a = this.byId.get(id);
    if (!a) return null;
    Object.assign(a, patch);
    this.store.save();
    return a;
  }

  trim() {
    const list = this.store.data.articles;
    if (list.length <= this.max) return;
    list.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    for (const a of list.splice(this.max)) this.byId.delete(a.id);
    this.urlHashes = new Set(list.map((a) => a.urlHash).filter(Boolean));
  }

  list({ limit = 200, since, q, assetClass, impact } = {}) {
    let out = [...this.byId.values()];
    if (since) out = out.filter((a) => a.ingestedAt > since || a.updatedAt > since);
    if (assetClass) out = out.filter((a) => a.assetClass === assetClass);
    if (impact) out = out.filter((a) => a.impact === impact);
    if (q) {
      const t = q.toLowerCase();
      out = out.filter((a) => `${a.title} ${a.description} ${a.subSector} ${(a.instruments || []).join(' ')}`.toLowerCase().includes(t));
    }
    out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    return out.slice(0, limit);
  }

  flush() { return this.store.flush(); }
}
