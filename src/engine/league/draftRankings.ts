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
  /** Position — used to fade goalies (analysts are wary of projecting them high). */
  position?: string
  /** Draft eligibility — re-entry (passed-over) prospects are docked. */
  eligibility?: DraftEligibility
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
    .map((x) => {
      const base = x.ceiling * ceilingWeight + x.current * (1 - ceilingWeight)
      return { id: x.id, score: base * positionFactor(x.position) - reentryPenalty(x.eligibility) + hashUnit(`${x.id}|${phase}`) * noise }
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.id)
}

/** Goalies are notoriously hard to project — analysts fade them on draft boards
 *  (an elite goalie ceiling rarely cracks the top 10). Skaters are unaffected. */
function positionFactor(position?: string): number {
  return position === 'G' ? 0.86 : 1
}

/** Re-entry prospects (19–20, passed over once already) are docked — they're
 *  older and the league has seen them before. */
function reentryPenalty(eligibility?: DraftEligibility): number {
  return eligibility === 'reentry' ? 9 : 0
}

/**
 * What role analysts project a prospect tops out at, in hockey terms, from their
 * projected ceiling (0–100) and position. This is the "where do they top out"
 * read that pundits attach to a prospect — distinct from current ability.
 */
export function ceilingRole(ceiling: number, position: string): string {
  const isG = position === 'G'
  const isD = position === 'D' || position === 'LD' || position === 'RD'
  if (isG) {
    if (ceiling >= 84) return 'a franchise starting goaltender'
    if (ceiling >= 78) return 'a starting goaltender'
    if (ceiling >= 71) return 'a capable 1B / tandem netminder'
    if (ceiling >= 63) return 'an NHL backup'
    return 'an AHL / depth goaltender'
  }
  if (isD) {
    if (ceiling >= 86) return 'a true #1 defenceman who drives play in all situations'
    if (ceiling >= 80) return 'a top-pairing defenceman'
    if (ceiling >= 74) return 'a second-pairing defenceman'
    if (ceiling >= 67) return 'a third-pairing defenceman'
    if (ceiling >= 60) return 'a depth / 7th defenceman'
    return 'an AHL blueliner'
  }
  if (ceiling >= 88) return 'a franchise forward and perennial all-star'
  if (ceiling >= 82) return 'a genuine first-line forward'
  if (ceiling >= 76) return 'a top-six contributor'
  if (ceiling >= 70) return 'a reliable middle-six forward'
  if (ceiling >= 63) return 'a bottom-six / energy-line forward'
  return 'an AHL / depth forward'
}

/**
 * Compact ceiling-role label for tables (e.g. "First-line F", "Top-pair D",
 * "Starting G"). The terse cousin of {@link ceilingRole} — a real projection of
 * what a player tops out as, never a vague "Prospect".
 */
export function ceilingRoleShort(ceiling: number, position: string): string {
  const isG = position === 'G'
  const isD = position === 'D' || position === 'LD' || position === 'RD'
  if (isG) {
    if (ceiling >= 84) return 'Franchise G'
    if (ceiling >= 78) return 'Starter'
    if (ceiling >= 71) return '1B / Tandem'
    if (ceiling >= 63) return 'Backup'
    return 'AHL G'
  }
  if (isD) {
    if (ceiling >= 86) return '#1 D'
    if (ceiling >= 80) return 'Top-pair D'
    if (ceiling >= 74) return '2nd-pair D'
    if (ceiling >= 67) return '3rd-pair D'
    if (ceiling >= 60) return 'Depth D'
    return 'AHL D'
  }
  if (ceiling >= 88) return 'Franchise F'
  if (ceiling >= 82) return 'First-line F'
  if (ceiling >= 76) return 'Top-six F'
  if (ceiling >= 70) return 'Middle-six F'
  if (ceiling >= 63) return 'Bottom-six F'
  return 'AHL F'
}

export interface AnalystProjectionInput {
  name: string
  position: string
  /** Projected ceiling, 0–100. */
  ceiling: number
  eligibility: DraftEligibility
  /** Board rank, if the player made the published top board (omit if off-board). */
  rank?: number
  /** Display label for the current phase, e.g. "Mid-season ranking". */
  phaseLabel: string
  /** Upcoming entry-draft year. */
  draftYear: number
}

/**
 * The analyst/pundit projection blurb shown under a prospect's scout report —
 * the consensus read on where they're ranked and the ceiling they're predicted
 * to reach. Returns null for players who aren't draft-relevant.
 */
export function analystProjection(p: AnalystProjectionInput): string | null {
  const role = ceilingRole(p.ceiling, p.position)
  if (p.eligibility === 'radar') {
    return `Not yet draft-eligible, but already on analysts' radar for a future class. Early ceiling read: projects as ${role}.`
  }
  const reentry = p.eligibility === 'reentry'
  const where =
    p.rank !== undefined
      ? `have ${p.name} ranked #${p.rank} in the ${p.draftYear} class`
      : `have ${p.name} outside their published board for the ${p.draftYear} class`
  const lead = reentry
    ? `Passed over once and re-entry eligible; analysts ${where}`
    : `Analyst consensus (${p.phaseLabel.toLowerCase()}) ${where}`
  return `${lead}. Their projection: tops out as ${role}.${projectionHedge(p.rank)}`
}

/**
 * Projections are reliable at the very top of the board and get murkier the
 * deeper you go — top picks are ranked there for a reason; later picks are a
 * crapshoot where outcomes scatter wildly from the projection. This returns the
 * confidence caveat appended to the analyst projection.
 */
export function projectionHedge(rank?: number): string {
  if (rank === undefined) return ' Off the board, the range of outcomes is enormous.'
  if (rank <= 10) return ' A high-confidence projection at the top of the class.'
  if (rank <= 31) return ' A first-round projection, though some spread remains.'
  if (rank <= 64) return ' Projections this deep carry a wide range of outcomes.'
  return ' This late, the projection is little more than a best guess.'
}
