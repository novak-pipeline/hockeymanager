/**
 * phoneCalls.ts — who is on the line, and what they actually SAY.
 *
 * The living phone used to voice whatever string the inbox happened to hold. Those
 * strings are written for a *card*: third-person narration, stage directions, and
 * UI consequence hints. Spoken aloud in a character's voice they were nonsense —
 * the owner ringing you to say "the owner is looking at the balance sheet", a
 * winger phoning to narrate himself closing your office door, a club's front
 * office reading out an asset list. That is the "calls make no sense" bug.
 *
 * The rule this module enforces: **the phone rings only when somebody is actually
 * speaking, and it speaks only their words.**
 *
 *   • An authored office scene is prose with dialogue embedded in it. We lift the
 *     dialogue (`spokenFromScene`) and voice only that; the full scene still reads
 *     on its inbox card. A scene with no real dialogue in it has nobody on the
 *     line — it stays in the office, where its news item already points.
 *   • A player concern is already first-person speech, so it is spoken whole.
 *   • The owner and rival GMs get an authored first-person line from the engine
 *     (`spoken`), separate from the written body.
 *
 * Pure and renderer-agnostic so the whole trigger table is unit-testable without
 * mounting React.
 */
import type { InboxView, OwnerRequestView, PlayerInteractionView } from '../../worker/protocol'
import type { StaffView, TradesView } from '@engine/career/views'
import type { ScreenId } from '../components/NavContext'
import type { VoiceRole } from './voiceCast'

/** Who is talking in an authored scene. Mirrors DecisionEvent['speaker']. */
export type SceneSpeaker = 'player' | 'agent' | 'owner' | 'press'

/** A unified incoming call, whoever is on the line. */
export interface PhoneCall {
  id: string
  callerName: string
  callerRole: string
  faceId?: string
  voice: VoiceRole
  /** Only what the caller says out loud. Never narration — the written card
   *  prose stays in the inbox, which is where the call's action deep-links. */
  spoken: string
  actionLabel: string
  actionTarget: ScreenId
}

/** Minimum words for a quoted run to count as a real utterance rather than a
 *  fragment lifted out of a sentence ("something to announce"). */
const MIN_SPOKEN_WORDS = 6

/**
 * Lift the spoken line out of an authored scene, or null when nobody speaks in it.
 *
 * Takes the LAST substantial quoted run: scenes with two speakers (a reporter's
 * question, then the player's reaction to it) must not put the first man's words
 * in the second man's mouth, and the last thing said is the thing you answer.
 * "Substantial" = a whole sentence of at least MIN_SPOKEN_WORDS, which rejects
 * quoted sentence-fragments and quoted newspaper phrases.
 */
export function spokenFromScene(scene: string): string | null {
  const norm = scene.replace(/[“”]/g, '"')
  let best: string | null = null
  for (const m of norm.matchAll(/"([^"]+)"/g)) {
    const q = (m[1] ?? '').trim()
    if (q.split(/\s+/).length >= MIN_SPOKEN_WORDS && /[.!?]$/.test(q)) best = q
  }
  return best
}

/** Role label + voice for the man speaking in a scene. */
function sceneCaller(
  speaker: SceneSpeaker,
  it: PlayerInteractionView,
  staff: StaffView | null,
): { callerName: string; callerRole: string; faceId?: string; voice: VoiceRole } {
  switch (speaker) {
    case 'owner':
      return {
        callerName: staff?.owner.name ?? 'The Owner',
        callerRole: 'Club Owner',
        ...(staff?.owner.faceId ? { faceId: staff.owner.faceId } : {}),
        voice: 'owner',
      }
    case 'press':
      return { callerName: 'The beat writer', callerRole: 'Press', voice: 'pundit' }
    case 'agent':
      return {
        callerName: `${it.playerName}'s agent`,
        callerRole: 'Player agent',
        voice: 'agent',
      }
    case 'player':
    default:
      return {
        callerName: it.playerName,
        callerRole: 'Player',
        ...(it.faceId ? { faceId: it.faceId } : {}),
        voice: 'player',
      }
  }
}

/**
 * Turn one open concern into a call — or null when it belongs in the office.
 *
 * `scene` interactions are authored dilemmas staged in your office (their news
 * item literally reads "…is waiting in your office"): they ring only if somebody
 * in them speaks. A plain concern is the player's own first-person words, so it
 * always rings and is spoken whole.
 */
export function callFromInteraction(
  it: PlayerInteractionView,
  staff: StaffView | null,
): PhoneCall | null {
  const base = { id: it.id, actionLabel: 'Talk it out →', actionTarget: 'inbox' as const }
  if (!it.scene) {
    return {
      ...base,
      callerName: it.playerName,
      callerRole: 'Player',
      ...(it.faceId ? { faceId: it.faceId } : {}),
      voice: 'player',
      spoken: it.message,
    }
  }
  const spoken = spokenFromScene(it.message)
  if (!spoken) return null // narration — nobody is on the line
  return { ...base, ...sceneCaller(it.speaker ?? 'player', it, staff), spoken }
}

/** The overall-rating floor at which a trade offer is worth ringing about;
 *  routine offers stay in the Trades tab. */
const BLOCKBUSTER_OVR = 78

/**
 * Rank every live call and return the first one the GM hasn't dealt with. The
 * owner outranks a rival GM's blockbuster, which outranks a player's concern.
 */
export function pickCall(args: {
  ownerReq: OwnerRequestView | null
  trades: TradesView | null
  inbox: InboxView | null
  staff: StaffView | null
  /** Call ids already rung (this career). */
  seen: ReadonlySet<string>
}): PhoneCall | null {
  const { ownerReq, trades, inbox, staff, seen } = args

  if (ownerReq?.spoken) {
    const id = `owner:${ownerReq.kind}:${hashStr(ownerReq.body)}`
    if (!seen.has(id)) {
      return {
        id,
        callerName: staff?.owner.name ?? 'The Owner',
        callerRole: 'Club Owner',
        ...(staff?.owner.faceId ? { faceId: staff.owner.faceId } : {}),
        voice: 'owner',
        spoken: ownerReq.spoken,
        actionLabel: 'Take it upstairs →',
        actionTarget: 'board',
      }
    }
  }

  for (const o of trades?.incoming ?? []) {
    const id = `trade:${o.offerId}`
    if (seen.has(id)) continue
    if (!o.spoken) continue // an offer with no pitch is paperwork, not a call
    const headliner = [...o.receive.players, ...o.give.players].sort((a, b) => b.overall - a.overall)[0]
    if (!headliner || headliner.overall < BLOCKBUSTER_OVR) continue
    return {
      id,
      callerName: o.gmName ?? `${o.receive.teamName} — front office`,
      callerRole: `${o.receive.teamAbbr} General Manager`,
      voice: 'gm',
      spoken: o.spoken,
      actionLabel: 'See the offer →',
      actionTarget: 'trades',
    }
  }

  for (const it of inbox?.interactions ?? []) {
    if (it.severity !== 'serious' || seen.has(it.id)) continue
    const call = callFromInteraction(it, staff)
    if (call) return call
  }
  return null
}

/** Stable, compact hash of a string — for a seen-key on callers without an id. */
export function hashStr(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}
