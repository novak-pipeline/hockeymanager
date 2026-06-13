# League Pipeline & Farm System

The agreed design for multi-tier leagues. Phase 1 (this doc's focus) is the
**farm system**: an AHL affiliate per NHL club. Phases 2+ (juniors, one
Europe/KHL) reuse the same machinery and are deferred.

## Core principle: an affiliate is just another `Team`

The expensive-looking option is splitting `Team.roster` into `nhlRoster` /
`ahlRoster` (ripples to 50+ callsites). We do **not** do that. Instead:

- Each AHL affiliate is a full `Team` object stored in the same
  `LeagueData.teams` map as NHL teams. Every per-team system (lineup repair,
  quick-sim, box score, standings row, finances) works on it unchanged.
- A **call-up/send-down** moves a `PlayerId` from one team's `roster` to the
  affiliate's `roster` and calls `repairLines` on both. No new roster model.

This keeps the change additive instead of invasive.

## Data model (all additive / optional)

`Team` (domain/team.ts):
- `tier?: 'nhl' | 'ahl'` — absent = `'nhl'` (back-compat).
- `parentTeamId?: TeamId` — set on AHL teams, points to the NHL parent.
- `affiliateId?: TeamId` — set on NHL teams, points to the AHL affiliate.

`League` (domain/league.ts):
- `ahlTeams?: TeamId[]` — affiliate ids (parallel to `teams`).
- `ahlSchedule?: ScheduledGame[]` — affiliate games.
- `ahlStandings?: Standing[]` — affiliate standings.

Because these live inside `leagueData.league` and the AHL `Team`s live inside
`leagueData.teams`, they serialize with the existing `serializeLeagueData` and
old saves (which lack them) load fine — `validateSnapshot` only checks the v1
required core. AHL teams that aren't in `league.teams` never appear in NHL
standings/schedule/draft, so existing loops are untouched.

## Simulation

- `advanceDay` also sims that day's `ahlSchedule` games via `quickSimGame`,
  applying results to `ahlStandings` and player stats, but **lightweight**: no
  rivalry/news/special-teams/morale side-effects (those stay NHL-only).
- AHL game seeds derive from a **separate** namespace so adding the farm tier
  does not perturb the NHL RNG stream — calibration and existing sim tests stay
  green.
- AHL games are never watched in v1 (quick-sim only, no box score / 3D).

## Roster movement

- `callUp(playerId)` / `sendDown(playerId)`: validate the source team keeps
  legal minimums (≥12 F, ≥6 D, ≥2 G implied by lineup repair), move the id,
  repair both lineups, log a transaction + news for the user's org.
- Two-way contracts: AHL assignment does not change the NHL cap hit for v1
  (waivers and one-way/two-way cap nuances are deferred).
- AI orgs auto-assign at season start and after injuries: keep the best ~23 by
  overall on the NHL roster, the rest on the affiliate.

## Development (makes the decision matter)

Offseason `developPlayers` already scales growth by `gamesPlayed`. Extend it so
a young player's growth toward potential is driven by **ice time across both
tiers**: a 19-year-old playing big AHL minutes develops well; the same player
scratched/buried in the NHL stagnates. This is the core farm-system payoff.

## Roster source

- **Fictional generator** (ships clean): generate one affiliate per NHL team
  with lower-overall depth players + the org's youngest prospects.
- **EHM importer** (dev only, gitignored): extend `scripts/dev/import_ehm.py`
  with an AHL-club → NHL-parent map, pulling each affiliate's real roster from
  the export; backfill from NHL-club overflow where an affiliate is thin.

## Deferred (Phase 2+)

Juniors (CHL) and one Europe/KHL as **feeder** leagues with a rights/reserve
list (drafted juniors keep playing in their league until signed); draft pulls
from juniors; sign imports. Same multi-league plumbing as above; also the
foundation the parked pro/rel "World Mode" would reuse.
