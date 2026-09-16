// ui.js — rendering and event wiring. Reads state, calls actions; never saves.

import * as model from './model.js?v=3';
import { daysOffRoast, UNKNOWN } from './compute.js?v=3';

const LABELS = {
  beans: ['Beans', 'bean'],
  rigs: ['Rigs', 'rig'],
  waters: ['Waters', 'water'],
};

// Tiny element builder. User text always goes in as text nodes, never as HTML.
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(2)) {
    if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

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
  let mountedKey = null;      // editor currently in the DOM
  let refreshDerived = null;  // updates computed rows without rebuilding inputs

  function render(state, route) {
    renderTabs(route.kind);

    if (!route.id) {
      mountedKey = null;
      refreshDerived = null;
      view.replaceChildren(list(route.kind, state[route.kind]));
      return;
    }

    const key = `${route.kind}/${route.id}`;
    const entity = state[route.kind][route.id];
    // Same editor still open: rebuilding it would steal focus mid-typing.
    if (entity && mountedKey === key) {
      refreshDerived?.(entity);
      return;
    }
    mountedKey = entity ? key : null;
    view.replaceChildren(entity ? editor(route.kind, entity) : notFound(route.kind));
    scrollTo(0, 0);
  }

  function renderTabs(active) {
    tabs.replaceChildren(...Object.keys(LABELS).map(k => h('a', {
      href: `#/${k}`,
      class: k === active ? 'tab active' : 'tab',
      'aria-current': k === active ? 'page' : null,
    }, LABELS[k][0])));
  }

  // ---------- list ----------

  function list(kind, items) {
    const [plural, singular] = LABELS[kind];
    const sorted = Object.values(items).sort((a, b) =>
      model.displayName(kind, a).localeCompare(model.displayName(kind, b), undefined, { numeric: true }));

    return h('section', { class: 'screen' },
      h('div', { class: 'screen-head' },
        h('h2', {}, plural),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => actions.create(kind) }, `+ New ${singular}`)),
      sorted.length
        ? h('ul', { class: 'list' }, sorted.map(e => h('li', {},
            h('a', { class: 'list-item', href: `#/${kind}/${encodeURIComponent(e.id)}` },
              h('span', { class: 'list-title' }, model.displayName(kind, e)),
              summary(kind, e)))))
        : h('p', { class: 'empty' }, `No ${plural.toLowerCase()} yet.`));
  }

  function summary(kind, e) {
    const line = parts => {
      const text = parts.filter(p => p != null && p !== '').join(' · ');
      return text ? h('span', { class: 'list-sub' }, text) : null;
    };
    if (kind === 'beans') return [
      line([e.origin, e.process, e.roastLevel]),
      h('span', { class: 'list-sub' }, 'Days off roast: ', h('output', { class: 'days-off-roast' }, beanAge(e))),
    ];
    if (kind === 'rigs') return [
      line([e.grinder, e.dripper, e.filter]),
      h('span', { class: 'badges' }, model.allowedActions(e).map(a => h('span', { class: 'badge' }, a))),
    ];
    return line([e.type, e.ppm != null ? `${e.ppm} ppm` : null]);
  }

  // ---------- editor ----------

  function editor(kind, entity) {
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
        model.FIELDS[kind].map(f => [field(kind, entity, f), f.derivedAfter ? derived : null])),
      // Computed rows sit next to the field that drives them, else at the end.
      model.FIELDS[kind].some(f => f.derivedAfter) ? null : derived,
      h('button', {
        type: 'button', class: 'btn btn-danger',
        onclick: () => {
          if (confirm(`Delete “${model.displayName(kind, entity)}”? This cannot be undone.`)) {
            actions.remove(kind, entity.id);
          }
        },
      }, `Delete ${singular}`));
  }

  function derivedRows(kind, e) {
    const row = (label, value) => h('div', { class: 'derived-row' },
      h('span', { class: 'derived-label' }, label),
      h('span', { class: 'derived-value' }, value));

    if (kind === 'beans') {
      return [row('Days off roast', h('output', { class: 'days-off-roast' }, beanAge(e)))];
    }
    if (kind === 'rigs') {
      const allowed = model.allowedActions(e);
      const blocked = model.ALL_ACTIONS.filter(a => !allowed.includes(a));
      return [
        row('Recipe actions', allowed.join(' · ')),
        blocked.length ? row('Not possible', blocked.join(' · ')) : null,
      ].filter(Boolean);
    }
    return [];
  }

  function field(kind, entity, f) {
    const id = `f-${f.key}`;
    const set = value => actions.update(kind, entity.id, f.key, value);
    const hint = f.hint ? h('small', { class: 'field-hint' }, f.hint) : null;

    if (f.type === 'bool') {
      return h('label', { class: 'toggle' },
        h('input', { type: 'checkbox', id, checked: Boolean(entity[f.key]), onchange: ev => set(ev.target.checked) }),
        h('span', { class: 'toggle-text' }, h('span', { class: 'field-label' }, f.label), hint));
    }

    let control;
    if (f.type === 'textarea') {
      control = h('textarea', { id, rows: 3, value: entity[f.key] ?? '', oninput: ev => set(ev.target.value) });
    } else if (f.type === 'select') {
      control = h('select', { id, onchange: ev => set(ev.target.value) },
        f.options.map(o => h('option', { value: o, selected: entity[f.key] === o }, o)));
    } else if (f.type === 'number') {
      control = h('input', {
        id, type: 'number', inputMode: 'decimal', step: 'any', value: entity[f.key] ?? '',
        oninput: ev => {
          const raw = ev.target.value.trim();
          const n = raw === '' ? null : Number(raw);
          set(Number.isFinite(n) ? n : null);
        },
      });
    } else {
      control = h('input', {
        id, type: 'text', autocomplete: 'off', value: entity[f.key] ?? '',
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

  function notFound(kind) {
    const [plural, singular] = LABELS[kind];
    return h('section', { class: 'screen' },
      h('a', { class: 'back', href: `#/${kind}` }, `‹ ${plural}`),
      h('p', { class: 'empty' }, `This ${singular} doesn't exist any more.`));
  }

  return { render };
}
