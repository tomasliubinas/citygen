import { MeshBuilder, Rng } from '@citygen/core';
import type { FacadeSpec, HouseSpec } from '../types';
import { facadeFrame } from './facade';

/**
 * Weathering decals: rain streaks washing down from every sill and soot under
 * the cornice. Plain quads with per-vertex opacity in the 'stain' slot, so any
 * renderer can draw them as a darkening overlay. Strength follows the house's
 * condition; length and shape vary per opening (seeded).
 */
export function buildWeathering(mb: MeshBuilder, spec: HouseSpec): void {
  const cond = spec.weathering.condition;
  // Barely visible: nothing on newer houses, a faint trace on the oldest.
  if (cond < 0.35) return;
  const halfW = spec.envelope.width / 2;
  const pw = spec.input.partyWalls;
  const isParty = (f: FacadeSpec) =>
    Math.abs(f.normal[0]) > 0.5 && ((pw.left && Math.abs(f.a[0] + halfW) < 1e-3) || (pw.right && Math.abs(f.a[0] - halfW) < 1e-3));
  const e1 = spec.floors[1]?.elevation ?? Infinity;
  const rustTop = spec.rusticatedGround ? e1 - 0.17 : -Infinity;
  const wallTop = spec.roof.eaveY - spec.roof.corniceHeight;
  const aTop = 0.03 + 0.12 * cond * cond;
  const main = new Set(spec.facades);
  const all = [...spec.facades, ...spec.towers.flatMap((t) => t.facades)];

  mb.paint('stain', () => {
    for (const fc of all) {
      if (isParty(fc)) continue;
      mb.with(facadeFrame(fc), () => {
        for (const o of fc.openings) {
          if (o.kind !== 'window' && o.kind !== 'stair-window') continue;
          const r = Rng.create(spec.input.seed, 'stain', o.id);
          const top = o.sill - 0.14;
          const L = (0.35 + 1.15 * cond) * r.range(0.55, 1.15);
          const bottom = Math.max(top - L, spec.plinthHeight + 0.1);
          if (top - bottom < 0.15) continue;
          const z = (o.sill < rustTop ? 0.035 : 0) + 0.012;
          // A few soft drip streaks: alpha peaks on each streak's centre line and fades
          // to nothing at its sides and at its foot.
          const streaks = 3 + Math.floor(r.next() * 3);
          for (let k = 0; k < streaks; k++) {
            const cx = o.u + (r.next() - 0.5) * (o.width + 0.15);
            const hw = r.range(0.04, 0.16);
            const len = (top - bottom) * r.range(0.45, 1);
            const a = aTop * r.range(0.5, 1);
            const yb = top - len;
            mb.quadAlpha([cx - hw, yb, z], [cx, yb, z], [cx, top, z], [cx - hw, top, z], [0, 0, a, 0]);
            mb.quadAlpha([cx, yb, z], [cx + hw, yb, z], [cx + hw, top, z], [cx, top, z], [0, 0, 0, a]);
          }
        }
        // Soot and run-off under the cornice of the main body.
        if (main.has(fc) && fc.length > 1.2) {
          const drop = 0.45 + 0.9 * cond;
          const a = 0.08 * cond * cond;
          mb.quadAlpha([0, wallTop - drop, 0.012], [fc.length, wallTop - drop, 0.012], [fc.length, wallTop, 0.012], [0, wallTop, 0.012], [0, 0, a, a]);
        }
      });
    }
  });
}
