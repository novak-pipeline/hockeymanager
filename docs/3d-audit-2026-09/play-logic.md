# Does "The Show" play like hockey? — gameplay audit of the current watched-game engine

*Read-only audit, 2026-09-27, branch `improve-loop` @ dc4f53a. Target: the CURRENT engine (`src/engine/full/`: director.ts, playbook.ts, formations.ts, movement.ts, fullSim.ts). For each issue: what real hockey does, what we do (evidence), severity, root cause, fix size, and whether `docs/MATCH-ENGINE-PLAN.md` M1–M4 covers it.*

## Method and evidence

- **Measurement probe** (`probe.audit.ts`, this folder): 30 full games on the imported real-roster league (`mods/nhl-ehm/database.json`, read-only), seeds 7000–7029 (same pairing as `npm run scorecard`), 434,125 frames. It measures situations the scorecard does not: faceoff alignment and follow-up, line-change timing and placement, puck/skater jumps by cause, interception and block geometry, hit kinematics, offside at the line, net and crease intrusion, out-of-rink positions, goalie angle, pulled-goalie handling, penalty context, and attribute→outcome correlations. Raw output: `probe-out.json`, `probe2.json`, `probe3.json` (12-game rerun that adds line-change composition and crease occupancy).
- **Harness timeline** (`harnessgame.audit.ts` → `harness-timeline-s3.txt`): an event-by-event dump of the render3d harness game (generated league seed 3, game seed 21), so screenshots can be matched to sim events. `seeds.txt` lists 24 harness seeds with final score, OT and pull time.
- **Watching**: the render3d harness on port 5191 (stopped). I used a fixed high "tactical" camera (`look=0,110,80,0,0,4,62`, whole sheet in frame) plus broadcast and closeup cameras. Screenshot grids are in this folder: `fo3.png`, `fo4.png`, `lc77.png`, `pull1.png`, `hitnet.png`, `hit0.png`. Clips (webm):
  - `clip-faceoff-not-set.webm`: seed 3, faceoff #1. The puck drops while four attackers are still skating in from centre ice, and the winning centre carries the puck out himself.
  - `clip-crease-pile-hit-in-net.webm`: seed 3, hit #10. Five bodies stand in the crease, skaters clip into the net, and a hit is thrown inside the goal mouth.
  - `clip-goalie-pull-to-corner.webm`: seed 1, P3 1:40. The pulled goalie pops to the corner behind his own net, and the extra attacker appears mid-ice.
  - `clip-linechange-p1-77s.webm`: seed 3, P1 77 s. Both benches change at the same moment with the puck in the home zone, and 3D rigs skate out from the gate while the sim already has the new men in position.
- **Scorecard baseline**: `docs/MATCH-SCORECARD.md` (60 games, post-Step-0). It is quoted where it already shows the problem. It is not re-derived here.

Severity scale: **S1** breaks the illusion or the owner's asks ("hits and logic for the plays"). **S2** clearly un-hockey and often visible. **S3** texture or polish.
Fix size: **S** is under a day in the current engine. **M** is a few days. **L** is a structural change (agent engine).

---

## A. The core problem: outcomes are rolled first, then bodies and puck are made to fit

**Real hockey:** a pass is intercepted because a defender's stick is in the lane. A shot is blocked because a body sits between the shooter and the net. A takeaway happens because a defender closed on the carrier.

**What we do.** Every outcome is a dice roll at release time. The world is then bent to match it:

| Situation | Measured (30 games) | Root cause |
|---|---|---|
| Pass completion | Rolled at release: `rng.chance(0.95 − pressure·0.18 − d/420)`. The lane only affects *who* is chosen as target. | `doPass`/`passTo`, fullSim.ts:1328, 1481 |
| Interceptions | 5,284 picks. The interceptor is the defender *nearest the landing point*: median **6.9 ft** from the pass line, p90 **22 ft**, max 63 ft. The puck jumps to him at landing: p90 **28.6 ft**, max 70 ft in one 0.25 s tick. | fullSim.ts:1340, 1495, 1352 |
| Blocked shots | Rolled at `1 − ON_GOAL_SHARE` (37% blocked; NHL 28%). The blocker is the defender nearest the puck, wherever he stands: **44%** are more than 6 ft from the shot lane (p90 15.7 ft, max 42 ft), and **62%** stand behind the shooter. | `tryShoot` fullSim.ts:1071 |
| Giveaways | Flat per-tick rate. The puck teleports to the nearest opponent: p90 **26 ft**, max 76 ft. | fullSim.ts:2189 |
| Possession flips | 10% of flips hand the puck to a player 25+ ft away (max 85 ft). | same |
| Goals and saves | Decided when the shot is released (`isGoal = rng.chance(pGoal)`), then a straight-line flight to the net plays out. The goalie's body is irrelevant. | fullSim.ts:1153 |
| Puck jumps > 35 ft in one tick (≈ 95 mph+), outside whistles | **20 per game**: 41% at pass landings, 20% at save/rebound, 33% with no event at all. | the above |

**Severity S1.** This is the root of "no logic for the plays". **Fix L.** **Plan: covered by M2** ("Mistakes emerge from lower attributes … not from dice; pass success and shot quality come from the physical situation") and M1 (puck physics, stick reach, poke checks). **Gate the plan should add:** interceptor within stick reach of the lane, blocker in the lane, zero puck teleports. None of these is on the scorecard today.

## B. Hits are cosmetic dice events (the owner's #1 ask)

**Real hockey:** checks are thrown mostly along the boards: 94% within 10 ft of the boards (NHL PBP, scorecard). 44% are thrown on the forecheck in the hitter's offensive zone. They come at speed, separate the man from the puck or pin him, and are thrown more by physical players. Bad angles draw boarding, charging or interference calls.

**What we do** (1,367 hits):
- A hit is `rng.chance(HIT_P × tactic sliders)` whenever the nearest defender is within 10 ft of the carrier (fullSim.ts:2145–2166). The target is always the puck carrier.
- The hitter is **whoever happens to be nearest**. Correlation of hits/60 with the `hitting` composite is **−0.06**. The top quintile of hitters throws **4.6** hits/60 against **5.0** for the bottom quintile. The composites `hitting`, `blocking` and `takeaway` are read nowhere in play (grep).
- **No physical contact.** The target's speed changes by **+1.0 mph** on average over the next second. Closing speed has a median of **5 mph**, and the hitter's own speed a median of **5 mph**. These are hits at walking pace.
- **Rarely any consequence.** The puck is knocked loose in only **21%** of hits (a 30% roll), and the target still has it 1 s later in **41%**. Hits never lead to penalties (1/1,367 coincidental), injuries (the injury is a pre-rolled hash) or fatigue.
- **Location is wrong:** only **21%** of hits are within 10 ft of the boards (median 16.8 ft), against 94% in the NHL. 60% are in the hitter's defensive zone, 32% on the forecheck (NHL 44%).
- **3D fakes it.** `choreo.ts resolveHit` plays a stagger or fall clip from the relative speed. The sim body keeps going (`hit0.png`: the pair drift together and apart with no impact).

**Severity S1. Fix L. Plan: covered by M3** (deciding, executing, outcomes, penalties from angle and force, injury, calibration) together with **M1** "bodies occupy space … contact". Keep the M3 gate "hits/60 by player type": today it would read 0 correlation.

## C. Line changes (MISSING FROM PLAN)

**Real hockey:** each bench changes on its own schedule. Changes happen on the fly when the puck is going deep or the team has possession heading the other way (never with the puck in your own zone if avoidable), or at a whistle. Players physically skate to and from the bench door. Forward shifts run about 40–50 s and are tired-driven. A team that ices the puck cannot change (NHL Rule 81). Too many men is a penalty (Rule 74).

**What we do** (5,509 changes over 30 games):
- **Clock-driven, both benches at once.** Every `SHIFT_SECONDS=40` (fullSim.ts:1901) both teams redeploy together: **97%** of change ticks involve both teams.
- **No read of the puck.** 40% of on-the-fly changes happen with the puck in the changing team's own zone, and 36% while the opponent has the puck. Only 8% happen at stoppages. The scorecard shows 89% on the fly against a band of 45–85%.
- **In-place identity swap.** The incoming unit inherits the outgoing players' positions (`deploy(…inherit)`, fullSim.ts:376–386). New players appear mid-ice a mean **68 ft** from the bench. The sim has no bench at all.
- **Teleports.** Inherit is by array index, so a player who stays on (a D pair continues, a forward double-shifts) is moved to another slot's coordinates. That produces **323 of the 325 same-player teleports** (> 11 ft per tick). This is the scorecard's "10.55 teleports/game" and its impossible 30.6 mph top speed.
- **Fake changes.** 14% of on-the-fly "changes" send out the same five men, and 42% are partial. Line choice is a weighted random draw per change (`FWD_LINE_WEIGHTS`), with no rotation order and no fatigue. The full sim never reads fatigue.
- **3D disagrees with the sim.** `render3d/lineChange.ts` skates incoming rigs out from the gate while the sim already has them in position (`lc77.png`, `clip-linechange-p1-77s.webm`). For a few seconds the picture and the event stream disagree.
- The icing team changes freely. Too many men cannot happen.

**Severity S1** (it is visible about every 40 s, and it is the main teleport source). **Fix M in the current engine** (bench gate model, per-team fatigue-driven timing, puck-state gating, identity-stable slots). **Plan: MISSING.** M4 mentions only "line matching … behave as set" and a "shorten the bench" shout.

## D. Faceoffs (MISSING FROM PLAN except animation)

**Real hockey:** everyone is set before the drop. Wingers line up on the hash marks outside the 15-ft circle, and no one but the two centres may be inside it (Rule 76). A clean win is drawn back to a D or a winger. The centre rarely skates away with it. Offensive-zone wins lead to set plays: the D shot, the winger's quick shot, the "win and go". There are violations and tie-ups.

**What we do** (1,477 faceoffs):
- **Players not set.** The drop happens once the two centres are within 8 ft of the dot and at least 6 ticks have passed (fullSim.ts:1743–1754). Median whistle-to-drop is **2.5 s** (p90 9 s). At the seed-3 icing faceoff, four attackers are still skating in from the neutral zone when the puck drops (`fo3.png`, `clip-faceoff-not-set.webm`).
- **Illegal alignment.** A mean of **5.45** skaters are inside the circle at the drop. `FACEOFF_OFFSETS` put wingers 6 ft back and 6 ft wide of the dot (formations.ts:747).
- **Winner keeps it.** The puck is handed straight to the winning centre (`carrier = hC/aC`, fullSim.ts:1758). He is still carrying it 1 s later in **49%** of faceoffs and 2 s later in **32%**. A pass within 3 s happens only 50% of the time, and a pull-back only **13%** (`fo4.png`: the red centre wins and skates up ice).
- A single probability (`faceoffWin_h/(h+a)`) decides the draw. There are no zone-specific alignments (D-zone strong-side coverage, weak-side winger on the point) and no follow-up plays, and `tactics.offensiveFaceoff`/`defensiveFaceoff` are DEAD (LEVER-AUDIT §5).

**Severity S1** (about 50 per game, each one staged). **Fix M.** **Plan: MISSING.** M5 covers only faceoff *animation*. Add a faceoff sub-system to M2: legal alignment, set before drop, draw direction as a skill-driven choice, post-draw plays, and use of the faceoff tactics.

## E. Shooting

**Real hockey:** NHL teams take about 30 shots on goal plus about 14 misses and about 17 blocks per game. Mean shot distance is about 34 ft (scorecard). A large share comes from the point and the D. Shots go wide, high and off posts. Tips and deflections are common in front. Shooters pick corners.

**What we do** (2,136 SOG):
- **No misses.** Every unblocked attempt is on net. The target is literally `{x: a, y: 0}`, and the flight aims within ±1.9 ft of centre (fullSim.ts:1157). Shot-target lateral in the stream is **0.0 ft for 100%** of shots, so the renderer invents placement.
- **Too close.** Mean distance is **18.1 ft** and median **13.7 ft**, against NHL 34. Shot-location total variation is 0.48 (scorecard). **9.4%** of shots come from behind the goal line.
- **Defencemen barely shoot.** D take **10%** of SOG. The NHL figure is roughly 30%; check it against the calibration cache. Point shots require a scripted `pointShot` beat with a low-to-high bail-out, so they are rare.
- One-timer is a flag that multiplies xG by 1.35 (fullSim.ts:1091). There is no tip, deflection or screen physics: "screened" means any attacker within 12 ft of the net, for +15%. There are no shot types.
- **Rebounds:** 50% are placed at a fixed slot spot and 50% in a fixed corner, with the puck jumping about **6.4 ft** instantly (fullSim.ts:1234–1246). Rebound-shot share is 12% against NHL 6.7%, and SOG are 36/team-game against 30.

**Severity S2. Fix M–L.** **Plan: partly covered.** M1 covers "deflections, shot speeds" and M2 "shot quality from the physical situation". **Missing:** explicit missed-shot, post and crossbar modelling, shot placement and shot-type choice, the point-shot share, and a gate on the distance distribution. The scorecard's "Not observable" rows already name the event fields.

## F. Rink geometry, the net and the crease (partly MISSING)

**Real hockey:** the boards have 28 ft corner radii. The net is a solid obstacle that players skate *around*. The crease is protected: goalie interference rules apply.

**What we do:**
- The sim rink is a **rectangle**. Skaters clamp to |x|≤97 ft, |y|≤40.4 ft, and the loose puck bounces off a rectangle (movement.ts:44–46, fullSim.ts:1943–1956). Over 30 games there were **1,541 skater-frames and 581 puck-frames outside the rounded boards**. The analyzer's `boardDistFt` clamps these to 0, so the scorecard cannot see them.
- **The net is not an obstacle.** There were **9,612 skater-frames inside the net cage** (x 89.5–92.5 ft, |y|<2.7 ft), about **80 s per game**, and 39% of them are the puck carrier walking through the net. Wraparound and cycle targets sit at 0.9–0.94 (playbook.ts:223, formations.ts:498), and nothing routes around the cage.
- **Crease camping.** 5.3% of live frames have a skater in a crease, about 3 minutes per game. POINT_SHOT_SCREEN plants a forward at x=0.86 (3 ft off the goal line, *inside* the 6-ft crease; playbook.ts:200). Defensive box spots sit at 0.8. `hitnet.png` and `hit0.png` show piles of 4–5 bodies on the goalie, and one hit event sits at (−90, 0), inside the goal mouth.

**Severity S2** (very visible in 3D). **Fix S–M** now: add a rounded-corner clamp, a net and crease avoidance field, and fix the template spots. **Plan:** M1 "bodies occupy space … separation" is generic. **MISSING:** static obstacles (net, crease rules, corner geometry) and board-following puck physics.

## G. Rules not adjudicated: offside, icing, stoppages (MISSING FROM PLAN)

**Real hockey:** offside is judged when the puck crosses the line, with delayed offside and tag-up (Rule 83). Icing requires a race, and hybrid icing is judged at the dots (Rule 81). Whistles have causes: puck out of play, high stick, hand pass, net off, goalie freeze. Penalties on the non-offending team are delayed until that team touches the puck.

**What we do:**
- **Offside exists only as a scripted "readable failure" beat** sampled at the NHL rate (director.ts:162; fullSim.ts:2296). Real positions are never judged: in **41%** of carried entries (898/2,193) a teammate is already 5+ ft inside the zone when the puck crosses, with no call.
- **Icing** is a per-tick dice roll during breakouts (`pIcingPerTick`, fullSim.ts:2232). The puck is "iced" by a straight flight, and the whistle comes the moment it lands. There is no race, no hybrid, and no waving off. Dumps and clears that actually travel the length of the ice are never judged. The iced team can still change.
- **Whistles:** **85%** carry no reason (1,188 of 1,394). "Other" stoppages are a flat per-tick rate (fullSim.ts:2210) with no puck-over-glass, high-stick or hand-pass mechanics.
- **Penalties are called instantly**, with no delayed penalty and no 6-on-5.

**Severity S2. Fix M** (a rules referee that reads positions each tick; it is independent of the agent work). **Plan: MISSING.** Nothing in M1–M4 covers officiating.

## H. Penalties

**Real hockey:** most minors come from actions: hooking, holding and tripping on a beaten defender, interference, slashing, high sticks, roughing after whistles, and body-check infractions. The NHL shows about 27 distinct infraction types (scorecard).

**What we do:** `rng.chance(PENALTY_P × proneness × sliders)` each decision tick for each team (fullSim.ts:2106–2143). The offender is picked by `penaltyProne` from anywhere on the ice: median **34 ft from the puck**, and the team with the puck is penalised 50% of the time. The infraction is always `"minor"` (plus pre-scheduled fights), so **2 distinct types** appear. There are no majors except fights, no double minors, and no misconducts.

**Severity S2. Fix M** (and L once penalties come from agent actions). **Plan: partly.** M3 covers body-check penalties (boarding, charging, elbowing, interference) and fights. **MISSING:** stick and obstruction infractions from M2 defensive actions (hook, hold, trip, slash, high-stick), delayed-penalty play, and the penalty-type mix gate.

## I. Skating and bodies

**Real hockey:** skaters glide most of the time, accelerate in bursts, turn wide at speed, skate backwards (D), and never pass through each other.

**What we do:** seek-steering at up to max acceleration toward a target each tick (movement.ts:62–112). Median acceleration is **16.6 ft/s²** (band 1–8). There are **10.5 bursts of 20+ mph per skater-game** (band 0.3–3). There is no facing, no backward skating and no pivots: an OZ carrier "skates backward" in 13% of frames and a DZ carrier in 24%, meaning velocity points back while the renderer infers facing. **Opposing skaters overlap (< 2 ft) in 0.22 pairs per live frame.** OZ carriers stand still (< 2 mph) in **27%** of frames. The puck is glued exactly 2.2 ft ahead along velocity (p10=p50=p90=2.2 ft; fullSim.ts:1932–1936), with no stickhandling or protection.

**Severity S2. Fix L. Plan: covered by M1** (momentum skating, backward skating, bodies occupy space, puck on blade). Add the frame-level "facing" field (scorecard "Not observable") as an M1 deliverable so 3D stops inferring facing.

## J. Goaltending

**Real hockey:** goalies move with the puck on their angle, push post to post, seal the post (RVH) when the puck is below the goal line, come out to challenge, play dumped pucks behind the net, and freeze about 31% of saves.

**What we do:** `tendNet` *writes* the goalie's position each tick with no movement model (fullSim.ts:1624–1636). Depth runs 2–6 ft. **Lateral position is hard-capped at ±2.55 ft**, so on a sharp-angle puck he stays near centre: the angle error is fine at the median (1.4 ft) but p90 is **13.5 ft**. When the puck is below the goal line he sits centred (median 0.7 ft off centre, no post seal). He **never plays the puck**. Saves are dice, rebounds go to two fixed spots, and freezes are 21% against 31%. There is no save selection from the shot; the renderer picks a clip from lateral offset.

**Severity S2. Fix M. Plan: covered by M2 "Goalie AI"** (angle, depth, tracking, post-to-post, rebound control, freezes, playing the puck).

## K. Pulled goalie and empty net (mechanics MISSING)

**Real hockey:** the goalie is pulled when his team has possession in the offensive zone or at an OZ faceoff. He skates to the bench, and the extra attacker jumps over the boards. The leading team fires long-range empty-net attempts and must avoid icing.

**What we do:** the goalie is pulled at a fixed clock time (1:20, 1:40 or 1:45 left, adjusted by the aggressiveness slider; fullSim.ts:933–945). In the harness, seeds pull at exactly 1100 s, 1120 s or 1095 s **regardless of puck location** (one probe case pulled with the puck at his own crease, (−91, 0)). The goalie **teleports about 35 ft to (97, −36): the corner behind his own net**, not the bench (`BENCH_X/BENCH_Y`, fullSim.ts:130–131, 1627; `pull1.png`, `clip-goalie-pull-to-corner.webm`). The 6th attacker spawns with no inherited slot, a mean **56 ft from the bench** (fullSim.ts:384). Empty-net shots happen only inside offensive-zone beats with p=0.85 (fullSim.ts:133), so there are no long-range EN attempts and no icing avoidance.

**Severity S2** (every close game ends with this). **Fix S–M** now. **Plan:** M4 lists "pull the goalie" as a GM shout only. **MISSING:** pull and return mechanics, bench travel, EN shooting logic, and the delayed-penalty extra attacker.

## L. Puck physics

**Real hockey:** puck speeds are 30–60 mph for passes and 70–100 mph for shots. A loose puck slides a long way (low friction). Rims travel along the boards and glass. There are bounces, height (saucers, chips, lobs) and deflections.

**What we do:** passes, shots, dumps and clears are **straight-line tweens with a precomputed tick count** that land exactly at the target and then run a callback (`launchFlight`, fullSim.ts:970). A "rim" or dump is a straight flight to a corner point (fullSim.ts:1845), with nothing along the boards. Loose-puck friction is ×0.93 per 0.25 s, about 25% of velocity lost per second (fullSim.ts:232), so pucks die quickly. Board bounces are rectangular. There is no puck height. **About 20 puck jumps of more than 35 ft per tick per game** (section A).

**Severity S2. Fix M–L. Plan: covered by M1** (friction, bounces off boards and glass, deflections, realistic speeds, puck on the blade). Add `puckZ` (scorecard "Not observable") as an M1 deliverable.

## M. Player differentiation: stars do not look different

**Real hockey (FM bar):** attributes shape every decision and execution.

**What we do:** correlations over 30 games of attribute against per-60 outcome, skaters with at least 10 min TOI:

| Outcome | Rating it should follow | r |
|---|---|---|
| Hits/60 | hitting | **−0.06** |
| Takeaways/60 | takeaway | **−0.03** |
| Giveaways/60 | puckControl | **+0.04** (the wrong sign would be negative) |
| Pass completion | playmaking | **−0.02** (top-20% 76.9% against bottom-20% 78.1%) |
| Blocks/60 | blocking | +0.14 (from deployment only; the composite is unread) |
| Shots/60 | scoring | +0.33 (the only real link) |

The ratings that actually drive the full sim are: skating (top speed and acceleration), scoring (finish, shot speed, flair), faceoffWin, puckControl (loose-puck wins, entry choice, bail-out keep), playmaking (as a pass *receiver* weight and for assists), goaltending, penaltyProne and defensiveZone (line-matching only). The passer's skill does not affect completion. Coverage, gap and positioning ignore `defensiveZone`. In-game fatigue does not exist. **Severity S1** for an FM-style game. **Fix L. Plan: covered by M2** ("choice quality from vision, decisions, puck skills"). **Add a gate:** the correlation table above as a scorecard section, with r ≥ 0.3 per mapped pair.

## N. Tactics you can see

**What we do:** team shapes are template waypoints with small sway. The shape error against coaching templates is **35–40 ft** for NZ regroup, **29 ft** for the rush, **35 ft** for point possession and **27 ft** for the PP umbrella (scorecard). In the full sim, PP formation, PK formation, pace, shot eagerness, pinch and hitting are **INCONCLUSIVE** as levers, and 13 tactics fields are DEAD (LEVER-AUDIT §3, §5). The forecheck F1 simply targets the carrier's position (formations.ts:691). **Severity S2. Fix L. Plan: covered by M4** (and M2 Systems). The gate should require each tactic to be both *visible* (shape metric) and *priced* (lever audit).

## O. Flow and structure: breakouts, neutral zone, entries, rushes, cycle

**What we measure** (scorecard plus probe):
- **Zone entries: 133 per team-60** against 35–80. The puck leaks out over the blue line and back in constantly: the cycle resets at `adv < 0.12`, and blocked shots carom 10–30 ft/s "back up ice". Controlled entries are **20%** against 40–62%.
- **Odd-man rushes: 8.6 per team-game** against 1–6, because counters are dice (`startCounter`: 75% if the numbers say odd-man, plus 6–14% otherwise; fullSim.ts:1264).
- **Backward passes:** 40% of rush passes and 51% of neutral-zone passes go backward. Pass attempts are 401 per 60 against 150–400.
- **Breakout:** the retrieving D "wheels" only in the first 7 ticks. Wingers post at fixed half-wall spots (formations.ts:378). There are no reverses, no D-to-D behind the net, no stretch passes as a read, and no forecheck-read decision. `tactics.breakout` is DEAD.
- **Neutral zone:** the regroup is a dwell timer (director.ts:197), and the trap is only different template spots.
- **Cycle:** station waypoints plus a random pass every tick at about 6–18% (fullSim.ts:2490), forced after `MAX_HOLD_TICKS=20` (5 s). Carriers stand still 27% of OZ time.

**Severity S1** (it is what "scripted" looks like). **Fix L. Plan: covered by M2** (Support, Defence, Systems: breakouts, regroups, forecheck roles).

## P. Smaller findings (S3)

- **Dead time and pacing.** Whistle to drop has a median of 2.5 s and a goal restart takes 7.5 s. Real dead time is about 30 s. Watched games need a presentation decision (cut, compress, or let players reset) rather than dropping the puck on unset players. **MISSING** from the plan (M5 has broadcast cuts but no pacing rules).
- **OT 3v3** uses one forward and two D (`SLOTS_BY_COUNT[3]=[1,3,4]`). It runs about 2.1 shots per minute, and 3v3 regroup and possession-retention behaviour is not modelled. M2 names only PP/PK systems. **Partly missing:** add 3v3, 4v4 and 5v3 shapes.
- **Goal celebration:** the scoring team converges on the scorer and the conceding team drifts to its blue line. This is fine, but the 3D celebration is renderer-driven.
- **Blocked-shot carom** always goes "back up ice" at 10–30 ft/s and feeds the entry churn (fullSim.ts:1083).
- **Scoring rates** are high: 36 SOG and 3.57 goals per team-game against 30 and 3.07 (scorecard). This is a calibration issue.
- **Shift length** is 55 s for forwards and 59 s for D against about 40–50 s (scorecard). There is no fatigue model to shorten them.
- **Renderer compensations mask sim truth:** line-change gate skating, hit reactions and save-clip choice. When M2/M3 land, the renderer should *consume* sim facts (hit force and kind, save type, change timing) rather than invent them. M5 covers the animation side, but the plan should state that the sim is the source of truth.

---

## Ranked top 15

| # | Issue | Sev | Fix | Plan |
|---|---|---|---|---|
| 1 | Outcomes rolled first, then the world bent to fit: interceptors 22 ft (p90) off the lane, 44% of blockers not in the lane, puck teleports of about 20 per game over 35 ft per tick, goals decided at release (A) | S1 | L | M2 (+M1) |
| 2 | Hits are cosmetic dice: no contact (+1 mph target speed change), 5 mph closing speed, 21% near the boards against 94%, r=−0.06 with `hitting`, the target keeps the puck, no penalties or injuries (B) | S1 | L | M3 (+M1) |
| 3 | Line changes: clock-driven, both benches together (97%), in-place identity swap, 40% with the puck in own zone, 14% no-op, index-inherit teleports (≈ all 10.6 per game), sim/3D disagree (C) | S1 | M | **MISSING** |
| 4 | Faceoffs: puck dropped about 2.5 s after the whistle on unset players, 5.5 skaters inside the circle, the centre skates off with the puck (49% at 1 s), 13% draw-backs, no plays (D) | S1 | M | **MISSING** (M5 animation only) |
| 5 | Scripted flow: entries 133 per 60 (puck leaks in and out), 20% controlled entries, 8.6 odd-man rushes per game, rush and NZ back-passes 40–51%, dwell-timer regroups (O) | S1 | L | M2 |
| 6 | No player differentiation: hits, takeaways, giveaways and pass% uncorrelated with ratings; passer skill, blocking, takeaway and defensiveZone unused; no in-game fatigue (M) | S1 | L | M2 (gate missing) |
| 7 | The net and corners are not physical: 80 s per game of skaters inside the cage, rectangular rink (1.5k skater-frames and 581 puck-frames outside the boards), crease piles, screen spot inside the crease (F) | S2 | S–M | Partly M1; net and corners **MISSING** |
| 8 | Shots: no misses, posts or tips, the target always dead centre, mean distance 18 ft against 34, 9% from behind the goal line, D only 10% of shots, fixed-spot rebounds (E) | S2 | M–L | Partly M1/M2; misses and placement **MISSING** |
| 9 | Rules not adjudicated: offside never judged (41% of entries have a mate 5+ ft offside), dice icing with no race, 85% of whistles with no reason, no delayed penalties (G) | S2 | M | **MISSING** |
| 10 | Penalties are random ticks: always "minor", offender median 34 ft from the puck, 50% on the team with the puck, 2 infraction types (H) | S2 | M | M3 partly; stick and obstruction penalties plus delayed calls **MISSING** |
| 11 | Pulled goalie: fixed clock pull regardless of puck location, goalie teleports 35 ft to the corner behind his net, 6th attacker spawns mid-ice, no EN long shots (K) | S2 | S–M | **MISSING** (M4 shout only) |
| 12 | Goalie is a written position: ±2.55 ft lateral cap, no post seal (centred when the puck is behind the net), never plays the puck, dice saves, 21% freezes against 31% (J) | S2 | M | M2 Goalie AI |
| 13 | Skating: max-accel seek steering (median 16.6 ft/s² against 1–8), 10.5 bursts per game, opponents overlapping 0.22 pairs per frame, no backward skating or facing, puck glued at 2.2 ft (I) | S2 | L | M1 |
| 14 | Puck physics: straight-line tweens that land exactly, rims with no board travel, friction 25% per s, rectangular bounces, no height (L) | S2 | M–L | M1 |
| 15 | Tactics invisible: shape errors of 27–40 ft against system templates; PP/PK formation, pace, eagerness, pinch and hitting inconclusive; 13 dead fields (N) | S2 | L | M4 (+M2) |

**Quick wins inside the current engine** (while the agent engine is built; each is S or M and removes a visible 3D defect):
1. Make deploy identity-stable. A continuing player keeps his own position (removes about 10 teleports per game).
2. Hold the faceoff until all ten skaters are within a few feet of their spots. Move wingers to the hash marks. Hand a won draw to the D or winger behind the dot.
3. Clamp skaters and puck to the rounded-corner rink. Add net-cage and crease avoidance. Move the POINT_SHOT_SCREEN and REBOUND_CRASH spots out of the crease.
4. Put the pulled goalie at the real bench door, walk him there, and bring the extra attacker from the gate. Gate the pull on possession in the offensive zone or a stoppage.
5. Choose the blocker and interceptor only among defenders inside a lane corridor; otherwise the pass completes or the shot reaches the net. Recalibrate after.

## Plan gaps (items MISSING from MATCH-ENGINE-PLAN M1–M4)

1. **Line changes and the bench.** Bench and gate geometry, per-team change timing driven by fatigue and puck state, changes at stoppages, the icing no-change rule, too many men, identity-stable deployment, and double-shifting and bench-shortening as coach AI.
2. **Faceoffs as a system.** Legal alignment, players set before the drop, draw direction as a skill-driven choice, post-draw set plays, violations and tie-ups, and wiring of `offensiveFaceoff`/`defensiveFaceoff`.
3. **Officiating and rules engine.** Positional offside with tag-up and delayed offside, the icing race and hybrid icing, puck out of play, high stick, hand pass, net off, delayed penalty with the extra attacker, goalie interference, too many men, and a reason on every whistle.
4. **Stick and obstruction penalties from M2 defensive actions** (hook, hold, trip, slash, high-stick, interference) plus the infraction-mix gate. M3 lists only body-check infractions and fights.
5. **Static obstacles and rink geometry.** Rounded corners for bodies and the puck, the net cage as an obstacle, and crease rules. M1 "bodies occupy space" covers only body-to-body contact.
6. **Missed shots, posts, shot placement and shot types** as explicit outputs, with gates on the shot-distance distribution, D shot share and miss rate.
7. **Pulled goalie and empty-net logic.** Pull timing tied to possession or a stoppage, goalie travel to the bench, EN shooting and icing avoidance by the leading team.
8. **In-game fatigue and shift length** as a sim variable (speed, decisions, TOI distribution between stars and depth). The full sim never reads fatigue today.
9. **Special strengths beyond PP/PK.** 3v3 OT behaviour, 4v4, 5v3 and 6v5 shapes.
10. **Dead-time pacing.** Players reset in real time or the broadcast cuts; never drop the puck on unset players.
11. **The sim as the source of truth for 3D.** Retire renderer inventions (gate skating, hit reactions from relative speed, save-clip guessing) once the sim emits hit force and kind, save type and change timing.
12. **Situation-level scorecard gates from this audit:** interceptor lane distance, blocker-in-lane share, puck and skater teleports by cause, net and out-of-rink intrusion, offside-uncalled share, faceoff set-state and draw direction, the line-change puck-zone share, and the attribute-correlation table. Also fix `boardDistFt` so it reports negative (outside) values.

## Files

All in the audit scratch folder (evidence kept locally, not committed):
- Scripts: `probe.audit.ts`, `harnessgame.audit.ts`, `seeds.audit.ts`, `vitest.audit.config.ts`, `seq.mjs`.
- Data: `probe-out.json`, `probe2.json`, `probe3.json`, `harness-timeline-s3.txt`, `harness-dump-s3.txt`, `seeds.txt`.
- Images: `fo2.png`, `fo3.png`, `fo4.png`, `lc77.png`, `pull1.png`, `hitnet.png`, `hit0.png`, `top3.png`.
- Clips: `clip-*.webm`.

Run the probe from K:/Hockey Game with `node node_modules/vitest/vitest.mjs run --config <scratch>/vitest.audit.config.ts probe.audit`. Set `GAMES=` for the sample size and `TAG=` for the output name.
