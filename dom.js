// dom.js — tiny shared DOM helpers for ui.js and coachScreen.js.

// Element builder. User text always goes in as text nodes, never as HTML.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(3)) {
    if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export const row = (label, value) => h('div', { class: 'derived-row' },
  h('span', { class: 'derived-label' }, label),
  h('span', { class: 'derived-value' }, value));

export const fmt = n => String(Math.round(n * 10) / 10);

export const toNum = raw => {
  const t = String(raw).trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
