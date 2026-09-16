// model.js — factories, ids, field schemas, capability flags, seed presets.
// No DOM, no storage.

export const ENTITY_STORES = ['beans', 'rigs', 'waters'];

export const WATER_TYPES = ['distilled+solution', 'brand', 'other'];

export const ALL_ACTIONS = ['pour', 'swirl', 'steep', 'release', 'cut'];

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
  valveCapable: false,      // closed valve possible — Hario Switch, Clever
  immersionCapable: false,  // planned steep possible
  cuttable: true,           // almost any dripper can be lifted off the server
};

const WATER_DEFAULTS = { name: '', type: 'other', ppm: null, notes: '' };

export const createBean = (o = {}) => ({ ...BEAN_DEFAULTS, ...o, id: o.id ?? uid('bean') });
export const createRig = (o = {}) => ({ ...RIG_DEFAULTS, ...o, id: o.id ?? uid('rig') });
export const createWater = (o = {}) => ({ ...WATER_DEFAULTS, ...o, id: o.id ?? uid('water') });

export const factories = { beans: createBean, rigs: createRig, waters: createWater };

const SINGULAR = { beans: 'bean', rigs: 'rig', waters: 'water' };

export function displayName(kind, entity) {
  return entity?.name?.trim() || `Untitled ${SINGULAR[kind]}`;
}

// ---------- capabilities ----------

// Which recipe actions a rig can physically perform. The recipe builder and
// pour coach read this; an impossible action is never offered.
export function allowedActions(rig) {
  const actions = ['pour', 'swirl'];
  if (rig?.immersionCapable) actions.push('steep');
  if (rig?.valveCapable) actions.push('release');
  if (rig?.cuttable) actions.push('cut');
  return actions;
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
    { key: 'valveCapable', label: 'Has a valve', type: 'bool', hint: 'Hario Switch, Clever. Enables release.' },
    { key: 'immersionCapable', label: 'Can steep', type: 'bool', hint: 'Planned immersion. Enables steep.' },
    { key: 'cuttable', label: 'Can be cut', type: 'bool', hint: 'Dripper can be lifted to end extraction early.' },
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
