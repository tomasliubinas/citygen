import { MeshBuilder, deg, frame, hash32, mul, rotationX, translation, type Mat, type Vec2 } from '@citygen/core';
import type { FacadeSpec, HouseSpec, OpeningSpec } from '../types';
import { circle, console_ } from './elements';

/**
 * Facade geometry. Everything here is built in a facade frame:
 * x = distance along the wall from its start point, y = height,
 * z = outward (wall occupies z ∈ [-thickness, 0]).
 */

interface Rect { u0: number; u1: number; v0: number; v1: number }

export function facadeFrame(fc: FacadeSpec): Mat {
  const dx = (fc.b[0] - fc.a[0]) / fc.length;
  const dz = (fc.b[1] - fc.a[1]) / fc.length;
  return frame([dx, 0, dz], [0, 1, 0], [fc.normal[0], 0, fc.normal[1]], [fc.a[0], 0, fc.a[1]]);
}

/** [u0,u1]×[v0,v1] minus the holes, as a list of rectangles. */
export function cutRects(u0: number, u1: number, v0: number, v1: number, holes: Rect[]): Rect[] {
  const xs = new Set([u0, u1]);
  for (const h of holes) {
    if (h.u0 > u0 && h.u0 < u1) xs.add(h.u0);
    if (h.u1 > u0 && h.u1 < u1) xs.add(h.u1);
  }
  const sorted = [...xs].sort((a, b) => a - b);
  const out: Rect[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (b - a < 1e-6) continue;
    const covering = holes
      .filter((h) => h.u0 < b - 1e-6 && h.u1 > a + 1e-6 && h.v1 > v0 && h.v0 < v1)
      .sort((p, q) => p.v0 - q.v0);
    let y = v0;
    for (const h of covering) {
      if (h.v0 > y) out.push({ u0: a, u1: b, v0: y, v1: Math.min(h.v0, v1) });
      y = Math.max(y, h.v1);
    }
    if (y < v1) out.push({ u0: a, u1: b, v0: y, v1 });
  }
  return out;
}

const holeOf = (o: OpeningSpec): Rect => ({ u0: o.u - o.width / 2, u1: o.u + o.width / 2, v0: o.sill, v1: o.sill + o.height });

/** For each facade: is the corner at its start / end convex (outside corner)? */
function convexity(fp: Vec2[]): { start: boolean; end: boolean }[] {
  const n = fp.length;
  const dir = (i: number): Vec2 => {
    const a = fp[i];
    const b = fp[(i + 1) % n];
    return [b[0] - a[0], b[1] - a[1]];
  };
  const convexAt = (i: number) => {
    // Corner at vertex i, between edge i-1 and edge i.
    const p = dir((i - 1 + n) % n);
    const q = dir(i);
    return p[1] * q[0] - p[0] * q[1] > 0;
  };
  return fp.map((_, i) => ({ start: convexAt(i), end: convexAt((i + 1) % n) }));
}

interface Head { spring: number; cx: number; cy: number; R: number; a0: number; a1: number }

/** Arc geometry of an arched (semicircular) or segmental opening head; null for flat heads. */
export function headOf(o: OpeningSpec): Head | null {
  const top = o.sill + o.height;
  const w = o.width;
  if (o.head === 'arched') return { spring: top - w / 2, cx: o.u, cy: top - w / 2, R: w / 2, a0: 0, a1: Math.PI };
  if (o.head === 'segmental') {
    const rise = Math.min(w * 0.2, o.height * 0.15);
    const R = (w * w / 4 + rise * rise) / (2 * rise);
    const phi = Math.asin(w / 2 / R);
    return { spring: top - rise, cx: o.u, cy: top - R, R, a0: Math.PI / 2 - phi, a1: Math.PI / 2 + phi };
  }
  return null;
}

/** Seed of the house being built: gives every pane its own random value (glass `alpha` = window id). */
let glassSeed = '';
const paneValue = (id: string) => hash32(`${glassSeed}/${id}`) / 4294967296;

export type DoorSurround = HouseSpec['composition']['doorSurround'];

export function buildFacades(mb: MeshBuilder, spec: HouseSpec): void {
  glassSeed = spec.input.seed;
  const t = spec.wallThickness;
  const eave = spec.roof.eaveY;
  const wallTop = eave - spec.roof.corniceHeight + 0.05;
  const e1 = spec.floors[1]?.elevation;
  const rust = spec.rusticatedGround && e1 !== undefined;
  const rustTop = rust ? e1! - 0.17 : 0;
  const RUST = 0.035;
  const conv = [...convexity(spec.footprint), ...(spec.courtyard ? convexity(spec.courtyard) : [])];

  const halfW = spec.envelope.width / 2;
  const pw = spec.input.partyWalls;
  const isParty = (f?: FacadeSpec) =>
    !!f && Math.abs(f.normal[0]) > 0.5 && ((pw.left && Math.abs(f.a[0] + halfW) < 1e-3) || (pw.right && Math.abs(f.a[0] - halfW) < 1e-3));
  const nRing = spec.footprint.length;
  spec.facades.forEach((fc, i) => {
    const holes = fc.openings.map(holeOf);
    const inRing = i < nRing;
    const prev = inRing ? spec.facades[(i - 1 + nRing) % nRing] : undefined;
    const next = inRing ? spec.facades[(i + 1) % nRing] : undefined;
    const cx = { start: conv[i].start && !isParty(prev), end: conv[i].end && !isParty(next) };
    mb.with(facadeFrame(fc), () => {
      // Ashlar façades: the wall itself is stone (scored limestone blocks in the shader).
      mb.paint(spec.genome.ashlar ? 'stone' : 'wall', () => {
        for (const r of cutRects(0, fc.length, 0, wallTop + (isParty(fc) ? spec.roof.corniceHeight - 0.05 : 0), holes)) mb.box(r.u0, r.v0, -t, r.u1, r.v1, 0);
      });
      // A party wall is a plain fire wall: no dressing at all.
      if (isParty(fc)) return;

      for (const o of fc.openings) {
        if (o.head !== 'flat') spandrels(mb, o, -t + 0.05, rust && o.sill < rustTop ? RUST : 0, spec.genome.ashlar ? 'stone' : 'wall');
      }

      if (rust) {
        mb.paint(spec.genome.groundCladding ? 'stone' : 'wall', () => {
          const s0 = cx.start ? -RUST : 0;
          const s1 = fc.length + (cx.end ? RUST : 0);
          for (let y = spec.plinthHeight; y < rustTop - 0.1; y += 0.47) {
            const top = Math.min(y + 0.42, rustTop);
            for (const r of cutRects(s0, s1, y, top, holes)) mb.box(r.u0, r.v0, 0, r.u1, r.v1, RUST);
          }
        });
      }

      if (spec.quoins) quoins(mb, fc, cx, rust ? rustTop : spec.plinthHeight, wallTop - 0.05);

      for (const p of spec.pilasters) {
        if (p.facadeId !== fc.id) continue;
        if (p.style === 'lesene') lesene(mb, p.u, p.width, p.y0, p.y1);
        else if (p.style === 'strip') mb.paint('trim', () => mb.box(p.u - p.width / 2, p.y0, 0, p.u + p.width / 2, p.y1, 0.12));
        else pilaster(mb, p.u, p.width, p.y0, p.y1, 0);
      }

      for (const o of fc.openings) {
        const out0 = rust && o.sill < rustTop ? RUST : 0;
        if (o.kind === 'door') doorDetail(mb, o, out0, o.surround ?? spec.composition.doorSurround, spec.genome.flagpole);
        else windowDetail(mb, o, out0, spec.genome.smallPanes, spec.genome.glazing === 'deco');
      }

      if (spec.genome.accentFrieze) frieze(mb, fc, holes, wallTop, cx);
      if (spec.genome.decoBands) {
        // Interwar horizontal emphasis: a dark band under the windows of every upper floor.
        // Bands stop at pilasters/lesenes instead of running through them.
        const piers = spec.pilasters.filter((p) => p.facadeId === fc.id).map((p) => ({ u0: p.u - p.width / 2 - 0.06, u1: p.u + p.width / 2 + 0.06, v0: -1, v1: 999 }));
        mb.paint('accent', () => {
          for (const f of spec.floors.slice(1)) {
            for (const r of cutRects(cx.start ? -0.02 : 0, fc.length + (cx.end ? 0.02 : 0), f.elevation + 0.12, f.elevation + 0.42, [...holes, ...piers])) mb.box(r.u0, r.v0, 0, r.u1, r.v1, 0.02);
          }
        });
      }
      for (const o of spec.ornaments) {
        if (o.facadeId !== fc.id) continue;
        mb.paint('trim', () => mb.arcBand(o.u, o.y, o.radius, o.radius + 0.12, 0, Math.PI * 2, -0.02, 0.09, 24));
        mb.paint('glass', () => mb.extrude(circle(o.u, o.y, o.radius, 20), -0.06, -0.02));
        mb.paint('frame', () => {
          mb.box(o.u - o.radius, o.y - 0.025, -0.03, o.u + o.radius, o.y + 0.025, 0.0);
          mb.box(o.u - 0.025, o.y - o.radius, -0.03, o.u + 0.025, o.y + o.radius, 0.0);
        });
      }
      if (spec.genome.eaves === 'bracketed') eaveBrackets(mb, fc, eave, spec.roof.corniceProjection);
      else if (spec.genome.eaves === 'corbel') corbelFrieze(mb, fc, eave - spec.roof.corniceHeight);
      else if (spec.genome.dentils && fc.length > 1) {
        const y0 = eave - spec.roof.corniceHeight;
        mb.paint('trim', () => {
          for (let u = 0.1; u < fc.length - 0.05; u += 0.2) mb.box(u - 0.045, y0 + 0.19, 0.03, u + 0.045, y0 + 0.3, 0.2);
        });
      }

      basementWindows(mb, spec, fc);
    });
  });
}

function spandrels(mb: MeshBuilder, o: OpeningSpec, z0: number, z1: number, slot = 'wall'): void {
  const h = headOf(o);
  if (!h) return;
  const top = o.sill + o.height;
  const u0 = o.u - o.width / 2;
  const u1 = o.u + o.width / 2;
  const seg = 10;
  const left: Vec2[] = [[u0, top], [u0, h.spring]];
  const right: Vec2[] = [[u1, top], [o.u, top]];
  for (let i = 0; i <= seg; i++) {
    const a = h.a1 - (h.a1 - Math.PI / 2) * (i / seg);
    left.push([h.cx + h.R * Math.cos(a), h.cy + h.R * Math.sin(a)]);
    const b = Math.PI / 2 - (Math.PI / 2 - h.a0) * (i / seg);
    right.push([h.cx + h.R * Math.cos(b), h.cy + h.R * Math.sin(b)]);
  }
  mb.paint(slot, () => {
    mb.extrude(left, z0, z1);
    mb.extrude(right, z0, z1);
  });
}
function quoins(mb: MeshBuilder, fc: FacadeSpec, cx: { start: boolean; end: boolean }, y0: number, y1: number): void {
  const OUT = 0.045;
  const course = 0.42;
  const gap = 0.06;
  const maxLen = Math.max(0.2, fc.length / 2 - 0.05);
  mb.paint('trim', () => {
    let k = 0;
    for (let y = y0; y + course <= y1 + 1e-6; y += course + gap, k++) {
      // Interlock: at a corner, one face gets the long block when the other gets the short one.
      if (cx.start) {
        const L = Math.min(maxLen, k % 2 === 0 ? 0.5 : 0.85);
        mb.box(-OUT, y, 0, L, y + course, OUT);
      }
      if (cx.end) {
        const L = Math.min(maxLen, k % 2 === 0 ? 0.85 : 0.5);
        mb.box(fc.length - L, y, 0, fc.length + OUT, y + course, OUT);
      }
    }
  });
}

export function pilaster(mb: MeshBuilder, u: number, w: number, y0: number, y1: number, out0: number): void {
  const h = w / 2;
  mb.paint('trim', () => {
    mb.box(u - h - 0.05, y0, out0, u + h + 0.05, y0 + 0.28, out0 + 0.14);
    mb.box(u - h - 0.02, y0 + 0.28, out0, u + h + 0.02, y0 + 0.36, out0 + 0.11);
    mb.box(u - h, y0 + 0.36, out0, u + h, y1 - 0.38, out0 + 0.12);
    mb.box(u - h - 0.02, y1 - 0.38, out0, u + h + 0.02, y1 - 0.3, out0 + 0.11);
    mb.box(u - h - 0.05, y1 - 0.3, out0, u + h + 0.05, y1 - 0.13, out0 + 0.14);
    mb.box(u - h - 0.09, y1 - 0.13, out0, u + h + 0.09, y1, out0 + 0.18);
  });
}

function glazing(mb: MeshBuilder, o: OpeningSpec, zg: number, rowsHint: number | undefined, smallPanes: boolean, deco = false): void {
  const w = o.width;
  const u0 = o.u - w / 2;
  const u1 = o.u + w / 2;
  const top = o.sill + o.height;
  const h = headOf(o);
  const spring = h ? h.spring : top;
  const french = o.kind === 'french-door';
  const f = 0.07;
  const z0 = zg;
  const z1 = zg + 0.07;
  /** Height of the clear opening's upper edge at x. */
  const edgeAt = (x: number) => (h ? Math.max(spring, h.cy + Math.sqrt(Math.max(0, h.R * h.R - (x - h.cx) ** 2))) : top);
  mb.value = paneValue(o.id);
  mb.paint('glass', () => {
    mb.box(u0, o.sill, zg - 0.02, u1, spring, zg);
    if (h) mb.extrude(circle(h.cx, h.cy, h.R, 14, h.a0, h.a1), zg - 0.02, zg);
  });
  mb.value = null;
  mb.paint('frame', () => {
    mb.box(u0, o.sill, z0, u0 + f, spring, z1);
    mb.box(u1 - f, o.sill, z0, u1, spring, z1);
    mb.box(u0, o.sill, z0, u1, o.sill + f, z1);
    if (h) mb.arcBand(h.cx, h.cy, h.R - f, h.R, h.a0, h.a1, z0, z1, 14);
    else mb.box(u0, top - f, z0, u1, top, z1);
    const transom = o.head === 'arched' ? spring : Math.min(spring, french ? top - 0.6 : o.sill + o.height * (deco ? 0.8 : 0.72));
    mb.box(u0, transom - 0.04, z0, u1, transom + 0.04, z1 + 0.01);
    if (deco) {
      // Art Deco three-part window: two vertical bars, a high transom, no glazing bars.
      for (const x of [u0 + w / 3, u0 + (2 * w) / 3]) mb.box(x - 0.03, o.sill, z0, x + 0.03, top, z1);
      return;
    }
    mb.box(o.u - 0.03, o.sill, z0, o.u + 0.03, top, z1);
    const rows = smallPanes ? 1 : (rowsHint ?? Math.max(1, Math.round((transom - o.sill) / 0.75)));
    for (let k = 1; k < rows; k++) {
      const y = o.sill + ((transom - o.sill) * k) / rows;
      mb.box(u0, y - 0.018, z0 + 0.01, u1, y + 0.018, z1 - 0.01);
    }
    if (smallPanes) {
      // Jugendstil: big lower panes, a grid of small panes in the upper light.
      const cols = Math.max(3, Math.round(w / 0.22));
      for (let k = 1; k < cols; k++) {
        const x = u0 + (w * k) / cols;
        mb.box(x - 0.015, transom, z0 + 0.01, x + 0.015, edgeAt(x), z1 - 0.01);
      }
      const ym = (transom + edgeAt(o.u)) / 2;
      if (edgeAt(o.u) - transom > 0.45) mb.box(u0, ym - 0.015, z0 + 0.01, u1, ym + 0.015, z1 - 0.01);
    }
    if (french) mb.box(u0, o.sill, z0 + 0.005, u1, o.sill + 0.55, z1 - 0.015);
    if (o.head === 'arched' && !smallPanes) {
      for (const a of [Math.PI / 4, (3 * Math.PI) / 4]) {
        const r = w / 2 - f;
        mb.beam([o.u, spring, z0 + 0.035], [o.u + r * Math.cos(a), spring + r * Math.sin(a), z0 + 0.035], 0.05, 0.035);
      }
    }
  });
}
function architrave(mb: MeshBuilder, o: OpeningSpec, a: number, out0: number): number {
  const w = o.width;
  const u0 = o.u - w / 2;
  const u1 = o.u + w / 2;
  const top = o.sill + o.height;
  const h = headOf(o);
  const spring = h ? h.spring : top;
  const z0 = out0 - 0.01;
  const z1 = out0 + 0.055;
  mb.paint('trim', () => {
    mb.box(u0 - a, o.sill, z0, u0, spring, z1);
    mb.box(u1, o.sill, z0, u1 + a, spring, z1);
    // Inner bead.
    mb.box(u0 - 0.035, o.sill, z0, u0, spring, z1 + 0.025);
    mb.box(u1, o.sill, z0, u1 + 0.035, spring, z1 + 0.025);
    if (h) {
      mb.arcBand(h.cx, h.cy, h.R, h.R + a, h.a0, h.a1, z0, z1, 16);
      if (o.head === 'segmental') {
        // Fill the small notch between the radial arch ends and the jambs.
        mb.box(u0 - a, spring, z0, u0, spring + 0.12, z1);
        mb.box(u1, spring, z0, u1 + a, spring + 0.12, z1);
      }
    } else {
      mb.box(u0 - a, top, z0, u1 + a, top + a, z1);
      mb.box(u0 - 0.035, top, z0, u1 + 0.035, top + 0.035, z1 + 0.025);
    }
  });
  return h ? h.cy + h.R + a : top + a;
}
function keystone(mb: MeshBuilder, u: number, y: number, out0: number, h = 0.4): void {
  mb.paint('trim', () =>
    mb.with(translation(u, y, 0), () =>
      mb.extrude([[-0.11, 0], [0.11, 0], [0.155, h], [-0.155, h]], out0 - 0.01, out0 + 0.1),
    ),
  );
}

function windowDetail(mb: MeshBuilder, o: OpeningSpec, out0: number, smallPanes = false, deco = false): void {
  const w = o.width;
  const u0 = o.u - w / 2;
  const u1 = o.u + w / 2;
  const top = o.sill + o.height;
  const a = o.kind === 'stair-window' ? 0.12 : 0.15;
  const rows = o.kind === 'stair-window' ? 2 : undefined;
  glazing(mb, o, -0.2, rows, smallPanes, deco);
  const yH = architrave(mb, o, a, out0);

  mb.paint('trim', () => {
    if (o.kind === 'french-door') {
      mb.box(u0 - a, o.sill - 0.05, -0.25, u1 + a, o.sill, out0 + 0.05);
    } else {
      mb.box(u0 - a - 0.07, o.sill - 0.12, -0.08, u1 + a + 0.07, o.sill, out0 + 0.14);
      mb.box(u0 - a - 0.03, o.sill - 0.16, -0.02, u1 + a + 0.03, o.sill - 0.12, out0 + 0.09);
    }
    if (o.sillConsoles) {
      for (const x of [u0 - a + 0.01, u1 + a - 0.15]) {
        mb.box(x, o.sill - 0.44, out0, x + 0.14, o.sill - 0.16, out0 + 0.08);
        mb.box(x - 0.01, o.sill - 0.28, out0, x + 0.15, o.sill - 0.16, out0 + 0.11);
      }
    }
    if (o.apron) {
      mb.box(u0 - 0.01, o.sill - 0.6, out0, u1 + 0.01, o.sill - 0.18, out0 + 0.02);
      mb.box(u0 + 0.12, o.sill - 0.52, out0, u1 - 0.12, o.sill - 0.26, out0 + 0.04);
    }
  });

  if (o.head === 'arched') {
    if (o.crown !== 'none') keystone(mb, o.u, top - 0.08, out0, yH - top + 0.22);
    return;
  }
  crown(mb, o.crown, o.u, u0 - a, u1 + a, top, yH, out0);
}


function crown(mb: MeshBuilder, kind: OpeningSpec['crown'], u: number, x0: number, x1: number, top: number, yH: number, out0: number): void {
  if (kind === 'none') return;
  if (kind === 'keystone') {
    keystone(mb, u, top - 0.06, out0, yH - top + 0.2);
    return;
  }
  if (kind === 'eared') {
    // Baroque "ears": the frame steps out at the top corners, with a small cornice above.
    mb.paint('trim', () => {
      for (const [a, b] of [[x0 - 0.12, x0], [x1, x1 + 0.12]]) mb.box(a, yH - 0.32, out0, b, yH, out0 + 0.055);
      mb.box(x0 - 0.16, yH, out0, x1 + 0.16, yH + 0.1, out0 + 0.12);
      mb.box(x0 - 0.2, yH + 0.1, out0, x1 + 0.2, yH + 0.16, out0 + 0.16);
    });
    return;
  }
  if (kind === 'secession') {
    // Vienna Secession motif: a flat band, hanging drip strips and three discs.
    mb.paint('trim', () => {
      mb.box(x0, yH + 0.04, out0, x1, yH + 0.16, out0 + 0.05);
      for (const sx of [x0 - 0.11, x1 + 0.05]) mb.box(sx, yH - 0.8, out0, sx + 0.06, yH + 0.16, out0 + 0.04);
    });
    mb.paint('accent', () => {
      for (const k of [-1, 0, 1]) mb.arcBand(u + k * 0.21, yH + 0.34, 0, 0.075, 0, Math.PI * 2, out0, out0 + 0.05, 16);
    });
    return;
  }
  mb.paint('trim', () => {
    mb.box(x0, yH, out0, x1, yH + 0.2, out0 + 0.04);
    mb.box(x0 - 0.12, yH + 0.2, out0, x1 + 0.12, yH + 0.31, out0 + 0.17);
    mb.box(x0 - 0.08, yH + 0.31, out0, x1 + 0.08, yH + 0.35, out0 + 0.13);
    const base = yH + 0.35;
    const half = (x1 - x0) / 2 + 0.12;
    if (kind === 'triangular') {
      const h = half * Math.tan(deg(22));
      mb.extrude([[u, base + h], [u - half, base], [u + half, base]], out0, out0 + 0.15);
      mb.extrude([[u, base + h + 0.05], [u - half - 0.04, base], [u - half, base], [u, base + h]], out0, out0 + 0.17);
      mb.extrude([[u, base + h + 0.05], [u, base + h], [u + half, base], [u + half + 0.04, base]], out0, out0 + 0.17);
    } else if (kind === 'segmental') {
      const rise = 0.24;
      const R = (half * half + rise * rise) / (2 * rise);
      const phi = Math.asin(half / R);
      mb.arcBand(u, base + rise - R, R - 0.14, R, Math.PI / 2 - phi, Math.PI / 2 + phi, out0, out0 + 0.16, 16);
    }
  });
}

function doorDetail(mb: MeshBuilder, o: OpeningSpec, out0: number, surround: DoorSurround, flagpole = false): void {
  const w = o.width;
  const u0 = o.u - w / 2;
  const u1 = o.u + w / 2;
  const top = o.sill + o.height;
  const arched = o.head === 'arched';
  const spring = arched ? top - w / 2 : top;
  const leafTop = arched ? spring - 0.05 : top - 0.6;
  const zl0 = -0.34;
  const zl1 = -0.28;

  mb.paint('door', () => {
    for (const [lx0, lx1] of [[u0, o.u - 0.01], [o.u + 0.01, u1]]) {
      mb.box(lx0, o.sill, zl0, lx1, leafTop, zl1);
      const H = leafTop - o.sill;
      mb.box(lx0 + 0.12, o.sill + 0.18, zl1, lx1 - 0.12, o.sill + 0.18 + H * 0.28, zl1 + 0.035);
      mb.box(lx0 + 0.12, o.sill + 0.32 + H * 0.28, zl1, lx1 - 0.12, leafTop - 0.16, zl1 + 0.035);
    }
  });
  mb.paint('metal', () => {
    mb.box(o.u - 0.09, o.sill + 1.0, zl1, o.u - 0.05, o.sill + 1.15, zl1 + 0.06);
    mb.box(o.u + 0.05, o.sill + 1.0, zl1, o.u + 0.09, o.sill + 1.15, zl1 + 0.06);
  });
  mb.value = paneValue(o.id);
  mb.paint('glass', () => {
    mb.box(u0, leafTop, zl0, u1, spring, zl0 + 0.02);
    if (arched) mb.extrude(circle(o.u, spring, w / 2, 16, 0, Math.PI), zl0, zl0 + 0.02);
  });
  mb.value = null;
  mb.paint('frame', () => {
    mb.box(u0, leafTop, zl0, u1, leafTop + 0.08, zl1 + 0.02);
    if (arched) {
      const r = w / 2;
      for (let k = 1; k < 6; k++) {
        const a = (Math.PI * k) / 6;
        mb.beam([o.u + 0.22 * Math.cos(a), spring + 0.22 * Math.sin(a), zl0 + 0.04], [o.u + r * Math.cos(a), spring + r * Math.sin(a), zl0 + 0.04], 0.04, 0.035);
      }
      mb.arcBand(o.u, spring, 0.18, 0.24, 0, Math.PI, zl0 + 0.02, zl0 + 0.06, 10);
      mb.arcBand(o.u, spring, r - 0.06, r, 0, Math.PI, zl0, zl0 + 0.07, 16);
    } else {
      for (const x of [u0 + w / 3, u0 + (2 * w) / 3]) mb.box(x - 0.02, leafTop, zl0 + 0.02, x + 0.02, top, zl0 + 0.06);
    }
  });

  const a = 0.2;
  const yH = architrave(mb, o, a, out0);
  mb.paint('stone', () => mb.box(u0 - a, o.sill - 0.06, -0.34, u1 + a, o.sill + 0.015, out0 + 0.12));

  if (surround === 'pediment') {
    const pw = 0.32;
    const gap = 0.08;
    const L = u0 - a - gap - pw;
    const R = u1 + a + gap + pw;
    for (const x of [L, u1 + a + gap]) pilaster(mb, x + pw / 2, pw, o.sill, yH, out0);
    mb.paint('trim', () => {
      mb.box(L - 0.06, yH, out0, R + 0.06, yH + 0.3, out0 + 0.15);
      mb.box(L - 0.2, yH + 0.3, out0, R + 0.2, yH + 0.46, out0 + 0.32);
      const half = (R - L) / 2 + 0.2;
      const h = half * Math.tan(deg(21));
      const c = (L + R) / 2;
      mb.extrude([[c, yH + 0.46 + h], [c - half, yH + 0.46], [c + half, yH + 0.46]], out0, out0 + 0.24);
      mb.extrude([[c, yH + 0.52 + h], [c - half - 0.04, yH + 0.46], [c - half, yH + 0.46], [c, yH + 0.46 + h]], out0, out0 + 0.3);
      mb.extrude([[c, yH + 0.52 + h], [c, yH + 0.46 + h], [c + half, yH + 0.46], [c + half + 0.04, yH + 0.46]], out0, out0 + 0.3);
    });
    if (arched) keystone(mb, o.u, top - 0.08, out0, yH - top + 0.08);
  } else if (arched) {
    keystone(mb, o.u, top - 0.08, out0, yH - top + 0.3);
  } else {
    crown(mb, 'cornice', o.u, u0 - a, u1 + a, top, yH, out0);
  }
  if (surround === 'canopy') canopy(mb, u0 - 0.75, u1 + 0.75, yH + 0.45);
  if (surround === 'stepped') {
    // Interwar stepped portal: three receding frames rising to a stepped top, a flagpole above.
    mb.paint('trim', () => {
      for (let k = 1; k <= 3; k++) {
        const g = 0.16 * k;
        const zf = out0 + 0.05 * (4 - k);
        mb.box(u0 - a - g, o.sill, out0, u0 - a - g + 0.16, yH + g, zf);
        mb.box(u1 + a + g - 0.16, o.sill, out0, u1 + a + g, yH + g, zf);
        mb.box(u0 - a - g, yH + g - 0.16, out0, u1 + a + g, yH + g, zf);
      }
      mb.box(o.u - 0.35, yH + 0.48, out0, o.u + 0.35, yH + 0.75, out0 + 0.08);
    });
  }
  if (surround === 'slab') {
    // Interwar cantilevered canopy: a thin flat slab with a crisp edge.
    mb.paint('trim', () => {
      mb.box(u0 - 1.0, yH + 0.15, out0, u1 + 1.0, yH + 0.33, out0 + 1.5);
      mb.box(u0 - 1.0, yH + 0.1, out0 + 1.42, u1 + 1.0, yH + 0.15, out0 + 1.5);
    });
  }
  if (surround === 'lantern') {
    // Recessed door in a plain stone frame with a thin cornice, flanked by wall lanterns.
    crown(mb, 'cornice', o.u, u0 - a, u1 + a, top, yH, out0);
    for (const x of [u0 - a - 0.75, u1 + a + 0.75]) {
      const y = o.sill + Math.min(2.3, o.height * 0.75);
      mb.paint('metal', () => {
        mb.box(x - 0.08, y + 0.2, out0, x + 0.08, y + 0.32, out0 + 0.22);
        mb.box(x - 0.15, y - 0.32, out0 + 0.08, x + 0.15, y - 0.27, out0 + 0.38);
        mb.box(x - 0.17, y + 0.12, out0 + 0.06, x + 0.17, y + 0.2, out0 + 0.4);
      });
      mb.with(translation(x, y + 0.2, out0 + 0.23), () => mb.paint('metal', () => mb.lathe([[0, 0], [0.18, 0], [0.04, 0.18], [0.02, 0.26], [0, 0.27]], 4)));
      mb.paint('glass', () => mb.box(x - 0.13, y - 0.27, out0 + 0.1, x + 0.13, y + 0.12, out0 + 0.36));
    }
  }
  if ((surround === 'stepped' || surround === 'slab') && flagpole) {
    mb.paint('metal', () => {
      // Beside the portal, leaning out and away — never in front of the glazed strip above the door.
      const xb = o.u + w / 2 + 1.0;
      const yb = yH + (surround === 'slab' ? 0.4 : 0.3);
      mb.box(xb - 0.08, yb, out0, xb + 0.08, yb + 0.2, out0 + 0.12);
      mb.beam([xb, yb + 0.1, out0 + 0.08], [xb + 0.7, yb + 1.5, out0 + 1.4], 0.05, 0.05);
    });
  }
}

/** Iron-and-glass entrance canopy on two curved brackets. */
function canopy(mb: MeshBuilder, x0: number, x1: number, y: number): void {
  const depth = 1.35;
  const tilt = 0.18;
  mb.with(mul(translation(0, y, 0), rotationX(tilt)), () => {
    mb.paint('glass', () => mb.box(x0, -0.03, 0, x1, 0, depth));
    mb.paint('metal', () => {
      mb.box(x0, -0.1, depth - 0.06, x1, 0.02, depth);
      mb.box(x0, -0.1, 0, x0 + 0.05, 0.02, depth);
      mb.box(x1 - 0.05, -0.1, 0, x1, 0.02, depth);
      for (let x = x0 + 0.45; x < x1 - 0.3; x += 0.45) mb.box(x - 0.012, -0.05, 0, x + 0.012, 0, depth);
    });
  });
  mb.paint('metal', () => {
    for (const x of [x0 + 0.3, x1 - 0.3]) {
      // Bracket drawn in the plane perpendicular to the wall (local x → outward).
      mb.with(frame([0, 0, 1], [0, 1, 0], [1, 0, 0], [x, 0, 0]), () => {
        mb.arcBand(0, y - 0.3, 1.0, 1.05, -Math.PI / 2, 0, -0.025, 0.025, 14);
        mb.arcBand(0.32, y - 0.62, 0.12, 0.155, 0, Math.PI * 1.6, -0.02, 0.02, 12);
        mb.box(0, y - 1.35, -0.06, 0.05, y - 0.05, 0.06);
      });
    }
  });
}

/** Secession lesene: flat strip with a capital panel, disc and drips. */
function lesene(mb: MeshBuilder, u: number, w: number, y0: number, y1: number): void {
  const h = w / 2;
  mb.paint('trim', () => {
    mb.box(u - h, y0, 0, u + h, y1 - 0.7, 0.13);
    mb.box(u - h - 0.04, y1 - 0.7, 0, u + h + 0.04, y1 - 0.05, 0.16);
    for (const k of [-1, 0, 1]) mb.box(u + k * 0.1 - 0.02, y1 - 1.25, 0.13, u + k * 0.1 + 0.02, y1 - 0.7, 0.155);
  });
  mb.paint('accent', () => mb.arcBand(u, y1 - 0.38, 0, Math.min(w * 0.3, 0.13), 0, Math.PI * 2, 0.16, 0.19, 16));
}

/** Glazed-tile frieze band under the eaves, interrupted by openings. */
function frieze(mb: MeshBuilder, fc: FacadeSpec, holes: Rect[], wallTop: number, cx: { start: boolean; end: boolean }): void {
  const ya = wallTop - 0.62;
  const yb = wallTop - 0.27;
  const s0 = cx.start ? -0.015 : 0;
  const s1 = fc.length + (cx.end ? 0.015 : 0);
  mb.paint('accent', () => {
    for (const r of cutRects(s0, s1, ya, yb, holes)) mb.box(r.u0, r.v0, 0, r.u1, r.v1, 0.015);
  });
  mb.paint('trim', () => {
    for (const y of [ya - 0.06, yb]) for (const r of cutRects(s0, s1, y, y + 0.06, holes)) mb.box(r.u0, r.v0, 0, r.u1, r.v1, 0.03);
  });
}

/** Gothic brick arcade frieze: a row of small round arches on corbels under the eaves. */
function corbelFrieze(mb: MeshBuilder, fc: FacadeSpec, y: number): void {
  if (fc.length < 1) return;
  const step = 0.62;
  const count = Math.max(1, Math.floor(fc.length / step));
  const off = (fc.length - count * step) / 2;
  mb.paint('trim', () => {
    for (let k = 0; k < count; k++) {
      const u = off + step * (k + 0.5);
      mb.arcBand(u, y - 0.32, 0.2, 0.27, 0, Math.PI, 0, 0.07, 8);
      mb.box(off + step * k - 0.06, y - 0.52, 0, off + step * k + 0.06, y - 0.3, 0.07);
    }
    mb.box(0, y - 0.06, 0, fc.length, y, 0.08);
  });
}

/** Deep Art Nouveau eaves: carved brackets under the soffit. */
function eaveBrackets(mb: MeshBuilder, fc: FacadeSpec, eave: number, overhang: number): void {
  if (fc.length < 0.9) return;
  const count = Math.max(1, Math.round(fc.length / 1.1));
  const step = fc.length / count;
  mb.paint('trim', () => {
    for (let k = 0; k <= count; k++) {
      const u = Math.min(fc.length - 0.08, Math.max(0.08, k * step));
      console_(mb, u, eave - 0.14, 0, overhang - 0.12, 0.6, 0.12);
    }
  });
}

/**
 * Plain wall with openings for secondary volumes (tower faces, oriel faces):
 * wall pieces, spandrels and window/door detailing, no rustication.
 */
export function buildSimpleFacade(mb: MeshBuilder, spec: HouseSpec, fc: FacadeSpec, y0: number, y1: number, thickness: number, frieze_?: [number, number]): void {
  glassSeed = spec.input.seed;
  const holes = fc.openings.map(holeOf);
  mb.with(facadeFrame(fc), () => {
    mb.paint('wall', () => {
      for (const r of cutRects(0, fc.length, y0, y1, holes)) mb.box(r.u0, r.v0, -thickness, r.u1, r.v1, 0);
    });
    for (const o of fc.openings) {
      if (o.head !== 'flat') spandrels(mb, o, -thickness + 0.03, 0);
      if (o.kind === 'door') doorDetail(mb, o, 0, o.surround ?? 'portico');
      else windowDetail(mb, o, 0, spec.genome.smallPanes, spec.genome.glazing === 'deco');
    }
    if (spec.genome.eaves === 'corbel' && y1 > spec.roof.eaveY) corbelFrieze(mb, fc, y1 - 0.55);
    if (frieze_ && spec.genome.accentFrieze) {
      mb.paint('accent', () => {
        for (const r of cutRects(-0.015, fc.length + 0.015, frieze_[0], frieze_[1], holes)) mb.box(r.u0, r.v0, 0, r.u1, r.v1, 0.015);
      });
    }
  });
}

function basementWindows(mb: MeshBuilder, spec: HouseSpec, fc: FacadeSpec): void {
  const ph = spec.plinthHeight;
  if (ph < 0.85) return;
  const dx = (fc.b[0] - fc.a[0]) / fc.length;
  const dz = (fc.b[1] - fc.a[1]) / fc.length;
  for (const o of fc.openings) {
    if (o.floor !== 0 || o.kind !== 'window') continue;
    const x = fc.a[0] + dx * o.u;
    const z = fc.a[1] + dz * o.u;
    const underStair = spec.stairs.some((s) => !s.facadeId && x > s.x0 - 1.5 && x < s.x1 + 1.5 && Math.abs(z - s.zStart) < 0.05);
    if (underStair) continue;
    const w = Math.min(0.75, o.width * 0.6);
    const y0 = ph * 0.28;
    const y1 = ph * 0.72;
    mb.paint('glass', () => mb.box(o.u - w / 2, y0, 0.0, o.u + w / 2, y1, 0.1));
    mb.paint('metal', () => {
      for (let k = 1; k < 4; k++) {
        const x2 = o.u - w / 2 + (w * k) / 4;
        mb.box(x2 - 0.012, y0, 0.1, x2 + 0.012, y1, 0.125);
      }
    });
    mb.paint('stone', () => {
      mb.box(o.u - w / 2 - 0.08, y0 - 0.06, 0.08, o.u + w / 2 + 0.08, y0, 0.15);
    });
  }
}
