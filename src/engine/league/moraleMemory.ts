/**
 * Morale memory — the people layer's long memory (story audit 2026-10 F1,
 * depth audit 2026-09 "consequences fade").
 *
 * Morale is one 0–100 number that drifts 5% a day back toward 60, so a shock
 * halves in about two weeks and a season of decisions leaves the whole roster
 * at 57 ± 4. This module keeps the BIG things a player remembers — a benching,
 * a broken promise, a contract snub, a trade request nobody answered, or the
 * good ones (a promise kept, a new deal) — as dated entries that move the
 * level his morale SETTLES at, not his morale today. The daily drift then pulls
 * him toward a sore 50 instead of a neutral 60 for as long as he remembers.
 *
 * Tuned for fun, not punishment (memory feedback_fun-over-realism):
 *  - Telegraphed: every entry is dated, specific and shown on his profile with
 *    how raw it still is. Nothing hidden, no numbers printed.
 *  - Forgiving: everything fades (half-lives of 4–17 weeks), and fixing the
 *    cause heals faster — play the scratched man and the scratch fades fast,
 *    keep a promise and the broken one softens, sign him and the snub goes.
 *  - Never a lockout: the settling level is clamped to 44…70, well above the
 *    trade-request bar (24); memory alone can make a man sour, never desperate.
 *  - Normal play is never penalised: entries come only from GM decisions
 *    (scratching talent, breaking a word, walking away from talks, ignoring a
 *    man). An autopilot lineup that dresses its best players writes nothing.
 *
 * Pure and deterministic; JSON-safe (lives on the Player in the save).
 */
import type { MoraleMemory, MoraleMemoryKind, Player } from '@domain'

/** The neutral level morale drifts to with nothing on his mind. */
export const MORALE_BASELINE = 60
/** Settling level bounds — memory can sour a man, never break him. */
export const MEMORY_BASELINE_MIN = 44
export const MEMORY_BASELINE_MAX = 70
/** An entry this small is forgotten. */
const FORGET_BELOW = 0.6

interface KindSpec {
  /** Pull of one occurrence (morale points, signed). */
  weight: number
  /** Most it can compound to. */
  cap: number
  /** Match days for the pull to halve. */
  halfLife: number
}

export const MEMORY_SPEC: Record<MoraleMemoryKind, KindSpec> = {
  scratched:           { weight: -3,  cap: -10, halfLife: 35 },
  buried:              { weight: -0.8, cap: -6, halfLife: 25 },
  brokenPromise:       { weight: -9,  cap: -14, halfLife: 100 },
  keptPromise:         { weight: 5,   cap: 8,   halfLife: 70 },
  contractSnub:        { weight: -7,  cap: -10, halfLife: 120 },
  newDeal:             { weight: 4,   cap: 6,   halfLife: 60 },
  ignored:             { weight: -4,  cap: -8,  halfLife: 50 },
  dismissed:           { weight: -4,  cap: -8,  halfLife: 50 },
  tradeRequestIgnored: { weight: -7,  cap: -10, halfLife: 90 },
  backed:              { weight: 4,   cap: 6,   halfLife: 60 },
  grievance:           { weight: -6,  cap: -9,  halfLife: 80 },
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-11-12" → "Nov 12". */
export function shortDate(iso: string): string {
  const m = Number(iso.slice(5, 7))
  const d = Number(iso.slice(8, 10))
  if (!Number.isFinite(m) || !Number.isFinite(d) || m < 1 || m > 12) return iso
  return `${MONTHS[m - 1]} ${d}`
}

export interface MemoryEvent {
  kind: MoraleMemoryKind
  year: number
  day: number
  /** ISO date of the event. */
  date: string
  /** Builds the profile note from the running count and the date it started. */
  note: (count: number, since: string) => string
  /** Scale this occurrence's pull (e.g. a serious concern ignored = 1.5). */
  scale?: number
}

/**
 * Record (or compound) a memory. A repeat of the same kind stacks up to the
 * kind's cap and refreshes the date he last felt it; the note keeps the date
 * it STARTED ("since Nov 12") so the profile reads the run, not just the last
 * night. Returns the entry.
 */
export function rememberMorale(p: Player, ev: MemoryEvent): MoraleMemory {
  const spec = MEMORY_SPEC[ev.kind]
  const pull = spec.weight * (ev.scale ?? 1)
  const list = (p.moraleMemory ??= [])
  const existing = list.find((m) => m.kind === ev.kind)
  if (existing) {
    const capped = spec.cap < 0 ? Math.max(spec.cap, existing.weight + pull) : Math.min(spec.cap, existing.weight + pull)
    existing.weight = capped
    existing.peak = spec.cap < 0 ? Math.min(existing.peak, capped) : Math.max(existing.peak, capped)
    existing.count += 1
    existing.year = ev.year
    existing.day = ev.day
    existing.note = ev.note(existing.count, shortDate(existing.date))
    return existing
  }
  const w = spec.cap < 0 ? Math.max(spec.cap, pull) : Math.min(spec.cap, pull)
  const mem: MoraleMemory = {
    kind: ev.kind, weight: w, peak: w, year: ev.year, day: ev.day, date: ev.date, count: 1,
    note: ev.note(1, shortDate(ev.date)),
  }
  list.push(mem)
  return mem
}

/** The level his morale settles at today: 60 plus what he remembers. */
export function moraleBaseline(p: Player): number {
  const mem = p.moraleMemory
  if (!mem || mem.length === 0) return MORALE_BASELINE
  let sum = 0
  for (const m of mem) sum += m.weight
  return Math.max(MEMORY_BASELINE_MIN, Math.min(MEMORY_BASELINE_MAX, MORALE_BASELINE + sum))
}

/** One match day of forgetting. Drops entries once they are small. */
export function fadeMoraleMemory(p: Player): void {
  const mem = p.moraleMemory
  if (!mem || mem.length === 0) return
  for (const m of mem) m.weight *= Math.pow(0.5, 1 / MEMORY_SPEC[m.kind].halfLife)
  const kept = mem.filter((m) => Math.abs(m.weight) >= FORGET_BELOW)
  if (kept.length === 0) delete p.moraleMemory
  else p.moraleMemory = kept
}

/**
 * Fixing the cause heals faster: scale down (factor < 1) the pull of these
 * kinds. Playing the scratched man, keeping a later promise, signing him.
 */
export function easeMoraleMemory(p: Player, kinds: readonly MoraleMemoryKind[], factor: number): void {
  const mem = p.moraleMemory
  if (!mem || mem.length === 0) return
  for (const m of mem) if (kinds.includes(m.kind)) m.weight *= factor
  const kept = mem.filter((m) => Math.abs(m.weight) >= FORGET_BELOW)
  if (kept.length === 0) delete p.moraleMemory
  else p.moraleMemory = kept
}

/* ───────────────────────────── view ───────────────────────────── */

export interface MoodFactorView {
  kind: MoraleMemoryKind
  tone: 'positive' | 'negative'
  /** "Healthy-scratched twice since Nov 12". */
  note: string
  /** How much it still weighs on him, in words. */
  strength: 'Still raw' | 'Lingering' | 'Fading' | 'Still glowing' | 'Warm'
}

/** The profile's "What's on his mind" list, strongest first. No numbers. */
export function moodFactorsView(p: Player): MoodFactorView[] {
  const mem = p.moraleMemory
  if (!mem || mem.length === 0) return []
  return [...mem]
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .map((m) => {
      const ratio = m.peak === 0 ? 0 : m.weight / m.peak
      const tone: MoodFactorView['tone'] = m.weight < 0 ? 'negative' : 'positive'
      const strength: MoodFactorView['strength'] = tone === 'negative'
        ? (ratio > 0.66 ? 'Still raw' : ratio > 0.33 ? 'Lingering' : 'Fading')
        : (ratio > 0.5 ? 'Still glowing' : 'Warm')
      return { kind: m.kind, tone, note: m.note, strength }
    })
}

/** The strongest sore memory, if any (for the staff's mindset read). */
export function sorestMemory(p: Player): MoraleMemory | null {
  let worst: MoraleMemory | null = null
  for (const m of p.moraleMemory ?? []) if (m.weight < 0 && (!worst || m.weight < worst.weight)) worst = m
  return worst
}

/* ───────────────────────── note builders ───────────────────────── */

const TIMES = ['', 'once', 'twice', 'three times', 'four times', 'five times']
function times(n: number): string {
  return TIMES[n] ?? `${n} times`
}

const ORD = ['', 'first', 'second', 'third', 'fourth']

export const MEMORY_NOTES = {
  scratched: (count: number, since: string): string =>
    count === 1 ? `Healthy-scratched on ${since}` : `Healthy-scratched ${times(count)} since ${since}`,
  buried: (tier: number, isD: boolean) => (count: number, since: string): string =>
    `Dressed on the ${ORD[tier] ?? `${tier}th`} ${isD ? 'pair' : 'line'}, ${count} game${count === 1 ? '' : 's'} since ${since}`,
  brokenPromise: (text: string) => (_c: number, since: string): string =>
    `Broken promise (${since}): “${text}”`,
  keptPromise: (text: string) => (_c: number, since: string): string =>
    `You kept your word (${since}): “${text}”`,
  contractSnub: (_c: number, since: string): string =>
    `Contract talks broke off on ${since}`,
  newDeal: (_c: number, since: string): string =>
    `Signed a new deal with the club on ${since}`,
  ignored: (count: number, since: string): string =>
    count === 1 ? `Asked to talk on ${since}. Nobody called back` : `Asked to talk ${times(count)} since ${since}. Nobody called back`,
  dismissed: (_c: number, since: string): string =>
    `Waved off when he came to you on ${since}`,
  tradeRequestIgnored: (_c: number, since: string): string =>
    `Asked for a trade on ${since}. Still here`,
  backed: (other: string) => (_c: number, since: string): string =>
    `You took his side over ${other} on ${since}`,
  grievance: (other: string) => (_c: number, since: string): string =>
    `You sided with ${other} on ${since}`,
}
