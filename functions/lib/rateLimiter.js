// lib/rateLimiter.js
// Simple in-memory rate limiter for Firebase Cloud Functions.
// Each function instance has its own memory, so this is per-instance.
// For multi-instance rate limiting, use Firestore counters or Redis.

'use strict';

class RateLimiter {
  /**
   * @param {{ windowMs: number, maxPerMin: number }} opts
   */
  constructor({ windowMs = 60000, maxPerMin = 60 } = {}) {
    this.windowMs  = windowMs;
    this.maxPerMin = maxPerMin;
    this._store    = new Map(); // ip -> [timestamps]
  }

  _getKey(req) {
    return req.headers['x-forwarded-for']?.split(',')[0].trim()
      || req.connection?.remoteAddress
      || 'unknown';
  }

  isAllowed(req) {
    const key  = this._getKey(req);
    const now  = Date.now();
    const hits = (this._store.get(key) || []).filter(t => now - t < this.windowMs);
    hits.push(now);
    this._store.set(key, hits);
    // Evict old keys periodically
    if (this._store.size > 10000) {
      for (const [k, ts] of this._store) {
        if (ts.every(t => now - t > this.windowMs)) this._store.delete(k);
      }
    }
    return hits.length <= this.maxPerMin;
  }

  /**
   * Wrap an Express-style handler with rate limiting.
   * @param {Function} handler
   * @returns {Function}
   */
  wrap(handler) {
    return (req, res) => {
      if (!this.isAllowed(req)) {
        res.status(429).json({ error: 'Too many requests. Please slow down.' });
        return;
      }
      // CORS headers for mdothree sub-domains
      res.set('Access-Control-Allow-Origin', '*');
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      if (req.method === 'OPTIONS') { res.status(204).send(''); return; }
      return handler(req, res);
    };
  }
}

module.exports = { RateLimiter };
