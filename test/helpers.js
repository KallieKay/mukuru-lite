'use strict';

const seed = require('../data/seed.json');
const { loadConfig } = require('../src/config');
const { createApp } = require('../src/app');

/** Starts a fresh app on a random port with frozen rates and fast tracker stages. */
async function startTestServer(env = {}) {
  const config = loadConfig({ FX_STATIC: '1', STEP_MS: '30', ...env });
  const { app, services, stop } = createApp({ seed: structuredClone(seed), config });
  const server = await new Promise(resolve => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const api = async (path, { method = 'GET', body, headers = {} } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json() };
  };

  const ussd = async (sessionId, text, phoneNumber = '+27000000001') => {
    const res = await fetch(base + '/ussd', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ sessionId, serviceCode: '*130*999#', phoneNumber, text }),
    });
    return res.text();
  };

  const close = () => {
    stop();
    return new Promise(resolve => server.close(resolve));
  };

  return { base, api, ussd, services, close };
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = { startTestServer, wait };
