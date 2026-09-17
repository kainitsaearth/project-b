// app.js — state, mutate(), routing.
// Persistence is structural: every state change goes through mutate(), which
// applies, re-renders, and schedules a debounced save. Handlers never say
// what changed — save() works it out by diffing against the last write.

import * as store from './store.js?v=12';
import * as model from './model.js?v=12';
import * as recipeLib from './recipe.js?v=12';
import * as coachLib from './coach.js?v=12';
import * as timelineLib from './timeline.js?v=12';
import { createUI } from './ui.js?v=12';

const SAVE_DEBOUNCE_MS = 400;
const STATE_KEY = 'state';
const SCHEMA = 2;

const state = {
  meta: { seeded: false },
  beans: {}, rigs: {}, waters: {}, recipes: {}, sessions: {},   // id → entity
  // The brew being coached: { id, recipeId, startedAtMs, timeline }. Saved with the working
  // state, so if Android kills the app mid-brew, reopening resumes with every tap intact.
  activeBrew: null,
};

// JSON of what is known to be on disk, per record.
let saved = emptySnapshot();
let saveTimer = null;
let dirty = false;
let inFlight = false;
let flushRequested = false;   // a flush arrived while a write was in flight: run it right after
let ui = null;

function emptySnapshot() {
  return { kv: null, ...Object.fromEntries(model.ENTITY_STORES.map(n => [n, new Map()])) };
}

// ---------- persistence ----------

function setSaveStatus(ok, err) {
  document.getElementById('not-saving').hidden = ok;
  if (!ok) console.error('[store] save failed:', err);
}

const kvValue = () => ({ schema: SCHEMA, meta: state.meta, activeBrew: state.activeBrew });

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
    // A mutate that landed mid-write still needs saving — immediately if it asked to flush.
    if (dirty && !failed) {
      if (flushRequested) { flushRequested = false; clearTimeout(saveTimer); saveTimer = setTimeout(save, 0); }
      else scheduleSave();
    }
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
  if (inFlight) { flushRequested = true; return; }
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
  if (kv?.activeBrew && Array.isArray(kv.activeBrew.timeline)) state.activeBrew = kv.activeBrew;
  const snap = emptySnapshot();
  snap.kv = kv === undefined ? null : JSON.stringify(kv);
  for (const name of model.ENTITY_STORES) {
    for (const entity of await store.getAll(name)) {
      state[name][entity.id] = entity;
      snap[name].set(entity.id, JSON.stringify(entity));
    }
  }
  saved = snap;

  // Re-derive recipes saved by older versions (e.g. separate release/steep steps before
  // the steep model). The snapshot still holds the old JSON, so save() writes the change.
  let migrated = 0;
  for (const recipe of Object.values(state.recipes)) {
    const next = recipeLib.normalizeRecipe(recipe);
    if (JSON.stringify(next) !== JSON.stringify(recipe)) {
      state.recipes[recipe.id] = next;
      migrated += 1;
    }
  }
  if (migrated) {
    console.info(`[recipe] migrated ${migrated} recipe(s) to the current plan format`);
    scheduleSave();
  }
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

const ROUTE = /^#\/(recipes|beans|rigs|waters|brew|result)(?:\/([^/]+))?$/;

function currentRoute() {
  const m = ROUTE.exec(location.hash);
  return m ? { kind: m[1], id: m[2] ? decodeURIComponent(m[2]) : null } : { kind: 'recipes', id: null };
}

function navigate(hash) {
  if (location.hash === hash) render();
  else location.hash = hash;
}

function render() {
  ui?.render(state, currentRoute());
}

const recipeUsage = id => recipeLib.recipeUsage(Object.values(state.sessions)).get(id) ?? 0;

// The single gate for recipe changes: refuses frozen recipes, re-derives after every edit.
function editRecipe(id, fn) {
  const recipe = state.recipes[id];
  if (!recipe) return false;
  if (recipeUsage(id) > 0) {
    console.warn(`[recipe] refused edit: ${id} is used by brews — fork a new version`);
    return false;
  }
  mutate(s => {
    const r = s.recipes[id];
    fn(r);
    Object.assign(r, recipeLib.normalizeRecipe(r)); // in place: UI closures keep a live reference
  });
  return true;
}

const goToEntity = (kind, id) => navigate(`#/${kind}/${encodeURIComponent(id)}`);

export const actions = {
  create(kind) {
    let entity = model.factories[kind]();
    if (kind === 'recipes') entity = recipeLib.normalizeRecipe(entity);
    mutate(s => { s[kind][entity.id] = entity; });
    goToEntity(kind, entity.id);
  },
  update(kind, id, key, value) {
    if (kind === 'recipes') return editRecipe(id, r => { r[key] = value; });
    mutate(s => { if (s[kind][id]) s[kind][id][key] = value; });
    return true;
  },
  remove(kind, id) {
    if (kind === 'recipes' && recipeUsage(id) > 0) return false; // would orphan brew history
    if (kind === 'recipes' && state.activeBrew?.recipeId === id) return false; // being brewed right now
    mutate(s => { delete s[kind][id]; });
    navigate(`#/${kind}`);
    return true;
  },

  // ---- recipes ----
  recipeUsage,
  editStep(id, stepId, key, value) {
    return editRecipe(id, r => {
      const step = r.plan.find(a => a.id === stepId);
      if (step) step[key] = value;
    });
  },
  addStep(id, action) {
    const recipe = state.recipes[id];
    if (!recipe || !recipeLib.allowedActions(state.rigs[recipe.rigId]).includes(action)) return null;
    const step = model.createAction(action, recipe.plan);
    return editRecipe(id, r => { r.plan.push(step); }) ? step.id : null;
  },
  moveStep(id, stepId, delta) {
    return editRecipe(id, r => {
      const i = r.plan.findIndex(a => a.id === stepId);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= r.plan.length) return;
      [r.plan[i], r.plan[j]] = [r.plan[j], r.plan[i]];
    });
  },
  removeStep(id, stepId) {
    return editRecipe(id, r => { r.plan = r.plan.filter(a => a.id !== stepId); });
  },
  // Refuses a switch that would leave impossible steps: returns the conflicts, changes nothing.
  // With adapt: true the user has seen the list and confirmed the fix.
  changeRig(id, rigId, { adapt = false } = {}) {
    const recipe = state.recipes[id];
    if (!recipe) return [];
    const rig = state.rigs[rigId];
    const conflicts = rig ? recipeLib.rigConflicts(recipe.plan, rig) : [];
    if (conflicts.length && !adapt) return conflicts;
    editRecipe(id, r => {
      if (adapt && rig) r.plan = recipeLib.adaptPlanToRig(r.plan, rig);
      r.rigId = rigId || null;
    });
    return [];
  },
  forkRecipe(id) {
    const recipe = state.recipes[id];
    if (!recipe) return;
    const fork = recipeLib.forkRecipe(recipe, model.uid('recipe'), Object.values(state.recipes));
    mutate(s => { s.recipes[fork.id] = fork; });
    goToEntity('recipes', fork.id);
  },

  // ---- brewing ----
  setCoachSetting(key, value) {
    mutate(s => { s.meta.coach = { ...(s.meta.coach ?? {}), [key]: value }; });
  },
  startBrew(recipeId, startedAtMs) {
    const recipe = state.recipes[recipeId];
    if (!recipe || state.activeBrew) return false;
    if (recipeLib.validateRecipe(recipe, state.rigs[recipe.rigId]).length) return false;
    mutate(s => { s.activeBrew = { id: model.uid('brew'), recipeId, startedAtMs, timeline: [] }; });
    flush();   // a started brew must survive the app being killed in the next second
    return true;
  },
  brewTap(which, tS, opts = {}) {
    const brew = state.activeBrew;
    const sched = brew && scheduleFor(brew.recipeId);
    if (!sched) return;
    const next = coachLib.applyTap(sched, brew.timeline, tS, which, opts);
    if (next.length === brew.timeline.length) return;
    mutate(s => { s.activeBrew.timeline = next; });
    flush();   // taps are saved immediately, not after the 400 ms debounce
    if (coachLib.tapState(sched, next).ended) finishBrew();
  },
  undoTap() {
    if (!state.activeBrew?.timeline.length) return;
    mutate(s => { s.activeBrew.timeline = coachLib.undoTap(s.activeBrew.timeline); });
    flush();
  },
  discardBrew() {
    const recipeId = state.activeBrew?.recipeId;
    if (!recipeId) return;
    mutate(s => { s.activeBrew = null; });
    flush();
    goToEntity('recipes', recipeId);
  },
};

// On startup: a brew that already ended (app killed between the final tap and filing it) is
// filed now; one whose recipe no longer exists is dropped so it can't block new brews.
function recoverActiveBrew() {
  const brew = state.activeBrew;
  if (!brew) return;
  const sched = scheduleFor(brew.recipeId);
  if (!sched) {
    console.warn('[brew] dropped a brew in progress whose recipe no longer exists');
    mutate(s => { s.activeBrew = null; });
    flush();
    return;
  }
  if (coachLib.tapState(sched, brew.timeline).ended) finishBrew();
}

function scheduleFor(recipeId) {
  const recipe = state.recipes[recipeId];
  return recipe ? coachLib.schedule(recipe, { rig: state.rigs[recipe.rigId] }) : null;
}

function localISODate(d) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// A finished brew goes into that day's practice session, with its analysis computed and stored
// (shown only after assessment, Step 9). The recipe is now referenced, so it freezes.
function finishBrew() {
  const brew = state.activeBrew;
  const recipe = brew && state.recipes[brew.recipeId];
  if (!recipe) return;
  const sched = scheduleFor(recipe.id);
  const analysis = timelineLib.analyzeBrew(recipe, brew.timeline);
  const started = new Date(brew.startedAtMs - (sched.startS * 1000));   // wall clock at brew time 0
  const date = localISODate(started);
  const sessionId = `session-${date}`;
  const record = {
    id: brew.id, sessionId,
    startedAt: started.toISOString(),
    recipeId: recipe.id, recipeVersion: recipe.version ?? 1,
    beanId: recipe.beanId ?? null, rigId: recipe.rigId, waterId: recipe.waterId ?? null,
    doseG: recipe.doseG ?? null, cueLeadS: sched.cueLeadS,
    timeline: brew.timeline,
    endedBy: analysis.endedBy,
    phases: analysis.phases,
    plannedPhases: analysis.plannedPhases,
    drift: analysis.drift,
    pourDoneUsed: analysis.pourDoneUsed,
    tapDrift: coachLib.tapDrift(sched, brew.timeline),
    assessment: null, changedFrom: null, notes: '',
  };
  mutate(s => {
    s.sessions[sessionId] ??= { id: sessionId, date, mode: 'practice', brews: [] };
    s.sessions[sessionId].brews.push(record);
    s.activeBrew = null;
  });
  flush();
  navigate(`#/result/${encodeURIComponent(record.id)}`);
}

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
  recoverActiveBrew();
  render();
  store.requestPersistence().catch(() => {});

  const params = new URLSearchParams(location.search);
  if (location.hostname === 'localhost' || params.has('test')) {
    import('./tests.js?v=12').then(m => m.runTests());
  }
}

boot();
