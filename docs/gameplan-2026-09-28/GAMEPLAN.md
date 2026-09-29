# Game plan — getting past "60%" (2026-09-28)

**Status: ON HOLD** for usage (the owner has ~33% of weekly usage left, reserved for work). Resume from this file.

Sources:
- [ROOT-CAUSES.md](ROOT-CAUSES.md): the process audit, complete.
- The owner's 13 watched-game issues below.
- [3D-MATCH-AUDIT.md](../3D-MATCH-AUDIT.md), [MATCH-ENGINE-PROGRESS.md](../MATCH-ENGINE-PROGRESS.md), [depth-audit-2026-09](../depth-audit-2026-09/).

The symptom auditors A–D (match) and the five whole-game re-auditors were **stopped before reporting**, to save usage. Re-run them at W0 (below), one or two at a time, not all at once.

## Why we plateau (short version of ROOT-CAUSES)

1. **We verified the stream and a dev harness, not the match screen the owner watches.**
   - Full mode plays live hockey at **2×**; our motion checks ran at 1× and fail by about 80× at 2×.
   - The metrics passed while the owner's eye failed.
2. **The renderer invents behaviour** (bench, line changes, shot timing, replay clocks, speed changes). Every seam between the sim and the picture is a place for jank.
3. **Breadth outran integration.** About 190 commits in 3 days, about 10 branches on the watched game at once; the same bugs were re-fixed across layers (puck-on-blade 9×, line changes 8×).
4. **Tuning stood in for design.** Global scalars were re-fit after every behaviour change; the engine has no team-level play plans.
5. **No owner-signed bar,** and no owner clip review ever happened, although the plan called for one.

## The owner's watched-game issues → where they're fixed

| # | Owner's issue | Likely root cause (to confirm in W0) | Milestone |
|---|---|---|---|
| 1 | Shots and goals are instant; you never see the shot | Wind-up is one 0.25 s frame for every shot type (`agentSim.ts` `VAL_WINDUP`); Full mode plays at 2× | W2: wind-up as a real sim state, 1× live play |
| 2 | Camera misses things, replays end early, players stand around | Replay seeks −8 s but plays 4.8 s of game time; a 4.5 s wall timer cuts the goal sequence; multiple clocks | W2 (one clock) + W4 (replay package) |
| 3 | Doesn't play like real hockey | Agents react every 0.25 s with no team play plans | W3: designed team plays |
| 4 | Too many men on changes | Likely the 18 idle bench rigs visible past the far boards, plus renderer change choreography | W2: the renderer reads the engine's bench model; the invented rigs are deleted |
| 5 | Skating through the puck; aimless players not looking at the puck | Low-urgency support, pickup rules, facing | W3 |
| 6 | Breakaway skated into the corner | Carry-target geometry in close; breakaway decision | W3 |
| 7 | Commentary bad: 3 voices, highlight-only, repetitive, white noise | Old voice paths still live; stems only on events; a procedural crowd noise bed (suspect `sfx.ts`) | W4/W5: one voice (the owner picked Voice 1), a continuous-call grammar, an audio mix pass |
| 8 | Speed changes to slow-mo on highlights | `playbackDirector` changes speed on its own | W2: speed never changes without user input |
| 9 | Pass ping-pong | No progress requirement on passes | W3 |
| 10 | "Brainless toddler hockey"; must look like NHL players | All of the above | W3 exit bar |
| 11 | Switch full / highlights / condensed any time (FM) | Mode chosen once at the start | W6: live mode switch |
| 12 | Morphing through boards on changes, ref glitching, sticks through the ice, unnatural skating | Renderer choreography and IK, the ceiling of code-only animation | W2 (delete inventions) + W5 (animation data decision) |
| 13 | Bench stares lifelessly; crowd are primitive shapes | No bench or crowd animation content | W5 |

## Milestones (each ends with the owner scoring a clip reel 1–5; exit at ≥ 4 on every clip)

| Milestone | What | Owner-visible exit |
|---|---|---|
| **W0 Baseline** | 1. Confirm the 3 cheap facts: does the replay end before the goal? Are the extra men bench rigs? Which engine is in Settings? 2. Record reel v0 (10 pinned scenarios). 3. The owner scores it. 4. Write a watched-game bar into EXCELLENCE.md. 5. Re-run the stopped audits, one at a time. | Reel v0 scored; the top complaints ranked |
| **W1 Truth pipeline** | A real-app runner (HOCKEY_USER_DATA plus a save copy) measures what's drawn, at the owner's settings. Viewer-truth detectors VT1–VT10. A one-command reel. | The known bugs show up red |
| **W2 One source of truth** | Agent engine is the default; the shot wind-up is a sim state; one playback clock (1× live, speed only in dead time); the renderer consumes bench, change and shot facts; the renderer inventions are deleted | Breakaway and line-change clips ≥ 4 |
| **W3 Vertical slice** | One 5v5 period made excellent: designed breakouts, rush lanes, forecheck roles, D-zone coverage | A 20-minute period the owner "would show a friend" |
| **W4 Stoppages and special teams** | PP/PK, penalties, a goal plus a replay that shows the goal, empty net, commentary truth | Those clips ≥ 4 |
| **W5 Content** (parallel) | Animation data decision (mocap about $3–8k vs code), crowd and bench life, audio mix, booth lines | The owner prefers the new content on every clip |
| **W6 Match-day product** | Segmented live sim, intermission decisions, shouts, live watch-mode switching | One intermission decision visibly changes the 3rd period |
| **W7 Parity and hardening** | Quick sim matched to the agent engine, performance, a 5–10 person fan playtest | Playtest average ≥ 4 |

## Standing rules

- **One owner for the watched game.** At most one other branch touches watched-game code at a time. No more swarms.
- **Every merge carries** a viewer-truth detector plus a reel clip.
- **Any change to a calibration scalar** must state which behaviour it compensates.
- **Progress means the owner's reel scores,** not internal metrics.
- **Usage-aware:** heavy work, meaning multi-agent audits, overnight renders and the lever audit, only runs when the owner okays usage.

## Parked, needing the owner's go

- **Commentary booth:** the single-voice rebuild was stopped mid-way. Resume the `booth` worktree; its last state is uncommitted.
- **Name-bank render:** overnight GPU, current NHL rosters about 4 h.
- **Lever-audit re-measure:** multi-hour CPU.
- **New engine as the default:** after the owner's eye test.
- **Whole-game re-audit:** 5 areas: loop, squad and world, people and story, managing, UI and first hour.
