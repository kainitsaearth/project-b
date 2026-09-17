// exportData.js — PURE. Imports nothing, touches no DOM, reads no app state.
// Step 10's escape hatch: the whole database as one JSON file, so brews are never trapped
// in one phone's browser storage.
//
// The file holds EVERYTHING, unfiltered and unrounded — including quality10, which the app
// never ranks. An export is a backup, not advice.

export const EXPORT_FORMAT = 'project-b-export';
export const EXPORT_VERSION = 1;
export const ENTITY_KINDS = ['beans', 'rigs', 'waters', 'recipes', 'sessions'];

const byId = (a, b) => (String(a?.id) < String(b?.id) ? -1 : String(a?.id) > String(b?.id) ? 1 : 0);

// state: { meta, activeBrew, brewDraft, beans: {id: …}, rigs, waters, recipes, sessions }
// → a plain object ready for JSON.stringify. Entities become arrays sorted by id (stable diffs).
export function buildExport(state, { exportedAt, appVersion = null, schema = null } = {}) {
  const data = {};
  for (const kind of ENTITY_KINDS) data[kind] = Object.values(state?.[kind] ?? {}).sort(byId);
  const brews = data.sessions.flatMap(s => s?.brews ?? []);
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: exportedAt ?? null,
    appVersion,
    schema,
    counts: {
      beans: data.beans.length, rigs: data.rigs.length, waters: data.waters.length,
      recipes: data.recipes.length, sessions: data.sessions.length,
      brews: brews.length,
      assessedBrews: brews.filter(b => b?.assessment?.submittedAt).length,
    },
    data: {
      ...data,
      meta: state?.meta ?? {},
      activeBrew: state?.activeBrew ?? null,   // a brew in progress is exported too, not lost
      brewDraft: state?.brewDraft ?? null,
    },
  };
}

// project-b-2026-09-17-1432.json — local time, sorts by date in a file list.
export function exportFilename(date) {
  const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date(NaN);
  if (Number.isNaN(d.getTime())) return 'project-b-export.json';
  const p = n => String(n).padStart(2, '0');
  return `project-b-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
}

// Sharing: Chrome on Android refuses to share .json files ("Permission denied" — the type isn't on
// its allowed list). A plain-text file with the same JSON inside is accepted everywhere, and it
// opens fine on a laptop. The name keeps ".json" so it's obvious what it is.
export const SHARE_TYPE = 'text/plain';
export function shareFilename(date) {
  return exportFilename(date).replace(/\.json$/, '.json.txt');
}

// Is this a Project B export that could be read back? → [problem]   ([] = valid)
export function validateExport(obj) {
  const issues = [];
  if (!obj || typeof obj !== 'object') return ['Not a JSON object'];
  if (obj.format !== EXPORT_FORMAT) issues.push(`format is not "${EXPORT_FORMAT}"`);
  if (obj.version !== EXPORT_VERSION) issues.push(`unknown export version ${obj.version}`);
  for (const kind of ENTITY_KINDS) {
    const list = obj.data?.[kind];
    if (!Array.isArray(list)) { issues.push(`data.${kind} missing`); continue; }
    if (list.some(e => !e || typeof e.id !== 'string')) issues.push(`data.${kind} has a record without an id`);
  }
  const brews = Array.isArray(obj.data?.sessions) ? obj.data.sessions.flatMap(s => s?.brews ?? []) : [];
  if (obj.counts && obj.counts.brews !== brews.length) issues.push(`counts.brews says ${obj.counts.brews}, file has ${brews.length}`);
  return issues;
}

// Brews saved after the last export (all of them if never exported). This is the backup nudge.
export function unexportedBrews(sessions, lastExportAt) {
  const since = Date.parse(lastExportAt);
  const brews = (sessions ?? []).flatMap(s => s?.brews ?? []);
  if (!Number.isFinite(since)) return brews.length;
  return brews.filter(b => !(Date.parse(b?.startedAt) <= since)).length;
}

// When to nudge on the Recipes screen: any brew not backed up, and either never exported or
// the last export was 3+ days ago.
export const NUDGE_AFTER_DAYS = 3;
export function shouldNudge(sessions, lastExportAt, nowMs) {
  const pending = unexportedBrews(sessions, lastExportAt);
  if (pending === 0) return false;
  const since = Date.parse(lastExportAt);
  return !Number.isFinite(since) || nowMs - since >= NUDGE_AFTER_DAYS * 86_400_000;
}
