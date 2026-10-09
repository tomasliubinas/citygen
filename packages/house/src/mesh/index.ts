import { MeshBuilder, frame, rotationY, mul, translation, type MeshData, type Vec2, type Vec3 } from '@citygen/core';
import type { HouseSpec, OrielSpec, TowerSpec } from '../types';
import { pediment, railing } from './elements';
import { buildFacades, buildSimpleFacade, facadeFrame } from './facade';
import { buildRoof } from './roof';
import { buildBalcony, buildPortico, buildStair } from './structures';
import { buildWeathering } from './weathering';

/** Material slots used by the house mesh; colours come from `spec.palette`. */
export const HOUSE_MATERIALS = ['wall', 'trim', 'stone', 'roof', 'glass', 'frame', 'door', 'metal', 'roofTrim', 'accent', 'stain', 'rust', 'cableDark', 'cableGrey', 'cableWhite', 'cableBrown'] as const;
export type HouseMaterial = (typeof HOUSE_MATERIALS)[number];

/** HouseSpec → renderer-agnostic triangle buffers (building-local coordinates). */
export function buildHouseMesh(spec: HouseSpec): MeshData {
  const mb = new MeshBuilder();
  buildFacades(mb, spec);
  buildMouldings(mb, spec);
  buildRoof(mb, spec);
  for (const p of spec.pediments) pediment(mb, p);
  for (const t of spec.towers) buildTower(mb, spec, t);
  for (const o of spec.oriels) buildOriel(mb, spec, o);
  if (spec.portico) buildPortico(mb, spec.portico, spec);
  for (const s of spec.stairs) {
    const fc = s.facadeId ? spec.facades.find((f) => f.id === s.facadeId) : undefined;
    if (fc) mb.with(facadeFrame(fc), () => buildStair(mb, s));
    else buildStair(mb, s);
  }
  for (const b of spec.balconies) buildBalcony(mb, b, spec);
  if (spec.parapet) {
    const y = spec.parapet.baseY;
    for (const [a, b] of spec.parapet.segments) railing(mb, [a[0], y, a[1]], [b[0], y, b[1]], 'stone', 0.9);
  }
  buildWeathering(mb, spec);
  return mb.bake();
}

/** Horizontal articulation: plinth, string courses between floors, main cornice. */
function buildMouldings(mb: MeshBuilder, spec: HouseSpec): void {
  buildRingMouldings(mb, spec, spec.footprint);
  if (spec.courtyard) buildRingMouldings(mb, spec, spec.courtyard);
}

function buildRingMouldings(mb: MeshBuilder, spec: HouseSpec, fp: Vec2[]): void {
  // Party walls: mouldings stop at the plot edge (they continue on the neighbour).
  const halfW = spec.envelope.width / 2;
  const pw = spec.input.partyWalls;
  const partyEdge = (i: number) => {
    const a = fp[i];
    const b = fp[(i + 1) % fp.length];
    return Math.abs(a[0] - b[0]) < 1e-6 && ((pw.left && Math.abs(a[0] + halfW) < 1e-3) || (pw.right && Math.abs(a[0] - halfW) < 1e-3));
  };
  const chains: Vec2[][] = [];
  const firstParty = fp.findIndex((_, i) => partyEdge(i));
  if (firstParty < 0) chains.push(fp);
  else {
    let cur: Vec2[] = [];
    for (let k = 1; k <= fp.length; k++) {
      const i = (firstParty + k) % fp.length;
      if (!cur.length) cur.push(fp[i]);
      if (partyEdge(i)) {
        if (cur.length > 1) chains.push(cur);
        cur = [];
      } else cur.push(fp[(i + 1) % fp.length]);
    }
    if (cur.length > 1) chains.push(cur);
  }
  const sweepRing = (profile: Vec2[]) => {
    for (const c of chains) mb.sweep(c, profile, c === fp);
  };
  const ph = spec.plinthHeight;
  mb.paint('stone', () =>
    sweepRing([[-0.3, 0], [0.09, 0], [0.09, ph - 0.13], [0.12, ph - 0.1], [0.14, ph - 0.04], [0.14, ph], [-0.3, ph]]),
  );
  mb.paint('trim', () => {
    for (const f of spec.genome.stringCourses ? spec.floors.slice(1) : []) {
      const y = f.elevation;
      sweepRing([[-0.1, y - 0.17], [0.04, y - 0.17], [0.06, y - 0.13], [0.06, y - 0.03], [0.1, y], [0.1, y + 0.05], [-0.1, y + 0.05]]);
    }
    const top = spec.roof.eaveY;
    const y0 = top - spec.roof.corniceHeight;
    const P = spec.roof.corniceProjection;
    if (spec.genome.eaves === 'parapet') {
      // Interwar parapet: flat band at the top of the wall, a plain parapet above the roof line, thin coping.
      sweepRing([[-0.3, y0], [0.03, y0], [0.03, y0 + 0.5], [0.07, y0 + 0.52], [0.07, top + 0.75], [0.1, top + 0.78], [0.1, top + 0.9], [-0.18, top + 0.9], [-0.18, top - 0.1]]);
      // (Last segment: the parapet's inner face, seen from the roof.)
      return;
    }
    if (spec.genome.eaves === 'corbel') {
      // Brick corbel table: stepped courses; the small arched frieze comes with the facades.
      sweepRing([[-0.3, y0], [0.04, y0], [0.04, y0 + 0.14], [0.1, y0 + 0.16], [0.1, y0 + 0.3], [0.18, y0 + 0.32], [0.18, y0 + 0.46], [P, y0 + 0.48], [P, top], [-0.3, top]]);
      return;
    }
    if (spec.genome.eaves === 'bracketed') {
      // Frieze band + deep boarded soffit with a fascia; brackets come with the facades.
      sweepRing([[-0.3, y0], [0.03, y0], [0.03, y0 + 0.1], [0.06, y0 + 0.13], [0.06, top - 0.14], [P, top - 0.14], [P, top + 0.06], [-0.3, top + 0.06]]);
      return;
    }
    mb.sweep(
      fp,
      [
        [-0.3, y0], [0.04, y0], [0.04, y0 + 0.13], [0.07, y0 + 0.16], [0.07, y0 + 0.18], [0.04, y0 + 0.18],
        [0.04, y0 + 0.28], [0.1, y0 + 0.3], [P - 0.04, y0 + 0.31], [P - 0.04, y0 + 0.45], [P - 0.01, y0 + 0.48],
        [P, y0 + 0.56], [P, top], [-0.3, top],
      ],
      true,
    );
  });
}

const STRING_COURSE = (y: number): Vec2[] => [[-0.1, y - 0.17], [0.04, y - 0.17], [0.06, y - 0.13], [0.06, y - 0.03], [0.1, y], [0.1, y + 0.05], [-0.1, y + 0.05]];

/** Octagonal corner tower: walls, mouldings, an extra belvedere stage and a cone or bell roof. */
function buildTower(mb: MeshBuilder, spec: HouseSpec, t: TowerSpec): void {
  const ph = spec.plinthHeight;
  const eave = spec.roof.eaveY;
  for (const fc of t.facades) buildSimpleFacade(mb, spec, fc, 0, t.wallTop, 0.45, [t.wallTop - 0.62, t.wallTop - 0.27]);
  mb.paint('stone', () =>
    mb.sweep(t.outline, [[-0.3, 0], [0.09, 0], [0.09, ph - 0.13], [0.12, ph - 0.1], [0.14, ph - 0.04], [0.14, ph], [-0.3, ph]], true),
  );
  mb.paint('trim', () => {
    if (spec.genome.stringCourses) for (const f of spec.floors.slice(1)) mb.sweep(t.outline, STRING_COURSE(f.elevation), true);
    // A band where the main cornice meets the tower, and the tower's own cornice.
    const yb = eave - spec.roof.corniceHeight;
    mb.sweep(t.outline, [[-0.1, yb], [0.08, yb], [0.12, yb + 0.12], [0.12, yb + 0.3], [-0.1, yb + 0.3]], true);
    const y0 = t.wallTop - 0.05;
    const top = t.roofBaseY;
    mb.sweep(t.outline, [[-0.3, y0], [0.04, y0], [0.04, y0 + 0.1], [0.1, y0 + 0.15], [0.3, top - 0.1], [0.35, top - 0.06], [0.35, top], [-0.3, top]], true);
  });
  const [cx, cz] = t.center;
  const Rb = (t.apothem + 0.35) / Math.cos(Math.PI / t.sides);
  const H = t.roofHeight;
  const prof: Vec2[] =
    t.roof === 'pyramid'
      ? [[0, 0], [Rb, 0], [Rb * 0.9, H * 0.08], [0, H]]
      : t.roof === 'cone'
      ? [[0, 0], [Rb, 0], [Rb * 0.93, H * 0.06], [0, H]]
      : [[0, 0], [Rb, 0], [Rb * 0.72, H * 0.1], [Rb * 0.6, H * 0.26], [Rb * 0.66, H * 0.42], [Rb * 0.6, H * 0.56], [Rb * 0.4, H * 0.74], [Rb * 0.15, H * 0.9], [0, H]];
  mb.with(mul(translation(cx, t.roofBaseY, cz), rotationY(Math.PI / t.sides)), () => {
    mb.paint('roof', () => mb.lathe(prof, t.sides));
  });
  mb.with(translation(cx, t.roofBaseY + H - 0.05, cz), () =>
    mb.paint('metal', () => mb.lathe([[0, 0], [0.09, 0], [0.05, 0.25], [0.14, 0.42], [0.05, 0.58], [0.025, 1.4], [0, 1.45]], 10)),
  );
}

/** Mitred outward offset of an open path (end points move along their own edge normal). */
function offsetOpen(path: Vec2[], d: number): Vec2[] {
  const n = path.length;
  const nrm = (i: number): Vec2 => {
    const [ax, az] = path[i];
    const [bx, bz] = path[i + 1];
    const l = Math.hypot(bx - ax, bz - az);
    return [-(bz - az) / l, (bx - ax) / l];
  };
  return path.map(([x, z], i) => {
    const a = nrm(Math.max(0, i - 1));
    const b = nrm(Math.min(n - 2, i));
    const k = 1 + a[0] * b[0] + a[1] * b[1];
    return [x + (d * (a[0] + b[0])) / k, z + (d * (a[1] + b[1])) / k];
  });
}

/** Oriel: three-sided bay on a stepped corbel, with a lean-to roof or a flat cap under the eaves. */
function buildOriel(mb: MeshBuilder, spec: HouseSpec, o: OrielSpec): void {
  for (const fc of o.facades) buildSimpleFacade(mb, spec, fc, o.y0, o.y1, 0.25);
  const out = o.outline;
  const zW = o.zWall;
  const depthOf = (p: Vec2) => Math.max(0, p[1] - zW) / o.depth;
  mb.paint('trim', () => {
    mb.sweep(out, [[-0.05, o.y0 - 0.14], [0.08, o.y0 - 0.14], [0.08, o.y0 + 0.06], [-0.05, o.y0 + 0.06]], false);
    for (const f of o.floors.slice(1)) mb.sweep(out, STRING_COURSE(spec.floors[f].elevation), false);
    // Corbel: faces slope from the oriel floor down to the wall.
    const y = o.y0 - 0.14;
    const drop = 1.1;
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i];
      const b = out[i + 1];
      const nx = -(b[1] - a[1]);
      const nz = b[0] - a[0];
      mb.quad(
        [a[0], y, a[1]], [b[0], y, b[1]],
        [b[0], y - drop * depthOf(b), zW], [a[0], y - drop * depthOf(a), zW],
        [nx, -1, nz],
      );
    }
  });
  if (o.roof === 'flat') {
    mb.paint('trim', () => {
      mb.sweep(out, [[-0.05, o.y1 - 0.25], [0.06, o.y1 - 0.25], [0.12, o.y1 - 0.08], [0.15, o.y1], [-0.05, o.y1]], false);
      mb.with(frame([1, 0, 0], [0, 0, 1], [0, 1, 0], [0, 0, 0]), () => mb.extrude(out.map(([x, z]) => [x, z] as Vec2), o.y1 - 0.05, o.y1 + 0.04));
    });
    return;
  }
  const y1 = o.y1;
  const tan = Math.tan((32 * Math.PI) / 180);
  mb.paint('trim', () => mb.sweep(out, [[-0.05, y1 - 0.22], [0.05, y1 - 0.22], [0.12, y1 - 0.06], [0.15, y1], [-0.05, y1]], false));
  const eaveLine = offsetOpen(out, 0.15);
  mb.paint('roof', () => {
    for (let i = 0; i < out.length - 1; i++) {
      const a = eaveLine[i];
      const b = eaveLine[i + 1];
      const ta: Vec3 = [a[0], y1 + tan * (a[1] - zW), zW];
      const tb: Vec3 = [b[0], y1 + tan * (b[1] - zW), zW];
      mb.quad([a[0], y1, a[1]], [b[0], y1, b[1]], tb, ta, [-(b[1] - a[1]), 1, b[0] - a[0]]);
    }
  });
}
