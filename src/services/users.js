'use strict';

const { AppError } = require('../lib/errors');
const { hashSecret, verifySecret } = require('../lib/secrets');

const startOfDay = ms => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** Senders, their recipients, PIN checks and daily limits. PINs are never stored or logged in clear. */
class UserService {
  /**
   * @param {Array<object>} seedUsers
   * @param {{ pinMaxTries: number, pinLockMs: number, dailyMaxCents: number, now?: () => number }} options
   */
  constructor(seedUsers, { pinMaxTries, pinLockMs, dailyMaxCents, now = Date.now }) {
    this.seedUsers     = seedUsers;
    this.pinMaxTries   = pinMaxTries;
    this.pinLockMs     = pinLockMs;
    this.dailyMaxCents = dailyMaxCents;
    this.now           = now;
    this.reset();
  }

  /** Restores every user to the seed state (demo reset). */
  reset() {
    this.users = new Map(this.seedUsers.map(({ pin, recipients, ...user }) => [user.id, {
      ...user,
      recipients:  recipients.map(r => ({ ...r })),
      pin:         hashSecret(pin),
      failedPins:  0,
      lockedUntil: 0,
      sentToday:   0,
      sentDay:     startOfDay(this.now()),
    }]));
  }

  get(id) {
    const user = this.users.get(id);
    if (!user) throw new AppError('unknown_user', 404);
    return user;
  }

  findByPhone(phone) {
    return [...this.users.values()].find(u => u.phone === phone) ?? null;
  }

  recipient(user, recipientId) {
    const recipient = user.recipients.find(r => r.id === recipientId);
    if (!recipient) throw new AppError('unknown_recipient', 404);
    return recipient;
  }

  /** Finds a recipient across all senders (used for the receiver's inbox). */
  findRecipient(recipientId) {
    for (const user of this.users.values()) {
      const recipient = user.recipients.find(r => r.id === recipientId);
      if (recipient) return recipient;
    }
    return null;
  }

  setLanguage(user, language) {
    user.language = language;
  }

  /** Throws `wrong_pin` or `pin_locked`; resets the failure count on success. */
  verifyPin(user, pin) {
    const now = this.now();
    if (user.lockedUntil > now)
      throw new AppError('pin_locked', 429, { retryAfterMs: user.lockedUntil - now });

    if (verifySecret(pin, user.pin)) {
      user.failedPins = 0;
      return;
    }

    user.failedPins += 1;
    if (user.failedPins >= this.pinMaxTries) {
      user.failedPins  = 0;
      user.lockedUntil = now + this.pinLockMs;
      throw new AppError('pin_locked', 429, { retryAfterMs: this.pinLockMs });
    }
    throw new AppError('wrong_pin', 401, { triesLeft: this.pinMaxTries - user.failedPins });
  }

  remainingToday(user) {
    this.#rollDay(user);
    return this.dailyMaxCents - user.sentToday;
  }

  recordSend(user, cents) {
    this.#rollDay(user);
    user.sentToday += cents;
  }

  #rollDay(user) {
    const today = startOfDay(this.now());
    if (user.sentDay !== today) {
      user.sentDay   = today;
      user.sentToday = 0;
    }
  }
}

module.exports = { UserService };
