import { MeshBuilder, frame, type Vec2 } from '@citygen/core';
import type { BalconySpec, HouseSpec, PorticoSpec, StairSpec } from '../types';
import { column, console_, railing, urn } from './elements';

/** Extrude a profile drawn in the (z, y) plane across x ∈ [x0, x1]. */
function extrudeZY(mb: MeshBuilder, poly: Vec2[], x0: number, x1: number): void {
  mb.with(frame([0, 0, 1], [0, 1, 0], [1, 0, 0], [0, 0, 0]), () => mb.extrude(poly, x0, x1));
}

export function buildStair(mb: MeshBuilder, s: StairSpec): void {
  const riser = (s.toY - s.fromY) / s.steps;
  if (s.direction === 'sides') {
    const tread = 0.34;
    mb.paint('stone', () => {
      mb.box(s.x0, 0, s.zEnd, s.x1, s.toY, s.zStart);
      for (let i = 1; i <= s.steps; i++) {
        const ext = (s.steps - i + 1) * tread;
        mb.box(s.x1, 0, s.zEnd, s.x1 + ext, i * riser, s.zStart);
        mb.box(s.x0 - ext, 0, s.zEnd, s.x0, i * riser, s.zStart);
      }
    });
    if (s.railing !== 'none') railing(mb, [s.x0 + 0.05, s.toY, s.zEnd + 0.06], [s.x1 - 0.05, s.toY, s.zEnd + 0.06], s.railing, 0.95);
    return;
  }

  const tread = (s.zEnd - s.zStart - s.landing) / s.steps;
  mb.paint('stone', () => {
    for (let i = 1; i <= s.steps; i++) mb.box(s.x0, 0, s.zStart, s.x1, i * riser, s.zEnd - (i - 1) * tread);
    // Nosings give the steps a crisp shadow line.
    for (let i = 1; i <= s.steps; i++) {
      const zf = s.zEnd - (i - 1) * tread;
      mb.box(s.x0, i * riser - 0.04, zf - 0.045, s.x1, i * riser, zf);
    }
  });

  const cheekH = 0.22;
  const zSlopeTop = s.zStart + s.landing + tread * 0.5;
  const cheek: Vec2[] = [
    [s.zStart, 0],
    [s.zEnd, 0],
    [s.zEnd, riser + cheekH],
    [zSlopeTop, s.toY + cheekH],
    [s.zStart, s.toY + cheekH],
  ];
  const cw = 0.44;
  for (const [cx0, cx1] of [[s.x0 - cw, s.x0], [s.x1, s.x1 + cw]] as const) {
    const xm = (cx0 + cx1) / 2;
    mb.paint('stone', () => extrudeZY(mb, cheek, cx0, cx1));
    const bottom: [number, number, number] = [xm, riser + cheekH, s.zEnd - 0.2];
    const top: [number, number, number] = [xm, s.toY + cheekH, zSlopeTop];
    if (s.railing !== 'none') {
      railing(mb, bottom, top, s.railing, 0.95);
      if (s.landing > 0.3) railing(mb, top, [xm, s.toY + cheekH, s.zStart + 0.05], s.railing, 0.95, false, true);
    }
    if (s.pedestals) {
      if (s.railing === 'stone') {
        mb.paint('trim', () => urn(mb, xm, bottom[1] + 0.99, bottom[2], 0.95));
      } else {
        mb.paint('stone', () => {
          mb.box(xm - 0.3, 0, s.zEnd - 0.62, xm + 0.3, riser + cheekH + 0.85, s.zEnd - 0.02);
          mb.box(xm - 0.35, riser + cheekH + 0.85, s.zEnd - 0.67, xm + 0.35, riser + cheekH + 0.95, s.zEnd + 0.03);
        });
        mb.paint('trim', () => urn(mb, xm, riser + cheekH + 0.95, s.zEnd - 0.32, 1.0));
      }
    }
  }
}

export function buildBalcony(mb: MeshBuilder, b: BalconySpec, spec: HouseSpec): void {
  const y = b.y;
  const zf = b.zFace;
  const zo = zf + b.depth;
  const kind = b.railing;
  if (b.support === 'consoles') {
    mb.paint('trim', () => {
      mb.box(b.x0, y - 0.22, zf, b.x1, y, zo);
      mb.box(b.x0 - 0.05, y - 0.08, zf, b.x1 + 0.05, y, zo + 0.05);
      mb.box(b.x0 + 0.03, y - 0.3, zf, b.x1 - 0.03, y - 0.22, zo - 0.04);
      const xs = [b.x0 + 0.2, b.x1 - 0.2];
      const cs = spec.bays.centers.filter((c) => c > b.x0 && c < b.x1);
      for (let i = 0; i < cs.length - 1; i++) xs.push((cs[i] + cs[i + 1]) / 2);
      const tall = b.id === 'b-center' ? 1.15 : b.depth < 0.5 ? 0.45 : 0.9;
      for (const x of xs) console_(mb, x, y - 0.3, zf, b.depth - 0.1, tall, 0.22);
    });
  }
  const inset = b.support === 'portico' ? 0.18 : 0.12;
  const l = b.x0 + inset;
  const r = b.x1 - inset;
  const f = zo - inset;
  railing(mb, [l, y, zf + 0.02], [l, y, f], kind, 1.0, true, true);
  railing(mb, [l, y, f], [r, y, f], kind, 1.0, false, false);
  railing(mb, [r, y, f], [r, y, zf + 0.02], kind, 1.0, true, true);
}

export function buildPortico(mb: MeshBuilder, p: PorticoSpec, spec: HouseSpec): void {
  const st = spec.stairs.find((s) => s.role === 'entrance')!;
  const fy = p.floorY;
  mb.paint('stone', () => {
    mb.box(st.x0, 0, p.zWall - 0.1, st.x1, fy, st.zStart);
    mb.sweep(
      [[st.x0, p.zWall], [st.x0, st.zStart], [st.x1, st.zStart], [st.x1, p.zWall]],
      [[-0.01, fy - 0.14], [0.06, fy - 0.14], [0.06, fy], [-0.01, fy]],
      false,
    );
  });
  for (const c of p.columns) column(mb, c, p.order);

  const eb = p.entablatureBottom;
  const H = p.topY - eb;
  const cp = Math.min(0.45, 0.28 * H);
  mb.paint('trim', () => {
    mb.box(p.x0, eb, p.zWall - 0.1, p.x1, p.topY, p.zFront);
    mb.sweep(
      [[p.x0, p.zWall], [p.x0, p.zFront], [p.x1, p.zFront], [p.x1, p.zWall]],
      [
        [-0.01, eb], [0.02, eb], [0.02, eb + 0.16 * H], [0.04, eb + 0.18 * H], [0.04, eb + 0.34 * H],
        [0.07, eb + 0.37 * H], [0.07, eb + 0.4 * H], [0.0, eb + 0.4 * H], [0.0, eb + 0.66 * H],
        [0.05, eb + 0.68 * H], [0.09, eb + 0.73 * H], [0.13, eb + 0.76 * H], [cp, eb + 0.78 * H],
        [cp, eb + 0.92 * H], [cp + 0.03, eb + 0.95 * H], [cp + 0.04, p.topY], [-0.01, p.topY],
      ],
      false,
    );
    if (spec.genome.dentils) {
      for (let x = p.x0 + 0.1; x < p.x1 - 0.05; x += 0.2) mb.box(x - 0.045, eb + 0.68 * H, p.zFront, x + 0.045, eb + 0.76 * H, p.zFront + 0.11);
    }
    // Soffit panels between the column axes.
    for (let i = 0; i < p.columns.length - 1; i++) {
      const a = p.columns[i].x + p.columns[i].diameter * 0.6;
      const b = p.columns[i + 1].x - p.columns[i + 1].diameter * 0.6;
      mb.box(a, eb - 0.05, p.zWall + 0.3, b, eb, p.zFront - 0.3);
    }
  });
}
