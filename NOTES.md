# NOTES

## What I Built

### Cache
I used JavaScript Map for the cache because it keeps things in order. When someone does `get()`, I delete and re-add the key so it moves to the end (most recently used). When the cache is full, the first item in the Map gets removed (least recently used). Simple and fast.

For TTL, I check expiration lazily - only when someone tries to access the key. `size()` cleans up all expired items at once.

The single-flight thing was cool. Multiple requests for the same missing key share one promise. First request starts computing, others wait for the same promise. If it fails, I remove it from the waiting list so next request retries.

### Rate Limiter
Each client gets their own bucket stored in a Map. Everyone starts with full tokens. Instead of using timers, I refill tokens lazily - when someone asks for a token, I check how much time passed and add tokens accordingly.

`retryAfterMs()` just calculates how long until there's at least 1 token and rounds up so the client actually gets one.

### Server
I used Node's built-in http module instead of Express to avoid dependencies.

I validate JSON and required fields like `value`. Bad requests get 400.

Rate limiting applies to all routes except `/health`. Uses `x-client-id` header. Returns 429 with `Retry-After` header when blocked.

---

## Hardest Bug

The delay for `costMs` was annoying. In tests they use `ManualClock` which doesn't move in real time. I initially used `setTimeout` but tests would hang forever because the clock never advanced.

I made a `delay()` function that checks the clock type:
- RealClock → use `setTimeout`
- ManualClock → use a loop with `setImmediate` that keeps checking the clock

The loop yields control to the event loop. When the test calls `clock.advance()`, the loop sees time moved and continues. Took me a while to figure out why tests were hanging.

---

## What I'd Improve

1. **Background cleanup** - Expired items only get removed when accessed. With millions of items that never get touched, memory would keep growing. I'd add a cleanup interval.

2. **Rate limiter cleanup** - Client buckets stay in memory forever even if client never comes back. I'd remove inactive clients after some time.

3. **Better error messages** - Could make them more descriptive for debugging.
