# Money Home, Made Simple (SheHacks x Mukuru)

One transfer thread for Thandi in Johannesburg and Mama in Harare.
Thandi sends over USSD (`*130*999#`), Mama gets an SMS and voice note in ChiShona,
and Thandi gets "Collected" back. No data, no app and no phone call needed.

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

| Env var | Default | Effect |
|---|---|---|
| `PORT` | 3000 | |
| `DEMO` | off | `1` enables `POST /api/demo/reset` and the Reset demo button |
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
