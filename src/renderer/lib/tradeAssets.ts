/**
 * The trade builder's club-asset browser: filter, sort and group one club's
 * players so a whole organisation reads as a few short, collapsible groups
 * instead of two scrolling lists. Pure: the screen owns the state.
 */
import type { TradePartnerView } from '../../engine/career/views'
import { overallToStars } from '../../engine/ratings/composites'

export type AssetRow = TradePartnerView['players'][number]

export type AssetSort = 'value' | 'rating' | 'age' | 'cap' | 'years'
export type AssetPos = 'all' | 'F' | 'D' | 'G'

export interface AssetFilters {
  search: string
  pos: AssetPos
  /** Hide no-trade clauses. */
  tradeableOnly: boolean
  /** Floor in the stars the rows show (our read). */
  minRating: string
  /** $M. */
  maxCap: string
  prospectsOnly: boolean
  expiring: boolean
  sort: AssetSort
  desc: boolean
}

export const DEFAULT_ASSET_FILTERS: AssetFilters = {
  search: '', pos: 'all', tradeableOnly: false, minRating: '', maxCap: '',
  prospectsOnly: false, expiring: false, sort: 'value', desc: true,
}

export function posGroupOf(position: string): 'F' | 'D' | 'G' {
  return position === 'G' ? 'G' : position === 'D' || position === 'LD' || position === 'RD' ? 'D' : 'F'
}

/** A futures piece: a rights-held junior, a young AHLer, or any man 21 or under. */
export function isProspect(r: AssetRow): boolean {
  const cls = r.assetClass ?? 'nhl'
  return cls === 'junior' || (cls === 'ahl' && r.age <= 23) || r.age <= 21
}

/** Signed, with this season the last (or one more to run). */
export function isExpiring(r: AssetRow): boolean {
  return r.salary > 0 && r.yearsRemaining <= 1
}

function numOf(v: string): number | undefined {
  const t = v.replace(/[^0-9.]/g, '')
  if (t === '') return undefined
  const n = Number(t)
  return Number.isNaN(n) ? undefined : n
}

/** Rows that pass the filters. Rows in `keep` (already on the table) always
 *  pass, so a filter can never hide something you have to untick. */
export function filterAssets(rows: readonly AssetRow[], f: AssetFilters, keep: ReadonlySet<string> = new Set()): AssetRow[] {
  const text = f.search.trim().toLowerCase()
  const minR = numOf(f.minRating)
  const maxC = numOf(f.maxCap)
  return rows.filter((r) => {
    if (keep.has(r.playerId)) return true
    if (text && !r.name.toLowerCase().includes(text)) return false
    if (f.pos !== 'all' && posGroupOf(r.position) !== f.pos) return false
    if (f.tradeableOnly && r.noTradeClause) return false
    if (minR !== undefined && overallToStars(r.overall) < minR) return false
    if (maxC !== undefined && r.salary > maxC * 1_000_000) return false
    if (f.prospectsOnly && !isProspect(r)) return false
    if (f.expiring && !isExpiring(r)) return false
    return true
  })
}

const SORT_KEY: Record<AssetSort, (r: AssetRow) => number> = {
  value: (r) => r.tradeValue ?? -1,
  rating: (r) => r.overall,
  age: (r) => r.age,
  cap: (r) => r.salary,
  years: (r) => r.yearsRemaining,
}

export function sortAssets(rows: readonly AssetRow[], sort: AssetSort, desc: boolean): AssetRow[] {
  const key = SORT_KEY[sort]
  const dir = desc ? -1 : 1
  return [...rows].sort((a, b) => dir * (key(a) - key(b)) || a.name.localeCompare(b.name))
}

export interface AssetGroup {
  id: 'F' | 'D' | 'G' | 'ahl' | 'junior'
  label: string
  rows: AssetRow[]
  /** Starts collapsed (the farm and the rights list). */
  collapsedByDefault: boolean
}

/** The big club by position, then the farm, then unsigned rights. Empty
 *  groups are dropped. Rows keep the order they arrive in. */
export function groupAssets(rows: readonly AssetRow[]): AssetGroup[] {
  const groups: AssetGroup[] = [
    { id: 'F', label: 'Forwards', rows: [], collapsedByDefault: false },
    { id: 'D', label: 'Defense', rows: [], collapsedByDefault: false },
    { id: 'G', label: 'Goalies', rows: [], collapsedByDefault: false },
    { id: 'ahl', label: 'AHL', rows: [], collapsedByDefault: true },
    { id: 'junior', label: 'Unsigned rights', rows: [], collapsedByDefault: true },
  ]
  const byId = new Map(groups.map((g) => [g.id, g]))
  for (const r of rows) {
    const cls = r.assetClass ?? 'nhl'
    byId.get(cls === 'nhl' ? posGroupOf(r.position) : cls)!.rows.push(r)
  }
  return groups.filter((g) => g.rows.length > 0)
}

/** The whole pipeline: filter, sort, group. */
export function browseAssets(rows: readonly AssetRow[], f: AssetFilters, keep: ReadonlySet<string> = new Set()): AssetGroup[] {
  return groupAssets(sortAssets(filterAssets(rows, f, keep), f.sort, f.desc))
}

/** How many filters (beyond sort) are set, for the toggle's badge. */
export function activeAssetFilterCount(f: AssetFilters): number {
  return [f.search.trim(), f.pos !== 'all', f.tradeableOnly, f.minRating.trim(), f.maxCap.trim(), f.prospectsOnly, f.expiring].filter(Boolean).length
}
