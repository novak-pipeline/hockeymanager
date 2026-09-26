/**
 * Season Wrapped — the authored copy (docs/SEASON-WRAPPED.md).
 *
 * Hades-model pools, one per card kind, picked with {@link pickStable} keyed on
 * `${year}:${kind}:${subject}` so a card reads the same every time the yearbook
 * reopens it, and different years/subjects get different phrasings. `text` is
 * the card headline, `text2` the body.
 *
 * House rules for this file (owner: "a hockey writer, not a spreadsheet"):
 *  - The big number lives on the card (hero/stats). The prose says what it
 *    MEANT. A body line never lists a stat line the card already shows.
 *  - Specific over grand. No "journey", "testament", "showcased", "a season to
 *    remember". Short declaratives; the odd fragment is fine.
 *  - Author siblings at EQUAL specificity (project_content-pool-craft: the most
 *    specific eligible variant wins every time, so a lone 3-condition line
 *    would be the only line a state ever shows).
 */
import type { ContentVariant } from './contentEngine'

type Pool = ContentVariant[]

/* ── YOUR YEAR ─────────────────────────────────────────────────────────── */

/** ctx: result = 'champ' | 'final' | 'semi' | 'second' | 'first' | 'missed'; vsPick = 'over' | 'under' | 'par' */
export const RUN_POOL: Pool = [
  { id: 'run-champ-1', conditions: { result: 'champ' }, text: 'Champions.', text2: '{springWinsCap} wins in the spring. {seriesLine} Somebody go find a ladder for the banner.' },
  { id: 'run-champ-2', conditions: { result: 'champ' }, text: 'You won the whole thing.', text2: '{seriesLine} The {teamShort} are the last team standing, and nobody gets to take that back.' },
  { id: 'run-champ-3', conditions: { result: 'champ', vsPick: 'over' }, text: 'Nobody picked you. You won it anyway.', text2: 'The September previews had the {teamShort} {predicted}. {seriesLine} Frame the previews.' },
  { id: 'run-champ-4', conditions: { result: 'champ', vsPick: 'over' }, text: 'From {predicted} in the previews to the parade route.', text2: '{seriesLine} The only prediction that mattered was the last one.' },
  { id: 'run-final-1', conditions: { result: 'final' }, text: 'Two wins short.', text2: '{seriesLine} The {oppShort} took the Cup in the Final. That one will sting all summer.' },
  { id: 'run-final-2', conditions: { result: 'final' }, text: 'All the way to the Final.', text2: '{seriesLine} It ended against the {oppShort}, one series from everything.' },
  { id: 'run-semi-1', conditions: { result: 'semi' }, text: 'A conference final. Then the {oppShort}.', text2: '{seriesLine} Final four in the league. The last step is the steepest.' },
  { id: 'run-semi-2', conditions: { result: 'semi' }, text: 'Three rounds deep.', text2: '{seriesLine} The {oppShort} closed the door one round from the Final.' },
  { id: 'run-second-1', conditions: { result: 'second' }, text: 'Won a round. Lost the next.', text2: '{seriesLine} A real playoff run, cut off in the second round by the {oppShort}.' },
  { id: 'run-second-2', conditions: { result: 'second' }, text: 'Out in round two.', text2: '{seriesLine} Enough to taste it. Not enough to keep it.' },
  { id: 'run-first-1', conditions: { result: 'first' }, text: 'In, and out quickly.', text2: '{seriesLine} The {oppShort} ended it in the first round.' },
  { id: 'run-first-2', conditions: { result: 'first', vsPick: 'over', forecastOut: true }, text: 'A playoff spot nobody forecast.', text2: 'Picked {predicted} in September, the {teamShort} got in. {seriesLine}' },
  { id: 'run-first-5', conditions: { result: 'first', vsPick: 'over', forecastOut: true }, text: 'In the dance, against the odds.', text2: 'The previews had the {teamShort} {predicted} and on the outside. {seriesLine} The spring was short; the season was not a failure.' },
  { id: 'run-first-6', conditions: { result: 'first', vsPick: 'over' }, text: 'Better than billed. Out early anyway.', text2: 'Picked {predicted}, finished {rank}. {seriesLine} The regular season said one thing; the first round said another.' },
  { id: 'run-first-7', conditions: { result: 'first', vsPick: 'over' }, text: 'A big regular season, a short spring.', text2: 'Finished {rank} after a {predicted}-place forecast. {seriesLine}' },
  { id: 'run-first-3', conditions: { result: 'first', vsPick: 'under' }, text: 'Expected more than one round.', text2: '{seriesLine} The previews had this group {predicted}. The spring did not agree.' },
  { id: 'run-first-4', conditions: { result: 'first', vsPick: 'par' }, text: 'One-and-done.', text2: '{seriesLine} A first-round exit is still an exit.' },
  { id: 'run-missed-1', conditions: { result: 'missed' }, text: 'No spring hockey.', text2: 'The {teamShort} finished {rank}{missedLine} The golf courses open early.' },
  { id: 'run-missed-2', conditions: { result: 'missed', vsPick: 'under' }, text: 'This was supposed to go better.', text2: 'Picked {predicted}, finished {rank}{missedLine} That gap is the whole summer’s conversation.' },
  { id: 'run-missed-3', conditions: { result: 'missed', vsPick: 'over' }, text: 'Better than billed, still on the outside.', text2: 'Picked {predicted}, finished {rank}{missedLine} Progress, of the kind that does not sell playoff tickets.' },
  { id: 'run-missed-4', conditions: { result: 'missed', vsPick: 'par' }, text: 'About what everyone expected.', text2: 'Picked {predicted}, finished {rank}{missedLine} No surprises, in either direction.' },
]

/** ctx: role = 'skater' | 'goalie'; share = 'huge' | 'big' | 'normal'; award = true/false */
export const MVP_POOL: Pool = [
  { id: 'mvp-sk-1', conditions: { role: 'skater', share: 'big' }, text: 'Your best player was {player}.', text2: 'He had a hand in {shareWords} the goals this club scored. When he went quiet, so did the team.' },
  { id: 'mvp-sk-2', conditions: { role: 'skater', share: 'big' }, text: '{player} carried the mail.', text2: 'The offence ran through him all year: {shareWords} the goals had his fingerprints on them.' },
  { id: 'mvp-sk-7', conditions: { role: 'skater', share: 'normal' }, text: 'Your leading scorer: {player}.', text2: 'Nobody on the roster put up more. On a team that spread it around, he was the one opponents circled.' },
  { id: 'mvp-sk-8', conditions: { role: 'skater', share: 'normal' }, text: '{player} led the way.', text2: 'The top of your scoring chart all year, and the first name on the power-play sheet.' },
  { id: 'mvp-sk-3', conditions: { role: 'skater', share: 'huge' }, text: '{player}, and then everybody else.', text2: 'He was in on {shareWords} the goals. That is star power, and it is also a warning about the depth chart.' },
  { id: 'mvp-sk-4', conditions: { role: 'skater', share: 'huge' }, text: 'The {teamShort} offence had one address.', text2: '{player} was in on {shareWords} the goals. Opponents knew it and still could not stop it.' },
  { id: 'mvp-sk-5', conditions: { role: 'skater', award: true }, text: '{player}: the league noticed too.', text2: 'He walked away with the {awardName}. Around the league they finally say his name the way you do.' },
  { id: 'mvp-sk-6', conditions: { role: 'skater', award: true }, text: 'Hardware for {player}.', text2: 'The {awardName} is his, and it came home in your sweater.' },
  { id: 'mvp-g-1', conditions: { role: 'goalie' }, text: '{player} held the building up.', text2: 'On the nights the skaters had nothing, the goalie was the plan. It worked more often than it should have.' },
  { id: 'mvp-g-2', conditions: { role: 'goalie' }, text: 'In goal, {player}. That was the season.', text2: 'The team in front of him was ordinary. He was not.' },
  { id: 'mvp-g-3', conditions: { role: 'goalie', award: true }, text: 'The {awardName} lives in your crease.', text2: '{player} was the best at the hardest job in the sport, and he did it in your sweater.' },
  { id: 'mvp-g-4', conditions: { role: 'goalie', award: true }, text: '{player} took the {awardName}.', text2: 'Every coach in the league game-planned around him. Few of them solved it.' },
]

/** ctx: kind = 'jump' | 'rookie' */
export const BREAKOUT_POOL: Pool = [
  { id: 'bo-jump-1', conditions: { kind: 'jump' }, text: '{player} arrived.', text2: 'Last year he was a name on the depth chart. This year he was a reason to buy a ticket.' },
  { id: 'bo-jump-2', conditions: { kind: 'jump' }, text: 'The leap: {player}.', text2: 'Same sweater, different player. Whatever he worked on last summer, he should do it again.' },
  { id: 'bo-jump-3', conditions: { kind: 'jump' }, text: 'Nobody took a bigger step than {player}.', text2: 'He went from filling a slot to filling the scoresheet.' },
  { id: 'bo-rook-1', conditions: { kind: 'rookie' }, text: 'Rookie year: {player}.', text2: 'A first season that looked nothing like a first season. He is {age}. Settle in.' },
  { id: 'bo-rook-2', conditions: { kind: 'rookie' }, text: 'Meet {player}.', text2: 'He is {age}, it was his first year, and by the spring he was one of your best {posPlural}.' },
  { id: 'bo-rook-3', conditions: { kind: 'rookie' }, text: 'The kid, {player}.', text2: 'At {age} he played like he had been here five years. The next contract talk will not be cheap.' },
]

/** ctx: verdict = 'won' | 'lost' | 'even' | 'early' */
export const YOUR_TRADE_POOL: Pool = [
  { id: 'yt-won-1', conditions: { verdict: 'won' }, text: 'Your biggest deal. It worked.', text2: '{summary} {gotName} gave you more than {gaveName} gave them, and it was not close.' },
  { id: 'yt-won-2', conditions: { verdict: 'won' }, text: 'The trade that paid off.', text2: '{summary} The return outplayed the price, which is the whole job.' },
  { id: 'yt-lost-1', conditions: { verdict: 'lost' }, text: 'Your biggest deal. Hm.', text2: '{summary} So far, {gaveName} has done more for them than {gotName} has done for you.' },
  { id: 'yt-lost-2', conditions: { verdict: 'lost' }, text: 'The trade people will bring up.', text2: '{summary} Early returns favour the other side. Early, but not nothing.' },
  { id: 'yt-even-1', conditions: { verdict: 'even' }, text: 'Your biggest deal of the year.', text2: '{summary} Both sides got about what they paid for. Ask again in two years.' },
  { id: 'yt-even-2', conditions: { verdict: 'even' }, text: 'The move of the year.', text2: '{summary} No clear winner yet, which usually means a fair price.' },
  { id: 'yt-buyhit-1', conditions: { verdict: 'buyHit' }, text: 'You paid in futures. {gotName} paid you back.', text2: '{summary} The picks may turn into something one day. He already did.' },
  { id: 'yt-buyhit-2', conditions: { verdict: 'buyHit' }, text: 'Your biggest deal. It worked.', text2: '{summary} Whatever those picks become, the return showed up this year.' },
  { id: 'yt-buy-1', conditions: { verdict: 'buy' }, text: 'Your biggest deal of the year.', text2: '{summary} The price was the future. The return has not justified it yet.' },
  { id: 'yt-buy-2', conditions: { verdict: 'buy' }, text: 'Futures for now.', text2: '{summary} So far the now has been quieter than hoped.' },
  { id: 'yt-sell-1', conditions: { verdict: 'sell' }, text: 'You cashed in {gaveName}.', text2: '{summary} The picks are a promise. Keep the receipt.' },
  { id: 'yt-sell-2', conditions: { verdict: 'sell' }, text: 'A bet on the future.', text2: '{summary} The payoff, if it comes, comes later.' },
  { id: 'yt-early-1', conditions: { verdict: 'early' }, text: 'Your biggest deal of the year.', text2: '{summary} Picks for picks. Nobody can grade this one yet.' },
  { id: 'yt-early-2', conditions: { verdict: 'early' }, text: 'Futures for futures.', text2: '{summary} Ask again in five years.' },
]

/** ctx: kind = 'bargain' | 'star' */
export const SIGNING_POOL: Pool = [
  { id: 'sg-barg-1', conditions: { kind: 'bargain' }, text: 'Best money you spent: {player}.', text2: 'Signed for {salaryWords}. Played like a man paid twice that.' },
  { id: 'sg-barg-2', conditions: { kind: 'bargain' }, text: '{player} was a steal.', text2: 'The contract was modest. The production was not.' },
  { id: 'sg-star-1', conditions: { kind: 'star' }, text: 'The big signing delivered.', text2: '{player} came in at {salaryWords} with a lot riding on it, and earned every dollar.' },
  { id: 'sg-star-2', conditions: { kind: 'star' }, text: '{player}: worth it.', text2: 'Big contracts come with big expectations. He cleared them.' },
]

/** ctx: kind = 'signing' | 'trade' */
export const WORST_CALL_POOL: Pool = [
  { id: 'wc-sign-1', conditions: { kind: 'signing' }, text: 'The one you would take back.', text2: '{player} signed for {salaryWords} and gave you very little for it. That cap space had other uses.' },
  { id: 'wc-sign-2', conditions: { kind: 'signing' }, text: 'Not every signing lands.', text2: '{player} at {salaryWords} was the swing that missed.' },
  { id: 'wc-trade-1', conditions: { kind: 'trade' }, text: 'The one that got away.', text2: 'You moved {player} to the {oppShort}. He had the kind of year you were hoping someone on your roster would have.' },
  { id: 'wc-trade-2', conditions: { kind: 'trade' }, text: 'You traded {player}. He noticed.', text2: 'He spent the year proving the {oppShort} right and you wrong.' },
]

/** ctx: stat = 'depth' | 'oneman' | 'shutouts' | 'overtime' | 'differential' | 'leaky' | 'rookies' */
export const STAT_POOL: Pool = [
  { id: 'st-depth-1', conditions: { stat: 'depth' }, text: 'Scoring by committee.', text2: '{count} different players reached twenty goals. Shut one line down and the next one beat you.' },
  { id: 'st-depth-2', conditions: { stat: 'depth' }, text: 'Everybody scored.', text2: 'Twenty-goal men all through the lineup. Matchups were somebody else’s problem.' },
  { id: 'st-oneman-1', conditions: { stat: 'oneman' }, text: 'A one-man offence.', text2: 'Nobody else on the roster got to twenty goals. {player} was the only real threat, and the league knew it.' },
  { id: 'st-oneman-2', conditions: { stat: 'oneman' }, text: 'Find him some help.', text2: '{player} did the scoring. The rest of the roster watched.' },
  { id: 'st-so-1', conditions: { stat: 'shutouts' }, text: 'Doughnuts.', text2: '{player} kept a clean sheet {countWords} times. Some nights the other team simply was not getting one.' },
  { id: 'st-so-2', conditions: { stat: 'shutouts' }, text: 'The wall.', text2: '{countWords} shutouts from {player}. Opponents left the rink wondering what they did wrong.' },
  { id: 'st-ot-1', conditions: { stat: 'overtime' }, text: 'You lived in overtime.', text2: 'Loser points piled up all year. Close is a nice word for it.' },
  { id: 'st-ot-2', conditions: { stat: 'overtime' }, text: 'So close, so often.', text2: 'A season of three-on-three and shootouts, and too many of them went the wrong way.' },
  { id: 'st-gd-1', conditions: { stat: 'differential' }, text: 'Dominant, and the math agrees.', text2: 'The goal differential was among the best in the league. These were not lucky wins.' },
  { id: 'st-gd-2', conditions: { stat: 'differential' }, text: 'Not a fluke.', text2: 'You outscored the league by a margin that does not happen by accident.' },
  { id: 'st-leak-1', conditions: { stat: 'leaky' }, text: 'The goals against.', text2: 'The puck went in too often at the wrong end. Defence is the first line on the summer to-do list.' },
  { id: 'st-leak-2', conditions: { stat: 'leaky' }, text: 'A long year for the goalies.', text2: 'The differential tells you everything the standings already did.' },
  { id: 'st-rook-1', conditions: { stat: 'rookies' }, text: 'The kids played.', text2: 'Rookies carried a real share of the scoring. The future showed up early.' },
  { id: 'st-rook-2', conditions: { stat: 'rookies' }, text: 'Youth movement, for real.', text2: 'A good chunk of the offence came from players in their first season.' },
]

/* ── THE LEAGUE’S YEAR ─────────────────────────────────────────────────── */

/** ctx: kind = 'favourite' | 'longshot' | 'normal'; sweep = true/false */
export const CHAMPION_POOL: Pool = [
  { id: 'ch-norm-1', conditions: { kind: 'normal' }, text: 'The {teamShort} won the Cup.', text2: 'They beat the {oppShort} in the Final. Everyone else starts over in September.' },
  { id: 'ch-norm-2', conditions: { kind: 'normal' }, text: 'Champions: the {teamShort}.', text2: 'The Final went to them over the {oppShort}. {springWinsCap} playoff wins, and a summer of parades.' },
  { id: 'ch-fav-1', conditions: { kind: 'favourite' }, text: 'The favourites held serve.', text2: 'The {teamShort} were the best team in the regular season and the last one standing. They beat the {oppShort} to finish it.' },
  { id: 'ch-fav-2', conditions: { kind: 'favourite' }, text: 'The {teamShort}, as advertised.', text2: 'Best in the standings, best in the spring. The {oppShort} were the last to find out.' },
  { id: 'ch-long-1', conditions: { kind: 'longshot' }, text: 'Nobody saw the {teamShort} coming.', text2: 'They finished {rank} in the standings and won the whole thing anyway, beating the {oppShort} in the Final.' },
  { id: 'ch-long-2', conditions: { kind: 'longshot' }, text: 'A {rank}-place team lifted the Cup.', text2: 'The {teamShort} spent the regular season in the pack and the spring in charge. The {oppShort} could not stop it either.' },
  { id: 'ch-sweep-1', conditions: { kind: 'normal', sweep: true }, text: 'The {teamShort} swept the Final.', text2: 'Four straight over the {oppShort}. It was not a series so much as a coronation.' },
  { id: 'ch-sweep-2', conditions: { kind: 'normal', sweep: true }, text: 'Four and done.', text2: 'The {teamShort} won the Cup without dropping a game in the Final. The {oppShort} never got a foothold.' },
]

export const UPSET_POOL: Pool = [
  { id: 'up-1', text: 'Upset of the spring.', text2: 'The {teamShort} finished well behind the {oppShort} in the standings and knocked them out anyway, {result}.' },
  { id: 'up-2', text: 'Bracket-buster: the {teamShort}.', text2: 'On paper the {oppShort} should have walked through. The series was played on ice.' },
  { id: 'up-3', text: 'The {oppShort} went home early.', text2: 'A season near the top of the league, undone in {roundName} by the {teamShort}.' },
]

/** ctx: user = true/false; lottery = true/false */
export const FIRST_OVERALL_POOL: Pool = [
  { id: 'fo-1', conditions: { user: false }, text: 'First overall: {player}.', text2: 'The {teamShort} made him the first name called. Now comes the hard part: everything after.' },
  { id: 'fo-2', conditions: { user: false }, text: 'The {teamShort} took {player}.', text2: 'The first name off the board. The next decade of that franchise just got a face.' },
  { id: 'fo-3', conditions: { user: false, lottery: true }, text: 'The lottery gave the {teamShort} {player}.', text2: 'They jumped the line on draft-lottery night and took the top prospect in the class.' },
  { id: 'fo-4', conditions: { user: false, lottery: true }, text: 'Ping-pong balls, then {player}.', text2: 'The {teamShort} won the lottery and did not overthink the pick.' },
  { id: 'fo-5', conditions: { user: true }, text: 'You took {player} first overall.', text2: 'The top pick in the draft is yours. So is the pressure that comes with it.' },
  { id: 'fo-6', conditions: { user: true }, text: 'Number one: {player}. Yours.', text2: 'A franchise does not get this chance often. You have him now.' },
]

/** ctx: userWinner = true/false */
export const AWARDS_POOL: Pool = [
  { id: 'aw-1', conditions: { userWinner: false }, text: 'The hardware.', text2: '{mvp} is the league’s most valuable player. The rest of the trophies went where the ballots said.' },
  { id: 'aw-2', conditions: { userWinner: false }, text: 'Awards night.', text2: '{mvp} took the MVP. None of the silverware went home with your club this time.' },
  { id: 'aw-3', conditions: { userWinner: true, userMvp: false }, text: 'Awards night, with your name in it.', text2: '{mvp} is the MVP. {userWinners} made sure your club had someone on the stage.' },
  { id: 'aw-4', conditions: { userWinner: true, userMvp: false }, text: 'The hardware, and some of it is yours.', text2: '{userWinners} brought a trophy home. {mvp} was named the league’s most valuable player.' },
  { id: 'aw-5', conditions: { userWinner: true, userMvp: true }, text: 'The MVP plays for you.', text2: '{mvp} is the most valuable player in the league. {otherWinners}' },
  { id: 'aw-6', conditions: { userWinner: true, userMvp: true }, text: 'Awards night belonged to your club.', text2: 'The Hart went to {mvp}. {otherWinners}' },
]

export const RECORD_POOL: Pool = [
  { id: 'rec-1', text: 'The record book changed.', text2: '{player} went past {prevName}’s mark from {prevYear}. {other}' },
  { id: 'rec-2', text: '{player} rewrote the book.', text2: 'The old record belonged to {prevName}, set in {prevYear}. It does not anymore. {other}' },
  { id: 'rec-3', text: 'A new number to chase.', text2: '{player} took the single-season mark from {prevName} ({prevYear}). {other}' },
]

export const MILESTONE_POOL: Pool = [
  { id: 'ms-1', text: 'Round numbers.', text2: 'The career counters ticked past some big ones. {lead}' },
  { id: 'ms-2', text: 'Milestone year.', text2: '{lead} The kind of numbers that end up on a banner.' },
]

export const RETIREMENT_POOL: Pool = [
  { id: 'ret-1', text: 'Last shifts.', text2: '{lead} hung up the skates after {seasonsWords} seasons. {others}' },
  { id: 'ret-2', text: 'Goodbye, {leadShort}.', text2: '{seasonsWordsCap} seasons, and a spot in every conversation about his era. {others}' },
  { id: 'ret-3', text: 'The league lost some history.', text2: '{lead} retired. {others}' },
]

/** ctx: veteran = true/false (31+) */
export const LEAGUE_BREAKOUT_POOL: Pool = [
  { id: 'lb-1', conditions: { veteran: false }, text: 'The breakout nobody saw coming.', text2: '{player} of the {teamShort} went from a quiet year to one of the best in the league.' },
  { id: 'lb-2', conditions: { veteran: false }, text: 'Where did {player} come from?', text2: 'The {teamShort} {posWord} was an afterthought last season. Nobody is overlooking him now.' },
  { id: 'lb-3', conditions: { veteran: false }, text: '{player} found another gear.', text2: 'A few pundits had him as a depth piece. He made them delete that column.' },
  { id: 'lb-4', conditions: { veteran: true }, text: '{player} turned back the clock.', text2: 'At {age}, the {teamShort} {posWord} was supposed to be winding down. Instead he had the best year anyone can remember him having.' },
  { id: 'lb-5', conditions: { veteran: true }, text: 'Old man, new tricks.', text2: '{player} is {age}. Somebody forgot to tell him, and the {teamShort} are not about to.' },
]

/** ctx: cup = true/false */
export const LEAGUE_TRADE_POOL: Pool = [
  { id: 'lt-1', conditions: { cup: false }, text: 'The biggest deal in the league.', text2: '{summary}' },
  { id: 'lt-2', conditions: { cup: false }, text: 'The trade everyone talked about.', text2: '{summary}' },
  { id: 'lt-3', conditions: { cup: true }, text: 'The trade that won a Cup.', text2: '{summary} The {teamShort} went and finished the job.' },
  { id: 'lt-4', conditions: { cup: true }, text: 'Go-for-it, and it went.', text2: '{summary} A few months later the {teamShort} were champions.' },
]

export const COACHING_POOL: Pool = [
  { id: 'cc-1', text: 'The carousel turned.', text2: '{lead} Benches and front offices around the league do not look like they did in September.' },
  { id: 'cc-2', text: 'New faces behind the bench.', text2: '{lead} Patience was in short supply this year.' },
]

/* ── HISTORY ───────────────────────────────────────────────────────────── */

/** ctx: found = true/false (a prior mark exists in the book) */
export const SINCE_POOL: Pool = [
  { id: 'since-1', conditions: { found: true }, text: 'First {mark} since {sinceYear}.', text2: '{player} of the {teamShort} did something this league had not seen in {gapWords}.' },
  { id: 'since-2', conditions: { found: true }, text: '{gapWordsCap} without one. Then {player}.', text2: 'The last {mark} was in {sinceYear}. {player} ended the wait.' },
  { id: 'since-3', conditions: { found: false }, text: 'A {mark}.', text2: '{player} did something nobody has done in {depthWords} of league records.' },
  { id: 'since-4', conditions: { found: false }, text: 'Not in living memory.', text2: 'No {mark} in {depthWords} of league records. Until {player}.' },
]

export const DROUGHT_POOL: Pool = [
  { id: 'dr-1', text: 'The drought is over.', text2: 'The {teamShort} last won it in {lastYear}. {gapWordsCap} of waiting ended this spring.' },
  { id: 'dr-2', text: '{gapWordsCap}. Over.', text2: 'The {teamShort} had not won since {lastYear}. Somewhere, a fan is crying into an old sweater.' },
]

export const FIRST_CUP_POOL: Pool = [
  { id: 'fc-1', text: 'A franchise first.', text2: 'In {depthWords} of recorded history the {teamShort} had never won it. Now they have.' },
  { id: 'fc-2', text: 'Never before. Now.', text2: 'The {teamShort} have their first championship in {depthWords} of league records.' },
]

/** ctx: kind = 'repeat' | 'threepeat' | 'dynasty' */
export const DYNASTY_POOL: Pool = [
  { id: 'dy-rep-1', conditions: { kind: 'repeat' }, text: 'Back-to-back.', text2: 'The {teamShort} won it again. Repeating in a capped league is supposed to be impossible.' },
  { id: 'dy-rep-2', conditions: { kind: 'repeat' }, text: 'Two in a row for the {teamShort}.', text2: 'Everyone had a year to figure them out. Nobody did.' },
  { id: 'dy-3p-1', conditions: { kind: 'threepeat' }, text: 'Three straight.', text2: 'The {teamShort} have won the last three championships. This is a dynasty, and it is no longer up for debate.' },
  { id: 'dy-3p-2', conditions: { kind: 'threepeat' }, text: 'Dynasty.', text2: 'A third consecutive title for the {teamShort}. The rest of the league is playing for second.' },
  { id: 'dy-dyn-1', conditions: { kind: 'dynasty' }, text: 'Another one.', text2: 'The {teamShort} have now won {countWords} of the last {windowWords} championships. Years from now, this is the era people will name.' },
  { id: 'dy-dyn-2', conditions: { kind: 'dynasty' }, text: 'The {teamShort} era.', text2: '{countWordsCap} titles in {windowWords} years. Everybody else is renting space in their league.' },
]

/* ── HINDSIGHT ─────────────────────────────────────────────────────────── */

/** ctx: kind = 'passed' | 'steal'; award = true/false */
export const HS_DRAFT_POOL: Pool = [
  { id: 'hd-pass-1', conditions: { kind: 'passed' }, text: 'You passed on him at #{userPick}.', text2: 'In {draftYear} you took {userPlayer}. {laterPlayer} went {laterPick}th to the {laterTeamShort}, and he has been the better player ever since.' },
  { id: 'hd-pass-2', conditions: { kind: 'passed' }, text: 'The one you did not take.', text2: '{laterPlayer} was still on the board when you picked {userPlayer} at #{userPick} in {draftYear}. The {laterTeamShort} took him at #{laterPick}.' },
  { id: 'hd-pass-3', conditions: { kind: 'passed', award: true }, text: 'You passed on him at #{userPick}. He just won the {laterAward}.', text2: 'In {draftYear} you took {userPlayer}. {laterPlayer} went {laterPick}th to the {laterTeamShort}. Draft boards are written in pencil.' },
  { id: 'hd-pass-4', conditions: { kind: 'passed', award: true }, text: '{laterPlayer}: {laterAward} winner. Not your pick.', text2: 'You had him available at #{userPick} in {draftYear} and went with {userPlayer}. The {laterTeamShort} said thank you at #{laterPick}.' },
  { id: 'hd-steal-1', conditions: { kind: 'steal' }, text: 'Your pick at #{userPick} looks brilliant now.', text2: 'In {draftYear} everyone let {userPlayer} slide. He has outplayed nearly everyone picked ahead of him.' },
  { id: 'hd-steal-2', conditions: { kind: 'steal' }, text: 'The steal of the {draftYear} draft.', text2: '{userPlayer} went #{userPick}. Your scouts were right, and a lot of other people were not.' },
  { id: 'hd-steal-3', conditions: { kind: 'steal', award: true }, text: 'Taken #{userPick}. Now a {userAward} winner.', text2: 'In {draftYear} the league let {userPlayer} fall to you. This year he collected hardware.' },
  { id: 'hd-steal-4', conditions: { kind: 'steal', award: true }, text: '{userPlayer} made the draft look silly.', text2: 'A #{userPick} pick in {draftYear}, and now the {userAward} winner.' },
]

/** ctx: verdict = 'won' | 'lost' */
export const HS_TRADE_POOL: Pool = [
  { id: 'ht-won-1', conditions: { verdict: 'won' }, text: 'The {tradeYear} trade, re-graded: you won it.', text2: 'You sent {gaveSummary} to the {oppShort} for {gotSummary}. Since the deal, {gotName} has given you far more than {gaveName} has given them.' },
  { id: 'ht-won-2', conditions: { verdict: 'won' }, text: 'Remember the {oppShort} trade?', text2: 'In {tradeYear} you gave up {gaveSummary} for {gotSummary}. Time has picked a winner, and it is you.' },
  { id: 'ht-won-3', conditions: { verdict: 'won' }, text: 'You fleeced the {oppShort}.', text2: 'Back in {tradeYear}: {gaveSummary} out, {gotSummary} in. Their GM would like that one back.' },
  { id: 'ht-won-4', conditions: { verdict: 'won' }, text: 'The {tradeYear} deal keeps paying.', text2: 'You sent {gaveSummary} to the {oppShort} for {gotSummary}. {gotName} is still collecting on it.' },
  { id: 'ht-lost-1', conditions: { verdict: 'lost' }, text: 'The {tradeYear} trade, re-graded: it got away.', text2: 'You sent {gaveSummary} to the {oppShort} for {gotSummary}. Since then {gaveName} has done more for them than {gotName} has done for you.' },
  { id: 'ht-lost-2', conditions: { verdict: 'lost' }, text: 'That {oppShort} deal ages badly.', text2: 'In {tradeYear} you gave up {gaveSummary} for {gotSummary}. The other side of the ledger is the one still producing.' },
  { id: 'ht-lost-3', conditions: { verdict: 'lost' }, text: 'The {oppShort} got the better of it.', text2: 'Back in {tradeYear}: {gaveSummary} out, {gotSummary} in. The years since have not been kind to your side of it.' },
  { id: 'ht-lost-4', conditions: { verdict: 'lost' }, text: 'A deal worth a second look.', text2: 'In {tradeYear} you moved {gaveSummary} to the {oppShort} for {gotSummary}. {gaveName} is the reason people still bring it up.' },
]

/** ctx: kind = 'bustRight' | 'starRight' | 'starWrong' | 'bustWrong' */
export const HS_SCOUT_POOL: Pool = [
  { id: 'hs-br-1', conditions: { kind: 'bustRight' }, text: 'Your scout called this one.', text2: 'In {draftYear}, {scout} had {player} pegged as {calledRole} while the league took him #{pick}. {yearsWordsCap} on, the file reads {nowRole}.' },
  { id: 'hs-br-2', conditions: { kind: 'bustRight' }, text: '{scout} was right about {player}.', text2: 'Going #{pick} in {draftYear}, the scout wrote him down as {calledRole}. That is where he is.' },
  { id: 'hs-sr-1', conditions: { kind: 'starRight' }, text: '{scout} saw it first.', text2: 'In {draftYear} the report on {player} said {calledRole}. It said so before anyone else did. He is there.' },
  { id: 'hs-sr-2', conditions: { kind: 'starRight' }, text: 'The scouting report aged well.', text2: '{scout} projected {player} as {calledRole} when he went #{pick}. He is exactly that.' },
  { id: 'hs-sw-1', conditions: { kind: 'starWrong' }, text: 'The report that missed.', text2: '{scout} projected {player} as {calledRole} in {draftYear}. {yearsWordsCap} later he is {nowRole}.' },
  { id: 'hs-sw-2', conditions: { kind: 'starWrong' }, text: 'Not every projection holds.', text2: 'The {draftYear} file on {player} said {calledRole}. Reality said {nowRole}.' },
  { id: 'hs-bw-1', conditions: { kind: 'bustWrong' }, text: 'The scouts undersold {player}.', text2: 'The {draftYear} report had a ceiling of {calledRole}. He blew through it: {nowRole}.' },
  { id: 'hs-bw-2', conditions: { kind: 'bustWrong' }, text: '{player} outgrew the scouting report.', text2: 'Written off as {calledRole} in {draftYear}. Now {nowRole}.' },
]

/** ctx: kind = 'regret' | 'relief' */
export const HS_WALKED_POOL: Pool = [
  { id: 'hw-reg-1', conditions: { kind: 'regret' }, text: 'You let {player} walk.', text2: 'He signed with the {teamShort} last summer and had the kind of year you would have loved to pay for.' },
  { id: 'hw-reg-2', conditions: { kind: 'regret' }, text: 'The one that walked.', text2: '{player} left in free agency. The {teamShort} are glad he did.' },
  { id: 'hw-rel-1', conditions: { kind: 'relief' }, text: 'Letting {player} go was the right call.', text2: 'The {teamShort} paid him {salaryWords}. They did not get much for it.' },
  { id: 'hw-rel-2', conditions: { kind: 'relief' }, text: 'The contract you did not give.', text2: '{player} took {salaryWords} from the {teamShort} and had a quiet year. Your cap sheet sends its regards.' },
]

/* ── OUTRO ─────────────────────────────────────────────────────────────── */

/** ctx: result as RUN_POOL */
export const OUTRO_POOL: Pool = [
  { id: 'out-champ', conditions: { result: 'champ' }, text: 'Your {season}.', text2: 'Champions. Enjoy the summer.' },
  { id: 'out-final', conditions: { result: 'final' }, text: 'Your {season}.', text2: 'One series short. Back at it.' },
  { id: 'out-semi', conditions: { result: 'semi' }, text: 'Your {season}.', text2: 'Final four. The door is open.' },
  { id: 'out-second', conditions: { result: 'second' }, text: 'Your {season}.', text2: 'A round won. More to do.' },
  { id: 'out-first', conditions: { result: 'first' }, text: 'Your {season}.', text2: 'In the dance. Out early.' },
  { id: 'out-missed', conditions: { result: 'missed' }, text: 'Your {season}.', text2: 'On the outside. The summer and the market are next.' },
]
