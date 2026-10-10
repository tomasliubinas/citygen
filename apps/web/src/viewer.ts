import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { addNavHint } from './render/nav';
import { bushGeometry, treeVariants } from './render/trees';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { createLook, glassReflections, enhanceMaterial, geometryFor, glassMaterial, kindForSlot, setAge, stainMaterial, type Look, type TimeOfDay } from './render/look';
import type { InteriorSpec } from '@citygen/interior';
import type { MeshData } from '@citygen/core';
import type { HouseSpec, WorldEdge } from '@citygen/house';
import type { Rect } from './editor';

/** Material look per engine material slot; colours come from the spec palette. */
const LOOK: Record<string, { roughness: number; metalness: number; side?: THREE.Side }> = {
  wall: { roughness: 0.93, metalness: 0 },
  trim: { roughness: 0.86, metalness: 0 },
  stone: { roughness: 0.95, metalness: 0 },
  roof: { roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide },
  glass: { roughness: 0.04, metalness: 0.6 },
  frame: { roughness: 0.55, metalness: 0 },
  door: { roughness: 0.55, metalness: 0 },
  metal: { roughness: 0.45, metalness: 0.6 },
  roofTrim: { roughness: 0.5, metalness: 0.35 },
  accent: { roughness: 0.3, metalness: 0.1 },
  void: { roughness: 1, metalness: 0 },
};

/** three.js presentation of a generated house. Pure consumer of HouseSpec + MeshData. */
export class HouseViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(38, 1, 0.5, 2000);
  readonly controls: OrbitControls;
  private sun: THREE.DirectionalLight;
  private house = new THREE.Group();
  private site = new THREE.Group();
  private contract = new THREE.Group();
  private materials = new Map<string, THREE.MeshStandardMaterial>();
  framed = false;
  private lastSpec: HouseSpec | null = null;
  private ground: THREE.Mesh;
  private look: Look;
  private sunKey = '';
  private decals = new Map<string, THREE.MeshStandardMaterial>();
  private decal(slot: string, color: string): THREE.MeshStandardMaterial {
    let m = this.decals.get(slot);
    if (!m) this.decals.set(slot, (m = stainMaterial(color)));
    return m;
  }
  private glass = (() => { const g = glassMaterial(); g.name = 'glass'; return g; })();
  private hemi!: THREE.HemisphereLight;
  private sunElevation = 1;
  private interior = new THREE.Group();
  private interiorMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private hasCellar = false;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    container.appendChild(this.renderer.domElement);

    this.look = createLook(this.renderer, this.scene, this.camera, { aoRadius: 0.9, haze: 0.0016, skyRadius: 1500 });
    glassReflections(this.renderer, this.glass);
    this.look.setSun(new THREE.Vector3(-1.3, 1.25, 1.1));

    this.hemi = new THREE.HemisphereLight('#e4e8ed', '#8d8573', 0.45);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff0dc', 3.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0003;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(600, 64).rotateX(-Math.PI / 2),
      enhanceMaterial(new THREE.MeshStandardMaterial({ color: '#a2aa8b', roughness: 1 }), 'ground'),
    );
    ground.receiveShadow = true;
    ground.position.y = -0.02;
    this.ground = ground;
    this.interior.visible = false;
    this.scene.add(ground, this.site, this.house, this.contract, this.interior);


    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 6;
    this.controls.maxDistance = 400;
    addNavHint(container, this.controls as never);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
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

  private material(slot: string, color: string): THREE.MeshStandardMaterial {
    let m = this.materials.get(slot);
    if (!m) {
      const look = LOOK[slot] ?? { roughness: 0.8, metalness: 0 };
      m = enhanceMaterial(new THREE.MeshStandardMaterial({ ...look, side: look.side ?? THREE.FrontSide }), kindForSlot(slot));
      m.name = slot;
      this.materials.set(slot, m);
    }
    m.color.set(color);
    return m;
  }

  setHouse(spec: HouseSpec, mesh: MeshData): void {
    disposeChildren(this.house);
    for (const [slot, buf] of Object.entries(mesh)) {
      const g = geometryFor(buf, slot);
      const mat = slot === 'stain' || slot === 'rust' ? this.decal(slot, spec.palette[slot] ?? '#463e33') : slot === 'glass' ? this.glass : this.material(slot, spec.palette[slot] ?? '#cccccc');
      const m = new THREE.Mesh(g, mat);
      m.castShadow = slot !== 'glass' && slot !== 'stain' && slot !== 'rust';
      m.receiveShadow = true;
      this.house.add(m);
    }
    setAge(this.materials.values(), spec.weathering.condition, spec.weathering.strength);
    this.house.position.set(spec.placement.x, 0, spec.placement.z);
    this.house.rotation.y = spec.placement.rotationY;
    this.buildGarden(spec);
    this.lastSpec = spec;

    this.placeSun(spec);

    if (!this.framed) {
      this.frame();
      this.framed = true;
    }
  }

  /** Sun (and its shadow frustum) relative to the house; the sky's sun glow follows. */
  private placeSun(spec: HouseSpec): void {
    const r = Math.max(spec.envelope.width, spec.envelope.depth);
    const s = this.sun.shadow.camera;
    s.left = s.bottom = -r * 0.95;
    s.right = s.top = r * 0.95;
    s.near = 1;
    s.far = r * 6;
    s.updateProjectionMatrix();
    const sunLocal = new THREE.Vector3(-r * 1.3, r * 1.5 * this.sunElevation, r * 1.1).applyAxisAngle(new THREE.Vector3(0, 1, 0), spec.placement.rotationY);
    this.sun.position.set(spec.placement.x + sunLocal.x, sunLocal.y, spec.placement.z + sunLocal.z);
    const key = `${spec.placement.rotationY}|${this.sunElevation}`;
    if (key !== this.sunKey) {
      this.sunKey = key;
      this.look.setSun(sunLocal.clone());
    }
    this.sun.target.position.set(spec.placement.x, 0, spec.placement.z);

  }

  /** Day / dusk / night: sky, light and lit windows. */
  setTime(t: TimeOfDay): void {
    const p = this.look.setTime(t);
    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.hemi.intensity = p.hemiIntensity;
    this.sunElevation = p.sunElevation;
    this.sunKey = '';
    if (this.lastSpec) this.placeSun(this.lastSpec);
  }

  /** Camera presets relative to the entrance facade (azimuth 0 = straight at the front). */
  frame(view: string = 'default'): void {
    const spec = this.lastSpec;
    if (!spec) return;
    const r = Math.max(spec.envelope.width, spec.envelope.depth);
    const h = spec.roof.ridgeY;
    const presets: Record<string, [number, number, number]> = {
      default: [-28, 18, 1.75],
      front: [0, 8, 1.6],
      back: [180 + 25, 18, 1.75],
      side: [90, 12, 1.75],
      roof: [-35, 48, 1.8],
      close: [-18, 6, 0.8],
    };
    const [az, el, dist] = presets[view] ?? presets.default;
    const D = r * dist;
    const a = (az * Math.PI) / 180;
    const e = (el * Math.PI) / 180;
    const local = new THREE.Vector3(Math.sin(a) * Math.cos(e) * D, h * 0.4 + Math.sin(e) * D, Math.cos(a) * Math.cos(e) * D);
    local.applyAxisAngle(new THREE.Vector3(0, 1, 0), spec.placement.rotationY);
    this.controls.target.set(spec.placement.x, h * 0.38, spec.placement.z);
    this.camera.position.set(spec.placement.x + local.x, local.y, spec.placement.z + local.z);
    this.controls.update();
  }

  /** Lot surface and the street in front of it. */
  setSite(rect: Rect, front: WorldEdge): void {
    disposeChildren(this.site);
    const w = rect.x1 - rect.x0;
    const d = rect.z1 - rect.z0;
    const lot = new THREE.Mesh(
      new THREE.PlaneGeometry(w + 6, d + 6).rotateX(-Math.PI / 2),
      enhanceMaterial(new THREE.MeshStandardMaterial({ color: '#d6cfc0', roughness: 1 }), 'ground'),
    );
    lot.position.set((rect.x0 + rect.x1) / 2, 0, (rect.z0 + rect.z1) / 2);
    lot.receiveShadow = true;
    this.site.add(lot);

    const streetW = 9;
    const horizontal = front === 'south' || front === 'north';
    const len = 400;
    const street = new THREE.Mesh(
      new THREE.PlaneGeometry(horizontal ? len : streetW, horizontal ? streetW : len).rotateX(-Math.PI / 2),
      new THREE.MeshStandardMaterial({ color: '#5d6066', roughness: 0.95 }),
    );
    const off = 3 + 1.5 + streetW / 2;
    const cx = (rect.x0 + rect.x1) / 2;
    const cz = (rect.z0 + rect.z1) / 2;
    street.position.set(
      front === 'east' ? rect.x1 + off : front === 'west' ? rect.x0 - off : cx,
      0.01,
      front === 'south' ? rect.z1 + off : front === 'north' ? rect.z0 - off : cz,
    );
    street.receiveShadow = true;
    this.site.add(street);

    // Dashed envelope outline: the boundary the house must fit in.
    const pts = [
      [rect.x0, rect.z0], [rect.x1, rect.z0], [rect.x1, rect.z1], [rect.x0, rect.z1], [rect.x0, rect.z0],
    ].map(([x, z]) => new THREE.Vector3(x, 0.03, z));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineDashedMaterial({ color: '#7a7d82', dashSize: 0.6, gapSize: 0.4 }),
    );
    line.computeLineDistances();
    this.site.add(line);
  }

  /** What the interior layer receives: floor plates, wall openings, stair core. */
  setContract(spec: HouseSpec | null): void {
    disposeChildren(this.contract);
    if (!spec) return;
    const shape = new THREE.Shape(spec.footprint.map(([x, z]) => new THREE.Vector2(x, -z)));
    const plateMat = new THREE.MeshBasicMaterial({ color: '#5b7bd5', transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
    const g = new THREE.Group();
    for (const f of spec.floors) {
      const plate = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2), plateMat);
      plate.position.y = f.elevation + 0.02;
      g.add(plate);
      const edge = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(spec.footprint.map(([x, z]) => new THREE.Vector3(x, f.elevation + 0.03, z))),
        new THREE.LineBasicMaterial({ color: '#5b7bd5' }),
      );
      g.add(edge);
    }
    if (spec.stairCore) {
      const sc = spec.stairCore;
      const top = spec.roof.eaveY;
      const y0 = spec.floors[0].elevation;
      const core = new THREE.Mesh(
        new THREE.BoxGeometry(sc.x1 - sc.x0, top - y0, sc.z1 - sc.z0),
        new THREE.MeshBasicMaterial({ color: '#d5785b', transparent: true, opacity: 0.35, depthWrite: false }),
      );
      core.position.set((sc.x0 + sc.x1) / 2, (y0 + top) / 2, (sc.z0 + sc.z1) / 2);
      g.add(core);
    }
    g.position.set(spec.placement.x, 0, spec.placement.z);
    g.rotation.y = spec.placement.rotationY;
    this.contract.add(g);
  }

  /** Hide the house walls so the contract overlay is readable. */
  setXray(on: boolean): void {
    for (const m of this.materials.values()) {
      m.transparent = on;
      m.opacity = on ? 0.25 : 1;
      m.depthWrite = !on;
      m.needsUpdate = true;
    }
  }

  /** Interior layer: all levels at once (the exterior is hidden while it is shown). */
  setInterior(spec: InteriorSpec, meshes: { level: number; mesh: MeshData }[]): void {
    disposeChildren(this.interior);
    for (const { mesh } of meshes) {
      for (const [slot, buf] of Object.entries(mesh)) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(buf.positions, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(buf.normals, 3));
        g.setIndex(new THREE.BufferAttribute(buf.indices, 1));
        let m = this.interiorMaterials.get(slot);
        if (!m) {
          m = new THREE.MeshStandardMaterial({ roughness: slot === 'windowMark' ? 0.2 : 0.8, metalness: slot === 'rail' ? 0.5 : 0, name: slot });
          this.interiorMaterials.set(slot, m);
        }
        m.color.set(spec.palette[slot] ?? '#cccccc');
        const me = new THREE.Mesh(g, m);
        me.castShadow = true;
        me.receiveShadow = true;
        this.interior.add(me);
      }
    }
    this.hasCellar = spec.levels.some((l) => l.kind === 'cellar');
    this.interior.position.set(spec.placement.x, 0, spec.placement.z);
    this.interior.rotation.y = spec.placement.rotationY;
  }

  /** Interior on: no outer walls, no roof; the ground turns translucent so the cellar shows. */
  setInteriorVisible(on: boolean): void {
    this.house.visible = !on;
    this.interior.visible = on;
    const gm = this.ground.material as THREE.MeshStandardMaterial;
    gm.transparent = on && this.hasCellar;
    gm.opacity = gm.transparent ? 0.35 : 1;
    gm.depthWrite = !gm.transparent;
    for (const o of this.site.children) {
      const mm = (o as THREE.Mesh).material as THREE.Material;
      mm.transparent = gm.transparent;
      mm.opacity = gm.opacity;
      mm.depthWrite = gm.depthWrite;
    }
  }

  /**
   * The visible model (house, or the interior when it is shown) as binary glTF.
   * Plain PBR materials with the house palette; procedural shader detail is not baked.
   */
  async exportGLB(): Promise<ArrayBuffer> {
    const src = this.interior.visible ? this.interior : this.house;
    const out = new THREE.Group();
    out.name = this.interior.visible ? 'interior' : 'house';
    const mats = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    src.updateMatrixWorld(true);
    src.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || !o.visible) return;
      const m = o.material as THREE.MeshStandardMaterial;
      // Stain decals are a shader overlay; leave them out of the model.
      if (m.vertexColors) return;
      let pm = mats.get(m);
      if (!pm) {
        pm = new THREE.MeshStandardMaterial({ color: m.color, roughness: m.roughness, metalness: m.metalness, side: m.side, transparent: m.transparent, opacity: m.opacity });
        pm.name = m.name || `${o.name || 'part'}`;
        mats.set(m, pm);
      }
      const g = new THREE.BufferGeometry();
      for (const k of ['position', 'normal']) if (o.geometry.getAttribute(k)) g.setAttribute(k, o.geometry.getAttribute(k));
      if (o.geometry.index) g.setIndex(o.geometry.index);
      const copy = new THREE.Mesh(g, pm);
      copy.applyMatrix4(o.matrixWorld);
      out.add(copy);
    });
    const result = await new GLTFExporter().parseAsync(out, { binary: true });
    return result as ArrayBuffer;
  }

  /** Garden on the part of a deep plot behind the building: lawn, hedge border, path, trees. */
  private garden = new THREE.Group();
  private buildGarden(spec: HouseSpec): void {
    disposeChildren(this.garden);
    if (!this.garden.parent) this.scene.add(this.garden);
    const g = spec.garden;
    if (!g || g.z1 - g.z0 < 3) return;
    const w = g.x1 - g.x0;
    const d = g.z1 - g.z0;
    const lawn = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.4, d - 0.4).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#8fa274', roughness: 1 }));
    lawn.position.set((g.x0 + g.x1) / 2, 0.025, (g.z0 + g.z1) / 2);
    lawn.receiveShadow = true;
    // Seeded so the same plot keeps the same garden.
    let seed = 0;
    for (const ch of spec.input.seed) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const greens = ['#4f6a3e', '#5a7444', '#46603a', '#617c4a'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
    /** Irregular leafy blob: an icosahedron with jittered vertices. */
    const blob = (r: number, detail = 1) => {
      const geo = new THREE.IcosahedronGeometry(r, detail);
      const pos = geo.getAttribute('position');
      const salt = rnd() * 100;
      for (let i = 0; i < pos.count; i++) {
        // Same jitter for the same corner (faces share corners), so the blob stays closed.
        const h = Math.sin(pos.getX(i) * 12.9898 + pos.getY(i) * 78.233 + pos.getZ(i) * 37.719 + salt) * 43758.5453;
        const k = 0.84 + (h - Math.floor(h)) * 0.32;
        pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k * 0.9, pos.getZ(i) * k);
      }
      geo.computeVertexNormals();
      return geo;
    };
    const add = (m: THREE.Mesh) => {
      m.castShadow = m.receiveShadow = true;
      this.garden.add(m);
    };
    // Clipped hedge: 1 m segments with slightly uneven height and width, a rounded cap.
    const hedge = (x0: number, z0: number, x1: number, z1: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const n = Math.max(1, Math.round(len / 1.0));
      const ang = Math.atan2(x1 - x0, z1 - z0);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const h = 1.05 + rnd() * 0.15;
        const wd = 0.6 + rnd() * 0.1;
        const seg = new THREE.Mesh(new THREE.BoxGeometry(wd, h, len / n + 0.04), greens[i % 2]);
        seg.position.set(x0 + (x1 - x0) * t, h / 2, z0 + (z1 - z0) * t);
        seg.rotation.y = ang;
        add(seg);
        const cap = new THREE.Mesh(blob(0.42, 0), greens[2 + (i % 2)]);
        cap.scale.set(wd * 1.4, 0.5, (len / n) * 1.5);
        cap.position.set(seg.position.x, h, seg.position.z);
        cap.rotation.y = ang;
        add(cap);
      }
    };
    hedge(g.x0 + 0.3, g.z0 + 0.3, g.x1 - 0.3, g.z0 + 0.3);
    hedge(g.x0 + 0.3, g.z0 + 0.3, g.x0 + 0.3, g.z1);
    hedge(g.x1 - 0.3, g.z0 + 0.3, g.x1 - 0.3, g.z1);
    const path = new THREE.Mesh(new THREE.PlaneGeometry(1.4, d - 0.6).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#cfc6b3', roughness: 1 }));
    path.position.set(0, 0.035, (g.z0 + g.z1) / 2 + 0.3);
    path.receiveShadow = true;
    this.garden.add(lawn, path);
    // Gravel forecourt at the foot of the garden steps, wider than the steps and their side flights.
    const gs = spec.stairs.find((st) => st.role === 'garden');
    if (gs) {
      const run = gs.steps * 0.34;
      const fx0 = Math.max(g.x0 + 0.8, gs.x0 - run - 1.2);
      const fx1 = Math.min(g.x1 - 0.8, gs.x1 + run + 1.2);
      const fd = Math.min(3.2, d * 0.3);
      const court = new THREE.Mesh(new THREE.PlaneGeometry(fx1 - fx0, fd + 0.6).rotateX(-Math.PI / 2), path.material);
      court.position.set((fx0 + fx1) / 2, 0.036, g.z1 - fd / 2 + 0.3);
      court.receiveShadow = true;
      this.garden.add(court);
    }
    // Low bushes along the path, and trees — the same open leafy look as in the city.
    const variants = treeVariants(3);
    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true, side: THREE.DoubleSide });
    for (let z = g.z0 + 2; z < g.z1 - 3.6; z += 2.2 + rnd() * 1.2) {
      for (const side of [-1, 1]) {
        if (rnd() < 0.3) continue;
        const r = 0.35 + rnd() * 0.25;
        const b = new THREE.Mesh(bushGeometry(r), leafMat);
        b.position.set(side * (1.2 + rnd() * 0.3), r * 0.7, z);
        add(b);
      }
    }
    const trunkMat = new THREE.MeshStandardMaterial({ color: '#5a4636', roughness: 1 });
    const count = Math.min(10, Math.floor((w * d) / 110));
    for (let i = 0; i < count; i++) {
      const x = g.x0 + 2.5 + rnd() * (w - 5);
      if (Math.abs(x) < 2.2) continue;
      const z = g.z0 + 2.5 + rnd() * Math.max(1, d - 7.5);
      const sc = 0.8 + rnd() * 0.5;
      const vg = variants[i % variants.length];
      for (const [geo, mat] of [[vg.trunk, trunkMat], [vg.crown, leafMat]] as const) {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, 0, z);
        m.rotation.y = rnd() * Math.PI * 2;
        m.scale.setScalar(sc);
        add(m);
      }
    }
    this.garden.position.set(spec.placement.x, 0, spec.placement.z);
    this.garden.rotation.y = spec.placement.rotationY;
  }
}

function disposeChildren(group: THREE.Object3D): void {
  group.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
      o.geometry.dispose();
    }
  });
  group.clear();
}
