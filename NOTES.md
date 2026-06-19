# NOTES: Concurrency-Safe Cache, Rate Limiter & Server

## 1. How I Built It

### Cache (`src/cache.js`)

**LRU stuff** - I used JavaScript's Map because it remembers the order you add things. When someone asks for a key with `get()`, I delete it and add it back so it moves to the end (most recently used). When the cache gets full, I just delete the first item in the Map (that's the oldest one). Pretty simple and fast.

**TTL (Time To Live)** - I don't clean expired items immediately. Instead, I check if they're expired when someone tries to access them. When you call `size()`, I go through everything and clean up expired ones at once.

**Single-Flight thing** - This was interesting. When 5 people ask for the same missing key at the same time, only 1 person actually computes it. The others just wait for that same promise. Once it's done, everyone gets the result. If it fails, I remove it from the waiting list so the next person tries again.

### Rate Limiter (`src/rateLimiter.js`)

**Token Bucket** - Each client has their own bucket in a Map. Everyone starts with full tokens. Instead of using timers to refill, I just check how much time passed when someone asks for a token and add tokens based on that.

**Retry After** - Just simple math. Figure out how long until there's at least 1 token and round up so the user definitely gets one.

### HTTP Server (`src/server.js`)

**No Express** - I used Node's built-in http module instead of installing Express. Keeps it simple and no npm installs needed.

**Checking Inputs** - I validate JSON and check for required fields like `value`. If something's wrong, I return 400.

**Rate Limiting** - Applied to everything except `/health`. Uses `x-client-id` header. Returns 429 with `Retry-After` when blocked.

---

## 2. The Bug That Took Me Too Long to Fix

### Making `costMs` Work with ManualClock

The `/compute/:key` endpoint can pretend to do expensive work with `costMs`. 

**The Problem**: 
In tests, they use `ManualClock` which doesn't actually move forward in real time. I initially used `setTimeout` for the delay, but in tests the clock never advanced so it would just hang forever.

**How I Fixed It**:
I made a `delay()` function that handles both cases:
- If it's a real clock, use `setTimeout` (normal behavior)
- If it's a manual clock, use a loop with `setImmediate` that keeps checking the clock

This loop keeps yielding control to the event loop. When the test calls `clock.advance()`, the loop sees the time changed and continues immediately.

Took me a while to figure out why tests were hanging!

---

## 3. What I'd Change Later

1. **Background Cleanup** - Right now, expired cache items only get cleaned when someone tries to access them. If I had millions of items that nobody ever asks for, they'd just sit in memory. I'd add a background cleanup.

2. **Rate Limiter Memory** - Client buckets stay in memory forever, even if a client makes 1 request and never comes back. I'd clean up inactive clients.

3. **Better Error Messages** - Some error messages are basic. Could make them more helpful.
