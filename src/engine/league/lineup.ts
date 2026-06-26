/**
 * Lineup validation & repair.
 *
 * Slot conventions follow data/generate.ts buildLines(): 4 forward lines
 * [LW, C, RW], 3 defense pairs [LD, RD], goalies [starter, backup], 2 PP units
 * of 5 skaters, 2 PK units of 4 skaters.
 *
 * `lineupIssues` reports human-readable problems for the tactics screen
 * (LinesView.issues); `repairLines` mutates Team.lines in place so a team can
 * ALWAYS ice full lines: injured/missing/duplicate entries are replaced by the
 * best healthy unused roster players with positional preference, falling back
 * to double-shifting the best healthy skater rather than leaving a hole. A
 * skater only ends up in net when zero healthy goalies remain.
 *
 * Both functions are deterministic (pure functions of roster state — no Rng)
 * and `repairLines` is idempotent: a second call on the repaired team changes
 * nothing and returns false.
 */
import { asPlayerId } from '@domain'
import type { Lines, Player, PlayerId, Position, Team } from '@domain'
import { ratedOverall } from '@engine/ratings/composites'
import type { StaffMember } from '@engine/league/staff'
import { Rng } from '@engine/shared/rng'

const FORWARD_LINE_COUNT = 4
const DEFENSE_PAIR_COUNT = 3
const PP_UNIT_SIZE = 5
const PK_UNIT_SIZE = 4
const SPECIAL_UNIT_COUNT = 2

const FORWARD_SLOT_NAMES = ['LW', 'C', 'RW'] as const
const PAIR_SLOT_NAMES = ['LD', 'RD'] as const

interface SlotRef {
  label: string
  /** Position the slot wants; fills fall back across positions when empty. */
  prefer: Position
  /** Live reference into Lines so writes mutate the team. */
  row: PlayerId[]
  col: number
}

function skaterSlots(lines: Lines): SlotRef[] {
  const slots: SlotRef[] = []
  lines.forwards.forEach((row, i) => {
    FORWARD_SLOT_NAMES.forEach((name, col) => {
      slots.push({ label: `L${i + 1} ${name}`, prefer: name === 'C' ? 'C' : 'W', row, col })
    })
  })
  lines.defensePairs.forEach((row, i) => {
    PAIR_SLOT_NAMES.forEach((name, col) => {
      slots.push({ label: `D${i + 1} ${name}`, prefer: 'D', row, col })
    })
  })
  return slots
}

const cmpId = (a: Player, b: Player): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** Lower rank = better fit for the slot; G is always the last resort. */
function positionRank(prefer: Position, pos: Position): number {
  if (pos === prefer) return 0
  if (pos === 'G') return 9
  if (prefer === 'C') return pos === 'W' ? 1 : 2
  if (prefer === 'W') return pos === 'C' ? 1 : 2
  return 1 // prefer 'D': any forward, best overall wins
}

function bySlotPreference(prefer: Position) {
  return (a: Player, b: Player): number =>
    positionRank(prefer, a.position) - positionRank(prefer, b.position) ||
    ratedOverall(b) - ratedOverall(a) ||
    cmpId(a, b)
}

/* ────────────────────────── lineupIssues ────────────────────────── */

export function lineupIssues(team: Team, players: Map<PlayerId, Player>): string[] {
  const issues: string[] = []
  const lines = team.lines
  const roster = new Set(team.roster)
  const name = (id: PlayerId): string => players.get(id)?.name ?? String(id)

  const checkOccupant = (label: string, id: PlayerId | undefined): void => {
    if (!id) {
      issues.push(`${label}: empty slot`)
      return
    }
    const p = players.get(id)
    if (!p || !roster.has(id)) {
      issues.push(`${label}: player is not on the roster`)
      return
    }
    if (p.injuryStatus !== null) issues.push(`${label}: ${p.name} is injured`)
  }

  const slots = skaterSlots(lines)
  for (const s of slots) checkOccupant(s.label, s.row[s.col])
  checkOccupant('G1', lines.goalies[0])
  checkOccupant('G2', lines.goalies[1])

  // Duplicates across the even-strength deployment. Lone exception: the backup
  // slot may repeat the starter when no second healthy goalie exists.
  const skaterIds = slots.map((s) => s.row[s.col]).filter(Boolean)
  const goalieIds = lines.goalies.filter(Boolean)
  const occurrences = new Map<PlayerId, number>()
  for (const id of [...skaterIds, ...goalieIds]) {
    occurrences.set(id, (occurrences.get(id) ?? 0) + 1)
  }
  const otherHealthyGoalies = (excluding: PlayerId): number =>
    team.roster.filter((id) => {
      const p = players.get(id)
      return !!p && id !== excluding && p.position === 'G' && p.injuryStatus === null
    }).length
  for (const [id, count] of occurrences) {
    if (count < 2) continue
    const allowedGoalieDup =
      count === 2 &&
      lines.goalies[0] === id &&
      lines.goalies[1] === id &&
      !skaterIds.includes(id) &&
      otherHealthyGoalies(id) === 0
    if (allowedGoalieDup) continue
    issues.push(`${name(id)} appears in multiple even-strength slots`)
  }

  // Special teams: unit members must be available, units must be full.
  const checkUnits = (units: PlayerId[][], size: number, prefix: string, full: string): void => {
    if (units.length < SPECIAL_UNIT_COUNT) {
      issues.push(`only ${units.length} ${full} unit(s) set (needs ${SPECIAL_UNIT_COUNT})`)
    }
    units.forEach((unit, i) => {
      const label = `${prefix}${i + 1}`
      for (const id of unit) {
        if (!id) continue
        const p = players.get(id)
        if (!p || !roster.has(id)) issues.push(`${label}: player is not on the roster`)
        else if (p.injuryStatus !== null) issues.push(`${label}: ${p.name} is injured`)
      }
      const unique = new Set(unit.filter(Boolean)).size
      if (unique < size) issues.push(`${label} has ${unique} of ${size} players`)
    })
  }
  checkUnits(lines.powerPlayUnits, PP_UNIT_SIZE, 'PP', 'power-play')
  checkUnits(lines.penaltyKillUnits, PK_UNIT_SIZE, 'PK', 'penalty-kill')

  return issues
}

/* ────────────────────────── repairLines ────────────────────────── */

export function repairLines(team: Team, players: Map<PlayerId, Player>): boolean {
  const lines = team.lines
  const roster = new Set(team.roster)
  let changed = false

  const get = (id: PlayerId): Player | undefined => {
    const p = players.get(id)
    return p && roster.has(id) ? p : undefined
  }
  const isHealthy = (id: PlayerId): boolean => {
    const p = get(id)
    return !!p && p.injuryStatus === null
  }

  // Normalize structure so a malformed save still repairs to a legal shape.
  while (lines.forwards.length < FORWARD_LINE_COUNT) {
    lines.forwards.push([asPlayerId(''), asPlayerId(''), asPlayerId('')])
    changed = true
  }
  while (lines.defensePairs.length < DEFENSE_PAIR_COUNT) {
    lines.defensePairs.push([asPlayerId(''), asPlayerId('')])
    changed = true
  }

  const healthySkaters = team.roster
    .map((id) => players.get(id))
    .filter((p): p is Player => !!p && p.position !== 'G' && p.injuryStatus === null)
  const healthyGoalies = team.roster
    .map((id) => players.get(id))
    .filter((p): p is Player => !!p && p.position === 'G' && p.injuryStatus === null)
    .sort(
      (a, b) => b.composites.goaltending - a.composites.goaltending || cmpId(a, b)
    )

  // Pass 1: keep valid occupants (healthy, on roster, first occurrence), note
  // the holes. Goalie slots are pre-marked used so skater fills never poach an
  // occupant of the net.
  const used = new Set<PlayerId>()
  for (const id of lines.goalies) if (id) used.add(id)
  const slots = skaterSlots(lines)
  const holes: SlotRef[] = []
  for (const s of slots) {
    const id = s.row[s.col]
    if (id && isHealthy(id) && !used.has(id)) used.add(id)
    else holes.push(s)
  }

  // Pass 2: fill holes. A position-correct body ALWAYS beats a miscast one — we
  // would sooner double-shift a forward onto a wing than drop a defenceman there
  // (and vice versa), so a D never ends up at LW while any forward is available.
  // Tiers per hole: (1) unused, right position; (2) double-shift, right position;
  // (3) unused, wrong position; (4) double-shift, anyone; (5) emergency goalie.
  const isFwd = (p: Player): boolean =>
    p.position !== 'G' && p.position !== 'D' && p.position !== 'LD' && p.position !== 'RD'
  const isDef = (p: Player): boolean =>
    p.position === 'D' || p.position === 'LD' || p.position === 'RD'

  let unused = healthySkaters.filter((p) => !used.has(p.id))
  for (const s of holes) {
    const current = s.row[s.col]
    const lineMates = new Set(s.row.filter((id, i) => i !== s.col && id))
    const wantFwd = s.prefer === 'C' || s.prefer === 'W'
    const rightPos = (p: Player): boolean => (wantFwd ? isFwd(p) : isDef(p))
    const pref = bySlotPreference(s.prefer)
    const free = (pool: Player[]): Player[] => pool.filter((p) => !lineMates.has(p.id))

    const replacement: Player | undefined =
      free(unused.filter(rightPos)).sort(pref)[0] ??
      free(healthySkaters.filter(rightPos)).sort(pref)[0] ??
      free(unused.filter((p) => !rightPos(p))).sort(pref)[0] ??
      free(healthySkaters).sort(pref)[0] ??
      healthyGoalies[0]

    if (!replacement) continue // nobody healthy at all; leave the hole
    if (replacement.id !== current) {
      s.row[s.col] = replacement.id
      changed = true
    }
    used.add(replacement.id)
    unused = unused.filter((p) => p.id !== replacement.id)
  }

  // Goalies: keep healthy occupants; otherwise promote the best healthy goalie.
  // The backup may duplicate the starter when no second healthy goalie exists.
  // A skater only enters the net when zero healthy goalies remain — and then
  // we take the worst healthy scratch so the lines aren't robbed of talent.
  const isHealthyG = (id: PlayerId): boolean => isHealthy(id) && get(id)?.position === 'G'
  const inSkaterSlots = new Set<PlayerId>()
  for (const s of slots) {
    const id = s.row[s.col]
    if (id) inSkaterSlots.add(id)
  }
  const emergencySkater = (): Player | undefined => {
    const scratches = healthySkaters.filter((p) => !inSkaterSlots.has(p.id))
    const pool = scratches.length > 0 ? scratches : healthySkaters
    return pool
      .slice()
      .sort(
        (a, b) => ratedOverall(a) - ratedOverall(b) || cmpId(a, b)
      )[0]
  }

  let starter = lines.goalies[0]
  if (!isHealthyG(starter)) {
    starter = healthyGoalies[0]?.id ?? emergencySkater()?.id ?? starter
  }
  let backup = lines.goalies[1]
  if (!isHealthyG(backup) || backup === starter) {
    const spare = healthyGoalies.find((g) => g.id !== starter)
    backup = spare?.id ?? starter
  }
  if (starter && starter !== lines.goalies[0]) {
    lines.goalies[0] = starter
    changed = true
  }
  if (backup && backup !== lines.goalies[1]) {
    lines.goalies[1] = backup
    changed = true
  }

  // Special teams: rebuild whole groups when any unit is invalid. PP takes the
  // best offensive skaters, PK the best defensive-zone skaters; the second unit
  // tops up from the best remaining when the healthy roster runs short.
  const isHealthySkaterId = (id: PlayerId): boolean => {
    const p = get(id)
    return !!p && p.position !== 'G' && p.injuryStatus === null
  }
  const unitInvalid = (unit: PlayerId[] | undefined, size: number): boolean =>
    !unit ||
    unit.length !== size ||
    new Set(unit).size !== size ||
    unit.some((id) => !isHealthySkaterId(id))

  const rebuildUnits = (size: number, score: (p: Player) => number): PlayerId[][] => {
    const ranked = healthySkaters.slice().sort((a, b) => score(b) - score(a) || cmpId(a, b))
    const first = ranked.slice(0, size).map((p) => p.id)
    const second = ranked.slice(size, size * 2).map((p) => p.id)
    for (const p of ranked) {
      if (second.length >= size) break
      if (!second.includes(p.id)) second.push(p.id)
    }
    return [first, second]
  }

  const unitsEqual = (a: PlayerId[][], b: PlayerId[][]): boolean =>
    a.length === b.length &&
    a.every((u, i) => u.length === b[i].length && u.every((id, j) => id === b[i][j]))

  if (
    lines.powerPlayUnits.length !== SPECIAL_UNIT_COUNT ||
    lines.powerPlayUnits.some((u) => unitInvalid(u, PP_UNIT_SIZE))
  ) {
    const rebuilt = rebuildUnits(PP_UNIT_SIZE, (p) => p.composites.scoring + p.composites.playmaking)
    if (!unitsEqual(lines.powerPlayUnits, rebuilt)) {
      lines.powerPlayUnits = rebuilt
      changed = true
    }
  }
  if (
    lines.penaltyKillUnits.length !== SPECIAL_UNIT_COUNT ||
    lines.penaltyKillUnits.some((u) => unitInvalid(u, PK_UNIT_SIZE))
  ) {
    const rebuilt = rebuildUnits(PK_UNIT_SIZE, (p) => p.composites.defensiveZone)
    if (!unitsEqual(lines.penaltyKillUnits, rebuilt)) {
      lines.penaltyKillUnits = rebuilt
      changed = true
    }
  }

  return changed
}

/* ────────────────────────── coachSetLineup ────────────────────────── */

export interface CoachLineupResult {
  lines: Lines
  /** Player ids who were left out (healthy but not dressed). */
  scratchIds: PlayerId[]
  /**
   * Why a healthy player was scratched, when it was for cause (not just depth).
   * Surfaced to the UI so the GM understands the coach's call.
   */
  scratchReasons?: Record<string, 'slumping' | 'unhappy' | 'tired'>
}

/** Stable per-id float (same hash as staff.ts) for reproducible coach noise. */
function lineupStableFloat(id: string, salt: number): number {
  let h = 5381
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0
  h = (Math.imul(h ^ (salt >>> 0), 0x9e3779b1) + 0x85ebca77) >>> 0
  return (h >>> 0) / 4294967296
}

/**
 * How much a coach moves a player up/down the depth chart for current form,
 * morale and condition — on top of raw skill. Exactly 0 at neutral inputs
 * (form 0, morale 50, full condition) so a roster of neutral players reproduces
 * the old skill-only ordering. Form is the loudest lever (the drama lever);
 * morale next; tiredness is a one-sided penalty. Form/morale scale by coach
 * rating — a poor coach under-reacts and leaves a slumping player in too long.
 */
export function coachFormMoraleConditionAdj(p: Player, coach: StaffMember): number {
  const react = Math.max(0, Math.min(1, coach.rating / 90))
  const formAdj = Math.max(-6, Math.min(6, (p.form / 5) * 6)) * react // form is -5..5
  const moraleAdj = Math.max(-4, Math.min(4, ((p.morale - 50) / 50) * 4)) * react
  const condition = 100 - p.fatigue
  const conditionAdj = condition >= 60 ? 0 : -((60 - condition) / 60) * 10
  return formAdj + moraleAdj + conditionAdj
}

/**
 * The coach's full evaluation of a player for lineup/roster purposes: true
 * overall + specialty lean + form/morale/condition + a stable judgment-scaled
 * noise. Shared by coachSetLineup and the career NHL/AHL split so both reflect
 * the same realistic read. Deterministic.
 */
export function coachAdjustedScore(p: Player, coach: StaffMember): number {
  const trueOvr = ratedOverall(p)
  let specialtyBonus = 0
  const spec = coach.specialty ?? ''
  if (p.position !== 'G') {
    if (spec === 'Offense' || spec === 'Power Play') {
      specialtyBonus = (p.composites.scoring + p.composites.playmaking) / 2 - trueOvr
    } else if (spec === 'Defense' || spec === 'Penalty Kill') {
      specialtyBonus = (p.composites.defensiveZone + p.composites.takeaway) / 2 - trueOvr
    } else if (spec === 'Player Development') {
      specialtyBonus = p.age < 26 ? 3 : 0
    }
    specialtyBonus *= (90 - coach.rating) / 50
    specialtyBonus = Math.max(-4, Math.min(4, specialtyBonus))
  }
  const noiseBudget = 6 * (1 - coach.judgment / 100)
  const noise = (lineupStableFloat(p.id as string, 42) * 2 - 1) * noiseBudget
  return trueOvr + specialtyBonus + noise + coachFormMoraleConditionAdj(p, coach)
}

/**
 * The head coach builds the full lineup and decides who dresses vs sits.
 *
 * Coach quality model:
 *  - `coach.judgment` (0–100): how accurately the coach reads true overall.
 *    A weaker coach adds seeded noise to each player's "seen" score; a perfect
 *    coach ranks by true overall. The noise is stable per (playerId, salt) so
 *    the same coach always over/under-values the same players.
 *  - `coach.rating` (40–90): overall coaching quality. Higher → smaller noise
 *    budget AND smaller positional bias (weaker coaches over-weight the wrong
 *    composites).
 *  - `coach.specialty`: biases which composite the coach emphasises.
 *    "Offense" / "Power Play" → boosts scoring; "Defense" / "Penalty Kill" →
 *    boosts defensiveZone; "Player Development" → values potential; default →
 *    balanced.
 *
 * Dress rule: best 12 forwards + 6 defensemen + 2 goalies; remainder = scratches.
 * Never dress an injured player.
 * Runs repairLines for legality at the end.
 */
export function coachSetLineup(args: {
  roster: Player[]
  coach: StaffMember
  rng: Rng
}): CoachLineupResult {
  const { roster, coach, rng } = args

  /* ── 1. The coach's read of each player ── */
  // True overall + specialty lean + form/morale/condition + judgment noise.
  // Form/morale slide borderline players up or down and can scratch a slumping
  // or unhappy depth player; a clear star is never buried (the swing is capped).
  const coachScore = (p: Player): number => coachAdjustedScore(p, coach)

  /* ── 2. Split by position and filter healthy ── */
  const healthy = roster.filter((p) => p.injuryStatus === null)
  const goalies = healthy.filter((p) => p.position === 'G')
  const defensemen = healthy.filter((p) => p.position === 'D')
  const forwards = healthy.filter((p) => p.position === 'C' || p.position === 'W')

  const sortByScore = (a: Player, b: Player): number =>
    coachScore(b) - coachScore(a) || (a.id < b.id ? -1 : 1)

  goalies.sort(sortByScore)
  defensemen.sort(sortByScore)
  forwards.sort(sortByScore)

  /* ── 3. Dress the best players ── */
  // Standard NHL dress: 12 forwards, 6 defensemen, 2 goalies = 20 total
  const dressedGoalies = goalies.slice(0, 2)
  const dressedDefense = defensemen.slice(0, 6)
  const dressedForwards = forwards.slice(0, 12)

  const dressed = new Set<string>([
    ...dressedGoalies.map((p) => p.id as string),
    ...dressedDefense.map((p) => p.id as string),
    ...dressedForwards.map((p) => p.id as string),
  ])

  /* ── 4. Build scratch list (healthy undressed + injured) ── */
  const scratchIds: PlayerId[] = roster
    .filter((p) => !dressed.has(p.id as string))
    .map((p) => p.id)

  // Label healthy scratches that sat for cause (not just depth), so the GM sees
  // the coach's reasoning. Tiredness > unhappiness > slump in priority.
  const scratchReasons: Record<string, 'slumping' | 'unhappy' | 'tired'> = {}
  for (const p of roster) {
    if (p.injuryStatus !== null || dressed.has(p.id as string)) continue
    if (100 - p.fatigue < 35) scratchReasons[p.id as string] = 'tired'
    else if (p.morale < 25) scratchReasons[p.id as string] = 'unhappy'
    else if (p.form <= -3) scratchReasons[p.id as string] = 'slumping'
  }

  /* ── 5. Build lines from dressed players ── */
  // Divide 12 forwards into 4 lines of 3, alternating C/W/W.
  // Centres first (sort centres to C slots), then fill remaining with W.
  const centres = dressedForwards.filter((p) => p.position === 'C')
  const wings = dressedForwards.filter((p) => p.position === 'W')

  // We need 4 centres (one per line); if insufficient, promote best wing
  while (centres.length < 4 && wings.length > 0) {
    centres.push(wings.shift()!)
  }

  const fwdLines: PlayerId[][] = []
  for (let i = 0; i < 4; i++) {
    const c = centres[i]
    const lw = wings[i * 2]
    const rw = wings[i * 2 + 1]
    fwdLines.push([
      lw?.id ?? asPlayerId(''),
      c?.id ?? asPlayerId(''),
      rw?.id ?? asPlayerId(''),
    ])
  }

  // Divide 6 defensemen into 3 pairs of 2
  const defPairs: PlayerId[][] = []
  for (let i = 0; i < 3; i++) {
    const ld = dressedDefense[i * 2]
    const rd = dressedDefense[i * 2 + 1]
    defPairs.push([
      ld?.id ?? asPlayerId(''),
      rd?.id ?? asPlayerId(''),
    ])
  }

  const goalieSlots: PlayerId[] = [
    dressedGoalies[0]?.id ?? asPlayerId(''),
    dressedGoalies[1]?.id ?? dressedGoalies[0]?.id ?? asPlayerId(''),
  ]

  // Special teams: PP takes top scorers, PK takes top defensive skaters
  const allDressedSkaters = [...dressedForwards, ...dressedDefense]
  const ppRanked = allDressedSkaters
    .slice()
    .sort((a, b) => b.composites.scoring + b.composites.playmaking - (a.composites.scoring + a.composites.playmaking) || (a.id < b.id ? -1 : 1))
  const pkRanked = allDressedSkaters
    .slice()
    .sort((a, b) => b.composites.defensiveZone - a.composites.defensiveZone || (a.id < b.id ? -1 : 1))

  const pp1 = ppRanked.slice(0, 5).map((p) => p.id)
  const pp2 = ppRanked.slice(5, 10).map((p) => p.id)
  // Ensure pp2 has 5 — top up from pp1 if short
  for (const p of ppRanked) {
    if (pp2.length >= 5) break
    if (!pp2.includes(p.id)) pp2.push(p.id)
  }

  const pk1 = pkRanked.slice(0, 4).map((p) => p.id)
  const pk2 = pkRanked.slice(4, 8).map((p) => p.id)
  for (const p of pkRanked) {
    if (pk2.length >= 4) break
    if (!pk2.includes(p.id)) pk2.push(p.id)
  }

  const lines: Lines = {
    forwards: fwdLines,
    defensePairs: defPairs,
    goalies: goalieSlots,
    powerPlayUnits: [pp1, pp2],
    penaltyKillUnits: [pk1, pk2],
  }

  /* ── 6. Run repairLines for legality ── */
  // Build a temporary Team shell (repairLines only reads team.lines + team.roster)
  const playersMap = new Map<PlayerId, Player>(roster.map((p) => [p.id, p]))
  const tempTeam: Team = {
    ...(roster[0] ? ({} as Team) : ({} as Team)), // structural placeholder
    roster: roster.map((p) => p.id),
    lines,
  } as unknown as Team
  repairLines(tempTeam, playersMap)

  // Use rng to avoid unused-parameter lint (rng is part of the public API for
  // future tie-breaking extensions; it's seeded so callers can rely on stability)
  void rng

  return {
    lines: tempTeam.lines,
    scratchIds,
    ...(Object.keys(scratchReasons).length > 0 ? { scratchReasons } : {}),
  }
}
