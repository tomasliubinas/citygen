import type { Vec2 } from '@citygen/core';
import type { HouseInput } from '@citygen/house';

/**
 * Contract of the street layer. World coordinates in metres: +X east,
 * +Z south, origin at the middle of the city square.
 */

export type CityPattern = 'grid' | 'radial' | 'organic';

export interface CityInput {
  seed: string;
  /** Side of the city square (m). */
  size: number;
  pattern: CityPattern;
  /** Scales target block size (0.6 = tight blocks … 1.6 = large blocks). */
  blockScale?: number;
  /** How quickly the city thins out from the centre (0.5 = gentle … 2 = sharp core). */
  falloff?: number;
  /** Centre offset as a fraction of the size (−0.3 … 0.3); null = seeded. */
  centre?: Vec2 | null;
  /** Relative weight per house style id; missing = all styles at weight 1. */
  styles?: Record<string, number>;
}

export type StreetKind = 'ring' | 'avenue' | 'street' | 'lane';

export interface StreetSpec {
  id: number;
  kind: StreetKind;
  /** Full width incl. sidewalks. */
  width: number;
  a: Vec2;
  b: Vec2;
}

export interface BlockSpec {
  id: string;
  /** Curb line (convex, CCW). */
  outline: Vec2[];
  /** Buildable area behind the sidewalk (convex, CCW). */
  lot: Vec2[];
  centrality: number;
  kind: 'built' | 'park' | 'plaza';
  plots: number[];
}

export interface PlotSpec {
  id: string;
  index: number;
  blockId: string;
  /** Plot centre in world space. */
  center: Vec2;
  /** Rotation about +Y mapping plot-local → world (three.js convention: local +Z → (sin θ, cos θ)). */
  rotation: number;
  /** Frontage (plot-local X) and depth (plot-local Z), even metres. */
  width: number;
  depth: number;
  /** World corners, CCW; corners[0..1] is the street front. */
  corners: Vec2[];
  centrality: number;
  style: string;
  seed: string;
  /** Street the plot fronts. */
  streetId: number;
  /** Ready-made input for @citygen/house, in plot-local space (front = south = street). */
  house: HouseInput;
}

export interface CitySpec {
  schema: 'citygen.city/1';
  input: Required<Omit<CityInput, 'centre' | 'styles'>> & { centre: Vec2; styles: Record<string, number> };
  size: number;
  centre: Vec2;
  /** Distance at which centrality reaches 0. */
  radius: number;
  streets: StreetSpec[];
  blocks: BlockSpec[];
  plots: PlotSpec[];
}
