# LIVING WORLD — RENEWAL

*Branch `living-world-b`, 2026-09-26. Brief: `docs/depth-audit-2026-09/audit-living-world.md` §2 (player careers), §3 (other leagues), §4 (history & memory).*

The imported world used to be a **snapshot**. Nothing put a 16-year-old into the OHL, J20 or MHL. The junior pool ran dry after two drafts, and every class after that was a faceless synthetic list: 50×50 names with real NHL surnames, no nation, never played junior, dropped into an AHL at 17. The world leagues played a season and then stopped: no playoffs, no champion, no awards. At rollover their standings were zeroed and players' seasons were thrown away.

This branch makes the world **renew itself** and **remember**.

| System | Where |
|---|---|
| Per-nation names and hometowns | `src/data/nationNames.ts` |
| Youth intake (newgens) | `src/engine/world/youthIntake.ts` |
| Junior age-out, NCAA, UDFA, Europe | `src/engine/world/juniorPathways.ts` |
| World playoffs, awards, Memorial Cup | `src/engine/world/worldSeason.ts` |
| World Juniors, Olympics, Nations Cup | `src/engine/world/international.ts` |
| Persistent world history (domain) | `src/domain/worldHistory.ts` (`League.worldHistory`) |
| Career wiring | `career.ts` — the `WORLD RENEWAL` block |
| View + worker request | `src/engine/career/worldHistoryView.ts`, `getWorldHistory` |
| UI | `WorldScreen.tsx` — champions and awards; tournament results |
| Measurement | `src/engine/world/worldRenewal.harness.test.ts`, `advanceProfile.harness.test.ts` |

---

## 1. Youth intake

**When.** Every summer at rollover (`renewWorld`, after `resetWorldSim`), each junior club is refilled toward its target roster (24–25).
- A normal club takes 2–8 new players aged 16–17.
- The **first** summer of a save runs in *bootstrap* mode. The imported DB has almost no 16–17-year-olds (79 seventeen-year-olds in the whole mod), so both cohorts are seeded at once, 4–10 per club, split evenly between 16 and 17. The 17-year-olds are 18 by the next draft, so **draft 2 is already a real class**.
- An old save meets the system the same way: its first rollover bootstraps.

**Where they come from.** Each league has a youth profile (`LEAGUE_YOUTH`): age limit, target, intake ages, a nation mix taken from the DB's own league mixes, and an import share.

| League | Domestic mix | Import share |
|---|---|---|
| OHL | CAN 82 / USA 18 | 8% |
| WHL | CAN 85 / USA 15 | 7% |
| QMJHL | Québec 72 / rest of Canada 22 / USA 6 | 8% |
| USHL, NAHL, NTDP, BCHL | mostly USA | small |
| MHL | RUS 91 / BLR 5 / KAZ 4 | — |
| J20 | SWE 93 / NOR 4 / DEN 3 | — |
| U20 SM-sarja, CZE jr, SVK jr, DNL | domestic | — |

Imports are drawn from real import pipelines: Czechia, Slovakia, Latvia, Germany, Russia, Sweden, and so on.

**Quality.**
- A newgen's hidden ceiling comes from a cohort-quantile curve (`PA_QUANTILES`) anchored to the real imported 2026 class: top pick about 92, 10th about 75, 32nd about 65, class median about 50.
- A per-nation talent multiplier (`NATION_TALENT`) scales each nation's odds of landing in the elite tail.
- Current ability at 16 tracks the ceiling loosely, so late bloomers exist.
- Ratings are synthesised with the importer's own `synthesiseAttributes`. Newgens therefore sit on the same scale as imported juniors and develop through the unchanged development model (`developPlayers` growth ∝ gap to potential, age-scaled).

**Calibration target — the real NHL draft by nationality, 2023–2025 (Wikipedia, "Draftees based on nationality", 2023/2024/2025 NHL entry drafts; 673 picks):**

| Nation | 2023 | 2024 | 2025 | 3-year share |
|---|---:|---:|---:|---:|
| Canada | 86 | 89 | 85 | **38.6%** |
| USA | 50 | 38 | 52 | **20.8%** |
| Sweden | 25 | 22 | 30 | **11.4%** |
| Russia | 20 | 27 | 21 | **10.1%** |
| Finland | 15 | 18 | 8 | **6.1%** |
| Czechia | 7 | 13 | 11 | **4.6%** |
| Slovakia | 8 | 1 | 3 | **1.8%** |
| Belarus | 4 | 3 | 3 | 1.5% |
| Germany | 3 | 0 | 4 | 1.0% |
| Switzerland | 1 | 4 | 2 | 1.0% |
| Norway / Latvia / Denmark / Austria | — | — | — | ~0.4–0.9% each |

The talent multipliers are **not** the raw shares. Each nation's junior capacity in the world is very different: the MHL alone has 38 clubs and the CHL 56. The draft board also weights NHLe-translated production: the MHL's 0.24 NHLe beats J20/U20 SM-sarja at 0.15, which is why raw Russian talent sits well below its capacity share. The multipliers were tuned against the in-game **draft result**, not the cohort.

**Bios.** Every newgen gets:
- a nationality;
- a nation-true fictional name, with correct diacritics (Mäkelä, Dvořáček, Ozoliņš) and Swedish/Finnish/Anglo/Québécois/Russian/Czech morphological surname generators for variety;
- a hometown in the DB's own format ("Örnsköldsvik, SWE", "Kelowna, BC");
- height and weight (nation- and position-adjusted);
- a handedness share by nation;
- a 5-trait personality and a hidden consistency.

Every generated surname is checked against `FAMOUS_HOCKEY_SURNAMES`, about 230 distinctive NHL names, so the game never mints a new Crosby. The shared fictional pool in `names.ts` lost its 17 real NHL surnames. It stays the same length, so the generated league's rng stream is unchanged.

**Fallback classes.** The generated league has no junior leagues. Its prospects now also get a nation, drawn with the real draft shares, plus a nation-true name and a hometown. These come from an id-seeded side rng, so every attribute roll is byte-identical.

## 2. Junior age-out and career paths (`runJuniorPathways`)

At rollover, before the intake:

- **Age-out.**
  - CHL, USHL, NAHL, BCHL and the European U20 loops keep 20-year-old overagers and lose them at 21.
  - The NTDP is U17/U18.
  - NCAA players are out by 24 (age limit 23).
- **The college route.**
  - North Americans aged 19–21 commit to NCAA programs with room (target 26).
  - USHL, NAHL and BCHL kids commit most (College-preference kids at 55% a summer).
  - Since the **NCAA's November-2024 rule change** (effective 2025–26), CHL players keep college eligibility. Major-junior kids now take the route too, less often (12%).
  - Recruits are ranked by ceiling, so the best go to the strongest programs.
- **Undrafted free agents.** Undrafted age-outs rated 52+ sign two-year two-way deals with an **AI** NHL org's AHL affiliate (the college free-agent market). The user's farm is never auto-filled. A news digest names the best of them.
- **Europeans stay home.** Everyone else steps into the strongest men's league in his nation he is good enough for, within 4 of its top-18 average (SHL → HockeyAllsvenskan, KHL → VHL, …). North Americans go to the ECHL and the minors.
- **Leaving the game.** A player good enough for no league leaves pro hockey (`retiredYear`).
- **Drafted players keep their rights wherever they land.**
  - `graduateProspects` now holds NCAA players and Europeans in a men's league until 22, unless they are NHL-ready or rated 60+.
  - CHL/USHL draftees still turn pro at 20, as before.
  - You get news when one of **your** rights-held kids commits, moves on or quits.

## 3. Other leagues that remember (`worldSeason.ts`)

One league is crowned per NHL playoff day, in real calendar order: junior loops first, the KHL last, the Memorial Cup after the three CHL finals. Anything left is crowned at the offseason flush. Games are the real quick-sim with `rules: 'playoff'` and the league's own scoring baseline.

**Formats (simplified from 2024–25):**

| League | Trophy | Field | Series |
|---|---|---|---|
| KHL | Gagarin Cup | 16 | 7/7/7/7 |
| SHL | Le Mat Trophy | 8 | 7/7/7 |
| Liiga | Kanada-malja | 8 | 7/7/7 |
| NL / DEL / Extraliga | national titles | 8 | 7/7/7 |
| OHL | J. Ross Robertson Cup | 16 | 7×4 |
| WHL | Ed Chynoweth Cup | 16 | 7×4 |
| QMJHL | President's Cup | 16 | 7×4 |
| **Memorial Cup** | — | 3 CHL champions + best other CHL club (host) | round robin → semi-final → one-game final |
| USHL | Clark Cup | 8 | 3/5/5 |
| NAHL | Robertson Cup | 8 | 5/5/5 |
| BCHL | Fred Page Cup | 4 | 7/7 |
| NCAA | national championship (16-team single elimination) | 16 | 1/1/1/1 |
| MHL | Kharlamov Cup | 16 | 5/5/7/7 |
| European U20 loops | titles | 8 | 5/5/5 |
| ECHL | Kelly Cup | 16 | 7×4 |
| VHL | Petrov Cup | — | — |
| Any other league | generic title | top 8 | 5/5/7 |

**Awards per league.** MVP (the scoring race weighted by team success, and an elite goalie can steal it), scoring champion, top goaltender, rookie of the year (no prior season in that league), and playoff MVP.

**What persists** (`League.worldHistory`, which rides the leagueData serialization; no snapshot change):
- A season record per league: champion, runner-up, final score, regular-season winner, award slate.
- Single-season **league records** (points, goals). A break after a league's first three seasons is news plus a `recordBroken` chronicle entry.
- **Honours** on player profiles: every man on a champion's roster gets the trophy, plus the individual awards. These are `scope: 'world'`, so the NHL History awards tab stays the NHL's.
- **Careers.** Every player's world-league season is archived into `careerHistory` (the imported DB's own row shape, newest first) when his league's postseason resolves. A rollover sweep catches the rest. Profiles, biographies and the draft board's "last season" read it with no further changes, and NHL totals still filter by league label. The world sim now credits goalie W/L/OTL/SO to each side's busiest netminder, so archived goalie seasons are complete.
- News: a champion story for the major leagues, or any league where one of **your** prospects lifted the trophy. Plus a `championship` chronicle event.

## 4. World Juniors and best-on-best (`international.ts`)

| Event | When | Format |
|---|---|---|
| **World Juniors (U20)** | first match day ≥ Dec 26 (day 87) | 10 nations by U20 pool strength; two serpentine-seeded groups of five; round robin (IIHF 3-2-1-0 points); top four per group → quarter-finals (A1–B4 …), semis, bronze, gold |
| **Winter Olympics** | seasons 2025, 2029, … (Feb 2026, 2030), first match day ≥ day 131 | 12 nations; three groups of four; rank 1–12; top four bye, 5–12 play qualification; QF, SF, bronze, gold (the Milan-2026 format) |
| **Nations Cup** | seasons 2027, 2031, … | Mid-cycle best-on-best modelled on the Feb-2025 four-nation event: top four nations, round robin, final, no bronze. Generic fictional name. |

**Squads.**
- `selectNationalTeam`: 14 F / 8 D / 3 G, healthy players, every club in every league.
- The U20s exclude NHL regulars (clubs keep them). AHL, junior, college and European kids are all eligible.
- Games are the real quick-sim between national teams built with `repairLines`.

**NHL pause.** In an Olympic or Nations Cup season the NHL calendar opens a 17- or 10-day break from day 131. Game ids, and so every seed, are unchanged. It is applied to rollover-built schedules and to a fresh mod career's opening season.

**What a tournament produces.**
- Medals and final standings, the final line, MVP, top scorer, best goalie, an all-tournament team (G, 2 D, 3 F) and the top-10 scorers.
- Every player's line, stored in the record.
- Players' `intlApps/intlGoals/intlAssists`.
- Medal and award honours (`scope: 'intl'`).
- Injuries, which are real `injuryStatus` with news when they hit your org.
- **Scouting and draft stock.**
  - Your scouts attend the World Juniors: every participant is known to at least knowledge 45, standouts to 70.
  - Standouts gain world and current reputation.
  - Draft-year standouts get a value-point **stock bonus** on every draft board: MVP +8, all-star +6, top-10 scorer +3.
- **Senior selection beats.**
  - Your players who make a roster: morale +4 and a news item.
  - Your players who were within 3 of the squad's weakest pick at their position and were left home: a **snub** item and morale −4.
  - Medallists: morale +5 (gold) or +2.
- A tournament story with **your players' lines called out**, and a `championship` chronicle event.
- The annual spring World Championship stays. Its old "Olympics every `year % 4`" instant-medal branch was retired, because the Olympics are now real.

## 5. History and memory

- **Hall of Fame is position-aware** (`hallOfFameWorthy`, `records.ts`). The old bar was 900 points for everyone, so no goalie could ever be inducted.
  - Goalies become legends at 200 wins or 450 games, and enter the Hall at 350 wins, 250 wins with a Vezina-type award or 2 Cups, or 200 wins with 2 top-goalie awards.
  - Defencemen become legends at 300 points, and enter the Hall at 600 points, 450 with a top-defenceman award or 2 Cups, or with 2 top-defenceman awards.
  - Two MVPs is automatic.
  - Retirement copy for goalies reads wins and shutouts.
- Chronicle writers added: world champions, the Memorial Cup, WJC/Olympic/Nations Cup medals, and world league records.
- **Retirement chronicle.** The retirement chronicle event was added on improve-loop by Season Wrapped, so it is deliberately **not** duplicated here. `registerRetirements` already carries the career summary, now position-aware.

## 6. Measured results

**Harness.**
```
WR_RUN=1 WR_SEASONS=10 npx vitest run src/engine/world/worldRenewal.harness.test.ts
```
It runs seed 2029 on the imported 32-team league. The baseline is improve-loop @ a3a9ac3 on the same harness.

### Draft classes (top 224 of each class)

**Generated placeholders.**
- Baseline: every class from 2026 to 2034 was 224 of 224 placeholders, with nationality "?".
- World Renewal: none. Every class after 2025 is made of intake-grown kids who have played 2+ junior seasons.

**Distinct surnames per class.**
- Baseline: 47–50.
- World Renewal: **197–207**.

**Nation mix, % of picks.** World Renewal is the 2026–2034 aggregate (2,016 picks). The baseline classes had no nationality, so they have no mix.

| Nation | World Renewal | Real NHL 2023–25 |
|---|---:|---:|
| Canada | 42.8 | 38.6 |
| USA | 20.9 | 20.8 |
| Sweden | 11.3 | 11.4 |
| Russia | 9.5 | 10.1 |
| Finland | 6.3 | 6.1 |
| Czechia | 4.3 | 4.6 |
| Slovakia | 1.3 | 1.8 |
| Switzerland | 0.8 | 1.0 |
| Germany | 0.8 | 1.0 |
| Belarus | 0.6 | 1.5 |

**First-round (top 32) mix, World Renewal:** Canada 49, USA 17, Sweden 11, Russia 9, Finland 4.5, Czechia 4.2.

**Ceiling** (#1 / #10 / #32 / class median):

| Source | #1 | #10 | #32 | Median |
|---|---|---|---|---|
| Imported 2025 class (the real one) | 93 | 76 | 65 | 49 |
| Baseline synthetic classes | 95–97 | 86–90 | 78–81 | 59–62 |
| World Renewal classes | 83–97 | 70–82 | 61–69 | 51–56 |

Every baseline synthetic class was far richer than the real one. World Renewal classes vary from year to year and sit close to the real class.

Canada runs about 4 points hot, and Slovakia and Belarus a little cold. The only knob is the talent table in `youthIntake.ts`.

### Junior leagues after 10 seasons (average roster, ages)

| League | Baseline 2034 | World Renewal 2034 |
|---|---|---|
| OHL | **0** (emptied by 2030) | 23.8 — 16:88, 17:85, 18:96, 19:106, 20:53 |
| WHL / QMJHL | 0 | 23.9 / 24.0, same even age spread |
| MHL / J20 / U20 SM-sarja | aged into 23–25-year-olds, then emptied | 24.8 / 24.0 / 23.6, ages 16–20 |
| NCAA | aged 24–30 | 21.6, ages 19–23 |
| USHL / NAHL | emptied | 22.9 / 18.8 |

Every simulated league crowned a champion every season: 22 records a year, including the Memorial Cup. Over the run the world played 10 World Juniors, 3 Olympics (2026, 2030, 2034) and 2 Nations Cups.

A second, independent 10-season run on the final code (`WR_TAG=final`) reproduced the draft figures above exactly: the same nation mix to one decimal, 197–207 distinct surnames per class, and #1 / #10 / #32 / median ceilings of 83–97 / 70–82 / 61–69 / 51–56.

### Daily-advance cost

Machine note: the box was shared with other sessions' sims throughout, so absolute ms/day swing 3–5× between runs. Only numbers taken **concurrently, under the same load**, are compared.

- **Same world, same season (2025, imported snapshot).**
  - Concurrent 10-season harness runs: World Renewal 1,831 ms/day vs baseline 1,993 (−8%).
  - Concurrent profile runs (`advanceProfile`, 80 days): 853 vs 758 (+13%). The difference sits in methods this branch does not touch (`teamOf`, `practiceAttributeBias`), so it is load noise.
  - An earlier quiet pair: 214 vs 233 (−8%).
  - **Parity, within about ±10%.**
- **Steady state (2026–2029).**
  - Concurrent harness: World Renewal is +14%, +33%, +30% and +25% per season.
  - Concurrent profile at 2028: 515 vs 375 ms/day (+38%).
  - Nearly all of the gap is `finishDay`'s own body, which is the world quick-sim. The baseline's junior leagues are emptying by then: the OHL is at 0 by 2030, and a club with no roster plays no games. So the baseline gets cheaper by losing its world.
  - The scouting methods shift but net out. `surfaceScoutFinds` is −83 ms/day, while `emitScoutDigest` and `getScouting` are about +40.
- **Against its own first season, World Renewal does not grow.** Within one run, the ms/day of seasons 2–10 stays at or below season 1 (for example 841 → 520 in the `renewAB` run), because pruning keeps the world at about 12–16k players.
- **Special days.** The World Juniors day and the Olympic day each simulate one tournament of 28–30 quick-sim games plus squad selection over the whole world. That is a one-day spike, on at most two days a season.

Verdict: against the same world, the per-day cost is within the ~10% budget. Against a baseline whose junior leagues have died, it is +25–38%. That extra is the cost of those leagues still playing hockey. The cheapest further cut is in pre-existing code, not the renewal: `teamOf` is a linear scan over about 700 teams and costs 17–71 ms/day, and `emitScoutDigest` builds the whole `getScouting()` view just to read `.scouts`. Both are left for a perf pass because they are shared with other branches.

### Save size (gzip, `exportSnapshot`)

| Season end | Baseline | World Renewal |
|---|---:|---:|
| 2025 | 6,894 KB | 7,437 KB |
| 2027 | 7,521 KB | 7,154 KB |
| 2029 | 8,103 KB | 7,729 KB |
| 2034 | — (the harness GM can't field a goalie after 2029 on the baseline) | 9,885 KB |

- **Growth.** About +270 KB a season over ten seasons (+33% total). The baseline grew about +300 KB a season over its five.
- **Why.** The growth is careers and history: 116,886 archived `careerHistory` rows by 2034, plus world champions, awards and tournament box lines. It does not come from population. `pruneWorldWashouts` holds the world at 12.3k–16.0k players; without it the intake would add about 1,100 a year.

### Autopilot gate

`AP_RUN=1 AP_SEASONS=10` on the modded 32-team league (seed 2029). Before the fix below the run finished 0 critical / **2 major**: "NHL roster size 27/31 outside 18–26" at the 2034 and 2035 openers.
- **Cause.** `assignRosters`, the rollover roster sort, trimmed without regard to position. The autopilot GM had signed a lopsided roster: five goalies, ten D and eight F, from a deeper renewed free-agent market. The trim sent the worst forwards down, and the minimum-fill pulled four forwards straight back up, which left the club at 27.
- **Fix.** The trim now never takes a group below its legal minimum, and it runs again after the pull-ups.
- **Result.** After the fix: 10/10 seasons, **0 critical / 0 major** and 151 minor issues.

The full suite is green apart from the known heavy-sim timeouts under parallel load (`rules`, `goaliePull`, `scoreEffects`). Those pass in isolation.

## 7. Contracts and compatibility

- **Frozen contracts untouched.** `views.ts`, `events.ts`, `rendererContract.ts` and `protocol.ts` changed only additively: a new `getWorldHistory` request and `worldHistory` response, backed by the new `WorldHistoryView` in its own file.
- **Old saves.** `League.worldHistory` is optional and created lazily. The first rollover after load bootstraps the intake. World goalie decisions start accruing on the totals objects, which persist through the existing `worldTotals`.
- **Additive fields.** Optional fields added: `AwardRecord.scope`, `LegendRecord.position/careerWins/careerShutouts`, `RetirementEntry.position/careerWins/careerShutouts`.
- **Determinism.** Everything runs through `rngFor(WR_NS, …)` or `deriveSeed(seed, …)`, and tournament and playoff games use `gameSeed` namespaces distinct from the NHL, AHL and world regular season.

## 8. What's left

- The World Juniors, Olympics and Nations Cup are instantaneous. Junior clubs do not lose their stars for two weeks, and European leagues do not pause for the Olympics.
- World clubs still do not re-sign or budget (audit §3, next step). Rosters are built by intake, pathways and the world free-agent sweep.
- League strength (NHLe) is still a constant table. The next step is to recompute it yearly from roster quality.
- No real rights-expiry rules yet (CHL draftees must sign within two years, and Europeans' rights last four under the current CBA).
- No mid-career moves to Europe or the KHL for money (audit §2).
- Swiss, Austrian and Danish youth have no domestic junior loop in the DB. They enter via DNL/J20 imports, so Switzerland is under-represented in drafts.
- The user cannot yet loan an NHL teenager to his World Juniors team.
- The 2034 census shows 3 players flagged retired but still on a roster (out of 16k). This is harmless, because they simply keep playing. The cause has not been traced.
- Performance: `teamOf` (a linear scan over every team) and `emitScoutDigest` (builds the full scouting view) are the cheapest daily wins. Both are pre-existing, see §6.
