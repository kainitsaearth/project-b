// brewScreens.js — Step 8 screens: brew setup (clone-last, blank slate, diff strip) and the
// saved-brew screen with post-brew reconciliation. Decisions come from pure brew.js; this file
// renders them and calls actions. Inputs are built once and refreshed in place, so typing
// never rebuilds the form (the phone keyboard stays up).

import { h, row, fmt, toNum } from './dom.js?v=16';
import * as model from './model.js?v=16';
import * as B from './brew.js?v=16';
import { daysOffRoast, UNKNOWN } from './compute.js?v=16';

const clock = t => {
  if (t == null || !Number.isFinite(t)) return '—';
  const neg = t < 0;
  const s = Math.floor(Math.abs(t) + (neg ? 0.999 : 0));
  return `${neg ? '−' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const signed = d => {
  const r = Math.round(d * 10) / 10;
  return r > 0 ? `+${r.toFixed(1)}` : r < 0 ? r.toFixed(1) : '0.0';
};
const todayISO = () => {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const when = iso => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—'
    : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

// A variable's value as the diff strip shows it.
export function formatVariable(state, field, v) {
  if (v == null || v === '') return '—';
  switch (field) {
    case 'beanId': return state.beans[v] ? model.displayName('beans', state.beans[v]) : '(deleted bean)';
    case 'waterId': return state.waters[v] ? model.displayName('waters', state.waters[v]) : '(deleted water)';
    case 'rigId': return state.rigs[v] ? model.displayName('rigs', state.rigs[v]) : '(deleted rig)';
    case 'recipeId': {
      const r = state.recipes[v];
      return r ? `${model.displayName('recipes', r)} v${r.version ?? 1}` : '(deleted recipe)';
    }
    case 'doseG': case 'bypassG': return `${fmt(v)} g`;
    case 'preheat.dripper': case 'preheat.server': return v ? 'on' : 'off';
    default: return String(v);
  }
}

// ---------- setup ----------

// What decides whether the setup form must be rebuilt (not just refreshed): anything that
// replaces field values wholesale — cloning, blank slate, picking another bean.
export function setupKey(state, recipeId) {
  const d = state.brewDraft;
  return `setup/${recipeId}|${d?.recipeId === recipeId ? `${d.mode}|${d.changedFrom}|${d.beanId}` : 'none'}`;
}

export function setupScreen(initialState, recipeId, actions) {
  let state = initialState;
  const recipe = state.recipes[recipeId];
  const draft = state.brewDraft?.recipeId === recipeId ? state.brewDraft : null;
  const el = h('section', { class: 'screen', id: 'setup' });

  if (!recipe) {
    el.append(h('a', { class: 'back', href: '#/recipes' }, '‹ Recipes'), h('p', { class: 'empty' }, "This recipe doesn't exist any more."));
    return { el, refresh() {} };
  }
  if (!draft) {
    el.append(
      h('a', { class: 'back', href: `#/recipes/${encodeURIComponent(recipeId)}` }, '‹ Recipe'),
      h('h2', {}, 'New brew'),
      h('p', { class: 'empty' }, 'No brew is being set up.'),
      h('button', { type: 'button', class: 'btn btn-primary', id: 'setup-new', onclick: () => actions.newBrew(recipeId) }, 'Set up a brew'));
    return { el, refresh() {} };
  }

  const sessions = () => Object.values(state.sessions);
  const refs = kind => Object.values(state[kind])
    .sort((a, b) => model.displayName(kind, a).localeCompare(model.displayName(kind, b), undefined, { numeric: true }));
  const field = (label, id, control, hint) => h('div', { class: 'field' },
    h('label', { class: 'field-label', htmlFor: id }, label), control, hint ? h('small', { class: 'field-hint' }, hint) : null);
  const refSelect = (id, kind, value, emptyLabel, key) => h('select', { id, onchange: ev => actions.setDraft(key, ev.target.value || null) },
    h('option', { value: '', selected: !value }, emptyLabel),
    value && !state[kind][value] ? h('option', { value, selected: true }, '(deleted)') : null,
    refs(kind).map(o => h('option', { value: o.id, selected: o.id === value }, model.displayName(kind, o))));
  const numInput = (id, value, key) => h('input', {
    id, type: 'number', inputMode: 'decimal', step: 'any', value: value ?? '',
    oninput: ev => actions.setDraft(key, toNum(ev.target.value)),
  });
  const toggle = (id, label, checked, key) => h('label', { class: 'toggle' },
    h('input', { type: 'checkbox', id, checked: Boolean(checked), onchange: ev => actions.setDraft(key, ev.target.checked) }),
    h('span', { class: 'toggle-text' }, h('span', { class: 'field-label' }, label)));

  const parent = B.parentOf(draft, sessions());
  const source = draft.mode === 'blank'
    ? 'Blank slate: nothing copied, nothing to compare.'
    : parent
      ? `Copied from your last brew on this bean (${when(parent.startedAt)}).`
      : draft.beanId ? 'First brew on this bean: nothing to copy yet.' : 'No bean picked: nothing to copy.';

  const stripEl = h('div', { class: 'diff-strip', id: 'diff-strip' });
  const warningEl = h('div', { id: 'attribution-slot' });
  const ageEl = h('output', { class: 'days-off-roast', id: 'setup-days-off-roast' });

  el.append(
    h('a', { class: 'back', href: `#/recipes/${encodeURIComponent(recipeId)}` }, '‹ Recipe'),
    h('div', { class: 'screen-head' },
      h('h2', {}, 'New brew'),
      h('span', { class: 'badge badge-version' }, `${model.displayName('recipes', recipe)} v${recipe.version ?? 1}`)),
    h('div', { class: 'segmented', role: 'group', 'aria-label': 'Start from' },
      h('button', { type: 'button', class: 'btn', id: 'draft-clone', 'aria-pressed': String(draft.mode === 'clone'), onclick: () => actions.draftClone() }, 'Clone last brew'),
      h('button', { type: 'button', class: 'btn', id: 'draft-blank', 'aria-pressed': String(draft.mode === 'blank'), onclick: () => actions.draftBlank() }, 'Blank slate')),
    h('p', { class: 'field-hint', id: 'setup-source' }, source),
    stripEl,
    warningEl,
    h('form', { class: 'form', onsubmit: ev => ev.preventDefault() },
      field('Bean', 'd-beanId', refSelect('d-beanId', 'beans', draft.beanId, '— no bean —', 'beanId'),
        draft.mode === 'clone' ? 'Picking a bean copies your last brew on it.' : null),
      h('div', { class: 'derived' }, row('Days off roast', ageEl)),
      field('Water', 'd-waterId', refSelect('d-waterId', 'waters', draft.waterId, '— none —', 'waterId')),
      h('div', { class: 'field-pair' },
        field('Grind', 'd-grind-setting', numInput('d-grind-setting', draft.grind?.setting, 'grind.setting')),
        field('Unit', 'd-grind-unit', h('select', { id: 'd-grind-unit', onchange: ev => actions.setDraft('grind.unit', ev.target.value || null) },
          h('option', { value: '', selected: !draft.grind?.unit }, '—'),
          B.GRIND_UNITS.map(u => h('option', { value: u, selected: draft.grind?.unit === u }, u))))),
      h('div', { class: 'field-pair' },
        field('Dose (g)', 'd-doseG', numInput('d-doseG', draft.doseG, 'doseG')),
        field('Bypass (g)', 'd-bypassG', numInput('d-bypassG', draft.bypassG, 'bypassG'))),
      toggle('d-preheat-dripper', 'Preheat dripper', draft.preheat?.dripper, 'preheat.dripper'),
      toggle('d-preheat-server', 'Preheat server', draft.preheat?.server, 'preheat.server'),
      field('Notes', 'd-notes', h('textarea', { id: 'd-notes', rows: 3, value: draft.notes ?? '', oninput: ev => actions.setDraft('notes', ev.target.value) }))),
    h('a', { class: 'btn btn-primary btn-brew', id: 'setup-start', href: `#/brew/${encodeURIComponent(recipeId)}` }, '▶ Continue to pour coach'),
    h('p', { class: 'field-hint' }, 'Rig and pour plan come from the recipe. Output, serve temperature and the real pour volumes are entered after the brew.'));

  function refresh(next) {
    state = next;
    const d = state.brewDraft;
    if (d?.recipeId !== recipeId) return;
    const bean = d.beanId ? state.beans[d.beanId] : null;
    const age = bean ? daysOffRoast(bean.roastDate, todayISO()) : UNKNOWN;
    ageEl.textContent = age === UNKNOWN ? UNKNOWN : `${age} ${age === 1 ? 'day' : 'days'}`;

    const changes = B.variableDiff(B.parentOf(d, sessions()), d);
    if (changes === B.UNKNOWN) {
      stripEl.replaceChildren(h('span', { class: 'diff-none' }, 'No parent brew · this starts a new line'));
      stripEl.dataset.count = '';
    } else if (changes.length === 0) {
      stripEl.replaceChildren(h('span', { class: 'diff-none' }, 'No changes from the last brew · a repeat'));
      stripEl.dataset.count = '0';
    } else {
      stripEl.replaceChildren(
        h('span', { class: 'diff-count' }, `${changes.length} changed`),
        ...changes.map(c => h('span', { class: 'diff-chip', 'data-field': c.field },
          h('b', {}, c.label), ` ${formatVariable(state, c.field, c.from)} → ${formatVariable(state, c.field, c.to)}`)));
      stripEl.dataset.count = String(changes.length);
    }

    const warn = B.attributionWarning(changes === B.UNKNOWN ? [] : changes, d.dismissedWarning);
    warningEl.replaceChildren(...(warn ? [h('div', { class: 'alert alert-warn', role: 'status', id: 'attribution-warning' },
      h('strong', {}, `⚠ ${warn.message}`),
      h('p', {}, 'Fine for exploring. For a clean comparison, change one thing per brew.'),
      h('div', { class: 'alert-actions' },
        h('button', { type: 'button', class: 'btn', id: 'dismiss-warning', onclick: () => actions.dismissDraftWarning(warn.signature) }, 'Got it')))] : []));
  }

  refresh(state);
  return { el, refresh };
}

// ---------- after the brew ----------

// Deliberately shows NO phases or drift, and no comparison with earlier brews:
// spec §6.3 "evidence follows judgement". They are saved; the assessment (Step 9) reveals them.
export function resultScreen(initialState, brewId, actions) {
  let state = initialState;
  const find = () => {
    for (const s of Object.values(state.sessions)) {
      const found = (s.brews ?? []).find(b => b.id === brewId);
      if (found) return found;
    }
    return null;
  };
  const brew = find();
  const el = h('section', { class: 'screen', id: 'brew-saved' });
  if (!brew) {
    el.append(h('a', { class: 'back', href: '#/recipes' }, '‹ Recipes'), h('p', { class: 'empty' }, "This brew doesn't exist any more."));
    return { el, refresh() {} };
  }

  const recipe = state.recipes[brew.recipeId];
  const endS = brew.timeline.find(e => e.type === 'cut' || e.type === 'drawdown-complete')?.atS ?? null;
  const edit = fn => actions.editBrew(brewId, fn);
  const num = (id, value, onset, placeholder) => h('input', {
    id, type: 'number', inputMode: 'decimal', step: 'any', value: value ?? '', placeholder,
    oninput: ev => onset(toNum(ev.target.value)),
  });
  const measured = (key, label, id) => h('div', { class: 'field' },
    h('label', { class: 'field-label', htmlFor: id }, label),
    num(id, brew[key], v => edit(b => B.setMeasured(b, key, v))));

  const pours = brew.timeline.filter(e => e.type === 'pour');
  const pourRows = pours.map((e, i) => h('div', { class: 'reconcile-pour', 'data-pour': i },
    h('span', { class: 'reconcile-time' }, clock(e.atS)),
    h('span', { class: 'reconcile-name' }, `Pour ${i + 1}`),
    h('label', { class: 'mini-field' }, h('span', { class: 'mini-label' }, 'ml'),
      num(`r-pour-${i}-volumeMl`, e.volumeMl, v => edit(b => B.reconcilePour(b, i, 'volumeMl', v)))),
    h('label', { class: 'mini-field' }, h('span', { class: 'mini-label' }, '°C'),
      num(`r-pour-${i}-tempC`, e.tempC, v => edit(b => B.reconcilePour(b, i, 'tempC', v))))));

  const waterInEl = h('span', { class: 'derived-value', id: 'r-water-in' });
  const retentionEl = h('span', { class: 'derived-value', id: 'r-retention' });
  const ratioEl = h('span', { class: 'derived-value', id: 'r-ratio' });
  const issuesEl = h('div', { id: 'reconcile-status' });
  const drow = (label, valueEl) => h('div', { class: 'derived-row' }, h('span', { class: 'derived-label' }, label), valueEl);

  el.append(
    h('a', { class: 'back', href: `#/recipes/${encodeURIComponent(brew.recipeId)}` }, '‹ Recipe'),
    h('h2', {}, '✓ Brew saved'),
    h('p', { class: 'list-sub' },
      `${recipe ? model.displayName('recipes', recipe) : 'Deleted recipe'} v${brew.recipeVersion ?? 1} · ${when(brew.startedAt)}`),
    h('div', { class: 'derived' },
      row('Ended by', h('span', { id: 'brew-ended-by' }, brew.endedBy === 'cut' ? 'cut (dripper lifted)' : 'drawdown finished')),
      row('Brew time', endS != null ? clock(endS) : '—'),
      row('Taps recorded', h('span', { id: 'brew-taps' }, String(new Set(brew.timeline.map(e => e.tap)).size)))),
    h('div', { class: 'alert alert-info', id: 'drift-hidden' },
      h('strong', {}, 'Phases and drift are hidden for now'),
      h('p', {}, 'Taste and score the cup first, so the numbers can’t steer your score. They are saved and will appear after the assessment.')),

    h('h3', { class: 'section-title' }, 'What actually went in'),
    h('p', { class: 'field-hint' }, 'Prefilled from the plan. Correct any pour that differed. Times come from your taps and can’t be edited.'),
    h('div', { class: 'reconcile', id: 'reconcile-pours' }, pourRows),
    h('form', { class: 'form', onsubmit: ev => ev.preventDefault() },
      h('div', { class: 'field-pair' },
        measured('outputMl', 'Output (ml)', 'r-outputMl'),
        measured('bypassG', 'Bypass (g)', 'r-bypassG')),
      measured('serveTempC', 'Serve temp (°C)', 'r-serveTempC')),
    h('div', { class: 'derived', id: 'reconcile-derived' },
      drow('Water in (pours + bypass)', waterInEl),
      drow('Retention', retentionEl),
      drow('True ratio (output ÷ dose)', ratioEl)),
    issuesEl,
    h('div', { class: 'field' },
      h('label', { class: 'field-label', htmlFor: 'r-notes' }, 'Notes'),
      h('textarea', { id: 'r-notes', rows: 3, value: brew.notes ?? '', oninput: ev => edit(b => B.setMeasured(b, 'notes', ev.target.value)) })),

    h('h3', { class: 'section-title' }, 'Your taps'),
    h('ol', { class: 'coach-done' }, (brew.tapDrift ?? []).map(d => h('li', {},
      h('span', { class: 'coach-plan-time' }, clock(d.actualAtS)),
      h('span', {}, d.label),
      h('span', { class: 'coach-delta' }, `${signed(d.deltaS)} s`)))),
    recipe ? h('button', { type: 'button', class: 'btn btn-primary', id: 'brew-again', onclick: () => actions.newBrew(recipe.id, { fresh: true }) }, 'Brew again') : null);

  function refresh(next) {
    state = next;
    const b = find();
    if (!b) return;
    const o = B.outcomes(b);
    waterInEl.textContent = o.waterInMl === B.UNKNOWN ? UNKNOWN : `${fmt(o.waterInMl)} ml`;
    retentionEl.textContent = o.retentionMl === B.UNKNOWN ? UNKNOWN : `${fmt(o.retentionMl)} ml`;
    ratioEl.textContent = o.trueRatio === B.UNKNOWN ? UNKNOWN : `1:${o.trueRatio.toFixed(1)}`;
    const issues = B.reconcileIssues(b);
    issuesEl.replaceChildren(issues.length
      ? h('ul', { class: 'issues', id: 'reconcile-issues' }, issues.map(x => h('li', {}, x)))
      : h('p', { class: 'ready', id: 'reconcile-ok' }, '✓ Reconciled'));
  }

  refresh(state);
  return { el, refresh };
}
