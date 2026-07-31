/**
 * The re-signing window — offers answered over DAYS, not on the spot.
 *
 * Playtest 2026-07-31 (docs/PLAYTEST-2026-07-31.md §B): re-signing was one
 * screen with instant accepts. A real June window is a queue: you table terms,
 * the camp takes them away, and a day or three later you get an answer — yes,
 * a counter with a number in it, or a flat no with your patience burned. This
 * module is the pure decision layer for that queue; the career layer owns the
 * clock, the persistence and the actual signing, exactly the way it already
 * does for FA standing offers (#167), offer sheets (#183) and trades (#184).
 *
 * It deliberately reuses the negotiation vocabulary (agent persona, priority
 * weights, offer value) rather than inventing a second personality model — a
 * player is the same man across the table as he is on the phone. The one thing
 * it adds is COUNTERS: the camp doesn't just say no, it names the smallest
 * terms it would say yes to, priced through termPriceMultiplier so extra years
 * arrive with a bill attached.
 *
 * Pure and JSON-safe; determinism flows through the caller's seeded Rng.
 */
import type { Player } from '@domain'
import type { Rng } from '@engine/shared/rng'
import { qualifyingOffer, termPriceMultiplier } from './contracts'
import { acceptThreshold, agentFor, offerValue, priorityWeights, type ContractOffer } from './negotiation'

/** How many Continue presses the June window lasts before July 1 arrives. */
export const RESIGN_WINDOW_DAYS = 4

/** What the camp did with an offer that was left on their desk. */
export type ResignVerdict = 'accept' | 'counter' | 'refuse' | 'walk'

export interface ResignResponse {
  verdict: ResignVerdict
  /** Named terms the camp WOULD sign — present on 'counter'. */
  counter?: { salary: number; years: number }
  /** The camp's answer, in their words. Always at least one line. */
  lines: string[]
  patienceAfter: number
}

const fmtM = (n: number): string => `$${(n / 1e6).toFixed(2)}M`
const to25k = (n: number): number => Math.round(n / 25_000) * 25_000

/**
 * The smallest deal this camp would actually sign, given what you just offered.
 * It keeps YOUR term (you asked for those years — that's the club's call) and
 * prices them honestly, then meets you part-way on the dollars if the agent is
 * a dealmaker. This is the number the counter names.
 */
export function counterTerms(
  player: Player,
  offer: { salary: number; years: number },
  ask: { salary: number; years: number },
): { salary: number; years: number } {
  const agent = agentFor(player)
  const priced = ask.salary * termPriceMultiplier(player, ask.years, offer.years)
  // A hard-liner counters at the full priced number; a dealmaker shaves toward
  // the offer on the table (never below it — a counter is never a concession
  // past what you already put up).
  const give = 0.02 + (1 - agent.combative) * 0.09
  const softened = priced - Math.max(0, priced - offer.salary) * give
  return { salary: Math.max(offer.salary, to25k(softened)), years: offer.years }
}

/**
 * Run one tabled offer to its answer. `patience` is the camp's remaining
 * appetite for this negotiation (0–100); every refused offer burns it, and a
 * camp out of patience walks to the open market.
 */
export function evaluateResignOffer(args: {
  player: Player
  offer: { salary: number; years: number }
  ask: { salary: number; years: number }
  patience: number
  rng: Rng
  /** False when the club never tendered him a qualifying offer — an RFA who
   *  knows he is about to be unrestricted negotiates from strength. */
  qualified?: boolean
}): ResignResponse {
  const { player, offer, ask, patience, rng, qualified = true } = args
  const agent = agentFor(player)
  const full: ContractOffer = { ...offer, signingBonusPct: 0, clause: 'none', twoWay: false }
  const fullAsk: ContractOffer = { ...ask, signingBonusPct: 0, clause: 'none', twoWay: false }
  // An unqualified RFA is a UFA in waiting; he prices himself accordingly.
  const value = offerValue(player, full, fullAsk) * (qualified ? 1 : 0.94)
  const threshold = acceptThreshold(player, 'resign', rng)

  if (value >= threshold) {
    return {
      verdict: 'accept',
      lines: [
        agent.combative > 0.6
          ? `"He'll sign it. ${fmtM(offer.salary)} over ${offer.years} — send the paper."`
          : `"We talked it over. ${fmtM(offer.salary)} over ${offer.years} years works for both sides — he's staying."`,
      ],
      patienceAfter: patience,
    }
  }

  // A serious-but-short offer earns a counter with a real number on it.
  if (value >= 0.85) {
    const counter = counterTerms(player, offer, ask)
    const burn = Math.max(3, Math.round(6 + agent.combative * 6 - agent.patient * 4))
    const lines: string[] = [
      `"Not at that number. Here's where he signs: ${fmtM(counter.salary)} over ${counter.years} years."`,
    ]
    if (offer.years > ask.years) {
      lines.push(
        `"And understand what you're asking — ${offer.years - ask.years} year${offer.years - ask.years > 1 ? 's' : ''} past what we wanted. ` +
        `Those years are yours to buy, not his to give away."`
      )
    } else if (offer.years < ask.years) {
      lines.push(`"He asked for ${ask.years} years for a reason. If you want it shorter, that's fine — but it isn't cheaper for you."`)
    }
    return { verdict: 'counter', counter, lines, patienceAfter: Math.max(1, patience - burn) }
  }

  // A lowball. Burn real patience; an empty camp leaves for the market.
  const burn = Math.max(8, Math.round(24 + agent.combative * 16 - agent.patient * 10 + rng.float(0, 8)))
  const after = Math.max(0, patience - burn)
  if (after <= 0) {
    return {
      verdict: 'walk',
      lines: [
        `"We're done. He'll take his chances on July 1 — and he'll remember who made him."`,
      ],
      patienceAfter: 0,
    }
  }
  return {
    verdict: 'refuse',
    lines: [
      value < 0.72
        ? `"${fmtM(offer.salary)}? That's not an offer, that's a message. He heard it."`
        : `"No. We're at ${fmtM(ask.salary)} on ${ask.years} years and we haven't moved."`,
    ],
    patienceAfter: after,
  }
}

/**
 * Does he simply take the qualifying offer? A QO is a one-year deal at a number
 * the CBA sets, so a depth player near his market value pockets it and a player
 * worth far more turns it down and keeps negotiating (or files). Deterministic
 * through the caller's Rng.
 */
export function acceptsQualifyingOffer(player: Player, ask: { salary: number }, rng: Rng): boolean {
  const qo = qualifyingOffer(player)
  const generosity = qo / Math.max(1, ask.salary)
  const w = priorityWeights(player)
  // At/above his ask it's free money; well below it he's insulted by it. The
  // money-motivated hold out longer than the security-motivated.
  let p = (generosity - 0.72) * 2.1 - (w.money - 0.3) * 0.6
  p = Math.max(0.02, Math.min(0.95, p))
  return rng.chance(p)
}
