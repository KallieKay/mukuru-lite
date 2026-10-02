'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer } = require('./helpers');

const MAX_SCREEN_CHARS = 182;

test('USSD channel', async t => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { ussd } = server;

  await t.test('full send journey in ChiShona', async () => {
    const steps = ['', '2', '2*1', '2*1*1', '2*1*1*1500', '2*1*1*1500*1', '2*1*1*1500*1*1234'];
    const screens = [];
    for (const text of steps) screens.push(await ussd('s1', text));

    assert.match(screens[0], /^CON Mukuru\n1 English\n2 ChiShona/);
    assert.match(screens[1], /^CON .*Tumira mari/s);
    assert.match(screens[4], /Unobhadhara R1500\nMuripo R45\nAmai vachawana \$94\.58/);
    assert.match(screens[6], /^END Yatumirwa! Ref MK\d{5}/);
    for (const screen of screens) assert.ok(screen.length - 4 <= MAX_SCREEN_CHARS);
  });

  await t.test('a gateway retry returns the same transfer', async () => {
    const first = await ussd('s1', '2*1*1*1500*1*1234');
    const retry = await ussd('s1', '2*1*1*1500*1*1234');
    assert.equal(retry, first);
    assert.equal(server.services.transfers.list().length, 1);
  });

  await t.test('a dropped reply still leaves Thandi with her reference by SMS', async () => {
    // The phone never sees the final screen; the SMS inbox still has the ref, in her language.
    const [transfer] = server.services.transfers.list();
    const sms = server.services.notifications.inbox('thandi').messages
      .find(m => m.ref === transfer.id && m.status === 'sent');
    assert.match(sms.text, /yatumirwa kuna Amai/);
  });

  await t.test('language is remembered on the next dial', async () => {
    assert.match(await ussd('s2', ''), /^CON Mukuru\n1 Tumira mari/);
  });

  await t.test('where is my money shows the tracker', async () => {
    assert.match(await ussd('s3', '2'), /^END MK\d{5} kuna Amai:\n\[x\] Yatumirwa/);
  });

  await t.test('errors end the session with a clear message', async () => {
    assert.match(await ussd('s4', '1*1*10'), /^END Isa mari kubva paR50 kusvika paR5000/);
    assert.match(await ussd('s5', '1*1*300*2'), /^CON Mukuru\n1 Tumira mari/);
    assert.match(await ussd('s6', '1*1*300*1*0000'), /^END PIN haisi iyo. Mikana yasara: 2/);
    assert.match(await ussd('s7', '9'), /^END Sarudzo haina kunaka/);
  });

  await t.test('unknown phone numbers are turned away', async () => {
    assert.match(await ussd('s8', '', '+27999999999'), /^END This number is not registered/);
  });
});

test('USSD help, navigation, and screen limits', async t => {
  const server = await startTestServer({ STEP_MS: '30000' });
  t.after(() => server.close());
  const { ussd, services } = server;
  const user = services.users.get('thandi');

  await t.test('help and send CON screens fit in both languages', async () => {
    services.users.setLanguage(user, null);
    const languageScreen = await ussd('language-limit', '');
    assert.ok(languageScreen.length - 4 <= MAX_SCREEN_CHARS);
    assert.ok(languageScreen.endsWith('0 Back\n00 Menu'));

    for (const lang of ['en', 'sn']) {
      services.users.setLanguage(user, lang);
      const paths = ['', '1', '1*1', '1*1*1500', '1*1*1500*1', '3',
        ...['1', '2', '3', '4', '5', '6'].map(option => `3*${option}`)];
      for (const [index, path] of paths.entries()) {
        const screen = await ussd(`screen-${lang}-${index}`, path);
        assert.match(screen, /^CON /, `${lang} ${path}`);
        assert.ok(screen.length - 4 <= MAX_SCREEN_CHARS, `${lang} ${path}: ${screen.length - 4}`);
      }
    }
  });

  await t.test('all six help options show a separate-line Back/Menu footer', async () => {
    for (const [lang, footer] of [['en', '0 Back\n00 Menu'], ['sn', '0 Dzokera\n00 Menyu']]) {
      services.users.setLanguage(user, lang);
      for (let option = 1; option <= 6; option += 1) {
        const screen = await ussd(`help-${lang}-${option}`, `3*${option}`);
        assert.match(screen, /^CON /);
        assert.ok(screen.endsWith(footer));
      }
    }
  });

  await t.test('help topics speak to the sender and explain receiver collection', async () => {
    services.users.setLanguage(user, 'en');
    const menu = await ussd('help-menu', '3');
    assert.match(menu, /4 How your receiver collects/);
    const collecting = await ussd('help-collect-en', '3*4');
    assert.equal(collecting,
      'CON Tell your receiver to take their ID and the secret code from their SMS to a Mukuru agent. ' +
      'The reference alone is not enough. Never share the code.\n0 Back\n00 Menu');

    services.users.setLanguage(user, 'sn');
    const shonaCollecting = await ussd('help-collect-sn', '3*4');
    assert.match(shonaCollecting, /Udza.*waunotumira.*aende.*neID.*SMS yake.*Reference yoga.*Usambogovana/);
    assert.match(shonaCollecting, /0 Dzokera\n00 Menyu$/);
  });

  await t.test('Back removes one step and Menu returns to the main menu', async () => {
    services.users.setLanguage(user, 'en');
    assert.match(await ussd('back-help', '3*1*0'), /^CON Help\n1 How to send money/);
    assert.match(await ussd('menu-help', '3*1*00'), /^CON Mukuru\n1 Send money/);
    assert.match(await ussd('menu-pin', '1*1*1500*1*00'), /^CON Mukuru\n1 Send money/);
  });

  await t.test('Back cannot remove the language choice', async () => {
    services.users.setLanguage(user, null);
    assert.match(await ussd('language-back', '0'), /^CON Mukuru\n1 English\n2 ChiShona/);
    assert.match(await ussd('language-back', '0*2*0'), /^CON Mukuru\n1 Tumira mari/);
    assert.equal(user.language, 'sn');
  });

  await t.test('backing out and resending reuses the quote and makes one transfer', async () => {
    services.users.setLanguage(user, 'en');
    const quoteCount = services.quotes.quotes.size;
    assert.match(await ussd('send-back', '1*1*1500'), /^CON You pay R1500/);
    assert.match(await ussd('send-back', '1*1*1500*0'), /^CON Amount to send/);
    assert.match(await ussd('send-back', '1*1*1500*0*1500'), /^CON You pay R1500/);
    assert.match(await ussd('send-back', '1*1*1500*0*1500*1'), /^CON Enter your 4-digit PIN/);
    assert.match(await ussd('send-back', '1*1*1500*0*1500*1*1234'), /^END Sent!/);
    assert.equal(services.quotes.quotes.size, quoteCount + 1);
    assert.equal(services.transfers.list().length, 1);
  });

  await t.test('fee help uses configured fees and rate-lock duration', async () => {
    services.users.setLanguage(user, 'en');
    services.quotes.fees = { flatCents: 2500, percentBps: 225, roundDownToCents: 500 };
    services.quotes.rateLockMs = 7 * 60_000;
    const screen = await ussd('fees-live', '3*3');
    assert.match(screen, /Your fee is R25 \+ 2\.25% \(rounded down to R5\)/);
    assert.match(screen, /Your rate locks for 7 min/);
  });

  await t.test('a PIN beginning with zero remains a PIN', async () => {
    services.users.setLanguage(user, 'en');
    assert.match(await ussd('leading-zero-pin', '1*1*1500*1*0123'), /^END Wrong PIN/);
  });
});
