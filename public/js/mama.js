'use strict';

// Mama's phone: shows the SMS the server sent her, in her language, and plays the voice note.

const RECIPIENT_ID = 'mama';
const POLL_MS      = 2000;

// Phone chrome only. Message text comes from the server (src/i18n).
const LABELS = {
  sn: { inbox: 'Mameseji', none: 'Hapana meseji.', from: 'Mukuru', play: 'Teerera', stop: 'Mira', back: 'Dzokera' },
  en: { inbox: 'Messages', none: 'No messages.',  from: 'Mukuru', play: 'Listen',  stop: 'Stop', back: 'Back' },
};

// A native speaker's recording beats any computer voice. Files placed here are used
// automatically; until then the browser's speech engine reads the text.
const voiceClip = lang => `audio/ready-${lang}.mp3`;

const $ = id => document.getElementById(id);
const state = {
  lang:     new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'sn',
  messages: [],
  index:    0,
  audio:    null,
  newestId: 0,
};

const time = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const tick = () => { $('clock').textContent = time(Date.now()); };
tick();
setInterval(tick, 10_000);

// ── Rendering ────────────────────────────────────────────────────────────────
const isPlaying = () => Boolean(state.audio) || speechSynthesis.speaking;

function render() {
  const labels  = LABELS[state.lang];
  const message = state.messages[state.index];

  document.documentElement.lang = state.lang;
  document.querySelectorAll('.lang button').forEach(b =>
    b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang)));
  $('title').textContent = `${labels.inbox} (${state.messages.length})`;

  const body = $('body');
  if (!message) {
    const idle = document.createElement('div');
    idle.className = 'idle';
    idle.textContent = labels.none;
    body.replaceChildren(idle);
  } else {
    const from = document.createElement('div');
    from.className = 'from';
    from.textContent = labels.from;
    const when = document.createElement('div');
    when.className = 'when';
    when.textContent = `${time(message.at)}  ${state.index + 1}/${state.messages.length}`;
    body.replaceChildren(from, when, document.createTextNode(`\n${message.text}`));
  }

  const left  = message?.voice ? (isPlaying() ? labels.stop : labels.play) : '';
  const right = state.index > 0 ? labels.back : '';
  $('soft-left').textContent  = left;
  $('soft-right').textContent = right;
  $('left').textContent  = left || ' ';
  $('right').textContent = right || ' ';
  $('left').disabled  = !left;
  $('right').disabled = !right;
}

/** Shake + flash, so a deaf receiver still notices a new message. */
function alertNewMessage() {
  for (const [id, cls] of [['phone', 'buzz'], ['screen', 'flash']]) {
    const node = $(id);
    node.classList.remove(cls);
    void node.offsetWidth;   // restart the CSS animation
    node.classList.add(cls);
  }
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* not supported */ }
}

// ── Voice note ───────────────────────────────────────────────────────────────
function stopVoice() {
  state.audio?.pause();
  state.audio = null;
  speechSynthesis.cancel();
}

async function playVoice(text) {
  stopVoice();
  const clip = new Audio(voiceClip(state.lang));
  try {
    await clip.play();
    state.audio = clip;
    clip.onended = () => { state.audio = null; render(); };
  } catch {
    // No recorded clip: fall back to the browser voice (usually an English accent for Shona).
    const speech = new SpeechSynthesisUtterance(text);
    speech.lang  = state.lang === 'sn' ? 'sn-ZW' : 'en-ZA';
    speech.rate  = 0.9;
    speech.onend = render;
    speechSynthesis.speak(speech);
  }
  render();
}

// ── Inbox ────────────────────────────────────────────────────────────────────
async function refresh() {
  let inbox;
  try {
    inbox = await fetch(`/api/inbox/${RECIPIENT_ID}?lang=${state.lang}`).then(r => r.json());
  } catch {
    return;
  }
  const newestId = inbox.messages[0]?.id ?? 0;
  const isNew = newestId > state.newestId;
  state.messages = inbox.messages;
  state.newestId = newestId;
  if (isNew) state.index = 0;
  render();
  if (isNew) alertNewMessage();
}

// ── Wiring ───────────────────────────────────────────────────────────────────
$('left').addEventListener('click', () => {
  const message = state.messages[state.index];
  if (isPlaying()) stopVoice();
  else if (message?.voice) playVoice(message.voice);
  render();
});
$('right').addEventListener('click', () => { state.index = 0; render(); });
$('next').addEventListener('click', () => {
  if (state.messages.length) state.index = (state.index + 1) % state.messages.length;
  render();
});
document.querySelectorAll('.lang button').forEach(button =>
  button.addEventListener('click', () => {
    state.lang = button.dataset.lang;
    stopVoice();
    refresh();
  }));

render();
refresh();
setInterval(refresh, POLL_MS);
