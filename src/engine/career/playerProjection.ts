/**
 * Player projection — EHM-style roster-fit + ceiling assessment, attributed to
 * the coaching staff.
 *
 * Produces:
 *  - a "Suggested status" (where he slots on the club's depth chart RIGHT NOW,
 *    and whether he's good enough for the NHL roster at all),
 *  - a "Projected status" (his ceiling expressed in roster terms — first line,
 *    middle six, bottom pair, starter/backup, etc.),
 *  - per-coach scouting reports whose tone varies by the coach's demeanour and
 *    judgement.
 *
 * Roster fit is computed against the player's NHL club (prospects on the AHL
 * affiliate are still measured against the parent club, as EHM does).
 *
 * Descriptive only; deterministic (hash of playerId + coachId); no Rng.
 */

import type { Player } from '@domain'
import { computeComposites, overall } from '@engine/ratings/composites'

/* ────────────────────────── deterministic hash ────────────────────────── */

function stableHash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = (h * 16777619) >>> 0
  }
  return (h % 10000) / 10000
}

function pick<T>(arr: T[], key: string): T {
  const idx = Math.floor(stableHash01(key) * arr.length)
  return arr[Math.max(0, Math.min(arr.length - 1, idx))]!
}

/* ────────────────────────── position helpers ────────────────────────── */

type Group = 'F' | 'D' | 'G'

function groupOf(position: string): Group {
  if (position === 'G') return 'G'
  if (position === 'D') return 'D'
  return 'F'
}

function positionNoun(position: string): string {
  switch (position) {
    case 'C': return 'centre'
    case 'LW': case 'RW': case 'W': return 'winger'
    case 'D': return 'defenceman'
    case 'G': return 'goaltender'
    default: return 'forward'
  }
}

/** Potential-based overall (his ceiling), via the same overall() function. */
export function potentialOverallOf(p: Player): number {
  return overall(computeComposites(p.potential, p.role, p.position), p.position)
}

/* ────────────────────────── depth-slot mapping ────────────────────────── */

/**
 * Where a player of `ovr` slots among `group` (his position peers on the NHL
 * club), as a depth index = how many peers grade out ahead of him.
 */
function depthIndex(ovr: number, group: Player[], selfId: string): number {
  let ahead = 0
  for (const t of group) {
    if ((t.id as string) === selfId) continue
    if (overall(t.composites, t.position) > ovr) ahead++
  }
  return ahead
}

/** Roster line label for a forward depth index. */
function forwardLine(idx: number): { label: string; nhl: boolean } {
  if (idx <= 2) return { label: 'first-line forward', nhl: true }
  if (idx <= 5) return { label: 'second-line forward', nhl: true }
  if (idx <= 8) return { label: 'third-line forward', nhl: true }
  if (idx <= 11) return { label: 'fourth-line forward', nhl: true }
  return { label: 'depth forward (AHL)', nhl: false }
}

function defenceLine(idx: number): { label: string; nhl: boolean } {
  if (idx <= 1) return { label: 'top-pairing defenceman', nhl: true }
  if (idx <= 3) return { label: 'second-pairing defenceman', nhl: true }
  if (idx <= 5) return { label: 'third-pairing defenceman', nhl: true }
  return { label: 'depth defenceman (AHL)', nhl: false }
}

function goalieLine(idx: number): { label: string; nhl: boolean } {
  if (idx === 0) return { label: 'starting goaltender', nhl: true }
  if (idx === 1) return { label: 'backup goaltender', nhl: true }
  return { label: 'third-string goaltender (AHL)', nhl: false }
}

function slotFor(group: Group, idx: number): { label: string; nhl: boolean } {
  return group === 'G' ? goalieLine(idx) : group === 'D' ? defenceLine(idx) : forwardLine(idx)
}

/** Absolute ceiling role from a potential overall (future team unknown). */
function ceilingRoleFor(group: Group, potOvr: number): string {
  if (group === 'G') {
    if (potOvr >= 80) return 'franchise starting goaltender'
    if (potOvr >= 72) return 'starting goaltender'
    if (potOvr >= 63) return 'backup goaltender'
    if (potOvr >= 54) return 'depth goaltender'
    return 'AHL goaltender'
  }
  if (group === 'D') {
    if (potOvr >= 80) return 'elite #1 defenceman'
    if (potOvr >= 72) return 'top-pairing defenceman'
    if (potOvr >= 64) return 'top-four defenceman'
    if (potOvr >= 56) return 'bottom-pairing defenceman'
    if (potOvr >= 48) return 'depth defenceman'
    return 'AHL defenceman'
  }
  if (potOvr >= 82) return 'franchise forward'
  if (potOvr >= 74) return 'first-line forward'
  if (potOvr >= 66) return 'middle-six forward'
  if (potOvr >= 58) return 'bottom-six forward'
  if (potOvr >= 49) return 'depth forward'
  return 'AHL forward'
}

/** Short value word for "rates him as a ___ player". */
function statusWord(ovr: number): string {
  if (ovr >= 82) return 'franchise player'
  if (ovr >= 75) return 'star player'
  if (ovr >= 68) return 'key player'
  if (ovr >= 61) return 'core player'
  if (ovr >= 54) return 'regular contributor'
  if (ovr >= 47) return 'depth player'
  return 'reserve player'
}

/* ────────────────────────── view types ────────────────────────── */

export interface RosterProjection {
  teamName: string
  coachName: string
  /** Depth-chart slot on the club right now (e.g. "second-line forward"). */
  currentRole: string
  /** Whether he's good enough for the NHL roster at all today. */
  nhlReady: boolean
  /** "Suggested status" prose — current fit on the club. */
  suggestedStatus: string
  /** Ceiling role in roster terms (e.g. "middle-six forward"). */
  ceilingRole: string
  /** "Projected status" prose — what he can become for the club. */
  projectedStatus: string
}

export interface CoachReport {
  coachName: string
  coachRole: string
  faceId?: string
  /** The coach's prose take. */
  text: string
}

/**
 * In-season signals that make staff opinion change over the year: hot/cold form,
 * morale, injury, and production vs expectation. All update as games are simmed.
 */
export interface SeasonForm {
  /** Hot/cold streak, −5..5. */
  form: number
  /** 0..100. */
  morale: number
  injured: boolean
  gamesPlayed: number
  points: number
  /** Full-season point expectation (skaters); absent for goalies. */
  expectedPoints?: number
}

const FORM_HOT = [
  'He has been in excellent form lately',
  'He is red-hot at the moment',
  'He has been one of our most reliable performers of late',
]
const FORM_COLD = [
  'He has gone a little quiet recently',
  'He is in a bit of a rut at the moment',
  'His game has dipped over the last stretch',
]
const PACE_UP = [
  'and he is outproducing expectations so far this season',
  'and his numbers are ahead of where we projected',
]
const PACE_DOWN = [
  'though his production has lagged behind what we hoped for this season',
  'though the points have not come as freely as expected',
]

/** A factual in-season clause that shifts the report as the year unfolds. */
function seasonClause(s: SeasonForm | undefined, isGoalie: boolean, key: string): string {
  if (!s) return ''
  if (s.injured) return 'He is currently working his way back from injury.'
  if (!isGoalie && s.gamesPlayed >= 10 && s.expectedPoints && s.expectedPoints > 0) {
    const pace = (s.points / s.gamesPlayed) * 82
    if (pace >= s.expectedPoints * 1.25) {
      return `${pick(FORM_HOT, key + ':hot')} ${pick(PACE_UP, key + ':up')}.`
    }
    if (pace <= s.expectedPoints * 0.7) {
      return `${pick(FORM_COLD, key + ':cold')} ${pick(PACE_DOWN, key + ':down')}.`
    }
  }
  if (s.form >= 2) return `${pick(FORM_HOT, key + ':hot')}.`
  if (s.form <= -2) return `${pick(FORM_COLD, key + ':cold')}.`
  if (s.morale <= 35) return 'He has seemed a little unsettled of late.'
  return ''
}

export interface StaffLike {
  name: string
  role: StaffMemberRole
  faceId?: string
  judgment: number
  demeanor?: string
}

type StaffMemberRole = 'headCoach' | 'assistantCoach' | 'assistantGM' | 'scout' | 'physio' | 'owner'

/* ────────────────────────── roster projection ────────────────────────── */

export function buildRosterProjection(args: {
  player: Player
  /** The NHL club we measure fit against. */
  teamName: string
  /** Resolved players on that NHL club's roster (may include the player). */
  clubRoster: Player[]
  /** Head coach making the call. */
  coachName: string
  /** In-season form, so the suggested status reflects how he's playing now. */
  season?: SeasonForm
}): RosterProjection {
  const { player, teamName, clubRoster, coachName, season } = args
  const group = groupOf(player.position)
  const peers = clubRoster.filter((p) => groupOf(p.position) === group)
  const curOvr = overall(player.composites, player.position)
  const potOvr = potentialOverallOf(player)

  const idx = depthIndex(curOvr, peers, player.id as string)
  const slot = slotFor(group, idx)
  const ceilingRole = ceilingRoleFor(group, potOvr)

  // Suggested status (now), with an in-season form tail so it reads live.
  const formTail = season
    ? season.injured ? ' He is currently injured.'
      : season.form >= 2 ? ' He is in strong form.'
      : season.form <= -2 ? ' He is in a rough patch right now.'
      : ''
    : ''
  const suggestedStatus = (slot.nhl
    ? `${coachName} would slot ${player.name} in as a ${slot.label} for ${teamName}.`
    : `${coachName} feels ${player.name} isn't ready for ${teamName}'s lineup yet — ticketed for the AHL to develop.`)
    + formTail

  // Projected status (ceiling). Frame as growth for the young, as a settled
  // ceiling for the older.
  const growing = player.age <= 23 && potOvr > curOvr + 3
  const word = statusWord(potOvr)
  const projectedStatus = growing
    ? `${coachName} rates him as a future ${word} — projecting a ${ceilingRole} ceiling for ${teamName}.`
    : `${coachName} sees his ceiling as a ${ceilingRole} (${word}) for ${teamName}.`

  return {
    teamName,
    coachName,
    currentRole: slot.label,
    nhlReady: slot.nhl,
    suggestedStatus,
    ceilingRole,
    projectedStatus,
  }
}

/* ────────────────────────── coach reports ────────────────────────── */

const OPENERS_YOUNG_HIGH = [
  'is one to watch in the coming years',
  'has the look of a real building block',
  'is among the most promising youngsters in the organisation',
]
const OPENERS_YOUNG_MID = [
  'is developing along the right lines',
  'is steadily rounding into a useful player',
  'has shown enough to suggest he belongs',
]
const OPENERS_ESTABLISHED = [
  'has firmly established his credentials as a member of the team',
  'has become a dependable part of the group',
  'is exactly the sort of professional you build a room around',
]
const OPENERS_FRINGE = [
  'is fighting for a regular role and will need to keep earning it',
  'profiles as a depth option who must do the little things well',
  'has work to do to nail down a spot',
]

const CEILING_LINES_HIGH = [
  'He believes the player could go on to achieve great things.',
  'He thinks the sky is the limit if the development continues.',
  'He expects him to push for a top role before long.',
]
const CEILING_LINES_MID = [
  'He sees a solid contributor with room to grow into more.',
  'He reckons there is another level still to come.',
]
const CEILING_LINES_SETTLED = [
  'He sees him at, or close to, his ceiling — but a valuable one.',
  'He values the consistency more than any untapped upside.',
]

const TRAIT_LINES: Array<{ test: (p: Player) => boolean; line: (n: string) => string }> = [
  { test: (p) => (p.personality.determination ?? 10) >= 15, line: (n) => `The report singles out ${n}'s work ethic and drive.` },
  { test: (p) => (p.personality.professionalism ?? 10) >= 15, line: (n) => `It also reflects favourably on ${n}'s maturity and professionalism.` },
  { test: (p) => ((p as unknown as Record<string, number | undefined>)['bravery'] ?? 10) >= 15, line: (n) => `He praises ${n}'s bravery and willingness to pay the price.` },
  { test: (p) => ((p.composites as unknown as Record<string, number>)['skating'] ?? 50) >= 70, line: (n) => `He highlights ${n}'s skating as a real asset.` },
  { test: (p) => ((p.composites as unknown as Record<string, number>)['hitting'] ?? 50) >= 70, line: (n) => `He notes the physical edge ${n} brings every night.` },
  { test: (p) => ((p.composites as unknown as Record<string, number>)['scoring'] ?? 50) >= 70, line: (n) => `He rates ${n}'s finishing among the group's best.` },
]

function roleLabel(role: StaffMemberRole): string {
  switch (role) {
    case 'headCoach': return 'Head Coach'
    case 'assistantCoach': return 'Assistant Coach'
    case 'assistantGM': return 'Assistant GM'
    case 'scout': return 'Scout'
    default: return 'Staff'
  }
}

/**
 * One short report per coach. Tone keys off the player's quality/age and the
 * coach's demeanour; a trait line is appended when something stands out.
 */
export function buildCoachReports(player: Player, coaches: StaffLike[], season?: SeasonForm): CoachReport[] {
  const curOvr = overall(player.composites, player.position)
  const potOvr = potentialOverallOf(player)
  const ceiling = Math.max(curOvr, potOvr)
  const young = player.age <= 23
  const noun = positionNoun(player.position)
  const isGoalie = player.position === 'G'
  const name = player.name

  return coaches.map((coach) => {
    const key = (player.id as string) + ':' + coach.name

    const openerPool =
      young && ceiling >= 70 ? OPENERS_YOUNG_HIGH
      : young ? OPENERS_YOUNG_MID
      : curOvr >= 60 ? OPENERS_ESTABLISHED
      : OPENERS_FRINGE
    const opener = pick(openerPool, key + ':open')

    const ceilingPool =
      ceiling - curOvr >= 8 ? CEILING_LINES_HIGH
      : ceiling - curOvr >= 3 ? CEILING_LINES_MID
      : CEILING_LINES_SETTLED
    const ceilingLine = pick(ceilingPool, key + ':ceil')

    // Optional trait line — pick a matching one deterministically (or none).
    const matches = TRAIT_LINES.filter((t) => t.test(player))
    const traitLine = matches.length > 0 && stableHash01(key + ':trait') > 0.25
      ? pick(matches, key + ':twhich').line(name.split(' ').slice(-1)[0]!)
      : ''

    // In-season clause — shifts the report as form/results change over the year.
    const inSeason = seasonClause(season, isGoalie, key)

    const descriptor = young ? `young ${noun}` : noun
    const head = `${coach.name} feels that ${descriptor} ${name} ${opener}.`
    const text = [head, ceilingLine, inSeason, traitLine].filter(Boolean).join(' ')

    return {
      coachName: coach.name,
      coachRole: roleLabel(coach.role),
      ...(coach.faceId !== undefined ? { faceId: coach.faceId } : {}),
      text,
    }
  })
}
