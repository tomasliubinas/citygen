import type { CitySpec } from '@citygen/city';

/** 2D overview: blocks, plots, avenues, camera target. Click to fly there. */
export class Minimap {
  private ctx: CanvasRenderingContext2D;
  private city: CitySpec | null = null;
  private size = 200;

  constructor(canvas: HTMLCanvasElement, onPick: (x: number, z: number) => void) {
    this.ctx = canvas.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    this.size = canvas.clientWidth || 200;
    canvas.width = this.size * dpr;
    canvas.height = this.size * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    canvas.addEventListener('click', (e) => {
      if (!this.city) return;
      const r = canvas.getBoundingClientRect();
      const [x, z] = this.toWorld((e.clientX - r.left) * (this.size / r.width), (e.clientY - r.top) * (this.size / r.height));
      onPick(x, z);
    });
  }

  private get scale() {
    return (this.size - 12) / (this.city?.size ?? 1);
  }
  private toPx(x: number, z: number): [number, number] {
    return [this.size / 2 + x * this.scale, this.size / 2 + z * this.scale];
  }
  private toWorld(px: number, pz: number): [number, number] {
    return [(px - this.size / 2) / this.scale, (pz - this.size / 2) / this.scale];
  }

  setCity(city: CitySpec): void {
    this.city = city;
  }

  draw(target: { x: number; z: number }, cam: { x: number; z: number }, selected: number | null): void {
    const ctx = this.ctx;
    const S = this.size;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#62656b';
    ctx.fillRect(0, 0, S, S);
    const city = this.city;
    if (!city) return;
    const poly = (pts: [number, number][], fill: string) => {
      ctx.beginPath();
      pts.forEach(([x, z], i) => {
        const [px, pz] = this.toPx(x, z);
        if (i) ctx.lineTo(px, pz);
        else ctx.moveTo(px, pz);
      });
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    for (const b of city.blocks) poly(b.outline, b.kind === 'park' ? '#94a77d' : b.kind === 'plaza' ? '#ddd6c8' : '#cdc8be');
    city.plots.forEach((p, i) => poly(p.corners, i === selected ? '#c2643c' : '#8f8a80'));
    const [tx, tz] = this.toPx(target.x, target.z);
    const [cx, cz] = this.toPx(cam.x, cam.z);
    ctx.strokeStyle = '#c2643c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cz);
    ctx.lineTo(tx, tz);
    ctx.stroke();
    ctx.fillStyle = '#c2643c';
    ctx.beginPath();
    ctx.arc(tx, tz, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
