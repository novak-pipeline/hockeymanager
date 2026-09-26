# Pressure and Firings (E3)

How the job can be lost, how the rest of the league turns its benches and front
offices over, and the rule that every scene, meeting and owner's ask either does
what it says or says why not.

Code: `src/engine/league/{pressure,board,coachCarousel,gmCarousel,ownerMeddling}.ts`,
`src/engine/career/career.ts` (season review, carousel wiring, job market,
decision acts), `src/engine/career/beatGates.ts` (the fired gate),
`src/engine/career/autopilot/autopilot.ts` (the AI-GM brain and its report).

---

## 1. The model

### The user's board

- **In-season.** Every ten match days the board updates confidence from rank vs
  target and recent form. Past the halfway mark, falling short of the target
  drains patience. When confidence drops through 35 the board escalates:
  concern, then a formal warning, then an ultimatum (at most three a season).
  The fan-mood meter (`pressure.ts`) bills the owner's patience while the
  building is angry.
  - *Fix:* "progress" is now counted in **games**. It used to be counted in
    league dates (`matchDays`), which is about twice a club's schedule. That
    capped progress near 0.5, so the late-season patience drain almost never
    ran and the carousel's "not after 80% of the season" rule never applied.
- **Season review.** The verdict is one of exceeded, met, missed or failed,
  judged against the mandate. Changes from calibration:
  - *contend:* a playoff team that finishes short of its billing has
    **missed**. Only missing the playoffs is **failed**.
  - *competeRespectably:* finishing **better** than the target counts as met.
    It used to be graded as |rank − target| ≤ 4, so a team asked to finish 23rd
    that finished 16th was told it had "missed". Finishing in the bottom three
    counts as **failed** when the target was not a bottom target.
  - *rebuild / developYouth:* five seasons into the job and still in the bottom
    three, a "met" is downgraded to **missed**. The owner has run out of "next
    year".
  - A sanctioned rebuild (Club Vision) still softens failed or missed to met.
- **Firing** requires a trend. The GM is never fired in his first season with a
  club. After that he is fired when:
  - the season **failed** and the failure was sustained (a prior miss, or two
    or more warnings this season), and either patience is ≤ 20 or a warning
    has been issued; or
  - he has **missed** three straight seasons with the board exhausted
    (patience ≤ 5, warnings ≥ 2).

### A dismissal the game honours

Before this work, a fired GM kept running the club through the draft and
July 1. The rollover then set a new mandate for the **same** club, which
silently undid the firing.

- After the season review (where he is told), `advanceOffseason` returns false
  until he takes a job. The beat-gate law routes Continue to the review first,
  then to the GM Career screen as a **hard gate**. The gate outranks draft day,
  because a fired GM does not make his old club's picks. Taking a job refreshes
  the shell.
- **Real vacancies.** The job market used to be a random draw (half the bottom
  third, plus 8% of the rest) at clubs whose GM never actually left. It now
  lists the AI clubs whose owners dismissed their GM at the same season review.
  - If no AI club made a change, the hottest AI seat goes. This is a normal
    dismissal, with its news.
  - If every opening is a long shot for his reputation, the lowest-ranked
    opening takes a flier on him.
  - A club that fired him in the last five years does not hire him back.
- **Taking a job.** He keeps his reputation, starts a new stint and gets a new
  mandate. His first season with the new club is protected. The old club hires
  a new AI GM, and every other empty chair is filled. The old desk is cleared:
  offers, concerns, promises, talks, mentorships and the owner's ask all belong
  to the old club, and fan mood, pricing and budget baseline are reset.

### The coaching carousel (`coachCarousel.ts`)

- **Mid-season:** capped at 3 league-wide. A firing needs at least 22 games
  played, no more than 80% of the season gone (now true in games), and a real
  collapse against the projection and on points pace. An interim coach hired
  this season is **never** fired again before it ends. The first calibration
  run fired Chicago's interim a few weeks after hiring him.
- **Summer:** runs at the season review, the week the season ends. Clubs that
  finished well below their projection, and long-serving coaches with nothing
  to show, are let go. **A new GM raises the odds by +0.2**: the new man picks
  his own coach. The cap is about 18% of the league (6 of 32).
- Every change is recorded in the chronicle as `coachFired` with its window
  (`midseason` or `offseason`). Replacement names are rerolled if the name is
  already behind a bench; one run had two clubs hire the same coach in the same
  winter.

### AI GM dismissals (`gmCarousel.ts`)

These are rarer than coaching changes and follow **sustained** failure against
the September projection.

- **Disappointing season:** any one of these:
  - finished at least 6 places (in a 32-team league) below the projection;
  - projected into the playoffs (top 40%) and missed them;
  - finished in the bottom 16% when not rebuilding.
- `missStreak` is kept on the GM persona, so it survives save and load.
- **Dismissal odds:** a GM is never dismissed before his second completed
  season. The GMs a career opens with count as having four prior seasons.

  | Case | Base odds |
  |---|---|
  | Missed 3 straight seasons | 0.65 |
  | Missed 2 straight seasons | 0.45 |
  | One miss, 5+ seasons in the job, bottom quarter | 0.20 |
  | One collapse (a third of the league below projection), 3+ seasons in the job | 0.12 |

  Modifiers: the size of the slide adds up to 0.25, and a bottom-quarter
  finish adds 0.06. A rebuild multiplies the odds by 0.3 in the GM's first four
  seasons and by 0.7 after that. The result is capped at 0.7, and at most three
  GMs are dismissed per summer.
- Each dismissal produces news, a transaction entry, and a chronicle `gmChange`
  entry (`change: 'dismissed'`). The successor gets a news story, a
  chronicle entry (`change: 'hired'`), and **a new persona roll**. The
  persona is salted by `generation`, so it has different aggression,
  pick-hoarding and cap discipline, and the club's trading follows his
  `gmPersonaFor` traits. He also has no relationship history with the user.
- Only summer dismissals are modelled. Mid-season GM firings are rare in the
  NHL and are left out on purpose.

### The AI-GM brain (autopilot)

When dismissed, the autopilot takes the best job it can get: the strongest
club among the openings that are not long shots. It then clears its plan,
diagnosis, offer book and warning counter and carries on.

The autopilot trace now records:

- a `board` decision for each escalation (concern, warning, ultimatum), with
  its drivers;
- a `job` decision for each move, listing every opening, the reputation and
  the reasoning;
- per season: the club, mandate, target, warnings, confidence, patience, fan
  mood, miss streak after the review, and fired or not;
- league churn per season: coach changes (mid-season vs summer) and GM
  dismissals, with headlines, read from the chronicle through
  `Career.carouselLog(year)`.

`summary` rolls up firings, warnings, ultimatums, coach changes per season
(and mid-season per season), and GM changes per season. The markdown summary
has a "Pressure & the carousel" section.

**Harness environment variables:**

- `AP_MOD_DB` points a worktree at the main checkout's 37 MB mod database
  instead of copying it.
- `AP_OUT` redirects the trace output.

---

## 2. Calibration

**Setup.** `AP_RUN=1 AP_SEASONS=10 AP_TIMEOUT_MS=7200000`, imported 32-team
database, user club Florida, final code (run r5).

### Final numbers

| | Seed 2029 | Seed 777 | Target |
|---|---|---|---|
| Head-coach changes per season | **6.2** | **5.4** | NHL ~5–8 |
| of which mid-season | 1.9 | 1.3 | cap 3 |
| GM dismissals per season (incl. user) | **1.3** | **1.0** | NHL ~1–3 |
| Board warnings (ultimatums) | 4 (0) | 4 (0) | |
| User fired | 2029 (after a #28 then #20 season) → Columbus | 2032 (4-season miss streak, cupOrBust #1 → #20) → Washington | |
| Issues | 0 critical / 0 major | 0 critical / 0 major | 0 / 0 |

Both final runs still won a Cup: seed 2029 in 2034 with Columbus, and seed 777
in 2033 with Washington.

### Tuning history

**Mid-season coaching cap.** Kept at 3. Mid-season coach firings measured
1.1–2.3 per season across eight 10-season runs and never ran into the cap.
Total coach changes per season: 6.7, 6.1, 6.0, 6.1, 5.6, 5.3, 5.4, 6.2. That
is inside the band in every run, so there was nothing to justify changing the
cap.

**GM dismissal odds.**

| Base odds (3 misses / 2 misses / 1 miss + basement) | GM changes per season |
|---|---|
| 0.5 / 0.24 / 0.10 | 0.6–0.7 |
| 0.6 / 0.38 / 0.16 | 0.8 |
| Final (with the single-collapse path) | 1.0–1.3 |

The final rate sits at the low end of the band. That is deliberate: GM changes
must stay rarer than coaching changes.

### When the user is warned or fired

Most firings come after the second disappointing season. Warnings come mid
season, when confidence falls through 35.

**Seed 777**

| Run | Fired | Why | Result |
|---|---|---|---|
| r1 | 2030 | contend target #3, finished #7 and then #13 | took Vegas |
| r4 | 2030, 2032, 2034 | a GM who never made the playoffs, across three clubs | realistic |
| r5 | 2032 | miss streak of 4 (2029 contend #2 → #16) | took Washington |

In r4, the club that sacked him in 2030 hired him back in 2032. That is now
blocked.

**Seed 2029**

| Run | Fired | Why | Result |
|---|---|---|---|
| r1 | 2033 | two first-round exits against a #1 target | Changed: contend + playoffs is now missed, not failed. A 104-point playoff team is no longer fired on its second try. |
| r2 | never | The owner's own mandates were rebuild, rebuild, rebuild (2026–28), then developYouth | |
| r4 | 2029 | makePlayoffs #16 → #28, then contend #2 → #19 | took Detroit, won the 2032 Cup there |
| r5 | 2029 | as r4 | took Columbus, won the 2034 Cup |

### Judgement: the seed-2029 multi-year slide

The seed-2029 Panthers slid from 2025 to 2029 before becoming a dynasty.
**Whether that GM should be fired depends on who asked for the slide.**

- **The owner sanctioned it.** The board handed out rebuild or developYouth
  mandates, or the GM declared a rebuild in Club Vision. A GM running a rebuild
  the owner asked for keeps his job through three to four losing years.
  Chicago under Davidson and Anaheim under Verbeek are examples. The model
  agrees: in r2 he was never fired, and the team became a 109-point club. The
  exception is the new five-year cap: still in the bottom three five years into
  the job reads as a miss.
- **The owner asked for respectability or the playoffs.** Two straight
  seasons at the bottom end it. Columbus under Kekäläinen is an example. The
  model agrees: the basement is now a failure under competeRespectably. In r1
  the same slide (30th, then 31st against a target around 24th) survived,
  because 31st was graded as "missed". A unit test now pins that it is fired.
  In r4 and r5 he is fired after makePlayoffs #16 → #28 and then contend
  #2 → #19.
- **Improvement is not punished.** A club that is improving steadily and
  keeps making the playoffs is not fired for first-round exits (unit test).

### Autopilot bugs the calibration exposed (fixed)

A GM who took over a club mid-summer could arrive with far more than 23 men on
the roster.

- **Cause 1:** the autopilot tabled about 31 async free-agent offers at once.
  Offers are now capped at the number of open slots, counting offers already
  pending.
- **Cause 2:** cut day made at most 6 decisions. Cut day now issues as many
  as it takes to get down to 23.

### Open lead

One intermediate run (r2, seed 2029, 2030, day 166, no job change) reported
**27 on the NHL roster** after the deadline, with no autopilot move in
between. The most likely cause is the emergency-signing path in
`emergencyRecalls`, which signs street free agents when the whole organisation
is short at a position and does not check the 23-man ceiling. The final runs
did not reproduce it.

---

## 3. Audit: "an event promises an action the game won't honour"

The rule, following E2's extension guard: **a scene may only offer what the
engine will perform, and every refusal is a sentence.** The guards live in
`decisionEvents.test.ts` (content integrity) and `promisedActions.test.ts`
(end to end).

### Decision events

| Event / option | Promised | Before | Now |
|---|---|---|---|
| healthy-scratch-vet / "You dress tomorrow" | he dresses | ice-time promise only; he stayed scratched | `act: dress` un-scratches him |
| medical.play-through-it / "Let him play" | he plays hurt | **never**: injured players are never dressed | `act: playThrough` clears a minor knock (fatigue +22, form −1); event gated to injuries of 4 games or fewer |
| injury.play-through-it / "Let him play… He dressed." | he dressed | never | same act; gated to 8 games or fewer; a longer injury is refused, and the receipt says so |
| "Sit him" / "Leave it to the medical staff" | he sits | honoured (he is injured) | unchanged |
| goalie.pulled-again (whole event) | — | **never fired**: `maxSavePct: 0.888` against a whole-number context | 88; a test pins the scale |
| goalie.pulled-again / "I'll stop pulling you" | coach's in-game pulls | a stance, tracked as a promise | unchanged (documented exception) |
| trade-block-question / "He's not going anywhere" | off the market | nothing | `act: untouchable` |
| rental-honesty / "You finish it here" ("took your best trade chip off the market") | off the market | nothing | `act: untouchable` |
| minors.buried-veteran / "Bring him up" | call-up | nothing; the ice-time promise then broke automatically | `act: callUp`; a refused recall gives its reason and plants no promise |
| minors.buried-veteran / "Let him go, with thanks" | release | nothing | `act: release`: mutual termination, he becomes an unrestricted free agent, with news and a transaction |
| rental-vs-room / "Take the picks… You banked the futures." | a trade | **nothing** | `act: sell`: shop him and accept the offer with the most picks, or "nobody bit" or "market closed" |
| rental-vs-room / "Keep him. We're going for it." | keep him | nothing | `act: untouchable` |
| rental-vs-room / "Try to extend him before Friday" | extension | legal (final year; the deadline falls at 75% of the season, after the extension window opens) | unchanged |
| owner.sell-the-fans-a-story / "Give him a move — trade someone the fans know… You spent a player" | a trade | **nothing** | `act: sell` |
| crease.goalie-controversy / "He's the starter" | named starter | nothing | `act: makeStarter` |
| crease.goalie-controversy / "Sit him. Let the backup run with it." | backup starts | nothing | `act: benchStarter` (net swapped) |
| crease.goalie-controversy / "Split the net" | tandem | a stance (no rotation mechanic) | unchanged; the text claims no lineup change |
| prospect.rush-or-ripen / "Bring him up now" | call-up | nothing | `act: callUp` |
| kid-takes-the-vets-minutes / "Give the kid the minutes" | first power-play unit | nothing | `act: topPowerPlay` (the oldest man on PP1 drops) |
| young-star-early-extension / "open extension talks" | discounted extension | honoured (E2) | unchanged |
| backup-wants-a-job, owner.streak-ultimatum / explore a trade | promise | judged at the deadline | now given a due day |
| **Every** promise planted by a scene or at the negotiation table | "the room will check" | **never judged**: no due day, and summer promises were waved through as "kept" at the rollover | `promiseTerms()`: ice time is judged 5 weeks on; trade promises at the deadline; summer promises are about next season and judged 5 weeks into it; the rollover skips promises that are not yet due |

A refused act replaces the receipt with the refusal. The inbox shows "It
didn't happen: …", and the leak story quotes the receipt that actually
happened.

### Club scenes

| Scene / option | Promised | Before | Now |
|---|---|---|---|
| draft call / "Come to camp and take a job off somebody" | an 18-year-old can win an NHL job | **impossible**: drafted juniors hold rights and join the AHL at 20; the ice-time promise could only break | reworded to development camp (which he attends); promise removed |
| draft slid-to-us / "Tell him what the reports said" | ice-time promise | an ice-time promise on a junior, so always broken | promise removed (found by the new guard) |
| arrival / role talk | ice time | promise | now actually judged (due day) |
| farm playoff trip | GM attends | honoured (E1) | unchanged |

### Staff and scout meetings

| Proposal | Before | Now |
|---|---|---|
| "Sit him a game" (scratch) | **toggled**: accepting it for a man already scratched put him back in; it never lifted after the game; it claimed success when four men were already scratched | one-game scratch that is served and lifted (`practiceState.oneGame`); "already scratched" and "four already sitting" receipts |
| "Rest him" | toggled a resting man back into the lineup; silent on refusal | stays resting; refusal sentence |
| "Call him up", "Put him on LTIR", "Move him to line N" | returned `null` (silence) on refusal | the refusal names the reason |
| scout meeting: track / refocus | honoured | unchanged |

### Owner asks (card, phone and Club Vision)

| Ask | Before | Now |
|---|---|---|
| any "go along with it" | confidence banked at once; **never checked** | a written commitment with a due day. Kept: +3 confidence. Broken: −(2 × gain + 2) confidence, −5 patience, "The owner remembers what you told him". |
| signMarketableStar | — | kept if an arrival rated 80+ comes within 30 days |
| pushForPlayoffs | could be asked **after the deadline** (the market is shut) | never asked in the last 5 days before the deadline or after it; kept if a veteran (27+, rated 74+) arrives by the deadline |
| trimPayroll | — | kept if the cap used drops by at least 2% of the cap within 30 days |
| developYouth | — | kept if under-24s play 2 games per club game over 30 days |
| extendFanFavourite | the card went out even when **no such veteran existed** | only asked when the named man exists (`subjectId`); kept if he is extended or re-signed before the season ends |

The phone and the Club Vision screen stop showing an ask once it is accepted.

### Inbox concerns

| Option | Before | Now |
|---|---|---|
| feud / "Promise to address the room" | a promise to do something the game had no action for, and nothing checked it | "Step in and address the room": choosing it settles the feud arc |
| trade request / iceTime / future promise options | judged (LW5) | unchanged |

### Board and career events

| Event | Before | Now |
|---|---|---|
| "GM dismissed" season review | undone at the rollover | honoured (hard gate, real move) |
| GM job market | phantom vacancies | the clubs that actually dismissed their GM |
| board-meeting promises (finishAtLeast, playoffBerth, youthGames, shedSalary, marqueeName) | judged | unchanged |
| trade offers and phone "See the offer" | real offers | unchanged |
