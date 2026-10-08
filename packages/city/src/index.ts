/**
 * @citygen/city — the street layer (above the house layer).
 *
 *   CityInput (seed, size, pattern …)
 *     → generateCity() → CitySpec: streets, blocks, plots — each plot carries a HouseInput
 *
 * Plots are rotated rectangles; the house is generated in plot-local space
 * (front = south = street) and placed with plot.center / plot.rotation.
 */
export { generateCity } from './generate';
export type * from './types';
