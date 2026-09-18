// adviceCard.js — the "what to try next" card. Decisions come from pure advice.js.

import { h } from './dom.js?v=24';
import * as A from './advice.js?v=24';

// state: for the recipe / rig / water the brew points at.
// includeDrift: only after the assessment is submitted (§6.3.1 — drift may not be shown while scoring).
export function adviceCard(state, brew, { includeDrift = false, id = 'advice' } = {}) {
  const recipe = state.recipes[brew?.recipeId] ?? null;
  const rig = state.rigs[brew?.rigId ?? recipe?.rigId] ?? null;
  const water = state.waters[brew?.waterId ?? recipe?.waterId] ?? null;
  const ctx = A.contextFromBrew(brew, { recipe, rig, water });
  const items = A.suggest(ctx, { includeDrift });
  if (!items.length) return null;
  return h('div', { class: 'advice', id },
    h('strong', { class: 'advice-head' }, A.headline(ctx.window)),
    h('ul', { class: 'advice-list' }, items.map(s => h('li', { class: `advice-${s.kind}`, 'data-advice': s.id },
      h('span', { class: 'advice-text' }, s.text),
      h('small', { class: 'advice-why' }, s.why)))),
    h('p', { class: 'field-hint' }, 'Rules of thumb from this brew\u2019s own settings. Nothing here reads your other brews.'));
}
