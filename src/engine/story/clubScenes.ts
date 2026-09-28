/**
 * CLUB SCENES — the roleplay beats of running a whole organisation.
 *
 * Playtest 2026-08-26 §E1. The GM's year has moments that have nothing to do
 * with tonight's lineup: the call you make to a kid an hour after you draft
 * him, the first conversation with a player you just acquired, the decision
 * whether to fly out for your affiliate's playoff run the way Kyle Dubas does.
 * They were all missing.
 *
 * These reuse the decision-event model exactly — a character-driven situation,
 * options with real tradeoffs, effects that map to levers the engine already
 * has — but they are raised BY NAME at a specific moment rather than scanned
 * for. That is the only difference, and it is why they live in their own pool:
 * a scanned event needs conditions the runner populates; a summoned one does
 * not, and pretending otherwise would put dead conditions in the library.
 *
 * Pure data. The career layer summons them and applies the effects.
 */

import type { DecisionEvent } from './decisionEvents'

/* ────────────────────────── post-draft calls ────────────────────────── */

/**
 * The call to your first pick, made from the draft floor. What you say here is
 * a real commitment: promise him a look and the room will check whether he gets
 * one; tell him he is going back to junior and you have bought yourself a year
 * of patience at the cost of his.
 *
 * Slots: {name} {last} {age} {team} {pick}.
 */
export const DRAFT_CALL_EVENTS: DecisionEvent[] = [
  {
    id: 'ev.draft.first-pick-call',
    speaker: 'player',
    scene:
      `An hour after the pick, someone hands you a phone. {last} is still in the building somewhere, ` +
      `still wearing the sweater, and he has clearly been told to sound composed. ` +
      `"Thank you. Genuinely. I just — what do you want from me? Tell me what the year looks like and I'll go do it."`,
    options: [
      {
        id: 'camp-shot',
        label: `"Come to development camp and make us notice you."`,
        // No iceTime promise: a drafted junior cannot make the NHL roster out of
        // camp here (rights held, AHL at 20), so that promise could only break.
        effects: { morale: 12, roomRespect: -2 },
        outcome:
          `You told an eighteen-year-old that July is an audition. He believed you, which means development ` +
          `camp now has his name on it — and the staff will be asked, in front of him, what they saw.`,
      },
      {
        id: 'go-back',
        label: `"Go back to junior. Dominate it. We'll be watching."`,
        effects: { morale: -4, roomRespect: 4 },
        outcome:
          `Honest, unglamorous, and the right answer more often than not. He heard "not yet", and the next ` +
          `time you call him he will want a reason that is better than the last one.`,
      },
      {
        id: 'no-promises',
        label: `"I don't make promises to players I've never coached."`,
        effects: { morale: -10, roomRespect: 8, residue: 'wasDismissed' },
        outcome:
          `A cold thing to say to a kid on the best day of his life, and a policy the whole room will hear about ` +
          `by Tuesday. Nobody in your organisation will ever accuse you of selling something you can't deliver.`,
      },
    ],
  },
  {
    id: 'ev.draft.slid-to-us-call',
    speaker: 'player',
    scene:
      `{last} went later than anyone had him, and by the time you called his name the cameras had stopped ` +
      `pointing at him. On the phone he is not composed at all. ` +
      `"Everyone had a reason. Nobody told me the reason. Do you know what it is?"`,
    options: [
      {
        id: 'tell-him',
        label: `Tell him exactly what the reports said`,
        // No iceTime promise: he is a drafted junior who cannot dress for you
        // this season, so the ledger could only ever record it as broken.
        effects: { morale: -8, roomRespect: 7 },
        outcome:
          `You read him his own scouting file. It was not kind and it was not wrong, and he now knows precisely ` +
          `what he has to disprove — to you, in writing, this season.`,
      },
      {
        id: 'chip',
        label: `"I don't care what it was. Play like it still bothers you."`,
        effects: { morale: 10, roomMorale: 2, roomRespect: -3, leakChance: 0.25 },
        outcome:
          `He will carry it. Your development staff would rather you had coached him than motivated him, and a ` +
          `general manager telling a teenager to play angry is the kind of line that gets repeated.`,
      },
      {
        id: 'brush-off',
        label: `"Don't worry about it. Get some sleep."`,
        effects: { morale: -3, roomRespect: -4, residue: 'wasDismissed' },
        outcome:
          `You had one moment to say something that mattered to him and you filled it with nothing. ` +
          `He will remember the length of the call more than the words.`,
      },
    ],
  },
]

/* ────────────────────────── the arrival meeting ────────────────────────── */

/**
 * The first meeting with a player you have just acquired. He wants to know what
 * he is here to do — and the honest version of this conversation is one you can
 * also have BEFORE you sign him, at the negotiation table (see roleTalk.ts).
 *
 * Slots: {name} {last} {age} {team} {via}.
 */
export const ARRIVAL_EVENTS: DecisionEvent[] = [
  {
    id: 'ev.arrival.role-and-wants',
    speaker: 'player',
    scene:
      `{last} came in the morning after the paperwork cleared, still living out of a hotel. ` +
      `"I've been somewhere I was a fourth option and somewhere I was the guy, and the second one was easier ` +
      `even when it was harder. So — which am I here? Say it plainly and I'll be fine with either."`,
    options: [
      {
        id: 'top-role',
        label: `"You're a top-six player here. I'll deploy you like one."`,
        effects: { morale: 12, promise: 'iceTime', roomRespect: -3 },
        outcome:
          `He relaxed for the first time since the trade call. That sentence is now a commitment the lineup card ` +
          `has to honour, and the men currently in those minutes did not get a vote.`,
      },
      {
        id: 'earn-it',
        label: `"You're here to compete for it. Nothing is handed out."`,
        effects: { morale: -2, roomRespect: 6 },
        outcome:
          `Unromantic and defensible. He knows the terms, the room hears that nobody arrives with minutes ` +
          `pre-paid, and if he wins the job nobody can call it a gift.`,
      },
      {
        id: 'specific-job',
        label: `Give him a specific job — kill penalties, play hard minutes`,
        effects: { morale: 6, roomRespect: 4, roomMorale: -3, promise: 'iceTime' },
        outcome:
          `A defined role is worth more to some players than a bigger vague one. He left knowing exactly what ` +
          `"a good night" means here — and so did the man who has been doing that job all season.`,
      },
    ],
  },
]

/* ────────────────────────── the affiliate's run ────────────────────────── */

/**
 * The Dubas beat: your farm club is deep in its own playoffs, and you can be in
 * the building or you can be at your desk. Neither is free.
 *
 * Slots: {team} {ahl} {round} {name} {last}.
 */
export const FARM_TRIP_EVENTS: DecisionEvent[] = [
  {
    id: 'ev.farm.playoff-trip',
    speaker: 'agent',
    scene:
      `Your director of player development called about the {ahl}. They are through to {round}, and the group ` +
      `down there is largely the group you are counting on in three years. ` +
      `"You should be here. Not for them — for you. You cannot draft your way out of not knowing your own players."`,
    options: [
      {
        id: 'go',
        label: `Go. Watch the run in person.`,
        effects: { roomRespect: 3, promise: 'iceTime' },
        outcome:
          `You spent the week in a half-full building watching nineteen-year-olds play the biggest games of their ` +
          `lives. You now have opinions about them that no report could have given you — and the ones who ` +
          `played well know you saw it.`,
      },
      {
        id: 'send-agm',
        label: `Send the AGM and read the reports`,
        effects: { roomRespect: -1 },
        outcome:
          `The sensible allocation of a general manager's week. The reports were good. They are still reports.`,
      },
      {
        id: 'stay',
        label: `Stay at your desk. The NHL club is the job.`,
        effects: { roomRespect: -4, residue: 'wasDismissed' },
        outcome:
          `Defensible, and the development staff have now learned exactly where the farm sits on your list. ` +
          `They will keep telling you about these players. You will keep hearing it secondhand.`,
      },
    ],
  },
]

/* ────────────────────────── the race decided ────────────────────────── */

/**
 * THE WEEK: the night the standings stop being a question. Clinch or
 * elimination, the captain is at your door, and what you tell the room sets
 * the tone for every game left. Raised once a season, by name, the day the
 * math is settled.
 *
 * Slots: {name} {last} {team}.
 */
export const RACE_EVENTS: DecisionEvent[] = [
  {
    id: 'ev.race.clinched',
    speaker: 'player',
    scene:
      `The dressing room is loud behind him when {last} leans into your office. The spot is clinched and the ` +
      `captain wants to know what the room hears from you before it hears it from the press. ` +
      `"Guys want to enjoy this one. I want to know what we're doing with the rest of the month."`,
    options: [
      {
        id: 'enjoy-it',
        label: `"Enjoy tonight. Tomorrow we get back to work."`,
        effects: { roomMorale: 6, roomRespect: -1 },
        outcome:
          `The room took the night and the room will remember you gave it to them. A couple of the veterans ` +
          `wondered aloud whether a clinch is really the thing to celebrate. That is their job.`,
      },
      {
        id: 'no-banners',
        label: `"Nobody hangs a banner for making the playoffs."`,
        effects: { roomRespect: 5, roomMorale: -3 },
        outcome:
          `{last} nodded like a man who had been hoping you would say it. The music got quieter. The standard ` +
          `in that room is now higher than the standings, which is either exactly right or a long April.`,
      },
      {
        id: 'promise-rest',
        label: `"The top guys get their minutes managed down the stretch."`,
        effects: { morale: 4, promise: 'iceTime', roomMorale: 2 },
        outcome:
          `A promise the lineup card has to keep: {last} will tell the others, and they will count their ` +
          `minutes against it. Done right, the club arrives in the playoffs with legs.`,
      },
    ],
  },
  {
    id: 'ev.race.eliminated',
    speaker: 'player',
    scene:
      `It went official tonight: the playoffs are gone for {team}. {last} stays behind after the others have ` +
      `left and sits down without being asked. "There are games left. I need to know what they're for, ` +
      `because I have to walk back in there and tell them."`,
    options: [
      {
        id: 'pride',
        label: `"We play every one of them like it matters. It does."`,
        effects: { roomRespect: 5, morale: -2 },
        outcome:
          `The honest answer, and a demanding one. Nobody in that room gets to coast, including the men who ` +
          `already know they are not coming back. {last} took it in without a word.`,
      },
      {
        id: 'kids',
        label: `"This is where we find out about the young players."`,
        effects: { roomMorale: -3, promise: 'iceTime' },
        outcome:
          `The veterans heard the part you did not say. The kids will read every lineup card from here to the ` +
          `end of the season, looking for the minutes you just promised them.`,
      },
      {
        id: 'own-it',
        label: `"That's on me. The roster wasn't good enough."`,
        effects: { roomMorale: 4, roomRespect: 3, leakChance: 0.35 },
        outcome:
          `The captain did not expect the GM to take it. The room will like you more for it, and if it reaches ` +
          `the press, the owner will read it too.`,
      },
    ],
  },
]

/* ────────────────────────── the code ────────────────────────── */

/**
 * The night before the rematch with the club whose man hurt one of yours.
 * The room's toughest player is at your door, and the room wants to know
 * whether the GM wants it answered. Answering is real: the game is played at
 * grudge-match heat (more penalties, a fight more likely). Raised once, by
 * name, the day before the rematch.
 *
 * Slots: {name} {last} {team} {hitter} {victim} {opp}.
 */
export const CODE_EVENTS: DecisionEvent[] = [
  {
    id: 'ev.code.rematch',
    speaker: 'player',
    scene:
      `{last} doesn't sit down. "The {opp} are in tomorrow. {hitter} is dressing, and {victim} is still in the ` +
      `treatment room from that hit. The guys want to know where you stand before they decide where they stand."`,
    options: [
      {
        id: 'answer-it',
        label: `"Nobody does that to one of ours for free."`,
        effects: { roomMorale: 5, roomRespect: 3, leakChance: 0.3 },
        outcome:
          `The room heard what it wanted to hear. Tomorrow is played hot: more whistles, a fight likely, and a ` +
          `penalty kill that had better be ready. If it leaks, the league will be watching the tape too.`,
      },
      {
        id: 'scoreboard',
        label: `"We answer it on the scoreboard. Power play, not the penalty box."`,
        effects: { roomRespect: 2, roomMorale: -2 },
        outcome:
          `The disciplined answer, and the coaches will love it. A few of the older players think the message ` +
          `was the wrong one, and {last} will be watching to see whether you meant it when the first cheap shot comes.`,
      },
      {
        id: 'league',
        label: `"The league has the tape. Let Player Safety handle it."`,
        effects: { roomMorale: -4, roomRespect: -2, residue: 'wasDismissed' },
        outcome:
          `Correct on paper and cold in the room. {last} nodded and left. Nobody will do anything stupid ` +
          `tomorrow, and nobody will forget that you asked them not to.`,
      },
    ],
  },
]

/** Every summoned scene, for lookup by id when a response comes back. */
export const CLUB_SCENES: DecisionEvent[] = [
  ...DRAFT_CALL_EVENTS,
  ...ARRIVAL_EVENTS,
  ...FARM_TRIP_EVENTS,
  ...RACE_EVENTS,
  ...CODE_EVENTS,
]
