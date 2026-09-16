// tests.js — console assertions. Runs on load on localhost or with ?test,
// and directly under Node:  node tests.js

import { daysOffRoast, totalWaterIn, retention, trueRatio, diff, DIFF_IGNORE, UNKNOWN } from './compute.js?v=3';
import * as model from './model.js?v=3';

// A brew shaped like spec §5, as Step 8's clone-last will produce it.
const brewFixture = () => ({
  id: 'brew-1', sessionId: 'session-1', recipeId: 'recipe-yuan-v1', ladderId: null, step: null,
  beanId: 'bean-guji', rigId: 'rig-seed-c40-origami-abaca', waterId: 'water-seed-omb-75',
  daysOffRoast: 12,
  grind: { setting: 26, unit: 'clicks' },
  doseG: 15,
  preheat: { dripper: true, server: false },
  timeline: [
    { atS: 0, type: 'pour', volumeMl: 50, tempC: 93, style: 'center', valve: 'closed' },
    { atS: 40, type: 'valve', state: 'open', trigger: 'planned' },
    { atS: 45, type: 'pour', volumeMl: 100, tempC: 93, style: 'spiral', valve: 'open' },
    { atS: 80, type: 'pour', volumeMl: 60, tempC: 84, style: 'center', valve: 'open' },
    { atS: 110, type: 'swirl', count: 1 },
    { atS: 150, type: 'cut' },
  ],
  endedBy: 'cut', bypassG: 0, outputMl: 180, retentionMl: 30, trueRatio: 12, serveTempC: 55,
  phases: {}, drift: {}, assessment: null, changedFrom: null, diff: [], notes: '',
});

export function runTests(log = console) {
  const results = [];
  const eq = (name, actual, expected) => {
    const ok = Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected);
    results.push({ name, ok, actual, expected });
  };
  const near = (name, actual, expected, eps = 1e-9) => {
    results.push({ name, ok: typeof actual === 'number' && Math.abs(actual - expected) < eps, actual, expected });
  };

  // ---- compute.daysOffRoast ----
  eq('days: normal', daysOffRoast('2026-09-01', '2026-09-16'), 15);
  eq('days: same day is 0', daysOffRoast('2026-09-16', '2026-09-16'), 0);
  eq('days: month boundary', daysOffRoast('2026-08-31', '2026-09-01'), 1);
  eq('days: leap year', daysOffRoast('2028-02-28', '2028-03-01'), 2);
  eq('days: non-leap year', daysOffRoast('2027-02-28', '2027-03-01'), 1);
  eq('days: surrounding whitespace ok', daysOffRoast(' 2026-09-01 ', '2026-09-16'), 15);
  for (const bad of ['', null, undefined, 'garbage', '2026-02-30', '2026-13-01', '2026-9-1', '26-09-01', 20260901, NaN]) {
    eq(`days: unknown for ${JSON.stringify(bad) ?? String(bad)}`, daysOffRoast(bad, '2026-09-16'), UNKNOWN);
  }
  eq('days: roast after brew is unknown, not negative', daysOffRoast('2026-09-20', '2026-09-16'), UNKNOWN);
  eq('days: bad brew date is unknown', daysOffRoast('2026-09-01', 'nope'), UNKNOWN);

  // ---- compute.totalWaterIn ----
  eq('water: sums pours only (valve/swirl/cut ignored)', totalWaterIn(brewFixture().timeline), 210);
  eq('water: empty timeline is 0', totalWaterIn([]), 0);
  near('water: fractional volumes', totalWaterIn([{ type: 'pour', volumeMl: 0.1 }, { type: 'pour', volumeMl: 0.2 }]), 0.3);
  eq('water: unreadable pour → unknown, not a short total',
    totalWaterIn([{ type: 'pour', volumeMl: 50 }, { type: 'pour', volumeMl: 'abc' }]), UNKNOWN);
  eq('water: missing volume → unknown', totalWaterIn([{ type: 'pour' }]), UNKNOWN);
  eq('water: negative pour → unknown', totalWaterIn([{ type: 'pour', volumeMl: -5 }]), UNKNOWN);
  eq('water: not a timeline → unknown', totalWaterIn(null), UNKNOWN);

  // ---- compute.retention ----
  eq('retention: in − out', retention(210, 180), 30);
  eq('retention: zero is valid', retention(200, 200), 0);
  eq('retention: output above input → unknown', retention(200, 210), UNKNOWN);
  eq('retention: unknown water in propagates', retention(UNKNOWN, 180), UNKNOWN);
  eq('retention: missing output → unknown', retention(210, null), UNKNOWN);
  eq('retention: NaN → unknown', retention(NaN, 180), UNKNOWN);

  // ---- compute.trueRatio ----
  eq('ratio: 180 ml / 15 g = 12', trueRatio(15, 180), 12);
  near('ratio: unrounded', trueRatio(15, 250), 16.666666666666668);
  eq('ratio: zero dose → unknown, not Infinity', trueRatio(0, 180), UNKNOWN);
  eq('ratio: zero output → unknown', trueRatio(15, 0), UNKNOWN);
  eq('ratio: string dose → unknown', trueRatio('15', 180), UNKNOWN);

  // ---- compute.diff ----
  {
    const a = brewFixture();
    const clone = structuredClone(a);
    eq('diff: identical clone → no changes', diff(a, clone), []);

    // THE plan check: one changed field → exactly one entry
    const b = structuredClone(a); b.grind.setting = 28;
    eq('diff: one changed field → exactly one entry', diff(a, b), [{ field: 'grind.setting', from: 26, to: 28 }]);

    const c = structuredClone(a); c.grind.setting = 28; c.doseG = 16; c.waterId = 'water-seed-omb-50';
    eq('diff: three changes → three entries, sorted',
      diff(a, c).map(x => x.field), ['doseG', 'grind.setting', 'waterId']);

    // Outcomes and bookkeeping never count as variables
    const d = structuredClone(a);
    Object.assign(d, { id: 'brew-2', changedFrom: 'brew-1', outputMl: 175, retentionMl: 35, trueRatio: 11.7,
      endedBy: 'drawdown', notes: 'sour', daysOffRoast: 13, assessment: { window: 'under' } });
    d.timeline[2].volumeMl = 90;
    eq('diff: outcomes, ids, notes, timeline, daysOffRoast ignored', diff(a, d), []);

    const e = structuredClone(a); e.preheat.server = true;
    eq('diff: nested object field', diff(a, e), [{ field: 'preheat.server', from: false, to: true }]);

    const f = structuredClone(a); f.bypassG = null; const g = structuredClone(a); delete g.bypassG; g.serveTempC = undefined; f.serveTempC = null;
    eq('diff: null vs missing vs undefined are the same', diff(f, g), []);

    const h = structuredClone(a); h.bypassG = 20;
    eq('diff: 0 → 20 is a change (0 is a value, not empty)', diff(a, h), [{ field: 'bypassG', from: 0, to: 20 }]);

    const i = structuredClone(a); i.grind.setting = '26';
    eq('diff: 26 vs "26" is a change (types matter)', diff(a, i).length, 1);

    const j = structuredClone(a); j.grind = null;
    eq('diff: object → null is one whole-field change', diff(a, j), [{ field: 'grind', from: { setting: 26, unit: 'clicks' }, to: null }]);

    const k = structuredClone(a); k.newField = 'x';
    eq('diff: added field shows from null', diff(a, k), [{ field: 'newField', from: null, to: 'x' }]);

    eq('diff: key order does not matter',
      diff({ grind: { setting: 26, unit: 'clicks' } }, { grind: { unit: 'clicks', setting: 26 } }), []);
    eq('diff: custom ignore list', diff({ doseG: 15 }, { doseG: 16 }, ['doseG']), []);
    eq('diff: no parent (blank slate) → unknown', diff(null, a), UNKNOWN);
    eq('diff: does not mutate inputs', (() => { const x = brewFixture(), y = brewFixture(); y.doseG = 20; diff(x, y); return JSON.stringify(x) === JSON.stringify(brewFixture()); })(), true);
    eq('diff: ignore list is frozen', Object.isFrozen(DIFF_IGNORE), true);
  }

  // ---- model ----
  const { rigs, waters } = model.seedPresets();
  eq('seed: 3 rigs', rigs.length, 3);
  eq('seed: 7 waters', waters.length, 7);
  const ids = [...rigs, ...waters].map(e => e.id);
  eq('seed: ids unique', new Set(ids).size, ids.length);
  eq('seed: ids stable across calls', model.seedPresets().rigs.map(r => r.id), rigs.map(r => r.id));

  const v60 = rigs.find(r => r.id === 'rig-seed-c40-v60');
  const v60Actions = model.allowedActions(v60);
  eq('caps: V60 cannot steep', v60Actions.includes('steep'), false);
  eq('caps: V60 cannot release', v60Actions.includes('release'), false);
  eq('caps: V60 can cut', v60Actions.includes('cut'), true);
  eq('caps: Switch-like rig gets steep + release',
    model.allowedActions(model.createRig({ valveCapable: true, immersionCapable: true })),
    ['pour', 'swirl', 'steep', 'release', 'cut']);
  eq('caps: uncuttable rig has no cut', model.allowedActions(model.createRig({ cuttable: false })).includes('cut'), false);

  eq('factory: unique ids', model.createBean().id !== model.createBean().id, true);
  eq('factory: overrides kept', model.createWater({ ppm: 75 }).ppm, 75);
  eq('displayName: fallback', model.displayName('beans', model.createBean()), 'Untitled bean');

  const failed = results.filter(r => !r.ok);
  for (const r of failed) {
    log.error(`FAIL ${r.name}: expected ${JSON.stringify(r.expected)}, got ${JSON.stringify(r.actual)}`);
  }
  const summary = `tests: ${results.length - failed.length}/${results.length} passed`;
  if (failed.length) log.error(summary); else log.log(summary);
  return { passed: results.length - failed.length, failed: failed.length };
}

if (typeof window === 'undefined') {
  const { failed } = runTests();
  process.exitCode = failed ? 1 : 0;
}
