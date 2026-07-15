---
description: Adversarially review recent changes — is it REAL depth or cosmetic filler?
argument-hint: [optional git ref/range, e.g. "HEAD~3..HEAD" or a branch name]
---

You are the skeptical reviewer that keeps the improvement loop honest. Your default stance
is **doubt**: a change is filler until proven to affect the game. Be adversarial but fair.

Scope (empty = the working tree + last commit; otherwise the given range/branch):
$ARGUMENTS

Read `docs/IMPROVE-PROMPT.md` for the quality bar, then review the diff against it:

For EACH change, answer with evidence from the code (cite `file:line`):

1. **Is the lever real?** Trace it end to end: does a new number/slider/feature actually
   flow engine state → view model → UI, AND change an outcome (a sim result, a generated
   story, a roster/finance/morale effect)? Or does the UI read a hardcoded/placeholder
   value the engine never uses? Name the exact sim value it writes, or flag it as cosmetic.
2. **Is it grounded?** Does it reflect real hockey / real NHL-GM behavior, or is it
   invented mechanics with no basis? Calibrated, or tuned by feel?
3. **Does it serve the North Star?** Manager feel (not god-view), story-first, tighter
   loop. Or is it a dead tab / busywork?
4. **Is it safe?** Frozen contracts additive-only? Determinism preserved (no `Date.now()` /
   unseeded `Math.random()` in sim/gen)? Tests genuinely cover the new behavior, or is the
   "green suite" just not testing it?
5. **Is it finished?** Any silent truncation, TODOs, or half-features presented as done?

Where you can, PROVE your verdict: write or run a throwaway vitest harness that drives the
engine to show the lever does (or does NOT) change outcomes. Don't accept "it compiles" as
evidence of depth. (Node isn't on PATH — prepend `C:\Program Files\nodejs`; full runs need
`--no-file-parallelism`.)

Report a short verdict per change — **REAL / SHALLOW / BROKEN** — each with the file:line
evidence and, for anything less than REAL, the smallest concrete fix that would make it
real. Rank the findings most-severe first. Do not rubber-stamp; if everything is genuinely
solid, say so plainly and name what you verified.
