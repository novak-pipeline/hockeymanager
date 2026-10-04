# Audit 3: squad building, the economy and the living world

*Read-only re-audit of `improve-loop` (HEAD 0650e98; the app was built from the worktree at 659f8cc), 2026-10-03.*
*Baselines: `docs/depth-audit-2026-09/audit-squad-building.md` and `audit-living-world.md` (2026-09-26).*
*What shipped since: Living World A (economy and AI GMs), Living World B (renewal), Offseason 3.0, the needs board, GM reputation, Recruitment, development camp 2.0, and the quick-sim recalibration.*

## Evidence base
- **Autopilot plus world-health harness.** `AP_RUN=1 AP_SEASONS=2`, the imported 32-team mod DB, seed 2029, the autopilot running FLA.
  - Output: `scratchpad/audit3/squad/ap/world-health-audit3sq.md` and `trace-latest-audit3sq.json`.
  - Kept to 2 seasons because a lever-audit job shares the CPU, so the dynasty metrics are indicative only.
- **Probe harness.** `scratchpad/audit3/squad/probe/econ.probe.test.ts` runs the real engine on the same DB and seed: 1 autopilot season, then the career advanced to 2026 day 40. It measures:
  - AHL roster sizes;
  - **1,240 trade-builder reads compared with the partner's real `evaluateProposal`**;
  - GM-reputation contacts;
  - user fog against the truth.
  - Output: `probe/out.json`.
- **The real app.** Playwright off-screen, `HOCKEY_USER_DATA` pointing at a scratch folder, and a copy of `slot-1.json` (TOR, 11 Nov 2026).
  - Real saves were SHA1-verified before and after; they are unchanged (`backup/sha1.txt`).
  - Screenshots are in `scratchpad/audit3/squad/shots/`:
    - b004 / b005 / b006 / b007: trade builder, fishing, gauge, rejection
    - b008 / b009: FA market
    - b003–b008 `rec-*`: Recruitment, all six tabs
    - b009: contract tab
    - b010: finances
    - 003: needs board
- **Process incident (fixed).** My first launch used `K:/Hockey Game/out`, which another session cleaned mid-run. My second build went to a scratch `out/` with no `node_modules` beside it, and that crashed with a dialog. All later launches came from the coordinator's worktree, after a clean-start check. All my processes are stopped.

---

## 1. What improved (old finding → status)

| # | Old finding (2026-09) | Status | Evidence |
|---|---|---|---|
| 1 | Cap stops binding: fixed-dollar asks against 4.5% cap growth | **FIXED** | `economy.ts` wage index, talent anchor and 20% max contract. Median AI payroll is **92.2%** in both seasons; 0 clubs under the floor; 0 over the ceiling in 2026. `livingEconomy.test.ts` pins a star's ask at 10–13% of the cap for 20 years. |
| 2 | Floor never enforced, AI payroll ~40–52% | **FIXED** | `aiFloorTopUp` (`contracts.ts:982`). Min AI payroll 77–79%, and 0 clubs below the floor in both seasons. |
| 3 | AI-AI trades: one shape, ~12 a season | **IMPROVED** | 62.5 a season. Shapes over 2 seasons: rental 52, prospectFor 25, capDump 16, pickSwap 12, hockey 11, goalie 5. Offseason trades run 18 a season (they were 0). Still under the 70–130 band (#12). |
| 4 | Deadline day ~1 trade | **IMPROVED, still out of band** | 12 then 7 deadline-day deals (mean 9.5) against a band of 15–35. |
| 5 | Builder showed the AI's exact verdict | **UNCHANGED in effect** | Now framed as the AGM's read, but measured as near-exact; THEIR BOOK also prints the partner's own valuation (#1). |
| 6 | AI valuation omniscient (trades, FA, waivers) | **UNCHANGED** | Still `ratedOverall` in `trades.ts:174`, `aiMarket.ts:271,466`, `contracts.ts:94` and `career.ts:15650`. Only the draft is fogged. |
| 7 | AI draft boards are the truth | **FIXED** | Per-club `scoutingDeptFor` noise plus a nation blind spot (`career.ts:12735`). |
| 8 | User "sim entire draft" picks by the truth | **FIXED** | `userAutoPick` reads Our Board (`career.ts:12680`). |
| 9 | "Rival clubs circling" were a hash; players never chose | **FIXED** (July) | `marketBidsFor` and `rankOffers` (`contracts.ts:785`, `:834`). Real bids; the player weighs money, term, a contender and role. The agent's named clubs are the real bidders. |
| 10 | Standing offers ignore clauses and role on July 1 | **UNCHANGED** | `FaUserBid` is `{salary, years}` only (`contracts.ts:~900`). |
| 11 | Offer sheets: always at the user, first club in the array | **FIXED** | Aimed at the user by an aggressive GM, not certain (`career.ts:17465`). AI-AI sheets at cap-tight clubs: 1 sheet in 2 seasons, and it walked. In band. |
| 12 | AI re-sign is a vending machine | **IMPROVED** | Loyalty and cap discipline now read; 151 AI re-signs a season. Still priced at the ask; no AI stars test July 1 on purpose. |
| 13 | GM personas decorative | **FIXED** | Each persona axis is wired into an AI behaviour (`LIVING-WORLD-ECONOMY-AND-AI.md` §4). |
| 14 | Posture = fixed thirds | **FIXED** | `deriveLivePosture`: 11/7/14 and 12/7/13 across the two seasons. |
| 15 | AI GMs immortal | **FIXED** | 2.5 GM dismissals a season with `gmChange` written (`career.ts:25746`). Coach changes run 5 a season. |
| 16 | Arbitration = one random roll | **IMPROVED** | Both sides file, a hearing is held on day 6, you can settle for 1 or 2 years (`career.ts:12154–12175`, `14203`). The award is still a random lean between the filings, with no comparables, user RFAs only, and no club election. |
| 17 | Signing bonus inert | **UNCHANGED** | Written at `career.ts:19029`, never read again (no buyout or cash effect). |
| 18 | Modified NTC = full NTC | **UNCHANGED** | `career.ts:19027`: `noTradeClause = offer.clause !== 'none'`. |
| 19 | Waiver exemption = one-way AND age ≥25 | **UNCHANGED** | `contracts.ts:126`. Claims use the true overall (`career.ts:15650`). |
| 20 | Interviews free and unlimited, on anyone | **UNCHANGED** | `requestInterview` (`career.ts:24014`): no slot limit, no draft-year gate, +10 knowledge to anyone. |
| 21 | Dev-camp reads are dice | **IMPROVED** | Scrimmage production now lifts or drops the grade (`career.ts:14759`). The base read is still `rng.float(-1,1)` (`:14657`). |
| 22 | No scout track record | **FIXED** | Recruitment merge: each scout's own board, judged two seasons later. |
| 23 | Scout ▾ silently rewrote briefs | **FIXED** | Removed in the Recruitment merge. |
| 24 | Scouting IA sprawl (6 tabs, 3 assignment views) | **IMPROVED** | Desk / Reports / Shortlist / Search / Scouts & Coverage / Draft Board (screenshots b003–b008). Reports is now list plus detail. |
| 25 | Finances: no ledger, hash market, budget a label | **UNCHANGED** | `buildViews.ts:1255` `marketTier = hash % 5`. The "Operating result" has no reader. `finances.budget` only feeds the dashboard "balance" (`career.ts:23501`). |
| 26 | Buyout text wrong; commitments assume a flat cap | **UNCHANGED** | `FinancesScreen.tsx:122` ("clears at season's end"), `:210`. |
| 27 | No youth intake (renewal cliff) | **FIXED** (LW-B) | 5,015 draft-eligibles on the Desk (b003). |
| 28 | Dynasty: FLA 14 straight 100-point seasons, 5 distinct champions per 10 | **FIXED per LW-A's 20-season run; now at risk** | Points SD is **17.0 / 17.1** in both seasons I ran, **OUT** of the 12–16 band (LW-A's pre-recalibration final was 14.7). CAR 129 and 119 points. Needs a 10-season re-run (#9). |
| 29 | Conditional picks, future considerations, three-team deals | **UNCHANGED** (absent) | No code path. LW-A §5 names this as the deadline supply limit. |
| 30 | AI floor top-up / cap compliance on IR return | **UNCHANGED** | LW-A §5. FLA (the user) sat at **103.3%** of the cap on day 30 of 2025, and LAK at 100.1%. |

---

## 2. Measurements (2 seasons, imported league, seed 2029)

| metric | 2025 | 2026 | NHL band | verdict |
|---|---|---|---|---|
| points SD | 17.0 | 17.1 | 12–16 | **OUT** |
| max / min points | 129 / 62 | 119 / 50 | ≤ ~135 | ok |
| median AI payroll | 92% (79–100) | 92% (77–100) | 85–98% | in band |
| clubs under the floor / over the cap | 0 / 2 (incl. the user) | 0 / 0 | 0 / 0 | ok |
| trades AI-AI / with the user | 57 / 0 | 64 / 4 | 70–130 | **OUT** (low) |
| in-season / deadline day / offseason | — | 43 / 7 / 18 | DD 15–35 | **OUT** (DD) |
| AI FA signings (stars ≥78) | 73 | 60 (7) | — | busy |
| AI re-signs | — | 151 | — | — |
| offer sheets AI-AI / at the user | 1 (walked) / 0 | 0 / 0 | ~0–1 | ok |
| posture contend / retool / rebuild | 11/7/14 | 12/7/13 | reacts | ok |
| GM / coach changes | 2 / 4 | 3 / 6 | ~2–4 / ~6–8 | ok |

**The AGM read against the real answer** (probe, 1,240 builder reads; each real answer averaged over 5 independent mood draws):

| AGM chip | n | real accept | real counter | real reject |
|---|---|---|---|---|
| "They'd accept" | 309 | **94%** | 6% | **0%** |
| "They'd want more" | 106 | 13% | 72% | 15% |
| "They'd reject" | 787 | **0%** | 1% | 99% |

GM-reputation contacts recorded across all 1,240 reads: **0**.

**Fog.** The user's view of rival NHL players is within ±2 of the truth. The AI's view of everyone is exact.

**AHL roster sizes** (all 32 affiliates, fresh career from the DB):

| point in time | min | median | max |
|---|---|---|---|
| Start | 24 | ~38 | 46 |
| After 1 rollover | 18 | ~40 | **64** |
| In-season 2026 | 18 | ~40 | **65** |
| Owner's slot-1 (Jul) | 28 | 56 | 70 |
| Owner's autosave (Sep 29) | 31 | 62 | **82** |

---

## 3. Findings

Severity: **S1** breaks the core loop or trust; **S2** is a real depth or fun gap; **S3** is polish or correctness.
Fix size: **S** < half a day, **M** 1–3 days, **L** a week or more.

### A. Exploits and information leaks

**F1 (S1): The trade builder still hands you the answer, and fishing is free.**
- **Evidence.**
  - The probe: a "They'd accept" chip comes back accepted 94% of the time and never rejected. A "They'd reject" chip is accepted 0% of the time. That is 1,240 reads and **0** reputation contacts.
  - In the app (b004/b005), **THEIR BOOK** prints the partner's own lens valuation ("they price your side ~60% above the market").
- **Root cause.**
  - `partnerDraftVerdict` (`career.ts:19403`) runs the real `evaluateProposal`. The only noise is a misread of `relationship`, which moves the threshold by at most ±0.1 (`trades.ts:1091`). That bias is **constant for the week per partner**, so the ordering of packages is exact: add value until the chip turns green.
  - `evaluateTradeDraft` never calls `noteContact` (contacts are recorded only at `:19504` gauge and `:19815` offer).
  - `lensLine`, `partnerGiveTotal` and `partnerReceiveTotal` (rendered at `TradesScreen.tsx:1322–1335`) expose the club lens directly.
- **Fix (M).**
  - Make the AGM read a noisy estimate of the value *ratio*, re-drawn per package (σ from AGM judgment), and bucket it.
  - Show THEIR BOOK only after a gauge or offer, and as a range.
  - Count every builder read past the first N per partner per day as a reputation "gauge".
- **Acceptance check.** Repeat the probe: P(real accept | "likely") is 60–80%, and P(real accept | "long shot") is ≥5%. Shuffling 20 packages against one club in one day produces the reputation warning.

**F2 (S2): In-season free agency shows bids that do not exist.**
- **Evidence.** On 11 Nov (b009), 45 free agents each read "On the table: DET $1.7M×1 · LAK $1.7M×1 · CBJ $1.7M×1 +11", a "Leaning DET" line and a "~2d" clock. The same three clubs (MIN/DET/MTL) top every forward, at identical money.
- **Root cause.**
  - `faLiveOffers` (`career.ts:18090`) calls `marketBidsFor` regardless of phase.
  - The only AI signing path, `aiFreeAgencyDay`, runs inside the offseason FA stage (`career.ts:12266`). Nothing signs in-season, so the "offers" and the clock are fiction, against the owner's no-fake-text rule.
  - Identical money comes from `over = 0.1 × aggression × upgrade/6`, rounded to $25K (`contracts.ts:815`).
- **Fix (M).** Either run a light in-season market (a weekly `aiFreeAgencyDay` for clubs with injuries or holes, PTO-style one-year deals), or hide "On the table" and the clock outside July and say "no club has called yet".
- **Acceptance check.** In November, every name listed "On the table" either signs within the stated clock or isn't shown. Over a season, in-season AI FA signings are > 0 and the wire reports them.

**F3 (S2): The AI is still omniscient everywhere except the draft.**
- **Evidence.** AI trade valuation, FA bids and waiver claims all use the true `ratedOverall`: `trades.ts:174` and `:205`, `aiMarket.ts:254–480`, `contracts.ts:94` (FA `upgrade`), `career.ts:15650` (waiver claimants).
- **Consequence.** There is no "buy low on a player they misjudge" and no "they love our kid", and a hot streak never fools anyone. Out-scouting the league pays off only on draft day.
- **Fix (M).** Pass `scoutingDeptFor(teamId)` into a `clubRead(p)` that is the true overall plus club-and-player-seeded noise ∝ (1 − quality), plus the blind-spot nation. Use it in `clubPlayerValue`, `clubWant` and the waiver bar.
- **Acceptance check.** Over a season, at least 3 AI-AI trades are value-negative by the truth at +1 year, and the hindsight panel names one. Tests show two clubs valuing the same RFA differently.

**F4 (S2): Interviews are unlimited, free, and work on anyone in the world.**
- **Evidence.** `career.ts:24014–24055`: no slot count, no draft-eligible gate, `addKnowledge(…, 10)` on any player, including NHL stars.
- **Fix (S).** 20 combine interview slots per draft year, draft-eligibles only, and the knowledge gain limited to personality.
- **Acceptance check.** The 21st request is refused with a slot message. Interviewing an NHL veteran is not offered.

### B. Decisions without a trade-off (inert levers)

**F5 (S2): The signing bonus is a free concession.** It is written at `career.ts:19029` and read nowhere (no buyout exclusion, no cash). The agent prices it, so agreeing to it is pure upside for the GM.
- **Fix (S/M).** The buyout computes on salary minus bonus. When the ledger lands (#F11), the bonus is paid in July.
- **Acceptance check.** Buying out a 50%-bonus contract saves visibly less than buying out the same contract without the bonus.

**F6 (S2): A modified NTC is the same as a full NTC.** `career.ts:19027` sets a boolean, and `evaluateProposal` blocks on any NTC (`trades.ts:1094–1098`).
- **Fix (S).** A modified NTC generates a 10-club no-trade list from the player's priorities. Only listed partners are blocked; the AI respects it.
- **Acceptance check.** A modified-NTC player can be traded to an unlisted club without a waive talk, and the profile shows the list.

**F7 (S2): The ELC "slide" is text only.**
- **Evidence.** Dev camp says "signs his entry-level deal and goes back … the deal slides" (`career.ts:15170`). But `offseason.ts:332` decrements `yearsRemaining` for **every** player, and there is no restore path anywhere (grep: no `yearsRemaining += 1`).
- **Consequence.** The "burn a year?" decision has no cost difference, and the text claims a rule the engine doesn't apply.
- **Fix (S).** Skip the decrement for 18- and 19-year-old ELC players who played under 10 NHL games, and log the slide.
- **Acceptance check.** Sign a 19-year-old's ELC and return him to junior. At the next rollover his contract still shows 3 years.

**F8 (S2): Standing FA offers ignore clauses, role and bonus.** `FaUserBid { salary, years }` (`contracts.ts`), and `rankOffers` scores only money, term, win and role-from-upgrade.
- **Fix (S).** Carry `clause`, `rolePitch` and `bonusPct` in `FaUserBid`, and add their weights in `rankOffers` (the AI bids get zero or the persona default).
- **Acceptance check.** The same money with an NTC plus a top-6 role beats an equal AI bid for a ring-chaser vet, and the loss reason can cite "the role".

**F9 (S2): Arbitration has no case.**
- **Evidence.** The award is `clubFiling + (playerFiling − clubFiling) × U(0.3, 0.7)` (`career.ts:12166–12168`). There are no comparables (although `findComparables` exists), no club election, and AI clubs never arbitrate.
- **Fix (M).** Lean the award toward the filing closer to the comparables' median. Add a club-elected hearing for the user, and apply the same hearings to AI RFAs (news only).
- **Acceptance check.** Over 10 cases, the award sits on the comparable side ≥70% of the time. One AI hearing appears on the wire each summer.

### C. AI stupidity and world realism

**F10 (S2): AI farm rosters bloat without limit.**
- **Evidence.** AHL affiliates median ~40 and max **64–65** after one season in a fresh career. The owner's Sep 29 autosave has median 62 and max **82**. The trade builder lists 70+ TOR farm bodies (b004).
- **Root cause.** `ORG_CONTRACT_LIMIT = 50` (`career.ts:1153`) is enforced only for the user (`:9063`, `:17821`). Nothing trims AI affiliates. Draft graduations, dev-camp ELCs and the world FA sweep only ever add.
- **Fix (M).** Apply the 50-contract limit plus an AHL active cap (~30) to AI orgs at rollover. Release the lowest-value AHL-contract players to the world FA pool.
- **Acceptance check.** After 5 seasons, every AHL affiliate holds 24–32 players and every org holds ≤50 NHL contracts.

**F11 (S2): Money is still not real.**
- **Evidence.**
  - Revenue is still `hash(team.id) % 5` market tiers (`buildViews.ts:1255`).
  - The "Operating result +$44.6M" (b010) has no reader.
  - The owner budget % only feeds the dashboard "balance".
  - Scouting wages ($5.06M, b003) cost nothing.
- **Fix (M).** A minimal ledger (as specified in audit 2 §5): per-game gate income; payroll, bonus, staff and buyout expenses; an owner payroll budget below the cap for small markets; AI clubs obey their own budget.
- **Acceptance check.** Two seasons of overspending trigger an owner payroll-trim request that cites the ledger figure. A small-market AI club runs at 80–88% of the cap by choice.

**F12 (S2): The deadline and the league market are still supply-starved.**
- **Evidence.** 62.5 trades a season and 7–12 on deadline day, against bands of 70–130 and 15–35.
- **Root cause (LW-A §5, unchanged).** Depth vets are valued below a 7th-round pick, and there is no smaller currency.
- **Fix (M).** Add a "future considerations" or conditional-7th currency, with conditions resolved at season end.
- **Acceptance check.** Deadline day carries ≥15 trades in 3 of 3 seasons, and ≥2 of them are depth-for-future-considerations.

**F13 (S2): The user cannot retain salary.** The engine supports retention (#157, `trades.ts:19–21`, `:881`) for AI-AI deals only. `TradeProposal` has no retention field (`views.ts:1660`), and the builder has no control (grep "retain" in renderer: 0 hits). This is a core NHL deadline lever.
- **Fix (S/M).** A retain % slider (max 50%, 3 slots) on outgoing players, fed into `evaluateProposal` (it already prices it).
- **Acceptance check.** At 50% retained, a capped contender accepts a rental it would reject at 0%, and the cap page shows the retained slot.

**F14 (S2): The headline-asset rule is invisible until you send.**
- **Evidence.** b007: two 1sts, Knies, Cowan, Danford and Rielly for Fox is rejected with "they need the best asset in the deal coming back their way". Before sending, the same screen showed three contradictory reads: "~44% ahead on paper", "their book prices your side 60% above market" and "we're fleecing them", plus a "long shot" chip.
- **Root cause.** The cornerstone/headline rule (`trades.ts:1217–1238`) is not surfaced in the draft view. The copy bug at `:1237` (the "Quantity is not quality —" prefix keys on the wrong side) leaves "pass. they need…" in lowercase.
- **Fix (S).** When the rule binds, the AGM says "Fox is their cornerstone; it takes a player of his class coming back". Fix the side and the capitalisation.
- **Acceptance check.** In this exact deal the AGM line names the rule before sending, and the rejection text is grammatical.

**F15 (S2): Parity drifted out of band after the quick-sim recalibration.** Points SD 17.0/17.1 against LW-A's final of 14.7 (measured before `76e0071`).
- **Fix (S to measure, then M).** Re-run `AP_SEASONS=10` on seed 2029 and seed 777. If it holds above 16, re-tune the quick-sim talent spread (not the economy).
- **Acceptance check.** The 10-season mean SD is 12–16, there are ≥6 distinct champions, and the longest run of 100-point seasons is ≤7.

**F16 (S3): No in-season AI cap compliance; the user can sit over the ceiling.** FLA (user) was at 103.3% and LAK at 100.1% on day 30 of 2025, and there is no compliance prompt (LW-A §5, unchanged).
- **Fix (M).** Daily compliance for AI clubs (send down, or move to LTIR). For the user, a blocking "get cap-compliant" gate.
- **Acceptance check.** No club is above 100% at any sample day.

**F17 (S3): Waiver exemption is still simplified.** `contracts.ts:126`. Young one-way veterans dodge waivers, and two-way deals are wrongly made exempt.
- **Fix (S).** An age-at-signing × games/seasons table.
- **Acceptance check.** A 22-year-old on a one-way deal with 200 or more games requires waivers.

### D. UI friction and copy

**F18 (S3): "Cap room next season" is this season's number in-season.**
- **Evidence.** It shows $5.7M with $86.3M committed (b003), identical to current space. The Finances table says 2027–28 has $16.8M (b010).
- **Root cause.** `underContract = offseason ? yearsRemaining > 0 : true` (`career.ts:18377`), plus no cap growth.
- **Fix (S).** Always count `yearsRemaining > 1` in-season and use the projected cap.
- **Acceptance check.** In November the needs board matches the Finances 2027–28 row.

**F19 (S3): Reports "Sort: grade" puts A+ last.** `GRADE_ORDER` lacks 'A+' (`ScoutingScreen.tsx:837`). A+ reports (Sandin Pellikka, Hutson) sort below B.
- **Fix (S).** Add `'A+': -1`.
- **Acceptance check.** A+ rows sort first.

**F20 (S3): The first gauge of the week reads like a repeat.** "No. And I'd rather not be made to say it twice in the same week" fired on the first call (b006). `tradeTalk.ts:691–694` `tt.ga.cool.shark` has no `minRound: 2`. The chip said "Lukewarm" while the line is from the `cool` pool.
- **Fix (S).** Gate the line on round 2 or later, and align the chip label with the lean.
- **Acceptance check.** The first gauge never uses a "twice" line.

**F21 (S3): Extension talks are gated to January.** `extension.ts:97` "open at the turn of the calendar year". The NHL allows them from July 1 of the final year. This removes a summer decision (extend now vs. wait).
- **Fix (S).** Open from July 1 of the final contract year.
- **Acceptance check.** Maccelli (1 year left) can be offered an extension in November.

**F22 (S3): Recruitment reports carry no price or availability.**
- **Evidence.** A reports for NHL-rostered players (Kantserov CHI, Kasper DET; b004-rec) offer only Shortlist / Take another look / Pass. There is no contract, no "CHI rebuilding, would sell", no asset-value price and no "Open in trade builder".
- **Fix (S).** Reuse the needs-board candidate line (stance, price tier) and add an Enquire button.
- **Acceptance check.** Every report on a rostered player shows a price tier, and one click opens the builder with him asked for.

**F23 (S3): Buyout copy and flat-cap commitments, unchanged since audit 2.** `FinancesScreen.tsx:122`, `:210`.
- **Fix (S).**
- **Acceptance check.** The text says "spread over 2× the remaining term", and the commitments use the projected cap.

---

## 4. Remaining gaps against FM / EHM depth (missing systems that matter)

| System | State | Why it matters |
|---|---|---|
| Retained salary (user) | missing (F13) | The core NHL deadline lever. |
| Conditional picks, future considerations, three-team deals | missing (F12) | The deadline supply and story layer. |
| Club ledger and owner budgets | missing (F11) | Small and big markets differ only in a label. |
| In-season FA, PTOs, AI injury signings | missing (F2) | A November market that is dead, yet shown as live. |
| AI scouting outside the draft | missing (F3) | "Out-scout the league" ends on draft day. |
| AI cap compliance / LTIR | missing (F16) | |
| AI farm limits | missing (F10) | 60–80-man AHL rosters. |
| ELC slide and ELC bonuses | text only (F7) | |
| Modified NTC lists, signing bonus effects | inert (F5, F6) | |
| Arbitration with comparables, club-elected, AI hearings | thin (F9) | |
| CBA waiver exemption | simplified (F17) | |
| Draftee rights clock (CHL 2 summers, NCAA, Europe) | missing | Holding rights is free until age 20, so there is no "sign him or lose him" decision. |
| Hindsight trade grades for user and league deals | missing | `pickBecame` / `tradesBetween` are still unused for league retrospectives. |
| 7-round draft, lottery, offer sheets both ways, AI GM firings, real FA bidding | **present** | No action. |

---

## 5. Ranked top 15

| Rank | Finding | Severity | Size | One-line acceptance check |
|---|---|---|---|---|
| 1 | F1: builder leak (exact chip, THEIR BOOK, free fishing) | S1 | M | "Likely" is accepted 60–80% of the time, and 20 reads in a day draw the reputation warning. |
| 2 | F2: fake in-season FA bids and clock | S2 | M | Nothing listed "on the table" fails to sign within its clock. |
| 3 | F3: AI omniscient in trades, FA and waivers | S2 | M | ≥3 AI deals a season are wrong by the truth at +1 year. |
| 4 | F10: AI farm bloat (64–82 AHL players) | S2 | M | Every AHL club holds 24–32 players after 5 seasons. |
| 5 | F15: parity SD 17 after the recalibration | S2 | S→M | 10-season SD in 12–16. |
| 6 | F12: deadline supply (7–12 against 15–35) | S2 | M | ≥15 deadline-day deals in 3 of 3 seasons. |
| 7 | F13: no user salary retention | S2 | S/M | 50% retained flips a rental verdict. |
| 8 | F11: money not real (hash market, no ledger) | S2 | M | A ledger-cited owner trim request; small-market AI clubs below 90% of the cap. |
| 9 | F7: ELC slide is text only | S2 | S | A returned 19-year-old keeps 3 ELC years. |
| 10 | F14: hidden headline rule plus three contradictory reads | S2 | S | The AGM names the cornerstone rule before sending. |
| 11 | F8: July 1 ignores clauses and role | S2 | S | NTC plus role beats equal money for a vet. |
| 12 | F6: modified NTC = full | S2 | S | Trade to an unlisted club without a waive talk. |
| 13 | F5: signing bonus inert | S2 | S/M | The buyout saves less with a bonus. |
| 14 | F4: unlimited interviews | S2 | S | The 21st interview is refused. |
| 15 | F9: arbitration without a case | S2 | M | ≥70% of awards land on the comparable side. |

Quick S3 sweep, about a day in total: F18, F19, F20, F21, F22, F23, F17, F16 (AI part).
