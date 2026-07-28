# THE BAR — Excellence Standard for 1.0

This is the game-design constitution for **The Show: Franchise Hockey Manager**.
It defines what "done" means, measured against modern Football Manager and the
best of indie design — as a *player experience*, not a feature list. Every loop
iteration, every epic, every review is judged against this document.

**Status: FEATURE FREEZE.** The game has more systems than EHM ever shipped.
Until the bars below are met, we do not add systems — we finish, deepen, and
polish the ones we have. "New" is only allowed when a bar below demands it
(e.g. the decision-event library).

---

## 1. The Promise

> **You are an NHL GM, and your career will be worth retelling.**

Every save should generate at least one story the player would tell a friend
unprompted: *"In my save, I traded Crosby at the deadline, the room turned on
me, and two years later he eliminated us in six."* That sentence is the
product. Everything else — stats, screens, sims — exists to make sentences
like it happen, be noticed, and be remembered.

The fantasy has three ingredients, in order:
1. **Consequence** — my choices change what happens (the sim is real).
2. **Memory** — the world remembers what I did (and brings it back up).
3. **Character** — the people involved feel like people, not rows.

---

## 2. The Benchmark, Decomposed

### What modern FM actually does right (match these)

| # | FM strength | What it really is |
|---|---|---|
| F1 | **Information confidence** | Every decision has its data one click away. The game never feels like it knows something it won't show you. |
| F2 | **The delegation spectrum** | Playable 5 min/day or 5 hrs/day. Every chore has "let my staff handle it." Nothing *forces* engagement. |
| F3 | **Receipts** | The game constantly attributes outcomes to YOUR choices. "You promised X. Y happened." Praise and blame land on you. |
| F4 | **The inbox as narrative spine** | News is addressed *to you*, in-world, with a voice — not a changelog. |
| F5 | **Match day as ritual** | Buildup → team talk → the match as an event → post-match reckoning. It's an occasion, not a dice roll. |
| F6 | **A career that follows you** | Reputation, history, relationships persist across jobs and decades. |
| F7 | **The craft floor** | It essentially never crashes, screens are instant, and the UI is one language. Trust is a feature. |

### Where FM is weak (attack these lanes — this is where we WIN)

| # | FM weakness | Our attack |
|---|---|---|
| W1 | **Sterile characters** — every player/agent talks the same | Legible personalities that *predict behavior*, distinct voices |
| W2 | **Press conferences are a hated chore** | Fewer, better staged media moments; everything skippable with consequence, not nagging |
| W3 | **No real memory of drama** — FM forgets last season's feud | The World Chronicle already exists. Use it EVERYWHERE. Callbacks are our signature. |
| W4 | **Repetition fatigue** — same interaction text for 30 seasons | The Hades content model (§4). Hard rule: nothing repeats verbatim within a season. |
| W5 | **Bloat/slowness** — FM takes minutes to boot, seconds per screen | We are instant. Every screen < 100ms perceived. Speed is a luxury feel. |

We do **not** try to beat FM at 3D match fidelity (until Blender assets exist)
or licensed content. We beat them at **character, memory, consequence, speed**.

### Lessons from the greats (the rules we adopt)

- **Hades** — repetition done right: thousands of *authored* lines, selected by
  state priority, no-repeat tracking, callbacks to YOUR history. The reason
  Hades never feels stale isn't generation — it's **authored variety + smart
  selection**. This is our content engine model (§4).
- **Crusader Kings 3** — an event is: a *character-driven situation* + a
  *decision with a real tradeoff* + a *delayed callback*. Never a toast.
- **Wildermyth** — mechanical outcomes get story dressing that cites
  relationship history. The sim result is the skeleton; the retelling is the product.
- **Slay the Spire / Into the Breach** — total clarity: every number's origin
  is inspectable; the player is never confused about *why* something happened.
- **OOTP** — statistical credibility IS fantasy fuel. Numbers that look like
  real NHL numbers make the world believable (our calibration harness ethos).
- **Balatro** — spend juice (sound, motion, celebration) ONLY on the moments
  that matter, and spend it hard. A cup win should feel 100× a regular win.

---

## 3. The Seven Pillars (with bars)

Every bar is written to be *checkable* — by the autopilot, a harness, an audit
script, or a 10-minute human playtest. "Feels better" is not a bar.

### P1 — The First Hour
The new-player fantasy must land before the first save file closes.
- **B1.1** Launch → first meaningful GM decision in **< 3 minutes** (no wall of setup; smart defaults, "take over the Penguins" one-click path).
- **B1.2** The first session ends on a hook: your first game, a crisis, or a promise — never on paperwork.
- **B1.3** A player who has played FM needs **zero explanation**; a player who hasn't gets one-line contextual hints (not a tutorial mode).
- **B1.4** The standalone build installs and launches with no SmartScreen scare, no frozen window, voices working. First impressions are release engineering.

### P2 — The Continue Loop (the heartbeat)
Every press of Continue is the game's atomic promise.
- **B2.1** Every interruption is one of exactly three things: a **decision** (something to choose), a **story beat** (something to feel), or **silent** (nothing worth your time — don't stop). Zero empty stops. Zero "OK"-button-only modals.
- **B2.2** Nothing ever blocks the sim without saying **exactly what it needs and offering a one-click way to resolve or delegate it** (the camp-softlock class is extinct).
- **B2.3** Median gap between meaningful choices ≤ 3 presses in-season; a full season is finishable in **< 45 minutes** when delegating everything, **and that playthrough still tells a story**.
- **B2.4** Every recurring prompt (training, meetings, camps, pressers) has a delegate toggle AND a visible payoff when you do engage (§P5 receipts). If we can't show the payoff, the prompt doesn't exist.

### P3 — The Season Arc
A season must have acts with distinct texture, not 82 identical ticks.
- **B3.1** The season has named beats the game *acknowledges in tone*: camp battles → opening night → the Thanksgiving benchmark (playoff-odds reality check) → the deadline → the stretch → playoffs → the handshake line → the offseason gauntlet. A player can tell which act they're in with the UI covered except the inbox.
- **B3.2** **Deadline day is the best day of the year**: live wire, ticking clock, AI GMs calling YOU, one-more-call temptation. If a playtester doesn't feel deadline-day adrenaline, this bar fails.
- **B3.3** Playoffs feel 2× louder than the regular season: presentation, stakes framing, elimination-game dread, handshake moment. Multi-OT playoff games are events.
- **B3.4** The offseason is a *gauntlet of decisions* (awards → draft → RFAs → July 1 frenzy → arbitration → camp), each with its own texture — not a menu you grind through.

### P4 — The Dynasty (5–20 years)
The long game is where GM sims live or die.
- **B4.1** A 10-season autopilot run: **zero crashes, zero softlocks** (this is a merge gate, not an aspiration).
- **B4.2** Eras are *felt*: your core ages, prospects bloom into stars with visible arcs, a rebuild has a narrative shape. The game should be able to answer **"what happened in 2029?"** with a season chronicle page worth reading.
- **B4.3** Records being approached are surfaced *as they happen* ("Ovechkin needs 3 goals to pass Gretzky by March") — chases, not footnotes.
- **B4.4** Rival GMs hold grudges and remember fleecings; your reputation arc (wheeler-dealer, drafter, cap wizard) is stated and consequential.
- **B4.5** No headline, interaction line, or event text repeats verbatim within a season; nothing repeats more than 3× a decade (§4 no-repeat ledger makes this auditable).

### P5 — Characters & Narrative (the differentiator)
- **B5.1** **The 5-character test**: after one season, the player can name five people in their save (a player, an agent, a coach, an owner, a journalist) and say what each is *like* — because personality visibly predicts behavior.
- **B5.2** **30% of story beats cite a specific past event** from the chronicle by name ("first meeting since the December trade"). Memory is our signature; make it constant.
- **B5.3** Promises are a ledger with due dates and receipts — kept ones build the room, broken ones surface at the worst moment.
- **B5.4** Voice is **rarer and better**: the diegetic phone (deadline calls, agent hardball), draft night, and playoff pressers — cast-consistent (same character = same voice, always) — instead of thin voice everywhere.
- **B5.5** The decision-event library (§4) delivers CK3-grade situations: locker-room flashpoints, media traps, owner dilemmas, injury gambles — each a real tradeoff with a delayed callback. **v1 bar: 50 hand-authored events**, hockey-authentic, none resolvable by an obviously-correct answer.

### P6 — Match Night
- **B6.1** Pregame ritual (compressed when simming, full when watching): the storyline (chronicle-fed), the keys to the game, your lines vs theirs.
- **B6.2** Postgame receipts every game: grades, the turning point, a coach/player quote that reflects personality and result — and your pregame choices referenced when they mattered (F3).
- **B6.3** Watching a game generates ≥ 1 storyline that persists (a scrap that starts a feud, a rookie's first goal, a goalie stealing it).
- **B6.4** The 2D match reads as *hockey* to a hockey fan: line changes, PP formations, goal-mouth scrambles, momentum. (3D parks until assets.)

### P7 — The Craft Floor (trust)
- **B7.1** `tsc --noEmit` **0 errors** on BOTH tsconfig.web (441 now) and tsconfig.node (330 now); the gate stays real forever after.
- **B7.2** Autopilot 10-season nightly on the modded 32-team league: green, plus a **UI-driving playtester** (Playwright harness exists) that clicks every screen each night.
- **B7.3** Every visible lever changes sim state (the "clear logic" rule) — dead levers are bugs with the same severity as crashes.
- **B7.4** Save/load: byte-stable roundtrip, backward-compatible loads two versions back, autosave never loses more than a day.
- **B7.5** Every screen < 100ms perceived; Continue tick < 1s in-season. Speed is a feature we hold over FM.
- **B7.6** One visual language (tokens/icons/motion — shipped) with zero regressions; ui:snap diffs reviewed on merge.

---

## 4. The Content Engine — authored beats generated

**Decision: the LLM writer is demoted to optional garnish.** The user tested it;
it "didn't add much." Hades proved the alternative: **hand-authored variant
pools + state-keyed selection + no-repeat tracking + callbacks** beats
generation on voice, and it's deterministic, testable, and shippable.

The model (build once, feed forever):
1. **Variant pools** — every recurring trigger (win streak, slump, injury,
   milestone, trade reaction, presser answer…) has ≥ **8 authored variants**,
   each tagged with conditions (personality, relationship, standings, era,
   severity, prior-history flags).
2. **State-keyed selection** — pick the *most specific* eligible variant
   (Hades' priority rule), not a random one. A generic line only fires when
   nothing specific applies.
3. **No-repeat ledger** — persisted per save: a variant used this season is
   ineligible; audit script proves B4.5.
4. **Callbacks** — a % of pools *require* a chronicle citation slot ("…their
   first meeting since {event}"). This is cheap and is our signature move.
5. **Tentpole one-offs** — the biggest moments (cup win, legend retirement,
   #1 pick, firing) get bespoke, non-pooled scenes. Juice spent hard (Balatro rule).
6. **The decision-event library** — CK3-shaped: situation → 2–4 options with
   real tradeoffs → delayed consequence + callback. Authored in a data file so
   writing events never touches engine code. 50 events for 1.0; grow forever.

The LLM layer stays behind a flag for players who want it, seeded BY the
authored system's fact sheets — never replacing it.

---

## 5. The Gap List v1 (ranked — the loop works TOP-DOWN from here)

Evidence: user playtests (camp softlock class, "training is a chore",
"stale RP/voices", SmartScreen, LLM-writer verdict), autopilot (2 seasons,
**0 trades / 0 signings** — the market loops gave even a motivated agent no
reason to engage; that is friction evidence), code audit (441+330 tsc, cap gap).

**P0 — Trust (the floor)**
1. **[CLOSED 2026-07-28]** Beat-gate sweep: every pending/blocking state states its need + one-click resolve/delegate (extinct the camp-softlock class). *(B2.2)* — **states its need: DONE.** All nine gates now name themselves on the Continue button in the shell'''s own routing order (career.ts continueLabel, pinned by continueLabel.test.ts); five in-season ones used to route the GM somewhere the button never mentioned. **resolve/delegate: DONE.** All nine audited one by one; eight already had an escape (auto-resolve on a second Continue, or "let the AGM / Head of Scouting handle it"). The captaincy had none — it blocked Continue outright until the GM found the C button — so `nameCaptainByCoach()` + a "Let the coach name him" button now closes it. **Gap CLOSED 2026-07-28.**
2. **[CLOSED 2026-07-27]** Extend autopilot to 10 seasons nightly; fix every crash/softlock found. *(B4.1)* — 10/10 green on seeds 2029 and 777 after five crash fixes; cross-validated on a second seed because one passing seed is weak evidence.
3. **[IN PROGRESS]** tsc burn-down: web 441→**209**, node 330→**167**; then the gate is law. *(B7.1)* — treat as a bug hunt, not cleanup: it has so far surfaced league-wide PP%/PK% misattribution, dead physio/shutout/history-flag reads, and two dead content pools.
4. **[CLOSED 2026-07-28]** In-season cap compliance (known filed gap — emergencyRecalls stacks salary uncapped). *(B7.3)*
5. **[BLOCKED — user]** Release trust: code-signing/SmartScreen, dev-freeze fix, voices in packaged build. *(B1.4)*

**P1 — The loop feels great**
6. **[RE-SCOPED 2026-07-28]** ~~Chore-ectomy of training/practice: weekly nag → monthly plan~~ — **the nag no longer exists.** Verified in code: `tickPractice` runs every 7 days silently (fatigue + promise upkeep), pushes no inbox item, sets no due-flag and gates nothing; practice reaches the GM only through the bi-weekly staff meeting, which is already a beat gate with a delegate escape, plus two opt-in screens. Task #170 appears to have removed the chore already. **What remains is the last clause only: visible payoff receipts.** A grep across the codebase for any payoff/attribution concept returns nothing — the Development Center lets you set a focus and says it "biases his growth", but nothing ever tells you whether it worked. Closed the practical half: the growth WAS computed (U23 Progress tab) but sat one tab from the focus dropdown, so a Season column now sits beside Dev focus on the prospects table. **Remaining: true attribution** (growth caused BY the focus, needing persisted per-player accounting of the practice modifier) rather than growth shown next to it. *(B2.4)*
7. **[CLOSED 2026-07-28]** Continue-cadence audit: classify every interruption decision/story/silent; kill everything else. Processing overlay = the delivery vehicle. *(B2.1)* — decisions = the nine beat gates (Gap #1); mail classified in lib/cadence.ts. Measured 57/60 advances holding -> 45/60 by dropping ambient league churn to silent-tier.
8. **[PARTIAL]** **Market engagement friction** (the autopilot 0/0 finding): AI GMs proactively pitch you (they have personas — use them), market temperature visible, counters scaffolded to one click. *(B3.2 feeds this)* — **the 0/0 was a BUG, not friction**: the offer generator picked partners from all 460 world clubs instead of the 32-team league, so ~93% of calls came from a club that could not trade. Fixed (`leagueTeamsOnly`); imported league went 0 -> 8 inbound offers a season. (a) the VANILLA silence was a SECOND cause — MIN_SHOP_VALUE sits above that league's 90th percentile of player value, so nobody was ever targetable; adaptive floor fixed it, 0 -> 5 offers per 90 days. **Remaining: market temperature and one-click counters not started.**

**P2 — Stale → alive (the first overhaul epic)**
9. Content engine build-out (§4): pools + selection + no-repeat ledger + callback slots wired into the existing news/interaction/press systems. *(B4.5, B5.2)*
10. Variant writing pass 1: the ~30 most-seen triggers to 8+ variants each, personality-conditioned. *(B5.1)*
11. Decision-event library v1: **50 authored events**, data-driven. *(B5.5)*
12. Voice re-scope: phone + draft + playoff pressers only, cast-consistent; cut thin voice elsewhere. *(B5.4)*

**P3 — Season shape**
13. Deadline day war-room to the B3.2 bar (clock, incoming calls, live wire).
14. Playoff presentation ×2 (stakes framing, elimination dread, handshake, bespoke cup scene). *(B3.3)*
15. **[CLOSED 2026-07-28]** Match-night ritual: pregame keys + postgame receipts, in simmed form too. *(B6.1–B6.2)*
16. Thanksgiving benchmark + season-act tonal shifts. *(B3.1)*

**P4 — Dynasty**
17. Season-chronicle page ("what happened in 2029") + record-chase surfacing. *(B4.2–B4.3)*
18. First-hour pass: 3-minute path, hook ending, contextual hints. *(B1.1–B1.3)*

---

## 6. Operating Model

- **The loop (`/improve`) is now a finisher, not a builder**: work the Gap List
  top-down; an iteration = close (or measurably advance) ONE numbered gap, pass
  the gates, cite the bar it serves. New systems are out of scope during the freeze.
- **Overhaul epics** (Gap 9–12 narrative; 6–8 loop-feel; 13–16 season shape) run
  one at a time with a short design doc approved by the user *before* code —
  taste calls are the user's.
- **Measurement arm**: nightly autopilot (10 seasons) + UI playtester + no-repeat
  audit + ui:snap. Their findings insert into the Gap List above anything cosmetic.
- **The user plays a build weekly.** Human playtest notes outrank everything —
  they found what no harness did. Each note gets triaged into the list within a day.
- **Reviews** (`/review-depth`) now ask one more question: *which bar does this
  serve, and did it move?*

## 7. What we are NOT doing (until post-1.0)

New leagues/rulesets · gear & sponsors (#50) · Feed D/E accounts & broadcast
(#150/151) · 3D overhaul (#52, gated on assets) · national-team expansion ·
BYO-key anything (dev-only, hidden) · any new screen that doesn't serve a bar.
