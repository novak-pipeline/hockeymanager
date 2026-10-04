/**
 * Offseason 3.0 — NEEDS FIRST (depth audit 2026-09, audit-gameplay-loop §4 and
 * audit-squad-building §3).
 *
 * The owner: "the trade screen, free agent screen have always felt like giant
 * lists that i dont want." A GM does not shop a list of 155 names; he shops for
 * a hole. This module reads the org's depth chart for next season against the
 * league's own depth at every slot and names the holes in hockey language —
 * "a 2nd-pair LHD", "a backup G", "$6.2M of cap space" — then offers each one
 * three to five REAL answers: free agents (with the actual bids against you),
 * trade targets (with what they'd cost in assets), your own expiring men, and
 * for a cap need, the contracts that would clear it.
 *
 * Pure: the career layer supplies the depth, the league benchmarks and the
 * candidate pools; this decides what is a need and who answers it.
 */
import { withArticle } from '@engine/story/prose'
import type { NeedCandidateView, OffseasonNeedView } from './views'

export type NeedGroup = 'F' | 'D' | 'G'

/** One of your players under contract for next season. */
export interface DepthEntry {
  playerId: string
  name: string
  position: string
  group: NeedGroup
  hand: 'L' | 'R'
  ovr: number
  salary: number
  age: number
}

/** A candidate answer, before it is matched to a need. */
export type NeedsCandidate = Omit<NeedCandidateView, 'fit'> & { group: NeedGroup }

export interface NeedsInput {
  depth: DepthEntry[]
  /** The league's average overall at each depth slot, best first, per group
   *  (F 12, D 6, G 2) — what a normal NHL club dresses there. */
  benchmark: Record<NeedGroup, number[]>
  capCeiling: number
  /** Next season's committed cap (including dead cap). */
  committed: number
  /** Free agents, trade targets and your own expiring men. */
  pool: NeedsCandidate[]
  /** Your own contracts that could be moved to clear money. */
  moveable: NeedsCandidate[]
}

/** How many regulars a club dresses per group. */
const DRESSED: Record<NeedGroup, number> = { F: 12, D: 6, G: 2 }
/** A slot this far below the league's is a need. */
const GAP_NEED = 3
const MAX_NEEDS = 4
const MAX_CANDIDATES = 5

interface Role {
  key: string
  group: NeedGroup
  /** Slot indices (0-based, best first) the role covers. */
  slots: number[]
  label: string
  /** How much a hole here hurts. */
  weight: number
  /** Defense only: the hand this role most wants. */
  hand?: 'L' | 'R'
  /** A top six short of centres wants a natural centre. */
  position?: 'C'
}

function roles(depth: DepthEntry[]): Role[] {
  const out: Role[] = [
    { key: 'F-top', group: 'F', slots: [0, 1, 2, 3, 4, 5], label: 'a top-six forward', weight: 1.4 },
    { key: 'F-mid', group: 'F', slots: [6, 7, 8], label: 'a third-line forward', weight: 1 },
    { key: 'F-bot', group: 'F', slots: [9, 10, 11], label: 'a fourth-line forward', weight: 0.6 },
    { key: 'D-1', group: 'D', slots: [0, 1], label: 'a top-pair D', weight: 1.5 },
    { key: 'D-2', group: 'D', slots: [2, 3], label: 'a 2nd-pair D', weight: 1.1 },
    { key: 'D-3', group: 'D', slots: [4, 5], label: 'a 3rd-pair D', weight: 0.7 },
    { key: 'G-1', group: 'G', slots: [0], label: 'a starting goalie', weight: 1.8 },
    { key: 'G-2', group: 'G', slots: [1], label: 'a backup G', weight: 0.9 },
  ]
  // Centres: a top six with fewer than two natural centres needs one.
  const f = depth.filter((d) => d.group === 'F').sort((a, b) => b.ovr - a.ovr)
  const topCs = f.slice(0, 6).filter((d) => d.position === 'C').length
  if (f.length >= 6 && topCs < 2) {
    const top = out.find((r) => r.key === 'F-top')!
    top.label = 'a top-six centre'
    top.position = 'C'
  }
  // Defense pairs want one left shot and one right shot.
  const d = depth.filter((x) => x.group === 'D').sort((a, b) => b.ovr - a.ovr)
  for (const r of out.filter((x) => x.group === 'D')) {
    const pair = r.slots.map((i) => d[i]).filter((x): x is DepthEntry => !!x)
    const ls = pair.filter((x) => x.hand === 'L').length
    const rs = pair.filter((x) => x.hand === 'R').length
    const want: 'L' | 'R' | undefined = pair.length < 2
      ? (ls > rs ? 'R' : rs > ls ? 'L' : undefined)
      : ls === 0 ? 'L' : rs === 0 ? 'R' : undefined
    if (want) {
      r.hand = want
      r.label = r.label.replace(/ D$/, ` ${want}HD`)
    }
  }
  return out
}

interface Gap {
  role: Role
  /** The weakest occupant of the role (absent = an empty slot). */
  weakest?: DepthEntry
  /** Overall points below the league at the role's weakest slot. */
  gap: number
  /** That slot (0-based) and what a normal club dresses there. */
  slot: number
  bench: number
  empty: number
  score: number
}

function findGaps(input: NeedsInput): Gap[] {
  const gaps: Gap[] = []
  const byGroup: Record<NeedGroup, DepthEntry[]> = { F: [], D: [], G: [] }
  for (const d of input.depth) byGroup[d.group].push(d)
  for (const g of ['F', 'D', 'G'] as const) byGroup[g].sort((a, b) => b.ovr - a.ovr)
  for (const role of roles(input.depth)) {
    const list = byGroup[role.group]
    let worst = 0
    let weakest: DepthEntry | undefined
    let empty = 0
    let slot = role.slots[0]!
    let benchAt = 0
    for (const i of role.slots) {
      const occ = list[i]
      const bench = input.benchmark[role.group][i] ?? input.benchmark[role.group][input.benchmark[role.group].length - 1] ?? 60
      if (!occ) {
        empty++
        if (bench - 45 > worst) { worst = bench - 45; slot = i; benchAt = bench; weakest = undefined }
        continue
      }
      const gap = bench - occ.ovr
      if (gap > worst || (benchAt === 0 && gap >= worst)) { worst = gap; weakest = occ; slot = i; benchAt = bench }
    }
    // A pair with no man of the hand it needs is a need even at par; the man
    // to replace is the weaker of the pair.
    const handNeed = role.hand && role.group === 'D' ? 1.5 : 0
    if (handNeed > 0 && !weakest) {
      const pair = role.slots.map((i) => list[i]).filter((x): x is DepthEntry => !!x).sort((a, b) => a.ovr - b.ovr)
      if (pair[0]) { weakest = pair[0]; slot = list.indexOf(pair[0]); benchAt = input.benchmark[role.group][slot] ?? benchAt }
    }
    const score = (Math.max(0, worst) + handNeed + empty * 6) * role.weight
    // A pair without the hand it needs is a need unless it is clearly better
    // than the league there anyway.
    if (empty > 0 || worst >= GAP_NEED || (handNeed > 0 && worst >= -1)) {
      gaps.push({ role, ...(weakest ? { weakest } : {}), gap: Math.round(worst * 10) / 10, slot, bench: benchAt, empty, score })
    }
  }
  return gaps.sort((a, b) => b.score - a.score)
}

function fitLine(c: NeedsCandidate, gap: Gap): string {
  const where = gap.role.label.replace(/^an? /, '')
  if (gap.role.hand && gap.weakest && gap.gap < GAP_NEED && gap.empty === 0) {
    return `A ${gap.role.hand === 'L' ? 'left' : 'right'} shot for the pair: ${Math.round(c.overall)} against ${gap.weakest.name}'s ${Math.round(gap.weakest.ovr)}`
  }
  if (gap.weakest) {
    const plus = Math.round(c.overall - gap.weakest.ovr)
    return `Slots in as your ${where}: ${plus >= 0 ? `+${plus}` : `−${-plus}`} over ${gap.weakest.name}`
  }
  return `Fills the empty ${where} spot`
}

/** Candidates for one role: better than who is there now, of the right
 *  group (and hand, when a pair lacks one), ranked by what they add per
 *  dollar with a mix of kinds so the answer is never one list. */
function candidatesFor(gap: Gap, pool: NeedsCandidate[], used: Set<string>, capRoom: number): NeedCandidateView[] {
  // A hand need is about the shot, so a man at the pair's level will do; any
  // other need wants a real upgrade on the man there now.
  const handOnly = !!gap.role.hand && gap.gap < GAP_NEED && gap.empty === 0
  const bar = gap.weakest ? gap.weakest.ovr + (handOnly ? -1 : 1) : 0
  const fits = pool.filter((c) =>
    c.group === gap.role.group &&
    !used.has(c.playerId) &&
    c.overall >= bar &&
    (!gap.role.position || c.position === gap.role.position) &&
    (!gap.role.hand || c.hand === gap.role.hand || gap.role.group !== 'D'))
  // Value for money: the upgrade, discounted when he doesn't fit the room.
  const rank = (c: NeedsCandidate): number => {
    const add = c.overall - (gap.weakest?.ovr ?? 50)
    const overRoom = Math.max(0, c.capHit - capRoom) / 1e6
    const handBonus = gap.role.hand && c.hand === gap.role.hand ? 1.5 : 0
    return add + handBonus - overRoom * 1.5 - (c.kind === 'trade' ? 0.5 : 0)
  }
  const sorted = [...fits].sort((a, b) => rank(b) - rank(a) || b.overall - a.overall)
  // Up to five answers from EACH market — the free-agent side (the open
  // market and your own expiring men) and the trade side — so every screen
  // that shows the board has a full set of its own kind (see needsFor).
  const out: NeedsCandidate[] = []
  for (const side of [SIGNING_KINDS, TRADE_KINDS]) {
    const mine = sorted.filter((c) => side.has(c.kind))
    // Your own man first when he fits: the cheapest fix is often in the room.
    const own = mine.find((c) => c.kind === 'resign')
    const picked = own ? [own, ...mine.filter((c) => c !== own)] : mine
    out.push(...picked.slice(0, MAX_CANDIDATES))
  }
  for (const c of out) used.add(c.playerId)
  return out.map(({ group: _g, ...c }) => ({ ...c, fit: fitLine(c as NeedsCandidate, gap) }))
}

/** Answers you SIGN (the open market, your own expiring men). */
const SIGNING_KINDS: ReadonlySet<NeedCandidateView['kind']> = new Set(['fa', 'resign'])
/** Answers you TRADE for (other clubs' players, your contracts to move). */
const TRADE_KINDS: ReadonlySet<NeedCandidateView['kind']> = new Set(['trade', 'move'])

/** Where the board is shown: the Free Agents desk, the Trade Centre, or the
 *  offseason overview (both, grouped). */
export type NeedsContext = 'fa' | 'trade' | 'all'

export interface NeedsGroup {
  kind: 'fa' | 'trade'
  /** "Free agents" / "Trade targets". */
  title: string
  candidates: NeedCandidateView[]
}

/** One need as a screen shows it: its answers of the screen's kind, grouped,
 *  and — when a group is empty — where to look instead. The need itself is
 *  never dropped: a hole is still a hole on the desk that can't fill it. */
export interface NeedInContext extends OffseasonNeedView {
  groups: NeedsGroup[]
  /** No answer of this screen's kind: say so, and point to the other desk. */
  elsewhere?: { text: string; screen: 'faMarket' | 'trades' }
}

/**
 * The needs board, filtered to where it is shown. The Free Agents desk shows
 * only free agents and your own re-sign candidates; the Trade Centre only
 * trade targets and, for a cap need, the contracts that would clear it; the
 * offseason overview shows both, grouped.
 */
export function needsFor(needs: OffseasonNeedView[], context: NeedsContext): NeedInContext[] {
  return needs.map((n) => {
    const signing = n.candidates.filter((c) => SIGNING_KINDS.has(c.kind)).slice(0, MAX_CANDIDATES)
    const trading = n.candidates.filter((c) => TRADE_KINDS.has(c.kind)).slice(0, MAX_CANDIDATES)
    const faGroup: NeedsGroup = { kind: 'fa', title: 'Free agents', candidates: signing }
    const trGroup: NeedsGroup = { kind: 'trade', title: n.kind === 'cap' ? 'Contracts that would clear it' : 'Trade targets', candidates: trading }
    if (context === 'fa') {
      return {
        ...n,
        groups: [faGroup],
        ...(signing.length === 0
          ? { elsewhere: n.kind === 'cap'
              ? { text: 'Cap room is cleared by moving a contract — see the Trade Centre.', screen: 'trades' as const }
              : { text: 'No free agents fit — see the Trade Centre.', screen: 'trades' as const } }
          : {}),
      }
    }
    if (context === 'trade') {
      return {
        ...n,
        groups: [trGroup],
        ...(trading.length === 0 ? { elsewhere: { text: 'No trade target fits — see Free Agents.', screen: 'faMarket' as const } } : {}),
      }
    }
    const groups = [faGroup, trGroup].filter((g) => g.candidates.length > 0)
    return { ...n, groups, ...(groups.length === 0 ? { elsewhere: { text: 'No real answer on the market today — nobody out there is better than who you have.', screen: 'faMarket' as const } } : {}) }
  })
}

const money = (n: number): string => `$${(n / 1e6).toFixed(1)}M`

/**
 * The needs, most pressing first, each with its answers — plus a cap need
 * when filling them (at the cheapest real answer) would break the ceiling.
 */
export function buildNeeds(input: NeedsInput): { needs: OffseasonNeedView[]; headline: string } {
  const gaps = findGaps(input).slice(0, MAX_NEEDS)
  const room = input.capCeiling - input.committed
  const used = new Set<string>()
  const needs: OffseasonNeedView[] = []
  let fillCost = 0
  for (const g of gaps) {
    const candidates = candidatesFor(g, input.pool, used, Math.max(0, room - fillCost))
    const cheapest = candidates.length > 0 ? Math.min(...candidates.map((c) => c.capHit)) : 0
    fillCost += cheapest
    const groupWord = g.role.group === 'F' ? 'forward' : g.role.group === 'D' ? 'defenseman' : 'goalie'
    const ord = (n: number): string => `${n}${n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'}`
    const pairOf = (r: Role): DepthEntry[] => {
      const list = input.depth.filter((x) => x.group === r.group).sort((a, b) => b.ovr - a.ovr)
      return r.slots.map((i) => list[i]).filter((x): x is DepthEntry => !!x)
    }
    const handOnly = g.role.hand && g.gap < GAP_NEED && g.empty === 0
    const why = handOnly
      ? `The pair has no ${g.role.hand === 'L' ? 'left' : 'right'} shot: ${pairOf(g.role).map((x) => x.name).join(' and ')} both shoot ${g.role.hand === 'L' ? 'right' : 'left'}, so one plays his off side.`
      : g.empty > 0
      ? `You have ${g.empty} empty ${g.empty === 1 ? 'spot' : 'spots'} there for next season.`
      : g.weakest
        ? `Your ${ord(g.slot + 1)} ${groupWord} is ${g.weakest.name} (${Math.round(g.weakest.ovr)}); a normal club dresses ${withArticle(String(Math.round(g.bench)))} there.` +
          (g.role.hand ? ` And the pair has no ${g.role.hand === 'L' ? 'left' : 'right'} shot.` : '')
        : 'Below the league at this spot.'
    needs.push({
      id: g.role.key,
      kind: 'slot',
      label: g.role.label,
      why,
      severity: g.score >= 12 ? 3 : g.score >= 6 ? 2 : 1,
      group: g.role.group,
      candidates,
    })
  }
  // The cap: can the club afford its own answers?
  const short = input.committed + fillCost - input.capCeiling
  if (short > 0) {
    const pick: NeedCandidateView[] = []
    let cleared = 0
    const movers = [...input.moveable].sort((a, b) => (b.capHit - b.assetValue * 1e5) - (a.capHit - a.assetValue * 1e5))
    for (const m of movers) {
      if (pick.length >= MAX_CANDIDATES || (cleared >= short && pick.length >= 3)) break
      const { group: _g, ...c } = m
      pick.push({ ...c, fit: `Clears ${money(m.capHit)}${m.years > 1 ? ` for ${m.years} years` : ''}` })
      cleared += m.capHit
    }
    needs.push({
      id: 'cap',
      kind: 'cap',
      label: `${money(short)} of cap space`,
      why: `Next season you have ${money(input.committed)} committed against a ${money(input.capCeiling)} ceiling. ` +
        (fillCost > 0 ? `Filling these holes at the cheapest real answers costs about ${money(fillCost)}.` : 'You are over before adding anyone.'),
      severity: short >= 5e6 ? 3 : short >= 2e6 ? 2 : 1,
      amount: short,
      candidates: pick,
    })
  }
  const headline = needs.length === 0
    ? 'No holes: your depth for next season matches the league at every spot.'
    : `You need: ${needs.map((n) => n.label).join(', ')}`
  return { needs, headline }
}

/** The league's depth benchmark: the average overall at each slot, taken
 *  across every club's best F12 / D6 / G2. */
export function leagueBenchmark(rosters: Array<Array<{ group: NeedGroup; ovr: number }>>): Record<NeedGroup, number[]> {
  const sums: Record<NeedGroup, number[]> = { F: new Array(DRESSED.F).fill(0), D: new Array(DRESSED.D).fill(0), G: new Array(DRESSED.G).fill(0) }
  const counts: Record<NeedGroup, number[]> = { F: new Array(DRESSED.F).fill(0), D: new Array(DRESSED.D).fill(0), G: new Array(DRESSED.G).fill(0) }
  for (const r of rosters) {
    for (const g of ['F', 'D', 'G'] as const) {
      const ovrs = r.filter((x) => x.group === g).map((x) => x.ovr).sort((a, b) => b - a).slice(0, DRESSED[g])
      ovrs.forEach((o, i) => { sums[g][i]! += o; counts[g][i]!++ })
    }
  }
  const out: Record<NeedGroup, number[]> = { F: [], D: [], G: [] }
  for (const g of ['F', 'D', 'G'] as const) out[g] = sums[g].map((s, i) => (counts[g][i]! > 0 ? Math.round((s / counts[g][i]!) * 10) / 10 : 0))
  return out
}
