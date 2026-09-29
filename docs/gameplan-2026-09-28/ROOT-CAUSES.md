# Auditor E: why the watched game stalls at "60%", and how to build past it

*Read-only process and root-cause audit, 2026-09-28. Branch `improve-loop` @ 0650e98. No repo edits.*
*Evidence comes from git history, docs/MATCH-ENGINE-PLAN.md, MATCH-ENGINE-PROGRESS.md, 3D-MATCH-AUDIT.md, 3d-audit-2026-09/*, EXCELLENCE.md, IMPROVE-PROMPT.md, LEVER-AUDIT.md, the analyzer and harness code, and the memory notes.*

---

## 0. The short version

The project does not have a quality problem in any one module. It has a **convergence problem**, and it has five causes:

1. **The team measures the wrong object.** Every gate reads the *sim stream* (4 fps) or a *dev harness*. Nothing measures the *real match screen* at the settings the owner actually plays. So metrics go green while the owner's eye goes red.
2. **The renderer and MatchViewer invent behaviour on top of the sim.** There are two or three independent "truths" for who is on the ice, when the puck leaves the stick, and how long a goal moment lasts. Every fix in one layer produces a new artefact at the seam.
3. **Breadth outruns integration.** There were about 190 commits and roughly 12,500 inserted lines of watched-game code in 3 days, across about 10 concurrent branches. No single owner judged the whole experience, and no owner-reviewed reel was produced.
4. **Tuning is standing in for design.** Five engine passes ran in two days. Global scalars were re-fitted each pass to keep the totals in band, and 9+ experiments were reverted. The pass-5 log then concludes the remaining problems are "not reachable by tuning".
5. **The bar document doesn't cover what is being built.** EXCELLENCE.md parks the 3D overhaul until after 1.0 and defines watched-game success only as "the 2D match reads as hockey" (B6.4). The 3D/agent campaign therefore has no owner-signed definition of done. "Done" defaults to whatever each agent's metric says.

"60%" is what you get when roughly 85% of the metrics pass (the agent scorecard is at 78–79 passes of ~92 graded) but the handful of moments a viewer actually judges were never the acceptance criteria.

---

## 1. Root causes, with evidence

### RC1: Verification measures the stream and the harness, not the screen the owner watches

**What is measured today**
- **`npm run scorecard`** (`src/engine/analysis`) reads only the GameEvent stream: events plus 4 fps positional frames. It grades about 92 aggregate metrics: kinematics distributions, shot TVD, hits/60, shift length. It cannot see the renderer, the camera, playback speed, replays or MatchViewer's timers.
- **`motion-probe.mjs`** runs on `scripts/dev/render3d-harness`. It is **not** the real `MatchViewer`. The harness uses `generateLeague({seed})`, a vanilla generated league, while the owner plays the imported NHL mod. It defaults to `fullSimGame`, the classic engine. It plays at `speed=1`, and it has none of MatchViewer's playback plan, director overlays, replays, highlight skips or booth.
- **Engine gate tests** (`agentSim.test.ts`) run 16 games on the vanilla league.
- **`npm run typecheck` checks nothing.** The root tsconfig has `files: []` without `-b`; see memory `project_typecheck-gate-hollow`, found 2026-09-27. Yet `docs/IMPROVE-PROMPT.md:78` still tells every loop iteration to "Verify: `npm run typecheck` clean". Every past "typecheck = 0" claim proved nothing.

**Cases where a metric passed and the eye failed**

| Owner-visible failure | What was green | Why the metric couldn't see it |
|---|---|---|
| **Shots "happen instantly."** | `shots.speedMean` in band (65–100 mph is *correct* NHL speed). Shot-location TVD 0.14 ✓. Puck-to-blade p90 0.01 ft ✓. | (a) The sim's wind-up is one frame for every shot type: `VAL_WINDUP = { near: FRAME_DT, far: FRAME_DT }` (`agentSim.ts:135`). Its own comment says "a slapper from the point winds up longer", but it doesn't. (b) At 4 fps and ~130 ft/s, a 35-ft shot travels from release to net in **about one stream frame**. (c) The renderer holds the puck on the blade until the clip's contact frame (`rink3dRenderer.ts` ~1588, commit 95e95fb), then `puckTrackStep`s to where the stream puck *already is*, near the net. The drawn flight is compressed further. (d) Full mode plays live hockey at **2×** (`playbackDirector.ts` `BASE_FULL_SPEED = 2`). A 0.25 s game-time wind-up is **0.125 s of wall time**. No metric measures "wall-clock seconds the viewer sees set-up + release + flight". |
| **"Too many men" after the renderer fix (3afecbf).** | Commit message: "now never more than 6" visible per team. | The fix counts rigs in mode `play`/`arriving`/`departing`. Idle **bench rigs are excluded by definition**, but up to `BENCH_SLOTS = 9` per team (18 total) stand visible at `RINK_HALF_W + 4.9` ft, just beyond the far boards. From a high broadcast angle that reads as bodies at the ice edge. The metric counts renderer state; the eye counts pixels. *Most likely explanation. Confirm with one screenshot with markers.* A second possible source is fast-forward and dead time, where `DEAD_TIME_SPEED = 5` and skips run at 30×: departure choreography runs on wall-clock timeouts (`DEPART_TIMEOUT_S = 2.2`), while the stream advances 5–30× faster. |
| **Jank at the speed the owner watches.** | Motion gates pass at 1×: pops ≤ 0.05/rig-s, yaw twitch ≤ 0.1. | The visuals-motion audit measured **pops 3.88–4.27/rig-s at 2×** and **40.6 at 4×**, about 80× and 800× over the gate. Full mode's *default* is 2×. The gate is only ever run at 1×. |
| **Goal replay.** | F-11 "replay holds the live score" was fixed and tested. | By code reading (`MatchViewer.tsx` ~741–759), the replay seeks to goal − 8 s, plays at 0.6×, and ends after 8 s wall time. That covers 4.8 s of game time, so **it ends about 3 s before the puck goes in**. The `_endReplay` comment admits a sibling symptom ("It used to resume … a few seconds before the goal"): the resume was fixed, not the window arithmetic. The replay also starts on a 4.5 s *wall-clock* `setTimeout`, while the 3D goal sequence (`GOAL_SEQ`: bench cut at 4.6 s, crowd at 6.4 s) runs on its own clock. The replay's seek resets `goalSeq`, so the bench and crowd shots it was built for are cut off whenever replays are on. *Verify with one recorded replay. If confirmed, it has existed since June (88d6b07).* |
| **Line changes "disagree with the sim."** | Agent engine: bench-door changes, shift length in band, `downVanishShare` 0. | The play-logic audit (line 63) said it directly: "3D rigs skate out from the gate while the sim already has the new men in position." The response was *more* renderer choreography: bench spots (4e970d6), departure caps (3afecbf). The renderer was not made to consume the engine's own bench model. |
| **Tactics "visible."** | The lever audit prices 7 real coach tactics. | Those are priced on outcome *totals*. Shape error against the templates is still 14–27 ft (pass 5), and nothing checks that a 1-2-2 *looks* different from a trap on screen. |
| **The scorecard committed to docs grades the classic engine.** | `docs/MATCH-SCORECARD.md`: 50 pass / 42 fail. | The agent's 78–79 lives in `.cache/scorecard-agent/`, and the **default engine is still classic** (`sim.worker.ts:23`, `career.ts:8851`). Unless the owner switched Settings → Match engine, the game he watches is the one that scores 50/42. The one that scores 78/79 is the one the team reports. |

**Root cause:** there is no acceptance test that runs **the real app, on the owner's league, at the owner's default settings, and checks what is drawn.** The team optimises what it can measure, and it measures upstream of the problem.

### RC2: Three layers each own a piece of "the truth", so the seams are where the jank lives

The frozen contract says the renderer "reads the same stream". In practice the renderer and MatchViewer author a lot of behaviour the sim never decided:

| Behaviour | Sim says | Renderer or viewer invents |
|---|---|---|
| **Line changes** | Agent: bench-door swap. Classic: 40 s clock, teleport. | `lineChange.ts` + `syncSide`: arriving/departing modes, 30 ft/s gate skating, 2.2 s timeout, "at most one departing" cap, 9 bench rigs per side. |
| **Shot timing** | One-frame wind-up, release at event t. | The choreo starts the clip `lead` seconds early. The puck is held on the blade until contact, then snapped to the stream. |
| **Stickhandling** | (nothing) | "Renderer-only, both engines" whenever a checker is within 11 ft (730a420). |
| **Stick and blade** | (no stick) | `groundStick()` swings the stick about hand_R onto the ice (owner clips float the blade 0.46 ft). |
| **Goal moment** | Celebration phase in the engine. | `GOAL_SEQ` 8.0 s (render clock) plus `CELEBRATION_DURATION` 3.5 s at 1× (playback plan) plus a 4.5 s wall `setTimeout` and an 8 s wall replay (MatchViewer): **four clocks for one moment**. |
| **Speed** | Game time. | Playback plan: 2× live, 5× dead time, 30× skip, 0.6× replay, 1× drama window, plus a user nudge. Clips, springs and choreography mix wall dt, game dt and fixed timeouts. |
| **Camera** | (nothing) | Director shots plus renderer framing: four camera-tuning commits in two days. |
| **Hit reactions** | Agent: force and kind (now consumed). | Before 41101b7: guessed from closing speed. |

The plan says the sim is the source of truth (MATCH-ENGINE-PLAN, revision: "the renderer consumes hit force and kind … instead of inventing them"). The code still does both, because **two engines are live**. The classic engine is still the default and cannot supply those facts, so the renderer must keep its compensations. Every compensation then has to work with the agent engine too. Memory `project_3d-polish-lessons` records the one time a renderer compensation was measured honestly (body separation): "it fights the position spring … REVERTED."

**The 4 fps stream is the physical root of much of this.** A 0.25 s frame is longer than a shot's flight, a wind-up, a poke and the contact phase of a hit. The renderer *must* synthesise sub-frame motion, and where it guesses, the seams show. The spline sawtooth (dc4f53a, "sawed every skater backwards 4× a second") was a direct artefact of that frame rate.

### RC3: Breadth outruns integration (WIP with no integration owner)

- **Volume:** improve-loop has 68 / 90 / 32 non-merge commits on 26 / 27 / 28 Sept. 117 of them touch the watched game, with about 12,500 lines inserted into `src/engine/agent`, `src/render3d`, `MatchViewer`, `render2d` and the analysis code.
- **Concurrency:** about 10 branches touched the watched game at once: `play-realism`, `anim-3d`, `match-day`, `viewer-fixes`, `stick-grip`, `stick-fix`, `match-scorecard`, `blender-3d`, `broadcast-package` and `booth`. MATCH-ENGINE-PLAN (revision) says "All three tracks run in parallel", and the audit table assigns E/V/G/P/A owners. The visuals audit notes "about 33 Chrome processes and 6 Vite servers belonging to other agents", plus a transient merge-conflict marker that broke the harness mid-measurement. This runs directly against memory `feedback_usage-budget` ("no agent swarms").
- **Hot files touched by many hands** (all branches, since 20 Sept): `agentSim.ts` 32 commits, `rink3dRenderer.ts` 31, `brain.ts` 29, `choreo.ts` 16, `MatchViewer.tsx` 12.
- **Same problem, re-touched across layers:** puck-on-blade has 9 commits across three layers (renderer grip → posed blade → stick grounding → wind-up hold → engine "carrier named only once the puck reaches the blade"). Line changes have 8 (engine gate, renderer bench spots, renderer too-many-men, goal-sequence bench). There are 3 jiggle/jank fixes and 4 camera retunes. Each one was locally correct, and no one owned the combined result.
- **No integration review:** the plan's own gate reads "Eye test: the owner watches a clip reel each phase" (MATCH-ENGINE-PLAN:107, M0 "plus a short clip reel per run"). Five engine passes and about 30 renderer commits later, **no reel exists**. A `record.mjs` tool exists, but only for the harness. EXCELLENCE §6 says "the user plays a build weekly … human playtest notes outrank everything". The watched-game campaign ran 3 days at full width without that loop.

### RC4: Tuning replaces design, and calibration hides regressions

- **Five passes, one pattern.** Each pass changes behaviour, then re-fits global scalars so goals and SOG land back in band: FINISH_K 0.53 → 0.62 → 0.80 → 0.90; shoot 0.62 → 0.66; fumbles ×1.12; hit intent 0.01. **Calibration absorbs the behavioural change, so the totals can never warn you.** A pass that makes the hockey worse but keeps 3.1 goals a game still goes green.
- **Reverted experiments** (MATCH-ENGINE-PROGRESS, passes 4–5): hurry-to-shape; spot-velocity feed-forward; rush urgency floor; puck-velocity lead; OZ route cuts; curl carries (goals went to 4.5); anticipation at k = 0.3–1.0; hustle; screen-role urgency; carving protect; smaller protect bonus. That is 9+ attempts, most "under 1 ft".
- **The log's own conclusion** (pass 5): "Both need the player to *be* there before the situation arises. That is not reachable by tuning urgency, anticipation or assignment." That is an **architecture finding**. The agents are reactive, re-reading every 0.25 s, with no team-level play intent: no set breakout, no rush lane assignment made *before* the entry, no PP rotation. Discovering it took five passes in two days, because the loop was "move metric → re-measure", not "design the play → test it looks right".
- **Weak targets:** many bands are marked "estimate" or "design" in the scorecard (acceleration, jerk, bursts, shapes). Passing a self-set band is weak evidence of looking like hockey.

### RC5: No owner-signed bar for the thing being built, and no "done" per feature

- EXCELLENCE.md §2 says "We do **not** try to beat FM at 3D match fidelity (until Blender assets exist)". B6.4 says "(3D parks until assets)", and §7 says "3D overhaul (#52, gated on assets)" is **not** being done. The owner then redirected to 3D ("a ton of work making the 3D gameplay much much better"), which is his call. **But the constitution was never updated**, so the watched game has no B-bar, no ranked gap list entry and no exit criteria.
- The **MATCH-ENGINE-PLAN** gates are numeric plus "the owner's eye test", and the eye test never ran.
- The **3D-MATCH-AUDIT** is a symptom list (30 items), not acceptance criteria. Items get marked "Fixed" by their own metric. #4 "drawn puck lags" was marked Fixed, yet shots still read as instant. #5 line changes and #12 labels were also marked Fixed on their own metrics.
- **Commit messages report the metric as the outcome** ("never more than 6", "TVD 0.20 → 0.14", "scorecard 76 → 78/79"). None reports "the owner watched X and it read as Y".

### Contributing factors

- **A combinatorial surface:** 2 engines × 2 renderers × 4 cameras × 4–5 watch modes × 6 playback speeds × presentation Full/Compact/Off × commentary on/off, plus SimView as a separate product with its own clock (audit F-12 and plan-gap 8). Nobody can make every combination excellent, and the harness tests about one of them.
- **Agents can't watch video in real time.** Verification collapses to stills plus metrics, which structurally favours metric-legible fixes over "feel" fixes.
- **Environment traps eat verification time:** the isolated-world JS in the browser pane, rAF throttling, `--user-data-dir` not isolating saves (this overwrote the owner's autosave on 2026-09-27), and the CPU-skinning measurement trap. Each teaches agents to verify in the harness instead of the app.
- **Asset ceiling:** owner Fab clips float the blade 0.46 ft, and Blender-authored and owner clip styles are mixed (audit #22). Some "60%" is a content ceiling that code can only paper over (RC2).

---

## 2. The build process that prevents it

### 2.1 Viewer-truth acceptance tests: detectors on the REAL match screen

**Where they run:** the built Electron app (`out/main/index.js`) driven by Playwright. It uses `HOCKEY_USER_DATA=<scratch>`, never `--user-data-dir`, with a copy of the owner's save (imported league), and the owner's default settings: the default engine, 3D, broadcast camera, Full mode (2× live) and presentation Full. Expose a dev-only `window.__viewerProbe` from MatchViewer, the renderer's pose list and the camera, so detectors read the scene graph plus screen projection, not the stream.

**The detectors** (each a pass/fail line in a `viewer-truth` report, run per merge to improve-loop):

| # | Detector | Rule (initial) |
|---|---|---|
| VT1 | **Bodies on ice per team:** project every visible rig; count those inside the rink polygon *or within 6 ft of it on screen* (the eye's definition). | ≤ 6 + goalie for 99.9% of frames. The extra attacker is declared. |
| VT2 | **Render-vs-sim divergence:** per player per frame, distance between the drawn root and the stream position (interpolated). | ≤ 3 ft, except inside declared presentation windows (goal sequence, replay, cut-in). Total "invention time" budget per game is reported. This is the metric that enforces "the sim is the truth". |
| VT3 | **Shot readability in wall time:** for each shot, wall-clock time from the shooter's set to release, and release to arrival, at the actual playback speed. | Set-up ≥ 0.3 s wall (wrist) or ≥ 0.6 s (slap). Puck visible in flight on ≥ 3 rendered frames. The shooter is on screen and the puck ≥ 3.5 px. |
| VT4 | **Motion gates at every speed the plan uses:** run motion-probe at 1, 1.25, 1.5, 2 and 5×. | The same gates at each speed, or the plan may not use that speed in live play. |
| VT5 | **Replay content:** the replay window contains the goal event plus ≥ 2 s before it. | The scorebug holds the live score, and no director shot is cut off. |
| VT6 | **One clock per moment:** log every timer for a goal moment (renderer, playback plan, MatchViewer). | All derive from one schedule, and there are zero wall-clock `setTimeout`s governing game-time content. |
| VT7 | **Faceoff set:** at the drop, count skaters inside the circle on screen, and check that everyone was stationary for ≥ 0.5 s. | ≤ 2 in the circle, 100% set. |
| VT8 | **Line change legibility:** every departing and arriving man crosses the boards within 8 ft of his bench door, and none appear or vanish mid-ice. | 0 violations. |
| VT9 | **Framing:** the puck is on screen ≥ 99% of broadcast frames, and the carrier sits in the middle third. | These existing audit gates move to the real app. |
| VT10 | **Commentary truth:** every line's claim (shot outcome, scorer, score) matches the stream fact at that time. | 0 contradictions. Auditor D's domain; the detector lives here. |

A new visible bug class earns a detector *before* its fix is written. The "too many men" fix would have caught its own bench-rig blind spot, because VT1 counts pixels, not modes.

### 2.2 A golden-scenario reel, reviewed by the owner each milestone

- **Scenario finder:** extend `src/engine/analysis` to locate, in a fixed set of seeds on the imported league, the first clean instance of each scenario: **breakaway, odd-man rush (2-on-1), PP set play with a rotation, goal plus replay, on-the-fly line change, offensive-zone faceoff win to a shot, big open-ice or boards hit, empty-net sequence, penalty call to the box, and period end into intermission.** Pin the seeds so every build shows the *same* ten moments.
- **Recorder:** a dev hook `MatchViewer.jumpTo(absT)`. A Playwright script records each scenario from the **real app** at the default speed, with the default camera and HUD (canvas plus overlays, so it includes scorebug and commentary audio). Each clip runs 10–20 s. Build an HTML reel page with before/after side by side against the previous milestone.
- **Checklist per clip** (owner scores 1–5, with a free-text note):

  | Clip | Checklist |
  |---|---|
  | Breakaway | Readable? Puck always visible? Did the shooter set up, or did the shot just happen? Goalie reaction plausible? |
  | Odd-man rush | Lanes filled? Pass goes across or forward, not back? Defender plays the pass? |
  | PP | Is the formation recognisable (umbrella or 1-3-1)? Does the puck move with purpose? Is the PK box visible? |
  | Goal + replay | Celebration, bench, crowd, replay showing the goal, back to faceoff. Score never wrong. |
  | Line change | Right number of men, change through the door, no ghosts. |
  | Faceoff | Everyone set, draw goes back, a play follows. |
  | Hit | Wind-up, contact, reaction, puck consequence. |
  | Empty net | Goalie to the bench, extra attacker from the gate, a long-range attempt. |

- **Exit rule:** a milestone closes only when **every clip scores ≥ 4** and each note is resolved or explicitly deferred by the owner. Track the average as the headline number. **The "60%" becomes a measured figure, and the goal is to move it.** Budget about 15 minutes of owner time per review.

### 2.3 One integration owner for the watched game

- **One lead session** owns: the stream contract, `MatchViewer`, the renderer contract, the playback plan, and the merge to improve-loop for anything touching the watched game. It runs viewer-truth and the reel, and it alone may say "done".
- **Other work is a supplier:** engine tuning, clip authoring, booth audio and camera tuning each deliver to the lead with a request and acceptance clips, and **never merge directly**.
- **WIP limit:** at most one supplier branch touching watched-game code at a time, plus asset pipelines, which don't touch code. This also honours the usage-budget rule; the 3-day swarm is the counter-example.
- **Seam rule:** when a visible behaviour needs a fact, the sim emits it as an additive field, and the renderer is forbidden to synthesise it. Existing inventions go on a **deletion list** (§2.4) with an owner.

### 2.4 Vertical slices: one period excellent, end to end

- **Pick one configuration and make it the product:** the agent engine, 3D, broadcast camera, Full mode, on the owner's save. Everything else becomes secondary and is allowed to lag: the classic watched engine, 2D, the other cameras, Key/Extended modes.
- **Retire the classic engine from watched games** once the agent engine is default. Keep it only as a quick-sim reference if needed. That deletes the reason for most renderer compensations: gate-skating line changes, and guessed reactions.
- **Slice 1 = one 5v5 period**, with faceoffs, breakouts, rushes, cycles, shots, saves, line changes, hits, icing and offside. It is done when viewer-truth is all green at the product settings **and** the reel scores ≥ 4. Only then does slice 2 start (special teams, penalties, goal plus replay, empty net), then slice 3 (full game and match-day flow).
- **Fix the physics of the seam first,** inside slice 1:
  - **Stream resolution:** raise positional frames to 10–15 Hz, or add additive per-event trajectories (release point, speed, target, arrival t) so the renderer draws exact puck flight instead of interpolating 4 fps. This is additive, so the contract survives.
  - **A shot as a sim state:** commit → settle/load → release over 0.3–0.9 s by shot type (make `VAL_WINDUP` real), visible to defenders, who can close or block during it. This is the real fix for "instant shots"; slower pucks are not.
  - **One playback clock:** live play at 1× (or ≤ 1.25×) always, and speed changes only in dead time. Time budget comes from highlight modes, not from fast-forwarding hockey (FM plays highlights in real time). Every presentation timer derives from game time plus one director schedule; no wall-clock `setTimeout`s.
- **Team-level play intent** (from RC4): the next engine lever is designed plays (breakout patterns, rush lane assignment at the regroup, PP rotations, forecheck roles). They are chosen by the coach and tactic at the moment a situation starts, and players commit to them. More urgency tuning won't do it. Design each play on paper with the owner, then implement and reel-test it.

### 2.5 Content pipelines for authored assets

Code can't close a content gap, so treat content as pipelines with their own QA:

| Pipeline | Input → output | QA gate |
|---|---|---|
| **Animation** | Clip list per engine action (the M5 list: receive, stickhandle, deke, poke, shot family, hit/take-hit, board battle, faceoff, goalie T-push/RVH/butterfly/freeze, celebrations, bench hop) → retarget to the owner skeleton (headless Blender, existing) → clip catalog with contact frames. | Per clip: blade-on-ice error, hand-on-shaft, foot slip, contact-frame alignment (clip-probe exists). One style: no mixing of Fab and procedural in the same action family. |
| **Commentary** | Line library keyed by stream facts → booth stems + name bank (exists: Dia2, 96 stems) → truth checker VT10. | Per line: fact-conditioned, no contradiction, no-repeat ledger, loudness normalised. (Auditor D.) |
| **Crowd / arena audio** | Event → reaction bed (anticipation swell on a rush, groan on a miss, roar on a goal, boo on a penalty) from a licensed library. | Reaction latency ≤ 0.3 s after the event; never a roar for the opponent's goal at home. |
| **Arena / crowd / bench art** | Poly Haven/ambientCG and Fab under the owner's licence (never committed; see memory `project_fab-assets-license`). | Performance budget: LOD, triangle cap, frame time at 2×. |

### 2.6 Definition of done for a watched-game feature

A feature is done only when **all** of these hold:
1. **Owner-visible claim written first.** One sentence of what the viewer will see, e.g. "a slapshot from the point has a visible wind-up and the puck is visible in flight".
2. **The sim owns the fact.** No renderer synthesis, or it is on the deletion list with a date.
3. **Detector green at product settings.** A viewer-truth detector exists for the claim and passes in the real app, on the owner's league, at the default speed and camera.
4. **Scorecard and calibration not regressed.** Calibration moved by more than ±5% on a global scalar needs an explicit note of *what behaviour it compensates*.
5. **Clip in the reel.** The feature's golden clip is recorded (before/after) and the owner scored it ≥ 4.
6. **Deleted what it replaces.** Old code paths and compensations are removed.
7. **The real typecheck ceiling holds** (per-project `tsc` counts, not `npm run typecheck`), and tests are green.

Fix `IMPROVE-PROMPT.md:78` to name the real typecheck gate.

### 2.7 Honest scoping: what needs outside people or assets

All rough market ranges for an indie buyer in 2026 USD. Verify quotes before committing.

| Need | Why code can't do it | Options | Rough cost |
|---|---|---|---|
| **Hockey motion capture** (skating strides, crossovers, stops, shots, hits, goalie) | Hand-keyed and retargeted generic clips are the current ceiling (floating blade, mixed styles). Skating on ice is the hardest mocap case. | (a) Buy more hockey clip packs (Fab/Marketplace), $50–500 per pack, quality variable. (b) Markerless capture (Move.ai-class) of a real player on rented ice: ~$20–50/mo software, ice rental ~$250–450/hr, a player ~$50–150/hr, plus a cleanup animator. (c) Studio mocap day, ~$3k–10k/day, plus cleanup. | (a) $0.5–2k · (b) $3–8k all-in for a focused 1–2 day shoot plus cleanup · (c) $10–25k |
| **Animation cleanup / technical animator** | Retargeting, contact frames, blend trees, goalie set. | Freelance, ~$40–90/hr. A ~60-clip library is 80–200 hrs. | $4k–15k |
| **3D character artist** (skater and goalie with gear variants, kits, LOD) | Fab packs are licensed but style-mixed. Facepack integration. | Freelance, ~$40–100/hr, or fixed ~$2–5k per rigged hero character. | $5k–15k |
| **Arena and crowd art** | The crowd is procedural. | Asset packs plus an artist's time. | $1k–8k |
| **Commentary voices** | TTS/Dia2 caps quality. A name bank of thousands of surnames is the hard part. | Two non-union VO actors at ~$200–500/hr session plus usage. Phonetic surname bank recorded as a batch (1–2k names). | $3k–15k (booth plus name bank) |
| **Crowd/arena SFX library** | Needs real recordings. | Licensed library (Boom/Soundsnap-class). | $100–800 |
| **Human hockey-fan playtesters** | Agents can't judge feel in real time. | 5–10 fans reviewing the reel and one game each milestone, ~$25–50/hr. | $300–1,000 per milestone |

The owner's standing rules still apply: CC0/commercial licences only, never clone a real person's likeness or voice, and Fab-derived files never committed.

---

## 3. Master plan outline (the coordinator merges A–D's findings in)

Every milestone ends in an **owner review of the reel** plus a viewer-truth report. No milestone starts before the previous one exits.

| Milestone | Scope | Owner-visible exit criteria |
|---|---|---|
| **W0: Stop and baseline** (1–2 sessions) | Feature freeze on the watched game. Name the integration owner. Update EXCELLENCE.md with a watched-game pillar (B6.5+) that the owner signs. Record **reel v0** on today's build (both engines) and have the owner score it. That gives the real "60%" as a number per clip. | The owner has scored reel v0. The top-5 owner complaints are ranked. The bar is written in EXCELLENCE. |
| **W1: Truth pipeline** | Real-app Playwright runner (HOCKEY_USER_DATA, owner-save copy), `__viewerProbe`, detectors VT1–VT10, scenario finder plus recorder plus reel page. Fix the typecheck gate text. | The viewer-truth report runs in one command on the real app. The reel regenerates in one command. The known bugs (instant shots, too many men, replay window, 2× pops) show up **red** in it. |
| **W2: One source of truth** | Agent engine becomes the default. Classic is removed from the watched path. Higher stream resolution or per-event trajectories. The shot wind-up becomes a sim state. One playback clock (1× live, speed only in dead time). The renderer consumes bench, change, hit and shot facts. Execute the deletion list of renderer inventions. | VT2 divergence ≤ 3 ft outside declared windows. VT3/VT4/VT6 green. The owner watches a breakaway and a line change and says they read right (≥ 4). |
| **W3: Vertical slice, one 5v5 period** | Designed team plays (breakout, rush lanes, forecheck roles, D-zone coverage). Faceoff to play. Hits with set-up. Goalie reads. Camera framing locked for this slice. | A 20-minute 5v5 period at product settings: all detectors green. Reel clips (breakaway, 2-on-1, faceoff, hit, line change) score ≥ 4. The owner would "show it to a friend". |
| **W4: Stoppages and special teams** | PP/PK formations and rotations, penalties to the box, goal plus celebration plus a replay that shows the goal, empty net, period end. Commentary truth (D). | PP, goal+replay, empty-net and penalty clips score ≥ 4. VT5 and VT10 green. |
| **W5: Content pass** (runs alongside W3–W4 as pipelines) | Animation library to one style (mocap or pack decision made at W0 with costs). Crowd audio bed. Booth lines. Arena and bench art. | Clip QA gates green. The owner's A/B on the reel: new content is preferred on every clip. |
| **W6: The match-day product** | Segmented live sim (the keystone for levers), intermission decisions, shouts, timeout, goalie pull, pregame team talk, postgame reckoning. Highlight modes play hockey at 1×. | The owner plays a full match night on his save, makes one decision at intermission that visibly changes the 3rd period, and the postgame names it. |
| **W7: Parity and hardening** | Quick-sim recalibrated from agent-engine distributions per tactic (M7). Performance at product settings. The 2D renderer brought to the same truth (it reads the same facts). | A season-long autopilot shows the watched and simmed hockey agree. Frame time is in budget. A human fan playtest of 5–10 people scores ≥ 4 average. |

**Standing rules through W0–W7:** one integration owner; at most one supplier branch on watched-game code; every merge carries a detector plus a reel clip; the calibration-scalar change note is mandatory; the owner's reel scores are the only definition of progress.

---

## 4. Evidence index

- **Commits:**
  - 3afecbf: too-many-men "never more than 6", excluding bench rigs.
  - 4e970d6: bench rigs.
  - c1d3d98: the agent engine's bench door.
  - 95e95fb: the renderer holds the puck through the wind-up.
  - 730a420: renderer-only stickhandling.
  - dc4f53a: the 4 fps spline sawtooth.
  - 6aa3ed1, 8069533, 84629cf, 0354ce7: camera retunes.
  - The 5 pass merges on 28 Sept.
  - ed9a4a2: found the hollow `npm run typecheck`.
  - 88d6b07: the June origin of the replay timing.
- **Code:**
  - `src/engine/agent/agentSim.ts:83` (`FRAME_DT = 0.25`) and `:135` (`VAL_WINDUP`).
  - `src/render2d/playbackDirector.ts:35–65` (2× / 5× / 30× / 1× speeds).
  - `src/render3d/rink3dRenderer.ts:89` (`BENCH_SLOTS = 9`), `:161–176` (depart timeouts, `GOAL_SEQ`), `:1588–1625` (puck held on the blade), `:1839–1930` (renderer line-change choreography and the cap).
  - `src/renderer/MatchViewer.tsx:731–760` (4.5 s wall `setTimeout`; replay seek −8 s at 0.6× for 8 s wall) and `:929–942`.
  - `src/worker/sim.worker.ts:23`: the classic engine is the default.
  - `scripts/dev/render3d-harness/main.ts:19,24`: generated league, classic engine.
- **Docs:**
  - MATCH-ENGINE-PROGRESS passes 4–5: the reverted list, and the conclusion "not reachable by tuning".
  - 3d-audit-2026-09/visuals-motion.md §1.1: pops at 2× and 4×.
  - play-logic.md:63 and :197: "3D disagrees with the sim" and "renderer compensations mask sim truth".
  - EXCELLENCE.md §2, B6.4 and §7: 3D parked.
  - MATCH-ENGINE-PLAN:34 and :107: the planned clip reel that never ran.
  - IMPROVE-PROMPT:78: the hollow typecheck gate.
- **Memory:** `project_3d-polish-lessons` (reverted renderer body separation, measurement traps), `feedback_usage-budget`, `feedback_owner-saves-isolation`, `project_typecheck-gate-hollow`, `project_excellence-campaign` ("user plays a build weekly; notes outrank harnesses").

**To confirm cheaply before acting** (each takes about 5 minutes in the real app): (1) that the goal replay ends before the goal; (2) that the "too many men" the owner sees are the idle bench rigs; (3) which engine the owner's Settings are on.
