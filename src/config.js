'use strict';

const toNumber = (value, fallback) =>
  value === undefined || value === '' ? fallback : Number(value);

const toBool = value => value === '1' || value === 'true';

/**
 * Reads runtime settings from environment variables.
 * Every value has a demo-friendly default, so `npm start` works with no setup.
 */
function loadConfig(env = process.env) {
  return Object.freeze({
    port:          toNumber(env.PORT, 3000),
    demoMode:      toBool(env.DEMO),                      // enables POST /api/demo/reset
    fxStatic:      toBool(env.FX_STATIC),                 // freeze rates for a predictable demo
    fxTickMs:      toNumber(env.FX_TICK_MS, 30_000),      // how often rates drift
    stepMs:        toNumber(env.STEP_MS, 6000),           // delay between tracker stages
    rateLockMs:    10 * 60 * 1000,
    pinMaxTries:   3,
    pinLockMs:     toNumber(env.PIN_LOCK_MS, 60_000),
    ussdSessionMs: 3 * 60 * 1000,
  });
}

module.exports = { loadConfig };
