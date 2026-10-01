'use strict';

const crypto = require('node:crypto');
const { AppError } = require('../lib/errors');
const { calculateFee, convert, toRateUnits } = require('../lib/money');

/**
 * Locked-rate quotes. All amounts are calculated here, on the server,
 * so a client can only ever refer to a quote by id, never change its numbers.
 */
class QuoteService {
  /**
   * @param {{ fees: object, limits: object, fx: import('./fx').FxService,
   *           users: import('./users').UserService, rateLockMs: number, now?: () => number }} deps
   */
  constructor({ fees, limits, fx, users, rateLockMs, now = Date.now }) {
    this.fees       = fees;
    this.limits     = limits;
    this.fx         = fx;
    this.users      = users;
    this.rateLockMs = rateLockMs;
    this.now        = now;
    this.quotes     = new Map();
  }

  /**
   * The fee comes out of the amount: Thandi pays exactly `amountCents`,
   * and the recipient gets (amount - fee) converted at the locked rate.
   */
  create(user, { amountCents, recipientId }) {
    const { minCents, maxCents } = this.limits;
    if (!Number.isInteger(amountCents) || amountCents < minCents || amountCents > maxCents)
      throw new AppError('invalid_amount', 400, { minCents, maxCents });

    if (amountCents > this.users.remainingToday(user))
      throw new AppError('daily_limit', 400, { remainingCents: this.users.remainingToday(user) });

    const recipient = this.users.recipient(user, recipientId);
    const fx        = this.fx.get(recipient.countryCode);
    const feeCents  = calculateFee(amountCents, this.fees);
    const sendCents = amountCents - feeCents;

    const quote = {
      id:            crypto.randomUUID(),
      userId:        user.id,
      recipientId:   recipient.id,
      amountCents,
      feeCents,
      sendCents,
      rate:          fx.rate,
      receivedCents: convert(sendCents, toRateUnits(fx.rate)),
      currency:      fx.currency,
      symbol:        fx.symbol,
      lockedUntil:   this.now() + this.rateLockMs,
      used:          false,
    };
    this.quotes.set(quote.id, quote);
    return quote;
  }

  /** Returns a quote that can still be used, or throws `quote_invalid` / `quote_expired`. */
  usable(quoteId, user) {
    const quote = this.quotes.get(quoteId);
    if (!quote || quote.used || quote.userId !== user.id) throw new AppError('quote_invalid', 409);
    if (this.now() > quote.lockedUntil) throw new AppError('quote_expired', 409);
    return quote;
  }

  consume(quote) {
    quote.used = true;
  }

  reset() {
    this.quotes.clear();
  }
}

module.exports = { QuoteService };
