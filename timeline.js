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
// Known limit: only a pour's START is tapped, so the last pour's pouring time counts
// toward drawdown.
//
// TimelineEvent =
//     { atS, type: 'pour', volumeMl, tempC, style, valve }   valve 'closed' closes it
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
export function segmentTimeline(timeline, plannedClosures = []) {
  const { events, ignored } = orderEvents(timeline);

  const endIndex = events.findIndex(e => e.type === 'cut' || e.type === 'drawdown-complete');
  const endEvent = endIndex >= 0 ? events[endIndex] : null;
  const endS = endEvent ? endEvent.atS : null;
  const endedBy = endEvent ? (endEvent.type === 'cut' ? 'cut' : 'drawdown') : null;
  const inScope = endIndex >= 0 ? events.slice(0, endIndex) : events;
  const ignoredAfterEnd = endIndex >= 0 ? events.length - endIndex - 1 : 0;

  const pours = inScope.filter(e => e.type === 'pour');
  if (pours.length === 0) {
    return { complete: false, endedBy, startS: null, endS, totalS: null, phases: {}, segments: [], closures: [], ignored, ignoredAfterEnd };
  }
  const startS = pours[0].atS;
  const pour2S = pours.length >= 2 ? pours[1].atS : null;
  const lastPourS = pours[pours.length - 1].atS;

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
    if (t < lastPourS) return 'percolation';
    return 'drawdown';
  };

  // Cut time into intervals at every boundary, label each, merge neighbours.
  const inRange = t => isNum(t) && t >= startS && (endS === null || t <= endS);
  const bounds = [...new Set([startS, pour2S, lastPourS, ...closures.flatMap(c => [c.closeAtS, c.openAtS]), endS].filter(inRange))]
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
//   - A CUT brew is exempt from SHORT drawdown and SHORT total: ending early was the decision.
//     A long drawdown before the cut is still flagged.
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
    phases[phase] = judge(planS, actualS, phase === 'drawdown' ? tol.drawdownS : tol.phaseS, {
      live: phase === 'lock',
      cut: phase === 'drawdown' && actual?.endedBy === 'cut',
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
export function analyzeBrew(recipe, timeline, tolerance = {}) {
  const plan = recipe ? planToTimeline(recipe) : { events: [], closures: [] };
  const planned = recipe ? segmentTimeline(plan.events, plan.closures) : null;
  const actual = segmentTimeline(timeline, plan.closures);
  return {
    endedBy: actual.endedBy,
    complete: actual.complete,
    phases: actual.phases,
    segments: actual.segments,
    closures: actual.closures,
    plannedPhases: planned ? planned.phases : null,
    drift: phaseDrift(planned, actual, tolerance),
  };
}
