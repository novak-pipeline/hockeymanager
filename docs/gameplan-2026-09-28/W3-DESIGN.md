# W3 design: team play (for the owner's approval before any code)

Written 2026-10-11. **Status: draft, waiting on the owner.** No W3 code starts until this is approved.

W3's exit from [GAMEPLAN.md](GAMEPLAN.md): one 5v5 period the owner "would show a friend", with designed breakouts, rush lanes, forecheck roles and D-zone coverage. This doc says how we get there in small slices, each one mergeable on its own and each ending in a reel clip the owner scores.

Inputs: the match-engine parts of [../fm-study/SPEC.md](../fm-study/SPEC.md) (§1, §2, §6, §7), the open items in [W3-LOG.md](W3-LOG.md), the owner's reel-v0 notes in `reel-v0-scores.json`, and the agent engine as it stands in `src/engine/agent/`. The design is ours, built from standard hockey systems and common game-AI practice. Every number is "calibrate", with the source named.

---

## 1. Where the agent engine is today

What already works and must be kept:
- Physics at 0.05 s substeps with momentum skating, body contact and a puck that rides the boards (`physics.ts`).
- Real offside, icing, freezes and delayed penalties (`agentSim.ts`).
- Role spots as data, in the attack frame relative to the puck (`templates.ts`), including forecheck, PP and PK tables keyed by our `ForecheckSystem`, `PowerPlayFormation` and `PenaltyKillFormation`.
- A whole-shape role assignment with a keep bonus on a man's current role (`assignRoles` and `ROLE_ASSIGN` in `brain.ts`).
- A carrier who values carry, pass, shot, dump and deke as expected goal value with a softmax on decision-making (`decideCarrier`).
- Loose-puck intercepts that read the puck's path, but as a straight slide clamped at the boards, with no bounce (`intercept` inside `thinkSide`).
- Hits from real collisions (`physical.ts`); the W2 shot wind-up as a sim state (`VAL_WINDUP`, `windupS` on the event).
- The analyzer and scorecard (`src/engine/analysis/`, `docs/MATCH-SCORECARD.md`) and viewer-truth detectors VT1–VT11 (`src/render3d/viewerTruth.ts`).

What causes the "aimless / toddler hockey" look (ROOT-CAUSES RC4, W3-LOG):
1. **No intent.** Every skater re-decides every 0.25 s from the current picture. The role is sticky; what he does in it is not.
2. **Drift loops stand in for purpose.** Support skaters circle their spot (`drift`, `DRIFT`) so they never stand still. To the eye that reads as wandering, and they still end up idle in dangerous areas.
3. **Spots, not jobs.** A role is a place on the ice, not a job ("take the weak-side forward", "be the outlet"). Two defenders can both decide the carrier is theirs.
4. **No team pattern.** Breakouts, regroups and forechecks exist as shape tables, but nobody runs a sequence ("D-to-D, wheel, hit the strong-side winger").
5. **Actions have no floor.** Apart from the wind-up, passes, receptions, battles and contact can complete in one think.

---

## 2. The eight design items

Each item lists: what changes and where; its fit with the frozen `GameEvent` contract; the detector that proves it; the calibration risk; and the effort (S = days, M = about a week, L = two weeks or more).

Goals-per-game guard for every slice: the agent engine's goals per team-game must stay inside the NHL band in `src/calibrate/matchTargets.json`. The last committed scorecard run already sits above the band (FAIL, high), so no slice may push it further up. Any scalar we touch is logged in the commit as "changed X, compensates for Y" (GAMEPLAN standing rule).

### Item 1. Action timing in the sim: minimum durations and contact pairs

**What changes.** A new `src/engine/agent/constraints.ts` holds one versioned table of body limits. Physics and brain read it; nobody else hard-codes a duration.

- **Minimum action durations** for: each shot type's wind-up and follow-through; pass release by kind (tape, saucer, stretch, rim, drop, one-timer feed); receive-and-settle (shorter for a soft pass and a skilled receiver, longer on a hard or bouncing puck); deke; poke check commit and recovery; stick lift; hockey stop and restart; goalie butterfly, recover, lateral push, freeze.
- **Actor/receiver contact pairs.** Each pair reserves time on both bodies. Neither can start a new action until his share runs out.

| Pair | Actor | Receiver |
|---|---|---|
| Body check | drive through | stagger, or fall and get up |
| Board pin | pin and hold | pinned, then work free |
| Wall battle / tie-up | tie up | tied up (both are actors) |
| Net-front box-out | box out | pushed off the spot |
| Faceoff | draw (centre) | draw (centre); the wingers' tie-ups start at the drop |
| Shot on goal | release | goalie save reaction (the goalie cannot move to a new spot until it ends) |
| Poke check / stick lift | lunge, lift | puck knocked free; no body hold |

Contact is only emitted if both bodies are within contact range when the pair starts. If the receiver has moved off, the actor whiffs (this exists for hits already; it extends to tie-ups and box-outs).

Files: new `constraints.ts`; `physical.ts` (hit, pin and tie-up pairs); `agentSim.ts` (pass release, reception, faceoff, shot/save timing; `VAL_WINDUP` moves into the table); `brain.ts` (a man inside a committed action is skipped by the decision step).

**Contract.** Additive only:
- `HitEvent`: optional `receiverS` (seconds the hit man is committed) and `knockdown` (already read by VT11 if present).
- `BattleEvent`: optional `holdS`.
- `PassEvent`: optional `releaseS`, `settleS`.
- `SkaterSnapshot`: optional `act` (a short action name) and `actT` (seconds into it). This is SPEC §2's "sim writes the action state"; W3 only needs it for detectors, W5 uses it for animation.

**Proof.**
- Existing: **VT3** (shot readability in wall time), **VT7** (faceoff set), **VT11** (hits: visible contact, reaction with the push).
- New **VT12 action floor**: from frames with `act`, no action shorter than its table minimum; for every shot, the shooter's wind-up seen in the drawn frames is at least the table's.
- New stream test in `agentSim.test.ts`: every `hit` and `battle` event has both bodies within contact range on the nearest frame.

**Calibration risk.** Medium. Longer releases mean fewer shots and more blocked or poked attempts, so goals per game drops a little. Since the engine is above the band today, this moves it the right way. Do not compensate for it inside this slice; the shot-volume scalar (`AGENT_TUNING` shot terms) is re-fitted once in Slice 9 and logged as "compensates for the action-timing floor". Durations are calibrated from NHL EDGE public shot-speed and skating pages plus broadcast video timed by hand; save-reaction timing from video only.

**Effort.** M.

### Item 2. Decisions: a short per-player decision list with persistence

**What changes.** Each skater owns a **plan**: an ordered list of up to four steps. A step has a job (a target or a mark), an urgency, and an exit test.

- The 0.25 s think stays, but it checks **triggers** instead of re-deciding: possession changes; the puck crosses a blue line or the red line; the current step's exit test passes or fails; pressure crosses a threshold; a teammate claims the same job; a whistle.
- Without a trigger, the man keeps executing his step.
- **Hysteresis.** A new target replaces the current one only if it is better by a margin and the man has held the current one for a minimum time. Both values sit in the constraints table and are tuned on the "target flips per minute" metric below. The existing role keep bonus (`ROLE_ASSIGN.keep`) stays for role assignment; the new rule covers targets inside a role.
- **Jobs are claimed.** When a defender claims "the carrier", nobody else on his side may claim it unless the system says so (a trap's two-man pinch, a PK's aggressive kill). The second man takes the next open job (the far attacker, the slot, the lane). This fixes "two people defending one guy".
- **The first step after a change is a puck read.** Men coming off the bench take the job the play needs, not their shape spot (W3-LOG: "three people come off the bench and ignore the guy with the puck").
- **Drift loops go.** `drift` is replaced by purposeful support steps: get open in a passing lane, time a route into the slot, re-set to the D partner's side. Idle in a dangerous area becomes an exit test that fails ("I have been on this spot too long with no lane: move").

Files: new `src/engine/agent/plans.ts` (plan and step types, triggers, exit tests, claims); `world.ts` (`Side` gains `plans: Map<Body, Plan>` and `claims`); `brain.ts` (`thinkSide` becomes trigger check, plan pick, step execution; `drift` removed).

**Contract.** Additive only: `SkaterSnapshot` optional `role` (role name) and `job` (short job name). Used by detectors and, later, a coaching overlay.

**Proof.**
- New **VT13 aimless check** (stream and viewer): share of live 5v5 frames where a non-carrier skater has speed under a walking threshold for longer than a set time inside the slot or the home plate area, with no `act` of box-out or screen. Target band: calibrate against the analyzer's NHL references; "design" confidence until we have a measured band.
- New **VT14 coverage**: in the defending zone, frames where two defenders are within stick reach of the carrier while an attacker in the slot has no defender within a set distance. Target: zero sustained cases outside a designed double-team.
- New analyzer metric **target flips per player-minute** (from `job` changes): must fall and stay under a design band.
- Existing scorecard rows for skating and team shape must hold.

**Calibration risk.** Medium to high. Better coverage cuts slot chances; better support raises completed passes and rush chances. The two partly cancel. Measure goals, shots and slot-shot share per slice; no compensation inside the slice unless goals leave a guard band one standard error wide outside the NHL band.

**Effort.** L. This is the core of W3.

### Item 3. Team systems as data, with named roles, chosen by the coach

**What changes.** A new `src/engine/agent/systems/` folder holds each system as data: the roles, each role's plan template (Item 2), and the triggers that move the team from one phase to the next.

| Phase | Systems (all ours, standard hockey) | Named roles |
|---|---|---|
| Forecheck | 1-2-2, 2-1-2 (and the 1-3-1 trap as the neutral-zone variant) | F1 pursuer, F2 strong-side support or wall seal, F3 high forward, strong-side D (pinch read), weak-side D |
| D-zone coverage | zone ("box plus one" low), man-on-man variant, collapse (shell) | strong-side D (on the puck along the wall), weak-side D (net front), F1 low support (centre), F2 strong-side wall/point, F3 weak-side high slot and point |
| Breakout | strong-side up, reverse, wheel, D-to-D, stretch | puck-retrieving D, partner D (talk and reverse option), strong winger (wall outlet), centre (low swing), weak winger (stretch or middle lane) |
| Neutral-zone regroup | regroup through the D and attack with speed; "dump and change" | regroup D, swing centre, wide lanes, stretch man |
| Rush attack | lane fill: drive the net, middle lane, trailer | carrier, net driver, wide lane, trailer, D joining |
| Penalty kill | box, diamond, aggressive (pressure) box | top two, bottom two, the presser |
| Power play | umbrella (1-3-1 with a point shooter), overload (strong-side triangle with the low man and half-wall) | point quarterback, half-wall, bumper, net front, weak-side one-timer |

The existing `templates.ts` spot tables become the shape each role's steps aim at, so W2's fitted shapes are kept.

**Chosen by coach profiles.** `src/engine/league/coachProfile.ts` already derives seven systems (`CoachSystemId`) and maps them to `TeamTactics` (`profileToTactics`). Add one mapping table, `systemPlaybook(profile)`, from system id and profile axes to a playbook: which forecheck, which breakout preferences (weighted, so a team still varies), which D-zone coverage, which entry style (carry vs dump), which PP and PK setups. The GM's existing tactics choices (`ForecheckSystem`, `PowerPlayFormation`, `PenaltyKillFormation`, `DefensiveZoneCoverage`) override the coach where set, as today.

Files: new `src/engine/agent/systems/*.ts`; `templates.ts` (kept as shapes); `brain.ts` (phase detection picks the system's plan set); `coachProfile.ts` (add `systemPlaybook`, no change to existing exports).

**Contract.** Additive: a new optional `system` field on `FrameEvent` per side (phase plus system name, for example "breakout:reverse"). Nothing else.

**Proof.**
- The analyzer's shape similarity against coaching-system templates (`src/engine/analysis/shapes.ts`) must rise for every situation we add, and each new system gets a shape template there before its code lands.
- New **VT15 system legibility** (stream): in a seeded game, each team's dominant forecheck, breakout and D-zone patterns, as classified by the analyzer from positions, match the playbook the coach chose, in most sequences.
- New reel scenarios in `src/engine/analysis/goldenScenarios.ts`: `breakoutPlay`, `forecheckTurnover`, `dZoneCoverage`, `nzRegroup`.

**Calibration risk.** Medium. Forecheck pressure changes turnover and dump-in recovery rates; coach systems now produce different team shot profiles. Check the lever audit afterwards ([LEVER-AUDIT.md](../LEVER-AUDIT.md)): coach fit's standings value must not move outside its tripwire bound; if it does, re-measure and update the doc, never widen the bound. Goals guard as above.

**Effort.** L (5v5 phases) + M (special teams, Slice 6).

### Item 4. The puck carrier: a utility scorer that tilts by situation

**What changes.** `decideCarrier` already scores options as expected goal value. Add a **situation tilt**: a small vector of weights applied on top of the option values, read from a data table keyed by situation.

| Situation | Tilt (direction only; sizes calibrate) |
|---|---|
| Trailing late | shot weight up, risk tolerance up, dump weight down |
| Leading late | safety up, chip-out and dump weight up, low-percentage passes down |
| Power play | patience up (hold for a better shot), cross-seam passes up |
| Penalty kill | clear weight up, carry only with open ice |
| Under pressure | simple play up (nearest outlet, chip), dekes down |
| Own zone | turnover cost up sharply; glass-and-out allowed |
| Neutral zone | carry vs dump decided by the system's entry style and the gap in front |
| In tight (home plate) | **time cap**: past a short limit with no better option, shoot or walk out; never hold |

The coach's playbook sets the neutral-zone entry style; the GM's sliders still multiply on top (`sliderMult`).

The in-tight time cap answers "he stands in the crease with the puck for so long doing nothing" directly. The `INCLOSE` constants already hold a deadline; the cap moves into the tilt table and becomes a plan step exit (Item 2).

Files: `brain.ts` (`decideCarrier` reads `carrierTilt(situation, playbook)`); new `src/engine/agent/carrierTilt.ts`.

**Contract.** Additive: optional `intent` on `CarryEvent` and `PassEvent` ("enter", "regroup", "cycle", "clear", "attack net"). Used by commentary truth later.

**Proof.**
- New **VT16 crease camping**: no carrier holds the puck inside the home plate area beyond the cap without a shot, pass or walk-out.
- Scorecard: shot share by score state should show the NHL score effect (trailing teams out-shoot). Calibrate from NHL API play-by-play split by score state.
- Reel: `ozCycleShot`, `breakaway`, `emptyNetLate`.

**Calibration risk.** Medium. The agent engine already uses `benchTilt` for deployment and keeps a reference to `scoreEffectMult`. If the carrier tilt reproduces the NHL score effect, any remaining score-effect multiplier in the agent path would double-count. Rule: the tilt replaces it, and the commit says "removed score-effect multiplier X, compensated by carrier tilt". The quick sim keeps its own score effects (W7 parity work).

**Effort.** M.

### Item 5. A puck path predictor

**What changes.** A pure function `predictPuck(puck, horizon)` in a new `src/engine/agent/puckPath.ts`. It steps a copy of the puck forward with the same physics as `stepPuck` (friction, board and glass bounces from Item 6, net frames), with no randomness, and returns timed samples.

Consumers:
- **Loose-puck races.** Replaces the straight-line `path` inside `thinkSide`. Every eligible man finds his earliest intercept on the real path, around the corner and off the end boards. The man with the best intercept claims the puck (Item 2 claims); the next man takes the support job on the predicted exit point.
- **Rims and dumps.** Forecheckers skate to where the rim will come off the corner, not to where the puck is now. The weak-side D reads a rim around the boards and pinches or retreats on time.
- **Goalie anticipation.** The goalie starts his lateral push when a pass's predicted path crosses the slot, scaled by his reading attributes, instead of tracking a lagged read of the puck only. Better goalies get there first; cross-ice one-timers stay dangerous but not free.
- **Camera focus** (Item 7): where the play will be in a moment.

Files: new `puckPath.ts`; `brain.ts` (intercepts, forecheck targets); `agentSim.ts` goalie tracking.

**Contract.** None for the predictor. Item 7 adds `focus` (see there).

**Proof.**
- Unit tests: the predictor and the real step agree on the puck's position over the horizon for rims, dumps and bank passes.
- New analyzer metric **loose-puck race won by the predicted man** (the man with the best predicted intercept is the one who touches it next): high, design band.
- Reel: `saveRebound`, plus a new `dumpInRace` scenario.

**Calibration risk.** Medium. Goalie anticipation lowers goals on cross-ice plays; better rim reads raise forecheck recoveries. Since goals run high now, the goalie part moves the right way. Measured against NHL API save percentage by situation; the goalie's "caught moving" bend in `xgAt` must be re-checked so the two effects don't stack.

**Effort.** M.

### Item 6. Per-surface puck bounce

**What changes.** `stepPuck` uses one restitution for boards and glass and one for the net. Replace with a surface table in `constraints.ts`:

| Surface | What it controls |
|---|---|
| Boards (straight) | restitution, along-wall scrub, so rims keep pace and hard dumps die |
| Corner boards | the same, plus the curve that sends rims behind the net |
| Glass | deader than the boards; above the glass is out of play |
| End boards behind the net | the long carom that gives the far-side forechecker his chance |
| Net frame and posts | hard, lively |
| Skater bodies and skates | low and dead; a blocked shot drops near the blocker |
| Goalie pads | the rebound: speed and spread of the direction, by save type |
| Goalie blocker and glove | deflect wide or catch and freeze |

Rebounds become physical: the save resolution still decides "saved" from xG, but where the puck goes after a pad save comes from the pad row and the shot's speed and angle, not a separate rebound roll.

**Calibration from NHL data.** The NHL API play-by-play gives what we can measure directly:
- the share of saves followed by a stoppage (freeze rate) and its stoppage reason;
- the share of shots followed by another shot within a few seconds (rebound rate) and where those rebound shots come from;
- the rate of whistles for the puck out of play;
- blocked-shot and missed-shot locations.

Board and glass restitution cannot be read from the API; set them from video so dumps and rims look right, then check that rebound and out-of-play rates land in band.

Files: `physics.ts` (`stepPuck` surface lookup; body and pad contacts); `agentSim.ts` (pad rebound handoff to physics); `constraints.ts`.

**Contract.** Additive: `StoppageEvent.reason` is already optional; the scorecard lists the missing reasons. Widening the `StoppageReason` union (adding "puck out of play" and similar) changes an existing type, even if additively. **Owner decision needed:** allow the union widening, or emit the new reasons in a new optional `detail` string field instead. This doc recommends the `detail` field, which leaves the frozen union alone.

**Proof.**
- Scorecard rows: rebound-shot share, freeze rate, out-of-play stoppages per game, in band.
- New **VT17 puck continuity** (viewer): the drawn puck never jumps more than its predicted step between frames, and a puck that hits the boards leaves them on the side the surface table allows.

**Calibration risk.** Medium. Rebound physics directly changes second-chance goals. Rebound goal share is the check. Any change to the save-resolution xG scalar is logged as "compensates for physical rebounds".

**Effort.** M.

### Item 7. A camera made of behaviours, with speed and acceleration limits

**What changes.** `rink3dRenderer.ts` has four presets with hand-written follow logic (`CAMERA_TUNING`, `MAX_CAM_YAW_RATE`, a dead-band). Split it into parts in a new `src/render3d/camera/`:
- **Focus source**: the puck; the sim's predicted focus (below); a named player; a fixed point.
- **Rig**: centre-ice gantry on a rail, follow at height, behind the net, overhead.
- **Limits**: max pan speed, **max pan acceleration**, max zoom rate, framing margins (keep the puck inside an inner box, the carrier near the middle third).

Each preset becomes data (focus + rig + limits). The broadcast preset leads with the sim's focus, which is where the puck is about to be (pass target, rim exit, dump destination, from Item 5), so the camera starts moving before the puck arrives and never has to whip.

**Contract.** Additive: optional `focus: XY` on `FrameEvent`.

**Proof.** **VT9 framing** is the gate, with its existing rule: puck on screen on at least 99% of live broadcast frames, carrier in the middle third on at least 90% of carried frames. W3-LOG measured 74–96% on screen. Add a check inside VT9's output for pan acceleration above the limit (should be zero).

**Calibration risk.** None (renderer only).

**Effort.** M.

### Item 8. Tactic changes at stop points only

**What changes.** A new `src/engine/shared/matchChanges.ts` defines one change record type: line and pair edits, PP/PK units, system or tactic switch, goalie pull and return, timeout, intermission choice. Each record names the stop point it applies at (a whistle index, an intermission, after a goal). `runGame()` in `src/engine/full/fullSim.ts` and the agent period loop read the queue at each stop point and nowhere else.

- **Determinism.** A watched game is defined by its match input (rosters, ratings, tactics, coach profiles, seed, engine version tag) plus the change list. A test sims a fixed set of inputs twice, once straight and once split at stop points with an empty change list, and compares stream hashes. They must match.
- **Dead time.** W3-LOG asks whether dead time should stop the period clock. **Yes.** The NHL clock stops at the whistle; ours runs through the line-up and the change. Stopping it also removes the penalty that killed the stricter faceoff-set check (W2 lost about 6% of shots and reverted it). With the clock stopped, the faceoff set can be as strict as VT7 wants.
- **VT8 mid-ice swap.** `beginChange` calls `deploySide(s, true, true)` when the number of men coming on differs from the number going off (an extra attacker returning, a strength change in live play), which swaps men in place mid-ice. Those men go through the door like any change; the strength change is applied as a sequence of single swaps.

W6 later builds the live UI (intermission decisions, shouts) on this channel; W3 only builds the channel and the clock.

**Contract.** Additive: a new event variant `tacticChange` (team, what changed, at which stop point), so commentary and the match center can say it. Adding a variant is allowed by the contract.

**Proof.**
- Stream-hash determinism test (new, in `src/engine/agent/agentSim.test.ts`).
- **VT8** (line changes through the door) green on all reel clips, including the empty-net clip where the swap was seen.
- **VT7** with the stricter set check restored.

**Calibration risk.** High for the clock change, none for the channel. A stopped clock adds live time, which adds shots and goals, and goals already run high. This is the one place a compensating scalar is expected: re-fit shot volume once in Slice 9 and log "compensates for the stopped dead-time clock". Shift length and TOI per shift must stay in the scorecard band (NHL API shift charts).

**Effort.** S (channel and determinism test) + S (clock) + S (VT8 fix).

---

## 3. The slices, in order

Each slice merges on its own, keeps `npm run typecheck && npm test` green with the per-project tsc counts at or below baseline, adds or turns green at least one detector, and ends with reel clips the owner scores. The standing rule holds: only one branch touches watched-game code at a time.

| Slice | Contents | Items | New or gated detectors | Reel clips to score | Effort |
|---|---|---|---|---|---|
| **S1 Intent and coverage** | plan queue, triggers, hysteresis, job claims, drift loops removed; D-zone coverage roles (strong/weak D, F1/F2/F3) and rush-defence roles first, since those are the owner's worst notes | 2, part of 3 | VT13 aimless, VT14 coverage, target-flip metric | `twoOnOne`, `saveRebound`, `ozCycleShot`, `dZoneCoverage` | L |
| **S2 Time floors and contact** | constraints table; minimum durations; contact pairs for hits, pins, tie-ups, faceoffs, shot/save; `act` on frames | 1 | VT12 action floor; VT3, VT7, VT11 | `breakaway`, `bigHit`, `faceoffWinPlay` | M |
| **S3 Stop points and the clock** | change channel; stream-hash determinism; dead time stops the clock; strict faceoff set restored; VT8 mid-ice swap fixed | 8 | determinism test; VT7, VT8 | `lineChangeOnFly`, `emptyNetLate`, `faceoffWinPlay` | S–M |
| **S4 5v5 systems from the coach** | forecheck 1-2-2 / 2-1-2 / trap, breakouts, neutral-zone regroup, rush lane fill; `systemPlaybook` in `coachProfile.ts` | 3 | VT15 system legibility; analyzer shape similarity | `breakoutPlay`, `forecheckTurnover`, `nzRegroup`, plus one clip of each coach system side by side | L |
| **S5 The carrier** | situation tilt table; in-tight time cap; score effect moved into the tilt | 4 | VT16 crease camping; score-state shot share | `ozCycleShot`, `breakaway`, `emptyNetLate` | M |
| **S6 Puck path and bounces** | predictor; loose-puck races, rim reads and goalie anticipation on it; per-surface bounce; physical rebounds | 5, 6 | VT17 puck continuity; race-won metric; rebound, freeze and out-of-play rows | `saveRebound`, `dumpInRace` | M–L |
| **S7 Camera** | behaviour-built camera; `focus` from the sim | 7 | VT9 framing at its existing bar | every clip (framing is judged on all) | M |
| **S8 Special-teams systems** | PP umbrella and overload, PK box and diamond and pressure kill, as plans; coordinate with W4 (W4 owns stoppages, penalties and the replay package) | 3 | VT15 for PP/PK; PP%/PK% rows in band | `ppSetPlay`, a new `pkClear` | M |
| **S9 Calibrate once, then the exit period** | single re-fit of shot volume and save scalars, each logged with what it compensates; full scorecard run; lever-audit tripwires; record one full 20-minute 5v5 period | all | whole scorecard; VT1–VT17 green | the W3 exit: one 20-minute period the owner "would show a friend" | M |

Why this order:
- **S1 first.** The owner's lowest scores are about players without purpose: positioning, standing in dangerous areas, doubling one man, new men ignoring the puck. Intent and job claims are the highest-leverage change for "aimless / toddler hockey", and every later slice builds on plans.
- **S2 next** because shots, hits and faceoffs only read as real once they take real time, and plans need durations to time their steps.
- **S3 early** because it is small, and the clock decision changes the time budget that every later measurement uses. Doing it before S4 means we calibrate against the right clock.
- **S4–S6** add the hockey patterns on top of a sound base.
- **S7** can move earlier if the owner wants, since it is renderer-only; it waits only for Item 5's predicted focus to be at its best.
- **S9** keeps the rule "tuning does not stand in for design": one re-fit at the end, not after every slice.

Calibration guard between slices: goals per team-game must not rise, and no slice may leave it more than one band-width outside the NHL band. If a slice breaks the guard, it does not merge with a compensating scalar; the cause is found first.

---

## 4. Reel slots

Reel v1 scores are not in yet. Fill this table when they arrive, then after each slice.

| Clip | v0 (agent) | v0 owner note (short) | v1 | after S1 | after S2 | after S3 | after S4 | after S5 | after S6 | after S7 | after S8 | S9 exit |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| breakaway | 1 | shots instant, penalty unexplained, change with men on | | | | | | | | | | |
| twoOnOne | 3 | D skates to far boards, two on one man | | 4 | | | | | | | | |
| ozCycleShot | 1 | too glitchy to read | | 1 ("he was offside") | | | | | | | | |
| ppSetPlay | 1 | too glitchy to read | | | | | | | | | | |
| goalReplay | 3 | replay misses the goal; bench doesn't celebrate | | | | | | | | | | |
| lineChangeOnFly | 1 | three new men ignore the puck carrier | | 4 | | | | | | | | |
| faceoffWinPlay | 1 | puck not dropped in the circle | | | | | | | | | | |
| bigHit | 2 | falls with nobody hitting him | | | | | | | | | | |
| saveRebound | 2 | positioning looks bad | | 5 | | | | | | | | |
| emptyNetLate | 4 | fine | | | | | | | | | | |
| dZoneCoverage (new) | – | – | | 4 | | | | | | | | |
| breakoutPlay (new) | – | – | | | | | | | | | | |
| forecheckTurnover (new) | – | – | | | | | | | | | | |
| nzRegroup (new) | – | – | | | | | | | | | | |
| dumpInRace (new) | – | – | | | | | | | | | | |
| pkClear (new) | – | – | | | | | | | | | | |
| offsideCall (new, S2) | – | – | | – | | | | | | | | |
| 20-minute period (exit) | – | – | | | | | | | | | | |

---

## 5. Decisions the owner needs to make

1. **Approve the slice order**, or move S7 (camera) earlier.
2. **Dead time stops the period clock** (Item 8). Recommended yes.
3. **New stoppage reasons**: a new optional `detail` field (recommended) or widen the `StoppageReason` union.
4. **Coach system vs GM choice**: the GM's tactics picks override the coach's playbook where set (as today). Confirm.
5. **Contract additions** listed per item are all additive optional fields plus one new event variant (`tacticChange`). Confirm that is acceptable under the frozen-contract rule.

## 6. Out of scope for W3

- Animation content, bench and crowd life (W5). W3 only adds `act` so W5 has something to drive.
- The replay package, penalty presentation and commentary rebuild (W4).
- The live intermission and shout UI (W6). W3 builds only the change channel underneath.
- Quick-sim parity (W7). W3 changes the agent engine only; the quick sim is re-matched in W7.
