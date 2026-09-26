/**
 * THE LEAGUE MARKET — AI-to-AI trades with character
 * (docs/LIVING-WORLD-ECONOMY-AND-AI.md).
 *
 * The old generator had one shape (a seller's best short-term veteran, never a
 * goalie, for 1–2 picks), priced at market value, in-season only. This one:
 *
 *  - picks an INITIATOR weighted by his GM's aggression and builds a deal of a
 *    SHAPE that fits the window and the club's situation: a rental, a veteran
 *    for a prospect-led return, a player-for-player hockey trade (need for
 *    need), a goalie trade, or a cap dump with a sweetener attached;
 *  - runs in the offseason too (draft floor + July: hockey trades, dumps,
 *    goalies, "sell before camp" veterans);
 *  - prices every deal through BOTH clubs' own lens (`evaluateProposal`, the
 *    same judge the user faces) — each side must say yes on its own book;
 *  - lets the persona colour everything: pickHoarding picks the return mix,
 *    loyalty protects a club's own draftees, capDiscipline decides when a club
 *    dumps salary, aggression is the overpay (a friendlier threshold) and the
 *    frequency, patience shapes who is selling at all (via the live posture).
 *
 * Returns a PROPOSED deal (talks). The Career holds it as pending talks for a
 * few days and executes it only if it still stands (two-phase; see
 * `PendingLeagueDeal` in career.ts) — the hook a later insider layer reads.
 *
 * Pure given its inputs + the seeded Rng.
 */
import type { DraftPick, Player, PlayerId, Team, TeamId } from '@domain'
import { ratedOverall } from '@engine/ratings/composites'
import type { Rng } from '@engine/shared/rng'
import { personaPhilosophy as personaPhilosophyLens, type GmPersona, type PostureKind } from './gmPersona'
import {
  evaluateProposal,
  fairSalaryFor,
  groupOf,
  MAX_RETAIN_PCT,
  MAX_RETAIN_SLOTS,
  MIN_SHOP_VALUE,
  pickValue,
  playerValue,
  rosterCapUsed,
  type AiAiTradeResult,
  type PositionGroup,
} from './trades'
import type { AiTradeShape } from './worldTelemetry'
import { wageIndex } from './economy'

export type MarketWindow = 'inSeason' | 'deadline' | 'offseason'

export interface MarketClub {
  team: Team
  persona: GmPersona
  posture: PostureKind
  /** 1 = strongest roster in the league. */
  strengthRank: number
}

export interface LeagueDealArgs {
  window: MarketWindow
  /** 0 = October … 1 = deadline day. */
  deadlineProximity: number
  /** Every club in the world (affiliates are looked up here). */
  teams: Map<TeamId, Team>
  /** The AI NHL clubs that may deal (never the user's). */
  clubs: MarketClub[]
  players: Map<PlayerId, Player>
  picks: DraftPick[]
  rng: Rng
  /** The club's cap floor. */
  floorOf: (team: Team) => number
  /** Prospects (AHL / rights) the club could put in a deal. */
  prospectsOf: (team: Team) => Player[]
  /** Players already committed to a pending deal (can't be in two). */
  busy?: ReadonlySet<string>
  /** Diagnostics: told why an attempt came back empty (harness only). */
  why?: (reason: string) => void
}

/** The persona's reasoning for the wire — plain facts, no prose pools. */
export interface DealRationale {
  seller: string
  buyer: string
}

export interface LeagueDeal extends AiAiTradeResult {
  shape: AiTradeShape
  rationale: DealRationale
}

/* ───────────────────────── helpers ───────────────────────── */

const GROUP_REGULARS: Record<PositionGroup, number> = { F: 9, D: 5, G: 1 }

/** The weakest REGULAR at a group — the man an arrival must beat to matter. */
function replacementLevel(team: Team, players: Map<PlayerId, Player>, g: PositionGroup, leaving: ReadonlySet<string> = new Set()): number {
  const ovrs = team.roster
    .filter((id) => !leaving.has(id as string))
    .map((id) => players.get(id))
    .filter((p): p is Player => !!p && groupOf(p.position) === g)
    .map((p) => ratedOverall(p))
    .sort((a, b) => b - a)
  return ovrs[GROUP_REGULARS[g] - 1] ?? (ovrs.length ? ovrs[ovrs.length - 1]! - 6 : 40)
}

function groupCount(team: Team, players: Map<PlayerId, Player>, g: PositionGroup): number {
  let n = 0
  for (const id of team.roster) {
    const p = players.get(id)
    if (p && groupOf(p.position) === g) n++
  }
  return n
}

const capUsed = (t: Team, players: Map<PlayerId, Player>): number => rosterCapUsed(t, players)

function ownedPicks(picks: DraftPick[], owner: TeamId, year: number, ranks: Map<string, number>): Array<{ pick: DraftPick; value: number }> {
  return picks
    .filter((p) => p.ownerTeamId === owner)
    .map((pick) => {
      const rank = ranks.get(pick.originalTeamId as string)
      // Valued the way evaluateProposal will see it (it discounts from the deal's
      // own earliest pick year, so a lone future pick carries no discount).
      void year
      return { pick, value: pickValue(pick, rank === undefined ? { year: pick.year } : { year: pick.year, teamStrengthRank: rank }) }
    })
    .sort((a, b) => b.value - a.value || a.pick.year - b.pick.year || a.pick.round - b.pick.round)
}

/** Did this club draft him (and does it know it)? Loyal GMs don't move these. */
function isOwnDraftee(p: Player, team: Team): boolean {
  return p.nhlDrafted === true && p.draftClub !== undefined && p.draftClub === team.name
}

function movable(p: Player | undefined, busy: ReadonlySet<string> | undefined): p is Player {
  return !!p && p.injuryStatus === null && !p.contract.noTradeClause && !(busy?.has(p.id as string) ?? false)
}

const ord = (n: number): string => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`)
const pickLabel = (p: DraftPick): string => `a ${p.year} ${ord(p.round)}`
const money = (n: number): string => `$${(n / 1e6).toFixed(2)}M`

/** Weighted draw of one club by a score (≥0). */
function weightedPick<T>(rng: Rng, items: T[], weight: (t: T) => number): T | undefined {
  const ws = items.map((t) => Math.max(0, weight(t)))
  const total = ws.reduce((a, b) => a + b, 0)
  if (total <= 0) return undefined
  let r = rng.float(0, total)
  for (let i = 0; i < items.length; i++) {
    r -= ws[i]!
    if (r <= 0) return items[i]
  }
  return items[items.length - 1]
}

/**
 * Both front offices must say yes on their OWN book. `aGives` / `bGives` are
 * what each club sends. Aggression is the overpay: an aggressive GM's
 * threshold sits lower (the evaluator's relationship dial, ±0.1).
 */
function bothAccept(args: {
  a: MarketClub
  b: MarketClub
  aGives: { players: Player[]; picks: DraftPick[] }
  bGives: { players: Player[]; picks: DraftPick[] }
  players: Map<PlayerId, Player>
  rng: Rng
  deadlineProximity: number
  /** Farm / rights assets in either package (no cap hit, no roster slot). */
  farmIds: ReadonlySet<string>
  retainedByA?: number
  why?: ((reason: string) => void) | undefined
}): boolean {
  const { a, b, aGives, bGives, players, rng, deadlineProximity, farmIds } = args
  const rel = (c: MarketClub): number => 50 + (c.persona.aggression - 0.5) * 60
  const retained = args.retainedByA && aGives.players[0]
    ? new Map([[aGives.players[0].id as string, args.retainedByA]])
    : undefined
  // B judges: receives aGives, gives bGives.
  const forB = evaluateProposal({
    give: { players: aGives.players, picks: aGives.picks, ...(retained ? { retainedAmounts: retained } : {}) },
    receive: { players: bGives.players, picks: bGives.picks },
    partnerTeam: b.team,
    partnerPlayers: players,
    rng,
    relationship: rel(b),
    philosophy: personaPhilosophyLens(b.persona, b.posture),
    context: { posture: b.posture, deadlineProximity },
    nonRosterIds: farmIds,
  })
  if (forB.verdict !== 'accept') { args.why?.(`B:${forB.verdict}:${forB.message.replace(/[A-Z][a-z]+ [A-Z][a-z]+|\d+/g, '#').slice(0, 60)}`); return false }
  const forA = evaluateProposal({
    give: { players: bGives.players, picks: bGives.picks },
    receive: { players: aGives.players, picks: aGives.picks },
    partnerTeam: a.team,
    partnerPlayers: players,
    rng,
    relationship: rel(a),
    philosophy: personaPhilosophyLens(a.persona, a.posture),
    context: { posture: a.posture, deadlineProximity },
    nonRosterIds: farmIds,
  })
  if (forA.verdict !== 'accept') args.why?.(`A:${forA.verdict}:${forA.message.replace(/[A-Z][a-z]+ [A-Z][a-z]+|\d+/g, '#').slice(0, 60)}`)
  return forA.verdict === 'accept'
}

/* ───────────────────────── the generator ───────────────────────── */

/** Shape weights per window — the variety the wire should show. */
const SHAPE_WEIGHTS: Record<MarketWindow, Array<[AiTradeShape, number]>> = {
  inSeason: [['rental', 36], ['prospectFor', 16], ['hockey', 28], ['goalie', 12], ['capDump', 3], ['pickSwap', 0]],
  deadline: [['rental', 60], ['prospectFor', 18], ['hockey', 10], ['goalie', 10], ['capDump', 2], ['pickSwap', 0]],
  offseason: [['rental', 30], ['prospectFor', 20], ['hockey', 34], ['goalie', 10], ['capDump', 6], ['pickSwap', 0]],
}

export function generateLeagueDeal(args: LeagueDealArgs): LeagueDeal | null {
  const { rng } = args
  if (args.clubs.length < 2) return null
  // Draw a shape, then try it; fall through the others so an attempt rarely
  // comes back empty just because one shape had no candidates today.
  const weights = SHAPE_WEIGHTS[args.window].filter(([, w]) => w > 0)
  const first = weightedPick(rng, weights, ([, w]) => w)?.[0]
  const order = first ? [first, ...weights.map(([s]) => s).filter((s) => s !== first)] : []
  const ranks = new Map(args.clubs.map((c) => [c.team.id as string, c.strengthRank]))
  const year = args.picks.length ? Math.min(...args.picks.map((p) => p.year)) : 0
  for (let i = 0; i < Math.min(3, order.length); i++) {
    const shape = order[i]!
    const deal =
      shape === 'rental' ? sellVeteran(args, ranks, year, 'rental')
      : shape === 'prospectFor' ? sellVeteran(args, ranks, year, 'prospectFor')
      : shape === 'hockey' ? hockeyTrade(args, ranks, year)
      : shape === 'goalie' ? goalieTrade(args, ranks, year)
      : shape === 'capDump' ? capDump(args, ranks, year)
      : null
    if (deal) return deal
  }
  return null
}

/* ── rental / veteran-for-futures ── */

function sellVeteran(args: LeagueDealArgs, ranks: Map<string, number>, year: number, shape: 'rental' | 'prospectFor'): LeagueDeal | null {
  const { clubs, players, rng, busy } = args
  const rental = shape === 'rental'
  // Sellers: rebuilders always; retoolers when the calendar says so. A patient
  // rebuilder sells term too; the rental market is short deals only.
  const vetsOf = (seller: MarketClub): Player[] => seller.team.roster
    .map((id) => players.get(id))
    .filter((p): p is Player => movable(p, busy))
    // Deadline day moves depth too (a bottom-six rental for a late pick).
    .filter((p) => p.age >= 26 && playerValue(p) >= (args.window === 'deadline' ? MIN_SHOP_VALUE * 0.5 : MIN_SHOP_VALUE))
    .filter((p) => (rental ? p.contract.yearsRemaining <= 2 : p.contract.yearsRemaining >= 2 && p.contract.yearsRemaining <= 4))
    // A goalie sells only if the club keeps two.
    .filter((p) => p.position !== 'G' || groupCount(seller.team, players, 'G') >= 3)
    .filter((p) => !(seller.persona.loyalty >= 0.65 && isOwnDraftee(p, seller.team)))
    .sort((a, b) => playerValue(b) - playerValue(a) || (a.id < b.id ? -1 : 1))
  const sellers = clubs
    .filter((c) => c.posture === 'rebuild' || (c.posture === 'retool' && (args.window !== 'inSeason' || args.deadlineProximity > 0.3)))
    .map((c) => ({ c, vets: vetsOf(c) }))
    .filter((x) => x.vets.length > 0)
  const pickedSeller = weightedPick(rng, sellers, (x) => (x.c.posture === 'rebuild' ? 1.4 : 0.7) * (0.5 + x.c.persona.aggression))
  if (!pickedSeller) { args.why?.(`sellVeteran:noSeller`); return null }
  const seller = pickedSeller.c
  const vets = pickedSeller.vets
  const vet = vets[rng.int(Math.min(3, vets.length))] ?? vets[0]
  if (!vet) { args.why?.(`sellVeteran:L251`); return null }
  const g = groupOf(vet.position)
  const vetOvr = ratedOverall(vet)
  const vetValue = playerValue(vet)
  const salary = vet.contract.salary
  const slotFree = (seller.team.finances.retained?.length ?? 0) < MAX_RETAIN_SLOTS

  // Buyers: contenders — and at the deadline an aggressive retooler — who have
  // a real hole where he plays, a roster spot and the money (retention helps).
  const buyers = clubs
    .filter((c) => c !== seller && (c.posture === 'contend' || (c.posture === 'retool' && c.persona.aggression >= 0.6 && args.window !== 'inSeason')))
    .filter((c) => c.team.roster.length < 26)
    .filter((c) => vetOvr >= replacementLevel(c.team, players, g) + (g === 'G' ? 1 : 2))
  const buyer = weightedPick(rng, buyers, (c) => 0.4 + c.persona.aggression + (c.posture === 'contend' ? 0.4 : 0))
  if (!buyer) { args.why?.(`sellVeteran:L265`); return null }
  const room = buyer.team.finances.salaryCap - capUsed(buyer.team, players)
  let retained = 0
  // Money has to work. First the seller retains (up to half); failing that the
  // buyer sends salary back — a cheap-value roster body at the same group, the
  // classic "salary in the deal" (the seller needs the roster spot for him).
  let filler: Player | undefined
  if (salary > room) {
    const short = salary - room
    if (slotFree && short <= salary * MAX_RETAIN_PCT) {
      retained = Math.ceil(short)
    } else if (seller.team.roster.length < 26) {
      filler = buyer.team.roster
        .map((id) => players.get(id))
        .filter((p): p is Player => movable(p, busy) && p.position !== 'G' && p.contract.salary >= short && playerValue(p) <= vetValue * 0.6)
        .filter((p) => groupCount(buyer.team, players, groupOf(p.position)) > (groupOf(p.position) === 'D' ? 6 : 12) || groupOf(p.position) === g)
        .sort((x, y) => playerValue(x) - playerValue(y) || x.contract.salary - y.contract.salary)[0]
      if (!filler) { args.why?.(`sellVeteran:money`); return null }
    } else { args.why?.(`sellVeteran:money`); return null }
  }

  // The return: a pick-hoarder wants picks; a prospect-minded GM wants a kid.
  const pool = ownedPicks(args.picks, buyer.team.id, year, ranks)
  const prospects = args.prospectsOf(buyer.team)
    .filter((p) => movable(p, busy) && playerValue(p) >= MIN_SHOP_VALUE && playerValue(p) <= vetValue * 0.9)
    .filter((p) => !(buyer.persona.loyalty >= 0.7 && isOwnDraftee(p, buyer.team)))
    .sort((a, b) => playerValue(b) - playerValue(a))
  const wantsKid = !rental || rng.chance(0.2 + 0.6 * (1 - seller.persona.pickHoarding))
  const kid = wantsKid ? prospects[rng.int(Math.min(2, prospects.length))] ?? prospects[0] : undefined
  if (!rental && !kid) { args.why?.(`sellVeteran:L281`); return null }
  // Aggressive buyers pay a little over; a hoarding seller holds out for more.
  const target = vetValue * (0.9 + 0.3 * buyer.persona.aggression + 0.1 * seller.persona.pickHoarding)
  const chosen: DraftPick[] = []
  let total = (kid ? playerValue(kid) : 0) + (filler ? playerValue(filler) * 0.5 : 0)
  for (const c of pool) {
    if (chosen.length >= 2 || total >= target * 0.92) break
    if (total + c.value > target * 1.15) continue
    chosen.push(c.pick)
    total += c.value
  }
  if (!kid && chosen.length === 0) { args.why?.(`sellVeteran:L292`); return null }
  const farmIds = new Set<string>(kid ? [kid.id as string] : [])
  const ok = bothAccept({
    a: seller, b: buyer,
    aGives: { players: [vet], picks: [] },
    bGives: { players: [...(kid ? [kid] : []), ...(filler ? [filler] : [])], picks: chosen },
    players, rng, deadlineProximity: args.deadlineProximity, farmIds, why: args.why,
    ...(retained > 0 ? { retainedByA: retained } : {}),
  })
  if (!ok) { args.why?.(`sellVeteran:reject`); return null }
  const parts = [...chosen.map(pickLabel), ...(kid ? [`${kid.position} ${kid.name}`] : []), ...(filler ? [`${filler.position} ${filler.name} (salary)`] : [])]
  const isGoalie = vet.position === 'G'
  const retainNote = retained > 0 ? ` ${seller.team.abbreviation} retain ${money(retained)}.` : ''
  return {
    shape: isGoalie ? 'goalie' : shape,
    sellerTeamId: seller.team.id,
    buyerTeamId: buyer.team.id,
    playerIds: [vet.id],
    picks: chosen,
    prospectIds: kid ? [kid.id] : [],
    ...(filler ? { buyerPlayerIds: [filler.id] } : {}),
    ...(retained > 0 ? { retainedAmount: retained } : {}),
    summary: `${seller.team.abbreviation} send ${vet.position} ${vet.name} to ${buyer.team.abbreviation} for ${parts.join(' and ')}.${retainNote}`,
    rationale: {
      seller: seller.posture === 'rebuild'
        ? `${seller.persona.name} keeps selling — ${rental ? 'an expiring veteran is a pick wearing skates' : 'term on a veteran is years the rebuild does not need'}${kid ? `, and he wanted a kid back` : seller.persona.pickHoarding >= 0.6 ? ', and he wanted picks, as ever' : ''}`
        : `${seller.persona.name} is retooling on the fly`,
      buyer: `${buyer.persona.name}${buyer.persona.aggression >= 0.65 ? ', all in,' : ''} adds a ${isGoalie ? 'goalie' : g === 'D' ? 'defenceman' : 'forward'} ${rental ? 'for the run' : 'with term'} — ${vet.name} beats what he had`,
    },
  }
}

/* ── hockey trade: need for need ── */

function hockeyTrade(args: LeagueDealArgs, ranks: Map<string, number>, year: number): LeagueDeal | null {
  const { clubs, players, rng, busy } = args
  // Each club's need: the group whose weakest regular sits furthest below the
  // league's typical regular there; it can deal from the other group when it
  // has a body to spare (keeps 12 F / 6 D after the swap).
  const med = (g: PositionGroup): number => {
    const xs = clubs.map((c) => replacementLevel(c.team, players, g)).sort((x, y) => x - y)
    return xs[Math.floor(xs.length / 2)] ?? 60
  }
  const medF = med('F')
  const medD = med('D')
  const needOf = (c: MarketClub): PositionGroup =>
    replacementLevel(c.team, players, 'F') - medF < replacementLevel(c.team, players, 'D') - medD ? 'F' : 'D'
  const spare = (c: MarketClub, g: PositionGroup): boolean => groupCount(c.team, players, g) >= (g === 'D' ? 7 : 13)
  const initiators = clubs.filter((c) => spare(c, needOf(c) === 'F' ? 'D' : 'F'))
  const a = weightedPick(rng, initiators, (c) => 0.3 + c.persona.aggression)
  if (!a) { args.why?.(`hockeyTrade:noInitiator`); return null }
  const needA = needOf(a)
  const giveG: PositionGroup = needA === 'F' ? 'D' : 'F'
  // B needs what A spares, and can spare what A needs.
  const partners = clubs.filter((c) => c !== a && c.team.roster.length < 26 && needOf(c) === giveG && spare(c, needA))
  const b = weightedPick(rng, partners, (c) => 0.4 + c.persona.aggression)
  if (!b) { args.why?.(`hockeyTrade:noPartner`); return null }
  // A offers a middle player from its surplus group (never its top two there).
  const aSide = a.team.roster
    .map((id) => players.get(id))
    .filter((p): p is Player => movable(p, busy) && groupOf(p.position) === giveG && playerValue(p) >= MIN_SHOP_VALUE * 0.5)
    .filter((p) => !(a.persona.loyalty >= 0.65 && isOwnDraftee(p, a.team)))
    .sort((x, y) => ratedOverall(y) - ratedOverall(x))
    .slice(1)
  const give = aSide[rng.int(Math.min(4, aSide.length))] ?? aSide[0]
  if (!give) { args.why?.(`hockeyTrade:L351`); return null }
  const gv = playerValue(give)
  const bSide = b.team.roster
    .map((id) => players.get(id))
    .filter((p): p is Player => movable(p, busy) && groupOf(p.position) === needA)
    .filter((p) => Math.abs(playerValue(p) - gv) <= gv * 0.6)
    .filter((p) => ratedOverall(p) >= replacementLevel(a.team, players, needA))
    .filter((p) => !(b.persona.loyalty >= 0.65 && isOwnDraftee(p, b.team)))
    .sort((x, y) => Math.abs(playerValue(x) - gv) - Math.abs(playerValue(y) - gv))
  const get = bSide[0]
  if (!get) { args.why?.(`hockeyTrade:L361`); return null }
  // Salaries must fit both ways.
  const aRoom = a.team.finances.salaryCap - capUsed(a.team, players) + give.contract.salary
  const bRoom = b.team.finances.salaryCap - capUsed(b.team, players) + get.contract.salary
  if (get.contract.salary > aRoom || give.contract.salary > bRoom) { args.why?.(`hockeyTrade:L365`); return null }
  // Balance the gap with a pick from the side getting the better player.
  const diff = playerValue(get) - gv
  let aPick: DraftPick | undefined
  let bPick: DraftPick | undefined
  if (Math.abs(diff) > gv * 0.1) {
    const payer = diff > 0 ? a : b
    const fit = ownedPicks(args.picks, payer.team.id, year, ranks)
      .filter((c) => c.value <= Math.abs(diff) * 1.25)[0]
    if (fit) {
      if (diff > 0) aPick = fit.pick
      else bPick = fit.pick
    }
  }
  const ok = bothAccept({
    a, b,
    aGives: { players: [give], picks: aPick ? [aPick] : [] },
    bGives: { players: [get], picks: bPick ? [bPick] : [] },
    players, rng, deadlineProximity: args.deadlineProximity, farmIds: new Set(),
  })
  if (!ok) { args.why?.(`hockeyTrade:reject`); return null }
  const word = (g: PositionGroup): string => (g === 'D' ? 'defenceman' : 'forward')
  const pickNote = aPick ? ` and ${pickLabel(aPick)}` : ''
  const backNote = bPick ? ` and ${pickLabel(bPick)}` : ''
  return {
    shape: 'hockey',
    sellerTeamId: a.team.id,
    buyerTeamId: b.team.id,
    playerIds: [give.id],
    buyerPlayerIds: [get.id],
    picks: bPick ? [bPick] : [],
    ...(aPick ? { sellerPicks: [aPick] } : {}),
    prospectIds: [],
    summary: `Hockey trade: ${a.team.abbreviation} send ${give.position} ${give.name}${pickNote} to ${b.team.abbreviation} for ${get.position} ${get.name}${backNote}.`,
    rationale: {
      seller: `${a.persona.name} dealt a spare ${word(giveG)} to fix a ${word(needA)} hole`,
      buyer: `${b.persona.name} swaps a ${word(needA)} he could spare for the ${word(giveG)} he needed`,
    },
  }
}

/* ── goalie trade: a contender with a weak crease buys a starter ── */

function goalieTrade(args: LeagueDealArgs, ranks: Map<string, number>, year: number): LeagueDeal | null {
  const { clubs, players, rng, busy } = args
  const starterOf = (t: Team): number => replacementLevel(t, players, 'G')
  const leagueMedian = [...clubs.map((c) => starterOf(c.team))].sort((x, y) => x - y)[Math.floor(clubs.length / 2)] ?? 70
  const buyers = clubs.filter((c) => c.posture !== 'rebuild' && starterOf(c.team) <= leagueMedian - 2 && c.team.roster.length < 26)
  const buyer = weightedPick(rng, buyers, (c) => 0.3 + c.persona.aggression + (c.posture === 'contend' ? 0.5 : 0))
  if (!buyer) { args.why?.(`goalieTrade:L398`); return null }
  const need = starterOf(buyer.team) + 3
  const cands: Array<{ club: MarketClub; g: Player }> = []
  for (const c of clubs) {
    if (c === buyer) continue
    const gs = c.team.roster.map((id) => players.get(id)).filter((p): p is Player => movable(p, busy) && p.position === 'G')
    if (gs.length < 2) continue
    for (const g of gs) {
      if (ratedOverall(g) < need || g.contract.yearsRemaining > 3 || playerValue(g) < MIN_SHOP_VALUE) continue
      // A club keeps its starter unless it is selling or has a better one.
      const better = gs.some((o) => o !== g && ratedOverall(o) >= ratedOverall(g) - 1)
      if (c.posture !== 'rebuild' && !better) continue
      cands.push({ club: c, g })
    }
  }
  const pickC = cands[rng.int(Math.max(1, cands.length))]
  if (!pickC) { args.why?.(`goalieTrade:L415`); return null }
  const { club: seller, g } = pickC
  // A club never leaves itself one goalie: if the seller carries only two, the
  // buyer's own backup goes the other way (a goalie swap plus the return).
  const backup = groupCount(seller.team, players, 'G') < 3
    ? buyer.team.roster
      .map((id) => players.get(id))
      .filter((p): p is Player => movable(p, busy) && p.position === 'G')
      .sort((x, y) => ratedOverall(x) - ratedOverall(y))[0]
    : undefined
  if (groupCount(seller.team, players, 'G') < 3 && !backup) { args.why?.(`goalieTrade:noBackup`); return null }
  const room = buyer.team.finances.salaryCap - capUsed(buyer.team, players) + (backup?.contract.salary ?? 0)
  if (g.contract.salary > room) { args.why?.(`goalieTrade:L418`); return null }
  const pool = ownedPicks(args.picks, buyer.team.id, year, ranks)
  const target = playerValue(g) * (0.9 + 0.2 * buyer.persona.aggression)
  const chosen: DraftPick[] = []
  let total = backup ? playerValue(backup) : 0
  for (const c of pool) {
    if (chosen.length >= 2 || total >= target * 0.92) break
    if (total + c.value > target * 1.15) continue
    chosen.push(c.pick)
    total += c.value
  }
  if (chosen.length === 0 && !backup) { args.why?.(`goalieTrade:L429`); return null }
  const ok = bothAccept({
    a: seller, b: buyer,
    aGives: { players: [g], picks: [] },
    bGives: { players: backup ? [backup] : [], picks: chosen },
    players, rng, deadlineProximity: args.deadlineProximity, farmIds: new Set(),
  })
  if (!ok) { args.why?.(`goalieTrade:reject`); return null }
  return {
    shape: 'goalie',
    sellerTeamId: seller.team.id,
    buyerTeamId: buyer.team.id,
    playerIds: [g.id],
    ...(backup ? { buyerPlayerIds: [backup.id] } : {}),
    picks: chosen,
    prospectIds: [],
    summary: `${seller.team.abbreviation} send G ${g.name} to ${buyer.team.abbreviation} for ${[...(backup ? [`G ${backup.name}`] : []), ...chosen.map(pickLabel)].join(' and ')}.`,
    rationale: {
      seller: seller.posture === 'rebuild' ? `${seller.persona.name} won't need a starter for the years it takes` : `${seller.persona.name} had a goalie to spare`,
      buyer: `${buyer.persona.name} fixes the crease — the one position a ${buyer.posture === 'contend' ? 'contender' : 'club'} cannot hide`,
    },
  }
}

/* ── cap dump: a capped-out club pays a sweetener to shed a contract ── */

function capDump(args: LeagueDealArgs, ranks: Map<string, number>, year: number): LeagueDeal | null {
  const { clubs, players, rng, busy } = args
  // Who must dump? A disciplined GM clears room early (≥95% of the cap); a
  // gambler only when he is actually jammed against (or over) the ceiling.
  const squeezed = clubs.filter((c) => {
    const used = capUsed(c.team, players) / c.team.finances.salaryCap
    return used >= 0.995 - 0.05 * c.persona.capDiscipline
  })
  const dumper = weightedPick(rng, squeezed, (c) => 0.4 + c.persona.capDiscipline)
  if (!dumper) { args.why?.(`capDump:L463`); return null }
  const cap = dumper.team.finances.salaryCap
  // The contract he'd most like gone: overpaid relative to his play, with term.
  const cands = dumper.team.roster
    .map((id) => players.get(id))
    .filter((p): p is Player => movable(p, busy))
    .filter((p) => p.contract.salary >= cap * 0.025 && p.contract.yearsRemaining >= 1)
    .filter((p) => p.position !== 'G' || groupCount(dumper.team, players, 'G') >= 3)
    .map((p) => ({ p, over: p.contract.salary - fairSalaryFor(ratedOverall(p)) }))
    .filter((x) => x.over > 0)
    .sort((x, y) => y.over - x.over)
  const dump = cands[0]?.p
  if (!dump) { args.why?.(`capDump:L475`); return null }
  const salary = dump.contract.salary
  // Takers: clubs with the room — rebuilders and clubs under the floor first
  // (a floor club NEEDS the salary), pick-hoarders happily.
  const takers = clubs.filter((c) => c !== dumper && c.team.roster.length < 26 &&
    c.team.finances.salaryCap - capUsed(c.team, players) >= salary)
  const taker = weightedPick(rng, takers, (c) => {
    const under = capUsed(c.team, players) < args.floorOf(c.team)
    return (under ? 2.5 : 0) + (c.posture === 'rebuild' ? 1 : c.posture === 'retool' ? 0.4 : 0.1) + c.persona.pickHoarding * 0.6
  })
  if (!taker) { args.why?.(`capDump:L485`); return null }
  const underFloor = capUsed(taker.team, players) < args.floorOf(taker.team)
  // The sweetener: the dead money over the remaining term, in pick points —
  // cheaper for a club that needs salary to reach the floor.
  const overM = Math.max(0.5, (salary - fairSalaryFor(ratedOverall(dump))) / (1e6 * wageIndex()))
  const want = Math.min(40, overM * Math.min(3, dump.contract.yearsRemaining) * (underFloor ? 1.6 : 3.2) * (0.8 + 0.4 * taker.persona.pickHoarding))
  const pool = ownedPicks(args.picks, dumper.team.id, year, ranks).reverse() // cheapest first
  const chosen: DraftPick[] = []
  let total = 0
  for (const c of pool) {
    if (total >= want) break
    if (chosen.length >= 2) break
    chosen.push(c.pick)
    total += c.value
  }
  if (total < want * 0.85 && want > 2) {
    // Try the dumper's best pick if the cheap ones don't cover it — only a
    // disciplined GM pays that much to clear the room.
    const best = ownedPicks(args.picks, dumper.team.id, year, ranks)[0]
    if (!best || dumper.persona.capDiscipline < 0.6 || best.value > want * 1.8) { args.why?.(`capDump:L504`); return null }
    chosen.length = 0
    chosen.push(best.pick)
    total = best.value
  }
  // The dumper pays; the taker takes nothing back. The taker's own book still
  // has to like "player + picks for nothing" (it always does if he has room),
  // so the real gate is the sweetener arithmetic above.
  const takerSees = evaluateProposal({
    give: { players: [dump], picks: chosen },
    receive: { players: [], picks: [] },
    partnerTeam: taker.team,
    partnerPlayers: players,
    rng,
    philosophy: personaPhilosophyLens(taker.persona, taker.posture),
    context: { posture: taker.posture, deadlineProximity: args.deadlineProximity },
  })
  if (takerSees.verdict !== 'accept') { args.why?.(`capDump:L521`); return null }
  return {
    shape: 'capDump',
    sellerTeamId: dumper.team.id,
    buyerTeamId: taker.team.id,
    playerIds: [dump.id],
    picks: [],
    sellerPicks: chosen,
    prospectIds: [],
    summary: `Cap dump: ${dumper.team.abbreviation} send ${dump.position} ${dump.name} (${money(salary)} × ${dump.contract.yearsRemaining}) and ${chosen.map(pickLabel).join(' and ') || 'future considerations'} to ${taker.team.abbreviation}.`,
    rationale: {
      seller: dumper.persona.capDiscipline >= 0.6
        ? `${dumper.persona.name} clears room before it becomes a problem — the cap surgeon at work`
        : `${dumper.persona.name} was out of room and had to pay to get out of it`,
      buyer: underFloor
        ? `${taker.persona.name} needed salary to reach the floor and got paid to take it`
        : `${taker.persona.name} rents out his cap space for picks`,
    },
  }
}
