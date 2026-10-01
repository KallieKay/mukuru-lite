'use strict';

/** In-memory USSD sessions that expire like real network sessions. */
class SessionStore {
  constructor(ttlMs, now = Date.now) {
    this.ttlMs    = ttlMs;
    this.now      = now;
    this.sessions = new Map();
  }

  get(id, create) {
    this.#sweep();
    let session = this.sessions.get(id);
    if (!session) {
      session = create();
      this.sessions.set(id, session);
    }
    session.touchedAt = this.now();
    return session;
  }

  reset() {
    this.sessions.clear();
  }

  #sweep() {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, s] of this.sessions) if (s.touchedAt < cutoff) this.sessions.delete(id);
  }
}

module.exports = { SessionStore };
