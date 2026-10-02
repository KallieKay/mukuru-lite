'use strict';

// Thandi's phone: a USSD dialler that talks to POST /ussd like a real network gateway,
// plus her SMS inbox and the demo controls.

const SERVICE_CODE  = '*130*999#';
const SERVICE_ROOT  = '*130*999';
const PHONE_NUMBER  = '+27000000001';   // synthetic, matches data/seed.json
const SENDER_ID     = 'thandi';
const MAX_CHARS     = 182;
const POLL_MS       = 2000;
const DROPPED       = 'Connection problem or invalid MMI code.';

const $ = id => document.getElementById(id);
const el = {
  number:  $('number'),
  overlay: $('overlay'),
  message: $('message'),
  reply:   $('reply'),
  send:    $('send'),
  cancel:  $('cancel'),
  ok:      $('ok'),
  inbox:   $('inbox'),
  note:    $('note'),
  dev:     $('dev'),
  timeout: $('timeout'),
  dropNext: $('drop-next'),
  fx: {
    market: $('fx-market'),
    locked: $('fx-locked'),
    up: $('fx-up'),
    down: $('fx-down'),
  },
  agent: {
    form:      $('agent-form'),
    ref:       $('agent-ref'),
    code:      $('agent-code'),
    idChecked: $('agent-id'),
    note:      $('agent-note'),
  },
};

const state = {
  sessionId: null,
  replies:   [],
  lastBody:  null,
  screen:    '',
  timer:     null,
  inboxSize: 0,
};

const escapeHtml = s =>
  s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const findRef  = text => (text.match(/Ref (MK\d+)/) || [])[1];
const setNote = (node, text, tone = '') => {
  node.textContent = text;
  node.className = `note ${tone}`.trim();
};
const showNote = (text, tone) => setNote(el.note, text, tone);
const time     = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

// ── Clock ────────────────────────────────────────────────────────────────────
const tick = () => { $('clock').textContent = time(Date.now()); };
tick();
setInterval(tick, 10_000);

// ── Dialog ───────────────────────────────────────────────────────────────────
function openDialog(text, { input = false, loading = false } = {}) {
  el.overlay.classList.add('open');
  el.message.textContent = text;
  el.message.classList.toggle('loading', loading);
  el.reply.hidden  = !input;
  el.send.hidden   = !input;
  el.cancel.hidden = !input;
  el.ok.hidden     = input || loading;
  el.reply.value   = '';
  if (input) el.reply.focus();
}

function closeDialog() {
  el.overlay.classList.remove('open');
  clearTimeout(state.timer);
}

function endSession(text) {
  state.sessionId = null;
  clearTimeout(state.timer);
  openDialog(text);
}

// ── USSD session ─────────────────────────────────────────────────────────────
function dial(code) {
  code = code.trim();
  if (!code.startsWith(SERVICE_ROOT) || !code.endsWith('#')) return endSession(DROPPED);
  // Chained dialling (*130*999*1*1#) pre-fills the first replies, as on a real network.
  state.replies   = code.slice(SERVICE_ROOT.length, -1).split('*').filter(Boolean);
  state.sessionId = `sim-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  request();
}

function sendReply() {
  const value = el.reply.value.trim();
  if (!value || !state.sessionId) return;
  state.replies.push(value);
  request();
}

function cancelSession() {
  state.sessionId = null;
  closeDialog();
}

async function postUssd(body) {
  const res = await fetch('/ussd', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams(body),
  });
  return res.text();
}

async function request() {
  clearTimeout(state.timer);
  openDialog('USSD code running...', { loading: true });
  state.lastBody = {
    sessionId:   state.sessionId,
    serviceCode: SERVICE_CODE,
    phoneNumber: PHONE_NUMBER,
    text:        state.replies.join('*'),
  };
  try {
    const raw = await postUssd(state.lastBody);
    // Demo of the worst case: the server acted on the request but the reply never reached
    // the phone. Thandi still gets her reference by SMS, and a retry cannot charge twice.
    if (el.dropNext.checked) {
      el.dropNext.checked = false;
      state.screen = raw.slice(4);   // what the server sent, so a retry can be compared with it
      showGateway(`${state.lastBody.text}  (reply dropped)`, raw);
      return endSession(DROPPED);
    }
    render(raw);
  } catch {
    endSession(DROPPED);
  }
}

function render(raw) {
  const type = raw.slice(0, 3);
  const text = raw.slice(4);
  state.screen = text;
  showGateway(state.lastBody.text, raw);

  if (type !== 'CON') return endSession(text);

  openDialog(text, { input: true });
  // Real gateways drop idle sessions. When that happens, nothing has been sent.
  const seconds = Math.max(5, Number(el.timeout.value) || 60);
  state.timer = setTimeout(() => endSession(DROPPED), seconds * 1000);
}

function showGateway(text, raw) {
  const length = raw.length - 4;
  const over = length > MAX_CHARS ? ' class="over"' : '';
  el.dev.innerHTML =
    `POST /ussd  text="${escapeHtml(text)}"\n` +
    `<span${over}>screen: ${length}/${MAX_CHARS} chars</span>\n\n${escapeHtml(raw)}`;
}

// ── Thandi's SMS inbox (written by the server) ───────────────────────────────
async function refreshInbox() {
  let inbox;
  try {
    inbox = await fetch(`/api/inbox/${SENDER_ID}`).then(r => r.json());
  } catch {
    return;
  }
  if (inbox.messages.length === state.inboxSize) return;
  state.inboxSize = inbox.messages.length;

  if (!inbox.messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No messages yet.';
    return el.inbox.replaceChildren(empty);
  }
  el.inbox.replaceChildren(...inbox.messages.map(m => {
    const item = document.createElement('div');
    item.className = 'sms';
    item.textContent = m.text;
    const stamp = document.createElement('time');
    stamp.textContent = new Date(m.at).toLocaleTimeString();
    item.append(stamp);
    return item;
  }));
}

function formatRate(value) {
  return `$${Number(value).toFixed(3)}`;
}

async function refreshFxCard() {
  let fx;
  try {
    fx = await fetch('/api/fx').then(r => r.json());
  } catch {
    return;
  }

  const market = fx.find(r => r.code === 'ZW');
  const marketRate = market ? formatRate(market.rate) : '—';
  el.fx.market.textContent = marketRate;

  let transfer;
  try {
    transfer = await fetch('/api/transfers').then(r => r.json());
  } catch {
    el.fx.locked.textContent = marketRate;
    return;
  }

  const latest = transfer.at(-1);
  el.fx.locked.textContent = latest ? formatRate(latest.rate) : marketRate;
}

async function demoFxMove(direction) {
  const res = await fetch('/api/demo/fx-move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ direction }),
  });
  if (!res.ok) {
    showNote('FX movement is only available in demo mode.', 'error');
    return;
  }
  const nextRate = await res.json();
  el.fx.market.textContent = formatRate(nextRate.rate);
  await refreshFxCard();
  showNote('Market rate moved. Quotes already on a phone keep their locked rate.', 'ok');
}

// ── Agent payout ─────────────────────────────────────────────────────────────
const AGENT_ERRORS = {
  id_check_required: 'Check her ID first.',
  wrong_code:        e => `Wrong code. ${e.triesLeft} tries left.`,
  collection_locked: 'Locked after 3 wrong codes. Send to support.',
  not_ready:         e => `Not ready yet (${e.status}).`,
  not_found:         'No transfer with that reference.',
};

async function payOut(event) {
  event.preventDefault();
  const { ref, code, idChecked, note } = el.agent;
  const res = await fetch(`/api/transfers/${encodeURIComponent(ref.value.trim())}/collect`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      code:      code.value.trim(),
      idChecked: idChecked.checked,
    }),
  });
  const body = await res.json();
  if (res.ok) {
    setNote(note, `Paid out ${body.id}. Thandi and Mama have been told.`, 'ok');
    el.agent.form.reset();
    return;
  }
  const message = AGENT_ERRORS[body.error] ?? `Failed: ${body.error}`;
  setNote(note, typeof message === 'function' ? message(body) : message, 'error');
}

/** Pre-fills the newest ready reference, as an agent's screen would after a lookup. */
async function suggestReadyRef() {
  const { ref } = el.agent;
  if (ref.value || document.activeElement === ref) return;
  try {
    const ready = await fetch('/api/transfers?status=ready').then(r => r.json());
    if (ready.length) ref.value = ready.at(-1).id;
  } catch { /* offline: leave the field empty */ }
}

// ── Demo controls ────────────────────────────────────────────────────────────
async function resetDemo() {
  const res = await fetch('/api/demo/reset', { method: 'POST' });
  if (!res.ok) return showNote('Reset only works in demo mode: start with npm run demo.', 'error');
  cancelSession();
  Object.assign(state, { replies: [], lastBody: null, screen: '', inboxSize: -1 });
  el.number.textContent = '';
  el.dev.textContent = 'No request yet.';
  el.agent.form.reset();
  setNote(el.agent.note, '');
  await refreshInbox();
  showNote('Demo reset: no transfers, language will be asked again.', 'ok');
}

// Re-sends the exact last request, as a gateway does after a dropped connection.
// The reply, and the transfer ref inside it, must be identical.
async function simulateRetry() {
  if (!state.lastBody) return showNote('Make a request first.');
  const before = findRef(state.screen);
  const raw    = await postUssd(state.lastBody);
  const after  = findRef(raw);
  showGateway(`${state.lastBody.text}  (retry)`, raw);
  if (!before || !after) return showNote('Retry sent: same request, same reply.');
  showNote(before === after
    ? `Retry returned the same ref ${after}: charged once.`
    : `Different ref ${after}: double charge!`);
}

// ── Wiring ───────────────────────────────────────────────────────────────────
$('keypad').addEventListener('click', e => {
  if (e.target.tagName === 'BUTTON') el.number.textContent += e.target.textContent;
});
$('delete').addEventListener('click', () => { el.number.textContent = el.number.textContent.slice(0, -1); });
$('call').addEventListener('click', () => dial(el.number.textContent));
$('quick-dial').addEventListener('click', () => { el.number.textContent = SERVICE_CODE; dial(SERVICE_CODE); });
$('retry').addEventListener('click', simulateRetry);
$('reset').addEventListener('click', resetDemo);
el.fx.up.addEventListener('click', () => demoFxMove('up'));
el.fx.down.addEventListener('click', () => demoFxMove('down'));
el.agent.form.addEventListener('submit', payOut);
el.send.addEventListener('click', sendReply);
el.cancel.addEventListener('click', cancelSession);
el.ok.addEventListener('click', closeDialog);

document.addEventListener('keydown', e => {
  if (el.overlay.classList.contains('open')) {
    if (e.key === 'Escape') cancelSession();
    if (e.key === 'Enter') (el.send.hidden ? closeDialog : sendReply)();
    return;
  }
  if (e.target.closest('input, textarea, select, form')) return;
  if (/^[0-9*#]$/.test(e.key)) el.number.textContent += e.key;
  if (e.key === 'Backspace')   el.number.textContent = el.number.textContent.slice(0, -1);
  if (e.key === 'Enter')       dial(el.number.textContent);
});

refreshInbox();
refreshFxCard();
setInterval(() => { refreshInbox(); refreshFxCard(); suggestReadyRef(); }, POLL_MS);
