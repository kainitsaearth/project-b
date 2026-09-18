// assessment.js — PURE. Imports nothing, touches no DOM, reads no app state.
// Step 9: the assessment form (spec §6.3) and score-then-reveal (§6.3.1).
//
// The question is not "is this cup good". It is "could a judge rank this cup LAST?"
// Three competition categories, answered hot and again cooled (the serve window).
//
// SCORE-THEN-REVEAL: until `submittedAt` is set, nothing that could anchor the score may be
// shown — phases, drift, per-step timing, the diff, anything from other brews. `revealed()` is
// the single gate every screen asks.
//
// quality10 FIREWALL (§6.3.2): kept for the trend on a bean, never ranked, never mined. Nothing
// in the app may sort, filter or advise by it. `tally` and `verdict` never read it.

export const CATEGORIES = Object.freeze([
  { key: 'flavor', label: 'Flavor / Overall' },
  { key: 'sweetAcid', label: 'Sweetness / Acidity' },
  { key: 'balance', label: 'Balance / Aftertaste' },
]);
export const ANSWERS = Object.freeze(['yes', 'no', 'unsure']);
// Five points, so a cup that leans without failing has a home. The three original values are
// still valid, so brews scored before this keep their meaning.
export const WINDOWS = Object.freeze(['under', 'slightly-under', 'in', 'slightly-over', 'over']);
export const WINDOW_LABELS = Object.freeze({
  'under': 'UNDER',
  'slightly-under': 'slightly under',
  'in': 'IN',
  'slightly-over': 'slightly over',
  'over': 'OVER',
});
export const WINDOW_HINT = 'under = sour, hollow, thin · in = sweet, clean, balanced · over = drying, bitter, hollow finish';
// Which way the next brew should move. 'in' → null.
export function direction(window) {
  if (window === 'under' || window === 'slightly-under') return 'more extraction';
  if (window === 'over' || window === 'slightly-over') return 'less extraction';
  return null;
}
export const TEMPS = Object.freeze(['hot', 'cooled']);
export const QUALITY_MIN = 1;
export const QUALITY_MAX = 10;
// Anchors for the ends of the scale, so a 1 and a 10 mean the same thing every session.
export const QUALITY_ANCHORS = Object.freeze({
  1: 'undrinkable, would pour it out',
  10: 'exceptional, the best cup I can make',
});
export const DEFAULT_COOLED_AFTER_MIN = 10;

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const blankTemp = () => ({ flavor: null, sweetAcid: null, balance: null });

// A fresh, EMPTY assessment. Never cloned from another brew: that would be anchoring.
export function createAssessment() {
  return {
    hot: blankTemp(), cooled: blankTemp(), cooledSkipped: false, cooledAtTempC: null,
    window: null, attributedPhase: null,
    oneFlaw: '', descriptors: '', quality10: null,
    submittedAt: null,
  };
}

// ---------- editing ----------

// path: 'hot.flavor' | 'cooled.balance' | 'window' | 'oneFlaw' | 'descriptors' | 'quality10'
//       | 'cooledAtTempC' | 'cooledSkipped' | 'attributedPhase'
// Invalid values are refused (the assessment comes back unchanged). Returns a NEW assessment.
export function setField(assessment, path, value) {
  const a = assessment ?? createAssessment();
  const [head, key] = path.split('.');
  if (TEMPS.includes(head)) {
    if (!CATEGORIES.some(c => c.key === key)) return a;
    if (value !== null && !ANSWERS.includes(value)) return a;
    const next = { ...a, [head]: { ...a[head], [key]: value } };
    // Answering a cooled question means it was tasted cooled after all.
    if (head === 'cooled' && value !== null) next.cooledSkipped = false;
    return next;
  }
  switch (path) {
    case 'window':
      if (value !== null && !WINDOWS.includes(value)) return a;
      // In the window there's nothing to attribute; a stale attribution would be a lie.
      return { ...a, window: value, attributedPhase: value === 'in' || value === null ? null : a.attributedPhase };
    case 'quality10':
      if (value !== null && !(Number.isInteger(value) && value >= QUALITY_MIN && value <= QUALITY_MAX)) return a;
      return { ...a, quality10: value };
    case 'cooledAtTempC':
      if (value !== null && !(isNum(value) && value > 0 && value <= 100)) return a;
      return { ...a, cooledAtTempC: value };
    case 'cooledSkipped':
      return value ? { ...a, cooledSkipped: true, cooled: blankTemp(), cooledAtTempC: null } : { ...a, cooledSkipped: false };
    case 'oneFlaw': case 'descriptors':
      return { ...a, [path]: typeof value === 'string' ? value : '' };
    default:
      return a;
  }
}

// ---------- tally & verdict ----------

// Paper form, Part 2: each "yes" or "unsure" is a category this cup could lose you.
// A category is at risk if it's at risk at EITHER temperature.
// → { hot, cooled, atRisk: 0–3, categories: { [key]: boolean }, answered: count of 6 (or 3 if cooled skipped) }
export function tally(assessment) {
  const a = assessment ?? createAssessment();
  const risky = v => v === 'yes' || v === 'unsure';
  const categories = {};
  let hot = 0, cooled = 0, answered = 0;
  for (const { key } of CATEGORIES) {
    const h = a.hot?.[key] ?? null;
    const c = a.cooledSkipped ? null : a.cooled?.[key] ?? null;
    if (h !== null) answered += 1;
    if (c !== null) answered += 1;
    if (risky(h)) hot += 1;
    if (risky(c)) cooled += 1;
    categories[key] = risky(h) || risky(c);
  }
  return { hot, cooled, atRisk: Object.values(categories).filter(Boolean).length, categories, answered };
}

// Standard: 0 is the target. 1 is survivable. 2 or more loses the round.
export function verdict(atRisk) {
  if (!Number.isInteger(atRisk) || atRisk < 0) return null;
  if (atRisk === 0) return { level: 'target', text: '0 at risk: the target' };
  if (atRisk === 1) return { level: 'survivable', text: '1 at risk: survivable' };
  return { level: 'loses', text: `${atRisk} at risk: this loses the round` };
}

// ---------- submit ----------

// What stops a submit. [] = ready.
export function submitIssues(assessment) {
  const a = assessment ?? createAssessment();
  const issues = [];
  for (const { key, label } of CATEGORIES) {
    if (!ANSWERS.includes(a.hot?.[key])) issues.push(`Hot: ${label}`);
  }
  if (!a.cooledSkipped) {
    for (const { key, label } of CATEGORIES) {
      if (!ANSWERS.includes(a.cooled?.[key])) issues.push(`Cooled: ${label} (or mark "didn't taste it cooled")`);
    }
  }
  if (!WINDOWS.includes(a.window)) issues.push('Window: under → over');
  return issues;
}

// Stamps submittedAt. Refuses an incomplete assessment (returned unchanged).
export function submit(assessment, nowISO) {
  if (submitIssues(assessment).length) return assessment;
  return { ...assessment, submittedAt: assessment.submittedAt ?? nowISO };
}

// THE GATE: evidence (phases, drift, per-step timing) may be shown only after this is true.
export function revealed(brew) {
  return Boolean(brew?.assessment?.submittedAt);
}

// ---------- after submit: phase attribution ----------

// Phases a cup marked under/over can be blamed on: the ones this brew actually had.
// Drifted phases (short/long) come first and are flagged — the likely suspects.
// → [] when the window is "in" (nothing to attribute) or not revealed yet.
export function attributionOptions(brew) {
  if (!revealed(brew)) return [];
  // Anything off-centre can be attributed to a phase, including the "slightly" calls.
  if (direction(brew.assessment.window) === null) return [];
  const order = ['bloom', 'steep', 'percolation', 'lock', 'drawdown'];
  const phases = brew.phases ?? {};
  const drift = brew.drift?.phases ?? {};
  return order.filter(p => p in phases)
    .map(p => ({ phase: p, flag: drift[p]?.flag ?? null, drifted: drift[p]?.flag === 'short' || drift[p]?.flag === 'long' }))
    .sort((x, y) => Number(y.drifted) - Number(x.drifted));
}

// One-tap attribution. Only a phase this brew had, only for under/over, only after reveal. null clears.
export function attribute(brew, phase) {
  if (phase !== null && !attributionOptions(brew).some(o => o.phase === phase)) return brew;
  if (phase === null && !revealed(brew)) return brew;
  return { ...brew, assessment: { ...brew.assessment, attributedPhase: phase } };
}

// ---------- the cooled prompt ----------

// When to taste it cooled: minutes after the brew ended. The phone can't measure the cup, so
// time stands in for the serve window until session ambient conditions exist (Phase 2).
// → { dueAtMs, remainingS, due }   remainingS is 0 once due.
export function cooledPrompt(brewEndMs, nowMs, afterMin = DEFAULT_COOLED_AFTER_MIN) {
  if (!isNum(brewEndMs) || !isNum(nowMs)) return null;
  const mins = isNum(afterMin) && afterMin > 0 ? afterMin : DEFAULT_COOLED_AFTER_MIN;
  const dueAtMs = brewEndMs + mins * 60_000;
  const remainingS = Math.max(0, Math.ceil((dueAtMs - nowMs) / 1000));
  return { dueAtMs, remainingS, due: nowMs >= dueAtMs };
}

// Wall-clock end of a saved brew (start + the cut / drawdown-complete tap), or null.
export function brewEndMs(brew) {
  const start = Date.parse(brew?.startedAt);
  const end = (brew?.timeline ?? []).find(e => e?.type === 'cut' || e?.type === 'drawdown-complete')?.atS;
  return Number.isFinite(start) && isNum(end) ? start + end * 1000 : null;
}
