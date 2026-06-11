# Hockey Manager

A single-player hockey management simulation in the spirit of **Football Manager** and **Eastside Hockey Manager** — a deep GM/front-office career game with a calibrated, watchable match engine. Built with Electron + TypeScript + React.

> **Fictional by default.** Ships with generated teams and players. Real-world rosters/logos are not included (they're licensed marks); the database is fully moddable so the community can supply their own — see [`MODDING.md`](MODDING.md).

## What's in it

- **Two match engines sharing one event stream.** A full-fidelity, possession-phase tick engine (breakouts, zone entries, cycles, odd-man rushes, real 5-on-4 power plays, 3-on-3 OT, goalie pulls, offsides/icing) plus a fast quick-sim for the rest of the league. Both calibrated against real NHL play-by-play rhythm and rate data.
- **2D (PixiJS) and 3D (three.js) renderers** reading the same stream, with condensed "broadcast" playback (full game in ~10 minutes, extended highlights, or key moments), procedural sound effects, commentary, and goal replays.
- **A full career loop:** regular season → best-of-7 playoffs → offseason (awards, development/aging, retirements, draft lottery + combine, re-signing, free agency) → season rollover, indefinitely.
- **Story layer (the heart of it):** emergent storylines (hot streaks, busts, feuds, cinderella runs), all-time records + Hall of Fame, media preseason expectations vs. reality, locker-room chemistry & hierarchy, trade-deadline drama, and an optional **AI press corps** (bring your own Anthropic API key) that writes columns and runs press conferences about your team.
- **FM-style depth:** tactics & line editor, scouting with fog-of-war, salary cap, AI trades with pick assets, save/load.

## Tech

Electron · TypeScript (strict) · React · Web Worker sim · PixiJS · three.js · Vite/electron-vite · Vitest. JSON save files; no native dependencies.

## Develop

```bash
npm install
npm run dev        # launch the Electron app with HMR
npm run typecheck  # tsc --noEmit
npm test           # vitest (700+ tests)
```

Architecture and design decisions live in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and [`docs/DATA-SOURCES.md`](docs/DATA-SOURCES.md). Contributors: read those first — the `GameEvent` stream contract (`src/domain/events.ts`) is the keystone and is kept stable.

## Status

Playable. ~728 tests green. Active areas: 3D visual fidelity (procedural primitives pending authored models), engine tuning, and an EHM-style UI restructure.

---

*Clean-room project: no code copied from ZenGM or other engines; reference games were studied for design only.*
