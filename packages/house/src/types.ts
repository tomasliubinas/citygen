import type { Vec2, Vec3 } from '@citygen/core';
import type { ManorGenome, StyleId } from './genome';

/** World compass edges. World axes: +X east, +Z south, +Y up. */
export type WorldEdge = 'north' | 'east' | 'south' | 'west';

/**
 * What the layer above (street / lot planner) hands to the house generator.
 * The envelope is the building boundary — everything (stairs, porticoes,
 * eaves) is guaranteed to fit inside it.
 */
export interface HouseInput {
  seed: string;
  /** World rectangle: (x, z) is the min corner; width along X, depth along Z. */
  envelope: { x: number; z: number; width: number; depth: number };
  /** Which envelope edge faces the street — the entrance goes there. */
  front: WorldEdge;
  /** 0 = outskirts … 1 = city centre. Drives the number of floors. */
  centrality: number;
  /** Explicit floor count; null/undefined = derived from size + centrality. */
  floors?: number | null;
  style?: StyleId;
  /**
   * Sides that touch the neighbouring house (terraced/row houses): the building fills
   * the plot to that edge with a blind fire wall. left = −x, right = +x seen from the street.
   */
  partyWalls?: { left?: boolean; right?: boolean };
  /** Wear override 0 (new) … 1 (derelict); null/undefined = from seed age and location. */
  wear?: number | null;
}

export type FloorKind = 'ground' | 'main' | 'upper' | 'top';

export interface FloorSpec {
  index: number;
  kind: FloorKind;
  /** Finished floor level (m above terrain). */
  elevation: number;
  height: number;
}

export type FacadeSide = 'front' | 'back' | 'left' | 'right';
export type OpeningKind = 'window' | 'door' | 'french-door' | 'garden-door' | 'stair-window';
export type WindowCrown = 'none' | 'keystone' | 'cornice' | 'triangular' | 'segmental' | 'secession' | 'eared';
export type OpeningHead = 'flat' | 'arched' | 'segmental';
export type RailingKind = 'stone' | 'iron' | 'nouveau' | 'tube' | 'xiron';

export interface OpeningSpec {
  id: string;
  facadeId: string;
  kind: OpeningKind;
  /** Floor the opening belongs to (stair windows: the floor they lead up to). */
  floor: number;
  /** Centre along the facade, measured from facade start point `a`. */
  u: number;
  /** Bottom of the clear opening (absolute y). */
  sill: number;
  width: number;
  /** Clear height including the arch, if any. */
  height: number;
  head: OpeningHead;
  crown: WindowCrown;
  apron: boolean;
  sillConsoles: boolean;
  balconyId?: string;
  /** Door framing override (wing entrances); defaults to the house's door surround. */
  surround?: 'portico' | 'consoles' | 'pediment' | 'canopy' | 'corbel' | 'stepped' | 'slab' | 'lantern';
  /** Bottom-centre of the opening on the outer wall face, building-local coords. */
  position: Vec3;
}

export interface FacadeSpec {
  id: string;
  side: FacadeSide;
  /** Outer wall face from a to b; outward normal is (-dz, dx). */
  a: Vec2;
  b: Vec2;
  length: number;
  normal: Vec2;
  openings: OpeningSpec[];
}

export type ColumnOrder = 'tuscan' | 'ionic' | 'corinthian';

export interface ColumnSpec {
  x: number;
  z: number;
  baseY: number;
  height: number;
  diameter: number;
}

export interface PedimentSpec {
  id: string;
  /** Tympanum extents along x (wall-to-wall). */
  x0: number;
  x1: number;
  /** Plane of the tympanum (outer face). */
  z: number;
  baseY: number;
  pitch: number;
  /** How far the raking cornice projects beyond x0/x1 and z. */
  overhang: number;
  oculus: boolean;
  /** Triangle = classical pediment; arched / bell = Art Nouveau curved gable wall. */
  shape: 'triangle' | 'arched' | 'bell' | 'stepped' | 'tiered' | 'volute' | 'block';
  /** Curved gables: total rise above baseY and the straight vertical part at the sides. */
  height: number;
  wallRise: number;
}

export interface PorticoSpec {
  kind: 'giant' | 'ground';
  order: ColumnOrder;
  /** Entablature footprint. */
  x0: number;
  x1: number;
  zWall: number;
  zFront: number;
  /** Podium top = ground floor level. */
  floorY: number;
  entablatureBottom: number;
  topY: number;
  columns: ColumnSpec[];
  pedimentId?: string;
  balconyId?: string;
}

export interface StairSpec {
  id: string;
  role: 'entrance' | 'garden';
  x0: number;
  x1: number;
  /** Building side and outer end of the flight (z). */
  zStart: number;
  zEnd: number;
  /** Flat landing depth next to the building (0 for portico stairs). */
  landing: number;
  fromY: number;
  toY: number;
  steps: number;
  /** 'front' descends towards +z; 'sides' descends towards ±x (garden terrace). */
  direction: 'front' | 'sides';
  /** If set, x/z are in that facade's frame (x along the wall, z outward) — wing entrance steps. */
  facadeId?: string;
  railing: RailingKind | 'none';
  pedestals: boolean;
}

export interface BalconySpec {
  id: string;
  floor: number;
  side: FacadeSide;
  x0: number;
  x1: number;
  /** Wall plane the balcony hangs off and its depth (towards +z for the front). */
  zFace: number;
  depth: number;
  /** Walking level. */
  y: number;
  support: 'consoles' | 'portico';
  railing: RailingKind;
}

export type RoofForm = 'hipped' | 'mansard' | 'flat';

export interface RoofPartSpec {
  id: string;
  form: 'hip' | 'mansard' | 'gable' | 'flat';
  /** Roof base rectangle at eave height, overhang included. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  baseY: number;
  pitch: number;
  /** Mansard: steep lower slope. */
  lowerPitch?: number;
  lowerHeight?: number;
  /** Gable: the pediment it terminates in (front, +z end). */
  pedimentId?: string;
  /** Part of a merged roof (union of maximal rectangles): the visible roof is the upper envelope. */
  merged?: boolean;
  /** Gable / fire-wall ends at x0 / x1 instead of hips (party walls). */
  ends?: { x0: boolean; x1: boolean };
}

export interface RoofSpec {
  form: RoofForm;
  eaveY: number;
  corniceHeight: number;
  corniceProjection: number;
  ridgeY: number;
  parts: RoofPartSpec[];
}

export interface DormerSpec {
  id: string;
  side: 'front' | 'back';
  x: number;
  /** Front face plane (z, building-local). */
  zFace: number;
  baseY: number;
  width: number;
  windowHeight: number;
  /** Depth of the dormer body back into the roof. */
  depth: number;
  shape: 'gable' | 'arched' | 'oculus';
}

export interface ChimneySpec {
  x: number;
  z: number;
  width: number;
  depth: number;
  baseY: number;
  topY: number;
}

export interface MassSpec {
  id: string;
  role: 'main' | 'central-risalit' | 'wing-left' | 'wing-right' | 'court-left' | 'court-right' | 'court-rear';
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

/** Polygonal corner tower; its walls are ordinary facades (interior can use them). */
export interface TowerSpec {
  id: string;
  /** Outline (facade order) of the outer wall face. */
  outline: Vec2[];
  center: Vec2;
  /** Apothem of the octagon (centre → face). */
  apothem: number;
  /** Number of sides: 4 square keep, 8 octagon, 16 round. */
  sides: number;
  role: 'corner' | 'gate';
  wallTop: number;
  /** Tower storeys above the main building: floor of stage k = stageBase + (k-1)·stageHeight. */
  stages: number;
  stageBase: number;
  stageHeight: number;
  roof: 'cone' | 'bell' | 'pyramid';
  roofBaseY: number;
  roofHeight: number;
  facades: FacadeSpec[];
}

/** Oriel (bay window) projecting from a facade over one or more floors, carried on a corbel. */
export interface OrielSpec {
  id: string;
  /** Open outline from wall to wall (facade order). */
  outline: Vec2[];
  zWall: number;
  depth: number;
  /** Bottom and top of the oriel walls. */
  y0: number;
  y1: number;
  roof: 'hip' | 'flat';
  floors: number[];
  facades: FacadeSpec[];
}

/**
 * A courtyard wing: a separate building block with its own staircase and entrance
 * from the courtyard. Block-local frame: x along the wing, z from the courtyard
 * wall (z small) to the outer wall (z large); world = origin + x·U + z·V with
 * U = (cos θ, −sin θ), V = (sin θ, cos θ).
 */
export interface WingBlockSpec {
  id: string;
  role: 'court-left' | 'court-right' | 'court-rear';
  /** Outer rectangle (building-local). */
  rect: { x0: number; x1: number; z0: number; z1: number };
  origin: Vec2;
  rotation: number;
  /** Bay centres along the wing, block-local x, ascending. */
  bays: { count: number; width: number; centers: number[] };
  stairBay: number;
  /** Which sides of the outer rect are internal junction walls (no inset needed). */
  junctions: ('x0' | 'x1' | 'z0' | 'z1')[];
}

export type EntranceComposition = 'frontispiece' | 'risalit' | 'giant-portico' | 'ground-portico' | 'gate-tower';

/**
 * The semantic result of the house layer. Coordinates are building-local:
 * origin at the envelope centre on the terrain, +Z towards the street (front),
 * +X to the right when looking at the front facade. `placement` maps local → world.
 *
 * This is the contract for the lower layers (interior planning reads floors,
 * walls, openings, stairCore) and for any renderer.
 */
export interface HouseSpec {
  schema: 'citygen.house/1';
  input: Required<Omit<HouseInput, 'floors' | 'partyWalls' | 'wear'>> & { floors: number | null; partyWalls: { left: boolean; right: boolean }; wear: number | null };
  genome: ManorGenome;
  placement: { x: number; z: number; rotationY: number };
  envelope: { width: number; depth: number };
  palette: Record<string, string>;
  /** Wear: 0 freshly built … 1 old and grimy (drives stains, dirt, lichen). */
  /** strength: spot (patch) prominence of the style — lower = larger, softer patches. */
  weathering: { condition: number; strength: number };
  wallThickness: number;
  plinthHeight: number;
  floors: FloorSpec[];
  bays: { count: number; width: number; centers: number[] };
  composition: {
    entrance: EntranceComposition;
    centralBays: number;
    wingBays: number;
    /** How the main door is framed: by the portico, by balcony consoles, or by its own pilasters + pediment. */
    doorSurround: 'portico' | 'consoles' | 'pediment' | 'canopy' | 'corbel' | 'stepped' | 'slab' | 'lantern';
  };
  masses: MassSpec[];
  /** Outer wall face polygon in facade order (counter-clockwise seen from below). */
  footprint: Vec2[];
  /** Inner courtyard ring (closed courtyard plans), facade order with normals into the court. */
  courtyard: Vec2[] | null;
  /** 'block' = single body; 'u' = side wings around an open court; 'o' = closed courtyard. */
  plan: 'block' | 'u' | 'o';
  wings: WingBlockSpec[];
  facades: FacadeSpec[];
  pediments: PedimentSpec[];
  portico: PorticoSpec | null;
  stairs: StairSpec[];
  balconies: BalconySpec[];
  roof: RoofSpec;
  dormers: DormerSpec[];
  chimneys: ChimneySpec[];
  /** Space reserved for the main staircase, for the interior layer. */
  stairCore: { x0: number; x1: number; z0: number; z1: number; fromFloor: number; toFloor: number } | null;
  pilasters: { facadeId: string; u: number; width: number; y0: number; y1: number; style: 'classical' | 'lesene' | 'strip' }[];
  /** Small facade ornaments (round porthole windows). Facade frame: u along the wall, y height. */
  ornaments: { kind: 'porthole'; facadeId: string; u: number; y: number; radius: number }[];
  towers: TowerSpec[];
  oriels: OrielSpec[];
  /** Balustrade on the cornice: offset base line segments (building-local, y = baseY). */
  parapet: { baseY: number; segments: [Vec2, Vec2][] } | null;
  /** Iron cresting along mansard curbs. */
  cresting: boolean;
  quoins: boolean;
  rusticatedGround: boolean;
  /** Human-readable summary of what was generated. */
  features: string[];
}
