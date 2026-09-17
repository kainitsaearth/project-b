// assessScreen.js — Step 9: the assessment form, a CLEAN screen (spec §6.3.1).
// While scoring it shows nothing that could anchor the score: no phases, no drift, no per-step
// timing, no diff, nothing from any other brew. It reads only this brew's own assessment.
// Answers save as you tap; the cooled reminder buzzes when it's time to taste again.

import { h, toNum } from './dom.js?v=19';
import * as model from './model.js?v=19';
import * as A from './assessment.js?v=19';

const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function assessKey(state, brewId) {
  return `assess/${brewId}`;
}

export function assessScreen(initialState, brewId, actions) {
  let state = initialState;
  const find = () => {
    for (const s of Object.values(state.sessions)) {
      const b = (s.brews ?? []).find(x => x.id === brewId);
      if (b) return b;
    }
    return null;
  };
  const brew = find();
  const el = h('section', { class: 'screen assess', id: 'assess' });
  if (!brew) {
    el.append(h('a', { class: 'back', href: '#/recipes' }, '‹ Recipes'), h('p', { class: 'empty' }, "This brew doesn't exist any more."));
    return { el, refresh() {}, destroy() {} };
  }
  const recipe = state.recipes[brew.recipeId];
  const a0 = brew.assessment ?? A.createAssessment();
  const set = (path, value) => actions.setAssessment(brewId, path, value);
  const prefs = () => ({ cooledAfterMin: A.DEFAULT_COOLED_AFTER_MIN, ...(state.meta.assessment ?? {}) });

  // Big yes / no / unsure buttons. aria-pressed carries the state; refresh() updates it in place.
  const groups = [];   // { path, buttons: Map(value → button) }
  const choice = (path, values, labels = values) => {
    const buttons = new Map();
    const wrap = h('div', { class: 'choice', role: 'group', 'data-path': path },
      values.map((v, i) => {
        const b = h('button', { type: 'button', class: `choice-btn choice-${v}`, 'data-value': v,
          onclick: () => set(path, current(path) === v ? null : v) }, labels[i]);
        buttons.set(v, b);
        return b;
      }));
    groups.push({ path, buttons });
    return wrap;
  };
  const current = path => {
    const a = find()?.assessment ?? A.createAssessment();
    const [head, key] = path.split('.');
    return key ? a[head]?.[key] ?? null : a[head] ?? null;
  };

  const tempBlock = temp => h('div', { class: `assess-temp assess-${temp}`, id: `assess-${temp}` },
    A.CATEGORIES.map(c => h('div', { class: 'assess-q' },
      h('span', { class: 'assess-cat' }, c.label),
      choice(`${temp}.${c.key}`, A.ANSWERS))));

  const tallyEl = h('div', { class: 'assess-tally', id: 'assess-tally' });
  const cooledTimerEl = h('div', { class: 'cooled-timer', id: 'cooled-timer' });
  const skipBtn = h('button', { type: 'button', class: 'btn btn-small', id: 'cooled-skip', onclick: () => set('cooledSkipped', !current('cooledSkipped')) });
  const cooledBody = h('div', {}, tempBlock('cooled'),
    h('div', { class: 'field' },
      h('label', { class: 'field-label', htmlFor: 'a-cooledAtTempC' }, 'Cup temperature when tasted (°C, optional)'),
      h('input', { id: 'a-cooledAtTempC', type: 'number', inputMode: 'decimal', step: 'any', value: a0.cooledAtTempC ?? '',
        oninput: ev => set('cooledAtTempC', toNum(ev.target.value)) })));
  const issuesEl = h('ul', { class: 'issues', id: 'assess-issues' });
  const submitBtn = h('button', { type: 'button', class: 'btn btn-primary btn-brew', id: 'assess-submit',
    onclick: () => actions.submitAssessment(brewId) }, 'Submit and reveal');

  el.append(
    h('a', { class: 'back', href: `#/result/${encodeURIComponent(brewId)}` }, '‹ Brew'),
    h('h2', {}, 'Score the cup'),
    h('p', { class: 'list-sub' }, `${recipe ? model.displayName('recipes', recipe) : 'Deleted recipe'} v${brew.recipeVersion ?? 1}`),
    h('div', { class: 'alert alert-info' },
      h('strong', {}, 'Could a judge rank this cup LAST?'),
      h('p', {}, 'Not "is it good". Yes or unsure means that category could lose you the round. Phases and drift appear after you submit.')),

    h('h3', { class: 'section-title' }, 'Hot'),
    tempBlock('hot'),

    h('h3', { class: 'section-title' }, 'Cooled (serve window)'),
    cooledTimerEl,
    h('label', { class: 'field inline-field' },
      h('span', { class: 'field-label' }, 'Remind me after (min)'),
      h('input', { id: 'a-cooledAfterMin', type: 'number', inputMode: 'numeric', min: 1, step: 1, value: prefs().cooledAfterMin,
        oninput: ev => { const v = toNum(ev.target.value); if (v && v > 0) actions.setAssessmentPref('cooledAfterMin', v); } })),
    cooledBody,
    skipBtn,

    h('h3', { class: 'section-title' }, 'Where does it sit?'),
    choice('window', A.WINDOWS, ['UNDER · sour, hollow', 'IN · sweet, clean', 'OVER · drying, bitter']),

    tallyEl,

    h('form', { class: 'form', onsubmit: ev => ev.preventDefault() },
      h('div', { class: 'field' },
        h('label', { class: 'field-label', htmlFor: 'a-oneFlaw' }, 'The one flaw a judge would punish'),
        h('input', { id: 'a-oneFlaw', type: 'text', autocomplete: 'off', value: a0.oneFlaw ?? '', oninput: ev => set('oneFlaw', ev.target.value) })),
      h('div', { class: 'field' },
        h('label', { class: 'field-label', htmlFor: 'a-descriptors' }, 'Descriptors (optional)'),
        h('input', { id: 'a-descriptors', type: 'text', autocomplete: 'off', value: a0.descriptors ?? '', oninput: ev => set('descriptors', ev.target.value) })),
      h('div', { class: 'field' },
        h('label', { class: 'field-label', htmlFor: 'a-quality10' }, 'Quality impression (optional)'),
        h('select', { id: 'a-quality10', onchange: ev => set('quality10', toNum(ev.target.value)) },
          h('option', { value: '', selected: a0.quality10 == null }, '—'),
          Array.from({ length: A.QUALITY_MAX - A.QUALITY_MIN + 1 }, (_, i) => A.QUALITY_MIN + i)
            .map(v => h('option', { value: String(v), selected: a0.quality10 === v },
              `${v} / 10${A.QUALITY_ANCHORS[v] ? ` · ${A.QUALITY_ANCHORS[v]}` : ''}`))),
        h('small', { class: 'field-hint', id: 'quality-anchors' },
          `1 = ${A.QUALITY_ANCHORS[1]} · 10 = ${A.QUALITY_ANCHORS[10]}. Tracking only. Never ranked, never used for advice.`))),

    issuesEl,
    submitBtn);

  // ---- cooled reminder: buzz + sound + banner, once, while this screen is open ----
  let timer = null;
  let buzzed = false;
  let wakeLock = null;
  let audio = null;
  const endMs = A.brewEndMs(brew);
  const alarm = () => {
    try { navigator.vibrate?.([300, 150, 300, 150, 300]); } catch { /* no vibration */ }
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      audio ??= Ctx ? new Ctx() : null;
      if (audio) {
        for (let i = 0; i < 3; i++) {
          const t = audio.currentTime + i * 0.35;
          const o = audio.createOscillator(); const g = audio.createGain();
          o.frequency.value = 880; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
          o.connect(g).connect(audio.destination); o.start(t); o.stop(t + 0.3);
        }
      }
    } catch { /* no audio */ }
    window.__cooledAlarms = (window.__cooledAlarms ?? 0) + 1;
    // In the background, a buzz inside the page may not reach you: post a system notification.
    // Best effort — Android may pause a background page, so this can arrive late.
    if (document.visibilityState === 'hidden' && window.Notification?.permission === 'granted') {
      navigator.serviceWorker?.ready?.then(reg => reg.showNotification('☕ Taste it cooled now', {
        body: `${recipe ? model.displayName('recipes', recipe) : 'Your brew'}: time for the cooled assessment.`,
        tag: `cooled-${brewId}`, renotify: true, vibrate: [300, 150, 300, 150, 300], requireInteraction: true,
        data: { hash: `#/assess/${encodeURIComponent(brewId)}` },
      })).catch(() => {});
      window.__cooledNotified = (window.__cooledNotified ?? 0) + 1;
    }
  };
  const tick = () => {
    const a = find()?.assessment ?? A.createAssessment();
    const answered = A.CATEGORIES.some(c => a.cooled?.[c.key]);
    if (a.submittedAt || a.cooledSkipped || answered) { cooledTimerEl.hidden = true; return; }
    if (endMs === null) {
      cooledTimerEl.hidden = false;
      cooledTimerEl.textContent = "Brew end time unknown, so there's no reminder.";
      return;
    }
    const p = A.cooledPrompt(endMs, Date.now(), prefs().cooledAfterMin);
    cooledTimerEl.hidden = false;
    cooledTimerEl.classList.toggle('due', p.due);
    cooledTimerEl.dataset.due = String(p.due);
    cooledTimerEl.textContent = p.due ? '🔔 Taste it cooled now' : `Taste it cooled in ${mmss(p.remainingS)}`;
    if (p.due && !buzzed) { buzzed = true; alarm(); }
  };
  timer = setInterval(tick, 500);
  (async () => { try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; } })();

  function refresh(next) {
    state = next;
    const b = find();
    if (!b) return;
    const a = b.assessment ?? A.createAssessment();
    for (const g of groups) {
      const v = current(g.path);
      for (const [value, btn] of g.buttons) btn.setAttribute('aria-pressed', String(v === value));
    }
    cooledBody.hidden = a.cooledSkipped;
    skipBtn.textContent = a.cooledSkipped ? 'I tasted it cooled after all' : "Didn't taste it cooled";
    const t = A.tally(a);
    const v = A.verdict(t.atRisk);
    tallyEl.dataset.atRisk = String(t.atRisk);
    tallyEl.dataset.level = v.level;
    tallyEl.textContent = `At risk: ${t.atRisk} / 3 · ${v.text}`;
    const issues = A.submitIssues(a);
    issuesEl.replaceChildren(...issues.map(x => h('li', {}, x)));
    issuesEl.hidden = issues.length === 0;
    submitBtn.disabled = issues.length > 0;
    tick();
  }

  refresh(state);
  return {
    el,
    refresh,
    destroy() {
      clearInterval(timer);
      wakeLock?.release?.().catch(() => {});
      audio?.close?.().catch?.(() => {});
    },
  };
}
