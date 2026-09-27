# 3D Match Audit — master issue list (2026-09-27)

*Owner ask: "there's a ton of issues with the 3D sim gameplay … a proper audit of all the issues so that we can make a plan for making it football manager 3D sim quality."*

Four independent passes, each measured, not eyeballed:

| Pass | What it covered | Full report |
|---|---|---|
| Play logic | Does the engine play hockey? 30 full games on the real-roster league, 434k frames, probe script | [3d-audit-2026-09/play-logic.md](3d-audit-2026-09/play-logic.md) |
| Visuals & motion | Does the 3D view read? Motion probe, puck/contact sync, cameras, labels, performance | [3d-audit-2026-09/visuals-motion.md](3d-audit-2026-09/visuals-motion.md) |
| Match experience | Is it an FM match day? Two real games in the built app on a copy of the owner's save | [3d-audit-2026-09/match-experience.md](3d-audit-2026-09/match-experience.md) |
| Film study | What real NHL looks like: 10 official highlight videos, streamed muted, eye-measured targets | [FILM-STUDY.md](FILM-STUDY.md) |

## The one-paragraph diagnosis

The current watched-game engine **rolls every outcome on dice first and then bends the bodies and puck to fit**. Interceptors are up to 22 ft from the passing lane, 44% of shot-blockers aren't in the lane, goals are decided at release, and the puck teleports 35+ ft about 20 times a game. Hits are dice at walking pace (5 mph), with no contact and no link to the hitting rating (r = −0.06). Line changes run on a 40-second clock for both benches at once, and faceoffs drop on players who aren't set. The 3D renderer then adds its own lies on top: the drawn puck trails the real one by up to 27 ft, so saves fire before the puck arrives; the puck never leaves the ice; and labels overlap in 77% of frames. Around it, the match day has no FM layer: the game is fully simulated before you watch (no levers), with no intermission, no postgame, no live stats and no ratings.

## What is already fixed or in flight

| Area | Status |
|---|---|
| Jiggle (spline sawtooth), backwards sticks, bone pops, line-change hitches | **Fixed** (dc4f53a, 5fd7dd8) |
| New **agent engine** (behind a flag): momentum skating, puck physics, thinking agents, collision hits, fatigue, positional offside/icing, 13 real infraction types, rounded corners, net as an obstacle, identity-stable deploy (no teleports), shot release from the blade, saves resolved on arrival, additive stream fields (puckZ, facing, hit force/kind, pass speed/kind, shot type, missedShot, battles) | **In progress** on `play-realism`. Scorecard **68 pass / 24 fail**, vs the current engine's 50 / 42 |
| Renderer + match-screen quick wins (items marked **V** below) | **In progress** on `viewer-fixes` |
| Stick grip / hands / blade | **In progress** on `stick-grip` |

## Master issue list (ranked by impact on "FM-quality")

Owner: **E** = agent engine, **V** = viewer quick-win agent, **G** = stick/rig agent, **P** = match-day product (not yet started), **A** = animation/assets (M5).

| # | Issue | Evidence | Owner / status |
|---|---|---|---|
| 1 | Outcomes rolled first, world bent to fit (passes, blocks, giveaways, goals) | play §A | E: agent engine replaces dice with physics |
| 2 | Watched game pre-simulated, so the GM has no levers (shouts, lines, timeout, goalie pull) | UX F-1/F-2 | P: **segmented live sim** (M4) — keystone of the FM feel |
| 3 | Hits cosmetic: 5 mph, 21% near the boards (NHL 94%), no penalties or injuries, uncorrelated with ratings | play §B, visual B3 | E: collision hits (done in engine); M3 tuning |
| 4 | Drawn puck lags up to 27 ft; saves fire with the puck 13 ft away; shots have no visible release | visual C2/B1/B2 | V (C2 lag) + E (release/save timing, done) |
| 5 | Line changes on a 40 s clock, both benches together, teleports, 3D disagrees with the sim | play §C | E: deploy done; bench gate and change rules next |
| 6 | Faceoffs: unset players, 5.5 skaters in the circle, the centre skates off with the puck | play §D, film #13 | E: next after the bench |
| 7 | Scripted flow: 133 entries/60 (target 35–80), 8.6 odd-man rushes a game, 40–51% backward passes in the rush and neutral zone | play §O | E |
| 8 | Stars don't play differently (hits, takeaways, pass% uncorrelated with ratings) | play §M | E: attributes wired; correlation gate (r ≥ 0.3) to add |
| 9 | No intermission, postgame, live stats panel or player ratings in the match flow | UX F-3/F-5/F-6/F-7 | P |
| 10 | 3D broadcast camera too far, action at the frame edge; puck and carrier unreadable | UX F-16/F-17, visual D3 | V |
| 11 | Viewer state bugs: a replay rewinds the score; switching 2D/3D restarts the game; 2D rink at 1/1.5 size on the owner's 150% display; the clock runs through stoppages | UX F-11/F-12/F-20/F-22 | V |
| 12 | Name labels world-sized, overlapping 77% of frames, unreadable | visual E1, UX F-18/F-21 | V |
| 13 | Puck never leaves the ice | visual C1 | E (puckZ emitted) → renderer consumes it |
| 14 | Net and corners not physical (80 s/game inside the cage), crease piles | play §F | E: done in engine; crease camping next |
| 15 | Shots: never miss, 18 ft mean (NHL 34), D only 10% of shots | play §E | E: misses done; distance and D share open |
| 16 | Pulled goalie at a fixed time, teleports to the corner; extra attacker spawns mid-ice | play §K | E: next |
| 17 | Goalie is a written position (±2.55 ft cap), no post seal, never plays the puck | play §J, film #7–9 | E (goalie AI) + A (T-push, RVH, freeze clips) |
| 18 | Follow camera whips (peak 3,856°/s); endzone camera flies 220 ft on a side swap | visual D1/D2 | V |
| 19 | No 3D broadcast consumer: replay angles, ceremonies, on-ice goal tag (`requestShot`/`playMoment`/`projectPlayer` missing) | UX F-13, visual D4 | P/A (M5) |
| 20 | Key Moments isn't ~60 s (full open + forced replays); "Watch replay" is a click-for-event button | UX F-9/F-14 | V |
| 21 | Commentary says "drifts wide" and then "GOAL"; clock strings like "0:9.5"; wrong GWG in the match report | UX F-27/F-28/F-30 | V |
| 22 | Missing actions: stickhandle, receive, deke, poke, board battle, T-push, freeze, fights, bench; owner and Blender clip styles mixed | visual B4/B5 | A (M5), consuming engine actions |
| 23 | Faces tinted in team colour (gear shader recolours skin) | visual A1 | G |
| 24 | Carried puck off the blade 32% of the time | visual C3 | V/G |
| 25 | Tactics invisible (27–40 ft shape error); 13 dead tactic fields | play §N | E (M4 systems) |
| 26 | Pregame has no decisions (team talk, starting goalie, matchup) | UX F-4 | P |
| 27 | Dead air between highlights; no comprehensive or dynamic highlight mode | UX F-8/F-10 | P |
| 28 | Body interpenetration 22% of frames | visual A3 | E (M1 bodies, done) |
| 29 | Crowd blocky, bench Lego, no audio; crowd reacts only to goals | visual F1–F3 | A (M5 sound + art) |
| 30 | Perf: 1.62M triangles, no LOD; laptop regression under 4× throttle | visual G1 | A |

## Film-study targets the 3D must hit (eye-check list)

Camera frames one zone (70–100 ft) from a high side angle, 20–30° down, with a smooth pan · stride lean 35–45°, knees 100–110°, ~3–3.5 pushes/s · two hands carrying, one hand skating hard or defending at reach · carry blade 2.5–3 ft ahead, tucked to ~1 ft under pressure · D skating backwards sits lower, stick out one-handed · goalie at the top of the crease, butterfly on the release (not on proximity), RVH seal below the goal line · hits set up over 1.5–2 s, landing 0.3–0.5 s after the puck leaves · wrist-shot follow-through low, slapshots and one-timers high · faceoff: wingers ~15 ft wide, D ~30 ft back · visible 1-3-1 PP vs box PK, D-zone collapse · stoppages take time; after a goal: wide shot, then celebration, crowd, replays.

## Revised plan

[MATCH-ENGINE-PLAN.md](MATCH-ENGINE-PLAN.md) is updated with three tracks that run in parallel, plus the gates this audit adds.
