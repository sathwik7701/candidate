// clock.js — PROVIDED. Do not modify.
//
// Your cache and rate limiter MUST read time only through an injected clock,
// never by calling Date.now() directly. This is what makes time-dependent
// behaviour (TTL, refill) deterministically testable.
//
// RealClock is the production default. ManualClock is what the grader uses to
// freeze and advance time. If your code calls Date.now() anywhere in its
// logic, the deterministic tests will be unable to control time and you will
// fail them.

class RealClock {
  now() {
    return Date.now();
  }
}

class ManualClock {
  constructor(start = 0) {
    this._t = start;
  }
  now() {
    return this._t;
  }
  advance(ms) {
    this._t += ms;
    return this._t;
  }
  set(ms) {
    this._t = ms;
    return this._t;
  }
}

module.exports = { RealClock, ManualClock };
