// model.js — factories, ids, field schemas, capability flags, seed presets.
// No DOM, no storage.

import { allowedActions, ALL_ACTIONS } from './recipe.js?v=17';

// Capability logic lives in pure recipe.js; re-exported so existing callers don't move.
export { allowedActions, ALL_ACTIONS };

// Stores loaded into memory. `sessions` has no screen until Step 8, but it is loaded
// now because brews inside it decide whether a recipe is frozen.
export const ENTITY_STORES = ['beans', 'rigs', 'waters', 'recipes', 'sessions'];

export const WATER_TYPES = ['distilled+solution', 'brand', 'other'];

export const POUR_STYLES = ['center', 'spiral', 'pulse', 'edge'];

export function uid(prefix) {
  const r = globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2);
  return `${prefix}-${r}`;
}

// ---------- factories ----------

const BEAN_DEFAULTS = {
  name: '', origin: '', process: '', varietal: '',
  roastLevel: '', roastDate: '', source: '', notes: '',
};

const RIG_DEFAULTS = {
  name: '', grinder: '', grinderNotes: '',
  dripper: '', filter: '', filterBatch: '', kettle: '', scale: '',
  valveCapable: false,      // Hario Switch, Clever — a pour can close the valve, which is the steep
  cuttable: true,           // almost any dripper can be lifted off the server
  // `immersionCapable` was removed 2026-09-16: on a valve rig, closing the valve IS the steep.
  // Older saved rigs may still carry it; nothing reads it.
};

const WATER_DEFAULTS = { name: '', type: 'other', ppm: null, notes: '' };

export const createBean = (o = {}) => ({ ...BEAN_DEFAULTS, ...o, id: o.id ?? uid('bean') });
export const createRig = (o = {}) => ({ ...RIG_DEFAULTS, ...o, id: o.id ?? uid('rig') });
export const createWater = (o = {}) => ({ ...WATER_DEFAULTS, ...o, id: o.id ?? uid('water') });

export function createRecipe(o = {}) {
  const id = o.id ?? uid('recipe');
  return {
    name: '', version: 1, familyId: id, forkedFrom: null,
    beanId: null, rigId: null, waterId: null,
    doseG: null, targetOutputMl: null, cueLeadS: 3,
    plan: [],
    targetDrawdownEndS: null,  // optional prediction; drawdown can't be controlled exactly
    // derived by recipe.normalizeRecipe — never typed
    totalWaterMl: null, targetRatio: null, targetTotalTimeS: null,
    ...o, id,
  };
}

export const factories = { beans: createBean, rigs: createRig, waters: createWater, recipes: createRecipe };

// A new plan step with sensible defaults taken from the steps before it.
export function createAction(action, plan = []) {
  const last = plan[plan.length - 1];
  const lastPour = [...plan].reverse().find(a => a.action === 'pour');
  let atS = 0;
  if (last) {
    // After a steep, start from when the valve opens rather than when it closed.
    const opensAt = last.action === 'pour' && last.valve === 'closed' && Number.isFinite(last.valveOpenAtS) ? last.valveOpenAtS : null;
    const end = Math.max(Number.isFinite(last.atS) ? last.atS : -Infinity, opensAt ?? -Infinity);
    atS = Number.isFinite(end) ? end + 30 : null;
  }
  const base = { id: uid('step'), action, atS };
  switch (action) {
    case 'pour':
      return { ...base, volumeMl: null, cumulativeMl: null,
        tempC: lastPour?.tempC ?? 93, style: lastPour?.style ?? '',
        flowRate: lastPour?.flowRate ?? null,  // flow rate: 1 = low … 10 = high; optional
        dripAssist: false,                     // poured through a drip assist (Melodrip etc.); never inherited
        tareBefore: false,                     // tare the scale before this pour: its scale target restarts at 0
        valve: 'open',
        valveOpenAtS: null };                  // set when valve is 'closed' — ends the steep
    case 'swirl': return { ...base, count: 1 };
    default: return base; // cut
  }
}

const SINGULAR = { beans: 'bean', rigs: 'rig', waters: 'water', recipes: 'recipe' };

export function displayName(kind, entity) {
  return entity?.name?.trim() || `Untitled ${SINGULAR[kind]}`;
}

// ---------- field schemas (drive the editor screens) ----------

export const FIELDS = {
  beans: [
    { key: 'name', label: 'Name', placeholder: 'e.g. Guji Washed' },
    { key: 'origin', label: 'Origin' },
    { key: 'process', label: 'Process', suggestions: ['Washed', 'Natural', 'Honey', 'Anaerobic', 'Wet-hulled'] },
    { key: 'varietal', label: 'Varietal' },
    { key: 'roastLevel', label: 'Roast level', placeholder: 'Agtron 93.3, or light / medium' },
    { key: 'roastDate', label: 'Roast date', placeholder: 'YYYY-MM-DD', hint: 'Anything unreadable counts as unknown.', derivedAfter: true },
    { key: 'source', label: 'Source' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
  rigs: [
    { key: 'name', label: 'Name', placeholder: 'e.g. C40 + Origami + Abaca' },
    { key: 'grinder', label: 'Grinder' },
    { key: 'grinderNotes', label: 'Grinder notes', type: 'textarea' },
    { key: 'dripper', label: 'Dripper' },
    { key: 'filter', label: 'Filter' },
    { key: 'filterBatch', label: 'Filter batch' },
    { key: 'kettle', label: 'Kettle' },
    { key: 'scale', label: 'Scale' },
    { key: 'valveCapable', label: 'Has a valve', type: 'bool',
      hint: 'Hario Switch, Clever. Lets a pour close the valve, which is a steep, then open it at a set time.' },
    { key: 'cuttable', label: 'Can be cut', type: 'bool', hint: 'Dripper can be lifted to end extraction early.' },
  ],
  recipes: [
    { key: 'name', label: 'Name', placeholder: 'e.g. Yuan valve-lock' },
    { key: 'rigId', label: 'Rig', type: 'ref', ref: 'rigs', empty: '— pick a rig —',
      hint: 'Decides which steps are possible.' },
    { key: 'beanId', label: 'Bean', type: 'ref', ref: 'beans', empty: 'Any bean' },
    { key: 'waterId', label: 'Water', type: 'ref', ref: 'waters', empty: '— none —' },
    { key: 'doseG', label: 'Dose (g)', type: 'number' },
    { key: 'targetOutputMl', label: 'Target output (ml)', type: 'number' },
    { key: 'cueLeadS', label: 'Cue lead (s)', type: 'number', hint: 'Warning before each step in the pour coach.' },
    // Rendered in the Plan section after the last step, where drawdown happens.
    { key: 'targetDrawdownEndS', label: 'Target drawdown end', type: 'clock', section: 'plan',
      hint: "Type digits: 300 = 3:00. When you expect the bed to finish draining. You can't control it exactly. "
        + "Set it from past brews of this bean. Optional: without it, drawdown drift isn't judged." },
  ],
  waters: [
    { key: 'name', label: 'Name', placeholder: 'e.g. OMB 75 ppm' },
    { key: 'type', label: 'Type', type: 'select', options: WATER_TYPES },
    { key: 'ppm', label: 'ppm', type: 'number' },
    { key: 'notes', label: 'Notes', type: 'textarea' },
  ],
};

// ---------- seed presets ----------
// Source: (C) PCBL — OMB Dial-In, Grind Calibration & Filter Test 2026-09-08.
// Stable ids, so seeding is idempotent.

const C40_NOTES = 'OMB @ 100 ppm: 25–28 clicks — flat-response plateau, a mis-click costs little. '
  + 'Lower ppm: 29–30. Avoid 23 (bimodal, least consistent).';

const OMB_NOTES = {
  50: 'Best cups in Test A.',
  75: 'Best cups in Test A.',
  100: 'Sodium taste surfaces — hard ceiling. Grind map (Test B) was built here.',
  150: 'Past the 125→150 crossover: dryness beats sweetness.',
  175: 'Net-negative — dryness dominant.',
  200: 'Net-negative — dryness dominant.',
};

export function seedPresets() {
  const rigs = [
    createRig({
      id: 'rig-seed-c40-origami-abaca', name: 'C40 + Origami + Abaca',
      grinder: 'Comandante C40', grinderNotes: C40_NOTES, dripper: 'Origami', filter: 'Cafec Abaca',
    }),
    createRig({
      id: 'rig-seed-c40-v60', name: 'C40 + V60',
      grinder: 'Comandante C40', grinderNotes: C40_NOTES, dripper: 'Hario V60 (ceramic)',
    }),
    createRig({
      id: 'rig-seed-mischief-origami', name: 'Mischief + Origami',
      grinder: 'Mischief (spring-modded)', dripper: 'Origami',
      grinderNotes: '≈38 clicks matches C40 ~1107 µm — interpolated, not measured. '
        + 'Put 38 through the analyser before building a recipe on it.',
    }),
  ];
  const waters = [50, 75, 100, 125, 150, 175, 200].map(ppm => createWater({
    id: `water-seed-omb-${ppm}`, name: `OMB ${ppm} ppm`,
    type: 'distilled+solution', ppm, notes: OMB_NOTES[ppm] ?? '',
  }));
  return { rigs, waters };
}
