/**
 * The Scouting Centre briefing (C2).
 *
 * The Centre used to say one thing — "your roster is thin at Goaltending" — and
 * that was the entire insight a scouting department offered its GM. This builds
 * the briefing a real chief scout would give: where your eyes ARE, where they
 * conspicuously are NOT, which of your own scouts are arguing about whom, and
 * what actually moved since last month.
 *
 * Every line here is derived from state the department genuinely holds — the
 * knowledge table, the assignment briefs, the per-scout draft boards, and the
 * month-start coverage snapshots (`ScoutingState.coverageLog`). Nothing is
 * invented, and nothing leaks a rating the department has not earned.
 *
 * Pure and deterministic.
 */
import type { Player, PlayerId, Team, TeamId } from '@domain'
import type { ScoutingState } from '@domain/scouting'
import { knowledgeOf, SCOUT_CAPACITY, SCOUT_SEEN_THRESHOLD, type ScoutingCompetition } from '@engine/league/scouting'
import type {
  CoverageBeatRow, ScoutCardView, ScoutCoverageRow, ScoutDisagreementRow,
  ScoutFindView, ScoutingBriefingView, ScoutingChangeRow, WatchListRow,
} from './views'

type PosGroup = 'C' | 'W' | 'D' | 'G'

export interface ScoutBriefingArgs {
  scouting: ScoutingState
  players: Map<PlayerId, Player>
  teams: Map<TeamId, Team>
  competitions: ScoutingCompetition[]
  leagueCoverage: ScoutCoverageRow[]
  nationCoverage: ScoutCoverageRow[]
  scouts: ScoutCardView[]
  recommendations: ScoutFindView[]
  watchList: WatchListRow[]
  draftProspectIds: Set<string>
  rosterNeeds: string[]
  needGroups: Set<PosGroup>
  groupOf: (pos: string) => PosGroup
  groupLabel: Record<PosGroup, string>
  ownRoster: Set<string>
  /** Per-scout draft boards, for the disagreement panel. */
  scoutBoards?: Array<{ scoutId: string; scoutName: string; rows: Array<{ playerId: string; rank: number }> }>
  /** Today, ISO — used to date "this month". */
  todayISO: string
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0
}

export function buildScoutingBriefing(a: ScoutBriefingArgs): ScoutingBriefingView {
  const {
    scouting, players, leagueCoverage, scouts, recommendations,
    watchList, draftProspectIds, needGroups, groupOf, groupLabel,
  } = a

  /* ── who covers what ─────────────────────────────────────────────────── */
  // Deltas are measured against the last month-start snapshot the department
  // filed, so "up 9 points on the OHL" is a fact, not a vibe.
  const log = scouting.coverageLog ?? []
  const last = log.length ? log[log.length - 1] : undefined
  const prevLeague = new Map<string, number>(last?.leagues ?? [])

  const beatRow = (r: ScoutCoverageRow): CoverageBeatRow => {
    const before = prevLeague.get(r.id)
    return {
      id: r.id,
      label: r.label,
      ...(r.nation ? { nation: r.nation } : {}),
      playerCount: r.playerCount,
      knowledge: r.avgKnowledge,
      delta: before === undefined ? 0 : Math.round((r.avgKnowledge - before) * 10) / 10,
      scoutNames: r.scoutNames,
    }
  }

  const byKnowledge = (x: CoverageBeatRow, y: CoverageBeatRow): number =>
    y.knowledge - x.knowledge || y.playerCount - x.playerCount
  const assignedBeats = leagueCoverage.filter((r) => r.scoutNames.length > 0).map(beatRow).sort(byKnowledge)
  // With nobody deployed the panel would be blank, which reads as a rendering
  // bug rather than a fact about the club. Fall back to the beats we know best
  // anyway — labelled honestly as passive knowledge, since that is what it is.
  const covering = (assignedBeats.length > 0
    ? assignedBeats
    : leagueCoverage.map(beatRow).sort(byKnowledge)
  ).slice(0, 6)

  /* ── blind spots ──────────────────────────────────────────────────────── */
  // A blind spot is not simply "a league we don't know". It is a league with real
  // DRAFT-AGE TALENT in it that nobody is watching — the pool where the player
  // you're never going to find is currently playing.
  const youthOf = new Map(leagueCoverage.map((r) => [r.id, r.youthCount]))
  const blindSpots = leagueCoverage
    .filter((r) => r.id !== 'nhl' && r.id !== 'ahl')
    .filter((r) => r.youthCount >= 20 && r.youthAvgKnowledge < 35 && r.scoutNames.length === 0)
    .map(beatRow)
    .sort((x, y) => {
      const sx = (youthOf.get(x.id) ?? 0) * (100 - x.knowledge)
      const sy = (youthOf.get(y.id) ?? 0) * (100 - y.knowledge)
      return sy - sx
    })
    .slice(0, 5)

  /* ── where our own scouts disagree ────────────────────────────────────── */
  const disagreements: ScoutDisagreementRow[] = []
  const boards = a.scoutBoards ?? []
  if (boards.length >= 2) {
    const spread = new Map<string, { hi: { name: string; rank: number }; lo: { name: string; rank: number } }>()
    for (const b of boards) {
      for (const row of b.rows) {
        const cur = spread.get(row.playerId)
        if (!cur) {
          spread.set(row.playerId, { hi: { name: b.scoutName, rank: row.rank }, lo: { name: b.scoutName, rank: row.rank } })
          continue
        }
        if (row.rank < cur.hi.rank) cur.hi = { name: b.scoutName, rank: row.rank }
        if (row.rank > cur.lo.rank) cur.lo = { name: b.scoutName, rank: row.rank }
      }
    }
    const teamAbbrOf = new Map<string, string>()
    for (const t of a.teams.values()) for (const id of t.roster) teamAbbrOf.set(id as string, t.abbreviation)
    for (const [pid, v] of spread) {
      const gap = v.lo.rank - v.hi.rank
      if (gap < 8 || v.hi.name === v.lo.name) continue
      const p = players.get(pid as PlayerId)
      if (!p) continue
      // A split opinion is only interesting if somebody has actually watched him.
      if (knowledgeOf(scouting, pid) < SCOUT_SEEN_THRESHOLD) continue
      disagreements.push({
        playerId: pid,
        name: p.name,
        position: p.position as string,
        age: p.age,
        teamAbbr: teamAbbrOf.get(pid) ?? 'FA',
        highScout: v.hi.name,
        highRank: v.hi.rank,
        lowScout: v.lo.name,
        lowRank: v.lo.rank,
        spread: gap,
        line: `${v.hi.name} has him ${ordinal(v.hi.rank)}; ${v.lo.name} has him ${ordinal(v.lo.rank)}. Somebody in that room is wrong — a third look would settle it.`,
      })
    }
    disagreements.sort((x, y) => y.spread - x.spread || x.name.localeCompare(y.name))
    disagreements.splice(4)
  }

  /* ── draft-class coverage ─────────────────────────────────────────────── */
  let filed = 0
  for (const pid of draftProspectIds) {
    if (knowledgeOf(scouting, pid) >= SCOUT_SEEN_THRESHOLD) filed++
  }
  const classTotal = draftProspectIds.size
  const classPct = pct(filed, classTotal)
  const classLine = classTotal === 0
    ? 'No draft class in the database to work.'
    : classPct === 0
      ? `Nobody in the ${classTotal}-name class has been watched enough for your staff to hold an opinion. Every grade you'd read today is somebody else's.`
      : classPct < 15
        ? `Your staff has filed on ${filed} of ${classTotal} eligibles — ${classPct}%. Whoever goes at your pick, the odds are nobody in your building has seen him.`
        : classPct < 45
          ? `${filed} of ${classTotal} eligibles carry a real read (${classPct}%). Enough to have opinions in the first round, not enough to run a draft.`
          : `${filed} of ${classTotal} eligibles are scouted (${classPct}%) — your board is your own now, not the public one.`

  /* ── what changed since last month ────────────────────────────────────── */
  const changes: ScoutingChangeRow[] = []
  let worldSum = 0, worldN = 0, filedNow = 0
  for (const [, k] of scouting.knowledge) {
    worldSum += k; worldN++
    if (k >= SCOUT_SEEN_THRESHOLD) filedNow++
  }
  const worldNow = worldN ? Math.round((worldSum / worldN) * 10) / 10 : 0
  if (last) {
    const since = last.date
    const dWorld = Math.round((worldNow - last.world) * 10) / 10
    if (Math.abs(dWorld) >= 0.2) {
      changes.push({
        kind: 'knowledge',
        delta: dWorld,
        text: dWorld > 0
          ? `Department-wide read up ${dWorld.toFixed(1)} points since ${monthName(since)}.`
          : `Department-wide read has slipped ${Math.abs(dWorld).toFixed(1)} points since ${monthName(since)} — files go stale when nobody is looking.`,
      })
    }
    const dFiled = filedNow - last.filed
    if (dFiled !== 0) {
      changes.push({
        kind: 'board',
        delta: dFiled,
        text: dFiled > 0
          ? `${dFiled} more player${dFiled === 1 ? '' : 's'} crossed into a real read this month.`
          : `${Math.abs(dFiled)} file${Math.abs(dFiled) === 1 ? '' : 's'} decayed back below an opinion.`,
      })
    }
    const movers = leagueCoverage
      .map((r) => ({ label: r.label, d: Math.round((r.avgKnowledge - (prevLeague.get(r.id) ?? r.avgKnowledge)) * 10) / 10 }))
      .filter((m) => Math.abs(m.d) >= 1)
      .sort((x, y) => Math.abs(y.d) - Math.abs(x.d))
      .slice(0, 3)
    for (const m of movers) {
      changes.push({
        kind: 'coverage',
        delta: m.d,
        text: m.d > 0 ? `${m.label} coverage up ${m.d.toFixed(1)}.` : `${m.label} coverage down ${Math.abs(m.d).toFixed(1)} — no one has been there.`,
      })
    }
    const newFinds = recommendations.filter((r) => r.foundDate >= since).length
    if (newFinds > 0) {
      changes.push({ kind: 'finds', delta: newFinds, text: `${newFinds} new name${newFinds === 1 ? '' : 's'} flagged since ${monthName(since)}.` })
    }
    const newPins = watchList.filter((w) => w.addedDate >= since).length
    if (newPins > 0) {
      changes.push({ kind: 'watch', delta: newPins, text: `You pinned ${newPins} player${newPins === 1 ? '' : 's'} to the watch list this month.` })
    }
  }

  /* ── position coverage vs roster need ─────────────────────────────────── */
  const groups: PosGroup[] = ['C', 'W', 'D', 'G']
  const trackedBy: Record<PosGroup, { tracked: number; sum: number; n: number }> = {
    C: { tracked: 0, sum: 0, n: 0 }, W: { tracked: 0, sum: 0, n: 0 },
    D: { tracked: 0, sum: 0, n: 0 }, G: { tracked: 0, sum: 0, n: 0 },
  }
  for (const pid of draftProspectIds) {
    const p = players.get(pid as PlayerId)
    if (!p) continue
    const g = groupOf(p.position as string)
    const k = knowledgeOf(scouting, pid)
    trackedBy[g].sum += k
    trackedBy[g].n++
    if (k >= SCOUT_SEEN_THRESHOLD) trackedBy[g].tracked++
  }
  const needCoverage = groups.map((g) => {
    const t = trackedBy[g]
    const know = t.n ? Math.round(t.sum / t.n) : 0
    const need = needGroups.has(g)
    const want = NEED_NOUN[g]
    const line = need && t.tracked === 0
      ? `You need ${want} and your department has filed on none in this class.`
      : need
        ? `You need ${want}; ${t.tracked} in the class carry a read.`
        : t.tracked === 0
          ? 'No reads filed in this class.'
          : `${t.tracked} scouted.`
    return { group: groupLabel[g], need, tracked: t.tracked, knowledge: know, line }
  })

  /* ── bandwidth ────────────────────────────────────────────────────────── */
  const load = scouts.reduce((sum, s) => sum + s.coverage, 0)
  const per = scouts.length ? Math.round(load / scouts.length) : 0
  const thin = scouts.filter((s) => s.readSpeed === 'Thin').length
  const idle = scouts.filter((s) => s.coverage === 0).length
  const headline = scouts.length === 0
    ? 'You have no scouts. Everything you think you know about the rest of the world is public information.'
    : load === 0
      ? `${countWord(scouts.length)} scout${scouts.length === 1 ? '' : 's'} on the books, and not one player in front of ${scouts.length === 1 ? 'him' : 'them'}.`
      : `${countWord(scouts.length)} scout${scouts.length === 1 ? '' : 's'} carrying ${load.toLocaleString()} players between them.`
  const strain = scouts.length === 0
    ? 'Hire someone under Recruitment Focus before the draft, or you will be picking off the same board every other club can read.'
    : idle >= scouts.length
      ? `Every brief you have set resolves to nobody — check Recruitment Focus, because an unassigned scout files nothing.`
      : idle > 0
        ? `${countWord(idle)} of them ${idle === 1 ? 'has' : 'have'} nothing in scope — an unassigned scout files nothing.`
        : per <= SCOUT_CAPACITY
          ? `About ${per} players each — inside what a scout can actually watch, so reads come fast.`
          : thin > 0
            ? `About ${per} each, roughly ${Math.round(per / SCOUT_CAPACITY)}× what one man can watch closely. ${thin} brief${thin === 1 ? ' is' : 's are'} spread thin; narrow them and the reads sharpen.`
            : `About ${per} each — beyond close watching, so every read is slower than it needs to be.`

  return {
    headline,
    strain,
    classCoverage: { filed, total: classTotal, pct: classPct, line: classLine },
    covering,
    blindSpots,
    disagreements,
    changes,
    needCoverage,
    ...(last ? { since: last.date } : {}),
  }
}

/** What the roster is actually short of, in words a chief scout would use. */
const NEED_NOUN: Record<PosGroup, string> = {
  C: 'a centre', W: 'a winger', D: 'a defenceman', G: 'a goaltender',
}

const COUNT_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten']

/** Small numbers read better as words in prose; big ones stay numerals. */
function countWord(n: number): string {
  return COUNT_WORDS[n] ?? String(n)
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2027-11-01" → "November". */
function monthName(iso: string): string {
  const m = parseInt(iso.slice(5, 7), 10)
  return MONTHS[m - 1] ?? 'last month'
}

/** 1 → "1st". */
function ordinal(n: number): string {
  const rem100 = n % 100
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`
  const rem = n % 10
  return `${n}${rem === 1 ? 'st' : rem === 2 ? 'nd' : rem === 3 ? 'rd' : 'th'}`
}
