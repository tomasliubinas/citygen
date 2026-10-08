export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const deg = (d: number) => (d * Math.PI) / 180;

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: Vec3): Vec3 => {
  const l = length(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/**
 * Affine transform: three basis columns + translation.
 * Layout: [xx, xy, xz, yx, yy, yz, zx, zy, zz, tx, ty, tz].
 * Only rigid transforms (rotation, mirror, translation) are expected.
 */
export type Mat = readonly number[];

export const IDENTITY: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

export function frame(xAxis: Vec3, yAxis: Vec3, zAxis: Vec3, origin: Vec3): Mat {
  return [...xAxis, ...yAxis, ...zAxis, ...origin];
}

export const translation = (x: number, y: number, z: number): Mat => [1, 0, 0, 0, 1, 0, 0, 0, 1, x, y, z];

export function rotationY(a: number): Mat {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, 0, -s, 0, 1, 0, s, 0, c, 0, 0, 0];
}

export function rotationZ(a: number): Mat {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [c, s, 0, -s, c, 0, 0, 0, 1, 0, 0, 0];
}

export function applyDir(m: Mat, d: Vec3): Vec3 {
  return [
    m[0] * d[0] + m[3] * d[1] + m[6] * d[2],
    m[1] * d[0] + m[4] * d[1] + m[7] * d[2],
    m[2] * d[0] + m[5] * d[1] + m[8] * d[2],
  ];
}

export function apply(m: Mat, p: Vec3): Vec3 {
  const d = applyDir(m, p);
  return [d[0] + m[9], d[1] + m[10], d[2] + m[11]];
}

/** a ∘ b — apply b first, then a. */
export function mul(a: Mat, b: Mat): Mat {
  return [
    ...applyDir(a, [b[0], b[1], b[2]]),
    ...applyDir(a, [b[3], b[4], b[5]]),
    ...applyDir(a, [b[6], b[7], b[8]]),
    ...apply(a, [b[9], b[10], b[11]]),
  ];
}

export function determinant(m: Mat): number {
  return dot([m[0], m[1], m[2]], cross([m[3], m[4], m[5]], [m[6], m[7], m[8]]));
}

export function rotationX(a: number): Mat {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [1, 0, 0, 0, c, s, 0, -s, c, 0, 0, 0];
}
