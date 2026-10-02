'use strict';

/**
 * VoiceCallService — fires a TTS call to a recipient when their money is ready.
 *
 * In production this calls a real gateway (Africa's Talking, Twilio, etc.).
 * In demo / test mode (no VOICE_GATEWAY_URL set) it logs instead so the rest
 * of the app works without any credentials.
 *
 * Retry schedule (default): 3 attempts, 1 min → 5 min → 15 min apart.
 * After all retries are exhausted the NotificationService SMS is already in the
 * inbox, so the recipient still gets a text — the voice call is best-effort only.
 */
class VoiceCallService {
  /**
   * @param {{
   *   notifications: import('./notifications').NotificationService,
   *   gatewayUrl?: string,
   *   gatewayApiKey?: string,
   *   retryDelaysMs?: number[],
   *   now?: () => number
   * }} opts
   */
  constructor({
    notifications,
    gatewayUrl    = '',
    gatewayApiKey = '',
    retryDelaysMs = [60_000, 5 * 60_000, 15 * 60_000],
    now           = Date.now,
  }) {
    this.notifications = notifications;
    this.gatewayUrl    = gatewayUrl;
    this.gatewayApiKey = gatewayApiKey;
    this.retryDelaysMs = retryDelaysMs;
    this.now           = now;
    this.timers        = new Set();

    // Keyed by recipientId; each entry tracks the call state for the latest transfer.
    this._callLog = new Map();
  }

  /**
   * Attempt a TTS call to `recipient` reading `voiceText`.
   * Retries on failure with exponential back-off; falls back to SMS (already in inbox).
   *
   * @param {{ id: string, phone: string, language?: string }} recipient
   * @param {string} voiceText   The rendered voice string from i18n
   * @param {string} transferRef Transfer ID (for logging)
   */
  call(recipient, voiceText, transferRef) {
    const entry = {
      recipientId: recipient.id,
      transferRef,
      language:    recipient.language ?? 'en',
      voiceText,
      attempt:     0,
      success:     false,
    };
    this._callLog.set(recipient.id + ':' + transferRef, entry);
    this._attempt(recipient, voiceText, transferRef, entry);
  }

  /** Cancels all pending retry timers (used on shutdown and demo reset). */
  stop() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  /** Clears the call log (demo reset). */
  reset() {
    this.stop();
    this._callLog.clear();
  }

  // ── internal ──────────────────────────────────────────────────────────────

  _attempt(recipient, voiceText, transferRef, entry) {
    entry.attempt += 1;
    const attemptNum = entry.attempt;

    this._dial(recipient, voiceText)
      .then(() => {
        entry.success = true;
        console.log(
          `[voice] call delivered to ${recipient.id} (${transferRef}) ` +
          `attempt ${attemptNum}`
        );
      })
      .catch(err => {
        console.warn(
          `[voice] attempt ${attemptNum} failed for ${recipient.id} ` +
          `(${transferRef}): ${err.message}`
        );
        const nextDelay = this.retryDelaysMs[attemptNum - 1]; // 0-indexed after increment
        if (nextDelay !== undefined) {
          console.log(
            `[voice] retrying ${recipient.id} in ${nextDelay / 1000}s ` +
            `(attempt ${attemptNum + 1}/${this.retryDelaysMs.length + 1})`
          );
          const t = setTimeout(() => {
            this.timers.delete(t);
            this._attempt(recipient, voiceText, transferRef, entry);
          }, nextDelay);
          t.unref?.();
          this.timers.add(t);
        } else {
          console.warn(
            `[voice] all retries exhausted for ${recipient.id} (${transferRef}). ` +
            `Falling back to SMS (already in inbox).`
          );
        }
      });
  }

  /**
   * Makes one dial attempt.
   * Swaps in a mock when no gateway URL is configured.
   * @returns {Promise<void>}
   */
  async _dial(recipient, voiceText) {
    if (!this.gatewayUrl) {
      // Demo / dev: just log, always succeed.
      console.log(
        `[voice:mock] → ${recipient.phone} (${recipient.language ?? 'en'}): "${voiceText}"`
      );
      return;
    }

    // Real gateway call (Africa's Talking / Twilio compatible shape).
    // Replace the body construction to match your chosen provider's API.
    const response = await fetch(this.gatewayUrl, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${this.gatewayApiKey}`,
      },
      body: JSON.stringify({
        to:       recipient.phone,
        text:     voiceText,
        language: recipient.language ?? 'en',
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Gateway ${response.status}: ${body}`);
    }
  }

  /** Exposes the internal call log for testing / the demo inbox. */
  callLog() {
    return [...this._callLog.values()];
  }
}

module.exports = { VoiceCallService };
