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
