/**
 * The HEAT LEDGER — what two clubs, and two men, carry from one meeting into
 * the next (rivalry heat across games).
 *
 * After every game the career folds the night's heat incidents (story/
 * rivalryHeat.ts over shared/heat.ts) into this ledger:
 *  - per club pairing: how hot it ran, and the last meeting's fights and PIM;
 *  - per player pair: the strongest incident between them (a fight, a big hit,
 *    a cheap shot on a top scorer, something after the whistle), dated, and
 *    how many meetings both have dressed for since.
 * Before the next meeting the career reads it back: the carried heat feeds the
 * fight-frequency hook (shared/fights.ts, via heat.fightHeatInput) and the
 * live story ("Bad blood: third meeting since the hit on …").
 *
 * Heat fades with time (a quiet month cools a pairing) and with quiet
 * meetings. JSON-safe, bounded, pure: no rng, no sim impact beyond the fight
 * input the caller passes on.
 */
import type { HeatIncident, HeatKind } from '@engine/shared/heat'

export type CarriedKind = 'fight' | 'bigHit' | 'cheapShot' | 'afterWhistle'

export interface HeatIncidentRecord {
  kind: CarriedKind
  /** The aggressor and the man it was done to (a fight: the home man first). */
  byId: string
  onId: string
  year: number
  day: number
  /** ISO date. */
  date: string
  infraction?: string
  /** A hit that put him down. */
  down?: boolean
  /** A fight: who had the better of it (null = a draw / unknown). */
  winnerId?: string | null
}

export interface PairHeatRecord {
  /** Sorted pair key members. */
  a: string
  b: string
  heat: number
  year: number
  day: number
  last: HeatIncidentRecord
  /** Meetings both have dressed for since the incident (not counting the night of it). */
  meetingsSince: number
}

export interface TeamHeatRecord {
  a: string
  b: string
  heat: number
  year: number
  day: number
  last: { date: string; fights: number; pim: number }
}

export interface HeatLedgerState {
  pairs: PairHeatRecord[]
  teams: TeamHeatRecord[]
}

export const MAX_PAIRS = 160
export const MAX_TEAMS = 120
/** Club heat halves over this many days without a meeting. */
export const TEAM_HALF_LIFE_DAYS = 40
/** Player-pair heat halves over this many days. */
export const PAIR_HALF_LIFE_DAYS = 75
/** A calm meeting keeps this share of the club heat it started with. */
export const CALM_KEEP = 0.6
/** Below this the record is dropped. */
const FORGET = 0.04

/** Weight of one incident in tonight's carry-over (club pairing). */
const TEAM_W: Partial<Record<HeatKind, number>> = { fight: 0.4, cheapShot: 0.12, afterWhistle: 0.12, bigHit: 0.04, goalInFace: 0.02 }
/** Weight of an incident between two men (only these kinds are remembered). */
const PAIR_W: Record<CarriedKind, number> = { fight: 0.9, bigHit: 0.4, cheapShot: 0.45, afterWhistle: 0.4 }
const CARRIED_RANK: Record<CarriedKind, number> = { fight: 4, cheapShot: 3, afterWhistle: 2, bigHit: 1 }

export function createHeatLedger(): HeatLedgerState {
  return { pairs: [], teams: [] }
}

const key = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a])
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Days between two (season year, match day) points (a season ≈ 365 days). */
export function daysBetween(y0: number, d0: number, y1: number, d1: number): number {
  return Math.max(0, (y1 - y0) * 365 + (d1 - d0))
}

export function decayed(heat: number, y0: number, d0: number, y1: number, d1: number, halfLifeDays: number): number {
  return heat * Math.pow(0.5, daysBetween(y0, d0, y1, d1) / halfLifeDays)
}

/** The club pairing's carried heat now (0 when there is no history). */
export function teamHeatBetween(state: HeatLedgerState, t1: string, t2: string, year: number, day: number): { heat: number; rec: TeamHeatRecord | null } {
  const [a, b] = key(t1, t2)
  const rec = state.teams.find((r) => r.a === a && r.b === b) ?? null
  if (!rec) return { heat: 0, rec: null }
  return { heat: decayed(rec.heat, rec.year, rec.day, year, day, TEAM_HALF_LIFE_DAYS), rec }
}

/** Player pairs with history, one man dressed on each side tonight; heat decayed to now. */
export function pairsAcross(state: HeatLedgerState, homeIds: ReadonlySet<string>, awayIds: ReadonlySet<string>, year: number, day: number): Array<PairHeatRecord & { heatNow: number }> {
  const out: Array<PairHeatRecord & { heatNow: number }> = []
  for (const r of state.pairs) {
    const across = (homeIds.has(r.a) && awayIds.has(r.b)) || (homeIds.has(r.b) && awayIds.has(r.a))
    if (!across) continue
    const heatNow = decayed(r.heat, r.year, r.day, year, day, PAIR_HALF_LIFE_DAYS)
    if (heatNow >= FORGET) out.push({ ...r, heatNow })
  }
  return out.sort((x, y) => y.heatNow - x.heatNow || (x.a < y.a ? -1 : 1))
}

export interface IngestArgs {
  year: number
  day: number
  /** ISO date of the game. */
  date: string
  homeTeamId: string
  awayTeamId: string
  /** Who dressed (skaters and goalies) for each club. */
  homeIds: ReadonlyArray<string>
  awayIds: ReadonlyArray<string>
  incidents: ReadonlyArray<HeatIncident>
  pim: number
  fights: number
}

/** Fold one finished game into the ledger. */
export function ingestGameHeat(state: HeatLedgerState, g: IngestArgs): void {
  // ── the club pairing ──
  let score = 0
  for (const inc of g.incidents) {
    const w = (TEAM_W[inc.kind] ?? 0) * (inc.kind === 'bigHit' && inc.down ? 1.5 : 1)
    score = score + w * (1 - score)
  }
  const [ta, tb] = key(g.homeTeamId, g.awayTeamId)
  const prev = teamHeatBetween(state, ta, tb, g.year, g.day)
  const kept = prev.heat * CALM_KEEP
  const heat = clamp01(kept + score * (1 - kept))
  const trec: TeamHeatRecord = { a: ta, b: tb, heat, year: g.year, day: g.day, last: { date: g.date, fights: g.fights, pim: g.pim } }
  const ti = state.teams.findIndex((r) => r.a === ta && r.b === tb)
  if (heat < FORGET) {
    if (ti >= 0) state.teams.splice(ti, 1)
  } else if (ti >= 0) state.teams[ti] = trec
  else state.teams.push(trec)
  if (state.teams.length > MAX_TEAMS) {
    state.teams.sort((x, y) => decayed(y.heat, y.year, y.day, g.year, g.day, TEAM_HALF_LIFE_DAYS) - decayed(x.heat, x.year, x.day, g.year, g.day, TEAM_HALF_LIFE_DAYS))
    state.teams.length = MAX_TEAMS
  }

  // ── player pairs: tonight's strongest incident per pair ──
  const tonight = new Map<string, HeatIncident>()
  for (const inc of g.incidents) {
    if (!(inc.kind in PAIR_W)) continue
    const k = key(inc.by, inc.on).join('|')
    const cur = tonight.get(k)
    if (!cur || CARRIED_RANK[inc.kind as CarriedKind] > CARRIED_RANK[cur.kind as CarriedKind]) tonight.set(k, inc)
  }
  const home = new Set(g.homeIds)
  const away = new Set(g.awayIds)
  for (const r of state.pairs) {
    const k = `${r.a}|${r.b}`
    if (tonight.has(k)) continue
    const across = (home.has(r.a) && away.has(r.b)) || (home.has(r.b) && away.has(r.a))
    if (across) r.meetingsSince++
  }
  for (const [k, inc] of tonight) {
    const [a, b] = k.split('|') as [string, string]
    const kind = inc.kind as CarriedKind
    const idx = state.pairs.findIndex((r) => r.a === a && r.b === b)
    const old = idx >= 0 ? decayed(state.pairs[idx]!.heat, state.pairs[idx]!.year, state.pairs[idx]!.day, g.year, g.day, PAIR_HALF_LIFE_DAYS) : 0
    const w = PAIR_W[kind] * (kind === 'bigHit' && inc.down ? 1.35 : 1)
    const rec: PairHeatRecord = {
      a, b, heat: clamp01(Math.max(old, w) + 0.25 * Math.min(old, w)), year: g.year, day: g.day, meetingsSince: 0,
      last: {
        kind, byId: inc.by, onId: inc.on, year: g.year, day: g.day, date: g.date,
        ...(inc.infraction ? { infraction: inc.infraction } : {}),
        ...(inc.down ? { down: true } : {}),
        ...(kind === 'fight' ? { winnerId: inc.winner ?? null } : {}),
      },
    }
    if (idx >= 0) state.pairs[idx] = rec
    else state.pairs.push(rec)
  }
  // forget the cold ones, keep the hottest MAX_PAIRS
  const now = (r: PairHeatRecord): number => decayed(r.heat, r.year, r.day, g.year, g.day, PAIR_HALF_LIFE_DAYS)
  state.pairs = state.pairs.filter((r) => now(r) >= FORGET)
  if (state.pairs.length > MAX_PAIRS) {
    state.pairs.sort((x, y) => now(y) - now(x))
    state.pairs.length = MAX_PAIRS
  }
}
