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
player** (someone who's sunk hundreds of hours into FM/EHM and cares about *fun*,
not just winning). It produces four things:

1. **GM Journal** — the season-by-season story in-character, grounded in the real
   decisions + `newsSample`.
2. **Fun ratings** — 1–10 per season on competitiveness, drama/narrative,
   trade-market realism, roster believability, agency ("did my moves matter").
3. **Feature/UX critique** — for each feature it used, judged from `featureNotes`
   (the GM's friction) + `viewSamples` (what the screen actually served): was the
   information there, sufficient, well-organised? What's confusing or missing?
4. **AI-GM upgrade notes** — wherever the autopilot exploited the AI (fleeced every
   trade, walked to a Cup) or the market behaved unrealistically → concrete fixes
   for the computer GMs. (The autopilot's own policy is the reusable AI-GM brain.)

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
