// server.js — IMPLEMENT THIS.
//
// Expose your cache + rate limiter over HTTP. You may use Express or raw
// node:http. Whatever you choose, export createServer() returning a
// NON-LISTENING http.Server instance (with Express: http.createServer(app)).
// The grader calls server.listen(0) itself.
//
// Routes (all except /health are rate-limited per x-client-id header):
//   GET  /health            -> 200 { ok: true }
//   GET  /cache/:key        -> 200 { value } | 404 { error }
//   PUT  /cache/:key        -> body { value, ttlMs? } -> 204 | 400
//   POST /compute/:key      -> body { ttlMs?, costMs? } -> 200 { value }
//                              (must use cache.getOrCompute for coalescing)
// Rate-limited responses: 429 { error, retryAfterMs } with a Retry-After header.

const http = require('node:http');
const { Cache } = require('./cache');
const { RateLimiter } = require('./rateLimiter');
const { RealClock } = require('./clock');

function createServer({ clock = new RealClock() } = {}) {
  const cache = new Cache({ clock });
  const limiter = new RateLimiter({ capacity: 5, refillPerSec: 1, clock });

  // Yields event loop until clock reaches target (crucial for ManualClock)
  async function delay(ms) {
    if (ms <= 0) return;
    const start = clock.now();
    while (clock.now() - start < ms) {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = url.pathname;

      if (req.method === 'GET' && pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true }));
      }

      // Central Rate Limiting
      const clientId = req.headers['x-client-id'] || '';
      if (!limiter.allow(clientId)) {
        const retryAfterMs = limiter.retryAfterMs(clientId);
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': String(Math.ceil(retryAfterMs / 1000)),
        });
        return res.end(JSON.stringify({ error: 'Rate limit exceeded', retryAfterMs }));
      }

      // Central Request Body Parsing
      let bodyStr = '';
      for await (const chunk of req) {
        bodyStr += chunk;
      }
      const body = bodyStr.trim() ? JSON.parse(bodyStr) : {};

      // GET /cache/:key
      if (req.method === 'GET' && pathname.startsWith('/cache/')) {
        const key = decodeURIComponent(pathname.slice(7));
        if (cache.has(key)) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ value: cache.get(key) }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Key not found' }));
        }
      }
      // PUT /cache/:key
      else if (req.method === 'PUT' && pathname.startsWith('/cache/')) {
        const key = decodeURIComponent(pathname.slice(7));
        if (body === null || typeof body !== 'object' || !('value' in body)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ error: 'Invalid body' }));
        }
        cache.set(key, body.value, body.ttlMs ?? Infinity);
        res.writeHead(204);
        res.end();
      }
      // POST /compute/:key
      else if (req.method === 'POST' && pathname.startsWith('/compute/')) {
        const key = decodeURIComponent(pathname.slice(9));
        const value = await cache.getOrCompute(
          key,
          async () => {
            await delay(body.costMs ?? 0);
            return `computed-${key}`;
          },
          body.ttlMs ?? Infinity
        );
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ value }));
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      }
    } catch (err) {
      res.writeHead(err instanceof SyntaxError ? 400 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

module.exports = { createServer };
