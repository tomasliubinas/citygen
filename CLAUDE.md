# CLAUDE.md

Procedural 3D city generator, built as independent layers: **city → house → interior** (later: furniture/items, NPCs). Frontend-only; everything is computed in the browser from a seed.

## Layout

```
packages/core      seeded RNG (Rng, forkable by key), math, MeshBuilder (renderer-agnostic buffers)
packages/city      CityInput → CitySpec: streets, blocks, plots; each plot carries a HouseInput
packages/house     HouseInput → HouseSpec (semantic) → MeshData; style presets in genome.ts
packages/interior  HouseSpec → InteriorSpec (levels, rooms, walls, doors, stairs, flats) → MeshData
apps/web           three.js viewers: index.html (house editor), city.html (city); src/render/* shared
```

Commands: `npm run dev` · `npm test` · `npx tsc -p tsconfig.json --noEmit` · `npm run build` · `npm run house -- --seed amber --json`.

## Core principles

- **Engine is pure TypeScript**: no DOM, no three.js, no I/O in `packages/*`. Renderers consume specs/mesh buffers. Keep it that way.
- **Each layer only uses the public API of the layer above** (`HouseSpec` is the contract for interior and city; `HouseInput` is what city hands to house).
- **Seeded and stable**: decisions use `Rng.create(seed, …).fork('name')` keyed streams, never shared sequential state — adding a new random choice must not change existing ones. A seed means the same thing everywhere; never special-case a seed (rebalance the style instead; per-style showcase seeds live only in the UI).
- **Genome vs expression**: the seed fixes a house's character (genome); size/location only switch features on/off at stable thresholds, so resizing keeps the house recognisable.
- **Styles are presets** (weights over a shared architectural vocabulary in `genome.ts`). New style = new preset + only the missing vocabulary. UI and city read styles from `STYLES`, so new presets appear automatically. Order: Kaunas Art Deco, Vilnius, Klaipėda, then Classicist manor, Beaux-Arts, Art Nouveau, French Classical.
- **Architectural plausibility matters**: real proportions, bay rhythm, symmetry, odd bay counts, entrance on the axis, tallest windows on the piano nobile. Prefer accurate period detail over invention; correct the user when something is architecturally wrong.
- **Envelope invariant**: all house geometry stays inside its envelope (tests check this). Min envelope 12 m, max floors 4. Building blocks are at most one dual-aspect flat deep; deep plots become U / closed-courtyard plans, or a garden behind the block (`spec.garden`). Party walls (terraced houses) are blind fire walls with gable roof ends.
- **Interior invariant**: every room is reachable through doors/stairs from an entrance, cellar and attic included; flats have one entrance door (tests check this).

## Wear / weathering

- `spec.weathering.condition` (0 new … 1 derelict): from location with a cubic falloff (only the very centre is clean) × the house's age gene; overridable via `HouseInput.wear`. `strength` per style = spot prominence only (Art Nouveau softer, larger patches) — never reduce overall wear per style.
- All dirt is **multiplicative** on the clean surface (never painted over); effects must grow monotonically with wear and fade in smoothly (no hard thresholds).
- Wall patterns use façade-local coordinates (`MeshBuilder.facade()` → `aFacade` attribute) so they move with the wall when resizing. Roofs: one spot field (per-tile + washed-down runs) drives both colour and roughness, so it shows on red tile and black slate.
- Decals (stains, rust) sit in front of any rustication bands; never coplanar (z-fighting flicker).

## Rendering (apps/web)

- Shared look in `src/render/look.ts`: gradient sky + env, GTAO, ACES, procedural surface shader (plaster, brick, ashlar, roof tiles, wear), glass with fake sky reflection, curtains/blinds by wear, lit windows at dusk/night. No textures. Patterns must fade before they alias (moiré).
- City LOD: massing (wear baked into vertex colours, simplified windows) for most houses; detailed houses use the noise-free `LOOK_LITE` shader; full wear/stains only for the ~4 houses in front of the camera. Trees are instanced variants from `src/render/trees.ts` (open leafy crowns, low poly — keep them cheap).
- Settings and camera live in the URL hash (shareable links). Defaults: house page seed `amber`, French Classical, location 0.2; city seed `amber`, organic, 600 m, blocks 1.35, dusk.
- GPU budget matters: prefer cheap tricks (instancing, baked colours, shared materials) over geometry; small details are not worth heavy cost.

## Conventions

- Verify visual changes with a headless Chrome screenshot (swiftshader) and look at it before reporting.
- Run typecheck + tests after engine changes.
- Commit only when asked.
- Build output uses relative paths (`base: './'`); `apps/web/public/.htaccess` must stay in the build.
