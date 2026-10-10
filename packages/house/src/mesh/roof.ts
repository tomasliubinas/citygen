import { MeshBuilder, deg, hash32, rotationY, translation, type Vec2 } from '@citygen/core';
import type { ChimneySpec, DormerSpec, HouseSpec, RoofPartSpec } from '../types';
import { roofHeightAt } from '../layout';
import { circle, railing } from './elements';

/** While building a merged roof: caps are drawn only on real convex creases of the envelope. */
let capTest: ((a: [number, number, number], b: [number, number, number]) => boolean) | null = null;

export function buildRoof(mb: MeshBuilder, spec: HouseSpec): void {
  const merged = spec.roof.parts.filter((p) => p.merged);
  const env = (x: number, z: number) => {
    let h = -Infinity;
    for (const p of merged) if (x >= p.x0 - 1e-6 && x <= p.x1 + 1e-6 && z >= p.z0 - 1e-6 && z <= p.z1 + 1e-6) h = Math.max(h, roofHeightAt(p, x, z));
    return h;
  };
  const creaseTest = (a: [number, number, number], b: [number, number, number]) => {
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const l = Math.hypot(dx, dz) || 1;
    const n: Vec2 = [-dz / l, dx / l];
    for (const t of [0.3, 0.5, 0.7]) {
      const p: [number, number, number] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      const e = env(p[0], p[2]);
      if (Math.abs(e - p[1]) > 0.03) return false;
      const d = 0.3;
      if (env(p[0] + n[0] * d, p[2] + n[1] * d) + env(p[0] - n[0] * d, p[2] - n[1] * d) - 2 * e > -0.02) return false;
    }
    return true;
  };
  for (const part of spec.roof.parts) {
    capTest = part.merged ? creaseTest : null;
    mb.paint('roof', () => {
      if (part.form === 'hip') hip(mb, part.x0, part.x1, part.z0, part.z1, part.baseY, part.pitch, part.ends);
      else if (part.form === 'mansard') mansard(mb, part, spec.cresting);
      else if (part.form === 'flat') mb.quad([part.x0, part.baseY + 0.1, part.z1], [part.x1, part.baseY + 0.1, part.z1], [part.x1, part.baseY + 0.1, part.z0], [part.x0, part.baseY + 0.1, part.z0], [0, 1, 0]);
      else gable(mb, part);
    });
  }
  capTest = null;
  for (const c of spec.chimneys) chimney(mb, c);
  const pitch = spec.roof.parts[0].pitch;
  for (const d of spec.dormers) {
    mb.value = hash32(`${spec.input.seed}/${d.id}`) / 4294967296 + Math.round(spec.weathering.condition * 10);
    if (d.side === 'front') dormer(mb, d.x, d.zFace, d, pitch);
    else mb.with(rotationY(Math.PI), () => dormer(mb, -d.x, -d.zFace, d, pitch));
    mb.value = null;
  }
}

function ridgeCap(mb: MeshBuilder, a: [number, number, number], b: [number, number, number]): void {
  if (capTest && !capTest(a, b)) return;
  // Seam covering in the roof's own colour: reads as a fold, not as a gap.
  mb.paint('roof', () => mb.beam([a[0], a[1] + 0.03, a[2]], [b[0], b[1] + 0.03, b[2]], 0.2, 0.07));
}

/** Hip cap starting a little inside the eave corner so it never pokes past the envelope. */
function hipCap(mb: MeshBuilder, a: [number, number, number], b: [number, number, number]): void {
  const t = 0.12 / Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  ridgeCap(mb, [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t], b);
}

/** Vertical gable / fire wall closing a roof end at x (party wall): a polygon in the ZY plane. */
function fireWall(mb: MeshBuilder, x: number, zy: [number, number][]): void {
  mb.paint('wall', () => {
    const pts = zy.map(([z, y]) => [x, y, z] as [number, number, number]);
    mb.fan(pts, [1, 0, 0]);
    mb.fan(pts, [-1, 0, 0]);
  });
  mb.paint('trim', () => {
    for (let i = 1; i < zy.length - 1; i++) {
      const [za, ya] = zy[i];
      const [zb, yb] = zy[i + 1];
      if (Math.abs(ya - yb) < 1e-6 && i !== 1) continue;
      mb.beam([x, ya + 0.08, za], [x, yb + 0.08, zb], 0.5, 0.16);
    }
  });
}

function hip(mb: MeshBuilder, x0: number, x1: number, z0: number, z1: number, y: number, pitchDeg: number, ends?: { x0: boolean; x1: boolean }): void {
  const tan = Math.tan(deg(pitchDeg));
  const w = x1 - x0;
  const d = z1 - z0;
  if (ends && (ends.x0 || ends.x1)) {
    // Ridge parallel to the street; gable/fire wall at party ends, hip at free ends.
    const h = (d / 2) * tan;
    const zc = (z0 + z1) / 2;
    const xa = ends.x0 ? x0 : x0 + d / 2;
    const xb = Math.max(xa, ends.x1 ? x1 : x1 - d / 2);
    mb.quad([x0, y, z1], [x1, y, z1], [xb, y + h, zc], [xa, y + h, zc], [0, 1, 1]);
    mb.quad([x0, y, z0], [x1, y, z0], [xb, y + h, zc], [xa, y + h, zc], [0, 1, -1]);
    if (ends.x0) fireWall(mb, x0, [[z0, y], [z0, y], [zc, y + h], [z1, y]]);
    else mb.tri([x0, y, z0], [x0, y, z1], [xa, y + h, zc], [-1, 1, 0]);
    if (ends.x1) fireWall(mb, x1, [[z0, y], [z0, y], [zc, y + h], [z1, y]]);
    else mb.tri([x1, y, z0], [x1, y, z1], [xb, y + h, zc], [1, 1, 0]);
    if (xb - xa > 0.05) ridgeCap(mb, [xa, y + h, zc], [xb, y + h, zc]);
    if (!ends.x0) for (const cz of [z0, z1]) hipCap(mb, [x0, y, cz], [xa, y + h, zc]);
    if (!ends.x1) for (const cz of [z0, z1]) hipCap(mb, [x1, y, cz], [xb, y + h, zc]);
    return;
  }
  if (w >= d) {
    const h = (d / 2) * tan;
    const zc = (z0 + z1) / 2;
    const xa = x0 + d / 2;
    const xb = x1 - d / 2;
    mb.quad([x0, y, z1], [x1, y, z1], [xb, y + h, zc], [xa, y + h, zc], [0, 1, 1]);
    mb.quad([x0, y, z0], [x1, y, z0], [xb, y + h, zc], [xa, y + h, zc], [0, 1, -1]);
    mb.tri([x0, y, z0], [x0, y, z1], [xa, y + h, zc], [-1, 1, 0]);
    mb.tri([x1, y, z0], [x1, y, z1], [xb, y + h, zc], [1, 1, 0]);
    if (xb - xa > 0.05) ridgeCap(mb, [xa, y + h, zc], [xb, y + h, zc]);
    for (const [cx, cz, ex] of [[x0, z0, xa], [x0, z1, xa], [x1, z0, xb], [x1, z1, xb]] as const) {
      hipCap(mb, [cx, y, cz], [ex, y + h, zc]);
    }
  } else {
    const h = (w / 2) * tan;
    const xc = (x0 + x1) / 2;
    const za = z0 + w / 2;
    const zb = z1 - w / 2;
    mb.quad([x0, y, z0], [x0, y, z1], [xc, y + h, zb], [xc, y + h, za], [-1, 1, 0]);
    mb.quad([x1, y, z0], [x1, y, z1], [xc, y + h, zb], [xc, y + h, za], [1, 1, 0]);
    mb.tri([x0, y, z0], [x1, y, z0], [xc, y + h, za], [0, 1, -1]);
    mb.tri([x0, y, z1], [x1, y, z1], [xc, y + h, zb], [0, 1, 1]);
    if (zb - za > 0.05) ridgeCap(mb, [xc, y + h, za], [xc, y + h, zb]);
    for (const [cx, cz, ez] of [[x0, z0, za], [x1, z0, za], [x0, z1, zb], [x1, z1, zb]] as const) {
      hipCap(mb, [cx, y, cz], [xc, y + h, ez]);
    }
  }
}

function mansard(mb: MeshBuilder, p: RoofPartSpec, cresting: boolean): void {
  const h1 = p.lowerHeight!;
  const run = h1 / Math.tan(deg(p.lowerPitch!));
  const { x0, x1, z0, z1, baseY: y } = p;
  const e0 = !!p.ends?.x0;
  const e1 = !!p.ends?.x1;
  const ix0 = e0 ? x0 : x0 + run;
  const ix1 = e1 ? x1 : x1 - run;
  const iz0 = z0 + run;
  const iz1 = z1 - run;
  const yt = y + h1;
  mb.quad([x0, y, z1], [x1, y, z1], [ix1, yt, iz1], [ix0, yt, iz1], [0, 0.3, 1]);
  mb.quad([x0, y, z0], [x1, y, z0], [ix1, yt, iz0], [ix0, yt, iz0], [0, 0.3, -1]);
  if (!e0) mb.quad([x0, y, z0], [x0, y, z1], [ix0, yt, iz1], [ix0, yt, iz0], [-1, 0.3, 0]);
  if (!e1) mb.quad([x1, y, z0], [x1, y, z1], [ix1, yt, iz1], [ix1, yt, iz0], [1, 0.3, 0]);
  for (const [cx, cz, ex, ez, free] of [[x0, z0, ix0, iz0, !e0], [x1, z0, ix1, iz0, !e1], [x0, z1, ix0, iz1, !e0], [x1, z1, ix1, iz1, !e1]] as const) {
    if (free) hipCap(mb, [cx, y, cz], [ex, yt, ez]);
  }
  // Curb moulding where the steep slope meets the shallow upper roof.
  const curb: Vec2[] = [[ix0, iz1], [ix1, iz1], [ix1, iz0], [ix0, iz0]];
  if (!p.merged && !e0 && !e1) mb.paint('roof', () => mb.sweep(curb, [[-0.1, yt - 0.14], [0.06, yt - 0.14], [0.1, yt - 0.06], [0.12, yt], [-0.1, yt]], true));
  const upperEnds = e0 || e1 ? { x0: e0, x1: e1 } : undefined;
  // The curb moulding hides a small inset; without a curb (merged roofs, fire-wall ends) there is no inset.
  const curbDrawn = !p.merged && !e0 && !e1;
  // The upper plate starts at the break (tucked 2 cm under the curb), so no slot opens below the seam.
  const ins = curbDrawn ? -0.02 : 0;
  hip(mb, ix0 + (e0 ? 0 : ins), ix1 - (e1 ? 0 : ins), iz0 + ins, iz1 - ins, yt, p.pitch, upperEnds);
  if (!curbDrawn) {
    // Seam along the break between the steep and the shallow slope (merged roofs: only where visible).
    for (let i = 0; i < 4; i++) {
      if ((i === 1 && e1) || (i === 3 && e0)) continue;
      const a = curb[i];
      const b = curb[(i + 1) % 4];
      ridgeCap(mb, [a[0], yt, a[1]], [b[0], yt, b[1]]);
    }
  }
  const hu = ((iz1 - iz0 - 0.24) / 2) * Math.tan(deg(p.pitch));
  const zc = (z0 + z1) / 2;
  if (e0) fireWall(mb, x0, [[z0, y], [z0, y], [iz0, yt], [zc, yt + hu], [iz1, yt], [z1, y]]);
  if (e1) fireWall(mb, x1, [[z0, y], [z0, y], [iz0, yt], [zc, yt + hu], [iz1, yt], [z1, y]]);
  if (cresting && !p.merged) {
    const c = [[ix0, iz1], [ix1, iz1], [ix1, iz0], [ix0, iz0]] as const;
    for (let i = 0; i < 4; i++) {
      // Edges 1 and 3 are the ends at x1 / x0: none along a fire wall.
      if ((i === 1 && e1) || (i === 3 && e0)) continue;
      const a = c[i];
      const b = c[(i + 1) % 4];
      railing(mb, [a[0], yt, a[1]], [b[0], yt, b[1]], 'iron', 0.42);
    }
  }
}

function gable(mb: MeshBuilder, p: RoofPartSpec): void {
  const tan = Math.tan(deg(p.pitch));
  const { x0, x1, z0, z1, baseY: y } = p;
  const xc = (x0 + x1) / 2;
  const h = ((x1 - x0) / 2) * tan;
  const lift = 0.015;
  mb.quad([x0, y + lift, z1], [x0, y + lift, z0], [xc, y + h + lift, z0], [xc, y + h + lift, z1], [-1, 1, 0]);
  mb.quad([x1, y + lift, z1], [x1, y + lift, z0], [xc, y + h + lift, z0], [xc, y + h + lift, z1], [1, 1, 0]);
  mb.tri([x0, y, z0], [x1, y, z0], [xc, y + h, z0], [0, 0, -1]);
  ridgeCap(mb, [xc, y + h + lift, z0], [xc, y + h + lift, z1]);
}

function chimney(mb: MeshBuilder, c: ChimneySpec): void {
  const hw = c.width / 2;
  const hd = c.depth / 2;
  const t = c.topY;
  mb.paint('wall', () => mb.box(c.x - hw, c.baseY, c.z - hd, c.x + hw, t - 0.3, c.z + hd));
  mb.paint('trim', () => {
    mb.box(c.x - hw - 0.05, t - 0.75, c.z - hd - 0.05, c.x + hw + 0.05, t - 0.65, c.z + hd + 0.05);
    mb.box(c.x - hw - 0.09, t - 0.3, c.z - hd - 0.09, c.x + hw + 0.09, t - 0.17, c.z + hd + 0.09);
    mb.box(c.x - hw - 0.04, t - 0.17, c.z - hd - 0.04, c.x + hw + 0.04, t - 0.1, c.z + hd + 0.04);
  });
  mb.paint('metal', () => {
    for (const s of [-1, 1]) {
      const pz = c.z + s * hd * 0.45;
      mb.box(c.x - 0.11, t - 0.1, pz - 0.11, c.x + 0.11, t + 0.22, pz + 0.11);
    }
  });
}

function dormer(mb: MeshBuilder, x: number, zf: number, d: DormerSpec, roofPitch: number): void {
  const w = d.width;
  const zb = zf - d.depth;
  const cw = 0.17;
  const y0 = d.baseY;
  const ys = y0 + 0.16;
  const yt = ys + d.windowHeight;
  const yl = yt + 0.24;
  const l = x - w / 2;
  const r = x + w / 2;
  mb.paint('roof', () => {
    mb.box(l, y0, zb, l + cw, d.shape === 'gable' ? yl : yt, zf - 0.03);
    mb.box(r - cw, y0, zb, r, d.shape === 'gable' ? yl : yt, zf - 0.03);
  });
  mb.paint('trim', () => {
    mb.box(l - 0.06, y0, zb, r + 0.06, ys, zf + 0.08);
    mb.box(l - 0.03, ys, zf - 0.04, l + cw, yt, zf + 0.05);
    mb.box(r - cw, ys, zf - 0.04, r + 0.03, yt, zf + 0.05);
  });

  if (d.shape === 'oculus') {
    // Round œil-de-boeuf: solid front with a ringed round window, barrel hood.
    const rad = Math.min((w - 0.36) / 2, d.windowHeight / 2);
    const yc = (ys + yt) / 2;
    mb.paint('trim', () => {
      // Front panel with a round hole: vertical strips stopping just outside the circle (the
      // reveal covers the small gaps); the window sits behind the ring, no deeper than the panel.
      const n = 28;
      const strip = (xa: number, xb: number, y0s: number, y1s: number) => { if (y1s - y0s > 1e-3) mb.box(xa, y0s, zf - 0.06, xb, y1s, zf + 0.02); };
      strip(l + cw, x - rad, ys, yt);
      strip(x + rad, r - cw, ys, yt);
      for (let i = 0; i < n; i++) {
        const xa = x - rad + (2 * rad * i) / n;
        const xb = xa + (2 * rad) / n;
        // Nearest edge to the centre: the box stays fully outside the circle.
        const dx = xa < x && xb > x ? 0 : Math.min(Math.abs(xa - x), Math.abs(xb - x));
        const hh = Math.sqrt(Math.max(0, rad * rad - dx * dx));
        strip(xa, xb, ys, yc - hh);
        strip(xa, xb, yc + hh, yt);
      }
      mb.arcBand(x, yc, rad, rad + 0.06, 0, Math.PI * 2, zf - 0.06, zf + 0.02, 24);
      mb.arcBand(x, yc, rad, rad + 0.13, 0, Math.PI * 2, zf + 0.02, zf + 0.12, 24);
      mb.arcBand(x, yt, w / 2 - 0.02, w / 2 + 0.1, 0, Math.PI, zf - 0.04, zf + 0.1, 14);
      mb.with(translation(x, yt + w / 2 - 0.06, 0), () => mb.extrude([[-0.09, 0], [0.09, 0], [0.12, 0.24], [-0.12, 0.24]], zf - 0.02, zf + 0.13));
    });
    // Glass at the back of the front panel: the steep roof slope sits right behind it.
    mb.paint('glass', () => mb.extrude(circle(x, yc, rad, 20), zf - 0.055, zf - 0.04));
    mb.paint('frame', () => {
      mb.box(x - rad, yc - 0.025, zf - 0.04, x + rad, yc + 0.025, zf - 0.01);
      mb.box(x - 0.025, yc - rad, zf - 0.04, x + 0.025, yc + rad, zf - 0.01);
    });
    mb.paint('wall', () => mb.extrude(circle(x, yt, w / 2 - 0.02, 12, 0, Math.PI), zf - 0.06, zf - 0.04));
    mb.paint('roof', () => mb.arcBand(x, yt, w / 2 - 0.04, w / 2 + 0.06, 0, Math.PI, zb, zf - 0.04, 12));
    return;
  }

  mb.paint('glass', () => mb.box(l + cw, ys, zf - 0.18, r - cw, yt, zf - 0.16));
  mb.paint('frame', () => {
    mb.box(x - 0.03, ys, zf - 0.16, x + 0.03, yt, zf - 0.1);
    mb.box(l + cw, ys + d.windowHeight * 0.55 - 0.02, zf - 0.16, r - cw, ys + d.windowHeight * 0.55 + 0.02, zf - 0.11);
  });

  if (d.shape === 'arched') {
    // Round-headed dormer: arched light, moulded archivolt with keystone, barrel roof.
    const ri = w / 2 - cw;
    mb.paint('glass', () => mb.extrude(circle(x, yt, ri, 14, 0, Math.PI), zf - 0.18, zf - 0.16));
    mb.paint('frame', () => {
      mb.arcBand(x, yt, ri - 0.05, ri, 0, Math.PI, zf - 0.16, zf - 0.1, 14);
      mb.box(x - 0.03, yt, zf - 0.16, x + 0.03, yt + ri, zf - 0.1);
    });
    mb.paint('trim', () => {
      mb.arcBand(x, yt, ri, w / 2 + 0.08, 0, Math.PI, zf - 0.04, zf + 0.09, 16);
      mb.with(translation(x, yt + ri - 0.05, 0), () => mb.extrude([[-0.09, 0], [0.09, 0], [0.12, 0.3], [-0.12, 0.3]], zf - 0.02, zf + 0.12));
    });
    mb.paint('roof', () => mb.arcBand(x, yt, w / 2 - 0.04, w / 2 + 0.06, 0, Math.PI, zb, zf - 0.04, 12));
    return;
  }

  mb.paint('trim', () => mb.box(l - 0.07, yt, zb, r + 0.07, yl, zf + 0.08));
  const half = w / 2 + 0.14;
  const h = half * Math.tan(deg(Math.max(roofPitch, 32)));
  mb.paint('trim', () => {
    mb.extrude([[x, yl + h], [x - half, yl], [x + half, yl]], zf - 0.15, zf + 0.1);
  });
  mb.paint('roof', () => {
    mb.quad([x - half - 0.04, yl - 0.02, zf + 0.14], [x - half - 0.04, yl - 0.02, zb], [x, yl + h + 0.03, zb], [x, yl + h + 0.03, zf + 0.14], [-1, 1, 0]);
    mb.quad([x + half + 0.04, yl - 0.02, zf + 0.14], [x + half + 0.04, yl - 0.02, zb], [x, yl + h + 0.03, zb], [x, yl + h + 0.03, zf + 0.14], [1, 1, 0]);
  });
}
