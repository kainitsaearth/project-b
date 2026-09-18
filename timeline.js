// timeline.js — PURE. Imports nothing, touches no DOM, reads no app state.
// Turns tapped events into phases, and compares them with the plan.
//
// PHASES PARTITION THE BREW — no overlap, they always sum to the total time:
//   steep / lock  valve closed. Steep if the recipe planned that closure, lock if it was live.
//   bloom         valve open, before pour 2
//   percolation   valve open, from pour 2 until the last pour starts
//   drawdown      valve open, from the last pour until the brew ends
// The brew starts at the first pour and ends at the FIRST of `cut` or `drawdown-complete`.
// A phase exists only if events produced it: a V60 brew never has a `steep` key.
//
// POUR DONE (optional): a `pour-done` tap after the LAST pour moves the start of drawdown to
// when pouring actually stopped; the pouring time becomes percolation. Without it, drawdown
// starts at the last pour's start. Pour-done on earlier pours is kept but changes no phase.
//
// TimelineEvent =
//     { atS, type: 'pour', volumeMl, tempC, style, valve }   valve 'closed' closes it
//   | { atS, type: 'pour-done' }                             pouring stopped (optional)
//   | { atS, type: 'valve', state: 'open' | 'closed', trigger }
//   | { atS, type: 'swirl', count }
//   | { atS, type: 'cut' }                                   dripper lifted — a decision
//   | { atS, type: 'drawdown-complete' }                     natural finish

export const PHASES = Object.freeze(['bloom', 'percolation', 'steep', 'lock', 'drawdown']);

// ±5 s per phase, ±10 s on drawdown (spec §5.2). Total uses the drawdown tolerance.
export const DEFAULT_TOLERANCE = Object.freeze({ phaseS: 5, drawdownS: 10, totalS: 10 });

// A live valve closure within this many seconds of a planned one is that planned steep.
export const STEEP_MATCH_WINDOW_S = 15;

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const EPS = 1e-9;

// Valid events in time order. Equal times keep their original order.
function orderEvents(timeline) {
  const valid = [];
  let ignored = 0;
  (Array.isArray(timeline) ? timeline : []).forEach((e, i) => {
    if (e && typeof e.type === 'string' && isNum(e.atS)) valid.push({ e, i });
    else ignored += 1;
  });
  valid.sort((a, b) => a.e.atS - b.e.atS || a.i - b.i);
  return { events: valid.map(v => v.e), ignored };
}

// ---------- segmentation ----------

// timeline: TimelineEvent[] (any order)
// plannedClosures: [{ closeAtS }] from the recipe — what makes a closure a steep instead of a lock
// → { complete, endedBy: 'cut' | 'drawdown' | null, startS, endS, totalS,
//     phases: { [phase]: seconds | null },   null = still running (no end yet)
//     segments: [{ phase, startS, endS, durationS }],
//     closures: [{ closeAtS, openAtS, kind: 'steep' | 'lock', durationS }],
//     ignored, ignoredAfterEnd }
// options.usePourDone (default true): false measures drawdown from the last pour's START,
// the only convention a plan can follow (plans don't know pour durations).
export function segmentTimeline(timeline, plannedClosures = [], { usePourDone = true } = {}) {
  const { events, ignored } = orderEvents(timeline);

  const endIndex = events.findIndex(e => e.type === 'cut' || e.type === 'drawdown-complete');
  const endEvent = endIndex >= 0 ? events[endIndex] : null;
  const endS = endEvent ? endEvent.atS : null;
  const endedBy = endEvent ? (endEvent.type === 'cut' ? 'cut' : 'drawdown') : null;
  const inScope = endIndex >= 0 ? events.slice(0, endIndex) : events;
  const ignoredAfterEnd = endIndex >= 0 ? events.length - endIndex - 1 : 0;

  const pours = inScope.filter(e => e.type === 'pour');
  if (pours.length === 0) {
    return { complete: false, endedBy, startS: null, endS, totalS: null, lastPourS: null, lastPourEndS: null, pourDoneUsed: false,
      phases: {}, segments: [], closures: [], ignored, ignoredAfterEnd };
  }
  const startS = pours[0].atS;
  const pour2S = pours.length >= 2 ? pours[1].atS : null;
  const lastPour = pours[pours.length - 1];
  const lastPourS = lastPour.atS;
  const doneTap = usePourDone
    ? inScope.slice(inScope.indexOf(lastPour) + 1).find(e => e.type === 'pour-done' && e.atS > lastPourS)
    : null;
  const lastPourEndS = doneTap ? doneTap.atS : lastPourS;

  // Valve closures. A closed pour or a valve-closed event closes; only a valve-open event opens.
  // (A pour marked "open" while the valve is shut is a pour inside a steep, not an opening.)
  let closures = [];
  let current = null;
  for (const e of inScope) {
    const closes = (e.type === 'pour' && e.valve === 'closed') || (e.type === 'valve' && e.state === 'closed');
    const opens = e.type === 'valve' && e.state === 'open';
    if (closes && !current) {
      current = { closeAtS: e.atS, openAtS: null };
      closures.push(current);
    } else if (opens && current) {
      current.openAtS = e.atS;
      current = null;
    }
  }
  closures = closures.filter(c => c.openAtS === null || c.openAtS > c.closeAtS);

  // Plan intent: each planned closure can claim one actual closure near its time.
  const planned = (Array.isArray(plannedClosures) ? plannedClosures : [])
    .filter(p => isNum(p?.closeAtS))
    .map(p => ({ closeAtS: p.closeAtS, used: false }));
  for (const c of closures) {
    const match = planned.find(p => !p.used && Math.abs(p.closeAtS - c.closeAtS) <= STEEP_MATCH_WINDOW_S + EPS);
    if (match) match.used = true;
    c.kind = match ? 'steep' : 'lock';
  }

  const phaseAt = t => {
    const c = closures.find(x => x.closeAtS <= t && (x.openAtS === null || t < x.openAtS));
    if (c) return c.kind;
    if (pour2S !== null && t < pour2S) return 'bloom';
    if (t < lastPourEndS) return 'percolation';
    return 'drawdown';
  };

  // Cut time into intervals at every boundary, label each, merge neighbours.
  const inRange = t => isNum(t) && t >= startS && (endS === null || t <= endS);
  const bounds = [...new Set([startS, pour2S, lastPourS, lastPourEndS, ...closures.flatMap(c => [c.closeAtS, c.openAtS]), endS].filter(inRange))]
    .sort((a, b) => a - b);

  const raw = [];
  for (let i = 0; i + 1 < bounds.length; i++) {
    raw.push({ phase: phaseAt(bounds[i]), startS: bounds[i], endS: bounds[i + 1] });
  }
  if (endS === null) raw.push({ phase: phaseAt(bounds[bounds.length - 1]), startS: bounds[bounds.length - 1], endS: null });

  const segments = [];
  for (const s of raw) {
    const prev = segments[segments.length - 1];
    if (prev && prev.phase === s.phase && prev.endS === s.startS) prev.endS = s.endS;
    else segments.push({ ...s });
  }
  // Bounds are unique, so every interval has positive length: no empty phases to filter out.
  for (const s of segments) s.durationS = s.endS === null ? null : s.endS - s.startS;

  const phases = {};
  for (const phase of PHASES) {
    const own = segments.filter(s => s.phase === phase);
    if (own.length === 0) continue;
    phases[phase] = own.some(s => s.durationS === null) ? null : own.reduce((t, s) => t + s.durationS, 0);
  }

  const clip = t => Math.max(startS, endS === null ? t : Math.min(t, endS));
  const closuresOut = closures.map(c => {
    const from = clip(c.closeAtS);
    const to = c.openAtS === null ? endS : clip(c.openAtS);
    return { closeAtS: c.closeAtS, openAtS: c.openAtS, kind: c.kind, durationS: to === null ? null : Math.max(0, to - from) };
  });

  return {
    complete: endS !== null,
    endedBy, startS, endS,
    totalS: endS === null ? null : endS - startS,
    lastPourS, lastPourEndS: endS === null ? lastPourEndS : Math.min(lastPourEndS, endS),
    pourDoneUsed: Boolean(doneTap) && (endS === null || doneTap.atS <= endS),
    phases, segments, closures: closuresOut,
    ignored, ignoredAfterEnd,
  };
}

// ---------- the plan as a timeline ----------

// A NORMALIZED recipe (recipe.normalizeRecipe output) rendered as the events a perfect brew
// would tap, so plan and actual go through the same segmentation.
// Planned end: the cut if there is one, else the target drawdown end, else none (open-ended).
// → { events: TimelineEvent[], closures: [{ closeAtS, openAtS }] }
export function planToTimeline(recipe) {
  const events = [];
  const closures = [];
  for (const a of recipe?.plan ?? []) {
    if (!isNum(a?.atS)) continue;
    if (a.action === 'pour') {
      const startsSteep = a.valveClosedByStep != null && a.valveClosedByStep === a.seq;
      events.push({ type: 'pour', atS: a.atS, volumeMl: a.volumeMl ?? null, valve: startsSteep ? 'closed' : 'open' });
      if (startsSteep) {
        const openAtS = isNum(a.valveClosedUntilS) ? a.valveClosedUntilS : null;
        closures.push({ closeAtS: a.atS, openAtS });
        if (openAtS !== null) events.push({ type: 'valve', atS: openAtS, state: 'open', trigger: 'planned' });
      }
    } else if (a.action === 'swirl') {
      events.push({ type: 'swirl', atS: a.atS, count: a.count ?? null });
    } else if (a.action === 'cut') {
      events.push({ type: 'cut', atS: a.atS });
    }
  }
  if (isNum(recipe?.targetDrawdownEndS)) events.push({ type: 'drawdown-complete', atS: recipe.targetDrawdownEndS });
  return { events, closures };
}

// ---------- drift ----------

// Actual minus planned, per phase and in total, flagged short / on / long.
//   - A phase missing on one side counts as 0 there; unknown (null) is never judged.
//   - lock is never judged: it is a live decision, not something the plan could get wrong.
//   - A CUT brew is exempt from SHORT on: the drawdown, the total, the phase the cut interrupted,
//     and any phase the cut prevented from happening at all. Ending early was the decision, so
//     phases that never ran are not execution errors. A phase that ran LONG before the cut is
//     still flagged.
// → { phases: { [phase]: { planS, actualS, deltaS, flag, exempt } }, total: {…} }
//   flag: 'short' | 'on' | 'long' | null      exempt: 'cut' | 'live' | null
export function phaseDrift(planned, actual, tolerance = {}) {
  const tol = { ...DEFAULT_TOLERANCE, ...tolerance };
  const phases = {};
  for (const phase of PHASES) {
    const inPlan = Boolean(planned) && phase in planned.phases;
    const inActual = Boolean(actual) && phase in actual.phases;
    if (!inPlan && !inActual) continue;
    const planS = planned ? (inPlan ? planned.phases[phase] : 0) : null;
    const actualS = actual ? (inActual ? actual.phases[phase] : 0) : null;
    const wasCut = actual?.endedBy === 'cut';
    // The phase the cut landed in is the last one that ran.
    const cutPhase = wasCut ? actual.segments?.[actual.segments.length - 1]?.phase ?? null : null;
    phases[phase] = judge(planS, actualS, phase === 'drawdown' ? tol.drawdownS : tol.phaseS, {
      live: phase === 'lock',
      cut: wasCut && (phase === 'drawdown' || phase === cutPhase || !inActual || actualS === 0),
    });
  }
  const total = judge(planned?.totalS ?? null, actual?.totalS ?? null, tol.totalS, { cut: actual?.endedBy === 'cut' });
  return { phases, total };
}

function judge(planS, actualS, limitS, { live = false, cut = false } = {}) {
  if (live) return { planS, actualS, deltaS: null, flag: null, exempt: 'live' };
  if (!isNum(planS) || !isNum(actualS)) return { planS, actualS, deltaS: null, flag: null, exempt: null };
  const deltaS = actualS - planS;
  const flag = Math.abs(deltaS) <= limitS + EPS ? 'on' : deltaS < 0 ? 'short' : 'long';
  if (cut && flag === 'short') return { planS, actualS, deltaS, flag: null, exempt: 'cut' };
  return { planS, actualS, deltaS, flag, exempt: null };
}

// ---------- one call for a brew ----------

// recipe: normalized recipe or null (blank slate — then every closure is a lock, nothing is judged)
//
// `phases` is what really happened (drawdown from POUR DONE when tapped).
// `drift` compares like with like: the plan can't know pour durations, so drift measures
// drawdown from the last pour's START on both sides (`comparablePhases`). Otherwise every
// brew with a POUR DONE tap would read "drawdown short" by exactly its pouring time.
export function analyzeBrew(recipe, timeline, tolerance = {}) {
  const plan = recipe ? planToTimeline(recipe) : { events: [], closures: [] };
  const planned = recipe ? segmentTimeline(plan.events, plan.closures) : null;
  const actual = segmentTimeline(timeline, plan.closures);
  const comparable = actual.pourDoneUsed ? segmentTimeline(timeline, plan.closures, { usePourDone: false }) : actual;
  return {
    endedBy: actual.endedBy,
    complete: actual.complete,
    phases: actual.phases,
    segments: actual.segments,
    closures: actual.closures,
    pourDoneUsed: actual.pourDoneUsed,
    lastPourS: actual.lastPourS,
    lastPourEndS: actual.lastPourEndS,
    plannedPhases: planned ? planned.phases : null,
    comparablePhases: comparable.phases,
    drift: phaseDrift(planned, comparable, tolerance),
  };
}
