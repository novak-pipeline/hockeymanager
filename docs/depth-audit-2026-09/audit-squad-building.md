# Squad-building depth audit (read-only): scouting, draft and youth, recruitment, contracts, finances

Repo: `K:/Hockey Game`, branch `improve-loop`, working tree as-is, 2026-09-26.
Scale 0–5. **World aliveness** is the 7th axis the owner added: does the system run on its own, or does it only react when the GM pokes it?

References for FM and EHM mechanics:
[FM24 manual: Transfers, Recruitment & Scouting](https://community.sports-interactive.com/sigames-manual/football-manager-2024/transfers-recruitment-and-scouting-r4962/),
[Passion4FM scouting guide](https://www.passion4fm.com/scouting-in-football-manager/) (knowledge %, scouting budget and ranges, per-player scouting cost),
[FM26 Recruitment Focuses](https://www.passion4fm.com/recruitment-focuses-in-football-manager/), [Operation Sports FM26 focuses](https://www.operationsports.com/football-manager-26-recruitment-focuses-that-actually-work/), [FM26 international Pool vs Shortlist](https://footballgpt.co/fm/fm26/scouting-focuses-international),
[EHM The Blue Line: scouting basics](https://www.ehmtheblueline.com/forums/viewtopic.php?t=17816), [EHM: revealing ability/potential via scouting](https://www.ehmtheblueline.com/forums/viewtopic.php?f=17&t=14757), [Steam EHM drafting thread](https://steamcommunity.com/app/301120/discussions/0/133256240734626332/) (Judging Potential/Ability and Discipline drive report quality).
I also used the project's own digests: memory `reference_ehm-manual`, `reference_ehm-gm-mechanics`, `reference_nhl-cadence`.

---

## Scores

| System | Decisions | Info quality | Consequence | Feedback/attribution | UX polish | Content variety | World aliveness |
|---|---|---|---|---|---|---|---|
| 1. Scouting (engine + UI) | 4 | 3 | 3 | **1** | **2** | 3 | **1** |
| 2. Draft & youth | 3 | 3 | 3 | 2 | 3 | 3 | 2 |
| 3a. Trades (incl. deadline) | 4 | 4* | 4 | 3 | 3 | 4 | 3 |
| 3b. FA / waivers / offer sheets | 3 | 2 | 3 | 3 | 3 | 2 | 2 |
| 4. Contracts & agents | 4 | 3 | **2** | 3 | 3 | 3 | **1** |
| 5. Finances & cap | **1** | 2 | **1** | **1** | 3 | **1** | **1** |

\*Trades information is *too* good. The builder dry-runs the AI's real verdict before you send anything (see 3a).

**The common root cause:** the depth is built for one club only. The user is fogged, negotiated with and persuaded. The AI clubs are omniscient, run on vending machines and never choose. So the world does not compete with you for the same information, prospects or free agents. And whatever you do, nothing ever tells you whether a read or a decision was right.

---

## 1. SCOUTING

### What FM and EHM do
- **FM (24/26):**
  - **Scouting knowledge % per player and per nation.** It grows with each viewing.
  - **Scouting budget and range** (national, continental, worldwide), with a per-assignment cost of about 1K–5K per player outside range. Clubs with no range only know what their staff already know.
  - **Recruitment Focuses:** saved criteria (position, role, age, value, contract status, player style) plus the scouts assigned to them. They surface reports into an inbox.
  - **Scout reports** carry:
    - a recommendation grade (A+ to E)
    - pros and cons
    - role suitability for *your* tactic
    - estimated fee and wage
    - "compared to your squad"
    - scout confidence
  - **Shortlist** with interest and availability flags.
  - **Player Search** with column views.
  - Recruitment meetings and data-analyst recommendations.
  - FM26 keeps Recruitment Focuses with further filters (contract status, player style). Its national-team layer separates Pool (auto-found) from Shortlist (a manual act).
- **EHM:**
  - Scouts have **Judging Ability, Judging Potential and Discipline**. A low-Discipline scout calls every forward "like Daniel Sedin", so *who* scouted a player changes what you believe.
  - Assignments by region, league or team.
  - Star ratings for current and potential ability, shown relative to your team.
  - Knowledge per nation.
  - Draft boards built from reports.

### What we have
**Engine** (`src/engine/league/scouting.ts`)
- Knowledge 0–100 per player, with fog bands that narrow as knowledge grows (`bandWidth` :170, `maskAttribute` :187).
- Scout `rating` sets read speed. Scout `judgment` sets band width (`accuracyOf` :97).
- Bandwidth dilution (`SCOUT_CAPACITY` 60, :514/:720).
- Divide-the-work stride plus second opinions (:627–705).
- Specialty nation ×1.2 (:746).
- Decay toward a renown floor (:766–779).
- Watch list = priority order, capped at 50% of a scout's capacity and at 40 names (:611–619, :706–714).
- Per-scout history (:642–652).

**Engine** (other files)
- Per-scout reads and dissent: `multiScout.ts`.
- Scout reports with 1–9 grades, comps and bio: `scoutReport.ts`.
- Department briefing: `scoutBriefing.ts`.
- Whole-database fogged search: `playerSearch.ts`.
- Scout meeting: `scoutMeeting.ts`.
- Squad-fit notes: `scoutFit.ts`.
- Interviews: `interview.ts`, plus `career.ts:16464–16508`.

**UI**: sidebar Scouting → 6 sub-tabs (`src/renderer/components/navConfig.ts:83–91`), plus separate screens for Scout Profile, Scout Meeting and Draft.

### Placeholder check (concrete)
1. **Nobody ever grades the scouts.** Nothing records what a scout said about a prospect and compares it with how the player turned out:
   - The ScoutProfile tabs are Attributes / Info / Players Scouted (`ScoutProfileScreen.tsx:86–146`). There is no track record.
   - The only retrospective is the *press* one-year redraft (`career.ts:7514`).
   - So `judgment` is a hidden number you can never learn except by reading the attribute bar. The EHM loop of "fire the scout who oversold" is impossible.
2. **Scout error has no personality.** The fog bias is a hash of *player + attribute* (`scouting.ts:204–210`), not of the scout. Every scout errs in the same direction on the same player.
   - `judgmentOf` keeps the **max** judgment of anyone who ever looked (`recordJudgment` :84–93). One glance from your best scout permanently sharpens the read, and a bad scout can never mislead you.
   - Per-scout disagreement lives in a *second, independent* model (`multiScout.ts`, its own hash). So the draft board's dissent and the attribute bands come from two unrelated accuracy systems.
3. **AI clubs do not scout at all.**
   - The draft class order is true potential plus production (`offseason.ts:863–880`, `score: overall(computeComposites(p.potential…))`).
   - AI picks from that true order with a ±2.5-slot hash nudge (`career.ts:8587–8593`, `offseason.ts:917–936`).
   - Your fog is a handicap no rival shares. Out-scouting the league cannot happen, because the league already knows the truth.
4. **"Sim entire draft" auto-picks by truth, not by your board.** `simDraftUntil` uses `remaining[0]` for the user's own picks (`career.ts:8551–8553`), which is the *true* class order. Delegating the draft therefore beats your own scouts: a fog exploit.
5. **Interviews are free, unlimited and work on anyone.**
   - `requestInterview` has no slot limit and no draft-year gate (`career.ts:16464–16478`).
   - Each interview adds +10 knowledge to *any* player in the world (:16498) and reveals true personality traits.
   - It is a free second scouting department.
6. **Scouting costs nothing.**
   - Scouts have salaries, and "Scouting Wages" appears in the header (`ScoutingScreen.tsx:377`), but no budget or ledger consumes them (see §5).
   - Range is global for everyone. "Scouting Range: **World**" is a hard-coded string (`ScoutingScreen.tsx:371`).
   - The only limit is `maxScouts()` (`career.ts:19481`).
7. **"Scout ▾" in Player Search wipes the scout's brief.** `handleScoutPlayer` reassigns his whole target to `{kind:'player'}` (`ScoutingScreen.tsx:1732–1736`), silently abandoning his region. This overlaps with, and is worse than, the watch-list pin.
   - Likewise, assigning via a focus card resets `positionFilter` to 'any' and `minPotentialStars` to 0 (`:1791`), erasing the Advanced settings without saying so.
8. **Development-camp reads are dice.** `devCampRead` is `rng.float(-1,1)` with no link to ability (`career.ts:9863–9866`).
   - The mailed report says "Quicker release and better pace than the book had" (`:10070`) for a pure coin flip.
   - The standout gets +6 morale and a chronicle "award" (`:10052–10062`).
   - The text claims information it does not carry.

### UI inventory (what question each panel answers)

| Tab | Panels | Question | Problems |
|---|---|---|---|
| **Overview** (`OverviewTab` :522) | HeaderStrip (5 KPI cards :365) · Watch List (:430) · Scout Assignments table (:384) | "What's my department doing? Who am I tracking?" | "Range: World" is a constant. "Nations covered" repeats Coverage. The assignment table is repeated on Recruitment Focus (twice). |
| **Scouting Centre** (:870) | Department Briefing (3 dense columns, :731) · triage card stack (:936–959) · Shortlist grid (:965) | "What did the scouts find and what's changing?" | The briefing is ~140 lines of 10–11px text in three columns. "Where your eyes are" and "Blind spots" duplicate the Coverage tab. **The Shortlist here is the same act as the Watch List on Overview** ("★ Track him" pins to both), in a different format. The one-card-at-a-time stack has no list view, no sorting and no batch actions. |
| **Players** (:1048) | 16-control filter panel (3 rows) · 17-column results | "Find me a player." | Good bones. No saved searches and no column presets. Scout ▾ is destructive (#7). The 16 controls are always expanded. |
| **Recruitment Focus** (:1467) | Focus cards grid · "New focus" · Advanced per-scout cards | "Where are my scouts pointed?" | "Focus" here means a *target region*, but FM's Recruitment Focus means a *saved player profile* (position, role, age, value). The name promises FM semantics it doesn't have. The third presentation of assignments. |
| **Scouting Coverage** (:1800) | Globe + beat list (:1622) · Nation table · League table | "Where are my blind spots?" | The globe's side list, the two tables and the Centre briefing all answer the same question four ways. |
| **Prospect Rankings** (`DraftRankingsScreen.tsx`) | Analyst/Scouts toggle · per-scout board select · U17 radar | "How do we rank this class vs the public?" | Lives under Scouting, while the Draft screen (Board / Available / Combine / War room, `DraftScreen.tsx:849–889`) lives under Competitions: two draft boards in two places. |
| Scout Meeting / Inbox digest / Centre queue | — | "Act on finds" | The same finds reach the GM in three channels (playtest 07-23 #10). "Weekly scouting digest" is an identical headline 35×/season (autopilot summary). |

**There are six rating scales for one question ("how good is he?"):**
- letter grade A–D (finds)
- half-stars current/potential
- 1–9 grades (scout report)
- read band (exact / strong / partial / glimpse)
- knowledge %
- pNHLer/pStar % and tier words (Fringe…Star, multiScout)

### Proposed information architecture (concrete)
**Rename the sidebar entry to "Recruitment"** with five tabs. The draft board moves to the Draft centre.

1. **Desk** (home, no scroll, follows the dashboard laws)
   - *Left panel: "Department."* Scouts deployed, bandwidth strain, spend this month vs budget (after §5), next digest date.
   - *Centre panel: "What we need."* From `squadPlanner`: position × horizon (now / 1 year / 3 years), e.g. "RD, top-4, within 1 season". Each need is one click to "Create focus from this need".
   - *Right panel: "What moved."* The current briefing `changes` plus `disagreements`, capped at 5 lines each, each deep-linking.
   - *Footer strip:* "N new reports awaiting a call" leads to Reports.
   - The globe is **not** here.
2. **Reports** (list plus detail, replacing the one-at-a-time stack)
   - *Left:* a sortable list of reports: grade, name, position, age, league, scout, knowledge %, date, and a NEW badge. Filters: focus, scout, position, grade, "fills a need". Batch actions: Shortlist, Pass.
   - *Right:* **one canonical report card**:
     - header: face, bio, rights/contract
     - **Recommendation** (A–E, FM-style, meaning "should we pursue")
     - **Ability / Potential** in half-stars with a confidence band (knowledge % plus the number of scouts)
     - **Pros / Cons** (existing)
     - **Role suitability** in *our* system (existing `scoutFit`)
     - **Squad fit** ("would be our 3rd RD; ice-time risk")
     - **Estimated cost** (asset value for trade targets, ask for free agents, draft slot for prospects)
     - **Staff dissent** (multiScout)
     - actions: Shortlist · Re-scout (named scout) · Interview (limited slots) · Open in trade builder / make offer
   - The Scout Meeting then becomes "walk the unactioned Reports", not a fourth channel.
3. **Shortlist** (merge Watch List and Shortlist into one list with two tiers)
   - **Priority** (≤ `MAX_WATCH_LIST`, consumes bandwidth, no decay; the current watch list).
   - **Monitoring** (unlimited, free, decays).
   - Columns: knowledge % with trend since added, last seen, scouts, your note, **rival interest** (after the world-aliveness work), status (Scouting → Ready → Pursuing), and an action.
   - One ★ everywhere in the game means "add to Shortlist (Monitoring)". Promoting to Priority is a deliberate second click.
4. **Search**
   - Keep `playerSearch`. Collapse the filters into a single row plus "More filters".
   - Add **saved searches** and **column presets** (Scouting / Contract / Production).
   - Replace Scout ▾ with "Send a scout (adds a Priority pin)". Never rewrite a brief from here.
5. **Scouts & Coverage** (one screen)
   - *Left:* the scout roster table: judgment, rating, specialty, current brief, workload, **track record (hit rate)**, salary, and Hire/Release.
   - *Right:* the **assignment board**. Rows are focuses; drag scouts onto them. Rename "Recruitment Focus" to **Assignments**. Reserve the name "Recruitment Focus" for saved player profiles (a Search saved search plus assigned scouts plus a report threshold), which is FM's meaning.
   - *Below:* the globe, with **one** side list (covered / blind spots). The Nation and League tables fold into the globe list as expandable rows.
   - Delete the Overview assignment table and the separate Coverage tab.

**Draft centre** (Competitions → Draft), with tabs:
- Public Book
- Our Board (consensus plus a per-scout switch)
- U17 Radar
- Combine & Interviews
- War Room (draft day only)

This removes "Prospect Rankings" from Scouting.

**One scale rule:**
- Ability and potential are always half-stars plus a confidence band.
- Letters are only ever the recommendation.
- The 1–9 grades stay inside the full scout report as tool grades, labelled as such.
- Delete the free-standing read-band words, or use them only as the confidence caption.

### Root cause of shallowness
The scouting engine is genuinely good at *the user's knowledge*. But its outputs are never scored against reality, never priced (no budget), and never contested (AI omniscience). The UI grew one playtest fix at a time (C1–C5, #17, #10), each adding a panel instead of consolidating, which is how it ended up with three assignment views, two lists and four coverage views.

### True-depth spec (smallest genuinely-deep version)
- **S — Scout track record.**
  - At the draft, snapshot each scout's board (`scoutBoards` already exists) and his potential read per player.
  - At +2 and +4 seasons, score it against outcome (NHL games played, peak overall).
  - Show a hit rate plus "his best call / worst miss" on ScoutProfile and in the Scouts table. Feed it into the scout meeting ("Novak was right about X").
  - This makes `judgment` learnable and firing meaningful.
- **S — Per-scout error.** Seed the `maskAttribute` bias with the scout who filed the dominant read (the scout's hash plus player/attribute). Scale bias magnitude by (1 − judgment) and add a small Discipline-style "over-seller" trait. Unify with `multiScout` so bands and dissent come from one model.
- **S — Honest auto-draft.** The user's auto-pick uses Our Board (staff consensus), not `remaining[0]`.
- **S — Interview slots.** 20 combine interviews per draft year, draft-eligibles only, and +knowledge only on personality/intangibles.
- **S — Dev-camp reads grounded.** z = (true development signal + noise scaled by the head coach's judgment).
- **M — AI clubs scout.** Give each AI club a department scalar (from its staff) and a regional bias.
  - AI draft boards = true order plus club-specific noise ∝ (1 − dept quality) plus regional blind spots.
  - AI clubs get scouts "in attendance" on your Priority names ("scouts from 3 clubs at his last game"), which drives the Shortlist's rival-interest column.
  - This is the world-aliveness fix.
- **M — Scouting budget and ranges.** A monthly scouting budget from finances. Regions outside the base range cost per scout-week. This gives the "Scouting Wages" KPI a meaning.
- **M — IA restructure above.** Mostly recomposition of existing views, plus one new list-detail Reports component and the merged Shortlist.

---

## 2. DRAFT & YOUTH

### What FM, EHM and the NHL do
- **EHM:** 7-round draft with a lottery; BPA vs team-need boards; draftee rights by league (a CHL pick must be signed within 2 years or re-enters; NCAA/Europe rules differ); ELC signing of draftees; ECHL→AHL→NHL development gates. (Memory: `reference_ehm-gm-mechanics`.)
- **FM:** youth intake, youth candidate reports, trial periods.
- **NHL:** combine interviews and testing, draft-day trades, the ELC "slide" rule.

### What we have
- A real imported draft class of whitelisted junior leagues (memory `project_real-draft`).
- Analyst board by phase (preliminary / midseason / final) with production NHLe terms (`draftRankings.ts`).
- Staff and per-scout boards; U17 radar gated on real reads (C5).
- Combine and war room (`DraftScreen.tsx:489`, `:656`).
- A user-gated draft day.
- Rights held in junior, graduating to the AHL at 20.
- Dev camp (M3); post-draft call (`career.ts:17160`).
- Press redraft after one year (`career.ts:7514`).

### Placeholder check
- **AI boards = truth** (see §1.3). **Auto-draft = truth** (§1.4).
- **Dev-camp grades are random** (§1.8). The camp's only mechanical effects are +6 morale for the standout and a +4/+9 knowledge bump (`career.ts:10085–10088`), and that bump is on your *own* drafted players, whom `protectedIds` already treats as fully known in most paths.
- No draftee signing window or rights expiry. A grep for rights lapse finds only RFA qualifying-offer lapses (`career.ts:8104`, `:11442`). Holding rights is free and forever until 20, so the "sign him or lose him" decision is absent.
- No ELC slide and no ELC bonuses.
- The draft lottery was not audited here.
- The U17 radar only feeds a table. Nothing (no rival interest, no early agent relationship) makes finding a 15-year-old early pay off, beyond knowing his name earlier.

### Scores rationale
- **Decisions 3:** pick and trade-up decisions are real, but rights management and ELC decisions are missing.
- **Information 3:** good boards, but the AI is omniscient.
- **Consequence 3:** picks become real players who develop.
- **Feedback 2:** the press redraft exists, but there is no "your board vs outcome".
- **UX 3.**
- **Content 3:** class article, combine, calls.
- **World aliveness 2:** the AI drafts with need and bias, but cannot mis-draft through fog, and there are no AI draft-day trades toward prospects the AI covets.

### True-depth spec
- **S:** a draftee rights clock (CHL 2 summers; NCAA until graduation + 30 days; Europe 4 years) with an unsigned-pick decision in the offseason gauntlet. Unsigned picks re-enter the draft.
- **S:** ELC slide (fewer than 10 NHL games at 18/19 → the contract year slides) and ELC performance bonuses. These create a real "burn a year?" decision for October call-ups.
- **M:** the "Draft retrospective" page: our board vs public book vs actual outcomes at +3 years, per scout. This shares the track-record data from §1.
- **M:** AI draft boards from AI scouting (§1), plus AI trade-ups for prospects high on *their* board (world aliveness).

---

## 3a. TRADES (incl. deadline day, per-club valuation, negotiation threads)

### What FM and EHM do
- EHM: AI GMs with trade profiles; the AI evaluates through its own knowledge; NTC/NMC lists; retained salary; conditional picks.
- FM: negotiation rounds with clauses (sell-on %, add-ons); AI "interested" status; transfer-deadline day with an ever-updating wire; "make offer" requires you to guess value, and the AI's valuation is opaque.

### What we have (strong)
- `trades.ts` `evaluateProposal` (:1048–1279) with a club lens:
  - posture, depth after the deal, cap space, deadline proximity
  - cornerstone rule, headline-asset rule, endowment 1.08, cap guards, retained salary (MAX 50% / 3 slots)
- Per-club valuation: `clubPlayerValue` :769, `clubAssetValue` :802.
- Farm assets outside the cap (A4).
- Trade threads with patience, final offer and walk-away (`tradeThread.ts`), with 152 authored lines.
- A deadline day in half-hour blocks.
- AI↔AI trades on a ramping schedule (`career.ts:6464`; 2 attempts/day → 12 on deadline day).
- Trade block cards (D3).
- Rival offers to you with personas.

### Placeholder check
1. **The builder shows the AI's real answer before you ask.** `evaluateTradeDraft` returns a `partnerVerdict` that is "a side-effect-free dry-run of the real `evaluateProposal`" (`career.ts:13127–13135`), rendered as a chip (`TradesScreen.tsx:1354–1360`).
   - The user can shuffle assets until the chip says accept, and only then send.
   - The whole patience/thread machinery is bypassed, because the fishing never touches the thread.
   - This single leak collapses "trade negotiation" into "solve the meter".
2. **AI valuation is omniscient.** `playerValue` uses the true `ratedOverall` (`trades.ts:167–168`). Only the *user's* side is fogged (`career.ts:13166–13169`). The AI can never be fooled by a hot streak or be wrong about a prospect, so there is no "buy low on a player they undervalue".
3. **NTC is binary, and "modified" equals "full".**
   - Signing sets `noTradeClause = offer.clause !== 'none'` (`career.ts:12934`). A *modified* NTC that the player or agent negotiated as cheaper protection behaves exactly like a full NMC in `evaluateProposal` (`trades.ts:1088–1098`).
   - The modified NTC is therefore a choice whose outcome converges with the full one.
4. **AI↔AI trades have one shape.** A rebuild/retool seller's vet goes to a contend/retool buyer for a prospect or pick, priced by *market* `playerValue`, not by the club lens (`trades.ts:1815–1830`, `:1850–1890`). There are no hockey trades, no player-for-player swaps and no cap dumps, so the wire reads samey over years.
5. **The market temperature and one-click counters from the Gap #8 remainder** are still open (`EXCELLENCE.md:183`).
6. There are no conditional picks or three-team deals. DEPTH §3.3 promises them; a grep finds none.

### Scores rationale
- **Decisions 4:** rich levers.
- **Information 4\*:** too complete (the leak).
- **Consequence 4:** cap, roster, morale and news all follow.
- **Feedback 3:** news and chronicle, but no "trade grade in hindsight" (who won the deal after 2 seasons).
- **UX 3.**
- **Content 4:** threads and persona lines.
- **World aliveness 3:** a real AI↔AI flurry, but single-template and driven by market value.

### True-depth spec
- **S — Replace the dry-run verdict with the AGM's estimate.** Noisy by AGM judgment, bucketed (likely / maybe / long shot). "Sounding him out" becomes a real call that spends a thread round, so the patience system bites.
- **S — Modified NTC as a 10-team no-trade list.** Generate it from the player's priorities and market. `evaluateProposal` blocks only listed partners; the AI respects it too.
- **S — AI↔AI trades priced through each side's `clubAssetValue`.** Add two more shapes: hockey trade (need-for-need) and cap dump (a pick attached to shed salary).
- **M — AI valuation through AI knowledge.** Reuse §1's AI department scalar: AI `clubPlayerValue` uses a fogged overall with club-specific error. This creates exploitable mispricings and "they love our kid" moments.
- **M — Hindsight grades.** At +1 and +3 seasons, score each user trade by value delivered (points, GP, cap). Feed the GM reputation arc ("wheeler-dealer", B4.4) and rival grudges.
- **M — Conditional picks** (resolve at season end with news).
- **L — Three-team broker deals.**

---

## 3b. FREE AGENCY, WAIVERS, OFFER SHEETS

### What FM, EHM and the NHL do
- **NHL/EHM free agency:** each UFA picks among competing offers by money, term, role, contender status and location; bidding wars; leverage decays through the summer.
- **Waivers:** exemption by age at signing plus pro games or seasons; claim priority by standings; re-claim rules.
- **Offer sheets:** compensation ladder; 7-day match window.

### What we have
- FA hub with interest (keen/warm/cold), standing offers decided a few days later, snipe risk, agent intel, ask decay (`faAskDecay`).
- Waiver wire with AI placements (up to 2/week, `career.ts:10918`) and worst-record-first claims (`:10624`).
- Offer sheets both ways, with a compensation ladder and an own-picks check (`career.ts:11125–11277`, `:11655`).
- PTO camp invites.

### Placeholder check
1. **"Rival clubs circling" are a hash, not bidders.**
   - `faRivalClubs` selects clubs by `(playerIdNum XOR clubIdNum) % 12 < appetite` (`career.ts:12177–12190`).
   - The agent names those clubs (`askFaAgent` :12215–12225), but the *actual* AI signing logic (`aiFreeAgencyDay`, `contracts.ts:477–553`) picks by positional deficit plus cap space and never consults that list.
   - The clubs the agent names are fiction. "A rival matched your money" is a coin flip on the rival *count* (`career.ts:12295–12296`), with no rival offer behind it.
2. **AI free-agency signings involve no player choice.** Each player "decides" on a day fixed by his rank in the pool (`contracts.ts:~508`) and signs with whichever AI club scores highest at ask × discount. The priority weights (`negotiation.ts:121`) that make the user's talks a puzzle don't exist for AI suitors.
3. **Standing offers bypass the negotiation engine.** `resolveFaOffers` uses the old `offerAcceptable` (money 75% / term 25%, `contracts.ts:267–287`). Clauses, role pitch and bonus are ignored in the July 1 path, which is exactly where they matter most.
4. **Interest ignores the weights.** `faInterestFor` adds a "personal lean" hash (`career.ts:12140`). Priority weights only choose the *note text* (:12143–12151), not the interest score.
5. **Waiver exemption is simplified to "one-way AND age ≥ 25"** (`contracts.ts:120–122`). Two-way status has nothing to do with exemption under the CBA, and a 22-year-old on a one-way deal after 200 games would really need waivers. AI claim decisions use the true overall.

### Scores rationale
- **Decisions 3.**
- **Information 2:** the named rivals are fabricated.
- **Consequence 3.**
- **Feedback 3:** you are told why you lost, but the reason may be fiction.
- **UX 3.**
- **Content 2.**
- **World aliveness 2:** the market moves without you, but nobody competes.

### True-depth spec
- **M — Real bidding.** Each FA day, AI clubs with need and room place *actual* offers (salary, term, role implied by their depth chart).
  - The player scores every offer, including yours, with `offerValue` × priority weights (money / term / role / contender / loyalty), then signs the best, or waits if all are below his decaying floor.
  - The agent's "clubs have called" becomes the real bidder list, and losses cite the real winning offer's dominant factor.
  - This one change fixes items 1, 2 and 4 and makes the league compete.
- **S — Standing offers through `evaluateRound`/`offerValue`** so clauses and role count on July 1.
- **S — CBA waiver exemption** (age at first contract × games/seasons table), with claim priority shown on the wire.

---

## 4. CONTRACTS & AGENTS

### What EHM and the NHL do
- ELC / RFA / UFA with qualifying offers and arbitration: player- or club-elected hearings with comparables, and 1- or 2-year awards.
- NTC/NMC and modified lists; signing bonuses (buyout-proof); performance bonuses (ELC / 35+).
- Extensions from July 1; agent relationships; holdouts.

### What we have (strong in the UI, thin in consequence)
- `negotiation.ts`:
  - agent persona axes (:55–112)
  - priority weights with hints (:114–150)
  - comparables (:152–180)
  - rounds with patience, barter and walk-away (:407)
  - role pitch → a real ice-time promise that is collected later (`career.ts:12865–12886`)
- Agent rapport across a shared "book" (`agentRapport.ts`).
- Term pricing (`contracts.ts:204–250`).
- Extensions (`extension.ts`), RFA tender / qualifying offers, arbitration, buyouts with the real 2/3 over 2× term (`career.ts:9387–9407`), LTIR relief.
- LLM parse of offers (`offerParse.ts`).

### Placeholder check
1. **The signing bonus is inert after signing.**
   - The agent prices `signingBonusPct` (`negotiation.ts:36–40`) and it is written to the contract (`career.ts:12936`), but no code reads `contract.signingBonusPct` again.
   - The buyout doesn't exclude it, and there is no cash ledger to pay it (§5).
   - The club gives away a "concession" that costs nothing.
2. **Modified NTC equals full NTC** (§3a.3).
3. **Salaries do not inflate with the cap.**
   - The cap grows 4.5%/yr (`contracts.ts:51`, applied `career.ts:9017`).
   - `askTerms` is a fixed-dollar curve on overall and age with no cap term (`contracts.ts:169–187`); a grep finds no cap scaling anywhere in the ask path.
   - After 25 seasons the cap is about 3× the base while a star still asks about $13M. Cap pressure evaporates over a long career. This may contribute to the autopilot's late dynasty (7 Cups, #1 almost every year from 2033, `docs/autopilot/summary-latest.md`). **Worth measuring before claiming.**
   - The Finances "Wage commitments" footnote also "assumes a flat cap" (`FinancesScreen.tsx:~208`).
4. **Arbitration is one random roll.**
   - Award = ask × U(0.98, 1.12), 1 year only (`career.ts:8116–8118`).
   - No hearing, no comparables (though `findComparables` exists), no club-elected arbitration, no 2-year award, and no walk-away threshold rule.
5. **AI re-signing is a vending machine** (`aiResignDay`, `contracts.ts:410–452`).
   - Every AI RFA at or above 45 overall is re-signed at the exact ask.
   - UFAs re-sign if they are a "keeper" and `offerAcceptable(ask, ask)`.
   - There are no AI extensions in-season, no AI stars testing the market for more, and no AI cap planning.
   - The negotiation depth exists for one club only.
6. **Agents are a hash.**
   - `agentFor(player)` derives a name and persona per player id. "Star agents rep multiple players" happens only when name hashes collide, and rapport is keyed by that name.
   - Agents never act on their own: no shopping clients, no leaking unprompted, no demanding trades for unhappy clients.

### Scores rationale
- **Decisions 4:** a rich offer builder.
- **Information 3:** hints and comparables.
- **Consequence 2:** bonus inert, modified NTC collapses to full, no inflation.
- **Feedback 3:** rapport and promise receipts.
- **UX 3.**
- **Content 3.**
- **World aliveness 1:** AI contracts never negotiate, and agents never initiate.

### True-depth spec
- **S — Cap-indexed market.** `askTerms` × (currentCap / baseCap). Plus a yearly market recalibration: re-fit the curve so that the league-wide share of cap spent on the top-N contracts stays at its NHL ratio. **This is the highest-leverage small fix in this whole audit** (long-run cap pressure, the dynasty guard).
- **S — Signing bonus with teeth.** Excluded from buyout savings (buyout computes on salary minus bonus). Paid in the cash ledger (§5). A lockout/escrow flavour line.
- **M — Arbitration hearing.**
  - Both sides file numbers.
  - The award is the midpoint pulled toward the side closer to the comparables (`findComparables`) and production.
  - Club election is allowed.
  - Walk-away is only permitted above a threshold.
  - The hearing damages morale and agent rapport (real NHL flavour: "the club argued he's not that good").
- **M — AI contracts through the engine.**
  - AI re-signs and extends via `evaluateRound` against its own priorities and cap plan.
  - AI stars can reach July 1, feeding the real bidding in §3b.
- **M — Agents as actors.** A persistent agent entity with a client list. Agents initiate:
  - "my client wants a trade" for an unhappy player
  - pre-July-1 leaks to the Feed
  - holding out an unsigned RFA from camp

---

## 5. FINANCES & CAP

### What FM, EHM and the NHL do
- FM: a real balance sheet (monthly income and expenditure, bank balance); wage and transfer budgets set by the board; the board judges the finances; stadium, ticket and sponsorship income; staff costs.
- EHM: team budgets; owner spending limits (internal cap below the league cap for small markets).

### What we have
- A real cap engine: hard cap, floor `capFloorFor`, dead cap schedule, LTIR, retained slots, multi-year commitments, cap growth.
- A Finances screen: cap, salary by position, revenue estimate, ticket pricing, commitments, payroll, expiring deals (`FinancesScreen.tsx`).
- Sponsors (`sponsors.ts`), fanbase, and ticket pricing that nudges fan interest (`career.ts:7590`).

### Placeholder check
1. **Revenue is view-only arithmetic.**
   - `buildViews.ts:1250–1270` computes gate, broadcast, sponsorship and merchandise as fixed fractions of the **salary cap** × a **hash-derived market size** (`marketTier = hash(team.id) % 5`), not from the team's city or arena.
   - `career.ts:20674–20700` rescales gate and merchandise by fan interest and price, and prints an "Operating result".
   - No cash balance accumulates. `operatingResult` has no reader outside the view: a grep finds it only in `career.ts:20699` and the views.
2. **The ticket-pricing lever is half-connected.** It shifts fan interest ±2 (`career.ts:7590`) and a displayed number. Its revenue side affects nothing.
3. **`finances.budget` is effectively a label.** It is scaled by fan interest (`career.ts:8983`) and shown as the dashboard "balance" = budget − capUsed (`career.ts:15955`). No decision is gated by it.
4. **The board's "cost-cutting" mandate is judged by final standings rank as a proxy** (`board.ts:549–552`).
5. **Owner complaints are not read from any books.** The "we are bleeding money" payroll-trim request (`ownerMeddling.ts:59`) is picked from templates biased by the season mandate. There is no ledger to read.
6. **Small and large markets differ only in a displayed revenue number.** AI payrolls behave identically; there is no internal budget.
7. **The UI text contradicts the engine.** It says "Buyout dead cap … clears at season's end" (`FinancesScreen.tsx:121`), while the engine correctly spreads it over 2× the term (`career.ts:9402–9406`).

### Scores rationale
- **Decisions 1:** ticket tier only.
- **Information 2:** real cap data, fictional revenue.
- **Consequence 1.**
- **Feedback 1.**
- **UX 3:** the cap panels are clean.
- **Content 1.**
- **World aliveness 1:** AI clubs have no money constraints beyond the cap.

### Root cause
Finances were scoped as "cap management" (done well), and revenue was stubbed as a display. Nothing downstream needed money, because scouting, staff, bonuses and the owner all bypass it.

### True-depth spec
- **M — A minimal ledger.**
  - `ClubLedger { cash, seasonIncome[], seasonExpense[] }`.
  - Income per home game = capacity × attendance(fan interest, price, streak) × price. Broadcast and sponsorship monthly.
  - Expenses: payroll (including signing bonuses on Jul 1), staff and scout wages, scouting trips (§1), buyout cash.
  - Market size comes from team data (city or a DB field), not a hash.
- **M — Owner budget = internal cap.**
  - Small-market owners set a payroll budget below the cap. Exceeding it drains owner patience, and the "trim payroll" request fires *from the ledger*.
  - The board's cost-cutting mandate is judged on the operating result.
  - AI clubs obey their own budget, so there are cap-floor clubs, spenders and deadline cap dumps: world aliveness.
- **S:** fix the buyout text. Make commitments cap-growth-aware.

---

## World aliveness summary (the owner's north-star lens)

| System | Runs without you | Only reacts to you |
|---|---|---|
| Scouting | Knowledge decays | AI never scouts; no rival scouts; no competition for gems |
| Draft | AI drafts with need and bias | AI boards = truth; no AI trade-ups for coveted kids |
| Trades | AI↔AI deals ramp to the deadline; AI pitches you | Single deal template; market value, not lens |
| FA | AI clubs sign by need | Players never choose; named rivals are fictional |
| Contracts/agents | — | AI re-signs at ask; agents never initiate |
| Finances | — | No AI budgets; no market differences |

The two changes that most increase "the world runs on its own":
1. **Real FA bidding with player choice.**
2. **AI scouting departments**, which feed both AI draft boards and fogged AI trade valuation.

---

## Top recommendations (ranked)
1. **Scouting UI restructure plus scout accountability.**
   - Collapse 6 tabs into Desk / Reports / Shortlist / Search / Scouts & Coverage.
   - Merge Watch List and Shortlist; move the draft board to the Draft centre; use one rating scale.
   - Add a per-scout track record (hit rate at +2 and +4 seasons) and per-scout error direction.
   - Fix the fog leaks: auto-draft by truth, unlimited interviews, destructive Scout ▾.
   - (M)
2. **Make the world compete.**
   - Real FA bidding where players choose by priority weights (replacing the hashed "rival clubs").
   - AI scouting departments that fog AI draft boards and AI trade valuation.
   - Remove the builder's exact dry-run verdict in favour of a noisy AGM estimate.
   - (M–L)
3. **Contracts and money with teeth.**
   - Cap-indexed ask market (S; measure its effect on the autopilot dynasty).
   - Modified NTC as a real 10-team list (S).
   - Signing bonus that is buyout-proof and paid in cash.
   - A minimal club ledger with owner budgets, so revenue, pricing and owner pressure are real (M).
