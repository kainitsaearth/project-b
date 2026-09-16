// app.js — state, mutate(), routing.
// Persistence is structural: every state change goes through mutate(), which
// applies, re-renders, and schedules a debounced save. Handlers never say
// what changed — save() works it out by diffing against the last write.

import * as store from './store.js?v=3';
import * as model from './model.js?v=3';
import { createUI } from './ui.js?v=3';

const SAVE_DEBOUNCE_MS = 400;
const STATE_KEY = 'state';
const SCHEMA = 2;

const state = {
  meta: { seeded: false },
  beans: {}, rigs: {}, waters: {},   // id → entity
};

// JSON of what is known to be on disk, per record.
let saved = emptySnapshot();
let saveTimer = null;
let dirty = false;
let inFlight = false;
let ui = null;

function emptySnapshot() {
  return { kv: null, ...Object.fromEntries(model.ENTITY_STORES.map(n => [n, new Map()])) };
}

// ---------- persistence ----------

function setSaveStatus(ok, err) {
  document.getElementById('not-saving').hidden = ok;
  if (!ok) console.error('[store] save failed:', err);
}

const kvValue = () => ({ schema: SCHEMA, meta: state.meta });

// Everything that differs from the last successful write, as one batch.
function pendingOps() {
  const ops = [];
  const next = { kv: JSON.stringify(kvValue()) };
  if (next.kv !== saved.kv) ops.push({ store: 'kv', type: 'put', key: STATE_KEY, value: kvValue() });

  for (const name of model.ENTITY_STORES) {
    const snap = new Map();
    for (const [id, entity] of Object.entries(state[name])) {
      const json = JSON.stringify(entity);
      snap.set(id, json);
      if (saved[name].get(id) !== json) ops.push({ store: name, type: 'put', value: structuredClone(entity) });
    }
    for (const id of saved[name].keys()) {
      if (!snap.has(id)) ops.push({ store: name, type: 'delete', key: id });
    }
    next[name] = snap;
  }
  return { ops, next };
}

async function save() {
  saveTimer = null;
  if (!dirty || inFlight) return;
  dirty = false;
  inFlight = true;
  let failed = false;
  const { ops, next } = pendingOps();
  try {
    await store.commit(ops);
    saved = next;
    setSaveStatus(true);
  } catch (err) {
    failed = true;
    dirty = true; // retried on the next mutate or flush, not in a hot loop
    setSaveStatus(false, err);
  } finally {
    inFlight = false;
    // A mutate that landed mid-write still needs saving.
    if (dirty && !failed) scheduleSave();
  }
}

function scheduleSave() {
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DEBOUNCE_MS);
}

// Save now when backgrounded — Android can kill the app at any point after.
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

async function load() {
  const kv = await store.getKV(STATE_KEY);
  // Step 1 stored { schema: 1, counter }. Only `meta` carries forward.
  if (kv?.meta) Object.assign(state.meta, kv.meta);
  const snap = emptySnapshot();
  snap.kv = kv === undefined ? null : JSON.stringify(kv);
  for (const name of model.ENTITY_STORES) {
    for (const entity of await store.getAll(name)) {
      state[name][entity.id] = entity;
      snap[name].set(entity.id, JSON.stringify(entity));
    }
  }
  saved = snap;
}

// First run only. The flag lives in meta, so deleting a seeded rig keeps it deleted.
function seed() {
  const { rigs, waters } = model.seedPresets();
  mutate(s => {
    for (const r of rigs) s.rigs[r.id] ??= r;
    for (const w of waters) s.waters[w.id] ??= w;
    s.meta.seeded = true;
  });
}

// ---------- routing ----------

const ROUTE = /^#\/(beans|rigs|waters)(?:\/([^/]+))?$/;

function currentRoute() {
  const m = ROUTE.exec(location.hash);
  return m ? { kind: m[1], id: m[2] ? decodeURIComponent(m[2]) : null } : { kind: 'beans', id: null };
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function render() {
  ui?.render(state, currentRoute());
}

const actions = {
  create(kind) {
    const entity = model.factories[kind]();
    mutate(s => { s[kind][entity.id] = entity; });
    navigate(`#/${kind}/${encodeURIComponent(entity.id)}`);
  },
  update(kind, id, key, value) {
    mutate(s => { if (s[kind][id]) s[kind][id][key] = value; });
  },
  remove(kind, id) {
    mutate(s => { delete s[kind][id]; });
    navigate(`#/${kind}`);
  },
};

// ---------- boot ----------

async function boot() {
  ui = createUI(document.getElementById('view'), document.getElementById('tabs'), actions);

  addEventListener('hashchange', render);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
  addEventListener('pagehide', flush);

  try {
    await load();
    setSaveStatus(true);
  } catch (err) {
    setSaveStatus(false, err);
  }
  if (!state.meta.seeded) seed();
  render();
  store.requestPersistence().catch(() => {});

  const params = new URLSearchParams(location.search);
  if (location.hostname === 'localhost' || params.has('test')) {
    import('./tests.js?v=3').then(m => m.runTests());
  }
}

boot();
