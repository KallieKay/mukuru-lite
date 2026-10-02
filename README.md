# Money Home, Made Simple (SheHacks x Mukuru)

One transfer thread for Thandi in Johannesburg and Mama in Harare.
Thandi sends over USSD (`*130*999#`), Mama gets an SMS and a voice call in English,
and Thandi gets her own voice confirmation the moment she sends. No data, no app needed.

## Run

    npm install
    npm run demo         # demo mode: rates frozen, 3 s stages, Reset button -> http://localhost:3000
    npm start            # live, drifting rates
    npm run dev          # restarts on file changes
    npm test

| Page | What it shows |
|---|---|
| `/` | Thandi's phone (USSD), Mama's phone, Thandi's SMS inbox, voice call log, Mukuru agent, demo controls |
| `/mama.html` | Mama's phone on its own, for a second laptop or phone |

Thandi's PIN: **1234**. All data is synthetic and in memory; restarting, or
**Reset demo** (demo mode only), puts everything back to the seed.

## USSD help and navigation
Choose **3 Help** for guidance on sending, tracking, fees and rates, how your receiver collects,
PIN safety, and contacting an agent. The exact fee and payout are shown before confirmation.
Agents are available Mon-Sat 8am-7pm, Sun 8am-12pm; call **0860018555**.

On continuing screens, enter **0** to go back one step or **00** to return to the main menu.
The sender's language is preserved while navigating. On the quote screen, **2 Cancel** returns
to the main menu. Only an exact `0` or `00` is navigation; other input values are unchanged.

| Env var | Default | Effect |
|---|---|---|
| `PORT` | 3000 | |
| `DEMO` | off | `1` enables demo reset, FX movement, and transfer failure controls |
| `FX_STATIC` | off | `1` freezes rates, so R1,500 always gives $94.58 |
| `STEP_MS` | 6000 | ms between tracker stages (sent -> on the way -> ready) |
| `FX_TICK_MS` | 30000 | ms between rate moves |
| `PIN_LOCK_MS` | 60000 | lockout after 3 wrong PINs |
| `VOICE_GATEWAY_URL` | _(unset)_ | Voice gateway endpoint; unset = browser speech / mock mode |
| `VOICE_GATEWAY_API_KEY` | _(unset)_ | API key for the voice gateway |
| `VOICE_RETRY_DELAYS_MS` | `60000,300000,900000` | Comma-separated retry delays (1 min, 5 min, 15 min) |

## Demo script
1. Click **Reset demo**, then **Dial \*130\*999#** and reply `2` (ChiShona), `1` (send), `1` (Amai), `1500`.
2. The quote shows: you pay R1,500, fee R45, Amai gets $94.58, rate locked 10 min. Reply `1`.
3. Tick **Drop the next reply**, then enter PIN `1234`. The phone shows "Connection problem", but
   Thandi's SMS inbox already has "R1500 yatumirwa kuna Amai. Ref MK..." She knows it went through.
4. **Simulate network retry**: the phone resends, and gets the same ref back. Charged once.
5. The moment the transfer is sent, **Thandi's voice confirmation plays automatically** through the
   speakers: *"Hello Thandi. Your transfer of R1500 to Mama has been sent. Reference MK..."*
   The **📞 Voice calls** panel shows the call with a **🔊 Replay** button.
6. A few seconds later (at "ready"), **Mama's voice call plays automatically**:
   *"Hello Mama. Your money from Thandi has arrived. Take your ID to a Mukuru agent."*
   Mama's phone also buzzes with her SMS, which includes a secret 6-digit code.
   Press **Teerera / Listen** for the on-device voice note (the code is never read aloud).
7. At the **Mukuru agent** card, show that the reference alone is not enough: an
   unticked ID check and a wrong code are both refused. Then pay out with the ID ticked and Mama's
   code. Mama gets a receipt; Thandi gets "Amai vatora... Hapana chikonzero chekufona."

## Voice calls
The system automatically places a TTS (text-to-speech) call at two moments:

| Trigger | Who | Message |
|---|---|---|
| Transfer `sent` | Thandi (sender) | Confirms amount, recipient and reference |
| Transfer `ready` | Mama (recipient) | Tells her to go to a Mukuru agent with her ID |

**How it works in demo mode:** the browser's built-in speech engine reads the message aloud
through the laptop speakers. The **📞 Voice calls** panel shows each call in real time, with
the exact text spoken and a **🔊 Replay** button.

**How it works in production:** the server sends the message to a voice gateway (Africa's Talking
or Twilio), which places a real outbound phone call — including international calls, e.g. to
Mama's +263 Zimbabwean number. To switch from demo to live, set `VOICE_GATEWAY_URL` and
`VOICE_GATEWAY_API_KEY`. No code changes needed.

**Reliability:** if a call fails, the system retries automatically (default: after 1 min, 5 min,
15 min). After all retries are exhausted it falls back silently to SMS, which is already in the
inbox. Voice is best-effort on top of SMS, never a replacement for it.

**Opt-in:** each recipient has a `voiceCall` boolean in their profile. Toggle it at runtime:

    POST /api/recipients/:recipientId/preferences   { "voiceCall": true }

## Structure

    data/seed.json            synthetic users, recipients, fees, limits, FX corridor
    src/
      server.js               entry point
      app.js                  wires services and routes together
      config.js               env vars and defaults
      lib/money.js            cents maths, fee rule, formatting
      lib/errors.js           AppError (code + HTTP status)
      lib/secrets.js          salted scrypt hashing for PINs and collection codes
      middleware/             security headers
      i18n/                   en.json, sn.json and the t() helper
      services/
        fx.js                 mock FX feed with a drifting rate
        users.js              senders, recipients, PIN checks, daily limits
        quotes.js             locked-rate quotes, all amounts server-side
        transfers.js          lifecycle, idempotency, stage timers
        notifications.js      SMS/voice messages in each person's language
        voice.js              TTS call service: gateway calls, retry logic, SMS fallback
        sessions.js           USSD session store
      routes/
        api.js                REST API
        ussd.js               USSD gateway handler and menu tree
    public/                   simulator pages (plain HTML/CSS/JS, no CDN)
    test/                     node:test suites

## Money rules
- All money is integer cents; rates are integer micro-units. No floating-point rounding.
- Fee = R20 + 1.67%, **rounded down to whole rands**, so rounding always favours Thandi.
- The fee comes **out of** the amount: Thandi pays R1,500 and Mama gets (R1,500 - R45) x rate.
- Quotes are created and stored on the server; a transfer only refers to a quote id.

## API

| Endpoint | Notes |
|---|---|
| `POST /api/quotes` `{amount, recipientId}` | Locked for 10 minutes; amounts in cents |
| `POST /api/transfers` `{quoteId, pin}` + `Idempotency-Key` header | Same key + same quote = same transfer (200); key reused for another quote = 422 |
| `GET /api/transfers?status=ready` | |
| `GET /api/transfers/:id` | Status, stages, timestamps |
| `POST /api/transfers/:id/collect` `{code, idChecked}` | Agent payout, only when ready; 3 wrong codes lock it |
| `GET /api/inbox/:partyId?lang=en` | `thandi` or `mama`; defaults to the person's own language |
| `GET /api/fx` | |
| `GET /api/voice-calls` | Log of all TTS calls fired this session (recipientId, transferRef, voiceText, success) |
| `POST /api/recipients/:recipientId/preferences` `{voiceCall}` | Opt a recipient in or out of voice calls |
| `POST /api/demo/reset` | Demo mode only; 404 otherwise |
| `POST /ussd` | Gateway format (Africa's Talking style): `sessionId, phoneNumber, text`; replies `CON`/`END` |

Errors are JSON: `{ "error": "<code>", ...details }`.

## Security
- **PINs:** scrypt-hashed with a salt and compared in constant time; never stored in clear or logged.
  3 wrong tries lock the account.
- **No double charges:** every transfer needs an idempotency key. A retry with the same key returns
  the same transfer; reusing a key for a different quote is refused. Quotes are one-time and bound
  to the sender.
- **Server-side maths:** amounts are calculated and stored on the server; clients only send a quote id.
- **Reference alone can't collect:** when money is ready, Mama gets a random 6-digit code by SMS
  ("Never share your code"). It is stored only as a hash, never returned by any transfer endpoint and
  never read aloud in the voice call. A payout needs a ticked ID check and the code; 3 wrong codes
  lock the payout.
- **Sender always gets her reference:** an SMS goes out the moment a transfer is created, so a
  dropped USSD session never leaves Thandi wondering whether she paid.
- **Browser headers:** strict Content-Security-Policy (no inline or third-party scripts), framing
  limited to our own pages, `nosniff`, no referrer, no `X-Powered-By`.
- **Synthetic data only.** No AI touches the money calculation.

**Demo limits (say so if asked):** there is no sender login (the API acts as Thandi), the inbox
endpoints stand in for the SMS network and are open, and references are short (MK + 5 digits).
Production would add sign-in with short-lived sessions, longer references, rate limiting and a
SIM-swap check with the mobile network.

## Languages
English and ChiShona. **The Shona strings are first drafts: have a native speaker review them
before judging.** To add a language, copy `src/i18n/en.json`, translate it and register it in
`src/i18n/index.js`.

## Voice notes (on-device, Mama's phone)
Mama's phone plays `public/audio/ready-sn.mp3` (or `ready-en.mp3`) when present. Record one
sentence by a native speaker; until then it falls back to the browser's voice.

## Not built (honest cut list)
Offline queue, real SMS/voice gateway integration (env vars are wired; gateway client is a stub), login, isiNdebele.


## Run

    npm install
    npm run demo         # demo mode: rates frozen, 3 s stages, Reset button -> http://localhost:3000
    npm start            # live, drifting rates
    npm run dev          # restarts on file changes
    npm test

| Page | What it shows |
|---|---|
| `/` | Thandi's phone (USSD), Mama's phone, Thandi's SMS inbox, Mukuru agent, demo controls |
| `/mama.html` | Mama's phone on its own, for a second laptop or phone |

Thandi's PIN: **1234**. All data is synthetic and in memory; restarting, or
**Reset demo** (demo mode only), puts everything back to the seed.

## USSD help and navigation
Choose **3 Help** for guidance on sending, tracking, fees and rates, how your receiver collects,
PIN safety, and contacting an agent. The exact fee and payout are shown before confirmation.
Agents are available Mon-Sat 8am-7pm, Sun 8am-12pm; call **0860018555**.

On continuing screens, enter **0** to go back one step or **00** to return to the main menu.
The sender's language is preserved while navigating. On the quote screen, **2 Cancel** returns
to the main menu. Only an exact `0` or `00` is navigation; other input values are unchanged.

| Env var | Default | Effect |
|---|---|---|
| `PORT` | 3000 | |
| `DEMO` | off | `1` enables demo reset, FX movement, and transfer failure controls |
| `FX_STATIC` | off | `1` freezes rates, so R1,500 always gives $94.58 |
| `STEP_MS` | 6000 | ms between tracker stages (sent -> on the way -> ready) |
| `FX_TICK_MS` | 30000 | ms between rate moves |
| `PIN_LOCK_MS` | 60000 | lockout after 3 wrong PINs |

## Demo script
1. Click **Reset demo**, then **Dial \*130\*999#** and reply `2` (ChiShona), `1` (send), `1` (Amai), `1500`.
2. The quote shows: you pay R1,500, fee R45, Amai gets $94.58, rate locked 10 min. Reply `1`.
3. Tick **Drop the next reply**, then enter PIN `1234`. The phone shows "Connection problem", but
   Thandi's SMS inbox already has "R1500 yatumirwa kuna Amai. Ref MK..." She knows it went through.
4. **Simulate network retry**: the phone resends, and gets the same ref back. Charged once.
  Use **Fail latest active transfer** to simulate a failed transfer; the sender is notified and the daily limit is restored.
5. At "ready", Mama's phone buzzes with her SMS, which includes a secret 6-digit code. Press **Teerera**
   for the voice note (the code is never read aloud).
6. At the **Mukuru agent** card, show that the reference alone is not enough: an
   unticked ID check and a wrong code are both refused. Then pay out with the ID ticked and Mama's
   code. Mama gets a receipt; Thandi gets "Amai vatora... Hapana chikonzero chekufona."

## Structure

    data/seed.json            synthetic users, recipients, fees, limits, FX corridor
    src/
      server.js               entry point
      app.js                  wires services and routes together
      config.js               env vars and defaults
      lib/money.js            cents maths, fee rule, formatting
      lib/errors.js           AppError (code + HTTP status)
      lib/secrets.js          salted scrypt hashing for PINs and collection codes
      middleware/             security headers
      i18n/                   en.json, sn.json and the t() helper
      services/
        fx.js                 mock FX feed with a drifting rate
        users.js              senders, recipients, PIN checks, daily limits
        quotes.js             locked-rate quotes, all amounts server-side
        transfers.js          lifecycle, idempotency, stage timers
        notifications.js      SMS/voice messages in each person's language
        sessions.js           USSD session store
      routes/
        api.js                REST API
        ussd.js               USSD gateway handler and menu tree
    public/                   simulator pages (plain HTML/CSS/JS, no CDN)
    test/                     node:test suites

## Money rules
- All money is integer cents; rates are integer micro-units. No floating-point rounding.
- Fee = R20 + 1.67%, **rounded down to whole rands**, so rounding always favours Thandi.
- The fee comes **out of** the amount: Thandi pays R1,500 and Mama gets (R1,500 - R45) x rate.
- Quotes are created and stored on the server; a transfer only refers to a quote id.

## API

| Endpoint | Notes |
|---|---|
| `POST /api/quotes` `{amount, recipientId}` | Locked for 10 minutes; amounts in cents |
| `POST /api/transfers` `{quoteId, pin}` + `Idempotency-Key` header | Same key + same quote = same transfer (200); key reused for another quote = 422 |
| `GET /api/transfers?status=ready` | |
| `GET /api/transfers/:id` | Status, stages, timestamps |
| `POST /api/transfers/:id/collect` `{code, idChecked}` | Agent payout, only when ready; 3 wrong codes lock it |
| `GET /api/inbox/:partyId?lang=en` | `thandi` or `mama`; defaults to the person's own language |
| `GET /api/fx` | |
| `POST /api/demo/reset` | Demo mode only; 404 otherwise |
| `POST /api/demo/transfers/:id/fail` `{reason}` | Demo mode only; fails an undelivered transfer and restores the daily limit |
| `POST /ussd` | Gateway format (Africa's Talking style): `sessionId, phoneNumber, text`; replies `CON`/`END` |

Errors are JSON: `{ "error": "<code>", ...details }`.

## Security
- **PINs:** scrypt-hashed with a salt and compared in constant time; never stored in clear or logged.
  3 wrong tries lock the account.
- **No double charges:** every transfer needs an idempotency key. A retry with the same key returns
  the same transfer; reusing a key for a different quote is refused. Quotes are one-time and bound
  to the sender.
- **Server-side maths:** amounts are calculated and stored on the server; clients only send a quote id.
- **Reference alone can't collect:** when money is ready, Mama gets a random 6-digit code by SMS
  ("Never share your code"). It is stored only as a hash, never returned by any transfer endpoint and
  never read aloud in the voice note. A payout needs a ticked ID check and the code; 3 wrong codes
  lock the payout.
- **Sender always gets her reference:** an SMS goes out the moment a transfer is created, so a
  dropped USSD session never leaves Thandi wondering whether she paid.
- **Browser headers:** strict Content-Security-Policy (no inline or third-party scripts), framing
  limited to our own pages, `nosniff`, no referrer, no `X-Powered-By`.
- **Synthetic data only.** No AI touches the money calculation.

**Demo limits (say so if asked):** there is no sender login (the API acts as Thandi), the inbox
endpoints stand in for the SMS network and are open, and references are short (MK + 5 digits).
Production would add sign-in with short-lived sessions, longer references, rate limiting and a
SIM-swap check with the mobile network.

## Languages
English and ChiShona. **The Shona strings are first drafts: have a native speaker review them
before judging.** To add a language, copy `src/i18n/en.json`, translate it and register it in
`src/i18n/index.js`.

## Voice notes
Mama's phone plays `public/audio/ready-sn.mp3` (or `ready-en.mp3`) when present. Record one
sentence by a native speaker; until then it falls back to the browser's voice, which rarely
pronounces Shona well.

## Not built (honest cut list)
Offline queue, real SMS/voice gateway, login, isiNdebele.
