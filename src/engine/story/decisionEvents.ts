/**
 * The decision-event library — Narrative Engine layer 2
 * (docs/NARRATIVE-ENGINE.md §"Decision events", EXCELLENCE.md B5.5).
 *
 * CK3-shaped: a character-driven SITUATION, 2–4 options with REAL tradeoffs
 * (never an obviously-correct answer), and effects that map to sim levers the
 * engine already has. Events live here as pure data so writing one never
 * touches engine code; the career layer scans triggers and delivers the
 * winner through the existing interaction machinery.
 *
 * Rules every event must satisfy (enforced by tests):
 *  - ≥2 options, and every option costs something real;
 *  - at least one option plants a delayed consequence (a promise or a flag);
 *  - the scene names the player and states WHY it's happening now.
 */
import type { Player } from '@domain'
import type { ResidueKind } from '@engine/career/livingLedger'
import type { Rng } from '@engine/shared/rng'
import { isEligible, type ContentCtx } from './contentEngine'

/** Sim levers an option may pull. All optional; the career layer applies them. */
export interface DecisionEffects {
  /** Morale delta for the subject player. */
  morale?: number
  /** Room-wide morale delta (the locker room is watching). */
  roomMorale?: number
  /** Standing the GM gains/loses with the room's veterans. */
  roomRespect?: number
  /** Write a promise into the LW5 ledger: he'll hold you to it. */
  promise?: 'iceTime' | 'newDeal' | 'exploreTrade'
  /** Leave a permanent residue flag (the Living Ledger remembers). Shares the
   *  ledger's own union so the two can never drift apart. */
  residue?: ResidueKind
  /** Chance (0–1) the choice leaks to the press as a story. */
  leakChance?: number
}

export interface DecisionOption {
  id: string
  label: string
  effects: DecisionEffects
  /** What the GM sees after choosing — the receipt. */
  outcome: string
}

export interface DecisionEvent {
  id: string
  /** Conditions on the ctx the career layer builds (min/max prefixes + equality). */
  conditions?: ContentCtx
  /** Rarity tiebreak when several are eligible; higher wins. */
  weight?: number
  /** The scene. Slots: {name} {last} {age} {gp} {team}. */
  scene: string
  options: DecisionOption[]
}

/* ────────────────────────── the library ────────────────────────── */
/* Seeded with the doc's worked example plus four more; grows toward 50. */

export const DECISION_EVENTS: DecisionEvent[] = [
  {
    id: 'ev.room.healthy-scratch-vet',
    conditions: { minAge: 30, minGamesPlayed: 700, scratched: true },
    weight: 2,
    scene:
      `{name} closed the office door behind him. {gp} games in this league, and he didn't sit down. ` +
      `"Just tell me straight — am I done here, or am I in your plans? I've earned the truth either way."`,
    options: [
      {
        id: 'plans',
        label: `"You're in my plans. You dress tomorrow."`,
        effects: { morale: 10, promise: 'iceTime', roomRespect: 2 },
        outcome: `He nodded once and left. You just put your word on the line — the room will check whether he dresses.`,
      },
      {
        id: 'truth',
        label: `"You deserve the truth: we're going younger."`,
        effects: { morale: -8, roomRespect: 6, residue: 'wasScratched' },
        outcome: `It cost him something to hear it, and cost you nothing to say it — except that he'll never quite look at the room the same way. The veterans respect the honesty.`,
      },
      {
        id: 'door',
        label: `"I don't owe minutes to anyone. Door's behind you."`,
        effects: { morale: -14, roomMorale: -4, roomRespect: -10, leakChance: 0.4, residue: 'wasScratched' },
        outcome: `He was gone in four seconds. Whether that conversation stays in this office is now somebody else's decision.`,
      },
    ],
  },
  {
    id: 'ev.room.captain-defends-teammate',
    conditions: { isLeader: true, minRoomTension: 55 },
    weight: 2,
    scene:
      `{last} asked for five minutes and used all of them. "The room's fine — but the guys see how the young ones are getting ` +
      `treated, and they're waiting to see if anyone says anything. So I'm saying something."`,
    options: [
      {
        id: 'back-him',
        label: `Back your captain publicly`,
        effects: { morale: 6, roomMorale: 8, roomRespect: 5, leakChance: 0.3 },
        outcome: `You said his name to the cameras and agreed with him. The room heard it before the reporters filed.`,
      },
      {
        id: 'private',
        label: `Agree privately, say nothing publicly`,
        effects: { morale: 3, roomMorale: 3, roomRespect: -2 },
        outcome: `He got what he asked for and none of the credit. He noticed which one you protected: the room, or the optics.`,
      },
      {
        id: 'overstep',
        label: `Tell him the letter doesn't make him management`,
        effects: { morale: -10, roomMorale: -6, roomRespect: -8, residue: 'wasDismissed' },
        outcome: `He didn't argue. He just stopped bringing things to you — which is worse, and you'll find that out later. His agent will find out sooner.`,
      },
    ],
  },
  {
    id: 'ev.medical.play-through-it',
    conditions: { nursingInjury: true, minImportance: 70 },
    weight: 3,
    scene:
      `The physio's report is careful; {last} is not. "It's manageable. I want to play." Your medical staff won't ` +
      `say no outright — they'll say it's your call, which is how they say no.`,
    options: [
      {
        id: 'play',
        label: `Let him play — the standings won't wait`,
        effects: { morale: 8, roomRespect: 3, promise: 'iceTime' },
        outcome: `He's in. If the thing that was manageable stops being manageable, everyone will remember whose call it was.`,
      },
      {
        id: 'sit',
        label: `Sit him. The season is long.`,
        effects: { morale: -6, roomMorale: 2, roomRespect: 4 },
        outcome: `He's furious in the professional way — polite, cold, unmistakable. Your staff exhaled.`,
      },
    ],
  },
  {
    id: 'ev.media.criticized-in-press',
    conditions: { minLosingStreak: 4, minMediaHeat: 50 },
    weight: 2,
    scene:
      `A columnist wrote that your club has "no identity and no urgency," named {last} as the example, and asked ` +
      `whether the GM has a plan. Your phone has three messages about it. So does his.`,
    options: [
      {
        id: 'defend',
        label: `Defend him publicly, take the shot yourself`,
        effects: { morale: 12, roomMorale: 6, roomRespect: 8, promise: 'iceTime' },
        outcome: `You put your name where his was. The column tomorrow will be about you — and every player in that room read the swap. You have also, in front of cameras, tied yourself to his deployment.`,
      },
      {
        id: 'silent',
        label: `Say nothing. Let it burn out.`,
        effects: { morale: -4, roomMorale: -2 },
        outcome: `It burned out in four days. He noticed it took four days.`,
      },
      {
        id: 'agree',
        label: `Publicly agree the urgency isn't good enough`,
        effects: { morale: -12, roomMorale: -8, roomRespect: -6, leakChance: 0.5 },
        outcome: `The message landed. So did the message about what you'll do when a microphone is nearby.`,
      },
    ],
  },
  {
    id: 'ev.contract.young-star-early-extension',
    conditions: { maxAge: 24, minImportance: 75, contractYearsRemaining: 1 },
    weight: 3,
    scene:
      `{last}'s agent floated something unusual: sign the extension NOW, a year early, below what he'll be worth ` +
      `if the season continues like this. "He likes it here. That discount has an expiry date, and it's June."`,
    options: [
      {
        id: 'sign-now',
        label: `Take the discount — lock him up early`,
        effects: { morale: 8, promise: 'newDeal', roomRespect: 3 },
        outcome: `You bought low on a rising player, and committed real money before you had to. If he plateaus, this is the deal they'll cite.`,
      },
      {
        id: 'wait',
        label: `Wait. Let the season finish and negotiate on facts.`,
        effects: { morale: -6, residue: 'wasShopped' },
        outcome: `Defensible, disciplined, and he heard it as hesitation. His camp will remember who blinked first — nobody.`,
      },
      {
        id: 'lowball',
        label: `Counter well below even the discount`,
        effects: { morale: -12, roomRespect: -4, leakChance: 0.35 },
        outcome: `The agent laughed, then stopped laughing. Whatever goodwill was in the room this morning is now a negotiating position.`,
      },
    ],
  },
]

/**
 * Pick the dilemma to raise, or null for silence.
 *
 * Deliberately NOT the content engine's selector: flavour text must never go
 * silent (it recycles a least-recently-used line), but a DILEMMA that already
 * fired must not be asked again — the same crossroads twice reads as amnesia.
 * So: eligible → strictly unused this season → most specific → seeded tiebreak.
 */
export function pickDecisionEvent(args: {
  ctx: ContentCtx
  rng: Rng
  /** Event ids already fired, with the season they fired in. */
  used: ReadonlyArray<{ variantId: string; year: number }>
  year: number
}): DecisionEvent | null {
  const { ctx, rng, used, year } = args
  const spent = new Set(used.filter((u) => u.year === year).map((u) => u.variantId))
  const eligible = DECISION_EVENTS.filter(
    (e) => !spent.has(e.id) && isEligible({ id: e.id, ...(e.conditions ? { conditions: e.conditions } : {}), text: '' }, ctx)
  )
  if (eligible.length === 0) return null
  const score = (e: DecisionEvent): number =>
    Object.keys(e.conditions ?? {}).length * 10 + (e.weight ?? 1)
  const top = Math.max(...eligible.map(score))
  const best = eligible.filter((e) => score(e) === top)
  return best[rng.int(best.length)] ?? null
}

/** Slot fills for a scene/option string. */
export function decisionSlots(player: Player, gamesPlayed: number, teamName: string): Record<string, string> {
  const last = player.name.split(' ').slice(-1)[0] ?? player.name
  return {
    name: player.name,
    last,
    age: String(player.age),
    gp: gamesPlayed.toLocaleString(),
    team: teamName,
  }
}
