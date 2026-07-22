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

/**
 * The context keys the career runner actually populates — the CONTRACT between
 * authored events and the engine.
 *
 * This exists because a condition on a key the runner never sets fails
 * silently (a missing key can't satisfy min/max or equality), so the event
 * simply never fires: authored content sitting dark, with no error anywhere.
 * A test asserts every event's conditions are a subset of this list, which
 * makes that whole bug class impossible to ship.
 */
export const DECISION_CTX_KEYS = [
  'age',
  'gamesPlayed',
  'scratched',
  'isLeader',
  'roomTension',
  'losingStreak',
  'mediaHeat',
  'nursingInjury',
  'importance',
  'contractYearsRemaining',
  'position',
  'potential',
  'inMinors',
  'formerlyShopped',
  'deadlineWeek',
  'savePct',
] as const

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

/* ── wave 2: the deadline, the owner, the crease, the kid, the returnee ── */

DECISION_EVENTS.push(
  {
    id: 'ev.deadline.rental-vs-room',
    conditions: { deadlineWeek: true, minImportance: 72, contractYearsRemaining: 1 },
    weight: 4,
    scene:
      `Two clubs have called about {last} in as many days, and the second offer was serious. He is a pending free agent ` +
      `on an expiring deal, he has been here {age} years' worth of good soldiering, and he is currently the third-best ` +
      `player in your room. The deadline is Friday.`,
    options: [
      {
        id: 'sell',
        label: `Take the picks. He was never signing anyway.`,
        effects: { roomMorale: -10, roomRespect: -4, residue: 'wasShopped', leakChance: 0.6 },
        outcome: `You banked the futures. The room watched a good teammate get turned into an asset in February, and every man in it did the arithmetic on himself.`,
      },
      {
        id: 'keep-run',
        label: `Keep him. We're going for it.`,
        effects: { morale: 10, roomMorale: 8, roomRespect: 6, promise: 'newDeal' },
        outcome: `You told the room, in effect, that this year counts. If it ends in the first round with nothing to show, that sentence is the one they'll replay.`,
      },
      {
        id: 'extend-now',
        label: `Try to extend him before Friday`,
        effects: { morale: 6, promise: 'newDeal', leakChance: 0.3 },
        outcome: `You chose the hardest path: keep the player AND the asset. His camp now knows exactly how badly you want it, which is not a strong negotiating position.`,
      },
    ],
  },
  {
    id: 'ev.owner.sell-the-fans-a-story',
    conditions: { minLosingStreak: 5, minMediaHeat: 60 },
    weight: 3,
    scene:
      `The owner's office called before the tickets report even reached you. Attendance is sliding, the season-ticket ` +
      `renewal window opens in three weeks, and he wants "something to announce." Not a plan — an announcement.`,
    options: [
      {
        id: 'make-a-move',
        label: `Give him a move — trade someone the fans know`,
        effects: { roomMorale: -8, roomRespect: -6, residue: 'wasShopped', leakChance: 0.5 },
        outcome: `He got his headline. You spent a player to buy three weeks of goodwill, and the room learned what your job security is worth in bodies.`,
      },
      {
        id: 'hold-the-line',
        label: `Tell him the plan doesn't change for a renewal window`,
        effects: { roomRespect: 8, roomMorale: 4, leakChance: 0.35 },
        outcome: `You said no to the man who signs your cheques, in writing. Somebody in that building will make sure a columnist knows there was friction.`,
      },
      {
        id: 'sell-the-kids',
        label: `Offer him the prospects story instead`,
        effects: { morale: -4, roomMorale: 2, promise: 'iceTime' },
        outcome: `You promised him young faces in the lineup, which means you have now promised those young faces minutes. Two commitments for the price of one press release.`,
      },
    ],
  },
  {
    id: 'ev.crease.goalie-controversy',
    conditions: { position: 'G', minImportance: 74, maxSavePct: 89 },
    weight: 3,
    scene:
      `{last} has started 40 of your last 45 and his numbers have quietly fallen off a cliff. Your backup has been the ` +
      `better goalie for a month. {last} has not asked for a night off; he has, per the goalie coach, "stopped sleeping."`,
    options: [
      {
        id: 'ride-him',
        label: `He's the starter. He plays through it.`,
        effects: { morale: 4, roomMorale: -4, promise: 'iceTime' },
        outcome: `Loyalty declared, publicly and in the lineup card. If the slide continues, you have no move left that doesn't look like panic.`,
      },
      {
        id: 'split',
        label: `Split the net until someone takes it`,
        effects: { morale: -8, roomMorale: 4, roomRespect: 4 },
        outcome: `The honest answer, and the one goalies hate most: you told a starter he is now a competition. His agent will phone before the week is out.`,
      },
      {
        id: 'bench-him',
        label: `Sit him. Let the backup run with it.`,
        effects: { morale: -14, roomMorale: 2, residue: 'wasScratched', leakChance: 0.45 },
        outcome: `A benched starting goaltender is a story by Tuesday. You may have saved his season or ended his time here; nobody finds out for a month.`,
      },
    ],
  },
  {
    id: 'ev.prospect.rush-or-ripen',
    conditions: { maxAge: 20, minPotential: 82, inMinors: true },
    weight: 3,
    scene:
      `{last} is {age} and has nothing left to prove where he is. Your development staff want another half-season of ` +
      `big minutes in the minors. Your coach wants him tomorrow. The kid's camp has started using the phrase "clear runway."`,
    options: [
      {
        id: 'call-up',
        label: `Bring him up now, top-nine minutes`,
        effects: { morale: 10, roomMorale: -3, promise: 'iceTime' },
        outcome: `He is in the lineup and you have promised the minutes that come with it. Rushed kids who sit are how organisations lose players three years early.`,
      },
      {
        id: 'ripen',
        label: `Leave him down. He plays every situation there.`,
        effects: { morale: -8, roomRespect: 4 },
        outcome: `Right for his development, and he does not experience it as care — he experiences it as a door not opening. His camp starts counting the games.`,
      },
    ],
  },
  {
    id: 'ev.room.returning-face',
    conditions: { formerlyShopped: true, minImportance: 70 },
    weight: 5,
    scene:
      `{last} asked for the meeting himself this time. He has played well since the whole business, said nothing publicly, ` +
      `and now wants to talk about next year while he still has leverage. "I'd like to stay. I'd like to know that you'd like that too."`,
    options: [
      {
        id: 'commit',
        label: `Tell him plainly: you want him here`,
        effects: { morale: 14, roomRespect: 6, promise: 'newDeal' },
        outcome: `You closed a wound you opened. He'll hold you to the deal that conversation implied — and until it's signed, everyone in the room is watching whether your word survives a negotiation.`,
      },
      {
        id: 'noncommittal',
        label: `"Let's see where we are in the summer."`,
        effects: { morale: -10, residue: 'wasShopped', leakChance: 0.3 },
        outcome: `The second time a man hears he might be available, he stops asking. He'll take the summer meeting — with everyone.`,
      },
      {
        id: 'honest-rebuild',
        label: `Be straight: the club is going younger`,
        effects: { morale: -6, roomRespect: 10, residue: 'wasShopped' },
        outcome: `No theatre, no false hope. He thanked you for it, meant it, and started thinking about where he goes next — which is exactly what you just told him to do.`,
      },
    ],
  },
)

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
