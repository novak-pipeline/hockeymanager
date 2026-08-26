# Real-roster mod refresh — 2025-26 → 2026-27

**Run date: 26 August 2026.** `mods/nhl-ehm/database.json` now reflects the real
hockey world as it stands after the 2026 offseason, ready to start 2026-27.

> **This is dev-only data.** The mod carries real NHL names, contracts and
> headshots. It is gitignored (`mods/`), it is not in any packaged build, and it
> must never be shipped — the game ships fictional-by-default. See `MODDING.md`
> and `CLAUDE.md`. Only the *pipeline* is committed, never the data.

| | before | after |
|---|---|---|
| `meta.season` | 2025-26 | **2026-27** |
| players | 11,104 | **11,224** |
| on NHL rosters | 800 (a flat 25/club) | **700** (20–24/club, the real rosters) |
| in AHL affiliates | 896 | 1,234 |
| median NHL payroll | — | **$97.0M of the $104.0M cap (93%)** |
| 2026 draft picks carried | 0 | **223 of 224** (the 224th was forfeited) |
| face images | 4,129 | **5,134** |

Files: `mods/nhl-ehm/database.json` (new), `mods/nhl-ehm/database.2025-26.pre-update.bak.json`
(the pre-update data), `mods/nhl-ehm/faces/` (+1,005 PNGs).

---

## Sources

Everything below traces to one of these. Nothing was interpolated from memory.

| Source | Used for | Notes |
|---|---|---|
| `api-web.nhle.com/v1/roster/{TEAM}/current` | 2026-27 org rosters, 32 clubs | 1,268 contracted players |
| `api-web.nhle.com/v1/player/{id}/landing` | birthdates, bios, draft records, season-by-season production | 1,268 pulled |
| `api-web.nhle.com/v1/draft/picks/2026/all` | the 2026 entry draft, all 224 picks | names/slots/clubs |
| `search.d3.nhle.com/api/v1/search/player` | player-id lookup | |
| `api.nhle.com/stats/rest/en/skater/summary`, `/skater/timeonice`, `/goalie/summary` | 2025-26 production (940 skaters, 98 goalies) | drives the rating rule |
| `api-web.nhle.com/v1/standings/now` | 2025-26 final table | 82 GP everywhere; season ended 2026-04-17 |
| `capwages.com` team pages (`_next/data/.../teams/<club>.json`) | **contracts**: 2026-27 cap hit, years remaining, NMC/NTC, NHL-vs-minors bucket, salary-cap table | `robots.txt` allows `/`; only `Amazonbot` is disallowed from `/players/` |
| `nhl.com` free-agency tracker + individual reports | retirements, remaining unsigned UFAs | |
| `assets.nhle.com/mugs/nhl/latest/{id}.png` | headshots | |

The two roster sources were cross-checked against each other: after tightening
the name join, **CapWages and the NHL API agreed on every player's club — zero
disagreements across 1,263 players.** Every apparent conflict in a first pass
turned out to be my own bad name match, not a source conflict.

The 2026 draft got a second, stronger check: each pick was matched to an NHL
player record, and that record's *own* `draftDetails` had to say "2026, pick #N"
for the exact N. **223 of 223 real picks confirmed that way.**

MoneyPuck was not touched (licensing — recorded decision in `docs/DATA-SOURCES.md`).

---

## The rating rule

**The loader derives a player's real rating from `attributes`, not from
`overall`.** In `src/data/modSchema.ts` → `buildModPlayer`, `overall` is only
used as a *caliber* to synthesise attributes the mod omits — and this DB supplies
all 33 of them. So changing `overall` alone changes nothing that the sim reads.

The rule therefore moves attributes, and it can be exact:

- Every composite in `src/engine/ratings/composites.ts` is a **normalised**
  weighted average of raw attributes.
- `overall()` is a fixed **convex combination** of composites (weights sum to
  1.00 for F, D and G).
- Therefore **adding the same delta `D` to every attribute that feeds a
  position's overall moves that overall by exactly `D`** (up to the 1–99 clamp).

So: *a uniform shift of the overall-driving attribute set, and nothing else.*
Character and style attributes — aggression, discipline, faceoffs, checking,
strength, fighting, flair, leadership, teamwork, height — are **left alone**. One
season of box-score production is no evidence about them. (Side effect, and an
intended one: `hitting` and `faceoffWin` move slightly because they share `speed`
and `anticipation` with the overall set.)

Which attributes, per position — read straight off `SKATER_WEIGHTS` /
`GOALIE_WEIGHTS` and the `overall()` combination:

- **Forwards** — wristShot, slapShot, deflections, offensiveIQ, composure,
  anticipation, passing, vision, stickhandling, balance, agility, speed,
  acceleration, stamina, defensiveIQ, positioning, stickChecking, shotBlocking
- **Defence** — the above set plus takeaway and workRate
- **Goalies** — reflexes, positioningG, glove, blocker, reboundControl, recovery,
  composure, anticipation

### How the delta is chosen

Percentile-to-percentile against **this DB's own scale**, so no absolute
production→rating curve has to be invented:

1. Qualify: skaters with **≥20 GP**, goalies with **≥15 GP**, in 2025-26.
   Split into three cohorts: F, D, G.
2. Production score, z-scored *within cohort*:
   - skaters: `0.55·z(points per 60 min of ice time) + 0.45·z(TOI per game)`
     — rate quality plus how much the coach actually trusts him;
   - goalies: `0.75·z(save %) + 0.25·z(games started)`.
3. `expected = ` the DB's own overall at the **same percentile** within the same
   cohort.
4. `delta = clamp(round(0.5 × (expected − current)), ±6)` — **±5 for goalies**.

The 0.5 damping and the cap are deliberate: one season is noisy, and the stored
ratings encode scouting knowledge that a box score does not. A player who did not
play enough is **not touched** — no age curve, no decay, no guesswork.

**Result: 716 players qualified (429F / 220D / 67G); 509 moved — 278 up, 231
down.** The distribution is tight: 237 moved by 1 point, 165 by 2, 66 by 3, and
only 11 hit ±5 or ±6.

- Biggest up: Brad Lambert +6 (48→54), Artyom Levshunov +6 (62→68),
  Tom Willander +6 (62→68), Jesper Wallstedt +5 (80→85), Ukko-Pekka Luukkonen +5 (76→81)
- Biggest down: Connor Hellebuyck −5 (94→89), Brayden Point −5 (90→85),
  Lukas Dostal −5 (83→78), Stuart Skinner −5 (84→79), Brock Nelson −4 (89→85)

Newly-created players who *did* play qualifying NHL minutes get their overall
read straight off the same mapping instead of a placeholder.

---

## What changed, pass by pass

The pipeline is `scripts/dev/mod-refresh/`; `apply.js` prints each pass.

1. **Ages.** Verified that this DB uses EHM's calendar-year age (`age = year −
   birthYear`): it reproduced 11,090 of 11,104 stored ages against 2025-12-31
   (99.9%), and nothing else came close. Recomputed as `2026 − birthYear`.
   Birthdates come from the `faceId`, which encodes them — and the naming rule
   was verified by regenerating **all 11,104 faceIds exactly from name + DOB**.

2. **Placement.** 1,374 contracted players placed from source. CapWages' roster
   bucket decides NHL vs minors, with two exceptions: players on season-ending IR
   and a PTO body are parked in the affiliate, because the sim has no LTIR and no
   way to import "already injured" — leaving them on the NHL roster would both
   break the cap and hand the club a phantom regular (Krug/STL, Pietrangelo/VGK,
   Petersen/WSH). 463 players changed club or tier.

3. **Contracts.** 1,360 set from **signed 2026-27 deals** (cap hit + years),
   plus **302 real NTC/NMC clauses** carried verbatim. 11 unsigned RFAs got
   CapWages' own published projection rather than a number I made up (Fantilli,
   Gauthier, Edvinsson, Nikishin, Bolduc, Xhekaj, Korchinski, Del Mastro,
   Poitras, Othmann, Melanson). 3 with neither got the $800,000 league minimum —
   which is the lowest 2026-27 cap hit anywhere in the league, so it is observed,
   not assumed. The 2026-27 cap is **$104,000,000**.

4. **Ratings.** As above.

5. **2026 entry draft.** All 223 real picks now carry `nhlDrafted`, `draftYear`,
   `draftRound`, `draftOverall`, `draftClub`. **This matters beyond cosmetics:**
   `Career.isEntryDraftEligible` puts every undrafted 18–19-year-old amateur into
   the next draft class, so without these flags the game would have re-drafted
   the entire 2026 class in 2027. 186 of them were already in the DB as junior /
   college / European prospects; 37 were not and were created.

6. **Creates.** 127 players added — 91 NHL-contracted (mostly AHL depth and
   recent college signings) and 36 2026 draftees. New players get `overall` only,
   with no `attributes`, so the loader synthesises a coherent spread; inventing
   35 attribute values for a name I know nothing about would be fake precision.
   Baselines are the DB's own 35th percentile for that tier and position
   (NHL C/W/D/G = 69/67/68/65, AHL = 48/48/46/50); draftees use a curve fitted to
   the DB's *own* values for the 186 picks it already carried, bucketed by slot
   (top-10 → ov 48 / pot 58, late rounds → ov 40 / pot 48).

7. **Rosters rebuilt.** 700 on NHL rosters, 1,234 in AHL affiliates.

8. **Meta.** `season: "2026-27"`.

### Departures

- **Removed as retired (7):** Jonathan Toews, Anze Kopitar, Jonathan Quick,
  Jordan Oesterle, Max McCormick, Andrew Agozzino, Gannon Laroque. Shea Weber and
  Carey Price also retired but were already off the rosters.
- **Moved to the KHL (3):** Ivan Fedotov, Yegor Zamula, Ivan Prosvetov.
- **Everyone else who lost his NHL contract (52)** is parked on his last club's
  AHL affiliate. This is an approximation forced by the format: `ModDatabase` has
  no free-agent pool and `Career.faPool` starts empty, so every player must be on
  *some* roster. Their stored contract is the previous deal rolled a year, **not
  a real 2026-27 contract** — do not read it as one. Affiliate salaries do not
  count against the cap (`capUsedFor` sums the NHL roster only), so this does not
  distort the cap game. It covers the genuinely unsigned UFAs of late August
  2026: Tarasenko, Klingberg, van Riemsdyk, Talbot, Laine, Tolvanen, Bunting,
  Henrique, Stanley, Kane, Nyquist and the like.

### Corrections made along the way

- **Crosby and Malkin are both alive and on Pittsburgh** for 2026-27, verified
  against their NHL player records. Crosby: 74 points in 68 games last year,
  $8.7M, final year, NMC. Malkin: 61 in 56. The recurring "they retire every
  season" report is not coming from this data.
- **De-duplicated 7 clashing `externalId`s** in the source export — genuinely
  different players sharing an id (same name, same birth *year*, different birth
  *date*), which silently collapsed one of each pair.
- **Fixed `FACE_ID_PATTERN` in `src/main/mods.ts`.** It rejected apostrophes, so
  `mods:face` *threw* for 51 players whose PNGs were sitting right there
  (O'Reilly, K'Andre Miller, L'Heureux, D'Astous…). An apostrophe cannot form a
  path traversal. This is the one code change in the update.

---

## Faces

`mods/nhl-ehm/faces/<faceId>.png`, where `faceId` is
`first_last_d_m_yyyy` — lowercase, spaces → `_`, accents decomposed and
stripped, any remaining non-ASCII **dropped** (`Søgaard` → `sgaard`), apostrophes
and periods **kept**, day and month **not zero-padded** (`7_2_1996`, not
`07_02_1996`). Verified by regenerating all 11,104 existing faceIds exactly.

**1,005 headshots added** from the NHL's own CDN. The CDN answers 200 with a
generic silhouette for players who have no photo on file, so every download is
SHA-1'd against the `default-skater` / `default-goalie` fingerprints and
discarded on a match — **632 were placeholders and were not saved.**

Coverage now: **NHL rosters 699/700**, AHL affiliates 87%, 2026 draft class
112/223. The rest of the draft class genuinely has no NHL headshot yet — they
were drafted two months ago and the CDN still serves silhouettes for them. Worth
re-running in a few months. The one uncovered NHL player is Ryan Ellis, who has
not played since 2021-22.

---

## Verification

- `validateModDatabase` passes on the shipped file.
- `loadModDatabase` + a **full 2026-27 season and playoffs** run to a champion:
  32 clubs at 82 GP, standings math exact for every club, scoring race in NHL
  range. Harness: `src/data/modRefresh.verify.test.ts` —
  `MODCHECK=1 npx vitest run src/data/modRefresh.verify.test.ts --no-file-parallelism`
  (skips unless `MODCHECK` is set and the dev mod is present).
- The same harness was run against the **pre-update** DB as a control. Its
  standings spread, inflated goal totals and low save percentages are identical
  in character, which places them in the engine's calibration, not in this data
  change.
- No NHL club falls below the validator's floor; no competition club was left
  unable to ice lines (see caveats).

---

## What I could NOT verify

Stated plainly, so the next refresh knows where the soft spots are.

1. **Where the unsigned UFAs actually end up.** 52 players lost their NHL
   contract and I could only confirm retirement for 7 and a European club for 3.
   The rest sit in an AHL affiliate as a placeholder (above). If any of them
   signs in September, this DB will be wrong about him.
2. **European destinations are coarse.** EHM strips KHL club identities, so this
   DB has two clubs both called "Moskva Moskva" (Dynamo and Spartak) and I cannot
   tell them apart. Fedotov (really Spartak) is on the first of the two. CSKA
   → "Moskva Armeitsy" and Avangard → "Omsk Omsk" are unambiguous.
3. **AHL rosters are deep — about 39 players a club, against a real ~28.** The
   surplus is the 52 parked UFAs plus AHL-contract depth the NHL API never lists.
   Real orgs also assign to the ECHL; I had no source for *who*, so I did not
   invent assignments.
4. **AHL / junior / European transactions generally.** Only NHL-contract moves
   are sourced. A player who changed CHL or SHL clubs in 2026 is still at his
   2025-26 club here.
5. **Two teams sit over the cap** — FLA at $107.5M and TOR at $105.8M against
   $104.0M. Both are LTIR-dependent in reality and both are over on CapWages too.
   The sim has no LTIR; it will simply refuse to let them add salary until they
   shed some, which is the real situation. Nothing was fudged to hide it.
6. **Ratings for players who did not play 2025-26 NHL minutes are unchanged**
   from the 2025-26 import — no age curve was applied. A 19-year-old who
   dominated the OHL last year still carries last year's rating.
7. **Three duplicate people remain in the source data** (Vladislav Gayov/Gayev,
   Alexander V. Stepanov/Alexander Stepanov, Ivan Sherstnev/Sherstnyov — all in
   Russian junior leagues). They pre-date this update. Deleting a player on a
   spelling hunch is worse than leaving him, so they stay.
8. **One 2026 draft pick has no birthdate:** #155 DAL, Ryan Brown (OHL London).
   He is not in the NHL player database yet, so he could not be created with a
   correct age or faceId. Left out rather than guessed. 223 of 224 picks are in.
9. **Another process rewrote `mods/nhl-ehm/database.json` mid-run.** It replaced
   the original with the same data reserialised and `meta.season` bumped to
   "2026-27" and nothing else — no roster, contract or draft changes. Nothing was
   lost (the backup is that file with the season label restored, and the final
   build was reproduced from it), but if several agents share this checkout, the
   mod file is a shared resource with no locking.

---

## Re-running this

`scripts/dev/mod-refresh/`, from that directory, with network access:

```bash
node pull_cw.js        # 32 CapWages team pages (contracts, roster buckets, cap table)
node pull_stats.js     # 2025-26 skater/goalie stats + the raw draft
node pull_landing.js   # per-player bios and season-by-season production
node resolve_draft.js  # draft picks -> NHL ids, each confirmed against its own draft record
node build_truth.js && node merge_truth.js && node rehits.js && node redraft.js
node plan.js           # decide where every player belongs
node apply.js          # write database.<season>.json
node faces.js          # fill facepack gaps from the NHL CDN
```

Every fetch is cached under `cache/`, so re-runs are cheap and the whole thing is
deterministic. `apply.js` reads `IN` (default: the pre-update backup) and writes
`OUT`; point `IN` at whichever file is genuinely the previous season's data —
**never at an already-transformed file**, since the contract roll and the rating
shift are not idempotent.

Then, before installing:

```bash
MODCHECK=1 MODDB=/path/to/new.json npx vitest run src/data/modRefresh.verify.test.ts --no-file-parallelism
```
