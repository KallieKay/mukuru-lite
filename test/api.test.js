'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startTestServer, wait } = require('./helpers');

test('REST API', async t => {
  const server = await startTestServer();
  t.after(() => server.close());
  const { api } = server;

  const quote = async (amount = '1500') =>
    (await api('/api/quotes', { method: 'POST', body: { amount, recipientId: 'mama' } })).body;

  await t.test('quote takes the fee out of the amount and pays out in USD', async () => {
    const q = await quote();
    assert.equal(q.amountCents, 150000);
    assert.equal(q.feeCents, 4500);
    assert.equal(q.receivedCents, 9458);
    assert.equal(q.currency, 'USD');
  });

  await t.test('quote rejects amounts outside the limits', async () => {
    for (const amount of ['10', '999999', 'abc']) {
      const res = await api('/api/quotes', { method: 'POST', body: { amount, recipientId: 'mama' } });
      assert.equal(res.status, 400);
      assert.equal(res.body.error, 'invalid_amount');
    }
  });

  await t.test('transfer needs an idempotency key', async () => {
    const q = await quote();
    const res = await api('/api/transfers', { method: 'POST', body: { quoteId: q.quoteId, pin: '1234' } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'idempotency_key_required');
  });

  await t.test('wrong PIN is rejected and the PIN is never echoed back', async () => {
    const q = await quote();
    const res = await api('/api/transfers', {
      method: 'POST', headers: { 'Idempotency-Key': 'k-wrong' }, body: { quoteId: q.quoteId, pin: '9999' },
    });
    assert.equal(res.status, 401);
    assert.deepEqual(res.body, { error: 'wrong_pin', triesLeft: 2 });
  });

  await t.test('same request twice creates one transfer', async () => {
    const q = await quote();
    const send = () => api('/api/transfers', {
      method: 'POST', headers: { 'Idempotency-Key': 'k-twice' }, body: { quoteId: q.quoteId, pin: '1234' },
    });
    const first = await send();
    const retry = await send();
    assert.equal(first.status, 201);
    assert.equal(retry.status, 200);
    assert.equal(retry.body.id, first.body.id);
  });

  await t.test('a key cannot be reused for a different quote', async () => {
    const q = await quote('200');
    const res = await api('/api/transfers', {
      method: 'POST', headers: { 'Idempotency-Key': 'k-twice' }, body: { quoteId: q.quoteId, pin: '1234' },
    });
    assert.equal(res.status, 422);
    assert.equal(res.body.error, 'idempotency_key_reused');
  });

  await t.test('a quote can only be used once', async () => {
    const q = await quote('100');
    const body = { quoteId: q.quoteId, pin: '1234' };
    await api('/api/transfers', { method: 'POST', headers: { 'Idempotency-Key': 'k-a' }, body });
    const again = await api('/api/transfers', { method: 'POST', headers: { 'Idempotency-Key': 'k-b' }, body });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'quote_invalid');
  });

  const AGENT = { idChecked: true };

  const sendAndWaitUntilReady = async (amount, key) => {
    const q = await quote(amount);
    const { body: transfer } = await api('/api/transfers', {
      method: 'POST', headers: { 'Idempotency-Key': key }, body: { quoteId: q.quoteId, pin: '1234' },
    });
    await wait(100);
    const sms = (await api('/api/inbox/mama?lang=en')).body.messages.find(m => m.ref === transfer.id);
    return { transfer, code: sms.text.match(/Code (\d{6})/)[1] };
  };

  const collect = (id, body) => api(`/api/transfers/${id}/collect`, { method: 'POST', body });

  await t.test('Thandi gets her reference by SMS the moment she sends', async () => {
    const q = await quote('250');
    const { body: transfer } = await api('/api/transfers', {
      method: 'POST', headers: { 'Idempotency-Key': 'k-sms' }, body: { quoteId: q.quoteId, pin: '1234' },
    });
    const sms = (await api('/api/inbox/thandi')).body.messages
      .find(m => m.ref === transfer.id && m.status === 'sent');
    assert.match(sms.text, new RegExp(`R250 sent to Mama\\. Ref ${transfer.id}`));
  });

  await t.test('collection code is in Mama\'s SMS but never in a transfer response', async () => {
    const { transfer, code } = await sendAndWaitUntilReady('300', 'k-hidden');
    const views = [(await api(`/api/transfers/${transfer.id}`)).body, ...(await api('/api/transfers')).body];
    for (const view of views) {
      assert.equal(view.collection, undefined);
      assert.ok(!JSON.stringify(view).includes(code));
    }
    const voice = (await api('/api/inbox/mama')).body.messages.find(m => m.ref === transfer.id && m.voice);
    assert.ok(!voice.voice.includes(code), 'code must not be read aloud');
  });

  await t.test('payout needs an ID check and the right code', async () => {
    const { transfer, code } = await sendAndWaitUntilReady('400', 'k-payout');

    const noId = await collect(transfer.id, { ...AGENT, idChecked: false, code });
    assert.equal(noId.status, 400);
    assert.equal(noId.body.error, 'id_check_required');

    const wrongCode = await collect(transfer.id, { ...AGENT, code: code === '000000' ? '111111' : '000000' });
    assert.equal(wrongCode.status, 403);
    assert.deepEqual(wrongCode.body, { error: 'wrong_code', triesLeft: 2 });

    const paid = await collect(transfer.id, { ...AGENT, code });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.status, 'collected');
    assert.deepEqual(Object.keys(paid.body.timestamps), ['sent', 'in_transit', 'ready', 'collected']);

    const [mamaLatest, mamaReady] = (await api('/api/inbox/mama')).body.messages;
    assert.match(mamaLatest.text, /^Watora \$/);
    assert.match(mamaReady.text, /kubva kuThandi/);
    assert.ok(mamaReady.voice);
    assert.match((await api('/api/inbox/mama?lang=en')).body.messages[0].text, /^You collected \$/);
    assert.match((await api('/api/inbox/thandi')).body.messages[0].text, /Mama collected/);
  });

  await t.test('three wrong codes lock the payout', async () => {
    const { transfer, code } = await sendAndWaitUntilReady('500', 'k-lock');
    const wrong = code === '000000' ? '111111' : '000000';
    await collect(transfer.id, { ...AGENT, code: wrong });
    await collect(transfer.id, { ...AGENT, code: wrong });
    const third = await collect(transfer.id, { ...AGENT, code: wrong });
    assert.equal(third.status, 423);
    const evenRight = await collect(transfer.id, { ...AGENT, code });
    assert.equal(evenRight.body.error, 'collection_locked');
    assert.equal((await api(`/api/transfers/${transfer.id}`)).body.collectionLocked, true);
  });

  await t.test('cannot pay out before the money is ready', async () => {
    const q = await quote('600');
    const { body: transfer } = await api('/api/transfers', {
      method: 'POST', headers: { 'Idempotency-Key': 'k-early' }, body: { quoteId: q.quoteId, pin: '1234' },
    });
    const early = await collect(transfer.id, { ...AGENT, code: '123456' });
    assert.equal(early.status, 409);
    assert.equal(early.body.error, 'not_ready');
  });

  await t.test('demo reset is not available outside demo mode', async () => {
    assert.equal((await api('/api/demo/reset', { method: 'POST' })).status, 404);
  });

  await t.test('unsupported inbox language is rejected', async () => {
    const res = await api('/api/inbox/mama?lang=xx');
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'unsupported_language');
  });
});

test('security headers are set on pages and API', async t => {
  const server = await startTestServer();
  t.after(() => server.close());
  for (const path of ['/', '/api/fx']) {
    const res = await fetch(server.base + path);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(res.headers.get('x-powered-by'), null);
  }
});

test('demo reset clears everything back to the seed', async t => {
  const server = await startTestServer({ DEMO: '1' });
  t.after(() => server.close());
  const { api, ussd } = server;

  await ussd('r1', '2*1*1*1500*1*1234');
  assert.equal((await api('/api/transfers')).body.length, 1);

  const res = await api('/api/demo/reset', { method: 'POST' });
  assert.equal(res.status, 200);
  assert.equal((await api('/api/transfers')).body.length, 0);
  assert.equal((await api('/api/inbox/thandi')).body.messages.length, 0);
  assert.match(await ussd('r2', ''), /^CON Mukuru\n1 English\n2 ChiShona/, 'language is asked again');
});
