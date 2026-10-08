import type { Vec2 } from '@citygen/core';

/**
 * Contract of the interior layer. Coordinates are the house's building-local
 * frame (front = +Z); apply `placement` to get world coordinates.
 */

export interface InteriorOptions {
  /** 'auto' splits large urban houses into flats; 'single' = one household; 'split' = force flats. */
  apartments?: 'auto' | 'single' | 'split';
}

export type LevelKind = 'cellar' | 'floor' | 'attic' | 'tower';

export interface LevelSpec {
  index: number;
  kind: LevelKind;
  /** House floor index for 'floor' levels, null otherwise. */
  floor: number | null;
  name: string;
  short: string;
  /** Finished floor level. */
  elevation: number;
  /** Clear storey height (to the next level). */
  height: number;
  /** Height partitions are drawn to in the cut-away view. */
  wallHeight: number;
  /** Outer wall rings (facade order, outer face) — drawn as the cut section. */
  outlines: { points: Vec2[]; closed: boolean; thickness: number }[];
  /** Openings in the outer walls on this level. */
  windows: { x: number; z: number; width: number; normal: Vec2; kind: 'window' | 'door' }[];
}

export type RoomKind =
  | 'entrance-hall' | 'hall' | 'corridor' | 'landing' | 'stair'
  | 'salon' | 'dining' | 'library' | 'study' | 'music' | 'living'
  | 'bedroom' | 'nursery' | 'dressing' | 'guest'
  | 'kitchen' | 'pantry' | 'bathroom' | 'wc' | 'servant' | 'cloakroom' | 'porter'
  | 'storage' | 'boiler' | 'laundry' | 'wine' | 'workshop'
  | 'studio' | 'maid' | 'loft' | 'tower';

export interface RoomSpec {
  id: string;
  level: number;
  kind: RoomKind;
  name: string;
  /** Apartment id, or null for common / single-household space. */
  unit: string | null;
  /** Convex floor polygons (x, z). */
  parts: Vec2[][];
  /** Render-only floor override (stair halls leave the well open). */
  floorParts?: Vec2[][];
  area: number;
  /** Label anchor. */
  center: Vec2;
  /** Ids of rooms reachable through a door or opening. */
  connects: string[];
}

export interface WallOpening {
  id: string;
  /** Centre along the wall from `a`. */
  u: number;
  width: number;
  height: number;
  kind: 'door' | 'double-door' | 'apartment-door' | 'opening';
  rooms: [string, string];
}

export interface WallSpec {
  id: string;
  level: number;
  a: Vec2;
  b: Vec2;
  thickness: number;
  /** Overrides the level's wall height (attic knee walls). */
  height?: number;
  openings: WallOpening[];
}

/** One dog-leg staircase between two consecutive levels. */
export interface StairRunSpec {
  fromLevel: number;
  toLevel: number;
  /** Stair hall extents: z0 = back wall, flights start/end at z1. */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  yFrom: number;
  yTo: number;
  risers: number;
  tread: number;
  landingDepth: number;
  material: 'wood' | 'stone';
  /** Block frame: stair coordinates are local to it (main block: identity). */
  transform: { x: number; z: number; rotationY: number };
}

export interface UnitSpec {
  id: string;
  name: string;
  level: number;
  rooms: string[];
  area: number;
}

export interface InteriorSpec {
  schema: 'citygen.interior/1';
  houseSeed: string;
  placement: { x: number; z: number; rotationY: number };
  apartments: boolean;
  levels: LevelSpec[];
  rooms: RoomSpec[];
  walls: WallSpec[];
  stairs: StairRunSpec[];
  /** Spiral stairs inside towers (drawn on `level`, climbing yFrom → yTo). */
  spirals: { level: number; cx: number; cz: number; radius: number; yFrom: number; yTo: number }[];
  units: UnitSpec[];
  /** Rooms with a door to the outside (main entrance hall, wing stair halls). */
  entrances: string[];
  palette: Record<string, string>;
}
