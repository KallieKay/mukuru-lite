'use strict';

const express = require('express');
const i18n = require('../i18n');
const { AppError } = require('../lib/errors');
const { parseRands } = require('../lib/money');

// The demo has no login: every API call acts as the seeded sender.
const DEMO_USER_ID = 'thandi';

const quoteView = q => ({
  quoteId:         q.id,
  recipientId:     q.recipientId,
  amountCents:     q.amountCents,
  feeCents:        q.feeCents,
  sendCents:       q.sendCents,
  rate:            q.rate,
  receivedCents:   q.receivedCents,
  currency:        q.currency,
  symbol:          q.symbol,
  rateLockedUntil: q.lockedUntil,
});

// Transfers arrive already stripped of secrets (see TransferService); this adds the timeline.
const transferView = t => ({
  ...t,
  timestamps: Object.fromEntries(t.stages.map(s => [s.status, s.at])),
});

/**
 * REST API. Demo only: no sender login (every call acts as Thandi), synthetic data.
 * @param {{ fx, users, quotes, transfers, notifications }} services
 * @param {{ demoMode: boolean, resetDemo: () => void }} options
 */
function createApiRouter({ fx, users, quotes, transfers, notifications }, { demoMode, resetDemo }) {
  const router = express.Router();
  router.use(express.json({ limit: '10kb' }));

  router.get('/fx', (req, res) => {
    res.json(fx.all());
  });

  router.post('/quotes', (req, res) => {
    const user = users.get(DEMO_USER_ID);
    const quote = quotes.create(user, {
      amountCents: parseRands(req.body?.amount) ?? NaN,
      recipientId: req.body?.recipientId,
    });
    res.status(201).json(quoteView(quote));
  });

  router.post('/transfers', (req, res) => {
    const user = users.get(DEMO_USER_ID);
    const { transfer, created } = transfers.create(user, {
      quoteId:        req.body?.quoteId,
      pin:            req.body?.pin,
      idempotencyKey: req.get('Idempotency-Key'),
    });
    res.status(created ? 201 : 200).json(transferView(transfer));
  });

  router.get('/transfers', (req, res) => {
    res.json(transfers.list({ status: req.query.status }).map(transferView));
  });

  router.get('/transfers/:id', (req, res) => {
    res.json(transferView(transfers.get(req.params.id)));
  });

  // Agent payout: needs a checked ID and the receiver's secret code.
  router.post('/transfers/:id/collect', (req, res) => {
    const { code, idChecked } = req.body ?? {};
    res.json(transferView(transfers.collect(req.params.id, { code, idChecked })));
  });

  router.post('/demo/transfers/:id/fail', (req, res) => {
    if (!demoMode) throw new AppError('not_found', 404);
    res.json(transferView(transfers.fail(req.params.id, req.body?.reason)));
  });

  router.get('/inbox/:partyId', (req, res) => {
    const { lang } = req.query;
    if (lang !== undefined && !i18n.isSupported(lang))
      throw new AppError('unsupported_language', 400, { supported: i18n.LANGUAGES });
    res.json(notifications.inbox(req.params.partyId, lang));
  });

  // Voice call preference for a recipient. Body: { voiceCall: true|false }
  // e.g. POST /api/recipients/mama/preferences
  router.post('/recipients/:recipientId/preferences', (req, res) => {
    const sender    = users.get(DEMO_USER_ID);
    const recipient = users.recipient(sender, req.params.recipientId);
    const { voiceCall } = req.body ?? {};
    if (voiceCall !== undefined) users.setVoiceCall(recipient, voiceCall);
    res.json({ recipientId: recipient.id, voiceCall: recipient.voiceCall ?? false });
  });

  // Voice call log: shows TTS calls that have been fired (for the simulator UI).
  router.get('/voice-calls', (req, res) => {
    res.json(notifications.voice?.callLog() ?? []);
  });

  // Wipes all state back to the seed. Only exists when the server runs with DEMO=1.
  router.post('/demo/fx-move', (req, res) => {
    if (!demoMode) throw new AppError('not_found', 404);
    const code = req.body?.code ?? 'ZW';
    const direction = req.body?.direction ?? 'up';
    res.json(fx.move(code, direction));
  });

  router.post('/demo/reset', (req, res) => {
    if (!demoMode) throw new AppError('not_found', 404);
    resetDemo();
    res.json({ reset: true });
  });

  return router;
}

module.exports = { createApiRouter };
