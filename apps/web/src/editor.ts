import type { HouseSpec, WorldEdge } from '@citygen/house';

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
  | { mode: 'move'; start: [number, number]; orig: Rect; moved: boolean }
  | { mode: 'resize'; l: boolean; r: boolean; t: boolean; b: boolean; orig: Rect; edge: WorldEdge | null; moved: boolean }
  | { mode: 'draw'; anchor: [number, number] };

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
  private drag: Drag | null = null;
  private hover: { cursor: string } = { cursor: 'crosshair' };
  private ctx: CanvasRenderingContext2D;
  private size = 336;

  constructor(private canvas: HTMLCanvasElement, private opts: Options) {
    this.ctx = canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', (e) => this.down(e));
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', () => (this.drag = null));
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

  setOverlay(spec: HouseSpec | null): void {
    this.overlay = spec;
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
  private toWorld(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    const h = this.opts.extent / 2;
    return [(e.clientX - r.left) / this.scale - h, (e.clientY - r.top) / this.scale - h];
  }
  private snap = (v: number) => Math.round(v / SNAP) * SNAP;

  private hit(p: [number, number]) {
    const tol = 9 / this.scale;
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
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.toWorld(e);
    const h = this.hit(p);
    if (h.kind === 'edge') this.drag = { mode: 'resize', l: h.l, r: h.r, t: h.t, b: h.b, orig: { ...this.rect }, edge: h.edge, moved: false };
    else if (h.kind === 'inside') this.drag = { mode: 'move', start: p, orig: { ...this.rect }, moved: false };
    else this.drag = { mode: 'draw', anchor: [this.snap(p[0]), this.snap(p[1])] };
  }

  private move(e: PointerEvent): void {
    const p = this.toWorld(e);
    if (!this.drag) {
      const h = this.hit(p);
      const cursor =
        h.kind === 'inside' ? 'move'
        : h.kind === 'edge' ? ((h.l || h.r) && (h.t || h.b) ? ((h.l && h.t) || (h.r && h.b) ? 'nwse-resize' : 'nesw-resize') : h.l || h.r ? 'ew-resize' : 'ns-resize')
        : 'crosshair';
      if (cursor !== this.hover.cursor) this.canvas.style.cursor = this.hover.cursor = cursor;
      return;
    }
    const { minSize, maxSize, extent } = this.opts;
    const half = extent / 2;
    const d = this.drag;
    let next: Rect;
    if (d.mode === 'move') {
      const w = d.orig.x1 - d.orig.x0;
      const h = d.orig.z1 - d.orig.z0;
      const x0 = Math.min(half - w, Math.max(-half, this.snap(d.orig.x0 + p[0] - d.start[0])));
      const z0 = Math.min(half - h, Math.max(-half, this.snap(d.orig.z0 + p[1] - d.start[1])));
      next = { x0, z0, x1: x0 + w, z1: z0 + h };
      if (x0 !== d.orig.x0 || z0 !== d.orig.z0) d.moved = true;
    } else if (d.mode === 'resize') {
      const o = d.orig;
      const sx = this.snap(Math.max(-half, Math.min(half, p[0])));
      const sz = this.snap(Math.max(-half, Math.min(half, p[1])));
      next = { ...o };
      if (d.l) next.x0 = Math.min(o.x1 - minSize, Math.max(o.x1 - maxSize, sx));
      if (d.r) next.x1 = Math.max(o.x0 + minSize, Math.min(o.x0 + maxSize, sx));
      if (d.t) next.z0 = Math.min(o.z1 - minSize, Math.max(o.z1 - maxSize, sz));
      if (d.b) next.z1 = Math.max(o.z0 + minSize, Math.min(o.z0 + maxSize, sz));
      if (next.x0 !== o.x0 || next.x1 !== o.x1 || next.z0 !== o.z0 || next.z1 !== o.z1) d.moved = true;
    } else {
      const [ax, az] = d.anchor;
      const sx = this.snap(p[0]);
      const sz = this.snap(p[1]);
      const dirX = sx >= ax ? 1 : -1;
      const dirZ = sz >= az ? 1 : -1;
      const w = Math.min(maxSize, Math.max(minSize, Math.abs(sx - ax)));
      const h = Math.min(maxSize, Math.max(minSize, Math.abs(sz - az)));
      let x0 = dirX > 0 ? ax : ax - w;
      let z0 = dirZ > 0 ? az : az - h;
      x0 = Math.min(half - w, Math.max(-half, x0));
      z0 = Math.min(half - h, Math.max(-half, z0));
      next = { x0, z0, x1: x0 + w, z1: z0 + h };
    }
    if (next.x0 !== this.rect.x0 || next.x1 !== this.rect.x1 || next.z0 !== this.rect.z0 || next.z1 !== this.rect.z1) {
      this.rect = next;
      this.draw();
      this.opts.onChange(next);
    }
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    this.canvas.releasePointerCapture(e.pointerId);
    if (d?.mode === 'resize' && !d.moved && d.edge) this.opts.onFront(d.edge);
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

    ctx.strokeStyle = '#c2643c';
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (this.front === 'south') { ctx.moveTo(ax, bz); ctx.lineTo(bx, bz); }
    if (this.front === 'north') { ctx.moveTo(ax, az); ctx.lineTo(bx, az); }
    if (this.front === 'east') { ctx.moveTo(bx, az); ctx.lineTo(bx, bz); }
    if (this.front === 'west') { ctx.moveTo(ax, az); ctx.lineTo(ax, bz); }
    ctx.stroke();

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

    for (const st of spec.stairs) {
      if (st.direction === 'sides') {
        const run = st.steps * 0.34;
        rect(st.x0 - run, st.zEnd, st.x1 + run, st.zStart, '#e6e1d7', '#cbc5b9');
      } else rect(st.x0, st.zStart, st.x1, st.zEnd, '#e6e1d7', '#cbc5b9');
    }
    if (spec.portico) {
      const st = spec.stairs.find((s2) => s2.role === 'entrance')!;
      rect(st.x0, spec.portico.zWall, st.x1, st.zStart, '#e6e1d7', '#cbc5b9');
    }
    poly(spec.footprint as [number, number][], '#f3f1ec', '#3a3d42');
    if (spec.courtyard) poly(spec.courtyard as [number, number][], '#ffffff', '#3a3d42');
    if (spec.portico) {
      for (const col of spec.portico.columns) {
        const [px, pz] = P(col.x, col.z);
        ctx.beginPath();
        ctx.arc(px, pz, Math.max(1.5, (col.diameter / 2) * this.scale), 0, Math.PI * 2);
        ctx.fillStyle = '#3a3d42';
        ctx.fill();
      }
    }
    if (spec.stairCore) {
      const sc = spec.stairCore;
      rect(sc.x0, sc.z0, sc.x1, sc.z1, 'rgba(91,123,213,0.12)', 'rgba(91,123,213,0.5)');
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
