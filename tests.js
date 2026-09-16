// tests.js — console assertions. Runs on load on localhost or with ?test,
// and directly under Node:  node tests.js

import { daysOffRoast, totalWaterIn, retention, trueRatio, diff, DIFF_IGNORE, UNKNOWN } from './compute.js?v=6';
import * as model from './model.js?v=6';
import * as R from './recipe.js?v=6';

// Plan Step 4's test recipe: 50 g closed → release → 100 g → 60 g @ 84 °C → swirl ×1 → cut.
// Times and dose from (C) Yuan's Simmer Technique (17 g, 210 g total).
const yuanRecipe = () => R.normalizeRecipe(model.createRecipe({
  id: 'recipe-yuan', name: 'Yuan valve-lock', rigId: 'rig-switch', doseG: 17,
  plan: [
    { id: 's1', action: 'pour', atS: 0, volumeMl: 50, tempC: 92, style: 'center', valve: 'closed' },
    { id: 's2', action: 'release', atS: 40 },
    { id: 's3', action: 'pour', atS: 45, volumeMl: 100, tempC: 92, style: 'spiral', valve: 'open' },
    { id: 's4', action: 'pour', atS: 80, volumeMl: 60, tempC: 84, style: 'center', valve: 'open' },
    { id: 's5', action: 'swirl', atS: 110, count: 1 },
    { id: 's6', action: 'cut', atS: 150 },
  ],
}));
const switchRig = () => model.createRig({ id: 'rig-switch', name: 'C40 + Hario Switch', valveCapable: true, immersionCapable: true });
const v60Rig = () => model.seedPresets().rigs.find(r => r.id === 'rig-seed-c40-v60');

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

  // ---- recipe: derived fields ----
  {
    const y = yuanRecipe();
    eq('recipe: seq numbered 1..6', y.plan.map(a => a.seq), [1, 2, 3, 4, 5, 6]);
    eq('recipe: cumulative ml is what the scale reads', y.plan.filter(a => a.action === 'pour').map(a => a.cumulativeMl), [50, 150, 210]);
    eq('recipe: non-pours carry no cumulative', 'cumulativeMl' in y.plan[1], false);
    eq('recipe: total water 210', y.totalWaterMl, 210);
    near('recipe: ratio 210 / 17', y.targetRatio, 210 / 17);
    eq('recipe: total time from last action (cut @ 2:30)', y.targetTotalTimeS, 150);

    const steep = R.normalizeRecipe({ plan: [
      { id: 'a', action: 'pour', atS: 0, volumeMl: 200 },
      { id: 'b', action: 'steep', atS: 30, durationS: 90 },
    ] });
    eq('recipe: steep end counts toward total time', steep.targetTotalTimeS, 120);
    eq('recipe: no dose → ratio null, not NaN', steep.targetRatio, null);

    const broken = R.normalizeRecipe({ plan: [
      { id: 'a', action: 'pour', atS: 0, volumeMl: 50 },
      { id: 'b', action: 'pour', atS: 30, volumeMl: null },
      { id: 'c', action: 'pour', atS: 60, volumeMl: 60 },
    ] });
    eq('recipe: missing volume blanks that and later cumulatives', broken.plan.map(a => a.cumulativeMl), [50, null, null]);
    eq('recipe: missing volume → total water null', broken.totalWaterMl, null);
    eq('recipe: a missing time → total time null', R.normalizeRecipe({ plan: [{ id: 'a', action: 'pour', atS: null, volumeMl: 5 }] }).targetTotalTimeS, null);
    eq('recipe: empty plan → nulls', [R.normalizeRecipe({ plan: [] }).totalWaterMl, R.normalizeRecipe({ plan: [] }).targetTotalTimeS], [null, null]);
    eq('recipe: normalize does not mutate input', (() => { const raw = { plan: [{ id: 'a', action: 'pour', atS: 0, volumeMl: 5 }] }; R.normalizeRecipe(raw); return 'seq' in raw.plan[0]; })(), false);
  }

  // ---- recipe: rig capabilities (THE Step 4 check, logic half) ----
  {
    const y = yuanRecipe();
    eq('rig: Yuan on a Switch → valid', R.validateRecipe(y, switchRig()), []);
    eq('rig: Yuan on a Switch → no conflicts', R.rigConflicts(y.plan, switchRig()), []);

    const conflicts = R.rigConflicts(y.plan, v60Rig());
    eq('rig: Yuan → V60 refused on exactly steps 1 and 2', conflicts.map(c => [c.step, c.action, c.fix]),
      [[1, 'pour', 'open-valve'], [2, 'release', 'remove']]);
    eq('rig: conflict messages say why', conflicts.map(c => c.message), [
      'Step 1 (pour): closed valve, but this rig has no valve',
      'Step 2 (release): this rig has no valve to release',
    ]);
    eq('rig: V60 validation surfaces the same 2 problems', R.validateRecipe({ ...y, rigId: 'rig-seed-c40-v60' }, v60Rig()).length, 2);

    const adapted = R.adaptPlanToRig(y.plan, v60Rig());
    eq('rig: adapt removes release only', adapted.map(a => a.id), ['s1', 's3', 's4', 's5', 's6']);
    eq('rig: adapt opens the closed pour', adapted[0].valve, 'open');
    eq('rig: adapted plan has no conflicts', R.rigConflicts(adapted, v60Rig()), []);
    eq('rig: adapt does not mutate the original', [y.plan.length, y.plan[0].valve], [6, 'closed']);

    const noCut = model.createRig({ cuttable: false });
    eq('rig: cut refused on uncuttable rig', R.rigConflicts(y.plan, noCut).map(c => c.action), ['pour', 'release', 'cut']);
    eq('rig: steep refused without immersion', R.rigConflicts([{ id: 'x', action: 'steep', atS: 0, durationS: 30 }], v60Rig()).map(c => c.action), ['steep']);
    eq('rig: open-valve pour is fine on a V60', R.rigConflicts([{ id: 'x', action: 'pour', valve: 'open' }], v60Rig()), []);
  }

  // ---- recipe: validation ----
  {
    const y = yuanRecipe();
    const msgs = recipe => R.validateRecipe(recipe, switchRig()).map(x => x.message);
    eq('validate: no rig', R.validateRecipe({ ...y, rigId: null }, undefined).map(x => x.message), ['Pick a rig.']);
    eq('validate: rig deleted', R.validateRecipe(y, undefined)[0].message, "This recipe's rig no longer exists. Pick another.");
    eq('validate: no pours', msgs({ ...y, plan: [{ id: 'x', action: 'swirl', atS: 0, count: 1 }] }), ['Add at least one pour.']);
    const outOfOrder = structuredClone(y); outOfOrder.plan[3].atS = 30;
    eq('validate: step earlier than the one above', msgs(outOfOrder), ['Step 4 (pour): starts before the step above it']);
    const bad = structuredClone(y);
    bad.plan[0].volumeMl = 0; bad.plan[2].tempC = 150; bad.plan[4].count = 1.5; bad.plan[5].atS = null;
    eq('validate: volume, temp, swirl count, time', msgs(bad), [
      'Step 1 (pour): volume missing',
      'Step 3 (pour): temperature must be 1–100 °C',
      'Step 5 (swirl): swirl count must be a whole number, 1 or more',
      'Step 6 (cut): time missing (seconds, or m:ss)',
    ]);
    eq('validate: equal times are allowed', msgs({ ...y, plan: y.plan.map(a => (a.id === 's3' ? { ...a, atS: 40 } : a)) }), []);
  }

  // ---- recipe: target drawdown end ----
  {
    const y = yuanRecipe();
    const msgs = recipe => R.validateRecipe(recipe, switchRig()).map(x => x.message);
    const noCut = { ...y, plan: y.plan.filter(a => a.action !== 'cut') };

    eq('drawdown: optional — unset is not an issue', msgs(y), []);
    eq('drawdown: new recipes start unset', model.createRecipe().targetDrawdownEndS, null);
    eq('drawdown: no cut → total time is the drawdown end', R.normalizeRecipe({ ...noCut, targetDrawdownEndS: 180 }).targetTotalTimeS, 180);
    eq('drawdown: no cut, unset → total time is the last step', R.normalizeRecipe(noCut).targetTotalTimeS, 110);
    // Step 5 test 4's setup: cut at 150, drawdown planned to 180 — a legitimate plan
    eq('drawdown: planned cut 2:30 + drawdown 3:00 is valid', msgs({ ...y, targetDrawdownEndS: 180 }), []);
    eq('drawdown: a planned cut ends the brew → total time = cut', R.normalizeRecipe({ ...y, targetDrawdownEndS: 180 }).targetTotalTimeS, 150);
    eq('drawdown: must be after the last pour', msgs({ ...noCut, targetDrawdownEndS: 80 }),
      ['Target drawdown end (1:20) must be after the last pour (1:20).']);
    eq('drawdown: cut at/after it leaves nothing to cut', msgs({ ...y, targetDrawdownEndS: 140 }),
      ['The cut (2:30) is at or after the target drawdown end (2:20) — nothing would be left to cut.']);
    eq('drawdown: negative is invalid', msgs({ ...y, targetDrawdownEndS: -5 }), ['Target drawdown end is not a valid time.']);
    eq('drawdown: issue carries its field for the UI', R.validateRecipe({ ...y, targetDrawdownEndS: -5 }, switchRig())[0].field, 'targetDrawdownEndS');
    eq('drawdown: survives a fork', R.forkRecipe({ ...y, targetDrawdownEndS: 180 }, 'f', []).targetDrawdownEndS, 180);

    const afterCut = structuredClone(y);
    afterCut.plan.push({ id: 's7', action: 'pour', atS: 160, volumeMl: 20, valve: 'open' });
    eq('cut: a step after the cut is flagged', msgs(afterCut), ['Step 7 (pour): comes after the cut — the dripper is already off']);
  }

  // ---- recipe: pour flow rate 1–10 ----
  {
    const y = yuanRecipe();
    const withFlow = flowRate => ({ ...y, plan: y.plan.map(a => (a.id === 's3' ? { ...a, flowRate } : a)) });
    const msgs = recipe => R.validateRecipe(recipe, switchRig()).map(x => x.message);
    eq('flow rate: optional — unset is fine', msgs(withFlow(null)), []);
    eq('flow rate: 1 and 10 are valid', [msgs(withFlow(1)), msgs(withFlow(10))], [[], []]);
    for (const bad of [0, 11, 5.5, -1]) {
      eq(`flow rate: ${bad} rejected`, msgs(withFlow(bad)), ['Step 3 (pour): flow rate must be a whole number 1–10']);
    }
    eq('flow rate: first pour starts unset', model.createAction('pour').flowRate, null);
    eq('flow rate: next pour inherits it', model.createAction('pour', [{ action: 'pour', atS: 0, flowRate: 7 }]).flowRate, 7);
    eq('flow rate: only pours carry it', 'flowRate' in model.createAction('swirl'), false);
    eq('flow rate: survives adapting to a V60', R.adaptPlanToRig(withFlow(4).plan, v60Rig()).find(a => a.id === 's3').flowRate, 4);
  }

  // ---- recipe: clock ----
  eq('clock: seconds', R.parseClock('45'), 45);
  eq('clock: m:ss', R.parseClock('1:05'), 65);
  eq('clock: m.ss (phone number pad)', R.parseClock('2.30'), 150);
  eq('clock: whitespace', R.parseClock(' 0:40 '), 40);
  for (const bad of ['', '1:5', '1:75', 'abc', '-5', '1:30:00', null, 1.5]) {
    eq(`clock: rejects ${JSON.stringify(bad)}`, R.parseClock(bad), null);
  }
  eq('clock: format', [R.formatClock(0), R.formatClock(65), R.formatClock(600), R.formatClock(null)], ['0:00', '1:05', '10:00', '']);

  // ---- recipe: versioning ----
  {
    const y = yuanRecipe();
    const sessions = [
      { id: 'sess-1', brews: [{ recipeId: 'recipe-yuan' }, { recipeId: 'recipe-yuan' }, { recipeId: 'other' }] },
      { id: 'sess-2', brews: [] }, { id: 'sess-3' },
    ];
    const usage = R.recipeUsage(sessions);
    eq('version: usage counts brews per recipe', [usage.get('recipe-yuan'), usage.get('other'), usage.get('nope')], [2, 1, undefined]);

    const v2 = R.forkRecipe(y, 'recipe-yuan-2', [y]);
    eq('version: fork is v2 of the same family', [v2.version, v2.familyId, v2.forkedFrom, v2.id], [2, 'recipe-yuan', 'recipe-yuan', 'recipe-yuan-2']);
    eq('version: fork keeps the plan', v2.plan.map(a => a.cumulativeMl ?? null), y.plan.map(a => a.cumulativeMl ?? null));
    v2.plan[0].volumeMl = 999;
    eq('version: editing the fork leaves the original untouched', y.plan[0].volumeMl, 50);
    const v3 = R.forkRecipe(y, 'recipe-yuan-3', [y, v2]);
    eq('version: forking v1 again when v2 exists → v3', v3.version, 3);
  }

  // ---- model: recipe factories ----
  {
    const r = model.createRecipe();
    eq('model: new recipe is v1, own family', [r.version, r.familyId === r.id, r.cueLeadS, r.plan], [1, true, 3, []]);
    const plan = [model.createAction('pour')];
    eq('model: first step at 0:00', plan[0].atS, 0);
    plan[0].tempC = 88; plan[0].style = 'spiral';
    const next = model.createAction('pour', plan);
    eq('model: next pour inherits temp + style, +30 s', [next.atS, next.tempC, next.style, next.valve], [30, 88, 'spiral', 'open']);
    const afterSteep = model.createAction('release', [{ action: 'steep', atS: 30, durationS: 60 }]);
    eq('model: step after a steep starts after it ends', afterSteep.atS, 120);
    eq('model: step ids unique', model.createAction('cut').id !== model.createAction('cut').id, true);
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
