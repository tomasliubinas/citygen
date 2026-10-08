import { Rng, clamp, lerp, type Vec2 } from '@citygen/core';
import { MAX_ENVELOPE, MIN_ENVELOPE, STYLES, type HouseInput } from '@citygen/house';
import { area, centroid, chord, clip, extents, flip, inset, insideConvex, overlaps, type Line, type Tag, type TaggedPoly } from './geom';
import type { BlockSpec, CityInput, CitySpec, PlotSpec, StreetKind, StreetSpec } from './types';

/**
 * Street layer.
 *
 * 1. Primary structure per pattern: grid = main cross + two diagonal avenues
 *    through the centre; radial = spokes + polygonal ring roads; organic = one
 *    avenue. A ring road always runs along the city edge.
 * 2. Recursive splitting of every convex cell by a street perpendicular to its
 *    longer side until the block matches a target size (small near the centre,
 *    large in the outskirts).
 * 3. Cells are inset by half their streets' widths (curb) and a sidewalk (lot).
 * 4. Plots are laid along every lot edge, longest edge first: dense centre =
 *    narrow, deep, side-by-side plots; outskirts = wide plots with gardens
 *    between. Each plot becomes a HouseInput in its own street-facing frame.
 */

const SIDEWALK = 3;
const WIDTH: Record<StreetKind, number> = { ring: 18, avenue: 24, street: 15, lane: 11 };

/** Where a style is most at home: weight multiplier by centrality (unknown styles = 1). */
const AFFINITY: Record<string, (c: number) => number> = {
  'classicist-manor': (c) => 1.5 - 1.1 * c,
  'beaux-arts': (c) => 0.3 + 1.7 * c,
  'art-nouveau': (c) => 0.7 + 0.6 * c,
  // Old town in the core, the interwar ring around it, brick everywhere.
  'vilnius-old-town': (c) => 0.1 + 2.4 * c * c,
  'kaunas-deco': (c) => 0.5 * (0.3 + 1.6 * Math.sin(Math.PI * Math.min(1, c * 1.1))),
  klaipeda: () => 0.25,
  // Villas: mostly towards the outskirts.
  'french-classical': (c) => 0.9 - 0.6 * c,
};

const evenFloor = (v: number) => 2 * Math.floor(v / 2);
const r2 = (v: number) => Math.round(v * 100) / 100;
const rp = (p: Vec2): Vec2 => [r2(p[0]), r2(p[1])];

export function generateCity(raw: CityInput): CitySpec {
  const size = clamp(raw.size ?? 400, 200, 1200);
  const half = size / 2;
  const pattern = raw.pattern ?? 'grid';
  const blockScale = clamp(raw.blockScale ?? 1, 0.5, 2);
  const falloff = clamp(raw.falloff ?? 1, 0.3, 3);
  const rng = Rng.create(raw.seed ?? '', 'city');
  const cr = rng.fork('centre');
  const centreFrac: Vec2 = raw.centre ?? [cr.range(-0.08, 0.08), cr.range(-0.08, 0.08)];
  const centre: Vec2 = [clamp(centreFrac[0], -0.3, 0.3) * size, clamp(centreFrac[1], -0.3, 0.3) * size];
  const radius = size * 0.62;
  const styleWeights: Record<string, number> = raw.styles ?? Object.fromEntries(Object.keys(STYLES).map((k) => [k, 1]));
  const centralityAt = (p: Vec2) => Math.pow(clamp(1 - Math.hypot(p[0] - centre[0], p[1] - centre[1]) / radius, 0, 1), falloff);

  const streets: StreetSpec[] = [];
  const addStreet = (kind: StreetKind, a: Vec2, b: Vec2, width = WIDTH[kind]): Tag => {
    const id = streets.length;
    streets.push({ id, kind, width, a: rp(a), b: rp(b) });
    return { streetId: id, width };
  };

  // Square city with a ring road along its edge (CCW in x, z).
  const sq: Vec2[] = [[-half, -half], [half, -half], [half, half], [-half, half]];
  const ringTags = sq.map((p, i) => addStreet('ring', p, sq[(i + 1) % 4]));
  const root: TaggedPoly = { pts: sq, tags: ringTags };

  type Cell = TaggedPoly & { plaza?: boolean };
  let cells: Cell[] = [root];
  const cutAll = (l: Line, kind: StreetKind) => {
    const seg = chord(sq, l);
    if (!seg) return;
    const tag = addStreet(kind, seg[0], seg[1]);
    cells = cells.flatMap((c) => {
      if (c.plaza || !chord(c.pts, l)) return [c];
      return [clip(c, l, tag), clip(c, flip(l), tag)].filter((p) => p.pts.length >= 3);
    });
  };

  const pr = rng.fork('pattern');
  let gridAngle = 0;
  if (pattern === 'grid') {
    gridAngle = pr.chance(0.5) ? 0 : pr.range(-0.2, 0.2);
    const u: Vec2 = [Math.cos(gridAngle), Math.sin(gridAngle)];
    if (pr.chance(0.75)) {
      cutAll({ p: centre, d: u }, 'avenue');
      cutAll({ p: centre, d: [-u[1], u[0]] }, 'avenue');
    }
    for (const a of [Math.PI / 4, -Math.PI / 4]) cutAll({ p: centre, d: [Math.cos(gridAngle + a), Math.sin(gridAngle + a)] }, 'avenue');
  } else if (pattern === 'organic') {
    const a = pr.range(0, Math.PI);
    cutAll({ p: centre, d: [Math.cos(a), Math.sin(a)] }, 'avenue');
  } else {
    // Radial: spokes through the centre + polygonal rings whose corners sit on the spokes.
    const k = pr.pick([6, 8, 8, 10]);
    const a0 = pr.range(0, Math.PI / k);
    const angles = Array.from({ length: k }, (_, i) => a0 + (i * 2 * Math.PI) / k);
    const r0 = size * 0.055;
    const step = size * pr.range(0.12, 0.16);
    const radii: number[] = [r0];
    while (radii[radii.length - 1] + step < half * 1.35) radii.push(radii[radii.length - 1] + step);
    const V = (r: number, a: number): Vec2 => [centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a)];
    const spokeTags = angles.map((a) => {
      const l: Line = { p: centre, d: [Math.cos(a), Math.sin(a)] };
      const far = chord(sq, l);
      const end = far ? (far[0][0] - centre[0]) * Math.cos(a) + (far[0][1] - centre[1]) * Math.sin(a) > 0 ? far[0] : far[1] : V(half, a);
      return addStreet('avenue', V(r0, a), end);
    });
    const ringTagsR = radii.map((r, j) => angles.map((a, i) => addStreet(j === 0 ? 'avenue' : 'street', V(r, a), V(r, angles[(i + 1) % k]))));
    const out: Cell[] = [];
    // Central plaza.
    out.push({ pts: angles.map((a) => V(r0, a)), tags: angles.map((_, i) => ringTagsR[0][i]), plaza: true });
    for (let i = 0; i < k; i++) {
      const aA = angles[i];
      const aB = angles[(i + 1) % k];
      for (let j = 0; j < radii.length; j++) {
        let c: TaggedPoly = root;
        c = clip(c, { p: centre, d: [Math.cos(aA), Math.sin(aA)] }, spokeTags[i]);
        c = clip(c, flip({ p: centre, d: [Math.cos(aB), Math.sin(aB)] }), spokeTags[(i + 1) % k]);
        const inner = { p: V(radii[j], aA), d: [V(radii[j], aB)[0] - V(radii[j], aA)[0], V(radii[j], aB)[1] - V(radii[j], aA)[1]] as Vec2 };
        c = clip(c, flip(inner), ringTagsR[j][i]);
        if (j + 1 < radii.length) {
          const outer = { p: V(radii[j + 1], aA), d: [V(radii[j + 1], aB)[0] - V(radii[j + 1], aA)[0], V(radii[j + 1], aB)[1] - V(radii[j + 1], aA)[1]] as Vec2 };
          c = clip(c, outer, ringTagsR[j + 1][i]);
        }
        if (c.pts.length >= 3 && area(c.pts) > 50) out.push(c);
      }
    }
    cells = out;
    // Trim ring/spoke segments to the city square.
    for (const st of streets) {
      if (st.kind === 'ring') continue;
      const seg = clipSegment(st.a, st.b, half);
      if (seg) [st.a, st.b] = [rp(seg[0]), rp(seg[1])];
      else st.b = st.a;
    }
  }

  // ---- Recursive subdivision into blocks -----------------------------------------
  const sr = rng.fork('split');
  const finals: Cell[] = [];
  const subdivide = (c: Cell, depth: number) => {
    if (c.plaza) {
      finals.push(c);
      return;
    }
    const ctr = centroid(c.pts);
    const cen = centralityAt(ctr);
    const tLong = lerp(190, 100, cen) * blockScale;
    const tShort = lerp(140, 76, cen) * blockScale;
    let u: Vec2;
    if (pattern === 'grid') {
      u = [Math.cos(gridAngle), Math.sin(gridAngle)];
    } else {
      // Longest edge direction (with a little wobble for organic towns).
      let best = 0;
      let bi = 0;
      for (let i = 0; i < c.pts.length; i++) {
        const P = c.pts[i];
        const Q = c.pts[(i + 1) % c.pts.length];
        const l = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
        if (l > best) {
          best = l;
          bi = i;
        }
      }
      const P = c.pts[bi];
      const Q = c.pts[(bi + 1) % c.pts.length];
      const wob = pattern === 'organic' ? sr.range(-0.22, 0.22) : 0;
      const ang = Math.atan2(Q[1] - P[1], Q[0] - P[0]) + wob;
      u = [Math.cos(ang), Math.sin(ang)];
    }
    const e = extents(c.pts, u);
    const lu = e.umax - e.umin;
    const lv = e.vmax - e.vmin;
    const long = Math.max(lu, lv);
    const short = Math.min(lu, lv);
    if (depth >= 11 || (long <= tLong && short <= tShort * 1.3) || Math.abs(area(c.pts)) < 2400) {
      finals.push(c);
      return;
    }
    const t = 0.5 + sr.range(-1, 1) * (pattern === 'organic' ? 0.17 : 0.12);
    const v: Vec2 = [-u[1], u[0]];
    let line: Line;
    if (lu >= lv) {
      const a = e.umin + t * lu;
      const b = (e.vmin + e.vmax) / 2;
      line = { p: [a * u[0] + b * v[0], a * u[1] + b * v[1]], d: v };
    } else {
      const a = (e.umin + e.umax) / 2;
      const b = e.vmin + t * lv;
      line = { p: [a * u[0] + b * v[0], a * u[1] + b * v[1]], d: u };
    }
    const seg = chord(c.pts, line);
    if (!seg) {
      finals.push(c);
      return;
    }
    const kind: StreetKind = depth <= 1 ? 'street' : cen > 0.55 || depth <= 3 ? 'street' : 'lane';
    const tagProbe: Tag = { streetId: -1, width: WIDTH[kind] };
    const left = clip(c, line, tagProbe);
    const right = clip(c, flip(line), tagProbe);
    const tooSmall = (p: TaggedPoly) => {
      const ex = extents(p.pts, u);
      return Math.min(ex.umax - ex.umin, ex.vmax - ex.vmin) < 38 || Math.abs(area(p.pts)) < 1500;
    };
    if (left.pts.length < 3 || right.pts.length < 3 || tooSmall(left) || tooSmall(right)) {
      finals.push(c);
      return;
    }
    const tag = addStreet(kind, seg[0], seg[1]);
    const fix = (p: TaggedPoly): Cell => ({ pts: p.pts, tags: p.tags.map((tg) => (tg.streetId === -1 ? tag : tg)) });
    subdivide(fix(left), depth + 1);
    subdivide(fix(right), depth + 1);
  };
  for (const c of cells) subdivide(c, 0);

  // ---- Blocks and plots -------------------------------------------------------------
  const blocks: BlockSpec[] = [];
  const plots: PlotSpec[] = [];
  const allRects: { poly: Vec2[]; bb: [number, number, number, number] }[] = [];
  const bbox = (p: Vec2[]): [number, number, number, number] => [
    Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1])),
  ];
  const styleIds = Object.keys(styleWeights).filter((k) => styleWeights[k] > 0);

  // Plaza in the middle of a grid town: the block holding the centre stays open.
  finals.forEach((c, bi) => {
    const curb = inset(c, (tg) => tg.width / 2);
    if (curb.pts.length < 3 || area(curb.pts) < 300) return;
    const lot = inset(curb, () => SIDEWALK);
    const ctr = centroid(curb.pts);
    const cen = centralityAt(ctr);
    const id = `b${bi}`;
    const block: BlockSpec = { id, outline: curb.pts.map(rp), lot: lot.pts.map(rp), centrality: r2(cen), kind: 'built', plots: [] };
    blocks.push(block);
    const isPlaza = c.plaza || (pattern !== 'radial' && insideConvex(curb.pts, centre, 0) && area(curb.pts) < 14000);
    if (isPlaza) {
      block.kind = 'plaza';
      return;
    }
    if (lot.pts.length < 3) {
      block.kind = 'park';
      return;
    }
    const br = rng.fork(`block-${bi}`);
    if (cen < 0.35 && br.chance(0.06)) {
      block.kind = 'park';
      return;
    }
    // Terraced (touching, party walls) out to ~70% of the radius.
    const dense = cen > 0.3;
    const addPlot = (placed: Vec2[], w: number, d: number, nIn: Vec2, ei: number, partyWalls: { left: boolean; right: boolean }): number => {
      allRects.push({ poly: placed, bb: bbox(placed) });
      const index = plots.length;
      const pid = `p${index}`;
      const center: Vec2 = [(placed[0][0] + placed[2][0]) / 2, (placed[0][1] + placed[2][1]) / 2];
      const out: Vec2 = [-nIn[0], -nIn[1]];
      const rotation = Math.atan2(out[0], out[1]);
      const pc = centralityAt(center);
      const entries = styleIds.map((k) => {
        const aff = AFFINITY[k] ?? (() => 1);
        return [k, Math.max(0, styleWeights[k] * aff(pc))] as const;
      });
      const usable = entries.some(([, wt]) => wt > 0) ? entries : styleIds.map((k) => [k, 1] as const);
      const style = rng.fork(`style-${pid}`).weighted(usable);
      const seed = `${raw.seed ?? ''}-${pid}`;
      const house: HouseInput = {
        seed,
        envelope: { x: -w / 2, z: -d / 2, width: w, depth: d },
        front: 'south',
        centrality: r2(pc),
        floors: null,
        style: style as HouseInput['style'],
        partyWalls,
      };
      plots.push({
        id: pid, index, blockId: id, center: rp(center), rotation: Math.round(rotation * 1e6) / 1e6, width: w, depth: d,
        corners: placed.map(rp), centrality: r2(pc), style, seed, streetId: lot.tags[ei].streetId, house,
      });
      block.plots.push(index);
      return index;
    };


    // Organic centre: one or two large plots (room for wings and a courtyard) first, then
    // ordinary plots in the remaining space. A 4 m buffer keeps neighbours off the wings.
    if (pattern === 'organic' && cen > 0.6 && area(lot.pts) >= 1400) {
      const bigs = br.chance(0.5) ? 2 : 1;
      for (let k = 0; k < bigs; k++) {
        const free = (rect: Vec2[]) => {
          const bb = bbox(rect);
          return !allRects.some((r) => r.bb[0] < bb[2] && r.bb[2] > bb[0] && r.bb[1] < bb[3] && r.bb[3] > bb[1] && overlaps(r.poly, rect, 0.01));
        };
        const best = largestFrontRect(lot.pts, 48, 44, free);
        if (!best || best.w < (k ? 24 : 30) || best.d < (k ? 22 : 26)) break;
        addPlot(best.rect, best.w, best.d, best.nIn, best.edge, { left: false, right: false });
        const c: Vec2 = [(best.rect[0][0] + best.rect[2][0]) / 2, (best.rect[0][1] + best.rect[2][1]) / 2];
        const grown = best.rect.map(([x, z]) => {
          const dx = x - c[0];
          const dz = z - c[1];
          const l = Math.hypot(dx, dz) || 1;
          return [x + (dx / l) * 5.6, z + (dz / l) * 5.6] as Vec2;
        });
        allRects.push({ poly: grown, bb: bbox(grown) });
      }
    }

    const fMin = lerp(16, 12, cen);
    const fMax = lerp(28, 20, cen);
    const dMin = lerp(22, 16, cen);
    const dMax = lerp(40, 28, cen);
    const order = lot.pts.map((_, i) => i).sort((a, b) => edgeLen(lot.pts, b) - edgeLen(lot.pts, a));
    for (const ei of order) {
      const P = lot.pts[ei];
      const Q = lot.pts[(ei + 1) % lot.pts.length];
      const L = edgeLen(lot.pts, ei);
      if (L < MIN_ENVELOPE) continue;
      const e: Vec2 = [(Q[0] - P[0]) / L, (Q[1] - P[1]) / L];
      const nIn: Vec2 = [-e[1], e[0]];
      let s = dense ? 0.5 : br.range(1, 6);
      // Terraced rows: in the dense core consecutive plots touch and share a fire wall.
      let lastEnd = -1;
      let lastIndex = -1;
      while (s + MIN_ENVELOPE <= L) {
        let w = evenFloor(clamp(br.range(fMin, fMax), MIN_ENVELOPE, MAX_ENVELOPE));
        if (s + w > L) w = evenFloor(L - s);
        let d = evenFloor(clamp(br.range(dMin, dMax), MIN_ENVELOPE, MAX_ENVELOPE));
        let placed: Vec2[] | null = null;
        for (let tries = 0; tries < 8 && !placed; tries++) {
          if (w < MIN_ENVELOPE || d < MIN_ENVELOPE) break;
          const A: Vec2 = [P[0] + e[0] * s, P[1] + e[1] * s];
          const B: Vec2 = [A[0] + e[0] * w, A[1] + e[1] * w];
          const C: Vec2 = [B[0] + nIn[0] * d, B[1] + nIn[1] * d];
          const Dp: Vec2 = [A[0] + nIn[0] * d, A[1] + nIn[1] * d];
          const rect = [A, B, C, Dp];
          const bb = bbox(rect);
          const ok =
            rect.every((q) => insideConvex(lot.pts, q, 0.02)) &&
            !allRects.some((r) => r.bb[0] < bb[2] && r.bb[2] > bb[0] && r.bb[1] < bb[3] && r.bb[3] > bb[1] && overlaps(r.poly, rect, 0.01));
          if (ok) placed = rect;
          else if (tries % 2 === 0) d = evenFloor(Math.max(MIN_ENVELOPE, d * 0.8));
          else w = evenFloor(Math.max(MIN_ENVELOPE, w * 0.85));
        }
        if (!placed) {
          s += 3;
          continue;
        }
        const touching = dense && lastIndex >= 0 && Math.abs(s - lastEnd) < 0.01;
        // Plot-local +x is opposite to the walking direction along the edge.
        if (touching) plots[lastIndex].house.partyWalls = { ...plots[lastIndex].house.partyWalls, left: true };
        const index = addPlot(placed, w, d, nIn, ei, { left: false, right: touching });
        lastEnd = s + w;
        lastIndex = index;
        s += w + (dense ? 0 : br.range(3, lerp(14, 3, cen)));
      }
    }
    if (!block.plots.length) block.kind = 'park';
  });

  return {
    schema: 'citygen.city/1',
    input: { seed: raw.seed ?? '', size, pattern, blockScale, falloff, centre: centreFrac, styles: styleWeights },
    size,
    centre: rp(centre),
    radius: r2(radius),
    streets,
    blocks,
    plots,
  };
}

function edgeLen(pts: Vec2[], i: number): number {
  const P = pts[i];
  const Q = pts[(i + 1) % pts.length];
  return Math.hypot(Q[0] - P[0], Q[1] - P[1]);
}

/** Liang–Barsky clip of a segment to the square [-h, h]². */
function clipSegment(a: Vec2, b: Vec2, h: number): [Vec2, Vec2] | null {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  for (const [p, q] of [[-dx, a[0] + h], [dx, h - a[0]], [-dz, a[1] + h], [dz, h - a[1]]] as const) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  if (t0 >= t1) return null;
  return [[a[0] + dx * t0, a[1] + dz * t0], [a[0] + dx * t1, a[1] + dz * t1]];
}

/** Largest rectangle (even metres, within house limits) standing on one lot edge of a convex lot. */
function largestFrontRect(lot: Vec2[], maxW = MAX_ENVELOPE, maxD = MAX_ENVELOPE, ok: (rect: Vec2[]) => boolean = () => true): { rect: Vec2[]; w: number; d: number; nIn: Vec2; edge: number } | null {
  let best: { rect: Vec2[]; w: number; d: number; nIn: Vec2; edge: number } | null = null;
  for (let ei = 0; ei < lot.length; ei++) {
    const P = lot[ei];
    const L = edgeLen(lot, ei);
    if (L < MIN_ENVELOPE) continue;
    const Q = lot[(ei + 1) % lot.length];
    const e: Vec2 = [(Q[0] - P[0]) / L, (Q[1] - P[1]) / L];
    const nIn: Vec2 = [-e[1], e[0]];
    const rectAt = (s: number, w: number, d: number): Vec2[] => {
      const A: Vec2 = [P[0] + e[0] * s, P[1] + e[1] * s];
      const B: Vec2 = [A[0] + e[0] * w, A[1] + e[1] * w];
      return [A, B, [B[0] + nIn[0] * d, B[1] + nIn[1] * d], [A[0] + nIn[0] * d, A[1] + nIn[1] * d]];
    };
    for (let s = 0.5; s + MIN_ENVELOPE <= L; s += 2) {
      for (let w = Math.min(maxW, evenFloor(L - s)); w >= MIN_ENVELOPE; w -= 2) {
        if (best && w * maxD <= best.w * best.d) break;
        let d = maxD;
        while (d >= MIN_ENVELOPE && !rectAt(s, w, d).every((q) => insideConvex(lot, q, 0.02))) d -= 2;
        if (d >= MIN_ENVELOPE && (!best || w * d > best.w * best.d) && ok(rectAt(s, w, d))) best = { rect: rectAt(s, w, d), w, d, nIn, edge: ei };
      }
    }
  }
  return best;
}
