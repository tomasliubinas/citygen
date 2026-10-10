import type { HouseSpec, WorldEdge } from '@citygen/house';
import type { InteriorSpec } from '@citygen/interior';

/** Envelope rectangle in world metres (integer, snapped). +X east, +Z south. */
export interface Rect { x0: number; z0: number; x1: number; z1: number }

interface Options {
  extent: number;
  minSize: number;
  maxSize: number;
  onChange: (rect: Rect) => void;
  onFront: (front: WorldEdge) => void;
}

type Drag =
  | { mode: 'move'; start: [number, number]; orig: Rect }
  | { mode: 'resize'; l: boolean; r: boolean; t: boolean; b: boolean; orig: Rect; edge: WorldEdge | null; moved: boolean };

const GRID = 2;
const SNAP = 1;

/**
 * 2D envelope editor. Knows nothing about how houses are generated — it only
 * edits a rectangle and a front edge, and draws an optional footprint overlay.
 */
export class PlanEditor {
  rect: Rect = { x0: -14, z0: -9, x1: 14, z1: 9 };
  front: WorldEdge = 'south';
  private overlay: HouseSpec | null = null;
  private interior: InteriorSpec | null = null;
  private drag: Drag | null = null;
  private hover: { cursor: string } = { cursor: 'default' };
  private ctx: CanvasRenderingContext2D;
  private size = 336;

  constructor(private canvas: HTMLCanvasElement, private opts: Options) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', () => (this.drag = null));
    // Only the house (edges, corners, inside) is interactive: elsewhere a touch scrolls the page.
    canvas.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      if (e.touches.length === 1 && this.hit(this.toWorld(t), true).kind !== 'none') e.preventDefault();
    }, { passive: false });
    this.resize();
  }

  setRect(r: Rect): void {
    this.rect = r;
    this.draw();
  }

  setFront(f: WorldEdge): void {
    this.front = f;
    this.draw();
  }

  setOverlay(spec: HouseSpec | null, interior: InteriorSpec | null = null): void {
    this.overlay = spec;
    this.interior = interior;
    this.draw();
  }

  private resize(): void {
    const css = this.canvas.clientWidth || 336;
    const dpr = window.devicePixelRatio || 1;
    this.size = css;
    this.canvas.width = Math.round(css * dpr);
    this.canvas.height = Math.round(css * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  private get scale() {
    return this.size / this.opts.extent;
  }
  private toPx(x: number, z: number): [number, number] {
    const h = this.opts.extent / 2;
    return [(x + h) * this.scale, (z + h) * this.scale];
  }
  private toWorld(e: { clientX: number; clientY: number }): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const h = this.opts.extent / 2;
    return [(e.clientX - r.left) / this.scale - h, (e.clientY - r.top) / this.scale - h];
  }
  private snap = (v: number) => Math.round(v / SNAP) * SNAP;

  private hit(p: [number, number], touch = false) {
    const tol = (touch ? 18 : 9) / this.scale;
    const { x0, z0, x1, z1 } = this.rect;
    const nearX0 = Math.abs(p[0] - x0) < tol;
    const nearX1 = Math.abs(p[0] - x1) < tol;
    const nearZ0 = Math.abs(p[1] - z0) < tol;
    const nearZ1 = Math.abs(p[1] - z1) < tol;
    const inX = p[0] > x0 - tol && p[0] < x1 + tol;
    const inZ = p[1] > z0 - tol && p[1] < z1 + tol;
    const l = nearX0 && inZ;
    const r = nearX1 && inZ;
    const t = nearZ0 && inX;
    const b = nearZ1 && inX;
    if (l || r || t || b) {
      const corner = (l || r) && (t || b);
      const edge: WorldEdge | null = corner ? null : l ? 'west' : r ? 'east' : t ? 'north' : 'south';
      return { kind: 'edge' as const, l, r, t, b, edge };
    }
    if (p[0] > x0 && p[0] < x1 && p[1] > z0 && p[1] < z1) return { kind: 'inside' as const };
    return { kind: 'none' as const };
  }

  private down(e: PointerEvent): void {
    const p = this.toWorld(e);
    const h = this.hit(p, e.pointerType === 'touch');
    if (h.kind === 'none') return;
    this.canvas.setPointerCapture(e.pointerId);
    if (h.kind === 'inside') {
      this.drag = { mode: 'move', start: p, orig: { ...this.rect } };
      return;
    }
    this.drag = { mode: 'resize', l: h.l, r: h.r, t: h.t, b: h.b, orig: { ...this.rect }, edge: h.edge, moved: false };
  }

  private move(e: PointerEvent): void {
    const p = this.toWorld(e);
    if (!this.drag) {
      const h = this.hit(p);
      const cursor =
        h.kind === 'inside' ? 'move'
        : h.kind === 'edge' ? ((h.l || h.r) && (h.t || h.b) ? ((h.l && h.t) || (h.r && h.b) ? 'nwse-resize' : 'nesw-resize') : h.l || h.r ? 'ew-resize' : 'ns-resize')
        : 'default';
      if (cursor !== this.hover.cursor) this.canvas.style.cursor = this.hover.cursor = cursor;
      return;
    }
    const { minSize, maxSize, extent } = this.opts;
    const half = extent / 2;
    const d = this.drag;
    const o = d.orig;
    if (d.mode === 'move') {
      const w = o.x1 - o.x0;
      const h = o.z1 - o.z0;
      const x0 = Math.min(half - w, Math.max(-half, this.snap(o.x0 + p[0] - d.start[0])));
      const z0 = Math.min(half - h, Math.max(-half, this.snap(o.z0 + p[1] - d.start[1])));
      this.apply({ x0, z0, x1: x0 + w, z1: z0 + h });
      return;
    }
    const sx = this.snap(Math.max(-half, Math.min(half, p[0])));
    const sz = this.snap(Math.max(-half, Math.min(half, p[1])));
    const next = { ...o };
    if (d.l) next.x0 = Math.min(o.x1 - minSize, Math.max(o.x1 - maxSize, sx));
    if (d.r) next.x1 = Math.max(o.x0 + minSize, Math.min(o.x0 + maxSize, sx));
    if (d.t) next.z0 = Math.min(o.z1 - minSize, Math.max(o.z1 - maxSize, sz));
    if (d.b) next.z1 = Math.max(o.z0 + minSize, Math.min(o.z0 + maxSize, sz));
    if (next.x0 !== o.x0 || next.x1 !== o.x1 || next.z0 !== o.z0 || next.z1 !== o.z1) d.moved = true;
    this.apply(next);
  }

  private apply(next: Rect): void {
    if (next.x0 !== this.rect.x0 || next.x1 !== this.rect.x1 || next.z0 !== this.rect.z0 || next.z1 !== this.rect.z1) {
      this.rect = next;
      this.draw();
      this.opts.onChange(next);
    }
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.canvas.releasePointerCapture(e.pointerId);
    if (d.mode === 'resize' && !d.moved && d.edge) this.opts.onFront(d.edge);
  }

  draw(): void {
    const ctx = this.ctx;
    const S = this.size;
    const { extent } = this.opts;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, S, S);

    // Grid: 2 m minor, 10 m major.
    for (let v = -extent / 2; v <= extent / 2; v += GRID) {
      const major = v % 10 === 0;
      ctx.strokeStyle = v === 0 ? '#cfcac0' : major ? '#e3dfd7' : '#f1efea';
      ctx.lineWidth = 1;
      const [px] = this.toPx(v, 0);
      const [, pz] = this.toPx(0, v);
      ctx.beginPath();
      ctx.moveTo(Math.round(px) + 0.5, 0);
      ctx.lineTo(Math.round(px) + 0.5, S);
      ctx.moveTo(0, Math.round(pz) + 0.5);
      ctx.lineTo(S, Math.round(pz) + 0.5);
      ctx.stroke();
    }

    const { x0, z0, x1, z1 } = this.rect;
    const [ax, az] = this.toPx(x0, z0);
    const [bx, bz] = this.toPx(x1, z1);

    // Street along the front edge.
    ctx.fillStyle = 'rgba(194,100,60,0.10)';
    const band = 6 * this.scale;
    if (this.front === 'south') ctx.fillRect(0, bz, S, band);
    if (this.front === 'north') ctx.fillRect(0, az - band, S, band);
    if (this.front === 'east') ctx.fillRect(bx, 0, band, S);
    if (this.front === 'west') ctx.fillRect(ax - band, 0, band, S);

    ctx.fillStyle = 'rgba(58,61,66,0.05)';
    ctx.fillRect(ax, az, bx - ax, bz - az);

    if (this.overlay) this.drawOverlay(this.overlay);

    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = '#3a3d42';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(ax + 0.5, az + 0.5, bx - ax - 1, bz - az - 1);
    ctx.setLineDash([]);


    ctx.fillStyle = '#3a3d42';
    for (const [cx, cz] of [[ax, az], [bx, az], [ax, bz], [bx, bz]]) ctx.fillRect(cx - 3, cz - 3, 6, 6);

    ctx.font = '11px ui-sans-serif, -apple-system, sans-serif';
    ctx.fillStyle = '#7a7d82';
    ctx.textAlign = 'center';
    const labelTop = this.front === 'north' ? bz + 14 : az - 6;
    ctx.fillText(`${x1 - x0} m`, (ax + bx) / 2, labelTop < 10 ? bz + 14 : labelTop);
    ctx.save();
    const labelX = this.front === 'west' ? bx + 12 : ax - 8;
    ctx.translate(labelX < 10 ? bx + 12 : labelX, (az + bz) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${z1 - z0} m`, 0, 0);
    ctx.restore();
    ctx.fillStyle = '#c2643c';
    ctx.font = '600 10px ui-sans-serif, -apple-system, sans-serif';
    const sp = { south: [(ax + bx) / 2, bz + band / 2 + 4], north: [(ax + bx) / 2, az - band / 2 + 4], east: [bx + band / 2, (az + bz) / 2], west: [ax - band / 2, (az + bz) / 2] }[this.front];
    ctx.fillText('STREET', sp[0], sp[1]);
  }

  /** Ground-floor partitions (very faint) and the staircases as the interior plan places them. */
  private drawRooms(interior: InteriorSpec, P: (lx: number, lz: number) => [number, number]): void {
    const ctx = this.ctx;
    const ground = interior.levels.find((l) => l.floor === 0);
    if (!ground) return;
    // Partitions with gaps at doors.
    ctx.strokeStyle = 'rgba(58,61,66,0.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const w of interior.walls) {
      if (w.level !== ground.index) continue;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      if (len < 1e-3) continue;
      const at = (u: number) => P(w.a[0] + ((w.b[0] - w.a[0]) * u) / len, w.a[1] + ((w.b[1] - w.a[1]) * u) / len);
      const gaps = w.openings.map((o) => [o.u - o.width / 2, o.u + o.width / 2]).sort((g, h) => g[0] - h[0]);
      let u = 0;
      for (const [g0, g1] of [...gaps, [len, len]]) {
        if (g0 > u) {
          ctx.moveTo(...at(u));
          ctx.lineTo(...at(g0));
        }
        u = Math.max(u, g1);
      }
    }
    ctx.stroke();
    // Staircases: two flights with treads, the half landing at the back, an arrow up.
    for (const st of interior.stairs) {
      if (st.fromLevel !== ground.index) continue;
      const { x, z, rotationY } = st.transform;
      const c = Math.cos(rotationY);
      const s = Math.sin(rotationY);
      const Q = (lx: number, lz: number) => P(x + lx * c + lz * s, z - lx * s + lz * c);
      const seg = (x0: number, z0: number, x1: number, z1: number) => {
        ctx.moveTo(...Q(x0, z0));
        ctx.lineTo(...Q(x1, z1));
      };
      const fw = (st.x1 - st.x0 - 0.12) / 2;
      const zl = st.z0 + st.landingDepth;
      const n1 = Math.ceil(st.risers / 2);
      const n2 = st.risers - n1;
      ctx.beginPath();
      [Q(st.x0, st.z0), Q(st.x1, st.z0), Q(st.x1, st.z1), Q(st.x0, st.z1)].forEach(([px, pz], i) => (i ? ctx.lineTo(px, pz) : ctx.moveTo(px, pz)));
      ctx.closePath();
      ctx.fillStyle = 'rgba(91,123,213,0.10)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(91,123,213,0.6)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      seg(st.x0, zl, st.x1, zl);
      seg(st.x0 + fw, zl, st.x0 + fw, st.z1);
      seg(st.x1 - fw, zl, st.x1 - fw, zl + n2 * st.tread);
      for (let i = 2; i < n1; i += 2) seg(st.x0, st.z1 - i * st.tread, st.x0 + fw, st.z1 - i * st.tread);
      for (let j = 2; j < n2; j += 2) seg(st.x1 - fw, zl + j * st.tread, st.x1, zl + j * st.tread);
      ctx.strokeStyle = 'rgba(91,123,213,0.45)';
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(91,123,213,0.12)';
    ctx.strokeStyle = 'rgba(91,123,213,0.5)';
    for (const sp of interior.spirals) {
      if (sp.level !== ground.index) continue;
      const [px, pz] = P(sp.cx, sp.cz);
      ctx.beginPath();
      ctx.arc(px, pz, sp.radius * this.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /** Generated footprint, porch and stairs, mapped from building-local to world. */
  private drawOverlay(spec: HouseSpec): void {
    const ctx = this.ctx;
    const { x, z, rotationY } = spec.placement;
    const c = Math.cos(rotationY);
    const s = Math.sin(rotationY);
    const P = (lx: number, lz: number) => this.toPx(x + lx * c + lz * s, z - lx * s + lz * c);
    const poly = (pts: [number, number][], fill: string, stroke?: string) => {
      ctx.beginPath();
      pts.forEach(([lx, lz], i) => {
        const [px, pz] = P(lx, lz);
        if (i === 0) ctx.moveTo(px, pz);
        else ctx.lineTo(px, pz);
      });
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };
    const rect = (x0: number, z0: number, x1: number, z1: number, fill: string, stroke?: string) =>
      poly([[x0, z0], [x1, z0], [x1, z1], [x0, z1]], fill, stroke);

    // Outdoor steps: landing plus one line per tread; wing steps live in their facade's frame.
    for (const st of spec.stairs) {
      const fc = st.facadeId ? spec.facades.find((f) => f.id === st.facadeId) : undefined;
      const F = (u: number, w: number): [number, number] => {
        if (!fc) return P(u, w);
        const dx = (fc.b[0] - fc.a[0]) / fc.length;
        const dz = (fc.b[1] - fc.a[1]) / fc.length;
        return P(fc.a[0] + u * dx + w * fc.normal[0], fc.a[1] + u * dz + w * fc.normal[1]);
      };
      const box = (x0: number, z0: number, x1: number, z1: number) => {
        ctx.beginPath();
        [F(x0, z0), F(x1, z0), F(x1, z1), F(x0, z1)].forEach(([px, pz], i) => (i ? ctx.lineTo(px, pz) : ctx.moveTo(px, pz)));
        ctx.closePath();
        ctx.fillStyle = '#e6e1d7';
        ctx.fill();
        ctx.strokeStyle = '#b9b2a4';
        ctx.lineWidth = 1;
        ctx.stroke();
      };
      const line = (a: [number, number], b: [number, number]) => {
        ctx.beginPath();
        ctx.moveTo(...F(...a));
        ctx.lineTo(...F(...b));
        ctx.strokeStyle = '#b9b2a4';
        ctx.stroke();
      };
      if (st.direction === 'sides') {
        const tread = 0.34;
        const run = st.steps * tread;
        box(st.x0 - run, st.zEnd, st.x1 + run, st.zStart);
        line([st.x0, st.zEnd], [st.x0, st.zStart]);
        line([st.x1, st.zEnd], [st.x1, st.zStart]);
        for (let i = 2; i < st.steps; i += 2) {
          line([st.x1 + i * tread, st.zEnd], [st.x1 + i * tread, st.zStart]);
          line([st.x0 - i * tread, st.zEnd], [st.x0 - i * tread, st.zStart]);
        }
      } else {
        box(st.x0, st.zStart, st.x1, st.zEnd);
        const tread = (st.zEnd - st.zStart - st.landing) / st.steps;
        for (let i = 0; i < st.steps; i += 2) line([st.x0, st.zStart + st.landing + i * tread], [st.x1, st.zStart + st.landing + i * tread]);
      }
    }
    if (spec.portico) {
      const st = spec.stairs.find((s2) => s2.role === 'entrance')!;
      rect(st.x0, spec.portico.zWall, st.x1, st.zStart, '#e6e1d7', '#cbc5b9');
    }
    // Towers stand on the ground; oriels project only on upper floors (dashed).
    const ring = (pts: readonly (readonly [number, number])[], closed: boolean, fresh = true) => {
      if (fresh) ctx.beginPath();
      pts.forEach(([lx, lz], i) => (i ? ctx.lineTo(...P(lx, lz)) : ctx.moveTo(...P(lx, lz))));
      if (closed) ctx.closePath();
    };
    // Footprint with the courtyard cut out, so the grid shows through the yard.
    const body = () => {
      ctx.beginPath();
      ring(spec.footprint, true, false);
      if (spec.courtyard) ring(spec.courtyard, true, false);
    };
    ctx.fillStyle = '#f3f1ec';
    for (const tw of spec.towers) {
      ring(tw.outline, true);
      ctx.fill();
    }
    body();
    ctx.fill('evenodd');
    // One outer wall line around footprint + towers: each outline is stroked only outside the other.
    const S = this.size;
    const outside = (paths: () => void) => {
      ctx.beginPath();
      ctx.rect(0, 0, S, S);
      paths();
      ctx.clip('evenodd');
    };
    ctx.strokeStyle = '#3a3d42';
    ctx.save();
    if (spec.towers.length) outside(() => spec.towers.forEach((tw) => ring(tw.outline, true, false)));
    body();
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    if (spec.towers.length) {
      ctx.save();
      outside(() => ring(spec.footprint, true, false));
      ctx.beginPath();
      for (const tw of spec.towers) ring(tw.outline, true, false);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    for (const o of spec.oriels) {
      ring(o.outline, false);
      ctx.strokeStyle = 'rgba(58,61,66,0.7)';
      ctx.stroke();
    }
    ctx.setLineDash([]);
    if (this.interior) this.drawRooms(this.interior, P);
    // Walls where courtyard wings meet the main block (or each other), faint like partitions.
    const blocks = spec.masses.filter((m) => m.role === 'main' || m.role.startsWith('court'));
    ctx.beginPath();
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const m = blocks[i];
        const n = blocks[j];
        for (const zz of [m.z0, m.z1]) {
          const lo = Math.max(m.x0, n.x0);
          const hi = Math.min(m.x1, n.x1);
          if ((Math.abs(zz - n.z0) < 1e-3 || Math.abs(zz - n.z1) < 1e-3) && hi - lo > 0.5) {
            ctx.moveTo(...P(lo, zz));
            ctx.lineTo(...P(hi, zz));
          }
        }
        for (const xx of [m.x0, m.x1]) {
          const lo = Math.max(m.z0, n.z0);
          const hi = Math.min(m.z1, n.z1);
          if ((Math.abs(xx - n.x0) < 1e-3 || Math.abs(xx - n.x1) < 1e-3) && hi - lo > 0.5) {
            ctx.moveTo(...P(xx, lo));
            ctx.lineTo(...P(xx, hi));
          }
        }
      }
    }
    ctx.strokeStyle = 'rgba(58,61,66,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (spec.portico) {
      for (const col of spec.portico.columns) {
        const [px, pz] = P(col.x, col.z);
        ctx.beginPath();
        ctx.arc(px, pz, Math.max(1.5, (col.diameter / 2) * this.scale), 0, Math.PI * 2);
        ctx.fillStyle = '#3a3d42';
        ctx.fill();
      }
    }
    for (const f of spec.facades) {
      for (const o of f.openings) {
        if (o.floor !== 0 || (o.kind !== 'door' && o.kind !== 'garden-door')) continue;
        const [px, pz] = P(o.position[0], o.position[2]);
        ctx.fillStyle = '#c2643c';
        ctx.beginPath();
        ctx.arc(px, pz, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}
