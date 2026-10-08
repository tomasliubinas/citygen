import { describe, expect, it } from 'vitest';
import type { Vec2 } from '@citygen/core';
import { MAX_ENVELOPE, MIN_ENVELOPE } from '@citygen/house';
import { generateCity, type CityPattern, type CitySpec } from '@citygen/city';
import { insideConvex, overlaps } from '../src/geom';

const PATTERNS: CityPattern[] = ['grid', 'radial', 'organic'];

function streetRect(a: Vec2, b: Vec2, w: number): Vec2[] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const n: Vec2 = [(-(b[1] - a[1]) / len) * (w / 2), ((b[0] - a[0]) / len) * (w / 2)];
  return [[a[0] - n[0], a[1] - n[1]], [b[0] - n[0], b[1] - n[1]], [b[0] + n[0], b[1] + n[1]], [a[0] + n[0], a[1] + n[1]]];
}
const distToSeg = (p: Vec2, a: Vec2, b: Vec2) => {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dz * t);
};
const ccw = (p: Vec2[]) => (p.reduce((s, [x, z], i) => { const [x2, z2] = p[(i + 1) % p.length]; return s + x * z2 - x2 * z; }, 0) < 0 ? [...p].reverse() : p);

function check(city: CitySpec): void {
  expect(city.plots.length).toBeGreaterThan(20);
  const blocks = new Map(city.blocks.map((b) => [b.id, b]));
  for (const p of city.plots) {
    expect(p.width).toBeGreaterThanOrEqual(MIN_ENVELOPE);
    expect(p.depth).toBeGreaterThanOrEqual(MIN_ENVELOPE);
    expect(p.width).toBeLessThanOrEqual(MAX_ENVELOPE);
    expect(p.depth).toBeLessThanOrEqual(MAX_ENVELOPE);
    expect(p.width % 2).toBe(0);
    expect(p.house.envelope.width).toBe(p.width);
    // Inside the buildable lot of its block (so off the streets and sidewalks).
    const lot = blocks.get(p.blockId)!.lot;
    for (const q of p.corners) expect(insideConvex(lot, q, 0.1), `${p.id} outside lot`).toBe(true);
    // Fronts its street: front edge midpoint within half street + sidewalk.
    const st = city.streets[p.streetId];
    const mid: Vec2 = [(p.corners[0][0] + p.corners[1][0]) / 2, (p.corners[0][1] + p.corners[1][1]) / 2];
    expect(distToSeg(mid, st.a, st.b), `${p.id} not on street ${st.id}`).toBeLessThan(st.width / 2 + 3 + 0.6);
  }
  // No overlap with street carriageways.
  for (const st of city.streets) {
    if (Math.hypot(st.b[0] - st.a[0], st.b[1] - st.a[1]) < 1) continue;
    const r = ccw(streetRect(st.a, st.b, st.width - 0.2));
    for (const p of city.plots) expect(overlaps(r, p.corners, 0.05), `${p.id} overlaps street ${st.id}`).toBe(false);
  }
  // No overlap between plots.
  for (let i = 0; i < city.plots.length; i++) {
    for (let j = i + 1; j < city.plots.length; j++) {
      const a = city.plots[i];
      const b = city.plots[j];
      if (Math.hypot(a.center[0] - b.center[0], a.center[1] - b.center[1]) > 90) continue;
      expect(overlaps(a.corners, b.corners, 0.05), `${a.id} overlaps ${b.id}`).toBe(false);
    }
  }
}

describe('city', () => {
  for (const pattern of PATTERNS) {
    it(`${pattern}: plots are valid, front streets and do not overlap`, () => {
      for (const seed of ['vilnius', 'trakai', 'kaunas']) check(generateCity({ seed, size: 420, pattern }));
    });
  }

  it('is deterministic', () => {
    const a = generateCity({ seed: 'vilnius', size: 500, pattern: 'grid' });
    const b = generateCity({ seed: 'vilnius', size: 500, pattern: 'grid' });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('centre plots are narrower than outskirts plots', () => {
    const c = generateCity({ seed: 'vilnius', size: 700, pattern: 'grid' });
    const central = c.plots.filter((p) => p.centrality > 0.6);
    const outer = c.plots.filter((p) => p.centrality < 0.2);
    const avg = (xs: typeof central) => xs.reduce((s, p) => s + p.width, 0) / xs.length;
    expect(central.length).toBeGreaterThan(5);
    expect(outer.length).toBeGreaterThan(5);
    expect(avg(central)).toBeLessThan(avg(outer));
  });
});
