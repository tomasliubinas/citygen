import type { Vec2 } from '@citygen/core';

/**
 * 2D helpers in the ground plane (x, z). Polygons are convex and
 * counter-clockwise in the (x, z) math orientation; each edge i (v[i] → v[i+1])
 * carries a tag — the street it lies on.
 */

export interface Tag {
  streetId: number;
  /** Full street width (carriageway + both sidewalks); 0 = no street. */
  width: number;
}

export interface TaggedPoly {
  pts: Vec2[];
  tags: Tag[];
}

/** Line through p with direction d; f(q) = cross(d, q - p) > 0 on the left. */
export interface Line {
  p: Vec2;
  d: Vec2;
}

export const sideOf = (l: Line, q: Vec2) => l.d[0] * (q[1] - l.p[1]) - l.d[1] * (q[0] - l.p[0]);

/** Keep the part of a convex polygon left of `l`; edges along the cut get `tag`. */
export function clip(poly: TaggedPoly, l: Line, tag: Tag): TaggedPoly {
  const out: TaggedPoly = { pts: [], tags: [] };
  const n = poly.pts.length;
  for (let i = 0; i < n; i++) {
    const P = poly.pts[i];
    const Q = poly.pts[(i + 1) % n];
    const fp = sideOf(l, P);
    const fq = sideOf(l, Q);
    const pIn = fp >= -1e-9;
    const qIn = fq >= -1e-9;
    if (pIn) {
      out.pts.push(P);
      out.tags.push(poly.tags[i]);
    }
    if (pIn !== qIn) {
      const t = fp / (fp - fq);
      const I: Vec2 = [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t];
      out.pts.push(I);
      out.tags.push(pIn ? tag : poly.tags[i]);
    }
  }
  return dedupe(out);
}

function dedupe(poly: TaggedPoly): TaggedPoly {
  const pts: Vec2[] = [];
  const tags: Tag[] = [];
  for (let i = 0; i < poly.pts.length; i++) {
    const p = poly.pts[i];
    const prev = pts[pts.length - 1];
    if (prev && Math.hypot(p[0] - prev[0], p[1] - prev[1]) < 1e-6) {
      tags[tags.length - 1] = poly.tags[i];
      continue;
    }
    pts.push(p);
    tags.push(poly.tags[i]);
  }
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) {
    pts.pop();
    tags.pop();
  }
  return { pts, tags };
}

export const flip = (l: Line): Line => ({ p: l.p, d: [-l.d[0], -l.d[1]] });

/** Chord of a line through a convex polygon (null if it misses). */
export function chord(poly: Vec2[], l: Line): [Vec2, Vec2] | null {
  const hits: Vec2[] = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const P = poly[i];
    const Q = poly[(i + 1) % n];
    const fp = sideOf(l, P);
    const fq = sideOf(l, Q);
    if ((fp > 0) !== (fq > 0)) {
      const t = fp / (fp - fq);
      hits.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]);
    }
  }
  return hits.length >= 2 ? [hits[0], hits[1]] : null;
}

/** Shrink a convex polygon: each edge moves inward by dist(tag). */
export function inset(poly: TaggedPoly, dist: (t: Tag) => number): TaggedPoly {
  let out = poly;
  const n = poly.pts.length;
  for (let i = 0; i < n; i++) {
    const P = poly.pts[i];
    const Q = poly.pts[(i + 1) % n];
    const len = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
    if (len < 1e-9) continue;
    const d: Vec2 = [(Q[0] - P[0]) / len, (Q[1] - P[1]) / len];
    const nrm: Vec2 = [-d[1], d[0]]; // inward (left) normal
    const k = dist(poly.tags[i]);
    out = clip(out, { p: [P[0] + nrm[0] * k, P[1] + nrm[1] * k], d }, poly.tags[i]);
    if (out.pts.length < 3) return { pts: [], tags: [] };
  }
  return out;
}

export function area(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i];
    const [x1, z1] = pts[(i + 1) % pts.length];
    s += x0 * z1 - x1 * z0;
  }
  return s / 2;
}

export function centroid(pts: Vec2[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const p of pts) {
    x += p[0];
    z += p[1];
  }
  return [x / pts.length, z / pts.length];
}

/** Point inside a CCW convex polygon (with tolerance). */
export function insideConvex(pts: Vec2[], q: Vec2, tol = 1e-6): boolean {
  for (let i = 0; i < pts.length; i++) {
    const P = pts[i];
    const Q = pts[(i + 1) % pts.length];
    const len = Math.hypot(Q[0] - P[0], Q[1] - P[1]) || 1;
    if (sideOf({ p: P, d: [Q[0] - P[0], Q[1] - P[1]] }, q) / len < -tol) return false;
  }
  return true;
}

/** Separating-axis overlap test for two convex polygons (touching counts as apart). */
export function overlaps(a: Vec2[], b: Vec2[], tol = 0.05): boolean {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const P = poly[i];
      const Q = poly[(i + 1) % poly.length];
      const ax: Vec2 = [-(Q[1] - P[1]), Q[0] - P[0]];
      const len = Math.hypot(ax[0], ax[1]) || 1;
      let amin = Infinity;
      let amax = -Infinity;
      let bmin = Infinity;
      let bmax = -Infinity;
      for (const p of a) {
        const v = (p[0] * ax[0] + p[1] * ax[1]) / len;
        amin = Math.min(amin, v);
        amax = Math.max(amax, v);
      }
      for (const p of b) {
        const v = (p[0] * ax[0] + p[1] * ax[1]) / len;
        bmin = Math.min(bmin, v);
        bmax = Math.max(bmax, v);
      }
      if (amax <= bmin + tol || bmax <= amin + tol) return false;
    }
  }
  return true;
}

/** Extents of a polygon along unit axis u and its perpendicular. */
export function extents(pts: Vec2[], u: Vec2): { umin: number; umax: number; vmin: number; vmax: number } {
  let umin = Infinity;
  let umax = -Infinity;
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const p of pts) {
    const a = p[0] * u[0] + p[1] * u[1];
    const b = -p[0] * u[1] + p[1] * u[0];
    umin = Math.min(umin, a);
    umax = Math.max(umax, a);
    vmin = Math.min(vmin, b);
    vmax = Math.max(vmax, b);
  }
  return { umin, umax, vmin, vmax };
}
