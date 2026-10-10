# Review notices (2026-10-09)

App lifecycle review: start, reload/reopen, new window, temporary objects. Findings only — nothing fixed yet.
Severity: **H** high · **M** medium · **L** low. "Verified" = reproduced, not just read.

## Start, reopen, URL state

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| 1 | **H** | Invalid URL numbers break the house silently: `c=abc` or `floors=abc` produce a house with **0 floors** (just a plinth); `wear=abc` gives `NaN` wear. `normalizeInput` clamps but `clamp(NaN)` stays `NaN`. | Verified |
| 2 | **H** | `front=foo` is accepted: `rotationY` becomes `undefined` → placement breaks. Envelope values (`x0=abc`) give `null` placement. No validation of enum/number params on either page. | Verified |
| 3 | M | No `hashchange` / `popstate` handling. Pasting a new link into the same tab, or Back/Forward, changes the URL but not the scene (state is read only once at start). | Read |
| 4 | M | Reopening is "sticky": the page rewrites the hash on every change (incl. `cam`), so reloading never returns to defaults — a user has to know to strip the `#…`. No "reset to defaults" control. | Read |
| 5 | M | Envelope from the URL is not clamped to editor limits (12–60 m, 80 m extent): a link can put the rectangle off-canvas or oversize; the engine clamps silently, so plan and 3D disagree. | Read |
| 6 | L | City `detail` from the URL is not clamped (`detail=500` → hundreds of detailed houses, GPU stall). `size`/`block` are clamped. | Read |
| 7 | L | `view=` (camera preset) and the default camera are applied only at first load; old links with renamed style ids (`trakai-castle`) silently fall back to the default style while keeping the seed — a different house without notice. | Read |

## New window (city → house editor)

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| 8 | **H** | "Open in house editor" omits `partyWalls` (and `pl`/`pr`): terraced city houses open as free-standing ones with windows on the fire walls — not the same house. | **Fixed** (pl/pr passed) |
| 9 | L | The link also drops time of day (city defaults to dusk, house opens at day) and wear stays auto — usually equal, but not guaranteed if wear rules differ. | Time **fixed**; wear still auto |
| 10 | L | `window.open(..., '_blank')` without `noopener`; same-origin so low risk, but the new tab can reach `window.opener`. | Read |

## Temporary objects / resources

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| 11 | **H** | Material leak in the house viewer: `setSite()` and the garden builder create new materials on **every regenerate** (each slider move), `disposeChildren()` disposes only geometry. GPU memory grows over a long session. | Verified (code) |
| 12 | M | City: materials cache keyed by colour/wear/softness is never pruned across *Regenerate*; tree variant geometries are rebuilt per city and only geometry is disposed. | Read |
| 13 | M | Blob URLs for downloads (JSON, GLB) are revoked synchronously right after `a.click()`; Safari/Firefox can cancel the download. Revoke after a tick. | Read |
| 14 | L | `createLook` keeps a PMREM generator and re-bakes the environment on each time-of-day change; old targets are disposed, the generator never is. | Read |

## Running / background

| # | Sev | Finding | Status |
|---|-----|---------|--------|
| 15 | M | Both pages render continuously (`setAnimationLoop` + GTAO + composer) even when nothing moves → constant GPU load, fans, battery drain. Render on demand (controls change / damping / generation). | Read |
| 16 | M | No `webglcontextlost` / `restored` handling: after a GPU reset or tab restore the canvas stays black until reload. | Read |
| 17 | L | Multiple windows: the navigation mode (localStorage) is shared but not synced live (`storage` event not handled). | Read |
| 19 | M | Stuck progress: city generation and the detail queue have no error handling. If one house throws, the slice loop stops and the panel stays at `houses 120/262` forever (a "spinner" that never ends); the detail pump also stops (`building` reset, no retry). | Read |
| 18 | L | City generation runs in idle slices; if the tab is hidden mid-generation it stalls until visible again (fine), but progress UI gives no hint. | Read |

## Suggested order

1. Input validation for all URL params (1, 2, 5, 6) — small, prevents broken links.
2. City → house link completeness (8, 9).
3. Material disposal in house viewer (11) and city cache pruning (12).
4. Render-on-demand (15) and context-loss handling (16).
5. `hashchange` support + "reset to defaults" (3, 4).
