/**
 * Recruitment → Search: the filter state, its translation into a worker query,
 * the need → search mapping behind "See more" on the needs board, the chips
 * that name what is applied, and saved searches.
 *
 * Pure (storage is passed in), so the mapping and the filter logic are tested
 * without a DOM.
 */
import type { NeedCriteriaView, OffseasonNeedView, PlayerSearchQuery } from '../../engine/career/views'
import type { NeedsContext } from '../../engine/career/offseasonNeeds'
import { PROFILE_ATTRIBUTE_GROUPS, profileAttributeLabel } from '../../engine/career/profileAttributes'

export type ContractKey = 'signed' | 'expiring' | 'freeAgent' | 'unsigned'
export type SortKey = NonNullable<PlayerSearchQuery['sort']>

export interface AttrRule {
  key: string
  op: 'gte' | 'lte'
  /** Kept as typed, so a half-typed value does not jump. */
  value: string
}

/** Everything the search bar holds. Number fields stay strings (as typed). */
export interface SearchFilters {
  text: string
  positions: string[]
  contracts: ContractKey[]
  ageMin: string
  ageMax: string
  /** $M. */
  maxSalary: string
  minPot: string
  minCur: string
  nation: string
  league: string
  hand: string
  scoutedOnly: boolean
  watchedOnly: boolean
  draftOnly: boolean
  excludeOwn: boolean
  gpMin: string
  gpMax: string
  ptsMin: string
  ptsMax: string
  archetypes: string[]
  yearsLeftMax: string
  tradeAvailable: boolean
  health: '' | 'injured' | 'healthy'
  waiverExempt: boolean
  expiry: '' | 'RFA' | 'UFA'
  heightMin: string
  heightMax: string
  weightMin: string
  weightMax: string
  fillsNeed: boolean
  attrs: AttrRule[]
  sort: SortKey
  desc: boolean
}

export const DEFAULT_FILTERS: SearchFilters = {
  text: '', positions: [], contracts: [], ageMin: '', ageMax: '', maxSalary: '',
  minPot: '', minCur: '', nation: '', league: '', hand: '',
  scoutedOnly: false, watchedOnly: false, draftOnly: false, excludeOwn: true,
  gpMin: '', gpMax: '', ptsMin: '', ptsMax: '', archetypes: [], yearsLeftMax: '',
  tradeAvailable: false, health: '', waiverExempt: false, expiry: '',
  heightMin: '', heightMax: '', weightMin: '', weightMax: '', fillsNeed: false,
  attrs: [], sort: 'potential', desc: true,
}

/** A typed number, or undefined for blank / junk. */
export function num(v: string): number | undefined {
  if (v.trim() === '') return undefined
  const n = Number(v.replace(/[^0-9.]/g, ''))
  return Number.isNaN(n) || v.replace(/[^0-9.]/g, '') === '' ? undefined : n
}

/** Attributes the builder offers: the profile's own, in its groups. */
export const ATTRIBUTE_GROUPS: Array<{ group: string; options: Array<[key: string, label: string]> }> =
  PROFILE_ATTRIBUTE_GROUPS.map((g) => ({ group: g.name, options: g.attributes.map(([k, l]) => [k, l] as [string, string]) }))

/** The profile's name for an attribute. */
export function attrLabel(key: string): string {
  return profileAttributeLabel(key)
}

/** Short column header for an attribute: the initials of a two-word name
 *  ("WS"), a short one-word name whole ("Checking"), a long one cut ("Antic."). */
export function attrAbbr(key: string): string {
  const label = attrLabel(key)
  const g = / \(G\)$/.test(label)
  const base = label.replace(/ \(G\)$/, '')
  const words = base.split(/\s+/)
  const abbr = words.length > 1 ? words.map((w) => w[0]!.toUpperCase()).join('') : base.length <= 9 ? base : `${base.slice(0, 5)}.`
  return g ? `${abbr} G` : abbr
}

/** Attribute rules that are complete enough to send. */
export function liveAttrRules(f: SearchFilters): Array<{ key: string; op: 'gte' | 'lte'; value: number }> {
  return f.attrs.flatMap((r) => {
    const v = num(r.value)
    return r.key && v !== undefined ? [{ key: r.key, op: r.op, value: Math.max(1, Math.min(20, v)) }] : []
  })
}

/** Positions a need's group searches on, as the bar's chips name them. */
function needPositions(c: NeedCriteriaView): string[] {
  if (c.position) return [c.position]
  return [c.group]
}

/**
 * The filters as a worker query (paging added by the caller). `needs` feeds
 * the "Fills a need" toggle: a player passes when he answers any of them.
 */
export function filtersToQuery(f: SearchFilters, needs: readonly NeedCriteriaView[] = []): PlayerSearchQuery {
  const n = num
  const q: PlayerSearchQuery = { sort: f.sort, desc: f.desc }
  const text = f.text.trim()
  if (text) q.text = text
  if (f.positions.length) q.positions = f.positions
  if (f.contracts.length) q.contracts = f.contracts
  if (n(f.ageMin) !== undefined) q.ageMin = n(f.ageMin)!
  if (n(f.ageMax) !== undefined) q.ageMax = n(f.ageMax)!
  if (n(f.maxSalary) !== undefined) q.maxSalary = Math.round(n(f.maxSalary)! * 1_000_000)
  if (n(f.minPot) !== undefined) q.minPotentialStars = n(f.minPot)!
  if (n(f.minCur) !== undefined) q.minCurrentStars = n(f.minCur)!
  if (f.nation) q.nations = [f.nation]
  if (f.league) q.leagueIds = [f.league]
  if (f.hand) q.handedness = f.hand
  if (f.scoutedOnly) q.scoutedOnly = true
  if (f.watchedOnly) q.watchedOnly = true
  if (f.draftOnly) q.draftEligibleOnly = true
  if (f.excludeOwn) q.excludeOwn = true
  if (n(f.gpMin) !== undefined) q.gpMin = n(f.gpMin)!
  if (n(f.gpMax) !== undefined) q.gpMax = n(f.gpMax)!
  if (n(f.ptsMin) !== undefined) q.pointsMin = n(f.ptsMin)!
  if (n(f.ptsMax) !== undefined) q.pointsMax = n(f.ptsMax)!
  if (f.archetypes.length) q.archetypes = f.archetypes
  if (n(f.yearsLeftMax) !== undefined) q.yearsLeftMax = n(f.yearsLeftMax)!
  if (f.tradeAvailable) q.tradeAvailable = true
  if (f.health) q.health = f.health
  if (f.waiverExempt) q.waiverExemptOnly = true
  if (f.expiry) q.expiryStatus = f.expiry
  if (n(f.heightMin) !== undefined) q.heightMin = n(f.heightMin)!
  if (n(f.heightMax) !== undefined) q.heightMax = n(f.heightMax)!
  if (n(f.weightMin) !== undefined) q.weightMin = n(f.weightMin)!
  if (n(f.weightMax) !== undefined) q.weightMax = n(f.weightMax)!
  const attrs = liveAttrRules(f)
  if (attrs.length) q.attributes = attrs
  if (f.fillsNeed && needs.length > 0) {
    q.anyOf = needs.map((c) => ({
      positions: needPositions(c),
      ...(c.hand ? { handedness: c.hand } : {}),
      minCurrentStars: c.minStars,
    }))
  }
  return q
}

/** Ages that make sense for the role: a top slot wants a man in his prime, a
 *  depth or backup slot can take a veteran. Keyed by the need's role id. */
export function ageRangeFor(needId: string): { min: number; max: number } {
  if (needId === 'F-top' || needId === 'D-1' || needId === 'G-1') return { min: 21, max: 33 }
  if (needId === 'F-bot' || needId === 'D-3' || needId === 'G-2') return { min: 20, max: 36 }
  return { min: 20, max: 34 }
}

/** Where the search was opened from: the label for the banner. */
export interface SearchOrigin {
  needId: string
  label: string
  context: NeedsContext
}

/** A search pre-filled from somewhere else, carried in the route params. */
export interface SearchPreset {
  filters: SearchFilters
  origin?: SearchOrigin
  /** Distinguishes one click from the next, so back-navigation does not
   *  re-apply a preset over the user's edits. */
  nonce: number
}

/**
 * The need → search mapping behind "See more". Position and shot from the
 * need, the overall bar it names, cap hit within the room, the availability
 * the desk deals in, and a sensible age band. Cap needs have no search.
 */
export function needToFilters(need: OffseasonNeedView, context: NeedsContext, capRoom: number): SearchFilters | null {
  const c = need.criteria
  if (need.kind !== 'slot' || !c) return null
  const ages = ageRangeFor(need.id)
  const contracts: ContractKey[] = context === 'fa'
    ? ['freeAgent']
    : context === 'trade' ? ['signed', 'expiring'] : ['freeAgent', 'signed', 'expiring']
  return {
    ...DEFAULT_FILTERS,
    positions: needPositions(c),
    hand: c.hand ?? '',
    // The tier in the stars the search shows, never the hidden number.
    minCur: String(c.minStars),
    // $0.1M steps, rounded down so the bound never lets in a man over the room.
    maxSalary: capRoom > 0 ? (Math.floor(capRoom / 100_000) / 10).toFixed(1) : '',
    contracts,
    excludeOwn: true,
    ageMin: String(ages.min),
    ageMax: String(ages.max),
    sort: 'current',
    desc: true,
  }
}

export function presetForNeed(need: OffseasonNeedView, context: NeedsContext, capRoom: number, nonce: number): SearchPreset | null {
  const filters = needToFilters(need, context, capRoom)
  if (!filters) return null
  return { filters, origin: { needId: need.id, label: need.label, context }, nonce }
}

const CONTRACT_LABEL: Record<ContractKey, string> = {
  signed: 'Under contract', expiring: 'Expiring', freeAgent: 'Free agent', unsigned: 'Unsigned junior',
}

/** One applied filter, as a removable chip. */
export interface FilterChip {
  id: string
  label: string
  clear: (f: SearchFilters) => SearchFilters
}

/** Every filter that differs from the default, as a chip that removes it. */
export function filterChips(f: SearchFilters, archetypeLabel: (key: string) => string = (k) => k): FilterChip[] {
  const out: FilterChip[] = []
  const add = (id: string, label: string, clear: Partial<SearchFilters>): void => {
    out.push({ id, label, clear: (x) => ({ ...x, ...clear }) })
  }
  const range = (lo: string, hi: string, unit: string): string =>
    lo && hi ? `${unit} ${lo}–${hi}` : lo ? `${unit} ${lo}+` : `${unit} ≤ ${hi}`
  if (f.text.trim()) add('text', `Name: ${f.text.trim()}`, { text: '' })
  if (f.positions.length) add('pos', f.positions.join('/'), { positions: [] })
  if (f.hand) add('hand', `Shoots ${f.hand}`, { hand: '' })
  if (f.maxSalary) add('cap', `Cap hit ≤ $${f.maxSalary}M`, { maxSalary: '' })
  for (const c of f.contracts) out.push({ id: `c-${c}`, label: CONTRACT_LABEL[c], clear: (x) => ({ ...x, contracts: x.contracts.filter((k) => k !== c) }) })
  if (f.ageMin || f.ageMax) add('age', range(f.ageMin, f.ageMax, 'Age'), { ageMin: '', ageMax: '' })
  if (f.nation) add('nation', f.nation, { nation: '' })
  if (f.league) add('league', `League: ${f.league.toUpperCase()}`, { league: '' })
  if (f.minCur) add('cur', `Current ${f.minCur}★+`, { minCur: '' })
  if (f.minPot) add('pot', `Potential ${f.minPot}★+`, { minPot: '' })
  if (f.scoutedOnly) add('scouted', 'Scouted only', { scoutedOnly: false })
  if (f.watchedOnly) add('watched', 'On my watch list', { watchedOnly: false })
  if (f.draftOnly) add('draft', 'Draft eligible', { draftOnly: false })
  if (f.gpMin || f.gpMax) add('gp', range(f.gpMin, f.gpMax, 'GP'), { gpMin: '', gpMax: '' })
  if (f.ptsMin || f.ptsMax) add('pts', range(f.ptsMin, f.ptsMax, 'Pts'), { ptsMin: '', ptsMax: '' })
  for (const a of f.archetypes) out.push({ id: `arch-${a}`, label: archetypeLabel(a), clear: (x) => ({ ...x, archetypes: x.archetypes.filter((k) => k !== a) }) })
  if (f.yearsLeftMax) add('yrs', `≤ ${f.yearsLeftMax} yr left`, { yearsLeftMax: '' })
  if (f.tradeAvailable) add('avail', 'Trade available', { tradeAvailable: false })
  if (f.health) add('health', f.health === 'injured' ? 'Injured' : 'Healthy', { health: '' })
  if (f.waiverExempt) add('waiver', 'Waiver exempt', { waiverExempt: false })
  if (f.expiry) add('expiry', `${f.expiry} at expiry`, { expiry: '' })
  if (f.heightMin || f.heightMax) add('ht', range(f.heightMin, f.heightMax, 'Height cm'), { heightMin: '', heightMax: '' })
  if (f.weightMin || f.weightMax) add('wt', range(f.weightMin, f.weightMax, 'Weight kg'), { weightMin: '', weightMax: '' })
  if (f.fillsNeed) add('need', 'Fills a need', { fillsNeed: false })
  f.attrs.forEach((r, i) => {
    if (!r.key || num(r.value) === undefined) return
    out.push({ id: `attr-${i}`, label: `${attrLabel(r.key)} ${r.op === 'gte' ? '≥' : '≤'} ${r.value}`, clear: (x) => ({ ...x, attrs: x.attrs.filter((_, j) => j !== i) }) })
  })
  return out
}

/** How many "More filters" controls are set, for the expander's badge. */
export function moreFilterCount(f: SearchFilters): number {
  return [
    f.gpMin || f.gpMax, f.ptsMin || f.ptsMax, f.archetypes.length > 0, f.yearsLeftMax, f.tradeAvailable,
    f.health, f.waiverExempt, f.expiry, f.heightMin || f.heightMax, f.weightMin || f.weightMax, f.fillsNeed,
    liveAttrRules(f).length > 0,
  ].filter(Boolean).length
}

/* ── saved searches (per save, in localStorage) ── */

export interface SavedSearch {
  name: string
  filters: SearchFilters
}

/** Minimal storage surface (localStorage, or a stub in tests). */
export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function savedSearchKey(careerKey: string): string {
  return `hockey.savedSearches.${careerKey}`
}

export function loadSavedSearches(store: KeyValueStore | undefined, careerKey: string): SavedSearch[] {
  if (!store) return []
  try {
    const raw = store.getItem(savedSearchKey(careerKey))
    if (!raw) return []
    const list = JSON.parse(raw) as unknown
    if (!Array.isArray(list)) return []
    // Older saves may lack newer fields: fill them from the defaults.
    return list
      .filter((s): s is SavedSearch => !!s && typeof (s as SavedSearch).name === 'string' && typeof (s as SavedSearch).filters === 'object')
      .map((s) => ({ name: s.name, filters: { ...DEFAULT_FILTERS, ...s.filters } }))
  } catch {
    return []
  }
}

/** Save (or replace, by name) one search; returns the new list. */
export function storeSavedSearch(store: KeyValueStore | undefined, careerKey: string, list: SavedSearch[], entry: SavedSearch): SavedSearch[] {
  const next = [...list.filter((s) => s.name !== entry.name), entry].sort((a, b) => a.name.localeCompare(b.name))
  try { store?.setItem(savedSearchKey(careerKey), JSON.stringify(next)) } catch { /* storage full or blocked */ }
  return next
}

export function deleteSavedSearch(store: KeyValueStore | undefined, careerKey: string, list: SavedSearch[], name: string): SavedSearch[] {
  const next = list.filter((s) => s.name !== name)
  try { store?.setItem(savedSearchKey(careerKey), JSON.stringify(next)) } catch { /* ignore */ }
  return next
}
