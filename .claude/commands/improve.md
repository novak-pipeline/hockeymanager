---
description: Run one deep, verified improvement iteration on the game (real depth, not filler)
argument-hint: [optional focus, e.g. "the trade deadline experience"]
---

Follow the standing brief in `docs/IMPROVE-PROMPT.md` for exactly ONE improvement iteration.

Focus for this iteration (empty = self-pick the highest-impact item per the rubric):
$ARGUMENTS

Work the loop from that file end to end:

1. Read-first: `docs/ARCHITECTURE.md`, `CLAUDE.md`, the memory index, and the specific
   engine/renderer files you'll touch. Extend, don't rebuild.
2. Pick ONE high-impact improvement and spec it in 3–6 lines: the player-facing problem,
   the design, and exactly which sim values it reads/writes. If it's cosmetic-only, discard
   and pick again — every visible lever must be REAL and change what happens on the ice or
   in the front office.
3. Reproduce the current state (a throwaway vitest harness that drives the engine is the
   fastest proof), build the change matching surrounding idioms, then verify:
   - Node isn't on PATH — prepend `C:\Program Files\nodejs` in every shell command.
   - `npm run typecheck` clean.
   - Targeted `npx vitest run <files> --no-file-parallelism` green.
   - Confirm the new lever actually changes outcomes, not just that it compiles.
4. Respect the non-negotiables: additive-only frozen contracts
   (`src/domain/events.ts`, `src/engine/career/views.ts`, `src/worker/protocol.ts`,
   `src/render2d/rendererContract.ts`), seeded determinism, clean-room, fictional DB.
5. Commit ONLY if green, on a non-`main` branch, with a player-facing message. If you can't
   get green, STOP and leave a short note — never commit broken work.

Finish by reporting the change in plain player-facing language, the sim values you touched,
and the verification you ran. Then stop (one iteration). Under `/loop`, the next wake starts
the next iteration.
