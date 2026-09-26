# PHASE 0 — trust and quiet (depth audit 2026-09)

Brief: `docs/depth-audit-2026-09/report.html` (PHASE 0), `audit-gameplay-loop.md`,
`audit-people-story.md` ("Immediate bug list"), `audit-onice-dev.md`.
Branch `phase-0`. Owner rules applied: fun over realism; Continue always
advances; real moments open themselves as scenes; everything else goes to the
inbox / week ahead; hard gates stop once with an inline one-click fix; the
board speaks at three moments a year plus when the job is really at risk.

Already fixed on `improve-loop` before this branch (verified, not redone):
champion article, owner commitments, scene/negotiation promise due dates,
decision-event acts, inbox repetition, AI GM firings.

## A. Bugs — before / after

| # | Bug | Before | After | Regression test(s) |
|---|-----|--------|-------|--------------------|
| 1 | Ice-time promise baseline | Baseline and verdict read `player.stats`, which is written only at rollover. Mid-season every baseline was 0 GP / 0 TOI, so any ice at all "kept" the promise. | Baseline and verdict read the live accumulators (`this.gp` / `this.totals`) via `seasonIceLine()`. A healthy-scratch confrontation is now an `iceTime` concern, so a promise made there is measured too. | `promisedActions.test.ts`: "ice-time promise: his minutes go up after the talk → KEPT", "…stay where they were → BROKEN" (real sims for the baseline) |
| 2 | Living Ledger scale | Thresholds written for 0–100 (`temperament < 45`, `professionalism > 60`…), but personalities are generated on 1–20. Every "hot" test was true and every "pro" test false, so every man reacted the same way. Scratches used the "you shopped me" copy. | Shared `PERSONALITY` bands on 1–20. Voice pools rescaled the same way. Healthy scratches get their own confrontation family, setup line and options. Send-downs already arrive by agent phone with their own copy. Test fixtures moved to 1–20. | `livingLedger.test.ts` › "personality on the REAL 1–20 scale" (5 tests); `voices.test.ts` fixtures |
| 3 | Ignored concerns cost nothing, and two open ones block all new ones | An unanswered card stayed open forever. Two of them silently blocked every new concern and decision scene. | After `CONCERN_EXPIRY_DAYS` (8) the concern lapses: `wasDismissed` residue (the agent raises it at contract talks via `grudgeContext`), a morale hit scaled by professionalism, a room nick if it was serious, and an agent note in the inbox (no stop). The slot is freed. A dismissive answer to his face also leaves residue. | `phase0.test.ts` › "an ignored concern is an answer" (2 tests) |
| 4 | The generic concern always had one right answer | Fixed table: supportive +8 beat firm +2 for everyone below professionalism 20. Volatility used HIGH temperament, the opposite of the ledger's convention. | `toneDelta()` = personality × history. Reassurance lands with the insecure and wears out when repeated. Firm lands with professionals and driven players. A promise is worth your record with him (kept or broken). Low temperament amplifies the swing. Kept rather than retired: the four tones now read the man, and authored decision events still take over where they exist. | `interactions.test.ts` › "tone model — no dominant answer" (5 tests, including a whole-league split) |
| 5 | Squad status was a morale pump | No limit on Key or Core. Label everyone "key" and bank the weekly lift. Surplus cost nothing. | Caps: Key ≤ 2 and Core ≤ 6 across the org. A refused assignment explains why (worker returns an error, toast in Squad Planner). Auto-assign respects the caps. Old over-cap saves only honour the best N. Surplus costs −1/week (−2 if ambitious). | `phase0.test.ts` › "squad status is a scarce promise" (3 tests) |
| 6 | Medical risk vs injury model | The Medical Center showed a proneness+fatigue blend that the sim never read. Fatigue did not affect injuries, and the physio did nothing. | `injuryChance()` includes fatigue (max ×1.6) and head-physio quality (risk ±10%, layoff length ±20%). The Medical Center and the staff meeting quote `modelledInjuryRisk()`, which derives from that same function. | `phase0.test.ts` › "medical: the risk shown is the risk the sim rolls" (2 tests) |
| 7 | Line synergy was user-only | AI clubs got synergy ×1, so line-building was an edge the AI could never have. | Synergy applies to every club, like chemistry. Lever-audit tripwires (`leverGuard`, `leverStaticAudit`, `leverFixes`, `deploymentValue`) are green, and no pinned seed needed to move. | `phase0.test.ts` › "line synergy is one rule for the whole league" |
| 8a | Takeover year off by one | The summer was dated `year` on takeover, so its September read 2025 and the next press read 2026. | Summer is always `year + 1`. Construction mail is re-dated to the first summer day. | `phase0.test.ts` › "the takeover summer is the summer BEFORE the season…" |
| 8b | Draft label vs route | On draft day the button read "end-of-season review" while Continue routed to the draft. | The draft (a hard gate) outranks everything in the summer label. | `continueLabel.test.ts` › "draft day: the button names the DRAFT even with the season review still staged" |
| 8c | "Camp is over" mail on day 1 | "Cut day — camp verdicts are in" was sent the day camp opened. | Camp opens with "Training camp opens". The verdict mail comes on cut day. | `phase0.test.ts` › "'camp is over' mail waits for cut day…" |
| 8d | Dev camp dates | All three dev-camp beats were stamped on the same day. | Jun 22–24, one day per beat. The calendar marker sits on Jun 22. | `phase0.test.ts` (takeover test, dev-camp dates) |
| 8e | No "season over" beat | After elimination: 4+ empty "next playoff games" presses (21 in the measured year). | One press: "Continue — sim to the end of the playoffs", then a "The rest of the playoffs" bracket digest. | `phase0.test.ts` › "knocked out: ONE press sims to the Cup…" |
| 8f | The Apr→Jun gap | One press jumped to Jun 18 and dumped about 60 items. | Four dated presses: lottery (May 5) → combine (Jun 2) → awards night (Jun 18) → entry draft (Jun 20). Mail is staged to its real date (`stagedNews`, saved). The calendar shows the same dates. | `phase0.test.ts` › "the Apr→Jun gap is staged…" |
| 9 | Copy that promises nothing | The Data Hub hire panel advertised "shot maps", which don't exist. | Removed. | — |

## B. Interruption diet

What changed:

- **Continue always advances.** `routeContinue` never routes. Beat labels such as
  "Continue — staff meeting" are gone: the label names where time goes next.
  A moment that *arrives* on a press opens its own scene (`sceneToOpen`). A
  gate you walked away from is delegated, exactly as a beat simmed past always
  was.
- **Hard gates** (captain, illegal lineup) offer an inline one-click fix
  ("let the coach name him" / "let the AGM sign emergency cover").
- **Overlay re-tier** (`cadence.worthAStop`). The overlay stops only for:
  decisions and their answers (contracts), milestones, awards, draft, playoffs,
  `rare` stories, and high-salience items such as a key man (top-9 F, top-4 D,
  starting G) out 3+ games, or deadline day. It no longer stops for: scouting
  reports, press columns, the social feed, depth or day-to-day injuries,
  own-club slump/streak colour, agent grievance receipts, or trade-desk mail.
- **Routine results ride on the next match-day frame** (`receiptWorthAStop`).
  A result stops on its own only when it is a story: playoff game, chronicle
  storyline, 4+ goal margin, shutout, or the season finale. Otherwise the next
  pregame frame opens with a "Last game" strip (score, first star, lede, box
  score link).
- **Quiet league days roll** on one Continue press, up to 6 in a row, like
  FM's Continue. The roll stops at a match-day frame, a scene, a real story, a
  hard gate, or the end of the regular season.
- **Trade offers** reach the GM (and gate) only if one of these holds:
  1. They touch a Key/Core, untouchable, available or listed player.
  2. They return ≥ 1.3× on your own valuation.
  3. It is deadline week.

  Everything else is the AGM's, reported in a weekly "Trade desk: N calls this
  week" digest.
- **Staff meetings are event-triggered.** They convene only on a threshold
  finding (cold top-six, injury risk, worn body, prospect ready), with a 21-day
  minimum gap. A Responsibilities setting on the Staff Meeting screen offers
  "when something needs me" (default), "every week", or "let the AGM run
  them". Info-only briefings move to the dashboard's week ahead.
- **Scout meetings** convene only in the World Juniors window, deadline week,
  and the draft run-up (March onward). The rest of the year they are delegated
  to the Head of Scouting.
- **Board: three moments.**
  1. Preseason expectations (existing).
  2. A new deadline checkpoint mail.
  3. The season verdict (existing).

  "Board praises" mail is sent at most once a season. Warnings still come
  through. Between the three moments the dashboard chip shows a one-line
  board mood.

Measured with `src/renderer/lib/loopMeasure.harness.test.ts`: imported NHL DB,
Pittsburgh, seed 2029, one delegated year from the summer takeover. Run with:

```
LOOP_RUN=1 M_DB="K:/Hockey Game/mods/nhl-ehm/database.json" M_SEED=2029 M_TEAM=pitts \
  npx vitest run src/renderer/lib/loopMeasure.harness.test.ts
```

Click model: advance = 1, +1 if the overlay holds; spend = 1; hard gate = 2;
auto-opened scene = 0; rolled quiet day = 0. A user-game day is never counted
as rolled. The pregame press is left out in both builds.

| Measure | Before (improve-loop) | After (phase-0) | Target |
|---|---|---|---|
| Overlay holds / advances | 116 / 139 (**83%**) | 45 / 164 (**27%**) | ≤ 35% |
| Holds on days without your game | — | 15 / 92 (16%) | — |
| Blocking beat stops, regular season | **44** (24 trade offers, 13 staff, 6 scout, 1 deadline) | **19** (8 trade offers, 8 staff, 2 scout, 1 deadline) | — |
| Staff meetings convened | 13 (every 14 days) | 8 (≈ 1 per 3.3 weeks) | ≤ 1 per 3 weeks |
| Continue routes (detours) | 44 | 0 (all 19 moments open themselves) | 0 |
| **Clicks per user game** | **4.18** | **2.16** | ~2.2 |
| Offseason + preseason presses | 87 | 51 | — |
| Empty playoff presses after elimination | 21 | 0 | 0 |
| Biggest single-press mail dump | 55 | 41 | — |

Staged "after" numbers, from the same harness (the rolled-day correction was
added at step 3):

1. Engine diet + mail re-tier: 51% holds, 2.44 clicks/game.
2. Plus routine results riding on the match-day frame: 35%.
3. Plus the social feed, day-to-day key injuries and agent grievance receipts
   no longer stopping: 27%, 2.16 clicks/game.

Side effect worth knowing: concerns now expire, so the delegate-everything
playthrough sees about twice as many concerns and decision scenes as before
(16 in the year vs 4). The old cap of two open cards had been choking them.
These are real people moments, not timers.

## Contracts

- `views.ts`, `protocol.ts`: additive optional fields only — `DashboardView.staffMeetingMode`,
  `staffBrief`, `CareerSnapshot.stagedNews` / `staffMeetingMode` / `lastStaffMeeting`,
  and a `setStaffMeetingMode` request.
- `events.ts`, `rendererContract.ts`: untouched.
- Old saves load: every new snapshot field is optional with a default.
  Over-cap Key/Core labels from old saves are honoured only for the best N.

## Gates (at `0f2c854`)

- `npm run typecheck`: clean.
- Fresh-cache tsc counts: **193 web / 164 node** (ceiling 194 / 165).
- Full suite: 2957 passed. Five heavy full-sim tests timed out under machine
  load: `goaliePull`, `rivalryIntensity`, `goalieNight`, `rules`,
  `scoreEffects`. Each passes when run alone.
- Lever-audit tripwires green: `leverGuard`, `leverStaticAudit`, `leverFixes`,
  `deploymentValue`.
- Autopilot, 5 seasons on the imported NHL DB: **0 critical, 0 major**, 1 minor.
  The minor is a pre-existing club-statement repetition. An earlier run flagged
  "Trade desk" headline repetition; the headline now names the week's story.
