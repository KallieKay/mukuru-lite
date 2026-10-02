'use strict';

const i18n = require('../i18n');
const { formatMoney } = require('../lib/money');
const { VoiceCallService } = require('./voice');

// Which stage changes send a message to whom. "sent" goes out immediately, so Thandi
// gets her reference even if the USSD session drops before she sees the last screen.
const RULES = {
  sent:       ['sender'],
  in_transit: ['sender'],
  ready:      ['sender', 'recipient'],
  collected:  ['sender', 'recipient'],
  failed:     ['sender'],
};

/**
 * Mock SMS/voice gateway. Messages are stored as (template, transfer) and rendered when read,
 * so the same inbox can be shown in another language for judges.
 */
class NotificationService {
  /**
   * @param {{ transfers: import('./transfers').TransferService,
   *           users: import('./users').UserService,
   *           voice?: import('./voice').VoiceCallService,
   *           now?: () => number }} deps
   */
  constructor({ transfers, users, voice = null, now = Date.now }) {
    this.users    = users;
    this.voice    = voice;
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
    this.voice?.reset();
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

    // Fire a TTS call to the sender when the transfer is sent (voice receipt).
    if (transfer.status === 'sent' && this.voice) {
      const sender = this.users.get(transfer.userId);
      if (sender?.voiceCall) {
        const lang      = sender.language ?? i18n.DEFAULT_LANGUAGE;
        const recipient = this.#party(transfer.recipientId);
        const voiceText = i18n.t(lang, 'voice.sender.sent', {
          name:      sender.name,
          amount:    formatMoney(transfer.amountCents, 'R'),
          recipient: i18n.recipientName(lang, recipient),
          ref:       transfer.id,
        });
        this.voice.call(sender, voiceText, transfer.id);
      }
    }

    // Fire a TTS call to the recipient when money is ready to collect.
    if (transfer.status === 'ready' && this.voice) {
      const recipient = this.#party(transfer.recipientId);
      if (recipient?.voiceCall) {
        const lang      = recipient.language ?? i18n.DEFAULT_LANGUAGE;
        const sender    = this.users.get(transfer.userId);
        const voiceText = i18n.t(lang, 'voice.recipient.ready', {
          name:   i18n.recipientName(lang, recipient),
          sender: sender.name,
        });
        this.voice.call(recipient, voiceText, transfer.id);
      }
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
