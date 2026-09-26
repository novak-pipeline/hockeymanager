# Gameplay-Loop Audit: The Year As Played

**Auditor role:** gameplay loop designer (read-only). **Branch:** improve-loop @ 04285c4. **Date:** 2026-09-26.
**Question:** What is it like to play a full year of *The Show*, press by press? Where does it pull you into "one more week", and where does it interrupt without giving you anything back?

---

## 0. Method and evidence

1. **Docs read.** EXCELLENCE.md (P1–P3 bars, Gap List), SEASON-RHYTHM.md, OFFSEASON-2.md, PLAYTEST-2026-07-23/-07-31/-08-26, autopilot summary-latest.md, RnD/yt-digest.md.
2. **Code read.** beatGates.ts, lib/cadence.ts, career.ts (`advanceDay`, `advanceOffseason`, `continueLabel`, the training-camp and dev-camp engines, `reassignFarmSystems`, interactions, decision events), TrainingCampScreen, DevCampScreen, PhoneCallOverlay + lib/phoneCalls.ts, livingLedger.ts, league/interactions.ts, ProcessingOverlay.
3. **A measurement harness I wrote for this audit (scratch only; nothing in the repo changed).** It is a copy of `beatGateAudit`'s shell-faithful walker, extended to log every press: date, Continue label, route/spend/advance, new inbox items, how many of them `worthAStop()` classifies as worth holding the Processing overlay for, new player concerns, and new owner requests. It walks one career year from the summer takeover, delegating every beat, which is the B2.3 "delegate everything" playthrough.
   - Run A: **imported 32-team NHL DB, Pittsburgh, seed 2029** (82 games, the user's real world). 330 presses, 73 s.
   - Run B: vanilla generated league, seed 313 (shorter schedule; used for cross-checks only).
   - Raw logs: `scratchpad/loop/mod-pit.tsv` and `gen313.tsv`. Harness: `scratchpad/loop/measure.test.ts` and `measure.config.ts`.

The walker counts a gate as 2 presses (Continue routes you into the room, then Continue spends it). A human who stays in the room clicks about once per beat, so for human-click estimates I halve the gate presses.

### Headline measurements (Run A, Pittsburgh, one year)

| Metric | Value | Comment |
|---|---|---|
| Regular-season plain advances (one per league day that has games) | 140 | 82 games, so **about 1.7 advances per Penguins game** |
| Plain advances where the overlay HOLDS (`shouldHoldOverlay`) | **116 of 140 (83%)** | Worse than the 45/60 (75%) recorded when Gap #7 was closed. B2.1's "silent" tier barely exists. |
| Stop-worthy items per in-season month | 80–114 | About 3 per press. "Scout report: X" alone fires 1–2 times a day and always counts as stop-worthy (the scouting category never counts as league churn). |
| Blocking beat gates, Oct–Apr | **49** (about 7 per month) | 23 trade offers, 13 staff meetings, 6 scout meetings, 1 deadline, plus camp and the boardroom |
| **Trade-offer gates** | **23 in one season** (4–6 per month until the deadline) | Each one holds Continue. Delegated, the AGM "passes" every time. This is the single largest source of blocking stops. |
| Staff meetings | 13 (every 14 days, like clockwork) | Autopilot: the headline *"You left it to the staff"* fires **13–18× per season**, and *"You left the board to the staff"* 7–10×. |
| Scout meetings | 6 | Monthly |
| Player concerns ("wants a word" / office scenes) | 4 per year (2 mild, 2 serious) | Rare enough, but see §2: the generic ones have a dominant answer and ignoring them costs nothing. |
| Owner phone directives | 1 per year | Fine |
| Presses where nothing arrived (empty advance) | 24 in-season, plus 4 after playoff elimination and about 5 in camp/dev camp | Each is an empty stop, which B2.1 forbids |
| Offseason presses (end of playoffs to opening night) | about 29 human clicks | Short, but see §4: all of August and the whole arbitration and preseason calendar are one jump |
| Awards press (June 18) | **60 news items in one press** (22 stop-worthy) | Firehose after a 2-month silent gap |

### Calendar-coherence bugs the walk surfaced (cheap to fix, and each breaks the fiction)

1. **The takeover year skips a year.** The summer takeover is dated 2025-06-27 → 2025-07-08 → 2025-09-15, then the season runs as **2026-09-15 → 2027-04** ("2026–2027 campaign"). The DB season is 2026-27, so the summer dates are a year early. The cause is in `offseasonDateISO`, where `summerYear = currentDay === 0 ? year : year + 1`. After the jump, the same summer's September reads 2025 and 2026 on consecutive presses.
2. **Continue names the wrong beat at the draft.** On the draft press the button reads *"Continue — end-of-season review"*, but `routeContinue` sends the GM to the draft, because `draftPending` is the first hard gate while `continueLabel` checks `reviewFacts` before the stage labels. This is the exact trust bug Gap #1 said was closed. `continueLabel.test.ts` does not pin the draft+review combination.
3. **A two-month hole after the playoffs.** Pittsburgh was eliminated on Apr 20; the playoffs end Apr 25; the next press is **June 18** (awards, draft preview, and the combine all at once). The real Stanley Cup Final runs to mid-June. The whole of May, with lottery, combine and exit interviews, does not exist, and the awards/draft/combine mail lands in one 60-item dump.
4. **Four empty presses after elimination.** Once your club is out, *"Continue — next playoff games"* is pressed four times with nothing arriving. There is no "sim to the end of the playoffs" and no "your season is over" beat.
5. **Dev camp's "week" never moves the date.** All three dev-camp beats are stamped 2025-06-27, so "a week of camp" is three presses on the same day.
6. **The "Cut day — camp verdicts are in… Training camp is over" mail fires when camp OPENS** (Sep 15, from `reassignFarmSystems`), eight days before cut day.

---

## 1. THE YEAR AS PLAYED — annotated timeline (June → June)

Legend: **Type** = SCREEN (full-screen beat gate), GATE (named on Continue and blocking), POPUP (phone overlay), INBOX, OVERLAY (Processing overlay hold), SILENT.
**Rating:** FUN = a meaningful decision or payoff · NEUTRAL = information · FRICTION = interrupts without a meaningful choice, repeats, or asks a decision that doesn't matter.

### Act I — Summer (end of playoffs → Sep 14). About 29 clicks.

| # | Beat (in-game date) | What the player sees and does | Type | Rating | Notes |
|---|---|---|---|---|---|
| 1 | Elimination → "next playoff games" ×4 | Nothing | OVERLAY/empty | **FRICTION** | No "season over" moment and no fast-forward. For a non-playoff club (Pittsburgh in the autopilot's 2025–30 run), this is 2+ weeks of empty presses. |
| 2 | Awards (jump to Jun 18) | 60 mail items: trophies, draft preview, combine concerns, redraft, trade re-grades, fan delta, board verdict | OVERLAY | NEUTRAL (buried FUN) | Several genuinely good receipts (the redraft, the one-year trade re-grade) drown in the dump. There is no ceremony. B3.4 wants "awards" as its own texture. |
| 3 | End-of-season review | Boardroom receipts meeting; promises read back | SCREEN (skippable, "you sent regrets") | **FUN** | Right idea. Skipping it costs a line in the minutes, which is fine. |
| 4 | Entry draft | Draft screen: sim to pick, pick, or auto-draft | HARD GATE | **FUN** | The one mandatory summer event, as it should be. Button mislabels it (bug 2). |
| 5 | Post-draft call to the best pick | Phone popup | POPUP | NEUTRAL | Nice RP, no choice. |
| 6 | Dev camp ×3 (arrival / scrimmage / wrap) | Invite list; a talent-weighted random box score; grades; name a standout | SCREEN ×3 | NEUTRAL → mild FRICTION | The standout pick gives +6 morale and 4–9 knowledge. The scrimmage is dice weighted by `(potential + overall)/2`: it leaks potential and never touches the sim engine. Same date ×3. |
| 7 | Re-sign window, days 1–4 (Jun 27–30) | QOs, re-sign offers answered over days, rival offer sheets | GATE-less days | **FUN** when you have RFAs, NEUTRAL otherwise | A real window with memory. Good. |
| 8 | July 1 | "Free agency is open: 155 on the market" | INBOX | **FUN** (anticipation) | But the AI runs "two beats behind", so the FRENZY lands on day 3 (Jul 3), not July 1. |
| 9 | FA days 1–8 (Jul 1–8) | Standing offers resolve daily; offer sheets tick; losses debriefed ("you lose X to Y — it was the term") | Day presses | **FUN** days 1–3, NEUTRAL 4–8 | "You lose X" with a reason is excellent receipt design. Days 5–8 are mostly empty presses. |
| 10 | FA day 8 → **Sep 15** (one press) | Arbitration awards auto-accepted or walked; world FA sweep | SILENT jump | NEUTRAL | Compressing August is right (OFFSEASON-2's cadence law). But arbitration has no hearing date (the real ones run Jul 20–Aug 1), PTO invites have no beat, and there is no "summer market check". Arbitration is decided on the Offseason screen or lapses. |
| 11 | Name your captain | Leadership screen, or "let the coach name him" | HARD GATE | NEUTRAL | Needed only when the C is vacant. Fine. |
| 12 | "Start the new season" | Coaching-change mail around the league | press | NEUTRAL | |

### Act II — Preseason (Sep 15 → Oct 1). About 10 clicks.

| # | Beat | What happens | Type | Rating | Notes |
|---|---|---|---|---|---|
| 13 | Camp Day 1: fitness tests | Headcount; "X and Y sharpest" (overall ± 8 noise) | SCREEN | NEUTRAL | |
| 14 | Day 2: scrimmage 1 | Random stat lines from talent, plus 1–3 **filler goals** per side | SCREEN | **FRICTION** | Looks like gameplay, but see §5: the result cannot change anything. |
| 15 | Day 3: "skating drills & systems work" | One text line | SCREEN | **FRICTION** | Empty stop |
| 16 | Day 4: scrimmage 2 | As day 2 | SCREEN | **FRICTION** | |
| 17 | Day 5: "video & dryland" | One text line | SCREEN | **FRICTION** | Empty stop |
| 18 | Day 6: "full-team practice" | One text line | SCREEN | **FRICTION** | Empty stop |
| 19 | Day 7: coaches file reports | Reports whose recommendation **is the pre-camp `coachPlan`**; the scrimmage rating is only quoted in the prose | SCREEN | FRICTION (dressed as NEUTRAL) | |
| 20 | Day 8: cut day | ≤ 6 promotions and ≤ 6 demotions chosen by `farmSplit` on ratings *before camp opened*, plus PTOs. NHL/AHL toggles, waiver flag, "break camp" | SCREEN | **FUN** (the only real one) | The waiver trap exists and is real (claims happen). The rest of the week does not inform it. |
| 21 | Preseason board meeting (Sep 23) | Negotiate the mandate and make promises | SCREEN | **FUN** | Right beat, right order (after the roster exists) |
| 22 | Sep 23 → Oct 1 | One press | | NEUTRAL | No preseason games exist at all (OFFSEASON-2's exhibitions were never built) |

If the farm sort finds nothing to change, **there is no camp at all** (Run B, year 1: summer → captain → boardroom → opening night). The flagship chapter can vanish.

### Act III — Regular season (Oct → mid-Apr). About 190 presses delegating, far more engaging.

| # | Beat | Frequency (measured) | Type | Rating | Notes |
|---|---|---|---|---|---|
| 23 | Match day (yours) | 82 | pregame frame → sim → postgame receipt | **FUN** (the heartbeat) | Receipts are liked (playtest A5). Watching remains optional. |
| 24 | League day without your game | about 58 | OVERLAY holds 83% of the time | **FRICTION** | Many hold only for "Scout report: X", slump or drought quotes, or "@puckmodel" posts |
| 25 | Trade offer from X | **23 per season**, 4–6 per month until the deadline | GATE → Trades screen | **FRICTION** in the median case; FUN when it is a real target | The AGM passes on every one if you sim past. With no "call me only for offers above X" threshold, a routine depth swap blocks as hard as a blockbuster. It is the #1 interrupter. |
| 26 | Staff meeting | Every 14 days (13 per season) | GATE → StaffBriefing | NEUTRAL to FUN on its good items; FRICTION as a cadence | The agenda is real (line moves, rests, call-ups mutate the sim) but on a timer, not triggered by events. SEASON-RHYTHM's law is "never on a timer". Autopilot: delegated 13–18×/season. |
| 27 | Scout meeting | Monthly (6) | GATE | NEUTRAL | In-season, pro-scouting value is modest. Hold it back for the draft run-up and it earns its stop. |
| 28 | Weekly scouting digest | Holds only when a new card exists (1× in the run) | GATE → inbox | NEUTRAL | Well damped |
| 29 | Player concern / "wants a word" / office scene | 2–4 per season | INBOX card + POPUP if serious | FRICTION (generic concern) / FUN (authored scene) | See §2 |
| 30 | Owner directive | About 1 per year | POPUP → Board | **FUN** | Rare and consequential. Correct. |
| 31 | Living Ledger (leak → confrontation → agent call) | Only after you shop, scratch or demote someone | INBOX + POPUP | Could be FUN; currently FRICTION | Personality gates are dead (§2), so every man reacts the same way |
| 32 | Thanksgiving, holiday freeze, All-Star break | 0 mechanical beats | Calendar chips only | **absent** | "Holiday Roster Freeze" is a calendar label; trades still flow (`career.ts:11914`: "the market is open year-round") |
| 33 | Trade deadline | 1 hold (single day) | GATE → DeadlineDay | FUN but thin | Playtest G: "shows things but you can't act… nothing unfolds". The deadline-clock work in memory is **not on this branch**. |
| 34 | Deadline → end of season (about 7 weeks) | Only staff and scout meetings | | **SAG** | No playoff-race beat, no clinch or elimination moment, no "magic number", no trade market (correctly closed). The longest dead stretch of the year. |

### Act IV — Playoffs (mid-Apr → late Apr in-game). About 17–25 presses.

| # | Beat | Rating | Notes |
|---|---|---|---|
| 35 | Series games | **FUN** | Stakes are inherent. B3.3 (2× louder presentation) is still open. |
| 36 | Elimination | FRICTION | No handshake beat and no season-over beat, followed by the empty presses in row 1 |

### Scorecard

Of 36 beats: **FUN 11 · NEUTRAL 12 · FRICTION 11 · absent 2**. The friction clusters in three places:
- **training camp** (6 of 8 days),
- **the in-season interrupt mix** (trade offers, timer-driven meetings, overlay holds),
- **the season's seams** (post-elimination, May gap, post-deadline sag).

The FUN beats are almost all *once-a-year* decisions: draft, re-sign window, July 1, cut day, board meeting, review, owner, deadline.

### Clicks-to-next-game (delegating)

- Base cost: about 1.7 Continue presses per game.
- Overlay holds: +0.83 dismiss-or-continue interactions per advance.
- Gate detours: about 0.6 per game at about 2 clicks each.
- **Total: about 4.1 clicks per game, or about 340 per 82-game season.**
- If the overlay held only on decisions and results, and trade offers only gated above a threshold: **about 2.2 per game** (a 45% cut).

B2.3's "< 45 minutes delegating everything" is plausible on click count, but only if each overlay hold is closed without reading. That is exactly the habit that makes the good mail invisible.

---

## 2. INTERRUPTION AUDIT

Principle: interrupt only for (a) a decision with stakes or (b) a payoff moment; everything else flows to the inbox or feed; batch where possible; every recurring interrupt has an FM-style Responsibilities delegate.

| Interrupt | Now | Verdict | Reason and change |
|---|---|---|---|
| **Trade offer from X** (gate, 23/season) | Hard hold on every offer; AGM passes if simmed past | **DEMOTE + THRESHOLD** | Gate only if (i) the offer touches a player on your "untouchable/core" list or your own shopped list, (ii) its value clears a fair-deal bar from the AI's own `evaluateProposal`, or (iii) it is deadline week. Everything else goes to a "Trade desk: 3 offers this week" inbox digest, with a delegate rule (AGM: "decline lowballs / forward anything fair"). That would cut about 20 stops a season. |
| **Staff meeting** (every 14 days) | Timer-driven gate; real agenda | **MERGE + EVENT-TRIGGER** | Convene only when a finding crosses a threshold (a top-6 player cold for 8+ games, a prospect ready with the NHL weakest > X below, fatigue red, an injury recall needed), capped at about 1 per 3 weeks. Add a Responsibilities setting (weekly / on-demand / delegate) like FM's staff-meeting frequency. The info-only items (team form, tough stretch, cap) move to the dashboard "week ahead". |
| **Scout meeting** (monthly) | Gate | **DEMOTE in-season; KEEP Jan–Jun** | Keep at the World Juniors (late Dec/Jan), the deadline week (pro scouting of targets), and three draft run-up meetings (Mar, May, pre-draft). The rest go to the digest. |
| **Weekly scouting digest** | Holds only on a new card | **KEEP** | Already well damped. |
| **"Scout report: X" mail** | Stop-worthy on every one (1–2 per day) | **BATCH** | Fold into the weekly digest. Count as silent tier in `worthAStop` unless the grade is A-range or the player is watch-listed. |
| **Slump / drought / "coach backs X" / streak quotes** | Stop-worthy (the user's own club) | **DEMOTE to the feed**, except the first time per player per season | They are story beats without decisions. The autopilot shows "drought" and "slump — X speaks" shapes at 30–42× a season. |
| **Processing overlay hold** | 83% of advances | **RE-TIER** | Hold only on: your game's receipt; a decision item; a first-of-kind or `rare` story; injury to a top-9 forward, top-4 D or starting goalie; a milestone reached. Everything else streams into the overlay list without holding. Target ≤ 35% of advances. Add FM's optional **idle auto-continue** (yt-digest §4) that hard-stops on decisions. |
| **Phone: owner** | Rings for directives (1/yr) | **KEEP** | Rare, top stakes, voiced. |
| **Phone: rival GM blockbuster** (≥ 78 OVR) | Rings; the decision happens on the Trades screen | **KEEP, but make the call the decision** | Answering should let you say "I'm listening / not moving him / send it over". Today the call only deep-links; the decision is two screens away. |
| **Phone: player concern ("wants a word")** | Rings for serious ones; four generic tones | **REWORK or DEMOTE** | See the findings below. |
| **Living Ledger confrontation / agent note / leak** | Scheduled after shop/scratch/demote | **KEEP the concept; FIX the scale bug** | This is the consequence spine the owner wanted, but it currently fires one flat reaction. |
| **Authored office scenes** (decision events) | Up to 1 per 14 days; hand-written effects | **KEEP** | These are the CK3 events B5.5 wants. Real divergent effects (morale, room, promise ledger, residue, leak roll, extension discount, farm trip). |
| **Owner request card on the dashboard** | Banner | KEEP | |
| **Board meeting / season review** | Annual gates | **KEEP** | Once a year = ceremony is affordable (SEASON-RHYTHM §2). |
| **Deadline hold** | 1 press | **KEEP and DEEPEN** | See §3. |
| **Training camp days 3/5/6** | Screens with one text line | **CUT** | See §5. |
| **Dev camp 3 presses** | Screens | **MERGE to 1–2** | See §5. |
| **Post-elimination playoff presses** | Empty | **CUT** | Replace with a "your season is over" beat that offers "sim to the Cup Final" (with a bracket digest). |
| **Awards dump** | 60 items in one press | **STAGE** | Stage it across a real May–June calendar (§4). |
| **Draft hard gate** | Required | KEEP | Fix the label. |
| **Captain hard gate** | Required only when vacant | KEEP | |

### Why "wants a word" feels like a popup with no depth: four concrete defects

1. **The generic concern has a dominant answer.** In `interactions.ts` the tone table is promise +12, supportive +8, firm +2, dismissive −10, scaled by professionalism and temperament on the correct 1–20 scale. "Supportive" beats "firm" for every professionalism value below 20. It has no downside, no ledger entry, and no callback; promise creates a ledger entry that can bite later. A rational player always clicks Supportive. By SEASON-RHYTHM's own delegation test ("if a rational player would auto-resolve it, it's a news item"), the generic concern should not ship as an interaction.
2. **The Living Ledger's personality gates are dead: a scale bug.** Personalities are generated 1–20 (`generate.ts:162`, `offseason.ts:770`, `modSchema.ts:1034`), but `livingLedger.ts` tests them as if they were 0–100:
   - `temperament < 45`: always true.
   - `ambition > 55` and `professionalism > 60`: never true.
   - `CONFRONT_POOL` conditions `minLoyalty: 61` and `minProfessionalism: 66`: never met. `maxTemperament: 45`: always met.

   Consequences:
   - Every shopped player gets the same hot-headed "I find out from a REPORTER…?" line, even a calm veteran pro.
   - The "professional asks through his agent" branch after a healthy scratch **never fires**.
   - The "proud veteran storms in" scratch branch **never fires**.

   That is precisely "consequences matter ended up as a popup with no depth": the design has personality-driven divergence, and the numbers switch it off. (`grudgeContext` at the negotiation table is unaffected and does work.)
3. **Ignoring a concern is free.** Open concerns never expire and carry no cost if ignored. Meanwhile `MAX_OPEN_INTERACTIONS = 2` means two ignored cards silently *suppress all future concerns*. So the right play is to never answer, and the room goes quiet.
4. **The phone is a doorbell, not a conversation.** `PhoneCallOverlay` voices one line, then "Talk it out →" navigates to the inbox. The decision and the reaction happen somewhere else. The "moment" is split across a popup, a screen change and a card.

**Fix shape:** answer on the handset (2–3 options inline, reply voiced); give each option a *visible, delayed* receipt through the existing promise ledger and residue flags; add a cost to ignoring (after N days → the `wasDismissed` residue plus an agent note); fix the 0–100 thresholds; retire the four-tone generic concern in favour of authored decision events (the library already exists).

---

## 3. PACING & SESSION LOOP: the "one more week" pull

### Hooks that exist today

- **Next match** (label "Continue to Oct 14", pregame frame).
- **Pending FA offers and offer-sheet clocks** (good summer pull).
- **Re-sign window countdown** (days 1–4).
- **Negotiation threads** answered "a day or two later".
- **Waiver claims** with windows.
- **The deadline** (calendar chip + hold).
- **Staff proposals** (call-ups).
- **Playoff odds card**, **record chases** (B4.3 partial).
- **Scout digest** new cards.

### Where the season sags

1. **Post-deadline to the end of the season (about 7 weeks, about 45 presses).** The trade market is closed and there is no race framing. The only interrupts are timer meetings. This is the biggest dead stretch.
2. **Mid-November to mid-December.** No landmark, and trade-offer gates are at their peak. It is the busiest-yet-emptiest month.
3. **After elimination through the Cup Final**, and the **Apr 25 → Jun 18 void**.
4. **FA days 5–8** and **camp days 3/5/6** (empty stops).

### Proposed act structure (every act acknowledged in tone, per B3.1)

Each act gets:
- an **opening beat** (one screen or one mail with a voice),
- a **question** the act asks,
- a **checkpoint** that answers it with a receipt.

| Act | Dates | Opening beat | The question | Anticipation hook shown on the dashboard | Closing checkpoint |
|---|---|---|---|---|---|
| **1. Camp battles** | Sep 15–Oct 7 | Camp opens: the 3–5 named battles | Who makes it? | "Battles: 4th C (Kindel vs Lizotte), 7th D, backup G", with movement arrows | Cut day plus the **opening-night roster reveal** |
| **2. Opening month** | Oct 8–Nov 26 | Opening night (banner raising, first lineup) | Are we who we thought? | "Preseason projection: 14th; now: 9th" | **US Thanksgiving benchmark** (about 20 games; "teams in a playoff spot at Thanksgiving make it ~75% of the time"): the board's first read, the playoff-odds reality check, the first promise receipts |
| **3. The grind to the freeze** | Nov 27–Dec 19 | Thanksgiving mail | Buy or hold? | Market temperature (Gap #8), injuries, World Juniors watch | **Holiday roster freeze** (make it REAL: no trades Dec 19–27) plus a half-year staff review |
| **4. Winter and the stars** | Dec 28–All-Star | World Juniors (your prospects' tournament) | Whose prospects are rising? | WJC bracket and your kids' lines | **All-Star break**: a one-press "midseason report" (grades, awards race, record chases). The one place for a rest-week digest. |
| **5. Deadline month** | All-Star → deadline | "The market opens its eyes" | Buyer or seller? | Deadline countdown chip, "calls this week", rival GMs' postures | **Deadline day** (sub-day clock, per playtest G) |
| **6. The push** | Deadline → end of season | "The roster you ride" | Do we get in? | **Magic number / elimination number**, the race table vs the 2 clubs around you, remaining schedule strength | **Clinch or elimination scene**. On elimination: offer "shut down/sim to the draft" with an honest recap. |
| **7. Playoffs** | Mid-Apr–Jun | Bracket reveal, the series preview | How far? | Series state, elimination dread | **The handshake line** (win or lose), then the review |
| **8. Summer gauntlet** | Jun 1–Sep 14 | Lottery | See §4 | Offseason agenda | Camp opens |

**Delegated-season test (B2.3).** A GM who delegates everything should still hit about **12 tentpoles**: opening night, Thanksgiving, the freeze, WJC, All-Star, deadline, clinch/elimination, handshake, lottery, draft, July 1, cut day. Each is a one-press story beat that reads the chronicle. That is the "delegated playthrough still tells a story" bar.

---

## 4. OFFSEASON CADENCE REDESIGN

### Real NHL calendar anchors (2025-26/2026-27)

- Buyout window: opens the later of Jun 15 or 48 h after the Final; closes Jun 30.
- Qualifying offers due around Jun 29–30. FA opens noon ET Jul 1.
- Arbitration filing by Jul 5. Hearings Jul 20–Aug 1.
- Rookie camps and prospect tournaments around Sep 10.
- Training camp capped at **13 days** under the new CBA. **Four** preseason games per club (down from 6–8). Veterans (100+ NHL games) limited to two preseason games.
- A player sent to the AHL must play an AHL game before recall.

Sources: TSN, NHL key dates, PHR, Puckpedia, hockeymap, bluelinestation, Yahoo. Links are at the end.

### The redesigned summer

Each row is one press unless noted. **I** = interactive beat, **S** = summary mail (no stop unless it names a decision), **C** = compressed jump with a digest.

| In-game date | Beat | Type | The decision it creates | Real minutes (engaged / delegated) |
|---|---|---|---|---|
| Elimination → Final | "Season over": exit interviews (3 players, 1 coach read), a bracket digest, "sim to the Final" | I (1 screen) → C | Which of your UFAs you want back (sets re-sign intent); coach job security | 2 / 0.2 |
| Early May | **Draft lottery** (animated reveal if you are in it) | S (a story beat) | None; it reshapes the plan | 0.5 / 0.1 |
| Late May–early Jun | **Combine** + scout meeting #3 (interview list) | I (optional) | Who to interview (fog reduction); board order | 3 / 0 |
| Mid-Jun (after the Final) | **Awards night** (one screen; your nominees first) + **Season review** | I | Review promises; nothing to decide at awards | 2 / 0.3 |
| Jun 15–30 | **Buyout window** open (dashboard chip); *compliance-buyout pressure* if over the cap | agenda item | Eat dead cap vs flexibility | 1 / 0 |
| Draft weekend (late Jun) | **Draft day 1 (R1)** and **day 2 (R2–7)**, trade-up/down calls on the floor | I (hard gate) | Picks, pick trades, the "floor deal" | 8–20 / 1 (auto) |
| Jun 27–30 | Re-sign window (existing) + **QO deadline Jun 30** as its own press ("tender or walk") | I | Tender/non-tender; extend; offer-sheet risk | 3 / 0.3 |
| **Jul 1** | **Frenzy**: first-mover window, a live wire of signings, the AI moving on day 1 (not day 3) | I | The big bets | 5–10 / 0.3 |
| Jul 2–4 | Second wave; offer-sheet match clocks | S ×2 | Match or take the picks | 2 / 0.2 |
| Jul 5 | **Arbitration filings** named ("X filed; hearing Jul 24") | S | Settle before the hearing? | 0.5 / 0 |
| Jul 6–12 | **Development camp** (1–2 presses; see §5) | I | ELC signings; summer programs | 2 / 0.2 |
| Jul 13 → Jul 20 | C jump (market-check digest: best unsigned by position, cap-space table) | C | | 0.5 / 0.1 |
| Jul 20–Aug 1 | **Arbitration hearings** (each a dated beat: settle at the door, go to the hearing, or walk after the award) | I per case (0–2 per summer) | Real money plus the relationship residue ("you argued he was a 3rd-liner") | 1–3 / 0 |
| Aug 2 → Sep 1 | C jump: "August" digest (lingering RFAs, PTO season opens, captaincy chatter) | C | | 0.3 |
| Early Sep | **PTO invites** (existing panel, now a dated beat) | I | Gamble camp spots on vets | 1 / 0 |
| ~Sep 10–14 | **Rookie camp + prospect tournament** (3 games vs neighbours; quick-sim or watch) | I (1–2) | Which kids earn main-camp looks | 2 / 0.2 |
| Sep 15–Oct 6 | **Training camp + preseason** (§5) | I | Roster battles, cuts, waivers | 8–15 / 0.5 |
| ~Oct 7 | **Opening-night roster deadline** (23-man, cap-compliant) + **board meeting** | I | Final 23; the season's bet | 3 / 0.3 |

**Totals.** An engaged summer takes about **45–75 real minutes**; a delegated one about 5. That puts the summer at roughly a third of a season's play time, matching FM's "preseason is the flagship chapter" and B3.4's "gauntlet of decisions".

**Interactive:** draft, QO deadline, July 1, arbitration hearings, PTOs, camp battles, cut day, opening roster, board meeting.

**Summaries:** lottery (unless you are in it), awards, second waves, August, market check.

**Engineering note.** The stage machine already has `awards / draft / resign / freeAgency / preseason` and a dated summer clock (`offseasonDateISO`). The redesign mostly inserts dated sub-stages:
- `playoffsOut`, `lottery`, `combine` before awards;
- `arbitration` inside the Jul 5 → Aug 1 span;
- `rookieCamp` before `preseason`.

It re-dates the existing ones. The pending-queue pattern (#167/#183/#184) already models "answered over days".

---

## 5. TRAINING CAMP REDESIGN (the owner's headline example)

### What camp is today (verified in code)

The camp is **theatre over a decision made before it starts.**

- **Decisions are fixed at camp open.** `reassignFarmSystems()` runs `farmSplit` on ratings and writes up to 6 promotions and 6 demotions with `coachPlan` set, *then* `buildTrainingCampWeek` opens the week. `coachPlan` is **never written again**; grep finds only reads.
- **Reports restate the pre-camp plan.** `fileCampReports()` derives every recommendation from that fixed plan and only quotes the scrimmage average in the prose.
- **Scrimmages are dice, not hockey.** Per-player chances come from `(ratedPotential + ratedOverall)/2`. Team goals are the sum of individual dice plus `range(1,3)` filler goals, so assists and scorelines are unrelated. It never touches `quickSimGame`/`fullSim`, and it leaks potential through production.
- **Three of eight days are one line of text** (days 3, 5 and 6). Day 7→8 is a stop with nothing in it.
- **No preseason games, no position battles, no injuries, no junior-return or ELC-slide decisions.** PTOs are the only newcomers.
- **No farm change, no camp.** If the farm sort finds nothing to change, the camp is skipped entirely.
- **Contradictory mail.** The "Training camp is over" mail arrives on day 1.

The owner's description ("a text screen and you click next and it creates randomized results") is exactly right, and in one respect worse: the randomized results don't even feed the verdicts.

### Design principle

**Camp is a set of named position battles, each a small contest the sim decides and you can influence**:
- by deployment (who plays in which preseason game, on which line),
- by information spend (asking the coach or a scout for a read),
- by roster moves (PTOs, trades, waiver pickups).

Each battle ends in a verdict that is *argued by the camp's own evidence*. The cut decision then carries real consequences.

### Smallest genuinely-fun version — "Battles" (effort **M**, about 3–5 days)

1. **Battle detection (engine, pure).** At camp open, compute the depth chart from the lines (C1–C4, D1–D6, G1–G2) and find the **3–5 contested slots**: slots where the incumbent and the best challenger are within about 3 OVR, or where a challenger is waiver-exempt and an incumbent is waiver-eligible (the waiver trap). Each battle has 2–3 named contenders.
2. **Camp = 3 beats, not 8.**
   - (a) *Camp opens*: the battles board and the coach's opening depth chart.
   - (b) *Two intra-squad scrimmages plus two preseason games in one "week" press*, **played by `quickSimGame`** with the actual camp lines. Battle contenders are deployed on the contested line. Box scores come from the engine, so nothing is filler.
   - (c) *Cut day.*
3. **Battle score.** For each contender: prior (ratings) blended with camp evidence (per-60 production, on-ice GF/GA, save% for goalies, from the sim), weighted about 60/40. It is visible as a tug-of-war bar with the coach's one-line read ("Kindel's pace is winning it; Lizotte's faceoffs are keeping it close"). **The verdict is the battle outcome, not `farmSplit`.** Upsets happen, and the coach reports them.
4. **One lever between beats.** "Give him the look": pick up to 2 contenders to play top-6 minutes in the next games. More ice means more variance, which is the gamble.
5. **Cut day** shows each battle's verdict, the evidence, and the waiver risk: an estimated claim probability from how many clubs have cap room and need at his position. That risk is already computable from the AI's own waiver claim logic. The consequences are already real (claims happen); add a **morale/residue receipt**: `wasDemoted` for a vet who lost, plus a "made the team" morale boost for the winner.
6. **Delegate:** "Coach runs camp" = one press, with the verdicts mailed.

This turns 8 presses of text into **3 presses with 3–5 real contests**, all resolved by the same engine that plays the season.

### Fuller version — "Camp as a chapter" (effort **L**, about 2–3 weeks)

- **Rookie camp + prospect tournament** (Sep 10–14): 3 quick-simmed (or watchable) games against two neighbours' prospect squads. Standouts earn main-camp invites; this is the dev camp's payoff.
- **Main camp** (Sep 15–27, 13 days per the CBA). Group A/B/C sessions summarized. **4 preseason games** on real dates through the full or quick engine, watchable in MatchViewer, results off the standings. Vets capped at 2 games (the real rule), which makes **game lineups a genuine choice**: you can't showcase everyone.
- **Cut waves.** Wave 1 after game 2 (the coach proposes, you veto; junior-eligible 18–19-year-olds must be returned or kept). Wave 2 on cut day.
- **Junior decisions:**
  - An 18/19-year-old who makes the team can play **9 NHL games before his ELC year burns** (the ELC slide). A "9-game audition" flag carries into October with a dated decision beat on game 9.
  - Real prospects the DB holds rights to go back to junior or stay.
  - Ties into the deferred "elite 18yo straight to the NHL" item.
- **PTO verdicts** argued by camp stats.
- **Camp injuries** from the same injury model as the scrimmages, including the "he tweaked a groin, carry him on IR to open the season?" roster trick.
- **Holdouts:** an unsigned RFA misses camp days, battle-score penalty, and the negotiation clock is on your dashboard.
- **The rookie pushing the vet**: a scene from the decision-event library ("the vet asks whether his job is safe") with a promise-ledger receipt.
- **Coach vs scout disagreement** on 1 battle (the EHM draft-table trio pattern): you adjudicate, and the chronicle remembers who was right.
- **Opening-night reveal**: the 23 with line slots, a "last cut" story, and waiver claims around the league on a live wire (other clubs' cuts are claimable by you too).

### Development camp (effort **S**, 1–2 days)

- Collapse to **1 interactive press** plus mail:
  - arrival and scrimmage run by `quickSimGame` on invitee lines;
  - the wrap offers **ELC signing decisions** for unsigned draftees (real sign/defer choice, with a cap-hit preview);
  - **summer program focus** for the top 3 (feeds the existing practice-bias hook).
- Date the beats Jul 6–12 so the calendar moves.
- Stop weighting the scrimmage by potential; use current ability plus noise.

### Preseason games (effort **M**, included in the fuller version)

- 4 fixtures on real dates against nearby clubs, always optional to watch.
- Each fixture has a **"who dresses" choice**: prospects vs vets, the 2-game vet cap, and "rest your stars" as a real injury-risk trade.
- Results feed battle scores, not standings.
- Small gate revenue (EHM model) and a postgame mail naming the battle movers.

---

## 6. TOP 10 LOOP FIXES (ranked by enjoyment impact ÷ effort)

| Rank | Fix | Impact | Effort | Why this rank |
|---|---|---|---|---|
| 1 | **Fix the Living Ledger 1–20 scale bug** (livingLedger thresholds 45/55/60/61/66 → 1–20 equivalents), and add a cost to ignored concerns (expiry after about 7 days → `wasDismissed` residue plus an agent note) | High: personality-driven consequences switch on | **XS** (hours) | The owner's "consequences are a popup with no depth" is partly a literal bug |
| 2 | **Trade-offer gate threshold + weekly digest** (gate only for core players, fair-or-better offers, or deadline week; delegate rule) | High: removes about 20 of the season's 49 blocking stops | S | The #1 interrupter by count |
| 3 | **Re-tier the overlay hold** (hold only on your receipt, decisions, rare stories, key injuries and milestones; batch "Scout report: X", slump and drought quotes) + optional idle auto-continue | High: 83% → about 35% holds, and the good mail becomes visible | S | |
| 4 | **Calendar-coherence pack**: takeover year off by one; draft label vs route mismatch (+ a test); "camp is over" mail on day 1; dev camp dates; post-elimination "season over / sim to the Final" beat; stage the Apr→Jun gap (lottery, combine, awards on dates) | Medium-high: trust and fiction | S | Pure bug-class items, and each breaks immersion |
| 5 | **Training camp "Battles"** (§5 smallest version: battle detection, sim-played scrimmages and preseason games, battle-score verdicts, 3 presses) | **Very high** (the owner's headline complaint) | M | The biggest single enjoyment gain; builds on existing camp state, waivers and quickSim |
| 6 | **Staff meeting → event-triggered + a frequency setting** (Responsibilities: weekly / on-demand / delegate); info items to the dashboard "week ahead" | Medium-high: kills the "you left it to the staff" ×15 | S–M | FM's own fix (yt-digest §1) |
| 7 | **Answer on the handset**: decisions made on the phone card (2–3 inline options, voiced reply); retire the dominant-strategy four-tone generic concern in favour of authored decision events | Medium-high: the phone becomes a moment, not a doorbell | M | Pairs with fix 1 |
| 8 | **Season act beats**: Thanksgiving benchmark, a real holiday freeze (block trades Dec 19–27), All-Star midseason report, **magic/elimination number + clinch/elimination scene** for the post-deadline sag | High: fixes the 7-week sag and B3.1 | M | Each is one pure detector plus one scene; the playoff-odds Monte Carlo exists |
| 9 | **Summer gauntlet re-dating**: QO deadline press, arbitration filings (Jul 5) + dated hearings (Jul 20–Aug 1) with settle/hearing/walk, AI frenzy on July 1 not day 3, August digest, PTO and rookie-tournament beats | Medium-high (B3.4) | M | The stage machine and pending-queue pattern exist |
| 10 | **Deadline day sub-day clock** (land the memory's 8am→3pm half-hour work on this branch: live wire, sniped targets, "sim the rest of the day") | High (B3.2: "best day of the year") | M–L (partly built elsewhere) | Ranked last only because of merge risk; possibly the highest ceiling |

**Fast path:** 1 → 2 → 3 → 4 takes about a week and removes most of the friction measured here, with zero new systems (feature-freeze compliant: every fix closes B2.1/B2.3/B3.1 gaps). Then 5 is the flagship.

---

## Sources

- TSN — NHL buyout window through June 30: https://www.tsn.ca/nhl/article/nhl-buyout-window-now-open-through-june-30/
- Puckpedia — NHL key dates and figures 2026-27: https://puckpedia.com/news/nhl-provides-update-key-dates-and-figures-2026-27
- NHL 2025-26 Key Dates (PDF): https://media.nhl.com/site/asset/public/ext/2025-26/2025-26KeyDates.pdf
- Pro Hockey Rumors — Key 2025 offseason dates: https://www.prohockeyrumors.com/2025/06/key-2025-offseason-dates.html
- HockeyBuzz — 2026 offseason guide: https://www.hockeybuzz.com/2026/06/15/nhl-offseason-guide-key-dates-trades-cap
- Yahoo Sports — NHL rookie camps are different this year: https://sports.yahoo.com/articles/nhl-rookie-camps-different-why-233017468.html
- hockeymap — How NHL preseason works: https://blog.hockeymap.com/2026/09/how-does-nhl-preseason-work-prospect.html
- Blueline Station — New CBA preseason rules: https://bluelinestation.com/new-nhl-cba-preseason-rules-force-the-rangers-to-prioritize-young-talent-01m312jxyced
- All About The Jersey — CBA Article 15 camp/preseason rules: https://www.allaboutthejersey.com/2024/9/8/24238323/rules-about-nhl-training-camps-preseason-games-cba-artcle-15-zboril-hutchinson-new-jersey-devils
- Predators rookie camp (Sept 10): https://www.nhl.com/predators/news/predators-rookie-camp-begins-wednesday-sept-10-2025-08-27
- Football Manager — Delegating for success (FM26): https://www.footballmanager.com/the-dugout/delegating-success-football-manager-26
- FullerFM — Preparing for pre-season: https://fullerfm.com/2020/12/18/preparing-for-pre-season-on-football-manager/
- Operation Sports — What to delegate in FM26: https://www.operationsports.com/which-responsibilities-you-should-and-shouldnt-delegate-in-football-manager-26/
- In-repo: RnD/yt-digest.md (FM responsibilities, staff-meeting frequency, idle auto-continue).
