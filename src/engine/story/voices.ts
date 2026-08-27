/**
 * The Voices — FEED-V2-1 (docs/THE-FEED-V2.md workstream 1).
 *
 * Players and GMs post on the feed, not just pundits. Every post is grounded
 * in a REAL event the career layer witnessed (a milestone crossed, a call-up,
 * a trade, a leak he read about himself, a meeting in your office) — the
 * living-world rule applied to social media. Scope is deliberately tight:
 * the user's club always has a voice; the rest of the league only through its
 * stars, so the timeline reads like a feed, not a firehose.
 *
 * Tone is real social media — emoji, snark, gratitude — scaled by personality
 * through the Content Engine: a cocky sniper, a quiet vet and a wide-eyed
 * rookie do not sound alike, and nothing repeats verbatim within a season.
 *
 * Pure + deterministic (seeded Rng), JSON-safe. The career layer queues
 * VoiceEvents at the site where things actually happen and publishes the
 * rendered posts on the next story tick.
 */
import type { Player } from '@domain'
import type { Rng } from '@engine/shared/rng'
import {
  markUsed,
  renderTemplate,
  selectVariant,
  type ContentCtx,
  type ContentUse,
  type ContentVariant,
} from '@engine/story/contentEngine'
import type { FeedAuthor, PostFacts, SalienceCandidate, SalienceCtx } from '@engine/story/salience'
import type { GmPersona } from '@engine/league/gmPersona'

/* ────────────────────────── events ────────────────────────── */

export type VoiceEventKind =
  | 'milestone'      // round career number crossed (500 goals, 1,000 points…)
  | 'hatTrick'       // three goals tonight
  | 'firstNhlGoal'   // the first one ever
  | 'callup'         // recalled to the NHL
  | 'traded'         // moved between clubs (either direction)
  | 'signed'         // put pen to paper with the user's club
  | 'clinch'         // the club mathematically clinched a playoff berth
  | 'injuryReturn'   // cleared to play after an absence
  | 'scratchGripe'   // healthy-scratched and constitutionally unable to stay quiet
  | 'shopSubtweet'   // the leak broke — he KNOWS his name was out there
  | 'meetingGood'    // a concern resolved well in the GM's office
  | 'gmTrade'        // a rival front office announces its acquisition

/** One real thing that happened, queued by the career layer where it happened.
 *  JSON-safe (persisted in the save until the next story tick publishes it). */
export interface VoiceEvent {
  kind: VoiceEventKind
  /** The man posting (or, for gmTrade, the player being welcomed). */
  playerId?: string
  /** For GM posts: the club whose front office speaks. */
  teamId?: string
  day: number
  year: number
  /** Kind-specific slot facts (numbers AND strings both render as slots). */
  numbers?: Record<string, number | string>
  /** Trade direction relative to the user's club (keys goodbye-post copy). */
  fromUser?: boolean
  toUser?: boolean
  /** Set true at the queue site when the user's org is involved — overrides
   *  the club/star scope check (a man traded AWAY from you still gets his
   *  goodbye post even though he now resolves to another club). */
  relevant?: boolean
}

/* ────────────────────────── authors ────────────────────────── */

export function playerAuthorId(playerId: string): string {
  return `p:${playerId}`
}

export function gmAuthorId(teamId: string): string {
  return `gm:${teamId}`
}

/** Social handle from a real name + jersey number: "Tobias Dahl" #91 →
 *  TDahl91. Multi-word surnames keep every part ("Van Dorp" → VanDorp). */
export function playerHandle(name: string, jerseyNumber?: number): string {
  const parts = name.split(/\s+/).filter(Boolean)
  const first = (parts[0] ?? '').replace(/[^a-zA-Z]/g, '')
  const last = parts.slice(1).join('').replace(/[^a-zA-Z]/g, '')
  const base = parts.length > 1 ? `${first[0] ?? ''}${last}` : first
  return `${base || 'Player'}${jerseyNumber !== undefined ? jerseyNumber : ''}`
}

export function playerAuthorFor(player: Player, teamAbbr?: string): FeedAuthor {
  return {
    id: playerAuthorId(player.id as string),
    name: player.name,
    handle: playerHandle(player.name, player.jerseyNumber),
    kind: 'player',
    outlet: teamAbbr ? `${player.position} · ${teamAbbr}` : `${player.position} · NHL`,
  }
}

export function gmAuthorFor(persona: GmPersona, team: { name: string; abbreviation: string }): FeedAuthor {
  const last = (persona.name.split(/\s+/).pop() ?? 'GM').replace(/[^a-zA-Z]/g, '')
  return {
    id: gmAuthorId(persona.teamId),
    name: persona.name,
    handle: `${last}${team.abbreviation}`,
    kind: 'gm',
    outlet: `${team.name} front office`,
  }
}

/* ────────────────────────── the pools (the product) ────────────────────────── */
/* Written to the NARRATIVE-ENGINE.md standard, in a register it never used
 * before: actual social media. Personality keys the register — the Content
 * Engine picks the most specific eligible line, the no-repeat ledger keeps a
 * season from echoing, and every pool carries unconditional fallbacks so no
 * personality ever goes silent. Slots: {name} {first} {last} {team} {abbr}
 * {city} plus per-event facts documented on each pool. */

/** Every ctx key the voice pools may condition on. The dead-content test
 *  guards this list — a condition on anything else can never fire. */
export const VOICE_CTX_KEYS = [
  'ambition', 'professionalism', 'loyalty', 'temperament', 'determination',
  'age', 'morale', 'star',
  // per-event facts:
  'n', 'goals', 'rust', 'years', 'fromUser', 'toUser',
  // gm persona axes (0–100; loyalty2 = the persona's loyalty axis) + stance:
  'aggression', 'patience', 'riskTolerance', 'analyticsLean', 'capDiscipline',
  'pickHoarding', 'loyalty2', 'stance', 'streak',
] as const

/* ─────────────────────────── the player pools ───────────────────────────
 * A6 (playtest 2026-08-26): "a bit tooo corny", and emoji-heavy. The verdict
 * taken, and the three things actually causing it:
 *
 *  1. STACKED EMOJI. 🎩🎩🎩, 🚨🚨🚨, 😭🙏, 😤➡️😌. Nobody posts like that but
 *     a parody of a hockey player. Hard rule now: at most ONE emoji in a post,
 *     enforced by test, so a future line cannot quietly regress it.
 *  2. ONE EMOTIONAL PITCH. Half the library reached for the crescendo — Mom
 *     and Dad, kid-me, pinch-me. Kept where a nineteen-year-old earns it,
 *     re-pitched everywhere else.
 *  3. AGE DID NOT CARRY. The user's note: "a 19-year-old prospect and a
 *     35-year-old captain do not post alike." Only two pools keyed on age at
 *     all. Every player pool now carries a veteran register (30+): full
 *     sentences, no emoji, understatement — the way men who have done this for
 *     a decade actually write. Also enforced by test.
 *
 * The jokes stay. The cocky sniper is still cocky and the fiery winger still
 * subtweets. What changed is that the volume is no longer identical on every
 * post from every man in the league.
 */

/** Career milestone crossed. Slots: {n} (formatted number), {stat} ("career goals"…). */
const MILESTONE_POOL: ContentVariant[] = [
  { id: 'v.mile.cocky', conditions: { minAmbition: 70, maxProfessionalism: 50 },
    text: `{n} {stat}. and some of you said i was a reach on draft day 🤷‍♂️ keep counting.` },
  { id: 'v.mile.provet', conditions: { minProfessionalism: 70, minAge: 29 },
    text: `Humbled to reach {n} {stat} tonight. Every teammate, coach and trainer along the way owns a piece of that number. Back to work tomorrow.` },
  { id: 'v.mile.vet', conditions: { minAge: 30 },
    text: `{n} {stat}. You stop counting somewhere in your twenties, and then a number like that turns up and you realise how long you have been at this. Grateful to still be at it.` },
  { id: 'v.mile.rookie', conditions: { maxAge: 22 },
    text: `{n} {stat}?? actually surreal. thank you {city} — this one's for the boys 🙏` },
  { id: 'v.mile.loyal', conditions: { minLoyalty: 70 },
    text: `{n} {stat}, and every single one of them in this jersey. Proud to have done it here ❤️` },
  { id: 'v.mile.fiery', conditions: { maxTemperament: 40 },
    text: `{n}. and i'm not done. not even close 😤` },
  { id: 'v.mile.grinder', conditions: { minDetermination: 75 },
    text: `{n} {stat}. Nobody handed me a single one of them. See you at the rink at 7.` },
  { id: 'v.mile.rare', conditions: { minN: 500 },
    text: `{n}. Rare air, they tell me. Mostly I am thankful for everyone who has been part of the ride.` },
  { id: 'v.mile.plain',
    text: `{n} {stat} tonight. Grateful. On to the next one.` },
  { id: 'v.mile.plain2',
    text: `Special night. {n} {stat} for the {team}. Thanks for all the messages everyone 🙌` },
]

/** Three goals tonight. Slots: {goals}. */
const HATTRICK_POOL: ContentVariant[] = [
  { id: 'v.hat.cocky', conditions: { minAmbition: 70, maxProfessionalism: 50 },
    text: `hat trick tonight. shooters shoot 🎩` },
  { id: 'v.hat.cocky2', conditions: { minAmbition: 70, maxTemperament: 45 },
    text: `three for me. their goalie is still looking for the first one. jk. (not really)` },
  { id: 'v.hat.rookie', conditions: { maxAge: 22 },
    text: `A HAT TRICK IN THE NHL?? somebody pinch me 😭` },
  { id: 'v.hat.vet', conditions: { minAge: 30 },
    text: `Three tonight. They do not come around often at my age, so I will enjoy this one for about an hour and then we fly.` },
  { id: 'v.hat.pro', conditions: { minProfessionalism: 70 },
    text: `Fun night. Pucks went in. The two points are what actually matters.` },
  { id: 'v.hat.loyal', conditions: { minLoyalty: 70 },
    text: `a hatty in front of these fans. {city} you're the best in the league ❤️ thanks for the hats, keeping one.` },
  { id: 'v.hat.fiery', conditions: { maxTemperament: 40 },
    text: `hattys hit different when people spent all year doubting you 😤` },
  { id: 'v.hat.grinder', conditions: { minDetermination: 75 },
    text: `Three goals, but the boys did the work tonight. My job is just to finish it.` },
  { id: 'v.hat.plain',
    text: `Nights like this are why you play the game 🎩 thank you {city}` },
  { id: 'v.hat.plain2',
    text: `Three of them. I genuinely do not know what to say. Thanks {city}.` },
]

/** The first NHL goal ever. */
const FIRST_GOAL_POOL: ContentVariant[] = [
  { id: 'v.first.rookiecocky', conditions: { maxAge: 22, minAmbition: 70 },
    text: `FIRST NHL GOAL. been dreaming about that exact shot since i was 6. keeping this puck forever 🚀` },
  { id: 'v.first.rookie', conditions: { maxAge: 22 },
    text: `First NHL goal!!! Can't put the feeling into words. Mom, Dad — that one was for you ❤️` },
  { id: 'v.first.late', conditions: { minAge: 25 },
    text: `Took me longer than most. Don't care. That puck goes on my shelf tonight — first NHL goal. Never stopped believing.` },
  { id: 'v.first.vet', conditions: { minAge: 30 },
    text: `First NHL goal, at thirty. I had more or less made my peace with the idea that it might never come. Turns out you should not make peace with anything.` },
  { id: 'v.first.grinder', conditions: { minDetermination: 75 },
    text: `First NHL goal tonight. To every coach who stayed on the ice with me after practice — that was yours too. Thank you.` },
  { id: 'v.first.fiery', conditions: { maxTemperament: 40 },
    text: `FIRST OF MANY. remember the name 😤` },
  { id: 'v.first.loyal', conditions: { minLoyalty: 70 },
    text: `First NHL goal, and it came in a {team} sweater. Exactly how I dreamed it ❤️` },
  { id: 'v.first.humble', conditions: { minProfessionalism: 70 },
    text: `First NHL goal. A thousand people helped me get to that moment and I'm thinking about every one of them tonight.` },
  { id: 'v.first.plain',
    text: `That first one 🥹 the puck is already wrapped in tape with the date on it` },
  { id: 'v.first.plain2',
    text: `First one in the league. They say the first is the hardest — here's to many more.` },
]

/** Recalled to the NHL. Slots: {ahl} (farm club abbr). */
const CALLUP_POOL: ContentVariant[] = [
  { id: 'v.call.rookie', conditions: { maxAge: 22 },
    text: `THE CALL. i'm coming to the show 😭 thank you {ahl} for everything` },
  { id: 'v.call.cocky', conditions: { minAmbition: 70, maxProfessionalism: 50 },
    text: `about time. see you in the bigs 😏` },
  { id: 'v.call.vet', conditions: { minAge: 30 },
    text: `Recalled. I have taken this bus ride in both directions more times than I can count, and it has never once got old going this way. Thank you {ahl}.` },
  { id: 'v.call.pro', conditions: { minProfessionalism: 70 },
    text: `Grateful for the opportunity. Thank you to everyone with {ahl} — now the real work starts.` },
  { id: 'v.call.grinder', conditions: { minDetermination: 75 },
    text: `Got the call this morning. 6am workouts don't miss. Let's go.` },
  { id: 'v.call.loyal', conditions: { minLoyalty: 70 },
    text: `Dream come true getting the call from the {team}. This organization believed in me from day one ❤️` },
  { id: 'v.call.fiery', conditions: { maxTemperament: 40 },
    text: `they finally made the call 😤 been ready.` },
  { id: 'v.call.plain',
    text: `NHL bound 🙌 huge thanks to the {ahl} boys — wouldn't be here without you` },
  { id: 'v.call.plain2',
    text: `Phone rang. Bags packed. See you tonight {city}.` },
]

/** Traded. Slots: {fromCity} {fromAbbr} {toCity} {toAbbr}. Condition
 *  fromUser marks a man leaving the user's club (the goodbye that stings). */
const TRADED_POOL: ContentVariant[] = [
  { id: 'v.trade.loyal.fromuser', conditions: { minLoyalty: 70, fromUser: true },
    text: `Didn't think this day would ever come. {fromCity} — you were home. The fans, the staff, my teammates: thank you for everything. I'll never forget it ❤️` },
  { id: 'v.trade.cocky', conditions: { minAmbition: 70, maxProfessionalism: 50 },
    text: `new chapter. {toCity}, you're getting the best version of me. some people are gonna remember what they gave up 🤷‍♂️` },
  { id: 'v.trade.pro', conditions: { minProfessionalism: 70 },
    text: `Thankful for my time in {fromCity} — a first-class organization from day one. Excited for the fresh start with the {toAbbr}. See you soon, {toCity}.` },
  { id: 'v.trade.fiery', conditions: { maxTemperament: 40 },
    text: `all i'll say is: some people are gonna regret this one. {toCity}, let's work 😤` },
  { id: 'v.trade.rookie', conditions: { maxAge: 23 },
    text: `Wild day. Grateful to {fromAbbr} for taking a chance on a kid with a dream. {toCity} — can't wait to get started 🙏` },
  { id: 'v.trade.vet', conditions: { minAge: 30 },
    text: `Been in this league long enough to know the business. Leaving {fromCity} still stings. Proud of what we built there. {toCity} — let's win.` },
  { id: 'v.trade.vet2', conditions: { minAge: 33 },
    text: `My fourth address in this league. You learn to pack quickly, and to say the important things before you go. {fromCity}, thank you. Genuinely.` },
  { id: 'v.trade.plain',
    text: `Trades are part of the game. Doesn't make them easy. Thank you {fromCity}. Hello {toCity} 🙌` },
  { id: 'v.trade.plain2',
    text: `Emotional day. That's all I've got right now. Thank you, {fromCity}.` },
]

/** Signed with the user's club. Slots: {years}. */
const SIGNED_POOL: ContentVariant[] = [
  { id: 'v.sign.cocky', conditions: { minAmbition: 70, maxProfessionalism: 50 },
    text: `{years} more years. locked in. now we go get what we came for 🏆` },
  { id: 'v.sign.loyal', conditions: { minLoyalty: 70 },
    text: `{city} is home. {years} more years in this sweater — wouldn't want it any other way ❤️` },
  { id: 'v.sign.pro', conditions: { minProfessionalism: 70 },
    text: `Proud to sign with the {team}. Great group, great city. Let's get to work.` },
  { id: 'v.sign.rookie', conditions: { maxAge: 22 },
    text: `Signed my deal today. Kid me wouldn't believe it. Time to earn it 🙏` },
  { id: 'v.sign.vet', conditions: { minAge: 30 },
    text: `Signed for {years}. At this stage you sign where you are wanted and where you can still be useful. Both happen to be true here.` },
  { id: 'v.sign.fiery', conditions: { maxTemperament: 40 },
    text: `deal's done. everyone who said i wasn't worth it — keep watching 😤` },
  { id: 'v.sign.grinder', conditions: { minDetermination: 75 },
    text: `Signed. The contract doesn't score goals — the work does. See you at camp.` },
  { id: 'v.sign.plain',
    text: `Official ✍️ Excited for what comes next with the {team}` },
  { id: 'v.sign.plain2',
    text: `New deal, same hunger. Thank you {city} for wanting me here.` },
]

/** The club clinched a playoff berth. */
const CLINCH_POOL: ContentVariant[] = [
  { id: 'v.clinch.cocky', conditions: { minAmbition: 70, maxProfessionalism: 50 },
    text: `PLAYOFFS. and we're not going just to be there 👀` },
  { id: 'v.clinch.rookie', conditions: { maxAge: 22 },
    text: `MY FIRST NHL PLAYOFFS 😭 this group is special, i'm telling you` },
  { id: 'v.clinch.vet', conditions: { minAge: 32 },
    text: `You do not get many of these. I have had seasons where March was for booking flights home. Not this one.` },
  { id: 'v.clinch.loyal', conditions: { minLoyalty: 70 },
    text: `This city deserves playoff hockey. {city}, we did this TOGETHER ❤️ now buckle up` },
  { id: 'v.clinch.pro', conditions: { minProfessionalism: 70 },
    text: `Clinched. Nobody in that room is satisfied — the goal was never just getting in.` },
  { id: 'v.clinch.fiery', conditions: { maxTemperament: 40 },
    text: `we're IN. nobody wants to see us in a seven-game series 😤` },
  { id: 'v.clinch.grinder', conditions: { minDetermination: 75 },
    text: `82 games of work for this. And the work is just starting.` },
  { id: 'v.clinch.plain',
    text: `Playoff hockey in {city} 🙌 let's make that building LOUD` },
  { id: 'v.clinch.plain2',
    text: `Clinched. The regular season means nothing now. 16 wins.` },
]

/** Cleared after an injury. Slots: {rust} (games of ring rust, may be 0). */
const RETURN_POOL: ContentVariant[] = [
  { id: 'v.ret.fiery', conditions: { maxTemperament: 40 },
    text: `finally. tired of watching from the press box. somebody's gonna feel this comeback 😤` },
  { id: 'v.ret.grinder', conditions: { minDetermination: 75 },
    text: `Cleared. Rehab was the hardest thing I've done in this game. Grateful to the medical staff — see you tonight.` },
  { id: 'v.ret.rookie', conditions: { maxAge: 22 },
    text: `BACK. missed the boys so much man 🥹` },
  { id: 'v.ret.vet', conditions: { minAge: 31 },
    text: `Cleared to play. The body takes longer to answer the phone than it used to. It answered.` },
  { id: 'v.ret.pro', conditions: { minProfessionalism: 70 },
    text: `Good to be back with the group. Thank you to the training staff for getting me right — they don't get enough credit.` },
  { id: 'v.ret.loyal', conditions: { minLoyalty: 70 },
    text: `Missed this city, missed this jersey, missed these fans. Back tonight ❤️` },
  { id: 'v.ret.cocky', conditions: { minAmbition: 70, maxProfessionalism: 50 },
    text: `they survived without me. barely 😏 i'm back.` },
  { id: 'v.ret.plain',
    text: `Back in the lineup tonight 🙌 thank you for every message during the rehab. They mattered.` },
  { id: 'v.ret.plain2',
    text: `Injuries test you in ways the game never does. Back now. That's all that matters.` },
]

/** Healthy-scratched — the vague-post. Only queued for men constitutionally
 *  unable to let it go (fiery temperament or thin loyalty); the pros eat it. */
const SCRATCH_POOL: ContentVariant[] = [
  { id: 'v.scr.fiery', conditions: { maxTemperament: 35 },
    text: `interesting decisions around here lately. that's all i'll say 🤐` },
  { id: 'v.scr.fiery2', conditions: { maxTemperament: 45 },
    text: `guess showing up every night doesn't count for much anymore.` },
  { id: 'v.scr.disloyal', conditions: { maxLoyalty: 40 },
    text: `funny how fast things change around here. taking notes 📝` },
  { id: 'v.scr.vet', conditions: { minAge: 31 },
    text: `A decade in this league and you still learn something new about it every week. Learned something tonight.` },
  { id: 'v.scr.ambitious', conditions: { minAmbition: 65 },
    text: `i know exactly what i bring. some people apparently don't 🤷` },
  { id: 'v.scr.plain',
    text: `Healthy. Feeling great. Great seats tonight though.` },
  { id: 'v.scr.popcorn',
    text: `press box popcorn is elite at least 🍿` },
  { id: 'v.scr.learn',
    text: `you learn a lot about a place when things get hard. learning a lot lately.` },
  { id: 'v.scr.motivation',
    text: `motivation comes in strange forms. thanks for this one.` },
]

/** The shop leaked — he KNOWS his name was out there. The subtweet. */
const SHOPPED_POOL: ContentVariant[] = [
  { id: 'v.shop.fiery', conditions: { maxTemperament: 40 },
    text: `heard my name's out there. cool. remember this post when i'm rolling in April 😤` },
  { id: 'v.shop.pro', conditions: { minProfessionalism: 70 },
    text: `Not going to comment on rumors. My job is to play hockey. That's exactly what I'll keep doing.` },
  { id: 'v.shop.vet', conditions: { minAge: 31 },
    text: `I have been on the wrong end of one of those phone calls before. You play Tuesday either way.` },
  { id: 'v.shop.loyal', conditions: { minLoyalty: 70 },
    text: `gave everything to this place. everything. and my name's in trade talks. hockey's a business, right? …right.` },
  { id: 'v.shop.cocky', conditions: { minAmbition: 70, maxProfessionalism: 50 },
    text: `they'd miss me a lot more than i'd miss the drama 🤷‍♂️` },
  { id: 'v.shop.plain',
    text: `you find out who's loyal when your name starts floating around. noted.` },
  { id: 'v.shop.week',
    text: `funny week to be reading the news 🙃` },
  { id: 'v.shop.trust',
    text: `trust is earned in drops and lost in buckets.` },
  { id: 'v.shop.nocaption',
    text: `no caption needed. the people who know, know.` },
]

/** A concern resolved well in the GM's office — the grateful post. */
const MEETING_POOL: ContentVariant[] = [
  { id: 'v.meet.loyal', conditions: { minLoyalty: 70 },
    text: `appreciate the management here more than people know. we talked, we're good. this place is family ❤️` },
  { id: 'v.meet.pro', conditions: { minProfessionalism: 70 },
    text: `Had a good sit-down with the front office today. Clarity matters in this league. We're aligned on what comes next.` },
  { id: 'v.meet.rookie', conditions: { maxAge: 22 },
    text: `big thanks to the GM for making time for me today. learned a lot 🙏` },
  { id: 'v.meet.fiery', conditions: { maxTemperament: 40 },
    text: `said what i needed to say. he listened. respect 🤝` },
  { id: 'v.meet.vet', conditions: { minAge: 31 },
    text: `Sat down with the GM this morning. I have had that conversation in four buildings now and it is the first time I walked out knowing exactly where I stand.` },
  { id: 'v.meet.grinder', conditions: { minDetermination: 75 },
    text: `Talked with the GM. Now it's on me to hold up my end. Fine by me — that's the fun part.` },
  { id: 'v.meet.ambitious', conditions: { minAmbition: 65 },
    text: `good honest conversation upstairs today. i know where i stand and where this is going. that's all i ever asked for.` },
  { id: 'v.meet.plain',
    text: `air's cleared. love this group, love this city. onward 🙌` },
  { id: 'v.meet.plain2',
    text: `communication > everything. good meeting today. back to work.` },
]

/** A rival front office announces its acquisition. Slots: {playerName} {team}
 *  {city}. Conditions ride the LW2 persona axes (0–100). */
const GM_TRADE_POOL: ContentVariant[] = [
  { id: 'v.gmtr.aggr', conditions: { minAggression: 60 },
    text: `We didn't acquire {playerName} to stand still. This move makes us better today — and today is what we care about.` },
  { id: 'v.gmtr.patient', conditions: { minPatience: 60 },
    text: `{playerName} fits how we want to play for years, not weeks. Thrilled to welcome him to {city}.` },
  { id: 'v.gmtr.model', conditions: { minAnalyticsLean: 65 },
    text: `Our model loved {playerName} before our eyes did — and our eyes love him too. When the numbers and the hockey people agree, you make the call.` },
  { id: 'v.gmtr.cap', conditions: { minCapDiscipline: 65 },
    text: `Value wins championships. {playerName} on this contract is exactly the kind of deal that builds one.` },
  { id: 'v.gmtr.swing', conditions: { minRiskTolerance: 65 },
    text: `Big swings win big prizes. Welcome to {city}, {playerName}.` },
  { id: 'v.gmtr.calm', conditions: { maxAggression: 40 },
    text: `Patience found us the right deal, not the loud one. Welcome aboard, {playerName}.` },
  { id: 'v.gmtr.plain',
    text: `Official: {playerName} joins the {team}. A player we've admired for a long time — proud to get this one done.` },
  { id: 'v.gmtr.plain2',
    text: `Trade complete. {playerName} is one of ours now. We like our group a lot today.` },
]

/** Vote of confidence mid-skid. Slots: {streak} {team} {city}. */
export const GM_CONFIDENCE_POOL: ContentVariant[] = [
  { id: 'v.gmconf.patient', conditions: { minPatience: 60 },
    text: `{streak} losses is a stretch, not a story. This group has earned our patience, and it has it.` },
  { id: 'v.gmconf.aggr', conditions: { minAggression: 60 },
    text: `Nobody in this building is hiding from {streak} straight. I believe in this room — and everyone here knows what happens if that changes.` },
  { id: 'v.gmconf.loyal', conditions: { minLoyalty2: 60 },
    text: `I built this roster and I stand by it. {streak} games doesn't change what I know about these players.` },
  { id: 'v.gmconf.model', conditions: { minAnalyticsLean: 65 },
    text: `The underlying numbers are far better than the results. Results follow the numbers. They always do.` },
  { id: 'v.gmconf.steady', conditions: { maxRiskTolerance: 40 },
    text: `Steady hands. That's how you get through a stretch like this — not by lighting the plan on fire.` },
  { id: 'v.gmconf.chapters', conditions: { minPatience: 75 },
    text: `Seasons have chapters. This is one chapter. Judge the book in April.` },
  { id: 'v.gmconf.plain',
    text: `Full confidence in our group and our staff. Losing streaks test you. This team will answer.` },
  { id: 'v.gmconf.plain2',
    text: `We're not making panic moves. We're making the playoffs. That's the statement.` },
]

/** Deadline posturing. Slots: {team} {city}. Condition stance: buy | sell. */
export const GM_DEADLINE_POOL: ContentVariant[] = [
  { id: 'v.gmdl.buy.aggr', conditions: { stance: 'buy', minAggression: 60 },
    text: `We owe this room reinforcements and we're working the phones to deliver them. Watch this space.` },
  { id: 'v.gmdl.buy.model', conditions: { stance: 'buy', minAnalyticsLean: 65 },
    text: `We've known exactly what this roster needs since November — the data's been clear. Deadline week is about acting on it.` },
  { id: 'v.gmdl.buy.patient', conditions: { stance: 'buy', minPatience: 60 },
    text: `We'll add if the price is right. We won't mortgage the future for a rental — that's not how contenders are built.` },
  { id: 'v.gmdl.buy', conditions: { stance: 'buy' },
    text: `We're in win-now mode. If there's a deal out there that makes us better, we'll make it.` },
  { id: 'v.gmdl.sell.hoard', conditions: { stance: 'sell', minPickHoarding: 60 },
    text: `Draft capital is the lifeblood of what we're building. If you want our players, bring picks.` },
  { id: 'v.gmdl.sell.aggr', conditions: { stance: 'sell', minAggression: 60 },
    text: `Teams know our number. Meet it, or we're perfectly happy keeping our guys.` },
  { id: 'v.gmdl.sell.patient', conditions: { stance: 'sell', minPatience: 60 },
    text: `This deadline is about the next three years, not the next three weeks.` },
  { id: 'v.gmdl.sell', conditions: { stance: 'sell' },
    text: `We're listening on everyone. That's not a fire sale — that's doing the job properly.` },
]

export const VOICE_POOLS: Record<VoiceEventKind, ContentVariant[]> = {
  milestone: MILESTONE_POOL,
  hatTrick: HATTRICK_POOL,
  firstNhlGoal: FIRST_GOAL_POOL,
  callup: CALLUP_POOL,
  traded: TRADED_POOL,
  signed: SIGNED_POOL,
  clinch: CLINCH_POOL,
  injuryReturn: RETURN_POOL,
  scratchGripe: SCRATCH_POOL,
  shopSubtweet: SHOPPED_POOL,
  meetingGood: MEETING_POOL,
  gmTrade: GM_TRADE_POOL,
}

/* ────────────────────────── building posts ────────────────────────── */

/** How the career layer describes the man behind a playerId. */
export interface VoiceSubject {
  player: Player
  teamId: string
  teamName: string
  abbr: string
  city: string
  isUserClub: boolean
  /** League-star scope: ratedOverall >= 82 (or a league leader). */
  isStar: boolean
}

export interface VoiceGmSubject {
  persona: GmPersona
  teamId: string
  teamName: string
  abbr: string
  city: string
}

export interface VoicePost {
  authorId: string
  handle: string
  channel: 'feed'
  text: string
  facts: PostFacts
  playerId?: string
  teamId?: string
  /** 0–100; drives ordering, the daily cap cut and engagement volume. */
  score: number
}

/**
 * The no-repeat ledger is keyed PER MAN (`<playerId>::<variantId>`), not per
 * pool: a shared pool of nine lines exhausts across a 700-player league in
 * weeks, and once it recycles two different players start saying the exact
 * same sentence — the template seam the whole Content Engine exists to hide.
 * Per-man keys give every player his own fresh pool. The view below lets
 * selectVariant (which matches on bare variant ids) read the namespaced
 * ledger without knowing about the namespace.
 */
function ledgerViewFor(ledger: ContentUse[], owner: string): ContentUse[] {
  const prefix = `${owner}::`
  const out: ContentUse[] = []
  for (const u of ledger) {
    if (u.variantId.startsWith(prefix)) {
      out.push({ variantId: u.variantId.slice(prefix.length), year: u.year, day: u.day })
    }
  }
  return out
}

/** Base newsworthiness per event kind (before the star bump). */
const KIND_SCORE: Record<VoiceEventKind, number> = {
  milestone: 62, hatTrick: 60, firstNhlGoal: 66, callup: 56, traded: 68,
  signed: 58, clinch: 72, injuryReturn: 52, scratchGripe: 57, shopSubtweet: 64,
  meetingGood: 48, gmTrade: 55,
}

/** Max voice posts published per story tick — the feed stays a feed. */
export const VOICE_DAILY_CAP = 4

function personalityCtx(p: Player): ContentCtx {
  return {
    ambition: p.personality.ambition,
    professionalism: p.personality.professionalism,
    loyalty: p.personality.loyalty,
    temperament: p.personality.temperament,
    determination: p.personality.determination,
    age: p.age,
    morale: p.morale,
  }
}

/**
 * Turn the day's queued VoiceEvents into rendered posts. Scope filter lives
 * here: the user's club always speaks; the rest of the league only through
 * its stars (unless the queue site marked the event user-relevant). Copy is
 * served through the Content Engine — most specific personality match wins,
 * and the shared no-repeat ledger keeps a season from echoing.
 */
export function buildVoicePosts(args: {
  events: VoiceEvent[]
  resolve: (playerId: string) => VoiceSubject | null
  resolveGm: (teamId: string) => VoiceGmSubject | null
  rng: Rng
  ledger: ContentUse[]
  year: number
  day: number
  maxPosts?: number
}): VoicePost[] {
  const { events, resolve, resolveGm, rng, ledger, year, day } = args
  const cap = args.maxPosts ?? VOICE_DAILY_CAP
  const out: VoicePost[] = []

  for (const ev of events) {
    if (ev.kind === 'gmTrade') {
      const gm = ev.teamId ? resolveGm(ev.teamId) : null
      if (!gm) continue
      const acquired = ev.playerId ? resolve(ev.playerId) : null
      const p = gm.persona
      const ctx: ContentCtx = {
        aggression: Math.round(p.aggression * 100),
        patience: Math.round(p.patience * 100),
        riskTolerance: Math.round(p.riskTolerance * 100),
        analyticsLean: Math.round(p.analyticsLean * 100),
        capDiscipline: Math.round(p.capDiscipline * 100),
        pickHoarding: Math.round(p.pickHoarding * 100),
        loyalty2: Math.round(p.loyalty * 100),
      }
      const v = selectVariant({ pool: GM_TRADE_POOL, ctx, rng, ledger: ledgerViewFor(ledger, gm.teamId), year })
      if (!v) continue
      markUsed(ledger, `${gm.teamId}::${v.id}`, year, day)
      const slots: Record<string, string> = {
        playerName: acquired?.player.name ?? String(ev.numbers?.playerName ?? 'our new addition'),
        team: gm.teamName, city: gm.city, abbr: gm.abbr, gmName: p.name,
      }
      out.push({
        authorId: gmAuthorId(gm.teamId),
        handle: gmAuthorFor(p, { name: gm.teamName, abbreviation: gm.abbr }).handle,
        channel: 'feed',
        text: renderTemplate(v.text, slots),
        facts: {
          kind: `voice.gmTrade`,
          teamIds: [gm.teamId],
          ...(ev.playerId !== undefined ? { playerIds: [ev.playerId] } : {}),
          numbers: { ...(ev.numbers ?? {}), day: ev.day },
        },
        teamId: gm.teamId,
        ...(ev.playerId !== undefined ? { playerId: ev.playerId } : {}),
        score: KIND_SCORE.gmTrade + (ev.relevant ? 10 : 0),
      })
      continue
    }

    if (!ev.playerId) continue
    const subject = resolve(ev.playerId)
    if (!subject) continue
    // The locked scope rule: your club always, the rest only its stars —
    // unless the queue site vouched for relevance (your traded-away player).
    if (!subject.isUserClub && !subject.isStar && !ev.relevant) continue

    const pool = VOICE_POOLS[ev.kind]
    const ctx: ContentCtx = {
      ...personalityCtx(subject.player),
      star: subject.isStar,
      ...(ev.fromUser !== undefined ? { fromUser: ev.fromUser } : {}),
      ...(ev.toUser !== undefined ? { toUser: ev.toUser } : {}),
      ...(ev.numbers ?? {}),
    }
    const v = selectVariant({ pool, ctx, rng, ledger: ledgerViewFor(ledger, ev.playerId), year })
    if (!v) continue
    markUsed(ledger, `${ev.playerId}::${v.id}`, year, day)
    const last = subject.player.name.split(' ').slice(-1)[0] ?? subject.player.name
    const first = subject.player.name.split(' ')[0] ?? subject.player.name
    const slots: Record<string, string> = {
      name: subject.player.name, first, last,
      team: subject.teamName, abbr: subject.abbr, city: subject.city,
    }
    for (const [k, val] of Object.entries(ev.numbers ?? {})) {
      slots[k] = typeof val === 'number' ? val.toLocaleString('en-US') : String(val)
    }
    out.push({
      authorId: playerAuthorId(ev.playerId),
      handle: playerHandle(subject.player.name, subject.player.jerseyNumber),
      channel: 'feed',
      text: renderTemplate(v.text, slots),
      facts: {
        kind: `voice.${ev.kind}`,
        playerIds: [ev.playerId],
        teamIds: [subject.teamId],
        numbers: { ...(ev.numbers ?? {}), day: ev.day },
      },
      playerId: ev.playerId,
      teamId: subject.teamId,
      score: Math.min(95, KIND_SCORE[ev.kind] + (subject.isStar ? 12 : 0)),
    })
  }

  return out.sort((a, b) => b.score - a.score).slice(0, cap)
}

/* ────────────────────────── GM ambient moments ────────────────────────── */

/** Losing-streak bands a front office feels compelled to address. */
const CONFIDENCE_BANDS = [6, 8, 10]

/**
 * GM posts that need no queued event — read straight off league state at the
 * salience pass, and fed through the same novelty gate/budget as pundit posts:
 *  - vote of confidence when an AI club's skid hits a band (6/8/10),
 *  - deadline posturing from the clearest buyers and sellers in the window.
 * The user's own club never posts here — the user IS that front office.
 */
export function detectGmMoments(args: {
  ctx: SalienceCtx
  personaFor: (teamId: string) => GmPersona | null
  deadlineDay: number
  ledger: ContentUse[]
  rng: Rng
}): SalienceCandidate[] {
  const { ctx, personaFor, deadlineDay, ledger, rng } = args
  const out: SalienceCandidate[] = []

  const gmCtxOf = (p: GmPersona): ContentCtx => ({
    aggression: Math.round(p.aggression * 100),
    patience: Math.round(p.patience * 100),
    riskTolerance: Math.round(p.riskTolerance * 100),
    analyticsLean: Math.round(p.analyticsLean * 100),
    capDiscipline: Math.round(p.capDiscipline * 100),
    pickHoarding: Math.round(p.pickHoarding * 100),
    loyalty2: Math.round(p.loyalty * 100),
  })

  /* Vote of confidence: an AI club's skid reaches a band. */
  for (const [teamId, streak] of ctx.streaks) {
    if (teamId === ctx.userTeamId || streak >= 0) continue
    const len = -streak
    if (!CONFIDENCE_BANDS.includes(len)) continue
    const t = ctx.teams.get(teamId)
    const persona = personaFor(teamId)
    if (!t || !persona) continue
    const v = selectVariant({ pool: GM_CONFIDENCE_POOL, ctx: gmCtxOf(persona), rng, ledger, year: ctx.year })
    if (!v) continue
    markUsed(ledger, v.id, ctx.year, ctx.day)
    out.push({
      key: `gmconf-${teamId}-${ctx.year}-${len}`,
      score: Math.min(78, 44 + len * 3),
      channel: 'feed',
      authorId: gmAuthorId(teamId),
      text: renderTemplate(v.text, { streak: String(len), team: t.name, city: t.city ?? t.name }),
      facts: {
        kind: 'voice.gmConfidence',
        teamIds: [teamId],
        numbers: { streak: len, day: ctx.day },
      },
      teamId,
    })
  }

  /* Deadline posturing: two beats in the window, from the clearest buyers
   * (top of the standings) and sellers (bottom). */
  const postureDays = [deadlineDay - 8, deadlineDay - 2]
  if (postureDays.includes(ctx.day)) {
    const n = ctx.currentRanks.size
    for (const [teamId, rank] of ctx.currentRanks) {
      if (teamId === ctx.userTeamId) continue
      const stance = rank <= 3 ? 'buy' : rank > n - 3 ? 'sell' : null
      if (!stance) continue
      const t = ctx.teams.get(teamId)
      const persona = personaFor(teamId)
      if (!t || !persona) continue
      const v = selectVariant({ pool: GM_DEADLINE_POOL, ctx: { ...gmCtxOf(persona), stance }, rng, ledger, year: ctx.year })
      if (!v) continue
      markUsed(ledger, v.id, ctx.year, ctx.day)
      out.push({
        key: `gmdeadline-${stance}-${teamId}-${ctx.year}-${ctx.day}`,
        score: 46 + (ctx.day === deadlineDay - 2 ? 8 : 0),
        channel: 'wire',
        authorId: gmAuthorId(teamId),
        text: renderTemplate(v.text, { team: t.name, city: t.city ?? t.name }),
        facts: {
          kind: 'voice.gmDeadline',
          teamIds: [teamId],
          numbers: { rank, day: ctx.day, stance },
        },
        teamId,
      })
    }
  }

  return out
}
