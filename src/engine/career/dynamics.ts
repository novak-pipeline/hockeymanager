/**
 * Team Dynamics view builder (FM-style "Dynamics" screen, hockey-flavoured).
 *
 * Derives a squad-dynamics picture from systems we already have:
 *   - lockerRoom (captain/alternates, influence 0–100, relationships, roomMorale,
 *     familiarity, arrivals ledger)
 *   - personality archetype (the headline character word)
 *   - player morale (overall happiness)
 *   - lines / age cohorts / draft classes / nationality (social groups)
 *
 * Playtest #20: every summary bar carries DRIVERS — the top facts behind the
 * number — and social groups are a real deterministic partition (leadership
 * core, line cells, the kids, the old guard, draft classes, nationality blocs,
 * personality clusters) each with a note on its standing in the room and the
 * ACTUAL sim coupling it rides (chemistry, morale contagion, mentorship dev).
 *
 * Pure + deterministic. No Rng, no Date. The career layer passes the live roster +
 * locker-room state + head coach (+ optional facts: lines, streak, season year).
 */

import type { Player, Lines } from '@domain'
import type { LockerRoomState, Relationship } from '@engine/league/lockerRoom'
import { FAMILIARITY_GAIN_PER_GAME } from '@engine/league/lockerRoom'
import { personalityArchetype } from '@engine/career/personalityType'

export type DynamicsTier = 'leader' | 'highlyInfluential' | 'influential' | 'other'
export type SocialGroupKind = 'core' | 'secondary' | 'other'

export interface DynamicsPlayerView {
  playerId: string
  name: string
  faceId?: string
  position: string
  /** Headline personality archetype, e.g. "Born Leader". */
  personality: string
  tier: DynamicsTier
  influence: number
  morale: number
  /** Plain-English overall happiness. */
  happiness: string
  socialGroup: SocialGroupKind
}

export interface DynamicsBar {
  /** 0–100. */
  value: number
  label: string
  /** Playtest #20: the top 2–3 facts behind the number, plain English, each
   *  citing real state (turnover, tenure, captain morale, streaks, feuds…).
   *  Optional/additive. */
  drivers?: string[]
}

/** Playtest #20: a real social group — a deterministic slice of the room with
 *  a standing note and the sim coupling it actually rides. Optional/additive. */
export interface DynamicsSocialGroup {
  key: string
  /** e.g. "The Leadership Core", "The Kids", "The Swedish contingent". */
  title: string
  members: DynamicsPlayerView[]
  /** Standing relative to the leadership core, e.g. "this group runs the room"
   *  or "isolated — no overlap with the leadership core". */
  note: string
  /** What the group actually does in the sim — real coupling, or an honest
   *  "social only" when there is none. */
  effect: string
  /** 0–100 mean morale across members. */
  avgMorale: number
}

/** Optional live-world facts the career layer can pass so drivers/groups can
 *  cite them. All additive; the builder degrades gracefully without them. */
export interface DynamicsFacts {
  /** Current season year — used with the locker room's arrivals ledger to
   *  count new faces this season. */
  year?: number
  /** Signed current streak (+N won straight / −N winless). */
  teamStreak?: number
  /** Current lines — enables line-cell social groups. */
  lines?: Lines
}

export interface TeamDynamicsView {
  teamId: string
  teamName: string
  headCoachName: string
  headCoachFaceId?: string
  cohesion: DynamicsBar
  atmosphere: DynamicsBar
  leadership: DynamicsBar
  /** #189: true when this is the user's own club — unlocks the captaincy /
   *  jersey-number editor on the Dynamics screen. Optional/additive. */
  isUserClub?: boolean
  /** Top influencers (≤4), most influential first. */
  topInfluencers: Array<{ playerId: string; name: string; faceId?: string; tierLabel: string }>
  /**
   * LW5 promise ledger (user club only): every promise you've made to a
   * player's face, with its due date and whether you kept your word.
   * Optional/additive.
   */
  promises?: Array<{
    playerId: string
    playerName: string
    faceId?: string
    text: string
    madeLabel: string
    dueLabel: string
    status: 'open' | 'kept' | 'broken'
  }>
  hierarchy: {
    leaders: DynamicsPlayerView[]
    highlyInfluential: DynamicsPlayerView[]
    influential: DynamicsPlayerView[]
    others: DynamicsPlayerView[]
  }
  socialGroups: {
    /** e.g. "Mostly Canadian players" for the secondary group. */
    secondaryLabel: string | null
    core: DynamicsPlayerView[]
    secondary: DynamicsPlayerView[]
    other: DynamicsPlayerView[]
    /** Playtest #20: the rich deterministic partition. When present the UI
     *  renders these instead of core/secondary/other. Optional/additive. */
    groups?: DynamicsSocialGroup[]
  }
  /** Full roster for the happiness grid, leaders first. */
  happinessRows: DynamicsPlayerView[]
}

const TIER_LABEL: Record<DynamicsTier, string> = {
  leader: 'Team Leader',
  highlyInfluential: 'Highly Influential',
  influential: 'Influential',
  other: 'Squad Player',
}

function bandLabel(v: number): string {
  if (v >= 80) return 'Very good'
  if (v >= 62) return 'Good'
  if (v >= 45) return 'Average'
  if (v >= 28) return 'Poor'
  return 'Very poor'
}

function happinessLabel(morale: number): string {
  if (morale >= 82) return 'Delighted'
  if (morale >= 66) return 'Happy'
  if (morale >= 50) return 'Content'
  if (morale >= 34) return 'Unsettled'
  return 'Unhappy'
}

function influenceOf(lr: LockerRoomState | null, id: string): number {
  if (!lr) return 40
  for (const [pid, v] of lr.influence) if (pid === id) return v
  return 40
}

/* ───────────────────────── driver helpers ───────────────────────── */

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

function surname(name: string): string {
  const parts = name.trim().split(/\s+/)
  return parts[parts.length - 1] ?? name
}

/** Mean familiarity over pairs, converted to "games together". */
function meanGamesTogether(fam: Array<[string, number]>): number {
  if (fam.length === 0) return 0
  const mean = fam.reduce((s, [, v]) => s + v, 0) / fam.length
  return Math.round(mean / FAMILIARITY_GAIN_PER_GAME)
}

/** Mean pairwise familiarity among a member set (0–100). */
function groupFamiliarity(lr: LockerRoomState | null, ids: string[]): number {
  if (!lr || ids.length < 2) return 0
  const famMap = new Map(lr.familiarity)
  let sum = 0
  let n = 0
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      sum += famMap.get(pairKey(ids[i]!, ids[j]!)) ?? 0
      n++
    }
  }
  return n > 0 ? sum / n : 0
}

/** A driver with a sign so we can lead with what explains the number. */
interface Driver {
  text: string
  /** negative pulls the bar down, positive holds it up. */
  sign: -1 | 1
  /** Bigger = more load-bearing; used to rank within a sign. */
  weight: number
}

/** Order drivers so the ones that explain the value come first, cap at 3. */
function pickDrivers(drivers: Driver[], value: number): string[] {
  const neg = drivers.filter((d) => d.sign < 0).sort((a, b) => b.weight - a.weight)
  const pos = drivers.filter((d) => d.sign > 0).sort((a, b) => b.weight - a.weight)
  const ordered = value < 45 ? [...neg, ...pos] : [...pos, ...neg]
  return ordered.slice(0, 3).map((d) => d.text)
}

/* ─────────────────────── social group builder ─────────────────────── */

/** Demonyms for the common hockey nations; falls back to the raw name. */
const DEMONYM: Record<string, string> = {
  Canada: 'Canadian', USA: 'American', 'United States': 'American',
  Sweden: 'Swedish', Finland: 'Finnish', Russia: 'Russian',
  Czechia: 'Czech', 'Czech Republic': 'Czech', Slovakia: 'Slovak',
  Germany: 'German', Switzerland: 'Swiss', Latvia: 'Latvian',
  Denmark: 'Danish', Norway: 'Norwegian', Austria: 'Austrian',
}

const ARCHETYPE_GROUP_TITLE: Record<string, string> = {
  volatile: 'The Hotheads',
  modelPro: 'The Model Pros',
  worker: 'The Grinders',
  mercenary: 'Here for the Deal',
  laidBack: 'The Easy-Going Crowd',
  drivenWinner: 'The Driven Winners',
  bigGame: 'The Big-Game Crowd',
  loyalServant: 'The Club Men',
}

function buildSocialGroups(args: {
  roster: Player[]
  views: DynamicsPlayerView[]
  lr: LockerRoomState | null
  facts: DynamicsFacts
  captainId: string | null
  alternates: Set<string>
  archetypeKey: Map<string, string>
}): DynamicsSocialGroup[] {
  const { roster, views, lr, facts, captainId, alternates, archetypeKey } = args
  const viewOf = new Map(views.map((v) => [v.playerId, v]))
  const playerOf = new Map(roster.map((p) => [p.id as unknown as string, p]))
  const assigned = new Set<string>()
  const groups: DynamicsSocialGroup[] = []
  const rels: Relationship[] = lr?.relationships ?? []

  const byInfluenceDesc = (a: DynamicsPlayerView, b: DynamicsPlayerView): number =>
    b.influence - a.influence || (a.playerId < b.playerId ? -1 : 1)

  const avgMorale = (members: DynamicsPlayerView[]): number =>
    members.length === 0 ? 0 : Math.round(members.reduce((s, m) => s + m.morale, 0) / members.length)

  /** IDs of the leadership core once formed — notes are computed against it. */
  let coreIds = new Set<string>()

  function standingNote(members: DynamicsPlayerView[]): string {
    // A relationship (friendship/mentorship) with a core member links the group in.
    for (const rel of rels) {
      if (rel.kind === 'feud') continue
      const aIn = members.some((m) => m.playerId === rel.a)
      const bIn = members.some((m) => m.playerId === rel.b)
      if ((aIn && coreIds.has(rel.b)) || (bIn && coreIds.has(rel.a))) {
        const linker = aIn && coreIds.has(rel.b) ? rel.a : rel.b
        const linkName = viewOf.get(linker)?.name
        return linkName
          ? `Tight with the leadership core — ${surname(linkName)} links them to the room's leaders.`
          : 'Tight with the leadership core.'
      }
    }
    const avgInf = members.reduce((s, m) => s + m.influence, 0) / Math.max(1, members.length)
    if (avgInf >= 55) return 'Carries weight of its own in the room.'
    return 'Isolated — no overlap with the leadership core.'
  }

  function effectNote(members: DynamicsPlayerView[]): string {
    const ids = members.map((m) => m.playerId)
    if (captainId !== null && ids.includes(captainId)) {
      return "Room-morale engine: the captain's mood bleeds into the whole room after every game."
    }
    const inGroup = (id: string): boolean => ids.includes(id)
    const feud = rels.find((r) => r.kind === 'feud' && inGroup(r.a) && inGroup(r.b))
    if (feud) {
      const an = viewOf.get(feud.a)?.name
      const bn = viewOf.get(feud.b)?.name
      return an && bn
        ? `Friction: the ${surname(an)}–${surname(bn)} feud costs on-ice chemistry when they're iced together.`
        : 'Friction: a feud inside this group costs on-ice chemistry when they share the ice.'
    }
    const mentorship = rels.find((r) => r.kind === 'mentorship' && inGroup(r.b))
    if (mentorship) {
      const mentor = viewOf.get(mentorship.a)?.name
      const kid = viewOf.get(mentorship.b)?.name
      if (!mentor || !kid) {
        return "Development: a mentorship here speeds the protégé's growth (up to +15%)."
      }
      // Name the mentor as an outsider when he isn't on this card, so the line
      // never reads as if he were a member.
      return inGroup(mentorship.a)
        ? `Development: ${surname(mentor)}'s mentorship speeds ${surname(kid)}'s growth (up to +15%).`
        : `Development: ${surname(kid)} is being mentored from outside the group by ${surname(mentor)} (up to +15% growth).`
    }
    const fam = groupFamiliarity(lr, ids)
    if (fam >= 40) {
      const games = Math.round(fam / FAMILIARITY_GAIN_PER_GAME)
      return `On-ice chemistry: ~${games} games together — up to +3% when they share the ice.`
    }
    const friendship = rels.find((r) => r.kind === 'friendship' && inGroup(r.a) && inGroup(r.b))
    if (friendship) {
      return "Chemistry seed: friendships here add a small on-ice lift when they're on together."
    }
    return 'Social only — no on-ice effect yet; familiarity builds when they play together.'
  }

  function addGroup(key: string, title: string, members: DynamicsPlayerView[], noteOverride?: string): void {
    if (members.length === 0) return
    const sorted = [...members].sort(byInfluenceDesc)
    for (const m of sorted) assigned.add(m.playerId)
    groups.push({
      key,
      title,
      members: sorted,
      note: noteOverride ?? standingNote(sorted),
      effect: effectNote(sorted),
      avgMorale: avgMorale(sorted),
    })
  }

  const unassignedViews = (): DynamicsPlayerView[] => views.filter((v) => !assigned.has(v.playerId))

  /* 1 ── the leadership core: captain + alternates + heavyweights */
  const coreMembers = views.filter((v) => {
    if (assigned.has(v.playerId)) return false
    return v.playerId === captainId || alternates.has(v.playerId) || v.influence >= 72
  })
  if (coreMembers.length >= 2) {
    coreIds = new Set(coreMembers.map((m) => m.playerId))
    addGroup('core', 'The Leadership Core', coreMembers, 'This group runs the room.')
  }

  /* 2 ── line cells: units that have genuinely played together (fam ≥ 40) */
  if (facts.lines) {
    const units: Array<{ ids: string[]; kind: 'line' | 'pair' }> = []
    for (const line of facts.lines.forwards) units.push({ ids: line.map(String), kind: 'line' })
    for (const pair of facts.lines.defensePairs) units.push({ ids: pair.map(String), kind: 'pair' })
    for (const unit of units) {
      const members = unit.ids
        .filter((id) => !assigned.has(id))
        .map((id) => viewOf.get(id))
        .filter((v): v is DynamicsPlayerView => v !== undefined)
      if (members.length < unit.ids.length || members.length < 2) continue
      const fam = groupFamiliarity(lr, unit.ids)
      if (fam < 40) continue
      const anchor = [...members].sort(byInfluenceDesc)[0]!
      const title = unit.kind === 'line' ? `The ${surname(anchor.name)} Line` : `The ${surname(anchor.name)} Pairing`
      addGroup(`unit-${unit.ids.slice().sort().join('-')}`, title, members)
    }
  }

  /* 3 ── the goalie union */
  const goalies = unassignedViews().filter((v) => v.position === 'G')
  if (goalies.length >= 2) addGroup('goalies', 'The Goalie Union', goalies)

  /* 4 ── the kids (≤23) */
  const kids = unassignedViews().filter((v) => (playerOf.get(v.playerId)?.age ?? 99) <= 23)
  if (kids.length >= 3) {
    // Name a mentor if one of the room's veterans has taken a kid under his wing.
    const kidIds = new Set(kids.map((k) => k.playerId))
    const m = rels.find((r) => r.kind === 'mentorship' && kidIds.has(r.b))
    const mentorName = m ? viewOf.get(m.a)?.name : undefined
    addGroup(
      'kids',
      'The Kids',
      kids,
      mentorName ? `${surname(mentorName)} has taken them under his wing.` : undefined
    )
  }

  /* 5 ── the old guard (≥32) */
  const vets = unassignedViews().filter((v) => (playerOf.get(v.playerId)?.age ?? 0) >= 32)
  if (vets.length >= 3) addGroup('oldGuard', 'The Old Guard', vets)

  /* 6 ── draft classes: same draft year, 3+ of them still unassigned */
  const byDraftYear = new Map<number, DynamicsPlayerView[]>()
  for (const v of unassignedViews()) {
    const dy = playerOf.get(v.playerId)?.draftYear
    if (dy === undefined) continue
    const list = byDraftYear.get(dy) ?? []
    list.push(v)
    byDraftYear.set(dy, list)
  }
  for (const [dy, members] of [...byDraftYear.entries()].sort((a, b) => a[0] - b[0])) {
    if (members.length >= 3) addGroup(`draft-${dy}`, `The Class of ${dy}`, members)
  }

  /* 7 ── nationality blocs (3+), biggest first */
  const byNat = new Map<string, DynamicsPlayerView[]>()
  for (const v of unassignedViews()) {
    const nat = playerOf.get(v.playerId)?.nationality
    if (!nat) continue
    const list = byNat.get(nat) ?? []
    list.push(v)
    byNat.set(nat, list)
  }
  const natBlocs = [...byNat.entries()]
    .filter(([, m]) => m.length >= 3)
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
  for (const [nat, members] of natBlocs) {
    const demonym = DEMONYM[nat] ?? nat
    addGroup(`nat-${nat}`, `The ${demonym} Contingent`, members)
  }

  /* 8 ── personality clusters (3+ sharing an archetype) */
  const byArchetype = new Map<string, DynamicsPlayerView[]>()
  for (const v of unassignedViews()) {
    const key = archetypeKey.get(v.playerId)
    if (!key) continue
    const list = byArchetype.get(key) ?? []
    list.push(v)
    byArchetype.set(key, list)
  }
  const clusters = [...byArchetype.entries()]
    .filter(([key, m]) => m.length >= 3 && ARCHETYPE_GROUP_TITLE[key] !== undefined)
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
  for (const [key, members] of clusters) {
    addGroup(`arch-${key}`, ARCHETYPE_GROUP_TITLE[key]!, members)
  }

  /* 9 ── remainder: fringe players finding their feet vs everyone else */
  const rest = unassignedViews()
  const fringe = rest.filter((v) => v.influence <= 25)
  const settled = rest.filter((v) => v.influence > 25)
  if (settled.length > 0) addGroup('rest', 'The Rest of the Room', settled)
  if (fringe.length > 0) {
    addGroup('fringe', 'Finding Their Place', fringe,
      'New or on the fringe — not yet part of any circle.')
  }

  return groups
}

/* ─────────────────────────── the builder ─────────────────────────── */

export function buildTeamDynamics(args: {
  teamId: string
  teamName: string
  roster: Player[]
  lockerRoom: LockerRoomState | null
  headCoachName: string
  headCoachFaceId?: string
  /** Optional live-world facts (streak, season year, lines). Additive. */
  facts?: DynamicsFacts
}): TeamDynamicsView {
  const { teamId, teamName, roster, lockerRoom: lr, headCoachName } = args
  const facts: DynamicsFacts = args.facts ?? {}

  const captainId = lr?.captainId ?? null
  const alternates = new Set(lr?.alternateIds ?? [])

  // ── nationality clustering for social groups ──
  const natCount = new Map<string, number>()
  for (const p of roster) {
    const nat = p.nationality ?? 'Unknown'
    natCount.set(nat, (natCount.get(nat) ?? 0) + 1)
  }
  // Secondary group = the 2nd-most-common nationality bloc with ≥3 players.
  const natsBySize = [...natCount.entries()]
    .filter(([nat]) => nat !== 'Unknown')
    .sort((a, b) => b[1] - a[1])
  const secondaryNat = natsBySize[1] && natsBySize[1][1] >= 3 ? natsBySize[1][0] : null

  function socialGroupOf(p: Player, influence: number): SocialGroupKind {
    if (secondaryNat && p.nationality === secondaryNat) return 'secondary'
    if (influence <= 25) return 'other' // fringe / not yet gelling
    return 'core'
  }

  function tierOf(p: Player, influence: number): DynamicsTier {
    const id = p.id as unknown as string
    if (id === captainId || alternates.has(id)) return 'leader'
    if (influence >= 72) return 'highlyInfluential'
    if (influence >= 52) return 'influential'
    return 'other'
  }

  const archetypeKey = new Map<string, string>()
  const views: DynamicsPlayerView[] = roster.map((p) => {
    const id = p.id as unknown as string
    const influence = Math.round(influenceOf(lr, id))
    const arch = personalityArchetype(p)
    archetypeKey.set(id, arch.key)
    const v: DynamicsPlayerView = {
      playerId: id,
      name: p.name,
      position: p.position,
      personality: arch.label,
      tier: tierOf(p, influence),
      influence,
      morale: Math.round(p.morale),
      happiness: happinessLabel(p.morale),
      socialGroup: socialGroupOf(p, influence),
      ...(p.faceId !== undefined ? { faceId: p.faceId } : {}),
    }
    return v
  })

  const byInfluence = [...views].sort((a, b) => b.influence - a.influence)
  const tierRank: Record<DynamicsTier, number> = { leader: 0, highlyInfluential: 1, influential: 2, other: 3 }
  const sortedForGrid = [...views].sort(
    (a, b) => tierRank[a.tier] - tierRank[b.tier] || b.influence - a.influence
  )

  const viewOf = new Map(views.map((v) => [v.playerId, v]))

  // ── summary bars ──
  // Atmosphere = room morale. Cohesion = mean pairwise familiarity (fallback to morale).
  const fam = lr?.familiarity ?? []
  const cohesionRaw = fam.length > 0
    ? fam.reduce((s, [, v]) => s + v, 0) / fam.length
    : (lr?.roomMorale ?? 55) * 0.8
  const atmosphere = lr?.roomMorale ?? 55
  // Leadership = strength of the top of the hierarchy + a captain present.
  const topInf = byInfluence.slice(0, 3)
  const leadershipRaw =
    (topInf.reduce((s, p) => s + p.influence, 0) / Math.max(1, topInf.length)) * (captainId ? 1 : 0.8)

  /* ── drivers: the WHY behind each bar (playtest #20) ── */
  const rels = lr?.relationships ?? []
  const captainView = captainId ? viewOf.get(captainId) : undefined

  // Cohesion drivers — turnover, tenure, feuds, friendships.
  const cohesionDrivers: Driver[] = []
  const newFaces = facts.year !== undefined && lr?.arrivals
    ? lr.arrivals.filter(([id, y]) => y === facts.year && viewOf.has(id)).length
    : 0
  const gamesTogether = meanGamesTogether(fam)
  if (newFaces >= 3) {
    cohesionDrivers.push({
      text: `${newFaces} new faces this season — the room is still gelling.`,
      sign: -1, weight: 40 + newFaces,
    })
  } else if (newFaces >= 1) {
    cohesionDrivers.push({
      text: `${newFaces} new arrival${newFaces > 1 ? 's' : ''} bedding in.`,
      sign: -1, weight: 10,
    })
  }
  if (fam.length > 0) {
    if (gamesTogether < 12) {
      cohesionDrivers.push({
        text: `The lines have barely played together (~${gamesTogether} games avg).`,
        sign: -1, weight: 30,
      })
    } else if (gamesTogether >= 25) {
      cohesionDrivers.push({
        text: `A settled group — linemates average ~${gamesTogether} games together.`,
        sign: 1, weight: 30,
      })
    } else {
      cohesionDrivers.push({
        text: `Linemates average ~${gamesTogether} games together.`,
        sign: 1, weight: 12,
      })
    }
  } else {
    cohesionDrivers.push({
      text: 'No shared ice time yet — cohesion starts building with the first games.',
      sign: -1, weight: 25,
    })
  }
  const hotFeuds = rels.filter((r) => r.kind === 'feud' && r.strength >= 25)
  if (hotFeuds.length > 0) {
    const f = hotFeuds.sort((a, b) => b.strength - a.strength)[0]!
    const an = viewOf.get(f.a)?.name
    const bn = viewOf.get(f.b)?.name
    cohesionDrivers.push({
      text: an && bn
        ? `The ${surname(an)}–${surname(bn)} feud is splitting the room.`
        : 'An open feud is splitting the room.',
      sign: -1, weight: 20 + f.strength / 5,
    })
  }
  const strongBonds = rels.filter((r) => r.kind !== 'feud' && r.strength >= 40).length
  if (strongBonds >= 2) {
    cohesionDrivers.push({
      text: `${strongBonds} strong bonds (friendships & mentorships) hold the group together.`,
      sign: 1, weight: 15 + strongBonds,
    })
  }

  // Atmosphere drivers — streak, captain's mood, unhappy players.
  const atmosphereDrivers: Driver[] = []
  const streak = facts.teamStreak ?? 0
  if (streak >= 3) {
    atmosphereDrivers.push({ text: `Won ${streak} straight — winning papers over everything.`, sign: 1, weight: 30 + streak * 3 })
  } else if (streak <= -3) {
    atmosphereDrivers.push({ text: `${-streak} games without a win — the mood follows results.`, sign: -1, weight: 30 + -streak * 3 })
  }
  if (captainView) {
    if (captainView.morale >= 75) {
      atmosphereDrivers.push({
        text: `Captain ${surname(captainView.name)} is flying (morale ${captainView.morale}) and it carries the room.`,
        sign: 1, weight: 25,
      })
    } else if (captainView.morale <= 40) {
      atmosphereDrivers.push({
        text: `Captain ${surname(captainView.name)} is slumping (morale ${captainView.morale}) — it drags everyone.`,
        sign: -1, weight: 25,
      })
    }
  }
  const unhappyCount = views.filter((v) => v.morale < 40).length
  if (unhappyCount >= 3) {
    atmosphereDrivers.push({ text: `${unhappyCount} players are unsettled or worse.`, sign: -1, weight: 15 + unhappyCount * 2 })
  } else if (unhappyCount === 0 && views.length > 0) {
    atmosphereDrivers.push({ text: 'Barely a sour face in the room.', sign: 1, weight: 12 })
  }
  if (atmosphereDrivers.length === 0) {
    atmosphereDrivers.push({
      text: atmosphere >= 55
        ? 'A steady room — results and mood are in balance.'
        : 'A flat room — nothing lifting the mood right now.',
      sign: atmosphere >= 55 ? 1 : -1, weight: 5,
    })
  }

  // Leadership drivers — captain, alternates, mentors, weak top-end.
  const leadershipDrivers: Driver[] = []
  if (captainView) {
    leadershipDrivers.push({
      text: `Captain ${surname(captainView.name)} sets the tone (influence ${captainView.influence}).`,
      sign: captainView.influence >= 60 ? 1 : -1,
      weight: 30,
    })
  } else {
    leadershipDrivers.push({ text: 'No captain named — a leadership vacuum.', sign: -1, weight: 40 })
  }
  const altViews = [...alternates].map((id) => viewOf.get(id)).filter((v): v is DynamicsPlayerView => v !== undefined)
  if (altViews.length > 0) {
    const names = altViews.map((v) => surname(v.name)).join(' and ')
    leadershipDrivers.push({
      text: `Alternate${altViews.length > 1 ? 's' : ''} ${names} back${altViews.length > 1 ? '' : 's'} him up as respected voices.`,
      sign: 1, weight: 18,
    })
  }
  const mentorCount = new Set(rels.filter((r) => r.kind === 'mentorship').map((r) => r.a)).size
  if (mentorCount >= 1) {
    leadershipDrivers.push({
      text: `${mentorCount} veteran${mentorCount > 1 ? 's are' : ' is'} mentoring the young players.`,
      sign: 1, weight: 12 + mentorCount * 3,
    })
  }
  const topAvg = topInf.reduce((s, p) => s + p.influence, 0) / Math.max(1, topInf.length)
  if (topAvg < 55) {
    leadershipDrivers.push({
      text: `No dominant voices — the top of the room carries little weight (influence ~${Math.round(topAvg)}).`,
      sign: -1, weight: 25,
    })
  }

  const tierViews = (t: DynamicsTier): DynamicsPlayerView[] =>
    sortedForGrid.filter((v) => v.tier === t)
  const groupViews = (g: SocialGroupKind): DynamicsPlayerView[] =>
    sortedForGrid.filter((v) => v.socialGroup === g)

  const richGroups = buildSocialGroups({
    roster, views, lr, facts, captainId, alternates, archetypeKey,
  })

  return {
    teamId,
    teamName,
    headCoachName,
    ...(args.headCoachFaceId !== undefined ? { headCoachFaceId: args.headCoachFaceId } : {}),
    cohesion: {
      value: Math.round(cohesionRaw),
      label: bandLabel(cohesionRaw),
      drivers: pickDrivers(cohesionDrivers, cohesionRaw),
    },
    atmosphere: {
      value: Math.round(atmosphere),
      label: bandLabel(atmosphere),
      drivers: pickDrivers(atmosphereDrivers, atmosphere),
    },
    leadership: {
      value: Math.round(leadershipRaw),
      label: bandLabel(leadershipRaw),
      drivers: pickDrivers(leadershipDrivers, leadershipRaw),
    },
    topInfluencers: byInfluence.slice(0, 4).map((v) => ({
      playerId: v.playerId,
      name: v.name,
      tierLabel: TIER_LABEL[v.tier],
      ...(v.faceId !== undefined ? { faceId: v.faceId } : {}),
    })),
    hierarchy: {
      leaders: tierViews('leader'),
      highlyInfluential: tierViews('highlyInfluential'),
      influential: tierViews('influential'),
      others: tierViews('other'),
    },
    socialGroups: {
      secondaryLabel: secondaryNat ? `Mostly ${secondaryNat} players` : null,
      core: groupViews('core'),
      secondary: groupViews('secondary'),
      other: groupViews('other'),
      ...(richGroups.length > 0 ? { groups: richGroups } : {}),
    },
    happinessRows: sortedForGrid,
  }
}
