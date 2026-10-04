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
  /**
   * An early-extension concession the player's camp will honour for the rest of
   * this season: a multiplier (<1) on his asking price at the extension table.
   *
   * This exists because a scene must never promise an action the engine
   * refuses (Playtest 2026-08-26 §E2). Taking this option opens a REAL
   * extension negotiation at a REAL discount; letting the season end lets it
   * lapse, exactly as the agent said it would.
   */
  extensionDiscount?: number
  /**
   * The concrete thing this option says HAPPENS — the label or the receipt
   * describes it as done. The career layer performs it through the same API the
   * screens use; if the engine refuses (roster full, market closed, no-trade
   * clause…) the receipt is replaced with the refusal, so a blocked action is
   * never silent and a scene never claims something the game did not do
   * (E3 audit, docs/PRESSURE-AND-FIRINGS.md). Enforced by the content-integrity
   * tests in decisionEvents.test.ts.
   */
  act?: DecisionAct
}

/** The actions a scene may perform. Every one has an engine performer. */
export type DecisionAct =
  /** Take him off the healthy-scratch list: he dresses next game. */
  | 'dress'
  /** Clear a MINOR injury against medical advice: he dresses, hurt. */
  | 'playThrough'
  /** Recall him from the farm to the NHL roster. */
  | 'callUp'
  /** Grant the release he asked for: contract terminated, he walks. */
  | 'release'
  /** Move him now for the best offer the league will table. */
  | 'sell'
  /** Take him off the market (trade status: untouchable). */
  | 'untouchable'
  /** Name him the starting goaltender. */
  | 'makeStarter'
  /** Sit the struggling starter: the backup takes the net. */
  | 'benchStarter'
  /** Put him on the first power-play unit. */
  | 'topPowerPlay'

/** Every act, for exhaustiveness checks in tests. */
export const DECISION_ACTS: readonly DecisionAct[] = [
  'dress', 'playThrough', 'callUp', 'release', 'sell', 'untouchable', 'makeStarter', 'benchStarter', 'topPowerPlay',
]

export interface DecisionOption {
  id: string
  label: string
  effects: DecisionEffects
  /** What the GM sees after choosing — the receipt. */
  outcome: string
}

/** Who does the talking in a scene. Most dilemmas are the player himself; a few
 *  are brought to you by his agent, the owner, or a reporter. The living phone
 *  reads this to know whose face and voice to put on the call — without it a
 *  beat writer's question came out of the winger's mouth. */
export type SceneSpeaker = 'player' | 'agent' | 'owner' | 'press'

export interface DecisionEvent {
  id: string
  /** Conditions on the ctx the career layer builds (min/max prefixes + equality). */
  conditions?: ContentCtx
  /** Rarity tiebreak when several are eligible; higher wins. */
  weight?: number
  /** The scene. Slots: {name} {last} {age} {gp} {team}. */
  scene: string
  /** Whose voice says the dialogue in `scene`. Defaults to the player. */
  speaker?: SceneSpeaker
  /** Inbox headline that announces the scene. Same slots as `scene`. It must
   *  name whoever actually brings it to you: the owner's call is not "{name}
   *  is waiting in your office". Falls back to `sceneHeadline(speaker)`. */
  headline?: string
  options: DecisionOption[]
}

/** The default headline for a scene with no authored one, by who raises it. */
export function sceneHeadline(ev: Pick<DecisionEvent, 'speaker' | 'headline'>): string {
  if (ev.headline) return ev.headline
  switch (ev.speaker) {
    case 'agent': return `{last}'s agent is on the line`
    case 'owner': return `The owner wants to talk about {last}`
    case 'press': return `A reporter asks about {last}`
    default: return `{name} wants a word`
  }
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
  'formerlyDismissed',
  'deadlineWeek',
  'savePct',
  // Percent of the regular season played, 0–100. Gates any scene whose promised
  // action has its own calendar window — extension talks open at the halfway
  // mark, so the scene that sells an extension must not fire before it.
  'seasonPct',
  // Games the current injury still has to run (0 when healthy). Gates any scene
  // that lets a player PLAY THROUGH it — only a minor knock can be overruled.
  'injuryGames',
] as const

/* ────────────────────────── the library ────────────────────────── */
/* Seeded with the doc's worked example plus four more; grows toward 50. */

export const DECISION_EVENTS: DecisionEvent[] = [
  {
    id: 'ev.room.healthy-scratch-vet',
    conditions: { minAge: 30, minGamesPlayed: 700, scratched: true },
    weight: 2,
    headline: `{name} wants to know where he stands`,
    scene:
      `{name} closed the office door behind him and didn't sit down. {gp} games in this league, and tonight he's in a suit. ` +
      `"Just tell me straight. Am I done here, or am I in your plans? I've earned the truth either way."`,
    options: [
      {
        id: 'plans',
        label: `"You're in my plans. You dress tomorrow."`,
        effects: { morale: 10, promise: 'iceTime', roomRespect: 2, act: 'dress' },
        outcome: `He nodded once and left. He's in the lineup tomorrow, and the room will be watching whether he stays in it.`,
      },
      {
        id: 'truth',
        label: `"You deserve the truth: we're going younger."`,
        effects: { morale: -8, roomRespect: 6, residue: 'wasScratched' },
        outcome: `It hurt him to hear it. The veterans heard about it by lunch and respected that you said it to his face.`,
      },
      {
        id: 'door',
        label: `"I don't owe minutes to anyone. Door's behind you."`,
        effects: { morale: -14, roomMorale: -4, roomRespect: -10, leakChance: 0.4, residue: 'wasScratched' },
        outcome: `He was gone in four seconds. Whether that conversation stays in this office is up to him now.`,
      },
    ],
  },
  {
    id: 'ev.room.captain-defends-teammate',
    conditions: { isLeader: true, minRoomTension: 55 },
    weight: 2,
    headline: `Your captain, {last}, asks for five minutes`,
    scene:
      `{last} asked for five minutes and used all of them. "The room's fine. But the guys see how the young ones are getting ` +
      `treated, and they're waiting to see if anyone says anything. So I'm saying something."`,
    options: [
      {
        id: 'back-him',
        label: `Back your captain publicly`,
        effects: { morale: 6, roomMorale: 8, roomRespect: 5, leakChance: 0.3 },
        outcome: `You said his name to the cameras and agreed with him. The players had heard about it before the reporters filed.`,
      },
      {
        id: 'private',
        label: `Agree privately, say nothing publicly`,
        effects: { morale: 3, roomMorale: 3, roomRespect: -2 },
        outcome: `He got what he asked for and none of the credit. He noticed you kept your own name out of it.`,
      },
      {
        id: 'overstep',
        label: `Tell him the letter doesn't make him management`,
        effects: { morale: -10, roomMorale: -6, roomRespect: -8, residue: 'wasDismissed' },
        outcome: `He didn't argue. He'll stop bringing things to you, and his agent will hear about this conversation before you hear about the next problem.`,
      },
    ],
  },
  {
    id: 'ev.medical.play-through-it',
    // maxInjuryGames: "manageable" means a knock the GM can overrule. A torn
    // ligament cannot be played through, so the scene must not offer it.
    conditions: { nursingInjury: true, minImportance: 70, maxInjuryGames: 4 },
    weight: 3,
    headline: `{last} says he can play hurt`,
    scene:
      `The physio's report is careful. {last} is not. "It's manageable. I want to play." The medical staff won't ` +
      `say no outright. They've written "GM's call" at the bottom of the report.`,
    options: [
      {
        id: 'play',
        label: `Let him play. The standings won't wait.`,
        effects: { morale: 8, roomRespect: 3, promise: 'iceTime', act: 'playThrough' },
        outcome: `He's in. If the knock gets worse, the report with your name at the bottom is still in the trainer's file.`,
      },
      {
        id: 'sit',
        label: `Sit him. The season is long.`,
        effects: { morale: -6, roomMorale: 2, roomRespect: 4 },
        outcome: `He's furious, politely. The trainers were relieved.`,
      },
    ],
  },
  {
    id: 'ev.media.criticized-in-press',
    conditions: { minLosingStreak: 4, minMediaHeat: 50 },
    weight: 2,
    headline: `A column singles out {last}`,
    scene:
      `A columnist wrote that your club has "no identity and no urgency," named {last} as the example, and asked ` +
      `whether the GM has a plan. You have three messages about it. So does he.`,
    options: [
      {
        id: 'defend',
        label: `Defend him publicly, take the shot yourself`,
        effects: { morale: 12, roomMorale: 6, roomRespect: 8, promise: 'iceTime' },
        outcome: `You put your name where his was, on camera. Tomorrow's column will be about you, and you've tied yourself to his ice time in public.`,
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
        outcome: `The quote ran with his name next to yours. Every player in the room now knows what you say when a microphone is on.`,
      },
    ],
  },
  {
    id: 'ev.contract.young-star-early-extension',
    // minSeasonPct 50: extension talks are not legal before the turn of the
    // calendar year, and a scene must never offer an action the game refuses.
    conditions: { maxAge: 24, minImportance: 75, contractYearsRemaining: 1, minSeasonPct: 50 },
    weight: 3,
    speaker: 'agent',
    headline: `{last}'s agent offers an early extension`,
    scene:
      `{last}'s agent floated something unusual: sign the extension now, a year early, below what he'll be worth ` +
      `if the season keeps going like this. "He likes it here. That discount has an expiry date, and it's June."`,
    options: [
      {
        id: 'sign-now',
        label: `Take the discount. Open extension talks today.`,
        effects: { morale: 8, promise: 'newDeal', roomRespect: 3, extensionDiscount: 0.87 },
        outcome:
          `His camp will hold the number until the season ends. Open extension talks from his profile. ` +
          `The deal starts next season and counts against next season's cap, not this one. In June the discount is gone.`,
      },
      {
        id: 'wait',
        label: `Wait. Let the season finish and negotiate on facts.`,
        effects: { morale: -6, residue: 'wasShopped' },
        outcome: `A sensible answer, and he heard it as hesitation. His agent made a note of it.`,
      },
      {
        id: 'lowball',
        label: `Counter well below even the discount`,
        effects: { morale: -12, roomRespect: -4, leakChance: 0.35 },
        outcome: `The agent laughed, then stopped laughing. The goodwill he walked in with is gone, and next summer's talks start from here.`,
      },
    ],
  },
  {
    id: 'ev.goalie.pulled-again',
    // savePct is a whole-number percent in the runner's ctx; the old 0.888 could
    // never be met, so this scene had never once fired.
    conditions: { position: 'G', maxSavePct: 88, minGamesPlayed: 20 },
    weight: 2,
    headline: `{last} wants to talk about getting pulled`,
    scene:
      `{last} caught you in the hallway, still in his gear. "Third time this month you've pulled me. ` +
      `I can wear that. But I need to know if you're pulling the goalie or pulling me."`,
    options: [
      {
        id: 'starter',
        label: `"You're my starter. I'll stop pulling you."`,
        effects: { morale: 12, promise: 'iceTime', roomRespect: -3 },
        outcome: `He straightened up. You've also just taken the hook away from your coach, and the first night it costs a game, the bench will know why.`,
      },
      {
        id: 'earn-it',
        label: `"You're pulled when you're beaten. Same as anyone."`,
        effects: { morale: -6, roomRespect: 7 },
        outcome: `He didn't like it. The skaters who heard about it did: one set of rules for everybody.`,
      },
      {
        id: 'tandem',
        label: `"We're going to a tandem for a while."`,
        effects: { morale: -10, roomMorale: 3, leakChance: 0.3, residue: 'wasDemoted' },
        outcome: `He heard "you're not the starter any more," because that's what it means. His agent will date the end of his run from today.`,
      },
    ],
  },
  {
    id: 'ev.media.trade-block-question',
    conditions: { formerlyShopped: true, minMediaHeat: 55 },
    weight: 3,
    speaker: 'press',
    headline: `A reporter asks if {last} is available`,
    scene:
      `The beat writer skips the small talk. "We hear {name} was available. Is he in your plans, or is he a rental ` +
      `for somebody else?" The recorder is already running.`,
    options: [
      {
        id: 'deny',
        label: `"He's not going anywhere."`,
        effects: { morale: 8, promise: 'iceTime', roomRespect: -5, leakChance: 0.45, act: 'untouchable' },
        outcome: `He'll read that tonight and believe it. So will the GMs you were talking to, and one of them knows you offered him last week.`,
      },
      {
        id: 'honest',
        label: `"I listen on everybody. That's the job."`,
        effects: { morale: -9, roomRespect: 8, residue: 'wasShopped' },
        outcome: `The room respects a GM who doesn't lie to it. {last} still had to explain the headline to his family.`,
      },
      {
        id: 'nocomment',
        label: `"I don't discuss internal conversations."`,
        effects: { morale: -4, roomMorale: -3, leakChance: 0.55 },
        outcome: `By morning somebody with a source in another front office had filled in the blank for you.`,
      },
    ],
  },
  {
    id: 'ev.injury.play-through-it',
    conditions: { nursingInjury: true, minImportance: 70, maxInjuryGames: 8 },
    weight: 3,
    headline: `{last} wants to play through the injury`,
    scene:
      `The physio's report says {last} sits two weeks. {last} says he's playing. "Two weeks is a guess. ` +
      `I've played through worse and you know it."`,
    options: [
      {
        id: 'let-him',
        label: `Let him play. You need the points.`,
        effects: { morale: 8, roomRespect: 5, roomMorale: -2, act: 'playThrough' },
        outcome: `He dressed. The medical staff put their objection in writing and filed it.`,
      },
      {
        id: 'sit-him',
        label: `Sit him. The season is longer than one game.`,
        effects: { morale: -10, roomMorale: 4, promise: 'iceTime' },
        outcome: `He was furious, and he's protected. When he's healthy he expects his minutes back, and he'll be counting.`,
      },
      {
        id: 'defer',
        label: `Leave it to the medical staff`,
        effects: { morale: -3, roomRespect: -6 },
        outcome: `You didn't decide, so the trainers did. The players noticed you kept your name off it.`,
      },
    ],
  },
  {
    id: 'ev.owner.streak-ultimatum',
    conditions: { minLosingStreak: 6, minMediaHeat: 60 },
    weight: 4,
    speaker: 'owner',
    headline: `The owner calls at 7 a.m.`,
    scene:
      `The owner called at seven in the morning. Six straight losses, and he brought up {name} twice ` +
      `without being asked. "I'm not telling you how to do your job. But I want to hear that somebody is ` +
      `accountable, and I want to hear it today."`,
    options: [
      {
        id: 'coach',
        label: `Put the coach on notice publicly`,
        effects: { roomMorale: -8, roomRespect: -6, leakChance: 0.6, residue: 'wasDismissed' },
        outcome: `The owner is satisfied. Your coach read it at the same time the players did.`,
      },
      {
        id: 'own-it',
        label: `"It's on me. I built this roster."`,
        // Costs standing with the owner rather than the room, so it reads as a
        // real trade rather than the obviously-correct answer.
        effects: { roomMorale: 6, roomRespect: 10, leakChance: 0.35 },
        outcome: `The quote ran by lunchtime and the room got some air. The owner took note of whose name was on it.`,
      },
      {
        id: 'shake',
        label: `Promise changes to the lineup`,
        effects: { roomMorale: -4, roomRespect: -2, promise: 'exploreTrade' },
        outcome: `You bought a week. Every player in the room spent the afternoon wondering if he's one of the changes.`,
      },
    ],
  },
  {
    id: 'ev.deadline.rental-honesty',
    conditions: { deadlineWeek: true, maxContractYearsRemaining: 1, minImportance: 60 },
    weight: 4,
    headline: `{last} asks if he'll finish the year here`,
    scene:
      `The deadline is days away. {name} is on an expiring deal, and he's asked you ` +
      `straight out: "Am I finishing the year here?"`,
    options: [
      {
        id: 'commit',
        label: `"You finish it here. My word."`,
        effects: { morale: 14, promise: 'newDeal', roomRespect: 4, act: 'untouchable' },
        outcome: `He believed you. He's off the market now, and so is the best trade chip you had this week.`,
      },
      {
        id: 'honest',
        label: `"I can't promise that. You've earned honesty."`,
        effects: { morale: -7, roomRespect: 9, residue: 'wasShopped' },
        outcome: `He thanked you. He played the next two nights like a man auditioning for every other team in the league.`,
      },
      {
        id: 'dodge',
        label: `"Let's talk after the deadline."`,
        effects: { morale: -11, roomMorale: -4, leakChance: 0.4 },
        outcome: `He heard "you're available." So did everyone he told.`,
      },
    ],
  },
  {
    id: 'ev.minors.buried-veteran',
    conditions: { inMinors: true, minAge: 28, minGamesPlayed: 300 },
    weight: 2,
    headline: `{name} asks for his release`,
    scene:
      `{name} is {age}, has {gp} games on his record, and is riding the bus in the minors. He isn't asking for a call-up. "Just release me. ` +
      `Let me go be useful somewhere. I'm not doing this for another year."`,
    options: [
      {
        id: 'recall',
        label: `Bring him up`,
        effects: { morale: 12, promise: 'iceTime', roomMorale: -4, act: 'callUp' },
        outcome: `A younger player just lost his spot to a man you'd written off. Now he has to play like it was the right call.`,
      },
      {
        id: 'release',
        label: `Let him go, with thanks`,
        effects: { morale: 5, roomRespect: 7, residue: 'wasDismissed', act: 'release' },
        outcome: `You lost the depth. Every veteran in your system heard that this club lets a man leave on his own terms.`,
      },
      {
        id: 'keep',
        label: `"I need the insurance. You stay."`,
        effects: { morale: -14, roomRespect: -7, leakChance: 0.4 },
        outcome: `He stays, and so does his contract. He'll spend the year in the minors telling anyone who asks how he got there.`,
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
    headline: `Two clubs call about {last}`,
    scene:
      `Two clubs have called about {last} in two days, and the second offer was serious. He's {age}, on an expiring ` +
      `deal, and one of the three best players in your room. The deadline is Friday.`,
    options: [
      {
        id: 'sell',
        label: `Take the picks. He was never signing anyway.`,
        effects: { roomMorale: -10, roomRespect: -4, residue: 'wasShopped', leakChance: 0.6, act: 'sell' },
        outcome: `You got the picks. The room watched a good teammate get traded for futures in February, and every player in it did the math on himself.`,
      },
      {
        id: 'keep-run',
        label: `Keep him. We're going for it.`,
        effects: { morale: 10, roomMorale: 8, roomRespect: 6, promise: 'newDeal', act: 'untouchable' },
        outcome: `You told the room this year counts. If it ends in the first round, that's what they'll remember you said.`,
      },
      {
        id: 'extend-now',
        label: `Try to extend him before Friday`,
        effects: { morale: 6, promise: 'newDeal', leakChance: 0.3 },
        outcome: `You want the player and the asset. His agent now knows how badly you want the deal, and his number just went up.`,
      },
    ],
  },
  {
    id: 'ev.owner.sell-the-fans-a-story',
    conditions: { minLosingStreak: 5, minMediaHeat: 60 },
    weight: 3,
    speaker: 'owner',
    headline: `The owner wants something to announce`,
    scene:
      `The owner's office called before the ticket report reached you. Attendance is down, season-ticket renewals ` +
      `open in three weeks, and he wants "something to announce." Not a plan. An announcement. He brought up ` +
      `{last} without being asked. Twenty minutes later {last} is at your door. Somebody in the building talks.`,
    options: [
      {
        id: 'make-a-move',
        label: `Give him a move. Trade someone the fans know.`,
        effects: { roomMorale: -8, roomRespect: -6, residue: 'wasShopped', leakChance: 0.5, act: 'sell' },
        outcome: `He got his headline. You traded a player for three weeks of good press, and the room saw how you'll handle the next losing streak.`,
      },
      {
        id: 'hold-the-line',
        label: `Tell him the plan doesn't change for a renewal window`,
        effects: { roomRespect: 8, roomMorale: 4, leakChance: 0.35 },
        outcome: `You told the man who signs your cheques no, in writing. Expect a columnist to hear there was friction.`,
      },
      {
        id: 'sell-the-kids',
        label: `Offer him the prospects story instead`,
        effects: { morale: -4, roomMorale: 2, promise: 'iceTime' },
        outcome: `You promised the owner young faces in the lineup, which means you've promised those kids ice time too.`,
      },
    ],
  },
  {
    id: 'ev.crease.goalie-controversy',
    conditions: { position: 'G', minImportance: 74, maxSavePct: 89 },
    weight: 3,
    headline: `The crease question reaches your office`,
    scene:
      `{last} is under .900 for the season, and your backup has been the better goalie for a month. ` +
      `{last} hasn't asked for a night off. The goalie coach says he's "stopped sleeping."`,
    options: [
      {
        id: 'ride-him',
        label: `He's the starter. He plays through it.`,
        effects: { morale: 4, roomMorale: -4, promise: 'iceTime', act: 'makeStarter' },
        outcome: `He's your starter, in public and on the lineup card. If the slide continues, any change now will look like panic.`,
      },
      {
        id: 'split',
        label: `Split the net until someone takes it`,
        effects: { morale: -8, roomMorale: 4, roomRespect: 4 },
        outcome: `You told a starting goalie he's in a competition. His agent will call before the week is out.`,
      },
      {
        id: 'bench-him',
        label: `Sit him. Let the backup run with it.`,
        effects: { morale: -14, roomMorale: 2, residue: 'wasScratched', leakChance: 0.45, act: 'benchStarter' },
        outcome: `A benched starter is a story by Tuesday. You'll know in a month whether you saved his season or ended his time here.`,
      },
    ],
  },
  {
    id: 'ev.prospect.rush-or-ripen',
    conditions: { maxAge: 20, minPotential: 82, inMinors: true },
    weight: 3,
    headline: `Your staff are split on {last}`,
    scene:
      `{last} is {age} and has nothing left to prove where he is. Your development staff want another half-season of ` +
      `big minutes in the minors. Your coach wants him tomorrow. His agent has started saying "clear runway."`,
    options: [
      {
        id: 'call-up',
        label: `Bring him up now, top-nine minutes`,
        effects: { morale: 10, roomMorale: -3, promise: 'iceTime', act: 'callUp' },
        outcome: `He's up, and you've promised him top-nine minutes. If he ends up in the press box, his camp will say you wasted a year of him.`,
      },
      {
        id: 'ripen',
        label: `Leave him down. He plays every situation there.`,
        effects: { morale: -8, roomRespect: 4 },
        outcome: `Right for his development, and he took it as a door that didn't open. His camp is counting the games.`,
      },
    ],
  },
  {
    id: 'ev.room.returning-face',
    conditions: { formerlyShopped: true, minImportance: 70 },
    weight: 5,
    headline: `{last} wants to talk about next year`,
    scene:
      `{last} asked for the meeting himself this time. He's played well since you shopped him, said nothing publicly, ` +
      `and wants to talk about next year while he still has leverage. "I'd like to stay. I'd like to know you want that too."`,
    options: [
      {
        id: 'commit',
        label: `Tell him plainly: you want him here`,
        effects: { morale: 14, roomRespect: 6, promise: 'newDeal' },
        outcome: `He'll hold you to the deal that conversation implied. Until it's signed, the room is watching whether your word survives a negotiation.`,
      },
      {
        id: 'noncommittal',
        label: `"Let's see where we are in the summer."`,
        effects: { morale: -10, residue: 'wasShopped', leakChance: 0.3 },
        outcome: `That's the second time he's heard he might be available. He'll take meetings this summer, and not only with you.`,
      },
      {
        id: 'honest-rebuild',
        label: `Be straight: the club is going younger`,
        effects: { morale: -6, roomRespect: 10, residue: 'wasShopped' },
        outcome: `He thanked you and meant it. Then he called his agent to start looking.`,
      },
    ],
  },
)

/* ── wave 3: the room's politics, the aging contract, the tanking question ── */

DECISION_EVENTS.push(
  {
    id: 'ev.room.dismissed-leader-returns',
    conditions: { formerlyDismissed: true, minImportance: 68 },
    weight: 5,
    headline: `{last} brings you a problem, again`,
    scene:
      `{last} hasn't brought you a room problem since the last time you waved him off. He's bringing you one now, and he ` +
      `opened with it: "I know how this went before. I'm telling you anyway, because somebody has to."`,
    options: [
      {
        id: 'listen-properly',
        label: `Hear him out fully this time`,
        effects: { morale: 12, roomMorale: 6, roomRespect: 8, promise: 'iceTime' },
        outcome: `You let him finish, and you acted on it. He'll come back next time. Probably.`,
      },
      {
        id: 'polite-nothing',
        label: `Thank him, do nothing`,
        effects: { morale: -8, roomMorale: -4, residue: 'wasDismissed' },
        outcome: `He won't be back a third time, and the room will hear why from him.`,
      },
      {
        id: 'own-it',
        label: `Admit you got it wrong last time`,
        effects: { morale: 10, roomRespect: 12, roomMorale: 4, leakChance: 0.25 },
        outcome: `GMs don't apologize often, and he knew it. If it gets out of the room, it'll be told as weakness by people who weren't there.`,
      },
    ],
  },
  {
    id: 'ev.contract.aging-vet-final-year',
    conditions: { minAge: 33, minGamesPlayed: 600, contractYearsRemaining: 1 },
    weight: 4,
    headline: `{last}, {age}, asks about his future`,
    scene:
      `{last} is {age}, in the last year of his deal, and asked you directly: "Do I finish here, or do I start ` +
      `making other plans? I'm not asking for a number today. I'm asking whether there's a conversation to have."`,
    options: [
      {
        id: 'finish-here',
        label: `"You finish here."`,
        effects: { morale: 16, roomMorale: 8, roomRespect: 6, promise: 'newDeal' },
        outcome: `You promised a {age}-year-old his last contract. If he slows down faster than you expect, you'll be choosing between your word and your cap sheet in public.`,
      },
      {
        id: 'earn-it',
        label: `"Play like you have been and we'll talk in March."`,
        effects: { morale: -4, roomRespect: 4, promise: 'iceTime' },
        outcome: `He heard the "if." He'll play the rest of the season like every game is a tryout.`,
      },
      {
        id: 'make-plans',
        label: `"Make other plans."`,
        effects: { morale: -16, roomMorale: -8, residue: 'wasShopped', leakChance: 0.4 },
        outcome: `He thanked you flatly and called his agent that night. The room will hear his version first.`,
      },
    ],
  },
  {
    id: 'ev.room.kid-takes-the-vets-minutes',
    conditions: { maxAge: 23, minPotential: 84, minRoomTension: 50 },
    weight: 4,
    headline: `Your coach wants {last} on PP1`,
    scene:
      `Your coach wants {last} on the top power-play unit. Those minutes belong to a veteran who's been ` +
      `here longer than you have, is playing fine, and will notice within one game.`,
    options: [
      {
        id: 'promote-kid',
        label: `Give the kid the minutes`,
        effects: { morale: 12, roomMorale: -6, roomRespect: -3, promise: 'iceTime', act: 'topPowerPlay' },
        outcome: `The right hockey call. You'll pay for it in the room, and you've promised the kid minutes you took from someone else.`,
      },
      {
        id: 'keep-vet',
        label: `Leave the unit alone`,
        effects: { morale: -10, roomMorale: 4, residue: 'wasScratched' },
        outcome: `Seniority held. The kid didn't argue. His agent started keeping track of his ice time.`,
      },
      {
        id: 'split-it',
        label: `Split the unit and let form decide`,
        effects: { morale: -4, roomMorale: -3, roomRespect: 5 },
        outcome: `Nobody's insulted and nobody's settled. Two players now share one job, and both know it.`,
      },
    ],
  },
  {
    id: 'ev.crease.backup-wants-a-job',
    conditions: { position: 'G', minGamesPlayed: 100, maxImportance: 74 },
    weight: 3,
    headline: `{last} wants a chance to start somewhere`,
    scene:
      `{last} asked for ten minutes and used three. "I'm {age}. I've been a good soldier here. Somewhere out ` +
      `there is a team that needs a starter, and I'd like your blessing to go find it before I'm too old to be one."`,
    options: [
      {
        id: 'help-him',
        label: `Promise to find him a landing spot`,
        effects: { morale: 14, roomRespect: 10, promise: 'exploreTrade' },
        outcome: `You agreed to trade a useful goalie for his sake, not yours. The room noticed. So will your depth chart in March.`,
      },
      {
        id: 'need-you',
        label: `"I need you here. We're not deep enough."`,
        effects: { morale: -10, roomMorale: 2, residue: 'wasDismissed' },
        outcome: `True, and he knows it, and it doesn't help. You kept a backup and cost him a year of trying to be a starter.`,
      },
    ],
  },
  {
    id: 'ev.media.the-tanking-question',
    conditions: { minLosingStreak: 6, minMediaHeat: 80 },
    weight: 5,
    headline: `"Are you trying to win?" {last} wants an answer`,
    scene:
      `The question came on the record, from a reporter who has covered this club for twenty years: "Are you trying to win ` +
      `these games?" You gave an answer. {last} read it on the bus, and now he's in your office holding his phone. ` +
      `"The guys want to know what that means. I told them I'd ask you instead of guessing."`,
    options: [
      {
        id: 'deny-hard',
        label: `"We try to win every night."`,
        effects: { roomMorale: 6, roomRespect: 4, promise: 'iceTime' },
        outcome: `Now the lineup card has to agree with it. Every kid scratched and every veteran sat will be quoted back to you.`,
      },
      {
        id: 'admit-rebuild',
        label: `Be honest about the rebuild`,
        effects: { roomMorale: -10, roomRespect: 8, leakChance: 0.7 },
        outcome: `You told a room of competitors that this year isn't for them. The fans got a straight answer. The players got one too.`,
      },
      {
        id: 'deflect',
        label: `Deflect to "process" and end the availability`,
        effects: { roomMorale: -4, roomRespect: -6, leakChance: 0.4 },
        outcome: `Nobody believed it. The players read the same non-answer the reporters did.`,
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
