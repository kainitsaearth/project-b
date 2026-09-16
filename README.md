# Project B

Offline-first PWA for competition brew practice. No build step, no dependencies, no backend.

Personal tool. Single user. Android phone-first.

## What it does

Turns brew practice from **recall-based** into **record-based**.

- **Recipe** — the pour plan, written before brewing
- **Brew** — what actually happened, captured by tapping as you pour
- **Drift** — plan vs. actual, per phase, so a bad cup can be blamed on the right thing
- **Assessment** — three categories, judged hot and cooled

## The three things paper can't do

1. **Interrupt you at 55 °C** when the serve window arrives
2. **Timestamp your pours as you make them**, instead of from memory afterward
3. **Tell you what your data doesn't contain** — the untested axes

## Phases

Phases are derived from the timeline and depend on the rig. A V60 has no steep.

| Phase | Present when |
|---|---|
| Bloom | always |
| Percolation | always |
| Steep / immersion | immersion-capable rigs only |
| Lock / swirl | valve-capable rigs only |
| Drawdown | always — ends at `cut` or natural completion |

`cut` (lifting the dripper to end extraction) is a **decision**, not drift. It is recorded as such.

## Files

| File | Role |
|---|---|
| `index.html` | Markup and screens |
| `styles.css` | All styling; light/dark via `prefers-color-scheme` |
| `store.js` | IndexedDB — the only module that touches the database |
| `model.js` | Factories, ids, defaults, rig capability flags |
| `compute.js` | **Pure** — ratio, retention, days off roast, diff |
| `timeline.js` | **Pure** — phase segmentation, drift, cut handling |
| `coach.js` | Pure cue scheduler + thin timer/haptic adapter |
| `ui.js` | Rendering and event wiring |
| `app.js` | `mutate()`, routing, state |
| `tests.js` | Console assertions, run on load |
| `sw.js` | Service worker |

`compute.js`, `timeline.js` and the scheduler half of `coach.js` import nothing and touch no DOM. Data in, data out.

## Development

Service workers need HTTPS or `localhost`:

```sh
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Tests

```sh
node tests.js
```

They also run in the browser console on `localhost`, or on any host with `?test`.

`?simulate=storefail` makes every write fail, to check the **NOT SAVING** chip.

## Deploying

Push to `main`. GitHub Pages serves from the repo root.

> **Bump `CACHE` in `sw.js` and every `?v=` on every change** — in `index.html` *and* in every `import` specifier inside the modules. The same module imported under two different `?v=` values loads twice.

## Design docs

Kept in the Obsidian vault, not this repo:

- `(C) Project B — Design Spec`
- `(C) Project B — Phase 1 Implementation Plan`
