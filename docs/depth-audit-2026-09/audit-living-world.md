# Audit — THE WORLD WITHOUT THE USER
*Read-only audit of `K:/Hockey Game` @ improve-loop, 2026-09-26. Scope: does the hockey world run itself convincingly?*

Scores are 0–5 on **Aut**onomy (the world acts on its own) · **Real**ism vs NHL · **Cont**inuity/memory · **Vis**ibility (does the user see it) · **Emer**gence · **Var**iety.

## TL;DR

The world **moves**: AI clubs trade with each other, sign free agents, draft, fire coaches, and 20+ feeder/European leagues simulate every match day. But most of that motion is **one rule per system, keyed to a single variable**, and a lot of the "character" layer is **decorative**:

- **GM personas are decoration.** Seven persona axes exist. Only `aggression` changes AI behaviour, and only for offers made *to the user*. AI-to-AI trades, AI free agency, the AI draft and AI re-signing never read a persona.
- **Posture comes from one formula.** It is computed from strength rank in thirds plus core age, so a third of the league is always "contending" and a third is always "rebuilding".
- **The economy stops binding.** Contract asks are in absolute dollars while the cap compounds 4.5% a year. By the mid-2030s the cap is no longer a real constraint on anyone. This is the most likely root cause of the 7-Cup autopilot dynasty.
- **The feeder world has no future.** There is no youth intake. The imported junior pool runs dry after about 2–3 drafts. Every draft class after that is a fictional placeholder (generic 50×50 name pool, no nationality, never played junior) dropped straight into an AHL at 17.
- **Other leagues forget.** They have live standings but no playoffs, no champions and no awards. World season stats are never archived. At rollover, the world's past is deleted.
- **The biggest story in the league is misreported.** Each spring, a tentpole article announces that the **user's** club "are champions", whoever actually won (confirmed in trace for 2025–2027).

---

## 1. AI club management

**What FM/EHM do.** FM AI clubs run from a board/club vision (win now, develop youth, sign to sell). They hold transfer budgets, sack managers, and appoint successors from a real market of staff who carry reputations. EHM exposes GM-level cap/contract management for every club, and all AI clubs live under the same cap and roster rules the human does (EHM manual digest in memory: `reference_ehm-gm-mechanics.md`).

**What we have.**
- **Personas.** `buildGmPersona` (`src/engine/league/gmPersona.ts:55`) gives 7 axes plus a styleLabel. These are lazily built and persisted (`career.ts:14609`).
- **Posture.** `deriveClubPosture` (`gmPersona.ts:117`) is a pure function of strength rank in thirds and top-6 age.
- **AI-to-AI trades.** `generateAiAiTrade` (`trades.ts:1787`) is called daily in the regular season up to the deadline (`career.ts:6464–6479`: 2/4/7/12 attempts), plus a 10-attempt deadline-morning flurry (`career.ts:14918`). There is a ramp toward the deadline, plus retention (#157) and a "pick + prospect" return.
- **AI free agency.** `aiFreeAgencyDay` (`contracts.ts:477`) picks the club with the biggest positional deficit, breaking ties on cap space. Rebuilders are barred from expensive UFAs and contenders get a scoring nudge.
- **AI re-signs.** `aiResignDay` (`contracts.ts:410`) keeps anyone with overall ≥55 or anyone needed for position minimums, at his full ask.
- **AI roster shape.** `farmSplit` (`farmReassign.ts`) is a yearly sort by current overall, plus `emergencyRecalls` (`career.ts:5952`).
- **Coach carousel.** `coachCarousel.ts` handles mid-season (capped at 3) and offseason firings driven by projection-vs-result. This part is genuinely good.

**Placeholder check.**
- **Persona axes are mostly dead.** Grepping for persona fields shows:
  - `aggression` is read only by `generateAiOffers` and `solicitOffersForPlayer`, i.e. offers made *to the user*.
  - `patience`, `pickHoarding` and `analyticsLean` reach only user-facing negotiation (`personaPhilosophy` at `career.ts:13147/13320/13675`, and `tradeThread.ts:61`).
  - `capDiscipline` and `loyalty` (as GM axes) are read **nowhere** except LLM/voice fact sheets (`voices.ts:724–729`).
  - The file itself says the mapping is "NOT wired yet — LW3 swaps…" (`gmPersona.ts:150`). For AI-to-AI behaviour, that is still true.
- **Hash-based philosophy is still live.** `teamPhilosophy(teamId)` (`trades.ts:449`) is still the default in `buildTeamProfile` and in the offer paths at `trades.ts:1149/1524/1687`.
- **AI-to-AI trades have one shape only.** A seller's single best veteran (≥26, ≤2 years remaining, **never a goalie**) goes for 1–2 picks, optionally plus a prospect.
  - No hockey trades (player for player).
  - No buyer positional need: the buyer filter is only posture, roster size under 23 and cap.
  - No **offseason or draft-day AI trades at all**: both call sites are gated on `regularSeason && day <= deadlineDay`. Real NHL summers (draft floor, July 1) carry a large share of the year's trades.
- **AI GMs are immortal.** `gmChange` is a chronicle kind, but nothing ever emits it. `sinceYear` is set to the career start year for every GM, so "tenure" never differs between them. A GM whose club finishes last 20 years running keeps his job.
- **Offer sheets are wrong in both directions** (`career.ts:11655`):
  - They target only the **user's** RFAs.
  - A 78+ RFA "always" draws one.
  - The suitor is `rivals.find(...)`, i.e. the first club in array order with cap room.
  - AI clubs' RFAs are never sheeted.
  - Real NHL: 4 players changed teams via offer sheet in the whole cap era; 2024 was the first since 2021 ([Daily Faceoff](https://www.dailyfaceoff.com/news/a-brief-history-of-offer-sheets-in-the-nhls-salary-cap-era), [Wikipedia](https://en.wikipedia.org/wiki/Offer_sheet)).
- **The AI draft is persona-free.** `teamDraftBias` (`career.ts:8587`) is a ±2.5-rank FNV hash nudge plus positional need. `riskTolerance` and `analyticsLean` are ignored.
- **AI roster management is one sort.** Promotion and demotion are a yearly current-overall sort. A rebuilding club does not play its kids, and there are no waivers for AI demotions.
- **Replacement coaches come from nowhere.** `applyCoachFiring` (`career.ts:16954`) creates the new coach with `generateTeamStaff(rng)`. He is not hired from the coach market, fired coaches are never recycled, and nothing is written to the chronicle (a `coachFired` kind exists but is never recorded; it goes to the ledger as a `'signing'`).

**Frequency sanity check (estimate from the code; not measured).**
- Base rate is 2 attempts × 1/9 a day for about 110 pre-ramp days, then about 1/day over the final 20 days.
- Deadline day: about 4–5 from the tick plus about 4 from the morning flurry.
- Rough totals: about 8–9 deadline-day deals and about 40–55 in-season, if sellers and buyers are always available (they won't be). Zero in the offseason.
- Real NHL: 24 trades on 2025 deadline day and ≥17 every deadline for 10 years ([ESPN](https://www.espn.com/nhl/story/_/id/48121473/nhl-trade-deadline-deals-10-years)), plus a heavy offseason.
- **Nobody measures this.** The autopilot tracks only the user's club (`autopilot.ts`).

**Coherence over 10–25 seasons.** No harness measures AI rosters: cap, goalie tandems, age curve or depth. The autopilot checks league W/L balance and the user's roster only. See §7 for the cap drift, which makes AI cap coherence meaningless after about 2032.

| Aut | Real | Cont | Vis | Emer | Var |
|---|---|---|---|---|---|
| 3 — trades, FA, draft and coach churn all happen unprompted | 2 — one trade shape, no summer market, offer sheets inverted | 2 — GMs never change; coach changes unchronicled | 3 — wire, deadline feed, "Frenzy" roundups, GM voices | 2 — posture thirds produce stable, predictable roles | 1 — persona axes don't change what AI clubs do |

**Root cause.** LW2 built the cast and LW3 wired **posture only**. Behaviour functions accept `postureOf`/`aggressionOf` callbacks instead of a persona, so every new behaviour must thread a new callback and none ever did. There is no league-wide measurement arm, so nothing flags the gaps.

**True-depth spec.**
- **Smallest genuinely-deep version (M).**
  - Pass `GmPersona` (not callbacks) into `generateAiAiTrade`, `aiFreeAgencyDay`, `aiResignDay` and `aiSelectProspect`, with one knob each:
    - `pickHoarding` → the return mix;
    - `capDiscipline` → FA max AAV as a share of room;
    - `loyalty` → re-sign threshold for own draftees and veterans;
    - `riskTolerance` → draft variance on high-ceiling picks;
    - `patience` → posture hysteresis, so a patient GM stays in a rebuild for N seasons.
  - Posture reads board pressure and last season's result, not just strength thirds.
  - Add need-aware buyers, goalie trades, 1-for-1 hockey trades, and a draft-floor plus July AI trade window.
  - Add AI GM firings on the same heat model as coaches (reuse `coachCarousel.seatHeat`), with a replacement persona and a `gmChange` chronicle entry.
  - Add AI-to-AI offer sheets at about 0–1 per year league-wide, and cut user-targeted sheets to a probability instead of a certainty.
- **League-health harness (S).** Per season, record AI-to-AI trade count (in-season, deadline day, offseason); cap %, roster size, goalie count and mean age per club; and GM and coach turnover. Assert NHL bands.

---

## 2. Player careers across the world

**What FM/EHM do.** FM runs an annual **youth intake** per club and nation. Newgens are generated with nation-specific youth ratings, name pools, faces, and personality shaped by the Head of Youth Development ([Passion4FM youth-intake guide](https://www.passion4fm.com/youth-intake-guide-how-clubs-produce-newgens/), [intake dates](https://www.passion4fm.com/football-manager-youth-intake-dates/)). EHM seeds new players into junior, college and European leagues every year, so the draft always has a real, playing class.

**What we have.**
- **Development and retirement are strong.** In-season and offseason development is NHLe-weighted across every tier (`worldSim.ts:171` `combinedDevProduction`; `leagueStrength.ts`). The retirement model (`offseason.ts:520`) is multi-factor: age hazard × ability × contract × games played × production × ice time × injury, with a taper.
- **Washout exists for tweeners** (`offseason.ts:582`).
- **World free agency.** NHL leftovers sign home-nation first, into the strongest league with room (`worldFreeAgency.ts`). This produces "heads overseas to the KHL" news.
- **Draft.** The real draft uses imported juniors, NHLe-production-aware (`career.ts:7908`).

**Placeholder check: the newgen cliff (critical for any save over about 3 seasons).**
- **No youth intake anywhere.** The only code that creates players over time is `generateDraftClass` (`career.ts:7925`, the sole `playerCounter++` site).
- **The imported pool runs out.** It is used only while `realDraftEligibles()` ≥ 32×7 = 224 (`career.ts:7911`). Eligibility is undrafted, age 18–19 (`career.ts:1742`).
- **Mod DB counts** (`mods/nhl-ehm/database.json`, undrafted players in non-NHL/AHL competitions, by age):

  | age | undrafted players |
  |---|---:|
  | 17 | 79 |
  | 18 | 561 |
  | 19 | 1154 |
  | 20 | 1318 |

  Draft 1 is rich. Draft 2 draws from about 640 minus picks. **By about draft 3 the pool drops below 224**, and the game silently switches to fully synthetic classes for the rest of the save. *(Inferred from code plus DB counts; confirm with a 4-season run.)*
- **Synthetic prospects are placeholders** (`offseason.ts:780` `makeProspect`):
  - Names come from one global 50×50 pool (`src/data/names.ts`) that mixes "Dmitri", "Gallagher" and "Sven". It also contains **real NHL surnames** (Crosby, Tavares, Zetterberg, Forsberg, Koivu, Stastny), which conflicts with CLAUDE.md principle 5, fictional by default.
  - They have **no nationality, birthplace or face**, and every one is 17–18.
  - They belong to no junior team, so they have no production history for the draft board.
  - A drafted synthetic goes **straight onto the NHL or AHL roster at 17** (`career.ts:8426–8431`); an undrafted one plays nowhere.
- **Junior and college leagues age into ruin.** Nothing injects 15–16-year-olds, and nothing enforces a junior age-out (`upperAgeLimit` is read only by the world FA sweep, `worldFreeAgency.ts:89`). World rosters refill only from the FA pool, strongest leagues first, so the OHL, J20 and MHL either empty out or fill with over-agers.
- **World season stats are never archived.** `archiveSeasonStats` (`career.ts:8706`) writes NHL and AHL lines only. `resetWorldSim` (`career.ts:9052`) clears `worldSim.totals`. A drafted OHL star's 110-point season vanishes from his career page after the summer (only imported `careerHistory` survives).
- **Movement is thin.** Europe to NHL happens only through contract expiry into the FA pool. NHL to Europe happens only as a leftover sweep. No player *chooses* the KHL for money or ice time, no European star is courted mid-career, and there is no NCAA free-agent signing season.

| Aut | Real | Cont | Vis | Emer | Var |
|---|---|---|---|---|---|
| 3 — aging, development, retirement and world FA all self-run | 2 — excellent early, then the regen cliff makes drafts fictional | 2 — world-league seasons erased from careers | 2 — prospect views read live world stats; history does not | 2 — breakouts and busts arise, but future classes are faceless | 1 — newgens are homogeneous: one name pool, no nations |

**Root cause.** The multi-league import was designed as a **snapshot** of a real world. It has no **renewal** mechanism (no intake), and the synthetic fallback predates the world and was never upgraded to live inside it.

**True-depth spec.**
- **Annual youth intake (M).**
  - Every summer, each junior, NCAA and European club receives N newgens aged 15–17.
  - Nationality comes from the club's nation (≈80% domestic, ≈20% import, per the DB's own mix).
  - Each nation has a youth-rating table (seed it from the DB's average junior potential per nation).
  - Names come from per-nation name pools (fictional, built from syllables or curated). Remove the real NHL surnames.
  - Face and personality are generated too.
  - The draft then always draws from real, playing prospects, and `generateDraftClass` becomes a dead fallback for leagues with no competitions.
- **Junior age-out and NCAA eligibility (S).** Over-agers leave junior at rollover for pro, Europe or college.
- **Archive world seasons into `p.stats` with `league: abbrev` (S).**
- **Stretch (L): a regen/newgen "Shades of" link.** The comp system already exists, so you can see "a newgen from Timrå who plays like Forsberg".

---

## 3. Other leagues (multi-league world)

**What FM/EHM do.** Every playable or simulated league has fixtures, playoffs, champions, awards, leading scorers, history pages and promotion or relegation. EHM's nation-overview screen lists top leagues, clubs and players per country ([Steam page](https://store.steampowered.com/app/301120/Eastside_Hockey_Manager/)).

**What we have.**
- `simWorldDay` (`worldSim.ts:123`) quick-sims every `simulated` competition's schedule. Live standings, per-player totals and injuries are updated.
- League-scoring normalisation is applied.
- There is a World tab with clickable teams and scorers (`career.ts:19889`).
- 22 competitions are imported, and `defaultTier` (`leagueWorld.ts:41`) makes about 20 of them `simulated`.
- The AHL separately has real playoffs (`farmPlayoffs.ts`). There is a World Juniors event and an annual World Championship (`tentpoles.ts:913`).

**Placeholder check.**
- **No playoffs, champion, awards, or all-star team for any world league.** There is no archive either. `resetWorldSim` zeros standings and results each summer (`worldSim.ts:95`), so a KHL "season" ends with no Gagarin Cup, and next year there's no record it happened.
- **League strength is a constant table** (`leagueStrength.ts:42`). If the KHL is bled of talent by the FA sweep, or the SHL is loaded, its NHLe never moves. It is coherent but static; nothing measures a league's actual roster quality over time.
- **World clubs cannot manage themselves.**
  - They have `salaryCap: 0` (`modSchema.ts:1830`), no staff and no coach (`headCoachId: null`), and no posture.
  - `aiResignDay` iterates world teams too, but the `prospective > salaryCap(0)` test means **world clubs never re-sign anyone**. Every expiring contract goes back to the pool and is redistributed by the sweep.
  - European rosters are therefore reshuffled every summer by an allocator, not built by clubs.
- **"Background" leagues** (level ≥2, reputation below 13) are navigable shells with no schedule.

| Aut | Real | Cont | Vis | Emer | Var |
|---|---|---|---|---|---|
| 3 — ~20 leagues play every match day | 2 — plausible scoring, but no playoffs, no club behaviour, allocator rosters | 0 — nothing survives rollover | 2 — World tab shows live tables and scorers | 0 — no champions means no stories ("Frölunda three-peat") | 1 — every league behaves identically |

**Root cause.** The world was built as a **development substrate** for NHL prospects (NHLe production), not as a set of competitions with their own stakes.

**True-depth spec.**
- **Smallest deep version (M).**
  - Top-N playoffs per simulated league, reusing `farmPlayoffs` bracket code.
  - Archive `{competitionId, year, champion, standings top-3, scoring leader, top goalie}` into `recordsState.worldSeasons`.
  - Add one "notable abroad" wire item per champion. Name trophies generically ("the {league} title").
  - Archive player lines (§2).
- **Next step (M).**
  - World clubs get a minimal budget model: a strength-scaled payroll pool.
  - They re-sign keepers so rosters have continuity, and they get a coach.
  - League strength becomes dynamic: recompute NHLe yearly from actual mean roster rating relative to the NHL.

---

## 4. History & memory

**What FM does.** Club and competition history pages, all-time records, legends, a Hall of Fame, and "On this day"-style news. Newgens are compared to legends.

**What we have.**
- **World Chronicle** (`chronicle.ts`): append-only, with durable kinds kept forever (`:144`), head-to-head, and provenance.
- **Records** (`records.ts`): single-season and career boards, a season archive (champion, Presidents' Trophy, leaders), awards, retired legends, and a Hall of Fame 3 years after retirement (`:934`).
- **Real history seeding** from the DB (Gretzky, 24 Habs Cups). Franchise championship pedigree (`career.ts:22131`), rivalries with decay (`rivalries.ts`), and a revenge-game pregame line (`career.ts:15554`).

**Placeholder check.**
- **Several chronicle kinds are declared but never recorded.** Grepping `chronicleEvent(` call sites shows **retirement, coachFired, coachHired, gmChange, majorInjury, recordBroken, debut and waiverClaim are never written**. Only trade, signing, draftPick, release, award, playoffSeries, championship, promise and user match moments are recorded. The durable list promises memory the game doesn't collect.
- **Documented query APIs are dead code.** `tradesBetween` and `pickBecame` (LW4 "the 2nd you gave up became…") are exported (`chronicle.ts:350/360`) but **never called** outside tests. There are no trade retrospectives for anyone.
- **"On this day" is user-centric.** It fires only for events that involved the user or were championships (`career.ts:6304`).
- **The Hall of Fame is points-only.** A skater needs 900 career points or a points/goals record (`records.ts:420/958`). **Goalies and defensive defencemen can never be inducted.** Career boards also exclude goalies (`records.ts:639`).
- **Retired numbers are import-only** (`views.ts:3805`). No club ever retires a number during a save.
- **The transaction ledger is a rolling 300 entries** (`leagueStats.ts:194`). One July of league-wide signings flushes it. The chronicle keeps only signings of overall ≥75.
- **The season archive is thin.** It stores champion, Presidents' Trophy and three leaders. There are no standings snapshots, no playoff brackets and no award finalists, so "what happened in 2029" (Gap #17) has little to read from.

| Aut | Real | Cont | Vis | Emer | Var |
|---|---|---|---|---|---|
| 3 — records, HOF and rivalries accrue unaided | 3 — record logic careful (book-at-season-start); HOF skater-only | 3 — durable chronicle and H2H exist; key kinds never written | 3 — History screen, legends, pedigree, revenge lines | 2 — memory is there but rarely queried for league stories | 2 — HOF/records single-axis |

**Root cause.** LW1 built the substrate, but the writers that should feed it (retirement, carousel, records, injuries) were added later and never chronicle. LW4 ("ripples") shipped only revenge games.

**True-depth spec (S–M).**
- Chronicle every retirement, coach and GM change, record break, major injury and debut.
- Snapshot final standings plus the playoff bracket into the season archive.
- Make the HOF position-aware: goalie wins or save percentage, defence with a points bar of about 550 plus awards, and weight Cups and major awards.
- Add AI clubs retiring numbers for franchise legends (games with club ≥800, or HOF plus a long tenure), with a ceremony news item.
- Wire `pickBecame` and `tradesBetween` into +1y/+3y trade retrospectives for *league* trades too ("Who won the Rantanen deal?").

---

## 5. The world's voice

**What FM does.** News covers the whole game world: other clubs' sackings, transfer sagas and title races. There are journalists with beats, and headlines about leagues you don't play in.

**What we have.**
- **Salience engine** (`salience.ts`): deviation from recorded expectations. League-wide arcs include cinderellaTeam, collapseTeam, rookieRace, goalieDuel and milestoneWatch (`arcs.ts`).
- **Other feed content:**
  - ambient streak pools (`ambientNews.ts`);
  - pundits;
  - club, player and GM accounts on the Feed (THE-FEED-V2 F5);
  - coach-carousel headlines;
  - the deadline wire;
  - the July "Frenzy" roundup;
  - notable world FA signings;
  - awards, HOF and records.

**Placeholder check.**
- **BUG: the championship tentpole writes the USER's club as champion every year.**
  - `queuePressJob('champion', …)` (`career.ts:7328`) builds a fact sheet whose `team` is the user's club (`factSheet.ts:204` just clamps `pressFactArgs()`).
  - `CHAMPION_BEAT`, `CHAMPION_NATIONAL` and `CHAMPION_HOMER` (`pressFallback.ts:841–892`) print "{team} are champions" / "WE DID IT".
  - The trace confirms it: in 2025, 2026 and 2027 (champions COL, PHI and UTA; Florida missed the playoffs), each season's news contains "Florida Panthers are champions".
  - **The single biggest league-wide event is misattributed.**
- **Scope is deliberately user-first.** Voices cover other clubs only for stars rated ≥82 or major milestones (`THE-FEED-V2.md:143`). The Narrative Engine mandates that beats "trace back to *your actions*" (`NARRATIVE-ENGINE.md:7–12`). That is great for B5.2, but the other 31 clubs get only threshold-triggered one-liners, not threads.
- **Repetition is measured and high.** Over 25 seasons there are 351 minor flavour issues (`summary-latest.md`). "Weekly scouting digest" appears 35 times a season and "X report: X X" 62 times.
- **Rivalry flashes repeat.** In the trace, 3–5 "heated rivalry ignites" / "A rivalry is born" headlines appear every season, often both for the same pair.
- **League events with no voice:** AI trade retrospectives, AI GM job security, other leagues' champions, draft-class retrospectives, and "where are they now" pieces.

| Aut | Real | Cont | Vis | Emer | Var |
|---|---|---|---|---|---|
| 3 — lots of league-wide auto news | 2 — the wrong-champion bug undermines trust; thin non-user threads | 2 — few league stories cite past seasons | 3 — Feed is a first-class destination now | 2 — salience notices in-season deviation, not multi-season arcs | 2 — known repetition problem |

**True-depth spec.**
- **S:** Fix the champion fact sheet. Build it for the champion's club, and give the user a separate "season over" piece when he didn't win.
- **M:** Add a **league desk** with a persistent storyline tracker for non-user clubs (open threads: the "{team} rebuild year 3" watch, a coach on the hot seat, a contract-year star, a GM's big bet). Each thread gets 3–5 beats a season and resolves with a callback. Keep it inside the existing arcs framework, extended with `teamId` ownership.

---

## 6. Emergence — does the game notice long-save stories?

**What exists.** In-season arcs (hot streak, cold spell, breakout, bust watch, cinderella, collapse, rookie race, goalie duel, milestone chase), record-pace watch (rare by design, `records.ts:795`), biography lines with a "dynasty" and "journeyman" framing **for players** (`biography.ts:461/486`), and seeded dynasty pedigree for the fictional past (`records.ts:156`).

**Placeholder check.** There are **no multi-season, league-level detectors**. `dynasty|drought|back-to-back|first cup since` appears only in player biographies and slump copy. The game will not say:
- "{team} win back-to-back Cups";
- "{team}'s 30-year drought ends";
- "last year's champion misses the playoffs";
- "a journeyman on his 6th club leads the league";
- "the {year} draft: redraft";
- "{GM}'s rebuild, year 5".

The autopilot's 7-Cup Florida dynasty would pass without the league or media treating it as a dynasty (nothing in `arcs.ts` keys on consecutive titles).

| Aut | Real | Cont | Vis | Emer | Var |
|---|---|---|---|---|---|
| 2 | 2 | 2 | 1 — nothing surfaces a decade-long shape | 2 — sim produces the raw material (7 Cups) unnoticed | 2 |

**True-depth spec (M).** Add a `seasonStoryDetectors` pass at rollover over the season archive, chronicle and records:
- dynasty and back-to-back;
- title droughts (years since last Cup, seeded history included);
- the champion's hangover;
- a worst-to-first swing;
- journeyman scoring leaders (club count from provenance);
- a draft-class retrospective at +5 years (actual versus draft slot, using `pickBecame`);
- a GM tenure arc.

Each detector writes one tentpole or pundit column and one chronicle entry, feeding Gap #17 (season chronicle page) directly.

---

## 7. Competitive balance — the world pushing back

**Evidence.** The 25-season autopilot on the real imported league, seed 2029 (`docs/autopilot/summary-latest.md`):
- From 2031 on, the simple bot GM finished #1–#8 in points every season.
- It was **#1 or #2 in 13 of 17 seasons** (2032–2049), with **7 Cups** (2033, 2035, 2038, 2042, 2044, 2046, 2047) and 101–124 points every year.
- Cap-era reality: the best dynasties are Chicago (3 Cups in 6 years) and Tampa (2 Cups plus 3 Finals). No club has sustained 17 straight 100-point seasons.
- `trace-latest.json` holds only 3 seasons (champions COL, PHI, UTA, which are fine). **No 25-season league-wide distribution was recorded**, so parity (points SD, distinct champions) cannot be computed from existing artifacts. That is itself a finding.

**Why the world doesn't push back (code evidence).**
1. **The cap stops binding.** This is the dominant cause.
   - `CAP_GROWTH = 1.045` compounds every rollover (`contracts.ts:51`, applied at `career.ts:9017`).
   - `askTerms` (`contracts.ts:169`) prices players in **absolute dollars**: `0.7 + ((ovr−45)/45)^2.2 × 11` $M. That tops out about $14.8M for a 90-overall prime star, with **no cap indexing** (a grep for inflation or cap-ratio terms finds none).
   - Ceiling by year: $104M in 2026, $124M in 2030, $155M in 2035, $193M in 2040, **$286M in 2049**.
   - Past about 2032 a club can hold every star it has plus free agents. No second-contract squeeze, no cap-forced depth exits, no dynasty tax.
   - The **floor** (73.9% of the cap, $212M by 2049) is display-only (`buildViews.ts:1277`), never enforced. The whole league drifts below it.
2. **The AI doesn't adapt to a dominant rival.**
   - Buyers are chosen by strength-thirds posture (`trades.ts:1847`), not by "can we beat the leader".
   - No arms race, no loading up in the leader's conference, and no persona-driven "go for it" when a window opens.
   - AI free agency picks by **positional deficit, then cap space** (`contracts.ts:519–524`), not by talent upgrade. AI clubs don't chase stars to catch up.
3. **Offer sheets can't bite.** They do target the user's RFAs (≥78 always), but with a non-binding cap the user can always match. The suitor is also always the first club in array order with room.
4. **Aging is probably not the issue.** Decline and retirement are multi-factor and well tuned. The user can simply re-buy talent every summer because money is free (autopilot signings: 20–44 in most seasons).
5. **Draft balancing works but is small.** The lottery and worst-first order exist. The champion picks last, but after about draft 3 the classes are synthetic (§2), which blunts rebuild paths for AI clubs too.
6. **The AI can't rebuild efficiently.** Rebuilders sell one veteran at a time for picks. They don't trade young assets, tank deliberately or take on cap dumps for picks (there's no cap pressure to sell dumps into). Their re-signing is "keep anyone ≥55 at full ask".

| Aut | Real | Cont | Vis | Emer | Var |
|---|---|---|---|---|---|
| 1 — no mechanism reacts to a dominant club | 1 — 7 Cups / 17-year 100-point run under a hard cap is un-NHL | 2 — cap growth persists; nothing else accumulates as pressure | 1 — no "can anyone stop them?" narrative, no cap-crunch stories | 1 — dynasty collapse arcs cannot occur | 1 |

**True-depth spec.**
- **S — index the economy to the cap (highest leverage in this audit).**
  - Multiply `askTerms`, the world `worldContract` and ELC/minimum salary by `salaryCap / BASE_CAP` (base $104M, or the $88M vanilla).
  - Ideally, index each player's ask to his **share** of the cap (the NHL pays about 10–13% of the cap to a top star).
  - Enforce the floor for AI clubs in free agency (sign up to the floor; take cap dumps).
  - Pin both with a 20-season test: median AI payroll stays at 85–98% of cap every season.
- **S — league parity harness.** Extend the autopilot to record, every season:
  - all 32 point totals, the champion and the Presidents' Trophy winner;
  - Gini/SD of points;
  - distinct champions per decade;
  - consecutive seasons ≥100 points for any club.

  Target NHL bands: points SD ≈ 12–16, ≥6 distinct champions per decade, no club ≥100 points in more than about 6 straight years (Boston 2013–19 about the upper bound).
- **M — the world pushes back.**
  - Performance-sensitive asks: a contract-year breakout and Cup rings raise the ask; stars on winners demand more.
  - Posture reacts to the table: clubs within X points of the leader at the deadline become buyers, aggressive GMs "go all in" against a champion.
  - AI free agency scores by talent upgrade × posture, not just deficit.
  - AI offer sheets target the best under-cap RFAs anywhere (rare, but aimed at teams that are cap-tight).
  - A "champion hangover": leadership fatigue and morale after a Cup run, tuned by the lever-audit method so it is measured, not felt.

---

## Top 3 recommendations (ranked)

1. **Index the economy to the cap, enforce the AI floor, and add a league-parity and health harness (S, then M).** This is a small change with the biggest effect on realism, the 7-Cup dynasty, AI cap coherence and every trade and FA decision downstream. Measure before tuning anything else.
2. **Renew the world: annual youth intake with per-nation names and quality; junior age-out; archive world-league seasons; world playoffs and champions (M–L).** Without it, the real-world import becomes a placeholder world after about 3 seasons, and every later draft is a faceless generated list.
3. **Make the AI clubs characters and the league a storyteller.** Wire persona axes into AI-to-AI trades, FA, draft and re-signing. Add offseason and hockey trades, AI GM firings (`gmChange`), and chronicle writers for retirement, carousel and records. Add multi-season league detectors (dynasty, drought, hangover, trade retrospectives via the dead `pickBecame` and `tradesBetween`). **First, fix the S-sized champion-tentpole bug** that crowns the user every spring.

**Quick S-fixes found along the way:**
- The champion press bug (`career.ts:7328`, `pressFallback.ts:841`).
- User-RFA offer sheets that always fire on a single first-found suitor (`career.ts:11671–11684`).
- Real NHL surnames in the fictional name pool (`src/data/names.ts`).
- A goalie-blind Hall of Fame (`records.ts:958`).
- Coach firings logged as `'signing'` transactions and never chronicled (`career.ts:16972`).

## Sources
- [ESPN — NHL trade deadline deals over the past 10 years](https://www.espn.com/nhl/story/_/id/48121473/nhl-trade-deadline-deals-10-years) (24 deadline-day trades in 2025; ≥17 every year)
- [Daily Faceoff — history of offer sheets in the cap era](https://www.dailyfaceoff.com/news/a-brief-history-of-offer-sheets-in-the-nhls-salary-cap-era); [Wikipedia — Offer sheet](https://en.wikipedia.org/wiki/Offer_sheet)
- [Passion4FM — Youth intake guide](https://www.passion4fm.com/youth-intake-guide-how-clubs-produce-newgens/); [FM youth intake dates](https://www.passion4fm.com/football-manager-youth-intake-dates/)
- [Eastside Hockey Manager on Steam](https://store.steampowered.com/app/301120/Eastside_Hockey_Manager/)
