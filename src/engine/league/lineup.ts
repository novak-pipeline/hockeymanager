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
import { overall } from '@engine/ratings/composites'

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
    overall(b.composites, b.position) - overall(a.composites, a.position) ||
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

  // Pass 2: fill holes — best healthy unused first (position-preferred), then
  // double-shift the best healthy skater outside the slot's own line, then
  // (only when zero healthy skaters exist) a goalie.
  let unused = healthySkaters.filter((p) => !used.has(p.id))
  for (const s of holes) {
    const current = s.row[s.col]
    const lineMates = new Set(s.row.filter((id, i) => i !== s.col && id))
    let replacement: Player | undefined
    const fresh = unused.filter((p) => !lineMates.has(p.id)).sort(bySlotPreference(s.prefer))
    if (fresh.length > 0) {
      replacement = fresh[0]
    } else {
      const doubleShift = healthySkaters
        .filter((p) => !lineMates.has(p.id))
        .sort(bySlotPreference(s.prefer))
      replacement = doubleShift[0] ?? healthyGoalies[0]
    }
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
        (a, b) => overall(a.composites, a.position) - overall(b.composites, b.position) || cmpId(a, b)
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
