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
}

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
  'formerlyDismissed',
  'deadlineWeek',
  'savePct',
  // Percent of the regular season played, 0–100. Gates any scene whose promised
  // action has its own calendar window — extension talks open at the halfway
  // mark, so the scene that sells an extension must not fire before it.
  'seasonPct',
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
    // minSeasonPct 50: extension talks are not legal before the turn of the
    // calendar year, and a scene must never offer an action the game refuses.
    conditions: { maxAge: 24, minImportance: 75, contractYearsRemaining: 1, minSeasonPct: 50 },
    weight: 3,
    speaker: 'agent',
    scene:
      `{last}'s agent floated something unusual: sign the extension NOW, a year early, below what he'll be worth ` +
      `if the season continues like this. "He likes it here. That discount has an expiry date, and it's June."`,
    options: [
      {
        id: 'sign-now',
        label: `Take the discount — open extension talks today`,
        effects: { morale: 8, promise: 'newDeal', roomRespect: 3, extensionDiscount: 0.87 },
        outcome:
          `His camp will hold the number until the season ends. Go to his profile and open extension talks — ` +
          `the deal starts next season, and it comes out of next season's cap, not this one. Let June arrive and the discount goes with it.`,
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
  {
    id: 'ev.goalie.pulled-again',
    conditions: { position: 'G', maxSavePct: 0.888, minGamesPlayed: 20 },
    weight: 2,
    scene:
      `{last} caught you in the hallway, still in his gear. "Third time this month you've pulled me. ` +
      `I can wear that — but I need to know if you're pulling the goalie or pulling ME."`,
    options: [
      {
        id: 'starter',
        label: `"You're my starter. I'll stop pulling you."`,
        effects: { morale: 12, promise: 'iceTime', roomRespect: -3 },
        outcome: `He straightened up. You have also just told your coach he can't make an in-game decision — and the room will notice the first night it costs you.`,
      },
      {
        id: 'earn-it',
        label: `"You're pulled when you're beaten. Same as anyone."`,
        effects: { morale: -6, roomRespect: 7 },
        outcome: `He didn't like it. Every skater who heard about it liked it a great deal — nobody gets a different rulebook.`,
      },
      {
        id: 'tandem',
        label: `"We're going to a tandem for a while."`,
        effects: { morale: -10, roomMorale: 3, leakChance: 0.3, residue: 'wasDemoted' },
        outcome: `Honest, defensible, and the end of his run as the guy. His camp will remember which season that started.`,
      },
    ],
  },
  {
    id: 'ev.media.trade-block-question',
    conditions: { formerlyShopped: true, minMediaHeat: 55 },
    weight: 3,
    speaker: 'press',
    scene:
      `The beat writer skips the warm-up. "We hear {name} was available. Is he in your plans, or is he a rental ` +
      `for somebody else?" The recorder is already running.`,
    options: [
      {
        id: 'deny',
        label: `"He's not going anywhere."`,
        effects: { morale: 8, promise: 'iceTime', roomRespect: -5, leakChance: 0.45 },
        outcome: `He'll read that tonight and believe it. So will every GM you were negotiating with — and one of them knows better.`,
      },
      {
        id: 'honest',
        label: `"I listen on everybody. That's the job."`,
        effects: { morale: -9, roomRespect: 8, residue: 'wasShopped' },
        outcome: `The room respects a GM who doesn't insult them. {last} still had to explain it to his kids.`,
      },
      {
        id: 'nocomment',
        label: `"I don't discuss internal conversations."`,
        effects: { morale: -4, roomMorale: -3, leakChance: 0.55 },
        outcome: `A non-answer is an answer. By morning somebody with better sourcing than you filled in the blank.`,
      },
    ],
  },
  {
    id: 'ev.injury.play-through-it',
    conditions: { nursingInjury: true, minImportance: 70 },
    weight: 3,
    scene:
      `The physio's report says {last} sits two weeks. {last} says he's playing. "It's a playoff race. ` +
      `I've played through worse and you know it."`,
    options: [
      {
        id: 'let-him',
        label: `Let him play — you need the points`,
        effects: { morale: 8, roomRespect: 5, roomMorale: -2 },
        outcome: `He dressed. Your medical staff logged their objection in writing, the way people do when they expect to be asked later.`,
      },
      {
        id: 'sit-him',
        label: `Sit him. The season is longer than one game.`,
        effects: { morale: -10, roomMorale: 4, promise: 'iceTime' },
        outcome: `He was furious, and he was protected. You now owe him the minutes when he's right again — he'll be counting.`,
      },
      {
        id: 'defer',
        label: `Leave it to the medical staff`,
        effects: { morale: -3, roomRespect: -6 },
        outcome: `You didn't decide, so somebody else did. The room noticed the man who signs the cheques didn't want his name on it.`,
      },
    ],
  },
  {
    id: 'ev.owner.streak-ultimatum',
    conditions: { minLosingStreak: 6, minMediaHeat: 60 },
    weight: 4,
    speaker: 'owner',
    scene:
      `The owner called at seven in the morning, which is never good. Six straight, and he named {name} twice ` +
      `without being asked. "I'm not telling you how to do your job — but I want to hear that somebody is ` +
      `accountable, and I want to hear it today."`,
    options: [
      {
        id: 'coach',
        label: `Put the coach on notice publicly`,
        effects: { roomMorale: -8, roomRespect: -6, leakChance: 0.6, residue: 'wasDismissed' },
        outcome: `The owner is satisfied. Your coach read it at the same moment the players did, and the room now knows how you handle pressure.`,
      },
      {
        id: 'own-it',
        label: `"It's on me. I built this roster."`,
        // Costs standing with the owner rather than the room, so it reads as a
        // real trade rather than the obviously-correct answer.
        effects: { roomMorale: 6, roomRespect: 10, leakChance: 0.35 },
        outcome: `You spent your own credit to buy the room some air. The quote ran by lunchtime, and there is a finite amount of that credit — the owner keeps a tally.`,
      },
      {
        id: 'shake',
        label: `Promise changes to the lineup`,
        effects: { roomMorale: -4, roomRespect: -2, promise: 'exploreTrade' },
        outcome: `You bought a week. Every player in that room spent the afternoon working out whether they were "changes".`,
      },
    ],
  },
  {
    id: 'ev.deadline.rental-honesty',
    conditions: { deadlineWeek: true, maxContractYearsRemaining: 1, minImportance: 60 },
    weight: 4,
    scene:
      `Two days out. {name} is on an expiring deal, playing the best hockey of his life, and he has just asked the ` +
      `only question that matters: "Am I finishing the year here?"`,
    options: [
      {
        id: 'commit',
        label: `"You finish it here. My word."`,
        effects: { morale: 14, promise: 'newDeal', roomRespect: 4 },
        outcome: `He believed you completely, which is the problem — you just took your best trade chip off the market with a sentence.`,
      },
      {
        id: 'honest',
        label: `"I can't promise that. You've earned honesty."`,
        effects: { morale: -7, roomRespect: 9, residue: 'wasShopped' },
        outcome: `He thanked you, which somehow made it worse. He played the next two nights like a man auditioning, because he was.`,
      },
      {
        id: 'dodge',
        label: `"Let's talk after the deadline."`,
        effects: { morale: -11, roomMorale: -4, leakChance: 0.4 },
        outcome: `Everyone in the room translated that instantly. So did he.`,
      },
    ],
  },
  {
    id: 'ev.minors.buried-veteran',
    conditions: { inMinors: true, minAge: 28, minGamesPlayed: 300 },
    weight: 2,
    scene:
      `Six weeks in the minors and he is too good for it. {name} isn't asking for a call-up. "Just release me. ` +
      `Let me go be useful somewhere. I'm not doing this for another year."`,
    options: [
      {
        id: 'recall',
        label: `Bring him up`,
        effects: { morale: 12, promise: 'iceTime', roomMorale: -4 },
        outcome: `A younger player just lost his spot to a man you'd written off. You'd better be right about the hockey.`,
      },
      {
        id: 'release',
        label: `Let him go, with thanks`,
        effects: { morale: 5, roomRespect: 7, residue: 'wasDismissed' },
        outcome: `You did the decent thing and lost the depth. Every veteran in your system heard this org lets a man leave with his dignity.`,
      },
      {
        id: 'keep',
        label: `"I need the insurance. You stay."`,
        effects: { morale: -14, roomRespect: -7, leakChance: 0.4 },
        outcome: `Legally airtight. He'll spend the season as the most expensive available reminder that you can be held somewhere you don't want to be.`,
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
      `The owner's office called before the tickets report even reached you. Attendance is sliding, the renewal window ` +
      `opens in three weeks, and he wants "something to announce." Not a plan — an announcement. He said one name ` +
      `unprompted: {last}. Twenty minutes later {last} is at your door, because somebody in that building talks.`,
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

/* ── wave 3: the room's politics, the aging contract, the tanking question ── */

DECISION_EVENTS.push(
  {
    id: 'ev.room.dismissed-leader-returns',
    conditions: { formerlyDismissed: true, minImportance: 68 },
    weight: 5,
    scene:
      `{last} has not brought you a room problem since the last time he did. He is bringing you one now, and he ` +
      `prefaced it: "I know how this went before. I'm telling you anyway, because somebody has to."`,
    options: [
      {
        id: 'listen-properly',
        label: `Hear him out fully this time`,
        effects: { morale: 12, roomMorale: 6, roomRespect: 8, promise: 'iceTime' },
        outcome: `You let him finish, and you acted on it. A man who was done bringing you things is, provisionally, not done. Provisionally.`,
      },
      {
        id: 'polite-nothing',
        label: `Thank him, do nothing`,
        effects: { morale: -8, roomMorale: -4, residue: 'wasDismissed' },
        outcome: `The second time is the one that sticks. He will not be back a third time, and the room will learn why from him rather than from you.`,
      },
      {
        id: 'own-it',
        label: `Admit you got it wrong last time`,
        effects: { morale: 10, roomRespect: 12, roomMorale: 4, leakChance: 0.25 },
        outcome: `An apology from a GM is currency precisely because it is rare. You have spent some. If this gets repeated outside the room, it reads as weakness to people who weren't in it.`,
      },
    ],
  },
  {
    id: 'ev.contract.aging-vet-final-year',
    conditions: { minAge: 33, minGamesPlayed: 600, contractYearsRemaining: 1 },
    weight: 4,
    scene:
      `{last} is {age}, in the last year of his deal, and asked the question directly: "Do I finish here, or do I start ` +
      `making other plans? I'm not asking for a number today. I'm asking whether there's a conversation to have."`,
    options: [
      {
        id: 'finish-here',
        label: `"You finish here."`,
        effects: { morale: 16, roomMorale: 8, roomRespect: 6, promise: 'newDeal' },
        outcome: `You promised a {age}-year-old his ending. If the decline comes faster than the sentiment, you will be choosing between your word and your cap sheet in public.`,
      },
      {
        id: 'earn-it',
        label: `"Play like you have been and we'll talk in March."`,
        effects: { morale: -4, roomRespect: 4, promise: 'iceTime' },
        outcome: `Honest and conditional — which he heard as conditional. He'll play the season auditioning, and everyone who watches him closely will notice.`,
      },
      {
        id: 'make-plans',
        label: `"Make other plans."`,
        effects: { morale: -16, roomMorale: -8, residue: 'wasShopped', leakChance: 0.4 },
        outcome: `Brutal, clean, and correct if the roster math says so. He thanked you flatly and told his agent that night. The room will hear his version.`,
      },
    ],
  },
  {
    id: 'ev.room.kid-takes-the-vets-minutes',
    conditions: { maxAge: 23, minPotential: 84, minRoomTension: 50 },
    weight: 4,
    scene:
      `Your coach wants {last} on the top power-play unit. Those minutes currently belong to a veteran who has been ` +
      `here longer than you have, is playing fine, and will notice within one game.`,
    options: [
      {
        id: 'promote-kid',
        label: `Give the kid the minutes`,
        effects: { morale: 12, roomMorale: -6, roomRespect: -3, promise: 'iceTime' },
        outcome: `The right hockey call, made at a cost you'll pay in the room rather than on the scoresheet. And you've now promised the kid what you took from someone else.`,
      },
      {
        id: 'keep-vet',
        label: `Leave the unit alone`,
        effects: { morale: -10, roomMorale: 4, residue: 'wasScratched' },
        outcome: `Seniority held. The kid did not argue, which is worse than arguing — he simply started counting, and his camp counts with him.`,
      },
      {
        id: 'split-it',
        label: `Split the unit and let form decide`,
        effects: { morale: -4, roomMorale: -3, roomRespect: 5 },
        outcome: `Nobody is insulted and nobody is settled. Competition is honest management and an uncomfortable month for two players who now share a job.`,
      },
    ],
  },
  {
    id: 'ev.crease.backup-wants-a-job',
    conditions: { position: 'G', minGamesPlayed: 100, maxImportance: 74 },
    weight: 3,
    scene:
      `{last} asked for ten minutes and used three. "I'm {age}. I've been a good soldier behind him here. Somewhere out ` +
      `there is a team that needs a starter, and I'd like your blessing to go find it before I'm too old to be one."`,
    options: [
      {
        id: 'help-him',
        label: `Promise to find him a landing spot`,
        effects: { morale: 14, roomRespect: 10, promise: 'exploreTrade' },
        outcome: `You agreed to trade a useful goaltender for his benefit rather than yours. The room noticed. So did your depth chart, which is now a problem for March.`,
      },
      {
        id: 'need-you',
        label: `"I need you here. We're not deep enough."`,
        effects: { morale: -10, roomMorale: 2, residue: 'wasDismissed' },
        outcome: `True, and he knows it's true, and it doesn't help. You bought a season of competent backup goaltending with a season of a man's ambition.`,
      },
    ],
  },
  {
    id: 'ev.media.the-tanking-question',
    conditions: { minLosingStreak: 6, minMediaHeat: 80 },
    weight: 5,
    scene:
      `The question came on the record, from someone who has covered this club for twenty years: "Are you trying to win ` +
      `these games?" You gave an answer. {last} read it on the bus, and he is now in your office holding his phone: ` +
      `"The guys want to know what that means. I told them I'd ask you instead of guessing."`,
    options: [
      {
        id: 'deny-hard',
        label: `"We try to win every night."`,
        effects: { roomMorale: 6, roomRespect: 4, promise: 'iceTime' },
        outcome: `The only sayable answer, and now the lineup card has to agree with it. Every young scratch and every veteran sitting becomes evidence against your own quote.`,
      },
      {
        id: 'admit-rebuild',
        label: `Be honest about the rebuild`,
        effects: { roomMorale: -10, roomRespect: 8, leakChance: 0.7 },
        outcome: `You told the truth to a room that would rather not compete under it. The fans get clarity, the players get confirmation that this year is not for them, and both remember who said it.`,
      },
      {
        id: 'deflect',
        label: `Deflect to "process" and end the availability`,
        effects: { roomMorale: -4, roomRespect: -6, leakChance: 0.4 },
        outcome: `Nobody believed it, including you. The column writes itself, and the room reads the same evasion the reporters did.`,
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
