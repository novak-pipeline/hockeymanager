# The Living Economy & AI GMs as Characters

*Branch `living-world-a`, September 2026. Brief: `docs/depth-audit-2026-09/audit-living-world.md`
§1 (AI club management) and §7 (competitive balance), `audit-squad-building.md` (AI omniscience),
`docs/LIVING-WORLD.md`.*

The owner's ask: *"put a lot of focus into making the living world a great and in-depth
simulation."* The audit found a world that did not push back. The cap stopped binding by the
mid-2030s, because every price was in fixed dollars while the ceiling compounded. AI payrolls sagged
to about 40% of the cap. There were about 12 trades a season, all of one shape. Every club's stance
was a fixed third of the table. The trade screen showed the AI's exact verdict before you sent an
offer. This document covers the measurement arm, what changed, the before/after numbers against real
NHL bands, how the GM persona drives each decision, and what is left.

Rule throughout: **fun > realism.** The world should push back without grinding the player down.

---

## 1. The world-health harness

`src/engine/career/autopilot/worldHealth.ts` rides on the autopilot. The autopilot is an AI GM that
plays the real engine as the user's club, so the whole career loop runs, including the user's own
market and pressure on the table. The harness records, for every season:

- all 32 point totals, the champion and the Presidents' Trophy winner, the points SD and Gini;
- distinct champions per 10-season window, the longest run of ≥100-point seasons, and max/min points;
- every club's payroll against its ceiling and floor, sampled at day 30 after camp and the summer
  market have settled;
- trades by window (in-season / deadline day / offseason), by shape, and AI-AI vs. user; AI
  free-agent signings, stars among them, and offer sheets;
- AI posture counts (contend / retool / rebuild) and the league's top-end talent.

`src/engine/league/worldTelemetry.ts` holds the counters. They are observation only: nothing in the
sim reads them, and they are not persisted.

**Run it** (about 65 minutes for 20 seasons of the imported league; a worktree reads the main
checkout's DB read-only):

```bash
export PATH="/c/Program Files/nodejs:$PATH"
AP_RUN=1 AP_SEASONS=20 AP_TAG=mytag AP_MOD_DB="K:/Hockey Game/mods/nhl-ehm/database.json" \
  AP_TIMEOUT_MS=7200000 npx vitest run src/engine/career/autopilot/run.harness.test.ts --no-file-parallelism
# → docs/autopilot/world-health-mytag.md (+ summary/trace; don't commit these)
```

Setting `career.marketDiagnostics = (reason) => …` makes the league market report why each attempt
came back empty, tagged by window (`inSeason:` / `deadline:` / `DD:` / `offseason:` / `draft:`). That
is how the fixes in §3 were found.

### The NHL bands

| metric | band | basis |
|---|---|---|
| points SD | 12–16 | NHL standings since the 2005 cap era |
| distinct champions / 10 seasons | ≥ 6 | cap-era Cup winners |
| longest ≥100-pt streak | ≤ 7 (brief: "no 17-year juggernauts") | cap-era runs |
| median AI payroll | 85–98% of the ceiling | CapWages / PuckPedia payroll tables |
| AI clubs under the floor | 0 | CBA: the floor is binding |
| trades / league year | 70–130 | Wikipedia "NHL transactions" pages per season |
| deadline-day trades | 15–35 | about 16 per deadline on average since 1980 (693 trades over 43 deadlines, [The Hockey Writers](https://thehockeywriters.com/15-intriguing-nhl-trade-deadline-stats-figures/)); 21 on deadline day 2026 ([Wikipedia, 2025–26 NHL transactions](https://en.wikipedia.org/wiki/2025%E2%80%9326_NHL_transactions)); 32 in 2020 and 2022 |
| offer sheets / season | about 0–1 | a handful per decade |

---

## 2. Before / after (imported 32-team league, seed 2029, autopilot as FLA-index 3)

| metric | NHL band | **baseline** (dbf54b7, pre-change) | predecessor (da06e04) | after3 (11f2b31) | **final** (9ca3853) |
|---|---|---|---|---|---|
| points SD (mean) | 12–16 | 14.4 | 15.0 | 15.0 | **14.7** |
| min distinct champions / 10 | ≥ 6 | **5** | 6 | 6 | **8** (14 in 20) |
| most Cups (20 seasons) | — | FLA ×5 | SJS ×4 | CAR ×5 | CAR ×3 |
| longest ≥100-pt streak | ≤ 7 | **FLA 14** | CAR 9 | CAR 10 | **CAR 7** |
| median AI payroll | 85–98% | **52.7%** (4/20 seasons in band; 37% by 2044) | 89.5% (15/20) | 88.5% (13/18) | **89.8%** (19/20) |
| AI clubs under floor / season | 0 | **21.8** (31 of 31 by 2036) | 3.9 | 2.7 | **2.3** (0 in 7 of the last 10) |
| trades / season | 70–130 | **12.2** | 38.6 | 53.1 | **64.1** |
| … deadline day | 15–35 | 1.1 | 7.6 | 9.9 | **12.9** |
| … offseason | — | 0 | 11.2 | 14.5 | 20.0 |
| AI trade shapes | varied | rental 162, prospectFor 26 | rental 488, capDump 103, prospectFor 66, goalie 29, hockey 21 | rental 431, prospectFor 240, capDump 100, hockey 97, goalie 34 | rental 469, prospectFor 361, capDump 122, pickSwap 110, hockey 104, goalie 56 |
| AI FA signings / season (stars ≥78) | — | 22.1 (1.6) | 55.5 (8.8) | 53.4 (8.3) | 51.7 (9.5) |
| offer sheets / season | ~0–1 | 0.2 at user | 0.1 | 0.3 at user | 0.1 at user |
| postures c/r/r | reacts to the table | 10/11/11 every season (fixed thirds) | varies 10–13 / 3–8 / 11–16 | varies | varies |

The fictional default league (16 clubs, vanilla autopilot gate, 10 seasons) was measured the same
way. Before the price calibration (§3.1) it showed the audit's collapse: median AI payroll **61%**, and
**10.8** clubs a season under the floor. At the final commit: **89.7%** and **0.5**. That run had 6
distinct champions in 10 seasons, points SD 12.9, and 33.7 trades a season (a 16-club league, so about
67 at 32 clubs), including 7 draft-floor pick swaps a year. The autopilot gate was clean: 0 critical, 0
major.

---

## 3. What changed

### 3.1 The cap binds: `economy.ts`, `contracts.ts`

- **Wage index.** Every price is quoted in base-year dollars and multiplied by *today's ceiling ÷ the
  ceiling the league opened with*. That covers contract asks, the league minimum, ELCs, the
  fair-salary curve that trade value reads, offer-sheet compensation tiers and world contracts. Year
  one is byte-identical. The base ceiling is persisted on `league.economy`, so old saves anchor to the
  ceiling they load with.
- **Talent anchor.** Prices follow a player's *standing* in today's league: the mean rated overall of
  about 6 players per club (200 in a 32-club league), compared with the base year. When imported talent
  ages out, payrolls don't sag.
- **Calibrated price shift** (new this pass). The ask curve is written for the real NHL. The fictional
  league's top end sits about 15 points lower on the same scale, so re-signings there came in at a
  fraction of the generated contracts. On first install, the economy bisects for the talent shift at
  which Σ ask ≈ Σ salary over today's NHL rosters. The shift is clamped ≥ 0, so the imported NHL is
  unchanged, and persisted as `league.economy.priceShift`.
- **Max contract.** No ask exceeds 20% of the ceiling, the NHL individual maximum.
- **Performance-sensitive asks.** A contract-year breakout, a ring or an award raises the ask; a slump
  lowers it. The adjustment is bounded to 0.8–1.35×.
- **The floor binds for AI clubs.** Before camp, and again on opening night after camp cuts and the
  NHL/AHL split, an AI club under the floor signs up to it. A club far under spreads the shortfall over
  its last seats as one-year overpays capped at 3× the ask, the way real floor clubs comply. Cap-dump
  takers are weighted toward clubs under the floor. A player in the GM's camp on a tryout is never
  taken.
- **Pinned by a test** (`livingEconomy.test.ts`, "the cap binds for twenty seasons"). Across twenty
  years of 4.5% compounding, a star's ask stays at 10–13% of the ceiling, drifts less than 0.4 points,
  and never exceeds the max contract. The minimum stays about 0.9% of the ceiling.

### 3.2 The league market: `aiMarket.ts`

AI-AI deals come in six shapes, and each deal is priced through **both clubs' own lens**
(`evaluateProposal`, the same judge the user faces):

- **rental**: an expiring veteran for picks;
- **prospectFor**: a veteran for a prospect-led return;
- **hockey**: player for player, need for need, balanced with a pick;
- **goalie**: a goalie changes hands, with a backup going back when the seller would be left with one;
- **capDump**: a squeezed club pays a sweetener to shed salary;
- **pickSwap**: new, on the draft floor.

Aggression lowers a club's acceptance threshold; that is its overpay.

This pass restructured the generator so **candidates are found before the choice**:

- The veteran market enumerates every (seller, veteran) pair that has at least one club able to use
  him. It picks among them, weighted by the seller's eagerness and by the piece being a real player,
  and the buyer side calls up to two clubs. The old version drew one seller, then one veteran, and gave
  up if nobody had a hole for him; that was most attempts.
- Packages with a real headline are tried first. Both books insist the best piece comes back their
  way, so two late picks for a top-six forward was a wasted call. A depth rental worth less than a 7th
  can go for a like-valued depth body.
- Hockey trades pick the offered player first. The partners are every club that would actually play
  him and has a like-valued name (within 35%) to send back. The GMs talk through up to three names, and
  up to three initiators get a turn.
- Cap dumps happen when a squeezed club goes looking for one. They are no longer the fallback shape on
  a quiet day, which had made them a third of the wire.
- **Draft floor.** `generatePickSwap` runs on the real draft order before the first pick. A gambler
  (aggression × risk tolerance) climbs with his pick plus a sweetener. The club moving down wants a
  premium: thin for a pick-hoarder, fat for a patient GM. The pricing uses the Perri curve at the
  *actual* slot. The trade evaluator values every pick mid-round and cannot see the order, so the floor
  keeps its own book.

**Two-phase.** A market deal opens as *talks* (`pendingLeagueDeals`) and closes one to three market
beats later. It closes only if it still stands (every asset in place, both rosters legal, both caps
fit) and if the truth drawn when the talks opened says yes. The closing chance is 78–94%, higher for
aggressive GMs. On deadline day, talks open and close within hours. `getLeagueTalks()` is the clean
fact hook for a later insider layer: deals in talks, with `willClose` truth, rationale and shape, plus
the last 40 that fizzled. No prose.

**Curated news.** Every deal goes on the ledger and the ticker. A deal that moves a real roster piece,
or a goalie, dump or hockey trade of substance, is written up with both GMs' reasoning, drawn from
the persona (for example "the cap surgeon at work", or "has a man on his board he will not wait
for").

### 3.3 Free agency, re-signing, offer sheets: `contracts.ts`, `career.ts`

- **FA.** Clubs bid by *talent upgrade over their own replacement level × posture × GM*. Aggression is
  the overpay, capital discipline keeps a cushion, and a club under the floor bids harder. The
  **player chooses** between competing offers. The winner and the reason come back.
- **Re-signing** reads loyalty (keep your own; a loyal GM re-signs below the bar) and capital
  discipline (the cushion). A rebuilding GM lets his 30-plus veterans walk unless he is loyal to a
  fault.
- **Offer sheets** are rare and aimed. At the user, only an aggressive GM with room tenders one, and
  the better the RFA the likelier. Between AI clubs, sheets go at cap-tight clubs, at most one a summer.

### 3.4 The draft: AI boards have blind spots

Each AI club drafts off **its own board**. The board is the class order, plus noise from the club's
scouting department (`scoutingDeptFor`: quality 0.3–0.95, deterministic per club), plus a **regional
blind spot**: one nation the staff barely covers, whose prospects it misjudges, usually downward. On
top of that sits the GM's lean: risk tolerance favours ceiling, analytics lean favours production. The
user's "sim entire draft" uses **Our Board**, the user's scouts' ranking, not the truth.

### 3.5 Posture reacts to the table: `gmPersona.ts` `deriveLivePosture`

Stance is roster strength blended with the live table. The table's weight ramps up to 75% by about
60 games played, and each GM filters the result:

- **All in.** An aggressive GM on the bubble goes for it when the reigning champion is in his
  conference, or when he is within 8 points of the conference lead after 30 games.
- **Patient rebuild.** A patient GM holds a rebuild for at least two seasons, and until the club is
  genuinely good.
- **Sticky window.** A committed contender does not sell at the first slump.

GMs commit at checkpoints: season open, deadline morning and the June draft floor. A flip is news.

### 3.6 The trade screen: the AGM's read, not the answer

The trade builder used to dry-run the partner's real evaluation, so you could shuffle assets until the
chip said "accept". Now your **assistant GM reads the other GM**. He misjudges the other front office
by a bias that holds for a week, so the read stays consistent while you work a deal. The bias is
larger for a weak AGM (`judgment`) or a GM with an extreme temperament. His line hedges to match: "I'd
be surprised if I'm wrong about him", "I've been wrong before", "he is hard to read". Hard rules (a
no-trade clause, the cap, a gutted position) stay exact facts. The real evaluation still answers the
actual proposal. The `tradeTalk` and `tradeThread` dialogue is unchanged.

---

## 4. Persona → behaviour map

| axis | where it acts |
|---|---|
| **aggression** | acceptance threshold in every AI-AI deal (the overpay); how often his club initiates; how many packages a buyer tries (2–5 calls); rental premium; FA overpay; offer-sheet tendering (≥0.5, and the likelihood scales with it); "all in" posture from the bubble; draft-floor climbing; trade-talk closing chance; AGM misread width |
| **patience** | sticky rebuild (1–2 year minimum, higher exit bar); premium asked to move down on the draft floor; AGM misread width |
| **riskTolerance** | draft board lean toward ceiling; draft-floor climbing ("a man on his board"); FavorYoung philosophy |
| **pickHoarding** | what a seller wants back (picks vs. a kid); RebuildDraft vs. RebuildProspects philosophy; cap-dump sweetener size demanded by a taker; a thin premium to move down on the draft floor |
| **loyalty** | never moves his own draftees (≥0.65 on roster, ≥0.7 in the system); re-signs his own below the bar; a rebuild keeps a 31-year-old only if he is loyal |
| **capDiscipline** | when a club dumps salary (≥95% of the cap for a disciplined GM, jammed against the ceiling for a gambler); willingness to spend his best pick to clear room; the FA and re-sign cushion |
| **analyticsLean** | draft board lean toward production; FavorYoung philosophy |
| **scouting dept** (quality, blindSpot) | noise on the club's own draft board; one nation systematically misjudged |

---

## 5. What's left (honest)

- **Trade volume is just under the band.** The final run averages 64.1 trades a season against a
  70–130 band (the first two seasons run 87 and 69), and 12.9 on deadline day against 15–35. The
  volume sags mid-run: 2032–2038 average about 48. Market diagnostics show deadline day is
  *supply-limited*. By then the real pieces have moved, and the remaining depth veterans (value about 5)
  are worth less than the cheapest pick (a 7th is about 8–10 on the Perri scale), so both books reject
  every price. A "future considerations" or conditional-pick currency for depth deals would unlock the
  rest of the deadline flurry. It needs a pick-condition model, which is out of scope here.
- **Dynasties are now in band, but only just.** CAR's longest run of 100-point seasons is 7, down from
  10 (and FLA 14 at baseline), and no club won more than 3 Cups in 20 seasons. It sits exactly on the
  ≤7 bound, so a different seed could land one over. The next lever would be structural: ring-inflated
  asks on a champion's expiring core. It was not pursued, to avoid grinding the *player's* dynasty down.
- **The floor mostly binds.** 2.3 clubs a season are under it on average. Those are mid-2030s summers
  where the market had nobody left to sign; it is 0 in 7 of the final 10 seasons. A club that can't
  find a body could absorb a dump or front-load a re-sign, but neither is built yet.
- **Clubs over the ceiling.** One path is fixed: the opening-night roster re-balance
  (`assignRosters`) used to pull a sent-down veteran's full salary back up unchecked, which put clubs
  7–9% over. It now takes the best *affordable* body. In-season emergency recalls still eat an
  overage by design, since a legal lineup outranks the ceiling. There is no automatic compliance step
  for AI clubs when injured players return (LTIR exists only for the user).
- **Offer sheets between AI clubs** are almost never tendered (0 in 20 seasons). The real-world rate is
  about 1 in 5 seasons. The trigger (a cap-tight holder plus an aggressive suitor with room) may be too
  narrow.
- **The insider/media layer** that reads `getLeagueTalks()` (leaks, wrong reports, "talks have
  broken down") is deliberately not built.
- **Not in scope and not touched:** AI GM firings (on improve-loop), youth intake and other leagues
  (living-world-b), media, Season Wrapped.
