// ui.js — rendering and event wiring. Reads state, calls actions; never saves.

import * as model from './model.js?v=24';
import * as recipeLib from './recipe.js?v=24';
import { daysOffRoast, UNKNOWN } from './compute.js?v=24';
import { h, row, fmt, toNum } from './dom.js?v=24';
import { coachScreen } from './coachScreen.js?v=24';
import { setupScreen, setupKey, resultScreen, resultKey } from './brewScreens.js?v=24';
import { assessScreen, assessKey } from './assessScreen.js?v=24';
import { dataScreen } from './dataScreen.js?v=24';
import * as exportLib from './exportData.js?v=24';

const LABELS = {
  recipes: ['Recipes', 'recipe'],
  beans: ['Beans', 'bean'],
  rigs: ['Rigs', 'rig'],
  waters: ['Waters', 'water'],
};

const ACTION_TITLES = {
  pour: 'Pour', swirl: 'Swirl', cut: 'Cut — lift dripper',
};

function todayISO() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function beanAge(bean) {
  const days = daysOffRoast(bean.roastDate, todayISO());
  return days === UNKNOWN ? UNKNOWN : `${days} ${days === 1 ? 'day' : 'days'}`;
}

export function createUI(view, tabs, actions) {
  let mountedKey = null;       // what is in the DOM: "kind/id" (+ "|structure" for recipes)
  let refreshDerived = null;   // updates computed text without rebuilding inputs
  let lastState = null;
  let lastRoute = null;
  let rigPrompt = null;        // { recipeId, rigId, conflicts } — a refused rig switch awaiting a decision
  let scrollToLastStep = false;
  let coach = null;            // live pour coach: { el, refresh, destroy }
  let flow = null;             // setup / result screen: { el, refresh } — refreshed in place while typing

  function render(state, route) {
    lastState = state;
    lastRoute = route;
    if (rigPrompt && rigPrompt.recipeId !== route.id) rigPrompt = null;

    // The coach owns its screen: tabs hidden, its own frame loop, refreshed (never rebuilt) on taps.
    const fullScreen = ['brew', 'result', 'setup', 'assess'].includes(route.kind);
    tabs.hidden = fullScreen;
    if (route.kind !== 'brew' && coach) { coach.destroy(); coach = null; }
    if (!['result', 'setup', 'assess', 'data'].includes(route.kind) && flow) { flow.destroy?.(); flow = null; }
    if (route.kind === 'brew') {
      const key = `brew/${route.id}`;
      if (coach && mountedKey === key) { coach.refresh(state); return; }
      coach?.destroy();
      coach = null;
      mountedKey = key;
      refreshDerived = null;
      const recipe = state.recipes[route.id];
      if (!recipe) { view.replaceChildren(notFound('recipes')); return; }
      coach = coachScreen(state, recipe, actions);
      view.replaceChildren(coach.el);
      scrollTo(0, 0);
      return;
    }
    if (route.kind === 'result' || route.kind === 'setup' || route.kind === 'assess') {
      const key = route.kind === 'setup' ? setupKey(state, route.id)
        : route.kind === 'assess' ? assessKey(state, route.id) : resultKey(state, route.id);
      if (flow && mountedKey === key) { flow.refresh(state); return; }
      const sameScreen = mountedKey?.split('|')[0] === key.split('|')[0];
      flow?.destroy?.();
      mountedKey = key;
      refreshDerived = null;
      flow = route.kind === 'setup' ? setupScreen(state, route.id, actions)
        : route.kind === 'assess' ? assessScreen(state, route.id, actions)
        : resultScreen(state, route.id, actions);
      view.replaceChildren(flow.el);
      if (!sameScreen) scrollTo(0, 0);
      return;
    }
    // Leaving the flow screens (and not going to Data, which keeps its own screen object).
    if (route.kind !== 'data') { flow?.destroy?.(); flow = null; }
    renderTabs(route.kind);

    if (route.kind === 'data') {
      if (flow && mountedKey === 'data') { flow.refresh(state); return; }
      flow?.destroy?.();
      mountedKey = 'data';
      refreshDerived = null;
      flow = dataScreen(state, actions, { schema: actions.schema });
      view.replaceChildren(flow.el);
      scrollTo(0, 0);
      return;
    }

    if (!route.id) {
      mountedKey = null;
      refreshDerived = null;
      view.replaceChildren(list(route.kind, state));
      return;
    }

    const entity = state[route.kind][route.id];
    const baseKey = `${route.kind}/${route.id}`;
    const key = entity && route.kind === 'recipes' ? `${baseKey}|${recipeStructure(state, entity)}` : baseKey;

    // Same screen, same structure: only refresh computed text. Rebuilding would
    // close the phone keyboard mid-number.
    if (entity && mountedKey === key) {
      refreshDerived?.(entity);
      return;
    }

    const sameEntity = mountedKey?.split('|')[0] === baseKey;
    mountedKey = entity ? key : null;
    refreshDerived = null;
    view.replaceChildren(!entity ? notFound(route.kind)
      : route.kind === 'recipes' ? recipeEditor(state, entity)
      : editor(state, route.kind, entity));

    if (scrollToLastStep) {
      scrollToLastStep = false;
      [...view.querySelectorAll('.step')].pop()?.scrollIntoView({ block: 'center' });
    } else if (!sameEntity) {
      scrollTo(0, 0);
    }
  }

  const rerender = () => render(lastState, lastRoute);

  function renderTabs(active) {
    const all = [...Object.keys(LABELS).map(k => [k, LABELS[k][0]]), ['data', 'Data']];
    tabs.replaceChildren(...all.map(([k, label]) => h('a', {
      href: `#/${k}`,
      class: k === active ? 'tab active' : 'tab',
      'aria-current': k === active ? 'page' : null,
    }, label)));
  }

  // ---------- list ----------

  function list(kind, state) {
    const [plural, singular] = LABELS[kind];
    const byName = (a, b) => model.displayName(kind, a).localeCompare(model.displayName(kind, b), undefined, { numeric: true });
    const sorted = Object.values(state[kind]).sort((a, b) =>
      byName(a, b) || (kind === 'recipes' ? (b.version ?? 1) - (a.version ?? 1) : 0));

    const active = kind === 'recipes' && state.activeBrew ? state.recipes[state.activeBrew.recipeId] : null;

    const pendingBackup = kind === 'recipes' && exportLib.shouldNudge(Object.values(state.sessions), state.meta.lastExportAt, Date.now())
      ? exportLib.unexportedBrews(Object.values(state.sessions), state.meta.lastExportAt) : 0;

    return h('section', { class: 'screen' },
      pendingBackup ? h('a', { class: 'alert alert-warn resume-brew', id: 'backup-nudge', href: '#/data' },
        h('strong', {}, `💾 ${pendingBackup} ${pendingBackup === 1 ? 'brew' : 'brews'} not backed up`),
        h('span', {}, 'Tap to export')) : null,
      active ? h('a', { class: 'alert alert-danger resume-brew', id: 'resume-brew', href: `#/brew/${encodeURIComponent(active.id)}` },
        h('strong', {}, '● Brew in progress'),
        h('span', {}, `${model.displayName('recipes', active)} — tap to resume`)) : null,
      h('div', { class: 'screen-head' },
        h('h2', {}, plural),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => actions.create(kind) }, `+ New ${singular}`)),
      sorted.length
        ? h('ul', { class: 'list' }, sorted.map(e => h('li', {},
            h('a', { class: 'list-item', href: `#/${kind}/${encodeURIComponent(e.id)}` },
              h('span', { class: 'list-title' }, model.displayName(kind, e)),
              summary(state, kind, e)))))
        : h('p', { class: 'empty' }, `No ${plural.toLowerCase()} yet.`));
  }

  function summary(state, kind, e) {
    const line = parts => {
      const text = parts.filter(p => p != null && p !== '').join(' · ');
      return text ? h('span', { class: 'list-sub' }, text) : null;
    };
    if (kind === 'recipes') {
      const rig = state.rigs[e.rigId];
      const usage = actions.recipeUsage(e.id);
      const issues = recipeLib.validateRecipe(e, rig);
      const steps = e.plan?.length ?? 0;
      return [
        line([
          rig ? model.displayName('rigs', rig) : 'no rig',
          `${steps} ${steps === 1 ? 'step' : 'steps'}`,
          e.totalWaterMl != null ? `${fmt(e.totalWaterMl)} ml` : null,
          e.targetTotalTimeS != null ? recipeLib.formatClock(e.targetTotalTimeS) : null,
        ]),
        h('span', { class: 'badges' },
          h('span', { class: 'badge' }, `v${e.version ?? 1}`),
          usage > 0 ? h('span', { class: 'badge' }, `🔒 ${usage} ${usage === 1 ? 'brew' : 'brews'}`) : null,
          issues.length
            ? h('span', { class: 'badge badge-warn' }, `${issues.length} to fix`)
            : h('span', { class: 'badge badge-ok' }, 'complete')),
      ];
    }
    if (kind === 'beans') return [
      line([e.origin, e.process, e.roastLevel]),
      h('span', { class: 'list-sub' }, 'Days off roast: ', h('output', { class: 'days-off-roast' }, beanAge(e))),
    ];
    if (kind === 'rigs') return [
      line([e.grinder, e.dripper, e.filter]),
      h('span', { class: 'badges' },
        model.allowedActions(e).map(a => h('span', { class: 'badge' }, a)),
        e.valveCapable ? h('span', { class: 'badge' }, 'valve · steep') : null),
    ];
    return line([e.type, e.ppm != null ? `${e.ppm} ppm` : null]);
  }

  // ---------- generic editor (beans, rigs, waters) ----------

  function editor(state, kind, entity) {
    const [plural, singular] = LABELS[kind];
    const derived = h('div', { class: 'derived' });
    refreshDerived = e => {
      const rows = derivedRows(kind, e);
      derived.replaceChildren(...rows);
      derived.hidden = rows.length === 0;
    };
    refreshDerived(entity);

    return h('section', { class: 'screen' },
      h('a', { class: 'back', href: `#/${kind}` }, `‹ ${plural}`),
      h('h2', {}, `Edit ${singular}`),
      h('form', { class: 'form', onsubmit: ev => ev.preventDefault() },
        model.FIELDS[kind].map(f => [field(state, kind, entity, f), f.derivedAfter ? derived : null])),
      // Computed rows sit next to the field that drives them, else at the end.
      model.FIELDS[kind].some(f => f.derivedAfter) ? null : derived,
      deleteButton(kind, entity));
  }

  function deleteButton(kind, entity) {
    const singular = LABELS[kind][1];
    return h('button', {
      type: 'button', class: 'btn btn-danger',
      onclick: () => {
        if (confirm(`Delete “${model.displayName(kind, entity)}”? This cannot be undone.`)) {
          actions.remove(kind, entity.id);
        }
      },
    }, `Delete ${singular}`);
  }

  function derivedRows(kind, e) {
    if (kind === 'beans') {
      return [row('Days off roast', h('output', { class: 'days-off-roast' }, beanAge(e)))];
    }
    if (kind === 'rigs') {
      const allowed = model.allowedActions(e);
      const blocked = model.ALL_ACTIONS.filter(a => !allowed.includes(a));
      return [
        row('Recipe actions', allowed.join(' · ')),
        row('Valve', e.valveCapable ? 'close on any pour → steep' : 'none'),
        blocked.length ? row('Not possible', blocked.join(' · ')) : null,
      ].filter(Boolean);
    }
    return [];
  }

  function field(state, kind, entity, f, { disabled = false, onSet = null } = {}) {
    const id = `f-${f.key}`;
    const set = onSet ?? (value => actions.update(kind, entity.id, f.key, value));
    const hint = f.hint ? h('small', { class: 'field-hint' }, f.hint) : null;

    if (f.type === 'bool') {
      return h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', id, disabled, checked: Boolean(entity[f.key]), onchange: ev => set(ev.target.checked) }),
        h('span', { class: 'toggle-text' }, h('span', { class: 'field-label' }, f.label), hint));
    }

    let control;
    if (f.type === 'textarea') {
      control = h('textarea', { id, disabled, rows: 3, value: entity[f.key] ?? '', oninput: ev => set(ev.target.value) });
    } else if (f.type === 'select') {
      control = h('select', { id, disabled, onchange: ev => set(ev.target.value) },
        f.options.map(o => h('option', { value: o, selected: entity[f.key] === o }, o)));
    } else if (f.type === 'ref') {
      const current = entity[f.key] ?? '';
      const options = Object.values(state[f.ref])
        .sort((a, b) => model.displayName(f.ref, a).localeCompare(model.displayName(f.ref, b), undefined, { numeric: true }));
      control = h('select', { id, disabled, onchange: ev => set(ev.target.value || null) },
        h('option', { value: '', selected: current === '' }, f.empty),
        current && !state[f.ref][current] ? h('option', { value: current, selected: true }, '(deleted)') : null,
        options.map(o => h('option', { value: o.id, selected: o.id === current }, model.displayName(f.ref, o))));
    } else if (f.type === 'clock') {
      control = clockInput(id, entity[f.key], disabled, set);
    } else if (f.type === 'number') {
      control = h('input', {
        id, disabled, type: 'number', inputMode: 'decimal', step: 'any', value: entity[f.key] ?? '',
        oninput: ev => set(toNum(ev.target.value)),
      });
    } else {
      control = h('input', {
        id, disabled, type: 'text', autocomplete: 'off', value: entity[f.key] ?? '',
        placeholder: f.placeholder, list: f.suggestions ? `${id}-list` : null,
        oninput: ev => set(ev.target.value),
      });
    }

    return h('div', { class: 'field' },
      h('label', { class: 'field-label', htmlFor: id }, f.label),
      control,
      f.suggestions ? h('datalist', { id: `${id}-list` }, f.suggestions.map(s => h('option', { value: s }))) : null,
      hint);
  }

  // Time typed as digits on the number pad (130 = 1:30), or m:ss. Shown as m:ss when you
  // leave the box, and back as digits when you tap in, so no ':' key is ever needed.
  // Unreadable text is saved as "no time" and the input turns red, so a typo never looks
  // the same as a deliberately empty field.
  function clockInput(id, seconds, disabled, set) {
    return h('input', {
      id, type: 'text', inputMode: 'numeric', pattern: '[0-9]*', placeholder: 'mss', class: 'clock', autocomplete: 'off',
      value: recipeLib.formatClock(seconds), disabled,
      onfocus: ev => {
        const s = recipeLib.parseClock(ev.target.value);
        if (s !== null) ev.target.value = recipeLib.clockDigits(s);
      },
      oninput: ev => {
        const raw = ev.target.value;
        const s = recipeLib.parseClock(raw);
        const invalid = raw.trim() !== '' && s === null;
        ev.target.classList.toggle('invalid', invalid);
        ev.target.setAttribute('aria-invalid', String(invalid));
        set(s);
      },
      onchange: ev => {
        const s = recipeLib.parseClock(ev.target.value);
        if (s !== null) ev.target.value = recipeLib.formatClock(s);
      },
    });
  }

  // ---------- recipe editor ----------

  // Anything that changes which inputs exist. Typing into an input never changes this.
  function recipeStructure(state, r) {
    const rig = state.rigs[r.rigId];
    return JSON.stringify([
      r.rigId, recipeLib.allowedActions(rig), Boolean(rig?.valveCapable),
      actions.recipeUsage(r.id) > 0,
      // The valve picker's value decides whether a steep block exists. Which later pours
      // fall inside a steep is NOT here: it changes while typing an open time, and is
      // handled by show/hide in the refresher so the keyboard stays up.
      (r.plan ?? []).map(a => (a.action === 'pour' ? `${a.id}:${a.valve ?? 'open'}` : a.id)),
      rigPrompt?.recipeId === r.id ? rigPrompt.rigId : null,
      state.activeBrew?.recipeId ?? null,
    ]);
  }

  function requestRigChange(recipeId, rigId) {
    rigPrompt = null;
    const conflicts = actions.changeRig(recipeId, rigId);
    if (conflicts.length) {
      rigPrompt = { recipeId, rigId, conflicts };
      rerender();
      document.getElementById('rig-switch-alert')?.scrollIntoView({ block: 'nearest' });
    }
  }

  function recipeEditor(state, recipe) {
    const rig = state.rigs[recipe.rigId];
    const usage = actions.recipeUsage(recipe.id);
    const frozen = usage > 0;
    const refreshers = [];
    refreshDerived = r => refreshers.forEach(fn => fn(r));

    const fields = model.FIELDS.recipes.filter(f => f.section !== 'plan').map(f => {
      if (f.key !== 'rigId') return field(state, 'recipes', recipe, f, { disabled: frozen });
      return [
        field(state, 'recipes', recipe, f, { disabled: frozen, onSet: v => requestRigChange(recipe.id, v) }),
        rigPrompt?.recipeId === recipe.id ? rigSwitchAlert(state, recipe, rigPrompt) : null,
      ];
    });

    const summaryEl = h('div', { class: 'derived recipe-summary', id: 'recipe-summary' });
    refreshers.push(r => summaryEl.replaceChildren(...recipeSummary(state, r)));

    // Brew: only a complete plan can be coached. Enabled/disabled live while typing.
    const otherBrew = state.activeBrew && state.activeBrew.recipeId !== recipe.id ? state.recipes[state.activeBrew.recipeId] : null;
    const brewBtn = h('button', {
      type: 'button', class: 'btn btn-primary btn-brew', id: 'brew-recipe',
      // A brew in progress resumes; otherwise set up the brew first (clone-last, Step 8).
      onclick: () => (state.activeBrew ? (location.hash = `#/brew/${encodeURIComponent(state.activeBrew.recipeId)}`) : actions.newBrew(recipe.id)),
    });
    const brewHint = h('small', { class: 'field-hint', id: 'brew-hint' });
    refreshers.push(r => {
      const ready = recipeLib.validateRecipe(r, state.rigs[r.rigId]).length === 0;
      if (otherBrew) {
        brewBtn.textContent = `Resume brew in progress (${model.displayName('recipes', otherBrew)})`;
        brewBtn.disabled = false;
        brewHint.textContent = '';
      } else {
        brewBtn.textContent = state.activeBrew ? '▶ Resume brew' : '▶ Brew this recipe';
        brewBtn.disabled = !ready;
        brewHint.textContent = ready ? '' : 'Fix the plan first.';
      }
    });

    // Drawdown comes after the last step, so its target sits there too.
    const ddIssues = h('ul', { class: 'issues' });
    const drawdownBlock = h('div', { class: 'drawdown-block', id: 'drawdown-block' },
      model.FIELDS.recipes.filter(f => f.section === 'plan').map(f => field(state, 'recipes', recipe, f, { disabled: frozen })),
      ddIssues);
    refreshers.push(r => {
      const own = recipeLib.validateRecipe(r, state.rigs[r.rigId]).filter(x => x.field === 'targetDrawdownEndS');
      ddIssues.replaceChildren(...own.map(x => h('li', {}, x.message)));
      ddIssues.hidden = own.length === 0;
      drawdownBlock.classList.toggle('has-issues', own.length > 0);
    });

    const el = h('section', { class: 'screen' },
      h('a', { class: 'back', href: '#/recipes' }, '‹ Recipes'),
      h('div', { class: 'screen-head' },
        h('h2', {}, frozen ? 'Recipe' : 'Edit recipe'),
        h('span', { class: 'badge badge-version' }, `v${recipe.version ?? 1}`)),
      frozen ? h('div', { class: 'alert alert-info', id: 'frozen-banner' },
        h('strong', {}, `🔒 Used by ${usage} ${usage === 1 ? 'brew' : 'brews'}`),
        h('p', {}, 'Frozen so past brews keep the plan they ran. Changes go into a new version.'),
        h('button', { type: 'button', class: 'btn btn-primary', id: 'fork-recipe', onclick: () => actions.forkRecipe(recipe.id) },
          'Edit as new version')) : null,
      h('form', { class: 'form', onsubmit: ev => ev.preventDefault() }, fields),
      h('h3', { class: 'section-title' }, 'Plan'),
      summaryEl,
      brewBtn,
      brewHint,
      recipe.plan.length
        ? h('ol', { class: 'steps' }, recipe.plan.map((a, i) => stepCard(state, recipe, rig, a, i, frozen, refreshers)))
        : h('p', { class: 'empty' }, 'No steps yet.'),
      drawdownBlock,
      frozen ? null : addStepBar(recipe, rig),
      h('datalist', { id: 'pour-styles' }, model.POUR_STYLES.map(s => h('option', { value: s }))),
      frozen ? null : deleteButton('recipes', recipe));

    refreshDerived(recipe);
    return el;
  }

  function rigSwitchAlert(state, recipe, p) {
    const target = model.displayName('rigs', state.rigs[p.rigId]);
    const current = state.rigs[recipe.rigId];
    return h('div', { class: 'alert alert-danger', role: 'alert', id: 'rig-switch-alert' },
      h('strong', {}, `Can't switch to ${target} as is`),
      h('ul', {}, p.conflicts.map(c => h('li', {}, c.message))),
      h('p', {}, h('b', {}, 'Nothing has been changed.'), ' To switch anyway, the app would:'),
      h('ul', {}, p.conflicts.map(c => h('li', {}, c.fixText))),
      h('div', { class: 'alert-actions' },
        h('button', {
          type: 'button', class: 'btn btn-primary', id: 'rig-switch-adapt',
          onclick: () => { rigPrompt = null; actions.changeRig(recipe.id, p.rigId, { adapt: true }); },
        }, 'Make these changes and switch'),
        h('button', {
          type: 'button', class: 'btn', id: 'rig-switch-cancel',
          onclick: () => { rigPrompt = null; rerender(); },
        }, current ? `Keep ${model.displayName('rigs', current)}` : 'Cancel')));
  }

  function recipeSummary(state, r) {
    const issues = recipeLib.validateRecipe(r, state.rigs[r.rigId]);
    return [
      row('Total water', r.totalWaterMl != null ? `${fmt(r.totalWaterMl)} ml` : '—'),
      row('Brew ratio', r.targetRatio != null ? `1:${r.targetRatio.toFixed(1)}` : '—'),
      r.plan.some(a => a.closedForS !== undefined)
        ? row('Steep (valve closed)', r.totalSteepS != null ? recipeLib.formatClock(r.totalSteepS) : '—')
        : null,
      r.plan.some(a => a.action === 'pour' && a.dripAssist)
        ? row('With drip assist', `pour ${r.plan.filter(a => a.action === 'pour').map((a, k) => (a.dripAssist ? k + 1 : null)).filter(Boolean).join(', ')}`)
        : null,
      r.plan.some(a => a.action === 'pour' && a.dripAssist)
        ? h('p', { class: 'field-hint', id: 'drip-assist-comp' }, '⚠ Practice only: PCBL rules ban drip assists (nothing between spout and bed).')
        : null,
      row('Drawdown end', r.targetDrawdownEndS != null ? recipeLib.formatClock(r.targetDrawdownEndS) : 'not set'),
      row('Total time', r.targetTotalTimeS != null ? recipeLib.formatClock(r.targetTotalTimeS) : '—'),
      issues.length
        ? h('ul', { class: 'issues', id: 'recipe-issues' }, issues.map(x => h('li', {}, x.message)))
        : h('p', { class: 'ready', id: 'recipe-ready' }, '✓ Plan complete'),
    ];
  }

  function stepCard(state, recipe, rig, a, i, frozen, refreshers) {
    const n = recipe.plan.length;
    const set = (key, value) => actions.editStep(recipe.id, a.id, key, value);
    const inputId = key => `s-${a.id}-${key}`;
    const labeled = (label, control) => h('label', { class: 'mini-field' }, h('span', { class: 'mini-label' }, label), control);
    const num = (key, label) => labeled(label, h('input', {
      id: inputId(key), type: 'number', inputMode: 'decimal', step: 'any',
      value: a[key] ?? '', disabled: frozen, oninput: ev => set(key, toNum(ev.target.value)),
    }));
    const iconBtn = (text, label, disabled, onclick) =>
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': label, title: label, disabled, onclick }, text);

    const clock = labeled('At', clockInput(inputId('atS'), a.atS, frozen, s => set('atS', s)));

    let body = [];
    if (a.action === 'pour') {
      body = [
        num('volumeMl', 'ml'),
        num('tempC', '°C'),
        labeled('Style', h('input', {
          id: inputId('style'), type: 'text', list: 'pour-styles', autocomplete: 'off',
          value: a.style ?? '', disabled: frozen, oninput: ev => set('style', ev.target.value),
        })),
        labeled('Flow rate', h('select', {
          id: inputId('flowRate'), disabled: frozen, onchange: ev => set('flowRate', toNum(ev.target.value)),
        },
          h('option', { value: '', selected: a.flowRate == null }, '—'),
          Array.from({ length: recipeLib.FLOW_RATE_MAX - recipeLib.FLOW_RATE_MIN + 1 }, (_, k) => {
            const v = recipeLib.FLOW_RATE_MIN + k;
            const label = v === recipeLib.FLOW_RATE_MIN ? `${v} low` : v === recipeLib.FLOW_RATE_MAX ? `${v} high` : String(v);
            return h('option', { value: String(v), selected: a.flowRate === v }, label);
          }))),
        h('label', { class: 'toggle toggle-mini' },
          h('input', { type: 'checkbox', id: inputId('dripAssist'), disabled: frozen, checked: Boolean(a.dripAssist),
            onchange: ev => set('dripAssist', ev.target.checked) }),
          h('span', { class: 'mini-label' }, 'With drip assist')),
        h('label', { class: 'toggle toggle-mini' },
          h('input', { type: 'checkbox', id: inputId('tareBefore'), disabled: frozen, checked: Boolean(a.tareBefore),
            onchange: ev => set('tareBefore', ev.target.checked) }),
          h('span', { class: 'mini-label' }, 'Tare before')),
      ];
    } else if (a.action === 'swirl') {
      body = [num('count', 'Swirls')];
    }

    // ---- valve & steep ----
    // Built once per structure; the refresher only shows/hides (see recipeStructure).
    const showValve = Boolean(rig?.valveCapable) || (a.action === 'pour' && a.valve === 'closed');
    let valvePicker = null;
    let steepBlock = null;
    let steepInfo = null;
    const insideNote = h('p', { class: 'valve-inside', hidden: true });
    if (a.action === 'pour' && showValve) {
      valvePicker = labeled('Valve', h('select', { id: inputId('valve'), disabled: frozen, onchange: ev => set('valve', ev.target.value) },
        ['open', 'closed'].map(v => h('option', { value: v, selected: (a.valve ?? 'open') === v }, v))));
      body.push(valvePicker);
      if (a.valve === 'closed') {
        steepInfo = h('output', { class: 'steep-info' });
        steepBlock = h('div', { class: 'steep-block', id: `steep-${a.id}` },
          h('span', { class: 'steep-title' }, 'Steep — valve closed'),
          h('div', { class: 'step-body' },
            labeled('Open valve at', clockInput(inputId('valveOpenAtS'), a.valveOpenAtS, frozen, s => set('valveOpenAtS', s)))),
          steepInfo);
      }
    }

    const cumulative = h('output', { class: 'step-cumulative' });
    const issuesEl = h('ul', { class: 'issues step-issues' });

    const card = h('li', { class: 'step', id: `step-${a.id}`, 'data-action': a.action },
      h('div', { class: 'step-head' },
        h('span', { class: 'step-num' }, i + 1),
        h('span', { class: 'step-action' }, ACTION_TITLES[a.action] ?? a.action),
        frozen ? null : h('span', { class: 'step-tools' },
          iconBtn('↑', `Move step ${i + 1} up`, i === 0, () => actions.moveStep(recipe.id, a.id, -1)),
          iconBtn('↓', `Move step ${i + 1} down`, i === n - 1, () => actions.moveStep(recipe.id, a.id, +1)),
          iconBtn('✕', `Remove step ${i + 1}`, false, () => actions.removeStep(recipe.id, a.id)))),
      h('div', { class: 'step-body' }, clock, body),
      a.action === 'pour' ? cumulative : null,
      steepBlock,
      insideNote,
      issuesEl);

    refreshers.push(r => {
      const s = r.plan.find(x => x.id === a.id);
      if (!s) return;
      if (s.action === 'pour') {
        const tare = card.querySelector(`#${CSS.escape(inputId('tareBefore'))}`);
        if (tare) tare.checked = Boolean(s.tareBefore);
        cumulative.textContent = (s.prep?.length ? `Before: ${s.prep.map(x => x.toLowerCase()).join(', ')} · ` : '')
          + (s.scaleMl != null ? `→ ${fmt(s.scaleMl)} ml on the scale` : '→ ? ml on the scale')
          + (s.scaleMl != null && s.cumulativeMl != null && s.scaleMl !== s.cumulativeMl ? ` (${fmt(s.cumulativeMl)} ml total)` : '');
      }

      // Inside someone else's steep: no own valve choice, just say so.
      const inside = s.valveClosedByStep != null && s.valveClosedByStep !== s.seq;
      insideNote.hidden = !inside;
      if (inside) {
        insideNote.textContent = `Valve still closed from step ${s.valveClosedByStep}`
          + (s.valveClosedUntilS != null ? ` — opens ${recipeLib.formatClock(s.valveClosedUntilS)}` : '');
      }
      if (valvePicker) valvePicker.hidden = inside;
      if (steepBlock) steepBlock.hidden = inside;
      if (steepInfo && !inside) {
        const within = r.plan.filter(x => x.action === 'pour' && x.valveClosedByStep === s.seq && x.seq !== s.seq).map(x => x.seq);
        steepInfo.textContent = s.closedForS != null
          ? `Closed for ${recipeLib.formatClock(s.closedForS)}` + (within.length ? ` · includes pour ${within.join(', ')}` : '')
          : 'Set when to open the valve';
      }
      const own = recipeLib.validateRecipe(r, state.rigs[r.rigId]).filter(x => x.stepId === a.id);
      issuesEl.replaceChildren(...own.map(x => h('li', {}, x.message.replace(/^Step \d+ \([a-z]+\): /, ''))));
      issuesEl.hidden = own.length === 0;
      card.classList.toggle('has-issues', own.length > 0);
    });

    return card;
  }

  function addStepBar(recipe, rig) {
    if (!rig) {
      return h('p', { class: 'hint-box', id: 'add-step-blocked' }, recipe.rigId
        ? "This recipe's rig no longer exists. Pick one above to add steps."
        : 'Pick a rig first. It decides which steps are possible.');
    }
    const allowed = recipeLib.allowedActions(rig);
    return h('div', { class: 'add-steps', id: 'add-steps' },
      h('span', { class: 'mini-label' }, 'Add step'),
      h('div', { class: 'add-steps-buttons' },
        recipeLib.ALL_ACTIONS.filter(x => allowed.includes(x)).map(x => h('button', {
          type: 'button', class: 'btn', 'data-add': x,
          onclick: () => { scrollToLastStep = true; if (!actions.addStep(recipe.id, x)) scrollToLastStep = false; },
        }, `+ ${x}`))));
  }

  function notFound(kind) {
    const [plural, singular] = LABELS[kind];
    return h('section', { class: 'screen' },
      h('a', { class: 'back', href: `#/${kind}` }, `‹ ${plural}`),
      h('p', { class: 'empty' }, `This ${singular} doesn't exist any more.`));
  }

  return { render };
}
