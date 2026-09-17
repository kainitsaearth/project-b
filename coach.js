// coach.js — the SCHEDULER half. PURE: imports nothing, no DOM, no timers, no globals.
// Step 7 adds the thin adapter (clock, Vibration API, audio) in the UI layer; it only has
// to follow what this produces.
//
// Cue rules:
//   - Every step fires at its time, with a countdown (3 → 2 → 1 by default) before it.
//   - Countdowns never overlap. When the next step is closer than the lead, its countdown
//     starts the moment the previous step fires: a step 2 s later counts 2 → 1.
//   - Less than MIN_CUE_S of warning → no countdown, just the fire.
//   - Steps at the same second are one cue: "OPEN VALVE + POUR" — one buzz, not two.
//   - Steps the rig can't do produce nothing: no LIFT DRIPPER on an uncuttable rig,
//     no CLOSE VALVE / OPEN VALVE without a valve.
//   - Nothing is scheduled after a cut: the dripper is already off.

export const DEFAULT_CUE_LEAD_S = 3;
export const MIN_CUE_S = 1;

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const EPS = 1e-9;

// ---------- actions ----------

// The cueable actions of a NORMALIZED recipe (recipe.normalizeRecipe output), in time order.
// A steep is two actions: its closing pour, and OPEN VALVE at the open time.
// → { actions: [{ type, seq, atS, label, …details }], skipped: [{ seq, reason }] }
export function plannedActions(recipe, rig) {
  const valve = Boolean(rig?.valveCapable);
  const cuttable = Boolean(rig?.cuttable);
  const list = [];
  const skipped = [];

  for (const a of recipe?.plan ?? []) {
    const seq = a?.seq ?? null;
    if (!isNum(a?.atS)) { skipped.push({ seq, reason: 'no time' }); continue; }

    if (a.action === 'pour') {
      const startsSteep = a.valveClosedByStep != null && a.valveClosedByStep === a.seq;
      const closes = valve && startsSteep;
      if (startsSteep && !valve) skipped.push({ seq, reason: 'valve closure ignored: rig has no valve' });
      list.push({
        type: 'pour', seq, atS: a.atS,
        label: `${closes ? 'CLOSE VALVE + POUR' : 'POUR'}${a.dripAssist ? ' WITH DRIP ASSIST' : ''}`,
        volumeMl: a.volumeMl ?? null, cumulativeMl: a.cumulativeMl ?? null,
        tempC: a.tempC ?? null, style: a.style || null, flowRate: a.flowRate ?? null,
        dripAssist: Boolean(a.dripAssist),
        valve: valve ? (closes || a.valveState === 'closed' ? 'closed' : 'open') : null,
        closesValve: closes,
      });
      if (closes && isNum(a.valveClosedUntilS) && a.valveClosedUntilS > a.atS) {
        list.push({ type: 'open-valve', seq, atS: a.valveClosedUntilS, label: 'OPEN VALVE' });
      }
    } else if (a.action === 'swirl') {
      const count = Number.isInteger(a.count) && a.count >= 1 ? a.count : 1;
      list.push({ type: 'swirl', seq, atS: a.atS, count, label: `SWIRL ×${count}` });
    } else if (a.action === 'cut') {
      if (cuttable) list.push({ type: 'cut', seq, atS: a.atS, label: 'LIFT DRIPPER' });
      else skipped.push({ seq, reason: "rig can't be cut" });
    } else {
      skipped.push({ seq, reason: `unknown step type "${a.action}"` });
    }
  }

  // Time order; equal times keep plan order.
  const ordered = list.map((x, i) => ({ x, i })).sort((p, q) => p.x.atS - q.x.atS || p.i - q.i).map(p => p.x);

  // Nothing after a cut.
  const cutAt = ordered.findIndex(x => x.type === 'cut');
  const actions = cutAt >= 0 ? ordered.slice(0, cutAt + 1) : ordered;
  if (cutAt >= 0) for (const x of ordered.slice(cutAt + 1)) skipped.push({ seq: x.seq, reason: 'after the cut' });

  return { actions, skipped };
}

// ---------- schedule ----------

// → { cueLeadS, startS, endS,
//     events: [ { kind: 'cue', atS, fireAtS, windowS, shortened, ticks: [{ atS, n }], label, actions }
//             | { kind: 'fire', atS, label, actions } ],   time order; at equal times a fire comes first
//     skipped }
// Cue lead: opts.cueLeadS, else recipe.cueLeadS, else 3. 0 turns countdowns off.
export function schedule(recipe, { rig = null, cueLeadS } = {}) {
  const lead = isNum(cueLeadS) && cueLeadS >= 0 ? cueLeadS
    : isNum(recipe?.cueLeadS) && recipe.cueLeadS >= 0 ? recipe.cueLeadS
    : DEFAULT_CUE_LEAD_S;
  const { actions, skipped } = plannedActions(recipe, rig);

  // Same second → one cue, one fire.
  const groups = [];
  for (const a of actions) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.atS - a.atS) <= EPS) last.actions.push(a);
    else groups.push({ atS: a.atS, actions: [a] });
  }

  const events = [];
  let prevFireS = -Infinity;
  for (const g of groups) {
    const label = g.actions.map(a => a.label).join(' + ');
    const cueAtS = Math.max(g.atS - lead, prevFireS);
    const windowS = g.atS - cueAtS;
    if (lead > 0 && windowS >= MIN_CUE_S - EPS) {
      // One tick per whole second before the fire. A tick landing exactly on the previous
      // fire is dropped: that moment already buzzed.
      const ticks = [];
      for (let n = Math.floor(windowS + EPS); n >= 1; n--) {
        const atS = g.atS - n;
        if (atS > prevFireS + EPS) ticks.push({ atS, n });
      }
      events.push({ kind: 'cue', atS: cueAtS, fireAtS: g.atS, windowS, shortened: windowS < lead - EPS, ticks, label, actions: g.actions });
    }
    events.push({ kind: 'fire', atS: g.atS, label, actions: g.actions });
    prevFireS = g.atS;
  }

  return {
    cueLeadS: lead,
    startS: events.length ? Math.min(0, events[0].atS) : 0,   // negative = pre-roll before the first pour
    endS: groups.length ? groups[groups.length - 1].atS : 0,
    events,
    skipped,
  };
}

// ---------- reading a schedule while brewing ----------

// What the coach screen shows at brew time tS.
// → { next, secondsToNext, countdown, last, done }
//   next: the upcoming fire event (null when done)   countdown: 3 / 2 / 1 while cueing, else null
export function stateAt(sched, tS) {
  const events = sched?.events ?? [];
  const fires = events.filter(e => e.kind === 'fire');
  const next = fires.find(f => f.atS > tS + EPS) ?? null;
  let last = null;
  for (const f of fires) if (f.atS <= tS + EPS) last = f;
  const cue = events.find(e => e.kind === 'cue' && e.atS <= tS + EPS && tS < e.fireAtS - EPS) ?? null;
  return {
    next,
    secondsToNext: next ? next.atS - tS : null,
    countdown: cue ? Math.max(1, Math.ceil(cue.fireAtS - tS - EPS)) : null,
    last,
    done: next === null,
  };
}

// ---------- taps ----------
//
// The brew's state is DERIVED from its timeline, never stored beside it. Undo is "drop the
// last tap", and resuming after Android kills the app is "reload the timeline".
// Every event carries `tap` (which press made it); planned actions also carry `fire`
// (index into the schedule's fires) and `plannedAtS`.

const firesOf = sched => (sched?.events ?? []).filter(e => e.kind === 'fire');
const round2 = t => Math.round(t * 100) / 100;

// → { fireIndex: next planned fire to tap, pourOpen, valve: 'open'|'closed',
//     valveClosedBy: 'planned' | 'live' | null, ended, endedBy, taps }
export function tapState(sched, timeline) {
  let fireIndex = 0;
  let pourOpen = false;
  let valve = 'open';
  let valveClosedBy = null;
  let ended = false;
  let endedBy = null;
  let taps = 0;
  for (const e of timeline ?? []) {
    if (!e || ended) continue;
    if (isNum(e.tap)) taps = Math.max(taps, e.tap);
    if (Number.isInteger(e.fire)) fireIndex = Math.max(fireIndex, e.fire + 1);
    if (e.type === 'pour') {
      pourOpen = true;
      if (e.valve === 'closed' && valve === 'open') { valve = 'closed'; valveClosedBy = 'planned'; }
    } else if (e.type === 'pour-done') {
      pourOpen = false;
    } else if (Number.isInteger(e.fire)) {
      pourOpen = false;   // a planned non-pour step: the pour before it is over, end unknown
    }
    if (e.type === 'valve') {
      if (e.state === 'closed' && valve === 'open') { valve = 'closed'; valveClosedBy = e.trigger === 'live' ? 'live' : 'planned'; }
      else if (e.state === 'open') { valve = 'open'; valveClosedBy = null; }
    }
    if (e.type === 'cut') { ended = true; endedBy = 'cut'; }
    if (e.type === 'drawdown-complete') { ended = true; endedBy = 'drawdown'; }
  }
  return { fireIndex, pourOpen, valve, valveClosedBy, ended, endedBy, taps };
}

// What the big TAP button does right now.
//   'pour-done'          a pour is running and the next step's countdown hasn't started
//   'action'             the next planned step (fire), tapped early or late
//   'drawdown-complete'  every planned step tapped: tap when the bed is dry
//   'none'               brew ended
// POUR DONE is optional: once the next countdown starts, the button moves on.
export function expectedTap(sched, timeline, tS) {
  const st = tapState(sched, timeline);
  if (st.ended) return { kind: 'none', label: 'DONE' };
  const next = firesOf(sched)[st.fireIndex] ?? null;
  if (st.pourOpen) {
    const cue = next ? sched.events.find(e => e.kind === 'cue' && e.fireAtS === next.atS) : null;
    const nextCountdownS = next ? (cue ? cue.atS : next.atS) : Infinity;
    if (tS < nextCountdownS - EPS) return { kind: 'pour-done', label: 'POUR DONE' };
  }
  if (next) return { kind: 'action', label: next.label, fire: next, fireIndex: st.fireIndex };
  return { kind: 'drawdown-complete', label: 'DRAWDOWN DONE' };
}

function eventsForAction(a, atS, tap, fire) {
  const base = { atS, tap, fire, plannedAtS: a.atS };
  switch (a.type) {
    case 'pour':
      return { ...base, type: 'pour', volumeMl: a.volumeMl, tempC: a.tempC, style: a.style, flowRate: a.flowRate,
        dripAssist: Boolean(a.dripAssist), valve: a.closesValve ? 'closed' : 'open' };
    case 'open-valve': return { ...base, type: 'valve', state: 'open', trigger: 'planned' };
    case 'swirl': return { ...base, type: 'swirl', count: a.count };
    case 'cut': return { ...base, type: 'cut' };
    default: return { ...base, type: a.type };
  }
}

// ---------- pour count-in ----------
//
// Pressing a POUR step doesn't stamp the pour at the press: it counts 3 → 2 → 1 first, so
// there's time to put the phone down and lift the kettle. The pour is stamped at
// press + countInS, straight away, with `pressedAtS` on it — so a killed app resumes
// mid-count, and UNDO cancels it. While a count-in runs every other press is ignored.
// Tip: press when the planned countdown starts and both counts land on the plan.

export const POUR_COUNT_IN_S = 3;

// The count-in running at brew time tS, or null.
// → { atS: when the pour is stamped, pressedAtS, remainingS, countdown: 3|2|1, tap }
export function pendingCountIn(timeline, tS) {
  let found = null;
  for (const e of timeline ?? []) {
    if (isNum(e?.pressedAtS) && isNum(e.atS) && e.atS > tS + EPS && e.pressedAtS <= tS + EPS) found = e;
  }
  if (!found) return null;
  const remainingS = found.atS - tS;
  return { atS: found.atS, pressedAtS: found.pressedAtS, remainingS, countdown: Math.max(1, Math.ceil(remainingS - EPS)), tap: found.tap };
}

// Buzzes of count-ins in (fromS, toS]: a tick on each whole second left, a fire when the pour is stamped.
// (The press itself already buzzed, so no tick at the press.)
export function countInBuzzes(timeline, fromS, toS) {
  const out = [];
  const seen = new Set();
  for (const e of timeline ?? []) {
    if (!isNum(e?.pressedAtS) || !isNum(e.atS) || seen.has(e.tap)) continue;
    seen.add(e.tap);
    for (let n = Math.floor(e.atS - e.pressedAtS - EPS); n >= 1; n--) {
      const at = e.atS - n;
      if (at > fromS + EPS && at <= toS + EPS) out.push({ atS: at, type: 'tick', n, label: 'COUNT-IN' });
    }
    if (e.atS > fromS + EPS && e.atS <= toS + EPS) out.push({ atS: e.atS, type: 'fire', label: 'POUR NOW' });
  }
  return out;
}

// Is moment tS inside a count-in (after its press, up to and including its pour)?
export function inCountIn(timeline, tS) {
  for (const e of timeline ?? []) {
    if (isNum(e?.pressedAtS) && isNum(e.atS) && tS > e.pressedAtS + EPS && tS <= e.atS + EPS) return true;
  }
  return false;
}

// A press, at brew time tS. Returns a NEW timeline; the input is never changed.
//   which: 'main' (the TAP button) | 'cut' | 'drawdown' | 'valve' (live close/open → lock)
//   countInS: seconds between pressing a pour step and stamping it (0 = stamp at the press)
// After the brew has ended, or while a count-in runs, every press is ignored.
export function applyTap(sched, timeline, tS, which = 'main', { countInS = 0 } = {}) {
  const tl = [...(timeline ?? [])];
  const st = tapState(sched, tl);
  if (st.ended || !isNum(tS)) return tl;
  if (tl.some(e => isNum(e?.atS) && e.atS > tS + EPS)) return tl;   // a count-in is running
  const tap = st.taps + 1;
  const atS = round2(tS);

  if (which === 'cut') tl.push({ type: 'cut', atS, tap });
  else if (which === 'drawdown') tl.push({ type: 'drawdown-complete', atS, tap });
  else if (which === 'valve') tl.push({ type: 'valve', state: st.valve === 'closed' ? 'open' : 'closed', trigger: 'live', atS, tap });
  else {
    const exp = expectedTap(sched, tl, tS);
    if (exp.kind === 'pour-done') tl.push({ type: 'pour-done', atS, tap });
    else if (exp.kind === 'drawdown-complete') tl.push({ type: 'drawdown-complete', atS, tap });
    else if (exp.kind === 'action') {
      const countIn = isNum(countInS) && countInS > 0 && exp.fire.actions.some(a => a.type === 'pour');
      for (const a of exp.fire.actions) {
        tl.push(countIn
          ? { ...eventsForAction(a, round2(tS + countInS), tap, exp.fireIndex), pressedAtS: atS }
          : eventsForAction(a, atS, tap, exp.fireIndex));
      }
    }
  }
  return tl;
}

// Removes everything the last press added (a merged step like OPEN VALVE + POUR goes as one).
export function undoTap(timeline) {
  const tl = timeline ?? [];
  const last = tl.reduce((m, e) => (isNum(e?.tap) ? Math.max(m, e.tap) : m), 0);
  return last === 0 ? [...tl] : tl.filter(e => e?.tap !== last);
}

// Each tapped planned step: when it was planned vs when it was tapped.
// → [{ fire, label, plannedAtS, actualAtS, deltaS }]
export function tapDrift(sched, timeline) {
  const fires = firesOf(sched);
  const seen = new Set();
  const out = [];
  for (const e of timeline ?? []) {
    if (!Number.isInteger(e?.fire) || seen.has(e.fire) || !fires[e.fire]) continue;
    seen.add(e.fire);
    out.push({ fire: e.fire, label: fires[e.fire].label, plannedAtS: fires[e.fire].atS, actualAtS: e.atS, deltaS: round2(e.atS - fires[e.fire].atS) });
  }
  return out;
}

// Every buzz moment (countdown tick or fire) in (fromS, toS], in order.
// The adapter calls this each frame with the previous and current time, so each moment
// is signalled exactly once however uneven the frames are.
// → [{ atS, type: 'tick', n, label } | { atS, type: 'fire', label }]
export function buzzesBetween(sched, fromS, toS) {
  const out = [];
  for (const e of sched?.events ?? []) {
    if (e.kind === 'cue') {
      for (const t of e.ticks) if (t.atS > fromS + EPS && t.atS <= toS + EPS) out.push({ atS: t.atS, type: 'tick', n: t.n, label: e.label });
    } else if (e.atS > fromS + EPS && e.atS <= toS + EPS) {
      out.push({ atS: e.atS, type: 'fire', label: e.label });
    }
  }
  return out.sort((a, b) => a.atS - b.atS || (a.type === 'fire' ? -1 : 1));
}
