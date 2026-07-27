# HOCKEY GAME
## Claude Code Project Context

A single-player hockey management simulation in the spirit of **Football Manager** and **Eastside Hockey Manager (EHM)** — built to eventually surpass EHM and ship on Steam. There is currently no active hockey GM game on the market (Franchise Hockey Manager discontinued ~2021, EHM abandoned), so this targets a genuinely underserved niche.

**Start here:** read `docs/ARCHITECTURE.md` (full system design) and `docs/DATA-SOURCES.md` (hockey data plan) before doing anything. They contain the agreed design and decisions.

---

## CORE ARCHITECTURE PRINCIPLES (do not violate)

1. **Sim engine is fully decoupled from visuals.** The engine emits a positional **event stream**; 2D and 3D are just renderers reading the same stream. (This is how FM works — visuals "sit on top of what the players already do.") The event-stream contract is the keystone — get it right, never rewrite it.
2. **Two fidelity modes** (EHM's model): a full per-tick engine for watched games, a fast quick-sim for the rest of the league world. Both share the attribute model and emit the same event-stream type at different resolution.
3. **Clean-room — no ZenGM code.** ZenGM's license forbids commercial/competing use. We studied its hockey engine for design (ratings, weighted selection, fatigue patterns) but write everything ourselves. ZenGM legacy repo is Apache 2.0 if any old code helps.
4. **Calibrated against real NHL data**, not tuned by feel. Build a calibration harness early.
5. **Moddable, fictional-by-default DB.** Cannot ship real NHL names/logos (NHL/NHLPA own them). Ship fictional/editable DB; community supplies real rosters as separate downloads (EHM's legal model).

---

## TECH STACK

Electron + TypeScript + React (matches existing skill). Sim runs in a Web Worker. Storage SQLite (better-sqlite3). 2D renderer = PixiJS (ships first). 3D renderer = three.js + glTF models authored in Blender (later, OOTP-quality bar — readable not flashy). One stack, two renderers, no engine rewrite to add 3D.

---

## BUILD ORDER (each gates the next)

1. `domain/` + `GameEvent` event-stream contract — the keystone.
2. `engine/quick` + league generation → sim a season, produce standings.
3. `engine/full` → dense positional stream for one watched game.
4. `render2d/` (PixiJS) → watch a game. **This proves it's fun.**
5. `calibrate/` → make the numbers match real NHL.
6. UI depth: tactics, trades, draft, contracts, development/aging, multi-season, save/load.
7. `render3d/` (three.js + Blender) → the Steam differentiator.

Timeline estimate (focused sessions): watchable v1 prototype ~1–2 weeks; deep game that beats EHM ~6–8 weeks; 3D after that (gated on Blender assets).

---

## STATUS

Playable v1 (June 2026). Build order #1–#7 all have first implementations:
- Engines: calibrated full-fidelity tick engine (real 5v4 PP, 3v3 OT, goalie pulls, playoff multi-OT) + quick-sim; shared GameEvent stream.
- Career: full year cycle — regular season → best-of-7 playoffs → offseason (awards, development/aging, retirements, 2-round entry draft, re-signing, free agency) → season rollover. Injuries/fatigue/morale/form, salary cap, AI trades with pick assets.
- UI: FM-style dark shell (sidebar + topbar + continue), 31 screens across the FM nav sections — overview (dashboard, staff meeting, inbox), team (squad, squad planner, dynamics, tactics), development (data hub, staff, training, medical, dev centre), competition (schedule/match centre, competitions, world, scouting, transfers) and club (info, vision/board, finances). Sidebar layout lives in `src/renderer/components/navConfig.ts`. Worker protocol v2 in `src/worker/protocol.ts`.
- Renderers: 2D PixiJS and 3D three.js (procedural rink/players, broadcast cameras, event cues) behind one `MatchRenderer` contract; toggle in MatchViewer.
- Save/load: JSON snapshots via Electron IPC (`src/main/saves.ts`, versioned `CareerSnapshot`). SQLite dropped in favor of JSON saves (supply-chain: no native postinstall deps).
- 1511 vitest tests. `npm run typecheck && npm test` must stay green. Frozen contracts: `src/domain/events.ts`, `src/engine/career/views.ts`, `src/worker/protocol.ts`, `src/render2d/rendererContract.ts`.

Known tuning debt, most important first:
1. **Competitive balance is badly out of calibration.** A simmed season leaves the best team around 54-4 with a +250 goal differential and the worst around 10-49 (measured across seeds 2026/7/99, 16 teams, 60 games). The NHL's best-ever team is +107 over 82 games. League-average goals/game is on target — it is the *spread* that is roughly 3× too wide, because `quickSim`'s rate model multiplies offense/LEAGUE_AVG by LEAGUE_AVG/defense and then compounds that with the finishing and goalie terms. This distorts standings, playoff races, awards and every counting stat.
2. Generated payrolls can exceed the cap (displayed honestly).
3. PK stat splits are placeholders (`pk: { goals: 0, ... }` in archived season stats); AHL squad rows carry games played but no stat line.
4. 3D uses procedural primitives pending Blender glTF assets.

Plus/minus is real as of July 2026 — see `creditPlusMinus` in `src/engine/shared/outcome.ts` (NHL rules: no credit on power-play goals, skaters only, shootout excluded), credited by both engines and merged into season totals.
