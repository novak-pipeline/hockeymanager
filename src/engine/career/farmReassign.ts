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
