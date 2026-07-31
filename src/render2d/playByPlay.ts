/**
 * Play-by-play feed — the gamesheet voice, not the broadcast voice.
 *
 * A third consumer of the keystone GameStream (docs/ARCHITECTURE.md §4),
 * alongside the 2D/3D renderers and the box-score builder. Where commentary.ts
 * writes prose for an announcer to read aloud, this writes the terse timestamped
 * lines a live gamecast prints: who did what, at what clock, under what
 * strength. Deterministic and DOM-free — same stream in, same lines out.
 *
 * It computes no hockey. Every fact here is already in the stream.
 */
import type { GameEvent, GameStream, PlayerRef } from '@domain'
import { periodBases } from './timeline'

/** How loud a line is — the feed's density filter keys off this. */
export type PlayWeight = 'key' | 'normal' | 'ambient'

export interface PlayByPlayEntry {
  absT: number
  period: number
  /** Countdown clock within the period, "MM:SS". */
  clock: string
  /** Which bench the play belongs to, or null for neutral events. */
  side: 'home' | 'away' | null
  teamAbbr: string
  kind: GameEvent['type']
  text: string
  weight: PlayWeight
  /** Running score AFTER this line. */
  homeScore: number
  awayScore: number
}

const PERIOD_LEN = 1200

function clockOf(period: number, t: number, periodLen: number): string {
  const remaining = Math.max(0, (period <= 3 ? PERIOD_LEN : periodLen) - t)
  const mm = Math.floor(remaining / 60)
  const ss = Math.floor(remaining % 60)
  return `${mm}:${String(ss).padStart(2, '0')}`
}

function surname(full: string): string {
  const parts = full.trim().split(/\s+/)
  return parts[parts.length - 1] ?? full
}

/**
 * "Oskar Persson" → "O. Persson". Surname alone is the natural gamesheet
 * shorthand, but a roster happily carries two Perssons and the assist list then
 * reads "(Persson, Persson)", which looks like a bug. The initial disambiguates
 * in the same width — the same fix the match-day card makes.
 */
function shortName(full: string): string {
  const parts = full.trim().split(/\s+/)
  if (parts.length < 2) return full
  return `${parts[0]![0]}. ${parts[parts.length - 1]}`
}

const STRENGTH_TAG: Record<string, string> = {
  pp: 'PPG',
  sh: 'SHG',
  en: 'ENG',
  ev: '',
}

/** Ordinal for period headers — "1st", "2nd", "3rd", "OT", "2OT". */
export function periodLabel(period: number): string {
  if (period === 1) return '1st'
  if (period === 2) return '2nd'
  if (period === 3) return '3rd'
  return period === 4 ? 'OT' : `${period - 3}OT`
}

export function buildPlayByPlay(
  stream: GameStream,
  names: (id: PlayerRef) => string,
  isHome: (id: PlayerRef) => boolean,
  abbrs: { home: string; away: string }
): PlayByPlayEntry[] {
  const bases = periodBases(stream)
  const lengths = new Map<number, number>()
  for (const ev of stream) {
    const prev = lengths.get(ev.period) ?? 0
    if (ev.t > prev) lengths.set(ev.period, ev.t)
  }

  const out: PlayByPlayEntry[] = []
  let home = 0
  let away = 0

  const push = (
    ev: GameEvent,
    side: 'home' | 'away' | null,
    text: string,
    weight: PlayWeight
  ): void => {
    const base = bases.get(ev.period) ?? (ev.period - 1) * PERIOD_LEN
    // The engine's `gameEnd` carries t=0 rather than the final clock, which
    // would place the FINAL line twenty minutes before the horn it follows.
    // Pin it (and any other straggler) to where the feed has already reached —
    // this is a presentation concern, so it is fixed here, not in the stream.
    const raw = ev.type === 'gameEnd' ? 0 : base + ev.t
    const absT = Math.max(raw, out.length ? out[out.length - 1].absT : 0)
    out.push({
      absT,
      period: ev.period,
      clock: ev.type === 'gameEnd' ? '0:00' : clockOf(ev.period, ev.t, lengths.get(ev.period) ?? PERIOD_LEN),
      side,
      teamAbbr: side === 'home' ? abbrs.home : side === 'away' ? abbrs.away : '',
      kind: ev.type,
      text,
      weight,
      homeScore: home,
      awayScore: away,
    })
  }

  const sideOf = (id: PlayerRef): 'home' | 'away' => (isHome(id) ? 'home' : 'away')

  for (const ev of stream) {
    switch (ev.type) {
      case 'goal': {
        if (isHome(ev.scorer)) home++
        else away++
        const tag = STRENGTH_TAG[ev.strength] ?? ''
        const helpers = ev.assists.length
          ? ` (${ev.assists.map((a) => shortName(names(a))).join(', ')})`
          : ' (unassisted)'
        push(
          ev,
          sideOf(ev.scorer),
          `GOAL — ${names(ev.scorer)}${helpers}${tag ? ` · ${tag}` : ''}`,
          'key'
        )
        break
      }
      case 'penalty': {
        push(
          ev,
          sideOf(ev.player),
          `${names(ev.player)} — ${ev.infraction}, ${ev.minutes} min`,
          'key'
        )
        break
      }
      case 'shot': {
        const quality = ev.danger >= 0.65 ? 'Grade-A chance' : ev.danger >= 0.35 ? 'Shot' : 'Point shot'
        push(ev, sideOf(ev.shooter), `${quality} — ${surname(names(ev.shooter))}`, ev.danger >= 0.65 ? 'normal' : 'ambient')
        break
      }
      case 'save': {
        push(
          ev,
          sideOf(ev.goalie),
          `Save ${surname(names(ev.goalie))}${ev.rebound ? ' — rebound loose' : ''}`,
          ev.rebound ? 'normal' : 'ambient'
        )
        break
      }
      case 'blockedShot': {
        push(ev, sideOf(ev.blocker), `Blocked by ${surname(names(ev.blocker))}`, 'ambient')
        break
      }
      case 'hit': {
        push(ev, sideOf(ev.by), `${surname(names(ev.by))} hits ${surname(names(ev.on))}`, 'ambient')
        break
      }
      case 'takeaway': {
        push(ev, sideOf(ev.by), `${surname(names(ev.by))} takes it off ${surname(names(ev.from))}`, 'ambient')
        break
      }
      case 'giveaway': {
        push(ev, sideOf(ev.player), `Giveaway — ${surname(names(ev.player))}`, 'ambient')
        break
      }
      case 'faceoff': {
        // No zone label: the stream's Zone is stated from one side's point of
        // view, so printing it next to a named player would be a coin-flip on
        // whose "offensive" zone the reader assumes.
        push(ev, sideOf(ev.winner), `${surname(names(ev.winner))} wins the draw`, 'ambient')
        break
      }
      case 'whistle': {
        if (ev.reason === 'goal' || ev.reason === undefined) break
        const label =
          ev.reason === 'offside' ? 'Offside' :
          ev.reason === 'icing' ? 'Icing' :
          ev.reason === 'goalieFreeze' ? 'Whistle — goalie covers' :
          ev.reason === 'penalty' ? 'Whistle — penalty coming' : 'Whistle'
        push(ev, null, label, 'ambient')
        break
      }
      case 'periodEnd': {
        push(ev, null, `End of the ${periodLabel(ev.period)} — ${abbrs.away} ${away}, ${abbrs.home} ${home}`, 'key')
        break
      }
      case 'gameEnd': {
        const verdict = home > away ? `${abbrs.home} win` : away > home ? `${abbrs.away} win` : 'Tied'
        push(ev, null, `FINAL — ${abbrs.away} ${away}, ${abbrs.home} ${home} · ${verdict}`, 'key')
        break
      }
      // Positional / bench detail the feed doesn't print.
      case 'carry':
      case 'pass':
      case 'lineChange':
      case 'frame':
        break
    }
  }

  return out
}
