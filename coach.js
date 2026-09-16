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
        label: closes ? 'CLOSE VALVE + POUR' : 'POUR',
        volumeMl: a.volumeMl ?? null, cumulativeMl: a.cumulativeMl ?? null,
        tempC: a.tempC ?? null, style: a.style || null, flowRate: a.flowRate ?? null,
        valve: valve ? (closes || a.valveState === 'closed' ? 'closed' : 'open') : null,
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
