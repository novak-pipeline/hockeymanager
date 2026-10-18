/**
 * LIVE STORY POOLS — the authored text for the watched game's story layer
 * (liveStory.ts): broadcast lower-thirds, bench-cam vignettes and the
 * intermission room.
 *
 * Rules (game-writing skill §4):
 *  - Every slot is filled from a fact liveStory.ts gathered; a line only
 *    claims what its conditions guarantee.
 *  - Siblings sit at EQUAL specificity (every variant in a bucket carries the
 *    same condition keys), so no single line owns a population.
 *  - Picked with pickStable keyed by the game + the subject, so a rebuilt plan
 *    shows the same line and two games do not.
 *
 * Voices: lower-thirds are the TV graphics desk (terse, a name and a number in
 * every line); bench vignettes are a bench camera described in the present
 * tense; quotes are players talking like players.
 */
import type { ContentVariant } from './contentEngine'

/* ─────────────────────────── lower-thirds (TV) ─────────────────────────── */

/** He brings a point streak into tonight ({n} = games, before tonight). */
export const LT_POINT_STREAK: ContentVariant[] = [
  { id: 'lt.ps.1', text: '{name} has a point in {n} straight games.' },
  { id: 'lt.ps.2', text: '{name} brings a {n}-game point streak into tonight.' },
  { id: 'lt.ps.3', text: '{name}: points in each of his last {n} games, {points} on the season.' },
  { id: 'lt.ps.4', text: '{n} games running on the scoresheet for {name}.' },
  { id: 'lt.ps.5', text: 'Point streak: {name}, {n} games. {goals} goals this season.' },
  { id: 'lt.ps.6', text: '{name} has not been held off the scoresheet in {n} games.' },
]

/** He has a point tonight, so the streak is now {n} (tonight included). */
export const LT_POINT_STREAK_LIVE: ContentVariant[] = [
  { id: 'lt.psl.1', text: 'That makes {n} straight games with a point for {name}.' },
  { id: 'lt.psl.2', text: '{name} stretches his point streak to {n} games.' },
  { id: 'lt.psl.3', text: 'Make it {n} in a row on the scoresheet for {name}.' },
  { id: 'lt.psl.4', text: 'Streak alive: {name} has a point in {n} straight.' },
  { id: 'lt.psl.5', text: '{name} keeps it going. {n} straight games with a point.' },
]

/** {n} straight games without a point, before tonight. */
export const LT_DROUGHT: ContentVariant[] = [
  { id: 'lt.dr.1', text: '{name} has gone {n} games without a point.' },
  { id: 'lt.dr.2', text: '{n} games and counting without a point for {name}.' },
  { id: 'lt.dr.3', text: '{name} is pointless in his last {n}. {points} points on the season.' },
  { id: 'lt.dr.4', text: 'No points in {n} straight games for {name}.' },
  { id: 'lt.dr.5', text: '{name} comes in without a point in his last {n} games.' },
]

/** He has a point tonight after {n} games without one. */
export const LT_DROUGHT_LIVE: ContentVariant[] = [
  { id: 'lt.drl.1', text: '{name} ends a {n}-game drought.' },
  { id: 'lt.drl.2', text: '{name} had gone {n} games without a point. Not anymore.' },
  { id: 'lt.drl.3', text: 'Drought over: {name} gets on the board after {n} games without a point.' },
  { id: 'lt.drl.4', text: '{name} breaks through after {n} pointless games.' },
]

/** Final year of his deal. `ufa` = 27 or older, so unrestricted is certain. */
export const LT_CONTRACT_YEAR: ContentVariant[] = [
  { id: 'lt.cy.u1', conditions: { ufa: true }, text: '{name} is playing out the final year of his deal. {cap} cap hit, unrestricted this summer.' },
  { id: 'lt.cy.u2', conditions: { ufa: true }, text: 'Contract year for {name}: {cap} against the cap, a UFA in July.' },
  { id: 'lt.cy.u3', conditions: { ufa: true }, text: '{name}, {age}, can walk as an unrestricted free agent this summer.{pointsTail}' },
  { id: 'lt.cy.u4', conditions: { ufa: true }, text: 'Last year of the deal for {name}. {cap} cap hit; UFA come July.' },
  { id: 'lt.cy.r1', conditions: { ufa: false }, text: '{name} is in the final year of his deal at {cap}.' },
  { id: 'lt.cy.r2', conditions: { ufa: false }, text: 'Contract year for {name}. His {cap} deal runs out this summer.' },
  { id: 'lt.cy.r3', conditions: { ufa: false }, text: '{name} is playing out the last season of his contract.{pointsTail}' },
  { id: 'lt.cy.r4', conditions: { ufa: false }, text: '{possName} deal expires this summer. {cap} against the cap.' },
]

/** Drafted by the club he plays for, recently. */
export const LT_DRAFTED_OWN: ContentVariant[] = [
  { id: 'lt.do.1', text: '{name} went {pick} overall to the {club} in {year}.' },
  { id: 'lt.do.2', text: 'The {club} took {name} in the {round} round, {pick} overall, in {year}.' },
  { id: 'lt.do.3', text: '{name}: {year} draft, {round} round, {pick} overall.' },
  { id: 'lt.do.4', text: 'A {club} pick: {name}, {pick} overall in {year}.' },
]

/** Tonight's opponent drafted him. */
export const LT_DRAFTED_OPP: ContentVariant[] = [
  { id: 'lt.dx.1', text: '{name} faces the club that drafted him, {pick} overall in {year}.' },
  { id: 'lt.dx.2', text: 'The {club} took {name} {pick} overall in {year}. He is on the other bench tonight.' },
  { id: 'lt.dx.3', text: '{name} was a {club} pick: {round} round, {year}.' },
]

/** He left tonight's opponent. `via` trade / signing (year known), or `past` (the imported
 *  history names the club only: no year, no how). {when} = "this season" / "in 2027". */
export const LT_FORMER_CLUB: ContentVariant[] = [
  { id: 'lt.fc.t1', conditions: { via: 'trade' }, text: '{name} faces the {club}, who traded him {when}.' },
  { id: 'lt.fc.t2', conditions: { via: 'trade' }, text: 'The {club} traded {name} {when}. He is on the other side tonight.' },
  { id: 'lt.fc.t3', conditions: { via: 'trade' }, text: '{name} against the club that moved him {when}.' },
  { id: 'lt.fc.s1', conditions: { via: 'signing' }, text: '{name} left the {club} as a free agent {when}.' },
  { id: 'lt.fc.s2', conditions: { via: 'signing' }, text: '{name} signed away from the {club} {when}. They are tonight\'s opponent.' },
  { id: 'lt.fc.s3', conditions: { via: 'signing' }, text: 'Old club across the ice: {name} walked from the {club} {when}.' },
  { id: 'lt.fc.p1', conditions: { via: 'past' }, text: '{name} faces his former club, the {club}.' },
  { id: 'lt.fc.p2', conditions: { via: 'past' }, text: 'Familiar sweaters across the ice for {name}: the {club} were his last club.' },
  { id: 'lt.fc.p3', conditions: { via: 'past' }, text: '{name} against the {club}, the club he played for before this one.' },
]

/** First NHL season and every NHL game he has played is this season's. */
export const LT_ROOKIE: ContentVariant[] = [
  { id: 'lt.rk.1', text: '{name}, {age}, has {goals} goals and {points} points in his first {games} NHL games.' },
  { id: 'lt.rk.2', text: 'Rookie {name}: {points} points through {games} NHL games.' },
  { id: 'lt.rk.3', text: '{name} is {games} games into his NHL career. {goals} goals, {assists} assists.' },
  { id: 'lt.rk.4', text: 'First NHL season for {name}. {statLine} in {games} games.' },
]

/** Within reach of a round career number. `captain` = he wears the C. */
export const LT_MILESTONE: ContentVariant[] = [
  { id: 'lt.ms.n1', conditions: { captain: false }, text: '{name} is {need} from {target} career {stat}.' },
  { id: 'lt.ms.n2', conditions: { captain: false }, text: '{target} career {stat} is {need} away for {name}.' },
  { id: 'lt.ms.n3', conditions: { captain: false }, text: '{name} sits at {have} career {stat}. {target} is next.' },
  { id: 'lt.ms.c1', conditions: { captain: true }, text: 'Captain {name} is {need} from {target} career {stat}.' },
  { id: 'lt.ms.c2', conditions: { captain: true }, text: '{name}, wearing the C, sits at {have} career {stat}. {target} is next.' },
  { id: 'lt.ms.c3', conditions: { captain: true }, text: '{target} career {stat} within reach for captain {name}: {need} away.' },
]

/** He has a point tonight and is still short of the mark. */
export const LT_MILESTONE_LIVE: ContentVariant[] = [
  { id: 'lt.msl.1', text: '{name} is now {need} from {target} career {stat}.' },
  { id: 'lt.msl.2', text: 'Closer: {name} is {need} short of {target} career {stat}.' },
  { id: 'lt.msl.3', text: '{have} career {stat} for {name}. {target} is {need} away.' },
]

/** Consecutive shutouts coming in. `single` = exactly one. */
export const LT_SHUTOUT_RUN: ContentVariant[] = [
  { id: 'lt.so.s1', conditions: { single: true }, text: '{name} comes in off a shutout.' },
  { id: 'lt.so.s2', conditions: { single: true }, text: '{name} blanked his last opponent. {so} shutouts this season.' },
  { id: 'lt.so.s3', conditions: { single: true }, text: 'Last time out, {name} did not allow a goal.' },
  { id: 'lt.so.m1', conditions: { single: false }, text: '{name} has shut out his last {n} opponents.' },
  { id: 'lt.so.m2', conditions: { single: false }, text: '{n} straight shutouts for {name}.' },
  { id: 'lt.so.m3', conditions: { single: false }, text: '{name} has not allowed a goal in his last {n} starts.' },
]

/** Season shutout total, 3+. */
export const LT_SHUTOUTS: ContentVariant[] = [
  { id: 'lt.sh.1', text: '{name} has {so} shutouts this season.' },
  { id: 'lt.sh.2', text: '{so} shutouts on the season for {name}. {svp} save percentage.' },
  { id: 'lt.sh.3', text: '{name}: {svp}, {so} shutouts this year.' },
]

/** Live: his team has allowed nothing through two periods with him in net. */
export const LT_SHUTOUT_BID: ContentVariant[] = [
  { id: 'lt.sb.1', text: '{name} has a shutout through two periods. {saves} saves.' },
  { id: 'lt.sb.2', text: 'Forty minutes, nothing past {name}. {saves} saves.' },
  { id: 'lt.sb.3', text: '{name} is {saves} for {saves} through two.' },
  { id: 'lt.sb.4', text: 'Shutout watch: {name}, {saves} saves through 40 minutes.' },
]

/** Season series this year. `tied` / led. */
export const LT_SEASON_SERIES: ContentVariant[] = [
  { id: 'lt.ss.l1', conditions: { tied: false }, text: '{leader} lead the season series {w}–{l}. Last meeting: {last}.' },
  { id: 'lt.ss.l2', conditions: { tied: false }, text: '{Meeting} meeting of the season. {leader} {record}.' },
  { id: 'lt.ss.l3', conditions: { tied: false }, text: 'Season series: {leader} {w}, {trailer} {l}. Last time, {last}.' },
  { id: 'lt.ss.t1', conditions: { tied: true }, text: 'Season series tied {w}–{w}. Last meeting: {last}.' },
  { id: 'lt.ss.t2', conditions: { tied: true }, text: '{played} meetings so far, {w} wins apiece.' },
  { id: 'lt.ss.t3', conditions: { tied: true }, text: 'Even season series at {w}–{w}. Last time, {last}.' },
]

/** A registered rivalry. `history` = an all-time record worth quoting. */
export const LT_RIVALRY: ContentVariant[] = [
  { id: 'lt.rv.h1', conditions: { history: true }, text: '{reasons}. All-time: {allTime}.' },
  { id: 'lt.rv.h2', conditions: { history: true }, text: '{allTime} all-time. {reasons}.' },
  { id: 'lt.rv.h3', conditions: { history: true }, text: '{reasons}, and {allTimeLead} all-time.' },
  { id: 'lt.rv.n1', conditions: { history: false }, text: '{reasons}.' },
  { id: 'lt.rv.n2', conditions: { history: false }, text: '{reasons}. {meetingsLine}' },
  { id: 'lt.rv.n3', conditions: { history: false }, text: '{homeAbbr} and {awayAbbr}: {reasonsLower}.' },
]

/* ─────────────────────────── bench cam ─────────────────────────── */

/** Goal against; the captain picks the bench up. state trail|tied, late = final five minutes or OT. */
export const BENCH_CAPTAIN_RALLY: ContentVariant[] = [
  { id: 'b.cr.t1', conditions: { state: 'trail', late: false }, text: '{captain} is up on the bench before the faceoff. “Next shift. We get it back.”' },
  { id: 'b.cr.t2', conditions: { state: 'trail', late: false }, text: '{captain} works down the bench, a word for each guy. {score}.' },
  { id: 'b.cr.t3', conditions: { state: 'trail', late: false }, text: '“Shake it off,” {captain} tells the next line over the boards. {score}.' },
  { id: 'b.cr.t4', conditions: { state: 'trail', late: false }, text: '{captain} bangs his stick on the boards. “Still the {period}. Let\'s go.”' },
  { id: 'b.cr.l1', conditions: { state: 'trail', late: true }, text: '{captain} leans over the boards. “Last push. Everybody.” {score}, {left} to play.' },
  { id: 'b.cr.l2', conditions: { state: 'trail', late: true }, text: '“We\'ve got {left},” {captain} says down the bench. “That\'s enough.”' },
  { id: 'b.cr.l3', conditions: { state: 'trail', late: true }, text: '{captain} is on his feet, talking to the next line out. {score} with {left} left.' },
  { id: 'b.cr.l4', conditions: { state: 'trail', late: true }, text: '{captain} slaps the boards. “One. We need one.” {left} on the clock.' },
  { id: 'b.cr.e1', conditions: { state: 'tied', late: false }, text: '{captain} taps the boards with his stick. “New game. Our shift now.”' },
  { id: 'b.cr.e2', conditions: { state: 'tied', late: false }, text: 'Tied again at {score}. {captain} is already talking to the next line.' },
  { id: 'b.cr.e3', conditions: { state: 'tied', late: false }, text: '“Nothing\'s changed,” {captain} says as the line comes off. {score}.' },
  { id: 'b.cr.e4', conditions: { state: 'tied', late: false }, text: '{captain} stands up on the bench. “Reset. Win the next draw.”' },
  { id: 'b.cr.f1', conditions: { state: 'tied', late: true }, text: 'Tied with {left} to play. {captain} is up on the bench, talking to the next line.' },
  { id: 'b.cr.f2', conditions: { state: 'tied', late: true }, text: '“{left}. Whoever wants it,” {captain} says down the bench.' },
  { id: 'b.cr.f3', conditions: { state: 'tied', late: true }, text: '{captain} leans over the boards. “Next goal. That\'s all this is now.”' },
  { id: 'b.cr.f4', conditions: { state: 'tied', late: true }, text: '{captain} gets the bench up. {score}, {left} left.' },
]

/** His turnover led to a goal against. how: giveaway | pass (picked off). */
export const BENCH_TURNOVER: ContentVariant[] = [
  { id: 'b.to.g1', conditions: { how: 'giveaway' }, text: '{name} comes off and slams his stick on the boards. His giveaway {where} started that one.' },
  { id: 'b.to.g2', conditions: { how: 'giveaway' }, text: '{name} drops onto the bench and stares at the floor. He coughed it up {where}; {scorer} scored {secs} seconds later.' },
  { id: 'b.to.g3', conditions: { how: 'giveaway' }, text: '{name} whacks his stick on the bench door. The puck came off his stick {where}.' },
  { id: 'b.to.g4', conditions: { how: 'giveaway' }, text: 'Nobody says anything to {name}. His turnover {where}, and {scorer} made it count.' },
  { id: 'b.to.p1', conditions: { how: 'pass' }, text: '{name} slams his stick on the boards. His pass {where} got picked off, and {scorer} scored {secs} seconds later.' },
  { id: 'b.to.p2', conditions: { how: 'pass' }, text: '{name} sits down hard. {interceptor} read his pass {where}; {scorer} finished it.' },
  { id: 'b.to.p3', conditions: { how: 'pass' }, text: '{name} stares at the floor of the bench. His pass {where} went the other way.' },
  { id: 'b.to.p4', conditions: { how: 'pass' }, text: 'A stick bangs the boards: {name}. His pass got picked off {where}, and {scorer} scored off it.' },
]

/** A power-play goal against while he sat for the penalty. */
export const BENCH_BOX: ContentVariant[] = [
  { id: 'b.bx.n1', conditions: { named: true }, text: '{name} watches it from the penalty box. His {infraction} minor, and {scorer} scored on the power play.' },
  { id: 'b.bx.n2', conditions: { named: true }, text: '{name} hangs his head in the box. The {infraction} call cost a goal.' },
  { id: 'b.bx.n3', conditions: { named: true }, text: '{scorer} scores with {name} in the box for {infraction}.' },
  { id: 'b.bx.n4', conditions: { named: true }, text: 'In the box, {name} looks up at the board. His {infraction} minor just cost the team a goal.' },
  { id: 'b.bx.u1', conditions: { named: false }, text: '{name} watches it from the penalty box. {scorer} scored on the power play his minor handed them.' },
  { id: 'b.bx.u2', conditions: { named: false }, text: '{name} hangs his head in the box. His minor just cost a goal.' },
  { id: 'b.bx.u3', conditions: { named: false }, text: '{scorer} scores with {name} still in the box.' },
  { id: 'b.bx.u4', conditions: { named: false }, text: '{name} slaps the glass in the penalty box. {possScorer} power-play goal came on his minor.' },
]

/** NHL debut tonight; he is next over the boards for his first shift. */
export const BENCH_DEBUT: ContentVariant[] = [
  { id: 'b.db.1', text: '{name} is next over the boards. His first NHL shift.' },
  { id: 'b.db.2', text: '{name} bounces on his skates at the gate. First NHL shift coming up.' },
  { id: 'b.db.3', text: 'First NHL shift for {name}. He is {age}, and he is up next.' },
  { id: 'b.db.4', text: '{name} grabs a water bottle, puts it down, grabs it again. First NHL shift.' },
  { id: 'b.db.5', text: 'A tap on the pads from the guy beside him, and {name} is up. First shift in the NHL.' },
]

/** He has not had a shift since {when} ("5:42 of the third" / "the opening faceoff of the third"), 8+ minutes of play. */
export const BENCH_BENCHED: ContentVariant[] = [
  { id: 'b.bn.1', text: '{name} has not been over the boards since {when}.' },
  { id: 'b.bn.2', text: '{name} last took a shift at {when}.' },
  { id: 'b.bn.3', text: '{name} is still waiting for a shift. His last one started at {when}.' },
  { id: 'b.bn.4', text: '{name}, stick across his knees, has been on the bench since {when}.' },
  { id: 'b.bn.5', text: 'No shift for {name} since {when}.' },
]

/** He is sore with you, and remembers why. kind scratched|buried. {note} is the morale memory line. */
export const BENCH_SORE: ContentVariant[] = [
  { id: 'b.so.s1', conditions: { kind: 'scratched' }, text: '{name} glances down the bench toward you. {note}.' },
  { id: 'b.so.s2', conditions: { kind: 'scratched' }, text: '{name} catches your eye from the end of the bench, then looks away. {note}.' },
  { id: 'b.so.s3', conditions: { kind: 'scratched' }, text: '{name} is back in the lineup tonight, and he has not forgotten. {note}.' },
  { id: 'b.so.b1', conditions: { kind: 'buried' }, text: '{name} looks over at you after his shift. {note}.' },
  { id: 'b.so.b2', conditions: { kind: 'buried' }, text: '{name} gives you a look on his way back to the bench. {note}.' },
  { id: 'b.so.b3', conditions: { kind: 'buried' }, text: '{name} sits down without a word and stares at the clock. {note}.' },
]

/** Feuding teammates on the ice together. */
export const BENCH_FEUD_SHIFT: ContentVariant[] = [
  { id: 'b.fs.1', text: '{a} and {b} are out together. They have been at odds since {since}.' },
  { id: 'b.fs.2', text: 'Same shift for {a} and {b}. Their feud dates to {since}.' },
  { id: 'b.fs.3', text: '{a} and {b} on the ice at once. It has been tense between them since {since}.' },
]

/** Feuding teammates both credited on our goal. */
export const BENCH_FEUD_GOAL: ContentVariant[] = [
  { id: 'b.fg.1', text: '{a} and {b} both get points on that one. They have been at odds since {since}.' },
  { id: 'b.fg.2', text: 'Whatever has been going on between {a} and {b} since {since}, it worked there.' },
  { id: 'b.fg.3', text: '{a} and {b} combine for a goal. They have not been getting along since {since}.' },
  { id: 'b.fg.4', text: 'Goal, and it took {a} and {b} together to get it. The two have been at odds since {since}.' },
]

/* ─────────────────────────── the room (intermission) ─────────────────────────── */

/** A veteran speaks before the next period. state lead|trail|tied. */
export const ROOM_VETERAN: ContentVariant[] = [
  { id: 'r.v.t1', conditions: { state: 'trail' }, text: '{name} speaks up before the {next}. “We\'re down {deficitWord}. One shift at a time.”' },
  { id: 'r.v.t2', conditions: { state: 'trail' }, text: '{name} is first on his feet. “Twenty minutes. Get pucks deep and make them turn around.”' },
  { id: 'r.v.t3', conditions: { state: 'trail' }, text: '{intro} does the talking: “Nobody hangs their head. It\'s a {deficitWord}-goal game.”' },
  { id: 'r.v.t4', conditions: { state: 'trail' }, text: '“First goal of the {next} is ours,” {name} says. The room nods.' },
  { id: 'r.v.l1', conditions: { state: 'lead' }, text: '{name} stands up. “Same again. Nobody sits on it.”' },
  { id: 'r.v.l2', conditions: { state: 'lead' }, text: '{intro} keeps it short: “The next goal matters most.”' },
  { id: 'r.v.l3', conditions: { state: 'lead' }, text: '“Twenty more like that,” {name} says. “Don\'t let them back in.”' },
  { id: 'r.v.l4', conditions: { state: 'lead' }, text: '{name} goes around the room. “Play the {next} like it\'s nothing-nothing.”' },
  { id: 'r.v.e1', conditions: { state: 'tied' }, text: '{name} speaks first. “Twenty minutes. Whoever wants it.”' },
  { id: 'r.v.e2', conditions: { state: 'tied' }, text: '“We\'re right there,” {name} says. “Simple plays. Win the walls.”' },
  { id: 'r.v.e3', conditions: { state: 'tied' }, text: '{intro} speaks up: “Get the first one in the {next}.”' },
  { id: 'r.v.e4', conditions: { state: 'tied' }, text: '{name} keeps it short. “Even game. Make it our pace.”' },
]

/** The trainer on a man who is out. */
export const ROOM_TRAINER: ContentVariant[] = [
  { id: 'r.tr.1', text: 'No change on {name}: {injury}, {gamesMore} by the trainer\'s count.' },
  { id: 'r.tr.2', text: 'From the trainer\'s room: {name} ({injury}) is {gamesAway} away.' },
  { id: 'r.tr.3', text: 'The trainer on {name}: {injury}. He is still {gamesAway} out.' },
  { id: 'r.tr.4', text: '{name} is still {gamesAway} out, the trainer says. {injuryCap}.' },
]

/** Every pool, for the coverage tests and the prose audit. */
export const LIVE_STORY_POOLS: Record<string, ContentVariant[]> = {
  LT_POINT_STREAK, LT_POINT_STREAK_LIVE, LT_DROUGHT, LT_DROUGHT_LIVE, LT_CONTRACT_YEAR,
  LT_DRAFTED_OWN, LT_DRAFTED_OPP, LT_FORMER_CLUB, LT_ROOKIE, LT_MILESTONE, LT_MILESTONE_LIVE,
  LT_SHUTOUT_RUN, LT_SHUTOUTS, LT_SHUTOUT_BID, LT_SEASON_SERIES, LT_RIVALRY,
  BENCH_CAPTAIN_RALLY, BENCH_TURNOVER, BENCH_BOX, BENCH_DEBUT, BENCH_BENCHED, BENCH_SORE,
  BENCH_FEUD_SHIFT, BENCH_FEUD_GOAL, ROOM_VETERAN, ROOM_TRAINER,
}
