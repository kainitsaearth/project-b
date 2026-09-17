// tests.js — console assertions. Runs on load on localhost or with ?test,
// and directly under Node:  node tests.js

import { daysOffRoast, totalWaterIn, retention, trueRatio, diff, DIFF_IGNORE, UNKNOWN } from './compute.js?v=16';
import * as model from './model.js?v=16';
import * as R from './recipe.js?v=16';
import * as T from './timeline.js?v=16';
import * as C from './coach.js?v=16';
import * as Bw from './brew.js?v=16';

// Plan Step 4's test recipe: 50 g closed -> open at 0:40 -> 100 g -> 60 g @ 84 C -> swirl x1 -> cut.
// Times and dose from (C) Yuan's Simmer Technique (17 g, 210 g total).
// Steep model: the valve closes ON pour 1 and its open time lives there, no separate release step.
const yuanRecipe = () => R.normalizeRecipe(model.createRecipe({
  id: 'recipe-yuan', name: 'Yuan valve-lock', rigId: 'rig-switch', doseG: 17,
  plan: [
    { id: 's1', action: 'pour', atS: 0, volumeMl: 50, tempC: 92, style: 'center', valve: 'closed', valveOpenAtS: 40 },
    { id: 's2', action: 'pour', atS: 45, volumeMl: 100, tempC: 92, style: 'spiral', valve: 'open' },
    { id: 's3', action: 'pour', atS: 80, volumeMl: 60, tempC: 84, style: 'center', valve: 'open' },
    { id: 's4', action: 'swirl', atS: 110, count: 1 },
    { id: 's5', action: 'cut', atS: 150 },
  ],
}));
// The same recipe as saved before the steep model: a separate `release` step.
const legacyYuanPlan = () => [
  { id: 's1', action: 'pour', atS: 0, volumeMl: 50, tempC: 92, style: 'center', valve: 'closed' },
  { id: 'sR', action: 'release', atS: 40 },
  { id: 's2', action: 'pour', atS: 45, volumeMl: 100, tempC: 92, style: 'spiral', valve: 'open' },
  { id: 's3', action: 'pour', atS: 80, volumeMl: 60, tempC: 84, style: 'center', valve: 'open' },
  { id: 's4', action: 'swirl', atS: 110, count: 1 },
  { id: 's5', action: 'cut', atS: 150 },
];
const switchRig = () => model.createRig({ id: 'rig-switch', name: 'C40 + Hario Switch', valveCapable: true });
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
    eq('recipe: seq numbered 1..5', y.plan.map(a => a.seq), [1, 2, 3, 4, 5]);
    eq('recipe: cumulative ml is what the scale reads', y.plan.filter(a => a.action === 'pour').map(a => a.cumulativeMl), [50, 150, 210]);
    eq('recipe: non-pours carry no cumulative', 'cumulativeMl' in y.plan[3], false);
    eq('recipe: total water 210', y.totalWaterMl, 210);
    near('recipe: ratio 210 / 17', y.targetRatio, 210 / 17);
    eq('recipe: total time from the planned cut (2:30)', y.targetTotalTimeS, 150);
    eq('recipe: no dose → ratio null, not NaN', R.normalizeRecipe({ plan: [{ id: 'a', action: 'pour', atS: 0, volumeMl: 200 }] }).targetRatio, null);

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
    eq('recipe: normalize is idempotent', JSON.stringify(R.normalizeRecipe(y)), JSON.stringify(y));
  }

  // ---- recipe: steep = closed-valve pour + open time ----
  {
    const y = yuanRecipe();
    const at = (plan, i) => [plan[i].valveState, plan[i].valveClosedByStep, plan[i].valveClosedUntilS];
    eq('steep: Yuan pour 1 closes the valve until 0:40', at(y.plan, 0), ['closed', 1, 40]);
    eq('steep: closed for 0:40, stored on the pour that closes it', y.plan[0].closedForS, 40);
    eq('steep: pour 2 at 0:45 is after the valve opens', at(y.plan, 1), ['open', null, null]);
    eq('steep: only the closing pour carries closedForS', y.plan.filter(a => 'closedForS' in a).map(a => a.seq), [1]);
    eq('steep: total steep 0:40', y.totalSteepS, 40);

    const multi = R.normalizeRecipe({ plan: [
      { id: 'p1', action: 'pour', atS: 0, volumeMl: 50, valve: 'closed', valveOpenAtS: 90 },
      { id: 'p2', action: 'pour', atS: 30, volumeMl: 50, valve: 'open' },
      { id: 'w', action: 'swirl', atS: 60, count: 1 },
      { id: 'p3', action: 'pour', atS: 90, volumeMl: 50, valve: 'open' },
    ] });
    eq('steep: a pour before the open time is inside the steep', at(multi.plan, 1), ['closed', 1, 90]);
    eq('steep: a swirl inside the steep is valve-closed', at(multi.plan, 2), ['closed', 1, 90]);
    eq('steep: a pour exactly at the open time is outside', at(multi.plan, 3), ['open', null, null]);
    eq('steep: spanning 2 pours, closed for 1:30', [multi.plan[0].closedForS, multi.totalSteepS], [90, 90]);
    eq('steep: swirl inside a steep is valid', R.validateRecipe({ ...multi, rigId: 'r' }, switchRig()), []);

    const insideClosed = R.normalizeRecipe({ plan: [
      { id: 'p1', action: 'pour', atS: 0, volumeMl: 50, valve: 'closed', valveOpenAtS: 90 },
      { id: 'p2', action: 'pour', atS: 30, volumeMl: 50, valve: 'closed', valveOpenAtS: 60 },
    ] });
    eq('steep: "closed" on a pour already inside a steep does not start another',
      [at(insideClosed.plan, 1), 'closedForS' in insideClosed.plan[1], insideClosed.totalSteepS], [['closed', 1, 90], false, 90]);

    const two = R.normalizeRecipe({ plan: [
      { id: 'p1', action: 'pour', atS: 0, volumeMl: 50, valve: 'closed', valveOpenAtS: 30 },
      { id: 'p2', action: 'pour', atS: 45, volumeMl: 50, valve: 'closed', valveOpenAtS: 75 },
    ] });
    eq('steep: two separate steeps add up', [two.plan[1].valveClosedByStep, two.totalSteepS], [2, 60]);

    const noCutLongSteep = R.normalizeRecipe({ plan: [
      { id: 'p1', action: 'pour', atS: 0, volumeMl: 200, valve: 'closed', valveOpenAtS: 120 },
      { id: 'w', action: 'swirl', atS: 60, count: 1 },
    ] });
    eq('steep: with no cut, total time runs to when the valve opens', noCutLongSteep.targetTotalTimeS, 120);

    const msgs = plan => R.validateRecipe({ rigId: 'r', plan }, switchRig()).map(x => x.message);
    const unopened = [
      { id: 'p1', action: 'pour', atS: 0, volumeMl: 50, valve: 'closed' },
      { id: 'p2', action: 'pour', atS: 30, volumeMl: 50, valve: 'open' },
    ];
    eq('steep: closed with no open time is flagged', msgs(unopened), ['Step 1 (pour): valve closed — set when to open it']);
    eq('steep: …and covers only its own pour', at(R.normalizeRecipe({ plan: unopened }).plan, 1), ['open', null, null]);
    eq('steep: …and total steep is unknown, not 0', R.normalizeRecipe({ plan: unopened }).totalSteepS, null);
    eq('steep: open time before the pour is flagged',
      msgs([{ id: 'p1', action: 'pour', atS: 40, volumeMl: 50, valve: 'closed', valveOpenAtS: 30 }]),
      ['Step 1 (pour): open time (0:30) must be after the pour starts (0:40)']);
    eq('steep: cutting while the valve is closed is flagged',
      msgs([{ id: 'p1', action: 'pour', atS: 0, volumeMl: 50, valve: 'closed', valveOpenAtS: 200 }, { id: 'c', action: 'cut', atS: 150 }]),
      ['Step 2 (cut): the valve is still closed until 3:20 — nothing is draining yet']);
    eq('steep: drawdown cannot end before the valve opens',
      R.validateRecipe({ rigId: 'r', targetDrawdownEndS: 90, plan: [
        { id: 'p1', action: 'pour', atS: 0, volumeMl: 50, valve: 'closed', valveOpenAtS: 100 },
        { id: 'p2', action: 'pour', atS: 30, volumeMl: 50, valve: 'open' },
      ] }, switchRig()).map(x => x.message),
      ['Target drawdown end (1:30) must be after the valve opens (1:40).']);
  }

  // ---- recipe: migrating plans saved with release / steep steps ----
  {
    const y = yuanRecipe();
    const legacy = R.normalizeRecipe({ ...y, plan: legacyYuanPlan() });
    eq('migrate: old release step becomes pour 1 open time, identical to the new Yuan', JSON.stringify(legacy.plan), JSON.stringify(y.plan));
    eq('migrate: no release/steep steps survive', legacy.plan.some(a => a.action === 'release' || a.action === 'steep'), false);
    eq('migrate: old steep closes the pour before it, open at the steep end',
      R.migratePlan([{ id: 'a', action: 'pour', atS: 0, volumeMl: 200, valve: 'open' }, { id: 'b', action: 'steep', atS: 30, durationS: 90 }]),
      [{ id: 'a', action: 'pour', atS: 0, volumeMl: 200, valve: 'closed', valveOpenAtS: 120 }]);
    eq('migrate: a release with no closed pour is dropped',
      R.migratePlan([{ id: 'a', action: 'pour', atS: 0, volumeMl: 200, valve: 'open' }, { id: 'r', action: 'release', atS: 30 }]),
      [{ id: 'a', action: 'pour', atS: 0, volumeMl: 200, valve: 'open' }]);
    eq('migrate: an existing open time is not overwritten',
      R.migratePlan([{ id: 'a', action: 'pour', atS: 0, valve: 'closed', valveOpenAtS: 20 }, { id: 'r', action: 'release', atS: 30 }])[0].valveOpenAtS, 20);
    const raw = legacyYuanPlan();
    R.migratePlan(raw);
    eq('migrate: does not mutate the saved plan', [raw.length, 'valveOpenAtS' in raw[0]], [6, false]);
    eq('migrate: idempotent', JSON.stringify(R.migratePlan(R.migratePlan(legacyYuanPlan()))), JSON.stringify(R.migratePlan(legacyYuanPlan())));
  }

  // ---- recipe: rig capabilities (THE Step 4 check, logic half) ----
  {
    const y = yuanRecipe();
    eq('rig: Yuan on a Switch → valid', R.validateRecipe(y, switchRig()), []);
    eq('rig: Yuan on a Switch → no conflicts', R.rigConflicts(y.plan, switchRig()), []);

    const conflicts = R.rigConflicts(y.plan, v60Rig());
    eq('rig: Yuan → V60 refused on exactly the closed pour', conflicts.map(c => [c.step, c.action, c.fix]), [[1, 'pour', 'open-valve']]);
    eq('rig: conflict message says why', conflicts.map(c => c.message), ['Step 1 (pour): closed valve, but this rig has no valve']);
    eq('rig: fix text warns the steep is dropped', conflicts[0].fixText, 'pour step 1 with the valve open (its steep is dropped)');
    eq('rig: V60 validation surfaces the same problem', R.validateRecipe({ ...y, rigId: 'rig-seed-c40-v60' }, v60Rig()).length, 1);

    const adapted = R.adaptPlanToRig(y.plan, v60Rig());
    eq('rig: adapt keeps every step', adapted.map(a => a.id), ['s1', 's2', 's3', 's4', 's5']);
    eq('rig: adapt opens the valve and clears its open time', [adapted[0].valve, adapted[0].valveOpenAtS], ['open', null]);
    eq('rig: adapted plan has no conflicts and no steep',
      [R.rigConflicts(adapted, v60Rig()), R.normalizeRecipe({ plan: adapted }).totalSteepS], [[], 0]);
    eq('rig: adapt does not mutate the original', [y.plan[0].valve, y.plan[0].valveOpenAtS], ['closed', 40]);

    eq('rig: cut refused on an uncuttable, valve-less rig', R.rigConflicts(y.plan, model.createRig({ cuttable: false })).map(c => c.action), ['pour', 'cut']);
    eq('rig: open-valve pour is fine on a V60', R.rigConflicts([{ id: 'x', action: 'pour', valve: 'open' }], v60Rig()), []);
    eq('caps: step types are pour, swirl, cut', R.ALL_ACTIONS, ['pour', 'swirl', 'cut']);
    eq('caps: V60 and Switch offer the same step types',
      [model.allowedActions(v60Rig()), model.allowedActions(switchRig())], [['pour', 'swirl', 'cut'], ['pour', 'swirl', 'cut']]);
    eq('caps: uncuttable rig has no cut', model.allowedActions(model.createRig({ cuttable: false })), ['pour', 'swirl']);
    eq('caps: new rigs no longer carry "Can steep"', 'immersionCapable' in model.createRig(), false);
  }

  // ---- recipe: validation ----
  {
    const y = yuanRecipe();
    const msgs = recipe => R.validateRecipe(recipe, switchRig()).map(x => x.message);
    eq('validate: no rig', R.validateRecipe({ ...y, rigId: null }, undefined).map(x => x.message), ['Pick a rig.']);
    eq('validate: rig deleted', R.validateRecipe(y, undefined)[0].message, "This recipe's rig no longer exists. Pick another.");
    eq('validate: no pours', msgs({ ...y, plan: [{ id: 'x', action: 'swirl', atS: 0, count: 1 }] }), ['Add at least one pour.']);
    const outOfOrder = structuredClone(y); outOfOrder.plan[2].atS = 30;
    eq('validate: step earlier than the one above', msgs(outOfOrder), ['Step 3 (pour): starts before the step above it']);
    const bad = structuredClone(y);
    bad.plan[0].volumeMl = 0; bad.plan[1].tempC = 150; bad.plan[3].count = 1.5; bad.plan[4].atS = null;
    eq('validate: volume, temp, swirl count, time', msgs(bad), [
      'Step 1 (pour): volume missing',
      'Step 2 (pour): temperature must be 1–100 °C',
      'Step 4 (swirl): swirl count must be a whole number, 1 or more',
      'Step 5 (cut): time missing (seconds, or m:ss)',
    ]);
    eq('validate: equal times are allowed', msgs({ ...y, plan: y.plan.map(a => (a.id === 's2' ? { ...a, atS: 40 } : a)) }), []);
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
    afterCut.plan.push({ id: 's6', action: 'pour', atS: 160, volumeMl: 20, valve: 'open' });
    eq('cut: a step after the cut is flagged', msgs(afterCut), ['Step 6 (pour): comes after the cut — the dripper is already off']);
  }

  // ---- recipe: pour flow rate 1–10 ----
  {
    const y = yuanRecipe();
    const withFlow = flowRate => ({ ...y, plan: y.plan.map(a => (a.id === 's2' ? { ...a, flowRate } : a)) });
    const msgs = recipe => R.validateRecipe(recipe, switchRig()).map(x => x.message);
    eq('flow rate: optional — unset is fine', msgs(withFlow(null)), []);
    eq('flow rate: 1 and 10 are valid', [msgs(withFlow(1)), msgs(withFlow(10))], [[], []]);
    for (const bad of [0, 11, 5.5, -1]) {
      eq(`flow rate: ${bad} rejected`, msgs(withFlow(bad)), ['Step 2 (pour): flow rate must be a whole number 1–10']);
    }
    eq('flow rate: first pour starts unset', model.createAction('pour').flowRate, null);
    eq('flow rate: next pour inherits it', model.createAction('pour', [{ action: 'pour', atS: 0, flowRate: 7 }]).flowRate, 7);
    eq('flow rate: only pours carry it', 'flowRate' in model.createAction('swirl'), false);
    eq('flow rate: survives adapting to a V60', R.adaptPlanToRig(withFlow(4).plan, v60Rig()).find(a => a.id === 's2').flowRate, 4);
  }

  // ---- recipe: clock ----
  eq('clock: seconds', R.parseClock('45'), 45);
  eq('clock: m:ss', R.parseClock('1:05'), 65);
  eq('clock: m.ss (phone number pad)', R.parseClock('2.30'), 150);
  eq('clock: whitespace', R.parseClock(' 0:40 '), 40);
  // Digits only (number pad, no ':' key): last two digits are seconds
  eq('clock digits: 1–2 digits are seconds', [R.parseClock('5'), R.parseClock('45'), R.parseClock('90')], [5, 45, 90]);
  eq('clock digits: 130 → 1:30', R.parseClock('130'), 90);
  eq('clock digits: 300 → 3:00', R.parseClock('300'), 180);
  eq('clock digits: 1000 → 10:00', R.parseClock('1000'), 600);
  eq('clock digits: leading zeros ok (040, 0045)', [R.parseClock('040'), R.parseClock('0045')], [40, 45]);
  eq('clock digits: 190 rejected (90 is not valid seconds)', R.parseClock('190'), null);
  eq('clock digits: back to digits for editing', [R.clockDigits(0), R.clockDigits(40), R.clockDigits(90), R.clockDigits(600), R.clockDigits(null)], ['0', '40', '130', '1000', '']);
  eq('clock digits: round-trip 0..1200 s', Array.from({ length: 1201 }, (_, s) => s).every(s => R.parseClock(R.clockDigits(s)) === s), true);
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
    eq('version: fork keeps the plan, steep included',
      [v2.plan.map(a => a.cumulativeMl ?? null), v2.plan[0].valveOpenAtS], [y.plan.map(a => a.cumulativeMl ?? null), 40]);
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
    eq('model: first step at 0:00, valve open, no open time', [plan[0].atS, plan[0].valve, plan[0].valveOpenAtS], [0, 'open', null]);
    plan[0].tempC = 88; plan[0].style = 'spiral';
    const next = model.createAction('pour', plan);
    eq('model: next pour inherits temp + style, +30 s', [next.atS, next.tempC, next.style, next.valve], [30, 88, 'spiral', 'open']);
    eq('model: step after a steep starts from its open time',
      model.createAction('pour', [{ action: 'pour', atS: 0, valve: 'closed', valveOpenAtS: 40 }]).atS, 70);
    eq('model: step ids unique', model.createAction('cut').id !== model.createAction('cut').id, true);
  }

  // ================= timeline.js =================
  {
    const pour = (atS, extra = {}) => ({ type: 'pour', atS, volumeMl: 50, valve: 'open', ...extra });
    const valve = (atS, state) => ({ type: 'valve', atS, state, trigger: 'test' });
    const end = (type, atS) => ({ type, atS });
    const v60Events = last => [pour(0), pour(45, { volumeMl: 100 }), pour(80, { volumeMl: 60 }), ...(last ? [last] : [])];
    const v60Plan = (extra = {}) => R.normalizeRecipe(model.createRecipe({
      id: 'recipe-v60', rigId: 'rig-seed-c40-v60', doseG: 15, targetDrawdownEndS: 180,
      plan: [
        { id: 'a', action: 'pour', atS: 0, volumeMl: 50, valve: 'open' },
        { id: 'b', action: 'pour', atS: 45, volumeMl: 100, valve: 'open' },
        { id: 'c', action: 'pour', atS: 80, volumeMl: 60, valve: 'open' },
      ],
      ...extra,
    }));
    const sumPhases = seg => Object.values(seg.phases).reduce((t, v) => t + v, 0);
    const flags = drift => Object.fromEntries(Object.entries(drift.phases).map(([k, v]) => [k, v.flag]));

    // ---- THE FIVE PLAN CHECKS ----

    // 1. V60 (no valve events) → exactly bloom, percolation, drawdown. No steep key, not even null.
    const t1 = T.segmentTimeline(v60Events(end('drawdown-complete', 180)));
    eq('timeline #1: V60 → exactly bloom, percolation, drawdown', Object.keys(t1.phases), ['bloom', 'percolation', 'drawdown']);
    eq('timeline #1: no steep key, not even null', ['steep' in t1.phases, 'lock' in t1.phases], [false, false]);
    eq('timeline #1: bloom 0:45 · percolation 0:35 · drawdown 1:40', [t1.phases.bloom, t1.phases.percolation, t1.phases.drawdown], [45, 35, 100]);

    // 2. Two separate steeps → durations sum
    const t2Events = [pour(0, { valve: 'closed' }), valve(30, 'open'), pour(45, { valve: 'closed' }), valve(75, 'open'), pour(90), end('drawdown-complete', 150)];
    const t2 = T.segmentTimeline(t2Events, [{ closeAtS: 0 }, { closeAtS: 45 }]);
    eq('timeline #2: two steeps (0:30 + 0:30) sum to 1:00', t2.phases.steep, 60);
    eq('timeline #2: both closures are steeps', t2.closures.map(c => [c.kind, c.durationS]), [['steep', 30], ['steep', 30]]);
    eq('timeline #2: open gaps are bloom / percolation / drawdown', [t2.phases.bloom, t2.phases.percolation, t2.phases.drawdown], [15, 15, 60]);

    // 3. Same raw events: planned closure → steep, unplanned → lock
    const t3Events = [pour(0), pour(30), pour(60), valve(70, 'closed'), { type: 'swirl', atS: 72, count: 1 }, valve(80, 'open'), end('drawdown-complete', 150)];
    const t3Copy = JSON.stringify(t3Events);
    const t3Planned = T.segmentTimeline(t3Events, [{ closeAtS: 68 }]);
    const t3Live = T.segmentTimeline(t3Events, []);
    eq('timeline #3: planned closure → steep', [t3Planned.phases.steep, 'lock' in t3Planned.phases], [10, false]);
    eq('timeline #3: same events, unplanned → lock', [t3Live.phases.lock, 'steep' in t3Live.phases], [10, false]);
    eq('timeline #3: the raw events were not changed', JSON.stringify(t3Events), t3Copy);

    // 4 & 5. Same numbers, different meaning: drawdown planned to 3:00, brew ends at 2:30
    const plan45 = v60Plan();
    const t4 = T.analyzeBrew(plan45, v60Events(end('cut', 150)));
    const t5 = T.analyzeBrew(plan45, v60Events(end('drawdown-complete', 150)));
    eq('timeline #4/#5: both drawdowns are 1:10 against a planned 1:40', [t4.phases.drawdown, t5.phases.drawdown, t4.plannedPhases.drawdown], [70, 70, 100]);
    eq('timeline #4: cut at 2:30 → endedBy cut', t4.endedBy, 'cut');
    eq('timeline #4: cut → NO drawdown drift flag', [t4.drift.phases.drawdown.flag, t4.drift.phases.drawdown.exempt, t4.drift.phases.drawdown.deltaS], [null, 'cut', -30]);
    eq('timeline #4: cut → no short/long flag anywhere', Object.values(t4.drift.phases).concat(t4.drift.total).some(d => d.flag === 'short' || d.flag === 'long'), false);
    eq('timeline #5: natural finish at 2:30 → endedBy drawdown', t5.endedBy, 'drawdown');
    eq('timeline #5: → drawdown SHORT by 0:30', [t5.drift.phases.drawdown.flag, t5.drift.phases.drawdown.deltaS], ['short', -30]);
    eq('timeline #5: → total short too', t5.drift.total.flag, 'short');

    // ---- the plan as a timeline ----
    const yuan = yuanRecipe();
    const yuanPlan = T.planToTimeline(yuan);
    eq('plan→timeline: Yuan events', yuanPlan.events.map(e => `${e.type}${e.valve === 'closed' ? '(closed)' : ''}@${e.atS}`),
      ['pour(closed)@0', 'valve@40', 'pour@45', 'pour@80', 'swirl@110', 'cut@150']);
    eq('plan→timeline: Yuan has one planned closure 0:00–0:40', yuanPlan.closures, [{ closeAtS: 0, openAtS: 40 }]);
    const yuanPlanned = T.segmentTimeline(yuanPlan.events, yuanPlan.closures);
    eq('plan→timeline: Yuan planned phases', yuanPlanned.phases, { bloom: 5, percolation: 35, steep: 40, drawdown: 70 });
    eq('plan→timeline: Yuan segments in order',
      yuanPlanned.segments.map(s => `${s.phase} ${s.startS}-${s.endS}`), ['steep 0-40', 'bloom 40-45', 'percolation 45-80', 'drawdown 80-150']);
    eq('plan→timeline: no drawdown target and no cut → planned drawdown unknown',
      T.segmentTimeline(T.planToTimeline(v60Plan({ targetDrawdownEndS: null })).events).phases.drawdown, null);

    // ---- a realistic Yuan brew ----
    const yuanActual = [pour(0, { valve: 'closed' }), valve(43, 'open'), pour(47), pour(83), { type: 'swirl', atS: 112, count: 1 }, end('cut', 152)];
    const ya = T.analyzeBrew(yuan, yuanActual);
    eq('yuan brew: phases', ya.phases, { bloom: 4, percolation: 36, steep: 43, drawdown: 69 });
    eq('yuan brew: a few seconds off everywhere → all on', flags(ya.drift), { bloom: 'on', percolation: 'on', steep: 'on', drawdown: 'on' });
    eq('yuan brew: total 2:32 vs 2:30 → on', [ya.drift.total.deltaS, ya.drift.total.flag], [2, 'on']);

    const withLock = [...yuanActual.slice(0, 4), valve(100, 'closed'), valve(108, 'open'), ...yuanActual.slice(4)];
    const yl = T.analyzeBrew(yuan, withLock);
    eq('live lock: a mid-drawdown closure is a lock, the planned one still a steep', yl.closures.map(c => c.kind), ['steep', 'lock']);
    eq('live lock: 0:08 lock carved out of drawdown', [yl.phases.lock, yl.phases.drawdown], [8, 61]);
    eq('live lock: never judged as drift', [yl.drift.phases.lock.flag, yl.drift.phases.lock.exempt, yl.drift.phases.lock.actualS], [null, 'live', 8]);

    // ---- steep matching ----
    const closeAt = x => T.segmentTimeline([pour(0), pour(30), valve(x, 'closed'), valve(x + 10, 'open'), pour(90), end('drawdown-complete', 150)], [{ closeAtS: 0 }]).closures[0].kind;
    eq('match: closure 0:12 after a planned one → steep', closeAt(12), 'steep');
    eq('match: closure 0:15 after → steep (window edge)', closeAt(15), 'steep');
    eq('match: closure 0:20 after → lock', closeAt(20), 'lock');
    eq('match: one planned closure claims only one actual closure',
      T.segmentTimeline([pour(0, { valve: 'closed' }), valve(5, 'open'), valve(8, 'closed'), valve(12, 'open'), pour(30), end('drawdown-complete', 90)], [{ closeAtS: 0 }]).closures.map(c => c.kind),
      ['steep', 'lock']);
    eq('match: no recipe → every closure is a lock', T.analyzeBrew(null, t2Events).closures.map(c => c.kind), ['lock', 'lock']);

    // ---- valve edge cases ----
    const neverOpened = T.segmentTimeline([pour(0, { valve: 'closed' }), pour(30), end('cut', 100)], [{ closeAtS: 0 }]);
    eq('valve: closed and never reopened → steep until the cut', [neverOpened.phases, neverOpened.closures[0].durationS], [{ steep: 100 }, 100]);
    const immersion = T.segmentTimeline([pour(0, { valve: 'closed', volumeMl: 200 }), valve(120, 'open'), end('drawdown-complete', 180)], [{ closeAtS: 0 }]);
    eq('valve: single-pour immersion → steep 2:00, drawdown 1:00, no bloom', immersion.phases, { steep: 120, drawdown: 60 });
    const preClosed = T.segmentTimeline([valve(-5, 'closed'), pour(0, { valve: 'closed' }), valve(30, 'open'), pour(45), end('drawdown-complete', 120)], [{ closeAtS: 0 }]);
    eq('valve: closed before the first pour → steep counted from the pour', preClosed.phases, { bloom: 15, steep: 30, drawdown: 75 });
    // Pour 2 lands inside the steep, so there is no open-valve time before pour 2 → no bloom.
    eq('valve: an "open" pour inside a steep does not open the valve',
      T.segmentTimeline([pour(0, { valve: 'closed' }), pour(20, { valve: 'open' }), valve(60, 'open'), pour(70), end('drawdown-complete', 130)], [{ closeAtS: 0 }]).phases,
      { percolation: 10, steep: 60, drawdown: 60 });

    // ---- ends ----
    const both = (a, b) => T.segmentTimeline([...v60Events(), a, b]);
    eq('end: drawdown-complete before cut → ended by drawdown', [both(end('drawdown-complete', 140), end('cut', 150)).endedBy, both(end('drawdown-complete', 140), end('cut', 150)).totalS], ['drawdown', 140]);
    eq('end: cut before drawdown-complete → ended by cut', [both(end('cut', 130), end('drawdown-complete', 140)).endedBy, both(end('cut', 130), end('drawdown-complete', 140)).totalS], ['cut', 130]);
    const running = T.segmentTimeline(v60Events());
    eq('end: no end yet → incomplete, drawdown still running (null)', [running.complete, running.endedBy, running.totalS, running.phases], [false, null, null, { bloom: 45, percolation: 35, drawdown: null }]);
    eq('end: running brew → drawdown not judged', (() => { const d = T.analyzeBrew(plan45, v60Events()).drift; return [d.phases.drawdown.flag, d.phases.bloom.flag, d.total.flag]; })(), [null, 'on', null]);
    const afterEnd = T.segmentTimeline([...v60Events(end('drawdown-complete', 180)), pour(200)]);
    eq('end: taps after the end are ignored', [afterEnd.phases, afterEnd.ignoredAfterEnd], [t1.phases, 1]);

    // ---- pour counts ----
    eq('pours: one pour → drawdown only', T.segmentTimeline([pour(0), end('drawdown-complete', 60)]).phases, { drawdown: 60 });
    eq('pours: two pours → bloom + drawdown', T.segmentTimeline([pour(0), pour(30), end('drawdown-complete', 100)]).phases, { bloom: 30, drawdown: 70 });
    const noPours = T.segmentTimeline([end('cut', 10)]);
    eq('pours: none → no phases, incomplete', [noPours.phases, noPours.complete, noPours.totalS], [{}, false, null]);

    // ---- robustness ----
    const shuffled = [end('drawdown-complete', 180), pour(80, { volumeMl: 60 }), pour(0), null, { type: 'pour', atS: 'x' }, pour(45, { volumeMl: 100 })];
    const sh = T.segmentTimeline(shuffled);
    eq('robust: taps in any order give the same phases', sh.phases, t1.phases);
    eq('robust: unreadable taps are counted, not used', sh.ignored, 2);
    eq('robust: not a timeline → empty', T.segmentTimeline(undefined).phases, {});

    // ---- phases always add up to the total ----
    for (const [name, seg] of [['V60', t1], ['two steeps', t2], ['lock', t3Live], ['Yuan plan', yuanPlanned], ['Yuan with lock', T.segmentTimeline(withLock, yuanPlan.closures)], ['pre-closed', preClosed]]) {
      eq(`invariant: ${name} phases sum to total`, sumPhases(seg), seg.totalS);
    }

    // ---- drift rules ----
    const P = { phases: { bloom: 45, drawdown: 100 }, totalS: 145 };
    const A = (bloom, drawdown, extra = {}) => ({ phases: { bloom, drawdown }, totalS: bloom + drawdown, endedBy: 'drawdown', ...extra });
    eq('drift: bloom +5 is on, drawdown +10 is on (tolerance edges)', flags(T.phaseDrift(P, A(50, 110))), { bloom: 'on', drawdown: 'on' });
    eq('drift: bloom +6 is long, drawdown −11 is short', flags(T.phaseDrift(P, A(51, 89))), { bloom: 'long', drawdown: 'short' });
    eq('drift: total +15 is long', T.phaseDrift(P, A(50, 110)).total.flag, 'long');
    eq('drift: custom tolerance', flags(T.phaseDrift(P, A(51, 89), { phaseS: 10, drawdownS: 15 })), { bloom: 'on', drawdown: 'on' });
    eq('drift: a cut exempts SHORT drawdown only — LONG is still flagged', [
      T.phaseDrift(P, A(45, 80, { endedBy: 'cut' })).phases.drawdown.flag,
      T.phaseDrift(P, A(45, 130, { endedBy: 'cut' })).phases.drawdown.flag,
    ], [null, 'long']);
    eq('drift: phase only in the actual counts as planned 0', T.phaseDrift(P, { phases: { bloom: 45, percolation: 20, drawdown: 100 }, totalS: 165, endedBy: 'drawdown' }).phases.percolation,
      { planS: 0, actualS: 20, deltaS: 20, flag: 'long', exempt: null });
    eq('drift: phase only in the plan counts as actual 0', T.phaseDrift({ phases: { bloom: 45, steep: 30, drawdown: 100 }, totalS: 175 }, A(45, 100)).phases.steep.flag, 'short');
    eq('drift: no plan → nothing judged', Object.values(T.phaseDrift(null, A(45, 100)).phases).every(d => d.flag === null), true);
    eq('drift: plan without a drawdown target → drawdown and total not judged', (() => {
      const d = T.analyzeBrew(v60Plan({ targetDrawdownEndS: null }), v60Events(end('drawdown-complete', 180))).drift;
      return [d.phases.drawdown.flag, d.phases.drawdown.planS, d.total.flag, d.phases.bloom.flag];
    })(), [null, null, null, 'on']);
    eq('drift: planned cut 2:30, natural finish at 2:10 → short (not exempt: no cut happened)',
      T.analyzeBrew(v60Plan({ plan: [...v60Plan().plan, { id: 'x', action: 'cut', atS: 150 }] }), v60Events(end('drawdown-complete', 130))).drift.phases.drawdown.flag, 'short');
    eq('drift: finish at 3:20 against 3:00 → long', T.analyzeBrew(plan45, v60Events(end('drawdown-complete', 200))).drift.phases.drawdown.flag, 'long');
    eq('drift: DEFAULT_TOLERANCE is ±5 / ±10 / ±10 and frozen', [T.DEFAULT_TOLERANCE, Object.isFrozen(T.DEFAULT_TOLERANCE)], [{ phaseS: 5, drawdownS: 10, totalS: 10 }, true]);

    // ---- purity ----
    const recipeCopy = JSON.stringify(yuan);
    const eventsCopy = JSON.stringify(withLock);
    T.analyzeBrew(yuan, withLock);
    eq('pure: analyzeBrew does not mutate the recipe or the timeline', [JSON.stringify(yuan) === recipeCopy, JSON.stringify(withLock) === eventsCopy], [true, true]);
  }

  // ================= coach.js (scheduler) =================
  {
    const switchR = switchRig();
    const v60R = v60Rig();
    const recipeOf = (plan, extra = {}) => R.normalizeRecipe(model.createRecipe({ rigId: 'r', plan, ...extra }));
    const p = (id, atS, extra = {}) => ({ id, action: 'pour', atS, volumeMl: 50, valve: 'open', ...extra });
    const fires = s => s.events.filter(e => e.kind === 'fire');
    const cues = s => s.events.filter(e => e.kind === 'cue');
    const buzzes = s => s.events.flatMap(e => (e.kind === 'cue' ? e.ticks.map(t => t.atS) : [e.atS])).sort((a, b) => a - b);

    // ---- THE PLAN CHECK: actions 2 s apart produce no double-cue stutter ----
    {
      const s = C.schedule(recipeOf([p('a', 0), p('b', 2), p('c', 4)]), { rig: v60R, cueLeadS: 3 });
      eq('stutter: one fire per step', fires(s).map(f => f.atS), [0, 2, 4]);
      eq('stutter: at most one cue per step', cues(s).map(c => c.fireAtS), [0, 2, 4]);
      eq('stutter: a cue never starts before the previous step fires', cues(s).map(c => c.atS), [-3, 0, 2]);
      // Steps 2 and 3 show 2 → 1 on screen, but "2" lands on the previous fire, which already buzzed.
      eq('stutter: buzz ticks are 3-2-1, then 1, then 1', cues(s).map(c => c.ticks.map(t => t.n)), [[3, 2, 1], [1], [1]]);
      eq('stutter: the screen still counts 2 → 1 before steps 2 and 3', [C.stateAt(s, 0.5).countdown, C.stateAt(s, 1.5).countdown, C.stateAt(s, 2.5).countdown], [2, 1, 2]);
      const b = buzzes(s);
      eq('stutter: every buzz is at a distinct moment, ≥1 s apart', b.every((t, i) => i === 0 || t - b[i - 1] >= 1 - 1e-9), true);
      eq('stutter: no two cue windows overlap', cues(s).every((c, i, all) => i === 0 || c.atS >= all[i - 1].fireAtS), true);
      // Sample the countdown every 0.1 s: between two fires it never jumps back up.
      let ok = true;
      let prev = null;
      for (let t = -3; t <= 4.001; t += 0.1) {
        const st = C.stateAt(s, t);
        if (st.last && prev && st.last.atS !== prev.lastAt) prev = null;   // a fire resets the countdown
        if (st.countdown !== null && prev && prev.countdown !== null && st.countdown > prev.countdown) ok = false;
        prev = { countdown: st.countdown, lastAt: st.last?.atS ?? null };
      }
      eq('stutter: sampled countdown never counts back up before its fire', ok, true);
    }
    {
      const s = C.schedule(recipeOf([p('a', 0), p('b', 0.5)]), { rig: v60R });
      eq('stutter: less than 1 s of warning → no countdown, just the fire', [cues(s).length, fires(s).length], [1, 2]);
    }

    // ---- Yuan ----
    {
      const s = C.schedule(yuanRecipe(), { rig: switchR });
      eq('yuan: fires in order with the right words', fires(s).map(f => `${f.atS} ${f.label}`),
        ['0 CLOSE VALVE + POUR', '40 OPEN VALVE', '45 POUR', '80 POUR', '110 SWIRL ×1', '150 LIFT DRIPPER']);
      eq('yuan: countdown starts, lead 3 s', cues(s).map(c => c.atS), [-3, 37, 42, 77, 107, 147]);
      eq('yuan: OPEN VALVE (0:40) then POUR (0:45): pour gets a full 3-2-1 from 0:42', cues(s)[2].ticks, [{ atS: 42, n: 3 }, { atS: 43, n: 2 }, { atS: 44, n: 1 }]);
      eq('yuan: pre-roll starts 3 s before the first pour', [s.startS, s.endS], [-3, 150]);
      const pours = fires(s).flatMap(f => f.actions).filter(a => a.type === 'pour');
      eq('yuan: pour cues carry what the scale should read', pours.map(a => [a.volumeMl, a.cumulativeMl, a.tempC, a.valve]), [[50, 50, 92, 'closed'], [100, 150, 92, 'open'], [60, 210, 84, 'open']]);
      eq('yuan: nothing skipped', s.skipped, []);
    }

    // ---- same second → one cue ----
    {
      const r = recipeOf([p('a', 0, { valve: 'closed', valveOpenAtS: 45 }), p('b', 45)]);
      const s = C.schedule(r, { rig: switchR });
      eq('same second: OPEN VALVE + POUR is one fire', fires(s).map(f => f.label), ['CLOSE VALVE + POUR', 'OPEN VALVE + POUR']);
      eq('same second: and one cue', cues(s).length, 2);
    }

    // ---- rig capabilities ----
    {
      const yuanOnV60 = C.schedule(yuanRecipe(), { rig: v60R });
      eq('rig: no valve → no CLOSE VALVE, no OPEN VALVE', fires(yuanOnV60).map(f => f.label), ['POUR', 'POUR', 'POUR', 'SWIRL ×1', 'LIFT DRIPPER']);
      eq('rig: no valve → pours carry no valve state', fires(yuanOnV60).flatMap(f => f.actions).filter(a => a.type === 'pour').map(a => a.valve), [null, null, null]);
      eq('rig: the ignored closure is reported', yuanOnV60.skipped, [{ seq: 1, reason: 'valve closure ignored: rig has no valve' }]);
      const uncut = C.schedule(yuanRecipe(), { rig: model.createRig({ valveCapable: true, cuttable: false }) });
      eq('rig: uncuttable → no LIFT DRIPPER', fires(uncut).some(f => f.label.includes('LIFT DRIPPER')), false);
      eq('rig: uncuttable → the cut is reported skipped', uncut.skipped, [{ seq: 5, reason: "rig can't be cut" }]);
      // Agreement with recipe.js: the coach never cues a step type the rig doesn't allow
      for (const [name, rig] of [['V60', v60R], ['Switch', switchR], ['uncuttable', model.createRig({ cuttable: false })]]) {
        const allowed = new Set([...R.allowedActions(rig), ...(rig.valveCapable ? ['open-valve'] : [])]);
        eq(`rig: coach agrees with allowedActions (${name})`, C.plannedActions(yuanRecipe(), rig).actions.every(a => allowed.has(a.type)), true);
      }
    }

    // ---- lead time ----
    {
      const r = recipeOf([p('a', 0), p('b', 30)], { cueLeadS: 5 });
      eq('lead: recipe cue lead is used', [C.schedule(r, { rig: v60R }).cueLeadS, cues(C.schedule(r, { rig: v60R }))[1].atS], [5, 25]);
      eq('lead: an explicit setting overrides the recipe', C.schedule(r, { rig: v60R, cueLeadS: 2 }).cueLeadS, 2);
      eq('lead: 0 turns countdowns off', [cues(C.schedule(r, { rig: v60R, cueLeadS: 0 })).length, fires(C.schedule(r, { rig: v60R, cueLeadS: 0 })).length], [0, 2]);
      eq('lead: invalid falls back to 3', C.schedule(recipeOf([p('a', 0)], { cueLeadS: -1 }), { rig: v60R, cueLeadS: 'x' }).cueLeadS, 3);
    }

    // ---- defensive ----
    {
      const s = C.schedule(recipeOf([p('a', 0), { id: 'c', action: 'cut', atS: 60 }, p('b', 90)]), { rig: v60R });
      eq('defensive: nothing after the cut', [fires(s).map(f => f.label), s.skipped], [['POUR', 'LIFT DRIPPER'], [{ seq: 3, reason: 'after the cut' }]]);
      const noTime = C.schedule(recipeOf([p('a', 0), p('b', null)]), { rig: v60R });
      eq('defensive: a step with no time is skipped and reported', [fires(noTime).length, noTime.skipped], [1, [{ seq: 2, reason: 'no time' }]]);
      const outOfOrder = C.schedule(recipeOf([p('a', 30), p('b', 0)]), { rig: v60R });
      eq('defensive: steps out of order are cued in time order', fires(outOfOrder).map(f => f.atS), [0, 30]);
      eq('defensive: empty or missing recipe → empty schedule', [C.schedule(null).events, C.schedule(recipeOf([])).events], [[], []]);
    }

    // ---- stateAt ----
    {
      const s = C.schedule(yuanRecipe(), { rig: switchR });
      const at = t => { const st = C.stateAt(s, t); return [st.next?.label ?? null, st.countdown, st.last?.label ?? null, st.done]; };
      eq('state: -3 s → counting 3 to CLOSE VALVE + POUR', at(-3), ['CLOSE VALVE + POUR', 3, null, false]);
      eq('state: -0.4 s → 1', at(-0.4)[1], 1);
      eq('state: at 0:00 the pour has fired, next is OPEN VALVE, no countdown yet', at(0), ['OPEN VALVE', null, 'CLOSE VALVE + POUR', false]);
      eq('state: 0:38.5 → 2 to OPEN VALVE', at(38.5), ['OPEN VALVE', 2, 'CLOSE VALVE + POUR', false]);
      eq('state: 0:20 → seconds to next', C.stateAt(s, 20).secondsToNext, 20);
      eq('state: after the cut → done', at(151), [null, null, 'LIFT DRIPPER', true]);
    }

    // ---- buzzesBetween (what the adapter signals each frame) ----
    {
      const s = C.schedule(yuanRecipe(), { rig: switchR });
      const all = C.buzzesBetween(s, -Infinity, Infinity);
      eq('buzz: Yuan has 6 fires and 18 ticks', [all.filter(b => b.type === 'fire').length, all.filter(b => b.type === 'tick').length], [6, 18]);
      // 60 fps frames with jitter: every buzz exactly once, in order
      const got = [];
      let t = -4;
      let i = 0;
      while (t < 152) {
        const next = t + 0.016 + ((i++ * 7) % 5) * 0.003;
        got.push(...C.buzzesBetween(s, t, next));
        t = next;
      }
      eq('buzz: uneven 60 fps frames signal every moment exactly once', JSON.stringify(got), JSON.stringify(all));
      eq('buzz: a frame boundary landing exactly on a buzz does not repeat it', [C.buzzesBetween(s, 39, 40).length, C.buzzesBetween(s, 40, 41).length], [1, 0]);
      eq('buzz: a long gap (screen off 0:30→0:50) returns everything missed, in order',
        C.buzzesBetween(s, 30, 50).map(b => `${b.atS}${b.type === 'tick' ? `:${b.n}` : '!'}`), ['37:3', '38:2', '39:1', '40!', '42:3', '43:2', '44:1', '45!']);
    }

    // ---- purity ----
    {
      const y = yuanRecipe();
      const copy = JSON.stringify(y);
      C.schedule(y, { rig: switchR });
      eq('pure: schedule does not mutate the recipe', JSON.stringify(y), copy);
    }
  }

  // ================= pour done (timeline.js) =================
  {
    const pour = (atS, extra = {}) => ({ type: 'pour', atS, volumeMl: 50, valve: 'open', ...extra });
    const v60 = [pour(0), pour(45), pour(80)];
    const base = T.segmentTimeline([...v60, { type: 'drawdown-complete', atS: 180 }]);
    const withDone = T.segmentTimeline([...v60, { type: 'pour-done', atS: 95 }, { type: 'drawdown-complete', atS: 180 }]);
    eq('pour done: drawdown starts when pouring stopped (1:35), pouring time is percolation',
      [withDone.phases, withDone.pourDoneUsed, withDone.lastPourEndS], [{ bloom: 45, percolation: 50, drawdown: 85 }, true, 95]);
    eq('pour done: without it, drawdown starts at the pour start', [base.phases.drawdown, base.pourDoneUsed], [100, false]);
    eq('pour done: usePourDone:false ignores it', T.segmentTimeline([...v60, { type: 'pour-done', atS: 95 }, { type: 'drawdown-complete', atS: 180 }], [], { usePourDone: false }).phases, base.phases);
    eq('pour done: on an earlier pour changes nothing',
      T.segmentTimeline([pour(0), { type: 'pour-done', atS: 10 }, pour(45), pour(80), { type: 'drawdown-complete', atS: 180 }]).phases, base.phases);
    eq('pour done: single pour → percolation while pouring, then drawdown',
      T.segmentTimeline([pour(0), { type: 'pour-done', atS: 20 }, { type: 'drawdown-complete', atS: 90 }]).phases, { percolation: 20, drawdown: 70 });
    eq('pour done: after the end is ignored',
      T.segmentTimeline([...v60, { type: 'cut', atS: 120 }, { type: 'pour-done', atS: 125 }]).pourDoneUsed, false);
    eq('pour done: phases still sum to the total', Object.values(withDone.phases).reduce((a, b) => a + b, 0), withDone.totalS);

    const plan = R.normalizeRecipe(model.createRecipe({ rigId: 'r', targetDrawdownEndS: 180, plan: [
      { id: 'a', action: 'pour', atS: 0, volumeMl: 50, valve: 'open' },
      { id: 'b', action: 'pour', atS: 45, volumeMl: 100, valve: 'open' },
      { id: 'c', action: 'pour', atS: 80, volumeMl: 60, valve: 'open' },
    ] }));
    const aDone = T.analyzeBrew(plan, [...v60, { type: 'pour-done', atS: 95 }, { type: 'drawdown-complete', atS: 180 }]);
    const aPlain = T.analyzeBrew(plan, [...v60, { type: 'drawdown-complete', atS: 180 }]);
    eq('pour done: the result shows the real drawdown (1:25)', aDone.phases.drawdown, 85);
    eq('pour done: drift compares like with like, so it is NOT flagged short by the pouring time',
      [aDone.drift.phases.drawdown.flag, aDone.drift.phases.drawdown.deltaS], ['on', 0]);
    eq('pour done: drift is identical with or without the tap', JSON.stringify(aDone.drift), JSON.stringify(aPlain.drift));
  }

  // ================= taps (coach.js) =================
  {
    const switchR = switchRig();
    const yuan = yuanRecipe();
    const sched = C.schedule(yuan, { rig: switchR });
    const label = (tl, t) => C.expectedTap(sched, tl, t).label;

    // A whole Yuan brew, press by press
    let tl = [];
    const press = (t, expectLabel, which = 'main') => {
      if (which === 'main') eq(`tap @${t}: button says ${expectLabel}`, label(tl, t), expectLabel);
      tl = C.applyTap(sched, tl, t, which);
    };
    eq('tap: before anything, the button is the first step', label([], -3), 'CLOSE VALVE + POUR');
    press(0.4, 'CLOSE VALVE + POUR');
    eq('tap: the closing pour is stamped closed, with its plan time', [tl[0].type, tl[0].valve, tl[0].atS, tl[0].plannedAtS, tl[0].fire, tl[0].tap], ['pour', 'closed', 0.4, 0, 0, 1]);
    press(12, 'POUR DONE');
    eq('tap: after POUR DONE the next step waits for its countdown', label(tl, 20), 'OPEN VALVE');
    press(40.2, 'OPEN VALVE');
    press(45, 'POUR');
    eq('tap: POUR DONE offered while pouring…', label(tl, 60), 'POUR DONE');
    eq('tap: …and skipped once the next countdown starts (0:77)', label(tl, 77.5), 'POUR');
    press(79.5, 'POUR');   // pour done skipped
    press(94, 'POUR DONE');
    press(100, '', 'valve');   // live close
    eq('tap: live valve close is stamped as live', [tl[tl.length - 1].type, tl[tl.length - 1].state, tl[tl.length - 1].trigger], ['valve', 'closed', 'live']);
    press(104, '', 'valve');   // live open
    press(111, 'SWIRL ×1');
    press(150.3, 'LIFT DRIPPER');
    eq('tap: after the cut, the button is DONE', label(tl, 151), 'DONE');
    const frozen = JSON.stringify(tl);
    eq('tap: presses after the end change nothing', JSON.stringify(C.applyTap(sched, tl, 160)), frozen);

    // Who closed the valve decides whether the live valve button may appear
    const closedByAt = n => C.tapState(sched, tl.filter(e => e.tap <= n)).valveClosedBy;
    eq('valve: after CLOSE VALVE + POUR it is closed by the plan', closedByAt(1), 'planned');
    eq('valve: OPEN VALVE clears it', closedByAt(3), null);
    eq('valve: a live close is closed by "live"', closedByAt(7), 'live');
    eq('valve: releasing the lock clears it', closedByAt(8), null);

    const st = C.tapState(sched, tl);
    eq('tap: state after the brew', [st.ended, st.endedBy, st.fireIndex, st.pourOpen, st.valve], [true, 'cut', 6, false, 'open']);
    const a = T.analyzeBrew(yuan, tl);
    eq('tap: the tapped timeline analyses cleanly', [a.endedBy, a.closures.map(c => c.kind), a.pourDoneUsed], ['cut', ['steep', 'lock'], true]);
    eq('tap: real drawdown from POUR DONE (1:34) minus the 4 s lock', a.phases.drawdown, 150.3 - 94 - 4);
    near('tap: steep 0:39.8 (tapped 0:00.4 → 0:40.2)', a.drift.phases.steep.actualS, 39.8, 1e-6);
    eq('tap: steep → on', a.drift.phases.steep.flag, 'on');
    eq('tap: per-step timing vs plan', C.tapDrift(sched, tl).map(d => `${d.label} ${d.deltaS}`),
      ['CLOSE VALVE + POUR 0.4', 'OPEN VALVE 0.2', 'POUR 0', 'POUR -0.5', 'SWIRL ×1 1', 'LIFT DRIPPER 0.3']);

    // Undo
    const beforeSwirl = C.undoTap(C.undoTap(tl));   // drop LIFT DRIPPER, then SWIRL
    eq('undo: removes one press at a time', [label(beforeSwirl, 111), C.tapState(sched, beforeSwirl).ended], ['SWIRL ×1', false]);
    const merged = R.normalizeRecipe(model.createRecipe({ rigId: 'r', plan: [
      { id: 'a', action: 'pour', atS: 0, volumeMl: 50, valve: 'closed', valveOpenAtS: 45 },
      { id: 'b', action: 'pour', atS: 45, volumeMl: 100, valve: 'open' },
    ] }));
    const ms = C.schedule(merged, { rig: switchR });
    let mt = C.applyTap(ms, [], 0);
    mt = C.applyTap(ms, mt, 45);
    eq('merged: OPEN VALVE + POUR is one press → valve then pour, same time', mt.slice(1).map(e => `${e.type}@${e.atS}#${e.tap}`), ['valve@45#2', 'pour@45#2']);
    eq('undo: a merged press goes as one', C.undoTap(mt).length, 1);
    eq('undo: empty timeline stays empty', C.undoTap([]), []);

    // Ending without a planned cut
    const v60Plan = R.normalizeRecipe(model.createRecipe({ rigId: 'r', plan: [
      { id: 'a', action: 'pour', atS: 0, volumeMl: 50, valve: 'open' },
      { id: 'b', action: 'pour', atS: 45, volumeMl: 150, valve: 'open' },
    ] }));
    const vs = C.schedule(v60Plan, { rig: v60Rig() });
    let vt = C.applyTap(vs, [], 0);
    vt = C.applyTap(vs, vt, 45);
    eq('end: last pour running, no more steps → POUR DONE', C.expectedTap(vs, vt, 200).label, 'POUR DONE');
    vt = C.applyTap(vs, vt, 70);
    eq('end: then DRAWDOWN DONE', C.expectedTap(vs, vt, 71).label, 'DRAWDOWN DONE');
    vt = C.applyTap(vs, vt, 160);
    eq('end: which ends the brew naturally', C.tapState(vs, vt).endedBy, 'drawdown');
    eq('end: CUT works any time', C.tapState(vs, C.applyTap(vs, [C.applyTap(vs, [], 0)[0]], 30, 'cut')).endedBy, 'cut');
    eq('end: DRAWDOWN DONE button works any time', C.tapState(vs, C.applyTap(vs, [], 30, 'drawdown')).endedBy, 'drawdown');

    // Early / late taps, rounding, purity
    // While pour 1 runs and pour 2's countdown (0:42) hasn't started, the button is POUR DONE.
    eq('tap: pressing at 0:41 during pour 1 means POUR DONE, not pour 2', C.applyTap(vs, C.applyTap(vs, [], 0), 41.237)[1].type, 'pour-done');
    const early = C.applyTap(vs, C.applyTap(vs, C.applyTap(vs, [], 0), 10), 41.237);
    eq('tap: pour 2 tapped early stamps the real time, rounded to 0.01 s', [early[2].type, early[2].atS, early[2].plannedAtS], ['pour', 41.24, 45]);
    const input = C.applyTap(vs, [], 0);
    const copy = JSON.stringify(input);
    C.applyTap(vs, input, 10);
    C.undoTap(input);
    eq('pure: applyTap and undoTap never change the timeline passed in', JSON.stringify(input), copy);
    eq('tap: nothing happens without a valid time', C.applyTap(vs, [], NaN), []);
  }

  // ================= pour count-in + drip assist (coach.js) =================
  {
    const sched = C.schedule(yuanRecipe(), { rig: switchRig() });
    const ci = { countInS: C.POUR_COUNT_IN_S };
    let tl = C.applyTap(sched, [], -3, 'main', ci);
    eq('count-in: pressing a pour stamps it 3 s later, remembering the press', [tl.length, tl[0].type, tl[0].atS, tl[0].pressedAtS, tl[0].plannedAtS], [1, 'pour', 0, -3, 0]);
    eq('count-in: counts 3 → 2 → 1', [-2.9, -1.5, -0.2].map(t => C.pendingCountIn(tl, t)?.countdown), [3, 2, 1]);
    eq('count-in: over at the pour', C.pendingCountIn(tl, 0), null);
    eq('count-in: other presses are ignored while it runs (main, cut, valve, drawdown)',
      ['main', 'cut', 'valve', 'drawdown'].map(w => C.applyTap(sched, tl, -1, w, ci).length), [1, 1, 1, 1]);
    eq('count-in: UNDO cancels it', C.pendingCountIn(C.undoTap(tl), -1), null);
    eq('count-in: buzzes tick at −2, −1 and fire at 0, none at the press',
      C.countInBuzzes(tl, -3, 1).map(b => `${b.type}@${b.atS}`), ['tick@-2', 'tick@-1', 'fire@0']);
    eq('count-in: the plan\'s own buzzes inside the count are suppressed', C.buzzesBetween(sched, -3, 0).filter(b => !C.inCountIn(tl, b.atS)).map(b => b.atS), []);
    eq('count-in: after the pour, POUR DONE is offered as before', C.expectedTap(sched, tl, 5).label, 'POUR DONE');
    tl = C.applyTap(sched, tl, 20, 'main', ci);   // POUR DONE: not a pour step → no count-in
    eq('count-in: POUR DONE is stamped at the press', [tl[1].type, tl[1].atS, 'pressedAtS' in tl[1]], ['pour-done', 20, false]);
    tl = C.applyTap(sched, tl, 40, 'main', ci);   // OPEN VALVE → no count-in
    eq('count-in: OPEN VALVE is stamped at the press', [tl[2].type, tl[2].atS], ['valve', 40]);
    tl = C.applyTap(sched, tl, 42, 'main', ci);   // POUR pressed when its countdown starts
    eq('count-in: pressing when the planned countdown starts lands on the plan', C.tapDrift(sched, tl).map(d => d.deltaS), [0, 0, 0]);
    eq('count-in: off (0) stamps at the press, as before', C.applyTap(sched, [], -1, 'main', { countInS: 0 })[0].atS, -1);
    eq('count-in: a press during a count-in that was undone works again', C.applyTap(sched, C.undoTap(tl), 43, 'main', ci).slice(-1)[0].atS, 46);
    const T2 = T.analyzeBrew(yuanRecipe(), [...C.applyTap(sched, [], -3, 'main', ci), { type: 'valve', state: 'open', trigger: 'planned', atS: 40, tap: 2 }, { type: 'cut', atS: 150, tap: 3 }]);
    eq('count-in: the analysis measures from the stamped pour, not the press', T2.phases.steep, 40);

    // Drip assist
    const da = R.normalizeRecipe(model.createRecipe({ rigId: 'r', plan: [
      { id: 'a', action: 'pour', atS: 0, volumeMl: 60, valve: 'open' },
      { id: 'b', action: 'pour', atS: 100, volumeMl: 190, valve: 'open', dripAssist: true },
    ] }));
    const ds = C.schedule(da, { rig: v60Rig() });
    eq('drip assist: new pours default off', model.createAction('pour').dripAssist, false);
    eq('drip assist: never inherited from the previous pour', model.createAction('pour', [{ action: 'pour', atS: 0, dripAssist: true }]).dripAssist, false);
    eq('drip assist: the cue says so', C.plannedActions(da, v60Rig()).actions.map(a => a.label), ['POUR', 'POUR WITH DRIP ASSIST']);
    const dt = C.applyTap(ds, C.applyTap(ds, [], 0), 100);
    eq('drip assist: stamped on the tapped pour', dt.filter(e => e.type === 'pour').map(e => e.dripAssist), [false, true]);
    eq('drip assist: does not block the plan', R.validateRecipe(da, v60Rig()).length, 0);
    eq('drip assist: survives adapting the plan to another rig', R.adaptPlanToRig(da.plan, v60Rig())[1].dripAssist, true);
  }

  // ================= prep reminders: drip assist on/off, tare (recipe.js + coach.js) =================
  {
    const plan = [
      { id: 'a', action: 'pour', atS: 0, volumeMl: 60, valve: 'open' },
      { id: 'b', action: 'pour', atS: 45, volumeMl: 90, valve: 'open', dripAssist: true, tareBefore: true },
      { id: 'c', action: 'pour', atS: 90, volumeMl: 50, valve: 'open', dripAssist: true },
      { id: 'd', action: 'pour', atS: 120, volumeMl: 50, valve: 'open', tareBefore: true },
      { id: 'e', action: 'pour', atS: 125, volumeMl: 50, valve: 'open', tareBefore: true },
    ];
    const r = R.normalizeRecipe(model.createRecipe({ rigId: 'r', doseG: 15, plan }));
    eq('tare: scale targets restart at 0 after a tare', r.plan.map(a => a.scaleMl), [60, 90, 140, 50, 50]);
    eq('tare: total water still counts every pour', [r.plan.map(a => a.cumulativeMl), r.totalWaterMl], [[60, 150, 200, 250, 300], 300]);
    eq('prep: put on, then tare · nothing between two drip assist pours · remove, then tare',
      r.plan.map(a => a.prep), [[], ['PUT ON DRIP ASSIST', 'TARE SCALE'], [], ['REMOVE DRIP ASSIST', 'TARE SCALE'], ['TARE SCALE']]);
    eq('tare: new pours default off', model.createAction('pour').tareBefore, false);
    eq('tare: an unreadable volume blanks the scale target until the next tare',
      R.normalizeRecipe(model.createRecipe({ rigId: 'r', plan: [{ id: 'x', action: 'pour', atS: 0, volumeMl: null }, { id: 'y', action: 'pour', atS: 30, volumeMl: 40 }, { id: 'z', action: 'pour', atS: 60, volumeMl: 40, tareBefore: true }] })).plan.map(a => a.scaleMl),
      [null, null, 40]);

    const s = C.schedule(r, { rig: v60Rig() });
    const preps = s.events.filter(e => e.kind === 'prep');
    eq('reminder: 10 s before the pour, buzzing on its own', preps.slice(0, 2).map(p => [p.atS, p.fireAtS, p.buzz, p.label]),
      [[35, 45, true, 'PUT ON DRIP ASSIST · TARE SCALE'], [110, 120, true, 'REMOVE DRIP ASSIST · TARE SCALE']]);
    eq('reminder: 5 s after the previous pour it squeezes in 1 s after that pour, 1 s before the countdown', [preps[2].buzz, preps[2].atS, preps[2].fireAtS], [true, 121, 125]);
    const tight = C.schedule(R.normalizeRecipe(model.createRecipe({ rigId: 'r', plan: [
      { id: 'a', action: 'pour', atS: 0, volumeMl: 50 }, { id: 'b', action: 'pour', atS: 2, volumeMl: 50, tareBefore: true }] })), { rig: v60Rig() });
    const tp = tight.events.find(e => e.kind === 'prep');
    eq('reminder: pours 2 s apart → no room to buzz, shown from the previous pour', [tp.buzz, tp.atS, C.buzzesBetween(tight, -20, 5).filter(b => b.type === 'prep').length], [false, 0, 0]);
    eq('reminder: buzzes in order, a prep never lands on a tick or a fire',
      C.buzzesBetween(s, 30, 46).map(b => `${b.type}@${b.atS}`), ['prep@35', 'tick@42', 'tick@43', 'tick@44', 'fire@45']);
    eq('reminder: the screen shows it from the reminder until the pour', [34, 35, 44.9, 45].map(t => C.stateAt(s, t).prep?.label ?? null),
      [null, 'PUT ON DRIP ASSIST · TARE SCALE', 'PUT ON DRIP ASSIST · TARE SCALE', null]);
    eq('reminder: never buzzes before the previous step has fired', preps.every(p => !p.buzz || p.atS > 0), true);
    const first = C.schedule(R.normalizeRecipe(model.createRecipe({ rigId: 'r', plan: [{ id: 'a', action: 'pour', atS: 0, volumeMl: 50, tareBefore: true }] })), { rig: v60Rig() });
    eq('reminder: on the first pour it moves the pre-roll to −10 s', [first.startS, first.events[0].kind, first.events[0].buzz], [-10, 'prep', true]);
    eq('reminder: the cue carries the scale reading and the tare', C.plannedActions(r, v60Rig()).actions.map(a => [a.scaleMl, a.tareBefore]),
      [[60, false], [90, true], [140, false], [50, true], [50, true]]);
    eq('reminder: none without drip assist or tare (Yuan unchanged)', C.schedule(yuanRecipe(), { rig: switchRig() }).events.some(e => e.kind === 'prep'), false);
  }

  // ================= brew entry: clone-last, diff strip, blank slate, reconciliation (brew.js) =================
  {
    const yuan = yuanRecipe();
    const past = { ...brewFixture(), id: 'b-old', beanId: 'bean-guji', recipeId: yuan.id, rigId: yuan.rigId, startedAt: '2026-09-15T08:00:00Z' };
    const last = { ...brewFixture(), id: 'b-last', beanId: 'bean-guji', recipeId: yuan.id, rigId: yuan.rigId, startedAt: '2026-09-16T08:00:00Z',
      grind: { setting: 26, unit: 'clicks' }, doseG: 16, bypassG: 0, waterId: 'water-seed-omb-75', preheat: { dripper: true, server: true } };
    const other = { ...brewFixture(), id: 'b-other', beanId: 'bean-other', startedAt: '2026-09-17T08:00:00Z' };
    const sessions = [{ id: 's1', brews: [last, past] }, { id: 's2', brews: [other] }];

    eq('history: newest first across sessions', Bw.allBrews(sessions).map(b => b.id), ['b-other', 'b-last', 'b-old']);
    eq('history: last brew on a bean', Bw.lastBrewOnBean(sessions, 'bean-guji').id, 'b-last');
    eq('history: no bean → nothing to clone', Bw.lastBrewOnBean(sessions, null), null);

    const d = Bw.cloneDraft({ ...yuan, beanId: 'bean-guji' }, sessions);
    eq('clone: copies the last brew on the bean', [d.mode, d.changedFrom, d.grind.setting, d.doseG, d.waterId, d.preheat.server], ['clone', 'b-last', 26, 16, 'water-seed-omb-75', true]);
    eq('clone: an untouched clone has no changes', Bw.variableDiff(last, d), []);

    // Plan check: clone, change grind only → exactly one field
    const grindOnly = { ...d, grind: { ...d.grind, setting: 28 } };
    eq('PLAN CHECK: change grind only → the strip shows exactly one field', Bw.variableDiff(last, grindOnly),
      [{ field: 'grind.setting', label: 'grind', from: 26, to: 28 }]);
    eq('warning: one change → none', Bw.attributionWarning(Bw.variableDiff(last, grindOnly)), null);

    // Plan check: change three → warning, dismissible
    const three = { ...grindOnly, doseG: 18, waterId: 'water-seed-omb-100' };
    const changes3 = Bw.variableDiff(last, three);
    eq('diff: three changes, in display order', changes3.map(c => c.label), ['water', 'grind', 'dose']);
    const w = Bw.attributionWarning(changes3);
    eq('PLAN CHECK: three changes → the attribution warning', [w?.count, w?.message], [3, "3 variables changed. This result won't be attributable to any one of them."]);
    eq('PLAN CHECK: the warning is dismissible', Bw.attributionWarning(changes3, w.signature), null);
    eq('warning: comes back when a fourth variable changes', Bw.attributionWarning(Bw.variableDiff(last, { ...three, bypassG: 20 }), w.signature)?.count, 4);
    eq('warning: two changes → none', Bw.attributionWarning(Bw.variableDiff(last, { ...grindOnly, doseG: 18 })), null);

    eq('diff: empty = empty (null, undefined, blank text)', Bw.variableDiff({ bypassG: null, grind: { unit: '' } }, { grind: {} }), []);
    eq('diff: 0 is a value, so 0 → 20 g bypass is a change', Bw.variableDiff({ bypassG: 0 }, { bypassG: 20 }).map(c => c.field), ['bypassG']);
    eq('diff: a new recipe version counts as one change', Bw.variableDiff(last, { ...d, recipeId: 'recipe-yuan-v2' }).map(c => c.field), ['recipeId']);
    eq('diff: outcomes, timeline and notes never count', Bw.variableDiff(last, { ...last, outputMl: 1, timeline: [], notes: 'x', assessment: {}, daysOffRoast: 99 }), []);
    eq('diff: no parent → unknown, not "nothing changed"', Bw.variableDiff(null, d), Bw.UNKNOWN);

    const blank = Bw.blankDraft({ ...yuan, beanId: 'bean-guji', waterId: 'w1' });
    eq('blank slate: only what the recipe says, no parent', [blank.mode, blank.changedFrom, blank.doseG, blank.waterId, blank.grind.setting], ['blank', null, 17, 'w1', null]);
    const firstOnBean = Bw.cloneDraft(yuan, sessions, 'bean-new');
    eq('clone: first brew on a bean is blank but stays in clone mode', [firstOnBean.mode, firstOnBean.changedFrom, firstOnBean.beanId], ['clone', null, 'bean-new']);
    eq('clone: re-pointed at the recipe being brewed', Bw.cloneDraft({ ...yuan, id: 'recipe-yuan-v2', beanId: 'bean-guji' }, sessions).recipeId, 'recipe-yuan-v2');
    eq('parent: found by id', Bw.parentOf(d, sessions).id, 'b-last');

    // Reconciliation
    const brew = { doseG: 17, bypassG: null, outputMl: null, timeline: [
      { type: 'pour', atS: 0, volumeMl: 50, tempC: 92, tap: 1 }, { type: 'valve', atS: 40, tap: 2 },
      { type: 'pour', atS: 45, volumeMl: 100, tempC: 92, tap: 3 }, { type: 'pour', atS: 80, volumeMl: 60, tempC: 84, tap: 4 }] };
    eq('reconcile: outcomes unknown until output is entered', Bw.outcomes(brew), { waterInMl: 210, retentionMl: Bw.UNKNOWN, trueRatio: Bw.UNKNOWN });
    let r = Bw.setMeasured(brew, 'outputMl', 180);
    eq('reconcile: retention and true ratio computed', [r.waterInMl, r.retentionMl, Math.round(r.trueRatio * 100) / 100], [210, 30, 10.59]);
    r = Bw.reconcilePour(r, 1, 'volumeMl', 110);
    eq('reconcile: correcting pour 2 changes water in, keeps its time', [r.waterInMl, r.retentionMl, r.timeline[2].atS, r.timeline[2].reconciled], [220, 40, 45, true]);
    eq('reconcile: only the chosen pour changes', r.timeline.map(e => e.volumeMl ?? null), [50, null, 110, 60]);
    r = Bw.setMeasured(r, 'bypassG', 20);
    eq('reconcile: bypass counts as water in', r.waterInMl, 240);
    eq('reconcile: output above water in → retention unknown', Bw.setMeasured(r, 'outputMl', 300).retentionMl, Bw.UNKNOWN);
    eq('reconcile: a blanked pour volume → water in unknown', Bw.reconcilePour(r, 0, 'volumeMl', null).waterInMl, Bw.UNKNOWN);
    eq('reconcile: times and other fields are not editable through it', [Bw.reconcilePour(r, 0, 'atS', 5).timeline[0].atS, Bw.setMeasured(r, 'doseG', 99).doseG], [0, 17]);
    eq('reconcile: issues until output is in', Bw.reconcileIssues(brew), ['Output not entered']);
    eq('reconcile: none once reconciled', Bw.reconcileIssues(r), []);
    eq('reconcile: pure — the input brew is untouched', brew.timeline[2].volumeMl, 100);
  }

  // ---- model ----
  const { rigs, waters } = model.seedPresets();
  eq('seed: 3 rigs', rigs.length, 3);
  eq('seed: 7 waters', waters.length, 7);
  const ids = [...rigs, ...waters].map(e => e.id);
  eq('seed: ids unique', new Set(ids).size, ids.length);
  eq('seed: ids stable across calls', model.seedPresets().rigs.map(r => r.id), rigs.map(r => r.id));
  eq('seed: no seeded rig has a valve', rigs.some(r => r.valveCapable), false);

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
