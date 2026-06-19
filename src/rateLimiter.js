// rateLimiter.js — IMPLEMENT THIS.
//
// A per-client token-bucket rate limiter. All time MUST come from the injected
// clock. See the README for the contract.
const { RealClock } = require('./clock');

class RateLimiter {
  /**
   * @param {{ capacity: number, refillPerSec: number, clock?: { now(): number } }} opts
   */
  constructor({ capacity, refillPerSec, clock = new RealClock() } = {}) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.clock = clock;
    this.buckets = new Map(); // clientId -> { tokens, lastRefillTime }
  }

  /** Retrieve or initialize/refill the bucket for a clientId */
  _getBucket(clientId) {
    const now = this.clock.now();
    let bucket = this.buckets.get(clientId);
    if (!bucket) {
      bucket = {
        tokens: this.capacity,
        lastRefillTime: now
      };
      this.buckets.set(clientId, bucket);
    } else {
      const elapsedMs = now - bucket.lastRefillTime;
      if (elapsedMs > 0) {
        const refillAmount = (elapsedMs / 1000) * this.refillPerSec;
        bucket.tokens = Math.min(this.capacity, bucket.tokens + refillAmount);
        bucket.lastRefillTime = now;
      }
    }
    return bucket;
  }

  /** Consume one token for clientId. Returns true if allowed, false if limited. */
  allow(clientId) {
    const bucket = this._getBucket(clientId);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }
    return false;
  }

  /** Milliseconds until the next token is available for clientId (0 if now). */
  retryAfterMs(clientId) {
    const bucket = this._getBucket(clientId);
    if (bucket.tokens >= 1) {
      return 0;
    }
    return Math.ceil((1 - bucket.tokens) * 1000 / this.refillPerSec);
  }
}

module.exports = { RateLimiter };
