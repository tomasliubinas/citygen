/**
 * Deterministic, forkable pseudo-random generator.
 *
 * A fork is derived from a *key path* (e.g. "seed/manor/roof"), never from the
 * state already consumed by its parent. Adding a new random decision somewhere
 * therefore never shifts the outcome of existing decisions — the property that
 * keeps a house recognisable when it is resized or when the generator evolves.
 */

/** 32-bit string hash (cyrb53 folded to 32 bits). */
export function hash32(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

export type Weighted<T> = ReadonlyArray<readonly [T, number]>;

export class Rng {
  private state: number;

  private constructor(readonly key: string) {
    this.state = hash32(key);
  }

  static create(seed: string | number, ...path: string[]): Rng {
    return new Rng([String(seed), ...path].join('/'));
  }

  /** Independent stream for a named decision. */
  fork(name: string): Rng {
    return new Rng(`${this.key}/${name}`);
  }

  /** Uniform float in [0, 1) — mulberry32. */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  weighted<T>(entries: Weighted<T>): T {
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = this.next() * total;
    for (const [value, w] of entries) {
      r -= w;
      if (r < 0) return value;
    }
    return entries[entries.length - 1][0];
  }
}
