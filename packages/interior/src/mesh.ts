import { MeshBuilder, frame, mul, rotationY, translation, type MeshData, type Vec2 } from '@citygen/core';
import type { InteriorSpec, LevelSpec, RoomKind, StairRunSpec, WallSpec } from './types';

/** Floor finish per room kind. */
const FLOOR: Partial<Record<RoomKind, string>> = {
  'entrance-hall': 'marble', hall: 'parquet', corridor: 'parquet', landing: 'marble',
  kitchen: 'tiles', pantry: 'tiles', bathroom: 'tiles', wc: 'tiles', laundry: 'stone',
  storage: 'boards', boiler: 'stone', wine: 'stone', workshop: 'stone',
  studio: 'boards', maid: 'boards', loft: 'boards', porter: 'parquet',
};

/** One mesh per level so the viewer can show the house cut away floor by floor. */
export function buildInteriorMesh(spec: InteriorSpec): { level: number; mesh: MeshData }[] {
  return spec.levels.map((L) => {
    const mb = new MeshBuilder();
    const cellar = L.kind === 'cellar';
    const stairsUp = spec.stairs.filter((s) => s.fromLevel === L.index);

    for (const r of spec.rooms) {
      if (r.level !== L.index) continue;
      const mat = cellar && r.kind !== 'stair' ? 'stone' : r.kind === 'stair' ? 'marble' : (FLOOR[r.kind] ?? 'parquet');
      mb.paint(mat, () => {
        for (const part of r.floorParts ?? r.parts) slab(mb, part, L.elevation);
      });
    }

    for (const w of spec.walls) if (w.level === L.index) partition(mb, w, L);
    outerSection(mb, L);
    for (const sp of spec.spirals.filter((q) => q.level === L.index)) spiral(mb, sp);
    for (const st of stairsUp) {
      mb.with(mul(translation(st.transform.x, 0, st.transform.z), rotationY(st.transform.rotationY)), () => staircase(mb, st));
    }
    return { level: L.index, mesh: mb.bake() };
  });
}

/** Floor finish: a convex polygon (x, z) extruded downwards. */
function slab(mb: MeshBuilder, poly: Vec2[], y: number): void {
  // Local X → X, local Y → Z, local Z → Y (a mirror; the builder fixes winding).
  mb.with(frame([1, 0, 0], [0, 0, 1], [0, 1, 0], [0, 0, 0]), () => mb.extrude(poly, y - 0.18, y));
}

function partition(mb: MeshBuilder, w: WallSpec, L: LevelSpec): void {
  const dx = w.b[0] - w.a[0];
  const dz = w.b[1] - w.a[1];
  const len = Math.hypot(dx, dz);
  if (len < 0.05) return;
  const ux = dx / len;
  const uz = dz / len;
  const h = w.height ?? L.wallHeight;
  const tt = w.thickness / 2;
  const y0 = L.elevation;
  // Wall frame: x along the wall, y up, z across (right-handed).
  mb.with(frame([ux, 0, uz], [0, 1, 0], [-uz, 0, ux], [w.a[0], 0, w.a[1]]), () => {
    const holes = w.openings.map((o) => ({ u0: o.u - o.width / 2, u1: o.u + o.width / 2, v1: y0 + Math.min(o.height, h) }));
    // Split the wall into pieces around the openings.
    const xs = [-tt, len + tt, ...holes.flatMap((o) => [o.u0, o.u1])].sort((a, b) => a - b);
    mb.paint('partition', () => {
      for (let i = 0; i < xs.length - 1; i++) {
        const a = xs[i];
        const b = xs[i + 1];
        if (b - a < 1e-4) continue;
        const hole = holes.find((o) => o.u0 < b - 1e-4 && o.u1 > a + 1e-4);
        mb.box(a, hole ? hole.v1 : y0, -tt, b, y0 + h, tt);
      }
    });
    for (const o of w.openings) {
      const u0 = o.u - o.width / 2;
      const u1 = o.u + o.width / 2;
      const top = y0 + Math.min(o.height, h);
      if (o.kind === 'opening') {
        mb.paint('trim', () => {
          mb.box(u0 - 0.06, y0, -tt - 0.02, u0, top, tt + 0.02);
          mb.box(u1, y0, -tt - 0.02, u1 + 0.06, top, tt + 0.02);
        });
        continue;
      }
      mb.paint('trim', () => {
        mb.box(u0 - 0.08, y0, -tt - 0.025, u0, top + 0.08, tt + 0.025);
        mb.box(u1, y0, -tt - 0.025, u1 + 0.08, top + 0.08, tt + 0.025);
        if (top + 0.08 <= y0 + h) mb.box(u0 - 0.08, top, -tt - 0.025, u1 + 0.08, top + 0.08, tt + 0.025);
      });
      // Leaves left ajar so the plan reads which way you walk.
      mb.paint(o.kind === 'apartment-door' ? 'doorDark' : 'door', () => {
        const leaves = o.kind === 'double-door' ? [[u0, -1], [u1, 1]] : [[u0, -1]];
        const lw = o.kind === 'double-door' ? o.width / 2 : o.width;
        for (const [hx, dir] of leaves) {
          mb.with(mul(translation(hx, y0, 0), rotationY(dir * 1.1)), () => {
            if (dir < 0) mb.box(0, 0, -0.025, lw - 0.02, top - y0 - 0.02, 0.025);
            else mb.box(-(lw - 0.02), 0, -0.025, 0, top - y0 - 0.02, 0.025);
          });
        }
      });
    }
  });
}

/** The outer walls are removed; their cut section stays as a low dark band with window marks. */
function outerSection(mb: MeshBuilder, L: LevelSpec): void {
  const y = L.elevation;
  mb.paint('outerCut', () => {
    for (const o of L.outlines) mb.sweep(o.points, [[-o.thickness, y - 0.18], [0, y - 0.18], [0, y + 0.12], [-o.thickness, y + 0.12]], o.closed);
  });
  for (const w of L.windows) {
    const [nx, nz] = w.normal;
    // Along-wall axis (dx, dz) with outward normal (-dz, dx) → (dx, dz) = (nz, -nx).
    mb.with(frame([nz, 0, -nx], [0, 1, 0], [nx, 0, nz], [w.x, 0, w.z]), () =>
      mb.paint(w.kind === 'door' ? 'doorMark' : 'windowMark', () => mb.box(-w.width / 2, y + 0.12, -0.5, w.width / 2, y + 0.2, 0.02)),
    );
  }
}

/** Dog-leg stair: flight up along the left half to a half landing at the back wall, back along the right half. */
function staircase(mb: MeshBuilder, s: StairRunSpec): void {
  const W = s.x1 - s.x0;
  const fw = (W - 0.12) / 2;
  const n1 = Math.ceil(s.risers / 2);
  const n2 = s.risers - n1;
  const r = (s.yTo - s.yFrom) / s.risers;
  const zl = s.z0 + s.landingDepth;
  const yl = s.yFrom + n1 * r;
  const mat = s.material === 'stone' ? 'stairsStone' : 'stairsWood';
  mb.paint(mat, () => {
    for (let i = 1; i <= n1; i++) {
      const zf = s.z1 - (i - 1) * s.tread;
      mb.box(s.x0, s.yFrom + i * r - 0.22, Math.max(zl, zf - s.tread - 0.03), s.x0 + fw, s.yFrom + i * r, zf);
    }
    mb.box(s.x0, yl - 0.22, s.z0, s.x1, yl, zl);
    for (let j = 1; j <= n2; j++) {
      const zb = zl + (j - 1) * s.tread;
      mb.box(s.x1 - fw, yl + j * r - 0.22, zb, s.x1, yl + j * r, zb + s.tread + 0.03);
    }
    // Stringers along the well.
    mb.beam([s.x0 + fw - 0.03, s.yFrom - 0.1, s.z1], [s.x0 + fw - 0.03, yl - 0.1, zl], 0.06, 0.3);
    mb.beam([s.x1 - fw + 0.03, yl - 0.1, zl], [s.x1 - fw + 0.03, s.yTo - 0.1, zl + n2 * s.tread], 0.06, 0.3);
  });
  mb.paint('rail', () => {
    const xa = s.x0 + fw - 0.03;
    const xb = s.x1 - fw + 0.03;
    const zEnd2 = zl + n2 * s.tread;
    mb.beam([xa, s.yFrom + 0.95, s.z1], [xa, yl + 0.95, zl], 0.06, 0.05);
    mb.beam([xb, yl + 0.95, zl], [xb, s.yTo + 0.95, zEnd2], 0.06, 0.05);
    mb.beam([xa, yl + 0.95, zl], [xb, yl + 0.95, zl], 0.06, 0.05);
    for (let i = 1; i <= n1; i += 2) {
      const z = s.z1 - (i - 0.5) * s.tread;
      const y = s.yFrom + i * r;
      mb.box(xa - 0.012, y, z - 0.012, xa + 0.012, y + 0.95 - 0.03, z + 0.012);
    }
    for (let j = 1; j <= n2; j += 2) {
      const z = zl + (j - 0.5) * s.tread;
      const y = yl + j * r;
      mb.box(xb - 0.012, y, z - 0.012, xb + 0.012, y + 0.95 - 0.03, z + 0.012);
    }
  });
}

/** Spiral stair around a newel post, inside a tower. */
function spiral(mb: MeshBuilder, sp: InteriorSpec['spirals'][number]): void {
  const n = Math.max(8, Math.ceil((sp.yTo - sp.yFrom) / 0.19));
  const rise = (sp.yTo - sp.yFrom) / n;
  const turn = (Math.PI * 2) / 14;
  mb.paint('stairsStone', () => {
    mb.with(translation(sp.cx, 0, sp.cz), () => {
      mb.lathe([[0, sp.yFrom], [0.16, sp.yFrom], [0.16, sp.yTo + 0.9], [0, sp.yTo + 0.9]], 10);
      for (let i = 1; i <= n; i++) {
        mb.with(mul(translation(0, sp.yFrom + i * rise, 0), rotationY(i * turn)), () => mb.box(0.1, -0.12, -0.2, sp.radius, 0, 0.2));
      }
    });
  });
}
