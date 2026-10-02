'use strict';

const path = require('node:path');
const express = require('express');

const { AppError } = require('./lib/errors');
const { securityHeaders } = require('./middleware/securityHeaders');
const { FxService } = require('./services/fx');
const { UserService } = require('./services/users');
const { QuoteService } = require('./services/quotes');
const { TransferService } = require('./services/transfers');
const { NotificationService } = require('./services/notifications');
const { VoiceCallService }    = require('./services/voice');
const { SessionStore } = require('./services/sessions');
const { createApiRouter } = require('./routes/api');
const { createUssdRouter } = require('./routes/ussd');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

/** Wires the services together. Each call gets fresh in-memory state. */
function createServices(seed, config) {
  const fx = new FxService(seed.corridors, { isStatic: config.fxStatic, tickMs: config.fxTickMs });
  const users = new UserService(seed.users, {
    pinMaxTries:   config.pinMaxTries,
    pinLockMs:     config.pinLockMs,
    dailyMaxCents: seed.limits.dailyMaxCents,
  });
  const quotes = new QuoteService({
    fees: seed.fees, limits: seed.limits, fx, users, rateLockMs: config.rateLockMs,
  });
  const transfers     = new TransferService({ quotes, users, stepMs: config.stepMs });
  const voice         = new VoiceCallService({
    notifications: null,          // passed after notifications is constructed below
    gatewayUrl:    config.voiceGatewayUrl,
    gatewayApiKey: config.voiceGatewayApiKey,
    retryDelaysMs: config.voiceRetryDelaysMs,
  });
  const notifications = new NotificationService({ transfers, users, voice });
  voice.notifications = notifications;  // complete the circular reference
  const sessions      = new SessionStore(config.ussdSessionMs);
  return { fx, users, quotes, transfers, notifications, voice, sessions };
}

/** Clears all state back to the seed, so every rehearsal starts the same way. */
function resetServices({ fx, users, quotes, transfers, notifications, voice, sessions }) {
  transfers.reset();
  quotes.reset();
  notifications.reset();   // also calls voice.reset() internally
  sessions.reset();
  users.reset();
  fx.reset();
}

// Express recognises error handlers by their four parameters, so `next` must stay.
function errorHandler(err, req, res, next) {
  if (err instanceof AppError) return res.status(err.status).json({ error: err.code, ...err.details });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json' });
  console.error(err);
  res.status(500).json({ error: 'internal_error' });
}

/**
 * @param {{ seed: object, config: ReturnType<import('./config').loadConfig> }} options
 * @returns {{ app: import('express').Express, services: ReturnType<typeof createServices>, stop: () => void }}
 */
function createApp({ seed, config }) {
  const services = createServices(seed, config);
  services.fx.start();

  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);
  app.use(express.static(PUBLIC_DIR));
  app.use('/api', createApiRouter(services, {
    demoMode:  config.demoMode,
    resetDemo: () => resetServices(services),
  }));
  app.use('/ussd', createUssdRouter(services));
  app.use(errorHandler);

  const stop = () => {
    services.fx.stop();
    services.transfers.stop();
    services.voice.stop();
  };
  return { app, services, stop };
}

module.exports = { createApp };
