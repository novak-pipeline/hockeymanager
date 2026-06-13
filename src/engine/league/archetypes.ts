/**
 * Player archetype classification + line-synergy model.
 *
 * Archetypes are derived from a player's composites + raw physical attributes.
 * They are purely descriptive (UI/coaching layer) — the sim engine reads
 * composites directly and is unaffected by archetype assignment.
 *
 * Synergy scores compose into the same 0.97–1.03 multiplier style as
 * chemistryModifier in lockerRoom.ts so callers can stack them
 * multiplicatively without touching the sim loop.
 *
 * All functions are deterministic; the optional Rng in teamStyleFit is
 * accepted for future stochastic extensions (currently unused).
 *
 * JSON-safe: all return types are plain objects with primitive fields.
 */

import type { Player } from '@domain'
import type { TeamTactics, ForecheckSystem } from '@domain'
import type { Rng } from '@engine/shared/rng'

/* ─────────────────────── archetype type ─────────────────────── */

export type Archetype =
  | 'sniper'
  | 'playmaker'
  | 'powerForward'
  | 'twoWayForward'
  | 'grinder'
  | 'enforcer'
  | 'offensiveDefenseman'
  | 'twoWayDefenseman'
  | 'shutdownDefenseman'
  | 'puckMover'
  | 'athleticGoalie'
  | 'positionalGoalie'

/* ─────────────────────── metadata ─────────────────────── */

export interface ArchetypeMeta {
  label: string
  blurb: string
  /** Key composite/raw attribute names that define this archetype (for UI). */
  primary: string[]
}

export const ARCHETYPE_META: Record<Archetype, ArchetypeMeta> = {
  sniper: {
    label: 'Sniper',
    blurb: 'A pure goal-scorer who thrives in open ice and on the power play. Elite shot mechanics; limited defensive contribution.',
    primary: ['scoring', 'wristShot', 'slapShot', 'offensiveIQ']
  },
  playmaker: {
    label: 'Playmaker',
    blurb: 'The quarterback of a forward line. Sees the ice brilliantly, threads passes into impossible lanes, and elevates linemates.',
    primary: ['playmaking', 'vision', 'passing', 'offensiveIQ']
  },
  powerForward: {
    label: 'Power Forward',
    blurb: 'Combines finishing ability with physical dominance. Wins puck battles along the boards and punishes defenders in front of the net.',
    primary: ['hitting', 'scoring', 'strength', 'puckControl']
  },
  twoWayForward: {
    label: 'Two-Way Forward',
    blurb: 'Reliable at both ends of the ice. Trusted in all situations — penalty kill, defensive-zone draws, tight late-game minutes.',
    primary: ['defensiveZone', 'takeaway', 'scoring', 'skating']
  },
  grinder: {
    label: 'Grinder',
    blurb: 'Energy and work rate over skill. Wins puck battles, finishes checks, and brings grit that skilled linemates cannot provide themselves.',
    primary: ['hitting', 'skating', 'workRate', 'blocking']
  },
  enforcer: {
    label: 'Enforcer',
    blurb: 'Physical deterrent who protects teammates. Fights when needed, finishes every check, and tilts ice presence in his team\'s favour.',
    primary: ['hitting', 'strength', 'aggression', 'penaltyProne']
  },
  offensiveDefenseman: {
    label: 'Offensive Defenseman',
    blurb: 'A blueliner who quarterbacks the power play and activates into the rush. Trades some defensive reliability for dangerous offence.',
    primary: ['scoring', 'playmaking', 'skating', 'vision']
  },
  twoWayDefenseman: {
    label: 'Two-Way Defenseman',
    blurb: 'Solid all-around blueliner. Contributes offensively without sacrificing defensive structure — the backbone of a reliable defence pairing.',
    primary: ['defensiveZone', 'playmaking', 'skating', 'takeaway']
  },
  shutdownDefenseman: {
    label: 'Shutdown Defenseman',
    blurb: 'Deployed against opponents\' top lines to suffocate scoring chances. Blocks shots, wins battles, and kills penalty minutes.',
    primary: ['defensiveZone', 'takeaway', 'blocking', 'hitting']
  },
  puckMover: {
    label: 'Puck Mover',
    blurb: 'A defenseman who transitions the puck quickly through the neutral zone. Skating and passing are his weapons; physicality is not.',
    primary: ['skating', 'playmaking', 'puckControl', 'passing']
  },
  athleticGoalie: {
    label: 'Athletic Goalie',
    blurb: 'Wins with elite reflexes and explosive lateral movement. Makes jaw-dropping saves that more positional goalies cannot reach.',
    primary: ['goaltending', 'reflexes', 'recovery', 'skating']
  },
  positionalGoalie: {
    label: 'Positional Goalie',
    blurb: 'Takes away angles by reading play and squaring to shooters. Rarely spectacular, rarely beaten clean — just relentlessly sound.',
    primary: ['goaltending', 'positioningG', 'reboundControl', 'anticipation']
  }
}

/* ─────────────────────── classification ─────────────────────── */

export interface ClassifyResult {
  archetype: Archetype
  /** 0–1: how strongly this player fits vs. a generic average. */
  confidence: number
  /** Short human-readable trait tags for use in UI tooltips / scouting reports. */
  descriptors: string[]
}

/**
 * Derive an archetype from composites + raw physical attributes + role.
 * Fully deterministic — no Rng involved.
 */
export function classifyArchetype(player: Player): ClassifyResult {
  const { composites: c, ratings: raw, position, role } = player

  /* ── goalies ── */
  if (position === 'G') {
    const reflexes = raw.goalie?.reflexes ?? 50
    const posG = raw.goalie?.positioningG ?? 50
    const recovery = raw.goalie?.recovery ?? 50
    const rebounds = raw.goalie?.reboundControl ?? 50

    // Athleticism score: reflexes + recovery + skating (limited for G)
    const athleticism = (reflexes * 0.45 + recovery * 0.35 + c.skating * 0.2)
    // Positional score: positioningG + rebound control
    const positional = (posG * 0.55 + rebounds * 0.45)

    const isAthletic = athleticism > positional + 5
    const archetype: Archetype = isAthletic ? 'athleticGoalie' : 'positionalGoalie'

    const descriptors: string[] = []
    if (reflexes >= 70) descriptors.push('elite reflexes')
    if (posG >= 70) descriptors.push('reads play well')
    if (rebounds >= 65) descriptors.push('controls rebounds')
    if (recovery >= 70) descriptors.push('explosive recovery')
    if (c.skating >= 55) descriptors.push('mobile')

    const spread = Math.abs(athleticism - positional)
    const confidence = Math.min(1, 0.5 + spread / 60)
    return { archetype, confidence, descriptors }
  }

  /* ── defensemen ── */
  if (position === 'D') {
    return classifyDefenseman(player)
  }

  /* ── forwards ── */
  return classifyForward(player)
}

function classifyDefenseman(player: Player): ClassifyResult {
  const { composites: c, ratings: raw } = player
  const speed = raw.physical.speed
  const strength = raw.physical.strength

  // Score each D archetype
  const offScore =
    c.scoring * 0.35 +
    c.playmaking * 0.35 +
    c.skating * 0.20 +
    raw.mental.vision * 0.10

  const shutdownScore =
    c.defensiveZone * 0.35 +
    c.takeaway * 0.25 +
    c.blocking * 0.20 +
    c.hitting * 0.20

  const puckMoverScore =
    c.skating * 0.35 +
    c.playmaking * 0.30 +
    c.puckControl * 0.20 +
    speed * 0.15

  const twoWayScore =
    c.defensiveZone * 0.30 +
    c.playmaking * 0.25 +
    c.skating * 0.25 +
    c.takeaway * 0.20

  const best = Math.max(offScore, shutdownScore, puckMoverScore, twoWayScore)
  let archetype: Archetype
  if (best === offScore) archetype = 'offensiveDefenseman'
  else if (best === puckMoverScore) archetype = 'puckMover'
  else if (best === shutdownScore) archetype = 'shutdownDefenseman'
  else archetype = 'twoWayDefenseman'

  // Differentiate offensiveDefenseman vs puckMover:
  // puckMover is speed + passing dominant but NOT a scorer
  if (archetype === 'offensiveDefenseman' && c.scoring < 50 && c.skating >= 60 && speed >= 65) {
    archetype = 'puckMover'
  }

  const descriptors: string[] = []
  if (c.scoring >= 65) descriptors.push('offensive upside')
  if (c.playmaking >= 65) descriptors.push('QB on the PP')
  if (c.skating >= 65 || speed >= 70) descriptors.push('skates well')
  if (c.defensiveZone >= 65) descriptors.push('sound defensively')
  if (c.blocking >= 65) descriptors.push('shot-blocker')
  if (c.takeaway >= 65) descriptors.push('puck-stealer')
  if (c.hitting >= 65 || strength >= 70) descriptors.push('physical')

  const second = [offScore, shutdownScore, puckMoverScore, twoWayScore]
    .filter(s => s !== best)
    .reduce((a, b) => Math.max(a, b), 0)
  const confidence = Math.min(1, 0.45 + (best - second) / 60)

  return { archetype, confidence, descriptors }
}

function classifyForward(player: Player): ClassifyResult {
  const { composites: c, ratings: raw, role } = player
  const speed = raw.physical.speed
  const strength = raw.physical.strength

  // Score each forward archetype
  const sniperScore =
    c.scoring * 0.50 +
    raw.technical.wristShot * 0.20 +
    raw.technical.slapShot * 0.10 +
    raw.mental.offensiveIQ * 0.20

  const playmakerScore =
    c.playmaking * 0.50 +
    raw.technical.passing * 0.20 +
    raw.mental.vision * 0.20 +
    raw.mental.offensiveIQ * 0.10

  const powerForwardScore =
    c.hitting * 0.30 +
    strength * 0.25 +
    c.scoring * 0.25 +
    c.puckControl * 0.20

  const twoWayScore =
    c.defensiveZone * 0.30 +
    c.takeaway * 0.20 +
    c.scoring * 0.20 +
    c.skating * 0.20 +
    c.puckControl * 0.10

  const grinderScore =
    c.hitting * 0.30 +
    c.skating * 0.25 +
    raw.mental.workRate * 0.25 +
    c.blocking * 0.20

  const enforcerScore =
    c.hitting * 0.40 +
    strength * 0.30 +
    raw.mental.aggression * 0.20 +
    c.penaltyProne * 0.10

  // role hint nudges the winning score by a small amount (prevents role-fighting
  // a clear composite winner)
  const roleNudge: Partial<Record<typeof role, Archetype>> = {
    sniper: 'sniper',
    playmaker: 'playmaker',
    powerForward: 'powerForward',
    twoWay: 'twoWayForward',
    enforcer: 'enforcer'
  }
  const hintArchetype = roleNudge[role]
  const nudge = 4 // minor; composites still dominate

  const scored: Array<{ archetype: Archetype; score: number }> = [
    { archetype: 'sniper', score: sniperScore + (hintArchetype === 'sniper' ? nudge : 0) },
    { archetype: 'playmaker', score: playmakerScore + (hintArchetype === 'playmaker' ? nudge : 0) },
    { archetype: 'powerForward', score: powerForwardScore + (hintArchetype === 'powerForward' ? nudge : 0) },
    { archetype: 'twoWayForward', score: twoWayScore + (hintArchetype === 'twoWayForward' ? nudge : 0) },
    { archetype: 'grinder', score: grinderScore },
    { archetype: 'enforcer', score: enforcerScore + (hintArchetype === 'enforcer' ? nudge : 0) }
  ]

  // Enforcer gate: must have very low scoring to not be classified as powerForward
  if (c.scoring >= 50) {
    const enfEntry = scored.find(s => s.archetype === 'enforcer')
    if (enfEntry) enfEntry.score -= 15
  }

  // Grinder vs powerForward: powerForward needs some scoring; grinder does not
  if (c.scoring < 42) {
    const pfEntry = scored.find(s => s.archetype === 'powerForward')
    if (pfEntry) pfEntry.score -= 10
  }

  scored.sort((a, b) => b.score - a.score)
  const winner = scored[0]
  const runnerUp = scored[1]

  const archetype = winner.archetype
  const confidence = Math.min(1, 0.45 + (winner.score - runnerUp.score) / 60)

  const descriptors: string[] = []
  if (raw.technical.wristShot >= 70 || raw.technical.slapShot >= 70) descriptors.push('high-end shot')
  if (c.playmaking >= 65) descriptors.push('sets up linemates')
  if (speed >= 70 || c.skating >= 68) descriptors.push('wheels')
  if (strength >= 70 || c.hitting >= 65) descriptors.push('plays big')
  if (c.defensiveZone >= 65 && c.takeaway >= 60) descriptors.push('two-way')
  if (c.hitting >= 70 && strength >= 70) descriptors.push('heavy')
  if (raw.mental.workRate >= 70) descriptors.push('high motor')
  if (c.puckControl >= 65) descriptors.push('puck skills')
  if (c.faceoffWin >= 65 && player.position === 'C') descriptors.push('dot specialist')

  return { archetype, confidence, descriptors }
}

/* ─────────────────────── line synergy ─────────────────────── */

export interface LineSynergyResult {
  /** 0–100 complementarity score. */
  score: number
  /** 0.97–1.03 multiplier composing into the same scale as chemistryModifier. */
  multiplier: number
  /** Human-readable reasons for the score (educational, UI-facing). */
  notes: string[]
}

const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v

/**
 * Rate a forward line (LW, C, RW) on complementarity.
 * Complementary mixes (playmaker sets up sniper; power forward opens ice)
 * score high. Redundant mixes (three snipers; three grinders) score low.
 */
export function lineSynergy(forwards: Player[]): LineSynergyResult {
  if (forwards.length !== 3) {
    return { score: 50, multiplier: 1.0, notes: ['Line must have exactly 3 forwards'] }
  }

  const archetypes = forwards.map(p => classifyArchetype(p).archetype)
  const composites = forwards.map(p => p.composites)

  let score = 50
  const notes: string[] = []

  // ── finishing presence ──
  // A line needs at least one reliable scorer
  const hasScorer = archetypes.some(a => a === 'sniper' || a === 'powerForward')
  if (!hasScorer) {
    score -= 12
    notes.push('No dedicated scorer — goals will be hard to come by')
  }

  // ── puck distribution / playmaking ──
  const hasPlaymaker = archetypes.some(a => a === 'playmaker' || a === 'twoWayForward')
  const highPlaymaking = composites.some(c => c.playmaking >= 60)
  if (!hasPlaymaker && !highPlaymaking) {
    score -= 8
    notes.push('No puck-distributor — line will struggle to generate quality chances')
  }

  // ── puck retrieval / battles ──
  // A pure sniper line starves for pucks if nobody wins battles
  const hasBattleWinner = archetypes.some(
    a => a === 'powerForward' || a === 'grinder' || a === 'enforcer'
  )
  const allOffensive = archetypes.every(a => a === 'sniper' || a === 'playmaker')
  if (allOffensive && !hasBattleWinner) {
    score -= 10
    notes.push('Three skill players with nobody to retrieve pucks in the corners')
  }

  // ── classic complementary combos ──
  // Playmaker centre + sniper wing is the golden pairing
  const hasPlaymakerC =
    forwards[1] !== undefined && classifyArchetype(forwards[1]).archetype === 'playmaker'
  const hasSniperWing =
    (forwards[0] !== undefined && classifyArchetype(forwards[0]).archetype === 'sniper') ||
    (forwards[2] !== undefined && classifyArchetype(forwards[2]).archetype === 'sniper')

  if (hasPlaymakerC && hasSniperWing) {
    score += 15
    const cName = forwards[1]?.name ?? 'Centre'
    const wName =
      (forwards[0] !== undefined && classifyArchetype(forwards[0]).archetype === 'sniper'
        ? forwards[0].name
        : forwards[2]?.name) ?? 'Wing'
    notes.push(`${cName} feeds ${wName}'s shot — a dangerous combination`)
  }

  // Power forward next to a playmaker frees up ice
  if (hasBattleWinner && hasPlaymaker) {
    score += 8
    notes.push('Physical presence creates space for the skill players')
  }

  // Two-way forward brings responsible structure to an offensive pair
  const twoWayCount = archetypes.filter(a => a === 'twoWayForward').length
  if (twoWayCount >= 1 && hasScorer) {
    score += 5
    notes.push('Defensive structure + finishing ability — a balanced mix')
  }

  // ── redundancy penalties ──
  const sniperCount = archetypes.filter(a => a === 'sniper').length
  if (sniperCount === 3) {
    score -= 18
    notes.push('Three snipers — nobody to win battles or protect the puck')
  } else if (sniperCount === 2 && !hasBattleWinner) {
    score -= 8
    notes.push('Two snipers with no physical presence — cycle game will suffer')
  }

  const grinderCount = archetypes.filter(
    a => a === 'grinder' || a === 'enforcer'
  ).length
  if (grinderCount === 3) {
    score -= 20
    notes.push('Three grinders — grit without finish; goals will be very scarce')
  } else if (grinderCount === 2) {
    score -= 8
    notes.push('Two grinders with limited scoring — depends heavily on one scorer')
  }

  const playmakerCount = archetypes.filter(a => a === 'playmaker').length
  if (playmakerCount === 3) {
    score -= 12
    notes.push('Three playmakers — overabundance of setup with nobody to shoot')
  }

  // ── average skating: mobile lines can pressure better ──
  const avgSkating = composites.reduce((s, c) => s + c.skating, 0) / composites.length
  if (avgSkating >= 68) {
    score += 5
    notes.push('Excellent team speed — can forecheck relentlessly')
  } else if (avgSkating < 48) {
    score -= 5
    notes.push('Slow line — will be hemmed in by mobile opponents')
  }

  score = clamp(score, 0, 100)
  // Map score 0–100 to multiplier 0.97–1.03 (linear)
  const multiplier = 0.97 + (score / 100) * 0.06
  const clampedMultiplier = clamp(multiplier, 0.97, 1.03)

  if (notes.length === 0) notes.push('Balanced line with no glaring strengths or weaknesses')

  return { score, multiplier: clampedMultiplier, notes }
}

/**
 * Rate a defensive pair (LD, RD) on complementarity.
 */
export interface PairSynergyResult {
  score: number
  multiplier: number
  notes: string[]
}

export function pairSynergy(defenders: Player[]): PairSynergyResult {
  if (defenders.length !== 2) {
    return { score: 50, multiplier: 1.0, notes: ['Pair must have exactly 2 defensemen'] }
  }

  const [ld, rd] = defenders
  if (ld === undefined || rd === undefined) {
    return { score: 50, multiplier: 1.0, notes: ['Pair must have exactly 2 defensemen'] }
  }

  const archetypes = [classifyArchetype(ld).archetype, classifyArchetype(rd).archetype]
  let score = 50
  const notes: string[] = []

  const offTypes: Archetype[] = ['offensiveDefenseman', 'puckMover']
  const defTypes: Archetype[] = ['shutdownDefenseman', 'twoWayDefenseman']

  const hasOffensive = archetypes.some(a => offTypes.includes(a))
  const hasDefensive = archetypes.some(a => defTypes.includes(a))

  // Classic pairing: one offensive/rushing D anchored by a defensive partner
  if (hasOffensive && hasDefensive) {
    score += 18
    const offD = offTypes.includes(archetypes[0]!) ? ld : rd
    const defD = defTypes.includes(archetypes[0]!) ? ld : rd
    notes.push(`${offD.name} can jump into the play while ${defD.name} holds position`)
  }

  // Two shutdown D — safe but limits offensive production
  const shutdownCount = archetypes.filter(a => a === 'shutdownDefenseman').length
  if (shutdownCount === 2) {
    score -= 12
    notes.push('Two shutdown D — very safe defensively but little offensive production')
  }

  // Two offensive D — exciting but leaves gaps defensively
  const offCount = archetypes.filter(a => offTypes.includes(a)).length
  if (offCount === 2) {
    score -= 10
    notes.push('Two offensive-minded D — dangerous in attack but vulnerable defensively')
  }

  // Two-way D pairing — solid floor, ceiling depends on offensive composites
  const twoWayCount = archetypes.filter(a => a === 'twoWayDefenseman').length
  if (twoWayCount === 2) {
    score += 6
    notes.push('Two reliable two-way D — balanced and dependable')
  }

  // Complementary mobility: one fast puck-mover with a stay-at-home partner
  const hasPuckMover = archetypes.includes('puckMover')
  const hasShutdown = archetypes.includes('shutdownDefenseman')
  if (hasPuckMover && hasShutdown) {
    score += 8
    notes.push('Puck-mover supplies transition speed; shutdown partner covers the gap')
  }

  // Average skating check
  const avgSkating = (ld.composites.skating + rd.composites.skating) / 2
  if (avgSkating >= 68) {
    score += 4
    notes.push('Mobile pairing — good transition play')
  } else if (avgSkating < 45) {
    score -= 6
    notes.push('Both D are slow — forwards will be isolated in the offensive zone')
  }

  score = clamp(score, 0, 100)
  const multiplier = clamp(0.97 + (score / 100) * 0.06, 0.97, 1.03)

  if (notes.length === 0) notes.push('Serviceable pairing with no obvious synergy')

  return { score, multiplier, notes }
}

/* ─────────────────────── team style suggestions ─────────────────────── */

export interface TeamStyleFitResult {
  suggestedTactics: Partial<TeamTactics>
  styleLabel: string
  rationale: string[]
}

/**
 * Read the roster's archetype and physical distribution and suggest a coherent
 * tactical system. Returns only the fields that should change (Partial<TeamTactics>).
 *
 * The Rng parameter is accepted for future stochastic extensions; currently
 * unused so all output is deterministic.
 */
export function teamStyleFit(args: {
  roster: Player[]
  rng?: Rng
}): TeamStyleFitResult {
  const { roster } = args

  // Classify every skater on the roster (ignore goalies for style)
  const skaters = roster.filter(p => p.position !== 'G')
  if (skaters.length === 0) {
    return {
      suggestedTactics: {},
      styleLabel: 'Unknown',
      rationale: ['No skaters on roster']
    }
  }

  const classified = skaters.map(p => classifyArchetype(p))
  const archetypeCounts: Partial<Record<Archetype, number>> = {}
  for (const { archetype } of classified) {
    archetypeCounts[archetype] = (archetypeCounts[archetype] ?? 0) + 1
  }

  const count = (a: Archetype): number => archetypeCounts[a] ?? 0
  const total = skaters.length

  // Physical averages
  const avgSpeed = skaters.reduce((s, p) => s + p.ratings.physical.speed, 0) / total
  const avgStrength = skaters.reduce((s, p) => s + p.ratings.physical.strength, 0) / total
  const avgSkating = skaters.reduce((s, p) => s + p.composites.skating, 0) / total
  const avgScoring = skaters.reduce((s, p) => s + p.composites.scoring, 0) / total

  // Aggregate archetype buckets
  const speedSkillCount = count('sniper') + count('playmaker') + count('puckMover')
  const heavyCount = count('powerForward') + count('grinder') + count('enforcer')
  const shutdownCount = count('shutdownDefenseman') + count('twoWayDefenseman')
  const offCount = count('offensiveDefenseman') + count('puckMover')

  const isSpeedSkillHeavy = speedSkillCount >= Math.floor(total * 0.35)
  const isPhysicalHeavy = heavyCount >= Math.floor(total * 0.35)
  // Only flag as slow/trap when the roster lacks both skill AND physical identity —
  // power-forward/enforcer rosters are intentionally slow; that is their style.
  const isOldOrSlow = avgSpeed < 52 && avgSkating < 52 && !isPhysicalHeavy

  const rationale: string[] = []
  let suggestedTactics: Partial<TeamTactics>
  let styleLabel: string

  if (isOldOrSlow) {
    // Slow/aging roster → trap + low tempo
    styleLabel = 'Trap'
    suggestedTactics = {
      forecheck: 'trap',
      tempo: {
        pace: 0.3,
        passRisk: 0.3,
        shotEagerness: 0.4,
        defensivePinch: 0.2
      }
    }
    rationale.push('Roster is slow or aging — conservative trap preserves energy and limits exposure')
    rationale.push('Low pace reduces the number of transitions opponents can exploit')
    if (avgScoring < 48) {
      rationale.push('Limited scoring depth — protect leads rather than chase games')
    }
  } else if (isSpeedSkillHeavy && !isPhysicalHeavy) {
    // Speed + skill → up-tempo rush/forecheck
    styleLabel = 'Speed & Skill'
    const forecheck: ForecheckSystem = avgSpeed >= 65 ? '1-2-2' : '2-1-2'
    suggestedTactics = {
      forecheck,
      tempo: {
        pace: 0.75,
        passRisk: 0.55,
        shotEagerness: 0.65,
        defensivePinch: 0.45
      }
    }
    rationale.push(`${speedSkillCount} speed/skill forwards — up-tempo game maximises their advantage`)
    rationale.push('Aggressive forecheck uses skating to create turnovers in the offensive zone')
    if (avgSpeed >= 65) {
      rationale.push('Elite team speed supports a 1-2-2 forecheck that traps pucks high')
    }
    if (offCount >= 2) {
      rationale.push('Offensive D can pinch effectively to support this attack-first system')
    }
  } else if (isPhysicalHeavy) {
    // Big physical roster → heavy cycle / power forecheck
    styleLabel = 'Cycle & Grind'
    suggestedTactics = {
      forecheck: '2-1-2',
      tempo: {
        pace: 0.45,
        passRisk: 0.4,
        shotEagerness: 0.55,
        defensivePinch: shutdownCount >= 3 ? 0.3 : 0.5
      }
    }
    rationale.push(`${heavyCount} physical forwards — 2-1-2 forecheck uses size to win puck battles`)
    rationale.push('Moderate pace keeps big bodies fresh and lets the cycle game wear opponents down')
    if (avgStrength >= 60) {
      rationale.push('High team strength makes the corners and front of the net a weapon')
    }
    if (shutdownCount >= 3) {
      rationale.push('Shutdown D keeps defensive pinching conservative — protect the lead')
    }
  } else {
    // Balanced roster → versatile system
    styleLabel = 'Balanced'
    suggestedTactics = {
      forecheck: '2-1-2',
      tempo: {
        pace: 0.55,
        passRisk: 0.45,
        shotEagerness: 0.55,
        defensivePinch: 0.4
      }
    }
    rationale.push('Well-rounded roster suits a versatile 2-1-2 forecheck that works in most matchups')
    rationale.push('Moderate tempo leaves tactical flexibility — adjust by game situation')
  }

  return { suggestedTactics, styleLabel, rationale }
}

/* ─────────────────────── per-player system fit ─────────────────────── */

export type TeamStyleKind = 'trap' | 'speedSkill' | 'cycleGrind' | 'balanced'

/** Classify a team's *current tactics* into a coaching style. */
export function styleFromTactics(tactics: TeamTactics): { kind: TeamStyleKind; label: string } {
  const pace = tactics.tempo.pace
  if (tactics.forecheck === 'trap' || pace < 0.4) return { kind: 'trap', label: 'Defensive / Trap' }
  if (pace >= 0.65) return { kind: 'speedSkill', label: 'Speed & Skill' }
  if (tactics.forecheck === '2-1-2' && pace <= 0.52) return { kind: 'cycleGrind', label: 'Cycle & Grind' }
  return { kind: 'balanced', label: 'Balanced' }
}

/** Archetype → 0-100 base fit for each coaching style. */
const STYLE_FIT: Record<TeamStyleKind, Partial<Record<Archetype, number>>> = {
  speedSkill: {
    sniper: 90, playmaker: 90, puckMover: 88, offensiveDefenseman: 82, twoWayForward: 72,
    twoWayDefenseman: 66, powerForward: 60, shutdownDefenseman: 50, grinder: 46, enforcer: 30,
  },
  cycleGrind: {
    powerForward: 90, grinder: 86, enforcer: 76, twoWayForward: 72, shutdownDefenseman: 72,
    twoWayDefenseman: 68, sniper: 56, playmaker: 56, offensiveDefenseman: 56, puckMover: 50,
  },
  trap: {
    shutdownDefenseman: 92, twoWayDefenseman: 86, twoWayForward: 82, grinder: 72, puckMover: 66,
    powerForward: 62, playmaker: 60, offensiveDefenseman: 56, sniper: 54, enforcer: 56,
  },
  balanced: {
    twoWayForward: 80, twoWayDefenseman: 80, playmaker: 74, sniper: 72, puckMover: 72,
    powerForward: 72, offensiveDefenseman: 72, shutdownDefenseman: 72, grinder: 66, enforcer: 58,
  },
}

export interface PlayerStyleFitResult {
  /** 0–100 fit of this player in the team's current system. */
  score: number
  label: string
  /** One-line plain-English reason. */
  reason: string
  /** Team style the fit was measured against. */
  styleLabel: string
}

/**
 * Score how well one player suits the team's current tactical system. Pure +
 * deterministic; descriptive only (the sim is unaffected). Goalies return null —
 * system fit is a skater concept.
 */
export function playerStyleFit(player: Player, tactics: TeamTactics): PlayerStyleFitResult | null {
  if (player.position === 'G') return null
  const style = styleFromTactics(tactics)
  const { archetype } = classifyArchetype(player)
  let score = STYLE_FIT[style.kind][archetype] ?? 65

  // Attribute nudge: the trait the style leans on, relative to league-average 50.
  const c = player.composites
  let lever: number
  if (style.kind === 'speedSkill') lever = c.skating
  else if (style.kind === 'cycleGrind') lever = (c.hitting + player.ratings.physical.strength) / 2
  else if (style.kind === 'trap') lever = c.defensiveZone
  else lever = (c.skating + c.defensiveZone) / 2
  score += clamp((lever - 50) * 0.25, -12, 12)

  score = Math.round(clamp(score, 0, 100))

  const meta = ARCHETYPE_META[archetype]
  let label: string
  if (score >= 80) label = 'Excellent fit'
  else if (score >= 66) label = 'Good fit'
  else if (score >= 50) label = 'Adequate'
  else label = 'Poor fit'

  const reason =
    score >= 66
      ? `A ${meta.label.toLowerCase()} thrives in a ${style.label.toLowerCase()} system.`
      : score >= 50
        ? `A ${meta.label.toLowerCase()} can play in a ${style.label.toLowerCase()} system but isn't ideal.`
        : `A ${meta.label.toLowerCase()} is a poor match for a ${style.label.toLowerCase()} system.`

  return { score, label, reason, styleLabel: style.label }
}

/* ─────────────────────── style match ─────────────────────── */

export interface StyleMatchResult {
  /** 0–100: how well current tactics align with the roster's strengths. */
  fit: number
  /** Actionable suggestions to close the gap between tactics and roster. */
  advice: string[]
}

/**
 * Score how well a team's current tactics fit their roster archetype
 * distribution. Returns advice to improve the match.
 */
export function styleMatch(roster: Player[], tactics: TeamTactics): StyleMatchResult {
  const suggestion = teamStyleFit({ roster })
  const suggestedTempo = suggestion.suggestedTactics.tempo
  const suggestedForecheck = suggestion.suggestedTactics.forecheck

  let fit = 70 // default "serviceable" baseline
  const advice: string[] = []

  // Forecheck mismatch
  if (suggestedForecheck !== undefined && suggestedForecheck !== tactics.forecheck) {
    // How mismatched? Check the actual roster characteristics
    const skaters = roster.filter(p => p.position !== 'G')
    const total = skaters.length || 1
    const avgSpeed = skaters.reduce((s, p) => s + p.ratings.physical.speed, 0) / total
    const avgStrength = skaters.reduce((s, p) => s + p.ratings.physical.strength, 0) / total

    if (tactics.forecheck === 'trap' && avgSpeed >= 62) {
      fit -= 15
      advice.push(`Your mobile roster is wasted in a trap — a ${suggestedForecheck} forecheck would let them attack`)
    } else if (tactics.forecheck !== 'trap' && avgSpeed < 50) {
      fit -= 12
      advice.push(`Slow roster running an aggressive forecheck — players will tire quickly; consider the trap`)
    } else if (tactics.forecheck === '1-2-2' && avgSpeed < 60) {
      fit -= 8
      advice.push(`1-2-2 needs elite team speed — a 2-1-2 might fit your skating better`)
    } else if (tactics.forecheck === '2-1-2' && avgStrength < 50) {
      fit -= 6
      advice.push(`2-1-2 cycle game suits bigger bodies — your roster may struggle to win puck battles`)
    } else {
      fit -= 5
      advice.push(`Consider switching to a ${suggestedForecheck} forecheck to better match your roster`)
    }
  }

  // Tempo mismatch — compare pace slider
  if (suggestedTempo !== undefined) {
    const paceDiff = Math.abs(tactics.tempo.pace - suggestedTempo.pace)
    if (paceDiff > 0.25) {
      fit -= Math.round(paceDiff * 20)
      if (tactics.tempo.pace > suggestedTempo.pace + 0.25) {
        advice.push(`Pace is set too high for your roster's speed/stamina — lower it to reduce late-game fatigue`)
      } else {
        advice.push(`Your mobile roster can handle a higher tempo — raise pace to stress opponents`)
      }
    }

    const eagDiff = Math.abs(tactics.tempo.shotEagerness - suggestedTempo.shotEagerness)
    if (eagDiff > 0.2) {
      fit -= Math.round(eagDiff * 10)
      if (tactics.tempo.shotEagerness < suggestedTempo.shotEagerness - 0.2) {
        advice.push(`Shot eagerness is low for a scoring-heavy roster — give your snipers the green light`)
      } else {
        advice.push(`Your playmaking-heavy roster benefits from more patient puck movement before shooting`)
      }
    }

    const pinchDiff = Math.abs(tactics.tempo.defensivePinch - suggestedTempo.defensivePinch)
    if (pinchDiff > 0.2) {
      fit -= Math.round(pinchDiff * 8)
      if (tactics.tempo.defensivePinch > suggestedTempo.defensivePinch + 0.2) {
        advice.push(`Defensive pinching is aggressive for your D corps — risks odd-man rushes against`)
      } else {
        advice.push(`Your offensive D can safely pinch more — increase defensivePinch for more zone time`)
      }
    }
  }

  fit = clamp(fit, 0, 100)
  if (advice.length === 0) {
    advice.push('Tactics are well matched to your roster — no changes recommended')
  }

  return { fit, advice }
}
