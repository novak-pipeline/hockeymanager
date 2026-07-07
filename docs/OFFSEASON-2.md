# Offseason 2.0 — camps with weight, days that matter

Design doc (2026-07-07), from direct user feedback: "camps are too minimal —
should be 1-2 weeks of scrimmages with stat tracking and evolving coach
reports. Be wary of CADENCE: each day should hold weight, not quick-sim spam.
Maybe the calendar becomes the dashboard centerpiece." Grounded in how EHM
actually does it (thebluelinie forums + manual): camp is an INVITED roster
(prospects, farm recalls, tryout UFAs) split into scrimmage squads (~4 teams
of 15), playing intra-squad scrimmages AND exhibition games vs other clubs
(prospect showcase + gate revenue), with players begging for per-day coach
reports to drive cuts.

## The cadence law (applies to the whole game, not just summer)

A Continue press should never feel empty. Every advance lands on either
(a) a decision, (b) a report worth reading, or (c) a result. If a stretch has
none of those, it should be COMPRESSED (one press skips it with a digest),
not padded. The offseason is dated (July 1 anchor, in) — beats live on real
dates and the calendar is the spine.

## Development camp (July 8-14) — one week, three beats

Replaces the current single-click screen. State: `devCamp { day: 0..3 }`.
- **Day 1 — Arrival**: roster of invitees (draftees flagged), staff
  first-look notes (existing reads), fitness reports (who arrived in shape —
  deterministic). One press.
- **Day 2 — Scrimmage day**: an actual QUICK-SIM intra-squad scrimmage
  (Team White vs Team Blue from invitees + AHL filler) producing a real BOX
  SCORE — goals/assists/shots per kid, using the existing quick engine at
  low fidelity. Standouts get salience-style reads ("scored twice, both off
  the rush"). Stats stored on the camp state and shown cumulatively.
- **Day 3 — Wrap**: cumulative camp stat lines + the staff's final grades
  (existing A/B/C, now informed by scrimmage output: grade = prior read
  blended with scrimmage points), THEN the standout decision (existing) +
  optional "summer program focus" pick per top-3 (shooting/skating/strength
  -> tiny dev-focus tag consumed by the in-season dev pass).
Each beat = one Continue. Simming past any point auto-resolves the rest and
mails the (now richer, stats-inclusive) report.

## Training camp (Sep 15-28) — two weeks, the roster forge

Replaces single-shot cut day. State: `trainingCamp { day: 0..5, invites,
scrimmages, exhibitions, cuts }`.
- **Sep 15 — Camp opens**: invite list = NHL roster + top AHL + unsigned
  tryouts (PTOs — invite up to 3 FAs from the market to camp for free looks;
  M2's missing PTO piece lands here). Coach's opening depth chart.
- **Sep 17 / 20 — Intra-squad scrimmages**: quick-sim box scores; camp stat
  lines accumulate (G/A/SOG per player). Coach report after each names
  risers/fallers with the numbers cited.
- **Sep 22 / 25 — EXHIBITION GAMES** vs two nearby clubs: real fixtures
  through the full engine — WATCHABLE like any game, results meaningless to
  standings but stats feed camp lines and rookies get their showcase (EHM's
  exact model, incl. small gate revenue).
- **Sep 26 — First cuts**: wave 1, obvious trims (coach handles, you can
  veto) down to ~26.
- **Sep 28 — CUT DAY**: the existing decisions screen, now argued by two
  weeks of camp stats ("9 shots and 3 points across four games — he made
  the decision for you"), waiver trap intact. PTO verdicts: sign or release.
- **Oct 1 — Opening night.**
Every date = one Continue; each lands on a report, a game, or a decision.
Board meeting slots Sep 29-30 (after the roster exists — correct order).

## Calendar-centric dashboard (the aesthetic answer)

The offseason dashboard's center column becomes **the week ahead**: a
vertical agenda derived from the calendar — today highlighted, next 7 days
as rows (event chips, decisions pending, scrimmage/exhibition fixtures),
Continue visibly walks DOWN the list. In-season the same component shows the
fixture week. The Summer hub panel folds into it. This is one coherent
centerpiece instead of stacked panels; supporting cards (inbox, cap, market)
hang off the sides at fixed, balanced heights. Design pass with Mobbin
references (sports/productivity agenda screens) once authenticated.

## Free agency cadence (July)

Already day-based; additions: day-1 FRENZY digest exists; cap-casualty
releases now populate July (in); mid-July "market check" report (best
unsigned by position, cap space leaderboard); August compresses — one press
jumps Aug 1 -> Sep 15 with a digest (cadence law: empty weeks compress).

## Implementation order

1. Engine: dated multi-day camp states + scrimmage quick-sims + camp stat
   accumulation (devCamp first, smaller).
2. Exhibition fixtures (schedule two, playable through MatchViewer).
3. PTO invites (ties M2 + camp).
4. First-cuts wave + stat-argued cut day.
5. Week-ahead agenda component; dashboard restructure around it.
6. August compression + market-check report.

## Invariants

Additive contracts; camp scrimmage sims use separate rng namespaces and
never touch league standings/stats; save-compat (camp states optional);
the harness photographs every new beat.
