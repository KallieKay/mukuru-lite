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
    assert.match(await ussd('s5', '1*1*300*2'), /^END Kumiswa/);
    assert.match(await ussd('s6', '1*1*300*1*0000'), /^END PIN haisi iyo. Mikana yasara: 2/);
    assert.match(await ussd('s7', '9'), /^END Sarudzo haina kunaka/);
  });

  await t.test('unknown phone numbers are turned away', async () => {
    assert.match(await ussd('s8', '', '+27999999999'), /^END This number is not registered/);
  });
});
