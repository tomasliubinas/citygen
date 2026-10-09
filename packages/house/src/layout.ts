import { clamp, deg, type Vec2 } from '@citygen/core';
import { createGenome, STYLES, type ManorGenome } from './genome';
import type {
  BalconySpec,
  ChimneySpec,
  DormerSpec,
  EntranceComposition,
  FacadeSide,
  FacadeSpec,
  FloorKind,
  FloorSpec,
  HouseInput,
  HouseSpec,
  MassSpec,
  OpeningSpec,
  PedimentSpec,
  PorticoSpec,
  RoofPartSpec,
  StairSpec,
  WindowCrown,
  OpeningHead,
  OrielSpec,
  TowerSpec,
  WingBlockSpec,
} from './types';

// Fixed architectural constants (metres). Seed-dependent values live in the genome.
export const WALL_THICKNESS = 0.55;
export const CORNICE_HEIGHT = 0.62;
export const CORNICE_PROJECTION = 0.42;
const CORNER_MARGIN = 0.9;
const MAX_RISER = 0.17;
const TREAD = 0.34;
const LANDING = 1.3;
const GARDEN_TERRACE = 1.4;
const MIN_MAIN_DEPTH = 8;
export const MIN_ENVELOPE = 12;
/** Beyond four storeys these houses lose their proportions. */
export const MAX_FLOORS = 4;
export const MAX_ENVELOPE = 80;

const oddRound = (x: number) => Math.max(1, 2 * Math.round((x - 1) / 2) + 1);
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export function normalizeInput(input: HouseInput): HouseSpec['input'] {
  const e = input.envelope;
  return {
    seed: String(input.seed ?? ''),
    envelope: {
      x: e.x,
      z: e.z,
      width: clamp(e.width, MIN_ENVELOPE, MAX_ENVELOPE),
      depth: clamp(e.depth, MIN_ENVELOPE, MAX_ENVELOPE),
    },
    front: input.front ?? 'south',
    centrality: clamp(input.centrality ?? 0, 0, 1),
    floors: input.floors == null ? null : clamp(Math.round(input.floors), 1, MAX_FLOORS),
    style: input.style ?? 'classicist-manor',
    partyWalls: { left: !!input.partyWalls?.left, right: !!input.partyWalls?.right },
    wear: input.wear == null ? null : clamp(input.wear, 0, 1),
  };
}

/** Floors from footprint size (bigger plan ⇒ taller) plus centrality (centre ⇒ denser). */
export function deriveFloorCount(width: number, depth: number, centrality: number): number {
  const area = width * depth;
  const base = area < 200 ? 1 : area < 700 ? 2 : 3;
  return clamp(base + Math.round(centrality * 2), 1, MAX_FLOORS);
}

const ROTATION: Record<HouseInput['front'], number> = {
  south: 0,
  east: Math.PI / 2,
  north: Math.PI,
  west: -Math.PI / 2,
};

interface FrontZone {
  comp: EntranceComposition;
  zMain: number;
  zRis: number;
  zPorticoFront: number;
}

export function layoutHouse(rawInput: HouseInput): HouseSpec {
  const input = normalizeInput(rawInput);
  const g = createGenome(input.seed, input.style);
  const env = input.envelope;
  const sideways = input.front === 'east' || input.front === 'west';
  const W = sideways ? env.depth : env.width;
  const D = sideways ? env.width : env.depth;

  // Classical cornice, or deep Art Nouveau eaves on brackets.
  const co = g.eaves === 'bracketed' ? 0.85 : g.eaves === 'corbel' ? 0.32 : g.eaves === 'parapet' ? 0.12 : CORNICE_PROJECTION;
  const inset = co + 0.05;
  // Party walls: the house runs right up to that plot edge (no eaves, no windows there).
  const party = input.partyWalls;
  const anyParty = party.left || party.right;
  const xL = party.left ? -W / 2 : -W / 2 + inset;
  const xR = party.right ? W / 2 : W / 2 - inset;
  // Back limit of the plot; the main block may stop earlier (max block depth).
  const zBackEnv = -D / 2 + Math.max(inset, GARDEN_TERRACE + 0.05);
  const plinth = g.plinthHeight;
  const steps = Math.max(3, Math.ceil(plinth / MAX_RISER));
  const stairRun = steps * TREAD;

  // ---- Floors -------------------------------------------------------------
  const wanted = input.floors ?? deriveFloorCount(W, D, input.centrality);
  // Castles stay low: floors above the cap become extra tower storeys instead.
  const nFloors = g.maxFloors ? Math.min(wanted, g.maxFloors) : wanted;
  const towerStages = g.towerStages + (wanted - nFloors);
  const floors: FloorSpec[] = [];
  let elev = plinth;
  for (let i = 0; i < nFloors; i++) {
    const kind: FloorKind = i === 0 ? 'ground' : i === 1 ? 'main' : i === nFloors - 1 ? 'top' : 'upper';
    const height = nFloors === 1 ? g.floorHeights.main : g.floorHeights[kind];
    floors.push({ index: i, kind, elevation: r3(elev), height: r3(height) });
    elev += height;
  }
  const eaveY = elev;
  const wallTop = eaveY - CORNICE_HEIGHT;

  // ---- Bays: odd count, symmetric, entrance on the central axis ------------
  const usable = xR - xL - 2 * CORNER_MARGIN;
  const n = Math.max(3, oddRound(usable / g.bayWidth));
  const bayW = usable / n;
  const centers = Array.from({ length: n }, (_, i) => xL + CORNER_MARGIN + bayW * (i + 0.5));
  const mid = (n - 1) / 2;
  const winW = clamp(bayW * 0.4, 1.0, 1.5);

  // ---- Entrance composition (size expresses what the genome prefers) ------
  const gateW = clamp(bayW * 1.5, 4.6, 7.0);
  // Castle gate tower spans the bays it covers; otherwise one or three central bays.
  const c = g.entrance === 'gate' ? Math.min(n - 2, Math.max(1, oddRound(gateW / bayW + 0.4))) : n >= 7 ? 3 : 1;
  const wingBays = n >= 9 && g.endWings && !anyParty ? (n >= 13 ? 2 : 1) : 0;
  const prefs: EntranceComposition[] =
    g.entrance === 'gate'
      ? ['gate-tower']
      : n === 3
      ? ['frontispiece']
      : g.entrance === 'portico'
        ? [nFloors <= 2 ? 'giant-portico' : 'ground-portico', 'risalit', 'frontispiece']
        : ['risalit', 'frontispiece'];
  const zoneFor = (comp: EntranceComposition): FrontZone => {
    const zPF = D / 2 - stairRun;
    switch (comp) {
      case 'giant-portico': {
        const zMain = zPF - (c === 3 ? 3.4 : 2.7);
        return { comp, zMain, zRis: zMain, zPorticoFront: zPF };
      }
      case 'ground-portico': {
        const zRis = zPF - 2.5;
        return { comp, zMain: zRis - g.risalitProjection, zRis, zPorticoFront: zPF };
      }
      case 'gate-tower': {
        const zMain = zPF - 0.6 - gateW * 0.45;
        return { comp, zMain, zRis: zMain, zPorticoFront: zPF - 0.6 };
      }
      case 'risalit': {
        const zRis = zPF - LANDING;
        return { comp, zMain: zRis - g.risalitProjection, zRis, zPorticoFront: zRis };
      }
      default: {
        const z = zPF - LANDING;
        return { comp, zMain: z, zRis: z, zPorticoFront: z };
      }
    }
  };
  const zone = prefs.map(zoneFor).find((z) => z.zMain - zBackEnv >= MIN_MAIN_DEPTH) ?? zoneFor(prefs[prefs.length - 1]);
  const comp = zone.comp;
  const { zMain, zRis } = zone;

  // ---- Plan type: never deeper than one dual-aspect flat ---------------------------
  // Deep plots get side wings around a court (U) or a closed courtyard (O); if the plot
  // is too narrow for a court, the block simply stops and the rest is garden.
  const Dm = g.blockDepth;
  const avail = zMain - zBackEnv;
  const Ww = Dm - 1.5;
  let plan: HouseSpec['plan'] = 'block';
  if (!anyParty && avail > Dm + 1 && xR - xL - 2 * Ww >= 8 && avail - Dm >= 8) {
    plan = g.courtyard === 'closed' && avail - Dm - Ww >= 8 ? 'o' : 'u';
  }
  const zBack = avail > Dm + 1 ? zMain - Dm : zBackEnv;
  const mainDepth = zMain - zBack;
  const zMid = (zBack + zMain) / 2;

  const halfC = (c * bayW) / 2;
  const cx0 = -halfC - 0.35;
  const cx1 = halfC + 0.35;
  const wingW = wingBays ? CORNER_MARGIN + wingBays * bayW + 0.3 : 0;
  const zWing = zMain + 0.6;

  // ---- Footprint: front profile + back corners -----------------------------
  const segs: [number, number, number][] = [];
  if (wingBays) segs.push([xL, xL + wingW, zWing]);
  segs.push([wingBays ? xL + wingW : xL, cx0, zMain]);
  segs.push([cx0, cx1, zRis]);
  segs.push([cx1, wingBays ? xR - wingW : xR, zMain]);
  if (wingBays) segs.push([xR - wingW, xR, zWing]);
  const footprint: Vec2[] = [];
  for (const [x0, x1, z] of segs) footprint.push([x0, z], [x1, z]);
  if (plan === 'u') {
    footprint.push([xR, zBackEnv], [xR - Ww, zBackEnv], [xR - Ww, zBack], [xL + Ww, zBack], [xL + Ww, zBackEnv], [xL, zBackEnv]);
  } else if (plan === 'o') {
    footprint.push([xR, zBackEnv], [xL, zBackEnv]);
  } else {
    footprint.push([xR, zBack], [xL, zBack]);
  }
  const fp = simplifyRing(footprint.map(([x, z]) => [r3(x), r3(z)] as Vec2));
  // Closed courtyard: inner ring, traversed so facade normals point into the court.
  const court: Vec2[] | null =
    plan === 'o'
      ? ([[xR - Ww, zBack], [xL + Ww, zBack], [xL + Ww, zBackEnv + Ww], [xR - Ww, zBackEnv + Ww]] as Vec2[]).map(([x, z]) => [r3(x), r3(z)] as Vec2)
      : null;

  const masses: MassSpec[] = [{ id: 'main', role: 'main', x0: xL, x1: xR, z0: zBack, z1: zMain }];
  if (plan !== 'block') {
    masses.push({ id: 'court-l', role: 'court-left', x0: xL, x1: xL + Ww, z0: zBackEnv, z1: zBack });
    masses.push({ id: 'court-r', role: 'court-right', x0: xR - Ww, x1: xR, z0: zBackEnv, z1: zBack });
    if (plan === 'o') masses.push({ id: 'court-rear', role: 'court-rear', x0: xL + Ww, x1: xR - Ww, z0: zBackEnv, z1: zBackEnv + Ww });
  }
  if (zRis > zMain) masses.push({ id: 'risalit', role: 'central-risalit', x0: cx0, x1: cx1, z0: zMain, z1: zRis });
  if (wingBays) {
    masses.push({ id: 'wing-l', role: 'wing-left', x0: xL, x1: xL + wingW, z0: zMain, z1: zWing });
    masses.push({ id: 'wing-r', role: 'wing-right', x0: xR - wingW, x1: xR, z0: zMain, z1: zWing });
  }

  const makeFacade = (id: string, a: Vec2, b: Vec2): FacadeSpec => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const normal: Vec2 = [r3(-(b[1] - a[1]) / len), r3((b[0] - a[0]) / len)];
    const side: FacadeSide =
      normal[1] > 0.5 ? 'front' : normal[1] < -0.5 ? 'back' : normal[0] > 0.5 ? 'right' : normal[0] < -0.5 ? 'left' : normal[1] >= 0 ? 'front' : 'back';
    return { id: `${id}-${side}`, side, a, b, length: r3(len), normal, openings: [] };
  };
  const facades: FacadeSpec[] = fp.map((a, i) => makeFacade(`f${i}`, a, fp[(i + 1) % fp.length]));
  if (court) facades.push(...court.map((a, i) => makeFacade(`c${i}`, a, court[(i + 1) % court.length])));
  const facadeAt = (side: FacadeSide, x: number, z: number) =>
    facades.find(
      (f) =>
        f.side === side &&
        Math.abs(f.a[1] - z) < 1e-3 &&
        x > Math.min(f.a[0], f.b[0]) + 0.3 &&
        x < Math.max(f.a[0], f.b[0]) - 0.3,
    );

  const doorW = clamp(bayW * 0.5, 1.45, 1.9);
  const centerHalf = Math.max(winW / 2 + 0.75, doorW / 2 + 0.6);

  // ---- Tower plan: Art Nouveau corner tower, or castle gate tower + round corner towers ----
  interface TBox { id: string; x0: number; x1: number; z0: number; z1: number; size: number; shape: 'octagon' | 'round' | 'square'; roof: TowerSpec['roof']; role: 'corner' | 'gate' }
  const towerBoxes: TBox[] = [];
  if (g.tower && g.towerPlan === 'corner' && nFloors >= 2 && n >= 5 && !wingBays && !anyParty) {
    const tw = clamp(bayW * 1.35, 4.2, 5.6);
    const z1 = Math.min(zMain + 1.4, D / 2 - 0.55);
    const x0 = g.towerSide === 'left' ? xL : xR - tw;
    // Keep clear of the central composition.
    if (!(g.towerSide === 'left' ? x0 + tw > cx0 - 0.6 : x0 < cx1 + 0.6)) towerBoxes.push({ id: 'tower', x0, x1: x0 + tw, z0: z1 - tw, z1, size: tw, shape: 'octagon', roof: g.towerRoof, role: 'corner' });
  }
  if (g.tower && (g.towerPlan === 'castle' || g.towerPlan === 'gate')) {
    if (comp === 'gate-tower') {
      const z1 = zone.zPorticoFront;
      towerBoxes.push({ id: 'gate', x0: -gateW / 2, x1: gateW / 2, z0: z1 - gateW, z1, size: gateW, shape: 'square', roof: 'pyramid', role: 'gate' });
    }
    const cs = clamp(bayW * 1.25, 4.0, 6.0);
    if (g.towerPlan === 'castle' && xR - xL - 2 * cs > gateW + 2 && !anyParty) {
      const zf = Math.min(zMain + 1.2, D / 2 - 0.6);
      towerBoxes.push({ id: 'tower-fl', x0: xL, x1: xL + cs, z0: zf - cs, z1: zf, size: cs, shape: g.towerShape, roof: 'cone', role: 'corner' });
      towerBoxes.push({ id: 'tower-fr', x0: xR - cs, x1: xR, z0: zf - cs, z1: zf, size: cs, shape: g.towerShape, roof: 'cone', role: 'corner' });
      if (g.rearTowers) {
        const zb = (avail > Dm + 1 && plan !== 'block' ? zBackEnv : zBack) - 1.0;
        towerBoxes.push({ id: 'tower-bl', x0: xL, x1: xL + cs, z0: zb, z1: zb + cs, size: cs, shape: g.towerShape, roof: 'cone', role: 'corner' });
        towerBoxes.push({ id: 'tower-br', x0: xR - cs, x1: xR, z0: zb, z1: zb + cs, size: cs, shape: g.towerShape, roof: 'cone', role: 'corner' });
      }
    }
  }
  const frontTowers = towerBoxes.filter((tb) => tb.z1 > zMain - 0.1);
  const inTowerX = (x: number, w = 0) => frontTowers.some((tb) => x + w / 2 > tb.x0 - 0.3 && x - w / 2 < tb.x1 + 0.3);
  const anyTowerX = (x: number, w = 0) => towerBoxes.some((tb) => x + w / 2 > tb.x0 - 0.3 && x - w / 2 < tb.x1 + 0.3);
  const towerBox = towerBoxes[0] ?? null;

  const centralPavilion = g.centralRoof === 'pavilion' && (comp === 'risalit' || comp === 'ground-portico');

  const makePediment = (id: string, x0: number, x1: number, z: number, overhang: number, oculus: boolean, shape = g.gableShape): PedimentSpec => {
    const half = (x1 - x0) / 2;
    if (shape === 'triangle' || shape === 'none') {
      return { id, x0, x1, z, baseY: eaveY, pitch: g.pedimentPitch, overhang, oculus, shape: 'triangle', height: r3((half + overhang) * Math.tan(deg(g.pedimentPitch))), wallRise: 0 };
    }
    // Gable wall rising above the eaves (curved, crow-stepped or a tiered Deco attic);
    // the roof behind stays below its outline.
    const height =
      shape === 'stepped' ? clamp((x1 - x0) * 0.6, 2.8, 6.5) : shape === 'tiered' ? clamp((x1 - x0) * 0.24, 1.4, 3.0) : shape === 'block' ? clamp((x1 - x0) * 0.16, 1.0, 1.9) : clamp((x1 - x0) * 0.42, 2.2, 4.4);
    const pitch = (Math.atan((0.85 * height) / (half + 0.12)) * 180) / Math.PI;
    return { id, x0, x1, z, baseY: eaveY, pitch: r3(pitch), overhang: 0.12, oculus, shape, height: r3(height), wallRise: r3(height * 0.38) };
  };

  // ---- Portico --------------------------------------------------------------
  let portico: PorticoSpec | null = null;
  const pediments: PedimentSpec[] = [];
  const balconies: BalconySpec[] = [];
  const stairs: StairSpec[] = [];
  const e1 = floors[1]?.elevation ?? eaveY;

  if (comp === 'giant-portico' || comp === 'ground-portico') {
    const giant = comp === 'giant-portico';
    const k = g.columnOrder === 'tuscan' ? 7.5 : g.columnOrder === 'ionic' ? 8.5 : 9.5;
    const entR = 1.9;
    const total = giant ? eaveY - plinth : floors[0].height;
    const paired = g.pairedColumns;
    let dia = clamp(total / (k + entR), giant ? 0.5 : 0.42, giant ? 1.0 : 0.7);
    if (paired) dia = Math.min(dia, Math.max(0.4, (bayW - 1.1) / 2.6));
    const entH = dia * entR;
    const colH = total - entH;
    const axes = Array.from({ length: c + 1 }, (_, i) => (i - c / 2) * bayW);
    // Coupled columns: two shafts per axis, ~1.6 diameters apart.
    const colXs = paired ? axes.flatMap((x) => [x - dia * 0.8, x + dia * 0.8]) : axes;
    const zc = zone.zPorticoFront - 0.35 - dia / 2;
    const x0 = colXs[0] - dia / 2 - 0.12;
    const x1 = colXs[colXs.length - 1] + dia / 2 + 0.12;
    const zFront = zc + dia / 2 + 0.12;
    portico = {
      kind: giant ? 'giant' : 'ground',
      order: g.columnOrder,
      x0,
      x1,
      zWall: giant ? zMain : zRis,
      zFront,
      floorY: plinth,
      entablatureBottom: plinth + colH,
      topY: plinth + total,
      columns: colXs.map((x) => ({ x, z: zc, baseY: plinth, height: colH, diameter: dia })),
    };
    if (giant) {
      pediments.push(makePediment('p-portico', x0, x1, zFront, 0.3, g.oculus, 'triangle'));
      portico.pedimentId = 'p-portico';
      if (nFloors >= 2 && g.porticoBalcony) {
        balconies.push({
          id: 'b-center', floor: 1, side: 'front', x0: -centerHalf, x1: centerHalf,
          zFace: zMain, depth: 0.9, y: e1, support: 'consoles', railing: g.balustrade,
        });
      }
    } else {
      if (!centralPavilion) pediments.push(makePediment('p-risalit', cx0, cx1, zRis, co, g.oculus));
      balconies.push({
        id: 'b-portico', floor: 1, side: 'front', x0, x1, zFace: zRis, depth: zFront - zRis,
        y: plinth + total, support: 'portico', railing: g.balustrade,
      });
      portico.balconyId = 'b-portico';
    }
    stairs.push({
      id: 's-entrance', role: 'entrance', x0: x0 - 0.25, x1: x1 + 0.25, zStart: zone.zPorticoFront, zEnd: D / 2,
      landing: 0, fromY: 0, toY: plinth, steps, direction: 'front', railing: 'none', pedestals: true,
    });
  } else {
    if (!centralPavilion && comp !== 'gate-tower' && g.gableShape !== 'none') pediments.push(makePediment('p-risalit', cx0, cx1, zRis, co, g.oculus && comp === 'risalit'));
    if (nFloors >= 2 && g.oriel !== 'center' && g.doorStyle === 'classical' && comp !== 'gate-tower') {
      balconies.push({
        id: 'b-center', floor: 1, side: 'front', x0: -centerHalf, x1: centerHalf,
        zFace: zRis, depth: comp === 'risalit' ? 1.05 : 0.9, y: e1, support: 'consoles', railing: g.balustrade,
      });
    }
  }

  if (!portico && comp !== 'gate-tower') {
    const half = doorW / 2 + 1.25;
    stairs.push({
      id: 's-entrance', role: 'entrance', x0: -half, x1: half, zStart: zRis, zEnd: D / 2,
      landing: LANDING, fromY: 0, toY: plinth, steps, direction: 'front', railing: g.balustrade, pedestals: g.glazing !== 'deco',
    });
  }

  if (wingBays && nFloors >= 2 && g.wingBalconies) {
    const l0 = centers[0] - winW / 2 - 0.55;
    const l1 = centers[wingBays - 1] + winW / 2 + 0.55;
    for (const [id, a, b] of [['b-wing-l', l0, l1], ['b-wing-r', -l1, -l0]] as const) {
      balconies.push({ id, floor: 1, side: 'front', x0: a, x1: b, zFace: zWing, depth: 0.85, y: e1, support: 'consoles', railing: g.balustrade });
    }
  }

  // Which wall plane each front bay sits on (main facade, risalit or end pavilion).
  const bayZ = (i: number) => {
    const x = centers[i];
    return i === mid ? zRis : wingBays && (i < wingBays || i >= n - wingBays) ? zWing : x > cx0 && x < cx1 ? zRis : zMain;
  };
  // ---- Oriel plan: which bays get a bay window, on which floors ---------------
  const orielFloors = nFloors >= 3 ? Array.from({ length: nFloors - 2 }, (_, k) => k + 1) : nFloors === 2 ? [1] : [];
  const orielBays: number[] =
    !orielFloors.length || g.oriel === 'none'
      ? []
      : g.oriel === 'center'
        ? [mid]
        : n < 5
          ? []
          : towerBox
            ? [g.towerSide === 'left' ? n - 2 : 1]
            : [1, n - 2];
  const isOrielBay = (i: number, floor: number) => orielBays.includes(i) && orielFloors.includes(floor);

  if (g.balconets && nFloors >= 2) {
    for (let i = 0; i < n; i++) {
      const x = centers[i];
      const z = bayZ(i);
      if (orielBays.includes(i) || anyTowerX(x, winW) || (g.entranceStrip && i === mid)) continue;
      const dd = Math.abs(i - mid);
      const pick = { all: true, alternate: dd % 2 === 0 && dd > 0, ends: i <= 1 || i >= n - 2, center: dd <= 1 }[g.balconetPattern];
      if (!pick) continue;
      const bx0 = x - winW / 2 - 0.3;
      const bx1 = x + winW / 2 + 0.3;
      if (balconies.some((b) => b.floor === 1 && bx1 + 0.3 > b.x0 && bx0 - 0.3 < b.x1)) continue;
      balconies.push({ id: `b-net-${i}`, floor: 1, side: 'front', x0: bx0, x1: bx1, zFace: z, depth: g.balustrade === 'tube' ? 0.9 : g.balustrade === 'xiron' ? 0.3 : 0.4, y: e1, support: 'consoles', railing: g.balustrade === 'tube' || g.balustrade === 'xiron' ? g.balustrade : 'iron' });
    }
  }

  const doorSurround: HouseSpec['composition']['doorSurround'] = portico || comp === 'gate-tower'
    ? 'portico'
    : orielBays.includes(mid)
      ? 'corbel'
      : balconies.some((b) => b.id === 'b-center')
        ? 'consoles'
        : g.doorStyle === 'canopy'
          ? 'canopy'
          : g.doorStyle === 'stepped'
            ? 'stepped'
          : g.doorStyle === 'slab'
            ? 'slab'
          : g.doorStyle === 'lantern'
            ? 'lantern'
            : g.doorStyle === 'gateway'
              ? 'portico'
              : 'pediment';
  // Leave room above the door for whatever frames it (pediment, balcony consoles, portico ceiling).
  const doorMargin =
    portico?.kind === 'ground'
      ? portico.topY - portico.entablatureBottom + 0.6
      : doorSurround === 'pediment'
        ? 1.8
        : doorSurround === 'corbel'
          ? 1.5
          : doorSurround === 'canopy'
            ? 1.25
          : doorSurround === 'stepped'
            ? 1.05
          : doorSurround === 'slab'
            ? 0.75
          : doorSurround === 'lantern'
            ? 1.0
          : g.doorStyle === 'gateway'
            ? 0.75
        : doorSurround === 'consoles' || balconies.some((b) => b.id === 'b-center')
          ? 0.9
          : 0.6;

  // ---- Openings --------------------------------------------------------------
  const crownPattern = (d: number): WindowCrown =>
    g.crown === 'alternating' ? (d % 2 === 0 ? 'triangular' : 'segmental') : g.crown === 'plain' ? 'none' : g.crown;

  interface WinProfile { sill: number; height: number; head: OpeningHead; crown: WindowCrown; apron: boolean; sillConsoles: boolean }
  const windowFor = (f: FloorSpec, d: number, primary: boolean): WinProfile => {
    const e = f.elevation;
    const H = f.height;
    const single = nFloors === 1;
    // Art Deco windows: clean flat frames — no crowns, aprons or consoles.
    const plain = (w: WinProfile): WinProfile => (g.glazing === 'deco' ? { ...w, crown: 'none', apron: false, sillConsoles: false } : w);
    switch (f.kind) {
      case 'ground': {
        const head = g.archedGround ? 'arched' : g.windowHead;
        const crown: WindowCrown =
          single && primary ? crownPattern(d) : head === 'arched' || g.rusticatedGround ? 'keystone' : 'cornice';
        return plain({ sill: e + 0.95, height: Math.min(winW * g.windowRatio, H - 0.95 - 0.8), head, crown, apron: single && primary, sillConsoles: single && primary });
      }
      case 'main':
        return plain({
          sill: e + 0.8,
          // Piano nobile: the tallest windows. Deco frames have no crowns, so they may rise higher.
          height: g.glazing === 'deco' ? Math.min(winW * Math.max(g.windowRatio * 1.35, 1.75), H - 0.8 - 0.5) : Math.min(winW * g.windowRatio * 1.1, H - 0.8 - 1.0),
          head: g.windowHead,
          crown: primary ? crownPattern(d) : 'cornice',
          apron: primary,
          sillConsoles: primary,
        });
      case 'upper':
        return plain({ sill: e + 0.85, height: Math.min(winW * g.windowRatio * 0.92, H - 0.85 - 0.7), head: g.windowHead, crown: primary ? (g.crown === 'secession' ? 'secession' : 'cornice') : 'none', apron: false, sillConsoles: false });
      default:
        return { sill: e + 0.8, height: Math.min(winW * 1.25, H - 0.8 - 0.95), head: g.windowHead, crown: 'none', apron: false, sillConsoles: false };
    }
  };

  let openingSeq = 0;
  const addOpening = (fc: FacadeSpec, o: Omit<OpeningSpec, 'id' | 'facadeId' | 'position'>) => {
    const len = fc.length;
    const dx = (fc.b[0] - fc.a[0]) / len;
    const dz = (fc.b[1] - fc.a[1]) / len;
    const id = `o${openingSeq++}`;
    fc.openings.push({
      ...o,
      id,
      facadeId: fc.id,
      u: r3(o.u),
      sill: r3(o.sill),
      width: r3(o.width),
      height: r3(o.height),
      position: [r3(fc.a[0] + dx * o.u), r3(o.sill), r3(fc.a[1] + dz * o.u)],
    });
    return id;
  };
  const uOf = (fc: FacadeSpec, x: number, z: number) => Math.abs(x - fc.a[0]) + Math.abs(z - fc.a[1]);

  // Front facade(s): every bay on every floor; door on the axis.
  const stairBay = g.stairSide === 'right' ? Math.min(n - 1, mid + 1) : Math.max(0, mid - 1);
  for (let i = 0; i < n; i++) {
    const x = centers[i];
    const d = Math.abs(i - mid);
    const z = bayZ(i);
    const fc = facadeAt('front', x, z);
    if (!fc) continue;
    for (const f of floors) {
      if (f.index === 0 && i === mid && comp === 'gate-tower') continue;
      if (f.index === 0 && i === mid) {
        const fan = g.fanlight;
        // Vilnius: a wide arched gateway through to the courtyard instead of a front door.
        const gateway = g.doorStyle === 'gateway';
        addOpening(fc, {
          kind: 'door', floor: 0, u: uOf(fc, x, z), sill: f.elevation, width: gateway ? clamp(bayW - 0.7, 2.2, 3.0) : doorW,
          height: Math.min(f.height - doorMargin, gateway ? 3.9 : g.glazing === 'deco' ? 3.5 : fan ? 3.6 : 3.2), head: fan || gateway ? 'arched' : 'flat',
          crown: 'none', apron: false, sillConsoles: false,
        });
        continue;
      }
      if (isOrielBay(i, f.index) || (towerBox && Math.abs(z - zMain) < 1e-3 && inTowerX(x, winW))) continue;
      if (g.entranceStrip && i === mid && f.index >= 1) {
        // Art Deco: one tall glazed strip per storey above the entrance, reading as a single vertical band.
        addOpening(fc, { kind: 'window', floor: f.index, u: uOf(fc, x, z), width: Math.min(1.3, winW + 0.1), sill: f.elevation - 0.05, height: f.height - 0.35, head: 'flat', crown: 'none', apron: false, sillConsoles: false });
        continue;
      }
      const wp = windowFor(f, d, true);
      const balcony = balconies.find((b) => b.floor === f.index && b.side === 'front' && Math.abs(b.zFace - z) < 1e-3 && x > b.x0 && x < b.x1);
      if (balcony) {
        const top = wp.sill + wp.height;
        addOpening(fc, {
          kind: 'french-door', floor: f.index, u: uOf(fc, x, z), sill: f.elevation + 0.02, width: winW,
          height: top - f.elevation - 0.02, head: 'flat', crown: i === mid ? 'triangular' : wp.crown,
          apron: false, sillConsoles: false, balconyId: balcony.id,
        });
      } else {
        addOpening(fc, { kind: 'window', floor: f.index, u: uOf(fc, x, z), width: winW, ...wp });
      }
    }
  }

  // Back facade: same axes, garden door on the axis, staircase bay with half-landing windows.
  const back = facades.find((f) => f.side === 'back' && Math.abs(f.a[1] - zBack) < 1e-3 && Math.min(f.a[0], f.b[0]) < 0 && Math.max(f.a[0], f.b[0]) > 0)!;
  const hasStair = nFloors >= 2;
  const gardenW = clamp(bayW * 0.42, 1.2, 1.6);
  for (let i = 0; i < n; i++) {
    const x = centers[i];
    // Bays behind a courtyard wing have no back wall to the outside.
    if (x - winW / 2 - 0.4 < Math.min(back.a[0], back.b[0]) || x + winW / 2 + 0.4 > Math.max(back.a[0], back.b[0])) continue;
    const u = uOf(back, x, zBack);
    if (hasStair && i === stairBay && i !== mid) {
      for (let f = 1; f < nFloors; f++) {
        const below = floors[f - 1];
        const landing = below.elevation + below.height / 2;
        addOpening(back, {
          kind: 'stair-window', floor: f, u, sill: landing + 0.5, width: winW * 0.85,
          height: Math.min(1.35, below.height / 2 - 0.65), head: g.archedGround ? 'arched' : 'flat',
          crown: 'none', apron: false, sillConsoles: false,
        });
      }
      continue;
    }
    for (const f of floors) {
      if (f.index === 0 && i === mid) {
        addOpening(back, {
          kind: 'garden-door', floor: 0, u, sill: f.elevation, width: gardenW,
          height: Math.min(f.height - 0.75, 2.95), head: 'flat', crown: 'cornice', apron: false, sillConsoles: false,
        });
        continue;
      }
      addOpening(back, { kind: 'window', floor: f.index, u, width: winW, ...windowFor(f, Math.abs(i - mid), false) });
    }
  }

  // ---- Courtyard wings: bay grid along each wing, stair + entrance on the courtyard side ----
  const evenly = (a: number, b: number, target: number, odd = false) => {
    const L = b - a - 2 * CORNER_MARGIN;
    const k = Math.max(1, odd ? oddRound(L / target) : Math.round(L / target));
    return Array.from({ length: k }, (_, i) => a + CORNER_MARGIN + (L * (i + 0.5)) / k);
  };
  const mainZGrid = evenly(zBack, zMain, g.bayWidth);
  const wings: WingBlockSpec[] = [];
  const wingGrid = new Map<string, { axis: 'x' | 'z'; along: number[]; across: number[]; stairAt: number }>();
  for (const m of masses.filter((q) => q.role.startsWith('court'))) {
    const role = m.role as WingBlockSpec['role'];
    const alongZ = role !== 'court-rear';
    const [a, b] = alongZ ? [m.z0, m.z1] : [m.x0, m.x1];
    // Wing bays are laid out from the plot edge to the junction with the main block.
    const L = b - a - CORNER_MARGIN * 2;
    const k = Math.max(3, oddRound(L / g.bayWidth));
    const bwW = L / k;
    const along = Array.from({ length: k }, (_, i) => a + CORNER_MARGIN + bwW * (i + 0.5));
    const across = alongZ ? evenly(m.x0, m.x1, g.bayWidth) : evenly(m.z0, m.z1, g.bayWidth);
    const stairIdx = (k - 1) / 2;
    wingGrid.set(m.id, { axis: alongZ ? 'z' : 'x', along, across, stairAt: along[stairIdx] });
    // Block frame: V points from the courtyard wall to the outer wall.
    const rotation = role === 'court-left' ? -Math.PI / 2 : role === 'court-right' ? Math.PI / 2 : Math.PI;
    const U: Vec2 = [Math.cos(rotation), -Math.sin(rotation)];
    const V: Vec2 = [Math.sin(rotation), Math.cos(rotation)];
    const origin: Vec2 = role === 'court-left' ? [m.x1, 0] : role === 'court-right' ? [m.x0, 0] : [0, m.z1];
    const toLocal = (x: number, z: number): Vec2 => [(x - origin[0]) * U[0] + (z - origin[1]) * U[1], (x - origin[0]) * V[0] + (z - origin[1]) * V[1]];
    const localAlong = along.map((v) => (alongZ ? toLocal(m.x0, v)[0] : toLocal(v, m.z0)[0])).sort((p, q) => p - q);
    const junctions: WingBlockSpec['junctions'] = [];
    if (alongZ) junctions.push(role === 'court-left' ? 'x1' : 'x0');
    else junctions.push('x0', 'x1');
    wings.push({
      id: m.id, role, rect: { x0: r3(m.x0), x1: r3(m.x1), z0: r3(m.z0), z1: r3(m.z1) }, origin: [r3(origin[0]), r3(origin[1])], rotation,
      bays: { count: k, width: r3(bwW), centers: localAlong.map(r3) }, stairBay: stairIdx, junctions,
    });
  }
  const inside = (x: number, z: number) => masses.find((m) => m.role !== 'central-risalit' && x > m.x0 && x < m.x1 && z > m.z0 && z < m.z1);
  const wingStairs: StairSpec[] = [];
  const handled = new Set<FacadeSpec>([back, ...facades.filter((f) => f.side === 'front' && f.normal[1] > 0.5 && f.a[1] >= zMain - 1e-3)]);
  const isParty = (fc: FacadeSpec) => Math.abs(fc.normal[0]) > 0.5 && ((party.left && Math.abs(fc.a[0] + W / 2) < 1e-3) || (party.right && Math.abs(fc.a[0] - W / 2) < 1e-3));
  for (const fc of facades) {
    if (handled.has(fc) || fc.length < 2.2 || isParty(fc)) continue;
    const horizontal = Math.abs(fc.normal[1]) > 0.5;
    const lo = Math.min(horizontal ? fc.a[0] : fc.a[1], horizontal ? fc.b[0] : fc.b[1]);
    const hi = Math.max(horizontal ? fc.a[0] : fc.a[1], horizontal ? fc.b[0] : fc.b[1]);
    const line = horizontal ? fc.a[1] : fc.a[0];
    const candidates: { p: number; wing?: string; stair: boolean }[] = [];
    const push = (p: number, wing?: string, stair = false) => {
      if (p - winW / 2 < lo + 0.6 || p + winW / 2 > hi - 0.6) return;
      const [px, pz] = horizontal ? [p, line - fc.normal[1] * 0.6] : [line - fc.normal[0] * 0.6, p];
      const m = inside(px, pz);
      if (!m) return;
      if ((wing ?? 'main') !== (m.role.startsWith('court') ? m.id : 'main')) return;
      if (candidates.some((c2) => Math.abs(c2.p - p) < winW + 0.3)) return;
      candidates.push({ p, wing, stair });
    };
    for (const [id, gr] of wingGrid) {
      const courtSide = (gr.axis === 'z' && !horizontal && inside(line - fc.normal[0] * 0.6, gr.along[0])?.id === id && Math.abs(fc.normal[0]) > 0.5 && (id === 'court-l' ? fc.normal[0] > 0 : fc.normal[0] < 0))
        || (gr.axis === 'x' && horizontal && fc.normal[1] > 0.5);
      if ((gr.axis === 'z') !== horizontal) for (const p of gr.along) push(p, id, courtSide && Math.abs(p - gr.stairAt) < 1e-6);
      else for (const p of gr.across) push(p, id);
    }
    for (const p of horizontal ? centers : mainZGrid) push(p);
    for (const cnd of candidates) {
      const u = horizontal ? Math.abs(cnd.p - fc.a[0]) : Math.abs(cnd.p - fc.a[1]);
      if (cnd.stair) {
        // Wing staircase: entrance door from the courtyard, half-landing windows above.
        const doorWw = 1.3;
        addOpening(fc, { kind: 'door', floor: 0, u, sill: floors[0].elevation, width: doorWw, height: Math.min(floors[0].height - 1.0, 2.9), head: g.archedGround ? 'arched' : 'flat', crown: 'none', apron: false, sillConsoles: false, surround: 'portico' });
        for (let f = 1; f < nFloors; f++) {
          const below = floors[f - 1];
          const landing = below.elevation + below.height / 2;
          addOpening(fc, { kind: 'stair-window', floor: f, u, sill: landing + 0.5, width: winW * 0.85, height: Math.min(1.35, below.height / 2 - 0.65), head: g.archedGround ? 'arched' : 'flat', crown: 'none', apron: false, sillConsoles: false });
        }
        const run = steps * TREAD;
        wingStairs.push({ id: `s-${cnd.wing}`, role: 'entrance', x0: u - 1.2, x1: u + 1.2, zStart: 0, zEnd: run + 0.9, landing: 0.9, fromY: 0, toY: plinth, steps, direction: 'front', railing: g.balustrade === 'stone' ? 'iron' : g.balustrade, pedestals: false, facadeId: fc.id });
        continue;
      }
      for (const f of floors) addOpening(fc, { kind: 'window', floor: f.index, u, width: winW, ...windowFor(f, 1, false) });
    }
  }

  // Openings that would end up inside a tower disappear.
  for (const fc of facades) {
    fc.openings = fc.openings.filter((o) => !towerBoxes.some((tb) => {
      const m = o.width / 2 + 0.4;
      return o.position[0] > tb.x0 - m && o.position[0] < tb.x1 + m && o.position[2] > tb.z0 - m && o.position[2] < tb.z1 + m;
    }));
  }

  // ---- Oriels -------------------------------------------------------------------
  const oriels: OrielSpec[] = orielBays.map((i) => {
    const cx = centers[i];
    const z = bayZ(i);
    const d = 0.85;
    const half = winW / 2 + 0.35 + d;
    const outline: Vec2[] = [[cx - half, z], [cx - half + d, z + d], [cx + half - d, z + d], [cx + half, z]].map(([a, b]) => [r3(a), r3(b)] as Vec2);
    const last = orielFloors[orielFloors.length - 1];
    const toEaves = last === nFloors - 1;
    const y0 = floors[orielFloors[0]].elevation - 0.15;
    const y1 = toEaves ? wallTop - 0.05 : floors[last + 1].elevation;
    const fcs = [0, 1, 2].map((k) => makeFacade(`or${i}-${k}`, outline[k], outline[k + 1]));
    for (const f of orielFloors) {
      const wp = windowFor(floors[f], 1, true);
      fcs.forEach((fc, k) => {
        const w = k === 1 ? Math.min(winW, fc.length - 0.45) : Math.min(0.55, fc.length - 0.45);
        addOpening(fc, { kind: 'window', floor: f, u: fc.length / 2, width: w, sill: wp.sill, height: wp.height, head: wp.head, crown: 'none', apron: false, sillConsoles: false });
      });
    }
    return { id: `oriel-${i}`, outline, zWall: r3(z), depth: d, y0: r3(y0), y1: r3(y1), roof: toEaves ? 'flat' : 'hip', floors: orielFloors, facades: fcs };
  });

  // ---- Towers ---------------------------------------------------------------------
  const towers: TowerSpec[] = [];
  const fpArea = fp.reduce((sum, [x, z], i) => { const [x2, z2] = fp[(i + 1) % fp.length]; return sum + x * z2 - x2 * z; }, 0);
  const stageHeight = g.towerPlan === 'corner' ? 2.9 : 3.4;
  const stageBase = wallTop - 0.3;
  for (const tb of towerBoxes) {
    const { x0, x1, z0, z1, size } = tb;
    const sides = tb.shape === 'square' ? 4 : tb.shape === 'octagon' ? 8 : 16;
    const cxT = (x0 + x1) / 2;
    const czT = (z0 + z1) / 2;
    let outline: Vec2[];
    if (sides === 4) outline = [[x0, z1], [x1, z1], [x1, z0], [x0, z0]];
    else if (sides === 8) {
      const k = size * (1 - Math.SQRT1_2);
      outline = [[x0 + k, z1], [x1 - k, z1], [x1, z1 - k], [x1, z0 + k], [x1 - k, z0], [x0 + k, z0], [x0, z0 + k], [x0, z1 - k]];
    } else {
      const R = size / 2 / Math.cos(Math.PI / sides);
      outline = Array.from({ length: sides }, (_, k) => {
        const a2 = Math.PI / 2 + Math.PI / sides - (2 * Math.PI * k) / sides;
        return [cxT + R * Math.cos(a2 + Math.PI / 2 - Math.PI / 2) , czT + R * Math.sin(a2)] as Vec2;
      });
    }
    outline = outline.map(([a2, b2]) => [r3(a2), r3(b2)] as Vec2);
    // Same winding as the footprint (facade order).
    const ar = outline.reduce((sum, [x, z], i) => { const [x2, z2] = outline[(i + 1) % outline.length]; return sum + x * z2 - x2 * z; }, 0);
    if (Math.sign(ar) !== Math.sign(fpArea)) outline.reverse();
    const stages = g.towerPlan === 'castle' ? towerStages + (tb.role === 'gate' ? 1 : 0) : g.towerPlan === 'gate' ? towerStages : 1;
    const tTop = stageBase + stages * stageHeight + 0.3;
    const fcs = outline.map((a2, i) => makeFacade(`${tb.id}-${i}`, a2, outline[(i + 1) % outline.length]));
    for (const fc of fcs) {
      const mx = (fc.a[0] + fc.b[0]) / 2;
      const mz = (fc.a[1] + fc.b[1]) / 2;
      if (inside(mx - fc.normal[0] * 0.05, mz - fc.normal[1] * 0.05) && !(tb.role === 'gate' && fc.normal[1] > 0.5)) continue;
      if (fc.length < 1.2) continue;
      const w = Math.min(tb.role === 'gate' ? 1.1 : 0.95, fc.length - 0.6);
      for (const f of floors) {
        if (tb.role === 'gate' && f.index === 0 && fc.normal[1] > 0.5) {
          // The castle gate: a wide arched door in the gate tower.
          addOpening(fc, { kind: 'door', floor: 0, u: fc.length / 2, sill: f.elevation, width: Math.min(2.2, fc.length - 1.4), height: Math.min(f.height - 0.4, 3.6), head: 'arched', crown: 'none', apron: false, sillConsoles: false, surround: 'portico' });
          continue;
        }
        const wp = windowFor(f, 1, true);
        addOpening(fc, { kind: 'window', floor: f.index, u: fc.length / 2, width: w, sill: wp.sill, height: wp.height, head: wp.head, crown: 'none', apron: false, sillConsoles: false });
      }
      for (let k = 0; k < stages; k++) {
        const base = stageBase + k * stageHeight;
        addOpening(fc, { kind: 'window', floor: nFloors + k, u: fc.length / 2, width: Math.min(0.75, w), sill: base + 0.85, height: Math.min(1.35, stageHeight - 1.3), head: 'arched', crown: 'none', apron: false, sillConsoles: false });
      }
    }
    const apothem = size / 2;
    towers.push({
      id: tb.id, outline, center: [r3(cxT), r3(czT)], apothem: r3(apothem), sides, role: tb.role, wallTop: r3(tTop),
      stages, stageBase: r3(stageBase), stageHeight,
      roof: tb.roof, roofBaseY: r3(tTop + 0.35), roofHeight: r3(apothem * (tb.roof === 'bell' ? 2.1 : tb.roof === 'pyramid' ? 2.6 : g.towerPlan === 'castle' ? 2.8 : 2.3)), facades: fcs,
    });
    if (tb.role === 'gate') {
      const half = Math.min(2.2, size - 1.4) / 2 + 0.9;
      stairs.push({ id: 's-entrance', role: 'entrance', x0: -half, x1: half, zStart: z1, zEnd: D / 2, landing: Math.max(0, D / 2 - z1 - steps * TREAD), fromY: 0, toY: plinth, steps, direction: 'front', railing: 'none', pedestals: false });
    }
  }

  // ---- Wall articulation --------------------------------------------------------
  const pilasters: HouseSpec['pilasters'] = [];
  const pilasterBase = g.rusticatedGround && nFloors >= 2 ? e1 - 0.12 : plinth;
  const pStyle = g.corners === 'lesenes' ? 'lesene' : 'classical';
  const centralFront = facadeAt('front', 0, zRis);
  if (centralFront && (comp === 'risalit' || comp === 'ground-portico' || comp === 'frontispiece')) {
    const y0 = comp === 'ground-portico' ? e1 : pilasterBase;
    const us = [cx0 + 0.25, ...Array.from({ length: c - 1 }, (_, k) => (k + 1 - c / 2) * bayW), cx1 - 0.25];
    for (const x of us) pilasters.push({ facadeId: centralFront.id, u: uOf(centralFront, x, zRis), width: 0.46, y0, y1: wallTop, style: pStyle });
  }
  if (portico?.kind === 'giant' && centralFront) {
    for (const col of [portico.columns[0], portico.columns[portico.columns.length - 1]]) {
      pilasters.push({ facadeId: centralFront.id, u: uOf(centralFront, col.x, zMain), width: col.diameter * 0.9, y0: plinth, y1: portico.entablatureBottom, style: 'classical' });
    }
  }
  if (g.corners === 'pilasters' || g.corners === 'lesenes') {
    for (const fc of facades) {
      if (fc.length < 3) continue;
      if (fc.side === 'front' && Math.abs(fc.a[1] - zRis) < 1e-3 && zRis > zMain) continue;
      const w = pStyle === 'lesene' ? 0.42 : 0.5;
      pilasters.push({ facadeId: fc.id, u: 0.3, width: w, y0: pilasterBase, y1: wallTop, style: pStyle });
      pilasters.push({ facadeId: fc.id, u: fc.length - 0.3, width: w, y0: pilasterBase, y1: wallTop, style: pStyle });
    }
  }
  if (g.fluting) {
    // Plain vertical strips on every bay boundary of the street facades.
    for (const fc of facades) {
      if (fc.side !== 'front' || fc.normal[1] < 0.5 || fc.a[1] < zMain - 1e-3) continue;
      for (let k = 1; k < n; k++) {
        const x = centers[0] - bayW / 2 + k * bayW;
        if (x < Math.min(fc.a[0], fc.b[0]) + 0.3 || x > Math.max(fc.a[0], fc.b[0]) - 0.3) continue;
        const u = uOf(fc, x, fc.a[1]);
        // Skip where a pilaster already stands (overlapping faces flicker).
        if (pilasters.some((p) => p.facadeId === fc.id && Math.abs(p.u - u) < p.width / 2 + 0.2)) continue;
        pilasters.push({ facadeId: fc.id, u, width: 0.22, y0: plinth, y1: wallTop, style: 'strip' });
      }
    }
  }
  // Porthole windows: beside the glazed entrance strip on the top floor, or flanking the door.
  const ornaments: HouseSpec['ornaments'] = [];
  if (g.portholes && centralFront) {
    const top = floors[floors.length - 1];
    const strip = g.entranceStrip && nFloors >= 2;
    const y = strip ? top.elevation + top.height * 0.5 : plinth + floors[0].height * 0.55;
    const dx = strip ? bayW * 0.5 : doorW / 2 + 0.85;
    for (const s of [-1, 1]) {
      const u = uOf(centralFront, s * dx, zRis);
      if (pilasters.some((p) => p.facadeId === centralFront.id && Math.abs(p.u - u) < p.width / 2 + 0.5)) continue;
      ornaments.push({ kind: 'porthole', facadeId: centralFront.id, u: r3(u), y: r3(y), radius: 0.36 });
    }
  }

  // ---- Roof --------------------------------------------------------------------
  const roofForm = g.roof;
  const mainForm = roofForm === 'mansard' ? 'mansard' : roofForm === 'flat' ? 'flat' : 'hip';
  const lowerHeight = 3.0;
  const lowerPitch = 72;
  const upperPitch = 20;
  // With a parapet the roof starts just behind the wall line (hidden gutter behind the balustrade).
  // Behind a balustrade or a plain parapet the roof starts just inside the wall line.
  const ro = g.parapet || g.eaves === 'parapet' ? -0.12 : co;
  const tall = { form: 'mansard', lowerPitch: 78, lowerHeight: 4.1, pitch: 18 } as const;
  const parts: RoofPartSpec[] = [
    {
      id: 'r-main', form: mainForm, x0: party.left ? xL : xL - ro, x1: party.right ? xR : xR + ro, ...(anyParty ? { ends: { x0: party.left, x1: party.right } } : {}), z0: zBack - ro, z1: zMain + ro, baseY: eaveY,
      pitch: mainForm === 'mansard' ? upperPitch : g.roofPitch,
      ...(mainForm === 'mansard' ? { lowerPitch, lowerHeight } : {}),
    },
  ];
  if (wingBays) {
    const wz0 = zMain - wingW;
    const shape =
      g.pavilionRoof === 'tall'
        ? tall
        : ({ form: mainForm, pitch: mainForm === 'mansard' ? upperPitch : g.roofPitch, ...(mainForm === 'mansard' ? { lowerPitch, lowerHeight } : {}) } as const);
    const common = { ...shape, z0: wz0, z1: zWing + ro, baseY: eaveY };
    parts.push({ id: 'r-wing-l', x0: xL - ro, x1: xL + wingW + ro, ...common });
    parts.push({ id: 'r-wing-r', x0: xR - wingW - ro, x1: xR + ro, ...common });
  }
  if (plan !== 'block') {
    // One continuous roof over main block + courtyard wings. With equal pitch on an
    // orthogonal plan, roof height = pitch × (half-size of the largest centred square
    // that fits), i.e. the upper envelope of hip roofs over the maximal rectangles.
    // Outer corners become hips, inner corners valleys, without special cases.
    const shape = { form: mainForm, pitch: mainForm === 'mansard' ? upperPitch : g.roofPitch, ...(mainForm === 'mansard' ? { lowerPitch, lowerHeight } : {}) } as const;
    const outer: Vec2[] =
      plan === 'u'
        ? [[xL, zMain], [xR, zMain], [xR, zBackEnv], [xR - Ww, zBackEnv], [xR - Ww, zBack], [xL + Ww, zBack], [xL + Ww, zBackEnv], [xL, zBackEnv]]
        : [[xL, zMain], [xR, zMain], [xR, zBackEnv], [xL, zBackEnv]];
    const rects = maximalRects(offsetRing(outer, ro), court ? offsetRing(court, ro) : null);
    const mc: Vec2 = [0, (zBack + zMain) / 2];
    rects.sort((a, b) => Number(b.x0 <= mc[0] && b.x1 >= mc[0] && b.z0 <= mc[1] && b.z1 >= mc[1] && b.z1 - b.z0 < Dm + 2 * ro + 0.5) - Number(a.x0 <= mc[0] && a.x1 >= mc[0] && a.z0 <= mc[1] && a.z1 >= mc[1] && a.z1 - a.z0 < Dm + 2 * ro + 0.5));
    parts.length = 0;
    rects.forEach((r, i) => parts.push({ id: i === 0 ? 'r-main' : `r-court-${i}`, ...shape, ...r, baseY: eaveY, merged: true }));
    if (wingBays) {
      // (End pavilions are not combined with courtyard plans' merged roofs.)
    }
  }
  if (centralPavilion) {
    const w = cx1 - cx0 + 2 * ro;
    parts.push({ id: 'r-pav-center', ...tall, x0: cx0 - ro, x1: cx1 + ro, z0: Math.max(zBack, zRis + ro - w), z1: zRis + ro, baseY: eaveY });
  }
  // A flat roof gets no roof behind its gable/attic: the attic is a free-standing parapet wall.
  for (const p of roofForm === 'flat' ? [] : pediments) {
    parts.push({ id: `r-${p.id}`, form: 'gable', x0: p.x0 - p.overhang, x1: p.x1 + p.overhang, z0: zMid, z1: p.shape === 'triangle' ? p.z + p.overhang : p.z - 0.05, baseY: p.baseY, pitch: p.pitch, pedimentId: p.id });
  }
  const main = parts[0];
  const ridgeY = roofHeightAt(main, (main.x0 + main.x1) / 2, (main.z0 + main.z1) / 2);

  // Towers: lift the belvedere stages so their windows clear the main roof (mansards rise steeply).
  for (const tw of towers) {
    // Lift only as much as the roof actually rises in front of a belvedere window.
    let need = 0;
    for (const fc of tw.facades) {
      for (const o of fc.openings) {
        if (o.floor < nFloors) continue;
        // Sample across the whole window width and out to the eave edge.
        const dx = (fc.b[0] - fc.a[0]) / fc.length;
        const dz = (fc.b[1] - fc.a[1]) / fc.length;
        for (const side of [-0.5, 0, 0.5]) {
          for (const outD of [0.2, 0.6, 1.0, 1.4]) {
            const px = o.position[0] + dx * o.width * side + fc.normal[0] * outD;
            const pz = o.position[2] + dz * o.width * side + fc.normal[1] * outD;
            if (px < main.x0 || px > main.x1 || pz < main.z0 || pz > main.z1) continue;
            need = Math.max(need, roofHeightAt(main, px, pz) + 0.15 - o.sill);
          }
        }
      }
    }
    // Plus half a metre of clear wall under the belvedere windows.
    const shift = Math.max(0, need) + (need > -0.5 ? 0.5 : 0);
    if (shift <= 0) continue;
    tw.stageBase = r3(tw.stageBase + shift);
    tw.wallTop = r3(tw.wallTop + shift);
    tw.roofBaseY = r3(tw.roofBaseY + shift);
    for (const fc of tw.facades) for (const o of fc.openings) if (o.floor >= nFloors) { o.sill = r3(o.sill + shift); o.position[1] = o.sill; }
  }

  // ---- Dormers -------------------------------------------------------------------
  const dormers: DormerSpec[] = [];
  const blocked = (x: number, w: number) =>
    parts.slice(1).some((p) => x + w / 2 + 0.4 > p.x0 && x - w / 2 - 0.4 < p.x1) || anyTowerX(x, w + 0.8);
  const shape = g.dormerShape;
  if (g.dormers !== 'none' && mainForm !== 'flat') {
    const mansard = main.form === 'mansard';
    const dw = clamp(winW * 0.85 + 0.3, 1.2, 1.6);
    const tanP = Math.tan(deg(mansard ? lowerPitch : main.pitch));
    const s = mansard ? 0.28 : 0.75 + co;
    const winH = mansard ? 1.25 : 1.3;
    const baseY = eaveY + s * tanP - 0.08;
    const top = baseY + winH + 0.45 + (dw / 2 + 0.15) * Math.tan(deg(40));
    const depth = (top - eaveY) / tanP - s + 0.3;
    const halfW = (main.x1 - main.x0) / 2;
    const fits = mansard ? top < eaveY + lowerHeight + 0.4 : top < ridgeY - 0.25;
    if (fits) {
      for (let i = 0; i < n; i++) {
        const d = Math.abs(i - mid);
        if (!mansard && g.dormers === 'alternate' && d % 2 === 1) continue;
        const x = centers[i];
        if (blocked(x, dw)) continue;
        if (Math.abs(x) + dw / 2 + 0.25 > halfW - (mansard ? 1.1 : s + depth)) continue;
        dormers.push({ id: `d-front-${i}`, side: 'front', x, zFace: main.z1 - s, baseY, width: dw, windowHeight: winH, depth, shape });
        if (i !== stairBay || !hasStair) dormers.push({ id: `d-back-${i}`, side: 'back', x, zFace: main.z0 + s, baseY, width: dw, windowHeight: winH, depth, shape });
      }
    }
  }

  // Tall pavilion roofs each get a round œil-de-boeuf dormer on their front slope.
  for (const p of parts.filter((q) => q.form === 'mansard' && q.lowerHeight === tall.lowerHeight)) {
    const tanL = Math.tan(deg(p.lowerPitch!));
    const s = 0.3;
    const baseY = eaveY + s * tanL - 0.08;
    const top = baseY + 1.4 + 0.6;
    dormers.push({ id: `d-${p.id}`, side: 'front', x: (p.x0 + p.x1) / 2, zFace: p.z1 - s, baseY, width: 1.5, windowHeight: 1.25, depth: (top - eaveY) / tanL - s + 0.3, shape: 'oculus' });
  }

  // ---- Parapet ----------------------------------------------------------------------
  let parapet: HouseSpec['parapet'] = null;
  if (g.parapet) {
    const ring = offsetRing(fp, 0.2);
    const keepOut = parts.filter((p) => p.form === 'gable').map((p) => ({ x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1 + 0.5 }));
    let segments: [Vec2, Vec2][] = ring.map((a, i) => [a, ring[(i + 1) % ring.length]]);
    for (const r of keepOut) segments = segments.flatMap((sg) => subtractRect(sg, r));
    segments = segments.filter(([a, b]) => Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.8);
    // No balustrade along a fire wall.
    segments = segments.filter(([a, b]) => !(Math.abs(a[0] - b[0]) < 1e-3 && ((party.left && a[0] < -W / 2 + 0.5) || (party.right && a[0] > W / 2 - 0.5))));
    parapet = { baseY: r3(eaveY), segments };
  }

  // ---- Chimneys --------------------------------------------------------------------
  const chimneys: ChimneySpec[] = [];
  {
    const w = main.x1 - main.x0;
    const d = main.z1 - main.z0;
    const zc = (main.z0 + main.z1) / 2;
    const xs = n >= 9 ? [-0.33 * w, -0.13 * w, 0.13 * w, 0.33 * w] : [-0.22 * w, 0.22 * w];
    const pts: Vec2[] = w >= d ? xs.map((x) => [x, zc]) : [[0, zc - 0.25 * d], [0, zc + 0.25 * d]];
    for (const [x, z] of pts) {
      if (anyTowerX(x, 2)) continue;
      const h = roofHeightAt(main, x, z);
      chimneys.push({ x: r3(x), z: r3(z), width: 0.75, depth: 0.95, baseY: r3(eaveY - 0.5), topY: r3(Math.max(h + 1.1, ridgeY + 0.7)) });
    }
  }

  const envelopeAt = (x: number, z: number) =>
    Math.max(eaveY, ...parts.filter((q) => q.merged && x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1).map((q) => roofHeightAt(q, x, z)));
  for (const p of parts.filter((q) => q.id.startsWith('r-court'))) {
    const cxm = (p.x0 + p.x1) / 2;
    const czm = (p.z0 + p.z1) / 2;
    const top = envelopeAt(cxm, czm);
    chimneys.push({ x: r3(cxm), z: r3(czm), width: 0.75, depth: 0.95, baseY: r3(eaveY - 0.5), topY: r3(top + 0.8) });
  }
  stairs.push(...wingStairs);

  // ---- Garden terrace & staircase reservation -------------------------------------
  stairs.push({
    id: 's-garden', role: 'garden', x0: -(gardenW / 2 + 0.7), x1: gardenW / 2 + 0.7, zStart: zBack, zEnd: zBack - GARDEN_TERRACE,
    landing: GARDEN_TERRACE, fromY: 0, toY: plinth, steps, direction: 'sides', railing: 'iron', pedestals: false,
  });
  const stairCore = hasStair
    ? (() => {
        // Exactly the stair bay, so partitions land on window piers.
        const sx = centers[stairBay];
        const w = bayW;
        const z0 = zBack + WALL_THICKNESS;
        return { x0: r3(sx - w / 2), x1: r3(sx + w / 2), z0: r3(z0), z1: r3(z0 + Math.min(5.6, mainDepth * 0.45)), fromFloor: 0, toFloor: nFloors - 1 + (roofForm === 'mansard' ? 1 : 0) };
      })()
    : null;

  // ---- Summary ----------------------------------------------------------------------
  const orderName = { tuscan: 'Tuscan', ionic: 'Ionic', corinthian: 'Corinthian' }[g.columnOrder];
  const colCount = portico ? portico.columns.length : 0;
  const style = (cols: number) => (cols === 2 ? 'distyle' : cols === 4 ? "tetrastyle" : `${cols}-column`);
  const features = [
    STYLES[g.style].label,
    `${nFloors} floor${nFloors > 1 ? 's' : ''}${roofForm === 'mansard' ? ' + mansard attic' : ''}`,
    `${n} bays × ${bayW.toFixed(2)} m`,
    comp === 'giant-portico'
      ? `Giant ${g.pairedColumns ? `coupled ${colCount}-column` : style(colCount)} ${orderName} portico with pediment`
      : comp === 'ground-portico'
        ? `${orderName} ${g.pairedColumns ? `coupled ${colCount}-column` : style(colCount)} porch carrying a balcony, ${centralPavilion ? 'central pavilion' : 'pedimented central risalit'}`
        : comp === 'risalit'
          ? `Projecting central risalit with ${pStyle === 'lesene' ? 'lesenes' : 'pilasters'} and ${centralPavilion ? 'a tall pavilion roof' : g.gableShape !== 'triangle' ? 'a curved gable' : 'pediment'}`
          : comp === 'gate-tower'
            ? 'Entrance through the gate tower'
            : `Central frontispiece with ${g.gableShape !== 'triangle' ? 'a curved gable' : 'pediment'}`,
    roofForm === 'flat' ? `Flat roof behind a parapet, ${chimneys.length} chimney${chimneys.length === 1 ? '' : 's'}` : `${roofForm === 'mansard' ? 'Mansard' : 'Hipped'} ${roofWord(g.colors.roof)} roof, ${chimneys.length} chimney${chimneys.length === 1 ? '' : 's'}`,
  ];
  if (plan === 'u') features.push(`U-plan: two courtyard wings, own staircases and entrances`);
  if (plan === 'o') features.push(`Closed courtyard: three wings, own staircases and entrances`);
  if (plan === 'block' && avail > Dm + 1) features.push(`Block limited to ${Dm.toFixed(1)} m depth, garden behind`);
  if (wingBays) features.push(`End pavilions (${wingBays} bay${wingBays > 1 ? 's' : ''} each)${g.pavilionRoof === 'tall' ? ' with tall roofs' : ''}`);
  if (g.rusticatedGround) features.push('Rusticated ground floor');
  if (g.corners !== 'none') features.push({ quoins: 'Corner quoins', pilasters: 'Corner pilasters', lesenes: 'Secession lesenes' }[g.corners]);
  features.push(`Window crowns: ${g.crown}${g.archedGround ? ', arched ground floor' : ''}`);
  const nets = balconies.filter((b) => b.id.startsWith('b-net')).length;
  const full = balconies.length - nets;
  if (full) features.push(`${full} balcon${full > 1 ? 'ies' : 'y'} (${g.balustrade} railing)`);
  if (nets) features.push(`${nets} iron balconets on the piano nobile`);
  if (g.towerPlan === 'corner' && towers.length) features.push(`Octagonal corner tower with ${g.towerRoof === 'bell' ? 'a bell' : 'a conical'} roof`);
  if (g.towerPlan === 'gate' && towers.length) features.push(`Square gate tower, ${towers[0].stages} storey${towers[0].stages > 1 ? 's' : ''} above the eaves`);
  if (g.style === 'klaipeda') features.push('Red brick on a fieldstone base, brick corbel frieze, crow-stepped gable');
  if (g.style === 'kaunas-deco') features.push(`Stepped attic over the centre, flat bands, three-part windows${g.entranceStrip ? ', vertical glazed strip over the entrance' : ''}`);
  if (g.style === 'vilnius-old-town') features.push(`${g.gableShape === 'volute' ? 'Baroque volute gable, ' : ''}arched gateway to the courtyard, eared window frames`);
  if (g.towerPlan === 'castle') {
    if (towers.some((tw) => tw.role === 'gate')) features.push(`Square gate tower, ${towers.find((tw) => tw.role === 'gate')!.stages} storeys above the palace, pyramid roof`);
    const rc = towers.filter((tw) => tw.role === 'corner').length;
    if (rc) features.push(`${rc} round corner towers with conical roofs`);
    if (wanted > nFloors) features.push(`Palace capped at ${nFloors} floors; ${wanted - nFloors} more storey${wanted - nFloors > 1 ? 's' : ''} go into the towers`);
    features.push('Red brick on a fieldstone base, brick corbel frieze, red tile roofs');
  }
  if (oriels.length) features.push(`${oriels.length === 1 ? 'Oriel' : `${oriels.length} oriels`} on corbels ${g.oriel === 'center' ? 'over the entrance' : 'on a side bay'}`);
  if (g.eaves === 'bracketed') features.push('Deep eaves on brackets');
  if (g.windowHead === 'segmental') features.push(`Segmental window heads${g.smallPanes ? ', small-paned upper sashes' : ''}`);
  if (g.accentFrieze) features.push('Glazed tile frieze');
  if (doorSurround === 'canopy') features.push('Iron-and-glass entrance canopy');
  if (anyParty) features.push(`Terraced: blind fire wall${party.left && party.right ? 's on both sides' : ` on the ${party.left ? 'left' : 'right'}`}, ridge parallel to the street`);
  if (dormers.length) features.push(`${dormers.length} dormers (${g.dormerShape}${dormers.some((d) => d.shape === 'oculus' && g.dormerShape !== 'oculus') ? ' + œil-de-boeuf' : ''})`);
  if (parapet) features.push('Balustraded parapet on the cornice');
  if (g.cresting && roofForm === 'mansard') features.push('Iron cresting on the mansard curb');
  if (pediments.some((p) => p.oculus)) features.push('Oculus in pediment');
  if (g.dentils) features.push('Dentil cornice');

  return {
    schema: 'citygen.house/1',
    input,
    genome: g,
    placement: { x: env.x + env.width / 2, z: env.z + env.depth / 2, rotationY: ROTATION[input.front] },
    envelope: { width: W, depth: D },
    palette: {
      // Per-house drift: warmer/cooler, lighter/darker whites; roofs vary in tone.
      wall: shade(g.colors.wall, g.tint.light * 0.06, g.tint.warm * 1.3),
      trim: shade(g.colors.trim, g.tint.light * 0.012, g.tint.warm * 0.4),
      stone: shade(g.colors.stone, g.tint.light * 0.05, g.tint.warm * 0.5),
      roof: shade(g.colors.roof, g.tint.roof * 0.12, 0),
      glass: '#43576a',
      frame: g.colors.frame,
      door: g.colors.door,
      metal: '#1f2124',
      roofTrim: '#61666d',
      stain: '#463e33',
      rust: '#7a4528',
      void: '#0d0e0f',
      cableDark: '#1b1c1e',
      cableGrey: '#77787a',
      cableWhite: '#d8d5cd',
      cableBrown: '#4b3526',
      accent: g.colors.accent,
    },
    // Central façades are the kept-up, restored ones; wear builds up towards the outskirts.
    // Location drives wear (outskirts worn, centre clean); the house's own age varies it by ±25%.
    weathering: { condition: r3((input.wear ?? clamp((1 - input.centrality) * (0.75 + 0.5 * (g.age - 0.5)), 0, 1)) * (STYLES[g.style].weathering ?? 1)) },
    wallThickness: WALL_THICKNESS,
    plinthHeight: r3(plinth),
    floors,
    bays: { count: n, width: r3(bayW), centers: centers.map(r3) },
    composition: { entrance: comp, centralBays: c, wingBays, doorSurround },
    masses,
    footprint: fp,
    courtyard: court,
    plan,
    wings,
    facades,
    pediments,
    portico,
    stairs,
    balconies,
    roof: { form: roofForm, eaveY: r3(eaveY), corniceHeight: CORNICE_HEIGHT, corniceProjection: co, ridgeY: r3(ridgeY), parts },
    dormers,
    chimneys,
    stairCore,
    pilasters,
    towers,
    oriels,
    parapet,
    cresting: g.cresting && roofForm === 'mansard',
    quoins: g.corners === 'quoins',
    rusticatedGround: (g.rusticatedGround || g.groundCladding) && nFloors >= 2,
    ornaments,
    features,
  };
}

/** Height of a hip/mansard/gable roof surface above (x, z). */
export function roofHeightAt(p: RoofPartSpec, x: number, z: number): number {
  if (p.form === 'flat') return p.baseY + 0.1;
  if (p.form === 'gable') {
    const half = (p.x1 - p.x0) / 2;
    return p.baseY + Math.max(0, half - Math.abs(x - (p.x0 + p.x1) / 2)) * Math.tan(deg(p.pitch));
  }
  const d = Math.max(0, Math.min(p.ends?.x0 ? Infinity : x - p.x0, p.ends?.x1 ? Infinity : p.x1 - x, z - p.z0, p.z1 - z));
  if (p.form === 'hip') return p.baseY + d * Math.tan(deg(p.pitch));
  const run = p.lowerHeight! / Math.tan(deg(p.lowerPitch!));
  if (d <= run) return p.baseY + d * Math.tan(deg(p.lowerPitch!));
  return p.baseY + p.lowerHeight! + (d - run) * Math.tan(deg(p.pitch));
}

/** A roof colour in words, for the feature summary. */
function roofWord(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const [r, gg, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  return r > gg + 30 && r > b + 30 ? 'red tile' : gg > r + 10 ? 'green' : 'anthracite';
}

/** Lighten/darken (dl, relative) and warm/cool (warm −1…1) a hex colour. */
function shade(hex: string, dl: number, warm: number): string {
  const v = parseInt(hex.slice(1), 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => x / 255);
  const out = [ch[0] * (1 + dl) + warm * 0.018, ch[1] * (1 + dl) + warm * 0.004, ch[2] * (1 + dl) - warm * 0.022];
  return '#' + out.map((x) => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
}

/** Maximal axis-aligned rectangles inside an orthogonal ring (minus an optional hole). */
function maximalRects(outer: Vec2[], hole: Vec2[] | null): { x0: number; x1: number; z0: number; z1: number }[] {
  const xs = [...new Set([...outer, ...(hole ?? [])].map((p) => r3(p[0])))].sort((a, b) => a - b);
  const zs = [...new Set([...outer, ...(hole ?? [])].map((p) => r3(p[1])))].sort((a, b) => a - b);
  const pip = (ring: Vec2[], x: number, z: number) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i];
      const [xj, zj] = ring[j];
      if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  const cell = xs.slice(0, -1).map((x, i) => zs.slice(0, -1).map((z, k) => {
    const cx = (x + xs[i + 1]) / 2;
    const cz = (z + zs[k + 1]) / 2;
    return pip(outer, cx, cz) && !(hole && pip(hole, cx, cz));
  }));
  const all: { i0: number; i1: number; k0: number; k1: number }[] = [];
  for (let i0 = 0; i0 < xs.length - 1; i0++)
    for (let i1 = i0 + 1; i1 < xs.length; i1++)
      for (let k0 = 0; k0 < zs.length - 1; k0++)
        for (let k1 = k0 + 1; k1 < zs.length; k1++) {
          let ok = true;
          for (let i = i0; i < i1 && ok; i++) for (let k = k0; k < k1 && ok; k++) ok = cell[i][k];
          if (ok) all.push({ i0, i1, k0, k1 });
        }
  const maximal = all.filter((a) => !all.some((b) => b !== a && b.i0 <= a.i0 && b.i1 >= a.i1 && b.k0 <= a.k0 && b.k1 >= a.k1));
  return maximal.map((m) => ({ x0: xs[m.i0], x1: xs[m.i1], z0: zs[m.k0], z1: zs[m.k1] }));
}

/** Offset a facade-ordered rectilinear ring outward by d (mitred corners). */
function offsetRing(ring: Vec2[], d: number): Vec2[] {
  const n = ring.length;
  const nrm = (i: number): Vec2 => {
    const a = ring[i];
    const b = ring[(i + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    return [-(b[1] - a[1]) / l, (b[0] - a[0]) / l];
  };
  return ring.map((p, i) => {
    const a = nrm((i - 1 + n) % n);
    const b = nrm(i);
    const k = 1 + a[0] * b[0] + a[1] * b[1];
    return [r3(p[0] + (d * (a[0] + b[0])) / k), r3(p[1] + (d * (a[1] + b[1])) / k)] as Vec2;
  });
}

/** Segment minus an axis-aligned rectangle (Liang–Barsky clip, keep the outside parts). */
function subtractRect([a, b]: [Vec2, Vec2], r: { x0: number; x1: number; z0: number; z1: number }): [Vec2, Vec2][] {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [[-dx, a[0] - r.x0], [dx, r.x1 - a[0]], [-dz, a[1] - r.z0], [dz, r.z1 - a[1]]] as const) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return [[a, b]];
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  if (t0 >= t1) return [[a, b]];
  const at = (t: number): Vec2 => [a[0] + dx * t, a[1] + dz * t];
  const out: [Vec2, Vec2][] = [];
  if (t0 > 1e-6) out.push([a, at(t0)]);
  if (t1 < 1 - 1e-6) out.push([at(t1), b]);
  return out;
}

/** Remove duplicate and collinear vertices from a closed rectilinear ring. */
function simplifyRing(pts: Vec2[]): Vec2[] {
  let ring = pts.filter((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return Math.abs(p[0] - q[0]) > 1e-6 || Math.abs(p[1] - q[1]) > 1e-6;
  });
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[(i - 1 + ring.length) % ring.length];
      const b = ring[i];
      const c = ring[(i + 1) % ring.length];
      const crossV = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (Math.abs(crossV) < 1e-9) {
        ring = ring.filter((_, k) => k !== i);
        changed = true;
        break;
      }
    }
  }
  return ring;
}

export type { ManorGenome };
