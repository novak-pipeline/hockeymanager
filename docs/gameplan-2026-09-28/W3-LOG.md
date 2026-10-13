# W3 log: positioning and decision quality (logged during W2, not fixed)

These come from the owner's reel v0 notes and the W2 detector runs. They are about how the agent engine plays, so they belong to W3 (designed team plays). W2 left them alone on purpose.

## From the owner's reel v0 notes
- **D runs to the far boards.** "defenseman skating into boards on other side of play for no reason" (2-on-1). The D chooses support or a gap read with no relation to the rush.
- **Two defend one.** "two people defending one guy" (2-on-1). Coverage assignment doubles the puck carrier and leaves the second attacker open.
- **New men ignore the puck.** "three people come off the bench and ignore the guy with the puck right in front of them" (line change). Men coming on skate to their shape spots before they read the puck. W2 now brings them over the boards at their own door, so W3 should judge this again.
- **Positioning looks bad overall.** "positioning of all the players just looks bad" (save + rebound). There is no shared D-zone coverage structure, such as a box+1 or a collapse on the rebound.
- **Standing still in dangerous areas.** "too much standing still in dangerous areas". Support players arrive at a spot and stop (low-urgency support). The 0.25 s re-think with no play intent is the root cause (ROOT-CAUSES RC4).
- **Crease camping.** "he stands in the crease with the puck for so long doing nothing" (classic PP; check it on the agent engine). Carrier decisions in tight have no time-out and no "jam it / walk out" choice.
- **Looked offside.** "looked offside" (classic empty net). Check offside reads on the agent engine against the drawn blue line.

## Found by the detectors during W2
- **VT8: an on-the-fly shape change mid-ice.** An extra attacker returning, or a strength change during live play, swaps men in place: `deploySide(s, true, true)` from `beginChange` when incoming ≠ outgoing. Those men should go through the door like any other change. Seen once in 10 clips (empty net, P3 1:23).
- **VT9: framing.** The puck is on screen only 74–96% of live broadcast frames, and the carrier sits in the middle third 55–100% of the time. The camera framing lock is part of the W3 exit ("camera framing locked for this slice").
- **Stoppage time eats the period clock in the agent sim.** `now` runs through dead time. Any longer faceoff set or change therefore cuts live play and shot volume. A stricter faceoff "set" check (speed < 3 ft/s) cost about 6% of shots, so it was reverted. W3 should decide whether dead time stops the sim clock (as in the NHL) and then recalibrate once.
- **The bench is empty.** W2 deleted the standing bench rigs (they read as "too many men"). Nobody sits on the bench now, and the goal sequence's bench shot shows empty benches ("bench doesn't celebrate"). Bench life is W5 content.

## S1 intent and coverage (2026-10-12)

What shipped (W3-DESIGN item 2 and the D-zone / rush-defence part of item 3):
- **Plans** (`src/engine/agent/plans.ts`). Every skater holds a role and a job ("puck", "chase", "mark:<id>", "lane", "twoOnOne", "support", "spot", "change", "carry"), written on each frame as the additive `role` / `job` snapshot fields. Roles are re-assigned only on a trigger: the possession side, the shape (a line must be crossed by 3 ft; the strong side flips only 6 ft past the middle), the carrier or their pass receiver, the men in the pool (a change, a man taking the puck), or a man lost far from his job. A mark is held at least 1 s and only replaced by one 8 ft better; a man keeps his mark 8 ft past the radius he took it at.
- **Claims.** The carrier belongs to the presser; every other attacker is covered by at most one man. A man covering someone does not leave him to line up the carrier. The lane man collapses onto the carrier only when nobody in the slot is open.
- **D-zone roles** `DZ_SD` / `DZ_WD` (strong-side and weak-side D), `DZ_F1` / `DZ_F2` / `DZ_F3`. The man on the puck vacates the role nearest the puck. Zone coverage takes the attacker in a role's area: goal-side and tight in the house, and from the slot side of his lane further out. A spare man becomes the low support on the puck; one who has stood 1 s in front of his net picks up a free attacker.
- **Rush defence** `NZ_SD` / `NZ_WD` / `NZ_F1-3`. A lane becomes a mark, goal-side and inside of the attacker in it. With one man back on an odd-man rush, he plays the pass ("twoOnOne"), not the carrier. A pass of theirs that the defender cannot reach first is no longer chased (that was the D skating off to the far boards); he plays the receiver.
- **New men** start in the departing man's role and the shape re-plans at once. The closest man within 10 ft of their carrier takes him (from behind, onto his hip). Men skating to the bench are out of the shape.
- **Drift loops removed.** Support men pick open ice around their spot (room, plus a lane from the puck), hold it 1.2 s, move on after 0.8 s standing, and skate there with intent. The old low-urgency creep read as standing. The breakout centre and partner D move up with the puck. A loose puck behind the net is now chased round the post: two chasers pushing on the cage was a stall that froze everyone.

Detectors (stream, imported league, 480 games, seeds 7000-7479, per 60 live minutes): VT13 aimless 30.3 → 17.1; VT14 coverage 6.4 → 3.8 (doubles 0.93 → 0.81, far side 4.96 → 2.62, ignored carrier 0.53 → 0.34); VT16 crease camping 0 → 0.003; job flips 28.5 → 22.8 per player-minute. The gate in `agentSim.test.ts` (generated league): VT13 < 30, VT14 < 5, flips < 26. Viewer (5 clips): before, VT13 was red on dZoneCoverage (a D standing 11 ft off his crease with nobody near) and VT14/VT16 green; after, VT13/VT14/VT16 are green on all five.

Calibration (same 480 games): goals 3.12 → 3.10, shots 29.7 → 28.7, PP goals 0.45 → 0.43, penalties 3.76 → 3.30, hits 22.9 → 21.0 (claims stop a covering man lining up the carrier), rebound-shot share 0.061 → 0.100 (NHL band 0.035-0.110). No scalar changed.

Left for later slices:
- Rebound share is up (still in band, but further from the 0.067 target), and close-range rebound shots fail VT3's flight rule on the saveRebound / twoOnOne clips. Physical rebounds are S6; shot timing is S2.
- A designed net-front screen (on the shot line, which the sim's screen bonus rewards on every shot) was tried and pulled because it raised goals. The net-front man holds his spot until S4/S5.
- VT8 is red on the dZoneCoverage clip: three men swapped mid-ice in live play, most likely the known strength-change deploy (S3).
- The generated league scores about 2.5 goals per team-game against the NHL's 3.07, on both engines. The agent band test now samples 96 games so it measures the engine rather than the seeds; closing the gap is S9's job.

## S2 time floors and contact (2026-10-13)

### First: the offside bug (owner, reel S1 ozCycleShot: "he was offside")

The S1 clip could not be replayed frame-for-frame (the reel was recorded on S1 work-in-progress; the committed engine gives a different stream for the same pin), so the bug was found as a class with a new judge, `src/engine/analysis/offside.ts`, run over whole games.

Root cause (`agentSim.ts`): the blue line was checked only when the puck was carried over it or crossed it in a pass/dump flight. A puck that went in any other way was never judged: a shot from outside the zone, a chip, a poke, a block, a rebound, a fumble, a tie-up squirting loose. Men parked in the zone stayed "onside" and played it. Three smaller faults sat beside it: the puck counted as in the zone at the line's centre with no hysteresis (a puck riding the line re-entered every substep), the delayed-offside touch exempted the man touching it, and a man who reached back from inside the zone for the puck and carried it in was treated as onside.

Fix: one `blueLines()` pass after every puck step, whatever moved the puck.
- Rule 83.1 geometry: the 1-ft line belongs to the zone the puck is in; the puck enters or leaves only when completely over it (0.625 ft past the line's centre).
- Who propelled it: carrier, passer, shooter, blocker, the goalie's rebound, a poke or stick lift, the tie-up winner. If the defenders put it in, nobody is offside.
- Carried in with a man over the line: whistle. Anything else: delayed offside. It clears when every attacker is out of the zone at the same moment (tag-up) or the puck leaves. Any attacking touch in the zone before that is offside, the offending man included.
- A shot on goal during a delayed offside stops play (rule 83.3), faceoff in the offending side's end, not counted as a shot. (Rule reading worth an owner check.)
- A carrier who took the puck while already over the line, with the puck outside, is offside.

Detectors: the judge runs on the sim stream (gate in `agentSim.test`) and on the drawn screen as **VT18** (`viewerTruth.ts`). It reads pokes, blocks, saves and tie-ups as touches, and the `receive` act as possession during a reception. Missed calls on the imported league, 480 games: **S1 engine 2.25 a game, after the fix 0.03, after S2 0.025**. The generated-league gate (6 games) went from 16 missed to 0. The remaining handful are 4 Hz sampling at the line.

### S2 (W3-DESIGN item 1)

- **`src/engine/agent/constraints.ts`**: one versioned table (`CONSTRAINTS_VERSION 1`) of action floors. Shot wind-up by type (W2 values: 0.25 s, slap 0.5 s), follow-through 0.2 s, in-tight and backhand release speed. Pass release by kind (0.1-0.2 s), receive-and-settle 0.15-0.3 s by pass speed and hands. Deke 0.4-0.7 s, poke commit 0.25 s and reload 1.4 s, stick lift 0.3 s. Goalie save reaction 0.3 s, freeze 0.6 s. Faceoff set 0.5 s and hold 0.6-1.2 s. Contact: hit doer 0.4 s, pin 0.6 s, knockdown 1.8 s, pinned 1.7 s, tie-up 0.7 s; contact range 4.5 ft (hit) and 6 ft (battle). `VAL_WINDUP`, `DOWN_S`, `FACEOFF_HOLD`, `POKE_RELOAD_S`, `tieUpS` and `DEKE.minS/maxS` now read the table.
- **Acts as sim state.** Every skater and goalie carries an act (`windup`, `release`, `pass`, `receive`, `deke`, `poke`, `lifted`, `hit`, `stagger`, `down`, `pin`, `pinned`, `tieUp`, `set`, `save`), written on every frame as `act` / `actT` (additive `SkaterSnapshot` fields). A committed man starts nothing new: no new hit intent, no stick check, no loose-puck touch. The shooter follows through, the hitter drives through, the poker lunges.
- **Passes take their release.** The puck stays on the passer's blade through the sweep and leaves in the substeps at its floor; the lead is adjusted for the receiver's skating. The kind is fixed at the decision, and a saucer is planned when a stick is in the lane. `PassEvent.releaseS` / `settleS`.
- **Catch and shoot / catch and move it.** The load or the sweep can start while the puck settles, and the release waits for both. (A hard settle that blocked the decision cost about 6 shots a team-game in the ablation, so it was made an overlap, not a block.)
- **Contact pairs.** Hits already came from body contact. Each hit now commits the hitter (`hit` / `pin`) and the man hit (`stagger` / `down` / `pinned`), and `HitEvent.receiverS` says for how long. Tie-ups start only with both men within reach, hold both until somebody wins, and the battle event carries `holdS`. The goalie's save reaction holds him on his spot.
- **Goalie.** The shot → save pair: no push to a new spot during the reaction.
- **VT3 close-range rebounds** (deferred from S1). Two causes. (1) A shot is over inside one 4 Hz frame, so the drawn puck went from the blade straight to the rebound. The sim now writes a keyframe at the moment a shot meets the pads, blocker or net. (2) Point-blank jams left at full speed (83 mph from 5 ft). In-tight shots and backhands now release slower; speed is flight time only, the outcome is decided at the release.
- **Renderer (wind-up timing path only, `choreo.ts`).** When the sim's wind-up is longer than the shot clip can stretch, the shooter holds the set before the clip starts, so the drawn wind-up is never shorter than the sim's. No grip, hand or arm-IK code was touched.
- Reel: a new golden scenario `offsideCall` (`goldenScenarios.ts`, reel checklist and label).

### Detectors

- **VT12 action floor.** Stream half (`src/engine/analysis/actions.ts`, gate in `agentSim.test`): every shot's wind-up and every pass's release at least its row. Every act run on the frames lasted its floor unless a contact cut it. Imported league, 480 games: **0 short in ~1.19 M acts/shots/passes.** Viewer half (`vt12ActionFloor`): the drawn wind-up of every wound-up shot is at least its row in game time.
- **Contact pairs** (stream): hit men and tie-up men within range at the event, carried from the last frame at their own velocity. 7 apart in 34,000 pairs (hard knockdowns between frames). The gate sample shows 0.
- VT3 / VT7 / VT11 / VT12 / VT18 on the S2 reel: see below.

### Calibration (imported league, 480 games, seeds 7000-7479, no scalar changed)

| | S1 | + offside fix | S2 |
|---|---|---|---|
| goals / team-game (NHL band 2.70-3.43) | 3.10 | 3.17 | **2.86** |
| shots on goal | 28.7 | 29.2 | 26.7 |
| PP goals | 0.43 | 0.43 | 0.42 |
| hits | 21.0 | 21.0 | 21.5 |
| penalties (band 2.97-4.46) | 3.30 | 3.41 | 3.88 |
| rebound-shot share | 0.100 | 0.095 | 0.090 |
| offside whistles | 1.59 | 1.80 | 1.62 |
| VT13 aimless /60 | 17.1 | - | 17.2 |
| VT14 coverage /60 | 3.8 | - | 3.9 |
| tie-up battles | - | - | 14.2 |

The floors take goals down by about 0.3, as the design expected (defenders get the beat they close in). Goals stay in band. Per the design, no compensating scalar in this slice: the S9 re-fit is logged as "compensates for the action-timing floor". The generated-league band test (96 games) still passes.

### Reel S2 (`K:/Hockey Game/.cache/reel-s2/reel.html`)

Seven clips: breakaway, twoOnOne, ozCycleShot, faceoffWinPlay, bigHit, saveRebound, offsideCall. Green: VT1-VT8, VT10, VT12, VT13, VT14, VT16, VT18. **VT3 went from 2 red (S1) to 0 red, 5 green.** Still red: VT9 framing on 5 clips (S7) and VT11 on bigHit (one knockdown drawn 4.8 ft apart at contact). That hit is not an S2 regression: on 8 generated games, knockdown hits whose man moves back against the push are 0 of 15 (S1 code: 1 of 8). Owner saves were SHA1-verified unchanged.

### Left for later

- VT11 on the bigHit clip: the renderer's hit-contact draw for a knockdown (renderer hit path, not touched here while the grip/IK work is open).
- The wingers' tie-ups at the faceoff drop, and the net-front box-out pair: no box-out job exists yet (S4/S5).
- Goalie butterfly / lateral-push floors as separate acts. Only the save reaction is a sim state now.
- PP% runs low (about 10% against the NHL's about 20%), as before S2: S8.
