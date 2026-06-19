# NOTES: Concurrency-Safe Cache, Rate Limiter & Server

## 1. Design Overview

### **Cache (`src/cache.js`)**
- **LRU Policy**: Implemented using a native JavaScript `Map`. Since JavaScript Map entries are ordered by insertion, we achieve $O(1)$ LRU management. Accessing a key (`get`) or updating it (`set`) deletes and re-inserts the key, moving it to the end (Most Recently Used). The oldest entry (Least Recently Used) is always at `map.keys().next().value`, making eviction $O(1)$.
- **TTL Expiry**: Expired entries are checked on demand (lazily) during `get`, `has`, `delete`, and `size`. Calling `size()` actively prunes all expired entries to keep memory consumption accurate.
- **Single-Flight Coalescing**: Concurrent calls to `getOrCompute` for the same missing key share a single active `Promise` stored in `inFlight`. The first request initiates the async `computeFn`, while subsequent overlapping requests await the same promise. A `finally` block ensures that the promise is cleaned up from `inFlight` once resolved or rejected, ensuring failures are not cached.

### **Rate Limiter (`src/rateLimiter.js`)**
- **Token Bucket**: Implemented a per-client token-bucket rate limiter.
- **Continuous Fractional Refill**: Instead of running background timers (`setInterval`) per client, we perform lazy refilling on access. When a client requests a token, we calculate the elapsed time since the last request and add fractional tokens proportional to `refillPerSec` (capped at `capacity`).
- **Precision retry time**: `retryAfterMs` calculates exactly how many milliseconds are required to refill the bucket to $\ge 1$ token, rounding up with `Math.ceil` to guarantee availability when the client retries.

### **HTTP Server (`src/server.js`)**
- **Zero-Dependency Routing**: Built using the native Node.js `http` module to keep the implementation extremely lightweight and independent of npm registry state.
- **Validation**: Incoming requests are validated for JSON body correctness, presence of required properties (e.g. `value`), and numeric bounds on `ttlMs` and `costMs`. Invalid inputs return a `400 Bad Request` code.
- **Rate-Limiting Middleware**: Applied to all endpoints (except `/health`) using the `x-client-id` header. Throttled requests receive a `429 Too Many Requests` code with a `Retry-After` header specifying the delay in seconds.

---

## 2. Trickiest Bug Resolved

### **Simulating `costMs` under `ManualClock`**
In the `/compute/:key` endpoint, the request body can specify `costMs` to simulate an expensive computation. Under a `ManualClock`, time is frozen and only advances when the test suite explicitly calls `clock.advance(ms)`. 
- **The Issue**: If we used a standard `setTimeout` delay, the mock clock would never advance during the sleep, resulting in a deadlock or timing mismatches.
- **The Resolution**: We implemented a hybrid `delay(ms)` helper in the server:
  - If the clock is a `RealClock`, it uses a standard `setTimeout`.
  - If it is a `ManualClock`, it yields control back to the event loop using `setImmediate` within a polling loop:
    ```js
    while (clock.now() - start < ms) {
      await new Promise(resolve => setImmediate(resolve));
    }
    ```
  This allows the test runner to run, advance the clock synchronously, and immediately wake up the server's delay block.

---

## 3. Future Improvements (with more time)

1. **Active Cache Expiry Pruning**: Currently, cache expiration is lazy (keys are removed when touched or when `size()` is called). For an application with millions of unique, rarely-accessed keys, this can lead to memory leakages. Adding a background cleanup interval that sweeps the cache for expired entries would solve this.
2. **Rate Limiter Memory Eviction**: Clients that only make a single request will have their bucket state stored in `this.buckets` forever. We should implement an LRU eviction or cleanup mechanism on the rate-limiter buckets Map to reclaim memory for inactive clients.
