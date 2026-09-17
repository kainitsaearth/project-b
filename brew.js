// brew.js — PURE. Imports nothing, touches no DOM, reads no app state.
// Brew entry (Step 8): clone-last, blank slate, the diff strip, the attribution warning,
// and post-brew reconciliation.
//
// A brew's VARIABLES are the things you choose before brewing. Only these are cloned and
// only these are compared: outcomes (output, retention, phases, drift, assessment), the
// timeline and bookkeeping never count as "a change you made".

export const UNKNOWN = 'unknown';
export const ATTRIBUTION_LIMIT = 3;
export const GRIND_UNITS = ['clicks', 'µm', 'dial'];

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------- variables ----------

// The chosen variables of a brew or a draft, in one fixed shape.
export function variablesOf(b) {
  return {
    recipeId: b?.recipeId ?? null,
    rigId: b?.rigId ?? null,
    beanId: b?.beanId ?? null,
    waterId: b?.waterId ?? null,
    grind: { setting: b?.grind?.setting ?? null, unit: b?.grind?.unit ?? null },
    doseG: b?.doseG ?? null,
    bypassG: b?.bypassG ?? null,
    preheat: { dripper: b?.preheat?.dripper ?? null, server: b?.preheat?.server ?? null },
  };
}

// Human names for the diff strip, in the order they're shown.
export const VARIABLE_LABELS = Object.freeze({
  beanId: 'bean', recipeId: 'recipe', rigId: 'rig', waterId: 'water',
  'grind.setting': 'grind', 'grind.unit': 'grind unit',
  doseG: 'dose', bypassG: 'bypass',
  'preheat.dripper': 'preheat dripper', 'preheat.server': 'preheat server',
});
const ORDER = Object.keys(VARIABLE_LABELS);

// null and undefined are the same "no value"; blank text is no value too.
const empty = v => v == null || (typeof v === 'string' && v.trim() === '');
function same(a, b) {
  if (empty(a) || empty(b)) return empty(a) && empty(b);
  return Object.is(a, b);
}

// What changed from the parent brew to the draft, as [{ field, label, from, to }] in display order.
// No parent (blank slate, or the first brew on a bean) → UNKNOWN: "nothing changed" would be a lie.
export function variableDiff(parent, draft) {
  if (!isPlainObject(parent) || !isPlainObject(draft)) return UNKNOWN;
  const a = flatten(variablesOf(parent));
  const b = flatten(variablesOf(draft));
  return ORDER.filter(f => !same(a[f], b[f]))
    .map(f => ({ field: f, label: VARIABLE_LABELS[f], from: a[f] ?? null, to: b[f] ?? null }));
}

function flatten(v) {
  return {
    recipeId: v.recipeId, rigId: v.rigId, beanId: v.beanId, waterId: v.waterId,
    'grind.setting': v.grind.setting, 'grind.unit': v.grind.unit,
    doseG: v.doseG, bypassG: v.bypassG,
    'preheat.dripper': v.preheat.dripper, 'preheat.server': v.preheat.server,
  };
}

// ---------- the attribution warning ----------

const signatureOf = changes => changes.map(c => c.field).join('|');

// → null, or { count, message, signature }. `dismissedSignature` hides it for exactly this
// set of changed fields; change a further variable and it comes back.
export function attributionWarning(changes, dismissedSignature = null) {
  if (!Array.isArray(changes) || changes.length < ATTRIBUTION_LIMIT) return null;
  const signature = signatureOf(changes);
  if (signature === dismissedSignature) return null;
  return { count: changes.length, signature,
    message: `${changes.length} variables changed. This result won't be attributable to any one of them.` };
}

// ---------- history ----------

// Every saved brew, newest first. Sessions hold brews (spec §5).
export function allBrews(sessions) {
  const list = [];
  for (const s of sessions ?? []) for (const b of s?.brews ?? []) if (b) list.push(b);
  return list
    .map((b, i) => ({ b, i, t: Date.parse(b.startedAt) }))
    .sort((x, y) => (Number.isFinite(y.t) ? y.t : -Infinity) - (Number.isFinite(x.t) ? x.t : -Infinity) || y.i - x.i)
    .map(x => x.b);
}

// The most recent brew on a bean, or null. No bean → null (there's nothing to clone "on that bean").
export function lastBrewOnBean(sessions, beanId) {
  if (!beanId) return null;
  return allBrews(sessions).find(b => b.beanId === beanId) ?? null;
}

// ---------- drafts ----------

// A draft is what the setup screen edits before the coach starts:
//   { recipeId, mode: 'clone' | 'blank', changedFrom, ...variables, notes, dismissedWarning }

// Blank slate: only what the recipe itself says. No parent, so no diff.
export function blankDraft(recipe) {
  return {
    mode: 'blank', changedFrom: null,
    ...variablesOf({
      recipeId: recipe?.id, rigId: recipe?.rigId, beanId: recipe?.beanId,
      waterId: recipe?.waterId, doseG: recipe?.doseG,
    }),
    notes: '', dismissedWarning: null,
  };
}

// Clone-last: the last brew on the bean, re-pointed at the recipe being brewed.
// beanId: the bean to clone for (defaults to the recipe's bean). No brew on it → a blank draft
// for that bean, still in 'clone' mode so picking a bean with history clones from it.
export function cloneDraft(recipe, sessions, beanId = recipe?.beanId ?? null) {
  const parent = lastBrewOnBean(sessions, beanId);
  if (!parent) return { ...blankDraft(recipe), mode: 'clone', beanId: beanId ?? null };
  return {
    mode: 'clone', changedFrom: parent.id,
    ...variablesOf(parent),
    recipeId: recipe?.id ?? null,
    rigId: recipe?.rigId ?? null,
    beanId: parent.beanId,
    notes: '', dismissedWarning: null,
  };
}

// The brew a draft is compared against, or null.
export function parentOf(draft, sessions) {
  if (!draft?.changedFrom) return null;
  return allBrews(sessions).find(b => b.id === draft.changedFrom) ?? null;
}

// ---------- after the brew ----------

// Water in: every pour, plus bypass (it goes into the server too). Any unreadable pour → UNKNOWN.
export function waterIn(brew) {
  let total = 0;
  let pours = 0;
  for (const e of brew?.timeline ?? []) {
    if (e?.type !== 'pour') continue;
    if (!isNum(e.volumeMl) || e.volumeMl < 0) return UNKNOWN;
    total += e.volumeMl;
    pours += 1;
  }
  if (pours === 0) return UNKNOWN;
  if (brew.bypassG != null && !(isNum(brew.bypassG) && brew.bypassG >= 0)) return UNKNOWN;
  return total + (brew.bypassG ?? 0);
}

// Recomputes the outcome numbers from what's recorded. Never typed by hand.
// Output above water in is a measuring mistake → retention UNKNOWN, not negative.
export function outcomes(brew) {
  const inMl = waterIn(brew);
  const out = brew?.outputMl;
  const hasOut = isNum(out) && out >= 0;
  const retentionMl = inMl !== UNKNOWN && hasOut && inMl - out >= 0 ? round1(inMl - out) : UNKNOWN;
  const trueRatio = hasOut && out > 0 && isNum(brew?.doseG) && brew.doseG > 0 ? out / brew.doseG : UNKNOWN;
  // As a share of the water poured over the bed. Bypass never touches the coffee, so it's left out.
  const pouredMl = inMl === UNKNOWN ? UNKNOWN : inMl - (brew.bypassG ?? 0);
  const retentionPct = retentionMl !== UNKNOWN && pouredMl !== UNKNOWN && pouredMl > 0 ? round1((retentionMl / pouredMl) * 100) : UNKNOWN;
  return { waterInMl: inMl, retentionMl, retentionPct, trueRatio };
}
const round1 = n => Math.round(n * 10) / 10;

// Post-brew reconciliation of one pour: set its actual volume / temp. Times never change,
// they came from the taps. `pourIndex` counts pours in the timeline, from 0.
// Returns a NEW brew with outcomes recomputed.
export function reconcilePour(brew, pourIndex, key, value) {
  if (!['volumeMl', 'tempC'].includes(key)) return brew;
  let n = -1;
  const timeline = (brew.timeline ?? []).map(e => {
    if (e?.type !== 'pour') return e;
    n += 1;
    return n === pourIndex ? { ...e, [key]: value, reconciled: true } : e;
  });
  return withOutcomes({ ...brew, timeline });
}

// Set a measured field (output, bypass, serve temp, notes) and recompute.
export const MEASURED_FIELDS = ['outputMl', 'bypassG', 'serveTempC', 'notes'];
export function setMeasured(brew, key, value) {
  if (!MEASURED_FIELDS.includes(key)) return brew;
  return withOutcomes({ ...brew, [key]: value });
}

export function withOutcomes(brew) {
  const o = outcomes(brew);
  return { ...brew, waterInMl: o.waterInMl, retentionMl: o.retentionMl, retentionPct: o.retentionPct, trueRatio: o.trueRatio };
}

// A reconciliation check: pours with no readable volume, and no output yet.
// → [message]   ([] = reconciled)
export function reconcileIssues(brew) {
  const issues = [];
  const pours = (brew?.timeline ?? []).filter(e => e?.type === 'pour');
  pours.forEach((e, i) => {
    if (!(isNum(e.volumeMl) && e.volumeMl >= 0)) issues.push(`Pour ${i + 1}: volume missing`);
    if (e.tempC != null && !(isNum(e.tempC) && e.tempC > 0 && e.tempC <= 100)) issues.push(`Pour ${i + 1}: temperature must be 1–100 °C`);
  });
  if (!(isNum(brew?.outputMl) && brew.outputMl > 0)) issues.push('Output not entered');
  if (brew?.bypassG != null && !(isNum(brew.bypassG) && brew.bypassG >= 0)) issues.push('Bypass must be 0 or more');
  return issues;
}
