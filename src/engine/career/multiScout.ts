/**
 * Multi-scout panel engine.
 *
 * Given the user team's scouts and a player, produces:
 *   - One read per scout (tier estimate + one-liner), varied by that scout's
 *     judgment (accuracy), rating, and specialty/bias. Higher-judgment scouts
 *     track closer to the true tier.
 *   - A consensus tier + a dissent note when scouts disagree.
 *   - An NHL-style player comparison derived from archetype + key composites.
 *   - A boom/bust risk band from scout disagreement + potential gap + age.
 *
 * DETERMINISM: all randomness is derived from hash(scoutId + playerId). No
 * Math.random, no Date. Stable hashes so the same scout always reads the same
 * player the same way.
 *
 * exactOptionalPropertyTypes: absent optional props must be OMITTED (not undefined).
 */

import type { Player } from '@domain'
import type { ScoutingState } from '@domain/scouting'
import type { StaffMember } from '@engine/league/staff'
import { knowledgeOf } from '@engine/league/scouting'
import { ratedOverall } from '@engine/ratings/composites'
import { classifyArchetype } from '@engine/league/archetypes'
import { projectionTier, type ProjectionTier, TIER_LABELS } from './scoutReport'

/* ─────────────────────── deterministic hash ─────────────────────── */

/** FNV-1a 32-bit → [0, 1). */
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h * 16777619) >>> 0
  }
  return (h % 10000) / 10000
}

/** Pick a stable item from an array using a key string. */
function stablePick<T>(arr: T[], key: string): T {
  const idx = Math.floor(hash01(key) * arr.length)
  return arr[Math.max(0, Math.min(arr.length - 1, idx))]!
}

/* ─────────────────────── tier index helpers ─────────────────────── */

const TIER_ORDER: ProjectionTier[] = ['Fringe', 'Depth', 'Core', 'Key', 'Star', 'Prospect']

function tierIndex(t: ProjectionTier): number {
  const i = TIER_ORDER.indexOf(t)
  return i < 0 ? 2 : i
}

/* ─────────────────────── specialty bias ─────────────────────── */

/**
 * Specialty biases: a scout with a given specialty over-rates certain
 * composite areas. Returns a score delta in [-8, +8] applied to the raw
 * tier index computation.
 */
function specialtyBias(
  scout: StaffMember,
  player: Player,
  composites: Record<string, number>
): number {
  const spec = (scout.specialty ?? '').toLowerCase()
  if (spec.includes('defense') || spec.includes('defenseman')) {
    // Over-rates defensive traits; under-rates offensive players
    const defScore = ((composites['defensiveZone'] ?? 50) + (composites['takeaway'] ?? 50)) / 2
    return Math.round((defScore - 55) / 10)
  }
  if (spec.includes('goalt')) {
    // Focuses on goalie quality; limited opinion on skaters
    return player.position === 'G' ? 3 : -2
  }
  if (spec.includes('prospect') || spec.includes('college')) {
    // Youth optimist — boosts young players
    return player.age <= 22 ? 4 : -2
  }
  if (spec.includes('analytic')) {
    // Flat bias — analytics scouts are more accurate, not biased
    return 0
  }
  if (spec.includes('europe')) {
    // Slight underrating of physical play (European-style read)
    const phys = (composites['hitting'] ?? 50) / 50 - 1
    return Math.round(-phys * 3)
  }
  return 0
}

/**
 * A single scout's personal bias on a draft prospect's VALUE (0–100 units),
 * relative to the staff consensus — so each scout builds a different board.
 * Combines their specialty lean, demeanor, and a deterministic judgment-scaled
 * noise (worse scouts are noisier and diverge more). Caller still gates this by
 * scouting knowledge (no opinion on a player nobody has seen).
 */
export function scoutDraftBias(
  scout: StaffMember,
  player: Player,
  composites: Record<string, number>
): number {
  const specVal = specialtyBias(scout, player, composites) * 1.5 // tier units → value units
  const noiseMag = (1 - scout.judgment / 100) * 12
  const noise = (hash01(scout.id + ':' + (player.id as string) + ':board') * 2 - 1) * noiseMag
  const demeanorVal = scout.demeanor === 'motivator' ? 2 : scout.demeanor === 'fiery' ? -1.5 : 0
  return specVal + noise + demeanorVal
}

/* ─────────────────────── per-scout tier estimate ─────────────────────── */

/**
 * Compute a scout's tier estimate for a player.
 *
 * Error model (mirrors staff.ts judgedValue):
 *   judgment 90+ → ≤ 0.5 tier error (basically exact)
 *   judgment  60 → ≤ 1 tier off
 *   judgment  30 → ≤ 2 tiers off
 */
// The QUALITY ladder a scout's read can drift along. 'Prospect' is NOT here —
// it's a separate young-high-ceiling label, not a rank above Star, so an
// established star can never be mis-read as a "prospect".
const QUALITY_ORDER: ProjectionTier[] = ['Fringe', 'Depth', 'Core', 'Key', 'Star']
function qIndex(t: ProjectionTier): number {
  const i = QUALITY_ORDER.indexOf(t)
  return i < 0 ? 3 : i // Prospect (or unknown) anchors around Key
}

function scoutTierEstimate(
  scout: StaffMember,
  player: Player,
  trueTier: ProjectionTier,
  _potStars: number,
  composites: Record<string, number>
): ProjectionTier {
  // Error magnitude: [0, 2] tiers, shrinking with judgment.
  const maxError = 2 * Math.max(0, 1 - scout.judgment / 100)
  const bias = hash01(scout.id + ':' + (player.id as string) + ':tier') * 2 - 1
  const rawError = bias * maxError
  const specDelta = specialtyBias(scout, player, composites) * (maxError > 0.5 ? 0.3 : 0.1)
  let demeanorDelta = 0
  if (scout.demeanor === 'motivator') demeanorDelta = 0.3
  else if (scout.demeanor === 'fiery') demeanorDelta = -0.2

  // A genuine young prospect: scouts debate the ceiling (Core..Star) and some
  // still file him under "Prospect" — but he never reads as a fringe NHLer.
  if (trueTier === 'Prospect') {
    const idx = Math.round(3 + rawError + specDelta + demeanorDelta) // anchor at Key
    if (hash01(scout.id + ':' + (player.id as string) + ':prosp') > 0.45) return 'Prospect'
    return QUALITY_ORDER[Math.max(2, Math.min(4, idx))]!
  }

  // Established players drift only within the quality ladder — never to Prospect.
  const finalIdx = Math.round(qIndex(trueTier) + rawError + specDelta + demeanorDelta)
  return QUALITY_ORDER[Math.max(0, Math.min(4, finalIdx))]!
}

/* ─────────────────────── per-scout one-liner ─────────────────────── */

/**
 * Tier-anchored takes: the verbal read MATCHES the chip the scout files (a "Key
 * Player" chip reads like a key player, never "a depth piece"). The optimist /
 * pessimist colour is a SEPARATE clause about where he sits vs the room.
 */
const TAKE_BY_TIER: Record<ProjectionTier, string[]> = {
  Star: [
    'Elite — as good as I\'ve seen at this level.',
    'A franchise cornerstone; you build the team around him.',
    'A difference-maker every shift — best player on most ice he skates on.',
  ],
  Key: [
    'A high-end player you lean on every night.',
    'Top-of-the-lineup quality who drives results.',
    'Plays big minutes in all situations and delivers.',
  ],
  Core: [
    'A dependable everyday player through the middle of the lineup.',
    'An honest, reliable regular — rarely a liability.',
    'A solid middle-of-the-lineup contributor.',
  ],
  Depth: [
    'A useful depth piece in a defined role.',
    'Bottom-of-the-lineup energy — does the little things well.',
    'A role player; won\'t move the needle, but does a job.',
  ],
  Fringe: [
    'Replacement-level — a tweener fighting to hold down a job.',
    'An AHL/NHL bubble body; depth insurance at best.',
  ],
  // Kept only as a safety net — the panel remaps Prospect → a value tier first.
  Prospect: [
    'Raw, but the ceiling is real — needs development time.',
    'You\'re betting on projection, not what he is today.',
  ],
}

function leanSuffix(estIdx: number, trueIdx: number): string {
  if (estIdx > trueIdx + 0.5) return ' I\'m higher on him than the room.'
  if (estIdx < trueIdx - 0.5) return ' Though I\'m more cautious than most.'
  return ''
}

/** A young "Prospect" read isn't a projection — express it as the value tier he
 *  projects to, from his potential, so the chip reads "Key Player" not "Prospect". */
function prospectQuality(potStars: number): ProjectionTier {
  if (potStars >= 4.5) return 'Star'
  if (potStars >= 3.5) return 'Key'
  return 'Core'
}

function scoutOneLiner(
  scout: StaffMember,
  player: Player,
  displayTier: ProjectionTier,
  trueDisplayTier: ProjectionTier
): string {
  const key = scout.id + ':' + (player.id as string) + ':take'
  const base = stablePick(TAKE_BY_TIER[displayTier] ?? TAKE_BY_TIER.Core, key)
  return base + leanSuffix(tierIndex(displayTier), tierIndex(trueDisplayTier))
}

/* ─────────────────────── NHL comp ─────────────────────── */

/**
 * Archetype-to-comp lookup: a pool of notable fictional-but-stylistically-real
 * player comparisons. We keep these fictional to avoid IP issues; callers can
 * override via mod import.
 *
 * Keyed by archetype; each pool entry is { name, blurb }.
 */
const ARCHETYPE_COMPS: Record<string, Array<{ name: string; blurb: string }>> = {
  sniper: [
    { name: 'A.J. Hartwell', blurb: 'elite wrist shot, great release' },
    { name: 'Marcus Levin', blurb: 'pure goal scorer, one-timer specialist' },
    { name: 'Ryan Devereux', blurb: 'instinctive finisher, always in the right spot' },
  ],
  playmaker: [
    { name: 'Sven Holmberg', blurb: 'elite vision, threads passes into impossible lanes' },
    { name: 'Tyler Cassidy', blurb: 'creative playmaker, elevates his linemates' },
    { name: 'Dmitri Volkov', blurb: 'calm under pressure, outstanding hockey sense' },
  ],
  powerForward: [
    { name: 'Jake Morrow', blurb: 'physical presence around the net, hard to move' },
    { name: 'Brandon Tully', blurb: 'power game — wins battles and finishes chances' },
  ],
  twoWayForward: [
    { name: 'Colin Reid', blurb: 'trusted in all situations, reliable 200-foot player' },
    { name: 'Eric Sundqvist', blurb: 'strong defensive game, still contributes offensively' },
  ],
  grinder: [
    { name: 'Matt Hendrick', blurb: 'energy and work rate, great for PK roles' },
    { name: 'Kyle Bowen', blurb: 'grit player who eats tough minutes' },
  ],
  enforcer: [
    { name: 'Derek Oakes', blurb: 'physical deterrent, commands space on the ice' },
    { name: 'Travis Holt', blurb: 'heavy hitter, changes opponents\' behaviour' },
  ],
  offensiveDefenseman: [
    { name: 'Erik Lindqvist', blurb: 'power-play quarterback, dangerous from the blue line' },
    { name: 'Connor Bauer', blurb: 'jumps into the rush, great instincts offensively' },
  ],
  twoWayDefenseman: [
    { name: 'Marc Duchamp', blurb: 'steady all-around blueliner, high-floor defender' },
    { name: 'Adam Krejci', blurb: 'contributes at both ends without big risk' },
  ],
  shutdownDefenseman: [
    { name: 'Viktor Salo', blurb: 'deployed against top lines, suffocates opponents' },
    { name: 'Patrik Nylander', blurb: 'elite defensive instincts, shot-blocker' },
  ],
  puckMover: [
    { name: 'Jonas Halvorsen', blurb: 'transitions puck quickly, excellent skating D' },
    { name: 'Mikael Ström', blurb: 'smooth puck mover, controls pace from the back end' },
  ],
  athleticGoalie: [
    { name: 'Pascal Tremblay', blurb: 'elite reflexes, makes impossible saves look routine' },
    { name: 'Yannick Dubois', blurb: 'explosive lateral movement, high-end athleticism' },
  ],
  positionalGoalie: [
    { name: 'Henrik Mäkinen', blurb: 'takes away angles brilliantly, very positionally sound' },
    { name: 'Lars Bergström', blurb: 'calm and reliable, rarely beaten clean' },
  ],
}

/**
 * Pick an NHL-style comp for a player.
 * Requires knowledge >= 50 (fog gate). Returns null at lower knowledge.
 * Excludes the player themselves (by name, in case a future import gives real names).
 */
export function buildNhlComp(
  player: Player,
  knowledge: number
): NhlComp | null {
  if (knowledge < 50) return null

  const archResult = classifyArchetype(player)
  const pool = ARCHETYPE_COMPS[archResult.archetype] ?? []
  if (pool.length === 0) return null

  // Pick a stable comp from the pool, excluding the player's own name
  const available = pool.filter((c) => c.name !== player.name)
  if (available.length === 0) return null

  const key = (player.id as string) + ':comp'
  const comp = stablePick(available, key)
  return { name: comp.name, blurb: comp.blurb, archetype: archResult.archetype }
}

/* ─────────────────────── boom/bust risk ─────────────────────── */

export type RiskBand = 'Low' | 'Medium' | 'High'

/**
 * Boom/bust risk band.
 *   High variance = young + high ceiling + scouts disagree
 *   Low variance = established player + scouts agree
 */
export function computeRisk(
  player: Player,
  potStars: number,
  trueTier: ProjectionTier,
  reads: ScoutRead[]
): BoomBustRisk {
  const ovr = ratedOverall(player)
  const ceiling = potStars

  // Potential-vs-current gap: high ceiling + low current = high variance
  const ceilingGap = ceiling - Math.round(ovr / 20)

  // Age factor: under 22 = higher variance
  const ageFactor = player.age <= 20 ? 2 : player.age <= 22 ? 1 : 0

  // Scout disagreement: count distinct tier estimates
  const tierSet = new Set(reads.map((r) => r.tier))
  const disagreementFactor = tierSet.size - 1 // 0 = consensus, 1 = two camps, 2 = fully split

  const riskScore = ceilingGap + ageFactor + disagreementFactor

  let band: RiskBand
  if (riskScore >= 4) band = 'High'
  else if (riskScore >= 2) band = 'Medium'
  else band = 'Low'

  // Upside note
  let upsideNote: string
  if (trueTier === 'Star' || potStars >= 5) {
    upsideNote = 'Star-level upside if development goes well.'
  } else if (trueTier === 'Prospect' || potStars >= 4) {
    upsideNote = 'Top-six or top-four upside — high-ceiling projection.'
  } else if (potStars >= 3) {
    upsideNote = 'Core/key player upside with the right development path.'
  } else {
    upsideNote = 'Modest upside — a role player with limited ceiling.'
  }

  return { band, upsideNote }
}

/* ─────────────────────── consensus + dissent ─────────────────────── */

function computeConsensus(reads: ScoutRead[]): {
  consensusTier: ProjectionTier
  dissentNote: string | null
} {
  if (reads.length === 0) {
    return { consensusTier: 'Core', dissentNote: null }
  }

  // Tally votes
  const counts: Partial<Record<ProjectionTier, number>> = {}
  for (const r of reads) {
    counts[r.tier] = (counts[r.tier] ?? 0) + 1
  }

  // Sort by vote count desc, then by tier index desc (prefer higher tier on tie)
  const ranked = Object.entries(counts).sort((a, b) => {
    const countDiff = (b[1] as number) - (a[1] as number)
    if (countDiff !== 0) return countDiff
    return tierIndex(b[0] as ProjectionTier) - tierIndex(a[0] as ProjectionTier)
  })

  const consensusTier = ranked[0]![0] as ProjectionTier
  const topCount = ranked[0]![1] as number

  // Dissent: if not unanimous, build a dissent note
  let dissentNote: string | null = null
  if (ranked.length > 1) {
    // e.g. "3 of 4 scouts see Key upside; one scout is lower."
    const dissenterCount = reads.length - topCount
    const dissenterTier = ranked[1]![0] as ProjectionTier
    const estIdx = tierIndex(consensusTier)
    const dissIdx = tierIndex(dissenterTier)
    const direction = dissIdx > estIdx ? 'higher' : 'lower'
    const dissenterWord = dissenterCount === 1 ? 'one scout' : `${dissenterCount} scouts`
    dissentNote = `${topCount} of ${reads.length} scouts see ${TIER_LABELS[consensusTier]} upside; ${dissenterWord} ${direction === 'higher' ? 'is more bullish' : 'is more cautious'}.`
  }

  return { consensusTier, dissentNote }
}

/* ─────────────────────── public types ─────────────────────── */

export interface ScoutRead {
  scoutId: string
  scoutName: string
  /** Facepack image key — only present when the scout has a faceId. */
  faceId?: string
  /** This scout's tier estimate for the player. */
  tier: ProjectionTier
  tierLabel: string
  /** One-line take from this scout. */
  take: string
  /** What this scout saw the player do in a recent game he attended; omitted when
   *  there's no game sample yet. */
  watched?: string
}

export interface NhlComp {
  /** Fictional comparable player name. */
  name: string
  /** Short style note, e.g. 'elite wrist shot, great release'. */
  blurb: string
  /** Archetype key this comp is drawn from. */
  archetype: string
}

export interface BoomBustRisk {
  band: RiskBand
  upsideNote: string
}

export interface ScoutPanel {
  /** One entry per scout on the user's team. */
  reads: ScoutRead[]
  /** Majority tier across all scouts. */
  consensusTier: ProjectionTier
  consensusTierLabel: string
  /** Dissent note when scouts disagree; omitted when unanimous. */
  dissentNote?: string
  /** NHL-style player comp; omitted when knowledge < 50. */
  comp?: NhlComp
  /** Boom/bust risk band. */
  risk: BoomBustRisk
}

/* ─────────────────────── main builder ─────────────────────── */

/**
 * Build the full multi-scout panel for a player.
 *
 * @param scouts  The user team's scouts (from TeamStaff.scouts).
 * @param player  The player being viewed.
 * @param scouting  The current scouting state (for knowledge level).
 * @param potStars  Potential stars (0–5), as computed by buildViews.potentialStars.
 */
/**
 * A line describing what THIS scout saw the player do in a recent viewing —
 * anchored to his real season scoring pace, but nudged by the scout's lean (a
 * bullish scout remembers the big night; a bearish one the quiet one) and varied
 * per scout, so two scouts who caught different games file different reports.
 */
function watchedGameLine(scout: StaffMember, player: Player, ppg: number, estIdx: number, trueIdx: number): string {
  const key = scout.id + ':' + (player.id as string) + ':watched'
  if (player.position === 'G') {
    const lean = estIdx > trueIdx ? 0.25 : estIdx < trueIdx ? -0.25 : 0
    return hash01(key) + lean > 0.5
      ? 'Watched him steal a game — square to every shot, no rebounds.'
      : 'The night I caught him, a couple of soft ones got through.'
  }
  const lean = estIdx > trueIdx ? 0.6 : estIdx < trueIdx ? -0.5 : 0
  const pts = Math.max(0, Math.round(ppg + lean + (hash01(key) * 2 - 1) * 1.1))
  const goals = pts > 0 ? Math.min(pts, Math.round(pts * (0.3 + hash01(key + ':g') * 0.4))) : 0
  const assists = pts - goals
  const line = goals && assists ? `${goals}G ${assists}A` : goals ? `${goals}G` : assists ? `${assists}A` : 'no points'
  if (pts >= 3) return `Caught a big night — ${line}, drove play every shift.`
  if (pts === 2) return `Saw a strong showing — ${line}.`
  if (pts === 1) return `A quiet viewing — just ${line}.`
  return 'The game I watched, he was held off the scoresheet.'
}

export function buildScoutPanel(
  scouts: StaffMember[],
  player: Player,
  scouting: ScoutingState | undefined,
  potStars: number,
  /** The player's current-season scoring pace (points/game), for the "what I saw
   *  in a recent viewing" line. Omit when there's no game sample yet. */
  observed?: { ppg: number }
): ScoutPanel {
  const pid = player.id as string
  const knowledge = scouting !== undefined ? knowledgeOf(scouting, pid) : 100
  const ovr = ratedOverall(player)
  const composites = player.composites as unknown as Record<string, number>

  // True tier (hidden from the player; scouts' estimates vary around this)
  const trueTier = projectionTier(ovr, potStars, player.age)

  // If no scouts, synthesise a single "GM" read at full accuracy
  const effectiveScouts: StaffMember[] = scouts.length > 0 ? scouts : [
    {
      id: 'gm-default',
      name: 'GM (Self-scouted)',
      role: 'scout' as const,
      rating: 70,
      judgment: 80,
    },
  ]

  // "Prospect" is a status, not a projection — express both the true tier and each
  // scout's read as the value tier they project to, so every chip is a real
  // projection (Core/Key/Star…), never "Prospect".
  const trueDisplay: ProjectionTier = trueTier === 'Prospect' ? prospectQuality(potStars) : trueTier
  const reads: ScoutRead[] = effectiveScouts.map((scout) => {
    const tier = scoutTierEstimate(scout, player, trueTier, potStars, composites)
    const displayTier: ProjectionTier = tier === 'Prospect' ? prospectQuality(potStars) : tier
    const take = scoutOneLiner(scout, player, displayTier, trueDisplay)
    const read: ScoutRead = {
      scoutId: scout.id,
      scoutName: scout.name,
      tier: displayTier,
      tierLabel: TIER_LABELS[displayTier],
      take,
    }
    // What this scout saw the player do in a recent game he attended.
    if (observed) read.watched = watchedGameLine(scout, player, observed.ppg, tierIndex(displayTier), tierIndex(trueDisplay))
    if (scout.faceId !== undefined) {
      return { ...read, faceId: scout.faceId }
    }
    return read
  })

  const { consensusTier, dissentNote } = computeConsensus(reads)
  const comp = buildNhlComp(player, knowledge)
  const risk = computeRisk(player, potStars, trueTier, reads)

  const panel: ScoutPanel = {
    reads,
    consensusTier,
    consensusTierLabel: TIER_LABELS[consensusTier],
    risk,
  }
  if (dissentNote !== null) panel.dissentNote = dissentNote
  if (comp !== null) panel.comp = comp
  return panel
}
