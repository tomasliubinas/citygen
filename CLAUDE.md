# CLAUDE.md

Procedural 3D city generator, built as independent layers: **city → house → interior** (later: furniture/items, NPCs). Frontend-only; everything is computed in the browser from a seed.

## Layout

```
packages/core      seeded RNG (Rng, forkable by key), math, MeshBuilder (renderer-agnostic buffers)
packages/city      CityInput → CitySpec: streets, blocks, plots; each plot carries a HouseInput
packages/house     HouseInput → HouseSpec (semantic) → MeshData; style presets in genome.ts
packages/interior  HouseSpec → InteriorSpec (levels, rooms, walls, doors, stairs, flats) → MeshData
apps/web           three.js viewers: index.html (house editor), city.html (city)
```

Commands: `npm run dev` · `npm test` · `npx tsc -p tsconfig.json --noEmit` · `npm run build` · `npm run house -- --seed amber --json`.

## Core principles

- **Engine is pure TypeScript**: no DOM, no three.js, no I/O in `packages/*`. Renderers consume specs/mesh buffers. Keep it that way.
- **Each layer only uses the public API of the layer above** (`HouseSpec` is the contract for interior and city; `HouseInput` is what city hands to house).
- **Seeded and stable**: decisions use `Rng.create(seed, …).fork('name')` keyed streams, never shared sequential state — adding a new random choice must not change existing ones. A seed means the same thing everywhere; never special-case a seed.
- **Genome vs expression**: the seed fixes a house's character (genome); size/location only switch features on/off at stable thresholds, so resizing keeps the house recognisable.
- **Styles are presets** (weights over a shared architectural vocabulary in `genome.ts`). New style = new preset + only the missing vocabulary. UI and city read styles from `STYLES`, so new presets appear automatically. Order: Kaunas, Vilnius, Klaipėda, then the rest.
- **Architectural plausibility matters**: real proportions, bay rhythm, symmetry, odd bay counts, entrance on the axis. Prefer accurate period detail over invention; correct the user when something is architecturally wrong.
- **Envelope invariant**: all house geometry stays inside its envelope (tests check this). Min envelope 12 m, max floors 4 (castle-like towers carry extra height). Building blocks are at most one dual-aspect flat deep; deep plots become U / closed-courtyard plans.
- **Interior invariant**: every room is reachable through doors/stairs from an entrance, cellar and attic included; flats have one entrance door (tests check this).

## Rendering (apps/web)

- Shared look in `src/render/look.ts`: gradient sky + env, GTAO, ACES, procedural surface shader (plaster, brick, ashlar, roof tiles, dirt, wear) — no textures/UVs. Patterns must fade before they alias (moiré).
- City LOD: cheap massing (with simplified windows) for most houses, full detail for the nearest N; full wear/stains only for the few houses in front of the camera.
- Settings and camera live in the URL hash (shareable links). Defaults: house page seed `amber`, French Classical; city seed `amber`, organic, dusk.

## Conventions

- Verify visual changes with a headless Chrome screenshot (swiftshader) and look at it before reporting.
- Run typecheck + tests after engine changes.
- Commit messages: short, one line.
- Build output uses relative paths (`base: './'`); `apps/web/public/.htaccess` must stay in the build.
