import { MeshBuilder, cross, deg, frame, mul, normalize, rotationX, rotationY, translation, type Vec2, type Vec3 } from '@citygen/core';
import type { ColumnOrder, ColumnSpec, PedimentSpec } from '../types';

/** Reusable architectural elements. All coordinates are in the caller's frame. */

const BALUSTER: Vec2[] = [
  [0, 0], [0.072, 0], [0.072, 0.07], [0.05, 0.09], [0.056, 0.13], [0.086, 0.3], [0.092, 0.38],
  [0.062, 0.55], [0.036, 0.68], [0.048, 0.72], [0.036, 0.76], [0.062, 0.86], [0.066, 0.92],
  [0.082, 0.935], [0.082, 1], [0, 1],
];

const URN: Vec2[] = [
  [0, 0], [0.17, 0], [0.17, 0.07], [0.1, 0.11], [0.075, 0.19], [0.2, 0.33], [0.245, 0.44],
  [0.2, 0.57], [0.235, 0.6], [0.235, 0.65], [0.13, 0.67], [0.06, 0.74], [0.035, 0.82], [0, 0.84],
];

export function baluster(mb: MeshBuilder, x: number, y: number, z: number, h: number): void {
  const s = h / 0.62;
  mb.with(translation(x, y, z), () =>
    mb.lathe(BALUSTER.map(([r, t]) => [r * Math.min(1.15, s), t * h] as Vec2), 10),
  );
}

export function urn(mb: MeshBuilder, x: number, y: number, z: number, size = 1): void {
  mb.with(translation(x, y, z), () => mb.lathe(URN.map(([r, t]) => [r * size, t * size] as Vec2), 14));
}

/**
 * Railing along a (possibly sloped) base line from a to b.
 * Stone: pedestals + plinth + balusters + handrail. Iron: bars + rails.
 */
export function railing(mb: MeshBuilder, a: Vec3, b: Vec3, kind: 'stone' | 'iron' | 'nouveau' | 'tube' | 'xiron', height = 1.0, pedestalStart = true, pedestalEnd = true): void {
  const dx = b[0] - a[0];
  const dz = b[2] - a[2];
  const horiz = Math.hypot(dx, dz);
  if (horiz < 0.2) return;
  const at = (t: number): Vec3 => [a[0] + dx * t, a[1] + (b[1] - a[1]) * t, a[2] + dz * t];
  const up = (p: Vec3, h: number): Vec3 => [p[0], p[1] + h, p[2]];

  if (kind === 'xiron') {
    // French wrought iron: framed panels with a saltire (X) and a small ring at the crossing.
    const panels = Math.max(1, Math.round(horiz / 0.75));
    mb.paint('metal', () => {
      mb.beam(up(a, height), up(b, height), 0.05, 0.04);
      mb.beam(up(a, 0.08), up(b, 0.08), 0.035, 0.035);
      for (let i = 0; i <= panels; i++) {
        const p = at(i / panels);
        mb.box(p[0] - 0.018, p[1], p[2] - 0.018, p[0] + 0.018, p[1] + height, p[2] + 0.018);
      }
      for (let i = 0; i < panels; i++) {
        const p0 = at(i / panels);
        const p1 = at((i + 1) / panels);
        mb.beam(up(p0, 0.1), up(p1, height - 0.02), 0.018, 0.018);
        mb.beam(up(p1, 0.1), up(p0, height - 0.02), 0.018, 0.018);
        const m = at((i + 0.5) / panels);
        const dir = normalize([b[0] - a[0], 0, b[2] - a[2]]);
        const side = normalize(cross(dir, [0, 1, 0]));
        mb.with(frame(dir, [0, 1, 0], side, up(m, (height + 0.08) / 2)), () => mb.arcBand(0, 0, 0.07, 0.09, 0, Math.PI * 2, -0.012, 0.012, 14));
      }
    });
    return;
  }

  if (kind === 'tube') {
    // Interwar tubular steel: slim posts and three horizontal rails.
    mb.paint('metal', () => {
      const n = Math.max(1, Math.round(horiz / 1.2));
      for (let i = 0; i <= n; i++) {
        const p = at(i / n);
        mb.box(p[0] - 0.02, p[1], p[2] - 0.02, p[0] + 0.02, p[1] + height, p[2] + 0.02);
      }
      for (const h of [0.32, 0.62, height]) mb.beam(up(a, h), up(b, h), h === height ? 0.055 : 0.035, h === height ? 0.055 : 0.035);
    });
    return;
  }

  if (kind === 'nouveau') {
    // Whiplash ironwork: posts, rails, and per-panel sweeping arcs, rings and curls.
    const dir = normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const side = normalize(cross(dir, [0, 1, 0]));
    const len3 = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const panels = Math.max(1, Math.round(horiz / 0.95));
    const L = len3 / panels;
    mb.paint('metal', () => {
      mb.beam(up(a, height), up(b, height), 0.06, 0.045);
      mb.beam(up(a, 0.08), up(b, 0.08), 0.035, 0.035);
      for (let i = 0; i <= panels; i++) {
        const p = at(i / panels);
        mb.box(p[0] - 0.02, p[1], p[2] - 0.02, p[0] + 0.02, p[1] + height, p[2] + 0.02);
      }
      for (let i = 0; i < panels; i++) {
        const o = at(i / panels);
        // Sheared panel frame: x along the (sloped) rail, y straight up — so on a stair the
        // ornament stays between the vertical posts and under the rail.
        mb.with(frame(dir, [0, 1, 0], side, o), () => {
          // Fixed whiplash panel; every piece touches a rail, a post or another piece.
          const y0 = 0.08;
          const T = height;
          const rr = Math.min(L, T - y0) * 0.86;
          // Two concentric sweeps from the right post down to the bottom rail.
          mb.arcBand(L, y0, rr - 0.02, rr, Math.PI / 2, Math.PI, -0.011, 0.011, 14);
          mb.arcBand(L, y0, rr * 0.72 - 0.016, rr * 0.72, Math.PI / 2, Math.PI, -0.011, 0.011, 12);
          // Small sweep in the lower left corner (bottom rail → left post).
          const rs = Math.min(L, T) * 0.42;
          mb.arcBand(0, y0, rs - 0.016, rs, 0, Math.PI / 2, -0.011, 0.011, 10);
          // Counter-sweep hanging from the top rail at the left post.
          const rt = Math.min(L, T) * 0.34;
          mb.arcBand(0, T, rt - 0.016, rt, -Math.PI / 2, 0, -0.011, 0.011, 10);
          // Ring on a drop bar from the top rail.
          const rx = L * 0.42;
          const ry = (T + y0) * 0.55;
          mb.arcBand(rx, ry, 0.075, 0.095, 0, Math.PI * 2, -0.011, 0.011, 16);
          mb.box(rx - 0.009, ry + 0.09, -0.011, rx + 0.009, T, 0.011);
          // Curl resting inside the outer sweep.
          const ca = (3 * Math.PI) / 4;
          const cr = 0.06;
          const cd = rr - 0.02 - cr;
          mb.arcBand(L + Math.cos(ca) * cd, y0 + Math.sin(ca) * cd, cr - 0.016, cr, -Math.PI / 4, Math.PI * 1.25, -0.011, 0.011, 12);
        });
      }
    });
    return;
  }

  if (kind === 'iron') {
    mb.paint('metal', () => {
      mb.beam(up(a, height), up(b, height), 0.06, 0.05);
      mb.beam(up(a, 0.1), up(b, 0.1), 0.04, 0.04);
      mb.beam(up(a, height - 0.18), up(b, height - 0.18), 0.03, 0.03);
      const count = Math.max(2, Math.round(horiz / 0.13));
      for (let i = 0; i <= count; i++) {
        const p = at(i / count);
        const heavy = i % 8 === 0;
        const w = heavy ? 0.045 : 0.022;
        mb.box(p[0] - w / 2, p[1], p[2] - w / 2, p[0] + w / 2, p[1] + height, p[2] + w / 2);
        // Small rosette between the upper rails every few bars — the Art Nouveau-ish touch.
        if (i % 4 === 2) mb.box(p[0] - 0.05, p[1] + height - 0.16, p[2] - 0.05, p[0] + 0.05, p[1] + height - 0.06, p[2] + 0.05);
      }
    });
    return;
  }

  mb.paint('trim', () => {
    const ped = 0.3;
    const plinthH = 0.13;
    const railH = 0.15;
    const spans = Math.max(1, Math.ceil(horiz / 2.6));
    for (let s = 0; s <= spans; s++) {
      if ((s === 0 && !pedestalStart) || (s === spans && !pedestalEnd)) continue;
      const p = at(s / spans);
      mb.box(p[0] - ped / 2, p[1], p[2] - ped / 2, p[0] + ped / 2, p[1] + height, p[2] + ped / 2);
      mb.box(p[0] - ped / 2 - 0.04, p[1] + height - 0.06, p[2] - ped / 2 - 0.04, p[0] + ped / 2 + 0.04, p[1] + height + 0.04, p[2] + ped / 2 + 0.04);
    }
    mb.beam(up(a, plinthH / 2), up(b, plinthH / 2), 0.24, plinthH);
    mb.beam(up(a, height - railH / 2), up(b, height - railH / 2), 0.28, railH);
    const balH = height - plinthH - railH;
    const spacing = 0.24;
    for (let s = 0; s < spans; s++) {
      const segLen = horiz / spans;
      const free = segLen - ped;
      const count = Math.max(1, Math.floor(free / spacing));
      for (let i = 0; i < count; i++) {
        const t = (s + (ped / 2 + (free * (i + 0.5)) / count) / segLen) / spans;
        const p = at(t);
        baluster(mb, p[0], p[1] + plinthH, p[2], balH);
      }
    }
  });
}

/** Scroll console (corbel) projecting along +z from a wall at z0, top at y. Width along x. */
export function console_(mb: MeshBuilder, x: number, y: number, z0: number, depth: number, height: number, width: number): void {
  const poly: Vec2[] = [
    [z0, y],
    [z0, y - height],
    [z0 + 0.12, y - height + 0.06],
    [z0 + depth * 0.35, y - height * 0.45],
    [z0 + depth * 0.75, y - height * 0.2],
    [z0 + depth, y - 0.12],
    [z0 + depth, y],
  ];
  // Extrude in the ZY plane, across x.
  mb.with(frame([0, 0, 1], [0, 1, 0], [1, 0, 0], [0, 0, 0]), () => mb.extrude(poly, x - width / 2, x + width / 2));
}

export function column(mb: MeshBuilder, c: ColumnSpec, order: ColumnOrder): void {
  const D = c.diameter;
  const r = D / 2;
  const baseH = D * 0.5;
  const capH = order === 'tuscan' ? D * 0.5 : order === 'ionic' ? D * 0.42 : D * 1.05;
  const shaftH = c.height - baseH - capH;
  mb.with(translation(c.x, c.baseY, c.z), () =>
    mb.paint('trim', () => {
      // Base: square plinth + torus + fillet.
      mb.box(-r * 1.32, 0, -r * 1.32, r * 1.32, D * 0.2, r * 1.32);
      mb.lathe([[0, D * 0.2], [r * 1.22, D * 0.2], [r * 1.26, D * 0.26], [r * 1.22, D * 0.34], [r * 1.08, D * 0.38], [r * 1.12, D * 0.44], [r * 1.02, baseH], [0, baseH]], 20);
      // Shaft with entasis: straight lower third, gentle taper above.
      const prof: Vec2[] = [[0, baseH]];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const taper = t < 1 / 3 ? 0 : Math.pow((t - 1 / 3) / (2 / 3), 1.3) * 0.15;
        prof.push([r * (1 - taper), baseH + shaftH * t]);
      }
      prof.push([0, baseH + shaftH]);
      mb.lathe(prof, 20);
      const y0 = baseH + shaftH;
      const rt = r * 0.85;
      // Astragal ring under the capital.
      mb.lathe([[0, y0 - D * 0.08], [rt * 1.1, y0 - D * 0.08], [rt * 1.14, y0 - D * 0.04], [rt * 1.1, y0], [0, y0]], 20);
      if (order === 'corinthian') {
        // Bell with two rows of acanthus leaves, corner volutes and a thin abacus.
        mb.lathe([[0, y0], [rt, y0], [rt * 1.02, y0 + D * 0.5], [r * 1.06, y0 + D * 0.8], [r * 1.18, y0 + D * 0.9], [0, y0 + D * 0.9]], 20);
        for (const [row, h, lean] of [[0, D * 0.36, 0.12], [1, D * 0.58, 0.2]] as const) {
          for (let k = 0; k < 8; k++) {
            const a = ((k + row * 0.5) * Math.PI) / 4;
            mb.with(rotationY(a), () => mb.beam([rt * 0.98, y0 + 0.02, 0], [rt * 0.98 + D * lean, y0 + h, 0], D * 0.26, D * 0.07));
          }
        }
        for (let k = 0; k < 4; k++) {
          mb.with(rotationY(Math.PI / 4 + (k * Math.PI) / 2), () => mb.beam([r * 0.85, y0 + D * 0.55, 0], [r * 1.42, y0 + D * 0.88, 0], D * 0.14, D * 0.14));
        }
        mb.box(-r * 1.38, y0 + D * 0.9, -r * 1.38, r * 1.38, y0 + capH, r * 1.38);
      } else if (order === 'tuscan') {
        mb.lathe([[0, y0], [rt, y0], [rt, y0 + D * 0.12], [rt * 1.05, y0 + D * 0.14], [r * 1.25, y0 + D * 0.32], [0, y0 + D * 0.32]], 20);
        mb.box(-r * 1.3, y0 + D * 0.32, -r * 1.3, r * 1.3, y0 + capH, r * 1.3);
      } else {
        mb.lathe([[0, y0], [rt * 1.05, y0], [r * 1.12, y0 + D * 0.14], [r * 1.12, y0 + D * 0.2], [0, y0 + D * 0.2]], 20);
        // Volute bolsters seen as scrolls on front and back faces.
        for (const sx of [-1, 1]) {
          mb.with(mul(translation(sx * r * 1.0, y0 + D * 0.2, -r * 1.05), rotationX(Math.PI / 2)), () =>
            mb.lathe([[0, 0], [D * 0.2, 0], [D * 0.17, r * 0.5], [D * 0.14, r * 1.05], [D * 0.17, r * 1.6], [D * 0.2, r * 2.1], [0, r * 2.1]], 14),
          );
        }
        mb.box(-r * 1.05, y0 + D * 0.32, -r * 1.25, r * 1.05, y0 + D * 0.38, r * 1.25);
        mb.box(-r * 1.32, y0 + D * 0.38, -r * 1.32, r * 1.32, y0 + capH, r * 1.32);
      }
    }),
  );
}

/** Classical pediment: recessed tympanum framed by raking cornices. Faces +z. */
export function pediment(mb: MeshBuilder, p: PedimentSpec): void {
  if (p.shape !== 'triangle') {
    curvedGable(mb, p);
    return;
  }
  const tan = Math.tan(deg(p.pitch));
  const xc = (p.x0 + p.x1) / 2;
  const half = (p.x1 - p.x0) / 2 + p.overhang;
  const apex = p.baseY + half * tan;
  const hr = Math.min(0.42, 0.26 + half * 0.02);
  const zb = p.z - 0.9;
  const zf = p.z + p.overhang;
  // Broken pediment: the raking cornices stop short of the apex; a pedestal with a finial fills the gap.
  const gap = p.form === 'broken' ? Math.min(0.55, half * 0.16) : 0;
  if (p.form === 'acroteria' || p.form === 'broken') {
    mb.paint('trim', () => {
      // Acroteria: low pedestals with urns at the cornice ends (and the apex for 'acroteria').
      if (p.form === 'acroteria') {
        for (const s of [-1, 1]) {
          const x = xc + s * (half - 0.22);
          mb.box(x - 0.24, p.baseY, zf - 0.5, x + 0.24, p.baseY + 0.32, zf);
          urn(mb, x, p.baseY + 0.32, zf - 0.25, 0.75);
        }
        mb.box(xc - 0.22, apex, zf - 0.5, xc + 0.22, apex + 0.26, zf);
        urn(mb, xc, apex + 0.26, zf - 0.25, 0.7);
      } else {
        const y = apex - gap * tan - hr;
        mb.box(xc - gap * 0.75, y, zf - 0.55, xc + gap * 0.75, apex + 0.18, zf - 0.02);
        mb.box(xc - gap * 0.9, apex + 0.18, zf - 0.6, xc + gap * 0.9, apex + 0.28, zf + 0.02);
        urn(mb, xc, apex + 0.28, zf - 0.28, 0.85);
      }
    });
  }
  mb.paint('trim', () => {
    // Raking cornices with a small cyma lip on top.
    for (const s of [-1, 1]) {
      const outer: Vec2 = [xc + s * half, p.baseY];
      const inner: Vec2 = [xc + s * (half - hr / tan), p.baseY];
      // Top end of the cornice: the apex, or short of it for a broken pediment.
      const xt = xc + s * gap;
      const yt = apex - gap * tan;
      const poly: Vec2[] = s < 0 ? [outer, [xt, yt], [xt, yt - hr], inner] : [inner, [xt, yt - hr], [xt, yt], outer];
      mb.extrude(poly, zb, zf);
      const lip: Vec2[] = s < 0
        ? [[outer[0] - 0.04, p.baseY], [xt, yt + 0.06], [xt, yt], [outer[0], p.baseY]]
        : [[outer[0], p.baseY], [xt, yt], [xt, yt + 0.06], [outer[0] + 0.04, p.baseY]];
      mb.extrude(lip, zf - 0.12, zf + 0.04);
    }
  });
  const tymTop = apex - hr;
  const tx = (tymTop - p.baseY) / tan;
  mb.paint('wall', () =>
    mb.extrude([[xc, tymTop], [xc - tx, p.baseY], [xc + tx, p.baseY]], zb, p.z - 0.04),
  );
  if (p.oculus) {
    const h = tymTop - p.baseY;
    const rad = Math.min(0.5, h * 0.24);
    if (rad > 0.18) {
      const cy = p.baseY + h * 0.4;
      mb.paint('trim', () => mb.arcBand(xc, cy, rad, rad + 0.13, 0, Math.PI * 2, p.z - 0.04, p.z + 0.06, 24));
      mb.paint('glass', () => mb.extrude(circle(xc, cy, rad, 20), p.z - 0.08, p.z - 0.05));
      mb.paint('frame', () => {
        mb.box(xc - rad, cy - 0.025, p.z - 0.06, xc + rad, cy + 0.025, p.z - 0.03);
        mb.box(xc - 0.025, cy - rad, p.z - 0.06, xc + 0.025, cy + rad, p.z - 0.03);
      });
    }
  }
}

/** Art Nouveau gable wall with an arched or bell outline, coping, window and Secession discs. Faces +z. */
function curvedGable(mb: MeshBuilder, p: PedimentSpec): void {
  const xc = (p.x0 + p.x1) / 2;
  const half = (p.x1 - p.x0) / 2;
  const by = p.baseY;
  const H = p.height;
  const wr = p.wallRise;
  const curve = (t: number) => {
    const q = Math.max(0, 1 - t * t);
    return wr + (H - wr) * (p.shape === 'arched' ? Math.sqrt(q) : Math.pow(q, 1.6));
  };
  const N = 28;
  let pts: Vec2[];
  if (p.shape === 'stepped' || p.shape === 'tiered' || p.shape === 'block') {
    // Crow-stepped (Hanseatic) or tiered (Art Deco) outline: a staircase up to a central top.
    const steps = p.shape === 'stepped' ? Math.max(3, Math.round(half / 0.75)) : p.shape === 'block' ? 1 : 3;
    const top = p.shape === 'stepped' ? 0.45 : 0.32;
    const heights = Array.from({ length: steps }, (_, k) => (p.shape === 'stepped' ? H * (k + 1) / steps : p.shape === 'block' ? H : H * [0.42, 0.7, 1][k]));
    const xs = Array.from({ length: steps }, (_, k) => half - (half - half * top) * (k / (steps - 1 || 1)));
    const left: Vec2[] = [[p.x0, by]];
    for (let k = 0; k < steps; k++) {
      const x = xc - (k === 0 ? half : xs[k]);
      left.push([x, by + (k === 0 ? 0 : heights[k - 1])], [x, by + heights[k]]);
    }
    const right = left.slice(1).reverse().map(([x, y]) => [2 * xc - x, y] as Vec2);
    pts = [...left.slice(1), ...right];
  } else {
    pts = Array.from({ length: N + 1 }, (_, i) => {
      const t = -1 + (2 * i) / N;
      return [xc + t * half, by + curve(t)] as Vec2;
    });
  }
  const zf = p.z;
  // Window opening in the gable (arched light or oculus): bottom/top of the hole as functions of x.
  const R = 0.2; // recess depth, like the façade windows
  let hole: { x0: number; x1: number; bot: (x: number) => number; top: (x: number) => number } | null = null;
  const gw = { ww: Math.min(1.4, Math.max(0.8, half * 0.45)), y0: by + 0.35, top: by + Math.min(H * 0.68, wr + (H - wr) * 0.6) };
  const gSpring = gw.top - gw.ww / 2;
  const oRad = Math.min(0.55, H * 0.17);
  const oCy = by + H * 0.45;
  if (p.shape !== 'tiered' && p.shape !== 'block') {
    if (p.oculus) hole = { x0: xc - oRad, x1: xc + oRad, bot: (x) => oCy - Math.sqrt(Math.max(0, oRad * oRad - (x - xc) ** 2)), top: (x) => oCy + Math.sqrt(Math.max(0, oRad * oRad - (x - xc) ** 2)) };
    else if (gSpring > gw.y0 + 0.4) hole = { x0: xc - gw.ww / 2, x1: xc + gw.ww / 2, bot: () => gw.y0, top: (x) => gSpring + Math.sqrt(Math.max(0, (gw.ww / 2) ** 2 - (x - xc) ** 2)) };
  }
  // Outline height at x (sampled just inside a strip, so vertical risers resolve cleanly).
  const outline = [[p.x0, by] as Vec2, ...pts, [p.x1, by] as Vec2];
  const topAt = (x: number) => {
    for (let i = 0; i < outline.length - 1; i++) {
      const [ax, ay] = outline[i];
      const [bx, by2] = outline[i + 1];
      const lo = Math.min(ax, bx);
      const hi = Math.max(ax, bx);
      if (hi - lo < 1e-6 || x < lo || x > hi) continue;
      return ay + ((by2 - ay) * (x - ax)) / (bx - ax);
    }
    return by;
  };
  mb.paint('wall', () => {
    // Solid back slab, then the front layer in vertical strips leaving the window opening.
    mb.extrude(outline.length > 2 ? [[xc, by], ...outline] : outline, zf - 0.6, zf - R);
    const xs = new Set<number>(outline.map(([x]) => x));
    if (hole) for (let k = 0; k <= 12; k++) xs.add(hole.x0 + ((hole.x1 - hole.x0) * k) / 12);
    for (let k = 0; k <= 24; k++) xs.add(p.x0 + ((p.x1 - p.x0) * k) / 24);
    const cut = [...xs].filter((x) => x >= p.x0 - 1e-6 && x <= p.x1 + 1e-6).sort((a, b) => a - b);
    const quad = (a: number, b: number, ya0: number, yb0: number, ya1: number, yb1: number) => {
      if (Math.max(ya1 - ya0, yb1 - yb0) < 1e-3) return;
      mb.extrude([[a, ya0], [b, yb0], [b, yb1], [a, ya1]], zf - R, zf);
    };
    for (let i = 0; i < cut.length - 1; i++) {
      const a = cut[i];
      const b = cut[i + 1];
      if (b - a < 1e-4) continue;
      const ta = topAt(a + 1e-4);
      const tb = topAt(b - 1e-4);
      const inHole = hole && a >= hole.x0 - 1e-6 && b <= hole.x1 + 1e-6;
      if (!inHole) {
        quad(a, b, by, by, ta, tb);
        continue;
      }
      quad(a, b, by, by, hole!.bot(a), hole!.bot(b));
      quad(a, b, hole!.top(a), hole!.top(b), ta, tb);
    }
  });
  // Coping following the outline.
  const zc = zf - 0.27;
  mb.paint('trim', () => {
    if (p.shape !== 'stepped' && p.shape !== 'tiered' && p.shape !== 'block') {
      mb.beam([p.x0 - 0.05, by, zc], [p.x0 - 0.05, by + wr, zc], 0.16, 0.76, [0, 0, 1]);
      mb.beam([p.x1 + 0.05, by, zc], [p.x1 + 0.05, by + wr, zc], 0.16, 0.76, [0, 0, 1]);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i];
      const [bx, by2] = pts[i + 1];
      if (Math.abs(ax - bx) < 1e-6) {
        // Vertical riser of a step: coping on its outer face.
        const out = ax < xc ? -0.05 : 0.05;
        mb.beam([ax + out, ay, zc], [bx + out, by2, zc], 0.16, 0.76, [0, 0, 1]);
      } else mb.beam([ax, ay + 0.04, zc], [bx, by2 + 0.04, zc], 0.17, 0.76, [0, 0, 1]);
    }
    if (p.shape === 'volute') {
      // Baroque scrolls where the curve meets the straight sides.
      for (const s of [-1, 1]) mb.arcBand(xc + s * (half - 0.15), by + wr + 0.05, 0.12, 0.3, 0, Math.PI * 2, zf - 0.02, zf + 0.12, 16);
    }
    if (p.shape === 'tiered' || p.shape === 'block') {
      // Deco fluting on the attic.
      for (const k of [-1, 0, 1]) mb.box(xc + k * 0.5 - 0.07, by + 0.2, zf, xc + k * 0.5 + 0.07, by + H * 0.85, zf + 0.06);
    }
    mb.with(translation(xc, by + H + 0.08, zc), () =>
      mb.lathe([[0, 0], [0.1, 0], [0.06, 0.1], [0.13, 0.24], [0.05, 0.38], [0, 0.42]], 12),
    );
  });
  // Gable window: oculus or a tall arched light, recessed like the façade windows (none on a Deco attic).
  if (p.shape === 'tiered' || p.shape === 'block') {
    // no window
  } else if (p.oculus) {
    const rad = Math.min(0.55, H * 0.17);
    const cy = by + H * 0.45;
    mb.paint('trim', () => mb.arcBand(xc, cy, rad, rad + 0.14, 0, Math.PI * 2, zf, zf + 0.08, 24));
    mb.paint('glass', () => mb.extrude(circle(xc, cy, rad, 20), zf - R, zf - R + 0.02));
    mb.paint('frame', () => {
      mb.box(xc - rad, cy - 0.025, zf - R + 0.02, xc + rad, cy + 0.025, zf - R + 0.05);
      mb.box(xc - 0.025, cy - rad, zf - R + 0.02, xc + 0.025, cy + rad, zf - R + 0.05);
    });
  } else {
    const ww = Math.min(1.4, Math.max(0.8, half * 0.45));
    const y0 = by + 0.35;
    const top = by + Math.min(H * 0.68, wr + (H - wr) * 0.6);
    const spring = top - ww / 2;
    if (spring > y0 + 0.4) {
      mb.paint('glass', () => {
        mb.box(xc - ww / 2, y0, zf - R, xc + ww / 2, spring, zf - R + 0.02);
        mb.extrude(circle(xc, spring, ww / 2, 14, 0, Math.PI), zf - R, zf - R + 0.02);
      });
      mb.paint('frame', () => {
        mb.box(xc - 0.03, y0, zf - R + 0.02, xc + 0.03, top, zf - R + 0.05);
        mb.box(xc - ww / 2, spring - 0.03, zf - R + 0.02, xc + ww / 2, spring + 0.03, zf - R + 0.05);
        for (let k = 1; k < 4; k++) {
          const x = xc - ww / 2 + (ww * k) / 4;
          mb.box(x - 0.012, spring, zf - R + 0.02, x + 0.012, spring + Math.sqrt(Math.max(0, (ww / 2) ** 2 - (x - xc) ** 2)), zf - R + 0.045);
        }
      });
      mb.paint('trim', () => {
        mb.box(xc - ww / 2 - 0.13, y0, zf, xc - ww / 2, spring, zf + 0.07);
        mb.box(xc + ww / 2, y0, zf, xc + ww / 2 + 0.13, spring, zf + 0.07);
        mb.arcBand(xc, spring, ww / 2, ww / 2 + 0.13, 0, Math.PI, zf, zf + 0.07, 16);
        mb.box(xc - ww / 2 - 0.2, y0 - 0.1, zf, xc + ww / 2 + 0.2, y0, zf + 0.14);
      });
    }
  }
  if (p.shape === 'arched' || p.shape === 'bell') {
    mb.paint('accent', () => {
      for (const k of [-1, 0, 1]) mb.arcBand(xc + k * 0.28, by + H - 0.5, 0, 0.085, 0, Math.PI * 2, zf, zf + 0.05, 16);
    });
  }
}

/** Circle polygon with the centre as vertex 0 (fan-friendly). */
export function circle(cx: number, cy: number, r: number, segments: number, a0 = 0, a1 = Math.PI * 2): Vec2[] {
  const pts: Vec2[] = [[cx, cy]];
  for (let i = 0; i <= segments; i++) {
    const a = a0 + ((a1 - a0) * i) / segments;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}
