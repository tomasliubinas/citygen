import * as THREE from 'three';
import { hash32 } from '@citygen/core';
import { roofHeightAt, type FacadeSpec, type HouseSpec, type RoofPartSpec } from '@citygen/house';

/**
 * Cheap stand-in for a house (≈100–300 triangles): extruded footprint up to the
 * eaves, simple roof volumes, towers as prisms with cones. Built in
 * building-local coordinates; non-indexed with a `color` attribute so many of
 * them can be merged into one draw call.
 */
export function buildMassing(spec: HouseSpec): { walls: THREE.BufferGeometry; roofs: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const wallParts: THREE.BufferGeometry[] = [];
  const roofParts: THREE.BufferGeometry[] = [];

  const shape = new THREE.Shape(spec.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
  const courtyard = (spec as unknown as { courtyard?: [number, number][] }).courtyard;
  if (courtyard?.length) shape.holes.push(new THREE.Path(courtyard.map(([x, z]) => new THREE.Vector2(x, -z))));
  wallParts.push(extrude(shape, spec.roof.eaveY));

  for (const t of spec.towers ?? []) {
    // Up to the roof base: the detailed model fills this band with its cornice.
    wallParts.push(extrude(new THREE.Shape(t.outline.map(([x, z]) => new THREE.Vector2(x, -z))), t.roofBaseY + 0.02));
    const sides = t.sides ?? 8;
    const rb = (t.apothem + 0.35) / Math.cos(Math.PI / sides);
    const cone = new THREE.ConeGeometry(rb, t.roofHeight, sides, 1, false, Math.PI / 2 + Math.PI / sides);
    cone.translate(t.center[0], t.roofBaseY + t.roofHeight / 2, t.center[1]);
    roofParts.push(cone.toNonIndexed());
  }

  for (const p of spec.roof.parts) roofParts.push(roofVolume(p));

  const facades = [...spec.facades, ...(spec.towers ?? []).flatMap((t) => t.facades)];
  const win = windowPanes(facades, spec);
  return {
    walls: concatColored([paint(merge(wallParts), worn(spec.palette.wall ?? '#f2efe8', spec.weathering.condition)), win.frames]),
    roofs: paint(merge(roofParts), spec.palette.roof ?? '#3a3d42'),
    glass: win.glass,
  };
}

/**
 * Far-view windows: every opening of the spec as two flat quads on the wall —
 * a light frame and a dark pane (doors in the door colour). ~4 triangles each.
 */
function windowPanes(facades: FacadeSpec[], spec: HouseSpec): { frames: THREE.BufferGeometry; glass: THREE.BufferGeometry } {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const gpos: number[] = [];
  const gnor: number[] = [];
  const gwin: number[] = [];
  const frame = new THREE.Color(spec.palette.trim ?? '#fbfaf6');
  const glass = new THREE.Color('#2a3742');
  const door = new THREE.Color(spec.palette.door ?? '#5a3b26');
  const rect = (fc: FacadeSpec, u0: number, u1: number, y0: number, y1: number, out: number, c: THREE.Color, win = -1) => {
    const dx = (fc.b[0] - fc.a[0]) / fc.length;
    const dz = (fc.b[1] - fc.a[1]) / fc.length;
    const [nx, nz] = fc.normal;
    const P = (u: number, y: number) => [fc.a[0] + dx * u + nx * out, y, fc.a[1] + dz * u + nz * out];
    const a = P(u0, y0);
    const b = P(u1, y0);
    const cc = P(u1, y1);
    const d = P(u0, y1);
    // Counter-clockwise seen from outside: along +u is "right" when looking at the facade.
    for (const v of [a, b, cc, a, cc, d]) {
      if (win >= 0) {
        gpos.push(v[0], v[1], v[2]);
        gnor.push(nx, 0, nz);
        gwin.push(win);
        continue;
      }
      pos.push(v[0], v[1], v[2]);
      nor.push(nx, 0, nz);
      col.push(c.r, c.g, c.b);
    }
  };
  for (const fc of facades) {
    for (const o of fc.openings) {
      const u0 = o.u - o.width / 2;
      const u1 = o.u + o.width / 2;
      const top = o.sill + o.height;
      const isDoor = o.kind === 'door' || o.kind === 'garden-door';
      rect(fc, u0 - 0.13, u1 + 0.13, o.sill - 0.1, top + 0.14, 0.03, frame);
      if (isDoor) rect(fc, u0, u1, o.sill, top, 0.05, door);
      else rect(fc, u0, u1, o.sill, top, 0.05, glass, hash32(`${spec.input.seed}/${o.id}`) / 4294967296 + Math.round(spec.weathering.condition * 10));
      // A mullion and transom read as a window even from far away.
      if (!isDoor && o.width > 0.7) {
        rect(fc, o.u - 0.035, o.u + 0.035, o.sill, top, 0.06, frame);
        const ty = o.sill + o.height * 0.72;
        rect(fc, u0, u1, ty - 0.035, ty + 0.035, 0.06, frame);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(gpos, 3));
  gg.setAttribute('normal', new THREE.Float32BufferAttribute(gnor, 3));
  gg.setAttribute('aWin', new THREE.Float32BufferAttribute(gwin, 1));
  return { frames: g, glass: gg };
}

function concatColored(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = ['position', 'normal', 'color'] as const;
  const total = parts.reduce((s, p) => s + p.getAttribute('position').count, 0);
  const g = new THREE.BufferGeometry();
  for (const name of names) {
    const arr = new Float32Array(total * 3);
    let o = 0;
    for (const p of parts) {
      arr.set(p.getAttribute(name).array as Float32Array, o);
      o += p.getAttribute(name).count * 3;
    }
    g.setAttribute(name, new THREE.BufferAttribute(arr, 3));
  }
  for (const p of parts) p.dispose();
  return g;
}

function extrude(shape: THREE.Shape, height: number): THREE.BufferGeometry {
  const g = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
  g.rotateX(-Math.PI / 2);
  const out = g.index ? g.toNonIndexed() : g;
  out.deleteAttribute('uv');
  return out;
}

/** Hip / mansard (as a hip to the same apex) / gable roof as plain triangles. */
function roofVolume(p: RoofPartSpec): THREE.BufferGeometry {
  const { x0, x1, z0, z1, baseY: y } = p;
  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  const quad = (a: number[], b: number[], c: number[], d: number[]) => {
    tri(a, b, c);
    tri(a, c, d);
  };
  const w = x1 - x0;
  const d = z1 - z0;
  if (p.form === 'gable') {
    const xc = (x0 + x1) / 2;
    const h = roofHeightAt(p, xc, (z0 + z1) / 2) - y;
    quad([x0, y, z1], [xc, y + h, z1], [xc, y + h, z0], [x0, y, z0]);
    quad([x1, y, z0], [xc, y + h, z0], [xc, y + h, z1], [x1, y, z1]);
    tri([x0, y, z1], [x1, y, z1], [xc, y + h, z1]);
    tri([x1, y, z0], [x0, y, z0], [xc, y + h, z0]);
  } else {
    const h = roofHeightAt(p, (x0 + x1) / 2, (z0 + z1) / 2) - y;
    if (w >= d) {
      const zc = (z0 + z1) / 2;
      const xa = x0 + d / 2;
      const xb = x1 - d / 2;
      quad([x0, y, z1], [x1, y, z1], [xb, y + h, zc], [xa, y + h, zc]);
      quad([x1, y, z0], [x0, y, z0], [xa, y + h, zc], [xb, y + h, zc]);
      tri([x0, y, z0], [x0, y, z1], [xa, y + h, zc]);
      tri([x1, y, z1], [x1, y, z0], [xb, y + h, zc]);
    } else {
      const xc = (x0 + x1) / 2;
      const za = z0 + w / 2;
      const zb = z1 - w / 2;
      quad([x0, y, z0], [x0, y, z1], [xc, y + h, zb], [xc, y + h, za]);
      quad([x1, y, z1], [x1, y, z0], [xc, y + h, za], [xc, y + h, zb]);
      tri([x1, y, z0], [x0, y, z0], [xc, y + h, za]);
      tri([x0, y, z1], [x1, y, z1], [xc, y + h, zb]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // Roof faces are double-sided in spirit: make sure normals point up.
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i += 3) {
    if (n.getY(i) < 0) {
      for (let k = 0; k < 3; k++) n.setXYZ(i + k, -n.getX(i + k), -n.getY(i + k), -n.getZ(i + k));
      const a = pos.slice((i + 1) * 3, (i + 2) * 3);
      const b = pos.slice((i + 2) * 3, (i + 3) * 3);
      const P = g.getAttribute('position');
      P.setXYZ(i + 1, b[0], b[1], b[2]);
      P.setXYZ(i + 2, a[0], a[1], a[2]);
    }
  }
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let count = 0;
  for (const p of parts) count += p.getAttribute('position').count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) {
    if (!p.getAttribute('normal')) p.computeVertexNormals();
    pos.set(p.getAttribute('position').array as Float32Array, o * 3);
    nor.set(p.getAttribute('normal').array as Float32Array, o * 3);
    o += p.getAttribute('position').count;
    p.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

function paint(g: THREE.BufferGeometry, hex: string): THREE.BufferGeometry {
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/** Far-view wear baked into the colour: faded towards warm grey and slightly darker. */
function worn(hex: string, cond: number): string {
  const c = new THREE.Color(hex);
  const w = Math.min(1, cond / 0.9);
  const l = c.r * 0.299 + c.g * 0.587 + c.b * 0.114;
  const k = 1 - 0.12 * w;
  c.setRGB((c.r + (l * 0.97 - c.r) * 0.55 * w) * k, (c.g + (l * 0.95 - c.g) * 0.55 * w) * k, (c.b + (l * 0.9 - c.b) * 0.55 * w) * k);
  return '#' + c.getHexString();
}
