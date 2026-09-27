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
