// tests.js — console assertions. Runs on load on localhost or with ?test,
// and directly under Node:  node tests.js

import { daysOffRoast, UNKNOWN } from './compute.js?v=2';
import * as model from './model.js?v=2';

export function runTests(log = console) {
  const results = [];
  const eq = (name, actual, expected) => {
    const ok = Object.is(actual, expected) || JSON.stringify(actual) === JSON.stringify(expected);
    results.push({ name, ok, actual, expected });
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
