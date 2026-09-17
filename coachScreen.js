// coachScreen.js — the pour coach screen and its thin adapter: clock, vibration, sound,
// colour, screen wake lock. All timing decisions come from pure coach.js; this file only
// follows them. Taps go through actions (→ mutate → saved), never straight to storage.

import { h } from './dom.js?v=17';
import * as model from './model.js?v=17';
import * as recipeLib from './recipe.js?v=17';
import * as C from './coach.js?v=17';

// Dev only: ?coachspeed=20 runs brew time 20× faster, for automated checks.
const SPEED = (() => {
  const v = Number(new URLSearchParams(location.search).get('coachspeed'));
  return Number.isFinite(v) && v > 0 ? v : 1;
})();

export const COACH_DEFAULTS = Object.freeze({ sound: true, vibration: true, countIn: true });

const clock = t => {
  if (t == null || !Number.isFinite(t)) return '';
  const neg = t < 0;
  const s = Math.floor(Math.abs(t) + (neg ? 0.999 : 0));
  return `${neg ? '−' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const signed = d => {
  const r = Math.round(d * 10) / 10;
  return r > 0 ? `+${r.toFixed(1)}` : r < 0 ? r.toFixed(1) : '0.0';   // never "−0.0"
};

// The numbers for a step as boxes: one row of tiles per pour.
function stepTiles(fire, { compact = false } = {}) {
  const pours = (fire?.actions ?? []).filter(a => a.type === 'pour');
  if (!pours.length) return null;
  const tile = (label, value, extra) => h('div', { class: 'tile', 'data-tile': label.toLowerCase().replace(/\s+/g, '-') },
    h('span', { class: 'tile-label' }, label),
    h('span', { class: 'tile-value' }, value),
    extra ? h('span', { class: 'tile-extra' }, extra) : null);
  return h('div', { class: `coach-tiles${compact ? ' compact' : ''}` }, pours.map(a => h('div', { class: 'tile-row' },
    tile('Pour', a.volumeMl != null ? `${a.volumeMl} ml` : '?'),
    tile('Scale', a.scaleMl != null ? `${a.scaleMl} g` : '?', a.tareBefore ? 'tared' : null),
    a.tempC != null ? tile('Temp', `${a.tempC}°`) : null,
    a.flowRate != null ? tile('Flow', String(a.flowRate), '/10') : null,
    a.style ? tile('Style', a.style) : null,
    a.valve ? tile('Valve', a.valve) : null,
    a.dripAssist ? tile('Drip assist', 'on') : null)));
}

// ---------- signals: vibration, sound, and a record for checks ----------

function createSignals(settings) {
  let ctx = null;
  const beep = (freq, dur) => {
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.05);
  };
  return {
    // Audio can only start from a user gesture (START, TAP, Test buzz).
    unlock() {
      try {
        if (!ctx) {
          const Ctx = window.AudioContext || window.webkitAudioContext;
          if (Ctx) ctx = new Ctx();
        }
        ctx?.resume?.();
      } catch { /* no audio on this device */ }
    },
    play(kind) {
      const s = settings();
      window.__coachSignals?.push(kind);
      // prep = double buzz: clearly not a countdown tick and not a cue
      if (s.vibration && navigator.vibrate) navigator.vibrate(kind === 'fire' ? [250] : kind === 'tap' ? [25] : kind === 'prep' ? [150, 120, 150] : [70]);
      if (s.sound) {
        if (kind === 'prep') { beep(660, 0.12); setTimeout(() => beep(660, 0.12), 270); }
        else beep(kind === 'fire' ? 1320 : kind === 'tap' ? 520 : 880, kind === 'fire' ? 0.25 : 0.07);
      }
    },
  };
}

// ---------- the screen ----------

// → { el, refresh(state), destroy() }
export function coachScreen(initialState, recipe, actions) {
  let state = initialState;
  const rig = state.rigs[recipe.rigId];
  const sched = C.schedule(recipe, { rig });
  const fires = sched.events.filter(e => e.kind === 'fire');
  const lastPourFire = fires.reduce((m, f, i) => (f.actions.some(a => a.type === 'pour') ? i : m), -1);
  const settings = () => ({ ...COACH_DEFAULTS, ...(state.meta.coach ?? {}) });
  const signals = createSignals(settings);
  window.__coachSignals = [];

  let raf = null;
  let lastT = null;
  let flashUntil = 0;
  let wakeLock = null;
  let builtFor = null;
  let wasPending = false;   // 'idle' | 'running' — which view is in the DOM

  const mine = () => (state.activeBrew?.recipeId === recipe.id ? state.activeBrew : null);
  const tNow = () => {
    const ab = mine();
    return ab ? ((Date.now() - ab.startedAtMs) / 1000) * SPEED : null;
  };

  const keepAwake = async () => {
    try { if (navigator.wakeLock && !wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch { wakeLock = null; }
  };
  const onVisible = () => { if (document.visibilityState === 'visible' && mine()) { wakeLock = null; keepAwake(); } };
  document.addEventListener('visibilitychange', onVisible);

  const el = h('section', { class: 'coach', id: 'coach' });

  // The brew's setup (Step 8), so you can check grind and dose before tapping.
  function setupSummary() {
    const d = state.brewDraft?.recipeId === recipe.id ? state.brewDraft : null;
    const href = `#/setup/${encodeURIComponent(recipe.id)}`;
    if (!d) {
      return h('div', { class: 'hint-box', id: 'coach-setup' }, 'No setup yet. It will copy your last brew on this bean. ',
        h('a', { href, id: 'coach-setup-edit' }, 'Set up brew'));
    }
    const name = (kind, id) => (id && state[kind][id] ? model.displayName(kind, state[kind][id]) : '—');
    const tile = (label, value) => h('div', { class: 'tile' }, h('span', { class: 'tile-label' }, label), h('span', { class: 'tile-value' }, value));
    return h('div', { class: 'coach-setup', id: 'coach-setup' },
      h('div', { class: 'tile-row' },
        tile('Bean', name('beans', d.beanId)),
        tile('Grind', d.grind?.setting != null ? `${d.grind.setting}${d.grind.unit ? ` ${d.grind.unit}` : ''}` : '—'),
        tile('Dose', d.doseG != null ? `${d.doseG} g` : '—'),
        tile('Water', name('waters', d.waterId))),
      h('a', { class: 'btn btn-small', href, id: 'coach-setup-edit' }, 'Change setup'));
  }

  // ---- idle: the plan, settings, START ----
  function idleView() {
    const other = state.activeBrew && !mine() ? state.recipes[state.activeBrew.recipeId] : null;
    const firstPrep = fires[0] ? sched.events.find(e => e.kind === 'prep' && e.fireAtS === fires[0].atS) : null;
    const s = settings();
    const toggle = (key, label) => h('label', { class: 'toggle' },
      h('input', { type: 'checkbox', id: `coach-${key}`, checked: s[key], onchange: ev => actions.setCoachSetting(key, ev.target.checked) }),
      h('span', { class: 'toggle-text' }, h('span', { class: 'field-label' }, label)));

    return h('div', { class: 'coach-idle' },
      h('a', { class: 'back', href: `#/recipes/${encodeURIComponent(recipe.id)}` }, '‹ Recipe'),
      h('div', { class: 'screen-head' },
        h('h2', {}, model.displayName('recipes', recipe)),
        h('span', { class: 'badge badge-version' }, `v${recipe.version ?? 1}`)),
      h('p', { class: 'list-sub' }, `${model.displayName('rigs', rig)} · ${fires.length} cues · ${recipeLib.formatClock(sched.endS)}`),
      setupSummary(),
      h('ol', { class: 'coach-plan', id: 'coach-plan' }, fires.map(f => {
        const prep = sched.events.find(e => e.kind === 'prep' && e.fireAtS === f.atS);
        return h('li', {},
          h('span', { class: 'coach-plan-time' }, recipeLib.formatClock(f.atS)),
          h('span', { class: 'coach-plan-label' }, f.label),
          prep ? h('small', { class: 'coach-plan-prep' }, `Before: ${prep.label}${f === fires[0] ? ' (before you tap)' : prep.buzz ? ` (reminder at ${clock(prep.atS)})` : ' (no room for a reminder buzz)'}`) : null,
          stepTiles(f, { compact: true }));
      })),
      sched.skipped.length ? h('p', { class: 'field-hint' }, `Not cued: ${sched.skipped.map(x => `step ${x.seq} (${x.reason})`).join(', ')}`) : null,
      h('div', { class: 'coach-settings' },
        toggle('vibration', 'Vibration'),
        toggle('sound', 'Sound'),
        toggle('countIn', `${C.POUR_COUNT_IN_S} s count-in after pressing a pour`),
        navigator.vibrate ? null : h('p', { class: 'field-hint', id: 'coach-no-vibrate' }, "This browser can't vibrate. Sound and colour still work."),
        h('button', { type: 'button', class: 'btn', id: 'coach-test', onclick: () => {
          signals.unlock();
          signals.play('tick');
          setTimeout(() => signals.play('fire'), 700);
        } }, 'Test buzz')),
      other
        ? h('div', { class: 'alert alert-danger' },
            h('strong', {}, 'Another brew is in progress'),
            h('a', { class: 'btn', href: `#/brew/${encodeURIComponent(other.id)}` }, `Resume ${model.displayName('recipes', other)}`))
        : [
            firstPrep ? h('div', { class: 'coach-prep', id: 'coach-first-prep' }, `▲ Before you tap: ${firstPrep.label}`) : null,
            h('button', { type: 'button', class: 'coach-tap coach-start', id: 'coach-start', disabled: !fires.length, onclick: () => {
              signals.unlock();
              signals.play('tap');
              // The clock starts at this tap. With the count-in, the tap is 3 s before the first step,
              // so the first pour lands exactly on its planned time.
              const first = fires[0];
              const leadS = settings().countIn && first.actions.some(a => a.type === 'pour') ? C.POUR_COUNT_IN_S : 0;
              const tapAtS = first.atS - leadS;
              actions.startBrew(recipe.id, Date.now() - (tapAtS * 1000) / SPEED, { tapAtS, countInS: leadS });
              keepAwake();
            } }, fires[0]?.label ?? 'START'),
          ],
      h('p', { class: 'field-hint' }, s.countIn
        ? `Tap the button when you're ready: it counts ${C.POUR_COUNT_IN_S} → 1 and the clock starts as you pour. Later pours count in the same way; press when the amber countdown starts and you'll pour on time. CANCEL stops a count.`
        : 'Tap the button as you pour: the clock starts then. The screen stays awake while brewing.'));
  }

  // ---- running ----
  const clockEl = h('div', { class: 'coach-clock', id: 'coach-clock' });
  const prepEl = h('div', { class: 'coach-prep', id: 'coach-prep', hidden: true });
  const countEl = h('div', { class: 'coach-count', id: 'coach-count' });
  const nowEl = h('div', { class: 'coach-now', id: 'coach-now' });
  const detailEl = h('div', { class: 'coach-detail', id: 'coach-detail' });
  const tilesEl = h('div', { class: 'coach-tiles-slot', id: 'coach-tiles' });
  let tilesFor = undefined;   // which fire the tiles show, so they aren't rebuilt every frame
  const showTiles = fire => {
    if (fire === tilesFor) return;
    tilesFor = fire;
    tilesEl.replaceChildren(...[fire ? stepTiles(fire) : null].filter(Boolean));
  };
  const nextEl = h('div', { class: 'coach-next', id: 'coach-next' });
  const press = which => {
    const t = tNow();
    if (t === null) return;
    signals.unlock();
    signals.play('tap');
    actions.brewTap(which, t, { countInS: which === 'main' && settings().countIn ? C.POUR_COUNT_IN_S : 0 });
  };
  const tapBtn = h('button', { type: 'button', class: 'coach-tap', id: 'coach-tap', onclick: () => press('main') });
  const undoBtn = h('button', { type: 'button', class: 'btn', id: 'coach-undo', onclick: () => actions.undoTap() }, 'UNDO');
  const valveBtn = rig?.valveCapable ? h('button', { type: 'button', class: 'btn', id: 'coach-valve', onclick: () => press('valve') }) : null;
  const drawdownBtn = h('button', { type: 'button', class: 'btn', id: 'coach-drawdown', onclick: () => press('drawdown') }, 'DRAWDOWN DONE');
  const cutBtn = rig?.cuttable ? h('button', { type: 'button', class: 'btn btn-cut', id: 'coach-cut', onclick: () => press('cut') }, 'CUT') : null;
  const doneEl = h('ol', { class: 'coach-done', id: 'coach-done' });

  function runningView() {
    tilesFor = undefined;
    return h('div', { class: 'coach-run' },
      h('div', { class: 'coach-top' },
        nowEl,
        h('button', { type: 'button', class: 'btn btn-small', id: 'coach-discard', onclick: () => {
          if (confirm('Discard this brew? Its taps will be lost.')) actions.discardBrew();
        } }, 'Discard')),
      prepEl, tilesEl, detailEl, nextEl,
      // The clock and the countdown sit on the button, so one glance covers all three.
      h('div', { class: 'coach-tapzone' },
        tapBtn,
        h('div', { class: 'coach-tapinfo', 'aria-hidden': 'true' }, clockEl, countEl)),
      h('div', { class: 'coach-secondary' }, undoBtn, valveBtn, drawdownBtn, cutBtn),
      h('h3', { class: 'section-title' }, 'Tapped'),
      doneEl);
  }

  function paintDone() {
    const ab = mine();
    if (!ab) return;
    const t = tNow();
    const rows = C.tapDrift(sched, ab.timeline.filter(e => t === null || e.atS <= t + 1e-6)).reverse();
    doneEl.replaceChildren(...rows.map(d => h('li', { class: Math.abs(d.deltaS) > 5 ? 'late' : '' },
      h('span', { class: 'coach-plan-time' }, clock(d.actualAtS)),
      h('span', {}, d.label),
      h('span', { class: 'coach-delta' }, `${signed(d.deltaS)} s`))));
  }

  function paint(t) {
    const ab = mine();
    if (!ab) return;
    const st = C.stateAt(sched, t);
    const exp = C.expectedTap(sched, ab.timeline, t);
    const ts = C.tapState(sched, ab.timeline);
    const pending = C.pendingCountIn(ab.timeline, t);

    el.dataset.t = t.toFixed(2);
    el.dataset.countIn = pending ? String(pending.countdown) : '';
    // Prep reminder: from its buzz until the pour. During a count-in, the pending pour's prep.
    const pendingFire = pending ? fires[ab.timeline.find(e => e.tap === pending.tap)?.fire] : null;
    const prep = pendingFire ? sched.events.find(e => e.kind === 'prep' && e.fireAtS === pendingFire.atS) ?? null : st.prep;
    prepEl.hidden = !prep;
    prepEl.textContent = prep ? `▲ ${prep.label}` : '';
    clockEl.textContent = clock(t);
    if (!pending && wasPending) paintDone();
    wasPending = Boolean(pending);

    undoBtn.textContent = pending ? 'CANCEL' : 'UNDO';
    undoBtn.disabled = ts.taps === 0;
    if (pending) {
      // Count-in: one thing on screen — the number, and what happens at zero.
      const fire = sched.events.filter(e => e.kind === 'fire')[ab.timeline.find(e => e.tap === pending.tap)?.fire];
      countEl.textContent = String(pending.countdown);
      el.classList.add('cueing');
      el.classList.toggle('fired', performance.now() < flashUntil);
      tapBtn.textContent = `POUR IN ${pending.countdown}`;
      tapBtn.dataset.kind = 'count-in';
      tapBtn.disabled = true;
      nowEl.textContent = fire ? fire.label : 'POUR';
      detailEl.textContent = '';
      showTiles(fire ?? null);
      nextEl.textContent = 'Tap CANCEL to stop';
      if (valveBtn) valveBtn.hidden = true;
      drawdownBtn.hidden = true;
      if (cutBtn) cutBtn.hidden = true;
      return;
    }
    if (cutBtn) cutBtn.hidden = false;

    countEl.textContent = st.countdown ?? '';
    el.classList.toggle('cueing', st.countdown !== null);
    el.classList.toggle('fired', performance.now() < flashUntil);

    tapBtn.textContent = exp.label;
    tapBtn.dataset.kind = exp.kind;
    tapBtn.disabled = exp.kind === 'none';

    // NOW = what the metronome is counting toward; while nothing is counting, what the button does.
    const focus = st.countdown !== null ? st.next : exp.kind === 'action' ? exp.fire : null;
    nowEl.textContent = focus ? `${recipeLib.formatClock(focus.atS)} · ${focus.label}`
      : exp.kind === 'pour-done' ? 'Pouring…' : exp.kind === 'drawdown-complete' ? 'Drawdown' : '';
    // While pouring, the tiles keep showing that pour's numbers (the scale target is what you watch).
    const pouring = exp.kind === 'pour-done' ? fires[ts.fireIndex - 1] ?? null : null;
    showTiles(focus ?? pouring);
    detailEl.textContent = focus ? ''
      : exp.kind === 'pour-done' ? 'Tap POUR DONE when you stop pouring (optional)'
      : exp.kind === 'drawdown-complete' ? 'Tap DRAWDOWN DONE when the bed is dry' : '';
    const after = st.next ? fires[fires.indexOf(st.next) + 1] : null;
    const upcoming = st.countdown !== null ? after : st.next;
    nextEl.textContent = upcoming ? `then ${recipeLib.formatClock(upcoming.atS)} · ${upcoming.label}` : '';
    if (valveBtn) {
      // During a PLANNED steep the only valve action is the planned OPEN VALVE on the big button.
      // A second "open" here would log the opening as a live lock and misclassify the steep.
      valveBtn.hidden = ts.valveClosedBy === 'planned';
      valveBtn.textContent = ts.valve === 'closed' ? 'RELEASE LOCK' : 'LOCK VALVE';
    }
    drawdownBtn.hidden = exp.kind === 'drawdown-complete' || ts.fireIndex <= lastPourFire;
  }

  function frame() {
    raf = null;
    const t = tNow();
    if (t === null) return;
    if (lastT === null) lastT = t;
    const tl = mine()?.timeline ?? [];
    // During a count-in its own ticks replace the plan's, so nothing buzzes twice.
    const buzzes = [
      ...C.buzzesBetween(sched, lastT, t).filter(b => !C.inCountIn(tl, b.atS)),
      ...C.countInBuzzes(tl, lastT, t),
    ].sort((a, b) => a.atS - b.atS);
    // Screen was asleep or the tab hidden: signal only the latest moment, not a burst.
    const toPlay = t - lastT > 1.5 ? buzzes.slice(-1) : buzzes;
    for (const b of toPlay) {
      signals.play(b.type);
      if (b.type === 'fire') flashUntil = performance.now() + 600;
    }
    lastT = t;
    paint(t);
    raf = requestAnimationFrame(frame);
  }

  function build() {
    const want = mine() ? 'running' : 'idle';
    if (want === builtFor) return;
    builtFor = want;
    el.dataset.state = want;
    if (want === 'running') {
      el.replaceChildren(runningView());
      lastT = null;   // resuming after reload: don't replay buzzes that already happened
      paintDone();
      keepAwake();
      if (!raf) raf = requestAnimationFrame(frame);
    } else {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      el.classList.remove('cueing', 'fired');
      el.replaceChildren(idleView());
    }
  }

  build();

  return {
    el,
    refresh(next) {
      state = next;
      build();
      if (mine()) {
        paintDone();
        const t = tNow();
        if (t !== null) paint(t);
      }
    },
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      document.removeEventListener('visibilitychange', onVisible);
      wakeLock?.release?.().catch(() => {});
      wakeLock = null;
    },
  };
}
