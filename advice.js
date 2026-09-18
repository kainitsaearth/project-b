// advice.js — PURE. Imports nothing, touches no DOM, reads no app state, calls no network.
//
// "You said the cup is UNDER/OVER — here's what to try next."
//
// This is the AUTHORED layer only (spec §6.5, layer C): deterministic rules over this brew's own
// numbers. It never looks at other brews, never ranks, never reads quality10. The lookup layer
// that learns from your history is Phase 3 and needs far more than a handful of brews.
//
// Two honesty rules:
//   1. EXECUTION BEFORE RECIPE. If a phase drifted from the plan, the cup may just be a miss,
//      not a bad recipe. Those suggestions come first — and only after the assessment is
//      submitted, because drift may not be shown while scoring (§6.3.1).
//   2. ONE VARIABLE. Every list ends with the reminder, because changing three makes the next
//      cup unattributable (§6.1).

const isNum = v => typeof v === 'number' && Number.isFinite(v);

export const DIRECTIONS = Object.freeze({ under: 'more extraction', over: 'less extraction' });

// Which way to move. 'under' | 'over' | null
export function side(window) {
  if (window === 'under' || window === 'slightly-under') return 'under';
  if (window === 'over' || window === 'slightly-over') return 'over';
  return null;
}
const isSlight = w => w === 'slightly-under' || w === 'slightly-over';

// context (all optional):
//   window, grind {setting, unit}, tempC (hottest planned pour), doseG, waterPpm,
//   daysOffRoast, hasValve, cuttable, usesDripAssist, swirls, drift, endedBy, notes
// opts.includeDrift — only true after the assessment is submitted
// → [{ id, text, why, kind: 'execution' | 'recipe' | 'rule' }]
export function suggest(context = {}, { includeDrift = false, limit = 4 } = {}) {
  const dir = side(context.window);
  if (!dir) return [];
  const step = isSlight(context.window) ? 1 : 2;   // a "slightly" call earns a smaller move
  const out = [];
  const add = (id, text, why, kind = 'recipe') => out.push({ id, text, why, kind });

  // --- 1. execution first: a phase that missed the plan explains the cup before the recipe does
  if (includeDrift && context.drift?.phases) {
    for (const [phase, d] of Object.entries(context.drift.phases)) {
      if (!d || d.exempt || (d.flag !== 'short' && d.flag !== 'long')) continue;
      const late = d.flag === 'long';
      // A drift that pushes the SAME way as the fault is the likely cause.
      const pushes = late ? 'over' : 'under';
      if (pushes !== dir) continue;
      add(`drift-${phase}`, `Hit the plan first: ${phase} ran ${Math.abs(Math.round(d.deltaS))} s ${d.flag}.`,
        `That alone moves the cup ${dir === 'under' ? 'under' : 'over'}. Repeat the recipe as written before changing it.`, 'execution');
    }
  }

  // --- 2. grind: the biggest lever, and the one you can read off the setup
  if (isNum(context.grind?.setting)) {
    const unit = context.grind.unit ?? 'clicks';
    const to = dir === 'under' ? context.grind.setting - step : context.grind.setting + step;
    add('grind', `Grind ${dir === 'under' ? 'finer' : 'coarser'}: ${context.grind.setting} → ${to} ${unit}.`,
      dir === 'under' ? 'More surface area, more extraction.' : 'Less surface area, less extraction.');
  } else {
    add('grind', `Grind ${dir === 'under' ? 'finer' : 'coarser'} by ${step} ${step === 1 ? 'step' : 'steps'}.`,
      'The biggest single lever on extraction.');
  }

  // --- 3. contact time, using what the rig can actually do
  if (dir === 'under') {
    if (context.hasValve) add('contact', 'Keep the valve closed longer, or open it later.', 'Longer contact pulls more out.');
    else add('contact', 'Pour the last pour more slowly, or in smaller pulses.', 'Longer contact pulls more out.');
  } else if (context.cuttable) {
    add('contact', 'Cut earlier: lift the dripper before the bed runs dry.', 'Contact with the spent bed and the paper is where dryness comes from.');
  } else {
    add('contact', 'Open the valve sooner, or finish the last pour earlier.', 'Less contact with the spent bed.');
  }

  // --- 4. temperature
  if (isNum(context.tempC)) {
    const to = dir === 'under' ? Math.min(100, context.tempC + step) : Math.max(70, context.tempC - step);
    add('temp', `Water ${dir === 'under' ? 'hotter' : 'cooler'}: ${context.tempC} → ${to} °C.`, 'Smaller lever than grind. Move it on its own.');
  }

  // --- 5. agitation
  if (dir === 'under') {
    add('agitation', context.usesDripAssist
      ? 'Drop the drip assist on one pour, or raise the flow rate.'
      : 'Add a swirl after the last pour, or pour with more energy.',
      'Agitation mixes the bed and raises extraction.');
  } else {
    add('agitation', context.usesDripAssist
      ? 'Lower the flow rate, or swirl less.'
      : 'Pour gentler (lower flow rate), swirl less, or try a drip assist in practice.',
      'Less churn, fewer fines migrating, less dryness.');
  }

  // --- 6. water, from your own OMB ladder
  if (isNum(context.waterPpm)) {
    if (dir === 'over' && context.waterPpm > 100) {
      add('water', `Drop the water: ${context.waterPpm} → 75 ppm.`, 'Your Test A found 50–75 ppm best; past 125 ppm dryness beats sweetness.');
    } else if (dir === 'under' && context.waterPpm < 75) {
      add('water', `Try 75–100 ppm instead of ${context.waterPpm}.`, 'More minerals, more extraction — 100 ppm is your ceiling before sodium shows.');
    }
  }

  // --- 7. the bean itself
  if (isNum(context.daysOffRoast) && context.daysOffRoast <= 7 && dir === 'under') {
    add('rest', `The coffee is ${context.daysOffRoast} days off roast — it may just need more rest.`, 'Fresh coffee degasses and resists extraction. Wait rather than chase it.');
  }

  const list = out.slice(0, limit);
  if (list.length) {
    list.push({ id: 'one-variable', kind: 'rule',
      text: 'Change ONE of these, not several.',
      why: "Change two and the next cup can't tell you which one did it." });
  }
  return list;
}

// Everything the rules need, read off one brew and the things it points at.
// Pure: the caller hands over the recipe, rig and water; nothing is looked up here.
export function contextFromBrew(brew, { recipe = null, rig = null, water = null } = {}) {
  const pours = (recipe?.plan ?? []).filter(a => a.action === 'pour');
  const temps = pours.map(a => a.tempC).filter(isNum);
  return {
    window: brew?.assessment?.window ?? null,
    grind: brew?.grind ?? null,
    tempC: temps.length ? Math.max(...temps) : null,
    doseG: brew?.doseG ?? null,
    waterPpm: isNum(water?.ppm) ? water.ppm : null,
    daysOffRoast: isNum(brew?.daysOffRoast) ? brew.daysOffRoast : null,
    hasValve: Boolean(rig?.valveCapable),
    cuttable: Boolean(rig?.cuttable),
    usesDripAssist: pours.some(a => a.dripAssist),
    drift: brew?.drift ?? null,
    endedBy: brew?.endedBy ?? null,
  };
}

// A one-line summary for the card's heading.
export function headline(window) {
  const dir = side(window);
  if (!dir) return null;
  const strength = isSlight(window) ? 'a touch ' : '';
  return dir === 'under'
    ? `Tasted ${strength}under: aim for more extraction.`
    : `Tasted ${strength}over: aim for less extraction.`;
}
