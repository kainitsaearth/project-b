// compute.js — PURE. Imports nothing, touches no DOM, reads no app state.
// Every function is data in, data out.
//
// Convention: anything that cannot be computed honestly returns UNKNOWN.
// A wrong number is worse than no number — it gets compared, ranked and believed.

export const UNKNOWN = 'unknown';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

// Strict YYYY-MM-DD → integer UTC day number, or null.
// Rejects impossible dates (2026-02-30) instead of letting Date roll them over.
export function parseISODate(value) {
  if (typeof value !== 'string') return null;
  const m = ISO_DATE.exec(value.trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return t / MS_PER_DAY;
}

// Whole days between roast and brew. Missing, unparseable, or roast-after-brew
// dates return UNKNOWN — never NaN, never 0, never a guess.
export function daysOffRoast(roastDate, brewDate) {
  const roast = parseISODate(roastDate);
  const brew = parseISODate(brewDate);
  if (roast === null || brew === null) return UNKNOWN;
  const days = brew - roast;
  return days < 0 ? UNKNOWN : days;
}

const isNum = v => typeof v === 'number' && Number.isFinite(v);

// ---------- water & ratio ----------

// Sum of pour volumes. One unreadable pour makes the total UNKNOWN —
// silently skipping it would under-report water and inflate retention.
export function totalWaterIn(timeline) {
  if (!Array.isArray(timeline)) return UNKNOWN;
  let total = 0;
  for (const event of timeline) {
    if (event?.type !== 'pour') continue;
    if (!isNum(event.volumeMl) || event.volumeMl < 0) return UNKNOWN;
    total += event.volumeMl;
  }
  return total;
}

// Water held back by the bed and filter: water in − output.
// Pass bypass water inside `waterIn` if it went into the server.
// Output above input is a measurement error, not negative retention → UNKNOWN.
export function retention(waterIn, outputMl) {
  if (!isNum(waterIn) || !isNum(outputMl) || waterIn < 0 || outputMl < 0) return UNKNOWN;
  const r = waterIn - outputMl;
  return r < 0 ? UNKNOWN : r;
}

// Beverage ratio: output ÷ dose, i.e. the N in 1:N. Unrounded — formatting is the UI's job.
export function trueRatio(doseG, outputMl) {
  if (!isNum(doseG) || !isNum(outputMl) || doseG <= 0 || outputMl <= 0) return UNKNOWN;
  return outputMl / doseG;
}

// ---------- diff ----------

// Fields that are not brew *variables*, so never count as a change:
// identity, bookkeeping, outcomes, and daysOffRoast (it drifts daily on its own;
// counting it would flag every clone as changed).
export const DIFF_IGNORE = Object.freeze([
  'id', 'sessionId', 'ladderId', 'step', 'changedFrom', 'diff', 'notes',
  'createdAt', 'updatedAt',
  'timeline', 'endedBy', 'outputMl', 'retentionMl', 'trueRatio',
  'phases', 'drift', 'assessment',
  'daysOffRoast',
]);

const isPlainObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);

// null and undefined both mean "no value" — clearing a field to null is not
// a different state from never having set it.
function sameValue(a, b) {
  if (a == null || b == null) return a == null && b == null;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b)
      && a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) if (!sameValue(a[k], b[k])) return false;
    return true;
  }
  return Object.is(a, b);
}

// Field-level change set from brew A to brew B.
// Nested objects flatten to dotted paths ('grind.setting'); arrays compare whole.
// → [{ field, from, to }] sorted by field, or UNKNOWN if either side is not a brew.
export function diff(brewA, brewB, ignore = DIFF_IGNORE) {
  if (!isPlainObject(brewA) || !isPlainObject(brewB)) return UNKNOWN;
  const skip = new Set(ignore);
  const changes = [];

  const walk = (a, b, prefix) => {
    const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
    for (const key of keys) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (skip.has(path)) continue;
      const va = a?.[key], vb = b?.[key];
      if (isPlainObject(va) || isPlainObject(vb)) {
        // Object on both sides: descend. Object vs scalar: the whole field changed.
        if (isPlainObject(va) && isPlainObject(vb)) walk(va, vb, path);
        else if (!sameValue(va, vb)) changes.push({ field: path, from: va ?? null, to: vb ?? null });
      } else if (!sameValue(va, vb)) {
        changes.push({ field: path, from: va ?? null, to: vb ?? null });
      }
    }
  };

  walk(brewA, brewB, '');
  return changes.sort((x, y) => (x.field < y.field ? -1 : x.field > y.field ? 1 : 0));
}
