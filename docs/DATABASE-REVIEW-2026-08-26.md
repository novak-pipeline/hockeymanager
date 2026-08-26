# Database refresh — review sheet

Two chips rebuilt `mods/nhl-ehm/database.json` for 2026-27. **Neither is merged
yet.** This sheet is for your accuracy review before they land.

Full detail: `docs/MOD-DB-2026-UPDATE.md` (players, on `claude/vibrant-sinoussi-c5532d`)
and `docs/MOD-DB-2026-NONPLAYER.md` (staff/history/clubs, on `claude/eager-wilbur-07a7aa`).

---

## What changed

| | before | after |
|---|---|---|
| season | 2025-26 | **2026-27** |
| players | 11,104 | **11,224** |
| on NHL rosters | 800 (a flat 25/club) | **700** (20–24/club — the real rosters) |
| median NHL payroll | — | **$97.0M of a $104.0M cap (93%)** |
| 2026 draft picks | 0 | **223 of 224** (one forfeited) |
| face images | 4,129 | **5,134** (+1,005) |

Non-player: five head coaches replaced, six clubs' retired numbers corrected,
Carolina given its missing AHL affiliate, and the 2026 season written into 26
competitions.

---

## Verification actually performed

- **Rosters double-sourced.** NHL public API vs CapWages, **zero disagreements
  across 1,263 players**. Every apparent conflict in the first pass was a bad
  name match, not a source conflict.
- **Draft double-checked.** Each pick matched to an NHL player record whose *own*
  draft details had to say "2026, pick #N" for that exact N. 223/223 confirmed.
- **Coaches** cross-checked against nhl.com's 32-team list plus two independent
  trackers.
- **Club records** found by diffing every stored record against the NHL API —
  not by reading headlines.
- MoneyPuck untouched (licensing, per `docs/DATA-SOURCES.md`).

**Ratings moved by a provable rule, not taste.** The loader derives ability from
`attributes`, not the `overall` shorthand — so moving `overall` alone would have
changed nothing the sim reads. Because each composite is a normalised weighted
average and `overall()` a convex combination of them, shifting every
overall-driving attribute by delta D moves overall by exactly D. Character and
style attributes (aggression, discipline, leadership, teamwork, fighting, flair)
were left alone: one season of box score is no evidence about them.

---

## Three things that were BROKEN, not merely stale

Worth knowing these existed in the save you have been playing:

1. **Six clubs flew another league's retired numbers.** Florida was hanging the
   Nottingham Panthers' banners, New Jersey Cardiff's, Philadelphia Kloten's.
2. **Carolina had no farm club at all.**
3. **"Montréal Canadiens" never matched "Montreal Canadiens"** — so the seeded
   record book contained **none** of the Habs' 16 franchise records and **none of
   their 24 Stanley Cups**. A fresh career now seeds all 24.

---

## WHAT TO REVIEW — the soft spots

Ranked by how likely they are to bother you in a long playthrough.

| # | Risk | Why it matters |
|---|---|---|
| 1 | **52 unsigned UFAs are parked in AHL affiliates** as placeholders. Retirement confirmed for only 7, a European club for 3. | If any signs in September, the DB is wrong about him. Also inflates AHL depth to ~39/club against a real ~28. |
| 2 | **Ratings unchanged for anyone without 2025-26 NHL minutes**, and no age curve applied. | A 19-year-old who dominated the OHL still carries last year's rating. Affects your prospect reads specifically. |
| 3 | **FLA ($107.5M) and TOR ($105.8M) sit over the $104.0M cap.** Both are LTIR-dependent in reality and over on CapWages too. | The sim has no LTIR, so it will refuse to let them add salary until they shed. That is the real situation — nothing was fudged to hide it. |
| 4 | **KHL club identities are coarse** — EHM strips them, so two clubs are both "Moskva Moskva" (Dynamo and Spartak) and cannot be told apart. | Cosmetic unless you follow Russian hockey closely. |
| 5 | **Only NHL-contract moves are sourced.** A player who changed CHL, SHL or KHL clubs in 2026 is still at his 2025-26 club. | Junior/European rosters are a season stale. |
| 6 | **One 2026 pick omitted** — #155 DAL, Ryan Brown (OHL London), not yet in the NHL database, so no birthdate. Left out rather than guessed. | Trivial. |
| 7 | **Three duplicate people remain** (Gayov/Gayev, two Stepanovs, Sherstnev/Sherstnyov — Russian juniors). Pre-date this update. | Deleting a player on a spelling hunch is worse than leaving him. |
| 8 | **Bergeron's No. 37 deliberately NOT retired** — the real ceremony is 1 Dec 2026, still in the future. | Correct call; add after it happens. |

Also left alone as genuinely contested: Carolina's "9 Gordie Howe" (Whalers
heritage) and Utah's "19 Shane Doan" (the Coyotes' history arguably stayed in
Arizona).

---

## One process hazard worth knowing

The player chip reported that **another process rewrote the shared 42MB mod file
mid-run** — the two database chips were working the same file at the same time.
Nothing was lost (it was the same data reserialised with a season-label bump, and
the final build was reproduced from a backup), but **the mod file is a shared
resource with no locking**. If several agents ever touch it concurrently again,
assume a clobber is possible.

Practical consequence for the merge: the player pass lands first, then the
non-player patch re-applies on top. That is safe by design — the non-player work
is **a script, not a hand-edit**, specifically so it survives a rewrite of the
player side.

---

## Note on what is committed

**The data is never committed.** `mods/` is gitignored, the mod carries real NHL
names, contracts and headshots, and the game ships fictional-by-default. What is
committed is the *pipeline* (`scripts/dev/mod-refresh/`), the docs, and an
acceptance harness (`src/data/modRefresh.verify.test.ts`) that validates a
rebuilt file, loads a career, and sims a full season and playoffs to a champion
before it is installed.

So the refresh is re-runnable rather than a one-off: next August is a re-run, not
an archaeology project.
