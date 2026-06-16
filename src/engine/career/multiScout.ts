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
type PosGroup = 'F' | 'D' | 'G'
function posGroup(pos: string): PosGroup {
  if (pos === 'G') return 'G'
  if (pos === 'D' || pos === 'LD' || pos === 'RD') return 'D'
  return 'F'
}

/**
 * Tier-anchored takes, POSITION-AWARE and deep enough that a room of ~25 scouts
 * doesn't read as a wall of the same sentence. The verbal read always MATCHES the
 * chip the scout files (a "Key Player" chip never reads like a depth piece), and
 * the language fits the position (a winger isn't described as "plays big minutes
 * in all situations" — that's a defenceman's line).
 */
const TAKES: Record<PosGroup, Record<ProjectionTier, string[]>> = {
  F: {
    Star: [
      'Elite — a game-breaker every time he\'s on the ice.',
      'A franchise forward; you build the top six around him.',
      'The best forward on most sheets he skates on.',
      'Drives play and finishes — a true number-one forward.',
      'A dynamic, dangerous scorer at the top of any lineup.',
      'Elite skill — he tilts the ice every shift.',
    ],
    Key: [
      'A high-end top-six forward who drives results.',
      'A real scoring threat you lean on every night.',
      'Top-of-the-lineup forward — produces and creates.',
      'A reliable point producer in a featured role.',
      'A difference-maker on a scoring line.',
      'Plays up the lineup and delivers offence.',
    ],
    Core: [
      'A dependable middle-six forward.',
      'An honest two-way forward — rarely a liability.',
      'A solid everyday contributor through the middle.',
      'A useful complementary scorer.',
      'A reliable regular who chips in offence.',
    ],
    Depth: [
      'A useful bottom-six forward in a defined role.',
      'A fourth-line energy forward who does the little things.',
      'A checking-line piece — won\'t move the needle offensively.',
      'A role forward who forechecks hard and eats minutes.',
    ],
    Fringe: [
      'A tweener forward fighting to hold an NHL job.',
      'An AHL/NHL bubble forward; depth insurance at best.',
    ],
  },
  D: {
    Star: [
      'Elite — a true number-one defenceman.',
      'A franchise blueliner who logs every situation.',
      'A game-changing defenceman you build around.',
      'Drives play from the back end — a special talent.',
      'The best defenceman on most sheets he plays.',
    ],
    Key: [
      'A top-pairing defenceman you lean on every night.',
      'Plays big minutes in all situations and delivers.',
      'A real top-four blueliner who moves the puck and defends.',
      'A trusted two-way defenceman up the lineup.',
      'A high-end blueliner who eats tough minutes.',
    ],
    Core: [
      'A dependable everyday defenceman.',
      'An honest middle-pairing blueliner — rarely a liability.',
      'A solid second/third-pair contributor.',
      'A steady, reliable defender.',
    ],
    Depth: [
      'A useful depth defenceman in a sheltered role.',
      'A bottom-pair blueliner who keeps it simple.',
      'A seventh-defenceman type — depth insurance.',
    ],
    Fringe: [
      'A tweener blueliner fighting to hold a job.',
      'An AHL/NHL bubble defenceman at best.',
    ],
  },
  G: {
    Star: [
      'Elite — a franchise starting goaltender.',
      'A true number-one who steals games.',
      'A game-changing goaltender you build around.',
    ],
    Key: [
      'A reliable starting goaltender.',
      'A high-end netminder who gives you a chance every night.',
      'A clear starter you can lean on.',
    ],
    Core: [
      'A dependable goaltender — a solid tandem or 1B option.',
      'An honest netminder who keeps you in games.',
      'A steady tandem goaltender.',
    ],
    Depth: [
      'A useful backup goaltender.',
      'A depth netminder — spot-start insurance.',
    ],
    Fringe: [
      'An AHL/NHL bubble goaltender at best.',
    ],
  },
}

// Safety net — the panel remaps Prospect → a value tier first, so this is rarely hit.
const PROSPECT_TAKES = [
  'Raw, but the ceiling is real — needs development time.',
  'You\'re betting on projection, not what he is today.',
]

function takesFor(tier: ProjectionTier, pos: string): string[] {
  if (tier === 'Prospect') return PROSPECT_TAKES
  return TAKES[posGroup(pos)][tier] ?? TAKES[posGroup(pos)].Core
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
  const base = stablePick(takesFor(displayTier, player.position), key)
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

  // Upside note — position-aware ("top-four" is a defenceman's term; a forward
  // tops out "top-six", a goalie as a "starter").
  const highCeil = player.position === 'G' ? 'starting-goaltender upside'
    : player.position === 'D' || player.position === 'LD' || player.position === 'RD' ? 'top-pairing upside'
    : 'top-six upside'
  let upsideNote: string
  if (trueTier === 'Star' || potStars >= 5) {
    upsideNote = 'Star-level upside if development goes well.'
  } else if (trueTier === 'Prospect' || potStars >= 4) {
    upsideNote = `${highCeil.charAt(0).toUpperCase()}${highCeil.slice(1)} — high-ceiling projection.`
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
    const verb = dissenterCount === 1 ? 'is' : 'are'
    dissentNote = `${topCount} of ${reads.length} scouts see ${TIER_LABELS[consensusTier]} upside; ${dissenterWord} ${verb} more ${direction === 'higher' ? 'bullish' : 'cautious'}.`
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
const VIEW_MONTHS = ['Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
function formatTOI(minutes: number): string {
  const m = Math.floor(minutes)
  const s = Math.floor((minutes - m) * 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

/**
 * A scout's note from a specific game he caught: a dated box line (TOI, G, A, P —
 * or SV%/GA for a goalie) plus a short, POSITION-AWARE read of what he picked up.
 * Anchored to the player's real per-game pace, nudged by the scout's lean, and
 * varied per scout so two scouts who saw different games file different lines. A
 * defenceman's pointless night is a steady two-way shift, not a "quiet viewing".
 */
function watchedGameLine(scout: StaffMember, player: Player, ppg: number, estIdx: number, trueIdx: number): string {
  const key = scout.id + ':' + (player.id as string) + ':watched'
  const date = `${stablePick(VIEW_MONTHS, key + ':m')} ${1 + Math.floor(hash01(key + ':d') * 27)}`

  if (player.position === 'G') {
    const lean = estIdx > trueIdx ? 0.012 : estIdx < trueIdx ? -0.012 : 0
    const sv = Math.max(0.86, Math.min(0.96, 0.905 + (hash01(key + ':sv') * 2 - 1) * 0.03 + lean))
    const ga = Math.max(0, Math.round((1 - sv) * 30))
    const qual = sv >= 0.925 ? 'stood tall, controlled his rebounds' : sv < 0.89 ? 'a couple he’d want back' : 'a steady, composed night'
    return `${date} · .${Math.round(sv * 1000)} SV, ${ga} GA — ${qual}`
  }

  const isD = player.position === 'D' || player.position === 'LD' || player.position === 'RD'
  const lean = estIdx > trueIdx ? 0.5 : estIdx < trueIdx ? -0.4 : 0
  const pts = Math.max(0, Math.round(ppg + lean + (hash01(key) * 2 - 1)))
  const goals = pts > 0 ? Math.min(pts, Math.round(pts * (isD ? 0.25 : 0.42) + hash01(key + ':g') * 0.45)) : 0
  const assists = pts - goals
  const toi = formatTOI((isD ? 20 : ppg >= 0.8 ? 16 : 12) + hash01(key + ':t') * (isD ? 6 : 4))
  const box = `${toi} TOI · ${goals}G ${assists}A ${pts}P`
  const qual = isD
    ? (pts >= 2 ? 'quarterbacked the play' : pts === 1 ? 'chipped in and defended well' : 'a steady two-way night, heavy minutes')
    : (pts >= 3 ? 'drove the game' : pts === 2 ? 'dangerous all night'
      : pts === 1 ? (goals >= 1 ? 'took his one chance, quiet otherwise' : 'a quieter night, one helper')
      : 'kept off the scoresheet')
  return `${date} · ${box} — ${qual}`
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
