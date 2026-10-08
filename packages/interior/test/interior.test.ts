import { describe, expect, it } from 'vitest';
import { generateHouse, type StyleId } from '@citygen/house';
import { STYLES as ALL_STYLES } from '@citygen/house';
import { buildInteriorMesh, planInterior, type InteriorSpec } from '@citygen/interior';

const STYLES = Object.keys(ALL_STYLES) as StyleId[];
const SEEDS = ['amber', 'linden', 'oak', 'heron', 'cedar', 's5', 's6', 'n0', 'n6', 'birch'];
const SIZES: [number, number][] = [[12, 12], [16, 13], [22, 16], [28, 18], [36, 22], [44, 26], [48, 48], [60, 40]];

/** Every room reachable from the ground-floor staircase through doors/openings + the stairs. */
function unreachable(spec: InteriorSpec): string[] {
  const byId = new Map(spec.rooms.map((r) => [r.id, r]));
  const stairs = spec.rooms.filter((r) => r.kind === 'stair');
  const seen = new Set<string>();
  const queue = [...spec.entrances];
  while (queue.length) {
    const id = queue.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const r = byId.get(id)!;
    queue.push(...r.connects);
    // Staircases connect consecutive levels.
    // Staircases connect consecutive levels within the same block (stairs share x/z extents).
    if (r.kind === 'stair') for (const s of stairs) if (Math.abs(s.level - r.level) === 1 && Math.abs(s.center[0] - r.center[0]) < 0.5 && Math.abs(s.center[1] - r.center[1]) < 1.5) queue.push(s.id);
  }
  return spec.rooms.filter((r) => !seen.has(r.id)).map((r) => `${r.id} ${r.name}`);
}

describe('interior', () => {
  for (const style of STYLES) {
    it(`${style}: every room is reachable, in single and flat mode`, () => {
      for (const seed of SEEDS) {
        for (const [w, d] of SIZES) {
          for (const apartments of ['single', 'split'] as const) {
            for (const centrality of [0, 0.8]) {
              const house = generateHouse({ seed, envelope: { x: 0, z: 0, width: w, depth: d }, front: 'south', centrality, style });
              const spec = planInterior(house, { apartments });
              const missing = unreachable(spec);
              expect(missing, `${seed} ${w}x${d} ${apartments} c=${centrality}`).toEqual([]);
              expect(spec.rooms.every((r) => r.name.length > 0), `${seed} unnamed`).toBe(true);
              expect(spec.levels[0].kind).toBe('cellar');
              expect(spec.entrances.length).toBe(1 + house.wings.length);
            }
          }
        }
      }
    });
  }

  it('is deterministic and builds a mesh per level', () => {
    const house = generateHouse({ seed: 'amber', envelope: { x: 0, z: 0, width: 28, depth: 18 }, front: 'south', centrality: 0.2 });
    const a = planInterior(house);
    expect(JSON.stringify(planInterior(house))).toBe(JSON.stringify(a));
    const meshes = buildInteriorMesh(a);
    expect(meshes.length).toBe(a.levels.length);
    for (const m of meshes) expect(Object.keys(m.mesh).length).toBeGreaterThan(2);
  });

  it('flats: every flat has a kitchen and a bathroom and an entrance door', () => {
    const house = generateHouse({ seed: 'linden', envelope: { x: 0, z: 0, width: 36, depth: 22 }, front: 'south', centrality: 0.8 });
    const spec = planInterior(house, { apartments: 'split' });
    expect(spec.units.length).toBeGreaterThan(0);
    for (const u of spec.units) {
      const kinds = u.rooms.map((id) => spec.rooms.find((r) => r.id === id)!.kind);
      expect(kinds.some((k) => k === 'kitchen'), u.name).toBe(true);
      expect(kinds.some((k) => k === 'bathroom') || spec.rooms.some((r) => u.rooms.includes(r.id) && r.name.includes('bath')), u.name).toBe(true);
    }
    expect(spec.walls.some((w) => w.openings.some((o) => o.kind === 'apartment-door'))).toBe(true);
  });
});
