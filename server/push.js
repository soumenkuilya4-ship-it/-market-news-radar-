// Web Push (VAPID) delivery for High-impact alerts.
import webpush from 'web-push';
import { JsonStore } from './store.js';

export class PushService {
  constructor(dataDir) {
    this.keys = new JsonStore(`${dataDir}/vapid.json`, null);
    this.subs = new JsonStore(`${dataDir}/subscriptions.json`, { subscriptions: [] });
    this.publicKey = null;
  }

  async init() {
    let keys = null;
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      keys = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
    } else {
      keys = await this.keys.load();
      if (!keys?.publicKey) {
        keys = webpush.generateVAPIDKeys();
        this.keys.data = keys;
        await this.keys.flush();
        console.log(`[push] generated VAPID keys in ${this.keys.file}`);
      }
    }
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:alerts@market-radar.local', keys.publicKey, keys.privateKey);
    this.publicKey = keys.publicKey;
    await this.subs.load();
    return this;
  }

  get count() { return this.subs.data.subscriptions.length; }

  subscribe(sub) {
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) throw new Error('Invalid subscription');
    const list = this.subs.data.subscriptions.filter((s) => s.endpoint !== sub.endpoint);
    list.push({ endpoint: sub.endpoint, keys: sub.keys, createdAt: new Date().toISOString() });
    this.subs.data.subscriptions = list;
    this.subs.save(0);
  }

  unsubscribe(endpoint) {
    this.subs.data.subscriptions = this.subs.data.subscriptions.filter((s) => s.endpoint !== endpoint);
    this.subs.save(0);
  }

  /** Send a payload to every subscriber; prune expired endpoints. */
  async broadcast(payload, onlyEndpoint) {
    const body = JSON.stringify(payload);
    const gone = [];
    const targets = this.subs.data.subscriptions.filter((s) => !onlyEndpoint || s.endpoint === onlyEndpoint);
    await Promise.all(targets.map(async (s) => {
      try {
        await webpush.sendNotification(s, body, { TTL: 3600, urgency: 'high', topic: String(payload.id || '').slice(0, 32) });
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) gone.push(s.endpoint);
        else console.warn(`[push] send failed (${err.statusCode || err.message})`);
      }
    }));
    if (gone.length) {
      this.subs.data.subscriptions = this.subs.data.subscriptions.filter((s) => !gone.includes(s.endpoint));
      this.subs.save(0);
    }
  }

  notifyArticle(a) {
    return this.broadcast({
      id: a.id,
      title: `🔴 HIGH IMPACT · ${a.assetClass} · ${a.sentiment}`,
      body: `${a.title}\n${a.summary?.[1] || ''}`.slice(0, 240),
      url: `./?id=${encodeURIComponent(a.id)}`,
      tag: `radar-${a.id}`,
    });
  }
}
