/**
 * Seeded, deterministic PRNG.
 *
 * Determinism is a hard requirement (docs/ARCHITECTURE.md §7): the calibration
 * harness sims N seasons and compares output distributions, so the same seed
 * must always produce the same games. Math.random is therefore banned engine-
 * wide — every stochastic decision flows through an Rng instance.
 *
 * Algorithm is mulberry32: tiny, fast, good enough statistical quality for a
 * game sim, and trivially reproducible across machines.
 */
export class Rng {
  private state: number

  constructor(seed: number) {
    // Force into uint32 so a float or negative seed still behaves.
    this.state = seed >>> 0
  }

  /** Next float in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive)
  }

  /** Integer in [min, max] inclusive. */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1)
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** True with probability p (clamped to [0, 1]). */
  chance(p: number): boolean {
    return this.next() < p
  }

  /** Uniform pick from a non-empty array. */
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)]
  }

  /** Standard-normal sample (Box–Muller), mean 0, stddev 1. */
  gaussian(): number {
    // Avoid log(0) by excluding exactly 0 from the first uniform.
    let u = 0
    while (u === 0) u = this.next()
    const v = this.next()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  /** Gaussian with given mean/stddev. */
  normal(mean: number, stddev: number): number {
    return mean + this.gaussian() * stddev
  }

  /** In-place Fisher–Yates shuffle, returns the same array. */
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1)
      ;[arr[i], arr[j]] = [arr[j], arr[i]]
    }
    return arr
  }
}

/** Mix a base seed with one or more sub-keys into a fresh uint32 seed. */
export function deriveSeed(base: number, ...keys: number[]): number {
  let h = base >>> 0
  for (const k of keys) {
    h = (Math.imul(h ^ (k >>> 0), 0x9e3779b1) + 0x85ebca77) >>> 0
  }
  return h >>> 0
}
