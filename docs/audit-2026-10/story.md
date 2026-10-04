# Audit 3: People and story (re-audit)

Area: morale and the locker room, concerns and scenes, the phone, promises, media and the Feed, the inbox, the board and owner, staff meetings, GM career and reputation, rivalries and hockey soul, Wrapped and history, and the writing quality of all of it.

- **Build:** `improve-loop` @ `659f8cc`, built in `.claude/worktrees/audit-story`.
- **Read-only:** no repo edits and no commits. The only files written are this one and `writing-issues.json` next to it.
- **Baseline:** `docs/depth-audit-2026-09/audit-people-story.md` (2026-09-26).

## Evidence base

### 1. Headless season (instrumented autopilot)

- **Run:** one full season, `runAutopilot` on the mod DB (imported 32-team NHL), seed 2029, user club Florida. It covers the 2025–26 regular season, playoffs and offseason, up to the 2026 camp.
- **Instrumentation:** a wrapper recorded every `pushNews` call (2,401 items, each flagged if it reached the curated inbox) and every `step()`:
  - the dashboard gate flags;
  - morale for every roster player;
  - room morale;
  - every player-facing view string, from 30 views: pressers, board and season review, staff and scout meetings, dev camp, the needs board, postgame, match preview, the beat, Dynamics, player profiles, the Feed, Wrapped and the chronicle.
- **Location:** harness, outputs and analysis scripts are in `<scratchpad>/audit3/story/{h,out}`. The two harness files are `season.story.test.ts` and `corpus.story.test.ts`. 0 critical and 0 major autopilot issues.

### 2. The real app

- **Build:** built in the audit-story worktree, driven off-screen by Playwright with `HOCKEY_USER_DATA=<scratch>/ud`.
- **Save:** a copy of the owner's saves (the Pittsburgh autosave of 29 Sep, 2026–27 season, day 11).
- **What I did:** played from 11 Oct to 11 Nov 2026. I read the inbox, answered a presser, took a phone call, answered a scene, and opened the Feed, GM Career, Media Circuit, Club Vision, Dynamics and the Yearbook.
- **Screenshots:** `<scratchpad>/audit3/story/shots/b001…b024`.
- **Save integrity:** the real saves were backed up first and SHA1-verified unchanged afterwards (`autosave.json 838bbcbb…`, `slot-1.json a1704b7e…`, both OK).
- **Process cleanup:** all my processes are stopped.
- **Launch hazard (affects every auditor):** the main process clamps the window back to (1,1) on the primary display. Neither `setBounds` to x=4200/6000 nor `unmaximize` holds, and the squad driver's "x = primary width + 60" lands on the owner's second monitor. I made the window invisible and click-through (`setOpacity(0)`, `setIgnoreMouseEvents(true)`), and Playwright screenshots still work. Future drivers should do this at launch.

### 3. Code read

Code reads checked every old finding at file:line.

---

## 0. Verdict

The trust layer got real. Promises, owner commitments, ignored concerns, press claims, pundit tilt, people events in the chronicle, AI GM firings, squad-status caps and the Living Ledger's personality scale are all fixed and judged against real state. Wrapped and the GM-reputation layer exist and read true. The delegation spam is gone.

The two things the owner feels most are still there:

1. **The people layer still has no memory.** Morale still drifts 5% a day back to 60 (`condition.ts:217-218, 295`). After a season of scenes, promises and concerns, the whole roster sits at **56.8 ± 3.7**. Room morale still feeds nothing in the sim. The feud call is the worst example: the same two players raised the same complaint 4 times in one season, and "addressing the room" twice changed nothing.
2. **The writing.** I measured it across a whole season:
   - **648 grammar/placeholder hits.** Most are "Omsk Omsk"-style doubled club names; there is also a literal `{last}` in a scene outcome.
   - **134 false or nonsense lines.** Examples: "twenty-nine candles" for Malkin, "playoff race" on opening night, "Standings are undefeated" for an 0–1–2 club, "midway through the season" in early November.
   - **Repetition:** the inbox repeats 2.35 sentences per sentence shape, and the beat's grade lines run 10–80 times.
   - **AI-voiced pundit personas:** columns are built from verbal tics.

   The "AI sound" is no longer banned words; the writing pass removed "testament" and "delve" entirely. It is now **structure**:
   - aphoristic closers: "which is how they say no", "quietly is how these things start", "which is how you know it has arrived";
   - em-dash chains;
   - personas built from tics: "I'll tell you what, folks —", "Make of that what you will — and I'll tell you what I make of it";
   - context-free filler: "Hard to find on the ice. That can be good or bad."

---

## 1. What improved since the 2026-09 audit

| # | Old finding (2026-09) | Status | Evidence |
|---|---|---|---|
| 1 | Morale is one scalar drifting 5%/day to 60; consequences fade (half-life ~13 days) | **UNCHANGED** (partly mitigated) | `condition.ts:217-218, 295` unchanged. Season end: 28-man roster mean 56.8, sd 3.7. Seth Jones dropped 58.7→44.8 and recovered half the gap in 20 days. Mitigation: deployment morale now re-applies every game while the cause persists (`condition.ts:320-397`), and residue flags (`wasDismissed`, grudges) persist to the contract table. |
| 2 | In-season ice-time promises always broken (baseline read `p.stats`) | **FIXED** | `career.ts:4001-4013` reads `seasonIceLine` (live accumulators). Judged daily at `career.ts:4881-4925` with a grace extension. |
| 3 | Scene/negotiation ice-time promises always "kept" (no `dueDay`) | **FIXED**, with a leak | Every kind now gets terms (`career.ts:4006`). Leak: a summer promise gets baseline 0/0, so `perBefore <= 0 → kept if perAfter > 0` (`career.ts:4006, 4887`). Any ice time at all keeps it. S3. |
| 4 | Living Ledger thresholds on a 0–100 scale (personality is 1–20) | **FIXED** | `livingLedger.ts:79-80, 169-172, 298-313` use `PERSONALITY.*`. Scratch confrontations have their own pool. |
| 5 | Room morale written, never read by the sim | **UNCHANGED** | Readers are still only `dynamics.ts:519-520`, `playerMindset.ts:344-441` and the dilemma trigger at `career.ts:3807`. Nothing in `condition.ts` or the sims reads it. In-app, Dynamics shows "Team cohesion: Very poor" next to "Locker room: Good"; neither changes a result. |
| 6 | "Morale contagion" claimed but absent | **UNCHANGED** | A grep for "contagion" finds only the `dynamics.ts:15` comment. |
| 7 | Concern text ignores the player (`messageFor(_p)`) | **UNCHANGED** | `interactions.ts:211-228`. In one season "I wanted to talk about my future…" ran 3×, "I feel like I'm ready for more out there…" 2×, and the feud line 4×. |
| 8 | Ignoring a concern is free and blocks the system | **FIXED**, but **REGRESSED** for summer scenes | Concerns lapse after 8 days with morale, residue and an agent note (`career.ts:4263-4300`). Seen in-app: "Girard's agent: 'Nobody called him back'" on 5 Nov, then the `dismissed-leader-returns` scene the same day. **But** the lapse check skips `i.year !== this.year` (`career.ts:4277`). Scenes summoned in the summer (draft call, farm trip) never lapse after the rollover. The autopilot ended with 2 such scenes open, which hits `MAX_OPEN_INTERACTIONS = 2` (`career.ts:4144`) and silences every concern and dilemma next season until they are answered. |
| 9 | Phone has no consequence; Hang up and Decline are free | **UNCHANGED** | `PhoneCallOverlay.tsx:206-214`: hang-up only marks the call seen. In-app, the Girard call offered "Talk it out →" (a deep link) or "Hang up". |
| 10 | TTS: cut for 1.0 | **FIXED** | Voice and the LLM writer are opt-in (`c10ca43`). The commentary booth is pre-rendered and off by default. |
| 11 | Squad status uncapped; `surplus` free | **FIXED** | Caps at `career.ts:29834-29846`. Status grievance at `career.ts:30179-30229`. |
| 12 | AI players never raise concerns or demand trades | **IMPROVED** (thin) | World "X wants out of Y" rumours exist (4 in the season, `tentpoles.ts:201-210`). They are a rumour template, not character state, and all 4 used the same body. |
| 13 | Chronicle lacks people events | **FIXED** | The kinds now include `tradeRequest`, `shopped`, `confrontation`, `captaincy`, `feud`, `hotSeat`, `voteOfConfidence` and `claimResolved`. The season wrote promise ×4, feud, captaincy and hotSeat ×5. |
| 14 | Owner directives: accepting is dominant and never checked | **FIXED**, but a new hole | An accepted ask becomes a dated commitment (`career.ts:26039-26080`). Hole: an *unanswered* ask never expires and costs nothing. The day-45 "win-now push" sat pending for 163 of 206 steps (`career.ts:25972-26001`), and it blocks every other owner ask that season. |
| 15 | Pundit rapport feeds nothing (`coverageTilt` had 0 callers) | **FIXED** | `tiltFor` drives the beat framing (`career.ts:5555, 5583, 5855, 5936`). Claims are logged and resolved (`career.ts:7425-7470`) with fan, board and room effects. |
| 16 | Presser = pick a tone; praise or measured always right; typed text discarded | **IMPROVED** | Options name a player ("We need a save now and then." → "Arturs Silovs will know exactly who you mean", in-app 27 Oct) via `applyPresserOption` (`career.ts:5709`). Still there: the fiery random feud between two random skaters (`career.ts:5683-5703`). The Media Circuit tip spells out the dominant answer: "praise and measured answers warm reporters up". |
| 17 | Staff advice has no receipts and no credibility | **UNCHANGED** | No advice ledger anywhere in `engine/`. |
| 18 | Delegation spam ("You left it to the staff" 13–18×/season) | **FIXED** | 1 delegation item in the whole season ("Gregory Campbell handled the board meeting"). |
| 19 | Board wildcards: `ride` is free, `wins` does nothing | **UNCHANGED** | `boardMeeting.ts:500-504, 515-518`. `shedSalary` is now a real test: the season review read "It didn't happen. I keep the minutes." |
| 20 | No AI GM firings (`gmChange` had no writer) | **FIXED** | 4 GM changes in the season ("Anaheim Ducks relieve general manager Sven Wallin"). |
| 21 | Repetition: "X report" 32–63×, scouting digest 25–35× | **IMPROVED** | Scout cards now vary (7 or fewer per skeleton). The digest tail "Their cards are attached…" still ran 19×. New offender: league-wide waiver notices, 40×, none involving the user. |
| 22 | Fans react only to results | **IMPROVED** | Claim resolution and the homer's rapport move `fanInterest` (`career.ts:5740-5744, 7450-7460`). Selling a favourite still doesn't register. |
| new | Season Wrapped and the Yearbook | **NEW, good** | 16 cards in the season, factual: "Picked 27th, finished 22nd, twelve points from the cut line." "Alexander Ovechkin hung up the skates after twenty seasons." |
| new | GM reputation (anti-cheese) | **NEW, good** | GM Career → "Your name around the league": telegraphed, heals, never a lockout. |
| new | Hockey soul | **NEW, sparse** | One season produced 1 Player Safety fine, 1 named line (+ its breakup), 0 rematch scenes, 0 revenge games, 5 identical "rivalry ignites" flashes about other clubs, and 1 league record. |

---

## 2. Re-measurements

| Metric | Old | Now | Note |
|---|---|---|---|
| Morale spread at season end | (half-life ~13 days) | **mean 56.8, sd 3.7** over 28 players | Everyone converges to the baseline. Only the room number moved (32–69). |
| Recovery from a shock | — | half the gap closed in ~20 days (Jones 58.7→44.8) | |
| Conversations per season | — | **19**: 10 authored scenes + 9 generic concerns, about one every 10 in-season days | 4 of the 9 concerns were the same feud pair. |
| Scenes in a real-app month (11 Oct–11 Nov) | — | 1 scene (Novak), 2 pressers, 1 phone call + scene (Girard), 1 lapsed concern | Felt about right in volume. Thin in consequence. |
| Inbox volume | 504/season (vanilla) | **651/season** (mod DB): 528 in the regular season, ~3.2/day | **120 unread after one real-app month.** Scouting = 123 (19%); foreign waivers = 40; results = 137. |
| Inbox repetition index | 9.50 (all beats, vanilla, 4 seasons) | **2.35** inbox only; 4.89 all news | Not like-for-like with the old number. The inbox is clean-ish; the ticker and beat are not. |
| Em-dash density | — | **2.16 per 100 words** in inbox and Feed; 20% of texts have one; 67/658 inbox headlines | The skill's rule is "one per piece at most". |
| Blocking gates (autopilot) | 44 (pre-PHASE-0) | staff meeting 9, scout meeting 3, dev camp 3, trade offers 2, and 1 each of deadline, review, draft, captains, board and camp | Matches the loop auditor (14 gates, 2.3 clicks/game, 31% overlay holds). |
| Owner "wants a word" pending | — | **163 of 206 steps** | One unanswered ask nags all season, then vanishes at rollover with no consequence. |

---

## 3. Findings

Format: **severity · title**, then evidence, root cause, fix size and an owner-visible acceptance check.

### S1

**F1 · S1 · Consequences still fade; the room is decorative.**
- **Evidence:** §2 morale numbers. Dynamics shows "Team Cohesion: Very poor" and "Locker room: Good" side by side, and neither changes a result.
- **Root cause:**
  - `condition.ts:217-218, 295`: one scalar with 5%/day drift.
  - `roomMorale` has no sim reader (`dynamics.ts:519`, `playerMindset.ts:344`).
  - No happiness factors, no trust, no contagion (the `dynamics.ts:15` comment only).
- **Fix:** L. Build the Happiness Ledger from the 2026-09 spec: persistent caused factors plus GM trust. Have room morale feed a small, measured effort multiplier (re-measured in the lever audit) or delete it.
- **Acceptance:** scratch a star 3 games running, then open his profile 60 days later. A "Scratched 3 of 5 (Nov 12)" factor still shows on his happiness panel and he still raises it. A "Very poor" cohesion bar visibly shows up in a lever-audit row.

**F2 · S1 · Literal `{last}` in scene outcomes.**
- **Evidence:** "Correct on paper and cold in the room. {last} nodded and left." (autopilot, the Oilers-revenge scene).
- **Root cause:** `career.ts:3981` uses `chosen.outcome` raw; `renderTemplate` is applied to `ev.scene` but never to the outcome. It affects `clubScenes.ts:230, 238, 311, 319` and any `decisionEvents` outcome with a slot.
- **Fix:** S.
- **Acceptance:** answer every scene option in a test save. No `{` appears anywhere in any outcome or receipt. Add a unit test that renders every outcome with slots.

### S2

**F3 · S2 · Scene headlines lie about who is in the office.**
- **Evidence:** "Seth Jones is waiting in your office" headed a scene whose body is the owner's office calling about ticket sales. A second one headed a columnist naming Jones.
- **Root cause:** `career.ts:3880` hard-codes `${p.name} is waiting in your office` for every authored scene.
- **Fix:** S. Add a per-event `headline` field in `decisionEvents.ts`.
- **Acceptance:** each scene's inbox headline names whoever actually raises it ("The owner's office: 'something to announce'").

**F4 · S2 · Summer scenes never lapse and can silence the next season.**
- **Evidence:** the autopilot ended 2026 day 0 with `i20` (farm trip, 2025 day 201) and `i21` (draft call, 2025 day 225) still `open`.
- **Root cause:** `career.ts:4277` skips `i.year !== this.year`. With 2 open, `maybeRaiseInteractions` returns (`:4156-4157`) and `maybeRaiseDecisionEvent` returns (`:3793`).
- **Fix:** S. Lapse on age in days across the rollover, or close summer scenes at camp.
- **Acceptance:** ignore every summer scene. By opening night none is open, and a concern can fire in October.

**F5 · S2 · The owner and board can be skipped without cost.**
- **Evidence:**
  - An unanswered owner ask sits for 163 of 206 steps and never expires (`career.ts:25972-26001`).
  - In the real save the board meeting was "handled" by the AGM ("Wes Clark handled the board meeting"), and nothing was lost.
  - Board wildcards `ride` and `wins` are still free or empty (`boardMeeting.ts:500-504, 515-518`).
  - Club Vision still shows one confidence bar, with no breakdown.
- **Root cause:** soft gates by design (fun over realism), but with no telegraphed cost and no upside for showing up.
- **Fix:** M.
  - An owner ask lapses after ~10 days as a small, telegraphed "he stopped asking" hit.
  - An AGM-handled board meeting picks the safe line *and says so in Club Vision*.
  - Make `ride` a tracked promise; make `wins` a points target.
  - Split confidence into results, money, youth and media, each with drivers.
- **Acceptance:** Club Vision shows *why* confidence moved, with each line linked to its cause. Ignoring the owner shows a dated line there.

**F6 · S2 · The feud call (see §4).**
- **Evidence:** random cause; the same complaint 4× a season; "address the room" leaves the relationship in place.
- **Fix:** M; rebuild.

**F7 · S2 · Generic concerns are not about the player.**
- **Evidence:** fixed sentences per kind (`interactions.ts:211-228`). The outcome is picked by morale delta alone (`interactions.ts:419-430`), so "Tell him to sort it out himself" yields "Lundell appreciated being heard, even if nothing was promised."
- **Fix:** M. Slot the real cause (TOI vs status, contract year, last conversation date), and key the outcome to option and tone.
- **Acceptance:** two different players' concerns in one save never share a sentence, and each names a number.

**F8 · S2 · The phone is still a notifier.**
- **Evidence:** `PhoneCallOverlay.tsx:206-214`. In-app the options were "Answer / Decline", then "Talk it out → / Hang up", and hanging up does nothing.
- **Fix:** M. Put the 2–3 options on the handset. "Call you back" is a 24-hour defer with a cost. Hang-up equals ignore (residue).
- **Acceptance:** a call can be resolved without leaving the overlay, and hanging up shows up later in the player's history.

**F9 · S2 · The inbox floods.**
- **Evidence:** 651 items a season; 120 unread after one real month.
  - Scouting cards are 19% (in the real-app inbox, 13 of the first 23 were scouting).
  - 40 "X placed on waivers by MTL" items concern other clubs.
  - "Opposition report: New York Rangers" arrived twice on consecutive days.
  - Feed posts land with "@CarverNotes" as the subject line (`career.ts:4556`).
- **Root cause:** curation lets league-wide waivers and every scout card through (`career.ts:29009-29040`).
- **Fix:** S–M. Roll scout cards into one daily digest; send only waivers that match a need; headline Feed posts from their text.
- **Acceptance:** ≤1.5 items/day in-season, and none says "@handle".

**F10 · S2 · Pundit and beat columns are tic-driven and sometimes false.**
- **Evidence:**
  - "Standings are undefeated" for 0–1–2 (`pressFallback.ts:322`).
  - "The rumor mill… fever pitch" about the GM's own AHL depth body (`pressFallback.ts:238`; 14× in the season).
  - The homer persona opens with "I'll tell you what, folks —" (`:564`), the national writer with "Make of that what you will — and I'll tell you what I make of it" (`:238`), "Here's what we know… Here's what we don't know" (`:463`) and "On paper, fine. On the ice — honestly?" (`:617`).
- **Fix:** M. Rewrite under the game-writing skill: one opinion with a reason per column, the rumour slot gated on salience, and no persona tics.
- **Acceptance:** a season of columns contains no sentence shape more than twice per persona, and every opinion names a player and a number.

**F11 · S2 · False facts in the ambient pools.**
- **Evidence:**
  - "twenty-nine candles on the cake" for every expiring player, including Malkin at 39 (`tentpoles.ts:213`).
  - "a discontented man on an expensive contract" for depth players (`tentpoles.ts:207`).
  - "outperforming predictions midway through the season" on day 34 (`expectations.ts:231`).
  - "It's a playoff race" on opening night (`decisionEvents.ts:358`).
  - "A steady week: 27th of 31" (`devCamp.ts:171`).
  - "31yo, developing in KHL… raw for the AHL — an ECHL stint to find his feet" (`developmentCenter.ts:117, 138`).
- **Fix:** S per pool. Condition each claim on the facts.
- **Acceptance:** the writing-issues gate (below) reports 0 `nonsense-or-false` hits over a season.

**F12 · S2 · Doubled world-club names.**
- **Evidence:** "Omsk Omsk win the Gagarin Cup", "Trinec Trinec", "Nizhny Novgorod Novgorod", "Hradec Kralove Králové", "Ambri Ambrì-Piotta". About 300 occurrences a season (ticker, inbox champions, dev camp, beat).
- **Root cause:** `modSchema.ts:1823` (also `:1456`) builds `${city} ${nickname}` when the EHM nickname repeats the city.
- **Fix:** S. Drop the nickname when it contains the city, or use the DB's display name.
- **Acceptance:** search the World tab and a season's inbox: no "X X" club names.

**F13 · S2 · Staff advice has no receipts.**
- **Evidence:** unchanged since 2026-09.
- **Fix:** M. Advice ledger plus credibility.
- **Acceptance:** the next staff meeting opens with "Since we called up Reinhardt: 4 points in 7."

**F14 · S2 · The world has rumours, not people.**
- **Evidence:** AI players' unhappiness exists only as 4 identical rumour bodies (`tentpoles.ts:205-207`), and other rooms' feuds never surface.
- **Fix:** L. Run the concern resolver headlessly for AI clubs, with GM personas choosing the tone.
- **Acceptance:** over a season, ≥3 named AI-club trade requests with a stated cause, and at least one resolved by a trade the chronicle links back.

### S3

**F15 · S3 · Press leftovers.**
- **Evidence:** the fiery-answer random feud between two random skaters (`career.ts:5683-5703`). The arc summary calls the GM "the manager" (`career.ts:5698`). The Media Circuit tip names the dominant strategy ("praise and measured answers warm reporters up").
- **Fix:** S.
- **Acceptance:** a fiery answer can only ignite friction between players it names, and the tip no longer prescribes the winning tone.

**F16 · S3 · Hockey soul is sparse and templated.**
- **Evidence:**
  - The rivalry flash is one template for every pair: abbreviations in the prose, a list of every reason, and "heated rivalry ignites" plus "real, simmering rivalry" back to back (`rivalries.ts:343-348`). It reaches the GM's inbox for clubs he has nothing to do with.
  - The line nickname falls back to initials, "the TBT Line" (`hockeySoul.ts:73`).
  - No rematch or revenge scene in a full season.
- **Fix:** M.
- **Acceptance:** over a season, the user club gets ≥2 rivalry or rematch beats tied to a real prior game, and named lines are words a city would say.

**F17 · S3 · A summer promise is kept by any ice time.**
- **Root cause:** `career.ts:4006, 4887`.
- **Fix:** S. Baseline it on last season's TOI per game.
- **Acceptance:** a summer "bigger role" promise breaks when his TOI per game falls.

**F18 · S3 · The beat's grade and preview lines are filler at volume.**
- **Evidence:** in one season:
  - "Jacob Markström is the other option." ×76 (`beatDesk.ts:509`)
  - "Five-on-five may decide it; their kill is stingy." ×73 (`matchNight.ts:80`)
  - "Hard to find on the ice. That can be good or bad." ×8 (`beatPools.ts:272`)
  - "Whoever draws that matchup has the night's hardest job." ×23 (`beatPools.ts:168`)
- **Fix:** M. Deeper pools; skip a line when there is nothing to say.
- **Acceptance:** no beat sentence appears more than 6× in a season.

---

## 4. Feature: "a player has an issue with another player" (the feud call)

The coordinator's recommendation is to rebuild it, and I agree.

### Where it lives

- **Relationship seeding:** `lockerRoom.ts:308-325`. A feud is created when both players have temperament ≥14 and ambition ≥14 and `rng.chance(0.35)` passes. The strength roll is 10–40.
- **Escalation:**
  - `lockerRoom.ts:436-444`: +1…rate when the pair share a line and the team is on a 2+ losing streak; −0–2 on a win.
  - Random flare-up: `lockerRoom.ts:484-512` fires 1/30 game days × 1/3, producing a `FEUD_FLARE_POOL` news item (`lockerRoom.ts:100-115`) and an arc.
- **The concern:** `interactions.ts:180-200` (`chooseKind`: a feud exists and temperament ≥13), `SPEAK_CHANCE.feud = 0.18` (`:167`).
- **The message:** `interactions.ts:224`.
- **The options:** `interactions.ts:251-258`.
- **Raised through:** `career.ts:4155-4205`, then the phone (`renderer/lib/phoneCalls.ts`).
- **Resolution:** `career.ts:4364-4372`; outcome text at `interactions.ts:419-430`.
- **Other feud sources:** presser feud `career.ts:5683-5703` (random pair); authored room scenes `decisionEvents.ts:153, 181, 643`.

### Frequency

- **Autopilot season:** 4 feud concerns (days 15, 36, 66, 106), all the **same pair**, Lundell ↔ Forsling, alternating who calls.
- **Loop auditor's run (same build):** 3 feud concerns out of 16.

That is 3–4 a season, mostly repeats.

### Cause

Effectively random.
- The pair is chosen at roster build from two personality numbers plus a coin flip. Nothing on the ice or in the business (line competition, ice time, contract envy, captaincy, a demotion, a hit in practice) creates or names it.
- The one real driver, sharing a line while losing, is never mentioned to the player.
- The presser path picks two random skaters.

### Wording (verbatim)

- **Call / concern:** "I've got to be honest with you: there's friction in that room with Gustav Forsling, and it's starting to get into my head on the ice." He says "that room" about his own room, names no cause and states no stake.
- **Flare news:** "Sources close to the dressing room report a heated exchange between {a} and {b}." / "There is some friction between {a} and {b}. The coaches are aware of it."
- **Outcomes:**
  - "Lundell took the message on board without much reaction. You took it to the room the same afternoon."
  - "Lundell appreciated being heard, even if nothing was promised." This one was given for "Tell him to sort it out himself".
  - "Forsling was clearly unhappy with how the conversation went."

### Choices and effects

- **"Step in and address the room"** (supportive): resolves the *arc* only (`career.ts:4364-4371`). The locker-room `feud` relationship stays. Its −1.5%×strength chemistry and development penalty (`lockerRoom.ts:602`) and the trigger remain, so he calls again 3 weeks later. That happened twice.
- **"Tell him to sort it out himself"** (firm) and **"Tell him to focus on hockey"** (dismissive): a morale delta, plus `wasDismissed` residue for dismissive.
- **Visible later:** a "Friction" or "Bitter feud" tag in Dynamics. Nothing in the chronicle or the player's history says what you chose.

### Rebuild spec (grounded, about 2 a season)

1. **A real cause, named in the scene.** Create a feud only from logged sim events, with the event stored on the relationship as `cause`:
   - a demotion that promoted a rival at the same position;
   - a teammate's new contract above his own at equal or better production (contract envy);
   - a captaincy pick he lost;
   - repeated line-mate turnovers or minus nights together (from the event stream);
   - an on-ice incident in practice or a game (a hit, a fight, a stick).
2. **Raised in person.** The head coach or the captain brings it to the office, not a phone call. Use the authored-scene machinery (`summonClubScene`) with the cause in the first sentence. Example: "Since you moved Lundell to the first unit on Nov 3, Forsling hasn't passed to him once on the power play."
3. **Choices with visible effects:**
   - **Split the lines:** auto-edits the lines. The chemistry penalty ends, but both lose a line-mate's familiarity, and the coach's note is quoted next game.
   - **Back one player:** the backed player gets a trust and morale factor, the other gets a grievance factor that persists, and his agent mentions it at the table.
   - **Let the captain handle it:** the outcome rolls on the captain's leadership and influence; if it works, the captain's standing rises.
   - **Trade one:** opens the Trade Centre with him pre-shopped. The Living Ledger "shopped" path applies.
4. **An arc that is referenced later:**
   - Cool-down after N games apart, or wins together; escalate on a repeat incident.
   - Every state change writes a chronicle `feud` entry with its cause.
   - A second occurrence quotes the first ("You split them in November. They're on the same line again.").
5. **Rate:** at most 2 per season per club, never the same pair twice unless it escalated. Run headlessly for AI clubs and surface only the rare tail as world news.

### Acceptance

In one season:
- every feud scene names a dated sim cause;
- no pair repeats unless it escalated;
- choosing "split the lines" changes the lines, and Dynamics shows the cool-down;
- the chronicle and the player's biography read the arc back.

---

## 5. Writing quality: the "nonsensical, AI-sounding" text

### Method

- **Corpus:** every player-facing string from one autopilot season, 9,708 items from 30 views plus all 2,401 news items. Headless: inbox, ticker and wire, Feed, beat, pressers, scenes and concerns, staff and scout meetings, board and season review, owner, dev camp, needs board, postgame and preview, Dynamics, Dev. Center, player profiles, Wrapped and the chronicle. Plus what I read in the real app over one month.
- **Detectors** (`<scratchpad>/audit3/story/h/writing.cjs`):
  - the game-writing skill's banned words and structures;
  - em-dash density;
  - hedges;
  - soccer vocabulary;
  - slot, plural, a/an, doubled-word and handle bugs;
  - fact checks against the calendar and the player;
  - exact-sentence repetition (≥6 per season);
  - context-free repeated sentences.
- **Hand additions:** findings from code reads and the app.
- **Location:** each hit is traced to its template by literal match against `src/`.

### Output

`audit3/story/writing-issues.json`: 319 entries, one per (type, template), each with `text`, `source`, `type`, `count`, `views`, `why` and `moreExamples`.

The repetition and filler rows are heuristic; triage the bottom of each list. 77 strings are composed at runtime and marked "unlocated".

### Counts, one season

| Type | Distinct templates | Occurrences | Main root cause |
|---|---:|---:|---|
| Doesn't make sense, or contradicts the facts | 18 | ~134 | Template claims not conditioned on facts (age, salary, calendar, rank); tone-blind outcomes |
| Grammar, placeholder, plural | 40 | ~648 | Bad slot fill at import (doubled club names, about 300), unrendered `{last}`, "1 points", "a 8-game", "as a A+", "@handle" headlines, "the Florida Panthers has" |
| AI tells | 70 | ~408 | Templates written in an AI voice: em-dash chains (2.16/100 words), aphoristic closers, persona tics, "are believed to be" ×178, "if it comes together", "quietly" |
| Repetition | 90 | ~1,390 | Thin pools at high volume (beat previews and grades, match preview, waivers, dev-camp verdicts) |
| Generic filler | 96 | ~566 | Lines that carry no fact ("That can be good or bad.", "It is a message.", "Hard to argue with results.") |
| Wrong hockey voice | 5 | ~19 | Football press: "climbing the table", "surprise package", "the fixture opponents circle", "a clean sheet of ice", "the manager" |

### LLM-writer leftovers: none

The LLM writer is off by default, and every flagged string traced to an authored template. The "AI sound" is house style in the hand-written pools (`pressFallback.ts`, `tentpoles.ts`, `decisionEvents.ts`, `beatPools.ts`, `developmentCenter.ts`), not generated text.

### The house-style tells

The writing pass already banned the words; these are the structures that remain:

- **Aphoristic closer.** A clause that turns the sentence into a moral.
  - "…which is how they say no." (`decisionEvents.ts:216`)
  - "…, quietly, and quietly is how these things start." (`tentpoles.ts:228`)
  - "Streaks end; the habits underneath them tend not to." (`ambientNews.ts:58`)
  - "…which is how you know it has arrived." (`career.ts:22891`)
  - "…which is the problem — you just took your best trade chip off the market with a sentence." (`decisionEvents.ts:424`)
  - "Something gives before the deadline." (`tentpoles.ts:249`)
- **Em-dash parentheticals and chains.** The Dev. Center has 4 em-dashes in one line: "18yo — ~2 yrs of USHL left — organisational depth — an ECHL ceiling for now." (`developmentCenter.ts:131-138`). The dev-camp report has 54 in one item (`career.ts:14907`).
- **Persona tics instead of opinions.** See F10.
- **Vague attribution.** "Multiple clubs are believed to be in contact with…" ×178 (`tentpoles.ts:237`).

### Worst examples by type, verbatim, with source

<!-- generated from writing-issues.json -->

#### Doesn't make sense, or contradicts the facts — 18 distinct templates, ~134 occurrences in one season

| # | Seen | Text (verbatim) | Source | Why |
|---|---:|---|---|---|
| 1 | 7 | A year left, twenty-nine candles on the cake, and no extension talk anybody will confirm. Clubs shopping for a rental have Yevgeni Malkin circled. | `src/engine/league/tentpoles.ts:213` | age 29 hard-coded for every expiring player (Malkin 39, Makar 27) |
| 2 | 4 | A player who has stopped pretending. Joel Hanley has made his position clear to Anaheim Ducks, and a discontented man on an expensive contract is a difficult thing to move quietly. | `src/engine/league/tentpoles.ts:207` | 'expensive contract' asserted for depth players on near-minimum deals; also the only world trade-request story and it is identical every tim |
| 3 | 4 | I've got to be honest with you: there's friction in that room with Gustav Forsling, and it's starting to get into my head on the ice. | `src/engine/league/interactions.ts:224 (messageFor 'feud'); feud created at src/engine/leag` | FEUD CONCERN: no cause named (feuds are seeded from two personality numbers plus a 35% roll); 'that room' spoken by a player about his own r |
| 4 | 3 | Seth Jones is waiting in your office — body: "The owner's office called before the tickets report even reached you. Attendance is sliding, the renewal window opens in three weeks, and he wants 'something to ann… | `src/engine/career/career.ts:3880` | headline is hard-coded '<anchor player> is waiting in your office' for EVERY authored scene, including ones where the owner calls or a colum |
| 5 | 2 | The physio's report says Jones sits two weeks. Jones says he's playing. "It's a playoff race. I've played through worse and you know it." | `src/engine/story/decisionEvents.ts:358` | fires on day 1 (autopilot) and 10 Oct at 4-0-1 (real app, Tommy Novak): there is no playoff race in October; the condition does not check th |
| 6 | 2 | FLORIDA — Standings are undefeated. The Florida Panthers check in at 0–1–2 (2 pts, 27th of 32) after going 0–3 this week | `src/engine/story/pressFallback.ts:322` | meaningless lede, printed for a winless team |
| 7 | 40 | A steady week: 27th of 31 in the puck skills. Another year in junior is what he needs. | `src/engine/career/devCamp.ts:171` | 'steady' is the default lead for every B grade, whether he finished 1st or 27th of 31; 'the puck skills' article bug |
| 8 | 20 | 31yo, developing in KHL — organisational depth — an ECHL ceiling for now. | `src/engine/career/developmentCenter.ts:117` | veterans in their late 20s/30s described as 'developing' and 'raw for the AHL — an ECHL stint to find his feet, then a call-up' (development |
| 9 | 14 | The rumor mill keeps spinning around Joona Koppanen (WBS) — the trade chatter has reached a fever pitch. | `src/engine/story/pressFallback.ts:238 (rumour slot)` | the column picks any rumour, including an AHL depth body on the GM's own farm, and calls it 'fever pitch'; the same rumour sentence ran 14x  |
| 10 | 12 | St. Louis Blues outperforming predictions midway through the season | `src/engine/story/expectations.ts:231` | fires on day ~34 of 184 (and in the real app on 7 Nov); 'midway' is not conditioned on the calendar |
| 11 | 7 | A year left, twenty-nine candles on the cake, and no extension talk anybody will confirm. Clubs shopping for a rental have Alex Lyon circled. | `src/engine/league/tentpoles.ts:213` | hard-coded age 29 for every expiring player |
| 12 | 6 | Lundell appreciated being heard, even if nothing was promised. | `src/engine/league/interactions.ts:423` | outcome line picked only by morale delta, so 'Tell him to sort it out himself' (firm) reads as 'appreciated being heard'; the words contradi |
| 13 | 4 | A player who has stopped pretending. Joel Hanley has made his position clear to Anaheim Ducks, and a discontented man on an expensive contract is a difficult thing to move quietly. | `src/engine/league/tentpoles.ts:207` | "expensive contract" asserted regardless of salary |
| 14 | 3 | The physio's report says Jones sits two weeks. Jones says he's playing. "It's a playoff race. I've played through worse and you know it." | `src/engine/story/decisionEvents.ts:358` | "playoff race" on day 1 |
| 15 | 3 | St. Louis Blues outperforming predictions midway through the season | `src/engine/story/expectations.ts:231` | "midway" on day 34 |
| 16 | 1 | Panthers mailbag: Marchand's slump, plus a word on the playoff race. 3 of your questions, answered. | `src/engine/story/beatPools.ts:393` | "playoff race" on day 0 |
| 17 | 1 | Friday mailbag: Bennett's slump, the playoff race, more. 4 of your questions, answered. | `src/engine/career/career.ts:5835` | "playoff race" on day 0 |
| 18 | 1 | PIT ahead of the curve: what 5–0 means in this league — body: '7–0–1 (15 pts, 3rd of 32), a 5–0 week ... The rumor mill keeps spinning around Joona Koppanen (WBS)' | `src/engine/story/pressFallback.ts:481` | headline frames the week as the season; filler rumour slot about a farm depth player |

#### Grammar, placeholder or plural bugs — 40 distinct templates, ~648 occurrences in one season

| # | Seen | Text (verbatim) | Source | Why |
|---|---:|---|---|---|
| 1 | 1 | Correct on paper and cold in the room. {last} nodded and left. Nobody will do anything stupid tomorrow, and nobody will forget that you asked them not to. | `src/engine/story/clubScenes.ts:319 (rendered unfilled by src/engine/career/career.ts:3981:` | unfilled {last} slot in every summoned-scene outcome that uses a slot (also clubScenes.ts:230, :238, :311) |
| 2 | 300 | Omsk Omsk win the Gagarin Cup / Trinec Trinec win the Extraliga title / Nizhny Novgorod Novgorod win the Kharlamov Cup / Hradec Kralove Králové / Ambri Ambrì-Piotta | `src/data/modSchema.ts:1823 (world clubs: name = `${city} ${nickname}` where the EHM nickna` | bad slot fill at import; ~300 occurrences per season across rumours and champions |
| 3 | 46 | Half the contenders have called Novosibirsk Novosibirsk about Chase Priskie, and the asking price has gone up twice this week. Something gives before the deadline. | `src/engine/league/tentpoles.ts:249` | doubled word: Novosibirsk Novosibirsk; doubled word: Kladno Kladno |
| 4 | 40 | What was a whisper in January is a queue in February. Togliatti Togliatti are fielding real offers for Artur Tyanulin, and a man who has been asked about this twice a week is starting to sound like a man who ex… | `src/engine/league/tentpoles.ts:240` | doubled word: Togliatti Togliatti; doubled word: Bern Bern; doubled word: Karlskoga Karlskoga |
| 5 | 33 | @CarverNotes | `unlocated (composed at runtime)` | handle used as headline: @CarverNotes; handle used as headline: @puckmodel; a/an: a 8; a/an: a 18; doubled word: Davos Davos; doubled word:  |
| 6 | 30 | Novosibirsk Novosibirsk said to be closing in on a deal for Mikhail Berdin | `src/engine/league/tentpoles.ts:245` | doubled word: Novosibirsk Novosibirsk; doubled word: Karlskoga Karlskoga; doubled word: Pardubice Pardubice; doubled word: Fribourg Fribourg |
| 7 | 30 | Nobody will put a name to it, which is usually the last stage. Mikhail Berdin's situation at Novosibirsk Novosibirsk has moved from speculation to logistics. | `src/engine/league/tentpoles.ts:246` | doubled word: Novosibirsk Novosibirsk; doubled word: Karlskoga Karlskoga; doubled word: Pardubice Pardubice; doubled word: Fribourg Fribourg |
| 8 | 29 | Trade talk heats up: Artyom Zemchyonok close to leaving Togliatti Togliatti? | `src/engine/league/tentpoles.ts:192` | doubled word: Togliatti Togliatti |
| 9 | 29 | With the deadline approaching, chatter around Artyom Zemchyonok is intensifying. Multiple clubs are believed to be in contact with Togliatti Togliatti. | `src/engine/league/tentpoles.ts:237` | doubled word: Togliatti Togliatti |
| 10 | 25 | Nail Yakupov to a rival of Omsk Omsk? The calls are getting serious | `src/engine/league/tentpoles.ts:242` | doubled word: Omsk Omsk; doubled word: Boleslav Boleslav; doubled word: Zug Zug; doubled word: Yekaterinburg Yekaterinburg; doubled word: Mo |
| 11 | 25 | The temperature has changed. Omsk Omsk have gone from listening on Nail Yakupov to negotiating, and the difference is visible in how carefully everyone involved is now speaking. | `src/engine/league/tentpoles.ts:243` | doubled word: Omsk Omsk; doubled word: Boleslav Boleslav; doubled word: Zug Zug; doubled word: Yekaterinburg Yekaterinburg; doubled word: Mo |
| 12 | 14 | @CarverNotes | `src/engine/career/career.ts:4556` | a followed/breaking Feed post enters the inbox with the author handle as its headline; the reader sees '@CarverNotes' as the subject line |
| 13 | 9 | Seth has put up 1 points (0G, 1A) in 3 games in the NHL — a modest return. The points have been harder to come by than the talent suggests. | `src/engine/career/scoutSummary.ts:176` | plural: 1 points; plural: 1 games |
| 14 | 4 | We've filed Zayne Parekh (D) as a A+. The real thing — a No. 1 defenceman if he stays on track. | `src/engine/career/scoutMeeting.ts:142` | a/an before A+/A |
| 15 | 3 | Alex Weiermair in a 8-game point drought | `src/engine/story/arcs.ts:486` | a/an: a 8 |
| 16 | 3 | Davos Davos win the National League title, beating Geneve HC 4–2 in the final. Playoff MVP: Adam Tambellini (10 PTS). Regular-season MVP: Sandro Aeschlimann, HCD (.936). | `src/engine/world/international.ts:314` | doubled word: Davos Davos; doubled word: Pardubice Pardubice; doubled word: Omsk Omsk |
| 17 | 3 | Through 7 games of 2025–26 he has 1 points for the Panthers. | `src/engine/story/beatPools.ts:170` | plural: 1 points |
| 18 | 2 | The Florida Panthers are 5–3–2 (12 pts, 8th of 32). A 4–1 week. Make of that what you will — and I'll tell you what I make of it. They are ahead of a preseason projection of 27th — on 10 games, which is not yet… | `src/engine/story/pressFallback.ts:238` | vs vs: vs NJD (day 24), vs; vs vs: vs COL (day 72), vs |
| 19 | 1 | FLORIDA — Another October, another chance. The Florida Panthers open the 2025–2026 season with a new set of objectives and a roster that has been reshaped since we last saw them in April. Here is the full pictu… | `src/engine/story/pressFallback.ts:1258` | plural: 1 games |
| 20 | 1 | Rankings are always a conversation. Here is mine — and I'll stand behind every line of it. 1. Vegas Golden Knights — 1–0–0 (2 pts) 2. Buffalo Sabres — 1–0–0 (2 pts) 3. Ottawa Senators — 1–0–0 (2 pts) 4. Colorad… | `src/engine/story/pressFallback.ts:146` | plural: 1 games |

#### AI tells — 70 distinct templates, ~408 occurrences in one season

| # | Seen | Text (verbatim) | Source | Why |
|---|---:|---|---|---|
| 1 | 4 | I'll tell you what, folks — I've been on the phone all week with people around this league, and nobody is sleeping on the Florida Panthers right now. | `src/engine/story/pressFallback.ts:564` | persona written as a stack of verbal tics ('I'll tell you what', 'Make of that what you will — and I'll tell you what I make of it' :238, 'H |
| 2 | 178 | With the deadline approaching, chatter around Sonny Milano is intensifying. Multiple clubs are believed to be in contact with Hershey Bears. | `src/engine/league/tentpoles.ts:237` | are believed to be |
| 3 | 29 | 18yo — ~2 yrs of USHL left — organisational depth — an ECHL ceiling for now. | `src/engine/career/developmentCenter.ts:133` | em-dash |
| 4 | 26 | 21yo, developing in HA — raw for the AHL — an ECHL stint to find his feet, then a call-up. | `src/engine/career/developmentCenter.ts:138` | em-dash |
| 5 | 10 | FLORIDA — October is in the books. The Florida Panthers are 5–4–3 (13 pts, 13th of 32). Here is the honest assessment. Month in brief: Gabriel Vilardi — 4 away from 100 career goals Alexis Lafrenière — 4 away f… | `src/engine/story/pressFallback.ts:150` | em-dash |
| 6 | 9 | The Florida Panthers are 5–3–2 (12 pts, 8th of 32). A 4–1 week. Make of that what you will — and I'll tell you what I make of it. They are ahead of a preseason projection of 27th — on 10 games, which is not yet… | `src/engine/story/pressFallback.ts:238` | Make of that what you will; which is not yet a trend; em-dash |
| 7 | 8 | I'll tell you what, folks — I've been on the phone all week with people around this league, and nobody is sleeping on the Florida Panthers right now. We're 10–7–6 (26 pts, 18th of 32), and that record doesn't t… | `src/engine/story/pressFallback.ts:564` | I'll tell you what; em-dash |
| 8 | 7 | Noah Laba, 23: a middle-six forward if it comes together | `src/engine/story/inboxBeats.ts:367` | if it comes together |
| 9 | 7 | Philadelphia Flyers defying expectations — and it might be for real | `src/engine/story/expectations.ts:230` | might be for real |
| 10 | 7 | A +2 in 23:20. Quietly effective. | `unlocated (composed at runtime)` | Quietly |
| 11 | 7 | 18yo — ~2 yrs of U20SM left — an AHL depth projection — useful org body. | `src/engine/career/developmentCenter.ts:131` | em-dash |
| 12 | 6 | Here's what we know about the Florida Panthers: they are 15–10–7 (37 pts, 16th of 32) and they just went 3–2 over the last 5 games. Here's what we don't know: whether any of it is sustainable. They were project… | `src/engine/story/pressFallback.ts:463` | Here's what we know; em-dash |
| 13 | 6 | Brenden Dillon (37) — unsigned in the NHL — has joined Vladivostok Admiral in the Kontinental Hockey League on a 1-year deal. | `src/engine/career/career.ts:9794` | em-dash |
| 14 | 5 | FLORIDA — Numbers tell part of the story. The Florida Panthers are 8–6–3 (19 pts, 17th of 32) after a 3–2 week. But a lot of what happens on the ice in this building starts long before puck drop. The energy is … | `src/engine/story/pressFallback.ts:367` | em-dash |
| 15 | 4 | Rankings are always a conversation. Here is mine — and I'll stand behind every line of it. 1. Vegas Golden Knights — 1–0–0 (2 pts) 2. Buffalo Sabres — 1–0–0 (2 pts) 3. Ottawa Senators — 1–0–0 (2 pts) 4. Colorad… | `src/engine/story/pressFallback.ts:146` | which is not yet a trend; em-dash |
| 16 | 4 | The Florida Panthers are 5–4–3 (13 pts, 13th of 32) after a 3–2 week. On paper, fine. On the ice — honestly? We showed some things this week that I think are going to matter come the second half. They were proj… | `src/engine/story/pressFallback.ts:617` | On paper; em-dash |
| 17 | 4 | A player who has stopped pretending. Joel Hanley has made his position clear to Anaheim Ducks, and a discontented man on an expensive contract is a difficult thing to move quietly. | `src/engine/league/tentpoles.ts:207` | quietly |
| 18 | 4 | Fair question. Sam Reinhart has 8 points and he is one of the better players on the roster on paper. My read: the coach wants him to earn it back, and he has not yet. | `src/engine/story/beatPools.ts:473` | on paper |
| 19 | 4 | 20yo — ages out of junior after this season — raw for the AHL — an ECHL stint to find his feet, then a call-up. | `src/engine/career/developmentCenter.ts:109` | em-dash |
| 20 | 3 | I'm less worried than the scoreline suggests. The expected-goals gap was narrow — but 'close on paper' doesn't pay the bills, so we correct it anyway. | `src/engine/story/coachQuotes.ts:455` | on paper |

#### Repetition — 90 distinct templates, ~1390 occurrences in one season

| # | Seen | Text (verbatim) | Source | Why |
|---|---:|---|---|---|
| 1 | 82 | Schmid expected in goal. | `src/engine/story/beatPools.ts:135` | exact sentence |
| 2 | 76 | Jacob Markström is the other option. | `src/engine/story/beatDesk.ts:509` | exact sentence |
| 3 | 73 | Five-on-five may decide it; their kill is stingy. | `src/engine/career/matchNight.ts:80` | exact sentence |
| 4 | 53 | Grades for everyone who dressed. | `src/engine/career/career.ts:5834` | exact sentence |
| 5 | 52 | He drives their offense. | `src/engine/career/matchNight.ts:94` | exact sentence |
| 6 | 45 | Discipline keeps this a non-factor. | `src/engine/career/matchNight.ts:69` | exact sentence |
| 7 | 45 | The price: depth value (7) | `unlocated (composed at runtime)` | exact sentence |
| 8 | 42 | He is ready for pro hockey — the AHL would push him. | `src/engine/career/devCamp.ts:175` | exact sentence |
| 9 | 40 | You have until the wire clears to claim him and his contract — head to the Waiver Wire to put in a claim. | `src/engine/career/career.ts:16694` | exact sentence |
| 10 | 23 | Whoever draws that matchup has the night's hardest job. | `src/engine/story/beatPools.ts:168` | exact sentence |
| 11 | 22 | That is the assignment. | `src/engine/story/beatPools.ts:170` | exact sentence |
| 12 | 21 | The lines from the morning skate, and what I will be watching. | `src/engine/story/beatPools.ts:136` | exact sentence |
| 13 | 20 | A point salvaged, a point lost. | `src/engine/story/matchReport.ts:186` | exact sentence |
| 14 | 20 | The projected lineup is below, and it looks a lot like the last one. | `src/engine/story/beatPools.ts:134` | exact sentence |
| 15 | 20 | Made his minutes count. | `src/engine/story/beatPools.ts:242` | exact sentence |
| 16 | 20 | Here is how the Panthers should line up, based on the morning skate. | `src/engine/story/beatPools.ts:133` | exact sentence |
| 17 | 19 | Their cards are attached — make the calls here, or leave the queue to us. | `src/engine/career/career.ts:27519` | exact sentence |
| 18 | 19 | Needed one more save. | `src/engine/story/beatPools.ts:276` | exact sentence |
| 19 | 18 | The coaches trust him. | `src/engine/story/beatPools.ts:267` | exact sentence |
| 20 | 17 | He is getting chances; he needs one to go in. | `src/engine/story/beatPools.ts:147` | exact sentence |

#### Generic filler — 96 distinct templates, ~566 occurrences in one season

| # | Seen | Text (verbatim) | Source | Why |
|---|---:|---|---|---|
| 1 | 45 | Projects as a second-pair defenceman. | `unlocated (composed at runtime)` | context-free sentence |
| 2 | 45 | Projects as a second-pair defenceman. | `src/engine/story/inboxBeats.ts / scoutSummary.ts (scout card tail)` | scouting cards are 19% of the season inbox (123/651) and end on the same projection stub |
| 3 | 25 | CGY are rebuilding and would sell. | `src/engine/career/career.ts:18468` | context-free sentence |
| 4 | 21 | John Tavares ended it in overtime. | `src/engine/career/matchNight.ts:289` | context-free sentence |
| 5 | 12 | Louis Blues outperforming predictions midway through the season | `src/engine/story/expectations.ts:231` | context-free sentence |
| 6 | 11 | UTA would move their backup — at a price. | `src/engine/career/career.ts:18470` | context-free sentence |
| 7 | 10 | The tools say a middle-six forward; the consistency is coming. | `src/engine/story/inboxBeats.ts:563` | context-free sentence |
| 8 | 10 | Two shorthanded goals in one game. | `src/engine/story/matchReport.ts:245` | context-free sentence |
| 9 | 9 | I showed the group ten clips this morning. | `src/engine/story/coachQuotes.ts:691` | context-free sentence |
| 10 | 9 | I've mapped out the sequence failures. | `src/engine/story/coachQuotes.ts:686` | context-free sentence |
| 11 | 8 | New Jersey Devils were not supposed to be here at this point. | `src/engine/story/expectations.ts:247` | context-free sentence |
| 12 | 8 | It is a message. | `src/engine/story/beatPools.ts:475` | context-free sentence |
| 13 | 8 | Pittsburgh you're the best. | `src/engine/story/voices.ts:210` | context-free sentence |
| 14 | 8 | Hard to find on the ice. That can be good or bad. | `src/engine/story/beatPools.ts:272` | grade line for a player with no events says nothing; 'That can be good or bad' is the definition of filler (also 'Not much to say, good or b |
| 15 | 7 | Young C Cole Sillinger gets the full report | `src/engine/story/inboxBeats.ts:369` | context-free sentence |
| 16 | 7 | New Jersey Devils making forecasters eat their words | `src/engine/story/expectations.ts:233` | context-free sentence |
| 17 | 7 | Philadelphia Flyers defying expectations — and it might be for real | `src/engine/story/expectations.ts:230` | context-free sentence |
| 18 | 7 | Spencer Knight was the whole difference. | `src/engine/story/matchReport.ts:164` | context-free sentence |
| 19 | 7 | Beating Alex Nedeljkovic won't be easy | `src/engine/career/matchNight.ts:122` | context-free sentence |
| 20 | 7 | Carter Verhaeghe did his part; the grades show who did not. | `src/engine/story/beatPools.ts:219` | context-free sentence |

#### Wrong hockey voice — 5 distinct templates, ~19 occurrences in one season

| # | Seen | Text (verbatim) | Source | Why |
|---|---:|---|---|---|
| 1 | 8 | Surprise package: Nashville Predators climbing the table | `src/engine/story/expectations.ts:232` | the table |
| 2 | 8 | Surprise package: Nashville Predators climbing the table | `src/engine/story/expectations.ts:232` | 'surprise package' + 'the table' is football-press voice; hockey says 'standings' |
| 3 | 1 | 6 consecutive wins have turned Florida Panthers into the fixture opponents circle nervously. Streaks end; the habits underneath them tend not to. | `src/engine/league/ambientNews.ts:58` | fixture |
| 4 | 1 | A clean sheet of ice. 183 match days to the playoffs. | `src/engine/career/career.ts:13990` | clean sheet |
| 5 | 1 | Tempers simmer between {a} and {b} after the manager's fiery press conference. | `src/engine/career/career.ts:5698` | soccer 'manager' for the GM; also the feud pair is two random skaters |


### Gate to add

Keep `writing.cjs` as an on-demand harness next to `proseAudit.harness.test.ts`. The rewrite is done when one season reports:
- 0 `nonsense-or-false`;
- 0 placeholder, plural or a/an hits;
- no exact sentence shown more than 6×;
- no more than 1 em-dash per 100 words.

---

## 6. Ranked top 15

| Rank | Finding | Sev | Fix | Owner-visible acceptance |
|---:|---|---|---|---|
| 1 | F1 Consequences fade; the room is decorative (Happiness Ledger + trust; room feeds the sim or goes) | S1 | L | A scratch from November is still on the player's happiness panel in January, and he brings it up. |
| 2 | Writing rewrite (§5: the false-fact pools, persona columns, aphoristic house style, beat filler) | S1–S2 | M–L | The writing gate passes over a season. |
| 3 | F2 `{last}` unrendered in scene outcomes | S1 | S | No `{` anywhere after answering every scene. |
| 4 | F6 Rebuild the feud call (§4) | S2 | M | Feud scenes name a dated cause; "split the lines" changes the lines; at most 2 a season. |
| 5 | F12 Doubled world-club names ("Omsk Omsk") | S2 | S | None in the World tab or a season's inbox. |
| 6 | F4 Summer scenes never lapse and silence next season | S2 | S | Ignore every summer scene; a concern still fires in October. |
| 7 | F9 Inbox flood (651/season, 120 unread a month, foreign waivers, "@handle" subjects) | S2 | S–M | ≤1.5 items per in-season day; no "@handle" subjects. |
| 8 | F3 Scene headlines name the wrong person | S2 | S | The headline names whoever is actually in the office. |
| 9 | F5 The owner and board are skippable (unanswered asks never lapse; no confidence breakdown) | S2 | M | Club Vision shows why confidence moved, line by line. |
| 10 | F7 Concern text ignores the player; outcome contradicts the button | S2 | M | Two concerns never share a sentence; the outcome matches the option. |
| 11 | F11 False facts in ambient pools ("twenty-nine candles", "midway", "playoff race" on opening night) | S2 | S | 0 `nonsense-or-false` in the gate. |
| 12 | F8 The phone is a notifier | S2 | M | Resolve from the handset; hanging up has a recorded cost. |
| 13 | F10 Columns are tics and wrong rumours | S2 | M | Every column has an opinion with a named reason; no persona tic recurs. |
| 14 | F13 Staff advice without receipts | S2 | M | The meeting opens with last time's call and its result. |
| 15 | F14 + F16 The world has rumours, not people; hockey soul is sparse | S2/S3 | L/M | ≥3 named AI trade requests with causes, and ≥2 user rivalry or rematch beats a season. |

Smaller items, S3: F15 press leftovers, F17 summer-promise leak, F18 beat filler (rolled into rank 2).
