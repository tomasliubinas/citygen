import {
  IDENTITY,
  type Mat,
  type Vec2,
  type Vec3,
  apply,
  applyDir,
  cross,
  determinant,
  dot,
  frame,
  mul,
  normalize,
  sub,
} from './math';

/** Plain triangle buffers per material — trivially convertible to three.js, glTF, etc. */
export interface MeshBuffers {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Optional per-vertex opacity (decals such as stains); absent = fully opaque. */
  alpha?: Float32Array;
}
export type MeshData = Record<string, MeshBuffers>;

class Part {
  pos: number[] = [];
  nor: number[] = [];
  idx: number[] = [];
  alpha: number[] = [];
  hasAlpha = false;
}

const EPS = 1e-9;

/**
 * Renderer-agnostic mesh builder with a transform stack and per-material parts.
 * Front faces are counter-clockwise. Most primitives take an "expected" outward
 * normal and orient themselves, so callers never have to think about winding.
 */
export class MeshBuilder {
  private parts = new Map<string, Part>();
  private m: Mat = IDENTITY;
  private mirrored = false;
  material = 'default';
  /** When set, emitted vertices carry this scalar in `alpha` (e.g. a per-window random id for glass). */
  value: number | null = null;

  /** Run `fn` with an extra local transform applied. */
  with(local: Mat, fn: () => void): void {
    const prevM = this.m;
    const prevMirror = this.mirrored;
    this.m = mul(this.m, local);
    this.mirrored = determinant(this.m) < 0;
    try {
      fn();
    } finally {
      this.m = prevM;
      this.mirrored = prevMirror;
    }
  }

  /** Run `fn` with a different current material. */
  paint(material: string, fn: () => void): void {
    const prev = this.material;
    this.material = material;
    try {
      fn();
    } finally {
      this.material = prev;
    }
  }

  private part(): Part {
    let p = this.parts.get(this.material);
    if (!p) {
      p = new Part();
      this.parts.set(this.material, p);
    }
    return p;
  }

  private emit(points: Vec3[], normals: Vec3[], triangles: number[], alphas?: number[]): void {
    const part = this.part();
    const base = part.pos.length / 3;
    if (alphas || this.value !== null) part.hasAlpha = true;
    for (let i = 0; i < points.length; i++) {
      const p = apply(this.m, points[i]);
      const n = normalize(applyDir(this.m, normals[i]));
      part.pos.push(p[0], p[1], p[2]);
      part.nor.push(n[0], n[1], n[2]);
      part.alpha.push(alphas ? alphas[i] : (this.value ?? 1));
    }
    for (let i = 0; i < triangles.length; i += 3) {
      if (this.mirrored) part.idx.push(base + triangles[i], base + triangles[i + 2], base + triangles[i + 1]);
      else part.idx.push(base + triangles[i], base + triangles[i + 1], base + triangles[i + 2]);
    }
  }

  /** Flat triangle; flipped if its geometric normal opposes `expected`. */
  tri(a: Vec3, b: Vec3, c: Vec3, expected?: Vec3): void {
    let n = cross(sub(b, a), sub(c, a));
    if (Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) < EPS) return;
    n = normalize(n);
    if (expected && dot(n, expected) < 0) {
      this.emit([a, c, b], [[-n[0], -n[1], -n[2]], [-n[0], -n[1], -n[2]], [-n[0], -n[1], -n[2]]], [0, 1, 2]);
    } else {
      this.emit([a, b, c], [n, n, n], [0, 1, 2]);
    }
  }

  /** Flat planar quad a-b-c-d (in order around the perimeter). */
  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, expected?: Vec3): void {
    let n = cross(sub(b, a), sub(c, a));
    if (Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) < EPS) n = cross(sub(c, a), sub(d, a));
    if (Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2]) < EPS) return;
    n = normalize(n);
    if (expected && dot(n, expected) < 0) {
      const m: Vec3 = [-n[0], -n[1], -n[2]];
      this.emit([a, d, c, b], [m, m, m, m], [0, 1, 2, 0, 2, 3]);
    } else {
      this.emit([a, b, c, d], [n, n, n, n], [0, 1, 2, 0, 2, 3]);
    }
  }

  /** Quad with per-corner opacity (decals). Winding as given (CCW from the front). */
  quadAlpha(a: Vec3, b: Vec3, c: Vec3, d: Vec3, alphas: [number, number, number, number]): void {
    const n = normalize(cross(sub(b, a), sub(c, a)));
    this.emit([a, b, c, d], [n, n, n, n], [0, 1, 2, 0, 2, 3], alphas);
  }

  /** Planar polygon, fan-triangulated from vertex 0 (must be star-shaped from it). */
  fan(points: Vec3[], expected: Vec3): void {
    for (let i = 1; i < points.length - 1; i++) this.tri(points[0], points[i], points[i + 1], expected);
  }

  /** Axis-aligned box in the current frame. */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    if (x1 - x0 < EPS || y1 - y0 < EPS || z1 - z0 < EPS) return;
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
    this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0]);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0]);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1]);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
  }

  /** Box between two points: a beam of given width (side) and height (up). */
  beam(a: Vec3, b: Vec3, width: number, height: number, upHint: Vec3 = [0, 1, 0]): void {
    const dir = sub(b, a);
    const len = Math.hypot(dir[0], dir[1], dir[2]);
    if (len < EPS) return;
    const x = normalize(dir);
    let z = normalize(cross(x, upHint));
    if (Math.abs(z[0]) + Math.abs(z[1]) + Math.abs(z[2]) < EPS) z = normalize(cross(x, [1, 0, 0]));
    const y = cross(z, x);
    this.with(frame(x, y, z, a), () => this.box(0, -height / 2, -width / 2, len, height / 2, width / 2));
  }

  /**
   * Surface of revolution around local Y. Profile is [radius, y] from bottom to
   * top; start/end at radius 0 to close it. Each profile segment gets its own
   * ring so mouldings keep crisp edges while staying smooth around the axis.
   */
  lathe(profile: Vec2[], segments = 16): void {
    for (let i = 0; i < profile.length - 1; i++) {
      const [r0, y0] = profile[i];
      const [r1, y1] = profile[i + 1];
      if (r0 < EPS && r1 < EPS) continue;
      const n2 = normalize([y1 - y0, -(r1 - r0), 0]);
      const pts: Vec3[] = [];
      const nrm: Vec3[] = [];
      for (let j = 0; j <= segments; j++) {
        const t = (j / segments) * Math.PI * 2;
        const c = Math.cos(t);
        const s = Math.sin(t);
        pts.push([r0 * c, y0, r0 * s], [r1 * c, y1, r1 * s]);
        nrm.push([n2[0] * c, n2[1], n2[0] * s], [n2[0] * c, n2[1], n2[0] * s]);
      }
      // With profile running bottom→top and angle increasing, this winding faces outward.
      const tris: number[] = [];
      for (let j = 0; j < segments; j++) {
        const a = j * 2;
        tris.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
      }
      this.emit(pts, nrm, tris);
    }
  }

  /**
   * Extrude a polygon given in the local XY plane between z0 and z1.
   * The polygon must be star-shaped from its first vertex.
   */
  extrude(poly: Vec2[], z0: number, z1: number, caps: { front?: boolean; back?: boolean } = {}): void {
    const n = poly.length;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const [x0, y0] = poly[i];
      const [x1, y1] = poly[(i + 1) % n];
      area += x0 * y1 - x1 * y0;
    }
    const ccw = area > 0;
    if (caps.front !== false) this.fan(poly.map(([x, y]) => [x, y, z1] as Vec3), [0, 0, 1]);
    if (caps.back !== false) this.fan(poly.map(([x, y]) => [x, y, z0] as Vec3), [0, 0, -1]);
    for (let i = 0; i < n; i++) {
      const [ax, ay] = poly[i];
      const [bx, by] = poly[(i + 1) % n];
      const out: Vec3 = ccw ? [by - ay, -(bx - ax), 0] : [-(by - ay), bx - ax, 0];
      this.quad([ax, ay, z0], [bx, by, z0], [bx, by, z1], [ax, ay, z1], out);
    }
  }

  /** Annular band (arch / archivolt) in the XY plane, angles in radians. */
  arcBand(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number, z0: number, z1: number, segments = 12): void {
    const P = (r: number, a: number, z: number): Vec3 => [cx + r * Math.cos(a), cy + r * Math.sin(a), z];
    for (let i = 0; i < segments; i++) {
      const t0 = a0 + ((a1 - a0) * i) / segments;
      const t1 = a0 + ((a1 - a0) * (i + 1)) / segments;
      const tm = (t0 + t1) / 2;
      const radial: Vec3 = [Math.cos(tm), Math.sin(tm), 0];
      this.quad(P(r0, t0, z1), P(r1, t0, z1), P(r1, t1, z1), P(r0, t1, z1), [0, 0, 1]);
      this.quad(P(r0, t0, z0), P(r1, t0, z0), P(r1, t1, z0), P(r0, t1, z0), [0, 0, -1]);
      this.quad(P(r1, t0, z0), P(r1, t1, z0), P(r1, t1, z1), P(r1, t0, z1), radial);
      if (r0 > EPS) this.quad(P(r0, t0, z0), P(r0, t1, z0), P(r0, t1, z1), P(r0, t0, z1), [-radial[0], -radial[1], 0]);
    }
    const capA: Vec3 = [Math.sin(a0), -Math.cos(a0), 0];
    const capB: Vec3 = [-Math.sin(a1), Math.cos(a1), 0];
    this.quad(P(r0, a0, z0), P(r1, a0, z0), P(r1, a0, z1), P(r0, a0, z1), capA);
    this.quad(P(r0, a1, z0), P(r1, a1, z0), P(r1, a1, z1), P(r0, a1, z1), capB);
  }

  /**
   * Sweep a moulding profile along a path in the XZ plane.
   * Path points run so that the outward side is (-dz, dx) of each edge
   * (i.e. counter-clockwise seen from below / "facade order").
   * Profile points are [outward offset, y], bottom to top.
   */
  sweep(path: Vec2[], profile: Vec2[], closed: boolean): void {
    const n = path.length;
    const edgeNormal = (i: number): Vec2 => {
      const [ax, az] = path[i];
      const [bx, bz] = path[(i + 1) % n];
      const l = Math.hypot(bx - ax, bz - az) || 1;
      return [-(bz - az) / l, (bx - ax) / l];
    };
    const miter = (i: number): Vec2 => {
      const hasPrev = closed || i > 0;
      const hasNext = closed || i < n - 1;
      const np = hasPrev ? edgeNormal((i - 1 + n) % n) : edgeNormal(i);
      const nn = hasNext ? edgeNormal(i) : np;
      const d = 1 + np[0] * nn[0] + np[1] * nn[1];
      return [(np[0] + nn[0]) / d, (np[1] + nn[1]) / d];
    };
    const edges = closed ? n : n - 1;
    for (let i = 0; i < edges; i++) {
      const j = (i + 1) % n;
      const [ax, az] = path[i];
      const [bx, bz] = path[j];
      const ma = miter(i);
      const mb = miter(j);
      const en = edgeNormal(i);
      for (let k = 0; k < profile.length - 1; k++) {
        const [o0, y0] = profile[k];
        const [o1, y1] = profile[k + 1];
        const expected: Vec3 = [en[0] * (y1 - y0), -(o1 - o0), en[1] * (y1 - y0)];
        this.quad(
          [ax + ma[0] * o0, y0, az + ma[1] * o0],
          [bx + mb[0] * o0, y0, bz + mb[1] * o0],
          [bx + mb[0] * o1, y1, bz + mb[1] * o1],
          [ax + ma[0] * o1, y1, az + ma[1] * o1],
          expected,
        );
      }
    }
  }

  bake(): MeshData {
    const out: MeshData = {};
    for (const [name, p] of this.parts) {
      out[name] = {
        positions: new Float32Array(p.pos),
        normals: new Float32Array(p.nor),
        indices: new Uint32Array(p.idx),
        ...(p.hasAlpha ? { alpha: new Float32Array(p.alpha) } : {}),
      };
    }
    return out;
  }
}

/** Bounding box over all parts of a mesh. */
export function meshBounds(mesh: MeshData): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const part of Object.values(mesh)) {
    const p = part.positions;
    for (let i = 0; i < p.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        if (p[i + k] < min[k]) min[k] = p[i + k];
        if (p[i + k] > max[k]) max[k] = p[i + k];
      }
    }
  }
  return { min, max };
}

export function triangleCount(mesh: MeshData): number {
  return Object.values(mesh).reduce((s, p) => s + p.indices.length / 3, 0);
}
