import { Rng, deg, type Vec2 } from '@citygen/core';
import type { HouseSpec, OrielSpec, TowerSpec, WingBlockSpec } from '@citygen/house';
import type {
  InteriorOptions,
  InteriorSpec,
  LevelSpec,
  RoomKind,
  RoomSpec,
  StairRunSpec,
  UnitSpec,
  WallOpening,
  WallSpec,
} from './types';

/**
 * Interior planning.
 *
 * Structural idea (how a 1900s architect would do it): partition walls land on
 * the piers between window axes; every floor has a corridor spine running the
 * width of the house, a front band of rooms (street side) and a back band
 * (garden side) that also holds the stair hall. Every room opens onto the
 * corridor, or — where it cannot — onto a neighbour through an internal door,
 * so everything is reachable from the staircase, cellar and attic included.
 */

const PART = 0.15;
const H2 = PART / 2;
/** Cellar storey height: at least 2.75 m, deeper under tall houses (vaulted cellars of big town houses). */
const CELLAR_MIN = 2.75;
const TREAD = 0.27;
const MAX_RISER = 0.18;

interface Rect { x0: number; x1: number; z0: number; z1: number }
interface Group { k0: number; k1: number }
interface BlockCtx {
  id: string;
  main: boolean;
  ix0: number; ix1: number; iz0: number; iz1: number;
  n: number; bw: number; centers: number[];
  s: number; c: number; wingBays: number;
  backForcedL: number; backForcedR: number;
  projections: Rect[];
  towers: TowerSpec[];
  oriels: OrielSpec[];
  origin: Vec2;
  rotation: number;
  rng: Rng;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const rectPoly = (r: Rect): Vec2[] => [[r3(r.x0), r3(r.z0)], [r3(r.x1), r3(r.z0)], [r3(r.x1), r3(r.z1)], [r3(r.x0), r3(r.z1)]];
const polyArea = (p: Vec2[]) => Math.abs(p.reduce((s, [x, z], i) => { const [x2, z2] = p[(i + 1) % p.length]; return s + x * z2 - x2 * z; }, 0)) / 2;

export function planInterior(house: HouseSpec, opts: InteriorOptions = {}): InteriorSpec {
  const t = house.wallThickness;
  const main = house.masses.find((m) => m.role === 'main')!;
  const mix0 = main.x0 + t;
  const mix1 = main.x1 - t;
  const miz0 = main.z0 + t;
  const miz1 = main.z1 - t;

  // ---- Levels: cellar, floors, attic ----------------------------------------------
  const floors = house.floors;
  const nF = floors.length;
  const eave = house.roof.eaveY;
  const rm = house.roof.parts.find((p) => p.id === 'r-main')!;
  const head = 1.6 / Math.tan(deg(rm.form === 'mansard' ? rm.lowerPitch! : rm.pitch));
  const U: Rect = { x0: Math.max(mix0, rm.x0 + head), x1: Math.min(mix1, rm.x1 - head), z0: Math.max(miz0, rm.z0 + head), z1: Math.min(miz1, rm.z1 - head) };
  const ridgeH = house.roof.ridgeY - eave;
  const hasAttic = ridgeH >= 2.6 && U.z1 - U.z0 >= 4 && U.x1 - U.x0 >= 6;
  const atticH = rm.form === 'mansard' ? rm.lowerHeight! : Math.min(3.2, ridgeH);

  const levels: LevelSpec[] = [];
  const ordinal = (i: number) => (i === 1 ? '1st' : i === 2 ? '2nd' : i === 3 ? '3rd' : `${i}th`);
  const cellarH = Math.round(Math.max(CELLAR_MIN, Math.min(3.9, floors[0].height * 0.75)) * 100) / 100;
  levels.push(level(0, 'cellar', null, 'Cellar', 'C', floors[0].elevation - cellarH, cellarH, cellarH - 0.18));
  floors.forEach((f, i) => levels.push(level(i + 1, 'floor', i, i === 0 ? 'Ground floor' : `${ordinal(i)} floor`, i === 0 ? 'G' : String(i), f.elevation, f.height, f.height - 0.18)));
  if (hasAttic) levels.push(level(nF + 1, 'attic', null, 'Attic', 'A', eave, atticH, 2.3));

  function level(index: number, kind: LevelSpec['kind'], floor: number | null, name: string, short: string, elevation: number, height: number, wallHeight: number): LevelSpec {
    return { index, kind, floor, name, short, elevation: r3(elevation), height: r3(height), wallHeight, outlines: [], windows: [] };
  }

  const pairHeights = levels.slice(0, -1).map((l, i) => levels[i + 1].elevation - l.elevation);
  const flightRun = (h: number) => Math.ceil(Math.ceil(h / MAX_RISER) / 2) * TREAD;

  const rooms: RoomSpec[] = [];
  const walls: WallSpec[] = [];
  const units: UnitSpec[] = [];
  const stairs: StairRunSpec[] = [];
  const entrances: string[] = [];
  let wallSeq = 0;
  let openingSeq = 0;
  const towerRooms = new Set<RoomSpec>();
  const towerRoomAt = new Map<string, RoomSpec>();
  const spirals: InteriorSpec['spirals'] = [];

  // ---- Blocks: the main body plus any courtyard wings, each with its own staircase ----
  const bayIndexOf = (centers: number[], x: number) => centers.reduce((bi, c2, i) => (Math.abs(c2 - x) < Math.abs(centers[bi] - x) ? i : bi), 0);
  const mainBlock = (): BlockCtx => {
    const n = house.bays.count;
    const mid = (n - 1) / 2;
    const bnd = (k: number) => (k <= 0 ? mix0 : k >= n ? mix1 : house.bays.centers[0] - house.bays.width / 2 + k * house.bays.width);
    // Back rooms behind a courtyard wing have no outside wall: merge them into the corner room.
    const behind = (side: 'court-left' | 'court-right') => {
      const w = house.wings.find((q) => q.role === side);
      if (!w) return 0;
      return Array.from({ length: n }, (_, k) => k).filter((k) => (side === 'court-left' ? bnd(k) < w.rect.x1 - 0.3 : bnd(k + 1) > w.rect.x0 + 0.3)).length;
    };
    return {
      id: 'main', main: true, ix0: mix0, ix1: mix1, iz0: miz0, iz1: miz1,
      n, bw: house.bays.width, centers: house.bays.centers,
      s: house.genome.stairSide === 'right' ? Math.min(n - 1, mid + 1) : Math.max(0, mid - 1),
      c: Math.min(house.composition.centralBays, n), wingBays: house.composition.wingBays,
      backForcedL: behind('court-left'), backForcedR: behind('court-right'),
      projections: house.masses.filter((m) => m.role === 'central-risalit' || m.role === 'wing-left' || m.role === 'wing-right').map((m) => ({ x0: m.x0 + t, x1: m.x1 - t, z0: miz1, z1: m.z1 - t })),
      towers: house.towers, oriels: house.oriels, origin: [0, 0], rotation: 0, rng: Rng.create(house.input.seed, 'interior'),
    };
  };
  const wingBlock = (w: WingBlockSpec): BlockCtx => {
    const U2: Vec2 = [Math.cos(w.rotation), -Math.sin(w.rotation)];
    const V2: Vec2 = [Math.sin(w.rotation), Math.cos(w.rotation)];
    const loc = (x: number, z: number): Vec2 => [(x - w.origin[0]) * U2[0] + (z - w.origin[1]) * U2[1], (x - w.origin[0]) * V2[0] + (z - w.origin[1]) * V2[1]];
    const cs = [loc(w.rect.x0, w.rect.z0), loc(w.rect.x1, w.rect.z1)];
    const lx0 = Math.min(cs[0][0], cs[1][0]);
    const lx1 = Math.max(cs[0][0], cs[1][0]);
    const lz0 = Math.min(cs[0][1], cs[1][1]);
    const lz1 = Math.max(cs[0][1], cs[1][1]);
    return {
      id: w.id, main: false,
      ix0: lx0 + (w.junctions.includes('x0') ? 0 : t), ix1: lx1 - (w.junctions.includes('x1') ? 0 : t), iz0: lz0 + t, iz1: lz1 - t,
      n: w.bays.count, bw: w.bays.width, centers: w.bays.centers, s: w.stairBay, c: 1, wingBays: 0, backForcedL: 0, backForcedR: 0,
      projections: [], towers: [], oriels: [], origin: w.origin, rotation: w.rotation, rng: Rng.create(house.input.seed, 'interior', w.id),
    };
  };
  for (const blk of [mainBlock(), ...house.wings.map(wingBlock)]) planBlock(blk);
  void bayIndexOf;

  // ---- Tower storeys: their own levels, reached by a spiral stair inside each tower ----
  const topFloor = levels.find((l) => l.floor === nF - 1)!;
  const maxStages = Math.max(0, ...house.towers.map((tw) => tw.stages));
  const towerLevels: LevelSpec[] = [];
  for (let k = 1; k <= maxStages; k++) {
    const base = house.towers[0].stageBase + (k - 1) * house.towers[0].stageHeight;
    const L = level(levels.length, 'tower', null, `Tower ${k}`, `T${k}`, Math.max(base, topFloor.elevation + 2.4), house.towers[0].stageHeight, 2.6);
    levels.push(L);
    towerLevels.push(L);
  }
  for (const tw of house.towers) {
    const k2 = (tw.apothem - 0.45) / tw.apothem;
    const poly = tw.outline.map(([x, z]) => [r3(tw.center[0] + (x - tw.center[0]) * k2), r3(tw.center[1] + (z - tw.center[1]) * k2)] as Vec2);
    let below: RoomSpec | undefined = towerRoomAt.get(`${tw.id}@${topFloor.index}`) ?? rooms.find((r) => r.level === topFloor.index && (r.kind === 'corridor' || r.kind === 'hall' || r.kind === 'landing'));
    let yBelow = topFloor.elevation;
    let levelBelow = topFloor.index;
    for (let k = 1; k <= tw.stages; k++) {
      const L = towerLevels[k - 1];
      const castle = house.genome.towerPlan === 'castle';
      const room: RoomSpec = {
        id: `L${L.index}-${tw.id}`, level: L.index, kind: 'tower', name: k === tw.stages && castle ? 'Watch room' : tw.role === 'gate' ? 'Gate tower room' : 'Tower room',
        unit: null, parts: [poly], area: Math.round(polyArea(poly) * 10) / 10, center: [tw.center[0], tw.center[1]], connects: [],
      };
      rooms.push(room);
      if (below) {
        room.connects.push(below.id);
        below.connects.push(room.id);
      }
      spirals.push({ level: levelBelow, cx: tw.center[0], cz: tw.center[1], radius: Math.min(1.4, (tw.apothem - 0.45) * 0.55), yFrom: yBelow, yTo: L.elevation });
      below = room;
      yBelow = L.elevation;
      levelBelow = L.index;
    }
  }

  function planBlock(B: BlockCtx): void {
  const rng = B.rng;
  const { ix0, ix1, iz0, iz1, n, bw, centers } = B;
  const mid = (n - 1) / 2;
  /** Centreline of the partition between bay k-1 and bay k (k = 0 / n: inner face of the side walls). */
  const bnd = (k: number) => (k <= 0 ? ix0 : k >= n ? ix1 : centers[0] - bw / 2 + k * bw);
  const s = B.s;
  const sx0 = s === 0 ? ix0 : bnd(s) + H2;
  const sx1 = s === n - 1 ? ix1 : bnd(s + 1) - H2;
  const flightW = Math.max(0.85, (sx1 - sx0 - 0.12) / 2);
  const landing = Math.max(1.0, flightW);
  const blockLevels = (B.main ? levels : levels.filter((l) => l.kind !== 'attic')).filter((l) => l.kind !== 'tower');
  const runZ1 = (h: number) => iz0 + landing + Math.ceil(Math.ceil(h / MAX_RISER) / 2) * TREAD;
  const r0 = rooms.length;
  const w0 = walls.length;
  // ---- Staircase depth from the tallest storey it has to climb -------------------
  const stairDepth = Math.max(...pairHeights.map(flightRun)) + landing + 0.1;

  // ---- Bands: back (stair hall + service), corridor, front (street rooms) --------
  const Di = iz1 - iz0;
  let cw = Di >= 11 ? 2.0 : 1.6;
  let back = Math.max(stairDepth, Math.min(5.5, (Di - cw) * 0.42));
  if (Di - back - cw - 2 * PART < 3.4) back = stairDepth;
  if (Di - back - cw - 2 * PART < 3.0) cw = 1.3;
  const zA = iz0 + back + H2; // back band | corridor
  const zB = zA + H2 + cw + H2; // corridor | front band

  // ---- Room groups on the bay grid -------------------------------------------------
  const c = B.c;
  const half = (n - c) / 2;
  let forcedL = B.wingBays;
  let forcedR = forcedL;
  const zMidB = (iz0 + iz1) / 2;
  for (const tower of B.towers) {
    if (tower.role !== 'corner' || tower.center[1] < zMidB) continue;
    const xs = tower.outline.map((p) => p[0]);
    const tx0 = Math.min(...xs);
    const tx1 = Math.max(...xs);
    if (tx0 + tx1 < 0) forcedL = Math.max(forcedL, Array.from({ length: n }, (_, k) => k).filter((k) => bnd(k) < tx1 - 0.3).length);
    else forcedR = Math.max(forcedR, Array.from({ length: n }, (_, k) => k).filter((k) => bnd(k + 1) > tx0 + 0.3).length);
  }
  /** Inner floor polygon of a tower; remembers which room on which level owns it. */
  const towerPart = (tw: TowerSpec, room: RoomSpec): Vec2[] => {
    const [tcx, tcz] = tw.center;
    const k = (tw.apothem - 0.45) / tw.apothem;
    towerRooms.add(room);
    towerRoomAt.set(`${tw.id}@${room.level}`, room);
    return tw.outline.map(([x, z]) => [r3(tcx + (x - tcx) * k), r3(tcz + (z - tcz) * k)] as Vec2);
  };
  forcedL = Math.min(forcedL, half);
  forcedR = Math.min(forcedR, half);
  const split = n >= 5 && nF >= 2 && (opts.apartments === 'split' || ((opts.apartments ?? 'auto') === 'auto' && (ix1 - ix0) * Di >= 200 && nF >= 3));
  // Flats: rooms of one or two windows, mostly two.
  const pairChance = split ? 0.8 : 0.55;
  const sideSizes = (forced: number) => {
    const r = rng.fork('front-groups');
    const sizes: number[] = [];
    let rem = half - forced;
    while (rem > 0) {
      const sz = rem >= 2 && r.chance(pairChance) ? 2 : 1;
      sizes.push(sz);
      rem -= sz;
    }
    if (forced) sizes.push(forced);
    return sizes;
  };
  const frontGroups: Group[] = [];
  {
    let k = half;
    for (const sz of sideSizes(forcedL)) {
      frontGroups.unshift({ k0: k - sz, k1: k });
      k -= sz;
    }
    frontGroups.push({ k0: half, k1: half + c });
    k = half + c;
    for (const sz of sideSizes(forcedR)) {
      frontGroups.push({ k0: k, k1: k + sz });
      k += sz;
    }
  }
  const backGroups: Group[] = [];
  {
    const fixed = new Set([s, mid]);
    const rb = rng.fork('back-groups');
    let k = 0;
    while (k < n) {
      if (fixed.has(k)) {
        backGroups.push({ k0: k, k1: k + 1 });
        k++;
        continue;
      }
      let end = k;
      while (end < n && !fixed.has(end)) end++;
      for (let j = k; j < end; ) {
        const sz = end - j >= 2 && rb.chance(pairChance - 0.05) ? 2 : 1;
        backGroups.push({ k0: j, k1: j + sz });
        j += sz;
      }
      k = end;
    }
  }
  const centerFront = frontGroups.findIndex((g) => g.k0 === half);

  // Shallow plans (no room for corridor + two bands): full-depth rooms in an enfilade chain.
  const shallow = Di < stairDepth + cw + 3.4 + 2 * PART;
  const chainGroups: Group[] = (() => {
    const gs = backGroups.map((g) => ({ ...g }));
    const merge = (fromStart: boolean, count: number) => {
      // Corner rooms must swallow a whole tower / end pavilion, unless that would eat the stair or the axis.
      const covered = (g: Group) => (fromStart ? g.k1 <= count : g.k0 >= n - count);
      const take = fromStart ? gs.filter(covered) : gs.filter(covered);
      if (take.length < 2 || take.some((g) => g.k0 === s || g.k0 === mid)) return;
      const k0 = Math.min(...take.map((g) => g.k0));
      const k1 = Math.max(...take.map((g) => g.k1));
      const rest = gs.filter((g) => !take.includes(g));
      gs.length = 0;
      gs.push(...rest, { k0, k1 });
      gs.sort((a, b) => a.k0 - b.k0);
    };
    if (forcedL) merge(true, forcedL);
    if (forcedR) merge(false, forcedR);
    return gs;
  })();

  // Projections (central risalit, end pavilions) open into the front rooms behind them.
  const projections: Rect[] = B.projections;
  const frontZAt = (x: number) => Math.max(iz1, ...projections.filter((p) => x > p.x0 + 0.01 && x < p.x1 - 0.01).map((p) => p.z1));

  
  // Back rooms hidden behind courtyard wings join the corner room (it has a side window).
  const mergeBack = (gs: Group[], fromStart: boolean, count: number) => {
    if (!count) return;
    const take = gs.filter((g) => (fromStart ? g.k1 <= count : g.k0 >= n - count));
    if (take.length < 2 || take.some((g) => g.k0 === s || g.k0 === mid)) return;
    const k0 = Math.min(...take.map((g) => g.k0));
    const k1 = Math.max(...take.map((g) => g.k1));
    const rest = gs.filter((g) => !take.includes(g));
    gs.length = 0;
    gs.push(...rest, { k0, k1 });
    gs.sort((a, b) => a.k0 - b.k0);
  };
  mergeBack(backGroups, true, B.backForcedL);
  mergeBack(backGroups, false, B.backForcedR);

  for (const L of blockLevels) {
    const kind = L.kind === 'cellar' ? 'cellar' : L.kind === 'attic' ? 'attic' : L.floor === 0 ? 'ground' : 'floor';
    planLevel(L, kind);
  }

  function planLevel(L: LevelSpec, kind: 'cellar' | 'ground' | 'floor' | 'attic'): void {
    const attic = kind === 'attic';
    const cx0 = attic ? U.x0 : ix0;
    const cx1 = attic ? U.x1 : ix1;
    const frontLimit = attic ? U.z1 : iz1;
    const backLimit = attic ? U.z0 : iz0;
    const lvl = L.index;
    const mk = (id: string, k: RoomKind, parts: Vec2[][], center?: Vec2): RoomSpec => {
      const area = parts.reduce((sum, p, i) => sum + (i === 0 || k !== 'stair' ? polyArea(p) : 0), 0);
      const p0 = parts[0];
      const ctr = center ?? ([(p0[0][0] + p0[2][0]) / 2, (p0[0][1] + p0[2][1]) / 2] as Vec2);
      return { id: `L${lvl}-${B.main ? '' : B.id + '-'}${id}`, level: lvl, kind: k, name: '', unit: null, parts, area: Math.round(area * 10) / 10, center: [r3(ctr[0]), r3(ctr[1])], connects: [] };
    };

    if (shallow) {
      planChain(L, kind, mk, cx0, cx1, frontLimit, backLimit);
      return;
    }

    // -- Rooms ------------------------------------------------------------------
    type Placed = { room: RoomSpec; band: 'front' | 'back'; g: Group; x0: number; x1: number };
    const front: Placed[] = [];
    const backR: Placed[] = [];
    frontGroups.forEach((g, gi) => {
      const x0 = Math.max(cx0, g.k0 === 0 ? ix0 : bnd(g.k0) + H2);
      const x1 = Math.min(cx1, g.k1 === n ? ix1 : bnd(g.k1) - H2);
      const z0 = zB + H2;
      if (x1 - x0 < 1.2 || frontLimit - z0 < 1.6) return;
      const parts: Vec2[][] = [rectPoly({ x0, x1, z0, z1: frontLimit })];
      if (!attic) {
        for (const p of projections) {
          const a = Math.max(x0, p.x0);
          const b = Math.min(x1, p.x1);
          if (b - a > 0.2) parts.push(rectPoly({ x0: a, x1: b, z0: p.z0, z1: p.z1 }));
        }
      }
      const towersHere: TowerSpec[] = [];
      for (const tower of B.towers) {
        const [tcx, tcz] = tower.center;
        if (tcz < zB) continue;
        const insideX = tcx > x0 - 0.01 && tcx < x1 + 0.01;
        const reach = attic ? tcz - tower.apothem < frontLimit + 0.5 && tower.outline.some((p) => p[0] > cx0 && p[0] < cx1) : true;
        if (insideX && reach) towersHere.push(tower);
      }
      if (L.floor !== null) {
        for (const o of B.oriels) {
          if (!o.floors.includes(L.floor)) continue;
          const ocx = (o.outline[0][0] + o.outline[3][0]) / 2;
          if (ocx < x0 || ocx > x1) continue;
          const [p0, p1, p2, p3] = o.outline;
          parts.push([
            [r3(p0[0] + 0.25), r3(o.zWall - t)], [r3(p3[0] - 0.25), r3(o.zWall - t)], [r3(p3[0] - 0.25), o.zWall],
            [r3(p2[0] - 0.1), r3(p2[1] - 0.25)], [r3(p1[0] + 0.1), r3(p1[1] - 0.25)], [r3(p0[0] + 0.25), o.zWall],
          ]);
        }
      }
      const room = mk(`F${gi}`, 'storage', parts, [(x0 + x1) / 2, (z0 + frontLimit) / 2 + 0.3]);
      for (const tw of towersHere) room.parts.push(towerPart(tw, room));
      front.push({ room, band: 'front', g, x0, x1 });
    });
    backGroups.forEach((g, gi) => {
      const isStair = g.k0 === s;
      const x0 = isStair ? sx0 : Math.max(cx0, g.k0 === 0 ? ix0 : bnd(g.k0) + H2);
      const x1 = isStair ? sx1 : Math.min(cx1, g.k1 === n ? ix1 : bnd(g.k1) - H2);
      const z0 = isStair ? iz0 : backLimit;
      const z1 = zA - H2;
      if (!isStair && (x1 - x0 < 1.2 || z1 - z0 < 1.6)) return;
      const room = mk(`B${gi}`, isStair ? 'stair' : 'storage', [rectPoly({ x0, x1, z0, z1 })], [(x0 + x1) / 2, isStair ? z1 - 0.5 : (z0 + z1) / 2]);
      if (!isStair && !attic) {
        for (const tw of B.towers) if (tw.center[1] < zA && tw.center[0] > x0 - 0.01 && tw.center[0] < x1 + 0.01) room.parts.push(towerPart(tw, room));
      }
      backR.push({ room, band: 'back', g, x0, x1 });
    });
    const stairRoom = backR.find((p) => p.room.kind === 'stair')!.room;

    // -- Units (apartments) ----------------------------------------------------------
    const flats = split && (kind === 'floor' || kind === 'ground');
    let comX0 = bnd(s);
    let comX1 = bnd(s + 1);
    if (kind === 'ground') {
      const cg = frontGroups[centerFront];
      comX0 = Math.min(comX0, bnd(cg.k0));
      comX1 = Math.max(comX1, bnd(cg.k1));
    }
    const hasL = flats && comX0 > ix0 + 2.5;
    const hasR = flats && comX1 < ix1 - 2.5;
    const corridors: { room: RoomSpec; unit: string | null; x0: number; x1: number }[] = [];
    const unitId = (side: 'L' | 'R') => `U${L.floor}${side}${B.main ? '' : '-' + B.id}`;
    const zc0 = zA + H2;
    const zc1 = zB - H2;
    if (!flats || (!hasL && !hasR)) {
      corridors.push({ room: mk('C', kind === 'ground' ? 'hall' : 'corridor', [rectPoly({ x0: cx0, x1: cx1, z0: zc0, z1: zc1 })]), unit: null, x0: cx0, x1: cx1 });
    } else {
      const a = hasL ? comX0 + H2 : ix0;
      const b = hasR ? comX1 - H2 : ix1;
      corridors.push({ room: mk('C', 'landing', [rectPoly({ x0: a, x1: b, z0: zc0, z1: zc1 })]), unit: null, x0: a, x1: b });
      if (hasL) corridors.push({ room: mk('CL', 'hall', [rectPoly({ x0: ix0, x1: comX0 - H2, z0: zc0, z1: zc1 })]), unit: unitId('L'), x0: ix0, x1: comX0 - H2 });
      if (hasR) corridors.push({ room: mk('CR', 'hall', [rectPoly({ x0: comX1 + H2, x1: ix1, z0: zc0, z1: zc1 })]), unit: unitId('R'), x0: comX1 + H2, x1: ix1 });
    }
    for (const cdr of corridors) cdr.room.unit = cdr.unit;
    const corridorAt = (x: number) => corridors.find((cd) => x > cd.x0 - 0.01 && x < cd.x1 + 0.01) ?? corridors[0];

    // Which unit a room belongs to, and where (if anywhere) its door onto its own corridor goes.
    const needsEnfilade = new Set<RoomSpec>();
    const doorX = new Map<RoomSpec, number>();
    const comMid = (comX0 + comX1) / 2;
    for (const p of [...front, ...backR]) {
      const xm = (p.x0 + p.x1) / 2;
      const isVestibule = kind === 'ground' && p.band === 'front' && p.g.k0 === half;
      if (p.room.kind === 'stair') continue;
      if (flats && !isVestibule) {
        const side = hasL && (!hasR || xm < comMid) ? 'L' : hasR ? 'R' : null;
        if (side) p.room.unit = unitId(side);
      }
      const cd = corridors.find((k) => k.unit === p.room.unit) ?? corridors[0];
      const lo = Math.max(p.x0, cd.x0) + 0.55;
      const hi = Math.min(p.x1, cd.x1) - 0.55;
      if (lo <= hi) doorX.set(p.room, Math.min(hi, Math.max(lo, xm)));
      else needsEnfilade.add(p.room);
    }

    // -- Walls -------------------------------------------------------------------------
    const levelWalls: WallSpec[] = [];
    const wall = (a: Vec2, b: Vec2, height?: number) => {
      const w: WallSpec = { id: `w${wallSeq++}`, level: lvl, a: [r3(a[0]), r3(a[1])], b: [r3(b[0]), r3(b[1])], thickness: PART, openings: [] };
      if (height) w.height = height;
      levelWalls.push(w);
      return w;
    };
    const wA = wall([cx0, zA], [cx1, zA]);
    const wB = wall([cx0, zB], [cx1, zB]);
    const crossFront = new Map<number, WallSpec>();
    for (let i = 0; i < front.length - 1; i++) {
      const x = bnd(front[i].g.k1);
      if (x <= cx0 + 0.3 || x >= cx1 - 0.3) continue;
      crossFront.set(i, wall([x, zB], [x, attic ? frontLimit : frontZAt(x)]));
    }
    const crossBack = new Map<number, WallSpec>();
    for (let i = 0; i < backR.length - 1; i++) {
      const x = bnd(backR[i].g.k1);
      if (x <= cx0 + 0.3 || x >= cx1 - 0.3) continue;
      const z0 = backR[i].room.kind === 'stair' || backR[i + 1].room.kind === 'stair' ? iz0 : backLimit;
      crossBack.set(i, wall([x, z0], [x, zA]));
    }
    const flatWalls: WallSpec[] = [];
    if (hasL && flats) flatWalls.push(wall([comX0, zA], [comX0, zB]));
    if (hasR && flats) flatWalls.push(wall([comX1, zA], [comX1, zB]));
    if (attic) {
      // Knee walls where the roof gets too low.
      wall([U.x0, U.z0], [U.x1, U.z0], 1.1);
      wall([U.x1, U.z0], [U.x1, U.z1], 1.1);
      wall([U.x1, U.z1], [U.x0, U.z1], 1.1);
      wall([U.x0, U.z1], [U.x0, U.z0], 1.1);
    }

    const connect = (a: RoomSpec, b: RoomSpec) => {
      if (!a.connects.includes(b.id)) a.connects.push(b.id);
      if (!b.connects.includes(a.id)) b.connects.push(a.id);
    };
    const door = (w: WallSpec, along: number, width: number, kindD: WallOpening['kind'], ra: RoomSpec, rb: RoomSpec) => {
      const horizontal = Math.abs(w.b[1] - w.a[1]) < 1e-6;
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const u0 = horizontal ? Math.abs(along - w.a[0]) : Math.abs(along - w.a[1]);
      const u = Math.min(len - width / 2 - 0.12, Math.max(width / 2 + 0.12, u0));
      const height = kindD === 'double-door' ? 2.6 : kindD === 'opening' ? Math.min(2.6, L.wallHeight - 0.05) : 2.2;
      w.openings.push({ id: `d${openingSeq++}`, u: r3(u), width: r3(width), height, kind: kindD, rooms: [ra.id, rb.id] });
      connect(ra, rb);
    };

    // Stair hall opens onto the (common) corridor.
    door(wA, (sx0 + sx1) / 2, Math.max(1.0, sx1 - sx0 - 0.4), 'opening', stairRoom, corridorAt((sx0 + sx1) / 2).room);

    const grand = !flats && (kind === 'ground' || (L.floor === 1 && nF >= 3));
    for (const p of [...front, ...backR]) {
      if (p.room.kind === 'stair' || needsEnfilade.has(p.room)) continue;
      const xd = doorX.get(p.room)!;
      const cd = (corridors.find((k) => k.unit === p.room.unit) ?? corridors[0]).room;
      const wide = (kind === 'ground' && p.band === 'front' && p.g.k0 === half) || (grand && p.band === 'front' && p.g.k1 - p.g.k0 >= 2);
      door(p.band === 'front' ? wB : wA, xd, wide ? 1.4 : 0.9, wide ? 'double-door' : 'door', p.room, cd);
    }
    // Rooms in the common strip open into a neighbour of their own flat.
    for (const r of needsEnfilade) {
      const band = front.find((p) => p.room === r) ? front : backR;
      const i = band.findIndex((p) => p.room === r);
      const toLeft = r.unit?.endsWith('L');
      const j = toLeft ? i - 1 : i + 1;
      const nb = band[j];
      const crossMap = band === front ? crossFront : crossBack;
      const w = crossMap.get(toLeft ? j : i);
      if (nb && w && nb.room.unit === r.unit && !needsEnfilade.has(nb.room)) {
        const zMidW = (w.a[1] + w.b[1]) / 2;
        door(w, zMidW, 0.9, 'door', r, nb.room);
      } else {
        // No neighbour in that flat: it becomes common space off the landing.
        r.unit = null;
        const xm = (band[i].x0 + band[i].x1) / 2;
        door(band === front ? wB : wA, Math.min(corridors[0].x1 - 0.55, Math.max(corridors[0].x0 + 0.55, xm)), 0.9, 'door', r, corridors[0].room);
      }
    }
    // Classical enfilade along the street front on the reception floors.
    if (grand) {
      for (const [i, w] of crossFront) {
        const zEnd = Math.max(w.a[1], w.b[1]);
        door(w, Math.max(zB + 1.0, Math.min(iz1 - 1.1, zEnd - 1.1)), 1.2, 'double-door', front[i].room, front[i + 1].room);
      }
    }
    // Flat entrance doors from the landing.
    for (const w of flatWalls) {
      const left = w.a[0] < comMid;
      const flatCorr = corridors.find((cd) => cd.unit === unitId(left ? 'L' : 'R'))!;
      door(w, (zA + zB) / 2, 1.0, 'apartment-door', corridors[0].room, flatCorr.room);
    }

    // -- Names ---------------------------------------------------------------------------
    nameRooms(kind, L, front, backR, corridors, flats);

    const all = [...front.map((p) => p.room), ...backR.map((p) => p.room), ...corridors.map((cd) => cd.room)];
    rooms.push(...all);
    walls.push(...levelWalls);
    if (flats) {
      for (const side of ['L', 'R'] as const) {
        const id = unitId(side);
        const rs = all.filter((r) => r.unit === id);
        if (!rs.length) continue;
        const no = units.filter((u) => u.level === lvl).length + 1;
        units.push({ id, name: `Flat ${L.floor === 0 ? 'G' : L.floor}.${no}`, level: lvl, rooms: rs.map((r) => r.id), area: Math.round(rs.reduce((a, r) => a + r.area, 0)) });
      }
    }
  }

  /** Shallow houses: rooms span front to back and open into each other; the stair hall runs through. */
  function planChain(
    L: LevelSpec,
    kind: 'cellar' | 'ground' | 'floor' | 'attic',
    mk: (id: string, k: RoomKind, parts: Vec2[][], center?: Vec2) => RoomSpec,
    cx0: number,
    cx1: number,
    frontLimit: number,
    backLimit: number,
  ): void {
    const lvl = L.index;
    const attic = kind === 'attic';
    const stairZ1 = stairsZ1();
    const zEnf = Math.min(frontLimit - 0.6, Math.max(stairZ1 + 0.6, (stairZ1 + frontLimit) / 2));
    type Placed = { room: RoomSpec; g: Group; x0: number; x1: number };
    const placed: Placed[] = [];
    chainGroups.forEach((g, gi) => {
      const isStair = g.k0 === s;
      const x0 = isStair ? sx0 : Math.max(cx0, g.k0 === 0 ? ix0 : bnd(g.k0) + H2);
      const x1 = isStair ? sx1 : Math.min(cx1, g.k1 === n ? ix1 : bnd(g.k1) - H2);
      if (!isStair && x1 - x0 < 1.2) return;
      const z0 = isStair ? iz0 : backLimit;
      const z1 = isStair ? iz1 : frontLimit;
      const parts: Vec2[][] = [rectPoly({ x0, x1, z0, z1 })];
      const pendingTowers: TowerSpec[] = [];
      if (!attic && !isStair) {
        for (const p of projections) {
          const a = Math.max(x0, p.x0);
          const b = Math.min(x1, p.x1);
          if (b - a > 0.2) parts.push(rectPoly({ x0: a, x1: b, z0: p.z0, z1: p.z1 }));
        }
        for (const tw of B.towers) if (tw.center[0] > x0 - 0.01 && tw.center[0] < x1 + 0.01) pendingTowers.push(tw);
        if (L.floor !== null) {
          for (const o of B.oriels) {
            const ocx = (o.outline[0][0] + o.outline[3][0]) / 2;
            if (!o.floors.includes(L.floor) || ocx < x0 || ocx > x1) continue;
            const [p0, p1, p2, p3] = o.outline;
            parts.push([
              [r3(p0[0] + 0.25), r3(o.zWall - t)], [r3(p3[0] - 0.25), r3(o.zWall - t)], [r3(p3[0] - 0.25), o.zWall],
              [r3(p2[0] - 0.1), r3(p2[1] - 0.25)], [r3(p1[0] + 0.1), r3(p1[1] - 0.25)], [r3(p0[0] + 0.25), o.zWall],
            ]);
          }
        }
      }
      const room = mk(`R${gi}`, isStair ? 'stair' : 'storage', parts, [(x0 + x1) / 2, isStair ? (stairZ1 + iz1) / 2 : (z0 + z1) / 2]);
      for (const tw of pendingTowers) room.parts.push(towerPart(tw, room));
      placed.push({ room, g, x0, x1 });
    });
    const si = placed.findIndex((p) => p.room.kind === 'stair');

    const flats = split && (kind === 'floor' || kind === 'ground');
    const vestIdx = kind === 'ground' ? placed.findIndex((p) => p.g.k0 <= mid && p.g.k1 > mid && p.room.kind !== 'stair') : -1;
    // Common core: stair hall (+ ground-floor vestibule); flats left and right of it.
    const coreLo = vestIdx >= 0 ? Math.min(si, vestIdx) : si;
    const coreHi = vestIdx >= 0 ? Math.max(si, vestIdx) : si;
    placed.forEach((p, i) => {
      if (flats && (i < coreLo || i > coreHi)) p.room.unit = `U${L.floor}${i < coreLo ? 'L' : 'R'}${B.main ? '' : '-' + B.id}`;
    });

    const levelWalls: WallSpec[] = [];
    const connect = (a: RoomSpec, b: RoomSpec) => {
      if (!a.connects.includes(b.id)) a.connects.push(b.id);
      if (!b.connects.includes(a.id)) b.connects.push(a.id);
    };
    // Flats: every flat room is split into a back part (the flat's internal hall/kitchen/bath
    // strip, entered from the landing) and a front room that opens only from it.
    const zs = backLimit + (frontLimit - backLimit) * 0.42;
    const fronts = new Map<RoomSpec, RoomSpec>();
    const flatChain = flats && !attic;
    if (flatChain) {
      for (const p of placed) {
        if (!p.room.unit || frontLimit - zs < 3) continue;
        const fr = mk(`${p.room.id.split('-').pop()}f`, 'living', [rectPoly({ x0: p.x0, x1: p.x1, z0: zs + H2, z1: frontLimit }), ...p.room.parts.slice(1)], [(p.x0 + p.x1) / 2, (zs + frontLimit) / 2 + 0.3]);
        fr.unit = p.room.unit;
        p.room.parts = [rectPoly({ x0: p.x0, x1: p.x1, z0: backLimit, z1: zs - H2 })];
        p.room.area = Math.round(polyArea(p.room.parts[0]) * 10) / 10;
        p.room.center = [r3((p.x0 + p.x1) / 2), r3((backLimit + zs) / 2)];
        const w: WallSpec = { id: `w${wallSeq++}`, level: lvl, a: [r3(p.x0), r3(zs)], b: [r3(p.x1), r3(zs)], thickness: PART, openings: [] };
        w.openings.push({ id: `d${openingSeq++}`, u: r3((p.x1 - p.x0) / 2), width: 0.9, height: 2.2, kind: 'door', rooms: [p.room.id, fr.id] });
        connect(p.room, fr);
        levelWalls.push(w);
        fronts.set(p.room, fr);
      }
    }
    const zBackDoor = (backLimit + zs) / 2;
    for (let i = 0; i < placed.length - 1; i++) {
      const a = placed[i];
      const b = placed[i + 1];
      const x = bnd(a.g.k1);
      const stairSide = a.room.kind === 'stair' || b.room.kind === 'stair';
      const z0 = stairSide ? iz0 : backLimit;
      const z1 = attic ? frontLimit : frontZAt(x);
      const w: WallSpec = { id: `w${wallSeq++}`, level: lvl, a: [r3(x), r3(z0)], b: [r3(x), r3(z1)], thickness: PART, openings: [] };
      const entrance = a.room.unit !== b.room.unit;
      const grandDoor = !flats && (kind === 'ground' || (L.floor === 1 && nF >= 3)) && !stairSide;
      const width = entrance ? 1.0 : grandDoor ? 1.3 : 0.9;
      const kindD: WallOpening['kind'] = entrance && flats ? 'apartment-door' : grandDoor ? 'double-door' : 'door';
      const zd = fronts.has(a.room) || fronts.has(b.room) ? zBackDoor : zEnf;
      w.openings.push({ id: `d${openingSeq++}`, u: r3(zd - z0), width, height: kindD === 'double-door' ? 2.6 : 2.2, kind: kindD, rooms: [a.room.id, b.room.id] });
      connect(a.room, b.room);
      levelWalls.push(w);
    }
    if (attic) {
      for (const [a, b] of [[[U.x0, U.z0], [U.x1, U.z0]], [[U.x1, U.z1], [U.x0, U.z1]]] as [Vec2, Vec2][]) {
        levelWalls.push({ id: `w${wallSeq++}`, level: lvl, a, b, thickness: PART, height: 1.1, openings: [] });
      }
    }

    // Names.
    const set = (r: RoomSpec, k: RoomKind, name: string) => { r.kind = k; r.name = name; };
    const others = placed.filter((p) => p.room.kind !== 'stair');
    const byArea = [...others].sort((a, b) => b.room.area - a.room.area);
    placed[si].room.name = kind === 'cellar' ? 'Cellar stairs' : 'Stair hall';
    if (kind === 'cellar') {
      byArea.forEach((p, i) => set(p.room, ...(([['wine', 'Wine cellar'], ['boiler', 'Boiler room'], ['laundry', 'Laundry']] as [RoomKind, string][])[i] ?? ['storage', 'Storage'])));
    } else if (attic) {
      byArea.forEach((p, i) => set(p.room, ...((i === 0 ? ['studio', 'Studio'] : i % 2 ? ['maid', "Maid's room"] : ['storage', 'Box room']) as [RoomKind, string])));
    } else if (flats) {
      if (vestIdx >= 0) set(placed[vestIdx].room, 'entrance-hall', 'Vestibule');
      for (const side of ['L', 'R']) {
        const id = `U${L.floor}${side}${B.main ? '' : '-' + B.id}`;
        // Nearest the stair first: that room is where you enter the flat.
        const fl = placed.filter((p) => p.room.unit === id).sort((a, b) => Math.abs(a.g.k0 - s) - Math.abs(b.g.k0 - s));
        if (!fl.length) continue;
        if (fronts.size) {
          // Back strip from the entrance: hall, kitchen, bathroom; front rooms: living room, bedrooms.
          const backs = fl.map((p) => p.room);
          const fr = fl.map((p) => fronts.get(p.room)).filter((r): r is RoomSpec => !!r);
          const backNames: [RoomKind, string][] =
            backs.length === 1 ? [['hall', 'Hall, kitchen & bath']] : backs.length === 2 ? [['hall', 'Hall & kitchen'], ['bathroom', 'Bathroom']] : [['hall', 'Entrance hall'], ['kitchen', 'Kitchen'], ['bathroom', 'Bathroom']];
          backs.forEach((r, i) => set(r, ...(backNames[i] ?? ['dressing', 'Box room'])));
          [...fr].sort((a, b) => b.area - a.area).forEach((r, i) => set(r, ...((i === 0 ? ['living', 'Living room'] : ['bedroom', 'Bedroom']) as [RoomKind, string])));
          continue;
        }
        if (fl.length === 1) { set(fl[0].room, 'kitchen', 'Kitchen & living (bath)'); continue; }
        if (fl.length === 2) { set(fl[0].room, 'kitchen', 'Kitchen & bath'); set(fl[1].room, 'living', 'Living room'); continue; }
        set(fl[0].room, 'kitchen', 'Kitchen');
        const rest = fl.slice(1).sort((a, b) => b.room.area - a.room.area);
        rest.forEach((p, i) => set(p.room, ...((i === 0 ? ['living', 'Living room'] : i === rest.length - 1 ? ['bathroom', 'Bathroom'] : ['bedroom', 'Bedroom']) as [RoomKind, string])));
      }
    } else if (kind === 'ground') {
      if (vestIdx >= 0) set(placed[vestIdx].room, 'entrance-hall', 'Entrance hall');
      const fn: [RoomKind, string][] = [['salon', 'Salon'], ['dining', 'Dining room'], ['kitchen', 'Kitchen'], ['library', 'Library'], ['study', 'Study'], ['wc', 'WC']];
      byArea.filter((p) => p !== placed[vestIdx]).forEach((p, i) => set(p.room, ...(fn[i] ?? ['guest', 'Guest room'])));
    } else {
      const fn: [RoomKind, string][] = [['bedroom', 'Master bedroom'], ['bedroom', 'Bedroom'], ['bathroom', 'Bathroom'], ['nursery', 'Nursery'], ['dressing', 'Dressing room'], ['bedroom', 'Bedroom']];
      byArea.forEach((p, i) => set(p.room, ...(fn[i] ?? ['bedroom', 'Bedroom'])));
    }
    for (const p of placed) if (towerRooms.has(p.room)) p.room.name += ' · tower';

    rooms.push(...placed.map((p) => p.room), ...fronts.values());
    walls.push(...levelWalls);
    if (flats) {
      for (const side of ['L', 'R'] as const) {
        const id = `U${L.floor}${side}${B.main ? '' : '-' + B.id}`;
        const rs = [...placed.map((p) => p.room), ...fronts.values()].filter((r) => r.unit === id);
        if (!rs.length) continue;
        const no = units.filter((u) => u.level === lvl).length + 1;
        units.push({ id, name: `Flat ${L.floor === 0 ? 'G' : L.floor}.${no}`, level: lvl, rooms: rs.map((r) => r.id), area: Math.round(rs.reduce((a, r) => a + r.area, 0)) });
      }
    }
  }

  function nameRooms(
    kind: 'cellar' | 'ground' | 'floor' | 'attic',
    L: LevelSpec,
    front: { room: RoomSpec; g: Group }[],
    backR: { room: RoomSpec; g: Group }[],
    corridors: { room: RoomSpec; unit: string | null }[],
    flats: boolean,
  ): void {
    const set = (r: RoomSpec, k: RoomKind, name: string) => {
      r.kind = k;
      r.name = name;
    };
    const byArea = <T extends { room: RoomSpec }>(xs: T[]) => [...xs].sort((a, b) => b.room.area - a.room.area);
    const isCenter = (p: { g: Group }) => p.g.k0 === half;
    const isBackCenter = (p: { g: Group }) => p.g.k0 === mid && p.g.k0 !== s;
    for (const p of backR) if (p.room.kind === 'stair') set(p.room, 'stair', kind === 'cellar' ? 'Cellar stairs' : 'Staircase');
    const towerSuffix = (r: RoomSpec) => (towerRooms.has(r) ? ' · tower' : '');
    const fb = backR.filter((p) => p.room.kind !== 'stair');

    if (kind === 'cellar') {
      corridors.forEach((cd) => set(cd.room, 'corridor', 'Cellar corridor'));
      const near = [...fb].sort((a, b) => Math.abs(a.g.k0 - s) - Math.abs(b.g.k0 - s));
      const names: [RoomKind, string][] = [['boiler', 'Boiler room'], ['laundry', 'Laundry'], ['storage', 'Coal store']];
      near.forEach((p, i) => set(p.room, ...(names[i] ?? ['storage', 'Storage'])));
      byArea(front).forEach((p, i) => set(p.room, ...((isCenter(p) ? ['wine', 'Wine cellar'] : i % 3 === 1 ? ['workshop', 'Workshop'] : ['storage', 'Storage']) as [RoomKind, string])));
      return;
    }
    if (kind === 'attic') {
      corridors.forEach((cd) => set(cd.room, 'corridor', 'Attic corridor'));
      front.forEach((p) => set(p.room, ...((isCenter(p) ? ['studio', 'Studio'] : ['maid', "Maid's room"]) as [RoomKind, string])));
      byArea(fb).forEach((p, i) => set(p.room, ...((i === 0 ? ['loft', 'Drying loft'] : ['storage', 'Box room']) as [RoomKind, string])));
      for (const p of front) p.room.name += towerSuffix(p.room);
      return;
    }

    if (flats) {
      for (const cd of corridors) set(cd.room, cd.unit ? 'hall' : kind === 'ground' ? 'entrance-hall' : 'landing', cd.unit ? 'Hall' : kind === 'ground' ? 'Entrance passage' : 'Landing');
      const vest = front.find((p) => isCenter(p) && kind === 'ground' && !p.room.unit);
      if (vest) set(vest.room, 'entrance-hall', 'Vestibule');
      const unitsHere = [...new Set([...front, ...backR].map((p) => p.room.unit).filter((u): u is string => !!u))];
      for (const u of unitsHere) {
        const fr = byArea(front.filter((p) => p.room.unit === u));
        const br = byArea(backR.filter((p) => p.room.unit === u && p.room.kind !== 'stair'));
        fr.forEach((p, i) => set(p.room, ...((i === 0 ? ['living', 'Living room'] : i === fr.length - 1 && fr.length >= 3 && br.length < 2 ? ['bathroom', 'Bathroom'] : ['bedroom', 'Bedroom']) as [RoomKind, string])));
        br.forEach((p, i) => set(p.room, ...((i === 0 ? ['kitchen', br.length === 1 && fr.length < 3 ? 'Kitchen & bath' : 'Kitchen'] : i === br.length - 1 ? ['bathroom', 'Bathroom'] : ['bedroom', 'Bedroom']) as [RoomKind, string])));
      }
      for (const p of [...front, ...backR]) {
        if (!p.room.name) set(p.room, kind === 'ground' ? 'porter' : 'storage', kind === 'ground' ? "Porter's lodge" : 'Box room');
        p.room.name += towerSuffix(p.room);
      }
      return;
    }

    if (kind === 'ground') {
      corridors.forEach((cd) => set(cd.room, 'hall', 'Hall'));
      const others = byArea(front.filter((p) => !isCenter(p)));
      for (const p of front) if (isCenter(p)) set(p.room, 'entrance-hall', 'Entrance hall');
      const fn: [RoomKind, string][] = [['salon', 'Salon'], ['dining', 'Dining room'], ['library', 'Library'], ['study', 'Study'], ['music', 'Smoking room'], ['cloakroom', 'Cloakroom']];
      others.forEach((p, i) => set(p.room, ...(fn[i] ?? ['guest', 'Guest room'])));
      const bo = byArea(fb.filter((p) => !isBackCenter(p)));
      for (const p of fb) if (isBackCenter(p)) set(p.room, 'salon', 'Garden room');
      bo.forEach((p, i) => set(p.room, ...((i === 0 ? ['kitchen', 'Kitchen'] : i === bo.length - 1 && bo.length > 1 ? ['wc', 'WC'] : i === 1 ? ['pantry', 'Pantry'] : ['servant', "Servants' room"]) as [RoomKind, string])));
    } else if (L.floor === 1 && nF >= 3) {
      corridors.forEach((cd) => set(cd.room, 'corridor', 'Gallery'));
      for (const p of front) if (isCenter(p)) set(p.room, 'salon', c >= 3 ? 'Grand salon' : 'Salon');
      const fn: [RoomKind, string][] = [['salon', 'Drawing room'], ['music', 'Music room'], ['library', 'Library'], ['study', 'Study'], ['dressing', 'Boudoir']];
      byArea(front.filter((p) => !isCenter(p))).forEach((p, i) => set(p.room, ...(fn[i] ?? ['guest', 'Guest room'])));
      const bo = byArea(fb);
      bo.forEach((p, i) => set(p.room, ...((i === 0 ? ['bedroom', 'Bedroom'] : i === bo.length - 1 && bo.length > 1 ? ['bathroom', 'Bathroom'] : i === 1 ? ['dressing', 'Dressing room'] : ['guest', 'Guest room']) as [RoomKind, string])));
    } else {
      corridors.forEach((cd) => set(cd.room, 'corridor', 'Corridor'));
      for (const p of front) if (isCenter(p)) set(p.room, 'bedroom', 'Master bedroom');
      const fn: [RoomKind, string][] = [['bedroom', 'Bedroom'], ['nursery', 'Nursery'], ['bedroom', 'Bedroom'], ['study', 'Study'], ['bedroom', 'Bedroom']];
      byArea(front.filter((p) => !isCenter(p))).forEach((p, i) => set(p.room, ...(fn[i] ?? ['bedroom', 'Bedroom'])));
      const bo = byArea(fb);
      bo.forEach((p, i) => set(p.room, ...((i === bo.length - 1 ? ['bathroom', 'Bathroom'] : i === bo.length - 2 && bo.length > 2 ? ['wc', 'WC'] : i % 2 === 0 ? ['bedroom', 'Bedroom'] : ['dressing', 'Dressing room']) as [RoomKind, string])));
    }
    for (const p of front) p.room.name += towerSuffix(p.room);
  }

  function stairsZ1(): number {
    return iz0 + landing + Math.max(...pairHeights.map((h) => Math.ceil(Math.ceil(h / MAX_RISER) / 2))) * TREAD;
  }

  // ---- Stairs: one dog-leg run per pair of consecutive levels ------------------------
  for (let i = 0; i < blockLevels.length - 1; i++) {
    const l = blockLevels[i];
    const to = blockLevels[i + 1];
    const risers = Math.ceil((to.elevation - l.elevation) / MAX_RISER);
    const perFlight = Math.ceil(risers / 2);
    stairs.push({
      fromLevel: l.index, toLevel: to.index, x0: r3(sx0), x1: r3(sx1), z0: r3(iz0), z1: r3(iz0 + landing + perFlight * TREAD),
      yFrom: l.elevation, yTo: to.elevation, risers, tread: TREAD, landingDepth: r3(landing), material: l.kind === 'cellar' ? 'stone' : 'wood',
      transform: { x: B.origin[0], z: B.origin[1], rotationY: B.rotation },
    });
  }

  // Stair halls: only the strip in front of the arriving flights has a floor.
  for (const r of rooms.slice(r0)) {
    if (r.kind !== 'stair') continue;
    const li = blockLevels.findIndex((l) => l.index === r.level);
    if (li <= 0) continue;
    const zArr = runZ1(blockLevels[li].elevation - blockLevels[li - 1].elevation);
    const zs = r.parts[0].map((q) => q[1]);
    const top = Math.max(...zs);
    r.floorParts = top - zArr > 0.05 ? [rectPoly({ x0: sx0, x1: sx1, z0: zArr, z1: top })] : [];
  }

  // Entrances: the main door's hall / a wing's stair hall on the ground floor.
  const ground = blockLevels.find((l) => l.floor === 0)!;
  const groundRooms = rooms.slice(r0).filter((r) => r.level === ground.index);
  const ent = B.main ? groundRooms.filter((r) => r.kind === 'entrance-hall' && !r.id.endsWith('-C')) : groundRooms.filter((r) => r.kind === 'stair');
  entrances.push(...(ent.length ? ent : groundRooms.filter((r) => r.kind === 'stair')).map((r) => r.id));
  if (!B.main) for (const r of groundRooms) if (r.kind === 'stair') r.name = 'Entrance & stairs';

  // Block-local → building-local.
  if (B.rotation !== 0 || B.origin[0] !== 0 || B.origin[1] !== 0) {
    const cu = Math.cos(B.rotation);
    const su = Math.sin(B.rotation);
    const tw = ([x, z]: Vec2): Vec2 => [r3(B.origin[0] + x * cu + z * su), r3(B.origin[1] - x * su + z * cu)];
    for (const r of rooms.slice(r0)) {
      r.parts = r.parts.map((pt) => pt.map(tw));
      if (r.floorParts) r.floorParts = r.floorParts.map((pt) => pt.map(tw));
      r.center = tw(r.center);
    }
    for (const w of walls.slice(w0)) {
      w.a = tw(w.a);
      w.b = tw(w.b);
    }
  }
  }

  // ---- Outer wall sections and window markers per level ------------------------------
  const facadesAll = [...house.facades, ...house.towers.flatMap((tw) => tw.facades), ...house.oriels.flatMap((o) => o.facades)];
  for (const L of levels) {
    if (L.kind === 'tower') {
      const k = Number(L.short.slice(1));
      for (const tw of house.towers) if (tw.stages >= k) L.outlines.push({ points: tw.outline, closed: true, thickness: 0.45 });
      for (const tw of house.towers) for (const f of tw.facades) for (const op of f.openings) if (op.floor === nF + k - 1) L.windows.push({ x: op.position[0], z: op.position[2], width: op.width, normal: f.normal, kind: 'window' });
      continue;
    }
    if (L.kind !== 'attic') L.outlines.push({ points: house.footprint, closed: true, thickness: t });
    if (L.kind !== 'attic' && house.courtyard) L.outlines.push({ points: house.courtyard, closed: true, thickness: t });
    for (const tw of house.towers) L.outlines.push({ points: tw.outline, closed: true, thickness: 0.45 });
    if (L.floor !== null) {
      for (const o of house.oriels) if (o.floors.includes(L.floor)) L.outlines.push({ points: o.outline, closed: false, thickness: 0.25 });
      for (const f of facadesAll) {
        for (const op of f.openings) {
          if (op.floor !== L.floor) continue;
          L.windows.push({ x: op.position[0], z: op.position[2], width: op.width, normal: f.normal, kind: op.kind === 'door' || op.kind === 'garden-door' ? 'door' : 'window' });
        }
      }
    }
    if (L.kind === 'attic') {
      for (const d of house.dormers) L.windows.push({ x: d.x, z: d.zFace, width: d.width - 0.3, normal: d.side === 'front' ? [0, 1] : [0, -1], kind: 'window' });
    }
  }

  return {
    schema: 'citygen.interior/1',
    houseSeed: house.input.seed,
    placement: house.placement,
    apartments: units.length > 0,
    levels,
    rooms,
    walls,
    stairs,
    spirals,
    units,
    entrances,
    palette: {
      parquet: '#b4865a',
      boards: '#c7a274',
      marble: '#e6e2da',
      tiles: '#c9d6d4',
      stone: '#a7a196',
      slab: '#8d8a84',
      partition: '#f3f1ec',
      trim: '#fbfaf7',
      door: '#6a4930',
      stairsWood: '#7d5638',
      stairsStone: '#b3ada2',
      rail: '#2a2c2f',
      outerCut: '#53575d',
      windowMark: '#8cc0dd',
      doorMark: '#c2643c',
    },
  };
}
