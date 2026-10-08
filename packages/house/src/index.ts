/**
 * @citygen/house — the house layer of the city generator.
 *
 *   HouseInput (from the lot/street layer)
 *     → generateHouse()   → HouseSpec   (semantic: floors, walls, openings, stair core …)
 *     → buildHouseMesh()  → MeshData    (renderer-agnostic triangle buffers)
 *
 * No DOM, no renderer, no I/O: runs in a browser, a worker, or a Node backend.
 */
import { layoutHouse } from './layout';
import type { HouseInput, HouseSpec } from './types';

export function generateHouse(input: HouseInput): HouseSpec {
  return layoutHouse(input);
}

export { buildHouseMesh, HOUSE_MATERIALS, type HouseMaterial } from './mesh';
export { createGenome, STYLES, CLASSICIST_MANOR, type ManorGenome, type StyleId, type StylePreset } from './genome';
export { deriveFloorCount, normalizeInput, roofHeightAt, MIN_ENVELOPE, MAX_ENVELOPE, MAX_FLOORS } from './layout';
export type * from './types';
