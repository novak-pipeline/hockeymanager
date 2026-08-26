# `mods/nhl-ehm/database.json` — non-player update to 26 August 2026

**Date of work:** 2026-08-26 · **Applied by:** `scripts/dev/mod-db-2026-nonplayer.mjs`
**Scope:** everything in the mod database that is *not* a player. Rosters, contracts and
prospects were deliberately untouched (that surface was being updated in parallel).

> **Dev/personal use only.** This database carries real NHL names. Per `CLAUDE.md` the game
> ships fictional by default and cannot distribute real NHL names, logos or imagery. `mods/`
> is git-ignored and must stay out of packaged builds. Nothing here is committed except this
> document and the patch script.

The patch is applied by a script rather than by hand so it is **idempotent** — re-run it after
anyone else rewrites the player side and it will re-apply cleanly without doubling anything up:

```bash
node scripts/dev/mod-db-2026-nonplayer.mjs
```

(Run it from `K:\Hockey Game`, or pass the database path as the first argument. A backup of the
pre-patch file was taken to the session scratchpad as `database.pre2026.json`.)

---

## 1. The 2026 head-coaching carousel — 5 clubs

This was the change most likely to be noticed on the first click: four clubs were being led by
men who no longer work there, and one by a coach the engine picked over the real one.

| Club | Was (in the file) | Now | Source note |
|---|---|---|---|
| TOR | Craig Berube (85) | **Jim Hiller** (80) | Berube fired 13 May 2026 |
| LAK | D.J. Smith (75) | **Peter Laviolette** (80) | Hiller fired 1 Mar 2026; D.J. Smith was interim |
| EDM | Kris Knoblauch (85) | **Mike Babcock** (90) | Knoblauch fired 14 May 2026 |
| VGK | John Tortorella (85) | **Ryan Craig** (75) | Cassidy fired 29 Mar 2026; Tortorella was interim |
| VAN | Adam Foote (75) | **Manny Malhotra** (75, was 64) | Foote fired 19 May 2026; Malhotra promoted from AHL Abbotsford |

Sources — three independent, all in agreement:

- **nhl.com, "List of NHL coaches"** (page dated 23 June 2026) — the full 32-team list for
  2026-27. This is the primary check; all 32 clubs were compared against it, not just the five.
- **en.wikipedia.org/wiki/2026–27_NHL_season** — carries the firing dates quoted above and
  identifies both interim coaches.
- **deseret.com, "Every NHL head coach that changed teams this summer"** (21 Aug 2026) and
  **bleacherreport.com, "Ranking the NHL's New Head Coaching Hires for 2026-27"** (28 Jul 2026)
  — corroboration, and confirmation that the carousel had closed before 26 August.

The other 27 clubs already matched the nhl.com list and were left alone. Note that Rick Bowness
(CBJ) and Peter DeBoer (NYI) *looked* wrong at first glance but are correct — both were hired
during 2025-26, so the export is an end-of-2025-26 snapshot, not a start-of-season one.

### Staff-rating rule

No rating here was chosen by feel. The export rates NHL head coaches on a 5-point lattice inside
the band **[75, 95]** (the 32 incumbents are 11×75, 7×80, 11×85, 1×90, 2×95). AHL head coaches in
the same file sit in a separate ~55–65 band. The rule applied:

> A new head coach starts from the rating of the man he replaces at that club, then:
> **−5** if he has never been an NHL head coach before; **−5** if the man he replaces won a
> Stanley Cup as an NHL head coach and he has not; **+5** if he won one and the man he replaces
> did not. The result is clamped into [75, 95]. A coach already present in the database keeps his
> own attributes and face; only his rating moves, and only to bring him into the NHL band.

Worked through:

- **Hiller** — Berube 85, Cup 2019 (STL); Hiller has NHL HC experience, no Cup → 85 − 5 = **80**.
- **Laviolette** — D.J. Smith 75, no Cup; Laviolette Cup 2006 (CAR) → 75 + 5 = **80**.
- **Babcock** — Knoblauch 85, no Cup; Babcock Cup 2008 (DET) → 85 + 5 = **90**.
- **Craig** — Tortorella 85, Cup 2004 (TBL); Craig is a first-time NHL HC → 85 − 5 − 5 = **75**.
- **Malhotra** — Foote 75; first-time NHL HC → 75 − 5 = 70, clamped to the band floor = **75**.

**Babcock at 90 is a consequence of the rule, not a judgement about him** — it puts him level with
Lindy Ruff and above every coach except Cooper and Bednar. If that reads wrong, change it; it is
one number in the script.

Other fields for the four men new to the file:

- `judgment` = **80**, the median judgment of the export's own 32 NHL head coaches.
- `specialty` follows the man's playing position (forward → `Forwards`, defenceman → `Defense`).
- `attributes` is **omitted on purpose**. Inventing 19 per-attribute numbers each would be fake
  precision; the loader's documented fallback (`deriveSyntheticProfile` in
  `src/engine/league/coachProfile.ts`) builds their tactical profile from the rating instead.
  Malhotra keeps his own real attribute vector and `faceId`.
- No `faceId` for Hiller, Laviolette, Babcock or Craig — `mods/nhl-ehm/faces.json` has no face
  for any of them, and a made-up id would just fail to resolve.

The outgoing coaches were **removed** from their club's staff array rather than demoted, because
the schema has nowhere to put an unemployed coach and lowering a rating would corrupt it. That
does mean Berube, Knoblauch, Tortorella, Foote and D.J. Smith are no longer anywhere in the file.

---

## 2. Affiliate — Carolina

Carolina had **no AHL affiliate at all**. It now has the **Chicago Wolves**.

- Source: nhl.com/hurricanes, "Canes Announce Affiliation Agreement With Chicago Wolves"
  (multi-year deal running through 2026-27), corroborated by the 2025-26 AHL season club list,
  which shows Chicago Wolves (Carolina).
- **All 31 other NHL/AHL pairings in the file were checked against that same league-wide list and
  are correct** — no other affiliation change was needed.
- The affiliate is added with an **empty roster**: the loader tops every affiliate up to valid
  minimums, and the player surface was not this task's to write.
- Abbreviation `CHI` is the AHL's own code for the Wolves. It duplicates the Blackhawks' NHL
  abbreviation — exactly as the Toronto Marlies already duplicate the Maple Leafs' `TOR` in this
  file, so the behaviour is already exercised.
- Colours follow the file's own convention: 29 of its 31 affiliates carry their parent club's
  colours, so the Wolves carry Carolina's rather than invented hex values.

---

## 3. Retired numbers — six clubs were carrying the wrong league's banners

This turned out to be badly corrupted in the export, not merely stale:

- **Florida** held the **Nottingham Panthers'** (EIHL) retired numbers — Paul Adey, Corey Neilson,
  Adam Johnson.
- **New Jersey** held what look like **Cardiff Devils** numbers — John Lawless, Steve Moria.
- **Philadelphia** held **Swiss** numbers — Marco Klöti, Reto Pavoni, Felix Hollenstein.
- **NY Rangers**, **St. Louis** and **Vegas** carried lists that were simply wrong (the Rangers'
  had Scott Stevens and Larry Robinson; St. Louis had a single entry, "33 Mikko Hirvonen").

All six were replaced with the verified lists (No. 99 carried through, as the file already does
for 29 of 32 clubs):

| Club | Retired numbers now |
|---|---|
| FLA | 1 Luongo · 37 Huizenga · 93 Torrey |
| NJD | 3 Daneyko · 4 Stevens · 26 Eliáš · 27 Niedermayer · 30 Brodeur |
| NYR | 1 Giacomin · 2 Leetch · 3 Howell · 7 Gilbert · 9 Bathgate · 9 Graves · 11 Hadfield · 11 Messier · 19 Ratelle · 30 Lundqvist · 35 Richter |
| PHI | 1 Parent · 2 Howe · 4 Ashbee · 7 Barber · 16 Clarke · 88 Lindros |
| STL | 2 MacInnis · 3 Gassoff · 5 Bob Plager · 8 Barclay Plager · 11 Sutter · 16 Hull · 24 Federko · 44 Pronger |
| VGK | 58 (2017 Las Vegas shooting victims) |

Sources: Wikipedia's "List of National Hockey League retired numbers" as the base, then a second
independent check per club — NHL.com/ESPN/SI reporting on the Luongo, Torrey and Huizenga
ceremonies; the Flyers' six via NHL/Inquirer/FOX coverage of the Lindros retirement; NHL.com on
the Niedermayer ceremony (Wikipedia's summary omitted his No. 27 — the second source caught it);
Rangers coverage confirming the two shared numbers (9 Bathgate + Graves, 11 Hadfield + Messier)
and Lundqvist's 30; ESPN/Globe and Mail on Vegas' No. 58.

Also de-duplicated exact repeat rows: **Utah** had Gretzky twice, **Seattle** had "32 Seattle
Kraken Fans" twice.

### Left alone on purpose

- **Boston / Patrice Bergeron No. 37.** The ceremony is **1 December 2026** — a *future* event as
  of today (SI, 16 Jul 2026: "Tuesday, Dec. 1", and 1 Dec 2026 is a Tuesday). Add it after it
  happens; adding it now would be wrong.
- **Carolina "9 Gordie Howe"** — Whalers heritage, not on the Wikipedia list; could not confirm
  either way, so it stays.
- **Utah "19 Shane Doan"** — the sources say Utah has no retired numbers (the Coyotes' history
  stayed in Arizona), but that is a contested reading, so it stays.
- **Minnesota "1 Minnesota Wild Fans"** and **Seattle "32 Seattle Kraken Fans"** are real.
- **Winnipeg** correctly has none beyond No. 99.

---

## 4. History — the 2026 season (26 competitions)

The file's own convention is **`year` = the calendar year the trophy was won**, so the 2025-26
season is `year: 2026`. All club and nation strings reuse spellings already present in the file's
history so name-matching keeps working.

| Competition | Champion | Runner-up | Third | Regular season |
|---|---|---|---|---|
| National Hockey League | Carolina Hurricanes | Vegas Golden Knights | | Colorado Avalanche |
| NHL Eastern / Western Conference | Carolina / Vegas | | | |
| American Hockey League | Toronto Marlies | Chicago Wolves | | Providence Bruins |
| AHL Eastern / Western Conference | Toronto / Chicago | | | |
| ECHL | Florida Everblades | Kansas City Mavericks | | Kansas City Mavericks |
| ECHL Eastern / Western Conference | Florida / Kansas City | | | |
| Ontario Hockey League | Kitchener Rangers | Barrie Colts | | Brantford Bulldogs |
| Western Hockey League | Everett Silvertips | Prince Albert Raiders | | Everett Silvertips |
| Québec Maritimes Junior | Chicoutimi Saguenéens | Moncton Wildcats | | Moncton Wildcats |
| CHL Memorial Cup | Kitchener Rangers | Everett Silvertips | Chicoutimi Saguenéens | |
| United States Hockey League | Sioux Falls Stampede | Muskegon Lumberjacks | | Youngstown Phantoms |
| NCAA | University of Denver Pioneers | Univ. of Wisconsin-Madison Badgers | | |
| Kontinental Hockey League | Lokomotiv Yaroslavl | Ak Bars Kazan | | Metallurg Magnitogorsk |
| Russian MHL | Loko Yaroslavl | MHK Spartak Moskva | | |
| Swedish Hockey League | Skellefteå AIK | Rögle BK | | Skellefteå AIK |
| Swedish HockeyAllsvenskan | IF Björklöven | BIK Karlskoga | | IF Björklöven |
| Finnish Liiga | Tampereen Tappara | Kouvolan KooKoo | Lappeenrannan SaiPa | Tampereen Tappara |
| Swiss National League | HC Fribourg-Gottéron | HC Davos | | HC Davos |
| Czech Tipsport Extraliga | HC Dynamo Pardubice | HC Ocelári Trinec | | HC Dynamo Pardubice |
| Deutsche Eishockey Liga | Eisbären Berlin | Adler Mannheim | | Kölner Haie |
| World Championships | Finland | Switzerland | Norway | |
| World Junior Championships U-20 | Sweden | Czechia | Canada | |
| Olympic Hockey Tournament | United States | Canada | Finland | |

Sources:

- **NHL** — the NHL public API (`api-web.nhle.com/v1/playoff-bracket/2026` for the full bracket,
  Carolina 4-2 Vegas; `api-web.nhle.com/v1/standings/2026-04-17` for the final table, Colorado
  121 points). Corroborated by nhl.com/hurricanes' Cup-win story and CBS' Game 6 report.
- **Everything else** — the per-season Wikipedia article for that league or tournament
  (2025-26 AHL / ECHL / OHL / WHL / QMJHL / USHL / SHL / Liiga / Swiss NL / Czech Extraliga / DEL
  / KHL / HockeyAllsvenskan seasons; 2026 Memorial Cup; 2026 NCAA Division I tournament; 2026 IIHF
  World Championship; 2026 World Junior Championships; ice hockey at the 2026 Winter Olympics),
  plus the KHL's own MHL site (`engmhl.khl.ru`) for the Kharlamov Cup.

The MHL runner-up is rendered "JHC Spartak" by the league's English site; it is written here as
**MHK Spartak Moskva**, the spelling this file already uses, so the name matches.

---

## 5. Club records

### The Montréal bug (the biggest single fix in this pass)

`history.clubRecords` and the NHL history rows spelled the club **"Montréal Canadiens"**, but the
club's own record in `conferences[]` is `city: "Montreal"`, and the engine builds a team name as
`` `${city} ${nickname}` `` (`src/data/modSchema.ts:1409`). `seedRecordsFromHistory` only keeps
rows whose club name matches a real club — so **none of it matched**:

- Montreal's 16 franchise records were silently dropped, and
- **all 24 Montreal Stanley Cups were missing from the seeded record book** — the most decorated
  franchise in hockey did not appear as a champion once.

Normalising the 16 record rows and 59 history fields to "Montreal Canadiens" fixes both. Verified:
a freshly loaded career now seeds **24** Montreal Cups (it seeded 0 before), and Hainsworth's
22-shutout season now sits at the top of the single-season shutouts board.

("Montréal Maroons" was left alone — a defunct franchise, correctly not a current club. The
orphaned "Arizona Coyotes" records were also left alone: the Coyotes' records stayed with Arizona
and Utah already has its own set.)

### Records broken in 2025-26

Every stored single-season franchise record for the 31 NHL clubs that have them was compared
against that club's actual 2025-26 leaders from the NHL public API
(`api-web.nhle.com/v1/club-stats/{abbr}/20252026/2`). Seven were beaten:

| Club | Record | Was | Now |
|---|---|---|---|
| Utah Mammoth | Most goals in a season | 30 Clayton Keller (2024) | **40 Dylan Guenther** |
| Utah Mammoth | Most assists in a season | 60 Clayton Keller (2024) | **62 Clayton Keller** |
| Utah Mammoth | Most wins in a season | 26 Karel Vejmelka (2024) | **38 Karel Vejmelka** |
| Utah Mammoth | Most shutouts in a season | 1 Jaxson Stauber (2024) | **2 Karel Vejmelka** |
| Winnipeg Jets | Most points in a season | 100 Marián Hossa (2006) | **103 Mark Scheifele** |
| San Jose Sharks | Most points in a season | 114 Joe Thornton (2006) | **115 Macklin Celebrini** |
| Vegas Golden Knights | Most PIM in a season | 74 Ryan Reaves (2018) | **89 Jeremy Lauzon** |

The export holds exactly one row per (club, type), so these rows were updated in place rather
than appended, preserving that invariant. Caveat worth stating: this test is *"the 2025-26 value
beats the value stored in this file"*. If a stored record was itself wrong, the comparison
inherits that error — it is internally consistent, not independently audited.

---

## 6. Meta

`meta.season` moved from `"2025-26"` to `"2026-27"`, which is what the file now describes.

---

## What was NOT changed, and why

- **Divisional alignment** — verified unchanged for 2026-27 against the final 2025-26 NHL
  standings (conference/division per club) and the 2026-27 season article. The file already
  matches exactly, including Utah in the Central.
- **Arenas and capacities** — no verified change for 2026-27. The file is already *more* current
  than most aggregators (Benchmark International Arena, Grand Casino Arena, Xfinity Mobile Arena,
  Lenovo Center); one widely-circulated "2026-27 identity guide" blog still lists the old names
  and was discarded as unreliable. Calgary plays its **final** season at the Saddledome in
  2026-27 (Scotia Place opens 2027-28), so no change yet.
- **Rebrands, relocations, expansion, colours** — none for 2026-27.
- **Assistant coaches, scouts, physios, AGMs, owners** — the file has ~1,400 of them and their
  movement is not publicly documented at anything like that granularity. Left untouched.
  (Ottawa and Seattle have *no* assistant GM at all; the loader synthesises one.)
- **`competitions[]` membership** — European promotion/relegation (e.g. IF Björklöven going up)
  was not applied. It would mean moving whole player-bearing clubs between leagues, which
  collides with the player surface, and the promoted clubs are not in the file at all.
- **`clubRecords` for the 147 non-NHL clubs** (AHL/ECHL/CHL/European) — 2025-26 franchise records
  for those clubs are not verifiable at scale from primary sources. Left stale rather than guessed.
- **Rookie and career club records** — the API endpoint used gives single-season totals only, with
  no rookie flag, so those 10 record types were not re-checked for 2025-26.
- **2025 gaps that predate this pass** — the export is missing 2025 rows for the WHL, NAHL,
  Swedish U20 Nationell and the World Juniors, among others. Only 2026 was in scope.
- **Junior-league 2026 champions** for Swedish U20 Nationell, Finnish U20 SM-sarja, Czech DHL
  Extraliga junioru, DNL, BCHL, NAHL and Slovenská Extraliga juniorov — not verified, so not added.
- **NCAA/CHL eligibility** — the rule change took effect 1 August 2025, *before* this export. It
  changes where individual prospects play, not the shape of any league, so nothing structural was
  needed here; the consequences live entirely on the player surface.

---

## Known mechanical caveats (not introduced here — found while verifying)

1. **The 2026 history rows will not appear in the in-game record book yet.** Two different year
   conventions collide:
   - the export labels a season by the year the trophy was won (`2026` = the 2025-26 season);
   - the engine labels a season by its starting year (`career.year === 2025` *is* 2025-26).

   `seedRecordsFromHistory` drops any row with `row.year >= currentYear`
   (`src/engine/story/records.ts:347`), and the loader always starts a career at 2025 because
   `loadModDatabase` is called without `startYear` (`src/worker/sim.worker.ts:47`, default
   `startYear = 2025`). Result: a fresh career's record book runs 1918 → **2024**. The 2025 row
   (Florida) and the new 2026 row (Carolina) are both filtered out.

   The rows are correct and validated; they are simply not rendered yet. **Do not "fix" this by
   loosening the comparison to `>`** — that admits the 2025 row while the career's own first
   rollover also archives a season under year 2025, producing two different seasons with the same
   label. The real fix is to reconcile the conventions (offset imported years by −1 when seeding)
   and/or derive `startYear` from `meta.season`. That is engine work, deliberately out of scope
   for a data pass.

2. **`meta.season` is descriptive only.** Nothing reads it; `startYear` is hard-defaulted to 2025.
   So the file now says 2026-27 while a new career's UI will still label the year 2025-26.

---

## How this was verified

`validateModDatabase` (the strict importer in `src/data/modSchema.ts`) parses the patched 42 MB
file without error, and a career loads, seeds and sims from it. Checked, all passing:

- schema validation clean; `meta.season === "2026-27"`;
- the head coach the engine actually resolves (highest-rated `headCoach` entry) is Hiller / TOR,
  Laviolette / LAK, Babcock / EDM, Craig / VGK, Malhotra / VAN — and still Brind'Amour / CAR,
  Cooper / TBL, Bowness / CBJ, DeBoer / NYI;
- Carolina's affiliate loads; all six replaced retired-number lists land; no club has a duplicate
  retired-number row;
- 26 rows at `year: 2026`; the NHL row reads Carolina / Vegas / Colorado; no `"Montréal
  Canadiens"` rows remain;
- the seeded record book contains **24** Montreal Cups and Hainsworth on top of the shutouts
  board; the seven updated club-record rows read back correctly;
- `new Career(...)` on the real database advances 120 days and plays 200+ games.

Gates on this branch: `npx vitest run --no-file-parallelism` → **2145 passed, 1 skipped, 0
failed**; `tsc --noEmit` → web **434**, node **322**, root **0** — identical to the branch head,
since this pass adds no TypeScript (the patch script is `.mjs` and outside both projects).

To re-verify after re-running the script, drop a throwaway test into `src/data/` — the pattern is
the existing `real imported DB` block at the bottom of `src/data/history-import.test.ts`, which
already guards this file with `it.skipIf(!existsSync(REAL_DB))` and passes against the patched
database.
