// app.js — state, mutate(), routing.
// Persistence is structural: every state change goes through mutate(),
// which applies, re-renders, and schedules a debounced save.

import * as store from './store.js';

const SAVE_DEBOUNCE_MS = 400;
const STATE_KEY = 'state';

const defaultState = () => ({ schema: 1, counter: 0 });

let state = defaultState();
let saveTimer = null;
let dirty = false;

// ---------- persistence ----------

function setSaveStatus(ok, err) {
  document.getElementById('not-saving').hidden = ok;
  if (!ok) console.error('[store] save failed:', err);
}

async function save() {
  saveTimer = null;
  if (!dirty) return;
  dirty = false;
  try {
    await store.putKV(STATE_KEY, state);
    setSaveStatus(true);
  } catch (err) {
    dirty = true; // keep it dirty so the next mutate or flush retries
    setSaveStatus(false, err);
  }
}

function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DEBOUNCE_MS);
}

// Flush immediately when the app is backgrounded — Android can kill it at any point after.
function flush() {
  if (!dirty) return;
  clearTimeout(saveTimer);
  save();
}

export function mutate(fn) {
  fn(state);
  render();
  scheduleSave();
}

// ---------- render ----------

function render() {
  document.getElementById('counter-value').textContent = state.counter;
}

// ---------- boot ----------

async function boot() {
  document.getElementById('counter-inc').addEventListener('click', () =>
    mutate(s => { s.counter += 1; }));
  document.getElementById('counter-reset').addEventListener('click', () =>
    mutate(s => { s.counter = 0; }));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  addEventListener('pagehide', flush);

  try {
    const saved = await store.getKV(STATE_KEY);
    if (saved) state = { ...defaultState(), ...saved };
    setSaveStatus(true);
  } catch (err) {
    setSaveStatus(false, err);
  }
  render();
  store.requestPersistence().catch(() => {});
}

boot();
