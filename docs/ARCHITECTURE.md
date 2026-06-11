# Hockey Manager — Architecture

A single-player hockey management sim in the spirit of **Football Manager** and **Eastside Hockey Manager (EHM)**, built clean-room (no ZenGM code — that license forbids commercial/competing use; we study it only).

Core philosophy, confirmed by both reference games:

- **The sim engine is fully decoupled from the visuals.** The engine decides what happens and emits an event stream. 2D and 3D are just two renderers reading the *same* stream. (This is exactly how FM works — "the 3D just sits on top of what the players already do.")
- **Two fidelity modes.** A detailed per-tick engine for games you watch, and a fast abstract engine for the rest of the hockey world. (This is exactly how EHM works — full 2D engine for human leagues, quick-sim for background leagues.)
- **Calibrated against real NHL data**, not tuned by vibes.

---

## 1. Tech Stack

Stay in the web/Electron stack — it matches existing skill (the ks-terminal app) and lets one codebase serve both 2D and 3D.

| Layer | Choice | Why |
|-------|--------|-----|
| Shell | **Electron** | Desktop app, Steam-friendly, same as ks-terminal |
| Language | **TypeScript** | Type safety across a big domain model; same as ZenGM |
| UI | **React** | Menus, rosters, tables, tactics screens |
| Sim runtime | **Web Worker** | Sim runs off the UI thread (ZenGM does this — keeps UI responsive during season sims) |
| Storage | **SQLite** (better-sqlite3) or IndexedDB | Saves, league DB. SQLite preferred for Steam (file-based saves, moddable) |
| 2D renderer | **PixiJS** (canvas/WebGL) | Fast 2D rink view — ships first |
| 3D renderer | **three.js** + **glTF** models from Blender | Same stack, later. Blender exports glTF; three.js loads it |
| State | Zustand or Redux | UI ↔ worker message bus |

One stack, two renderers. No engine rewrite to go from 2D to 3D.

---

## 2. Data Model

```
League
 ├─ Conferences / Divisions
 ├─ Teams[]
 │   ├─ Roster: Player[] (signed)
 │   ├─ Lines: 4 forward lines, 3 D pairs, 2 goalies, special teams units
 │   ├─ Tactics (see §5)
 │   ├─ Finances (budget, cap, revenue)
 │   └─ Staff (coaches, scouts — affect dev & sim)
 ├─ Players[] (all, incl. free agents, prospects)
 ├─ Schedule: Game[]
 ├─ DraftClass[] per year
 └─ Season state (standings, stats, awards, news)
```

### Player
```ts
interface Player {
  id: string
  name: string
  age: number
  position: 'C' | 'W' | 'D' | 'G'
  handedness: 'L' | 'R'
  ratings: Ratings          // see §3 — current ability
  potential: Ratings        // ceiling, drives development
  personality: Personality  // affects dev, morale, locker room (FM-style)
  contract: Contract
  stats: SeasonStats[]       // per season, per situation (ev/pp/pk)
  fatigue: number            // 0-100, intra-game and season-long
  morale: number
  injuryStatus: Injury | null
  form: number               // hot/cold streak modifier (drama!)
}
```

---

## 3. Attribute Model (FM-depth, hockey-specific)

ZenGM's hockey ratings are a proven starting set — we expand toward FM depth. Two layers:

### Raw attributes (0–100, what scouts see)
Grouped FM-style:

**Technical**
- `wristShot`, `slapShot`, `stickhandling`, `passing`, `deflections`, `faceoffs`

**Physical**
- `speed`, `acceleration`, `strength`, `balance`, `stamina`, `agility`, `height`

**Mental**
- `offensiveIQ`, `defensiveIQ`, `positioning`, `vision`, `aggression`, `composure`, `workRate`, `discipline`, `anticipation`

**Defensive**
- `checking`, `shotBlocking`, `stickChecking`, `takeaway`

**Goalie (only for G)**
- `reflexes`, `positioning_g`, `reboundControl`, `glove`, `blocker`, `recovery`, `puckHandling_g`

> ZenGM's compact set (`hgt, stre, spd, endu, pss, wst, sst, stk, oiq, chk, blk, fcf, diq, glk`) maps directly into this — we're just splitting some for FM-level granularity.

### Composite ratings (derived, what the sim engine reads)
Computed from raw attributes + role. The engine never reads raw attributes directly — it reads composites (ZenGM pattern):

`scoring`, `playmaking`, `puckControl`, `faceoffWin`, `hitting`, `blocking`, `takeaway`, `penaltyProne`, `goaltending`, `skating`, `defensiveZone`

This indirection lets us re-tune the raw→composite formulas during calibration without touching the sim loop.

---

## 4. The Event Stream (the keystone)

**Everything reads from this.** Both engines emit it; both renderers and the box-score/calibrator consume it. Get this contract right on day one — it's the one thing that must not need a rewrite.

```ts
type GameEvent =
  | { t: number; type: 'faceoff'; zone: Zone; winner: PlayerRef; pos: XY }
  | { t: number; type: 'carry'; player: PlayerRef; from: XY; to: XY }
  | { t: number; type: 'pass'; from: PlayerRef; to: PlayerRef; a: XY; b: XY; completed: boolean }
  | { t: number; type: 'shot'; shooter: PlayerRef; from: XY; target: XY; danger: number }
  | { t: number; type: 'save'; goalie: PlayerRef; rebound: boolean; pos: XY }
  | { t: number; type: 'goal'; scorer: PlayerRef; assists: PlayerRef[]; strength: 'ev'|'pp'|'sh'|'en'; pos: XY }
  | { t: number; type: 'hit'; by: PlayerRef; on: PlayerRef; pos: XY }
  | { t: number; type: 'penalty'; player: PlayerRef; infraction: string; minutes: number }
  | { t: number; type: 'lineChange'; team: TeamRef; onIce: PlayerRef[] }
  | { t: number; type: 'whistle' | 'periodEnd' | 'gameEnd'; pos?: XY }

// t = game-clock seconds. XY = rink coordinates (0,0 center; normalized rink).
// danger/0..1 = shot quality, used for both sim outcome AND renderer drama cues.
```

- **Full-fidelity engine** emits the dense stream (positions on every event → animatable).
- **Quick-sim engine** emits a *sparse* version of the same stream (shots/goals/penalties only, no carry/pass positions) — same type, less detail. Background games still produce real box scores; they just aren't watchable frame-by-frame.

Renderers never compute outcomes. They interpolate positions between events and play canned animations on event types. That's the FM rule, enforced by the type system.

---

## 5. Tactics System (FM/EHM-style)

Configurable per team, per line, per player (EHM allows all three levels).

- **System**: forecheck (1-2-2, 2-1-2, aggressive trap), neutral-zone, D-zone coverage (man/zone)
- **Tempo / risk**: pace, pass risk, shot eagerness, pinch frequency for D
- **Special teams**: PP formation (umbrella, 1-3-1, overload), PK (box, diamond, aggressive)
- **Matchups**: line-matching, last-change logic at home
- **Player roles**: e.g. Sniper, Playmaker, Two-Way, Power Forward, Enforcer, Offensive D, Shutdown D, Stay-at-home — each role weights which composites the sim emphasizes and how the player behaves positionally

Tactics feed the sim by **modulating event probabilities** (e.g. aggressive forecheck → more takeaways + more odd-man rushes against) and **positioning** (where players are on the ice between events).

---

## 6. Simulation Engine

### Full-fidelity loop (watched games) — EHM's ¼-second model
```
run()
  for each period:
    faceoff()
    while clock > 0:
      tick()                       // advance ~0.25s game-time
        updatePositions()          // move skaters per tactics/roles
        checkShiftChange()         // line changes on fatigue/time
        resolveContest()           // possession battles, hits, takeaways
        maybeShot() -> doShot()    // danger from position + shooter + defense
          -> save / goal / block / miss / rebound
        checkPenalty()
        emit GameEvent(s)
    periodEnd()
  if tied: simOvertime() -> doShootout()
```

Outcome resolution = probabilistic, weighted by composite ratings × tactics × fatigue × situation (strength state). Pattern lifted conceptually from ZenGM (`pickPlayer()` weighted selection, fatigue-adjusted miss probability) but reimplemented and tuned to real data.

### Quick-sim loop (background games) — EHM's abstract model
Simulates in long slices by *which unit is on the ice*. For each shift: roll expected shots/chances from the line's aggregate composites vs opposing line + goalie, resolve goals, accumulate stats. ~100–1000× faster. Produces a valid box score + sparse event stream so standings/stats/leaders across the whole league world stay realistic.

**Both engines share** the attribute model, the strength-state logic, and the event-stream output type. The difference is only resolution.

### Drama (data-driven, from §earlier discussion)
- `form` and goalie hot/cold modeled as per-game variance pulled from real NHL distributions (a goalie's save% *variance*, not just mean).
- Momentum = short-lived scoring-rate multiplier after goals/big hits, calibrated to real "score-effects" data.
- Comeback frequency calibrated to real 3rd-period comeback rates.
- Player **agency**: tactics, goalie pulls, line-matching, timeouts feed these modifiers so drama feels *earned*, not RNG. (This last linkage is the part tuned by playing.)

---

## 7. Calibration Harness

A dev tool (build once, ~1 day):
1. Scrape/import real NHL season aggregates + play-by-play (public data).
2. Sim N full seasons with the current engine.
3. Compare output distributions to real targets: goals/game, shots/game, sh%, sv%, PP%, PK%, scoring spread, comeback rate, etc.
4. Auto-adjust raw→composite and probability coefficients (grid search / gradient-free optimizer) until output matches reality within tolerance.

Turns "weeks of feel-tuning" into "run the calibrator overnight." Run it whenever the engine changes.

---

## 8. Renderers

### 2D (PixiJS) — ships first
Top-down rink. Reads event stream, interpolates skater positions between events, plays simple sprite states (skating, shooting, save, hit, celebrate). Already beats EHM's crude 2D because positions come from the full-fidelity engine.

### 3D (three.js + Blender) — the upgrade
- Blender: rink model, simple rigged players, ~6–8 animation clips (skate, turn, shoot, pass, save, hit, fall, idle). Exported as glTF.
- three.js: loads glTF, drives the same position interpolation + clip triggering off the **same event stream**. OOTP-quality bar — readable, not flashy.
- Because it reads the identical stream, switching 2D↔3D is a view toggle, not an engine change. (FM proves this works.)

---

## 9. Module / Build Order

```
src/
 ├─ domain/        # types: Player, Team, League, Ratings, Tactics, GameEvent
 ├─ data/          # save/load (SQLite), league generation, NHL data import
 ├─ engine/
 │   ├─ ratings/   # raw -> composite
 │   ├─ full/      # full-fidelity tick engine
 │   ├─ quick/     # quick-sim engine
 │   └─ shared/    # strength state, fatigue, drama modifiers
 ├─ calibrate/     # harness (dev tool)
 ├─ render2d/      # PixiJS rink
 ├─ render3d/      # three.js (later)
 ├─ ui/            # React: dashboard, roster, tactics, schedule, draft, finances
 └─ worker/        # sim worker + UI message bus
```

**Build sequence (each gates the next):**
1. `domain` + `GameEvent` contract — the keystone.
2. `engine/quick` + league gen → can sim a season, produce standings. *(Proves the world works.)*
3. `engine/full` → emits dense stream for one game.
4. `render2d` → watch that game. *(Proves it's fun.)*
5. `calibrate` → make the numbers real.
6. UI depth: tactics, trades, draft, contracts, dev/aging, multi-season, save/load.
7. `render3d` → the Steam differentiator.

---

## 10. What we deliberately defer
- 3D (until 2D proves fun)
- Deep historical databases / real player licensing (legal) — ship with fictional or user-editable DB
- Online/multiplayer
- Mod tooling (design the DB to be moddable, but build tools later)
