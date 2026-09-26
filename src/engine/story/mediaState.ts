/**
 * The media layer's saved state (docs/MEDIA-BEAT.md): the user's beat outlet's
 * published articles, the injury disclosures the press is working, the GM's
 * public claims the pundits will quote back, and the coach hot-seat arc.
 *
 * JSON-safe, additive (`CareerSnapshot.media?`): an old save loads with
 * emptyMediaState() and the beat simply starts writing from the next day.
 */
import type { BeatArticle } from './beatDesk'
import type { InjuryDisclosure } from './injuryDisclosure'
import type { PressPersonaId } from './factSheet'

export type ClaimKind = 'playoffs' | 'building' | 'coachBacked' | 'playerCore'

/** Something the GM said on the record that the season will prove or disprove. */
export interface GmClaim {
  id: string
  kind: ClaimKind
  /** The pundit who asked — he is the one who quotes it back. */
  personaId: PressPersonaId
  /** The GM's words, exactly as the presser recorded them. */
  quote: string
  subjectId?: string
  subjectName?: string
  year: number
  day: number
  dateISO: string
  status: 'open' | 'right' | 'wrong'
  resolvedYear?: number
  resolvedDay?: number
}

export type HotSeatStage = 'radar' | 'asked' | 'backed' | 'hedged' | 'recovered' | 'fired'

export interface HotSeatState {
  year: number
  coachId: string
  coachName: string
  stage: HotSeatStage
  /** Day the talk started. */
  since: number
  /** Last computed seat heat, 0–1. */
  heat: number
  /** Consecutive cool checks (recovery needs two). */
  coolChecks: number
}

export interface MediaState {
  /** The user club's beat articles, newest first. */
  articles: BeatArticle[]
  counter: number
  /** Last day (as year*1000+day) a beat piece went to the inbox — the weekly budget. */
  lastInboxKey: number
  disclosures: InjuryDisclosure[]
  claims: GmClaim[]
  hotSeat: HotSeatState | null
  /** Slot each user player held at the last notebook ("top line", "third pair"). */
  lastSlots: Array<[string, string]>
  /** Per-feature latches for this season, e.g. "2029|thanksgiving". */
  done: string[]
  /** Scheduling marks, "kind" -> year*1000+day of the last run. */
  last: Array<[string, number]>
  /** Mailbag topics used last time (so two weeks don't ask the same things). */
  lastMailTopics: string[]
  /** Presser bookkeeping: last presser day key and subjects asked this season. */
  lastPresserKey: number
  askedThisSeason: string[]
  /** Trade-request interactions already written into the chronicle. */
  chronicled: string[]
}

export function emptyMediaState(): MediaState {
  return {
    articles: [],
    counter: 0,
    lastInboxKey: -99999,
    disclosures: [],
    claims: [],
    hotSeat: null,
    lastSlots: [],
    done: [],
    last: [],
    lastMailTopics: [],
    lastPresserKey: -99999,
    askedThisSeason: [],
    chronicled: [],
  }
}

/** Load-side repair: any missing field defaults, arrays stay arrays. */
export function normalizeMediaState(raw: Partial<MediaState> | undefined | null): MediaState {
  const base = emptyMediaState()
  if (!raw || typeof raw !== 'object') return base
  return {
    articles: Array.isArray(raw.articles) ? raw.articles : base.articles,
    counter: typeof raw.counter === 'number' ? raw.counter : base.counter,
    lastInboxKey: typeof raw.lastInboxKey === 'number' ? raw.lastInboxKey : base.lastInboxKey,
    disclosures: Array.isArray(raw.disclosures) ? raw.disclosures : base.disclosures,
    claims: Array.isArray(raw.claims) ? raw.claims : base.claims,
    hotSeat: raw.hotSeat ?? null,
    lastSlots: Array.isArray(raw.lastSlots) ? raw.lastSlots : base.lastSlots,
    done: Array.isArray(raw.done) ? raw.done : base.done,
    last: Array.isArray(raw.last) ? raw.last : base.last,
    lastMailTopics: Array.isArray(raw.lastMailTopics) ? raw.lastMailTopics : base.lastMailTopics,
    lastPresserKey: typeof raw.lastPresserKey === 'number' ? raw.lastPresserKey : base.lastPresserKey,
    askedThisSeason: Array.isArray(raw.askedThisSeason) ? raw.askedThisSeason : base.askedThisSeason,
    chronicled: Array.isArray(raw.chronicled) ? raw.chronicled : base.chronicled,
  }
}

/** A comparable day key across seasons (offseason days use 900+faDay). */
export function dayKey(year: number, day: number): number {
  return year * 1000 + day
}

export const MAX_ARTICLES = 450
export const MAX_DISCLOSURES = 120
export const MAX_CLAIMS = 40
