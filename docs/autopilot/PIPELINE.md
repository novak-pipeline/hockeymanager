# Autopilot → Agents pipeline

How the autonomous playtester's findings flow to the agents that fix and improve
the game. The autopilot itself is a **read-only playtester** — it never edits the
codebase. Everything downstream is a separate, reviewable step.

## The artifacts (the interchange format)

Every campaign writes to `docs/autopilot/`:

| File | What it is | Consumed by |
|---|---|---|
| `trace-latest.json` | The full machine-readable trace: `decisions[]` (with drivers), `issues[]` (severity/category/repro), `seasons[]` (results + `newsSample`), `featureNotes[]`, `viewSamples{}` | the reporter + the dispatcher |
| `trace-live.ndjson` | The same events, one JSON per line, as they happened | the live war-room viewer (future) |
| `summary-latest.md` | A quick human summary (headline + season table + top issues) | you, at a glance |
| `report-latest.md` / Artifact | The **persona reporter's** output — journal, fun ratings, bug audit, AI-GM notes | you |

Run a campaign:
```
AP_RUN=1 AP_SEASONS=6 AP_SEED=2029 \
  PATH="/c/Program Files/nodejs:$PATH" \
  npx vitest run src/engine/career/autopilot/run.harness.test.ts --no-file-parallelism
```
(`AP_TEAM=<index>` to pick a club; defaults to a mid-pack contender. Loads the
imported 32-team league from `mods/nhl-ehm/database.json` when present.)

## Stage 1 — the fan-persona reporter

An LLM pass reads `trace-latest.json` **in the voice of a die-hard hockey-manager
player** — someone with thousands of hours in FM/EHM/OOTP who cares about *fun*,
not winning.

### The bar (raised 2026-08-26)

**Judge against the best in the genre, not against the last build.** The audience
for this game has played Football Manager for a decade. "Better than it was" is
not a standard; "would this survive next to FM" is.

**Default to dissatisfaction.** Name what is MISSING before praising what works.
A high score requires evidence in the trace — decisions that visibly changed
outcomes, a season that produced stories worth retelling. Absent that evidence,
score low and say why. A reporter that rates everything 7/10 is useless.

**Know why comparable games fail.** Esports Manager 2026 — same genre, small
team, FM-literate audience — sits at Mixed on Steam almost entirely because of
one repeated complaint: *"many tactical options but most of them do not make any
difference"* and *"the stats are just there for show."* Every review theme worth
hunting is catalogued in `docs/LESSONS-ESPORTS-MANAGER.md`: levers that don't
move outcomes, real levers with no visible receipt, a quick-sim that feels
random, unexplained systems, dead stats, a third-year cliff, chores, and a sim
that looks stupid on screen. Hunt those specifically.

### Hunt FLAVOUR and IMMERSION, not just bugs

The engine layer is largely built. What decides whether anyone plays this for
300 hours is whether the world feels ALIVE. Ask relentlessly:

- **Where did something dramatic happen and nobody wrote about it?** The trace's
  `flavour[]` block measures exactly this (see `flavorAudit.ts`) — dramatic games
  that produced no story, days of total silence, headline shapes fired dozens of
  times, bare decimals leaking into prose. Treat those counts as findings, then
  go further: read `newsSample` and say whether a season's stories are worth
  retelling to another human.
- **Where is the game merely CORRECT?** A screen can be accurate, well-organised
  and completely dead. Name the places that give the GM a number where a rival
  would give him a moment.
- **What did the GM do that should have had a consequence and didn't?** Signing a
  star, firing a coach, missing the playoffs three years running.
- **Where would a real GM feel something** — pride, dread, regret — and does the
  game give him anything to feel it with?

### Output

1. **GM Journal** — the season-by-season story in-character, grounded in the real
   decisions + `newsSample`. If the journal is boring to write, that IS the
   finding: say so.
2. **Fun ratings** — 1–10 per season on competitiveness, drama/narrative,
   trade-market realism, roster believability, agency ("did my moves matter"),
   and **immersion/flavour**. Justify every score with trace evidence.
3. **Feature/UX critique** — per feature, from `featureNotes` (the GM's friction)
   + `viewSamples` (what the screen actually served).
4. **AI-GM upgrade notes** — wherever the autopilot exploited the AI or the
   market behaved unrealistically.
5. **The flavour docket** — a ranked list of the highest-leverage places to add
   life, with a concrete proposal for each. This is the section the human reads
   first.

Output: a styled Artifact (primary) + `report-latest.md` in the repo.

## Stage 2 — the dispatcher (bugs → fixer agents)

The reporter/dispatcher triages `issues[]` (and believability findings) and, for
each **confirmed, well-scoped** issue, prepares a fixer brief containing:
- the exact finding + severity + category,
- the repro context from the trace (season, day, phase, the decision around it),
- the relevant file(s) to look at.

**Dispatch policy (safety):** engine/`career.ts` fixes touch the shared seam, so
they are **queued as `spawn_task` chips for the human to trigger**, NOT auto-run
and auto-merged overnight. UI-only findings route to the UI/UX loop's queue
(`docs/autopilot/ui-loop-requests.md`). Nothing merges to `improve-loop` without
review — the human (or the main agent) is the integrator, exactly as with the
6-chip batch.

## Stage 3 — the dedicated bug-fixing agent (down the road)

A standing agent that:
- watches for new traces,
- independently fixes the confirmed bugs on its own branch (self-verifying: typecheck
  + targeted tests),
- **explores** — beyond the trace, it can propose and prototype fixes/improvements
  it spots while in the code (the "independent exploration" mandate),
- opens each fix for review; never auto-merges.

Not built yet — this file is its spec. Until then, the dispatcher queues chips.

## Why this shape

- The autopilot stays read-only and cheap (deterministic, no LLM in the sim loop).
- LLM tokens are spent once per campaign at the reporter, not per decision.
- The human/main agent remains the single integrator, which is what kept the
  parallel-chip work from turning into merge debt.
