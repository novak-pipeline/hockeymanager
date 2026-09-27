/**
 * Additive fixed-bin histograms — the analyzer's distribution currency.
 *
 * A watched game yields ~150k skater-speed samples; keeping raw arrays across a
 * 40-game scorecard run would cost hundreds of MB. Fixed bins make every
 * per-game result ADDITIVE (aggregate = element-wise sum) and quantiles cheap.
 */

export interface Hist {
  lo: number
  hi: number
  /** Bin width. bins.length = ceil((hi - lo) / step). */
  step: number
  bins: number[]
  /** Samples below lo / at or above hi (still counted in n, sum). */
  under: number
  over: number
  n: number
  sum: number
  max: number
  min: number
}

export function newHist(lo: number, hi: number, step: number): Hist {
  const len = Math.max(1, Math.ceil((hi - lo) / step))
  return { lo, hi, step, bins: new Array<number>(len).fill(0), under: 0, over: 0, n: 0, sum: 0, max: -Infinity, min: Infinity }
}

export function addSample(h: Hist, v: number, w = 1): void {
  if (!Number.isFinite(v)) return
  h.n += w
  h.sum += v * w
  if (v > h.max) h.max = v
  if (v < h.min) h.min = v
  if (v < h.lo) {
    h.under += w
    return
  }
  const i = Math.floor((v - h.lo) / h.step)
  if (i >= h.bins.length) {
    h.over += w
    return
  }
  h.bins[i] += w
}

/** Element-wise sum; the two histograms must share a layout. */
export function mergeHist(into: Hist, from: Hist): void {
  if (into.bins.length !== from.bins.length || into.lo !== from.lo || into.step !== from.step) {
    throw new Error('mergeHist: layout mismatch')
  }
  for (let i = 0; i < from.bins.length; i++) into.bins[i] += from.bins[i]
  into.under += from.under
  into.over += from.over
  into.n += from.n
  into.sum += from.sum
  if (from.max > into.max) into.max = from.max
  if (from.min < into.min) into.min = from.min
}

export function cloneHist(h: Hist): Hist {
  return { ...h, bins: h.bins.slice() }
}

export function histMean(h: Hist): number {
  return h.n > 0 ? h.sum / h.n : NaN
}

/** Quantile q ∈ [0,1], linearly interpolated inside the bin. */
export function histQuantile(h: Hist, q: number): number {
  if (h.n <= 0) return NaN
  const target = q * h.n
  let acc = h.under
  if (target <= acc) return h.lo
  for (let i = 0; i < h.bins.length; i++) {
    const b = h.bins[i]
    if (acc + b >= target && b > 0) {
      const f = (target - acc) / b
      return h.lo + (i + f) * h.step
    }
    acc += b
  }
  return Number.isFinite(h.max) ? h.max : h.hi
}

/** Share of samples at or above v (bin-resolution). */
export function histShareAbove(h: Hist, v: number): number {
  if (h.n <= 0) return NaN
  let above = h.over
  const start = Math.ceil((v - h.lo) / h.step)
  for (let i = Math.max(0, start); i < h.bins.length; i++) above += h.bins[i]
  if (v < h.lo) above += h.under
  return above / h.n
}

/** A dense 2D count grid (rink heat maps). */
export interface Grid {
  /** Columns along the rink length, rows across. */
  cols: number
  rows: number
  cells: number[]
  n: number
}

export function newGrid(cols: number, rows: number): Grid {
  return { cols, rows, cells: new Array<number>(cols * rows).fill(0), n: 0 }
}

export function mergeGrid(into: Grid, from: Grid): void {
  if (into.cells.length !== from.cells.length) throw new Error('mergeGrid: layout mismatch')
  for (let i = 0; i < from.cells.length; i++) into.cells[i] += from.cells[i]
  into.n += from.n
}

/**
 * Total-variation distance between two count vectors after normalising each to
 * a distribution: 0 = identical shape, 1 = disjoint.
 */
export function tvd(a: readonly number[], b: readonly number[]): number {
  const sa = a.reduce((s, v) => s + v, 0)
  const sb = b.reduce((s, v) => s + v, 0)
  if (sa <= 0 || sb <= 0) return NaN
  let d = 0
  for (let i = 0; i < Math.max(a.length, b.length); i++) d += Math.abs((a[i] ?? 0) / sa - (b[i] ?? 0) / sb)
  return d / 2
}
