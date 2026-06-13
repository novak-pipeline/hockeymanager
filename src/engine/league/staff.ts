/**
 * Staff generation and AGM Report system.
 *
 * Mirrors EHM's Team > Report tab: the assistant GM evaluates the roster
 * through the lens of his own judgment quality (0–100). Low-judgment AGMs
 * mis-rank players; high-judgment AGMs read players accurately. The error
 * is deterministic (stable per player-id hash) so reports stay consistent
 * between saves.
 *
 * All functions are pure; no side-effects, no wall-clock, no unseeded RNG.
 */

import type { Player, PlayerId } from '@domain'
import { computeComposites, overall } from '@engine/ratings/composites'
import { Rng } from '@engine/shared/rng'
import { FIRST_NAMES, LAST_NAMES } from '@data/names'

/* ─────────────────────────── types ─────────────────────────── */

export interface StaffMember {
  id: string
  name: string
  role: 'headCoach' | 'assistantCoach' | 'assistantGM' | 'scout' | 'physio' | 'owner'
  /** 40–90 quality. Governs how effective the staff member is at their job. */
  rating: number
  /** 0–100. Higher = the AGM's player reads track closer to true values. */
  judgment: number
  /** Optional specialty label, e.g. "Defense", "Goaltending", "Prospects". */
  specialty?: string
  /** Set when a retired player was hired; links back to the player record. */
  formerPlayerId?: string
  /** Facepack image key resolved to faces/<faceId>.png (from mod import). */
  faceId?: string
  /**
   * Personality hint for coach quotes and press reactions.
   * Derived deterministically from rating + judgment at generation time.
   * 'fiery' | 'calm' | 'analytical' | 'motivator' | 'pragmatic'
   */
  demeanor?: 'fiery' | 'calm' | 'analytical' | 'motivator' | 'pragmatic'
}

/**
 * Full staff complement for one team.
 * headCoach and assistantGM are singular; the rest are arrays.
 */
export interface TeamStaff {
  headCoach: StaffMember
  assistantCoaches: StaffMember[]
  assistantGM: StaffMember
  scouts: StaffMember[]
  physios: StaffMember[]
  owner: StaffMember
}

/** One player in an AGM's depth chart or prospect list. */
export interface AgmRankedPlayer {
  playerId: string
  name: string
  position: string
  age: number
  /** The AGM's estimate of current overall (perturbed from truth by judgment). */
  judgedOverall: number
  /** The AGM's estimate of potential (perturbed from truth by judgment). */
  judgedPotential: number
  /** Classification the AGM assigns based on his judged values. */
  tier: 'nhl' | 'reserve' | 'prospect'
}

export interface AgmReport {
  depthChart: {
    goalies: AgmRankedPlayer[]
    defensemen: AgmRankedPlayer[]
    leftWings: AgmRankedPlayer[]
    centers: AgmRankedPlayer[]
    rightWings: AgmRankedPlayer[]
  }
  /**
   * EHM-style category bests: 'Biggest Star', 'Best Leader', etc.
   * Each entry names the player the AGM believes best fits that category.
   */
  categoryBests: Array<{ category: string; playerId: string; playerName: string }>
  /** Under-23 players sorted descending by the AGM's judged potential. */
  topProspects: AgmRankedPlayer[]
}

/* ─────────────────────────── deterministic judgment error ─────────────────────────── */

/**
 * Stable per-player hash — same algorithm as scouting.ts playerIdHash.
 * Produces a 0..1 float that is stable for a given (playerId, salt) pair.
 */
function stableFloat(playerId: string, salt: number): number {
  let h = 5381
  for (let i = 0; i < playerId.length; i++) {
    h = ((h << 5) + h + playerId.charCodeAt(i)) >>> 0
  }
  // Mix in the salt
  h = (Math.imul(h ^ (salt >>> 0), 0x9e3779b1) + 0x85ebca77) >>> 0
  return (h >>> 0) / 4294967296
}

/**
 * Return the AGM's judged value for a true rating.
 *
 * Error magnitude shrinks as judgment rises:
 *   judgment 100 → error ≤ 0 (exact)
 *   judgment  75 → max error ±5
 *   judgment  50 → max error ±12
 *   judgment   0 → max error ±25
 *
 * The error direction is stable (determined by playerId + a numeric salt),
 * so the same AGM always over/under-rates the same players.
 */
function judgedValue(
  trueValue: number,
  judgment: number,
  playerId: string,
  salt: number
): number {
  const maxError = 25 * (1 - judgment / 100)
  // Map stable float [0,1) → signed bias [-1, +1)
  const bias = stableFloat(playerId, salt) * 2 - 1
  const error = Math.round(bias * maxError)
  return Math.max(1, Math.min(99, trueValue + error))
}

/* ─────────────────────────── potential overall helper ─────────────────────────── */

/**
 * Derive an overall from a player's *potential* attributes so we can
 * compare potential vs current and produce prospect rankings.
 * We re-use the same overall() function but against the potential composites.
 */
function potentialOverall(player: Player): number {
  const potentialComposites = computeComposites(player.potential, player.role, player.position)
  return overall(potentialComposites, player.position)
}

/* ─────────────────────────── name pool helpers ─────────────────────────── */

function pickName(rng: Rng, existingNames: Set<string>): string {
  // Try up to 10 times to find a unique name; fall through with a duplicate if needed.
  for (let attempt = 0; attempt < 10; attempt++) {
    const first = FIRST_NAMES[rng.int(FIRST_NAMES.length)]!
    const last = LAST_NAMES[rng.int(LAST_NAMES.length)]!
    const name = `${first} ${last}`
    if (!existingNames.has(name)) return name
  }
  // Guaranteed unique via suffix
  const first = FIRST_NAMES[rng.int(FIRST_NAMES.length)]!
  const last = LAST_NAMES[rng.int(LAST_NAMES.length)]!
  return `${first} ${last} Jr.`
}

/* ─────────────────────────── staff generation ─────────────────────────── */

const HEAD_COACH_SPECIALTIES = [
  'Offense', 'Defense', 'Power Play', 'Penalty Kill', 'Player Development', 'System'
]

const AGM_SPECIALTIES = [
  'Prospects', 'Defense', 'Goaltending', 'Analytics', 'Contract Negotiation', 'Trade Deadline'
]

/* ─────────────────────────── demeanor derivation ─────────────────────────── */

type Demeanor = NonNullable<StaffMember['demeanor']>

/**
 * Derive a stable demeanor from rating + judgment.
 * High rating + high judgment → analytical; high rating + low judgment → fiery;
 * low rating + high judgment → pragmatic; high judgment + mid rating → motivator;
 * default → calm.
 */
function deriveDemeanor(rating: number, judgment: number): Demeanor {
  if (rating >= 72 && judgment >= 72) return 'analytical'
  if (rating >= 70 && judgment < 55) return 'fiery'
  if (rating < 55 && judgment >= 68) return 'pragmatic'
  if (judgment >= 68 && rating >= 58) return 'motivator'
  return 'calm'
}

export interface GenerateStaffArgs {
  rng: Rng
  /** Names already in use (scouts, etc.) — avoid duplicates. */
  existingScoutNames?: string[]
}

/* ─────────────────────────── role-specific pools ─────────────────────────── */

const ASSISTANT_COACH_SPECIALTIES = [
  'Forwards', 'Defensemen', 'Goaltending', 'Power Play', 'Penalty Kill', 'Special Teams'
]

const SCOUT_SPECIALTIES = [
  'North America', 'Europe', 'Prospects', 'College', 'Analytics', 'Defense', 'Goaltending'
]

const PHYSIO_SPECIALTIES = [
  'Sports Medicine', 'Rehabilitation', 'Conditioning', 'Nutrition', 'Mental Health'
]

const OWNER_SPECIALTIES = [
  'Revenue Growth', 'Community', 'Long-Term Build', 'Win-Now', 'Analytics', 'Traditions'
]

/* ─────────────────────────── demeanor helper (public) ─────────────────────────── */

/**
 * Derive a stable demeanor from rating + judgment + specialty + rng.
 * The specialty and rng parameters let callers add entropy so staff with
 * identical stats can still diverge in personality.
 *
 * High rating + high judgment → analytical
 * High rating + low judgment  → fiery
 * Low rating  + high judgment → pragmatic
 * Mid rating  + high judgment → motivator
 * default                     → calm
 */
export function demeanor(
  rating: number,
  judgment: number,
  specialty: string | undefined,
  rng: Rng
): NonNullable<StaffMember['demeanor']> {
  // Small entropy nudge (0–3) from specialty hash + rng draw, keeping it deterministic.
  const specialtyHash = specialty
    ? specialty.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xffff, 0)
    : 0
  const nudge = ((specialtyHash + rng.int(4)) % 4)
  const r = rating + nudge
  const j = judgment + nudge

  if (r >= 72 && j >= 72) return 'analytical'
  if (r >= 70 && j < 55)  return 'fiery'
  if (r < 55  && j >= 68) return 'pragmatic'
  if (j >= 68 && r >= 58) return 'motivator'
  return 'calm'
}

/* ─────────────────────────── generateTeamStaff ─────────────────────────── */

export interface GenerateTeamStaffOpts {
  /** Names already in use across the league — avoid duplicates. */
  existingNames?: Set<string>
}

/**
 * Build a full staff complement for one team:
 *   1 headCoach, 2–3 assistantCoaches, 1 assistantGM, 2–3 scouts, 1–2 physios, 1 owner.
 *
 * All randomness flows through the provided Rng; results are fully deterministic.
 * Ratings/judgment use the same normal/clamp patterns as generateStaff().
 */
export function generateTeamStaff(rng: Rng, opts?: GenerateTeamStaffOpts): TeamStaff {
  const taken: Set<string> = opts?.existingNames ?? new Set<string>()

  const name = (): string => pickName(rng, taken)

  const makeStaff = (
    role: StaffMember['role'],
    prefix: string,
    ratingMean: number,
    ratingSD: number,
    judgmentMean: number,
    judgmentSD: number,
    specialties: string[]
  ): StaffMember => {
    const n = name()
    taken.add(n)
    const r = Math.round(Math.max(40, Math.min(90, rng.normal(ratingMean, ratingSD))))
    const j = Math.round(Math.max(30, Math.min(95, rng.normal(judgmentMean, judgmentSD))))
    const spec = specialties[rng.int(specialties.length)]!
    return {
      id: `${prefix}-${n.replace(/\s+/g, '-').toLowerCase()}`,
      name: n,
      role,
      rating: r,
      judgment: j,
      specialty: spec,
      demeanor: demeanor(r, j, spec, rng),
    }
  }

  // Head coach
  const headCoachName = name()
  taken.add(headCoachName)
  const coachR = Math.round(Math.max(40, Math.min(90, rng.normal(62, 10))))
  const coachJ = Math.round(Math.max(30, Math.min(95, rng.normal(60, 14))))
  const coachSpec = HEAD_COACH_SPECIALTIES[rng.int(HEAD_COACH_SPECIALTIES.length)]!
  const headCoach: StaffMember = {
    id: `coach-${headCoachName.replace(/\s+/g, '-').toLowerCase()}`,
    name: headCoachName,
    role: 'headCoach',
    rating: coachR,
    judgment: coachJ,
    specialty: coachSpec,
    demeanor: demeanor(coachR, coachJ, coachSpec, rng),
  }

  // 2–3 assistant coaches
  const acCount = 2 + rng.int(2) // 2 or 3
  const assistantCoaches: StaffMember[] = []
  for (let i = 0; i < acCount; i++) {
    assistantCoaches.push(makeStaff('assistantCoach', 'ac', 58, 10, 56, 13, ASSISTANT_COACH_SPECIALTIES))
  }

  // Assistant GM
  const agmName = name()
  taken.add(agmName)
  const agmR = Math.round(Math.max(40, Math.min(90, rng.normal(60, 10))))
  const agmJ = Math.round(Math.max(30, Math.min(95, rng.normal(58, 16))))
  const agmSpec = AGM_SPECIALTIES[rng.int(AGM_SPECIALTIES.length)]!
  const assistantGM: StaffMember = {
    id: `agm-${agmName.replace(/\s+/g, '-').toLowerCase()}`,
    name: agmName,
    role: 'assistantGM',
    rating: agmR,
    judgment: agmJ,
    specialty: agmSpec,
    demeanor: demeanor(agmR, agmJ, agmSpec, rng),
  }

  // 2–3 scouts
  const scoutCount = 2 + rng.int(2)
  const scouts: StaffMember[] = []
  for (let i = 0; i < scoutCount; i++) {
    scouts.push(makeStaff('scout', 'scout', 55, 12, 62, 14, SCOUT_SPECIALTIES))
  }

  // 1–2 physios
  const physioCount = 1 + rng.int(2)
  const physios: StaffMember[] = []
  for (let i = 0; i < physioCount; i++) {
    physios.push(makeStaff('physio', 'physio', 57, 11, 50, 12, PHYSIO_SPECIALTIES))
  }

  // Owner (single)
  const ownerName = name()
  taken.add(ownerName)
  const ownerR = Math.round(Math.max(40, Math.min(90, rng.normal(65, 12))))
  const ownerJ = Math.round(Math.max(30, Math.min(95, rng.normal(55, 18))))
  const ownerSpec = OWNER_SPECIALTIES[rng.int(OWNER_SPECIALTIES.length)]!
  const owner: StaffMember = {
    id: `owner-${ownerName.replace(/\s+/g, '-').toLowerCase()}`,
    name: ownerName,
    role: 'owner',
    rating: ownerR,
    judgment: ownerJ,
    specialty: ownerSpec,
    demeanor: demeanor(ownerR, ownerJ, ownerSpec, rng),
  }

  return { headCoach, assistantCoaches, assistantGM, scouts, physios, owner }
}

/**
 * Generate a head coach and assistant GM for a franchise.
 * Ratings/judgment are spread realistically (most staff are average; elite are rare).
 */
export function generateStaff(args: GenerateStaffArgs): {
  headCoach: StaffMember
  assistantGM: StaffMember
} {
  const { rng } = args
  const taken = new Set<string>(args.existingScoutNames ?? [])

  // Head coach
  const coachName = pickName(rng, taken)
  taken.add(coachName)
  const coachRating = Math.round(Math.max(40, Math.min(90, rng.normal(62, 10))))
  const coachJudgment = Math.round(Math.max(30, Math.min(95, rng.normal(60, 14))))
  const coachSpecialty = HEAD_COACH_SPECIALTIES[rng.int(HEAD_COACH_SPECIALTIES.length)]!

  const headCoach: StaffMember = {
    id: `coach-${coachName.replace(/\s+/g, '-').toLowerCase()}`,
    name: coachName,
    role: 'headCoach',
    rating: coachRating,
    judgment: coachJudgment,
    specialty: coachSpecialty,
  }

  // Assistant GM
  const agmName = pickName(rng, taken)
  taken.add(agmName)
  const agmRating = Math.round(Math.max(40, Math.min(90, rng.normal(60, 10))))
  const agmJudgment = Math.round(Math.max(30, Math.min(95, rng.normal(58, 16))))
  const agmSpecialty = AGM_SPECIALTIES[rng.int(AGM_SPECIALTIES.length)]!

  const assistantGM: StaffMember = {
    id: `agm-${agmName.replace(/\s+/g, '-').toLowerCase()}`,
    name: agmName,
    role: 'assistantGM',
    rating: agmRating,
    judgment: agmJudgment,
    specialty: agmSpecialty,
  }

  return { headCoach, assistantGM }
}

/* ─────────────────────────── hired retired player ─────────────────────────── */

/**
 * Promote a retired player into a staff role.
 * Their former playing overall + personality shapes their staff quality:
 *  - A high-overall, high-professionalism/determination ex-player makes a better coach/scout.
 *  - judgment is drawn from their former mental attributes (anticipation, vision, composure).
 */
export function hireRetiredPlayer(args: {
  player: Player
  role: StaffMember['role']
  rng: Rng
}): StaffMember {
  const { player, role, rng } = args

  // Derive rating from playing overall + personality
  const playingOverall = overall(player.composites, player.position)
  const personalityBonus =
    (player.personality.professionalism + player.personality.determination) / 2 - 10
  // Elite players bring cachet; average ones need more genuine coaching talent
  const baseRating = Math.round(playingOverall * 0.6 + personalityBonus + rng.normal(0, 5))
  const rating = Math.max(40, Math.min(90, baseRating))

  // Judgment from mental attributes + leadership personality traits
  const mentalAvg =
    (player.ratings.mental.anticipation +
      player.ratings.mental.vision +
      player.ratings.mental.composure) /
    3
  const leadershipBonus =
    (player.personality.determination + player.personality.professionalism) / 4
  const baseJudgment = Math.round(mentalAvg * 0.8 + leadershipBonus + rng.normal(0, 6))
  const judgment = Math.max(30, Math.min(95, baseJudgment))

  return {
    id: `staff-${player.id as string}`,
    name: player.name,
    role,
    rating,
    judgment,
    formerPlayerId: player.id as string,
  }
}

/* ─────────────────────────── AGM report ─────────────────────────── */

export interface BuildAgmReportArgs {
  /** The team's active roster — an array of Player objects. */
  roster: Player[]
  /** Full player map (used for any cross-roster lookups). */
  players: Map<PlayerId, Player>
  /** The AGM whose perspective shapes every judgment. */
  agm: StaffMember
  /** Seeded RNG — used only for tie-breaking when judged values are equal. */
  rng: Rng
}

/** EHM's category best labels. */
const CATEGORY_LABELS = [
  'Biggest Star',
  'Best Leader',
  'Best Skater',
  'Best Shooter',
  'Hardest Shot',
  'Best At Faceoffs',
  'Best Stickhandler',
  'Best Checker',
  'Best Enforcer',
  'Most Physical',
  'Most Overrated',
  'Most Underrated',
] as const

type CategoryLabel = (typeof CATEGORY_LABELS)[number]

/** Salts for each category (stable per-category, different from judgedOverall salt). */
const CATEGORY_SALT: Record<CategoryLabel, number> = {
  'Biggest Star': 100,
  'Best Leader': 101,
  'Best Skater': 102,
  'Best Shooter': 103,
  'Hardest Shot': 104,
  'Best At Faceoffs': 105,
  'Best Stickhandler': 106,
  'Best Checker': 107,
  'Best Enforcer': 108,
  'Most Physical': 109,
  'Most Overrated': 110,
  'Most Underrated': 111,
}

/**
 * Build the ranked AGM report.
 *
 * Key design choices:
 *  1. judgedOverall/judgedPotential are computed once per player then reused.
 *  2. Tier is assigned on judgedOverall/judgedPotential, so a low-judgment AGM
 *     can misclassify players.
 *  3. Category bests use category-specific stable salts — so "Best Skater"
 *     and "Biggest Star" can disagree (as in real life).
 *  4. Overrated/Underrated compare judged vs a reputation proxy derived from age
 *     and current contract salary (salary = proxy for public reputation).
 */
export function buildAgmReport(args: BuildAgmReportArgs): AgmReport {
  const { roster, agm, rng } = args

  // ── 1. Compute judged values for every roster player ──────────────────────
  interface RosterEntry {
    player: Player
    trueOverall: number
    truePotential: number
    judgedOverall: number
    judgedPotential: number
    tier: 'nhl' | 'reserve' | 'prospect'
  }

  const entries: RosterEntry[] = roster.map((player) => {
    const trueOvr = overall(player.composites, player.position)
    const truePot = potentialOverall(player)

    // Salt 1 = judgedOverall, Salt 2 = judgedPotential
    const jOvr = judgedValue(trueOvr, agm.judgment, player.id as string, 1)
    const jPot = judgedValue(truePot, agm.judgment, player.id as string, 2)

    // Tier classification based on judged values
    let tier: 'nhl' | 'reserve' | 'prospect'
    if (player.age < 23 && jPot > jOvr + 5) {
      tier = 'prospect'
    } else if (jOvr >= 70) {
      tier = 'nhl'
    } else if (jOvr >= 55) {
      // Could go either way — AGM classifies based on depth of roster need
      tier = jOvr >= 63 ? 'nhl' : 'reserve'
    } else {
      tier = 'reserve'
    }

    return { player, trueOverall: trueOvr, truePotential: truePot, judgedOverall: jOvr, judgedPotential: jPot, tier }
  })

  // ── 2. Depth chart ─────────────────────────────────────────────────────────
  const toRanked = (entry: RosterEntry): AgmRankedPlayer => ({
    playerId: entry.player.id as string,
    name: entry.player.name,
    position: entry.player.position,
    age: entry.player.age,
    judgedOverall: entry.judgedOverall,
    judgedPotential: entry.judgedPotential,
    tier: entry.tier,
  })

  const byPosition = (pos: string) =>
    entries
      .filter((e) => e.player.position === pos)
      .sort((a, b) => b.judgedOverall - a.judgedOverall || rng.int(3) - 1)
      .map(toRanked)

  // W maps to both LW and RW slots — split by whether playerId hash is even/odd
  const wings = entries.filter((e) => e.player.position === 'W')
  const leftWingEntries = wings.filter((_, i) => i % 2 === 0).sort((a, b) => b.judgedOverall - a.judgedOverall)
  const rightWingEntries = wings.filter((_, i) => i % 2 === 1).sort((a, b) => b.judgedOverall - a.judgedOverall)

  const depthChart: AgmReport['depthChart'] = {
    goalies: byPosition('G'),
    defensemen: byPosition('D'),
    centers: byPosition('C'),
    leftWings: leftWingEntries.map(toRanked),
    rightWings: rightWingEntries.map(toRanked),
  }

  // ── 3. Category bests ──────────────────────────────────────────────────────
  /**
   * Score each player for a category using the AGM's judgment (stable per salt).
   * The AGM doesn't see the raw attribute directly — he sees it with an error
   * whose magnitude is tied to his judgment.
   */
  function categoryScore(entry: RosterEntry, category: CategoryLabel): number {
    const p = entry.player
    const r = p.ratings
    const c = p.composites
    const salt = CATEGORY_SALT[category]

    // True score derived from the most relevant attribute(s)/composite
    let trueScore: number
    switch (category) {
      case 'Biggest Star':
        trueScore = entry.trueOverall
        break
      case 'Best Leader':
        trueScore = Math.round(
          (p.personality.professionalism + p.personality.determination + p.personality.ambition) / 3 * (entry.trueOverall / 80)
        )
        break
      case 'Best Skater':
        trueScore = c.skating
        break
      case 'Best Shooter':
        trueScore = c.scoring
        break
      case 'Hardest Shot':
        trueScore = r.technical.slapShot
        break
      case 'Best At Faceoffs':
        trueScore = c.faceoffWin
        break
      case 'Best Stickhandler':
        trueScore = c.puckControl
        break
      case 'Best Checker':
        trueScore = c.defensiveZone
        break
      case 'Best Enforcer':
        trueScore = c.hitting
        break
      case 'Most Physical':
        trueScore = Math.round((c.hitting + r.physical.strength) / 2)
        break
      case 'Most Overrated': {
        // Overrated = AGM thinks you're worth less than your "reputation"
        // Reputation proxy: clamp salary-based assumption to 40–99 scale
        const repProxy = Math.min(99, Math.max(40, Math.round(entry.trueOverall * 0.9 + 5)))
        trueScore = Math.max(0, repProxy - entry.judgedOverall)
        break
      }
      case 'Most Underrated': {
        // Underrated = AGM thinks you're worth more than your "reputation"
        const repProxy = Math.min(99, Math.max(40, Math.round(entry.trueOverall * 0.9 + 5)))
        trueScore = Math.max(0, entry.judgedOverall - repProxy)
        break
      }
    }

    // Apply judgment error to the category score so a bad AGM is unreliable here too
    return judgedValue(Math.min(99, Math.max(1, trueScore)), agm.judgment, p.id as string, salt)
  }

  const skaters = entries.filter((e) => e.player.position !== 'G')
  const all = entries

  function bestInGroup(group: RosterEntry[], category: CategoryLabel): RosterEntry | undefined {
    if (group.length === 0) return undefined
    return group.reduce((best, entry) =>
      categoryScore(entry, category) > categoryScore(best, category) ? entry : best
    )
  }

  const categoryBests: AgmReport['categoryBests'] = []
  for (const category of CATEGORY_LABELS) {
    // Faceoffs → centers only; Hardest Shot → skaters; Enforcer/Physical → skaters
    let group: RosterEntry[]
    if (category === 'Best At Faceoffs') {
      group = entries.filter((e) => e.player.position === 'C')
      if (group.length === 0) group = skaters // fallback
    } else if (category === 'Best Enforcer' || category === 'Most Physical') {
      group = skaters.length > 0 ? skaters : all
    } else if (category === 'Biggest Star' || category === 'Best Leader') {
      group = all
    } else {
      group = skaters.length > 0 ? skaters : all
    }

    const winner = bestInGroup(group, category)
    if (winner) {
      categoryBests.push({
        category,
        playerId: winner.player.id as string,
        playerName: winner.player.name,
      })
    }
  }

  // ── 4. Top prospects ───────────────────────────────────────────────────────
  const topProspects = entries
    .filter((e) => e.player.age < 23)
    .sort((a, b) => b.judgedPotential - a.judgedPotential)
    .map(toRanked)

  return { depthChart, categoryBests, topProspects }
}
