# Take-Home: Concurrency-Safe Cache, Rate Limiter & API

**Time budget:** ~1.5–2 hours of focused work. **Language:** Node.js (≥ 20). TypeScript is allowed (compile to the same module shape). No external runtime dependencies are required; you may use Express for the server if you prefer.

You are building the core of a high-throughput caching layer that sits in front of an expensive backend. Correctness **under concurrency and time** is the whole point. A solution that passes the visible examples but mishandles overlapping requests, expiry boundaries, or recency rules will score poorly.

---

## What to build

Implement three modules in `src/`. The exact contracts are below and stubs are provided.

### 1. `src/cache.js` — `Cache`

A TTL-aware **LRU** cache with single-flight compute.

| Method | Contract |
|---|---|
| `new Cache({ capacity, clock })` | `capacity > 0`. `clock` is an injected time source (see below). |
| `get(key)` | Value, or `undefined` on miss **or expiry**. A hit **refreshes recency** (most-recently-used). |
| `has(key)` | `true` iff present **and** not expired. **Must NOT refresh recency.** |
| `set(key, value, ttlMs)` | Insert/update. **Resets** both TTL and recency. Evicts the LRU entry when over capacity. |
| `size()` | Count of **live** (non-expired) entries. |
| `delete(key)` | Remove; returns whether it existed. |
| `getOrCompute(key, computeFn, ttlMs)` | `async`. Return cached value, else compute via `computeFn()` and cache it. **See single-flight rules below.** |

**Single-flight rules for `getOrCompute` (read carefully):**
- If N calls for the **same missing key** are in flight concurrently, `computeFn` runs **exactly once**; all N awaiters resolve to that one result.
- If `computeFn` **rejects**, the failure is **not cached** — the next call retries.
- A computed value is stored subject to the same capacity/eviction/TTL rules as `set`.

**Performance:** `get`/`set`/`has` must be **O(1) average**. A solution that scans all entries to find the LRU will fail the performance test.

### 2. `src/rateLimiter.js` — `RateLimiter`

A per-client **token bucket**.

| Method | Contract |
|---|---|
| `new RateLimiter({ capacity, refillPerSec, clock })` | Bucket holds up to `capacity` tokens; refills continuously at `refillPerSec`. Starts full. |
| `allow(clientId)` | Consume 1 token if `>= 1` available → `true`; else `false`. |
| `retryAfterMs(clientId)` | Milliseconds until the next whole token (0 if available now). |

Refill is **continuous and fractional** but a request costs a **whole** token. Tokens never exceed `capacity`. Each `clientId` has an independent bucket.

### 3. `src/server.js` — `createServer({ clock })`

Export `createServer` returning a **non-listening** `http.Server` (with Express: `http.createServer(app)`). The grader calls `.listen(0)`.

| Route | Behaviour |
|---|---|
| `GET /health` | `200 { ok: true }` — **not** rate-limited. |
| `GET /cache/:key` | `200 { value }` or `404 { error }`. |
| `PUT /cache/:key` | body `{ value, ttlMs? }` → `204`; bad body → `400`. |
| `POST /compute/:key` | body `{ ttlMs?, costMs? }` → `200 { value }`. **Must** use `cache.getOrCompute`; `costMs` simulates expensive work. |

All routes except `/health` are rate-limited per the `x-client-id` request header. **Configure the API's rate limiter as `capacity: 5` tokens, `refillPerSec: 1`** (so a client gets 5 requests before being throttled). When limited: `429 { error, retryAfterMs }` with a `Retry-After` header. The server must read time through the injected `clock` too.

---

## The clock (provided — do not modify)

`src/clock.js` gives you `RealClock` (production) and `ManualClock` (tests). **Read time only through the injected clock — never call `Date.now()` in your logic.** TTL and refill are time-dependent, and the grader freezes/advances a `ManualClock` to test them deterministically. Direct `Date.now()` calls make your time behaviour untestable and will fail the deterministic tests.

---

## Running

```bash
npm test               # the PUBLIC example tests (a small subset of grading)
# equivalently: node --test
```

The provided tests are intentionally shallow. Grading uses a **strict superset** that probes concurrency, expiry boundaries, recency semantics, refill math, and performance. Spend your time on the edge cases the examples *don't* show.

---

## ⚠️ Required: run the session recorder

Run this in a **separate terminal** for the whole assignment and submit the log:

```bash
node recorder/record.js     # leave running; Ctrl-C when done
```

It records the **sizes and diff magnitudes of your edits over time** — never your keystrokes, screen, or file contents (only content hashes). The resulting `recorder/session.jsonl` is part of your submission.

---

## Use of AI tools — read this

You may use any tools you normally would, **including AI assistants.** We are not testing whether you can avoid them. We are testing whether you can build and *own* a correct concurrent system. Two things follow:

1. A hidden test suite checks the subtle correctness an unowned copy-paste gets wrong (coalescing, rejection handling, recency vs. expiry, refill boundaries). If you don't understand your own code, these will fail.
2. You will walk us through your design in a **short live session** — we'll ask you to explain a tradeoff and make a small live change. Bring the understanding, not just the artifact.

Submit code that you can defend, line by line.

---

## Submission

Submit the whole folder (or a git repo) including:
- your `src/` implementation,
- `recorder/session.jsonl`,
- a short `NOTES.md`: your design, the trickiest bug you hit, and one thing you'd improve with more time.
