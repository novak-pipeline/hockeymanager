# Media Simulation Research: making coverage behave like a real NHL market

Research date: 2026-09-26. Scope: how NHL media really works, then a map onto The Show's story layer (`src/engine/story/*`, `career.ts`), ending in a prioritized build list.

Copyright note: everything below is summarized in my own words. Headline examples are invented *shapes* with slots, not copied headlines.

---

## 0. The one-paragraph finding

Real hockey media is not a news feed. It is a **cast of recurring voices, each with its own access, its own cadence and its own reliability**, and they work **stories that have state**. A rumour is born, heats up, gets denied, and then either closes as a trade or fizzles. An injury is disclosed vaguely and then revealed as "worse than thought". The coach gets a vote of confidence, and then he is fired. Our engine already has good ingredients: the salience engine, arcs, the chronicle, GM personas, the Living Ledger leak, the A5 trade tiers, pundit rapport, and a scheduled press calendar. Three structural things are missing, though:

1. **A daily team beat.** No outlet covers *your* club every day with practice lines, injury notes, grades and a mailbag.
2. **Lead time on real AI moves.** AI-to-AI trades are generated and executed on the same tick (`career.ts:6464-6479`), so an insider can never break a deal early, or get one wrong.
3. **Media memory and consequence.** Rapport feeds nothing (`coverageTilt` has zero callers). Pundits never cite what you said. Market size only shapes the board mandate.

---

## 1. Research findings

### 1.1 The primary case: Pittsburgh Hockey Now (PHN), the daily beat outlet

A snapshot of Dan Kingerski's author page ([PHN author page](https://pittsburghhockeynow.com/author/dkingerski/)) and the front page ([PHN home](https://pittsburghhockeynow.com/)) for Sep 23–25, 2026 shows 3–5 pieces per day from one lead writer during camp. Over three days that was:

- 3 game or preseason pieces (a preview plus two grades)
- 3 roster-decision pieces (cuts, reassignments)
- 2 "Dan's Daily" roundups
- 2 notebook, personnel or injury pieces
- 1 breaking item (a retirement, or off-ice news about a player)

**Recurring formats (the templates we should model):**

| Format | What it is | Facts it needs |
|---|---|---|
| **Practice report / Notebook** ([example](https://pittsburghhockeynow.com/pittsburgh-penguins-notebook-new-lines-special-teams-players-on-chopping-block/)) | Who was absent and why. Full forward lines and D pairs as observed. PP1/PP2 and PK units. Who is "on the chopping block". One or two coach quotes that explain a deployment choice. | lines, special-teams units, injured/absent list, bubble players, coach quote |
| **Gameday preview** ([example](https://pittsburghhockeynow.com/pittsburgh-penguins-preseason-game-3-last-showcase-lines-what-to-watch/)) | Projected lineup, goalie, "what to watch" bullets, how to watch | lineup, starter, storylines (who's auditioning, who's slumping) |
| **Grades** | A per-player grade after each game, plus "the good… and the bad" | the game ratings we already compute |
| **Roster moves** | "X cuts; Y re-assigned to junior/Europe" | transaction ledger |
| **Dan's Daily** ([example](https://pittsburghhockeynow.com/nhl-trade-offer-mistake-pittsburgh-penguins-next-wave-early-lines/)) | A first-person morning roundup. Sections: your team, then the division and league. Other outlets' and insiders' reports are *aggregated and attributed* ("per Seravalli…") with a line on why each matters locally. | the day's league wire, insider posts, the club's state |
| **Analysis column** | "The team's great catch-22": a thesis about direction, cap and age curve | posture, cap, age profile, expectations |
| **Mailbag** ([example](https://pittsburghhockeynow.com/pittsburgh-penguins-mailbag-fleury-jarry-poulin-legare-big-trades-more/)) | About 5 fan questions quoted with handles. Casual, confident answers that cite cap, prospects and draft. Makes specific predictions. Cites the outlet's own prior scoops for credibility. | fan-question generator over real state (cap space, prospects, UFAs, slumps) |
| **Opinion** | For example, whether the team "finally stood up for" its star | a game event (a hit on a star, a fight) plus the room response |

**Tone:** knowledgeable, conversational, first person in the roundups, and willing to be blunt ("chopping block"). It is *credentialed*: the writer is at practice and quotes the coach. It is **not** team-owned, so it can criticize, but it depends on access. Its identity is "we cover this team, every day, deeper than anyone".

### 1.2 National insiders

- **Elliotte Friedman / 32 Thoughts** is a numbered-notes column plus a weekly podcast. It is famous for **hedged** phrasing: "I think…", "I can't say 100%…", "I'm told". He prefers not being wrong over looking authoritative. Readers learn to decode *confidence levels* from the hedging. When he goes firm, the news is real ([Defector](https://defector.com/elliotte-friedman-is-the-most-canadian-scoopster); [Pro Hockey Rumors profile](https://www.prohockeyrumors.com/players/elliotte-friedman)).
- **TSN Insiders** (LeBrun, Dreger, Johnston, McKenzie) are the TradeCentre and Free Agent Frenzy panel. They break deals minutes before the official release. The **TSN Trade Bait board** is a ranked, regularly updated list with stats and cap hits that grows as the deadline nears ([Trade Bait board](https://www.tsn.ca/nhl/tradecentre/tsn-trade-bait-board-expands-to-35-with-two-weeks-until-nhl-trade-deadline-1.1920572); [TradeCentre](https://www.tsn.ca/nhl/how-to-watch-tradecentre-at-8am-et-friday-on-tsn-1.2265452)).
- **Frank Seravalli / Daily Faceoff** runs a **Trade Targets** top-40/45 board that is refreshed through the season and re-released at deadline week. New names entering the board is itself content ([Daily Faceoff Trade Targets](https://www.dailyfaceoff.com/categories/trade-targets)).
- **Sourcing reality.** Many trade stories start with an **agent** leaking a client's unhappiness to force movement. Teams also "leak" interest to get around tampering rules. Insiders exploit the gap between a deal being agreed and it being announced ([NHL Rumors, "silent war"](https://nhlrumors.com/the-silent-war-inside-the-unspoken-rules-that-shape-nhl-trades/2025/10/28/)).
- **Wrong or fake rumours exist.** Chris Johnston publicly called a Larkin trade-request rumour "false and fabricated". It came from a nobody who falsely claimed Johnston as his source ([NHL Trade Talk](https://nhltradetalk.com/nhl-insider-squashes-false-dylan-larkin-trade-rumors/)). So reliability is a property of the *source*. Top insiders are rarely flatly wrong. They are more often *early and partial*: talks happened, the deal died.

### 1.3 Analytics writers

Dom Luszczyszyn built **Game Score**, a weighted box-score single-game value (above 4 is great), plus model-based player cards and preseason projections ([Seattle Kraken explainer](https://www.nhl.com/kraken/news/evaluating-single-game-performances-using-game-score-330146096); [AATJ primer](https://www.allaboutthejersey.com/2020/12/28/22201666/all-about-the-jersey-hockey-stat-primer-goals-above-replacement-game-score-value-added)). Their voice is "the model doesn't care how it looked", and they supply cold water on hot streaks and on overpays. Their visual language is **cards**: percentile bars, WAR, and projection vs actual.

### 1.4 Columnists, TV panels, radio, team media, fans

- **Columnists** write theses and verdicts ("fire the coach", "this is the GM's team now"). They write less often and at bigger moments.
- **TV intermission panels and tentpole specials** (TradeCentre, Free Agent Frenzy) work as a live ticker, a panel, "winners and losers", and grades by the end of the day ([Free Agent Frenzy](https://www.tsn.ca/nhl/live-nhl-free-agent-frenzy-coverage-starts-july-1-at-11-a-m-et-on-tsn-1.2141669); a panel declared July 1 [winners](https://www.tsn.ca/nhl/video/2026/07/01/panel-declares-maple-leafs-panthers-winners-of-free-agent-frenzy/)).
- **Team-owned media** (club website and social) produce the in-house reporter's "part of the team" coverage: announcement voice, never critical ([MDPI study on in-house reporters](https://www.mdpi.com/2673-5172/5/1/14)). In Toronto, the club's media ownership itself creates conflict-of-interest critiques ([Between The Posts](https://betweentheposts.ca/2023/02/the-disturbing-media-conflict/)).
- **Access** has historically been contested. The PHWA fought for locker-room access, and teams set policy ([PHWA history](https://www.thephwa.com/2020/07/31/phwa-fighting-for-fair-media-access-since-1967/)). Access is the beat's currency, and a GM can freeze out a hostile outlet.
- **Fans:** message boards (HFBoards), fan blogs (SB Nation sites like PensBurgh), and social media. They are loud, fast and unreliable, and they amplify insider hedges into certainties (the Defector piece's point about Twitter stripping nuance).

### 1.5 Story lifecycles observed in the wild

- **Trade request:** a report (LeBrun first reported the Dubois request) → the club confirms and "deals with it openly" → on-ice friction (benchings) → blockbuster resolution ([NBC Sports](https://www.nbcsports.com/nhl/news/pierre-luc-dubois-talks-about-why-he-requested-trade-from-columbus-blue-jackets-winnipeg-jets); [Yardbarker](https://www.yardbarker.com/nhl/articles/columbus_blue_jackets_promise_to_openly_deal_with_pierre_luc_dubois_as_he_confirms_trade_request/s1_16442_33722243)).
- **Coach hot seat:** a skid → "hot seat radar" lists → the GM's public **vote of confidence** ("all the faith in our coach") → either recovery or firing. The *absence* of a vote of confidence at a season-end presser is itself read as a signal ([THN Hot Seat Radar](https://thehockeynews.com/news/latest-news/nhl-hot-seat-radar-leafs-berube-receives-vote-of-confidence-oilers-struggle); [ESPN hot seat index](https://www.espn.com/nhl/story/_/id/25006885/nhl-hot-seat-index-which-coaches-most-danger-being-fired)).
- **Injuries:** the league rule asks for approximate location, nature and severity, but clubs may give only a general overview if detail could endanger the player. The result is the "upper-body / lower-body, day-to-day" culture. The truth leaks later through the beat ("worse than thought") ([TSN](https://www.tsn.ca/nhl/when-it-comes-to-nhl-player-injury-transparency-mum-s-still-the-word-1.2113466); [ESPN on the Stars going specific](https://www.espn.com/nhl/story/_/id/21505859/no-more-upper-body-lower-body-dallas-stars-specific-injuries)). PHN's own "injury worse than thought" headline is exactly this beat.
- **Players and criticism:** players do read the coverage. Speculative rumour cycles around a player's private life (Hedman) and cruel podcast remarks (Laine) produce public pushback and real harm ([Yahoo on Hedman](https://sports.yahoo.com/articles/victor-hedman-targeted-disgusting-rumors-150508836.html); [CBC on Laine](https://amp.cbc.ca/sports/hockey/nhl/patrik-laine-podcast-remark-1.7113324)). *Design implication:* media heat should be able to reach a player's morale, but our content must stay on hockey and never go tabloid.

### 1.6 Calendar anchors

- **US Thanksgiving** is the standings "barometer". About 76–77% of teams in a playoff spot at US Thanksgiving make the playoffs, and the stat is published every year ([theScore](https://www.thescore.com/nhl/news/3342899/amp); [NHL.com](https://www.nhl.com/news/zizing-em-up-us-thanksgiving-playoff-barometer)).
- **The holiday roster freeze** runs roughly Dec 19–27 with no trades or waivers. Coverage goes quiet on trades and turns to the WJC, which starts Dec 26 ([Pro Hockey Rumors](https://www.prohockeyrumors.com/2023/12/breaking-down-the-roster-freeze-rules.html)).
- **Deadline:** trade boards expand in the final weeks, then a deadline-week countdown, then an all-day show with a live blog and trade tracker ([TSN countdown](https://www.tsn.ca/nhl/article/countdown-to-tradecentre-deadline-week-has-arrived/)).
- **July 1:** a six-hour show, then a signing tracker, then a winners/losers panel. There are daily off-season blogs leading into it ([Bell Media](https://www.bellmedia.ca/the-lede/press/tsn-free-agent-frenzy-provides-wall-to-wall-coverage-of-nhl-free-agency-with-comprehensive-live-special-july-1/)).

### 1.7 Market differences

A veteran who played across the league said Toronto's pressure exceeds that of the other markets combined. In a sunbelt city only a handful of reporters show up postgame. Florida players contrasted Toronto's "circus" with the quiet at home ([Yahoo Canada](https://ca.news.yahoo.com/is-playing-in-toronto-too-much-pressure-maple-leafs-panthers-offer-differing-viewpoints-after-another-playoff-disaster-for-the-core-4-140209129.html); [CBC on Maurice and Toronto](https://www.cbc.ca/lite/story/1.6829638)). Paul Maurice's counterpoint is that the scrutiny is also what funds the league.

---

## 2. The CAST: outlet and writer archetypes for The Show

Every generated league should get **one local beat outlet per club** (named per city), plus a shared national cast. Personas are fictional (principle 5). Each archetype carries these fields:

`{ id, kind, outlet, name, handle, clubId?, cadence, access, reliability (0–1), hedgeStyle, biasToGM (rapport-driven), pools[] }`

| Archetype | Covers | Cadence | Tone | Access / sourcing | Reliability | Reaction to the GM | Headline shapes |
|---|---|---|---|---|---|---|---|
| **The Beat Outlet** (the PHN model; *new*, one per club; the user's is the star) | Everything about ONE club: practice, lines, injuries, grades, cuts, prospects/AHL, mailbag, cap | **Daily** in camp and season (1–3 pieces per game day, 0–1 off days); weekly mailbag; summer 2–3 per week | Conversational, first person in the roundup, blunt, knows the room | Credentialed: sees practice lines, gets coach quotes, reports the injury *truth* on a lag, sometimes a local scoop (local-market leaks about your own club) | High on observed facts (lines = 1.0); medium on its own scoops (0.75) | Rapport sets the framing: an ally explains your move, a critic questions it. A **freeze-out** option (deny access) cuts its practice-report detail and its leaks both ways | "{Club} Notebook: {Player} back at practice; new look for {Line}" · "{Club} Grades: {adj} night in {City}; {Player} was the difference" · "{Club} Mailbag: Is {Player} part of the future? Cap space for a {Pos}?" · "{Player} injury worse than first thought" · "{N} cuts: {Prospect} returned to {JuniorLeague}" · "Daily: {Insider} hears {X}; what it means for {Club}" |
| **The National Insider** (Vic Mercer exists; add 1–2 more with *different* reliability and hedge style) | League-wide scoops: trades in talks, signings, firings, trade requests, extension talks | Opportunistic, driven by real pending moves; a weekly "Thoughts" column (numbered) | Terse when certain, hedged when not | Real sim state: pending AI deals, AI shopping lists, agent unhappiness, board hot seats | Per insider: A = 0.9 hedger, B = 0.7 fast mover, "aggregator" = 0.5 | Rapport changes **who he calls first**: an ally GM gets a heads-up before the story drops (a courtesy call event) | "Hearing {Club} and {Club} have talked about {Player}" · "Nothing imminent, but {Club} listening on {Player}" · "Deal done: {Player} to {Club}. Details to follow" · "{Coach} status being discussed internally in {City}" · "32 Thoughts-style: 1. … 2. … 3. …" |
| **The Board-Maker** (a trade-targets list; can be the same insider or a second outlet) | A ranked trade board | Monthly from ~day 40, then weekly, then daily in deadline week | Analytic-lite, list voice | Board = posture × contract × rumour heat | Board rank ≠ certainty (it *should* miss) | Your listing a player can place him on the board if it leaks | "Trade Targets 2.0: {N} new names; {Player} climbs to No. {k}" |
| **The Analytics Writer** (PuckModel exists as a stats voice) | Model cards, projections, regression calls, contract value | Checkpoints: preseason projections, monthly, after July 1 and the deadline | "The model doesn't care how it looked" | Our own ratings and xG; the fog-of-war view, not true ratings | Directionally right, noisy | Grades your signings and trades by *value*, independent of rapport (the incorruptible voice) | "The model on {Player}'s {Term}x{AAV}: {verdict}" · "{Club} are {k}th in xG% and {j}th in the standings. Something gives" |
| **The Columnist** (Sam Carver exists; see the name collision in §5) | Verdicts and theses: the coach, the GM's plan, the franchise's direction | Weekly, plus tentpoles (deadline verdict, season autopsy) | Opinionated, historical, cites the record | Chronicle and expectations; no scoops | n/a (opinion) | **Most rapport-sensitive.** A critic writes "the GM's plan is failing" pieces that feed board pressure | "It's time to ask the hard question about {Coach}" · "{GM}'s deadline: {grade}. Here's why" · "{N} years in, this is {GM}'s team" |
| **The TV / Radio Panel** (the homer "990 The Fan" exists; add a national TV panel for tentpoles) | Intermission hits, deadline/July 1/draft shows, call-in rage | Tentpoles live; radio daily in big markets | Hot takes, emotion, fans' voice | Reacts to the others | Low (takes) | The homer lives on rapport and passion; fan interest moves with him (already wired, `career.ts:5080-5086`) | "Winners & losers of Deadline Day" · "Callers want {Player} benched" |
| **Team Media** (the club accounts in `voices.ts` exist) | Announcements, hype, injury *official* line ("upper-body, day-to-day") | Per event | Corporate, positive, hashtag | The GM *controls* it: it states the official disclosure | 1.0 on facts, 0 on candour | Always friendly. It is the lever the GM uses to set the narrative first | "Roster update: {Player} (upper-body) week-to-week" · "Welcome to {City}, {Player}" |
| **Fan Voices** (new, lightweight: 3–4 archetypal fan accounts plus board-thread snippets) | Reaction: fury, hope, memes, trade proposals | Bursts after games, trades and firings | Emotional, hyperbolic | None, which is why they can be wrong (they amplify an insider's hedge into certainty) | Low; their *mood* is the signal | Mirrors fan interest and the homer; supplies mailbag questions | "Fire {Coach}" energy; "{Player} for {Star}, who says no?" |

**Budget rule (no noise for noise's sake):** the beat and the national cast write to the **Feed and a News reader** (a readable layer). Only the curated subset reaches the **inbox**: your player named in a real scoop, an injury update on a key man, a critic's column that moved the board, and mailbag questions you are asked to answer. The existing `INBOX_IMPORTANCE_FLOOR` and `reach` tags already express this.

---

## 3. Story Lifecycle Model

One generic state machine layered over the arc engine (`arcs.ts`). Arcs already have `building | peak | resolved` plus tension. We add **media states** and **claims**.

```
             (sim fact appears)
 DORMANT ──────────────────────► WHISPER ──► REPORTED ──► DENIED / NO-COMMENT ──► CONFIRMED ──► RESOLVED
    ▲            (only insiders,     │   (named insider,       │   (club/GM/agent        (official)     (chronicle entry
    │             hedged, low        │    hedge level)          │    responds; user can                  + callback)
    │             confidence)        ▼                          ▼    choose the line)
    └──────────────────────────── FIZZLED ◄───────────── (talks die / deadline passes)
                                   └─► "WRONG" flag on the claim (insider reliability ledger)
```

**Claim object** (new, JSON-safe):
`{ id, storyKind, subjectIds, sourceId (insider), confidence (0–1, drives hedge wording), truth: 'true'|'partial'|'false', createdDay, status, citedBy[] }`

- **Truth is decided by the sim, not the writer.** For a pending AI deal, `truth = true`, and the deal later closes with p = reliability-weighted.
- Rumours with `truth: 'false'` spawn only from low-reliability sources (the aggregator, or fan accounts that *misattribute* to an insider, as in the Larkin/Johnston case). Top insiders' "wrongs" are **partial**: the talks were real, but the deal died.
- **Hedge wording is a function of `confidence`:** ≥0.85 "Deal done / Finalizing"; 0.6–0.85 "Talks have intensified"; 0.35–0.6 "Teams have called about"; <0.35 "Hearing some chatter". This is the Friedman decoding game, and it is fun because players learn each insider's tells.
- **Reliability ledger:** each insider's `hits / partials / misses` are stored and shown on his profile. When a claim resolves, the analytics or fan accounts can call it out ("{Insider} was early on this one" / "{Insider}'s {Player} report aged badly").

**Story kinds, with the sim facts that trigger, advance and resolve each:**

| Story kind | Born when (sim fact) | Advances on | Resolves on |
|---|---|---|---|
| **Trade talks (AI↔AI)** | A pending AI deal is created (**needs the new two-phase trade: talks → close**) | Days pass; the buyer's posture hardens; deadline proximity | Execute → CONFIRMED; the deal dies (a posture change, a cap fail, a random break with p = 1 − close rate) → FIZZLED |
| **Available / shopped** | An AI club's rebuild posture plus an expiring vet; the user's quiet/open listing plus a leak roll (the Living Ledger `mediaLeak` exists) | Board rank rises; calls logged | Traded, pulled off the block (residue `wasShopped`), or the deadline passes |
| **Trade request** | A player's morale is below threshold and a concern goes unresolved (`career.ts:4245` already creates a `tradeRumor` arc) | Agent statement; benching; on-ice slump | Traded, or reconciled (a promise kept) |
| **Contract saga / holdout / extension talks** | RFA/UFA within 1 year, negotiation stalemate, offer-sheet window | Reported gap ("sides ~$X apart"), a deadline for talks | Signed (with the number compared to the reported gap), offer sheet, or walks July 1 |
| **Coach hot seat** | Standings far below `expectations` plus a losing streak (**new detector**; `coachFired` exists in the chronicle only) | "Hot seat radar" mention → GM asked in presser → **vote of confidence** (a user choice) → continued slide | Fired (by the user, or AI by board or GM persona patience), or recovery ("{Coach} has steadied the ship") |
| **Injury** | Injury event: the club states the **official vague line** | The beat reports the truth on a lag ("worse than thought") when true games-out ≥ 1.5× the announced band | Return (a voice post exists: `injuryReturn`), or season-ending |
| **Slump / streak** | Salience detectors (streak outlier, breakout) exist | Checkpoints | Ends; chronicle callback |
| **Prospect hype** | Top pick or AHL/junior dominance (WJC exists: `worldJuniors.ts`) | Camp performance, WJC | NHL debut, or "bust watch" arc (exists) |
| **Milestone chase** | Approaching a round number (`milestoneWatch` arc exists) | Countdown | The milestone voice post (exists) |
| **Rivalry / revenge game** | A former player faces his old club (`formerTeams` exists in the chronicle); head-to-head records | Pregame preview mentions | Game result; `gameMoment` chronicle |
| **GM's own claims** (new; see gap B) | A strong presser answer ("we're a playoff team") | Standings drift vs the claim | Proved or disproved, then *cited back* by that pundit |

**Conservation of drama:** at most ~3 live media stories per club, and the user's club at most 2 in the inbox tier at once, mirroring NARRATIVE-ENGINE's cap. Overflow stays Feed-only.

---

## 4. Calendar of coverage by season act

| Act (game phase) | What dominates real coverage | What the game should publish (beat / national / other) |
|---|---|---|
| **Summer (Jul 2–Aug)** | Dead-period content: rankings, "best/worst contracts", prospect camp, arbitration, unsigned RFAs | Beat: 2–3 per week (depth chart, "5 questions for camp", arbitration explainer if one is filed). National: "unsigned RFA" watch, a cap-crunch list. Analytics: offseason grades by value |
| **Camp / preseason** | Roster battles, cuts, lines at practice, injuries, PTOs | **The beat's peak act.** Daily notebook (lines as run, special-teams units, cuts, PTO status), preseason grades, "bubble board". Our camp week (Blue–Red scrimmage, PTO invites) is the raw material |
| **Opening night** | Previews, predictions, captains, opening-night roster | Season preview exists (`seasonPreview`). Add a beat "opening-night roster: who made it and why" |
| **Oct–Nov** | Early surprises, "is it real?" regression debates | Salience expectation-gap checkpoints (exist). Analytics "sustainable?" cards |
| **US Thanksgiving (~day 25–30)** | The playoff-barometer stat; hot-seat lists appear | **New tentpole:** a "Thanksgiving table" column that cites the ~3-in-4 rule against current standings. The first hot-seat radar |
| **Holiday freeze + WJC (late Dec–early Jan)** | No trades; WJC prospect coverage; holiday features | Trade rumours pause (a real calendar lever). The beat covers *your* prospects at the WJC (the engine exists). Columnist: "quarter-season report card" |
| **All-Star / midseason (late Jan–early Feb)** | Selections, midseason awards, a deadline preview | Midseason awards (from the award-race detectors). "Buyers & sellers" list starts. First Trade Targets board |
| **Deadline run-up → deadline day** | Boards expand weekly, then daily; insiders dominate; the live show | Board weekly → daily. Insiders break **pending** deals (talks state). Deadline day: live ticker (exists: the 8am–3pm half-hour clock) plus panel winners/losers plus beat grades for your moves |
| **Playoff push (post-deadline → end)** | Race math, "magic numbers", clinches, coaches on the brink | Playoff-race detector (exists), clinch posts (exist). Hot-seat escalations for teams that fall out |
| **Playoffs** | Series previews, game grades, OT heroes, lineup-change drama, injury secrecy peaks | Beat: game-day lineup plus grades every game. The injury disclosure gets *vaguer* in playoffs (the NHL norm). Elimination → the "what went wrong" autopsy |
| **Season end → awards → lottery/combine → draft** | Exit interviews (players reveal hidden injuries), the GM's season-ending presser (a vote of confidence or not), awards, mocks, the draft panel | Exit-day beat piece: "{Player} played through {injury}" reveals. The GM presser choice (confidence in the coach). Draft panel (THE-FEED §Event broadcasts) |
| **July 1 (FA frenzy)** | All-day show, signing tracker, grades | Insiders break signings minutes early (via the same claims pipeline). Winners/losers panel. Analytics grades by AAV value |

---

## 5. Market Pressure model

**Where it exists today:** `marketSize` 1–3 feeds only the board mandate (`board.ts:87-123`) and the GM job market. The view has `marketSizeLabel` (`buildViews.ts:1262`).

**Proposal:** `mediaHeat = marketSize × tradition (Original Six / Canadian flag) × currentDrama`. It scales **volume and edge**, never truth:

| Knob | Small / sunbelt (1) | Medium (2) | Big / Canadian / Original Six (3) |
|---|---|---|---|
| Beat outlets on your club | 1 | 1–2 | 2 plus a radio station plus a columnist |
| Pressers after bad losses | only 4+ goal losses | 3+ | any skid ≥3 |
| Hot-seat detector threshold | slow | normal | fast (fires ~2 weeks earlier) |
| Critic columns → board confidence drain | ×0.5 | ×1 | ×1.5 |
| Player morale hit when criticized by name | tiny | small | real, and the *personality* trait (pressure handling) matters. A "thrives in big market" trait makes it a boost |
| Leak probability on quiet shopping | ×0.6 | ×1 | ×1.6 (more reporters, more leaks) |
| Upside | lower revenue and fan interest ceiling | | higher revenue and fan interest; FA draw is mixed (some players avoid the fishbowl) |

**Local vs national framing of the same event.** A trade is written *twice*. The national insider writes it neutral and league-wide ("{Club} add a rental"). Each involved club's beat writes it local and emotional ("What {Club} gave up, and why it stings"). The rival's beat can gloat. The engine already emits one fact payload; add a per-outlet framing pool keyed on `{ side: 'buyer'|'seller'|'rival'|'neutral' }`.

---

## 6. GM–Media relationship: what the player should be able to *do*

This is where real GMs have levers, and where our pressers are currently tone-only.

1. **Official disclosure choice** on injuries: vague (the default norm) or specific. Specific earns beat rapport but gives opponents a tiny targeting edge (optional, or cosmetic). Vague that later proves "worse than thought" dents the beat's trust if you had said "day-to-day".
2. **Vote of confidence** in the coach (presser question): back him, which is recorded as a claim (it looks bad if you fire him in two weeks, and the pundit cites it), or hedge ("we evaluate everything"), which the room hears.
3. **Named-player questions** ("Is X part of your plans?"), as the audit's §5 spec says. They tie to the player's trust and the promise ledger, and leak to the player.
4. **Plant a story / float a trial balloon:** tell an ally insider that a player is available (open shopping without listing), or leak interest in a FA. This raises market heat and AI calls, but the player reads it (Living Ledger).
5. **Freeze out a hostile outlet:** its practice detail drops (no lines leak early), and it turns more critical. It costs a small amount of fan interest in big markets.
6. **Courtesy calls:** an ally insider calls *you* before publishing a story about your club, and you can confirm, deny or "no comment". A denial of a true story costs credibility later when it closes.

---

## 7. GAP MAP: what exists vs what's missing

### Already built (keep, build on)

| Capability | Where |
|---|---|
| Salience engine: expectation gap, streaks, breakouts, goalie heaters, scoring/goal/Vezina races, playoff race; novelty dampening; daily budget 2; inbox floor 70 | `story/salience.ts:194-589`, `career.ts:3818-3907` |
| Feed authors: insider (Vic Mercer), analyst (Sam Carver), stats (PuckModel), wire; plus player/GM/club voices | `story/salience.ts:64-85`, `story/voices.ts:34-46, 702-886` |
| Arc engine incl. `tradeRumor`, `contractStandoff`, `feud`, `bustWatch`, `milestoneWatch`, `collapseTeam` | `story/arcs.ts:27-40` |
| Rumour mill: heuristic spawn (seller star / expiring 28+ / unhappy), heat rises toward the deadline, all purged at the deadline | `league/tentpoles.ts:247-337`, `career.ts:4546-4569` |
| AI↔AI trades with a deadline flurry | `career.ts:6460-6479`, `career.ts:14764` |
| Trade announcement tiers (franchise / notable / depth) plus an insider break for stars | `career.ts:15396-15470` |
| Press corps: 3 personas (beat, national, homer), weekly column plus scheduled reports (preview, power rankings, monthly, playoff preview, awards, draft, review) with ~1,500 lines of fallback templates | `story/factSheet.ts:13-38`, `story/pressSchedule.ts`, `story/pressFallback.ts` |
| Presser: triggered only after a 4+ goal loss; tone → morale, random feud, pundit rapport | `career.ts:4593-4606, 5007-5094` |
| Pundit rapport plus the Media Circuit screen | `story/pundits.ts`, `career.ts:5100-5121` |
| Living Ledger leaks (`mediaLeak`, `shopSubtweet`) | `career.ts:3304-3330, 3597` |
| Chronicle, head-to-head, provenance, anniversaries | `story/chronicle.ts` |
| Postgame match report plus per-player game ratings (grades) | `story/matchReport.ts`, `views.ts:2414` |
| Coach quotes on win/loss streaks and slumping stars | `career.ts:4609-4634` |
| GM personas with posture (contend/retool/rebuild) | `league/gmPersona.ts` |
| Market size (board mandate only) | `league/board.ts:87-123` |
| Injury kinds with specific *and* vague descriptions mixed in one list | `league/condition.ts:42-72` |
| WJC, arbitration, camp week, deadline-day clock | `league/worldJuniors.ts`, `career.ts` |

### Missing (the gaps)

| # | Gap | Evidence |
|---|---|---|
| G1 | **No daily team beat.** The "beat" persona writes a *weekly* column (every 7th match day, `career.ts:4581`). No practice lines, injury notes, gameday lineup, grades article, cuts, AHL/prospect notebook or mailbag | `pressSchedule.ts` cadence list |
| G2 | **Insiders cannot break real AI moves early.** AI↔AI deals are generated and executed in the same tick (`career.ts:6467-6478`). Rumours are *heuristic* (`tentpoles.ts:284-290`) and disconnected from the deals that actually happen. Rumours are never wrong *by design* and never tracked for accuracy | `tickRumors`, `generateAiAiTrade` |
| G3 | **Rapport feeds nothing.** `coverageTilt` has zero callers. Boundary beats promise behaviour the engine doesn't perform | `pundits.ts:221`, `career.ts:5067-5078`, audit §5 |
| G4 | **Press tone is dominated, and pressers are rare and generic.** One trigger (a 4+ goal loss), one generic question, typed text discarded | `career.ts:4600-4605, 5038` |
| G5 | **No media memory of GM claims** (pundits never cite you back) | audit §5 |
| G6 | **Chronicle lacks people and media events** (trade request, feud, captaincy, shopped, hot seat, vote of confidence, report-wrong) | `chronicle.ts:16-37` |
| G7 | **No injury disclosure layer.** Specific diagnoses and "upper-body injury" are mixed in one description list. No official-vs-true split, no "worse than thought" beat | `condition.ts:48-72` |
| G8 | **No coach hot seat / vote-of-confidence lifecycle** (only `coachFired` exists as a chronicle kind) | grep: 2 hits, both in the chronicle |
| G9 | **No market pressure on media** (marketSize → board only) | `board.ts` |
| G10 | **Calendar tentpoles missing:** Thanksgiving barometer, holiday freeze (as a rumour pause *and* a rule), All-Star/midseason report, a trade-targets *board*, July 1 panel/grades | no matches for thanksgiving / freeze / all-star |
| G11 | **Cast coherence bug:** "Sam Carver" is the *beat* byline in `PRESS_PERSONA_NAMES` (`factSheet.ts:35`) but the *analyst/columnist* account in `FEED_AUTHORS` (`salience.ts:70-73`). So the "beat writer" posts as a columnist. Vic Mercer is both the national byline and the insider account, which is consistent | `factSheet.ts:34-38`, `salience.ts:64-85` |
| G12 | **Repetition** on the most common surfaces (audit §5: "X report" 32–63× per season, identical scouting digest). A daily beat would make this *worse* unless it is built on the shared content engine and the ledger from day one | audit §5 |
| G13 | **No local-vs-national framing.** One payload, one voice | `announceTrade` |

---

## 8. Prioritized build list

The principles for every item are the same. Use pure detectors and fact payloads, with Hades-model pools in `contentEngine` (most-specific wins, sibling variants at equal specificity, the no-repeat ledger, `pickStable` for view text). Articles land in a **News reader and the Feed**. The inbox gets only the curated tier. The local AI writer stays optional: the `PostFacts` payload is the contract.

### S (small, high leverage)

1. **S1 Wire rapport into framing (G3).** `coverageTilt(personaId)` selects a variant *family* (`ally | neutral | critic`) in `pressFallback` weekly/tentpole templates and in the Feed analyst pools. Critic columns after losses add a small board-confidence drain, scaled by market (§5). *This makes the Media Circuit tell the truth.*
2. **S2 Fix the cast (G11).** Give the beat its own name and outlet (a per-city beat outlet name pattern, e.g. "{City} Hockey Now"-style but fictional: "{City} Puck Report"). Keep Sam Carver as the columnist and Vic Mercer as the insider. Add a second insider with a different reliability and hedge style.
3. **S3 Injury disclosure layer (G7).** Split `description` into `official` ('upper-body', 'lower-body', 'illness'; severity band 'day-to-day' / 'week-to-week' / 'month-to-month' / 'indefinitely') and `true` (the specific diagnosis the GM sees in the medical screen). The club account posts the official line. If true games-out exceed the band by 1.5×, the beat posts "worse than thought". Exit-day pieces reveal "played through {true injury}".
4. **S4 Chronicle people and media events (G6).** Add the `tradeRequest | confrontation | captaincy | feud | shopped | hotSeat | voteOfConfidence | claimResolved` kinds. These unlock both biographies and media callbacks.
5. **S5 Calendar tentpoles (G10), content-only.** Add a Thanksgiving barometer column (cite the ~3-in-4 rule against real standings; at match-day index ≈ 25% of the season), a holiday rumour pause (`tickRumors` skip window; optionally a real trade/waiver freeze rule), a midseason report card, and a July 1 winners/losers panel from the FA signings of the day.

### M (medium, the core of "feels like a real market")

6. **M1 The Daily Beat (G1), the headline feature.** A new `story/beat.ts` (pure) builds typed articles from state the sim already holds:
   - **Notebook** (practice day / non-game day): lines and D pairs as set (`lines`), PP/PK units, who's absent (injury official line), the bubble board in camp, and one coach quote from `coachQuotes`.
   - **Gameday**: projected lineup, starting goalie, 3 "what to watch" bullets from live arcs (slump, milestone, revenge game via `formerTeams`), the opponent's form.
   - **Grades**: from the existing per-player game ratings, top 3 / bottom 2 with one-line reasons from box facts. Only after *your* games, and it goes in the News reader (not the inbox).
   - **Roster moves**: cuts, recalls and reassignments batched into one daily post (this kills per-move spam).
   - **Mailbag (weekly)**: 4–5 fan questions generated from state *slots* (cap space vs a UFA; "is {prospect} ready?" from AHL stats; "why is {Player} on the 3rd line?" from the deployment change; trade-board names). Answers are pooled by condition bucket. The writer makes a *prediction* that is recorded as a claim and graded later.
   - **Morning roundup** ("{Writer}'s Daily"): aggregates the day's insider claims and league wire with a *local* "why it matters" line. This is the natural place for Feed items to become readable.
   - Cadence: camp daily, season 1–3 per game day, summer 2–3 per week. Hard budget: ≤1 inbox item per week from the beat (a "worse than thought" injury, or a mailbag question naming your player). Everything else lives in a **Beat tab** (News reader).
7. **M2 Two-phase AI trades plus the Insider Claims pipeline (G2).** `generateAiAiTrade` creates a **pending deal** `{ closeDay = day + k (1–10, shorter near the deadline), closeProb (persona patience/aggression) }`. On each tick the insiders roll to *report*: the chance scales with deal heat, `1 − daysLeft/k`, and the insider's reach. The claim's `confidence` drives hedge wording (§3). The deal closes or dies, and the claim resolves true or partial. Low-reliability accounts can also emit *false* claims about plausible targets (drawn from the existing heuristic rumour pool), which is how `tickRumors` gets repurposed as the noise floor. Keep a reliability ledger per insider and show it on the profile. The same pipeline covers **FA signings on July 1** ("finalizing a deal with…" minutes before) and **coach firings**.
8. **M3 Trade Targets board (G10).** A ranked list (top 25–45) from pending deals, rebuild postures, expiring vets and rumour heat. Published monthly from midseason, weekly in the last month, daily in deadline week. Movement ("new names", "climbs to No. k") is the content. It hits your inbox only if *your* player enters it (and then he has read it too, via the Living Ledger).
9. **M4 Pressers become levers (G4, G5).** Add more triggers (skid ≥ N scaled by market, a trade day, deadline day, season end). Add **named-player questions** (audit spec) and **vote of confidence** in the coach. Store the **GM's strong claims** per pundit, and have pundits cite them back when they resolve ("In October {GM} told us this was a playoff team"). The typed text stays cosmetic unless the local writer is on. The choice buttons carry the mechanics.
10. **M5 Coach hot-seat lifecycle (G8).** Detector: `expectedRank − rank` and a skid, both scaled by market. Beats: hot-seat radar mention → presser question → vote-of-confidence choice → firing (AI clubs by persona patience; the user's by choice) or recovery. The chronicle records the stages.

### L (large, the deep version)

11. **L1 Local-vs-national framing plus rival beats (G13).** Every AI club has a beat outlet stub. Trades and big games are written per side (buyer / seller / rival / neutral pools). The rival's beat gloats after your loss. Mostly Feed-only, and cheap to read.
12. **L2 Market pressure model (G9)** wired across detectors: presser frequency, hot-seat speed, leak multipliers, criticism → the morale of *named* players with a pressure-handling trait, the board drain, revenue and fan interest. It stays a small number of knobs keyed on `mediaHeat`.
13. **L3 Media relationships as GM actions (§6).** Plant a story with an ally insider, freeze out an outlet, courtesy calls (confirm/deny/no comment with credibility stakes), and a choice of injury disclosure policy. Each is a real lever with a price in rapport, player trust or board, and none is decorative.
14. **L4 Deadline-day and July 1 broadcast panels** (THE-FEED §Event broadcasts): a live ticker, the insider claims firing ahead of confirmations, and end-of-day grades.

### Guardrails (owner rules)

- **Fun over realism:** the reliability and hedge game should be *learnable* ("Mercer is never wrong when he says 'done'"). Wrong rumours are a spice (≤15% of claims), never a spam source.
- **Curated inbox:** new article types default to the News reader or Feed. The inbox tier is only for items about your club that are actionable or personally consequential. Keep the existing `reach` tagging at the write site.
- **Authored prose:** every article type = a fact payload plus a pooled template family with condition buckets (`tilt`, `market`, `severity`, `side`, `confidence`). Add a prose-audit harness check per new surface (no verbatim repeat per season; B4.5).
- **Tone:** criticism stays on hockey. No tabloid personal-life rumours (see §1.5).

---

## 9. Top 5 (recommended order)

1. **M1 Daily Beat** (notebook, gameday, grades, roster moves, weekly mailbag), built on the existing lines, ratings, injuries and arcs. This is the PHN model, and it is the most-felt change.
2. **M2 Two-phase AI trades plus the insider Claims pipeline** with per-insider reliability and hedge-by-confidence. Insiders break real moves early, and sometimes wrongly.
3. **S1 plus S2: rapport wired into framing, and fixing the Sam Carver cast collision.** Small, and it makes the Media Circuit honest.
4. **S3 plus S4: the injury disclosure layer (official vs true, "worse than thought") and chronicle people/media events.** Media that remembers and reveals.
5. **M4 plus M5: presser levers** (named-player questions, vote of confidence, claims cited back) **and the coach hot-seat lifecycle.**
