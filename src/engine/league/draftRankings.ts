/**
 * NHL analyst draft rankings. Pundits/scouting services publish a consensus
 * ranking of the draft-eligible class that evolves across the season:
 *  - preliminary (pre-season / early): mostly upside-driven, noisy.
 *  - mid-season: the field firms up as bodies of work accumulate.
 *  - final (pre-draft): production/readiness weighted more, least noise.
 *
 * This is the ANALYST consensus, not the user's own scouts (a scout-built board
 * from what each scout has actually seen is the planned follow-up). Pure: the
 * "noise" is a deterministic hash of player id + phase, so a board is stable
 * within a phase but legitimately shuffles between phases.
 */
export type DraftRankPhase = 'preliminary' | 'midseason' | 'final'

/**
 * Draft status of a young player relative to the upcoming entry draft. We scout
 * from age 14, but only ~draft-age players are actually selectable:
 *  - 'radar'    : 14–16, too young to draft — on the radar / watch list only.
 *  - 'eligible' : 17–18, first-time draft-eligible — the board's focus.
 *  - 'reentry'  : 19–20 and still undrafted — re-entry eligible.
 * Already-drafted or 21+ undrafted players return null (off the board).
 *
 * (Age is our season-coarse proxy for the real "turns 18 by Sep 15 of the draft
 * year" birthday rule; precise DOB handling can refine this later.)
 */
export type DraftEligibility = 'radar' | 'eligible' | 'reentry'

export function draftEligibility(age: number, drafted: boolean): DraftEligibility | null {
  if (drafted) return null
  if (age <= 13) return null
  if (age <= 16) return 'radar'
  if (age <= 18) return 'eligible'
  if (age <= 20) return 'reentry'
  return null
}

export interface RankInput {
  id: string
  /** Projected ceiling, 0–100. */
  ceiling: number
  /** Current ability, 0–100. */
  current: number
}

/** Deterministic [-1, 1) from a string (FNV-1a hash). */
function hashUnit(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  // map to [0,1) then to [-1,1)
  return ((h >>> 0) / 0xffffffff) * 2 - 1
}

/** How much analysts weight ceiling vs current ability, and how much they
 *  disagree (noise), per phase. */
function phaseWeights(phase: DraftRankPhase): { ceilingWeight: number; noise: number } {
  switch (phase) {
    case 'preliminary': return { ceilingWeight: 0.85, noise: 3 }
    case 'midseason': return { ceilingWeight: 0.78, noise: 2 }
    case 'final': return { ceilingWeight: 0.68, noise: 1 }
  }
}

/**
 * Rank draft-eligible prospects best-first for the given phase. Returns ids in
 * ranked order (caller maps to display rows).
 */
export function analystRank(inputs: RankInput[], phase: DraftRankPhase): string[] {
  const { ceilingWeight, noise } = phaseWeights(phase)
  return [...inputs]
    .map((x) => ({
      id: x.id,
      score: x.ceiling * ceilingWeight + x.current * (1 - ceilingWeight) + hashUnit(`${x.id}|${phase}`) * noise,
    }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.id)
}
