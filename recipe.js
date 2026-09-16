// recipe.js — PURE. Imports nothing, touches no DOM, reads no app state.
// The plan: ordered actions, valve steeps, rig capabilities, validation, versioning.
//
// Steep model (2026-09-16): a steep is not its own step. A pour with the valve
// CLOSED starts one; its `valveOpenAtS` ends it. Pours that start before the open
// time are inside the steep. Closing and opening live together, so a valve can't
// be closed and forgotten, and one physical act has exactly one representation.

export const ALL_ACTIONS = ['pour', 'swirl', 'cut'];

export const FLOW_RATE_MIN = 1;
export const FLOW_RATE_MAX = 10;

const isNum = v => typeof v === 'number' && Number.isFinite(v);

// ---------- time ----------

// Digits only, for phone number pads with no ':' key:
//   1–2 digits = seconds        '45' → 0:45 · '90' → 1:30
//   3+ digits  = minutes + ss   '130' → 1:30 · '300' → 3:00 · '1000' → 10:00 · '190' → null (90 s isn't valid)
// Also accepted: '1:05' and '1.05'. Seconds after a separator must be two digits and < 60.
export function parseClock(value) {
  if (isNum(value)) return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value !== 'string') return null;
  const t = value.trim();
  let m = /^(\d+)$/.exec(t);
  if (m) {
    const d = m[1];
    if (d.length <= 2) return Number(d);
    const secs = Number(d.slice(-2));
    return secs < 60 ? Number(d.slice(0, -2)) * 60 + secs : null;
  }
  m = /^(\d+)[:.](\d{2})$/.exec(t);
  if (m && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
  return null;
}

export function formatClock(seconds) {
  if (!isNum(seconds) || seconds < 0) return '';
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// The digits-only form of a time, for editing on a number pad: 90 → '130', 40 → '40', 0 → '0'.
// Round-trips: parseClock(clockDigits(s)) === s.
export function clockDigits(seconds) {
  if (!isNum(seconds) || seconds < 0) return '';
  const s = Math.round(seconds);
  return s < 60 ? String(s) : `${Math.floor(s / 60)}${String(s % 60).padStart(2, '0')}`;
}

// ---------- capabilities ----------

// Which step types a rig can perform. Valve closing is not a step type:
// it is a setting on a pour, available when rig.valveCapable.
export function allowedActions(rig) {
  const actions = ['pour', 'swirl'];
  if (rig?.cuttable) actions.push('cut');
  return actions;
}

// Every step the rig cannot perform. Used to REFUSE a rig switch, never to silently drop steps.
// → [{ stepId, step, action, fix: 'remove' | 'open-valve', message, fixText }]
export function rigConflicts(plan, rig) {
  const allowed = new Set(allowedActions(rig));
  const out = [];
  (plan ?? []).forEach((a, i) => {
    const step = i + 1;
    const label = `Step ${step} (${a.action})`;
    if (!allowed.has(a.action)) {
      const reason = a.action === 'cut' ? "this rig can't be cut" : 'not possible on this rig';
      out.push({ stepId: a.id, step, action: a.action, fix: 'remove',
        message: `${label}: ${reason}`, fixText: `remove step ${step} (${a.action})` });
    } else if (a.action === 'pour' && a.valve === 'closed' && !rig?.valveCapable) {
      out.push({ stepId: a.id, step, action: a.action, fix: 'open-valve',
        message: `${label}: closed valve, but this rig has no valve`,
        fixText: `pour step ${step} with the valve open (its steep is dropped)` });
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
    .map(a => (conflicts.get(a.id) === 'open-valve' ? { ...a, valve: 'open', valveOpenAtS: null } : { ...a }));
}

// ---------- legacy plans ----------

// Plans saved before the steep model used separate `release` and `steep` steps.
// release → becomes the open time of the latest closed pour still missing one.
// steep   → closes the valve on the pour before it, opening at the steep's end.
//           (Approximation: the old steep closed after that pour began.)
// Idempotent: a plan with neither step type comes back as an equal copy.
export function migratePlan(plan) {
  const out = [];
  for (const a of plan ?? []) {
    if (a.action === 'release') {
      const pour = [...out].reverse().find(x => x.action === 'pour' && x.valve === 'closed');
      if (pour && !isNum(pour.valveOpenAtS) && isNum(a.atS)) pour.valveOpenAtS = a.atS;
      continue;
    }
    if (a.action === 'steep') {
      const pour = [...out].reverse().find(x => x.action === 'pour');
      if (pour && isNum(a.atS)) {
        pour.valve = 'closed';
        if (!isNum(pour.valveOpenAtS)) pour.valveOpenAtS = a.atS + (isNum(a.durationS) ? a.durationS : 0);
      }
      continue;
    }
    out.push({ ...a });
  }
  return out;
}

// ---------- valve steeps ----------

const validOpen = a => isNum(a.valveOpenAtS) && isNum(a.atS) && a.valveOpenAtS > a.atS;

// Walks the plan in order and works out the valve for every step.
// → { perStep: [{ valveState, startsSteep, steepStep, closedUntilS }], steeps: [{ step, closeAtS, openAtS, pourSteps }] }
// A closed pour with no valid open time covers only itself (and is flagged by validation).
export function valveSteeps(plan) {
  const perStep = [];
  const steeps = [];
  let current = null;
  (plan ?? []).forEach((a, i) => {
    const step = i + 1;
    if (current && (current.openAtS === null || (isNum(a.atS) && a.atS >= current.openAtS))) current = null;

    if (!current && a.action === 'pour' && a.valve === 'closed') {
      current = { step, closeAtS: isNum(a.atS) ? a.atS : null, openAtS: validOpen(a) ? a.valveOpenAtS : null, pourSteps: [step] };
      steeps.push(current);
      perStep.push({ valveState: 'closed', startsSteep: true, steepStep: step, closedUntilS: current.openAtS });
      return;
    }
    if (current) {
      if (a.action === 'pour') current.pourSteps.push(step);
      perStep.push({ valveState: 'closed', startsSteep: false, steepStep: current.step, closedUntilS: current.openAtS });
    } else {
      perStep.push({ valveState: 'open', startsSteep: false, steepStep: null, closedUntilS: null });
    }
  });
  return { perStep, steeps };
}

// ---------- derived fields ----------

// Recomputes everything derived from the plan. Never typed by hand:
//   seq · cumulativeMl (what the scale reads) · totalWaterMl
//   valveState, valveClosedByStep, valveClosedUntilS on every step; closedForS on a steep's first pour
//   totalSteepS — total planned valve-closed time (null if a steep has no open time)
//   targetRatio — water in ÷ dose, the N in 1:N
//   targetTotalTimeS — a planned cut ends the brew, so it is the cut time. Otherwise the
//     latest of: last step, last valve opening, target drawdown end (an optional prediction).
// One unreadable pour volume makes that pour's cumulative and every later one null —
// a scale target built on a guess is worse than a blank.
export function normalizeRecipe(recipe) {
  const migrated = migratePlan(recipe.plan);
  const { perStep, steeps } = valveSteeps(migrated);

  let running = 0;
  let broken = false;
  const plan = migrated.map((a, i) => {
    const v = perStep[i];
    const step = { ...a, seq: i + 1, valveState: v.valveState, valveClosedByStep: v.steepStep, valveClosedUntilS: v.closedUntilS };
    if (v.startsSteep) step.closedForS = isNum(v.closedUntilS) && isNum(a.atS) ? v.closedUntilS - a.atS : null;
    else delete step.closedForS;
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
  const totalSteepS = steeps.length === 0 ? 0
    : steeps.every(s => isNum(s.openAtS) && isNum(s.closeAtS)) ? steeps.reduce((t, s) => t + s.openAtS - s.closeAtS, 0)
    : null;

  const allTimed = plan.length > 0 && plan.every(a => isNum(a.atS));
  const cut = plan.find(a => a.action === 'cut');
  const drawdownEnd = isNum(recipe.targetDrawdownEndS) && recipe.targetDrawdownEndS >= 0 ? recipe.targetDrawdownEndS : null;
  let targetTotalTimeS = null;
  if (allTimed) {
    const lastEnd = Math.max(...plan.map(a => a.atS), ...steeps.map(s => s.openAtS).filter(isNum));
    targetTotalTimeS = cut ? cut.atS : Math.max(lastEnd, drawdownEnd ?? lastEnd);
  }
  const targetRatio = totalWaterMl !== null && isNum(recipe.doseG) && recipe.doseG > 0
    ? totalWaterMl / recipe.doseG : null;

  return { ...recipe, plan, totalWaterMl, totalSteepS, targetRatio, targetTotalTimeS };
}

// ---------- validation ----------

// Everything stopping this recipe from being brewed. [] means ready.
// → [{ step: number | null, stepId?, field?, message }]
export function validateRecipe(recipe, rig) {
  const issues = [];
  const plan = migratePlan(recipe.plan);
  const { perStep, steeps } = valveSteeps(plan);

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
    const v = perStep[i];
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
      if (v.startsSteep) {
        if (!isNum(a.valveOpenAtS)) add('valve closed — set when to open it');
        else if (isNum(a.atS) && a.valveOpenAtS <= a.atS) {
          add(`open time (${formatClock(a.valveOpenAtS)}) must be after the pour starts (${formatClock(a.atS)})`);
        }
      }
    }
    if (a.action === 'cut' && v.valveState === 'closed') {
      add(`the valve is still closed${isNum(v.closedUntilS) ? ` until ${formatClock(v.closedUntilS)}` : ''} — nothing is draining yet`);
    }
    if (a.action === 'swirl' && !(Number.isInteger(a.count) && a.count >= 1)) add('swirl count must be a whole number, 1 or more');
  });

  // Target drawdown end: optional prediction. When set it must fit the plan.
  const dd = recipe.targetDrawdownEndS;
  if (dd != null) {
    const addDd = message => issues.push({ step: null, field: 'targetDrawdownEndS', message });
    const lastPour = [...plan].reverse().find(a => a.action === 'pour' && isNum(a.atS));
    const opens = steeps.map(s => s.openAtS).filter(isNum);
    const lastOpen = opens.length ? Math.max(...opens) : null;
    const cut = plan[firstCut];
    if (!isNum(dd) || dd < 0) addDd('Target drawdown end is not a valid time.');
    else if (lastPour && dd <= lastPour.atS) {
      addDd(`Target drawdown end (${formatClock(dd)}) must be after the last pour (${formatClock(lastPour.atS)}).`);
    } else if (lastOpen !== null && dd <= lastOpen) {
      addDd(`Target drawdown end (${formatClock(dd)}) must be after the valve opens (${formatClock(lastOpen)}).`);
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
