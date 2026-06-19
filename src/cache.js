// cache.js — IMPLEMENT THIS.
//
// A concurrency-safe, TTL-aware LRU cache. Read the README for the full
// contract and constraints. All time MUST come from the injected clock.
const { RealClock } = require('./clock');

class Cache {
  /**
   * @param {{ capacity?: number, clock?: { now(): number } }} opts
   */
  constructor({ capacity = Infinity, clock = new RealClock() } = {}) {
    this.capacity = capacity;
    this.clock = clock;
    this.map = new Map(); // key -> { value, expiry }
    this.inFlight = new Map(); // key -> Promise
  }

  /** Return the value, or undefined on miss/expiry. A hit refreshes recency. */
  get(key) {
    const entry = this.map.get(key);
    if (!entry) {
      return undefined;
    }
    const now = this.clock.now();
    if (entry.expiry <= now) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency: move to the end of insertion order
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  /** True iff present AND not expired. MUST NOT refresh recency. */
  has(key) {
    const entry = this.map.get(key);
    if (!entry) {
      return false;
    }
    const now = this.clock.now();
    if (entry.expiry <= now) {
      this.map.delete(key);
      return false;
    }
    return true;
  }

  /** Insert/update. Resets TTL and recency. Evicts LRU when over capacity. */
  set(key, value, ttlMs = Infinity) {
    const now = this.clock.now();
    const expiry = now + ttlMs;

    // Remove key if it exists to reset recency
    if (this.map.has(key)) {
      this.map.delete(key);
    }

    this.map.set(key, { value, expiry });

    // Evict oldest (LRU) entry if capacity is exceeded
    while (this.map.size > this.capacity) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey !== undefined) {
        this.map.delete(oldestKey);
      } else {
        break;
      }
    }
  }

  /** Number of live (non-expired) entries. */
  size() {
    const now = this.clock.now();
    let count = 0;
    for (const [key, entry] of this.map.entries()) {
      if (entry.expiry <= now) {
        this.map.delete(key);
      } else {
        count++;
      }
    }
    return count;
  }

  /** Remove a key. Returns true if it existed. */
  delete(key) {
    if (!this.map.has(key)) {
      return false;
    }
    const entry = this.map.get(key);
    const now = this.clock.now();
    const existedAndLive = entry.expiry > now;
    this.map.delete(key);
    return existedAndLive;
  }

  /**
   * Return the cached value, or compute it via computeFn() and cache it.
   * Concurrent calls for the same missing key MUST coalesce into a single
   * computeFn() invocation (single-flight). A rejected computeFn MUST NOT be
   * cached — the next call retries.
   * @returns {Promise<any>}
   */
  async getOrCompute(key, computeFn, ttlMs = Infinity) {
    if (this.has(key)) {
      return this.get(key);
    }

    if (this.inFlight.has(key)) {
      return this.inFlight.get(key);
    }

    const promise = (async () => {
      try {
        const value = await computeFn();
        this.set(key, value, ttlMs);
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }
}

module.exports = { Cache };
