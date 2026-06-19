// PUBLIC example tests. These show the expected shape of the API. The grading
// suite is a strict SUPERSET of these and probes edge cases not shown here
// (concurrency, expiry boundaries, recency rules, refill math, perf). Make
// these pass first, then reason hard about what else could break.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Cache } = require('../src/cache');
const { RateLimiter } = require('../src/rateLimiter');
const { ManualClock } = require('../src/clock');

test('cache: basic get/set', () => {
  const c = new Cache({ capacity: 2 });
  c.set('a', 1);
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('missing'), undefined);
});

test('cache: LRU eviction at capacity', () => {
  const c = new Cache({ capacity: 2 });
  c.set('a', 1);
  c.set('b', 2);
  c.get('a'); // 'a' now most-recently-used
  c.set('c', 3); // evicts LRU 'b'
  assert.equal(c.get('b'), undefined);
  assert.equal(c.get('a'), 1);
  assert.equal(c.get('c'), 3);
});

test('cache: TTL expiry via injected clock', () => {
  const clock = new ManualClock(0);
  const c = new Cache({ capacity: 2, clock });
  c.set('a', 1, 100);
  clock.advance(100);
  assert.equal(c.get('a'), undefined);
});

test('cache: getOrCompute caches the computed value', async () => {
  const c = new Cache({ capacity: 2 });
  let calls = 0;
  const v1 = await c.getOrCompute('k', async () => (++calls, 'v'));
  const v2 = await c.getOrCompute('k', async () => (++calls, 'v'));
  assert.equal(v1, 'v');
  assert.equal(v2, 'v');
  assert.equal(calls, 1);
});

test('rateLimiter: allows up to capacity then denies', () => {
  const clock = new ManualClock(0);
  const rl = new RateLimiter({ capacity: 2, refillPerSec: 1, clock });
  assert.equal(rl.allow('c'), true);
  assert.equal(rl.allow('c'), true);
  assert.equal(rl.allow('c'), false);
});

test('cache: getOrCompute single-flight request coalescing', async () => {
  const c = new Cache({ capacity: 2 });
  let computeCount = 0;

  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(
      c.getOrCompute('key1', async () => {
        computeCount++;
        await new Promise((resolve) => setTimeout(resolve, 50));
        return 'val1';
      })
    );
  }

  const results = await Promise.all(promises);
  for (const res of results) {
    assert.equal(res, 'val1');
  }
  assert.equal(computeCount, 1);
});

test('rateLimiter: fractional refill and retryAfterMs calculation', () => {
  const clock = new ManualClock(0);
  const rl = new RateLimiter({ capacity: 5, refillPerSec: 1, clock });

  for (let i = 0; i < 5; i++) {
    assert.equal(rl.allow('c1'), true);
  }
  assert.equal(rl.allow('c1'), false);
  assert.equal(rl.retryAfterMs('c1'), 1000);

  clock.advance(500);
  assert.equal(rl.allow('c1'), false);
  assert.equal(rl.retryAfterMs('c1'), 500);

  clock.advance(500);
  assert.equal(rl.retryAfterMs('c1'), 0);
  assert.equal(rl.allow('c1'), true);
});

test('server: HTTP endpoints and rate limiting', async () => {
  const { createServer } = require('../src/server');
  const clock = new ManualClock(0);
  const server = createServer({ clock });

  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;

  try {
    const resHealth = await makeRequest(port, '/health');
    assert.equal(resHealth.status, 200);
    assert.equal(JSON.parse(resHealth.body).ok, true);

    const resGet1 = await makeRequest(port, '/cache/missing', {
      headers: { 'x-client-id': 'clientA' },
    });
    assert.equal(resGet1.status, 404);

    for (let i = 0; i < 4; i++) {
      const res = await makeRequest(port, '/cache/missing', {
        headers: { 'x-client-id': 'clientA' },
      });
      assert.equal(res.status, 404);
    }

    const resGetLimit = await makeRequest(port, '/cache/missing', {
      headers: { 'x-client-id': 'clientA' },
    });
    assert.equal(resGetLimit.status, 429);
    const limitBody = JSON.parse(resGetLimit.body);
    assert.equal(limitBody.error, 'Rate limit exceeded');
    assert.equal(resGetLimit.headers['retry-after'], '1');
    assert.ok(limitBody.retryAfterMs > 0);

    const resPut = await makeRequest(port, '/cache/key1', {
      method: 'PUT',
      headers: { 'x-client-id': 'clientB', 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: 'val1', ttlMs: 2000 }),
    });
    assert.equal(resPut.status, 204);

    const resGet2 = await makeRequest(port, '/cache/key1', {
      headers: { 'x-client-id': 'clientB' },
    });
    assert.equal(resGet2.status, 200);
    assert.equal(JSON.parse(resGet2.body).value, 'val1');

    const computePromise = makeRequest(port, '/compute/key2', {
      method: 'POST',
      headers: { 'x-client-id': 'clientB', 'Content-Type': 'application/json' },
      body: JSON.stringify({ costMs: 300, ttlMs: 5000 }),
    });

    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setTimeout(resolve, 20));

    clock.advance(300);

    const resCompute = await computePromise;
    assert.equal(resCompute.status, 200);
    assert.equal(JSON.parse(resCompute.body).value, 'computed-key2');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

function makeRequest(port, path, { method = 'GET', headers = {}, body = '' } = {}) {
  const http = require('node:http');
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port,
        path,
        method,
        headers,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data,
          });
        });
      }
    );
    req.on('error', reject);
    if (body) {
      req.write(body);
    }
    req.end();
  });
}
