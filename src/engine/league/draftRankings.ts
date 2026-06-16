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

/**
 * A hidden, stable per-player "analyst edge": something the public consensus reads
 * about a prospect that his raw tools/potential don't capture (pro pedigree, a
 * projectable frame, a translatable pro skill) — and which actually pays out in
 * development. It's what lets the ANALYST board legitimately beat your scouts on
 * some prospects (and miss on others), rather than the analysts being a uniformly
 * over-hyped wrong version. Range [-1, 1]; deterministic.
 */
export function analystEdge(playerId: string): number {
  let h = 0x811c9dc5
  const s = playerId + ':analystEdge'
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return ((h >>> 0) / 0xffffffff) * 2 - 1
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

/**
 * Pre-draft analyst optimism: the perceived ceiling sits ABOVE the true ceiling,
 * by a youth premium that fades with age (a 17-year-old is all projection; a
 * passed-over 20-year-old far less so). This is the perception layer — analysts
 * overrate the class — kept separate from the hidden true potential development
 * actually pays out, so reaches and sleepers emerge as players prove out.
 */
export function perceivedCeiling(trueCeiling: number, age: number, productionBonus = 0): number {
  const hype = 3 + Math.max(0, 19 - age) // 17→5, 18→4, 19→3, 20+→3
  const raw = trueCeiling + hype + productionBonus
  // Analysts hype the class, but FRANCHISE (5★) projections stay rare — real boards
  // don't slap top-end ceilings on the whole first round. Diminishing returns above
  // a knee mean only a genuinely elite ceiling (or a true monster season) reads as a
  // top-of-the-board star; everyone else compresses into the 4 / 4.5★ band.
  const KNEE = 82
  const perceived = raw <= KNEE ? raw : KNEE + (raw - KNEE) * 0.4
  return Math.max(0, Math.min(99, Math.round(perceived)))
}

/**
 * How much a prospect's PRODUCTION moves analysts off the book. When the rating
 * is generic, scouts rank on what a kid does on the ice — a teenager dominating
 * a junior (or, better, a pro) league rockets up boards; a low producer slides.
 * Points are converted to an NHL-equivalent rate via league strength, compared
 * to a positional par, and bounded so production tilts the read without
 * overriding genuine pedigree.
 *
 * @param ppg            points per game (blend of this + last season)
 * @param isD            defenceman (lower scoring par)
 * @param leagueStrength NHL-equivalency of the league he produces in (0,1]
 */
export function productionPremium(ppg: number, isD: boolean, leagueStrength: number, age = 18): number {
  if (ppg <= 0) return 0 // no sample → no opinion either way
  const nhlePpg = ppg * Math.max(0.05, leagueStrength)
  const par = isD ? 0.13 : 0.22 // NHL-equivalent PPG a "notable" prospect clears
  const ratio = nhlePpg / par
  // Production is the DOMINANT visible driver of a real draft board, and it's
  // NHLe-translated — so a point-per-game in a strong league (NCAA, 0.40) beats a
  // point-per-game in a weaker one (OHL, 0.30). It's also AGE-ADJUSTED: the same
  // output is far more impressive from a 16/17-year-old than a passed-over 19/20,
  // so younger producers get more credit (penalties aren't age-scaled — a young
  // no-show is a project, not a bust). Bounds wide enough that a dominant young
  // producer genuinely climbs and a no-show genuinely slides.
  const raw = (ratio - 1) * 16
  const ageMult = age <= 16 ? 1.25 : age === 17 ? 1.15 : age === 18 ? 1.0 : age <= 20 ? 0.85 : 0.75
  const adj = raw > 0 ? raw * ageMult : raw
  return Math.max(-10, Math.min(24, Math.round(adj)))
}

/** Goalies are notoriously hard to project — boards fade them (an elite goalie
 *  ceiling rarely cracks the top 10). Skaters are unaffected. Exported so YOUR
 *  scouts' board applies the same fade as the analyst board (a tandem-ceiling
 *  goalie shouldn't rank top-10 on either). */
export function positionFactor(position?: string): number {
  return position === 'G' ? 0.86 : 1
}

/** Re-entry prospects (19–20, passed over once already) are docked — they're
 *  older and the league has seen them before. Exported for the scout board too. */
export function reentryPenalty(eligibility?: DraftEligibility): number {
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
  /** The analyst's FULL-ordering rank (1-based), even past the published board — so
   *  an off-board prospect reads as a concrete "projected Nth-round pick" rather
   *  than a vague "off the board". */
  fullRank?: number
  /** Display label for the current phase, e.g. "Mid-season ranking". */
  phaseLabel: string
  /** Upcoming entry-draft year. */
  draftYear: number
}

/** Picks per round and rounds in an entry draft (NHL: 7 × 32 = 224). */
const PICKS_PER_ROUND = 32
const DRAFT_ROUNDS = 7
const ROUND_ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh']

/** The round a full-ordering rank projects into (1-based), or 0 if beyond the draft. */
export function projectedRound(fullRank: number): number {
  const r = Math.ceil(fullRank / PICKS_PER_ROUND)
  return r >= 1 && r <= DRAFT_ROUNDS ? r : 0
}

/** Compact draft-projection label for tables / info rows. */
export function draftRoundLabel(rank: number | undefined, eligibility?: DraftEligibility): string {
  if (eligibility === 'radar') return 'Future class'
  if (rank === undefined) return 'Unranked'
  if (rank <= PICKS_PER_ROUND * DRAFT_ROUNDS) {
    const round = projectedRound(rank)
    return `R${round} · #${rank}`
  }
  return 'Undrafted proj.'
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
  const round = p.fullRank !== undefined ? projectedRound(p.fullRank) : 0
  const where =
    p.rank !== undefined
      ? `have ${p.name} ranked #${p.rank} in the ${p.draftYear} class`
      : round >= 1
        ? `peg ${p.name} as roughly a ${ROUND_ORDINALS[round - 1]}-round pick (~#${p.fullRank}) in the ${p.draftYear} class`
        : `don't see ${p.name} as a draftable prospect this year`
  const lead = reentry
    ? `Passed over once and re-entry eligible; analysts ${where}`
    : `Analyst consensus (${p.phaseLabel.toLowerCase()}) ${where}`
  return `${lead}. Their projection: tops out as ${role}.${projectionHedge(p.rank ?? p.fullRank)}`
}

/**
 * Projections are reliable at the very top of the board and get murkier the
 * deeper you go — top picks are ranked there for a reason; later picks are a
 * crapshoot where outcomes scatter wildly from the projection. This returns the
 * confidence caveat appended to the analyst projection.
 */
export function projectionHedge(rank?: number): string {
  if (rank === undefined) return ' Off the board entirely — the range of outcomes is enormous.'
  if (rank <= 10) return ' A high-confidence projection at the top of the class.'
  if (rank <= 31) return ' A first-round projection, though some spread remains.'
  if (rank <= 64) return ' Projections this deep carry a wide range of outcomes.'
  if (rank <= PICKS_PER_ROUND * DRAFT_ROUNDS) return ' This late, the projection is little more than a best guess.'
  return ' More of a free-agent flier than a draft pick at this stage.'
}
