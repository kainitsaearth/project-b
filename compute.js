// compute.js — PURE. Imports nothing, touches no DOM, reads no app state.
// Every function is data in, data out. Step 3 adds ratio, retention and diff.

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
