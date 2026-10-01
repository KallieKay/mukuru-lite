'use strict';

const i18n = require('../i18n');
const { formatMoney } = require('../lib/money');

// Which stage changes send a message to whom. "sent" goes out immediately, so Thandi
// gets her reference even if the USSD session drops before she sees the last screen.
const RULES = {
  sent:       ['sender'],
  in_transit: ['sender'],
  ready:      ['sender', 'recipient'],
  collected:  ['sender', 'recipient'],
};

/**
 * Mock SMS/voice gateway. Messages are stored as (template, transfer) and rendered when read,
 * so the same inbox can be shown in another language for judges.
 */
class NotificationService {
  /**
   * @param {{ transfers: import('./transfers').TransferService,
   *           users: import('./users').UserService, now?: () => number }} deps
   */
  constructor({ transfers, users, now = Date.now }) {
    this.users    = users;
    this.now      = now;
    this.messages = [];
    this.nextId   = 1;   // keeps counting across resets, so phones always spot new messages
    transfers.on('status', (transfer, extras) => this.#onStatus(transfer, extras));
  }

  /**
   * Messages for a party ("thandi", "mama"), newest first.
   * In a real deployment these are SMS on the person's own phone, not an open endpoint.
   * @param {string} partyId
   * @param {string} [lang] overrides the party's own language
   */
  inbox(partyId, lang) {
    const party    = this.#party(partyId);
    const language = lang ?? party.language ?? i18n.DEFAULT_LANGUAGE;
    return {
      partyId,
      language,
      messages: this.messages
        .filter(m => m.partyId === partyId)
        .map(m => this.#render(m, language))
        .reverse(),
    };
  }

  reset() {
    this.messages = [];
  }

  #onStatus(transfer, { collectionCode } = {}) {
    for (const role of RULES[transfer.status] ?? []) {
      this.messages.push({
        id:       this.nextId++,
        partyId:  role === 'sender' ? transfer.userId : transfer.recipientId,
        role,
        status:   transfer.status,
        transfer,                                            // a public snapshot, never the code hash
        code:     role === 'recipient' ? collectionCode : undefined,
        at:       this.now(),
      });
    }
  }

  #render(message, lang) {
    const { transfer, role, status } = message;
    const sender    = this.users.get(transfer.userId);
    const recipient = this.users.recipient(sender, transfer.recipientId);
    const vars = {
      ref:      transfer.id,
      code:     message.code,
      name:     i18n.recipientName(lang, recipient),
      sender:   sender.name,
      amount:   formatMoney(transfer.amountCents, 'R'),
      received: formatMoney(transfer.receivedCents, transfer.symbol),
    };
    // Only "money is ready" gets a voice note: it is the one message the receiver must act on.
    // The code is left out of the voice note, so it can't be overheard.
    const hasVoice = role === 'recipient' && status === 'ready';
    return {
      id:     message.id,
      ref:    transfer.id,
      status,
      at:     message.at,
      text:   i18n.t(lang, `sms.${role}.${status}`, vars),
      voice:  hasVoice ? i18n.t(lang, `voice.${role}.${status}`, vars) : null,
    };
  }

  #party(partyId) {
    return this.users.findRecipient(partyId) ?? this.users.get(partyId);
  }
}

module.exports = { NotificationService };
