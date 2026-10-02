'use strict';

const toNumber = (value, fallback) =>
  value === undefined || value === '' ? fallback : Number(value);

const toBool = value => value === '1' || value === 'true';

const AGENT_HOURS = 'Mon-Sat 8am-7pm, Sun 8am-12pm';
const AGENT_PHONE = '0860018555';

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
    // Voice call gateway. Leave unset to use mock/log mode (no credentials needed).
    voiceGatewayUrl:    env.VOICE_GATEWAY_URL    ?? '',
    voiceGatewayApiKey: env.VOICE_GATEWAY_API_KEY ?? '',
    // Retry delays in ms between each attempt (default: 1 min, 5 min, 15 min).
    voiceRetryDelaysMs: (env.VOICE_RETRY_DELAYS_MS ?? '60000,300000,900000')
                          .split(',')
                          .map(n => toNumber(n.trim(), 60_000)),
  });
}

module.exports = { AGENT_HOURS, AGENT_PHONE, loadConfig };
