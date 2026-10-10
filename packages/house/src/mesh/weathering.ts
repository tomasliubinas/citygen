import { MeshBuilder, Rng, rotationY, translation, mul } from '@citygen/core';
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
  buildClutter(mb, spec, cond);
  buildCables(mb, spec, cond);
  // Fades in smoothly with wear: nothing on new houses, clear streaks on derelict ones.
  if (cond < 0.05) return;
  const halfW = spec.envelope.width / 2;
  const pw = spec.input.partyWalls;
  const isParty = (f: FacadeSpec) =>
    Math.abs(f.normal[0]) > 0.5 && ((pw.left && Math.abs(f.a[0] + halfW) < 1e-3) || (pw.right && Math.abs(f.a[0] - halfW) < 1e-3));
  const e1 = spec.floors[1]?.elevation ?? Infinity;
  const rustTop = spec.rusticatedGround ? e1 - 0.17 : -Infinity;
  const wallTop = spec.roof.eaveY - spec.roof.corniceHeight;
  const aTop = 0.6 * cond;
  // Full-wall decals sit in front of rustication bands (0.035), never between them (flicker).
  const zd = spec.rusticatedGround ? 0.055 : 0.02;
  const main = new Set(spec.facades);
  // Inside (reflex) corners of the footprint ring, at facade start (0) or end (1).
  const ring = spec.footprint;
  const innerCorner = (fc: FacadeSpec, end: 0 | 1) => {
    const i = spec.facades.indexOf(fc);
    if (i < 0 || i >= ring.length) return false;
    const n = ring.length;
    const v = end === 0 ? i : (i + 1) % n;
    const p = ring[(v - 1 + n) % n];
    const q = ring[v];
    const r2 = ring[(v + 1) % n];
    const d1 = [q[0] - p[0], q[1] - p[1]];
    const d2 = [r2[0] - q[0], r2[1] - q[1]];
    return d1[1] * d2[0] - d1[0] * d2[1] < 0;
  };
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
          // In front of aprons (to 0.045) and rustication bands, never coplanar with them.
          const z = (o.sill < rustTop ? 0.035 : 0) + 0.06;
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
        // Ground dirt: splash-back rising from the base of the wall.
        if (fc.length > 0.8) {
          const gy = spec.plinthHeight;
          const gh = 0.6 + 1.4 * cond;
          const ga = 0.7 * cond;
          mb.quadAlpha([0, gy, zd], [fc.length, gy, zd], [fc.length, gy + gh, zd], [0, gy + gh, zd], [ga, ga, 0, 0]);
        }
        // Grime collecting in inside corners (where two walls meet), full height.
        const wallH = wallTop - spec.plinthHeight;
        const ca = 0.45 * cond;
        for (const end of [0, 1] as const) {
          // Short walls (risalit returns) skip it: the strip would stick out past the wall
          // and float in front of the façade as a ghost "column".
          if (!main.has(fc) || fc.length < 2 || !innerCorner(fc, end)) continue;
          const gw = Math.min(0.9, fc.length / 2);
          const u0 = end === 0 ? 0 : fc.length - gw;
          const u1 = end === 0 ? gw : fc.length;
          const aL = end === 0 ? ca : 0;
          const aR = end === 0 ? 0 : ca;
          mb.quadAlpha([u0, spec.plinthHeight, zd], [u1, spec.plinthHeight, zd], [u1, spec.plinthHeight + wallH, zd], [u0, spec.plinthHeight + wallH, zd], [aL, aR, aR * 0.4, aL * 0.4]);
        }
        // Soot and run-off under the cornice of the main body.
        if (main.has(fc) && fc.length > 1.2) {
          const drop = 0.45 + 0.9 * cond;
          const a = 0.2 * cond * cond;
          mb.quadAlpha([0, wallTop - drop, 0.012], [fc.length, wallTop - drop, 0.012], [fc.length, wallTop, 0.012], [0, wallTop, 0.012], [0, 0, a, a]);
        }
      });
    }
  });
}

/** Rust bleeding down the wall from iron balconies and balconets. */
function buildRust(mb: MeshBuilder, spec: HouseSpec, cond: number): void {
  if (cond < 0.08) return;
  // Shows from moderate wear on (iron sheds rust long before a house is derelict).
  const a = 0.5 * Math.pow(cond, 1.4);
  mb.paint('rust', () => {
    for (const b of spec.balconies) {
      if (b.railing === 'stone' || b.side !== 'front') continue;
      const r = Rng.create(spec.input.seed, 'rust', b.id);
      const z = b.zFace + 0.014;
      const top = b.y - (b.support === 'consoles' ? 0.28 : 0.05);
      const n = Math.max(2, Math.round((b.x1 - b.x0) / 0.38));
      for (let k = 0; k < n; k++) {
        const cx = b.x0 + ((k + 0.5) / n) * (b.x1 - b.x0) + (r.next() - 0.5) * 0.15;
        const hw = r.range(0.03, 0.08);
        const yb = top - r.range(0.4, 1.6) * (0.6 + cond);
        const al = a * r.range(0.5, 1);
        mb.quadAlpha([cx - hw, yb, z], [cx, yb, z], [cx, top, z], [cx - hw, top, z], [0, 0, al, 0]);
        mb.quadAlpha([cx, yb, z], [cx + hw, yb, z], [cx + hw, top, z], [cx, top, z], [0, 0, 0, al]);
      }
    }
  });
}

/**
 * Old cable runs below the first-floor moulding on any outside wall (not party walls),
 * each in its own colour; more walls and more lines on more worn houses.
 */
function buildCables(mb: MeshBuilder, spec: HouseSpec, cond: number): void {
  const r = Rng.create(spec.input.seed, 'cables');
  // Each house has its own wear level at which cables appear (always by 0.45).
  if (cond < r.range(0.12, 0.45)) return;
  const halfW = spec.envelope.width / 2;
  const pw = spec.input.partyWalls;
  const walls = spec.facades.filter(
    (f) => f.length > 5 && !(Math.abs(f.normal[0]) > 0.5 && ((pw.left && Math.abs(f.a[0] + halfW) < 1e-3) || (pw.right && Math.abs(f.a[0] - halfW) < 1e-3))),
  );
  const colours = ['cableDark', 'cableDark', 'cableGrey', 'cableWhite', 'cableBrown'];
  // Tucked right under the first-floor moulding (whose underside is ~0.17 below floor level).
  const base = (spec.floors[1]?.elevation ?? spec.roof.eaveY - 1.1) - 0.23;
  const out = 0.045;
  walls.forEach((fc, wi) => {
    const rw = Rng.create(spec.input.seed, 'cables', fc.id);
    // The street front always gets cables once they appear; other walls with rising odds.
    const front = fc.side === 'front' && fc === walls.filter((f) => f.side === 'front').sort((p, q) => q.length - p.length)[0];
    if (!front && !rw.chance(0.25 + 0.6 * cond)) return;
    const lines = 1 + (cond > 0.4 ? 1 : 0) + (cond > 0.7 && rw.chance(0.5) ? 1 : 0);
    mb.with(facadeFrame(fc), () => {
      for (let k = 0; k < lines; k++) {
        const y = base - k * 0.07 - rw.range(0, 0.04);
        const u0 = 0.35 + k * 0.5;
        const u1 = fc.length - 0.35 - k * 0.5;
        if (u1 - u0 < 2) continue;
        mb.paint(colours[(wi * 3 + k + rw.int(0, 4)) % colours.length], () => {
          const n = Math.max(1, Math.round((u1 - u0) / 1.6));
          for (let j = 0; j < n; j++) {
            const a0 = u0 + ((u1 - u0) * j) / n;
            const a1 = u0 + ((u1 - u0) * (j + 1)) / n;
            const am = (a0 + a1) / 2;
            mb.beam([a0, y, out], [am, y - 0.025, out], 0.022, 0.022);
            mb.beam([am, y - 0.025, out], [a1, y, out], 0.022, 0.022);
            mb.box(a0 - 0.02, y - 0.03, 0, a0 + 0.02, y + 0.03, out + 0.01);
          }
          // The first line drops down a corner to a junction box.
          if (k === 0) {
            const ud = rw.chance(0.5) ? u0 : u1;
            mb.beam([ud, y, out], [ud, spec.plinthHeight + 0.3, out], 0.022, 0.022);
          }
        });
        if (k === 0) {
          mb.paint('metal', () => {
            const ud = rw.chance(0.5) ? u0 : u1;
            mb.box(ud - 0.14, spec.plinthHeight + 0.4, 0, ud + 0.14, spec.plinthHeight + 0.75, 0.09);
          });
        }
      }
    });
  });
  void r;
}

/**
 * Back-yard clutter on worn houses: boxes, crates, bins, barrels, a leaning pallet — along the
 * back wall, clear of the garden steps, inside the plot. None on clean houses.
 */
function buildClutter(mb: MeshBuilder, spec: HouseSpec, cond: number): void {
  const backs = spec.facades.filter((f) => f.side === 'back' && f.length > 4).sort((p, q) => q.length - p.length);
  const fc = backs[0];
  if (!fc) return;
  const r = Rng.create(spec.input.seed, 'clutter');
  // Amount scales with wall length: up to ~0.55 items per metre on a derelict house.
  const n = Math.round(Math.pow(Math.max(0, cond - 0.15) / 0.85, 1.4) * 0.55 * fc.length);
  if (n < 1) return;
  const gs = spec.stairs.find((st) => st.role === 'garden');
  const clear = gs ? [gs.x0 - gs.steps * 0.34 - 2.0, gs.x1 + gs.steps * 0.34 + 2.0] : [0, 0];
  const dx = (fc.b[0] - fc.a[0]) / fc.length;
  const maxOut = Math.max(0.6, Math.min(1.25, (fc.a[1] + spec.envelope.depth / 2) * Math.abs(fc.normal[1]) - 0.15));
  // Junk gathers in heaps: 1–3 clusters, items touching in two rough rows, each heap
  // leaning towards one kind (a row of bins, a pile of boxes and crates…).
  // About one heap per 7 m of wall (fewer on less worn houses).
  const clusters = Math.max(1, Math.round((fc.length / 7) * Math.min(1, 0.4 + cond)));
  const kinds = [['box', 4], ['crate', 3], ['bin', 2], ['barrel', 2], ['pallet', 1.5], ['sack', 2], ['bucket', 1.5], ['planks', 1.5], ['tyres', 1]] as const;
  const used: [number, number][] = [];
  // Near derelict, some heaps grow taller (own stream: existing choices stay put).
  const rp = Rng.create(spec.input.seed, 'clutter-pile');
  const pile = Math.max(0, Math.min(1, (cond - 0.75) / 0.25));
  mb.with(facadeFrame(fc), () => {
    for (let c = 0; c < clusters; c++) {
      const per = Math.round(n / clusters + (r.next() - 0.5) * 2);
      if (per < 1) continue;
      let uc = 0;
      for (let t = 0; t < 30; t++) {
        uc = 2.5 + r.next() * Math.max(0, fc.length - 5);
        const xw = fc.a[0] + dx * uc;
        const span = per * 0.35;
        if ((xw + span > clear[0] && xw - span < clear[1]) || used.some(([lo, hi]) => uc + span > lo && uc - span < hi)) { uc = -1; continue; }
        break;
      }
      if (uc < 0) continue;
      const fav = r.weighted(kinds);
      let left = uc;
      let right = uc;
      const back: [number, number][] = [];
      for (let k = 0; k < per; k++) {
        let kind: Clutter = r.chance(0.3) ? fav : r.weighted(kinds);
        const wdt = kind === 'bin' ? 0.62 : kind === 'barrel' ? 0.6 : kind === 'pallet' ? 1.2 : kind === 'planks' ? 1.6 : kind === 'tyres' ? 0.65 : kind === 'bucket' ? 0.32 : 0.4 + r.next() * 0.35;
        // Back row against the wall first; some items land in a front row, in front of the heap.
        const front = k > 1 && kind !== 'pallet' && kind !== 'bin' && kind !== 'planks' && r.chance(0.35);
        let u: number;
        if (front && back.length) {
          const [a0, a1] = back[Math.floor(r.next() * back.length)];
          u = (a0 + a1) / 2 + (r.next() - 0.5) * 0.3;
        } else if (k % 2 === 0) {
          u = right + wdt / 2 + 0.03;
          right = u + wdt / 2;
        } else {
          u = left - wdt / 2 - 0.03;
          left = u - wdt / 2;
        }
        const xw = fc.a[0] + dx * u;
        if (u < 1.5 || u > fc.length - 1.5 || (xw > clear[0] && xw < clear[1])) continue;
        if (!front) back.push([u - wdt / 2, u + wdt / 2]);
        // Boards never lean against a window or door: lay a pallet stack there instead.
        if (kind === 'planks' && fc.openings.some((o) => o.sill < 2.4 && Math.abs(o.u - u) < o.width / 2 + wdt / 2 + 0.2)) kind = 'pallet';
        // Leaning things stand 0.5 m out with their tops resting on the wall; the rest sit near it.
        const out = kind === 'planks' ? 0.5 : Math.min(maxOut - wdt / 2, (front ? 0.85 : 0.18) + wdt / 2);
        const turn = kind === 'planks' ? 0 : (r.next() - 0.5) * (front ? 0.8 : 0.3);
        mb.with(mul(translation(u, 0, out), rotationY(turn)), () => clutterItem(mb, kind, wdt, r, !front && rp.chance(pile * 0.6)));
      }
      used.push([left - 0.6, right + 0.6]);
    }
  });
}

type Clutter = 'box' | 'crate' | 'bin' | 'barrel' | 'pallet' | 'sack' | 'bucket' | 'planks' | 'tyres';

/** Simple-shaped junk: a few boxes / cylinders each, cheap and readable. */
function clutterItem(mb: MeshBuilder, kind: Clutter, w: number, r: Rng, high = false): void {
  const h2 = w / 2;
  const more = high ? 2 : 0;
  if (kind === 'box') {
    // One to three cardboard boxes stacked, each smaller and a little askew.
    const stack = 1 + Math.floor(r.next() * 3) + more;
    let y = 0;
    let s = w;
    mb.paint('cardboard', () => {
      for (let k = 0; k < stack; k++) {
        const hh = s * (0.6 + r.next() * 0.3);
        mb.with(mul(translation((r.next() - 0.5) * 0.06, y, (r.next() - 0.5) * 0.06), rotationY((r.next() - 0.5) * 0.4)), () => mb.box(-s / 2, 0, -s * 0.4, s / 2, hh, s * 0.4));
        y += hh;
        s *= high ? 0.9 : 0.8;
      }
    });
  } else if (kind === 'crate') {
    // Solid wooden crate with two darker bands.
    const h = w * 0.75;
    for (let k = 0; k <= (high ? 2 : 0); k++) {
      mb.with(mul(translation((r.next() - 0.5) * 0.08, k * h, 0), rotationY(k ? (r.next() - 0.5) * 0.3 : 0)), () => {
        mb.paint('crate', () => mb.box(-h2, 0, -h2, h2, h, h2));
        mb.paint('cardboard', () => {
          for (const y of [h * 0.3, h * 0.7]) mb.box(-h2 - 0.01, y - 0.03, -h2 - 0.01, h2 + 0.01, y + 0.03, h2 + 0.01);
        });
      });
    }
  } else if (kind === 'bin') {
    mb.paint(r.chance(0.5) ? 'binGreen' : 'binGrey', () => {
      mb.box(-0.29, 0.04, -0.3, 0.29, 1.0, 0.3);
      mb.box(-0.31, 1.0, -0.33, 0.31, 1.06, 0.33);
    });
  } else if (kind === 'barrel') {
    mb.paint(r.chance(0.5) ? 'rust' : 'binGrey', () => mb.lathe([[0, 0], [0.29, 0], [0.3, 0.9], [0, 0.9]], 10));
  } else if (kind === 'pallet') {
    // Stacked pallets: each a flat deck on a slotted base.
    const n = 2 + Math.floor(r.next() * 5) + more * 3;
    mb.paint('crate', () => {
      for (let k = 0; k < n; k++) {
        const y = k * 0.145;
        mb.with(mul(translation((r.next() - 0.5) * 0.05, y, (r.next() - 0.5) * 0.05), rotationY((r.next() - 0.5) * 0.08)), () => {
          mb.box(-0.6, 0.1, -0.4, 0.6, 0.14, 0.4);
          for (const x of [-0.55, 0, 0.55]) mb.box(x - 0.05, 0, -0.4, x + 0.05, 0.1, 0.4);
        });
      }
    });
  } else if (kind === 'sack') {
    // Rubble / sand sacks: squat rounded lumps, sometimes two.
    mb.paint('sack', () => {
      const k = r.chance(0.5) ? 2 : 1;
      for (let i = 0; i < k; i++) mb.with(translation(i * 0.3 - 0.15 * (k - 1), 0, 0), () => mb.lathe([[0, 0], [0.22, 0], [0.24, 0.12], [0.18, 0.28], [0, 0.3]], 8));
    });
  } else if (kind === 'bucket') {
    mb.paint(r.chance(0.5) ? 'binGrey' : 'cardboard', () => mb.lathe([[0, 0], [0.12, 0], [0.16, 0.3], [0, 0.3]], 10));
  } else if (kind === 'planks') {
    // A few planks leaning against the wall.
    mb.paint('crate', () => {
      for (let i = 0; i < 3 + Math.floor(r.next() * 3); i++) {
        const x = -0.7 + r.next() * 1.4;
        // Foot out from the wall (+z), top resting against it (wall face at z = -0.5).
        const foot = r.next() * 0.15;
        mb.beam([x, 0, foot], [x + (r.next() - 0.5) * 0.3, 1.6 + r.next() * 0.6, -0.46], 0.04, 0.14, [0, 0, 1]);
      }
    });
  } else {
    // A stack of old tyres.
    mb.paint('void', () => {
      const n = 2 + Math.floor(r.next() * 3) + more * 2;
      for (let i = 0; i < n; i++) mb.with(translation((r.next() - 0.5) * 0.05, i * 0.2, 0), () => mb.lathe([[0.15, 0], [0.32, 0], [0.32, 0.2], [0.15, 0.2], [0.15, 0]], 12));
    });
  }
}
