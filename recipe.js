// recipe.js — PURE. Imports nothing, touches no DOM, reads no app state.
// The plan: ordered actions, rig capabilities, validation, versioning.

export const ALL_ACTIONS = ['pour', 'swirl', 'steep', 'release', 'cut'];

const isNum = v => typeof v === 'number' && Number.isFinite(v);

// ---------- capabilities ----------

// Which recipe actions a rig can physically perform.
export function allowedActions(rig) {
  const actions = ['pour', 'swirl'];
  if (rig?.immersionCapable) actions.push('steep');
  if (rig?.valveCapable) actions.push('release');
  if (rig?.cuttable) actions.push('cut');
  return actions;
}

const NOT_POSSIBLE = {
  steep: { reason: "this rig can't steep", fix: 'remove it' },
  release: { reason: 'this rig has no valve to release', fix: 'remove it' },
  cut: { reason: "this rig can't be cut", fix: 'remove it' },
};

// Every step the rig cannot perform. Used to REFUSE a rig switch, never to silently drop steps.
// → [{ stepId, step, action, fix: 'remove' | 'open-valve', message, fixText }]
export function rigConflicts(plan, rig) {
  const allowed = new Set(allowedActions(rig));
  const out = [];
  (plan ?? []).forEach((a, i) => {
    const step = i + 1;
    const label = `Step ${step} (${a.action})`;
    if (!allowed.has(a.action)) {
      const why = NOT_POSSIBLE[a.action] ?? { reason: 'not possible on this rig', fix: 'remove it' };
      out.push({ stepId: a.id, step, action: a.action, fix: 'remove',
        message: `${label}: ${why.reason}`, fixText: `remove step ${step} (${a.action})` });
    } else if (a.action === 'pour' && a.valve === 'closed' && !rig?.valveCapable) {
      out.push({ stepId: a.id, step, action: a.action, fix: 'open-valve',
        message: `${label}: closed valve, but this rig has no valve`, fixText: `pour step ${step} with the valve open` });
    }
  });
  return out;
}

// Explicit, user-confirmed adaptation: remove impossible steps, open closed-valve pours.
// Returns a new plan; the input is untouched.
export function adaptPlanToRig(plan, rig) {
  const conflicts = new Map(rigConflicts(plan, rig).map(c => [c.stepId, c.fix]));
  return (plan ?? [])
    .filter(a => conflicts.get(a.id) !== 'remove')
    .map(a => (conflicts.get(a.id) === 'open-valve' ? { ...a, valve: 'open' } : { ...a }));
}

// ---------- time ----------

// '45' → 45 · '1:05' → 65 · '1.05' → 65 (phone number pads have '.', not ':').
// Seconds after the separator must be two digits and < 60. Anything else → null.
export function parseClock(value) {
  if (isNum(value)) return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  let m = /^(\d+)$/.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d+)[:.](\d{2})$/.exec(t);
  if (m && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
  return null;
}

export function formatClock(seconds) {
  if (!isNum(seconds) || seconds < 0) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const stepEnd = a => (a.action === 'steep' ? a.atS + (isNum(a.durationS) ? a.durationS : 0) : a.atS);

export const FLOW_RATE_MIN = 1;
export const FLOW_RATE_MAX = 10;

// ---------- derived fields ----------

// Recomputes everything derived from the plan. Never typed by hand:
//   seq, cumulativeMl (what the scale reads), totalWaterMl,
//   targetRatio (water in ÷ dose, the N in 1:N),
//   targetTotalTimeS — a planned cut ends the brew, so it is the cut time.
//     Otherwise the later of the last step's end and the target drawdown end.
//     targetDrawdownEndS is a prediction (drawdown can't be controlled), and optional.
// One unreadable pour volume makes that pour's cumulative and every later one null —
// a scale target built on a guess is worse than a blank.
export function normalizeRecipe(recipe) {
  let running = 0;
  let broken = false;
  const plan = (recipe.plan ?? []).map((a, i) => {
    const step = { ...a, seq: i + 1 };
    if (a.action === 'pour') {
      if (!broken && isNum(a.volumeMl) && a.volumeMl > 0) {
        running += a.volumeMl;
        step.cumulativeMl = running;
      } else {
        broken = true;
        step.cumulativeMl = null;
      }
    }
    return step;
  });

  const hasPour = plan.some(a => a.action === 'pour');
  const totalWaterMl = hasPour && !broken ? running : null;
  const allTimed = plan.length > 0 && plan.every(a => isNum(a.atS));
  const cut = plan.find(a => a.action === 'cut');
  const drawdownEnd = isNum(recipe.targetDrawdownEndS) && recipe.targetDrawdownEndS >= 0 ? recipe.targetDrawdownEndS : null;
  let targetTotalTimeS = null;
  if (allTimed) {
    const lastEnd = Math.max(...plan.map(stepEnd));
    targetTotalTimeS = cut ? cut.atS : Math.max(lastEnd, drawdownEnd ?? lastEnd);
  }
  const targetRatio = totalWaterMl !== null && isNum(recipe.doseG) && recipe.doseG > 0
    ? totalWaterMl / recipe.doseG : null;

  return { ...recipe, plan, totalWaterMl, targetRatio, targetTotalTimeS };
}

// ---------- validation ----------

// Everything stopping this recipe from being brewed. [] means ready.
// → [{ step: number | null, stepId?, message }]
export function validateRecipe(recipe, rig) {
  const issues = [];
  const plan = recipe.plan ?? [];

  if (!recipe.rigId) issues.push({ step: null, message: 'Pick a rig.' });
  else if (!rig) issues.push({ step: null, message: "This recipe's rig no longer exists. Pick another." });
  if (!plan.some(a => a.action === 'pour')) issues.push({ step: null, message: 'Add at least one pour.' });

  if (rig) {
    for (const c of rigConflicts(plan, rig)) issues.push({ step: c.step, stepId: c.stepId, message: c.message });
  }

  const firstCut = plan.findIndex(a => a.action === 'cut');
  let prevAt = null;
  plan.forEach((a, i) => {
    const step = i + 1;
    const add = msg => issues.push({ step, stepId: a.id, message: `Step ${step} (${a.action}): ${msg}` });

    if (!isNum(a.atS) || a.atS < 0) add('time missing (seconds, or m:ss)');
    else {
      if (prevAt !== null && a.atS < prevAt) add('starts before the step above it');
      prevAt = a.atS;
    }
    if (firstCut >= 0 && i > firstCut) add('comes after the cut — the dripper is already off');
    if (a.action === 'pour') {
      if (!(isNum(a.volumeMl) && a.volumeMl > 0)) add('volume missing');
      if (a.tempC != null && !(isNum(a.tempC) && a.tempC > 0 && a.tempC <= 100)) add('temperature must be 1–100 °C');
      if (a.flowRate != null && !(Number.isInteger(a.flowRate) && a.flowRate >= FLOW_RATE_MIN && a.flowRate <= FLOW_RATE_MAX)) {
        add(`flow rate must be a whole number ${FLOW_RATE_MIN}–${FLOW_RATE_MAX}`);
      }
    }
    if (a.action === 'steep' && !(isNum(a.durationS) && a.durationS > 0)) add('steep duration missing');
    if (a.action === 'swirl' && !(Number.isInteger(a.count) && a.count >= 1)) add('swirl count must be a whole number, 1 or more');
  });

  // Target drawdown end: optional prediction. When set it must fit the plan.
  const dd = recipe.targetDrawdownEndS;
  if (dd != null) {
    const addDd = message => issues.push({ step: null, field: 'targetDrawdownEndS', message });
    const lastPour = [...plan].reverse().find(a => a.action === 'pour' && isNum(a.atS));
    const cut = plan[firstCut];
    if (!isNum(dd) || dd < 0) addDd('Target drawdown end is not a valid time.');
    else if (lastPour && dd <= lastPour.atS) {
      addDd(`Target drawdown end (${formatClock(dd)}) must be after the last pour (${formatClock(lastPour.atS)}).`);
    } else if (cut && isNum(cut.atS) && cut.atS >= dd) {
      addDd(`The cut (${formatClock(cut.atS)}) is at or after the target drawdown end (${formatClock(dd)}) — nothing would be left to cut.`);
    }
  }

  return issues;
}

// ---------- versioning ----------

// recipeId → number of brews that reference it. Brews live inside sessions (spec §5).
export function recipeUsage(sessions) {
  const usage = new Map();
  for (const session of sessions ?? []) {
    for (const brew of session?.brews ?? []) {
      if (brew?.recipeId) usage.set(brew.recipeId, (usage.get(brew.recipeId) ?? 0) + 1);
    }
  }
  return usage;
}

// A referenced recipe is frozen: edits go to a new version, so past brews keep the plan they ran.
// The version number is one above the highest in the family, so forking v1 twice gives v2 then v3.
export function forkRecipe(recipe, newId, allRecipes = []) {
  const familyId = recipe.familyId ?? recipe.id;
  const versions = allRecipes
    .filter(r => (r.familyId ?? r.id) === familyId)
    .map(r => (isNum(r.version) ? r.version : 1));
  const copy = JSON.parse(JSON.stringify(recipe));
  return {
    ...copy,
    id: newId,
    familyId,
    version: Math.max(isNum(recipe.version) ? recipe.version : 1, ...versions) + 1,
    forkedFrom: recipe.id,
  };
}
