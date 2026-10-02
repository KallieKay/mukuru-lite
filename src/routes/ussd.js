'use strict';

// USSD channel (*130*999#) in the common gateway format (e.g. Africa's Talking):
//   POST /ussd  { sessionId, serviceCode, phoneNumber, text }
//   text = every reply so far joined by '*', e.g. "2*1*1*1500*1*1234"
//   reply "CON <screen>" to keep the session open, "END <screen>" to close it.

const express = require('express');
const i18n = require('../i18n');
const { AGENT_HOURS, AGENT_PHONE } = require('../config');
const { AppError } = require('../lib/errors');
const { formatMoney, parseRands } = require('../lib/money');
const { STAGES } = require('../services/transfers');

const MAX_SCREEN_CHARS = 182;   // GSM USSD limit; screens are kept well under it
const RAND = 'R';

const con = (text, lang, navigable = true) => ({
  type: 'CON',
  text: navigable ? `${text}\n${i18n.t(lang, 'ussd.navigation')}` : text,
});
const end = text => ({ type: 'END', text });

function normalizeInputs(inputs, askLanguage, recipientCount) {
  const path = [];
  const languageDepth = askLanguage ? 1 : 0;
  let languageChosen = !askLanguage;

  for (const input of inputs) {
    if (!languageChosen) {
      if (input === '0' || input === '00') continue;
      path.push(input);
      languageChosen = true;
      continue;
    }

    if (input === '00') {
      path.length = languageDepth;
      continue;
    }
    if (input === '0') {
      if (path.length > languageDepth) path.pop();
      continue;
    }

    const steps = path.slice(languageDepth);
    const recipientChoice = Number(steps[1]);
    if (input === '2' && steps.length === 3 && steps[0] === '1' &&
        Number.isInteger(recipientChoice) && recipientChoice >= 1 && recipientChoice <= recipientCount &&
        parseRands(steps[2]) !== null) {
      path.length = languageDepth;
      continue;
    }
    path.push(input);
  }

  return path;
}

/**
 * The menu tree. The gateway resends the whole reply path on every request, so the path is
 * walked from the start each time. Side effects are safe to repeat: the quote is cached on the
 * session and the transfer is protected by an idempotency key, so a retried request never
 * charges twice.
 */
class UssdMenu {
  constructor({ users, quotes, transfers }) {
    this.users     = users;
    this.quotes    = quotes;
    this.transfers = transfers;
  }

  respond({ sessionId, session, user, inputs }) {
    const replies = inputs[Symbol.iterator]();
    const next = () => replies.next().value;

    if (session.askLanguage) {
      const choice = next();
      if (choice === undefined) return con(this.#languageMenu(), i18n.DEFAULT_LANGUAGE);
      const language = i18n.LANGUAGES[Number(choice) - 1];
      if (!language) return end(i18n.t(i18n.DEFAULT_LANGUAGE, 'ussd.invalid'));
      this.users.setLanguage(user, language);
    }
    const lang = user.language ?? i18n.DEFAULT_LANGUAGE;
    const t = (key, vars) => i18n.t(lang, key, vars);

    switch (next()) {
      case undefined: return con(t('ussd.main'), lang, false);
      case '1':       return this.#send({ sessionId, session, user, lang, t, next });
      case '2':       return this.#track({ user, lang, t });
      case '3':       return this.#help({ lang, t, next });
      case '4':
        this.users.setLanguage(user, null);
        return end(t('ussd.languageReset'));
      default:        return end(t('ussd.invalid'));
    }
  }

  #help({ lang, t, next }) {
    const choice = next();
    if (choice === undefined) return con(t('ussd.help.menu'), lang);

    const screens = { '1': 'send', '2': 'track', '4': 'collect', '5': 'safety' };
    if (choice === '3') {
      const { flatCents, percentBps, roundDownToCents } = this.quotes.fees;
      const percent = (percentBps / 100).toFixed(2).replace(/\.?0+$/, '');
      return con(t('ussd.help.fees', {
        flatFee: formatMoney(flatCents, RAND),
        percent,
        roundTo: formatMoney(roundDownToCents, RAND),
        minutes: Math.max(1, Math.ceil(this.quotes.rateLockMs / 60_000)),
      }), lang);
    }
    if (choice === '6')
      return con(t('ussd.help.agent', { hours: AGENT_HOURS, phone: AGENT_PHONE }), lang);
    return screens[choice] ? con(t(`ussd.help.${screens[choice]}`), lang) : end(t('ussd.invalid'));
  }

  #send({ sessionId, session, user, lang, t, next }) {
    const recipientChoice = next();
    if (recipientChoice === undefined) {
      const options = user.recipients
        .map((r, i) => `${i + 1} ${i18n.recipientName(lang, r)} (${r.city})`)
        .join('\n');
      return con(t('ussd.sendTo', { options }), lang);
    }
    const recipient = user.recipients[Number(recipientChoice) - 1];
    if (!recipient) return end(t('ussd.invalid'));
    const name = i18n.recipientName(lang, recipient);

    const limits = {
      min: formatMoney(this.quotes.limits.minCents, RAND),
      max: formatMoney(this.quotes.limits.maxCents, RAND),
    };

    const amountInput = next();
    if (amountInput === undefined)
      return con(`${t('ussd.amount', limits)}\n${t('ussd.amountHint')}`, lang);

    try {
      // Reuse the session's quote while the path is unchanged, so every retry sees the same numbers.
      if (session.quoteInput !== `${recipient.id}:${amountInput}`) {
        session.quote = this.quotes.create(user, {
          amountCents: parseRands(amountInput) ?? NaN,
          recipientId: recipient.id,
        });
        session.quoteInput = `${recipient.id}:${amountInput}`;
      }
      const quote = session.quote;

      const confirm = next();
      if (confirm === undefined) {
        return con(`${t('ussd.quote', {
          amount:   formatMoney(quote.amountCents, RAND),
          fee:      formatMoney(quote.feeCents, RAND),
          name,
          received: formatMoney(quote.receivedCents, quote.symbol),
          minutes:  Math.max(1, Math.ceil((quote.lockedUntil - this.quotes.now()) / 60_000)),
        })}\n${t('ussd.quoteHint')}`, lang);
      }
      if (confirm === '2') return con(t('ussd.main'), lang, false);
      if (confirm !== '1') return end(t('ussd.invalid'));

      const pin = next();
      if (pin === undefined) return con(`${t('ussd.pin')}\n${t('ussd.pinHint')}`, lang);

      const { transfer } = this.transfers.create(user, {
        quoteId:        quote.id,
        pin,
        idempotencyKey: `ussd:${sessionId}:${quote.id}`,
      });
      return end(t('ussd.sent', { ref: transfer.id, name }));
    } catch (err) {
      const key = `ussd.errors.${err.code}`;
      if (err instanceof AppError && i18n.has(key)) return end(t(key, { ...limits, ...err.details }));
      throw err;
    }
  }

  #track({ user, lang, t }) {
    const transfer = this.transfers.latestFor(user.id);
    if (!transfer) return end(t('ussd.noTransfer'));
    const recipient = this.users.recipient(user, transfer.recipientId);
    const statuses = transfer.status === 'failed'
      ? ['sent', 'in_transit', 'failed']
      : STAGES.filter(status => status !== 'failed');
    const reached = new Set(transfer.stages.map(stage => stage.status));
    const stages = statuses
      .map(status => `${reached.has(status) ? '[x]' : '[ ]'} ${t(`stages.${status}`)}`)
      .join('\n');
    return end(t('ussd.track', { ref: transfer.id, name: i18n.recipientName(lang, recipient), stages }));
  }

  #languageMenu() {
    const options = i18n.LANGUAGES.map((lang, i) => `${i + 1} ${i18n.languageName(lang)}`);
    return ['Mukuru', ...options].join('\n');
  }
}

/**
 * @param {{ users, quotes, transfers, sessions: import('../services/sessions').SessionStore }} services
 */
function createUssdRouter(services) {
  const { sessions } = services;
  const menu = new UssdMenu(services);
  const router = express.Router();

  const reply = (res, { type, text }) => {
    if (text.length > MAX_SCREEN_CHARS)
      console.warn(`USSD screen is ${text.length} chars (max ${MAX_SCREEN_CHARS}):\n${text}`);
    res.type('text/plain').send(`${type} ${text}`);
  };

  router.post('/', express.urlencoded({ extended: false }), express.json(), (req, res) => {
    const { sessionId, phoneNumber, text = '' } = req.body ?? {};
    if (!sessionId || !phoneNumber) return res.status(400).type('text/plain').send('END Bad request');

    const user = services.users.findByPhone(phoneNumber);
    if (!user) return reply(res, end(i18n.t(i18n.DEFAULT_LANGUAGE, 'ussd.unknownNumber')));

    const session = sessions.get(sessionId, () => ({ askLanguage: !user.language }));
    const inputs = normalizeInputs(
      text === '' ? [] : String(text).split('*'),
      session.askLanguage,
      user.recipients.length,
    );

    try {
      reply(res, menu.respond({ sessionId, session, user, inputs }));
    } catch (err) {
      console.error('USSD request failed', err);
      reply(res, end(i18n.t(user.language ?? i18n.DEFAULT_LANGUAGE, 'ussd.error')));
    }
  });

  return router;
}

module.exports = { createUssdRouter };
