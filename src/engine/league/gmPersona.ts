/**
 * AI GM personas — Living World LW2 (docs/LIVING-WORLD.md).
 *
 * Every AI club gets a NAMED general manager with a persistent personality:
 * trait axes that will drive trade initiation, free-agency style, draft
 * philosophy and deadline behaviour (wired in LW3). The league becomes a cast
 * of characters — "Marcus Webb always overpays at the deadline" — instead of
 * 31 copies of the same logic.
 *
 * Pure + deterministic: personas derive from (seed, teamId) so the same career
 * always meets the same GMs; state is JSON-safe and persisted in the snapshot
 * so names/styles never drift mid-save.
 */
import { Rng, deriveSeed } from '@engine/shared/rng'
import { FIRST_NAMES, LAST_NAMES } from '@data/names'

/* ────────────────────────── types ────────────────────────── */

export interface GmPersona {
  /** Stable id: `gm-${teamId}`. */
  id: string
  teamId: string
  name: string
  /** Trait axes, 0–1. 0.5 is league-average. */
  aggression: number     // initiation frequency + overpay willingness
  patience: number       // resists panic moves, tolerates long rebuilds
  riskTolerance: number  // boom/bust prospects, variance in offers
  pickHoarding: number   // values draft capital above the curve
  loyalty: number        // resists trading own draftees, re-signs veterans
  capDiscipline: number  // avoids cap tightness, prizes contract surplus
  analyticsLean: number  // 0 = old-school scout gut, 1 = model-driven
  /** Short public reputation used by news ("aggressive win-now dealer"). */
  styleLabel: string
  /** Year he took the job (for tenure references). */
  sinceYear: number
  /** 0 (or absent) = the GM the career opened with; each successor +1. Salts
   *  the persona roll so a new man is a genuinely different operator. */
  generation?: number
  /** Consecutive disappointing seasons on his watch (gmCarousel.ts). */
  missStreak?: number
  /** Set when ownership dismissed him and the chair is still empty; the
   *  persona is replaced outright when the successor is named. */
  dismissedYear?: number
  /** The stance he committed to at the last checkpoint (optional — older saves
   *  start with none and commit at the next checkpoint). */
  postureMemory?: PostureMemory
}

/** A club's seasonal stance — recomputed from roster shape, not hand-set. */
export type PostureKind = 'contend' | 'retool' | 'rebuild'

export interface ClubPosture {
  posture: PostureKind
  /** One factual line explaining the read ("aging core, bottom-third strength"). */
  reason: string
}

/** [teamId, persona] — snapshot-friendly. */
export type GmPersonaState = Array<[string, GmPersona]>

/* ────────────────────────── generation ────────────────────────── */

const GM_NS = 8311

/** Deterministically build the persona for one club. */
export function buildGmPersona(args: {
  seed: number
  teamId: string
  year: number
  /** Names already in use (coaches etc.) so the GM doesn't collide. */
  takenNames?: ReadonlySet<string>
  /** Successor number (E3 front-office carousel). 0/absent = the original GM,
   *  whose roll is unchanged so existing careers meet the same people. */
  generation?: number
}): GmPersona {
  const gen = args.generation ?? 0
  const rng = new Rng(
    gen > 0
      ? deriveSeed(args.seed, GM_NS, hashId(args.teamId), gen)
      : deriveSeed(args.seed, GM_NS, hashId(args.teamId))
  )
  let name = `${FIRST_NAMES[rng.int(FIRST_NAMES.length)]!} ${LAST_NAMES[rng.int(LAST_NAMES.length)]!}`
  for (let i = 0; args.takenNames?.has(name) && i < 20; i++) {
    name = `${FIRST_NAMES[rng.int(FIRST_NAMES.length)]!} ${LAST_NAMES[rng.int(LAST_NAMES.length)]!}`
  }
  const axis = (): number => Math.round(rng.float(0.08, 0.92) * 100) / 100
  const persona: GmPersona = {
    id: gen > 0 ? `gm-${args.teamId}-${gen}` : `gm-${args.teamId}`,
    teamId: args.teamId,
    name,
    aggression: axis(),
    patience: axis(),
    riskTolerance: axis(),
    pickHoarding: axis(),
    loyalty: axis(),
    capDiscipline: axis(),
    analyticsLean: axis(),
    styleLabel: '',
    sinceYear: args.year,
    ...(gen > 0 ? { generation: gen } : {}),
  }
  persona.styleLabel = styleLabel(persona)
  return persona
}

function hashId(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return h
}

/** Human-readable style from the two most extreme axes. */
export function styleLabel(p: GmPersona): string {
  const traits: Array<{ v: number; hi: string; lo: string }> = [
    { v: p.aggression, hi: 'aggressive dealer', lo: 'cautious operator' },
    { v: p.pickHoarding, hi: 'draft-capital hoarder', lo: 'picks-for-players trader' },
    { v: p.loyalty, hi: 'loyal to his own', lo: 'sentiment-free mover' },
    { v: p.capDiscipline, hi: 'cap surgeon', lo: 'cap gambler' },
    { v: p.analyticsLean, hi: 'analytics believer', lo: 'old-school scout' },
    { v: p.riskTolerance, hi: 'swing-for-the-fences type', lo: 'floor-over-ceiling type' },
  ]
  // Most extreme axis defines the label; second-most adds colour when strong.
  const scored = traits
    .map((t) => ({ label: t.v >= 0.5 ? t.hi : t.lo, extremity: Math.abs(t.v - 0.5) }))
    .sort((a, b) => b.extremity - a.extremity)
  const first = scored[0]!
  const second = scored[1]!
  return second.extremity > 0.3 ? `${first.label}, ${second.label}` : first.label
}

/* ────────────────────────── club posture ────────────────────────── */

/**
 * Derive a club's competitive stance from observable roster facts.
 * Inputs are precomputed by the career layer so this stays pure.
 */
export function deriveClubPosture(args: {
  /** Average age of the club's top-6 by overall ("the core"). */
  coreAge: number
  /** 1 = strongest roster in the league. */
  strengthRank: number
  teamCount: number
}): ClubPosture {
  const third = args.teamCount / 3
  const strongThird = args.strengthRank <= third
  const weakThird = args.strengthRank > args.teamCount - third
  if (strongThird) {
    return {
      posture: 'contend',
      reason: args.coreAge >= 30
        ? 'top-third roster with an aging core — the window is now'
        : 'top-third roster in its prime',
    }
  }
  if (weakThird) {
    return args.coreAge >= 29
      ? { posture: 'rebuild', reason: 'bottom-third strength and an old core; time to tear down' }
      : { posture: 'rebuild', reason: 'bottom-third strength, accumulating young assets' }
  }
  if (args.coreAge >= 31) {
    return { posture: 'retool', reason: 'mid-pack with an aging core — retooling on the fly' }
  }
  return { posture: 'retool', reason: 'mid-pack, keeping options open' }
}

/* ────────────────────────── future wiring (LW3) ────────────────────────── */

/**
 * Map persona + posture onto the existing trade-AI philosophy enum.
 * NOT wired yet — LW3 swaps the hash-based teamPhilosophy for this, with its
 * own behaviour tests. Exported now so the mapping is designed alongside the
 * persona and stays stable.
 */
export function personaPhilosophy(
  p: GmPersona,
  posture: PostureKind
): 'WinNow' | 'FavorYoung' | 'RebuildProspects' | 'RebuildDraft' | 'Balanced' {
  if (posture === 'contend') return p.aggression >= 0.4 ? 'WinNow' : 'Balanced'
  if (posture === 'rebuild') return p.pickHoarding >= 0.5 ? 'RebuildDraft' : 'RebuildProspects'
  return p.analyticsLean >= 0.6 || p.riskTolerance >= 0.6 ? 'FavorYoung' : 'Balanced'
}

/* ────────────────────────── the live posture (LW-econ) ────────────────────────── */

/**
 * A GM's remembered stance — the posture he committed to at the last checkpoint
 * (season open, deadline morning, the June window) and the year he committed.
 * Persisted on the persona so a patient rebuild does not flip back to "retool"
 * the first week the club wins three straight.
 */
export interface PostureMemory {
  posture: PostureKind
  since: number
}

/** Where a club sits in the live table, projected over a full season. */
export interface TableRead {
  gamesPlayed: number
  /** Projected points minus the projected conference playoff line (+ = in). */
  paceGap: number
  /** Projected points behind the conference leader (0 = leading). */
  leaderGap: number
}

export interface LivePosture extends ClubPosture {
  /** −1 (bottom-feeder) … +1 (juggernaut): the blended read the stance came from. */
  score: number
  /** The stance was pushed by the GM's character, not the numbers alone. */
  personaDriven?: 'allIn' | 'patientRebuild' | 'stickyWindow'
}

const clamp1 = (v: number): number => Math.max(-1, Math.min(1, v))

/**
 * A club's stance read from BOTH its roster and the table, filtered through the
 * GM who runs it. This replaces the strength-thirds formula for AI clubs: a
 * third of the league is no longer contending by construction.
 *
 *  - Early season the roster read dominates; by the deadline the table does
 *    (a club eight points clear of the line is a buyer whatever its paper rank).
 *  - Aggression lowers the bar to "go for it" — and an aggressive GM sharing a
 *    conference with the reigning champion goes all in from the bubble.
 *  - Patience makes a rebuild sticky: a patient GM stays the course for at least
 *    two seasons and until the club is genuinely good, an impatient one bails.
 *  - A committed contender does not sell at the first slump (sticky window).
 *
 * Pure. Without `table` / `persona` / `memory` it reduces to a continuous
 * version of the old thirds rule.
 */
export function deriveLivePosture(args: {
  coreAge: number
  strengthRank: number
  teamCount: number
  year: number
  table?: TableRead
  persona?: GmPersona
  memory?: PostureMemory
  /** The reigning champion plays in this club's conference. */
  championInConference?: boolean
}): LivePosture {
  const n = Math.max(2, args.teamCount)
  const strength = 1 - (2 * (args.strengthRank - 1)) / (n - 1)
  const gp = args.table?.gamesPlayed ?? 0
  const w = args.table ? Math.max(0, Math.min(0.75, gp / 60)) : 0
  const tableScore = args.table ? clamp1(args.table.paceGap / 14) : 0
  let score = (1 - w) * strength + w * tableScore
  if (args.coreAge >= 30 && score < 0) score -= 0.1
  score = clamp1(score)

  const agg = args.persona?.aggression ?? 0.5
  const pat = args.persona?.patience ?? 0.5
  const contendAt = 0.34 - 0.2 * (agg - 0.5)
  const rebuildAt = -0.34 + 0.12 * (pat - 0.5)
  const mem = args.memory

  let posture: PostureKind = score >= contendAt ? 'contend' : score <= rebuildAt ? 'rebuild' : 'retool'
  let personaDriven: LivePosture['personaDriven']

  // All in: an aggressive GM on the bubble, with the champion in his way (or
  // within striking distance of the conference lead), pushes his chips in.
  if (posture !== 'contend' && agg >= 0.65) {
    const nearLead = args.table !== undefined && gp >= 30 && args.table.leaderGap <= 8
    if ((args.championInConference || nearLead) && score >= contendAt - 0.14) {
      posture = 'contend'
      personaDriven = 'allIn'
    }
  }
  // A patient rebuild stays a rebuild.
  if (mem?.posture === 'rebuild' && posture !== 'rebuild' && args.persona) {
    const minYears = pat >= 0.65 ? 2 : pat >= 0.4 ? 1 : 0
    const exitAt = -0.22 + 0.2 * pat
    if (args.year - mem.since < minYears ? score < 0.3 : score < exitAt) {
      posture = 'rebuild'
      personaDriven = 'patientRebuild'
    }
  }
  // A committed contender does not sell at the first slump.
  if (mem?.posture === 'contend' && posture !== 'contend' && args.persona && score >= contendAt - 0.16) {
    posture = 'contend'
    personaDriven = 'stickyWindow'
  }

  const t = args.table
  const tableNote = t && gp >= 20
    ? t.paceGap >= 0 ? `on pace to clear the playoff line by ${Math.round(t.paceGap)}` : `on pace to miss the playoffs by ${Math.round(-t.paceGap)}`
    : null
  let reason: string
  if (personaDriven === 'allIn') reason = args.championInConference ? 'going all in to get past the champion' : 'close enough to the top to go all in'
  else if (personaDriven === 'patientRebuild') reason = 'staying the course on the rebuild'
  else if (personaDriven === 'stickyWindow') reason = 'the window is open and they are not blinking'
  else if (posture === 'contend') reason = tableNote ?? (args.coreAge >= 30 ? 'a top roster with an aging core — the window is now' : 'a top roster in its prime')
  else if (posture === 'rebuild') reason = tableNote ?? (args.coreAge >= 29 ? 'bottom-end strength and an old core — time to tear down' : 'bottom-end strength, accumulating young assets')
  else reason = tableNote ?? (args.coreAge >= 31 ? 'mid-pack with an aging core — retooling on the fly' : 'mid-pack, keeping options open')
  return { posture, reason, score, ...(personaDriven ? { personaDriven } : {}) }
}

/* ────────────────────────── AI scouting departments ────────────────────────── */

/** Scouting regions a department can be thin in (nationality strings as the
 *  database writes them). Canada is absent on purpose: every club covers the CHL. */
export const SCOUTING_REGIONS = ['United States', 'Sweden', 'Finland', 'Russia', 'Czechia', 'Slovakia', 'Switzerland', 'Germany'] as const

export interface ScoutingDept {
  /** 0.3 (threadbare) … 0.95 (elite). Scales how far the club's board strays from truth. */
  quality: number
  /** A nation this staff barely covers — its prospects are misjudged (and usually undervalued). */
  blindSpot: string
}

/** Deterministic per (seed, club): every AI club drafts off its OWN board. */
export function scoutingDeptFor(seed: number, teamId: string): ScoutingDept {
  const rng = new Rng(deriveSeed(seed, GM_NS + 7, hashId(teamId)))
  const quality = Math.round(rng.float(0.3, 0.95) * 100) / 100
  const blindSpot = SCOUTING_REGIONS[rng.int(SCOUTING_REGIONS.length)]!
  return { quality, blindSpot }
}
