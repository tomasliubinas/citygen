import * as THREE from 'three';
import { MapControls } from 'three/examples/jsm/controls/MapControls.js';
import { createLook, glassReflections, enhanceMaterial, geometryFor, glassMaterial, kindForSlot, setAge, stainMaterial, type Look, type TimeOfDay } from '../render/look';
import type { CitySpec, PlotSpec } from '@citygen/city';
import { buildHouseMesh, generateHouse, type HouseSpec } from '@citygen/house';
import { buildMassing } from './massing';

const LOOK: Record<string, { roughness: number; metalness: number; side?: THREE.Side }> = {
  wall: { roughness: 0.93, metalness: 0 },
  trim: { roughness: 0.86, metalness: 0 },
  stone: { roughness: 0.95, metalness: 0 },
  roof: { roughness: 0.62, metalness: 0.15, side: THREE.DoubleSide },
  glass: { roughness: 0.05, metalness: 0.85 },
  frame: { roughness: 0.55, metalness: 0 },
  door: { roughness: 0.55, metalness: 0 },
  metal: { roughness: 0.45, metalness: 0.6 },
  roofTrim: { roughness: 0.5, metalness: 0.35 },
  accent: { roughness: 0.3, metalness: 0.1 },
  void: { roughness: 1, metalness: 0 },
};

const SLICE_MS = 10;

interface PlotState {
  spec: HouseSpec | null;
  /** Massing in world space (walls + roofs), with a plotIndex attribute. */
  walls: THREE.BufferGeometry | null;
  roofs: THREE.BufferGeometry | null;
  glass: THREE.BufferGeometry | null;
  matrix: THREE.Matrix4;
}

/**
 * three.js view of a CitySpec. Every house is generated (layout only) in time
 * slices and drawn as merged massing; the houses nearest the camera target are
 * upgraded to full-detail meshes one per idle callback.
 */
export class CityView {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera = new THREE.PerspectiveCamera(40, 1, 1, 6000);
  readonly controls: MapControls;
  private scene = new THREE.Scene();
  private sun: THREE.DirectionalLight;
  private ground = new THREE.Group();
  private massing = new THREE.Group();
  private detail = new THREE.Group();
  private highlight = new THREE.Group();
  private city: CitySpec | null = null;
  private plots: PlotState[] = [];
  private job = 0;
  private massingDirty = false;
  private lastMerge = 0;
  private detailed = new Map<number, THREE.Group>();
  private cache = new Map<number, THREE.Group>();
  private queue: number[] = [];
  private building = false;
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  private massingMat = enhanceMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), 'plaster', true);
  private massingRoofMat = enhanceMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.65, metalness: 0.1, side: THREE.DoubleSide }), 'roof', true);
  private look!: Look;
  private decals = new Map<string, THREE.MeshStandardMaterial>();
  private decal(slot: string, color: string): THREE.MeshStandardMaterial {
    let m = this.decals.get(slot);
    if (!m) this.decals.set(slot, (m = stainMaterial(color)));
    return m;
  }
  private glass = glassMaterial();
  private hemi!: THREE.HemisphereLight;
  private sunElevation = 1;
  detailCount = 16;
  onProgress: (done: number, total: number, detailed: number) => void = () => {};
  onPick: (plot: PlotSpec | null, spec: HouseSpec | null) => void = () => {};

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.domElement.classList.add('gl');
    container.prepend(this.renderer.domElement);

    this.look = createLook(this.renderer, this.scene, this.camera, { aoRadius: 1.6, haze: 0.0011, skyRadius: 4000 });
    glassReflections(this.renderer, this.glass);
    this.look.setSun(new THREE.Vector3(-160, 260, 140));
    this.hemi = new THREE.HemisphereLight('#e4e8ed', '#8d8573', 0.55);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff0dc', 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -170;
    sc.right = sc.top = 170;
    sc.near = 1;
    sc.far = 900;
    this.scene.add(this.sun, this.sun.target, this.ground, this.massing, this.detail, this.highlight);

    this.controls = new MapControls(this.camera, this.renderer.domElement);
    // Same mouse scheme as the house page: left = rotate, right (or Shift/Ctrl + left) = pan.
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minDistance = 15;
    this.controls.maxDistance = 2200;
    this.controls.screenSpacePanning = false;

    this.setupPicking();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    let lastLod = 0;
    this.renderer.setAnimationLoop((t) => {
      this.controls.update();
      const tg = this.controls.target;
      this.sun.position.set(tg.x - 160, 260 * this.sunElevation, tg.z + 140);
      this.sun.target.position.copy(tg);
      if (t - lastLod > 350) {
        lastLod = t;
        this.updateLod();
      }
      if (this.massingDirty && t - this.lastMerge > 400) this.mergeMassing(t);
      this.look.render();
    });
  }

  private resize(): void {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.look?.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---- City -------------------------------------------------------------------------

  setCity(city: CitySpec): void {
    const job = ++this.job;
    this.city = city;
    clear(this.ground);
    clear(this.massing);
    for (const g of [...this.detailed.values(), ...this.cache.values()]) disposeGroup(g);
    this.detailed.clear();
    this.cache.clear();
    clear(this.detail);
    clear(this.highlight);
    this.queue = [];
    this.plots = city.plots.map((p) => ({ spec: null, walls: null, roofs: null, glass: null, matrix: plotMatrix(p) }));
    this.buildGround(city);
    this.onPick(null, null);

    // Generate all house specs + massing in small time slices.
    let i = 0;
    const step = () => {
      if (job !== this.job) return;
      const t0 = performance.now();
      while (i < city.plots.length && performance.now() - t0 < SLICE_MS) {
        const p = city.plots[i];
        const st = this.plots[i];
        const spec = generateHouse(p.house);
        const m = new THREE.Matrix4().multiplyMatrices(st.matrix, houseMatrix(spec));
        const { walls, roofs, glass } = buildMassing(spec);
        walls.applyMatrix4(m);
        roofs.applyMatrix4(m);
        glass.applyMatrix4(m);
        tagPlot(walls, i);
        tagPlot(roofs, i);
        tagPlot(glass, i);
        st.glass = glass;
        st.spec = spec;
        st.walls = walls;
        st.roofs = roofs;
        st.matrix = m;
        i++;
      }
      this.massingDirty = true;
      this.onProgress(i, city.plots.length, this.detailed.size);
      if (i < city.plots.length) setTimeout(step, 0);
    };
    step();
  }

  /** Day / dusk / night: sky, light and lit windows. */
  setTime(t: TimeOfDay): void {
    const p = this.look.setTime(t);
    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.hemi.intensity = p.hemiIntensity * 1.2;
    this.sunElevation = p.sunElevation;
    this.look.setSun(new THREE.Vector3(-160, 260 * p.sunElevation, 140));
  }

  /** Close-up at the city centre: low angle, the detailed houses fill the view. */
  home(): void {
    if (!this.city) return;
    const [cx, cz] = this.city.centre;
    this.controls.target.set(cx, 6, cz);
    this.camera.position.set(cx - 52, 42, cz + 72);
    this.controls.update();
  }

  topView(): void {
    const t = this.controls.target;
    const d = Math.max(120, this.camera.position.distanceTo(t));
    this.camera.position.set(t.x, d, t.z + 0.01);
    this.controls.update();
  }

  flyTo(x: number, z: number): void {
    const off = this.camera.position.clone().sub(this.controls.target);
    this.controls.target.set(x, 0, z);
    this.camera.position.set(x + off.x, off.y, z + off.z);
    this.controls.update();
  }

  private buildGround(city: CitySpec): void {
    const s = city.size;
    const add = (g: THREE.BufferGeometry, color: string, y = 0, receive = true) => {
      const m = new THREE.Mesh(g, enhanceMaterial(new THREE.MeshStandardMaterial({ color, roughness: 1 }), 'ground', true));
      m.position.y = y;
      m.receiveShadow = receive;
      this.ground.add(m);
      return m;
    };
    const outer = new THREE.Mesh(new THREE.CircleGeometry(s * 3, 64).rotateX(-Math.PI / 2), enhanceMaterial(new THREE.MeshStandardMaterial({ color: '#a2aa8b', roughness: 1 }), 'ground', true));
    outer.position.y = -0.05;
    outer.receiveShadow = true;
    this.ground.add(outer);
    add(new THREE.PlaneGeometry(s + 20, s + 20).rotateX(-Math.PI / 2), '#62656b', 0);

    const curbs: number[][] = [];
    const lots: Record<'built' | 'park' | 'plaza', number[][]> = { built: [], park: [], plaza: [] };
    for (const b of city.blocks) {
      curbs.push(prism(b.outline, 0, 0.16));
      if (b.lot.length >= 3) lots[b.kind].push(fan(b.lot, 0.17));
    }
    add(fromArrays(curbs), '#cdc8be', 0);
    // Land between plots is laid out as small parks (same green as the park blocks).
    add(fromArrays(lots.built), '#94a77d', 0);
    add(fromArrays(lots.park), '#94a77d', 0);
    add(fromArrays(lots.plaza), '#ddd6c8', 0);
    add(fromArrays(city.plots.map((p) => fan(p.corners, 0.18))), '#d6d0c2', 0);

    // Plot outlines.
    const seg: number[] = [];
    for (const p of city.plots) {
      for (let i = 0; i < 4; i++) {
        const a = p.corners[i];
        const b = p.corners[(i + 1) % 4];
        seg.push(a[0], 0.22, a[1], b[0], 0.22, b[1]);
      }
    }
    const lines = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(seg, 3)),
      new THREE.LineBasicMaterial({ color: '#9b9688', transparent: true, opacity: 0.6 }),
    );
    this.ground.add(lines);

    // Lane markings on avenues and the ring road.
    const marks: number[] = [];
    for (const st of city.streets) {
      if (st.kind !== 'avenue' && st.kind !== 'ring') continue;
      const len = Math.hypot(st.b[0] - st.a[0], st.b[1] - st.a[1]);
      if (len < 2) continue;
      marks.push(st.a[0], 0.04, st.a[1], st.b[0], 0.04, st.b[1]);
    }
    const ml = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(marks, 3)),
      new THREE.LineDashedMaterial({ color: '#e9e6dc', dashSize: 3, gapSize: 4 }),
    );
    ml.computeLineDistances();
    this.ground.add(ml);

    // Trees in parks, a column on plazas.
    const trees: THREE.Vector3[] = [];
    // Trees in park blocks, and in the leftover land of built blocks (kept clear of every plot).
    const onPlot = (b: (typeof city.blocks)[number], q: [number, number]) =>
      b.plots.some((pi) => {
        const pl = city.plots[pi];
        const dx = q[0] - pl.center[0];
        const dz = q[1] - pl.center[1];
        const c = Math.cos(pl.rotation);
        const s = Math.sin(pl.rotation);
        return Math.abs(dx * c - dz * s) < pl.width / 2 + 3 && Math.abs(dx * s + dz * c) < pl.depth / 2 + 3;
      });
    for (const b of city.blocks) {
      if (b.kind === 'plaza' || b.lot.length < 3) continue;
      const xs = b.lot.map((p) => p[0]);
      const zs = b.lot.map((p) => p[1]);
      const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
      const step = b.kind === 'park' ? 11 : 9;
      for (let x = x0 + 5; x < x1 - 3; x += step) {
        for (let z = z0 + 5; z < z1 - 3; z += step) {
          const jx = x + Math.sin(x * 12.9898 + z * 78.233) * 3;
          const jz = z + Math.cos(x * 39.425 + z * 11.135) * 3;
          if (!insideConvex(b.lot, [jx, jz])) continue;
          if (b.kind === 'built' && onPlot(b, [jx, jz])) continue;
          trees.push(new THREE.Vector3(jx, 0.17, jz));
        }
      }
    }
    if (trees.length) {
      const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3.2, 1), new THREE.MeshStandardMaterial({ color: '#5f7a4a', roughness: 1 }), trees.length);
      const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.25, 0.35, 4, 6), new THREE.MeshStandardMaterial({ color: '#5a4636', roughness: 1 }), trees.length);
      const m = new THREE.Matrix4();
      trees.forEach((p, i) => {
        const sc = 0.8 + ((i * 7919) % 100) / 250;
        m.makeScale(sc, sc * 1.15, sc).setPosition(p.x, p.y + 5.5 * sc, p.z);
        crown.setMatrixAt(i, m);
        m.makeTranslation(p.x, p.y + 2, p.z);
        trunk.setMatrixAt(i, m);
      });
      crown.castShadow = trunk.castShadow = true;
      this.ground.add(crown, trunk);
    }
    for (const b of city.blocks) {
      if (b.kind !== 'plaza') continue;
      const c = centroid(b.outline);
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.1, 16, 16), new THREE.MeshStandardMaterial({ color: '#f1eee7', roughness: 0.8 }));
      col.position.set(c[0], 8.2, c[1]);
      const base = new THREE.Mesh(new THREE.BoxGeometry(5, 1.6, 5), new THREE.MeshStandardMaterial({ color: '#bdb7ad', roughness: 0.95 }));
      base.position.set(c[0], 0.95, c[1]);
      col.castShadow = base.castShadow = true;
      this.ground.add(col, base);
    }
  }

  // ---- Massing (merged) ----------------------------------------------------------------

  private mergeMassing(t: number): void {
    this.massingDirty = false;
    this.lastMerge = t;
    clear(this.massing);
    const walls: THREE.BufferGeometry[] = [];
    const roofs: THREE.BufferGeometry[] = [];
    const glass: THREE.BufferGeometry[] = [];
    this.plots.forEach((p, i) => {
      if (!p.walls || !p.roofs || this.detailed.has(i)) return;
      walls.push(p.walls);
      roofs.push(p.roofs);
      if (p.glass?.getAttribute('position').count) glass.push(p.glass);
    });
    if (!walls.length) return;
    const lists: [THREE.BufferGeometry[], THREE.Material][] = [[walls, this.massingMat], [roofs, this.massingRoofMat]];
    if (glass.length) lists.push([glass, this.glass]);
    for (const [list, mat] of lists) {
      const m = new THREE.Mesh(concat(list), mat);
      m.castShadow = true;
      m.receiveShadow = true;
      this.massing.add(m);
    }
  }

  // ---- Level of detail -------------------------------------------------------------------

  private updateLod(): void {
    if (!this.city) return;
    const tg = this.controls.target;
    const dist = this.camera.position.distanceTo(tg);
    const k = dist > 1100 ? 0 : this.detailCount;
    const radius = Math.max(90, dist * 0.7);
    const ranked = this.plots
      .map((p, i) => ({ i, d: Math.hypot(this.city!.plots[i].center[0] - tg.x, this.city!.plots[i].center[1] - tg.z), ready: !!p.spec }))
      .filter((r) => r.ready && r.d < radius)
      .sort((a, b) => a.d - b.d)
      .slice(0, k);
    const want = new Set(ranked.map((r) => r.i));
    let changed = false;
    for (const [i, g] of this.detailed) {
      if (want.has(i)) continue;
      this.detail.remove(g);
      this.detailed.delete(i);
      this.cache.set(i, g);
      changed = true;
    }
    while (this.cache.size > 40) {
      const [i, g] = this.cache.entries().next().value as [number, THREE.Group];
      this.cache.delete(i);
      disposeGroup(g);
    }
    this.queue = ranked.map((r) => r.i).filter((i) => !this.detailed.has(i));
    if (changed) this.massingDirty = true;
    this.updateWear();
    this.pump();
  }

  /** Full wear only for the few detailed houses right in front of the camera. */
  private updateWear(): void {
    this.camera.updateMatrixWorld();
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse));
    const close = [...this.detailed.entries()]
      .map(([i, g]) => {
        const c = new THREE.Vector3(this.city!.plots[i].center[0], 6, this.city!.plots[i].center[1]);
        return { g, d: c.distanceTo(this.camera.position), seen: frustum.containsPoint(c) };
      })
      .filter((r) => r.seen && r.d < 90)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4)
      .map((r) => r.g);
    const set = new Set(close);
    for (const g of this.detailed.values()) {
      const full = set.has(g);
      if (g.userData.full === full) continue;
      g.userData.full = full;
      g.traverse((o) => {
        if (!(o instanceof THREE.Mesh) || !o.userData.slot) return;
        if (o.userData.slot === 'stain' || o.userData.slot === 'rust') o.visible = full;
        else if (o.userData.slot === 'glass') return;
        else o.material = this.material(o.userData.slot, o.userData.color, full ? o.userData.age : null);
      });
    }
  }

  private pump(): void {
    if (this.building || !this.queue.length) return;
    this.building = true;
    const job = this.job;
    const run = () => {
      this.building = false;
      if (job !== this.job) return;
      const i = this.queue.shift();
      if (i === undefined) return;
      const g = this.cache.get(i) ?? this.buildDetail(i);
      this.cache.delete(i);
      this.detail.add(g);
      this.detailed.set(i, g);
      this.massingDirty = true;
      this.onProgress(this.plots.filter((p) => p.spec).length, this.plots.length, this.detailed.size);
      this.pump();
    };
    const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    if (ric) ric(run, { timeout: 120 });
    else setTimeout(run, 16);
  }

  private buildDetail(i: number): THREE.Group {
    const st = this.plots[i];
    const spec = st.spec!;
    const mesh = buildHouseMesh(spec);
    const g = new THREE.Group();
    // Built lite; updateLod() upgrades the few houses right in front of the camera
    // to full wear (noise shading, own age, drip stains).
    const age = Math.round(spec.weathering.condition * 4) / 4;
    for (const [slot, buf] of Object.entries(mesh)) {
      const geo = geometryFor(buf, slot);
      const color = spec.palette[slot] ?? '#cccccc';
      const mat = slot === 'stain' || slot === 'rust' ? this.decal(slot, spec.palette[slot] ?? '#463e33') : slot === 'glass' ? this.glass : this.material(slot, color);
      const m = new THREE.Mesh(geo, mat);
      m.userData = { slot, color, age };
      if (slot === 'stain' || slot === 'rust') m.visible = false;
      m.castShadow = slot !== 'glass' && slot !== 'stain' && slot !== 'rust';
      m.receiveShadow = true;
      g.add(m);
    }
    g.matrixAutoUpdate = false;
    g.matrix.copy(st.matrix);
    g.userData.plotIndex = i;
    return g;
  }

  /** Lite materials are shared per colour; full ones (close houses) also per wear bucket. */
  private material(slot: string, color: string, age: number | null = null): THREE.MeshStandardMaterial {
    const full = age !== null;
    const key = `${slot}|${color}|${full ? age : 'lite'}`;
    let m = this.materials.get(key);
    if (!m) {
      const look = LOOK[slot] ?? { roughness: 0.8, metalness: 0 };
      m = enhanceMaterial(new THREE.MeshStandardMaterial({ ...look, color, side: look.side ?? THREE.FrontSide }), kindForSlot(slot), !full);
      if (full) setAge([m], age);
      this.materials.set(key, m);
    }
    return m;
  }

  // ---- Picking -------------------------------------------------------------------------------

  private setupPicking(): void {
    const ray = new THREE.Raycaster();
    let down: [number, number] | null = null;
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]));
    el.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      down = null;
      const r = el.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const hits = ray.intersectObjects([...this.massing.children, ...this.detail.children], true);
      let idx: number | null = null;
      for (const h of hits) {
        let o: THREE.Object3D | null = h.object;
        while (o && o.userData.plotIndex === undefined && o.parent) o = o.parent;
        if (o && o.userData.plotIndex !== undefined) {
          idx = o.userData.plotIndex;
          break;
        }
        const attr = (h.object as THREE.Mesh).geometry?.getAttribute('plotIndex');
        if (attr && h.face) {
          idx = attr.getX(h.face.a);
          break;
        }
      }
      this.select(idx);
    });
  }

  select(idx: number | null): void {
    clear(this.highlight);
    if (idx === null || !this.city) {
      this.onPick(null, null);
      return;
    }
    const p = this.city.plots[idx];
    const pts = p.corners.map(([x, z]) => new THREE.Vector3(x, 0.3, z));
    const loop = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#c2643c' }));
    this.highlight.add(loop);
    const fill = new THREE.Mesh(fromArrays([fan(p.corners, 0.25)]), new THREE.MeshBasicMaterial({ color: '#c2643c', transparent: true, opacity: 0.25, depthWrite: false }));
    this.highlight.add(fill);
    this.onPick(p, this.plots[idx].spec);
  }
}

// ---- helpers -------------------------------------------------------------------------------------

type V2 = [number, number];

/** Plot-local → world. */
function plotMatrix(p: PlotSpec): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(p.rotation).setPosition(p.center[0], 0, p.center[1]);
}

/** Building-local → plot-local (the house's own placement inside its envelope). */
function houseMatrix(s: HouseSpec): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationY(s.placement.rotationY).setPosition(s.placement.x, 0, s.placement.z);
}

function tagPlot(g: THREE.BufferGeometry, i: number): void {
  const n = g.getAttribute('position').count;
  g.setAttribute('plotIndex', new THREE.BufferAttribute(new Float32Array(n).fill(i), 1));
}

/** Concatenate non-indexed geometries with identical attributes. */
function concat(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = Object.keys(list[0].attributes);
  const out = new THREE.BufferGeometry();
  for (const name of names) {
    const size = list[0].getAttribute(name).itemSize;
    let total = 0;
    for (const g of list) total += g.getAttribute(name).array.length;
    const arr = new Float32Array(total);
    let o = 0;
    for (const g of list) {
      const a = g.getAttribute(name).array as Float32Array;
      arr.set(a, o);
      o += a.length;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}

/** Convex polygon fan at height y (CCW in x,z → upward normal after mapping). */
function fan(poly: V2[], y: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < poly.length - 1; i++) {
    const a = poly[0];
    const b = poly[i];
    const c = poly[i + 1];
    // CCW in (x, z) math orientation faces −Y in three.js; emit reversed.
    out.push(a[0], y, a[1], c[0], y, c[1], b[0], y, b[1]);
  }
  return out;
}

/** Convex polygon slab between y0 and y1: top + side walls. */
function prism(poly: V2[], y0: number, y1: number): number[] {
  const out = fan(poly, y1);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    // Outward faces (polygon is CCW in x,z, so the outside is on the right).
    out.push(a[0], y0, a[1], b[0], y1, b[1], b[0], y0, b[1]);
    out.push(a[0], y0, a[1], a[0], y1, a[1], b[0], y1, b[1]);
  }
  return out;
}

function fromArrays(chunks: number[][]): THREE.BufferGeometry {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const arr = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    arr.set(c, o);
    o += c.length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}

function centroid(p: V2[]): V2 {
  return [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];
}

function insideConvex(poly: V2[], q: V2): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]) < 0) return false;
  }
  return true;
}

function clear(g: THREE.Object3D): void {
  g.traverse((o) => {
    if ((o as THREE.Mesh).geometry && !(o.parent && o.parent.userData.plotIndex !== undefined)) (o as THREE.Mesh).geometry.dispose();
  });
  g.clear();
}

function disposeGroup(g: THREE.Group): void {
  g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
}
