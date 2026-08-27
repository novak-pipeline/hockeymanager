/**
 * Farm-system reassignment — the offseason "development gate" that sorts a club's
 * NHL roster and its AHL affiliate by ability, so the best players are on the big
 * club and the rest develop (or sit as depth) in the AHL. This is what stops a
 * declined veteran clogging an NHL roster spot while an AHL standout who's clearly
 * outgrown the minors waits behind him — the ~NHL-readiness bar, applied yearly.
 *
 * Pure + deterministic: given the same rosters + score function it always returns
 * the same split. No Rng, no Date. The caller (career.ts) applies it to AI clubs
 * automatically and surfaces it as a SUGGESTION for the user's club (so the GM
 * keeps manual control of his own call-ups/send-downs).
 *
 * It only ever shuffles players BETWEEN a club's two rosters — the union is
 * preserved, so no player is ever dropped or duplicated.
 */
import type { Player, PlayerId } from '@domain'

/** Standard NHL active-roster shape (23 = 14F + 7D + 2G). */
const NHL_F = 14
const NHL_D = 7
const NHL_G = 2

export interface FarmSplitArgs {
  nhlRoster: PlayerId[]
  ahlRoster: PlayerId[]
  resolve: (id: PlayerId) => Player | undefined
  /** Pro-readiness score (current overall). Higher = more NHL-ready. */
  score: (p: Player) => number
}

export interface FarmSplit {
  /** New NHL roster (best players by score, capped to a standard 23-man shape). */
  nhl: PlayerId[]
  /** New AHL roster (the rest). */
  ahl: PlayerId[]
  /** Players who move AHL → NHL. */
  promoted: PlayerId[]
  /** Players who move NHL → AHL. */
  demoted: PlayerId[]
}

function posGroup(p: Player): 'F' | 'D' | 'G' {
  if (p.position === 'G') return 'G'
  if (p.position === 'D') return 'D'
  return 'F'
}

/**
 * Split a club's combined NHL+AHL pool into an ability-sorted NHL roster (top
 * NHL_F/NHL_D/NHL_G by score) and an AHL roster (everyone else). Returns the new
 * rosters plus the promotions/demotions vs. where each player started.
 */
export function farmSplit(args: FarmSplitArgs): FarmSplit {
  const wasNhl = new Set(args.nhlRoster.map((id) => id as string))

  const groups: Record<'F' | 'D' | 'G', Player[]> = { F: [], D: [], G: [] }
  for (const id of [...args.nhlRoster, ...args.ahlRoster]) {
    const p = args.resolve(id)
    if (!p) continue
    groups[posGroup(p)].push(p)
  }
  for (const key of ['F', 'D', 'G'] as const) {
    groups[key].sort((a, b) => args.score(b) - args.score(a))
  }

  const target: Record<'F' | 'D' | 'G', number> = { F: NHL_F, D: NHL_D, G: NHL_G }
  const nhl: PlayerId[] = []
  const ahl: PlayerId[] = []
  for (const key of ['F', 'D', 'G'] as const) {
    groups[key].forEach((p, i) => (i < target[key] ? nhl : ahl).push(p.id))
  }

  const promoted = nhl.filter((id) => !wasNhl.has(id as string))
  const demoted = ahl.filter((id) => wasNhl.has(id as string))
  return { nhl, ahl, promoted, demoted }
}

export interface RosterTrimArgs {
  nhlRoster: PlayerId[]
  ahlRoster: PlayerId[]
  resolve: (id: PlayerId) => Player | undefined
  /** Pro-readiness score; the camp cutdown passes ability plus waiver protection. */
  score: (p: Player) => number
  /** Ceiling the NHL roster must come back under. Never below the 23-man shape. */
  limit: number
}

export interface RosterTrim {
  nhl: PlayerId[]
  ahl: PlayerId[]
  /** Players sent NHL → AHL to get back under the limit, worst-first. */
  demoted: PlayerId[]
}

/**
 * Bring an over-size NHL roster back under a hard limit by sending the surplus
 * to the affiliate — the compliance half of {@link farmSplit}.
 *
 * Where farmSplit REBUILDS both rosters to the camp shape (and promotes), this
 * only ever moves players DOWN, and only as many as the limit demands: a legal
 * roster is left exactly as it is. That distinction matters at season start,
 * where the club's own call-ups must survive the sweep and only genuine surplus
 * may be touched.
 *
 * It demotes worst-first, but only out of a position group that is still ABOVE
 * the camp shape (14F/7D/2G) — so trimming can never strip a club below two
 * goalies or six defencemen no matter how the scores fall. Since that shape sums
 * to 23 and every legal limit is at least 23, a roster where no group is over
 * target is already under the limit, so the loop always terminates.
 *
 * Pure + deterministic: no Rng, no Date, and the union of the two rosters is
 * preserved exactly.
 */
export function trimToRosterLimit(args: RosterTrimArgs): RosterTrim {
  const nhl = [...args.nhlRoster]
  const ahl = [...args.ahlRoster]
  const demoted: PlayerId[] = []
  const target: Record<'F' | 'D' | 'G', number> = { F: NHL_F, D: NHL_D, G: NHL_G }

  // Bounded by the roster itself: every pass either demotes one player or stops.
  for (let guard = nhl.length; nhl.length > args.limit && guard > 0; guard--) {
    const counts: Record<'F' | 'D' | 'G', number> = { F: 0, D: 0, G: 0 }
    for (const id of nhl) {
      const p = args.resolve(id)
      if (p) counts[posGroup(p)]++
    }

    let worst: { id: PlayerId; score: number } | null = null
    for (const id of nhl) {
      const p = args.resolve(id)
      if (!p || counts[posGroup(p)] <= target[posGroup(p)]) continue
      const s = args.score(p)
      if (!worst || s < worst.score || (s === worst.score && (id as string) < (worst.id as string))) {
        worst = { id, score: s }
      }
    }
    if (!worst) break // every group is at its shape — nothing legal left to move

    const cut = worst.id
    const idx = nhl.findIndex((id) => (id as string) === (cut as string))
    nhl.splice(idx, 1)
    ahl.push(cut)
    demoted.push(cut)
  }

  return { nhl, ahl, demoted }
}
