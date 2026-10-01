'use strict';

const { EventEmitter } = require('node:events');
const { AppError } = require('../lib/errors');
const { hashSecret, verifySecret, numericCode } = require('../lib/secrets');

const STAGES = Object.freeze(['sent', 'in_transit', 'ready', 'collected']);
const CODE_DIGITS    = 6;
const CODE_MAX_TRIES = 3;

/** The fields any caller may see. The collection code hash never leaves this service. */
const toPublic = ({ collection, ...transfer }) => ({
  ...transfer,
  stages:           transfer.stages.map(s => ({ ...s })),
  collectionLocked: collection?.locked ?? false,
});

/**
 * Transfer lifecycle: sent -> in_transit -> ready (automatic) -> collected (agent).
 * Emits `status` (transfer, extras) on every stage change. When a transfer becomes ready the
 * extras carry the plain collection code, once, for the receiver's SMS.
 */
class TransferService extends EventEmitter {
  /**
   * @param {{ quotes: import('./quotes').QuoteService, users: import('./users').UserService,
   *           stepMs: number, now?: () => number }} deps
   */
  constructor({ quotes, users, stepMs, now = Date.now }) {
    super();
    this.quotes = quotes;
    this.users  = users;
    this.stepMs = stepMs;
    this.now    = now;
    this.timers = new Set();
    this.reset();
  }

  /**
   * Creates a transfer from a quote. Repeating a request with the same idempotency key
   * returns the original transfer instead of charging again.
   * @returns {{ transfer: object, created: boolean }}
   */
  create(user, { quoteId, pin, idempotencyKey }) {
    if (!idempotencyKey) throw new AppError('idempotency_key_required', 400);

    const previous = this.idempotency.get(idempotencyKey);
    if (previous) {
      if (previous.quoteId !== quoteId) throw new AppError('idempotency_key_reused', 422);
      return { transfer: this.get(previous.transferId), created: false };
    }

    this.users.verifyPin(user, pin);
    const quote = this.quotes.usable(quoteId, user);

    if (quote.amountCents > this.users.remainingToday(user))
      throw new AppError('daily_limit', 400, { remainingCents: this.users.remainingToday(user) });

    this.quotes.consume(quote);
    this.users.recordSend(user, quote.amountCents);

    const transfer = {
      id:            this.#newId(),
      userId:        user.id,
      recipientId:   quote.recipientId,
      amountCents:   quote.amountCents,
      feeCents:      quote.feeCents,
      rate:          quote.rate,
      receivedCents: quote.receivedCents,
      currency:      quote.currency,
      symbol:        quote.symbol,
      status:        'sent',
      stages:        [{ status: 'sent', at: this.now() }],
      collection:    null,
    };
    this.transfers.set(transfer.id, transfer);
    this.idempotency.set(idempotencyKey, { quoteId, transferId: transfer.id });

    this.emit('status', toPublic(transfer), {});
    this.#schedule(transfer, 'in_transit', this.stepMs);
    this.#schedule(transfer, 'ready', this.stepMs * 2);
    return { transfer: toPublic(transfer), created: true };
  }

  get(id) {
    return toPublic(this.#find(id));
  }

  list({ status } = {}) {
    const all = [...this.transfers.values()].map(toPublic);
    return status ? all.filter(t => t.status === status) : all;
  }

  /** The most recent transfer a user sent, or null. */
  latestFor(userId) {
    return this.list().filter(t => t.userId === userId).at(-1) ?? null;
  }

  /**
   * Agent pays out. Needs an ID check and the receiver's secret code:
   * the reference alone is never enough. Three wrong codes lock the payout.
   */
  collect(id, { code, idChecked }) {
    const transfer = this.#find(id);

    if (transfer.status === 'collected') return toPublic(transfer);
    if (transfer.status !== 'ready') throw new AppError('not_ready', 409, { status: transfer.status });
    if (idChecked !== true) throw new AppError('id_check_required', 400);

    const { collection } = transfer;
    if (collection.locked) throw new AppError('collection_locked', 423);
    if (!verifySecret(code, collection)) {
      collection.failedTries += 1;
      if (collection.failedTries >= CODE_MAX_TRIES) {
        collection.locked = true;
        throw new AppError('collection_locked', 423);
      }
      throw new AppError('wrong_code', 403, { triesLeft: CODE_MAX_TRIES - collection.failedTries });
    }

    this.#advance(transfer, 'collected');
    return toPublic(transfer);
  }

  /** Cancels pending stage timers (used on shutdown and in tests). */
  stop() {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }

  /** Forgets every transfer (demo reset). */
  reset() {
    this.stop();
    this.transfers   = new Map();
    this.idempotency = new Map();   // key -> { quoteId, transferId }
  }

  #find(id) {
    const transfer = this.transfers.get(id);
    if (!transfer) throw new AppError('not_found', 404);
    return transfer;
  }

  #schedule(transfer, status, delayMs) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.#advance(transfer, status);
    }, delayMs);
    timer.unref();
    this.timers.add(timer);
  }

  #advance(transfer, status) {
    const extras = {};
    if (status === 'ready') {
      extras.collectionCode = numericCode(CODE_DIGITS);
      transfer.collection = { ...hashSecret(extras.collectionCode), failedTries: 0, locked: false };
    }
    transfer.status = status;
    transfer.stages.push({ status, at: this.now() });
    this.emit('status', toPublic(transfer), extras);
  }

  #newId() {
    let id;
    do id = 'MK' + String(10000 + Math.floor(Math.random() * 90000));
    while (this.transfers.has(id));
    return id;
  }
}

module.exports = { TransferService, STAGES };
