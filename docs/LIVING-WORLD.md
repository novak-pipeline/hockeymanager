# THE LIVING WORLD EPIC

## Why this epic exists

The June 2026 full audit found the game simulates deeply but (a) lets the player *do*
too little, and (b) forgets everything each summer. The systems exist but feel like
placeholder because stories don't cite specific, persistent facts.

**Design thesis:** the fun in GM games is the story the player tells themselves —
watching players and rivalries develop, making decisions that visibly ripple through
the game's universe (your club, other GMs, the league's memory). A template that says
"X is on a hot streak" feels generated. A story that says "X — who you traded a 2nd
for at last year's deadline — has 9 points in 6 games since Y went down" feels alive.
The difference is **memory + causality**, not more templates.

Placeholder systems are acceptable *only* when this doc records the intention to
flesh them out. Improve-what-exists beats adding new shells.

## The spine (build in order — each phase feeds the next)

### LW1 — World Chronicle (the substrate)
Append-only, permanently-persisted record of significant events with actors and
causal links: trades (full asset lists), signings, draft selections, hirings/firings,
major injuries, records broken, playoff series results, promises made.
- Player provenance: drafted-by (team/round/pick), every acquisition (how + when).
- Story arcs persist across seasons (feuds, mentorships, rivalries compound).
- All-time head-to-head per team pair (reg season + playoffs).
- Query APIs so news/UI can cite exact facts: `eventsFor(playerId)`,
  `tradesBetween(teamA, teamB)`, `pickBecame(pickRef)`, `headToHead(a, b)`.
- Everything is derived-safe: the chronicle only *records* what other systems do.
  Zero sim impact. Additive snapshot field.

### LW2 — AI GM personas
Named GMs (exists) get a persona vector — aggression, patience, risk tolerance,
pick-hoarding, loyalty, cap discipline, analytics-vs-scout lean — plus a seasonal
club posture (contend / retool / rebuild) derived from roster age curve, strength,
and board mandate. Deterministic, persisted, referenced by name in news. The league
becomes a cast of characters, not 31 copies of the same logic.

### LW3 — Trade realism
Persona + posture drive behavior: deadline urgency ramp (quiet Oct, frantic
deadline week), sellers shop expiring vets for futures, buyers overpay for rentals,
hoarders stack picks. Counter-offer rounds. User can shop players / run a trade
block with responses arriving over days. Financial reasoning (internal budgets vs
cap teams, retention as a lever with a cost). Trade news cites chronicle history.

### LW4 — Ripples (consequences the player can SEE)
Trade retrospectives at +1y/+3y ("who won the deal"), traded-pick tracking ("the
2nd you gave up became…"), former-player revenge games, draft-class redrafts,
owner/fan reaction pinned to specific moves. Decisions must echo.

### LW5 — Dynamics v2 (re-enable interactions, done right)
The deferred morale/dynamics rework. Rate-limited player conversations
(hard cap ~2–4/season/player) as inbox scenes with real options and trade-offs.
Promise ledger in the chronicle with tracked follow-through. Morale displays its
causes. Game-theory rule: immersive, never modal-spam, never a chore.

### LW6 — Narrative grounding pass
Every story cites at least one specific persistent fact (head-to-head record, a
past trade between the clubs, provenance, an anniversary, a GM's track record).
Triple the thin commentary banks (penalties / period ends / faceoffs) with
context-aware lines. Season-end legacy article assembled from the user's actual
chronicle.

## Invariants (unchanged from CLAUDE.md — restated because this epic is engine-heavy)
- Sim calibration: no new code may alter match outcomes. Chronicle/personas/news are
  observers; trade-AI changes (LW3) are the one sanctioned behavior change and get
  their own tests + season-aggregate sanity checks.
- Additive-only contracts (protocol.ts / views.ts): new message types + optional
  fields only.
- Determinism: seeded RNG everywhere; chronicle event ids stable.
- Save-compat: every new snapshot field optional with lazy defaults.
