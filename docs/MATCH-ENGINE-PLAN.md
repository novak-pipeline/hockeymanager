# The Match Engine Plan — to Football Manager level

*Owner goals (2026-09-26): "a ton of work making the 3D gameplay much much better all around"; "get it to the level of the Football Manager sim"; "I want hits and logic for the plays". Fun outweighs realism.*

## Where we are

The watched-game engine (`src/engine/full/`) is a **script**:
- `director.ts` samples the next *beat* (breakout → entry → cycle → shot → rebound …) from a semi-Markov chain tuned to NHL aggregates;
- `playbook.ts` / `formations.ts` *choreograph* players to act the beat out;
- `movement.ts` steers each skater toward his waypoint with finite acceleration.

Consequences we measured: players steer at near-max acceleration almost constantly (twitchy paths); play reads scripted because nobody on the ice *decides* anything; outcomes are rolled first and bodies move to match them (hence breakaways that pass backwards); hits are events, not collisions; tactics change the dice, not visible behaviour; a watched game is fully simulated before playback, so the GM can't influence it.

## Where FM is (the bar)

Every player is an **agent** that re-reads the situation several times a second and chooses an action shaped by his **attributes** (decisions, anticipation, vision, positioning…), his **role** and the **coach's instructions**. Movement and ball physics are continuous. Results *emerge* from those choices, and the engine is **calibrated** until the emergent totals match reality. Tactics are visibly different on the pitch. The manager can intervene live (shouts, subs, tactical changes). Post-match analysis explains *why*.

## The approach

Build a new **agent engine** alongside the current one (`src/engine/agent/`, behind a flag), keep the same event-stream contract so both renderers work unchanged, A/B it against the old engine on a **realism scorecard**, and switch the default only when it wins on realism *and* keeps the calibrated totals (goals, shots, PP%, save%) in the NHL band. The old director stays as the fallback and as the quick-sim reference.

## Phases (each gated by numbers, and by the owner's eye test on clips)

### M0 — Measure first: the realism scorecard *(start immediately; small)*
An analyzer over the event stream + positions, run on every build, compared with NHL tracking/public data (NHL EDGE, league stats):
- skating kinematics: speed / acceleration / jerk distributions, turn radius vs speed;
- team shape: spacing, compactness, D-pair distance, gap control, players per zone;
- possession: passes/60, pass length and completion, carries vs dumps on entry, turnovers;
- shots: locations (heat map vs NHL), types, rush vs cycle vs rebound share, blocked/missed share;
- physical: hits/60 per team and by player type, hit locations (boards vs open ice), board-battle outcomes, penalties by type;
- flow: time in each zone, whistles, faceoff outcomes and follow-ups, line-change timing, odd-man rushes;
- goalie: depth/angle to the puck, post-to-post, rebound control, freezes;
- motion quality (renderer side, already built): position teleports, yaw twitch, bone pops, frame hitches.
Output: `docs/MATCH-SCORECARD.md` regenerated each run, plus a short clip reel per run for the eye test.

### M1 — Physics & movement: the foundation
- Momentum skating: acceleration curves, **turn radius grows with speed**, crossovers, backward skating for D, stopping distance, gliding; no max-accel twitch.
- **Bodies occupy space**: separation, no overlaps, screening, contact.
- **Puck physics**: friction, bounces off boards/glass, deflections, realistic pass (~30–60 mph) and shot speeds (~70–100 mph), puck carried on the blade, stick reach, poke checks.

### M2 — Agents that think: the FM core *(the biggest phase)*
Each skater, several times a second, picks an action from **role × tactic × situation × attributes**:
- **Puck carrier**: skate / pass / shoot / dump / protect / beat his man — choice quality from vision, decisions, puck skills, and pressure;
- **Support**: get open, fill lanes, drive the net, cycle low, provide an outlet;
- **Defence**: gap control, man vs zone coverage, collapse, box out, block shots, stick-on-puck, pinch or hold the blue line;
- **Systems**: forecheck F1/F2/F3 roles (1-2-2, 2-1-2, 1-3-1 trap), breakouts (up the wall, reverse, stretch), neutral-zone regroups, PP (umbrella, 1-3-1) and PK (box, diamond) formations;
- **Goalie AI**: angle and depth, tracking, post-to-post, butterfly timing, rebound control, freezes, playing the puck.
Mistakes **emerge** from lower attributes (a bad read, a blown coverage, an overskated pass) — not from dice. Pass success and shot quality come from the physical situation (distance, pressure, lanes, screens), with the xG model calibrated so totals stay NHL-real. The director becomes a *pacer/calibrator*, not a scriptwriter.

### M3 — The physical game: hits and battles *(owner priority)*
- **Deciding to hit**: checking/aggression/physicality, role (power forward, shutdown D, enforcer), target with the puck along the boards, angle, closing speed, score and rivalry, fatigue.
- **Executing**: approach angle, timing; the target can protect, dodge, or bail.
- **Outcomes**: clean hit → loose puck / turnover; a missed hit → out of position; board pins and **board battles** decided by strength vs puck protection; net-front battles; **penalties** from angle and force (boarding, charging, elbowing, interference); **injury risk** scaled by force; fatigue cost; momentum and crowd effects.
- The code: answering a dirty hit, rare **fights** (grudges, cheap shots), instigator rules.
- Calibrated: team hits/game and player leaderboards in NHL shape; penalty mix realistic.

### M4 — Tactics you can see, and the GM in the game
- Coach systems and instructions drive agent parameters, and the difference is *visible* (an aggressive forecheck looks aggressive).
- **Live watched games**: simulate in chunks instead of pre-simulating the whole game, so the GM can make **intermission decisions** and **touchline shouts** (FM-style: "get pucks deep", "pinch", "shoot more", "tighten up", "shorten the bench", pull the goalie).
- Line matching and special-teams units behave as set.

### M5 — Animation & presentation mapping (3D)
Every agent action gets a contextual animation on the owner's Fab rig (with Blender-authored fallbacks): passes and receptions, stickhandling, dekes, shot types, one-timers, checks and taking hits, board battles, faceoffs, goalie saves chosen by shot location, celebrations. Puck/stick contact exact. Broadcast camera cuts and 3D replays, pregame moments (rookie lap, ovations) in 3D, broadcast overlays. Sound: skates, puck on stick, boards, crowd reactions, goal horn (CC0 effects).

### M6 — Match analysis (FM's post-match)
xG shot maps, heat maps, pass networks, zone-entry breakdown, hits map, player ratings that explain themselves, an assistant's intermission and postgame reads, and a highlight reel that picks the genuinely best moments.

### M7 — Quick-sim parity
The Continue path must reflect the same hockey: the quick sim is re-calibrated from the agent engine's outcome distributions per tactic and attribute, so a team that plays a certain way wins and loses the same way whether you watch or not (closes the audit's Watch-vs-Play gap).

## Revision 2026-09-27 — after the 3D audit

The audit ([3D-MATCH-AUDIT.md](3D-MATCH-AUDIT.md)) found the plan was almost all *engine* work. It adds engine scope and two new tracks. All three tracks run in parallel.

**Track E — the agent engine (M1–M3, one lead).** Status: behind a flag, scorecard 68/24 vs the old engine's 50/42. Already in: momentum physics, puck physics, collision hits, fatigue, positional offside/icing, delayed penalties, 13 infraction types, rounded corners, net obstacle, identity-stable deploy, shot release from the blade, saves on arrival, additive stream fields (puckZ, facing, hit/pass/shot detail). Scope added by the audit, in order:
1. **Bench and line changes:** gate geometry, per-team change timing driven by fatigue and puck state, no change with the puck in your own zone or after icing, too many men.
2. **Faceoffs as a system:** legal alignment, everyone set before the drop, the draw goes back, post-draw plays, faceoff tactics wired.
3. **Pulled goalie and empty net:** pull on possession or at a stoppage, goalie to the bench door, extra attacker from the gate, long-range empty-net attempts.
4. **Shots:** mean distance ~34 ft, D ~30% of shots (misses and posts done).
5. **No crease camping;** 4v4, 5v3 and 6v5 shapes; never drop the puck on unset players.
6. **Switch the default** to the agent engine when the scorecard and calibration gates pass. The old director stays as the quick-sim reference.

**Track V — viewer quick wins (renderer and match screen, now).** Puck render lag; replay score rewind; view switch restarting the game; 2D DPI size; display clock frozen in dead time; outcome-aware commentary and report facts; mode-scaled pregame and replays as a setting; calm, zone-framed broadcast camera; readable puck and carrier; screen-space labels; follow and endzone camera fixes.

**Track P — the match-day product (new; FM's layer around the engine).** Starts once Track E's engine can simulate in chunks:
1. **Segmented live sim:** the watched game simulates period by period (then in shorter chunks), so decisions change the outcome. This is the keystone.
2. **Intermission screen:** period stats, three stars so far, the assistant's read, decisions (lines, tactics, goalie, a message to the room).
3. **In-game levers:** FM-style shouts, timeout, shorten the bench, pull the goalie, tactic changes.
4. **Live info layer:** stats panel, live player ratings, shot map and xG race during play; dead air in condensed modes filled with stats and assistant advice.
5. **Pregame decisions:** team talk, starting goalie, matchup directive. Keys name only real levers.
6. **Postgame in the flow:** FINAL, three stars, box score, shot map, the turning point, player ratings that explain themselves (folds in M6).
7. **Highlight levels:** key / extended / comprehensive / full plus a dynamic mode. Replays are a setting, never a button. Sim view and ice view become one screen with one clock.

**M5 (animation and presentation) now also owns:** the 3D broadcast consumer (`requestShot`/`playMoment`/`projectPlayer`: replay angles, ceremonies, on-ice goal tag), puck height in 3D, the missing action clips (stickhandle, receive, deke, poke, battle, T-push, RVH, freeze, fights, bench), one consistent clip style, crowd and bench art, sound, and LOD. Every animation is checked against the [FILM-STUDY.md](FILM-STUDY.md) targets. **The sim is the source of truth:** the renderer consumes hit force and kind, save type and change timing instead of inventing them.

**Gates added by the audit:**
- Engine: 0 puck or skater teleports; interceptor within stick reach of the lane; blocker in the shot lane; no skaters in the net cage or outside the rounded boards; offside never uncalled; faceoffs set at the drop with the draw going back; line changes never with the puck in the changing team's own zone; attribute correlations r ≥ 0.3 (hitting→hits, takeaway→takeaways, puckControl→giveaways, passing→pass%); hits 90%+ near the boards; infraction mix realistic.
- Readability (new): puck on screen ≥ 99% of broadcast frames; carrier identifiable; label overlap < 5%; skater height in the NHL-TV framing range; camera angular speed p95 < 60°/s with no peaks > 180°/s.
- Match day: no view switch loses state; the scorebug never shows a stale score; the clock is stopped in dead time.

## Gates (every phase)
- Realism scorecard improves vs the previous engine and lands in NHL bands for the phase's metrics.
- Calibration suite stays green (goals, shots, save%, PP%, PK%, shootouts, OT).
- Motion gates (renderer): 0 teleports, yaw twitch ≤ 0.1, bone pops ≤ 0.05 per rig-second, no frame hitches > 50 ms in steady play.
- Performance: a watched game streams in real time; a full-fidelity game simulates in a few seconds; quick sim unaffected.
- Determinism: same seed, same game.
- Eye test: the owner watches a clip reel each phase.

## Staffing
M1 → M2 → M3 are tightly coupled and run as **one lead engine track** (parallel agents would fight over the same code). M0 (scorecard) can run alongside. The 3D motion/animation track runs in parallel on the renderer side, consuming the new actions as they land. Sound can start any time.

## Decisions for the owner
- Build the agent engine alongside the old one behind a flag, switching when it wins — **recommended** over rewriting in place.
- The event-stream contract (`src/domain/events.ts`) is frozen; richer actions (pass speed, hit force, board battles) need **additive** event fields or new event types. Recommended: allow additive-only changes.
