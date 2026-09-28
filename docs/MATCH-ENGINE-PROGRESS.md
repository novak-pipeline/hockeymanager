# Match Engine — Progress Log

Companion to `docs/MATCH-ENGINE-PLAN.md` (the brief). What has landed, what it
measured before/after, and what is next. Branch: `play-realism`.

## Step 0 — immediate relief: no aimless backward passing (current engine)

**Rule implemented** (`src/engine/full/fullSim.ts`, `doPass` + the set plays):
- A backward pass (`isBackwardPass` in `types.ts`: more than 6 ft toward the
  passer's own net and the backward component dominant, i.e. the pass is more than
  about 110° off the attack direction) is allowed **in our own half** (breakout
  support, D-to-D regroup, reverses). **Past the red line** it is allowed only as a
  **bail-out**: a defender in stick reach and closing (`underRealPressure`) and
  no real forward/across option (receiver with room plus an open lane).
  Even then, most carriers protect the puck and keep working it, and strong
  puck handlers do this more often.
- The pass decision now reads the ice. Each option is weighted by the
  receiver's open ice (`openIceFt`), the lane clearance (`laneClearanceFt`),
  and in the zone by how much more dangerous the receiver's spot is than the
  carrier's (xG surface). Receivers are led by their velocity, and the
  back/forward test uses the led point.
- **Lane to the net → attack.** A cycle carrier with a clear corridor to the
  net (`laneToNet`: slot range, nobody within 9 ft of him and nobody in an 8-ft
  corridor) takes it. He stops passing, the playbook drives him into the slot,
  and he shoots when in tight.
- Set plays fixed: the entry "drop pass to a trailer" is gone. When a carrier is
  pressured at the line, he moves the puck **across** to the lane-mate. The
  low-to-high (point-shot beat) now happens only under pressure, and an
  unpressured low carrier attacks himself. The 2-on-1 pass must go level or
  ahead. The seam feed waits until the receiver is across, and never goes back
  to him.
- FINISH_K was re-reconciled from 0.6 to 0.53 because the average attempt is
  now more dangerous (slot drives instead of point dishes).

**Measurements** (`src/engine/full/passDirection.test.ts`, 24 seeded games;
calibration snapshot = the calibration test's 40-game set, seeds 5000+):

| metric | before | after |
|---|---|---|
| backward share of passes thrown in the offensive half | **40.5%** | **8.0%** |
| of which unpressured (no defender closing in stick reach) | 1755 / 10386 | **0** |
| backward passes during rush / entry / counter beats | 147 / 252 (58%) | **0** / 24 |
| breakaways ending in a shot (rest: lost to a backcheck/whistle) | 97.1% | 97.2% (0 passes) |
| all passes, backward share (own-half regroups included) | 41.3% | 26.1% |
| passes / team / game | 428 | 401 |
| goals / team / game (NHL target 3.07) | 3.54 | 3.27 |
| shots on goal / team / game (target 30.0, band ±20%) | 34.85 | 34.86 |
| hits / takeaways / giveaways / penalties | 19.1 / 5.8 / 7.3 / 3.67 | 22.6 / 6.5 / 7.7 / 3.88 |

Tests: `passDirection.test.ts` asserts that breakaways end in a shot or a
forward pass at least 95% of the time, with zero back passes. It also asserts
zero backward passes on rushes, an offensive-half back share under 10%, and
zero unpressured offensive-half back passes. The engine-agnostic stream
analyzer (`passShape.ts`) is reusable by the scorecard and by the agent engine.

## The agent engine (M1–M3, behind a flag): `src/engine/agent/`

**How to run it.** `agentSimGame(home, away, resolve, opts)` has the same
contract as `fullSimGame`. The render3d harness takes `?engine=agent`. The new
top-down eye-test page is
`scripts/dev/render3d-harness/top.html?engine=agent&seed=3&t=<s>`.
`SCORECARD_ENGINE=agent npm run scorecard` scores the agent engine and writes
to `.cache/scorecard-agent/`, so the committed director scorecard is never
overwritten. The default engine is still the director. It stays as the
fallback and as the quick-sim reference.

**Architecture.** `runGame()` (exported from `fullSim.ts`) is the shared game
shell: lines, penalties, OT/shootout and the outcome. The agent engine plugs in
its own period loop (`agentSim.ts`). The modules are:
- `rink.ts`: rink geometry in feet, including 28-ft rounded corners and the net as an obstacle;
- `physics.ts`: M1;
- `templates.ts`: role positions per situation;
- `brain.ts`: M2;
- `physical.ts`: M3;
- `world.ts`: shared state;
- `telemetry.ts`: measurements.

### M1: physics

**Skating is a momentum model:**
- The power curve falls off as speed rises.
- Hockey stops brake along the line of travel.
- Turning is limited by grip, so the turn radius grows with speed.
- Facing is separate from velocity. Skating backward caps speed at 0.68× top speed, and the turn rate is finite. Defenders pivot when a carrier comes at them with speed.
- Hard skating drains shift energy, which caps speed and acceleration. Bench time restores it.
- Movement commands track through a time constant that depends on urgency. Support skaters' targets move with a 0.45 s lag. Together these kill the old near-max-acceleration twitch.

**Bodies occupy space:**
- Collisions between skaters are inelastic and push them apart.
- Teammates steer around each other.
- The boards and the net stop bodies.

**The puck is physical:**
- It rides on the blade while carried.
- Loose, it slides with friction and bounces off the boards, glass and net. The boards are dead enough that it no longer rebounds the length of the ice.
- It can fly: chips, saucer passes over sticks, and clears over the glass.
- Passes travel at 27–60 mph and shots at 65–100 mph.
- A pickup is a stick-reach attempt that depends on hands, relative speed and cover. Each stick gets one try, and a miss can leave the puck untouched or deflect it.
- A save resolves only when the puck actually reaches the goalie.

### M2: thinking agents

**The carrier's decision.** He values every carry heading, pass, shot and dump or chip. The inputs are:
- the xG surface and possession value;
- retention (who can reach his path first);
- pass completion from lane timing and stick reach;
- how closely each receiver is covered;
- shooting lanes and net-front tip value.

He picks with a softmax whose sharpness comes from his decision-making. Execution error depends on skill and pressure, so mistakes emerge from ratings. The Step 0 rules are built in: no backward passes on the rush, in transition or on breakaways, unless as a pressured bail-out. A low-to-high pass is allowed in a settled cycle.

**Role spots.** Support players and defenders take their spots from `templates.ts`. The tables cover:
- breakout, transition and rush;
- the cycle, with the puck low or at the point;
- the power play (umbrella, 1-3-1, overload);
- the forecheck (1-2-2, 2-1-2, trap);
- neutral-zone defence and the DZ box+1;
- the penalty kill (box, diamond);
- 3v3.

Each spot is an offset relative to the puck, in the team's attack frame. The tables are fitted to the scorecard's textbook snapshots and can be swapped for measured shape targets without code changes.

**Defensive behaviours:**
- The presser contains the carrier and engages when he is vulnerable.
- D hold their neutral-zone gap and stay goal-side of the deepest attacker.
- Man or zone coverage, net-front box-outs, a shooting-lane man, and a slot collapse.
- Backchecking.
- Loose-puck intercepts, computed along the puck's path.

**The goalie** tracks a lagged read of the puck, playing angle and depth. He seals the post, covers loose pucks at his pads, and controls rebounds according to his rating.

**Rules**, adjudicated from positions:
- Offside is judged at the line, with delayed offside and tag-up.
- Icing is judged, and the iced team cannot change.
- Penalties are delayed until the offending side touches the puck.
- Every whistle carries a reason, including puck over the glass (and delay of game when that comes from your own zone).

**The bench:**
- On-the-fly changes go through the bench door. Each fresh man comes on only when the man he replaces arrives.
- No change starts with the puck in your own zone.
- Benches are fixed, so the 2nd period is the long change.

**Faceoffs:**
- Legal alignment, and nobody is unset at the drop.
- Draws are directed: back to a D, to the wall, or at the net, or they end in a tie-up.
- The `offensiveFaceoff` and `defensiveFaceoff` tactics now take effect.

**The pulled goalie:**
- He is pulled on offensive-zone possession or at a stoppage, and skates to the bench door.
- The extra attacker comes on when he gets there.
- The other team shoots at the empty net from distance, with icing risk.

### M3: the physical game

**Who hits.** Hit intent comes from the hitting composite, the player's role, the hitting slider, rivalry, the wall, and fatigue. Defencemen finish their man in the corners.

**How a hit resolves.** Hits come from real collisions:
- Force is closing speed × the hitter's mass share.
- A planned hit can be dodged.
- A battle collision counts as a hit for physical players.
- A hit knocks the target off balance (scaled by force against his balance and strength), knocks the puck loose, and costs energy.

**Penalties from angle and force:** boarding (from behind into the boards), charging, elbowing, and interference on a man without the puck. Beaten defenders reach, which gives hooking, tripping, holding, slashing, high-sticking, cross-checking and holding the stick.

**The code.** A dirty hit, or a hard hit on a star, is answered at the next whistle with a fight or a roughing minor.

**Battles.** Board, net-front and loose-puck battles are emitted as events.

### Additive event contract

All changes to `src/domain/events.ts` are additive: every new field is optional, and the new variants are additions.
- hit: `force`, `kind`, `targetHadPuck`
- pass: `speedMph`, `kind`, `interceptedBy`
- shot: `shotType`, `speedMph`, `origin`, `oddMan`
- new variants: `missedShot`, `battle`
- penalty: `drawnBy`
- lineChange: `onTheFly`
- faceoff: `loser`
- frames: skater `facing`, `puckZ`

### Scorecard: agent vs director

The agent was scored on 30 imported-league games. The director figures come from the committed 60-game report.
- **Director:** 50 pass / 42 fail.
- **Agent:** 63–68 pass / 24–29 fail. Run-to-run noise is about ±3.

| metric | director | agent | NHL band |
|---|---|---|---|
| median accel | 16.6 ft/s² | 8.9 | 1–8 |
| 20+ mph bursts / skater-game | 10.5 | 0.8 | 0.3–3 |
| teleports / game | 10.6 | **0** | 0 |
| back-pass share on the rush | 40% | 12.7% | ≤12% |
| back-pass share on odd-man / breakaways | 11% / 0% | 6.7% / 0% | ≤10% / ≤2% |
| hits within 10 ft of the boards | 21% | **94%** | 88–100% |
| hits thrown by D | 33% | 42% | 27–43% |
| distinct penalty types | 2 | 13 | 10–60 |
| blocked share of attempts | 37% | 28% | 23–33% |
| SOG / goals per team-game | 36.1 / 3.57 | 30.3 / 3.37 | 26–34 / 2.7–3.4 |
| missed shots | never misses | ~14 / team-game | ~14 |
| saves frozen | 21% | 26% | 24–38% |
| forward shift length | 55 s | 51 s | 36–52 |

**Calibration league.** `agentSim.test.ts` runs 16 games on the vanilla league. Goals, SOG, hits, penalties and faceoffs all land in their bands. The same test also checks determinism and the displacement cap.

**Speed.** A game simulates in about 0.6–0.9 s.

**Audit probe** (12 imported games):
- Skaters inside the faceoff circle at the drop: 5.45 → 2.1.
- Faceoff winner still carrying the puck 1 s after the draw: 49% → 15%.
- Hits/60: 0.93 for the top hitting quintile vs 0.34 for the bottom.
- Puck jumps over 35 ft: 4 in 12 games, against 20 per game before.

### Still failing / next
- **Shot location.** Mean shot distance is ~16 ft against 34 ft in the NHL, and point shots are too rare. Several value models were tried; point possession needs a structural fix.
- **Odd-man rushes.** About 12 per team-game against a band of 1–6. Most come from a carrier beating a stationary defenceman along the wall at the blue line, so D step-up and angling need work.
- **Kinematics.** Mean skater speed is slightly under the band (7.2 mph, about 6 mi/60 skated), and p99 acceleration is 28 ft/s² against a limit of 25.
- **Shape errors.** The neutral-zone regroup, the rush and the power-play set-ups sit 25–40 ft off the textbook positions.
- **Not started:** 4v4 and 5v3 shapes, and an attribute-correlation gate test.

## Pass 2 (2026-09-28): shot location, gap control, dekes, physics hits, tactic robustness

Measured on the imported real-roster league (the scorecard, 60 games) unless
noted. Before = the agent engine at fc59998.

| metric | before | after | NHL band |
|---|---|---|---|
| scorecard pass / fail (director: 50 / 42) | 68 / 24 | 69–70 / 22–23 | — |
| mean shot distance | 16.7 ft | 35–37 ft | 30–38 |
| D share of shots on goal | ~10% | ~29% | ~30% |
| odd-man rushes / team-game | 13.1 | 3.5 | 1–6 |
| SOG / goals / blocked share | 30.6 / 3.28 / 0.28 | 30–32 / 3.0–3.25 / 0.31 | 26–34 / 2.7–3.4 / 0.23–0.33 |
| offside / icing per game | 11 / 9 | 5 / 7–8 | 5–7 / 6–8 |
| loose-puck skate-pasts / game | ~270 | ~95–130 | — |
| near-net carry s / team-game, stint p90, circling | 147, 5.3 s, 5.2 | 82, 1.75 s, 0.55 | ≤90, ≤2.5 s, ≤0.5 |
| dekes / team-game (success) | 0 | ~20 (~50%) | 8–20 |
| knockdowns / pins per team-game | 0 / 0 | 1.7 / 6.5 | — |
| attribute gates r (hits, takeaways, giveaways, pass%) | — | 0.4 / 0.37 / −0.54 / 0.7 | ≥0.3 |

What changed (see the commits on `play-realism` for detail):
- **Value model** (`brain.ts` `VAL`): holding the puck in their zone is worth
  the possession's continuation; a shot is worth its finish plus what it keeps
  (rebounds, tips, and from the point the four men below the shot), minus the
  turnover a block hands back; shooters read lanes with the sim's own block
  odds. Carriers no longer stall at the crease; point shots are real.
- **D gap discipline** (`D_SAFETY`): D stay goal-side of every attacker's
  projected position and of a chip coming up the ice; a D steps up for a loose
  puck above that line only when he clearly wins the race; no pinch below the
  circles; the NZ gap is held on where the carrier is going.
- **In close**: a carrier has 1 s within 30 ft of the net to shoot, deke, pass
  or curl out; behind the net is worth less than in front; tie-ups get settled.
- **Dekes**: additive `deke` event; hands vs the defender's / goalie's read,
  both against tonight's average (scale-invariant across leagues).
- **Stick checks**: additive `pokeCheck` event with a reload between attempts.
- **Hits**: momentum exchange along the line of impact; `knockdown` when the
  shove beats balance + strength; `pinned` against the boards (a board battle).
- **Faceoffs**: `setAt` (everyone set; a 0.6–1.2 s hold before the drop) and
  `tieUp`.
- **Shapes**: 4v4 (2-2 attack, box defence), 5v3 (2-2-1) and the 3-man PK
  triangle; forward roles are dropped first when a unit is short.
- **Ratings on the game's level** (`world.ts` `LEVEL`, `shared/ratingLevel.ts`):
  both watched engines and the quick sim read ratings against the level of the
  rosters on the ice, so the imported league (~9 points higher) and the
  generated one play the same hockey.
- **Tactic robustness** (`fullSim.budgetTactics`, `tacticsRobust.test.ts`):
  any slider mix stays inside NHL extremes (≤42 SOG, ≤4.5 goals a team-game).

Still open: shape errors vs the textbook templates (20–38 ft; the matcher keys
on puck location only, so transitions are scored as set plays); shot-location
TVD 0.3; accel p99 ~28 ft/s² (hits and contacts are real impulses now); carrier
speed in close (median ~7 mph against ≥ 9); standoffs ~2–4 per game; 22+ mph
bursts; neutral-zone back passes 0.04 (band ≥ 0.05).

## Pass 3 (2026-09-28): stream consistency, kinematics, shot map

**Stream fixes (found by the 3D work):**
- **Puck on the blade.** A reception now names the new carrier only after the puck has slid onto his blade. The puck glides the last few feet at 30 ft/s or more. A puck that was just won is settled for 0.2 s before a poke, tie-up or fumble can take it back.
  - Carried frames with the puck more than 1.5 ft off the blade: 2.3% → 0.
  - The worst case was a pass reception assigned up to 5 ft away.
  - New metrics: `motion.puckOffBladeShare` (band 0–0.01) and `motion.puckBladeP90`. The agent gate test checks the share.
- **A downed man stays in the picture.** When a whistle's line change would take off a knocked-down or pinned man, the change is deferred until he is up: at least 1.8 s after a knockdown and 1.5 s after a pin. The faceoff waits for it.
  - Players missing from the frames within 1.5 s of their knockdown or pin: 4/106 → 0.
  - New metric: `motion.downVanishShare` (band 0). The agent gate test checks it.

**Situation-aware shape matcher.** Each template is scored only in its own situation (breakout / regroup / rush / settled OZ), and on-ice time is game-clock time.

**Kinematics and shot map** (imported league, 40 games):

| metric | before | after | target |
|---|---|---|---|
| miles / 60 | 7.64 | 8.08 | ≥ 8 |
| accel p50 (ft/s²) | 9.81 | 7.95 | ≤ 8 |
| accel p99 (ft/s²) | 28.0 | 22.1 | ≤ 25 |
| 22+ mph bursts / skater-game | 0.010 | 0.048 | ≥ 0.02 |
| 20+ mph bursts / skater-game | 1.86 | < 3 | 0.3–3 |
| standoffs / game | 7.9 | 5.2 | → 0 |
| NZ back-pass share | 0.037 | 0.050 | ≥ 0.05 |
| shot location TVD | 0.316 | 0.176 | ≤ 0.15 |
| mean shot distance (ft) | 37.3 | 34.5 | |
| in-close carrier speed p50 (mph) | 6.0 | 6.3 | ≥ 9 |
| SOG / goals per team-game | 29.8 / 3.18 | 29.0 / 3.26 | |

**Levers:**
- **Top speed** now runs from 23 to 35.6 ft/s by skating rating.
- **Support loops** are smaller and slower. The centripetal acceleration of the drift loop was what set the accel median.
- **Carry momentum:** a carrier who is moving keeps going the way he is going.
- **Tie-ups:** a stopped checker within stick reach (5 ft) of a stopped carrier is a tie-up that gets settled.
- **Regroup back passes** in the neutral zone are penalised less.
- **Shot map.** Before this pass, 21% of attempts were centre-slot one-timers.
  - The royal-road one-timer now goes to the circles (|y| 6–28 ft).
  - Point shots are less automatic.
  - In tight, a shot or deke is less often a lost cause.
- **Recalibrated:** shoot 0.62, finishK 0.80, hit intent 0.01.

**Still open:**
- **In-close carrier speed.** About 70% of the slow in-close frames are receptions or pickups less than 0.75 s old: receivers standing at their spots. Skate-through chasing did not move it.
- **Standoffs.** The remaining ones are mostly OZ half-wall holds.
- **Team shapes** are still 14–27 ft off the templates. The spot targets match the templates; what remains is lag (NZ and rush lanes 12–20 ft behind). A puck-velocity lead and a later breakout hand-off moved them by about 1 ft.

## Pass 4 (2026-09-28): receivers in stride, tips, tie-ups, shape-lag diagnosis

Measured on the imported league, 40 games on each of two seed sets (7000 / 9000), pass 3 → pass 4:

| metric | pass 3 | pass 4 | target |
|---|---|---|---|
| in-close receptions at 8+ mph | 43% | 52% | — |
| in-close carrier speed p50 (mph) | 6.3 / 6.2 | 6.4 / 6.3 | ≥ 9 |
| standoffs / game | 5.2 / 5.5 | 4.9 / 5.0 | → 0 |
| shot location TVD | 0.176 / 0.198 | 0.209 / 0.203 | ≤ 0.15 |
| tips (share of SOG) | 0 (credited to the point man) | ~3.5% | NHL ~3–5% |
| SOG / goals per team-game | 29.0 / 3.26 | 29.1 / 2.85 | in band |
| scorecard | 74 / 74 | 76 / 76 | |

**What changed:**
- **Receivers take passes in stride.** A receiver who is moving keeps skating his line when the pass was led to him. Before, he pulled up on the intercept point and waited.
- **Tips are the tipper's shots**, recorded from the tip spot, as the NHL scores them. The shooter gets the assist.
- **Tie-ups:**
  - Tie-ups are now settled against the nearest checker.
  - The clock no longer restarts when a second checker steps in.
  - A carrier who spins off goes along the wall instead of into it.
  - A won tie-up can be scored as a takeaway.
  - Carry headings that the boards or the line cut to under 4 ft are dropped.
- **Pinned players stay in the frames for 1.7 s.** At 1.5 s the gate sat exactly on its own boundary.

**Diagnosis: the team-shape error is lag, not wrong spots.** Per-role telemetry with the D at the point (5v5, settled) compares each player's body with his spot target:

| role | spot target error | body error (x, y), ft |
|---|---|---|
| WEAK_LOW | ≤ 1 ft | (-35, +10) |
| WALL | ≤ 1 ft | (-10, -22) |
| NET_FRONT | ≤ 1 ft | (-11, +3) |
| POINT_W | ≤ 1 ft | (-9, +13) |

The spot targets are right. The situation changes faster than drifting (low-urgency) support players relocate.

Tried and reverted:
- **Hurry-to-shape** (urgency rising with distance from the spot): 1–3 ft better, but accel p50 went to 8.4–8.8 and 20+ mph bursts went over 3 per skater-game.
- **Spot-velocity feed-forward** (lane running) and a rush urgency floor: under 1 ft.
- **A puck-velocity lead** on the spots: under 1 ft.
- **OZ route cuts** (a support forward cutting to the slot every 4 s): no change to reception speed, TVD 0.22.

The next lever is anticipation: support players moving to the spot for the puck's *next* location (the pass target the carrier is about to pick), not its current one.

**Why in-close speed didn't move:** the slow in-close carrier frames are mostly protect carries. A reversal on the spot is a hockey stop. A curl (heading ±2.0–2.3 rad instead of π) raised the median to 8.1 mph, but in-close carry time went from 43 to 117 s per team-game and goals to 4.5, so it was reverted.

**Why TVD didn't move:**
- 42% of SOG are one-timers, and they are the OZ's shot engine. Cutting the one-timer value drops SOG to 18–21 with no substitute shots.
- Moving the one-timer spot to the dots (|y| 12–30) also cut SOG.
- The biggest remaining gaps: too many central 15–40 ft shots and central point shots, too few 30–60° shots from 15–55 ft, and too few 8–15 ft shots.
