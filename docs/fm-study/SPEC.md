# What Football Manager does, and what The Show should take from it

Written 2026-10-11. This is a clean-room design spec. Its input was the owner's own-words study notes on Football Manager 2024, made from his licensed copy. Nothing from that study (data, numbers, tables, names, file formats, text) is copied here. Each section says in plain words how FM is shaped, then says what The Show should build, in hockey terms, mapped to our files and to the W0–W7 plan in [GAMEPLAN.md](../gameplan-2026-09-28/GAMEPLAN.md).

Rules for anyone working from this doc:
- Where a number matters, this doc says **calibrate**, and names the NHL source. The free NHL API (play-by-play, shift charts, boxscores, game logs) and the public NHL EDGE pages are our sources. MoneyPuck is off-limits.
- Every "should" below is a design proposal. Taste calls stay with the owner, and the owner's reel score is still the bar.
- The frozen contracts stay frozen. Every change proposed to `src/domain/events.ts` is an **additive optional field**, the same pattern the agent engine already uses.

---

## 0. The one-paragraph version

FM's match is a recorded simulation that a viewer plays back. The sim decides every action, how long it takes, and when two bodies touch. It writes all of that down with timestamps. Everything else reads from the record: the 3D viewer, the commentary, the crowd sound, the highlight cut, the replay length, the box score and the player ratings. Nothing downstream invents behaviour. The Show already has the right keystone (one `GameEvent` stream), but our sim decides too little and our renderer still decides too much. Shot timing, contact, what a player is doing with his body, how important a moment is: these are guessed in four or five places instead of written once by the sim. That gap is behind most of the owner's reel-v0 complaints.

---

## 1. Match engine structure

### How FM does it

- **Time slices.** The match advances in fixed small steps. Dead time (ball out of play, nothing happening) can be skipped quickly.
- **A decision list per player.** Each player keeps a short, capped queue of things he has decided to do next. He works through the queue instead of re-deciding from scratch every step. His movement is a timed path, and actions add delays onto that path.
- **A physical-constraints table.** One data table holds the body limits: speed for each gait from walk to sprint, acceleration and deceleration ranges, turn rate by gait, kick speeds, and a **minimum duration for every action** (a dive and hold, getting up after a fall, a celebration, stopping to avoid a collision). Nothing can happen faster than its row in the table allows.
- **Do/receive contact pairs.** Every physical interaction (tackle, trip, shoulder charge, shirt pull, push) has two durations: one for the player doing it and one for the player receiving it. Both are written onto their paths as delays. The animation always has the time it needs, because the sim reserved it.
- **Stop points.** The sim builds a list of moments where the human's tactical changes may take effect (stoppages, after a goal, before a penalty). A change made in between waits for the next stop point. Every touchline shout, team talk, substitution and instruction enters the engine through this one channel, as a typed change record.
- **Deterministic replay.** A match is fully described by an input snapshot (both squads, attributes, tactics, conditions, the seed) plus the ordered list of change records. Re-running that input on the same engine version gives the same match. The tuning data is keyed by engine version, so an old match replays with the engine that made it. Any mismatch is treated as a bug ("divergence").
- **The sim runs ahead.** The match is computed on its own thread ahead of the viewer, and the viewer plays it back.

### What The Show should do

Today (`src/engine/agent/`): physics runs in 0.05 s substeps (`physics.ts`); every skater re-thinks every 0.25 s (`FRAME_DT` in `agentSim.ts`, `thinkSide` in `brain.ts`); support players take role spots from `templates.ts`; hits come from real collisions (`physical.ts`); the wrist-shot wind-up is a single think (`VAL_WINDUP`). The whole game is simulated up front, then played back.

#### 1.1 Replace the global re-think with a plan queue per player

Each skater holds a short **plan**: an ordered list of 1–4 committed steps, each with a goal and an exit test. Examples:

| Plan | Steps |
|---|---|
| Weak-side D on a breakout | hold net-side spot → read the carrier's first pass → step up to the boards outlet |
| F2 on a 2-1-2 forecheck | skate to the strong-side wall → take the D-to-D pass away → read the rim |
| Rush trailer | trail the carrier by a lane width → hit the high slot as he crosses the top of the circles → stop and present the stick |
| Carrier in tight | protect the puck below the dots → walk out to the slot or throw it to the net within a time cap |

A player only re-plans on a **trigger**: possession changes, the puck crosses a line, his step's exit test passes or fails, he is under pressure past a threshold, or a teammate claims his job. Between triggers he executes. The 0.25 s think stays as a cheap check of the triggers, not a fresh decision.

Why this matters: the owner's "brainless toddler hockey", "aimless players" and "too much standing still in dangerous areas" all trace back to root cause RC4 in [ROOT-CAUSES.md](../gameplan-2026-09-28/ROOT-CAUSES.md): a fresh decision every 0.25 s with no play intent. A plan queue gives intent and purposeful motion, and it is the natural home for W3's designed breakouts, rush lanes, forecheck roles and D-zone coverage. Each W3 play becomes a plan template that the coach's system selects (see §6).

Files: new `src/engine/agent/plans.ts` (plan templates, exit tests); `brain.ts` becomes the trigger check plus the plan picker; `templates.ts` spots become plan step targets. Milestone **W3**.

#### 1.2 One physical-constraints table for hockey

Move every body limit into one versioned data table, `src/engine/agent/constraints.ts`, read by both physics and brain. Today these limits are spread across `physics.ts`, `physical.ts` (`HIT_TUNING`) and `agentSim.ts` (`VAL_WINDUP`, `AGENT_TUNING`).

| Group | Rows (all values: calibrate) | Source |
|---|---|---|
| Skating gaits | glide, stride, crossover, backward, sprint, top burst; acceleration and stop distance per gait | NHL EDGE skating-speed and burst pages; broadcast video timed by hand |
| Turning | max heading change per second, by gait; tight turn vs pivot | broadcast video |
| Puck release | wrist, snap, slap, one-timer, backhand, tip: **minimum wind-up** and release speed band | NHL EDGE shot-speed pages; video for wind-up time |
| Passing | release time per pass kind (tape, saucer, stretch, rim, drop); receive-and-settle time; one-touch | video |
| Stickwork | deke duration, poke check commit and recovery, stick lift | video |
| Contact | every do/receive pair in §1.3 | video |
| Goalie | butterfly drop, recover to feet, lateral push across the crease, freeze-and-cover, paddle-down | video; NHL API save events for outcome rates only |
| Stoppages | faceoff set time, linesman drop, change-on-whistle window, goal celebration, glove-to-bench after a goal | NHL API play-by-play (time between whistle and faceoff) |

Rule: no action can complete faster than its row. This kills "instant shots" at the source. The wind-up becomes a real sim state that lasts as long as the table says, the shooter can be checked or poked during it, and the event carries `windupS` so the renderer times the swing. W2 started this; the table finishes it for every shot type, every pass and every contact.

Milestones **W2** (the table and shot rows), **W3** (skating and passing rows used by plans). Calibration pass in W7 against NHL EDGE.

#### 1.3 Do/receive pairs for every contact

Every two-body interaction in hockey gets a pair of scheduled durations: one for the doer and one for the receiver. Both bodies are committed for that time and cannot take a new action.

| Interaction | Doer | Receiver |
|---|---|---|
| Open-ice hit | commit and drive through | stagger, or fall and get up |
| Board pin | pin and hold | pinned, then fight free |
| Net-front battle | box out | tied up |
| Puck battle on the wall | tie up | tied up (both are doers) |
| Poke check | lunge and recover | puck knocked loose (no body delay) |
| Stick lift | lift | lose the puck and recover the stick |
| Hook, hold, trip, slash | the foul action | slowed, or down (feeds the penalty call) |
| Interference | the illegal pick | knocked off line |
| Fight | the full bout, both bodies | (both are doers) |
| Goalie run | contact | goalie down and recovering |

The sim emits the contact only when both bodies are actually in range at the scheduled moment, and it puts both positions on the event. The renderer then has no room to invent a fall. This is the owner's reel note on `agent-bigHit`: "he wasn't even hit by anyone when he falls over". A fall now always has a doer standing next to the receiver at contact time.

Files: `physical.ts` (hit decide/resolve already exist; add the pair durations and the other rows); `HitEvent` gains an additive `receiverS` (receiver's committed seconds) and `doerPos`/`receiverPos` at contact if not already derivable from the frame. Milestone **W3**, with the hit row in the W2 follow-up.

#### 1.4 Stop points for every tactical change

Hockey has natural stop points, and they are more frequent than football's:

- every whistle (each is followed by a faceoff);
- after every goal;
- the TV timeouts at the first stoppage past the set game-clock marks;
- a called timeout (one per team);
- each intermission;
- the start and end of a power play.

Every human change goes into one **change channel** as a typed record: line and pair edits, PP/PK unit edits, a tactic or system switch, goalie pull or return, a shout, a timeout, an intermission talk. Each record is stamped with the stop-point index at which it applies. Line changes on the fly are not tactic changes; they stay a sim action the bench boss AI or the agent engine takes during play.

Files: new `src/engine/shared/matchChanges.ts` (the record types); `runGame()` in `src/engine/full/fullSim.ts` reads the queue at each stop point. Milestone **W6** ("one intermission decision visibly changes the 3rd period").

#### 1.5 Deterministic replay from input plus changes

A watched game is fully defined by:
1. a **match input**: both rosters and ratings, lines, tactics, coach profiles, condition, venue, the seed, and the **engine version tag**;
2. the **change stream** from §1.4.

Re-simulating the same input and change stream must give a byte-identical event stream. This buys us three things:
- **W6 segmented live sim.** Sim to the next stop point, let the user act, append the change, sim on. No special "live" engine; the same function with a longer change list.
- **Bug reports and the reel.** A reel clip becomes an input file plus a change list plus a time window. Any clip can be reproduced months later. The owner's pinned scenarios stop drifting when we tune.
- **A divergence test.** A vitest runs a fixed set of match inputs and compares stream hashes. Any change that alters them must say so in the commit, which is exactly the GAMEPLAN standing rule that "any change to a calibration scalar must state which behaviour it compensates".

Tuning tables (§1.2 constraints, xG, rating weights) carry the same version tag, so an old input replays with the tables that made it. The sim already uses seeded RNG (`src/engine/shared/rng`); the work is to collect the inputs into one serialisable object and to stop any reads of live career state mid-game.

Files: `src/engine/full/fullSim.ts` (`FullSimOptions` grows into the match input), `src/engine/agent/agentSim.ts` (`agentSimGame`). Milestones **W1** (reel files as match inputs) and **W6**.

#### 1.6 Run ahead, play behind

The sim runs in the worker up to the next stop point and hands the slice to the viewer; the viewer never waits on the sim during live play. Dead time between the whistle and the drop is still simulated (players skate to the dot, the change happens), but the period clock does not run, as in the NHL. This settles the W3-LOG question "whether dead time stops the sim clock": yes, it should, then recalibrate shot volume once.

#### 1.7 Owner complaints this section answers

| Reel-v0 note | Cause in FM terms | Fix above |
|---|---|---|
| "shots are too fast and happen instantly" | no minimum action time | §1.2 release rows |
| "he wasn't even hit by anyone when he falls over" / "I didn't even see a hit" | contact not reserved on both bodies | §1.3 |
| "positioning of all the players just looks bad", "standing still", D "skating into boards for no reason", "two people defending one guy" | no plan, fresh decision every think, no coverage claim | §1.1 plans with job claims |
| "he stands in the crease with the puck for so long doing nothing" | carrier has no time-capped plan | §1.1 carrier plan with a cap |
| "three people come off the bench and ignore the guy with the puck" | new men run a shape step before reading the puck | §1.1: the first step of an on-ice plan is a puck read |
| "the puck wasn't even dropped in the faceoff circle", "no one set" | faceoff set not a constrained state | §1.2 stoppage rows; §1.6 dead time |

---

## 2. The viewer as playback

### How FM does it

The viewer does not decide anything. For each recorded frame it reads the action the sim chose and picks an animation clip from a **picker table** keyed by that action, the direction of the move relative to the body, and a speed band. Locomotion is chosen from a motion database by foot phase, velocity and the ball's position relative to the player. Each clip carries **event markers** (the contact frame, fade in and out). The viewer lines the contact marker up with the sim's contact time, so the foot meets the ball when the sim says it does. The clip's own root motion is **stripped**: the sim's positions move the body, and the clip only animates it in place. Clips are mirrored to double coverage. The picker table is data, so animators add clips without code changes.

### What The Show should do

We already do part of this. `src/render3d/choreo.ts` starts a clip `contact` seconds before its event so the stick meets the puck at the event time, and `animCatalog.ts` holds per-clip metadata (mask, hands, contact, fades). What we lack is the input: the renderer guesses what a player is doing from positions and sparse events. Then `rink3dRenderer.ts` adds facing smoothing, turn-rate clamps and grounded-stick rules to make the guess look right.

1. **The sim writes the action state on every frame.** Add an additive optional `act` field to `SkaterSnapshot` in `src/domain/events.ts`. Its values are a small hockey vocabulary owned by us: glide, stride, crossover, backward, stop, set (faceoff), windup and release by shot type, pass release, receive, stickhandle, deke, poke, hit-do, hit-receive, fall, get-up, battle, box-out, celebrate, go-to-bench, sit. Add `actT` (seconds into the action) so the renderer knows the phase. The agent engine already knows all of these internally.
2. **A picker table in the renderer.** `src/render3d/animPicker.ts`: (action × direction bucket relative to facing × speed band) → a list of candidate clips, with a mirror flag for handedness. Left and right shots are a mirror, which halves the authoring work. The table is data, so W5 content lands as rows, not code.
3. **Contact markers from the sim, not guessed.** `choreo.ts` already aligns `contact`. It should align to the sim's committed times from §1.2/§1.3 (wind-up start, release, hit contact, receiver fall), not to fixed per-clip offsets.
4. **Root motion stripped.** Every clip is authored or baked in place; translation comes only from the frame positions. Any clip that needs travel (a hit that drives through, a fall that slides) gets that travel from the sim's positions. This removes the class of bugs where a body slides after a hit or through the boards ("he gets hit and still slides forward", "phasing through the boards").
5. **Locomotion in W5.** The W5 animation-data decision (mocap vs code) should be framed as a picker problem. Mocap gives the clips; the picker plus contact alignment is the same in both cases. If W5 goes with motion matching, the feature vector is ours to design: skate phase, velocity, turn rate, puck relation. That is a bigger build than a picker, so start with the picker and add matching only for locomotion if the reel still says skating looks wrong.

What the renderer then stops doing: inferring shot timing, inferring falls, choreographing line changes, and any behaviour not on the frame. That is W2's "delete the inventions" rule made structural.

Files: `src/domain/events.ts` (additive fields), `src/engine/agent/agentSim.ts` (emit), `src/render3d/animPicker.ts` (new), `choreo.ts`, `animCatalog.ts`, `rink3dRenderer.ts`. Milestones **W2** follow-up (fields and picker skeleton) and **W5** (content).

---

## 3. One event-metadata table

### How FM does it

One data table lists every match event the sim can produce. Each row carries everything the presentation needs:
- a **commentary priority** (how much the live text cares);
- the live text variants and separate past-tense variants for the match report, with selection weights;
- which crowd and whistle sounds to play;
- a **highlight importance** on a small ordinal scale;
- a replay or clip-length class;
- flags such as "flash this" or "this is a kick-off";
- a link to the preceding event, so commentary can chain ("…and he scores from the rebound").

Highlight modes are **importance thresholds** over the same stream: the shortest mode keeps only the top levels, longer modes lower the threshold, the full match keeps everything, commentary-only shows none. Switching mode is just changing the threshold.

### What The Show should do

Today the same judgment is made separately in at least five places, each with its own scale:

| Where | Its own importance scale |
|---|---|
| `src/render2d/highlights.ts` | segment importance and hard-coded windows per kind |
| `src/render2d/commentary.ts` | line importance |
| `src/render2d/broadcast/types.ts` + `director.ts` | overlay and cue priority, replay windows hard-coded in the director |
| `src/renderer/lib/sfx.ts` | procedural sounds picked by event type |
| `src/render2d/playbackDirector.ts` | speed plan per mode |

Build **one table**, `src/render2d/eventMeta.ts`, keyed by our event type plus a few qualifiers (danger band, shot result, hit force band, strength state, game state such as "late and close"). Each row holds:

| Column | Consumer |
|---|---|
| importance (one ordinal scale for the whole game) | highlights, playback speed plan, watch modes |
| booth priority and the moment key into `commentaryLibrary.ts` | booth, play-by-play text |
| report-text pool key (past tense) | postgame recap, beat writer |
| crowd reaction class (murmur, rise, roar, groan, boo) and whistle | crowd and arena audio |
| pre-roll and post-roll seconds | highlight cut |
| replay class (none, one angle, two angles, goal package) and length | W4 replay package |
| chains-from | commentary linking ("rebound", "off the faceoff", "on the rush") |

Then:
- **Watch modes are thresholds.** Key, extended, comprehensive and full are four thresholds over one importance column. W6's live mode switch becomes a threshold change on a stream that is already computed: no re-cut, no new clock.
- **The replay package reads its length from the row.** The goal replay length then covers the shot through the puck crossing the line by construction. This fixes "the replay didn't actually show the goal" (reel `agent-goalReplay`, `classic-goalReplay`) at the data level, not by retuning the director.
- **The crowd follows the same importance.** The owner's "white noise" complaint is partly that `sfx.ts` plays a procedural bed with no link to what matters. Crowd swell keyed to the table's crowd class ties sound to the play.
- **Commentary priority decides what the single voice says.** When two events land close together, the higher row wins and the lower is dropped or chained. That is the continuous-call grammar W4/W5 asks for.

The table is ours: our event kinds, our scales, our text pools. Writing rules for any text it points to follow `.claude/skills/game-writing/SKILL.md`.

Milestones: **W4** (replay package and commentary truth), **W6** (live watch-mode switching). The table itself is a small refactor and can land first.

---

## 4. Quick sim

### How FM does it

The quick engine does not run the spatial sim. It first settles the team result and team shot counts. Then it fills in the box score: each player's secondary stats are **sampled from fitted distributions** keyed by position, an ability band and an attribute band (the average of the attributes that drive that stat). The distribution family suits the stat: counts use a count distribution, rates use a normal or a binned histogram, rare stats can be zero. A separate small table says which attributes drive which stat. Goals and shots are **not** sampled this way; they come from the team-level result. In-match injuries are generated in both engines, and clubs nobody is watching get a separate random-injury pass.

### What The Show should do

`src/engine/quick/quickSim.ts` is already close in shape. It sims shift by shift with real on-ice units, resolves shots against the goalie, and credits goals, assists, TOI and plus-minus from those shifts. Then it hands out hits, blocks, takeaways and giveaways from a fixed per-game team total (`PHYS_PER_GAME`), split across skaters by one composite each. Keep the shift-level core for goals, shots, assists and TOI: that is where W7 parity with the agent engine lives. Replace the flat split with fitted distributions:

1. **Keys.** Position (C, LW, RW, LD, RD, G) × deployment tier (top-six F, bottom-six F, top-four D, third-pair D; starter or backup G) × ability band (our rated overall, banded so each band holds a similar share of NHL regulars) × driver band (the average of the stat's driving attributes on our 1–20 scale).
2. **Stats.** Hits, blocked shots, takeaways, giveaways, faceoff wins and attempts, PIM, shifts, and TOI by strength. Goals, shots on goal, missed shots and assists stay event-driven.
3. **Driver map.** A small table in our own terms. Examples: hits from checking, aggression and strength; blocks from shot-blocking, positioning and bravery; takeaways from stick checking and anticipation; faceoff win share from faceoffs and strength.
4. **Fit.** Pull per-game player lines from the NHL API boxscores and game logs for recent seasons. The dev mod maps real NHL players onto our attribute scale, so each real player-game can be placed in a key cell and the cell's distribution fitted directly. Only the fitted parameters ship, as aggregate data; no real names or rows go into the shipped DB.
5. **Team totals stay consistent.** Sample players, then rescale lightly so the team totals land inside the NHL per-game range for that team's style (a heavy forecheck team out-hits a trap team). The coach system in §6 sets that team-level mean.
6. **Parity test.** `src/engine/quick/parity.test.ts` grows a check: over a seeded season, per-position stat means and spreads from the quick sim match the agent engine's within a tolerance, and both match the NHL API distribution. This is the W7 exit for numbers.

Milestone **W7**. Data source: free NHL API only.

---

## 5. Ratings, xG and momentum

### 5.1 Player game ratings

**FM:** a rating starts at a fixed baseline. Each event the player was part of adds or subtracts a weight, and the weights differ by role (a keeper's save weight is not a striker's). A minutes term drains the baseline for short appearances. Positive contributions are scaled up when the team beat its pre-match expectation by a clear margin. The expectation comes from the two teams' strength. The weights are versioned data.

**The Show:** `src/engine/career/playerRating.ts` already gives a 0–10 game rating from counting stats, and `matchNight.ts` uses it for three stars and goalie form. Upgrade it to the same shape, with hockey weights:
- **Role sets**: C, W, D, G, and a PP specialist modifier. A centre's faceoffs count; a winger's do not. A D's blocks and xGA weigh more than a forward's.
- **Contributions**: goals, primary and secondary assists (primary worth more), individual xG and shots, on-ice xG for and against at 5v5, blocks, takeaways minus giveaways, penalties drawn minus taken, faceoff net (C only), hits (small), and for goalies **goals saved above expected** from §5.2.
- **Ice time**: pro-rate by TOI so a 9-minute fourth-liner is not judged as a 22-minute D.
- **Expectation scaling**: compare the result with the pregame expectation (the Monte-Carlo odds already exist) and scale the positives when a team beat it.
- **Calibrate**: fit the weights so the rating ranks players the way their on-ice goal impact does over a season of NHL API games; check the spread lands where the squad screen's scale expects.

Milestone: post-W4, as part of match-night receipts (Gap 15). Small effort.

### 5.2 xG as per-situation logistic models

**FM:** expected goals come from a set of separate logistic models, one per shot situation (open play by shot type, plus special variants for an open goal and for an obscured shot, plus set pieces and penalties). Features include distance, angle to the goal centre, the body's facing angle, how much of the goal is visible, players between shot and goal, distance to the nearest blocker and the ball's height. The engine first classifies the shot situation, then applies that model. The models are versioned. xG feeds the analysis screens and the ratings; assists' xG is the xG of the shot a pass created.

**The Show:** today `shotXg` in `src/engine/full/fullSim.ts` looks up an empirical distance × angle table, and the agent engine bends it with lane bodies, screens and goalie movement (`xgAt` in `brain.ts`). Move to per-situation logistic models:

| Situation model | Extra features |
|---|---|
| 5v5 unblocked by shot type (wrist/snap, slap, backhand, tip/deflection) | distance, angle, rush (puck in the neutral zone a few seconds earlier), rebound (time since the last shot), lateral puck movement before release, screen count |
| Power play | as above, plus PP formation |
| Rebound | time since the first shot, goalie displacement |
| Empty net | distance only |
| Penalty shot and shootout | shooter vs goalie skill only |

Fit with plain logistic regression on NHL API play-by-play (coordinates, shot type, situation code, event timing give rush and rebound flags). Store coefficients in a versioned table under the engine version tag (§1.5). Use the same models for xG display, the rating (§5.1), the Data Hub, and goalie GSAx. The sim keeps its physical bends (bodies in the lane, a goalie caught moving); the logistic model is the base rate those bends start from. Credit expected assists from the xG of the shot a pass set up.

Milestone **W7** (calibration), with the Data Hub using it once it lands. Medium effort.

### 5.3 Momentum

**FM:** momentum is a running weighted sum of attacking-zone events: touches and completed passes in the final third add a little, shots add more, and goals add most, with central zones weighted above wide ones. It drives a momentum chart. The study could not tell whether it feeds back into the sim.

**The Show:** build momentum as a **presentation measure only**: a decaying sum of offensive-zone time, shot attempts weighted by danger, and high-danger chances, with the slot weighted above the perimeter. Use it for a momentum strip in the match center, crowd volume, booth lines ("they've had this period"), and the intermission briefing in W6. Do not feed it back into outcomes. Score effects already exist (`src/engine/shared/scoreEffects.ts`) and are calibrated; a second feedback loop would double-count and break calibration. Milestone **W6**. Small effort.

---

## 6. Tactics

### How FM does it

- **Styles double as AI personalities.** Each named playing style has range bands over the staff database's tactical attributes (how attacking, how deep, how direct, how fluid, how hard they press, tempo, width, tolerance for dirty play) and over manager tendencies (counter-press, play out of the back, rely on set pieces). An AI manager is matched to the style whose bands best contain his own values. The style then gives him formations, preferred roles, favoured player attributes, a training template, and a "defensive" and "attacking" variant for protecting or chasing a lead. Staff warn the human when he drifts away from his style.
- **Mentality sets defaults, instructions modify.** A single mentality step sets the defaults for tempo, width, passing directness and pressing trigger. Team and player instructions are stored as changes relative to those defaults. A small vector of continuous team settings is derived from mentality plus instructions, and the engine reads that vector.
- **Tactical familiarity** is tracked at team and player level, grows through training and match time, and lowers when the tactic changes. It feeds selection.
- **In-match changes are event-sourced** (see §1.4) and go through the same channel as shouts and team talks.
- **Team selection is a weighted sum of factors**: position ability, current ability, recent ratings, condition, familiarity, potential, plus strong penalties for rest promises and minute limits. Different weight sets serve first-team, rotation and reserve selection.

### What The Show should do

`src/engine/league/coachProfile.ts` already holds the most important idea: seven named systems derived from coach attributes (`deriveSystem`), mapped to engine tactics (`profileToTactics`), with a roster fit grade (`coachFit`) and staff-meeting nudges. Line chemistry is tracked in `lockerRoom.ts`. Lineups are repaired in `lineup.ts`. Build on them:

1. **System = plan library.** Each `CoachSystemId` selects which §1.1 plan templates run in each phase: breakout (reverse, wheel, stretch), neutral zone (1-3-1, 1-2-2, 2-1-2 pressure), forecheck, D-zone coverage (box+1, swarm, man), PP setup (umbrella, 1-3-1, overload) and PK (box, diamond, aggressive). This is what makes "the coach's system" visible on the ice, and it is the W3 deliverable.
2. **Mentality defaults, instruction deltas.** Add one game-state mentality (protect, even, push, all-in) that sets defaults for pinch rate, forecheck depth, shot-vs-pass threshold, change length and hitting. The GM's tactics sliders become deltas from those defaults. Coaches get a "protect a lead" and "chase" variant, so the AI shifts at the right moment instead of only pulling the goalie. Files: `TeamTactics` in `src/domain`, `profileToTactics`, `sliderMult` in `fullSim.ts`.
3. **System familiarity.** Add a team-level familiarity per system, raised by practice (the practice plans already exist) and games played under it, cut by a system change. Low familiarity widens plan execution error (late reads, wrong spots), not raw ratings. This gives a mid-season coaching change a real cost and gives the practice screen a payoff it can show (EXCELLENCE B2.4 and B7.3). It must pass the lever audit in [LEVER-AUDIT.md](../LEVER-AUDIT.md): measure the standings-points value before it ships.
4. **Event-sourced changes**: §1.4.
5. **Lineup AI as a weighted factor sum.** Make the AI line builder an explicit weighted score per slot: position fit, rated ability in the slot's role, recent game ratings (§5.1), condition, line chemistry from `lockerRoom.ts`, system fit, and penalties for injury management, promised ice time and back-to-back goalie starts. Keep separate weight sets for a playoff push, a normal night and a back-to-back. Weights are ours; tune them with the lever audit, and make every factor printable so the coach can explain a lineup in the staff meeting.
6. **Style drift warnings.** When the GM's slider deltas fight the coach's system hard, the head coach says so in the next staff meeting. That gives the coach a voice (EXCELLENCE B5.1) and turns a hidden fit penalty into a visible receipt.

Milestones: **W3** (system = plan library), **W6** (mentality states and in-game changes). Familiarity and the lineup factor sum are post-W7 depth work.

---

## 7. Cameras

### How FM does it

Every camera is built from a few **composable behaviours**: follow an object, stay static, zoom by input, zoom automatically, a boom arm, a spline path, an orthographic top view, a behind-the-corner rig, an orbit. Each camera states its bounds, a **maximum speed and maximum acceleration**, and what scenery to hide. A **director family** of broadcast cameras (main TV, close, sideline, elevated, behind goal high and low, set-piece specials) is chosen per moment, and the sim itself publishes the focal point the cameras follow. User cameras are separate from director cameras. Cuts between cameras can fade.

### What The Show should do

`rink3dRenderer.ts` has four presets with a tuning pipeline (dead-band, smoothing, focus speed limit, spring, yaw-rate cap), and `director.ts` requests shots (goal and save replays, bench cut-ins, crowd, faceoff close). The pieces exist but each preset is hand-written, and the focus is the puck as the renderer sees it. W3-LOG reports the puck is on screen only 74–96% of live frames.

1. **Behaviour building blocks.** Split the camera into: a **focus source** (puck, carrier, the play's centroid weighted toward the puck, a named player, a fixed point); a **rig** (TV gantry on a rail at centre ice, follow at height, behind-net, overhead, bench level); and **limits** (max pan speed, max acceleration, max zoom rate, framing margins). Each preset becomes data: focus + rig + limits. File: `src/render3d/camera/` with one small module per behaviour.
2. **The sim publishes the focus.** Add an additive optional `focus` point to `FrameEvent`: where the play is about to be, not only where the puck is. The sim knows a pass target and a dump destination before the puck arrives, so the camera can lead the play instead of chasing it. That fixes "camera misses things" without making the camera twitchy.
3. **Acceleration limits, not only speed limits.** A real operator eases into a pan. Limit acceleration so the shot never starts or stops abruptly, then tune the framing margin until the W1 framing detector (VT9) holds the puck in frame on every live frame of the reel.
4. **A director family for stoppages.** Faceoff close-up, goal celebration, penalty walk to the box, bench reaction and replay angles are director cameras chosen from the §3 table's replay class. The live game stays on the user's chosen camera. The director never cuts away during live play; that rule already exists for speed and should hold for cameras too.

Milestones: **W3** (framing lock in the W3 exit), **W4** (replay angles). Medium effort.

---

## 8. UI: one property registry

### How FM does it

Every displayable property of every object type (player, team, club, competition, match stats) is registered once in a metadata registry. Each entry holds: an id, the display name and category, the widget that shows it, the widget that edits it, the column heading and hint, default and minimum width, an auto-hide priority for narrow screens, its search-filter definition, the default sort direction, and which other properties it depends on. Tables, search filters, column pickers, saved views and the in-game editor are all generated from the registry, so adding a property makes it available everywhere at once.

### What The Show should do

Player search today is hand-built in two places: `src/engine/career/playerSearch.ts` (query and rows, with fog of war) and `src/renderer/lib/playerSearchFilters.ts` (filter state, chips, saved searches). Squad, stats, scouting and the Data Hub each build their own columns.

Build `src/engine/career/propertyRegistry.ts`: one entry per player property with
- id, label, short heading and tooltip;
- category (bio, contract, ratings, season stats, advanced, scouting);
- a value getter from the view model;
- a **fog rule** (public fact, scouted read, or hidden), so the search's "cannot see through fog" rule lives in one place;
- a formatter and a cell widget kind;
- a filter kind (range, set, text) and a default sort direction;
- a hide priority for narrow windows;
- an editor kind, for the future in-game DB editor (useful for modding, CLAUDE.md principle 5).

Then the search, the squad table, the stats tables and the Data Hub read columns and filters from the registry, and the user can pick columns and save views. Adding xG, expected assists or the §5.1 rating means one registry entry. The frozen `views.ts` contract does not change shape; the registry is a renderer-side and query-side helper over existing view fields.

Not a watched-game item. Post-W7, or as a loop iteration under EXCELLENCE F1 ("information confidence"). Medium effort.

---

## 9. Career and world items worth taking

| FM idea (own words) | What The Show should do | Where |
|---|---|---|
| **A daily batch with named steps**, each step also a profiler counter | Name every step of `advanceDay` and time it; surface the slowest steps in a dev overlay. Serves B7.5 ("Continue tick < 1s"). | `src/engine/career/career.ts` |
| **Training sessions as data**: each session has primary/secondary/tertiary attribute groups with weights, and small signed side effects on condition, fatigue, injury risk, morale, sharpness, cohesion and familiarity | Express our practice plans the same way: a session row with attribute weights and side-effect columns. The practice screen can then show the trade-off ("hard skate: legs up, injury risk up, mood down") before the GM picks it. | practice/training code; feeds §6.3 familiarity |
| **Weekly schedule templates keyed by context** (phase of season, games this week) | Templates for camp, a three-game week, a back-to-back, the playoff push; the AI and the "delegate to staff" path pick by context. | practice planner |
| **Sharpness from game minutes only** | A healthy scratch or a long-injured player returns rusty for a few games; shows on the profile. Measure with the lever audit before shipping. | development/condition code |
| **Development needs ice time**, said by staff | Staff advice when a prospect is buried on the fourth line or in the press box; ties into the AHL loan decision. | staff meeting agenda |
| **Youth intake per region**, quality set by regional talent and club facilities | Our draft already uses real imported prospects. For later fictional seasons, generate draft classes per feeder league with a regional strength table. Pairs with the depth-audit "no youth intake" finding. | league generation, draft |
| **Tiered world**: playable leagues, background leagues with simulated stats, view-only leagues | We already have quick-sim world leagues. Add a third tier (results and tables only, no player stats) for far leagues to keep the Continue tick fast. | `src/engine/quick/season.ts`, world model |
| **Squad status labels** (star, key, regular, rotation, fringe, prospect) tied to promises and morale | We have roles/status (#188). Make every status carry an ice-time expectation the morale system checks. | locker room, promises |
| **AI recruitment as a pipeline**: shortlist, best-role fit, valuation, then deadline-day drama | Our trade AI already values assets per club. Add an explicit per-club shortlist built from needs and the coach system, so AI GMs chase players who fit what their coach runs. | trades, `clubAssetValue` |
| **Board objectives as named expectation levels** (win the title, challenge, make the playoffs, avoid the bottom) | Owner expectations as named levels set each summer, checked monthly, cited in the season review. | board/owner code |
| **Auto-save modes** (rolling slots, before and after games) | Rolling N autosaves, not one file. Serves B7.4 and the "agent overwrote the real autosave" memory. | `src/main/saves.ts` |

---

## 10. What not to copy

- **The scale of content.** FM's clip, commentary and stadium libraries are huge and built by large teams. We take the structure (picker table, event table, modular arena), not the volume.
- **Real-world licensing patterns** (licensed kits, real ads, ad-network SDKs). Not relevant to a fictional-by-default DB, and the ad network is a privacy cost we do not want.
- **Momentum feeding the sim.** Even FM's data does not show it. Our score effects are calibrated; keep momentum as presentation.
- **Hidden ability on a single budget scale.** Our ratings are attribute-first with fog of war; keep that.
- **FM's numbers.** Every constant in this spec comes from NHL data or our own tuning.

---

## 11. Adopt next (ranked)

Ranked by how much each moves the owner's reel score for the least work, watched game first. Effort: S = days, M = about a week, L = several weeks.

| # | Change | Fixes (reel-v0) | Effort | Milestone |
|---|---|---|---|---|
| 1 | **Per-player plan queue with trigger-based re-planning** (§1.1), and the coach system selecting plan templates (§6.1). Replaces the global 0.25 s re-think. | aimless and standing players, D to the far boards, two-on-one doubling, crease camping, new men ignoring the puck: 7 of the 18 clips | L | W3 |
| 2 | **One physical-constraints table with minimum action durations** (§1.2), covering every shot type, pass, stickwork, goalie move and faceoff set; calibrate from NHL EDGE and timed video. | instant shots, puck "zipping around too fast", no faceoff set | M | W2 follow-up → W3 |
| 3 | **Do/receive contact pairs** (§1.3), emitted only when both bodies are in range, with both positions on the event. | falls with nobody near, hits nobody saw, sliding after a hit | M | W3 |
| 4 | **Sim-written action state on every frame + renderer picker table, root motion stripped** (§2). Renderer stops inferring behaviour. | glitchy playback, sticks and wrists wrong, boards phasing; sets up W5 content | M (fields + picker) / L (content) | W2 follow-up, W5 |
| 5 | **One event-metadata table** (§3) driving highlights, booth priority, crowd class, replay class and length; watch modes as importance thresholds. | replay that misses the goal, white-noise crowd, three-voice clutter; makes W6 mode switching a threshold change | S–M | W4, W6 |
| 6 | **Match input + change stream, deterministic and version-tagged** (§1.4–1.5), with stop points for every change and a stream-hash divergence test. | reel scenarios that drift with tuning; prerequisite for intermission decisions and live shouts | M | W1 (reel files), W6 |
| 7 | **Camera from behaviours with acceleration limits, led by a sim-published focus point** (§7). | "camera misses things", puck off-screen in live frames | M | W3 exit, W4 |
| 8 | **Quick-sim secondary stats from NHL-fitted distributions** (§4) and **per-situation logistic xG** (§5.2), one parity test across both engines. | not a reel item; closes W7 numbers parity | M | W7 |

Order of work: 2 and 6 first (small, and everything else stands on them), then 1 and 3 together as the W3 slice, then 4 and 7 to show it, then 5 for W4/W6, then 8.
