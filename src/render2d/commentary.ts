/**
 * Pure, node-testable commentary generator.
 *
 * Walks a GameStream and produces a CommentaryLine for every meaningful event.
 * Deterministic: same stream + same names → same lines. All "randomness" is
 * derived from (absT, playerId hash) via mulberry32 — no Math.random.
 */
import type { GameStream, PlayerRef } from '@domain'
import { absTime } from './timeline'

export interface CommentaryLine {
  absT: number
  period: number
  /** "MM:SS" countdown clock within the period. */
  clock: string
  /** Display text (may contain em-dashes / ellipses). */
  text: string
  /** TTS-safe variant — no em-dashes/ellipses, numbers spelled out. */
  speech: string
  /** 1 = ambient, 2 = notable, 3 = critical (goals, game-end). */
  importance: 1 | 2 | 3
}

// ── tiny seeded rng (mulberry32) ─────────────────────────────────────────────

function rngNext(seed: number): number {
  const s = (seed + 0x6d2b79f5) >>> 0
  let t = s
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function pickSeeded<T>(arr: readonly T[], seed: number): T {
  return arr[Math.floor(rngNext(seed >>> 0) * arr.length)]
}

// Mix two numbers into a seed
function mixSeed(a: number, b: number): number {
  return (Math.imul((a >>> 0) ^ (b >>> 0), 0x9e3779b1) + 0x85ebca77) >>> 0
}

// Simple string hash (djb2-style)
function strHash(s: string): number {
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) >>> 0
  }
  return h
}

// ── clock helper ─────────────────────────────────────────────────────────────

const PERIOD_LEN = 1200

function clockStr(period: number, t: number): string {
  const remaining = Math.max(0, PERIOD_LEN - t)
  const mm = Math.floor(remaining / 60)
  const ss = remaining % 60
  return `${mm}:${ss.toString().padStart(2, '0')}`
}

function absT(period: number, t: number): number {
  return absTime(period, t)
}

// ── surname tracking ──────────────────────────────────────────────────────────

// Map key: "<period>:<playerId>"
type PeriodNameTracker = Map<string, true>

function surname(fullName: string): string {
  const parts = fullName.trim().split(/\s+/)
  return parts[parts.length - 1]
}

function resolveName(
  id: PlayerRef,
  names: (id: string) => string,
  tracker: PeriodNameTracker,
  period: number
): string {
  const full = names(id)
  const key = `${period}:${id}`
  if (!tracker.has(key)) {
    tracker.set(key, true)
    return full
  }
  return surname(full)
}

// ── number to words (simple, for TTS) ────────────────────────────────────────

const ONES = [
  'zero','one','two','three','four','five','six','seven','eight','nine','ten',
  'eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen',
]
const TENS = ['','','twenty','thirty','forty','fifty']

function numToWords(n: number): string {
  if (n < 20) return ONES[n] ?? String(n)
  const t = Math.floor(n / 10)
  const o = n % 10
  return o === 0 ? (TENS[t] ?? String(n)) : `${TENS[t] ?? ''}-${ONES[o] ?? ''}`
}

function scoreToSpeech(home: number, away: number, homeAbbr: string, awayAbbr: string): string {
  if (home === away) return `${numToWords(home)} apiece`
  const leading = home > away ? homeAbbr : awayAbbr
  const high = Math.max(home, away)
  const low = Math.min(home, away)
  return `${numToWords(high)} ${numToWords(low)}, ${leading}`
}

function toSpeech(text: string): string {
  return text
    .replace(/—/g, ',')
    .replace(/\.\.\./g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ── event phrase banks ────────────────────────────────────────────────────────

const FACEOFF_WIN = [
  '{winner} wins the draw.',
  '{winner} gets possession off the faceoff.',
  '{winner} wins it cleanly.',
  '{winner} draws it back.',
  '{winner} wins the dot.',
]

const SHOT_LOW_DANGER = [
  '{shooter} fires from the perimeter — not much danger there.',
  '{shooter} lets one go from the outside — right to the goalie.',
  '{shooter} shoots — drifts wide.',
  '{shooter} tries from distance — no real threat.',
  '{shooter} gets a shot away — easy work for the netminder.',
]

const SHOT_MED_DANGER = [
  '{shooter} steps up and fires — goalie tracks it.',
  '{shooter} gets a shot from a good position!',
  '{shooter} threatens — the goalie has to work!',
  '{shooter} lets it go from the top of the circle!',
  '{shooter} shoots — that needed watching!',
]

const SHOT_HIGH_DANGER = [
  'DANGEROUS chance — {shooter} from the slot!',
  '{shooter} in TIGHT — the goalie must be sharp!',
  'DANGEROUS! {shooter} from prime ice!',
  '{shooter} with a quality chance — goalie stays big!',
  'Excellent opportunity for {shooter} from the danger area!',
]

const SAVE_PLAIN = [
  '{goalie} turns it aside.',
  '{goalie} makes the stop.',
  '{goalie} holds firm.',
  '{goalie} deals with it.',
  '{goalie} smothers the shot.',
]

const SAVE_REBOUND = [
  '{goalie} saves but gives up the rebound!',
  '{goalie} makes the stop — puck loose in front!',
  '{goalie} parries it away — scramble in the crease!',
  'Save by {goalie} — rebound situation!',
  '{goalie} pushes it out — second chance coming!',
]

const HIT_PHRASES = [
  '{by} lays a big hit on {on}!',
  '{by} flattens {on} along the boards!',
  '{by} with a heavy check — {on} goes into the glass!',
  '{by} steps up and rocks {on}!',
  '{by} delivers a thunderous hit on {on}!',
]

const TAKEAWAY_PHRASES = [
  '{by} strips the puck from {from} — odd-man break!',
  'Great takeaway by {by}!',
  '{by} steals it and here comes the rush!',
  '{by} rips the puck away — transition time!',
]

const PENALTY_PHRASES = [
  '{player} off for {infraction} — {team} going to the power play.',
  'Penalty on {player}: {infraction}. {team} on the man advantage.',
  '{player} penalised for {infraction} — {team} gets the power play.',
  'Referee blows it up — {infraction} on {player}. {team} PP.',
]

const PERIOD_END_PHRASES = [
  "That's the end of period {p}.",
  'Whistle to end the {ord} period.',
  'Period {p} is over.',
]

const GAME_END_PHRASES = [
  "Final whistle! That's the game.",
  "And that's it! The game is over.",
  'The referee blows the final whistle.',
]

function ordinal(n: number): string {
  if (n === 1) return 'first'
  if (n === 2) return 'second'
  if (n === 3) return 'third'
  return `${n}th`
}

// ── score state ───────────────────────────────────────────────────────────────

interface ScoreState {
  home: number
  away: number
}

// ── main generator ────────────────────────────────────────────────────────────

export function generateCommentary(
  stream: GameStream,
  names: (id: string) => string,
  isHome: (id: string) => boolean,
  abbrs: { home: string; away: string }
): CommentaryLine[] {
  const lines: CommentaryLine[] = []
  const tracker: PeriodNameTracker = new Map()
  const score: ScoreState = { home: 0, away: 0 }
  let lastPeriod = 0

  for (const ev of stream) {
    // Reset surname introductions at each period boundary so players get
    // re-introduced at the start of each period.
    if (ev.period !== lastPeriod) {
      lastPeriod = ev.period
      for (const k of [...tracker.keys()]) {
        if (k.startsWith(`${ev.period}:`)) tracker.delete(k)
      }
    }

    const at = absT(ev.period, ev.t)
    const clk = clockStr(ev.period, ev.t)

    switch (ev.type) {
      case 'faceoff': {
        // Only emit commentary for period-starting faceoffs (t < 5s)
        if (ev.t >= 5) break
        const winnerName = resolveName(ev.winner, names, tracker, ev.period)
        const seed = mixSeed(at * 100 | 0, strHash(ev.winner))
        const tmpl = pickSeeded(FACEOFF_WIN, seed)
        const text = tmpl.replace('{winner}', winnerName)
        lines.push({ absT: at, period: ev.period, clock: clk, text, speech: toSpeech(text), importance: 1 })
        break
      }

      case 'shot': {
        const shooterName = resolveName(ev.shooter, names, tracker, ev.period)
        const seed = mixSeed(at * 100 | 0, strHash(ev.shooter))

        let bank: readonly string[]
        let imp: 1 | 2
        if (ev.danger >= 0.65) {
          bank = SHOT_HIGH_DANGER
          imp = 2
        } else if (ev.danger >= 0.35) {
          bank = SHOT_MED_DANGER
          imp = 1
        } else {
          bank = SHOT_LOW_DANGER
          imp = 1
        }

        const tmpl = pickSeeded(bank, seed)
        const text = tmpl.replace('{shooter}', shooterName)
        lines.push({ absT: at, period: ev.period, clock: clk, text, speech: toSpeech(text), importance: imp })
        break
      }

      case 'save': {
        const goalieName = resolveName(ev.goalie, names, tracker, ev.period)
        const seed = mixSeed(at * 100 | 0, strHash(ev.goalie))
        const bank = ev.rebound ? SAVE_REBOUND : SAVE_PLAIN
        const imp: 1 | 2 = ev.rebound ? 2 : 1
        const tmpl = pickSeeded(bank, seed)
        const text = tmpl.replace('{goalie}', goalieName)
        lines.push({ absT: at, period: ev.period, clock: clk, text, speech: toSpeech(text), importance: imp })
        break
      }

      case 'goal': {
        const scorerFull = names(ev.scorer)
        tracker.set(`${ev.period}:${ev.scorer}`, true)

        if (isHome(ev.scorer)) score.home++
        else score.away++

        const assistStr = ev.assists.length === 0
          ? 'unassisted'
          : ev.assists
              .map((a) => {
                tracker.set(`${ev.period}:${a}`, true)
                return surname(names(a))
              })
              .join(' and ')

        const strengthTag =
          ev.strength === 'pp' ? ' PP marker!' :
          ev.strength === 'sh' ? ' Shorthanded goal!' :
          ev.strength === 'en' ? ' Empty-net goal!' : ''

        const scoreLine = `${score.home}-${score.away}`
        const scoreWords = scoreToSpeech(score.home, score.away, abbrs.home, abbrs.away)

        const text = `GOAL — ${scorerFull}! Assisted by ${assistStr}. ${abbrs.home} ${scoreLine} ${abbrs.away}.${strengthTag}`
        const rawSpeech = `Goal. ${scorerFull}. Assisted by ${assistStr}. Score is ${scoreWords}.${strengthTag ? ` ${strengthTag.replace(/!/g, '').trim()}.` : ''}`
        lines.push({ absT: at, period: ev.period, clock: clk, text, speech: toSpeech(rawSpeech), importance: 3 })

        // Post-goal resume note
        const foText = 'Play resumes at centre ice.'
        lines.push({ absT: at + 0.5, period: ev.period, clock: clk, text: foText, speech: foText, importance: 1 })
        break
      }

      case 'hit': {
        const byName = resolveName(ev.by, names, tracker, ev.period)
        const onName = resolveName(ev.on, names, tracker, ev.period)
        const seed = mixSeed(at * 100 | 0, strHash(ev.by))
        const tmpl = pickSeeded(HIT_PHRASES, seed)
        const text = tmpl.replace('{by}', byName).replace('{on}', onName)
        lines.push({ absT: at, period: ev.period, clock: clk, text, speech: toSpeech(text), importance: 1 })
        break
      }

      case 'penalty': {
        const playerName = resolveName(ev.player, names, tracker, ev.period)
        const opposingAbbr = isHome(ev.player) ? abbrs.away : abbrs.home
        const seed = mixSeed(at * 100 | 0, strHash(ev.player))
        const tmpl = pickSeeded(PENALTY_PHRASES, seed)
        const text = tmpl
          .replace('{player}', playerName)
          .replace('{infraction}', ev.infraction)
          .replace('{team}', opposingAbbr)
        lines.push({ absT: at, period: ev.period, clock: clk, text, speech: toSpeech(text), importance: 2 })
        break
      }

      case 'takeaway': {
        const byName = resolveName(ev.by, names, tracker, ev.period)
        const fromName = resolveName(ev.from, names, tracker, ev.period)
        const seed = mixSeed(at * 100 | 0, strHash(ev.by))
        const tmpl = pickSeeded(TAKEAWAY_PHRASES, seed)
        const text = tmpl.replace('{by}', byName).replace('{from}', fromName)
        lines.push({ absT: at, period: ev.period, clock: clk, text, speech: toSpeech(text), importance: 1 })
        break
      }

      case 'periodEnd': {
        const seed = mixSeed(at * 100 | 0, ev.period * 7919)
        const tmpl = pickSeeded(PERIOD_END_PHRASES, seed)
        const scoreDisplay = `${score.home}-${score.away}`
        const baseText = tmpl.replace('{p}', String(ev.period)).replace('{ord}', ordinal(ev.period))
        const text = `${baseText} Score: ${abbrs.home} ${scoreDisplay} ${abbrs.away}.`
        const speech = `${toSpeech(baseText)} Score is ${scoreToSpeech(score.home, score.away, abbrs.home, abbrs.away)}.`
        lines.push({ absT: at, period: ev.period, clock: clk, text, speech, importance: 2 })
        break
      }

      case 'gameEnd': {
        const seed = mixSeed(at * 100 | 0, 0xf1a1)
        const tmpl = pickSeeded(GAME_END_PHRASES, seed)
        const scoreDisplay = `${score.home}-${score.away}`
        const winner = score.home > score.away ? abbrs.home : score.away > score.home ? abbrs.away : null
        const winText = winner ? ` ${winner} win!` : " It's a tie!"
        const text = `${tmpl}${winText} Final: ${abbrs.home} ${scoreDisplay} ${abbrs.away}.`
        const speech = `${toSpeech(tmpl)}${toSpeech(winText)} Final score: ${scoreToSpeech(score.home, score.away, abbrs.home, abbrs.away)}.`
        lines.push({ absT: at, period: ev.period, clock: clk, text, speech, importance: 3 })
        break
      }

      // Events we intentionally skip for commentary
      case 'carry':
      case 'pass':
      case 'giveaway':
      case 'blockedShot':
      case 'lineChange':
      case 'whistle':
      case 'frame':
        break
    }
  }

  // Stable sort by absT
  lines.sort((a, b) => a.absT - b.absT)
  return lines
}
