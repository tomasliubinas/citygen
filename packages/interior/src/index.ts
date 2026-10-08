/**
 * @citygen/interior — the interior layer of the city generator.
 *
 *   HouseSpec (from @citygen/house)
 *     → planInterior()        → InteriorSpec (levels, rooms, partitions, doors, stairs, flats)
 *     → buildInteriorMesh()   → one renderer-agnostic mesh per level
 *
 * The next layer down (furniture / items) reads rooms, doors and windows from InteriorSpec.
 */
export { planInterior } from './plan';
export { buildInteriorMesh } from './mesh';
export type * from './types';
