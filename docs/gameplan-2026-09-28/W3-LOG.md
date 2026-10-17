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

## S3 stop points and the clock (2026-10-16)

### First: the reel S2 regressions (owner scores 2/3/3/3/4/4, offsideCall unscored)

**Faceoffs off the dot** (ozCycleShot, faceoffWinPlay: "they're not dropping on the faceoff dot"). Not a new break: the agent engine's dots were the old 2D engine's normalized ones (`DOT_EZ_X 60`, `DOT_Y 23.4`), while the 3D sheet paints the NHL dots (69, 22). Every end-zone draw was 9 ft up the slot from the painted dot, inside the circle, so W2's "puck in the circle" fix and VT7 (which measured the puck against the *sim's* dot) were both green. On the S2 engine 73% of faceoffs were more than 2 ft off a painted dot. Second fault in the same class: a stoppage went to the *nearest* of the nine dots, so with real end dots a whistle at the top of the circles came out to the neutral zone. Fix: `rink.ts` dots = the painted ones (`iceCanvas ICE_DOTS`, one constant the probe hands to VT7); a stoppage dot is chosen by zone (rule 76.4: an end-zone stoppage stays in that end); D-zone alignment moved with the deeper dot. Detectors: `faceoffRule.ts` gives the dot a stoppage calls for (by the whistle's new `detail`, the penalised / icing / offside side, the goalie's end); the sim gate `agentSim.test` holds every faceoff to it; **VT7 now judges the drawn puck and both drawn centres against the painted dot the stoppage calls for** (≤ 2 ft / ≤ 4 ft), and with no `detail` against the nearest painted dot. Imported league, 480 games: 0 of 26,231 faceoffs off the right dot.

**A goal from behind the net** (breakaway: "the puck went in from behind the net at impossible angle"). The S2 clip could not be replayed frame for frame (the reel was recorded before the offside merge), so the class was found on the S2 head: a successful deke on the goalie carried the shooter up to 12 ft forward (past the goal line), and the shot that followed was released from behind the net; the shared xG surface folds |dx|, so 9 ft behind the net read as 9 ft in the slot (`DEKE.beatG` on top). A shooter loading his shot also glided on past the line, and a goal aimed at a random point 1.5 ft behind the line, so from a sharp angle the puck crossed the line outside the post. S2 head, 120 imported games: **89 of 676 goals illegal** (57 released on or behind the goal line, 11 past 78°, 21 crossing the line outside the post); same game as the reel (seed 1001): P3 7:08 goal from (97.8, 6.5) after a shoulder-fake on the goalie. Fix: `shotGeometry()` - no shot from on/behind the goal line (he keeps the puck), no shot on goal past 78° (it goes off the near side of the net); `goalPath()` - a goal crosses the line inside the posts on the straight line from the release; the deke and the wind-up glide stop short of the line; a tip needs an angle too; `xgAt` returns ~0 behind the line. Detectors: `goalGeometry.ts` (release angle + puck path through the mouth) as a sim gate, and new **VT19** on the drawn puck. Imported league after: 0 illegal in 3,086 goals.

**offsideCall "so much weird stuff"** - frames of the S2 clip (0.25 s apart), what is wrong:
1. Two TOR skaters wear #14 (Danford, Nylander). The labels carry no numbers, and the fallback is a hash of the id over 99 numbers: on a 23-man roster a duplicate is more likely than not. Fixed: fallback numbers are unique per team (`rink3dRenderer.teamNumbers`).
2. At the whistle BOS changes all five at once: eight or nine white sweaters pile up at their bench door for ~2 s. The sim swapped the five instantly at the whistle and the renderer walked the old rigs to the door while the new five already stood there. Fixed in the sim: a change at a whistle goes through the door like one on the fly (`whistleChange`, stepChanges now runs in dead time), and the faceoff waits for it - the clock is stopped, so it costs no play.
3. The scorebug froze at 14:01 for the stoppage, but the engine clock ran through it, so the clock jumped at the next drop. Fixed by the stopped clock (below).
4. The offside draw's dot (20, 23.4) was 1.4 ft off the painted neutral dot. Fixed with the dots.
5. Name labels of men at the bench float above the dasher boards (Hagens, Knies) while play goes on. Not fixed here (bench presentation, W5).

**The reel exporter** labelled every reel `"reel": "v0"` unless `--reel` was passed (the S2 scores were hand-named). It now takes the name from the output folder (`.cache/reel-s3` → `s3`) and writes it into report.json too.

### S3 (W3-DESIGN item 8)

- **The clock stops at the whistle** (owner-approved). Two clocks in `agentPeriod`: `now` (sim time, runs through everything) and `clock` (the period clock: only in live play). A period is 20:00 of clock. Events carry `t` = clock and the new additive `playT` (absolute playback second); `FaceoffEvent.setPlayT`. Penalties, the goalie pull, the bench tilt and TOI run on the clock. Every playback consumer now places events with `playAbsT` / `streamPeriodBases` (`@domain/streamTime`): timeline (the scorebug reads the frames' clock), 3D renderer, choreo, highlights, broadcast director, playback director, event cursor, match stats, play-by-play, viewer probe, the analysis judges. Box scores keep reading `t`. Live play per game: 52.2 → 60.5 min.
- **Strict faceoff set restored**: the linesman waits for every man to be still (< 2.5 ft/s) on his spot (W2 reverted it because the running clock paid for the wait).
- **VT8 mid-ice swap**: a strength change in live play (a penalty runs out, the extra attacker) used to redeploy in place. `liveShape`: one more man comes over the boards at the door, one fewer skates off through it, a new kind with the same count keeps the men out there until the next change; `beginChange` no longer redeploys on a count mismatch. Gate: no man leaves or appears mid-ice in live play (4 games, 0), and at whistles < 10% away from the door.
- **Tactic changes at stop points only** (`src/engine/shared/matchChanges.ts`, `AgentSimOptions.changes`): a record names a stop point (the n-th whistle or goal, or the intermission before a period) and changes tactics or lines there; a lines change goes on at that whistle. New event variant `tacticChange`. Determinism gate: an empty list and no-op records give the same stream hash as no list; a real change leaves the stream identical up to its whistle; the same input + list replays to the same hash.
- **`StoppageEvent.detail`** (owner-approved, the union left alone) and `team`: offsideCarried / offsideTouch / offsideShot / icing / goalieFreeze / puckOutOfPlay / boardPin / misc / penalty / fight / goal. A whistle during a delayed penalty is `penalty` (the draw goes to that end).
- Reel scenarios `faceoffNeutral`, `faceoffDefensive` (a draw in each zone).

### Detectors

| | before (S2 head) | after S3 |
|---|---|---|
| faceoffs > 2 ft off the painted dot (imported, 120 g / 480 g) | 73% | 0 of 26,231 off the dot the stoppage calls for |
| illegal goals (behind the line / past 78° / outside the post) | 89 of 676 | 0 of 3,086 (the shootout's nominal goals skipped) |
| VT7 strict on the drawn screen | red (hybrid build, S2 dots: "puck drawn 9.1 ft from the end (69, -22) dot, centres 9.8 / 5.7 ft") | green 3/3 (OZ, NZ, DZ draws) |
| VT19 drawn goals through the mouth | (new; synthetic red on a puck from behind the net) | green 3/3 goals |
| VT8 / live strength changes mid-ice (sim gate, 4 games) | redeploy in place | 0 mid-ice; whistle changes < 10% away from the door |
| VT12 floors, offside missed calls (stream judge), contact pairs apart (480 g) | 0 short; 12 missed in 83,649 entries; 7 apart | 0 short; 22 missed in 103,832 entries (more live play; all delayed-touch sampling cases but 2); 5 apart |
| VT13 aimless /60, VT14 coverage /60 | 17.2, 3.9 | 14.9, 3.9 |

### Calibration (imported league, 480 games, seeds 7000-7479)

| | S2 head | S3 (clock stopped) | S3 + stickFoulK |
|---|---|---|---|
| live minutes / game | 52.2 | 60.5 | 60.5 |
| goals / team-game (band 2.70-3.43) | 2.86 | 3.24 | **3.23** |
| shots on goal | 26.7 | 29.2 | 29.3 |
| PP goals | 0.42 | 0.54 | 0.50 |
| penalties (band 2.97-4.46) | 3.88 | 4.55 (over) | **4.27** |
| hits | 21.5 | 25.7 | 25.8 |
| rebound-shot share | 0.090 | 0.074 | 0.074 |
| offside whistles | 1.62 | 1.88 | 1.98 |

The stopped clock adds 16% live play, so every per-second rate rises with it (the design expected this, item 8). Goals stay in band; the illegal goals removed (about 13% of S2 goals) and the extra live time roughly cancel at the top of the range. One scalar changed: **`AGENT_TUNING.stickFoulK` 1.9 → 1.6, compensates for the stopped dead-time clock** (penalties had left the band). Shot volume is not re-fitted here (S9).

### Reel S3 (`K:/Hockey Game/.cache/reel-s3/reel.html`)

Eight clips: breakaway, ozCycleShot, goalReplay, lineChangeOnFly, faceoffWinPlay (OZ), offsideCall, faceoffNeutral, faceoffDefensive. Green: VT1-VT8, VT10, VT14, VT16, VT17, VT19. Red: VT9 framing (7 clips, S7), VT11 on lineChangeOnFly (a hit man drawn sliding against the push, the S2 class), VT13 on ozCycleShot (one 2 s case), VT12 on ozCycleShot (one backhand drawn with no wind-up; not reproduced on a re-run of the same pin), VT18 on ozCycleShot and goalReplay - see below. Owner saves SHA1-verified unchanged.

### Left for later

- **VT18 on the drawn puck.** Both reds are the same thing: the carrier is at the blue line and the drawn puck sits on the drawn blade 2.5-3.8 ft from the sim's puck (median 2.6-3.4 ft over carried frames, p90 3.7-5.3 ft), so on screen it is outside the zone while the sim's is already in; the pass that follows reads as an entry with men ahead of it. The sim's call was right (stream judge: 0 missed). The drawn blade vs sim blade point is the grip/IK path (VT17 work), not touched here.
- The 2D renderer still paints its dots at the old 0.6 / 0.55 normalized spots (the classic engine uses them; it was left alone), so agent games in 2D draw end-zone faceoffs 9 ft off its dots.
- Bench name labels drawn above the boards; bench life (W5).
- A `lines` change is applied by replacing the team's lines at the whistle (TeamSim's strength figure is not recomputed); goalie / timeout records are W6's.

## S4 5-on-5 systems from the coach (2026-10-17)

The owner said "go" without scoring reel S3.

### First: the S3 carry-overs

**1. The drawn carried puck 2.5-3.8 ft off the sim's (VT18 red on ozCycleShot / goalReplay).** The S3 note guessed body lag. Measured on the S3 pins (viewer-probe dumps, carried frames): the drawn carrier was only ~1 ft behind his sim position; the drawn puck sat 5.0-5.9 ft (p50) in front of the drawn body, the sim's 2.3 ft. Root cause: a carried puck was drawn on the drawn blade, and the carry pose holds the blade far out (`CARRY_BLADE` 4.1 ft, then slid out until the shaft is full length; the owner rigs' stick is 5.6 ft), while the sim carries it 2.3 ft ahead (`bladePoint`). Fix (renderer only, the sim's puck wins):
- A carried puck is drawn where the sim has it, whenever the sim has a carrier, including while the choreography still holds a passer in his swing (that put a passed puck that never left the zone 5 ft back outside it for a frame, which read as an entry: a second VT18 class found on reel S4). A swing keeps the puck on the blade only while the sim's puck is within 2.5 ft of it.
- The blade bends to the puck: `GripInput.puck` (the sim's puck in the carrier's frame) is the carry's blade target; the top hand comes back and up toward the ribs and chokes down to a 4.2 ft shaft before the blade is slid out, and gives the puck up rather than let the bottom hand off the shaft (no lance). The stickhandle loop's own stick and arms yield 80% to it (`animLayer.puckHold`).
- VT17 now also judges the carried puck against the sim's (≤ 1 ft on ≥ 95% of carried frames) and the blade on the drawn puck (≤ 1 ft on ≥ 65%: the measured floor). Before / after, same pins: drawn puck vs sim p50 2.6-3.5 ft → 0.00 ft, 100% within 1 ft; blade on the puck 31-39% (puck at the sim's, no bend) → 71-89%. Unit test (`gripState.test`): the carry puts the blade within 0.6 ft of the sim's puck, both hands on (red before: 1.9 ft). VT18 on the S3 pins: red → green; reel S4: 8 green, 0 red.
- What is left: the sim carries the puck 2.3 ft ahead of the body, nearer than a 5.6 ft stick reaches with both hands on it, so the tight carry chokes up to 1.2 ft down the owner stick. Moving the sim's blade point out to ~3.5 ft is an owner decision (it moves possession geometry and calibration).

**2. VT11, a hit man moving into the check (lineChangeOnFly since S2).** Stream judge first (`judgeContacts.against`: over the 0.4 s after a hit the man hit travels < -0.5 ft along the push, and toward the hitter too). Three causes: (a) a "hit" was scored when the man hit skated into the back of a hitter who was skating away from him (the hitter's own speed along the line of impact ≤ 0): the recoil is relative, so both kept going his way; (b) a stagger lasted the force-scaled stun only, as short as 0.15 s, after which he skated straight back into the hitter; (c) the contact fell between two 4 Hz frames and the picture interpolated straight from the approach to the recoil. Fix: a check needs the hitter driving into the man (`HIT_TUNING.driveMin` 1 ft/s, otherwise it is a bump); a stagger coasts at least `ACTION_FLOOR.contact.stagger` 0.45 s (`CONSTRAINTS_VERSION` 2); a keyframe is written at every hit. Against-the-push share: imported league 12 games 3.8% → 1.7%, generated 8 games 3.7% → 2.4% (gate in `agentSim.test` < 3%). VT11 also reads relative to the hitter (a man rubbed out along the wall travels with the man finishing the check). The S3 pin's hit (p189 → p12): drawn -2.8 / sim -2.3 ft → -1.0 / -0.8, along the boards with the hitter. Reel S4: VT11 green on all three clips with hits, the knockdown included. Hits 25.8 → 25.2 a team-game.

**3. Name plates over the boards.** Men arriving from the bench (behind the boards, hopping over) got their plate. Plates now only over men on the ice (`plateOnIce`: within the boards' line less 1 ft, not arriving); VT8 judges it (the probe writes `label` per rig). Reel S4: 0 of ~10,000 plates per clip behind the boards.

**4. `npm run reel` dropping `--out` with a space.** Root cause: the script is `electron-vite build && node viewer-truth.mjs --record`; npm runs it through cmd and escapes an argument with a space for cmd, and because the chain starts with a .cmd shim the carets reach node literally (`^--out=K:/Hockey^ Game/.cache/reel-s4^`), which no longer starts with `--out=`, so the reel went to the default folder. `scripts/dev/cliFlags.mjs`: `unCaret`, plus `--out <dir>` and npm's own `npm_config_out`; a bare argument nobody claimed stops the run. `reelArgs.test` (the captured string). Reel S4 was written with `npm run reel -- "--out=K:/Hockey Game/.cache/reel-s4"`.

### S4 (W3-DESIGN item 3, the 5-on-5 phases)

- **Playbooks** (`coachProfile.ts`, no change to existing exports): `SYSTEM_PLAYBOOK` per `CoachSystemId` (forecheck, D-zone, weighted breakouts, regroup, entry, pinch, screen), `playbookFor(system, tactics)` and `systemPlaybook(profile)`. The forecheck and man/zone choice always come from the tactics (the coach writes them, the GM can change them); the system adds its flavour (the shell's trap is a 1-4, its coverage the collapse). Breakout, regroup, entry and D-zone structure (`tactics.breakout / nzOffensive / ozEntry / dZoneStructure`) override the system where the tactics carry them (owner-approved). Those four were DEAD; they are now AGENT ENGINE ONLY in `leverStaticAudit.test` and LEVER-AUDIT.md (no UI writes them; not priced). `Team.coachSystem` (additive) is set where the career writes tactics from a profile, and filled from the head coach before a watched game (old saves).
- **On the ice** (`src/engine/agent/systems.ts`, 5-on-5 only; PP/PK/4-on-4/3-on-3 keep their tables):
  - forecheck: 2-1-2 (F1 and F2 both in deep, F2 taking away the carrier's first outlet, never above the deep line; the strong-side D pinching by the playbook's pinch), 1-2-2 (F2 / F3 on the walls at the hash marks), the 1-3-1 trap (F1 steers from the top of their circles and does not chase behind the net; the trap holds until the puck is over the red line), the 1-4 (F1 waits at their blue line, four across ours).
  - D zone: zone (box +1), man (S3's), the collapse (five men in the house, the point men left alone: `DZ_COLLAPSE`, `DZ_GAP`).
  - breakouts: up the wall, reverse (partner low on the far side), wheel (partner holds the net, the D skates it round), stretch (far winger at the red line), rim (winger low on the wall); one drawn per possession from the playbook weights with a hash (never the sim RNG); the carrier's small tilt toward the play's outlet (`SYSTEM_TILT`).
  - regroup: controlled (a D has it in the neutral zone or the carrier turned back: the forwards swing back below the red line), stretch (a man held at their blue line), dump-and-change (dump tilt).
  - the net-front screen (deferred from S1/S2): with a shot from beyond 45 ft the net-front man stands on its line 6 ft out (job `screen`), as far as the playbook's screen. The box-out pair answers it (`boxOuts`, constraints `contact.boxOut`): the net-front defender and the screener within 4 ft, shove for the spot every 2 s; the loser is moved off the spot, the winner's stick is free (`boxOut`), the loser's is tied up (`boxedOut`: no tip); a `battle` event `netFront` with `holdS` and no winner (it is not a puck touch).
- **Contract** (additive): `FrameEvent.homeSystem / awaySystem` ("forecheck:2-1-2", "dzone:collapse", "breakout:reverse", "regroup:controlled").
- **VT15** (`src/engine/analysis/systemPlay.ts`): forecheck, D-zone and breakouts classified from positions (and the pass events) and compared with the declared play. Stream gate in `agentSim.test` (heavy forecheck v shell, trap v 1-2-2, 6 games): forecheck family (pressure 2-1-2/1-2-2 v sitting back 1-3-1/1-4) > 50% per system, the shell's 1-4 share above the trap's, the heavy forecheck's pressure share 30 points above the shell's, the shell's collapse share 12 points above a zone team's. Viewer VT15 in `viewerTruth.ts` (the probe gets the declared plays as `system` events; a verdict needs two sequences of a phase).
- Reel scenarios: `breakoutPlay`, `forecheckTurnover`, `nzRegroup`, and `systemHome` / `systemAway` (the two teams' forechecks, picked only when the families differ).

What each system looks like (VT15 on the generated league, 8 games per pair, forecheck sequences classified / declared):

| | forecheck read off the bodies | D zone | breakouts |
|---|---|---|---|
| heavy forecheck (2-1-2, man) | 2-1-2 55, 1-2-2 26, 1-3-1 40, 1-4 8 (family 63%) | collapse 32% | 7% read as declared |
| shell (1-4, collapse) | 1-4 162, 1-3-1 43, 1-2-2 22, 2-1-2 11 (86%) | collapse 43% | 20% (rims) |
| trap (1-3-1, zone) | 1-3-1 176, 1-2-2 31, 2-1-2 19, 1-4 12 (79%) | collapse 28% | 10% |
| structured (1-2-2, zone) | 1-2-2 86, 2-1-2 55, 1-3-1 31, 1-4 4 (80%) | collapse 23% | 18% |

Imported league with every coach's system (480 games): forecheck family 82% of 5,760 sequences; the collapse read as a collapse 47% of the time, zone coverage 28%. Sitting back against pressing is legible; 2-1-2 against 1-2-2 is not separable by positions (both read about a third 2-1-2); the man coverage riding the point men tight (gap 5 ft out to 72 ft) cost 0.5 goals a team-game (the slot emptied) and was taken back to S3's man coverage. Breakouts are a tilt, not a script: the carrier still carries it out most of the time.

### Detectors (stream, imported league, 480 games)

| | S3 | S4 |
|---|---|---|
| VT13 aimless /60 | 14.9 | 14.0 |
| VT14 coverage /60 | 3.9 | 4.3 |
| job flips / player-min | 24.2 | 25.0 |
| VT12 floors | 0 short | 0 short in 374,000 |
| offside missed (stream judge) | 22 in 103,832 entries | 27 in 103,806 |
| illegal goals / faceoffs off the dot | 0 / 0 | 0 / 0 |
| hit man into the check (12 games) | 3.8% | 1.7% |

### Calibration (imported league, 480 games, seeds 7000-7479)

Two harness settings now (`teamPlay.measure`): the DB tactics as before, and `TP_COACH=1` (every team runs its head coach's system, the tactics it writes and its coach fit, as the career does).

| | S3 DB tactics | S4 DB tactics | S3 coach systems | S4 coach systems |
|---|---|---|---|---|
| goals / team-game (band 2.70-3.43) | 3.23 | **3.29** | 3.46 | **3.49** |
| shots on goal | 29.3 | 29.2 | 31.0 | 30.7 |
| PP goals | 0.50 | 0.49 | 0.54 | 0.57 |
| hits | 25.8 | 25.2 | 26.2 | 24.3 |
| penalties | 4.27 | 4.25 | 4.25 | 4.26 |
| rebound-shot share | 0.073 | 0.085 | 0.077 | 0.083 |
| tie-up battles | 16.6 | 67.5 (box-outs) | 15.8 | 61.2 |

Within noise (one standard error ≈ 0.06 goals) S4 leaves goals where S3 had them. **No scalar changed.** (`AGENT_TUNING.screenXg` is the old inline 0.15 screen bonus, named; setting it to 0 or 0.08 moved goals by nothing measurable, so it stays.) Ablations on 120 games with coach systems, all S4 parts on 3.83 at the time: no man-riding 3.32, no screen 3.55, no system tables 3.59, no carrier tilts 3.62, no box-outs 3.70, no 2-1-2 hunt 3.75, no trap hold 3.93. The man riding and the 34-ft screen were the goals; both were reworked (S3 man coverage; the screen only on shots from beyond 45 ft).

**Found: the coach systems already push the agent engine above the band on S3** (3.46): the career runs every NHL team on its coach's tactics, the old harness did not. The watched games the owner sees are the coach-systems column. It is S9's re-fit to bring it to ~3.05; S4 does not cause it.

### Reel S4 (`K:/Hockey Game/.cache/reel-s4/reel.html`)

Eleven clips (`npm run reel -- "--out=K:/Hockey Game/.cache/reel-s4"`): ozCycleShot, goalReplay, lineChangeOnFly, faceoffWinPlay, bigHit, dZoneCoverage, offsideCall, and the S4 clips breakoutPlay (a stretch breakout), nzRegroup (through the D, then the entry), systemHome (TOR's 1-2-2) and systemAway (CBJ's 1-3-1 trap) from the same game. forecheckTurnover was found on an interim build (a 2-1-2, takeaway 6.8 s in) but not in the twelve searched games on the final one. Green: VT1, VT2, VT4-VT7, VT10, VT11, VT13, VT14, VT16-VT19. VT15 is n/a on every clip: the viewer half needs two sequences of a phase for a verdict and a clip holds one at most (one alone flips on a frame: TOR's 1-2-2 F1 trailing a carrier who skated back into his own corner read as a 1-3-1 on the screen and as a 1-2-2 on the stream), so VT15 is carried by the stream gate. Red: VT9 framing (all, S7); VT3 on goalReplay (a jam from 5 ft that goes in: 0.1 s of flight ending in the goal whistle); VT8 on lineChangeOnFly (a man drawn leaving 8.1 ft from his door, the bound is 8); VT12 on nzRegroup (one backhand drawn with no wind-up, the S3 class). Owner saves SHA1-verified unchanged.

### Left for later

- 2-1-2 against 1-2-2 is not legible at 4 Hz; the breakouts are a tilt the carrier mostly overrides (7-20% read as declared). A breakout as a scripted sequence (first pass to the outlet, then the support routes) is plan work (W3-DESIGN item 2 steps).
- The box-out pair emits a `battle` per shove (~25 a team-game): any reader that counts net-front battles sees them.
- The four tactics fields are wired in the agent engine only and no UI writes them; the lever harness does not price them.
- The sim's 2.3 ft blade point against the owner rigs' 5.6 ft stick (above): owner decision.
