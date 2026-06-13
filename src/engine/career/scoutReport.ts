/**
 * Scout report prose generator.
 *
 * Produces a human-written "General Impressions" paragraph for a player
 * based on their standout attributes, personality, and archetype.
 *
 * FOG-AWARE: at low knowledge the prose is sparse and hedged; at high knowledge
 * it is confident and detailed. A deterministically-seeded wrong read can occur
 * at low knowledge for personality phrases.
 *
 * Personality is ONLY surfaced through this prose — never as a raw table.
 *
 * NO Math.random / Date. All randomness is derived from hash(playerId + seed).
 */

import type { Player } from '@domain'
import type { ScoutingState } from '@domain/scouting'
import { knowledgeOf } from '@engine/league/scouting'
import { overall } from '@engine/ratings/composites'
import { ARCHETYPE_META, classifyArchetype } from '@engine/league/archetypes'

/* ────────────────────────── deterministic hash ────────────────────────── */

/** FNV-1a 32-bit returning [0, 1). Same approach as personalityRead.ts. */
function stableHash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h * 16777619) >>> 0
  }
  return (h % 10000) / 10000
}

/** Pick a stable item from an array using playerId + seed. */
function stablePick<T>(arr: T[], playerId: string, seed: string): T {
  const idx = Math.floor(stableHash01(playerId + ':' + seed) * arr.length)
  return arr[Math.max(0, Math.min(arr.length - 1, idx))]!
}

/* ────────────────────────── report card grade ────────────────────────── */

export type ReportGrade = 'A+' | 'A' | 'B+' | 'B' | 'C+' | 'C' | 'D' | 'F'

function gradeFrom(score: number, knowledge: number): ReportGrade {
  // At low knowledge, coarsen the grade (round to nearest full letter)
  let coarsen = 0
  if (knowledge < 30) coarsen = 2
  else if (knowledge < 60) coarsen = 1

  // score 0-100 → fine grade index 0-7 (F..A+)
  const fine =
    score >= 88 ? 7 :
    score >= 78 ? 6 :
    score >= 68 ? 5 :
    score >= 58 ? 4 :
    score >= 48 ? 3 :
    score >= 38 ? 2 :
    score >= 28 ? 1 :
    0

  const coarsened = Math.max(0, fine - coarsen)
  const GRADES: ReportGrade[] = ['F', 'D', 'C', 'C+', 'B', 'B+', 'A', 'A+']
  return GRADES[coarsened]!
}

/* ────────────────────────── projection tier ────────────────────────── */

export type ProjectionTier = 'Fringe' | 'Depth' | 'Core' | 'Key' | 'Star' | 'Prospect'

export function projectionTier(
  ovr: number,
  potentialStars: number,
  age: number
): ProjectionTier {
  // Young prospects assessed differently
  if (age <= 21 && potentialStars >= 3) return 'Prospect'
  if (ovr >= 80 || (ovr >= 72 && potentialStars >= 4)) return 'Star'
  if (ovr >= 68 || (ovr >= 60 && potentialStars >= 4)) return 'Key'
  if (ovr >= 58) return 'Core'
  if (ovr >= 46) return 'Depth'
  return 'Fringe'
}

/** EHM-style prose label for tier used in the chip. */
export const TIER_LABELS: Record<ProjectionTier, string> = {
  Prospect: 'Prospect',
  Star: 'Star Player',
  Key: 'Key Player',
  Core: 'Core Player',
  Depth: 'Depth Player',
  Fringe: 'Fringe Player',
}

/* ────────────────────────── season projection ────────────────────────── */

export interface SeasonProjection {
  /** Human-readable one-liner, e.g. "Projected for around 55–65 points" */
  line: string
}

function skaterPointProjection(ovr: number, role: string): SeasonProjection {
  // EHM-calibrated: an 80-overall top-liner projects ~80 pts, a 50-overall depth ~12 pts
  const base = Math.round(Math.pow(Math.max(0, (ovr - 40) / 60), 1.6) * 90)
  const roleBonus =
    role.toLowerCase().includes('top') || role.toLowerCase().includes('first') ? 10 :
    role.toLowerCase().includes('second') ? 3 :
    role.toLowerCase().includes('third') || role.toLowerCase().includes('fourth') ? -8 :
    0
  const proj = Math.max(2, base + roleBonus)
  const lo = Math.max(2, Math.round(proj * 0.85))
  const hi = Math.round(proj * 1.15)
  return { line: `Projected for around ${lo}–${hi} points this season` }
}

function goalieProjection(ovr: number): SeasonProjection {
  // GAA: elite goalies ~2.20, average ~3.00, poor ~3.80
  const gaa = Math.max(2.10, 4.20 - (ovr / 100) * 2.20)
  // SV%: elite .926, average .908, poor .888
  const svPct = Math.min(0.932, 0.880 + (ovr / 100) * 0.055)
  return {
    line: `Projected around .${Math.round(svPct * 1000)} SV% / ${gaa.toFixed(2)} GAA`,
  }
}

/* ────────────────────────── report card ────────────────────────── */

export interface ReportCard {
  hockeyIQ: ReportGrade
  skating: ReportGrade
  shotScoring: ReportGrade
  puckhandling: ReportGrade
  defence: ReportGrade
  physicality: ReportGrade
  /** Only present for goalies. */
  goaltending?: ReportGrade
}

function buildReportCard(p: Player, knowledge: number): ReportCard {
  const c = p.composites as unknown as Record<string, number>
  const m = p.ratings.mental as unknown as Record<string, number>
  const t = p.ratings.technical as unknown as Record<string, number>

  const hockeyIQScore = ((m['offensiveIQ'] ?? 50) + (m['defensiveIQ'] ?? 50) + (m['vision'] ?? 50) + (m['anticipation'] ?? 50)) / 4
  const skatingScore = c['skating'] ?? 50
  const shotScore = ((t['wristShot'] ?? 50) + (t['slapShot'] ?? 50) + (c['scoring'] ?? 50)) / 3
  const puckScore = ((t['stickhandling'] ?? 50) + (t['passing'] ?? 50) + (c['playmaking'] ?? 50)) / 3
  const defScore = ((c['defensiveZone'] ?? 50) + (c['takeaway'] ?? 50) + (m['positioning'] ?? 50)) / 3
  const physScore = ((c['hitting'] ?? 50) + (c['blocking'] ?? 50)) / 2

  const card: ReportCard = {
    hockeyIQ: gradeFrom(hockeyIQScore, knowledge),
    skating: gradeFrom(skatingScore, knowledge),
    shotScoring: gradeFrom(shotScore, knowledge),
    puckhandling: gradeFrom(puckScore, knowledge),
    defence: gradeFrom(defScore, knowledge),
    physicality: gradeFrom(physScore, knowledge),
  }

  if (p.position === 'G' && p.ratings.goalie) {
    const g = p.ratings.goalie as unknown as Record<string, number>
    const goalieScore = ((g['reflexes'] ?? 50) + (g['positioningG'] ?? 50) + (g['reboundControl'] ?? 50) + (g['glove'] ?? 50) + (g['blocker'] ?? 50)) / 5
    card.goaltending = gradeFrom(goalieScore, knowledge)
  }

  return card
}

/* ────────────────────────── prose generation ────────────────────────── */

interface PhraseSet {
  positive: string[]
  negative: string[]
}

const SKATING_PHRASES: PhraseSet = {
  positive: [
    'a good skater with good speed',
    'his skating is among the best in the league',
    'an exceptional skater who covers ice quickly',
    'tremendous skating ability — very difficult to stay with',
  ],
  negative: [
    'his skating limits his effectiveness',
    'a below-average skater who struggles to keep up at this level',
    'his lack of foot speed is a concern',
  ],
}

const WRIST_SHOT_PHRASES: PhraseSet = {
  positive: [
    'has a laser wristshot',
    'a quick release that goalies fear',
    'his wrist shot is a genuine weapon',
  ],
  negative: [],
}

const SLAP_SHOT_PHRASES: PhraseSet = {
  positive: [
    'a hard point shot that generates traffic chances',
    'can really put it on net from distance',
    'his slapshot is above average for his position',
  ],
  negative: [],
}

const PASSING_PHRASES: PhraseSet = {
  positive: [
    'consistently finds the right pass',
    'opens up tremendous ice with his passing',
    'an excellent distributor who elevates his linemates',
    'threads passes into impossible lanes',
  ],
  negative: [],
}

const VISION_PHRASES: PhraseSet = {
  positive: [
    'reads the play well and anticipates lanes others miss',
    'excellent hockey sense and awareness',
    'sees the ice brilliantly',
  ],
  negative: [],
}

const CHECKING_PHRASES: PhraseSet = {
  positive: [
    'extremely solid checking his man',
    'wins puck battles along the wall',
    'a reliable defensive presence',
  ],
  negative: [
    'his defensive game needs work',
    'not strong on the backcheck',
    'defensively he can be caught out of position',
  ],
}

const HITTING_PHRASES: PhraseSet = {
  positive: [
    'an imposing physical presence on the ice',
    'finishes every check and makes opponents pay',
    'brings a physical edge that changes games',
  ],
  negative: [],
}

const STRENGTH_PHRASES: PhraseSet = {
  positive: [
    'extremely strong on the puck',
    'very difficult to knock off the puck',
    'wins every board battle with sheer strength',
  ],
  negative: [],
}

const COMPOSURE_PHRASES: PhraseSet = {
  positive: [
    'stays calm in big moments',
    'thrives under pressure — a player you can trust in tight games',
  ],
  negative: [
    'his composure in high-pressure moments is a question mark',
  ],
}

const SCORING_PHRASES: PhraseSet = {
  positive: [
    'a prolific goal scorer with excellent instincts in front of net',
    'has a nose for the net — always in the right place at the right time',
    'a pure finisher who rarely wastes his opportunities',
  ],
  negative: [
    'his scoring rate is below what you need from his position',
  ],
}

const DEF_ZONE_PHRASES: PhraseSet = {
  positive: [
    'very reliable in his own end',
    'takes away time and space in the defensive zone',
    'can be trusted in all situations on the penalty kill',
  ],
  negative: [
    'his defensive zone coverage leaves something to be desired',
  ],
}

const GOALIE_REFLEXES_PHRASES: PhraseSet = {
  positive: [
    'outstanding reflexes — makes saves others cannot',
    'his reaction time is exceptional',
  ],
  negative: [],
}

const GOALIE_POSITIONING_PHRASES: PhraseSet = {
  positive: [
    'takes away angles brilliantly',
    'positionally very sound — rarely caught out of position',
    'reads the play early and squares up to shooters',
  ],
  negative: [],
}

const GOALIE_REBOUND_PHRASES: PhraseSet = {
  positive: [
    'controls his rebounds well',
    'rarely gives up second-chance opportunities',
  ],
  negative: [
    'his rebound control can be loose',
  ],
}

// Personality phrases — woven into the prose body
const DETERMINATION_HIGH = [
  'will do whatever it takes to win',
  'a relentless competitor who never gives up on a play',
  'brings an intensity that teammates feed off',
]
const PROFESSIONALISM_HIGH = [
  'a true professional in everything he does',
  'his dedication and preparation are exemplary',
]
const LOYALTY_HIGH = [
  'has shown tremendous loyalty to the organisation',
  'a player who bleeds for his club',
]
const FLAIR_HIGH = [
  "isn't afraid to try the spectacular",
  'has the flair to pull off the highlight-reel move',
  'can surprise you with a moment of individual brilliance',
]
const AGGRESSION_HIGH = [
  'plays with an edge — likes to agitate',
  'brings a combative style that gets under opponents\' skin',
]
const COMPOSURE_PERS_HIGH = [
  'is the kind of player you want on the ice in crunch time',
  'a calm head in the storm',
]

/* ────────────────────────── main generator ────────────────────────── */

export interface ScoutReportView {
  /** Human-written scout prose paragraph(s). */
  generalImpressions: string
  /** Projection tier label. */
  tier: ProjectionTier
  tierLabel: string
  /** Season outlook line. */
  seasonProjection: SeasonProjection
  /** A+..F report card per area (fogged at low knowledge). */
  reportCard: ReportCard
  /** 0–100 scouting knowledge at time of report generation. */
  knowledge: number
}

export function buildScoutReport(
  player: Player,
  scouting: ScoutingState | undefined,
  potStars: number
): ScoutReportView {
  const pid = player.id as string
  const knowledge = scouting !== undefined ? knowledgeOf(scouting, pid) : 100

  const ovr = overall(player.composites, player.position)
  const tier = projectionTier(ovr, potStars, player.age)
  const tierLabel = TIER_LABELS[tier]
  const reportCard = buildReportCard(player, knowledge)

  const seasonProjection: SeasonProjection =
    player.position === 'G'
      ? goalieProjection(ovr)
      : skaterPointProjection(ovr, player.role)

  // Build prose
  const prose = buildProse(player, knowledge, pid)

  return {
    generalImpressions: prose,
    tier,
    tierLabel,
    seasonProjection,
    reportCard,
    knowledge: Math.round(knowledge),
  }
}

function pickPhrase(phrases: string[], pid: string, seed: string): string | null {
  if (phrases.length === 0) return null
  return stablePick(phrases, pid, seed)
}

function buildProse(player: Player, knowledge: number, pid: string): string {
  const c = player.composites as unknown as Record<string, number>
  const t = player.ratings.technical as unknown as Record<string, number>
  const m = player.ratings.mental as unknown as Record<string, number>
  const phys = player.ratings.physical as unknown as Record<string, number>
  const g = player.ratings.goalie as unknown as Record<string, number> | undefined
  const pers = player.personality as unknown as Record<string, number>
  const flair = (player as unknown as Record<string, number | undefined>)['flair'] ?? 10
  const aggression = m['aggression'] ?? 10
  const composure = m['composure'] ?? 10

  const isGoalie = player.position === 'G'

  // Hedge phrases scale by knowledge
  const lowKnow = knowledge < 35
  const medKnow = knowledge < 65
  const highKnow = knowledge >= 80

  // Prefix hedges for uncertain reads
  const lookLike = lowKnow ? 'looks like ' : medKnow ? 'appears to be ' : ''
  const could = lowKnow ? 'could ' : ''
  const _ = (s: string) => s // identity passthrough

  const clauses: string[] = []

  if (isGoalie) {
    // Goalie-specific prose
    const reflexes = g?.['reflexes'] ?? 50
    const posG = g?.['positioningG'] ?? 50
    const rebounds = g?.['reboundControl'] ?? 50

    if (highKnow || reflexes >= 70) {
      if (reflexes >= 70) {
        const ph = pickPhrase(GOALIE_REFLEXES_PHRASES.positive, pid, 'reflex')
        if (ph) clauses.push(`${lookLike}${ph}`)
      }
    }
    if (posG >= 65) {
      const ph = pickPhrase(GOALIE_POSITIONING_PHRASES.positive, pid, 'posG')
      if (ph) clauses.push(ph)
    } else if (posG < 45 && (highKnow || !medKnow)) {
      const ph = pickPhrase(GOALIE_POSITIONING_PHRASES.negative, pid, 'posGn')
      if (ph) clauses.push(ph)
    }
    if (rebounds >= 65) {
      const ph = pickPhrase(GOALIE_REBOUND_PHRASES.positive, pid, 'reb')
      if (ph) clauses.push(ph)
    } else if (rebounds < 42) {
      const ph = pickPhrase(GOALIE_REBOUND_PHRASES.negative, pid, 'rebn')
      if (ph) clauses.push(ph)
    }
  } else {
    // Skater-specific prose
    const skating = c['skating'] ?? 50
    const wristShot = t['wristShot'] ?? 50
    const slapShot = t['slapShot'] ?? 50
    const passing = t['passing'] ?? 50
    const vision = m['vision'] ?? 50
    const checking = c['defensiveZone'] ?? 50
    const hitting = c['hitting'] ?? 50
    const strength = phys['strength'] ?? 50
    const scoring = c['scoring'] ?? 50

    // Skating (always commentated if notable)
    if (skating >= 68) {
      const ph = pickPhrase(SKATING_PHRASES.positive, pid, 'skate')
      if (ph) clauses.push(`${lookLike}${ph}`)
    } else if (skating < 40 && (highKnow || !lowKnow)) {
      const ph = pickPhrase(SKATING_PHRASES.negative, pid, 'skaten')
      if (ph) clauses.push(ph)
    }

    // Shot — only if notable
    if (wristShot >= 68) {
      const ph = pickPhrase(WRIST_SHOT_PHRASES.positive, pid, 'wrist')
      if (ph) clauses.push(ph)
    }
    if (slapShot >= 70 && player.position === 'D') {
      const ph = pickPhrase(SLAP_SHOT_PHRASES.positive, pid, 'slap')
      if (ph) clauses.push(ph)
    }

    // Scoring
    if (scoring >= 70) {
      const ph = pickPhrase(SCORING_PHRASES.positive, pid, 'score')
      if (ph) clauses.push(`${could}${ph}`)
    } else if (scoring < 40 && (highKnow || !lowKnow) && player.position !== 'D') {
      const ph = pickPhrase(SCORING_PHRASES.negative, pid, 'scoren')
      if (ph) clauses.push(ph)
    }

    // Passing / vision
    if (passing >= 68) {
      const ph = pickPhrase(PASSING_PHRASES.positive, pid, 'pass')
      if (ph) clauses.push(ph)
    }
    if (vision >= 70) {
      const ph = pickPhrase(VISION_PHRASES.positive, pid, 'vision')
      if (ph) clauses.push(ph)
    }

    // Defence
    if (checking >= 65) {
      const ph = pickPhrase(CHECKING_PHRASES.positive, pid, 'check')
      if (ph) clauses.push(ph)
    } else if (checking < 42 && highKnow && player.position !== 'D') {
      const ph = pickPhrase(CHECKING_PHRASES.negative, pid, 'checkn')
      if (ph) clauses.push(ph)
    }

    // Physicality
    if (hitting >= 70) {
      const ph = pickPhrase(HITTING_PHRASES.positive, pid, 'hit')
      if (ph) clauses.push(ph)
    }
    if (strength >= 72) {
      const ph = pickPhrase(STRENGTH_PHRASES.positive, pid, 'str')
      if (ph) clauses.push(ph)
    }

    // Composure attribute
    if (composure >= 70 && (highKnow || !lowKnow)) {
      const ph = pickPhrase(COMPOSURE_PHRASES.positive, pid, 'comp')
      if (ph) clauses.push(ph)
    } else if (composure < 40 && highKnow) {
      const ph = pickPhrase(COMPOSURE_PHRASES.negative, pid, 'compn')
      if (ph) clauses.push(ph)
    }
  }

  // ── Personality phrases (woven in, not tabled) ──
  // Only at medium+ knowledge; at low knowledge we may get a wrong read
  if (knowledge >= 30) {
    const deterHash = stableHash01(pid + ':det:wrong')
    const useWrongDet = knowledge < 50 && deterHash < 0.3
    const determination = useWrongDet
      ? 20 - (pers['determination'] ?? 10)  // invert for wrong read
      : (pers['determination'] ?? 10)

    if (determination >= 15) {
      clauses.push(stablePick(DETERMINATION_HIGH, pid, 'det'))
    }

    const professionalism = pers['professionalism'] ?? 10
    if (professionalism >= 16 && highKnow) {
      clauses.push(stablePick(PROFESSIONALISM_HIGH, pid, 'prof'))
    }

    const loyalty = pers['loyalty'] ?? 10
    if (loyalty >= 17 && (highKnow || !medKnow)) {
      clauses.push(stablePick(LOYALTY_HIGH, pid, 'loy'))
    }

    if (flair >= 16) {
      clauses.push(stablePick(FLAIR_HIGH, pid, 'flair'))
    }

    if (aggression >= 16) {
      clauses.push(stablePick(AGGRESSION_HIGH, pid, 'agg'))
    }

    const pressure = (player as unknown as Record<string, number | undefined>)['pressure'] ?? 10
    if (pressure >= 16 && highKnow) {
      clauses.push(stablePick(COMPOSURE_PERS_HIGH, pid, 'pres'))
    }
  }

  // ── Assemble ──
  if (clauses.length === 0) {
    if (knowledge < 25) {
      return `We have limited information on ${player.name} at this time. Further scouting is recommended before drawing conclusions.`
    }
    return `${player.name} is a ${player.age}-year-old ${player.role.toLowerCase()} with no standout qualities identified at current scouting levels.`
  }

  // At low knowledge, prefix with a hedge opener
  const opener =
    knowledge < 25
      ? `Early looks suggest ${player.name} `
      : knowledge < 50
        ? `From what we've seen, ${player.name} `
        : `${player.name} `

  // Join clauses: first clause is sentence after opener, rest are sentences
  const first = clauses[0]!
  const rest = clauses.slice(1)

  // Capitalise first letter of first clause
  const firstSentence = opener + first.charAt(0).toLowerCase() + first.slice(1) + '.'

  const restSentences = rest.map((cl, i) => {
    const capitalized = cl.charAt(0).toUpperCase() + cl.slice(1)
    // Every 2–3 clauses, start a new sentence. Otherwise separate with a comma.
    if (i % 2 === 0) return ' ' + capitalized + '.'
    return ' ' + capitalized + '.'
  }).join('')

  return firstSentence + restSentences
}
