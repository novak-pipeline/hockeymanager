/**
 * Trade-talk dialogue — what a rival GM SAYS on the phone, round by round.
 *
 * The bug this fixes: every trade call drew from one of two fixed templates, so
 * a third-round counter introduced the player as though the phone had just been
 * picked up. A negotiation is a SEQUENCE with memory — what he says on the
 * second call depends on what you refused, what he moved on, how far apart you
 * still are, and how much patience he has left.
 *
 * Model: the project's authored-content model (docs/EXCELLENCE.md §4,
 * docs/NARRATIVE-ENGINE.md) — hand-written variant pools, MOST-SPECIFIC-wins
 * selection over a state ctx, a per-save no-repeat ledger, seeded tie-breaks.
 * The numbers stay the engine's (evaluateProposal owns every value); this layer
 * only chooses the voice (docs/LLM-PERSONALITY-LAYER.md).
 *
 * EVERY line here is SPOKEN aloud by the living phone. First person, no speaker
 * prefix, no third-person narration — it has to work in the ear, not just on
 * the card.
 */
import type { Rng } from '@engine/shared/rng'
import {
  markUsed,
  renderTemplate,
  selectVariant,
  type ContentCtx,
  type ContentUse,
  type ContentVariant,
} from './contentEngine'

/* ────────────────────────────── model ────────────────────────────── */

/** Where in the arc this line sits. */
export type TalkBeat =
  | 'pitch'
  | 'counter'
  | 'final'
  | 'walk'
  | 'cooloff'
  | 'gauge'
  | 'lapse'
  | 'shortfall'

/** How his ask moved since the last round — the axis the old dialogue lacked. */
export type Movement = 'opening' | 'conceded' | 'held' | 'hardened'

/** How far apart the two sides still are, relative to what is being chased. */
export type GapBand = 'slim' | 'real' | 'wide'

/** Voice archetype, derived from the existing GmPersona axes (LW2). */
export type TalkPersona = 'shark' | 'stone' | 'straight'

/** Named slots every template may reference. All are always filled. */
export interface TalkSlots {
  /** The name at the centre of the call — the player being chased. */
  target: string
  /** What he wants added to get to yes ("Ruiz and your 2027 second"). */
  ask: string
  /** What he is putting on the table (pitch beat). */
  package: string
  /** The hole he is trying to fill ("blue line"). */
  need: string
  team: string
  /** How far short the package is, as the ENGINE measured it ("27%"). The
   *  number is never the dialogue layer's to invent — only to wrap. */
  short: string
}

export interface TalkCtx extends ContentCtx {
  beat: TalkBeat
  /** 1-based round of THIS thread. */
  round: number
  persona: TalkPersona
  moved: Movement
  gap: GapBand
  /** Times he has lowered his ask in this thread. */
  concessions: number
  /** Rounds where the package that came back was not actually any better. */
  stalls: number
  rapport: 'warm' | 'neutral' | 'frosty'
  /** Within a week of the deadline. */
  deadline: boolean
  /** The user is chasing this club's best player. */
  chasingCore: boolean
  /** Gauge beat only — the non-binding read. */
  lean: 'warm' | 'tepid' | 'cool' | 'none'
}

/* ─────────────────────────── the pools ───────────────────────────
 * Conditions are read by the content engine: `minRound: 2` matches
 * ctx.round >= 2, `maxX` a ceiling, everything else strict equality. The
 * count of conditions IS the specificity — a bare variant only fires when
 * nothing sharper is eligible.
 */

/** He calls YOU. Round one, and it should sound like the start of a call. */
const PITCH: ContentVariant[] = [
  {
    id: 'tt.pitch.plain',
    text: "I'll keep this short — we want {target}. What I can send back is {package}. That's a real offer, not a feeler.",
  },
  {
    id: 'tt.pitch.plain2',
    text: "We've got a hole and you've got the man who fills it. {target}, for {package}. Tell me what's wrong with it.",
  },
  {
    id: 'tt.pitch.need',
    text: 'Our {need} has been the thing keeping me up since October. {target} fixes it. I will give you {package} for the privilege.',
  },
  {
    id: 'tt.pitch.plain3',
    text: "It's about {target}. I'd have called sooner, but I wanted something worth saying first — {package}.",
  },
  {
    id: 'tt.pitch.plain4',
    text: "I'm going to say a name, you're going to tell me to get lost, and then we'll talk properly. {target}. {package}.",
  },
  {
    id: 'tt.pitch.plain5',
    text: '{target}. That is the call. {package} is what I have for you, and I have already had it argued at me internally, so it is real.',
  },
  {
    id: 'tt.pitch.plain6',
    text: "Two minutes of your day. We want {target}, we'll send {package}, and if the answer is no then I'll take a no.",
  },
  {
    id: 'tt.pitch.plain7',
    text: "I've been circling {target} since camp. {package}. Tell me that isn't a fair place to start.",
  },
  {
    id: 'tt.pitch.plain8',
    text: "You've got depth where we've got a {need} problem. {target} solves it. Coming back to you: {package}.",
  },
  {
    id: 'tt.pitch.plain9',
    text: "Here's the ask: {target}. And here's the answer to your next question: {package}.",
  },
  {
    id: 'tt.pitch.shark2',
    conditions: { persona: 'shark' },
    text: "I don't make exploratory calls. {target}, {package}, and I'd rather know today than Thursday.",
  },
  {
    id: 'tt.pitch.stone2',
    conditions: { persona: 'stone' },
    text: "I'll only ask the once, so hear it properly. {target}. {package}. Take your time with it.",
  },
  {
    id: 'tt.pitch.straight2',
    conditions: { persona: 'straight' },
    text: "This is a straight offer with nothing behind it. {target} for {package}. If it isn't enough, tell me what is.",
  },
  {
    id: 'tt.pitch.shark',
    conditions: { persona: 'shark' },
    text: "Straight to it. {target}. I'm not going to pretend I called about anything else. {package}, and I'd like an answer this week.",
  },
  {
    id: 'tt.pitch.stone',
    conditions: { persona: 'stone' },
    text: "No rush on this one, but I'd be doing my job badly if I didn't ask about {target}. {package} is where I'd start. Sleep on it.",
  },
  {
    id: 'tt.pitch.straight',
    conditions: { persona: 'straight' },
    text: "My people have had {target} at the top of a list since the summer. {package} is what that list says he's worth. I'd rather open there than spend two weeks getting there.",
  },
  {
    id: 'tt.pitch.deadline',
    conditions: { deadline: true },
    text: "You've got what, forty-eight hours, same as the rest of us. {target}. {package}. I don't have time to dance and neither do you.",
  },
  {
    id: 'tt.pitch.shark.deadline',
    conditions: { persona: 'shark', deadline: true },
    text: "I've made this call to four clubs today and you're the one I actually want to hear back from. {target}. Back the other way: {package}. Clock's running.",
  },
  {
    id: 'tt.pitch.core',
    conditions: { chasingCore: true },
    text: "I know exactly what I'm asking for. {target} isn't a man you give up lightly — that's why I'm not lowballing you. {package}, and I'll wear the reaction at home.",
  },
  {
    id: 'tt.pitch.warm',
    conditions: { rapport: 'warm' },
    text: "You and I have done business before and it's always been clean, so I'll be clean now. {target}. {package}. No games in it.",
  },
  {
    id: 'tt.pitch.frosty',
    conditions: { rapport: 'frosty' },
    text: "I'll assume you've still got my name filed somewhere unpleasant. Doesn't matter. {target}. {package}. Business is business.",
  },
  {
    id: 'tt.pitch.stone.build',
    conditions: { persona: 'stone', chasingCore: false },
    text: "We're not in a hurry to be good, but {target} is the sort of player you build a {need} around. {package}. If it's a no, tell me now and I'll stop calling.",
  },
]

/** He counters your package. The heart of it — round, movement and gap. */
const COUNTER: ContentVariant[] = [
  /* Round one — he is answering the first thing you sent. */
  {
    id: 'tt.co.r1.wide.shark',
    conditions: { moved: 'opening', gap: 'wide', persona: 'shark' },
    text: "That's not an offer, that's an opening bid at an auction I'm not attending. If {target} is leaving here, {ask} comes back. Start there.",
  },
  {
    id: 'tt.co.r1.wide.straight',
    conditions: { moved: 'opening', gap: 'wide', persona: 'straight' },
    text: "I appreciate you sending something real, but you're a long way off. {ask}. That isn't a haggling number, that's the number.",
  },
  {
    id: 'tt.co.r1.wide.stone',
    conditions: { moved: 'opening', gap: 'wide', persona: 'stone' },
    text: "I'll say it plainly so we don't waste a fortnight. {ask}. Anything under that and I'd rather keep him and answer for it.",
  },
  {
    id: 'tt.co.r1.real.straight',
    conditions: { moved: 'opening', gap: 'real', persona: 'straight' },
    text: "The shape of it is fine. The weight isn't. Add {ask} and I'll put it in front of my staff tonight.",
  },
  {
    id: 'tt.co.r1.real.shark',
    conditions: { moved: 'opening', gap: 'real', persona: 'shark' },
    text: "Close enough that I didn't hang up. {ask}, and I'll say yes before you finish the sentence.",
  },
  {
    id: 'tt.co.r1.real.stone',
    conditions: { moved: 'opening', gap: 'real', persona: 'stone' },
    text: "You're in the right neighbourhood, wrong house. {ask} gets you onto the doorstep.",
  },
  {
    id: 'tt.co.r1.slim',
    conditions: { moved: 'opening', gap: 'slim' },
    text: "You're one piece short, and I think you already know which one. {ask}. Then we shake.",
  },
  {
    id: 'tt.co.r1.slim.shark',
    conditions: { moved: 'opening', gap: 'slim', persona: 'shark' },
    text: "Don't make me pull teeth over the last yard. {ask}, and {target} is on a plane tonight.",
  },
  {
    id: 'tt.co.r1.core',
    conditions: { moved: 'opening', chasingCore: true },
    text: "You went straight to the top of my roster. I respect the nerve. But the price for the best player I've got is {ask}, and I'm not apologising for it.",
  },
  {
    id: 'tt.co.r1.plain',
    conditions: { moved: 'opening' },
    text: "Not as it stands. {ask} on top of what you've sent, and then we've got something to talk about.",
  },

  {
    id: 'tt.co.r1.plain2',
    conditions: { moved: 'opening' },
    text: "Not yet. {ask}, and you'd have my attention properly.",
  },
  {
    id: 'tt.co.r1.plain3',
    conditions: { moved: 'opening' },
    text: "You're short, and you know you're short. {ask} closes it.",
  },
  {
    id: 'tt.co.r1.plain4',
    conditions: { moved: 'opening' },
    text: 'I like the idea rather more than the offer. {ask}, and the idea becomes a deal.',
  },
  {
    id: 'tt.co.r1.plain5',
    conditions: { moved: 'opening' },
    text: 'That gets me a conversation, not a trade. {ask} gets me a trade.',
  },
  {
    id: 'tt.co.r1.plain6',
    conditions: { moved: 'opening' },
    text: "I'd want {ask} on top before I'd even carry this upstairs.",
  },
  {
    id: 'tt.co.r1.plain7',
    conditions: { moved: 'opening' },
    text: "There's a version of this I say yes to, and it has {ask} in it.",
  },
  /* He CONCEDED — and it has to sound like a concession. */
  {
    id: 'tt.co.conc.plain',
    conditions: { moved: 'conceded' },
    text: "You didn't like the first one, so here's me moving. {ask}. That's less than what I asked you for last time — I checked before I dialled.",
  },
  {
    id: 'tt.co.conc.plain2',
    conditions: { moved: 'conceded' },
    text: "I went home and looked at it your way, which I don't do often. I've come down. {ask}, and we can both stop doing this.",
  },
  {
    id: 'tt.co.conc.shark',
    conditions: { moved: 'conceded', persona: 'shark', maxConcessions: 1 },
    text: "I've come off my number. {ask}. Don't make me regret being reasonable in front of my own staff.",
  },
  {
    id: 'tt.co.conc.stone',
    conditions: { moved: 'conceded', persona: 'stone' },
    text: "I said I'd think on it and I did. {ask} instead of what I asked for. That's your move now, and I'd make it soon.",
  },
  {
    id: 'tt.co.conc.straight',
    conditions: { moved: 'conceded', persona: 'straight' },
    text: "Here's where I've got to. I've taken a piece off the ask. {ask}, and it's done. I'd rather land this than win it.",
  },
  {
    id: 'tt.co.conc.twice',
    conditions: { moved: 'conceded', minConcessions: 2 },
    text: "I've come down twice now. I'm not coming down a third time. {ask}. That's the floor, and floors don't move.",
  },
  {
    id: 'tt.co.conc.deadline',
    conditions: { moved: 'conceded', deadline: true },
    text: "I'm shaving my own ask with hours left because I want the player, not the argument. {ask}. Take it before somebody senior tells me not to.",
  },

  {
    id: 'tt.co.conc.plain3',
    conditions: { moved: 'conceded' },
    text: "I've had a think and I've trimmed it. {ask}. That's me being the reasonable one for once.",
  },
  {
    id: 'tt.co.conc.plain4',
    conditions: { moved: 'conceded' },
    text: 'You pushed, I moved. Not far, but I moved. {ask}.',
  },
  {
    id: 'tt.co.conc.plain5',
    conditions: { moved: 'conceded' },
    text: "I'll take less than I asked you for last time. {ask}. Don't make me explain why.",
  },
  {
    id: 'tt.co.conc.plain6',
    conditions: { moved: 'conceded' },
    text: "Fine — {ask}, and that's a piece lighter than where I started. Your turn now.",
  },
  {
    id: 'tt.co.conc.plain7',
    conditions: { moved: 'conceded' },
    text: "I've knocked something off it. {ask}. I'd like that noticed.",
  },
  /* He HELD — a man repeating himself deliberately. */
  {
    id: 'tt.co.held.plain',
    conditions: { moved: 'held' },
    text: "Nothing's changed since we last spoke. {ask}. Same as it was.",
  },
  {
    id: 'tt.co.held.plain2',
    conditions: { moved: 'held' },
    text: "You've sent me the same deal wearing a different coat. So I'll say it again, slower. {ask}.",
  },
  {
    id: 'tt.co.held.shark',
    conditions: { moved: 'held', persona: 'shark' },
    text: "I'm going to repeat myself exactly once, and then I'm going to stop picking up. {ask}.",
  },
  {
    id: 'tt.co.held.stone',
    conditions: { moved: 'held', persona: 'stone' },
    text: "I don't mind waiting. He's under contract and you've still got the hole. {ask}, whenever you're ready.",
  },
  {
    id: 'tt.co.held.r3',
    conditions: { moved: 'held', minRound: 3 },
    text: "Three calls, and neither of us has said anything new on any of them. {ask}. If that isn't happening, say so and we'll both get our afternoons back.",
  },
  {
    id: 'tt.co.held.stall',
    conditions: { moved: 'held', minStalls: 2 },
    text: "You keep sending me the same weight in different shapes. It's still the same weight. {ask}.",
  },

  {
    id: 'tt.co.held.plain3',
    conditions: { moved: 'held' },
    text: 'Same answer, same reason as I gave you last time. {ask}.',
  },
  {
    id: 'tt.co.held.plain4',
    conditions: { moved: 'held' },
    text: "I haven't moved, and I'm not going to today. {ask}.",
  },
  {
    id: 'tt.co.held.plain5',
    conditions: { moved: 'held' },
    text: "You've heard this from me already. {ask}. It didn't change overnight.",
  },
  {
    id: 'tt.co.held.plain6',
    conditions: { moved: 'held' },
    text: 'My number is my number. {ask}.',
  },
  {
    id: 'tt.co.held.plain7',
    conditions: { moved: 'held' },
    text: "I'll be exactly as boring as I was last week. {ask}, and then we're done talking about it.",
  },
  /* He HARDENED — you made your own offer worse. */
  {
    id: 'tt.co.hard.plain',
    conditions: { moved: 'hardened' },
    text: 'You took something off the table. That is a new one on me. The price went the other way — {ask}.',
  },
  {
    id: 'tt.co.hard.shark',
    conditions: { moved: 'hardened', persona: 'shark' },
    text: "You just made your own offer worse and waited for me to thank you. It's {ask} now, and it goes up again if you try that twice.",
  },
  {
    id: 'tt.co.hard.straight',
    conditions: { moved: 'hardened', persona: 'straight' },
    text: "This one's further away than the last one. I don't know whether that's a tactic, but it isn't working. {ask}.",
  },
  {
    id: 'tt.co.hard.stone',
    conditions: { moved: 'hardened', persona: 'stone' },
    text: "I'd assumed we were converging. Apparently not. Back to {ask}, and I'll wait.",
  },
  {
    id: 'tt.co.hard.plain2',
    conditions: { moved: 'hardened' },
    text: "That's gone backwards. {ask}, and I'm being generous saying it this calmly.",
  },
  {
    id: 'tt.co.hard.plain3',
    conditions: { moved: 'hardened' },
    text: 'Whatever you were trying there, it cost you. {ask}.',
  },
  {
    id: 'tt.co.hard.plain4',
    conditions: { moved: 'hardened' },
    text: "You've taken value off and left the ask where it was. It's {ask} now.",
  },
  {
    id: 'tt.co.hard.plain5',
    conditions: { moved: 'hardened' },
    text: 'I was closer to yes an hour ago than I am now. {ask}.',
  },
]

/** The last offer before he is gone. Register changes: shorter, flatter. */
const FINAL: ContentVariant[] = [
  {
    id: 'tt.fin.plain',
    text: "Last one from me. {ask}. I'm not spending another week of my season on this — give me a yes or a no.",
  },
  {
    id: 'tt.fin.plain2',
    text: "This is the end of my rope, said politely. {ask}. After that I've done what I can.",
  },
  {
    id: 'tt.fin.plain3',
    text: "That is my last number. {ask}. I've got nothing after it.",
  },
  {
    id: 'tt.fin.plain4',
    text: "Right — {ask}, and I'd like that to be the last time either of us says it.",
  },
  {
    id: 'tt.fin.plain5',
    text: "I'll leave it at {ask}. Take it or don't, but decide.",
  },
  {
    id: 'tt.fin.plain6',
    text: "One more time, and then I'm done: {ask}.",
  },
  {
    id: 'tt.fin.plain7',
    text: "{ask}. I'm not going to improve on that, and I'd rather not pretend I might.",
  },
  {
    id: 'tt.fin.shark',
    conditions: { persona: 'shark' },
    text: 'Final. {ask}. After this I stop answering, and I mean that in the friendliest way available to me.',
  },
  {
    id: 'tt.fin.stone',
    conditions: { persona: 'stone' },
    text: "This is where I stop. {ask}. I've been patient because that's how I work — patient isn't the same as unlimited.",
  },
  {
    id: 'tt.fin.straight',
    conditions: { persona: 'straight' },
    text: "I'll put it once more and then I'm out of it. {ask}. You know it's fair, and I know you know.",
  },
  {
    id: 'tt.fin.conceded',
    conditions: { minConcessions: 1 },
    text: "I've moved for you. You haven't moved for me. So — {ask}, final, and then I'm going to go be useful somewhere else.",
  },
  {
    id: 'tt.fin.deadline',
    conditions: { deadline: true },
    text: "There's four hours left and I've got three calls holding. {ask}. Yes or no, right now.",
  },
  {
    id: 'tt.fin.core',
    conditions: { chasingCore: true },
    text: "You're asking for the best player in my building and I've let you ask five times. {ask}. That's the last version of this sentence.",
  },
]

/** He walks. It has to feel like he meant it. */
const WALK: ContentVariant[] = [
  {
    id: 'tt.walk.plain',
    text: "We're done. Not angry — done. I've got a room to build and you've got whatever this has been. If something changes on your end, call me. Not before.",
  },
  {
    id: 'tt.walk.plain2',
    text: "I'm going to stop here before it gets silly. He stays, you keep your pieces, and we both pretend this was productive.",
  },
  {
    id: 'tt.walk.plain3',
    text: "That's me finished with it. No hard feelings, but don't call about him again this month.",
  },
  {
    id: 'tt.walk.plain4',
    text: "I've spent more time on this than it's worth to either of us. It's off.",
  },
  {
    id: 'tt.walk.plain5',
    text: "We're not getting there and we both know it. I'll stop wasting your afternoon.",
  },
  {
    id: 'tt.walk.plain6',
    text: "Right. He's staying. That's the end of the conversation, and I'd rather end it cleanly than badly.",
  },
  {
    id: 'tt.walk.plain7',
    text: "I'm pulling him. Not to make a point — because I've stopped believing you'll pay for him.",
  },
  {
    id: 'tt.walk.shark',
    conditions: { persona: 'shark' },
    text: "I'm out. You had a fair number in front of you three times and you wanted to negotiate the negotiating. Good luck finding him somewhere else.",
  },
  {
    id: 'tt.walk.stone',
    conditions: { persona: 'stone' },
    text: "I'll leave it there. He's mine, he's happy, and I sleep fine. Come and find me in July if you're still short.",
  },
  {
    id: 'tt.walk.straight',
    conditions: { persona: 'straight' },
    text: "I don't think we're getting there, and I'd rather say that than keep taking your calls under false pretences. It's a no.",
  },
  {
    id: 'tt.walk.conceded',
    conditions: { minConcessions: 2 },
    text: "I came down twice and you didn't come up once. That tells me how this ends, so I'm ending it early and keeping the afternoon.",
  },
  {
    id: 'tt.walk.deadline',
    conditions: { deadline: true },
    text: "The clock beat us. That's fine, it beats most deals. He stays, you stay short, and neither of us gets to complain about it afterwards.",
  },
  {
    id: 'tt.walk.frosty',
    conditions: { rapport: 'frosty' },
    text: "You know what — keep him. Or don't. It's genuinely stopped being my problem either way.",
  },
  {
    id: 'tt.walk.warm',
    conditions: { rapport: 'warm' },
    text: "I like you, and that's exactly why I'm hanging up before one of us says the thing that costs us the next deal. We're not getting there.",
  },
  {
    id: 'tt.walk.long',
    conditions: { minRound: 5 },
    text: "Five calls. Five. I've hired assistant coaches faster than this. It's a no, and it's staying a no.",
  },
]

/** You dialled him again too soon after he walked. */
const COOLOFF: ContentVariant[] = [
  {
    id: 'tt.cool.plain',
    text: 'I told you where I stood and I meant it. Give it a couple of weeks before you try this number again.',
  },
  {
    id: 'tt.cool.plain2',
    text: "You want me to reopen a file I closed on {target}. Not this week. Ask me once the calendar's turned over.",
  },
  {
    id: 'tt.cool.plain3',
    text: 'No. Same as the last time you asked, and probably the next time too.',
  },
  {
    id: 'tt.cool.plain4',
    text: 'I closed this one. Ask me again when something on your side has actually changed.',
  },
  {
    id: 'tt.cool.plain5',
    text: "You're calling too soon. Give it some air.",
  },
  {
    id: 'tt.cool.shark',
    conditions: { persona: 'shark' },
    text: "We had this conversation. I remember all of it. You clearly don't. Not today.",
  },
  {
    id: 'tt.cool.stone',
    conditions: { persona: 'stone' },
    text: "Nothing's changed on my end since I hung up, and nothing will this week. Try me later in the month.",
  },
  {
    id: 'tt.cool.warm',
    conditions: { rapport: 'warm' },
    text: "I'm not going to be rude about it, but I said no and I need that to still mean something on Thursday. Later in the month.",
  },
  {
    id: 'tt.cool.straight',
    conditions: { persona: 'straight' },
    text: "I ended it for a reason and the reason hasn't gone anywhere. Let it sit.",
  },
]

/** The non-binding read when you gauge him before sending anything. */
const GAUGE: ContentVariant[] = [
  {
    id: 'tt.ga.warm',
    conditions: { lean: 'warm' },
    text: "That's the first thing anyone's shown me today worth a second read. Send it properly and I'll give it real thought.",
  },
  {
    id: 'tt.ga.warm.shark',
    conditions: { lean: 'warm', persona: 'shark' },
    text: "Now you're talking. Put it in writing before I come to my senses.",
  },
  {
    id: 'tt.ga.warm.again',
    conditions: { lean: 'warm', minRound: 2 },
    text: "Better than the last one you floated at me. Send it in and I'll treat it seriously this time.",
  },
  {
    id: 'tt.ga.warm.stone',
    conditions: { lean: 'warm', persona: 'stone' },
    text: "I wouldn't hate that. Send it over and let me look at it properly rather than off the cuff.",
  },
  {
    id: 'tt.ga.warm2',
    conditions: { lean: 'warm' },
    text: "I'd take that call seriously. Send it in.",
  },
  {
    id: 'tt.ga.warm3',
    conditions: { lean: 'warm' },
    text: "That isn't far off something I'd say yes to. Make it official.",
  },
  {
    id: 'tt.ga.tepid',
    conditions: { lean: 'tepid' },
    text: "There's something in there. Not enough, but something. Send it and I'll tell you exactly what's missing.",
  },
  {
    id: 'tt.ga.tepid.again',
    conditions: { lean: 'tepid', minRound: 2 },
    text: "We've been here before, haven't we. Still short. Send it if you like, but you know what I'm going to say.",
  },
  {
    id: 'tt.ga.tepid.stone',
    conditions: { lean: 'tepid', persona: 'stone' },
    text: "I wouldn't say no out of hand. I wouldn't say yes either. Sharpen it and come back.",
  },
  {
    id: 'tt.ga.tepid.shark',
    conditions: { lean: 'tepid', persona: 'shark' },
    text: 'Nearly. And nearly is worth nothing to either of us, so fix it before you waste my afternoon.',
  },
  {
    id: 'tt.ga.tepid2',
    conditions: { lean: 'tepid' },
    text: "Halfway there. Send it and I'll tell you the other half.",
  },
  {
    id: 'tt.ga.tepid3',
    conditions: { lean: 'tepid' },
    text: 'I could be talked into something in that area. Not that exactly.',
  },
  {
    id: 'tt.ga.cool',
    conditions: { lean: 'cool' },
    text: "We're not close. It'd take a lot more coming back before I'd even carry it to my staff.",
  },
  {
    id: 'tt.ga.cool.shark',
    conditions: { lean: 'cool', persona: 'shark' },
    text: "No. And I'd rather not be made to say it twice in the same week.",
  },
  {
    id: 'tt.ga.cool.again',
    conditions: { lean: 'cool', minRound: 2 },
    text: "That's the second version of the same idea and it's still not one I like. We're a long way apart.",
  },
  {
    id: 'tt.ga.cool.stone',
    conditions: { lean: 'cool', persona: 'stone' },
    text: "That one doesn't move me at all. No hard feelings — it just doesn't.",
  },
  {
    id: 'tt.ga.cool2',
    conditions: { lean: 'cool' },
    text: "That doesn't do anything for me, I'm afraid.",
  },
  {
    id: 'tt.ga.cool3',
    conditions: { lean: 'cool' },
    text: "No, and I don't think a small tweak fixes it either.",
  },
]

/** He slept on it and came back a no; nothing you own bridged the gap. */
const LAPSE: ContentVariant[] = [
  {
    id: 'tt.lap.plain',
    text: "I sat with it overnight. There's nothing on your side that gets me there — not a package I can actually build. It's a no.",
  },
  {
    id: 'tt.lap.plain2',
    text: "I've been through it and I can't make it work from your side. That's a no, and it isn't a negotiating no.",
  },
  {
    id: 'tt.lap.plain3',
    text: "I wanted this to work. It doesn't. There's nothing on your list that gets me over the line.",
  },
  {
    id: 'tt.lap.plain4',
    text: "No. I'd tell you what would change my mind if I could think of anything.",
  },
  {
    id: 'tt.lap.shark',
    conditions: { persona: 'shark' },
    text: "I looked. Twice. You haven't got what this costs. That's not an insult, it's an inventory problem.",
  },
  {
    id: 'tt.lap.stone',
    conditions: { persona: 'stone' },
    text: "I gave it a night, which was more than it needed. Nothing you've got bridges it. We'll talk another time.",
  },
  {
    id: 'tt.lap.straight',
    conditions: { persona: 'straight' },
    text: "I went through your roster properly before I called. I can't get from your side of this to mine. That's the whole answer.",
  },
  {
    id: 'tt.lap.deadline',
    conditions: { deadline: true },
    text: "I've run out of both time and ideas on this one. Nothing you own closes it before the horn. It's a no.",
  },
  {
    id: 'tt.lap.core',
    conditions: { chasingCore: true },
    text: "You asked for my best player and there's no version of your roster that pays for him. I'd rather tell you than string you along.",
  },
]

/**
 * The on-the-spot no to a package that is nowhere near. The shortfall figure is
 * the engine's (evaluateProposal), passed straight through as {short} — this
 * layer only decides how a man delivers it.
 */
const SHORTFALL: ContentVariant[] = [
  {
    id: 'tt.sf.plain',
    text: "That's not close. You're a good {short} light of what I'd need back, and I'd rather say so now than in three days.",
  },
  {
    id: 'tt.sf.plain2',
    text: "No. And not a soft no, I'm afraid — you're {short} short, which isn't a rounding error.",
  },
  {
    id: 'tt.sf.plain3',
    text: "I'll save you the wait. {short} under, near enough, and I haven't got a way to talk myself into it.",
  },
  {
    id: 'tt.sf.plain4',
    text: "You're about {short} away. Come back when you've closed most of that and I'll take it seriously.",
  },
  {
    id: 'tt.sf.plain5',
    text: "I ran it while you were talking. {short} short. That's not a starting point, it's a different conversation.",
  },
  {
    id: 'tt.sf.plain6',
    text: "That one doesn't get near me — {short} off the mark. Have another go if you like.",
  },
  {
    id: 'tt.sf.plain7',
    text: "No. My people put it {short} light and my people are usually kind about these things.",
  },
  {
    id: 'tt.sf.shark',
    conditions: { persona: 'shark' },
    text: "You're {short} short and you knew that when you dialled. Try me properly or don't try me.",
  },
  {
    id: 'tt.sf.shark2',
    conditions: { persona: 'shark' },
    text: "{short} under. I'd be embarrassed to take that into my own building, never mind sign it.",
  },
  {
    id: 'tt.sf.stone',
    conditions: { persona: 'stone' },
    text: "It's {short} short, which is too far for me to bridge with goodwill. No hard feelings.",
  },
  {
    id: 'tt.sf.stone2',
    conditions: { persona: 'stone' },
    text: "I'll pass, quietly. {short} is a long way to make up and I'm not in a hurry to try.",
  },
  {
    id: 'tt.sf.straight',
    conditions: { persona: 'straight' },
    text: "Straight answer: no. It's {short} light and I'd only be wasting your week pretending otherwise.",
  },
  {
    id: 'tt.sf.again',
    conditions: { minRound: 2 },
    text: "That's the second one of these you've sent me, and it's still {short} short. I'd change the approach.",
  },
  {
    id: 'tt.sf.again3',
    conditions: { minRound: 3 },
    text: "Three of these now. Still {short} away. At some point you have to believe me.",
  },
  {
    id: 'tt.sf.stall',
    conditions: { minStalls: 2 },
    text: "You keep sending the same weight back in a new order. It's still {short} short however you stack it.",
  },
  {
    id: 'tt.sf.deadline',
    conditions: { deadline: true },
    text: "No time to be polite about it: {short} short. If you're serious, be serious in the next hour.",
  },
  {
    id: 'tt.sf.core',
    conditions: { chasingCore: true },
    text: "For my best player? That's {short} short of the conversation, let alone the deal.",
  },
  {
    id: 'tt.sf.frosty',
    conditions: { rapport: 'frosty' },
    text: "{short} short. I'd ask if you were serious, but I think I know the answer.",
  },
  {
    id: 'tt.sf.warm',
    conditions: { rapport: 'warm' },
    text: "I'll be honest with you because you've earned that — it's {short} short and I can't get there. Try me again with more.",
  },
]

const POOLS: Record<TalkBeat, ContentVariant[]> = {
  pitch: PITCH,
  counter: COUNTER,
  final: FINAL,
  walk: WALK,
  cooloff: COOLOFF,
  gauge: GAUGE,
  lapse: LAPSE,
  shortfall: SHORTFALL,
}

/** Every authored line, for audits and coverage tests. */
export const TRADE_TALK_POOLS: Readonly<Record<TalkBeat, ContentVariant[]>> = POOLS

/* ─────────────────────────── selection ─────────────────────────── */

/** Voice archetype from the existing persona axes (LW2) — no new sim values. */
export function talkPersona(p: { aggression: number; patience: number }): TalkPersona {
  if (p.aggression >= 0.62) return 'shark'
  if (p.patience >= 0.6) return 'stone'
  return 'straight'
}

/** Rapport band from the 0–100 relationship the career already tracks. */
export function talkRapport(relationship: number): 'warm' | 'neutral' | 'frosty' {
  if (relationship >= 64) return 'warm'
  if (relationship <= 38) return 'frosty'
  return 'neutral'
}

/**
 * Say the line. Picks the most specific eligible authored variant for this
 * moment of this thread, skipping anything already used this season, and fills
 * the slots. Pure and deterministic given the Rng.
 *
 * `ledger` omitted → a stateless read (the gauge), which must not burn pool
 * freshness because the UI asks for it every time the package changes.
 */
export function speakTradeLine(args: {
  ctx: TalkCtx
  slots: TalkSlots
  rng: Rng
  year: number
  day: number
  ledger?: ContentUse[]
}): string {
  const { ctx, slots, rng, year, day } = args
  const v = selectVariant({
    pool: POOLS[ctx.beat],
    ctx,
    rng,
    ledger: args.ledger ?? [],
    year,
  })
  if (!v) return ''
  if (args.ledger) markUsed(args.ledger, v.id, year, day)
  return renderTemplate(v.text, slots as unknown as Record<string, string>)
}

/** The variant that WOULD be chosen, without spending it — for tests/audits. */
export function pickTradeVariant(args: {
  ctx: TalkCtx
  rng: Rng
  year: number
  ledger?: ContentUse[]
}): ContentVariant | null {
  return selectVariant({
    pool: POOLS[args.ctx.beat],
    ctx: args.ctx,
    rng: args.rng,
    ledger: args.ledger ?? [],
    year: args.year,
  })
}
