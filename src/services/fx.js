'use strict';

const { AppError } = require('../lib/errors');

const DRIFT = 0.008; // each tick moves a rate by at most ±0.4%

/** Mock FX feed: each corridor's rate drifts inside its band unless frozen for a demo. */
class FxService {
  /**
   * @param {Record<string, {currency: string, symbol: string, label: string, rate: number, minRate: number, maxRate: number}>} corridors
   * @param {{ isStatic: boolean, tickMs: number, now?: () => number, random?: () => number }} options
   */
  constructor(corridors, { isStatic, tickMs, now = Date.now, random = Math.random }) {
    this.corridors = corridors;
    this.isStatic  = isStatic;
    this.tickMs    = tickMs;
    this.now       = now;
    this.random    = random;
    this.timer     = null;
    this.reset();
  }

  /** Puts every rate back to its seed value. */
  reset() {
    this.rates = new Map(
      Object.entries(this.corridors).map(([code, c]) => [code, { rate: c.rate, updatedAt: this.now() }]),
    );
  }

  start() {
    if (this.isStatic || this.timer) return;
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
    this.timer = null;
  }

  tick() {
    for (const [code, c] of Object.entries(this.corridors)) {
      const { rate } = this.rates.get(code);
      const next = rate * (1 + (this.random() - 0.5) * DRIFT);
      const clamped = Math.min(c.maxRate, Math.max(c.minRate, Number(next.toFixed(5))));
      this.rates.set(code, { rate: clamped, updatedAt: this.now() });
    }
  }

  /** @returns {{ code: string, rate: number, updatedAt: number, currency: string, symbol: string, label: string }} */
  get(code) {
    const corridor = this.corridors[code];
    if (!corridor) throw new AppError('unsupported_corridor', 400, { code });
    const { label, currency, symbol } = corridor;
    return { code, label, currency, symbol, ...this.rates.get(code) };
  }

  all() {
    return Object.keys(this.corridors).map(code => this.get(code));
  }
}

module.exports = { FxService };
