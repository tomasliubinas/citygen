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
  buildRust(mb, spec, cond);
  buildCables(mb, spec, cond);
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

/** Rust bleeding down the wall from iron balconies and balconets. */
function buildRust(mb: MeshBuilder, spec: HouseSpec, cond: number): void {
  if (cond < 0.3) return;
  const a = 0.08 + 0.3 * (cond - 0.3);
  mb.paint('rust', () => {
    for (const b of spec.balconies) {
      if (b.railing === 'stone' || b.side !== 'front') continue;
      const r = Rng.create(spec.input.seed, 'rust', b.id);
      const z = b.zFace + 0.014;
      const top = b.y - (b.support === 'consoles' ? 0.28 : 0.05);
      const n = Math.max(2, Math.round((b.x1 - b.x0) / 0.5));
      for (let k = 0; k < n; k++) {
        const cx = b.x0 + ((k + 0.5) / n) * (b.x1 - b.x0) + (r.next() - 0.5) * 0.15;
        const hw = r.range(0.03, 0.08);
        const yb = top - r.range(0.4, 1.4) * (0.5 + cond);
        const al = a * r.range(0.5, 1);
        mb.quadAlpha([cx - hw, yb, z], [cx, yb, z], [cx, top, z], [cx - hw, top, z], [0, 0, al, 0]);
        mb.quadAlpha([cx, yb, z], [cx + hw, yb, z], [cx + hw, top, z], [cx, top, z], [0, 0, 0, al]);
      }
    }
  });
}

/** Old cable runs on the street façade: a line under the first string course, dropping down a corner. */
function buildCables(mb: MeshBuilder, spec: HouseSpec, cond: number): void {
  const r = Rng.create(spec.input.seed, 'cables');
  if (cond < 0.3 || !r.chance(0.35 + 0.6 * cond)) return;
  const fronts = spec.facades.filter((f) => f.side === 'front' && f.normal[1] > 0.5 && f.length > 6);
  const fc = fronts.sort((p, q) => q.length - p.length)[0];
  if (!fc) return;
  const y = (spec.floors[1]?.elevation ?? spec.roof.eaveY - 0.9) - 0.32 - r.range(0, 0.15);
  const out = 0.045;
  const sag = (a: number, b: number, yy: number) => {
    // Gently sagging between clips.
    const n = Math.max(1, Math.round((b - a) / 1.6));
    for (let k = 0; k < n; k++) {
      const u0 = a + ((b - a) * k) / n;
      const u1 = a + ((b - a) * (k + 1)) / n;
      const um = (u0 + u1) / 2;
      mb.beam([u0, yy, out], [um, yy - 0.025, out], 0.022, 0.022);
      mb.beam([um, yy - 0.025, out], [u1, yy, out], 0.022, 0.022);
      mb.box(u0 - 0.02, yy - 0.03, 0, u0 + 0.02, yy + 0.03, out + 0.01);
    }
  };
  mb.with(facadeFrame(fc), () =>
    mb.paint('metal', () => {
      const fromLeft = r.chance(0.5);
      const u0 = 0.35;
      const u1 = fc.length - 0.35;
      sag(u0, u1, y);
      // Down-lead at one corner, and a junction box.
      const ud = fromLeft ? u0 : u1;
      mb.beam([ud, y, out], [ud, spec.plinthHeight + 0.3, out], 0.022, 0.022);
      mb.box(ud - 0.14, spec.plinthHeight + 0.4, 0, ud + 0.14, spec.plinthHeight + 0.75, 0.09);
      if (r.chance(0.5)) sag(u0 + 0.6, u1 - 0.6, y - 0.09);
    }),
  );
}
