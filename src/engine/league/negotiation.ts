/**
 * Contract negotiation sessions — the stateful, multi-round replacement for
 * the one-shot offer/accept vending machine in contracts.ts.
 *
 * The model (docs/DEPTH-OFFSEASON-CONTRACTS-TRADES.md Part 1):
 *  - Every player has an AGENT, derived deterministically from his id: a
 *    persona (combative/patient/leaker/comparable-obsessed) that shapes how
 *    talks feel and how fast patience burns.
 *  - Every player has hidden PRIORITY WEIGHTS (money, term, role, loyalty,
 *    clauses) derived from personality + age. They decide what an offer is
 *    worth to HIM — two identical-overall players value the same offer
 *    differently — and they leak out as hints during talks.
 *  - A NEGOTIATION is a persisted session: rounds of offer → response, a
 *    patience meter, a moving ask (concessions), and an ending (signed /
 *    paused / walked). Responses are prose with content: comparables cited
 *    from real league contracts, barter moves generated from the weights.
 *
 * Everything is pure and JSON-safe; the career layer owns persistence and
 * the actual signing. askTerms() from contracts.ts remains the opening-ask
 * anchor so market scale stays calibrated. Determinism: personas and
 * priorities are hash-derived (no rng draw — recompute identically forever);
 * per-round wiggle flows through the caller's seeded Rng.
 */
import type { Player } from '@domain'
import { ratedOverall } from '@engine/ratings/composites'
import type { Rng } from '@engine/shared/rng'
import { askTerms, contractStatus, termPriceMultiplier, termSecurityScore } from './contracts'

/* ────────────────────────────── offer shape ────────────────────────────── */

export type ClauseLevel = 'none' | 'modified' | 'full'

/** A structured contract offer — what the offer builder produces. */
export interface ContractOffer {
  salary: number
  years: number
  /** Percent of salary paid as signing bonus (0–50). Buyout/lockout-proof
   *  money — agents price it as a sweetener worth a few % of value. */
  signingBonusPct: number
  /** Trade protection: modified = partial no-trade list, full = NMC. */
  clause: ClauseLevel
  twoWay: boolean
}

export const defaultOffer = (salary: number, years: number): ContractOffer => ({
  salary,
  years,
  signingBonusPct: 0,
  clause: 'none',
  twoWay: false,
})

/* ─────────────────────────────── the agent ─────────────────────────────── */

export interface AgentPersona {
  name: string
  /** 0–1 axes. combative: anchors hard, concedes slowly. patient: big
   *  patience pool. leaker: talks to the press. comparableFocus: argues
   *  from other players' deals. */
  combative: number
  patient: number
  leaker: number
  comparableFocus: number
  /** One-line read for the UI ("a deadline squeezer who works the press"). */
  style: string
}

const AGENT_FIRST = [
  'Marty', 'Don', 'Pat', 'Rich', 'Alan', 'Judd', 'Craig', 'Lewis', 'Gerry',
  'Kurt', 'Claude', 'Peter', 'Wade', 'Darren', 'Mike', 'J.P.', 'Allan', 'Ray',
]
const AGENT_LAST = [
  'Belanger', 'Meehan', 'Walsh', 'Overhardt', 'Brisson', 'Moldaver', 'Oates',
  'Gross', 'Johansson', 'Babcock', 'Lemieux', 'Fish', 'Arnott', 'Ferris',
  'Liut', 'Barry', 'Cohen', 'Petrov',
]

/** FNV-1a — same shape contracts.ts uses, kept local so the module is pure. */
function hashId(id: string, salt: number): number {
  let h = (0x811c9dc5 ^ salt) >>> 0
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** 0–1 float from an id + salt; stable forever, no rng stream consumed. */
const stable01 = (id: string, salt: number): number => hashId(id, salt) / 0xffffffff

/** The player's agent — hash-derived, so it never changes and never needs
 *  to be persisted. Star agents recur naturally: the name pool is small. */
export function agentFor(player: Player): AgentPersona {
  const combative = stable01(player.id, 11)
  const patient = stable01(player.id, 23)
  const leaker = stable01(player.id, 37)
  const comparableFocus = stable01(player.id, 53)
  const name = `${AGENT_FIRST[hashId(player.id, 71) % AGENT_FIRST.length]} ${
    AGENT_LAST[hashId(player.id, 89) % AGENT_LAST.length]
  }`

  const styleBits: string[] = []
  styleBits.push(combative > 0.6 ? 'a hard-line anchor' : combative < 0.35 ? 'a dealmaker' : 'a steady hand')
  if (patient < 0.35) styleBits.push('works on short fuses')
  if (leaker > 0.65) styleBits.push('talks to the press')
  if (comparableFocus > 0.6) styleBits.push('argues from comparables')
  return { name, combative, patient, leaker, comparableFocus, style: styleBits.join(', ') }
}

/* ───────────────────────── the player's priorities ─────────────────────── */

/** What the player actually wants, weights summing ~1. Hidden; hints leak
 *  out during talks. Derived from personality (1–20 axes) + age. */
export interface PriorityWeights {
  money: number
  term: number
  loyalty: number
  clauses: number
}

export function priorityWeights(player: Player): PriorityWeights {
  const p = player.personality
  // Raw appetites, each ~0..1.
  const money = 0.5 + (p.ambition - 10.5) / 19 * 0.8
  // Security matters more with age; determined young players bet on themselves.
  const term =
    0.35 + (player.age >= 29 ? 0.35 : player.age >= 26 ? 0.15 : 0) - (p.determination - 10.5) / 19 * 0.3
  const loyalty = 0.2 + (p.loyalty - 10.5) / 19 * 0.7
  // Trade protection: veterans and families want roots.
  const clauses = player.age >= 27 ? 0.25 + (p.loyalty - 10.5) / 19 * 0.3 : 0.08
  const sum = money + term + loyalty + clauses
  return { money: money / sum, term: term / sum, loyalty: loyalty / sum, clauses: clauses / sum }
}

/** The hints a GM can uncover, phrased as agent-meeting intel. Ordered by
 *  weight so the strongest trait leaks first. */
export function priorityHints(player: Player): string[] {
  const w = priorityWeights(player)
  const entries: Array<[number, string]> = [
    [w.money, 'He wants to be paid what the market says he is worth — the number is the message.'],
    [w.term, 'Security matters to his camp: years move him more than dollars.'],
    [w.loyalty, 'He values where he is — a fair hometown deal beats a bidding war.'],
    [w.clauses, 'His family wants roots: trade protection will move the conversation.'],
  ]
  return entries.sort((a, b) => b[0] - a[0]).map(([, s]) => s)
}

/* ─────────────────────────────── comparables ───────────────────────────── */

/** A signed contract the agent can point at. The career layer builds the
 *  pool from real league rosters — the argument is never invented. */
export interface Comparable {
  name: string
  teamAbbr: string
  overall: number
  age: number
  salary: number
  years: number
}

/** Pick the 3 most argument-worthy comps: closest in overall, then age.
 *  Agents cherry-pick upward — ties break toward the richer deal. */
export function findComparables(player: Player, pool: Comparable[]): Comparable[] {
  const ovr = ratedOverall(player)
  return [...pool]
    .filter((c) => Math.abs(c.overall - ovr) <= 3 && Math.abs(c.age - player.age) <= 4)
    .sort(
      (a, b) =>
        Math.abs(a.overall - ovr) - Math.abs(b.overall - ovr) ||
        b.salary - a.salary ||
        a.name.localeCompare(b.name)
    )
    .slice(0, 3)
}

/* ───────────────────────────── the session ─────────────────────────────── */

export type NegotiationKind = 'resign' | 'freeAgent' | 'extension'
export type NegotiationStatus = 'open' | 'signed' | 'paused' | 'walked'
export type RoundVerdict = 'accept' | 'close' | 'reject' | 'walk'

export interface NegotiationRound {
  offer: ContractOffer
  verdict: RoundVerdict
  /** The agent's response, one paragraph per entry. */
  agentLines: string[]
  /** Where the ask stands after this round (concessions applied). */
  askAfter: ContractOffer
  patienceAfter: number
}

export interface NegotiationState {
  playerId: string
  kind: NegotiationKind
  year: number
  /** Current ask — moves toward the offers as rounds progress. */
  ask: ContractOffer
  openingAsk: ContractOffer
  /** 0–100. Lowballs burn it; empty = talks end. */
  patience: number
  rounds: NegotiationRound[]
  status: NegotiationStatus
  /** Priority hints revealed so far (indexes into priorityHints order). */
  revealedHints: number[]
  /** E1: the role the GM has told this camp the player will have. Absent until
   *  he says it; once said it is priced into every round AND becomes a promise
   *  the lineup card has to keep. Optional/additive for save compatibility. */
  rolePitch?: RolePitch
  /** FA day (freeAgent kind) or offseason press count after which paused
   *  talks can be reopened. */
  pausedUntil?: number
}

/**
 * How much a free agent's asking price softens the longer he goes unsigned in the
 * open-market window. Day 0 = full ask; it slides ~2%/day down to a floor of 82%,
 * so a GM can wait out a player who's overpricing himself. Neutral (1.0) at day 0.
 */
export function faAskDecay(faDaysUnsigned: number): number {
  return Math.max(0.82, 1 - Math.max(0, faDaysUnsigned) * 0.02)
}

/** Clause expectations scale with stature: stars want full protection. */
function expectedClause(player: Player): ClauseLevel {
  const ovr = ratedOverall(player)
  if (player.age >= 27 && ovr >= 84) return 'full'
  if (player.age >= 26 && ovr >= 76) return 'modified'
  return 'none'
}

export function openNegotiation(args: {
  player: Player
  year: number
  kind: NegotiationKind
  /** >1 when rivals are bidding (raises the floor), <1 in a dead market. */
  marketHeat?: number
  /** Persistent GM↔agent rapport, −1…+1 (0 = neutral/none). A trusted agent
   *  opens a touch lower and more patiently; a burned one opens harder. */
  rapportTilt?: number
}): NegotiationState {
  const { player, year, kind, marketHeat = 1, rapportTilt = 0 } = args
  const base = askTerms(player, year)
  const w = priorityWeights(player)
  const agent = agentFor(player)

  // Re-sign talks open a touch warmer than open-market ones (hometown
  // continuity); heat from rival bidding raises any ask. Rapport shaves (or
  // adds) up to 5% on the open — 0 at neutral, so this is inert without history.
  const kindMult = kind === 'resign' || kind === 'extension' ? 0.97 : 1.0
  const salary = Math.round((base.salary * kindMult * marketHeat * (1 - rapportTilt * 0.05)) / 25_000) * 25_000

  const ask: ContractOffer = {
    salary,
    years: base.years,
    signingBonusPct: w.money > 0.32 && ratedOverall(player) >= 78 ? 20 : 0,
    clause: expectedClause(player),
    twoWay: false,
  }
  return {
    playerId: player.id,
    kind,
    year,
    ask,
    openingAsk: { ...ask },
    // Rapport buys up to ±18 opening patience (0 at neutral).
    patience: Math.max(10, Math.min(100, Math.round(55 + agent.patient * 40 + rapportTilt * 18))),
    rounds: [],
    status: 'open',
    revealedHints: [],
  }
}

/* ─────────────────────────── offer valuation ───────────────────────────── */

const clauseRank: Record<ClauseLevel, number> = { none: 0, modified: 1, full: 2 }

/**
 * What this offer is worth to THIS player, as a fraction of his ask (~1.0 =
 * met). Salary and term are weighted by his priorities; clause protection
 * and signing bonus are worth real points to players who care.
 *
 * Term is priced, not gifted: the money is measured against what the TERM
 * OFFERED costs (termPriceMultiplier), so tacking extra years onto the asking
 * AAV lowers the offer's worth instead of raising it. Meeting the ask exactly
 * is still exactly 1.0.
 */
export function offerValue(player: Player, offer: ContractOffer, ask: ContractOffer): number {
  const w = priorityWeights(player)
  const ratio = (o: number, a: number): number => (a <= 0 ? 1 : Math.min(1.35, o / a))

  // Money and term carry the decision, tilted by his weights. Meeting the
  // full ask on both is exactly 1.0 — the ask is always acceptable.
  const moneyShare = 0.45 + w.money * 0.6
  const termShare = 0.2 + w.term * 0.5
  const norm = moneyShare + termShare
  const requiredSalary = ask.salary * termPriceMultiplier(player, ask.years, offer.years)
  let value =
    (moneyShare / norm) * ratio(offer.salary, requiredSalary) +
    (termShare / norm) * termSecurityScore(player, ask.years, offer.years)

  // Clause protection, measured against what he asked for: short of the ask
  // costs a clause-hungry veteran real points; exceeding it adds goodwill.
  const clauseGap = clauseRank[offer.clause] - clauseRank[ask.clause]
  value += Math.max(-2, Math.min(1, clauseGap)) * (0.03 + w.clauses * 0.12)

  // Signing bonus above/below the asked structure (guaranteed money = respect).
  const bonusGap = Math.min(offer.signingBonusPct, 30) - Math.min(ask.signingBonusPct, 30)
  value += (bonusGap / 30) * (0.01 + w.money * 0.05)

  // A two-way offer to an established player is an insult.
  if (offer.twoWay && ratedOverall(player) >= 60) value -= 0.15

  return value
}

/** The bar an offer must clear, mirroring offerAcceptable's personality
 *  band: ambitious players hold out, loyal players settle. */
export function acceptThreshold(player: Player, kind: NegotiationKind, rng: Rng): number {
  let t =
    0.97 +
    (player.personality.ambition - 10.5) * 0.003 -
    (player.personality.loyalty - 10.5) * 0.003 +
    rng.float(-0.015, 0.015)
  if (kind === 'resign' || kind === 'extension') t -= 0.015
  return Math.min(1.0, Math.max(0.9, t))
}

/* ───────────────────────── the round evaluator ─────────────────────────── */

export interface RoundContext {
  rng: Rng
  comparables: Comparable[]
  /** Rival interest, 0–1 — raises confidence in FA talks. */
  marketHeat?: number
  teamName?: string
  /** Persistent GM↔agent rapport, −1…+1 (0 = neutral/none). A trusted agent
   *  burns less patience on a lowball and concedes a touch faster. */
  rapportTilt?: number
  /** E1: what the GM has told this camp the player's ROLE will be. A promise
   *  of real minutes is worth money at the table — see rolePitchValue. */
  rolePitch?: RolePitch | undefined
}

/* ────────────────────── the role pitch (E1) ────────────────────── */

/**
 * The conversation the user asked for: "a meeting with a newly acquired player
 * about role, needs and wants — AND that conversation should also exist inside
 * NEGOTIATION beforehand."
 *
 * A player will sign for less to be the guy, and more to be a spare part. That
 * is not flavour — it is the single most reliable discount in the sport. So the
 * pitch is priced, and (in the career layer) it becomes a PROMISE the lineup
 * card has to honour.
 */
export type RolePitch = 'star' | 'topSix' | 'middleSix' | 'specialist' | 'depth' | 'none'

export const ROLE_PITCH_LABEL: Record<RolePitch, string> = {
  star: 'The man we build around',
  topSix: 'A top-six / top-pair role',
  middleSix: 'A middle-six regular',
  specialist: 'A defined job — special teams, hard minutes',
  depth: 'Depth. You compete for a spot.',
  none: 'No promises about deployment',
}

/**
 * What the pitch is worth as a fraction of his ask — added to the offer's value
 * at the table. A role ABOVE what his ability says he should get is worth real
 * money; one below it costs you.
 *
 * `overall` is his rated ability, so the same words mean different things said
 * to a 62 and to an 88.
 */
export function rolePitchValue(pitch: RolePitch, overall: number): number {
  if (pitch === 'none') return 0
  // What role his ability alone entitles him to, on the same 0–4 ladder.
  const earned = overall >= 84 ? 4 : overall >= 76 ? 3 : overall >= 69 ? 2 : overall >= 63 ? 1 : 0
  const offered: Record<Exclude<RolePitch, 'none'>, number> = {
    star: 4, topSix: 3, middleSix: 2, specialist: 1, depth: 0,
  }
  const gap = offered[pitch] - earned
  // Each rung above what he has earned is worth ~4.5 % of his ask; each rung
  // below costs a little more than it gives, because being told you are depth
  // is not a negotiating position, it is an insult with a number attached.
  return gap >= 0 ? Math.min(0.135, gap * 0.045) : Math.max(-0.16, gap * 0.055)
}

/** The agent's one-line reaction to being told the role. */
export function rolePitchLine(pitch: RolePitch, overall: number, playerLast: string): string {
  const v = rolePitchValue(pitch, overall)
  if (pitch === 'none') return `"You won't commit to a role. Fine — then we're only talking about money."`
  if (v >= 0.09) return `"Now that is worth something to him. ${playerLast} has never been asked to be that."`
  if (v > 0) return `"He likes the sound of that. It doesn't sign the contract, but it moves us."`
  if (v === 0) return `"That's about where he sees himself. No argument, and no discount either."`
  if (v > -0.1) return `"You're offering him less than he is. He heard it, and the number just went up."`
  return `"Depth? For him? Then we're done pretending this is a hometown discount."`
}

const fmtM = (n: number): string => `$${(n / 1e6).toFixed(2)}M`

/**
 * Run one round: the offer goes in, the agent's verdict + prose + a possibly
 * softened ask come out. Mutates nothing — returns the round and the next
 * state fields; the caller commits them.
 */
export function evaluateRound(
  state: NegotiationState,
  player: Player,
  offer: ContractOffer,
  ctx: RoundContext
): { round: NegotiationRound; status: NegotiationStatus; ask: ContractOffer; patience: number; revealedHints: number[] } {
  const agent = agentFor(player)
  const tilt = ctx.rapportTilt ?? 0
  // E1: the role you have promised him is part of the offer, whether or not it
  // is written on the paper.
  const roleWorth = ctx.rolePitch ? rolePitchValue(ctx.rolePitch, ratedOverall(player)) : 0
  const value = offerValue(player, offer, state.ask) + roleWorth
  const threshold = acceptThreshold(player, state.kind, ctx.rng)
  const lines: string[] = []
  const revealed = [...state.revealedHints]

  /* accept ── */
  if (value >= threshold) {
    lines.push(
      agent.combative > 0.6
        ? `"You got there in the end. ${fmtM(offer.salary)} over ${offer.years} — my client accepts."`
        : `"That's a fair deal for both sides. ${fmtM(offer.salary)} over ${offer.years} years — we have an agreement."`
    )
    if (offer.clause !== 'none') lines.push(`"The trade protection mattered to him. Good touch."`)
    const round: NegotiationRound = {
      offer, verdict: 'accept', agentLines: lines, askAfter: { ...state.ask }, patienceAfter: state.patience,
    }
    return { round, status: 'signed', ask: state.ask, patience: state.patience, revealedHints: revealed }
  }

  /* lowball — burn patience, maybe end talks ── */
  const lowballBar = 0.82
  if (value < lowballBar) {
    // A trusted agent burns a touch less patience on a lowball; a burned one more.
    const burn = Math.max(4, Math.round(22 + agent.combative * 14 - agent.patient * 8 + ctx.rng.float(0, 6) - tilt * 8))
    const patience = Math.max(0, state.patience - burn)
    const insulted = value < 0.7

    if (patience <= 0) {
      const walked = state.kind === 'freeAgent' || insulted
      lines.push(
        walked
          ? `"We're done here. My client will find a club that values him."`
          : `"I'm pulling my client from the table. Call us when you're serious — we'll be busy for a while."`
      )
      const round: NegotiationRound = {
        offer, verdict: 'walk', agentLines: lines, askAfter: { ...state.ask }, patienceAfter: 0,
      }
      return { round, status: walked ? 'walked' : 'paused', ask: state.ask, patience: 0, revealedHints: revealed }
    }

    lines.push(
      offer.years > state.ask.years
        ? `"${fmtM(offer.salary)} over ${offer.years} years? You're asking him to sign away ${offer.years - state.ask.years} extra year${offer.years - state.ask.years > 1 ? 's' : ''} at the price of ${state.ask.years}. Term costs money — it doesn't save you any."`
        : insulted
          ? `"${fmtM(offer.salary)}? I have to assume that's a typo. Don't waste my client's summer."`
          : `"That's not a serious number. We're asking ${fmtM(state.ask.salary)} on ${state.ask.years} years for a reason."`
    )
    if (agent.comparableFocus > 0.45 && ctx.comparables.length > 0) {
      const c = ctx.comparables[0]
      lines.push(
        `"${c.name} signed for ${fmtM(c.salary)} × ${c.years} with ${c.teamAbbr} — same tier, and my client stacks up."`
      )
    }
    if (agent.leaker > 0.65 && state.kind === 'freeAgent') {
      lines.push(`(Within the hour, an insider posts that talks between you and ${player.name}'s camp are "not close.")`)
    }
    const round: NegotiationRound = {
      offer, verdict: 'reject', agentLines: lines, askAfter: { ...state.ask }, patienceAfter: patience,
    }
    return { round, status: 'open', ask: state.ask, patience, revealedHints: revealed }
  }

  /* close — concede, counter, teach ── */
  // Concession: collaborative agents move ~40% toward the offer, hard-liners
  // ~15%; a hot market stiffens the ask.
  const heat = ctx.marketHeat ?? 0
  const concede = Math.max(0.08, (0.4 - agent.combative * 0.25) * (1 - heat * 0.5) * (1 + tilt * 0.35))
  const ask: ContractOffer = {
    ...state.ask,
    salary: Math.round((state.ask.salary - (state.ask.salary - offer.salary) * concede) / 25_000) * 25_000,
    years:
      offer.years >= state.ask.years
        ? state.ask.years
        : Math.max(offer.years, state.ask.years - (ctx.rng.chance(concede + 0.2) ? 1 : 0)),
  }
  const patience = Math.max(1, state.patience - Math.round(4 + agent.combative * 5))

  const gapNow = ask.salary - offer.salary
  lines.push(
    gapNow <= 300_000
      ? `"We're close. Split the difference and we can shake hands today."`
      : `"The structure works — the number doesn't yet. We've come to ${fmtM(ask.salary)}; meet us there."`
  )

  // Term is a concession the CLUB is asking for. Say so, with the number.
  if (offer.years > state.ask.years) {
    const extra = offer.years - state.ask.years
    const priced = Math.round((state.ask.salary * termPriceMultiplier(player, state.ask.years, offer.years)) / 25_000) * 25_000
    lines.push(
      `"You want ${extra} year${extra > 1 ? 's' : ''} past what we asked for — that's your cost certainty, not his. ` +
      `${offer.years} years is ${fmtM(priced)} a season, not ${fmtM(state.ask.salary)}."`
    )
  }

  // Cite a comparable when the money is the sticking point.
  if (agent.comparableFocus > 0.35 && ctx.comparables.length > 0 && offer.salary < state.ask.salary) {
    const c = ctx.comparables[Math.min(state.rounds.length, ctx.comparables.length - 1)]
    lines.push(`"Look at ${c.name} — ${fmtM(c.salary)} × ${c.years} at age ${c.age}. That's the market we live in."`)
  }

  // Barter move: generate a genuine trade from the weights.
  const w = priorityWeights(player)
  if (offer.clause === 'none' && clauseRank[state.ask.clause] > 0 && w.clauses >= 0.12) {
    lines.push(
      `"Here's a path: give him the ${state.ask.clause === 'full' ? 'no-move' : 'modified no-trade'} protection and we'll take ${fmtM(Math.max(500_000, Math.round(state.ask.salary * 0.05 / 25_000) * 25_000))} less. Roots matter to this family."`
    )
    if (!revealed.includes(3)) revealed.push(3)
  } else if (offer.years < state.ask.years && w.term > 0.28) {
    lines.push(`"Add the ${state.ask.years}th year and the AAV gets friendlier. He wants to settle, not re-negotiate at ${player.age + offer.years}."`)
    if (!revealed.includes(1)) revealed.push(1)
  } else if (w.money > 0.34 && offer.signingBonusPct < 15) {
    lines.push(`"Structure some of it as signing bonus and my client hears respect. Guaranteed money talks."`)
    if (!revealed.includes(0)) revealed.push(0)
  }

  if (heat > 0.4 && state.kind === 'freeAgent') {
    lines.push(`"And I'll be straight with you — there are other numbers on my desk. Don't sit on this."`)
  }

  const round: NegotiationRound = {
    offer, verdict: 'close', agentLines: lines, askAfter: ask, patienceAfter: patience,
  }
  return { round, status: 'open', ask, patience, revealedHints: revealed }
}

/* ─────────────────────── opening pleasantries (UI) ─────────────────────── */

/** The agent's opening statement when a session begins. */
export function openingLines(player: Player, state: NegotiationState, ctx: { comparables: Comparable[] }): string[] {
  const agent = agentFor(player)
  const lines: string[] = []
  const status = contractStatus(player)
  const intro =
    state.kind === 'resign'
      ? `"Good to sit down. My client likes it here — but ${status === 'RFA' ? 'restricted or not, ' : ''}he's earned a real contract."`
      : state.kind === 'extension'
        ? `"Talking extension a year out — smart. Cost certainty cuts both ways."`
        : `"July is a seller's market, and you called us. Let's see how serious you are."`
  lines.push(intro)
  lines.push(`"We're asking ${fmtM(state.ask.salary)} a year on ${state.ask.years} years${state.ask.clause !== 'none' ? `, with ${state.ask.clause === 'full' ? 'full no-move protection' : 'a modified no-trade'}` : ''}."`)
  if (agent.comparableFocus > 0.5 && ctx.comparables.length > 0) {
    const c = ctx.comparables[0]
    lines.push(`"Before you counter: ${c.name} makes ${fmtM(c.salary)}. We both know where my client sits next to him."`)
  }
  return lines
}
