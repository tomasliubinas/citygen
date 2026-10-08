import { describe, expect, it } from 'vitest';
import { meshBounds } from '@citygen/core';
import { buildHouseMesh, createGenome, generateHouse, type StyleId } from '@citygen/house';
import { STYLES as ALL_STYLES } from '@citygen/house';

const STYLES = Object.keys(ALL_STYLES) as StyleId[];

describe('house', () => {
  it('is deterministic for the same input', () => {
    const input = { seed: 'amber', envelope: { x: 0, z: 0, width: 28, depth: 18 }, front: 'south' as const, centrality: 0.3 };
    expect(JSON.stringify(generateHouse(input))).toBe(JSON.stringify(generateHouse(input)));
  });

  it('keeps the genome when the size changes', () => {
    const a = generateHouse({ seed: 'oak', envelope: { x: 0, z: 0, width: 20, depth: 14 }, front: 'south', centrality: 0 });
    const b = generateHouse({ seed: 'oak', envelope: { x: 0, z: 0, width: 40, depth: 24 }, front: 'south', centrality: 0 });
    expect(a.genome).toEqual(b.genome);
    expect(a.genome).toEqual(createGenome('oak'));
  });

  for (const style of STYLES) {
    it(`${style}: geometry stays inside the envelope`, () => {
      for (const seed of ['amber', 'linden', 'oak', 'heron', 'n0', 's6']) {
        for (const [w, d] of [[12, 12], [22, 16], [36, 22]]) {
          for (const front of ['south', 'east'] as const) {
            const spec = generateHouse({ seed, envelope: { x: 0, z: 0, width: w, depth: d }, front, centrality: 0.4, style });
            const { min, max } = meshBounds(buildHouseMesh(spec));
            const [lw, ld] = [spec.envelope.width, spec.envelope.depth];
            expect(min[0], `${seed} ${w}x${d}`).toBeGreaterThanOrEqual(-lw / 2 - 0.06);
            expect(max[0]).toBeLessThanOrEqual(lw / 2 + 0.06);
            expect(min[2]).toBeGreaterThanOrEqual(-ld / 2 - 0.06);
            expect(max[2]).toBeLessThanOrEqual(ld / 2 + 0.06);
          }
        }
      }
    });
  }
});
