# Audit: People & Story systems vs modern Football Manager

Auditor scope: player interactions and consequences, squad dynamics, staff and meetings, board/owner/fans, media and story, voice/TTS.
Repo: `K:/Hockey Game`, branch `improve-loop`, working tree read as-is on 2026-09-26. This was a read-only audit: no edits, no simulations.
Scores run 0–5 on seven axes. **D** = Decisions offered, **I** = Information quality, **C** = Consequence (does it change anything downstream), **F** = Feedback and attribution (does the game tell you why), **U** = UX polish, **V** = Content variety, **W** = World aliveness (the world acts and remembers on its own, not only when the GM pokes it).

---

## 0. The verdict in one paragraph

The owner is right, and the code shows why. Every people-system in the game ends in the same place: **`player.morale += n`**. Morale is one number, and it drifts 5% back toward 60 every day (`condition.ts:176-177, 254`), so its half-life is about 13 days. A "consequence" therefore fades within about a month, and nothing structural holds it. That is how the room stops remembering.

On top of that sit three kinds of failure:

- **Real bugs make the ledgers lie.**
  - Every in-season ice-time promise from a concern is broken no matter what the GM does.
  - Every ice-time promise from an authored scene or the negotiating table is marked "kept" no matter what.
  - The Living Ledger's personality thresholds are on the wrong scale, so every confrontation reads the same line.
- **Several "consequences" feed nothing.** Room morale, `roomRespect`, pundit rapport, owner "commitments" and "surplus" status are all written but never read by anything that matters.
- **The design doc capped the depth.** NARRATIVE-ENGINE.md lists "No new sim mechanics" as a non-goal and says effects must map to EXISTING levers. The only existing levers were a morale scalar and a room-mood scalar. The team built a very good *delivery* layer (inbox cards, phone, voiced scenes, 21 authored dilemmas, no-repeat content engine) on top of a *state* layer that cannot carry memory.

---

## 1. Player interactions and consequences ("wants a word", concerns, promises, phone)

### What FM does

- **Happiness is a set of factors, not one number.** The happiness screen lists per-player concerns such as playing time against the agreed status, contract, training, treatment by the manager, and promises. Those factors are the causes of morale, and the player can see them. ([Passion4FM][p4fm], [SI manual/GiveMeSport][gms])
- **Squad status is a contract of expectations.** The tiers are Star (1–2 players), Important (3–5), Regular Starter, Squad, Impact Sub, Fringe and Emergency Backup. Playing time is judged against the agreed status. ([Passion4FM][p4fm])
- **Conversations turn on tone and personality.** Praise, criticism, warnings, fines and tone choices land differently by personality: perfectionists resist praise, confrontational low-professionalism players react badly to criticism. ([FullerFM][fuller])
- **Complaints escalate.** Repeated bad handling moves the relationship Close → Distant → Adversary → Rival. Influential players "unsettle some of their friends", so the social group takes his side. Next come a transfer request and squad unrest. ([FullerFM][fuller], [Passion4FM][p4fm])
- **Promises are a list with deadlines.** Examples are more playing time, a new contract, or signing a type of player. A broken promise to an influential player damages trust for a long time. ([FullerFM][fuller], [Passion4FM][p4fm])

### What we have

- **Generator** (`src/engine/league/interactions.ts`)
  - There are 5 concern kinds, chosen by thresholds on morale, ambition, contract years, form and feud (`chooseKind`, :181-209).
  - Speak chance is a dice roll (:162-168). Rate limits live in `career.ts:3619-3707`: at most 2 open, 1 every 14 days, 2 per player per season.
- **Message**
  - `messageFor(_p, kind)` (:211-228) **ignores the player entirely**. The parameter is `_p`. It returns one fixed sentence per kind, so every trade request in every save opens "I need to be straight with you — I'm not happy here…"
- **Options**
  - `optionsFor(kind)` (:230-267) returns the same 3–4 tone buttons for every player. The player's history, the GM's history with him, and his current status are never consulted.
- **Resolution**
  - `applyInteractionResponse` (:326-386) produces one morale delta: tone base, plus professionalism and temperament scaling, minus 4 if serious.
  - The room gets 15% of that delta. A trade escalation happens only on *dismissive* + serious + negative delta.
  - The outcome text is one of 5 fixed sentences.
- **Promise ledger**
  - `promiseFromResponse` (:115-150). Evaluated daily in `career.ts:4225-4295`, settled at rollover in `career.ts:9213-9237`.
- **Authored dilemmas**
  - There are 21 in `story/decisionEvents.ts` plus 4 in `clubScenes.ts`, against the B5.5 target of 50.
  - Raised by `maybeRaiseDecisionEvent` (`career.ts:3424-3517`) and resolved by `applyDecisionEffects` (:3529-3606).
- **Living Ledger** (`career/livingLedger.ts`)
  - Four GM actions are recorded: shopped, scratched, sent down, released (`career.ts:9513, 10882, 14218, 21975`).
  - They schedule leaks, confrontations, agent notes and room ripples, and leave residue flags. The flags raise the contract ask by about 4% per grudge (`grudgeContext`, :187-213).
- **Phone** (`renderer/components/PhoneCallOverlay.tsx`, `lib/phoneCalls.ts`)
  - A ringing card that speaks the line. Its only action is "Talk it out →", which **navigates to the inbox** (`phoneCalls.ts:115`).
  - Hang-up and Decline have **no game consequence**. They only add the call to a `localStorage` "seen" set (`PhoneCallOverlay.tsx:56-70`), which is not part of the save.

### Placeholder check (concrete)

1. **BUG: every generic in-season ice-time promise is broken no matter what the GM does.**
   - `career.ts:3765-3772` sets the baseline from `player.stats.find(s => s.season === this.year)`. `p.stats` is written only at rollover (`archiveSeasonStats`, `career.ts:8706`, `p.stats.push` at :8718 and :8767), so mid-season it is `undefined`. The baseline becomes 0/0.
   - At evaluation (`:4254-4262`) `gpNow` is also 0, so `dGp = 0 < 5`. It takes the one grace extension (+20 days), then `perAfter = 0` and `kept = false`.
   - The player loses 14 morale, the news says "His ice time hasn't moved", and an ambitious player files a trade request.
   - The GM can double his minutes and it still reads as broken. The ledger punishes the player for trusting it. Needs a regression test that promises, raises TOI, and asserts kept. Mid-season stats live in `this.totals`/`this.gp`.
2. **BUG (reverse): authored-scene and negotiating-table ice-time promises are always "kept".**
   - `applyDecisionEffects` (`career.ts:3541-3554`) and the negotiation role pitch (`career.ts:12866-12880`) push `iceTime` promises with **no `dueDay`**. `evaluatePlayerPromises` skips anything without a `dueDay` (:4229).
   - At rollover, a non-`newDeal`, non-`exploreTrade` promise is set to `'kept'` unconditionally (:9230). It even writes "Kept: you promised…" into the permanent chronicle (:4298-4310).
   - 19 authored options set `promise: 'iceTime'` (14 in decisionEvents, 5 in clubScenes). One example is "You're in my plans. You dress tomorrow." The negotiation news says "The lineup card is the only thing that can prove it", but nothing ever reads the lineup card.
   - The authored promise's `text` is also the *outcome narration* (`text: chosen.outcome`), not the GM's words.
3. **BUG: the Living Ledger's personality thresholds use a 0–100 scale; personality is 1–20.**
   - The generator uses `rng.range(1, 20)` (`data/generate.ts:160-168`, `modSchema.ts:1037`).
   - `scheduleReactions` tests `p.temperament < 45 && p.ambition > 55` (`livingLedger.ts:144`). "Proud" can never be true, so a first scratch never brings a confrontation. `p.professionalism > 60` (:147) never fires the scratch agent note.
   - In `CONFRONT_POOL` (:266-277), `maxTemperament: 45` is always satisfied, while `minLoyalty: 61` and `minProfessionalism: 66` never are. **Every first confrontation, from every personality, is "I find out from a REPORTER that I'm on the block?"**
   - That includes confrontations caused by a *scratch*. The body text is hard-coded as "because you shopped him" (:360). A repeat scratch confrontation picks `confront.repeat`: "You shopped me, I stayed…"
   - `livingLedger.test.ts:120-124` builds players with temperament 80 and professionalism 90, which is why the tests pass.
4. **Room morale is written by the conversation, then read by nothing that matters.**
   - `roomMoraleDelta` (`interactions.ts:359`) and authored `roomMorale`/`roomRespect` (`career.ts:3538-3540`) go into `lr.roomMorale`.
   - Its readers are the Dynamics display (`dynamics.ts:519-520`), mindset text (`playerMindset.ts:344-441`), press prose (`pressFallback.ts`), and a decision-event trigger threshold (`career.ts:3441`).
   - No sim path reads it: not the condition multipliers, not player morale, not the lineup. The only real coupling is that the captain's morale blends into it (`lockerRoom.ts:439-452`), and that runs one way.
   - `roomRespect` ("standing with the room's veterans") is not a stat at all. It is folded into `roomMorale × 0.5`.
5. **Choices converge.**
   - Every generic concern resolves to one scalar (`TONE_BASE`, :304-309). "Promise" (+12) and "supportive" (+8) differ by 4 morale points, which is about 2 days of drift.
   - For a pro, "firm" on a mild concern gives about +8 (2 + (20-10)×0.6). That is the same as "supportive", with no downside.
   - Only a *dismissive* answer can escalate. So a GM who never picks dismissive can never create a crisis, and "promise" is the only option with a delayed cost — which, per bug 1, is random rather than earned.
6. **Ignoring a concern costs nothing.** Open concerns never expire (no expiry code found). They sit in the inbox and block new concerns and dilemmas (`career.ts:3427, 3634-3635`). So ignoring the first two open concerns silences the whole system.
7. **The reaction is cosmetic.** `reactionSpec` (:419-448) only picks the *line spoken back*. The player cannot push back, refuse, or ask again. It is always a one-turn exchange.
8. **Status-as-promise can be exploited.**
   - `tickSquadPromises` (`career.ts:21841-21883`) gives +1 morale per week to every `keyPlayer` on the roster and +0.5 to every `coreStarter`.
   - `setSquadStatus` (:21531-21537) has **no cap**, so tagging the whole roster "key player" is a free morale pump.
   - Telling a player he is `surplus` has delta 0 (:21871-21872). The status is never compared with his ability or his agent's view.
9. **Nothing reaches the rest of the world.**
   - `maybeRaiseInteractions` scans only `this.userTeam` (:3647). AI players never raise concerns, never demand trades, and never break with their GM.
   - An unhappy star on another club shows up only as a −6% trade-value discount (`trades.ts:150-151`).
   - Teammates react only through the `released` room ripple. That ripple hits countrymen and same-position veterans (`career.ts:3366-3372`), not the player's actual friends in `lr.relationships`.
10. **The chronicle and biography do not record the relationship.** `ChronicleEventKind` (`story/chronicle.ts:16-37`) has `promise` but no trade request, confrontation, feud, captaincy or "shopped" entry. `biography.ts` holds no relationship facts. The GM–player history is unreadable after the fact.

### Scores

| Axis | Score | Why |
|---|---|---|
| D | **2** | 3–4 generic tone buttons, identical for every player. 21 authored dilemmas give real options but only 21. |
| I | **1** | No happiness breakdown. You never see *why* he is unhappy beyond one sentence per kind. |
| C | **1** | A decaying morale scalar plus a room number nothing reads. Promise receipts are wrong in both directions (bugs 1–2). |
| F | **2** | Receipts exist ("your words went in the book") but some are false. Scratch confrontations cite a trade block. |
| U | **2** | The phone is a notifier that deep-links. Hang-up is free. There is no conversation screen, only an inbox card. |
| V | **2** | 5 fixed generic messages. The confront pool collapses to one line because of the scale bug. |
| W | **0** | Only the user's roster ever speaks. |

### Root cause

Morale is a scalar with fast drift, and the narrative doc forbade new state. So every "consequence" had to be a delta on that scalar, which the next two weeks erase. Effort went into delivery (phone, voice, cards) instead of into a model of the relationship. Scale mismatches and stats-timing bugs survived because tests used fixture values the game never generates.

### "True depth" spec

1. **Happiness Ledger (the keystone).**
   - `player.happiness: Factor[]`, where `Factor = { kind, value, since, causeActionId?, decayPerWeek, text }`. Kinds: playingTime-vs-status, contract, gmTrust, teamSuccess, roleClarity, socialGroupMood, promise:<id>, grievance:<residue>.
   - Morale = baseline + Σ factor values, recomputed rather than drifted, so a broken promise stays on the sheet until repaired or forgotten.
   - Add an FM-style **Happiness panel** on the profile plus a squad overview, with each factor clickable to its cause ("because you scratched him 3 of the last 5, Nov 12").
2. **GM–player Trust.**
   - A per-player `trust: -100..100` and an `interactionHistory` of the last 8 outcomes, persisted.
   - Tone effectiveness is a function of personality × trust × kind. A "firm" answer from a GM he trusts lands; the same words from a GM who shopped him backfire.
   - Options change with history: "You said that in October" appears when a prior promise exists.
3. **Two-turn conversations.** The player replies and can counter. Options on turn 2 depend on the reply ("Then put it in writing" → offer an extension / promise a role / hold the line). Keep it short: at most 2 turns and 3 options each.
4. **Escalation ladder with a clock.**
   - The stages are: open concern (expires in 7–10 days → `ignored` residue plus a gmTrust factor) → agent call → leaks to a pundit → his **social group** sides with him (friends and influence-weighted contagion through `lr.relationships`) → leaders ask for a meeting (a squad-level dilemma) → formal trade request.
   - The request raises AI interest in him and lowers his trade value; that pipeline already exists.
5. **Fix the promises.**
   - Use `this.gp`/`this.totals` baselines.
   - Every promise type gets a due date and a measurable check: authored `iceTime` → TOI per game or games dressed over 20 days; negotiation role pitch → deployment tier.
   - Store the GM's *words*, not the narration.
6. **Status caps and reactions.**
   - Key Player ≤ 2 and Core ≤ 6, as in FM.
   - Setting a status triggers a reaction relative to what he and his agent expect (ability rank plus ego). Demoting to surplus is a real hit and a trust event.
7. **World.** Run the same resolver headlessly for AI clubs, with the AI GM persona choosing tone (LW2 personas already exist). Emit only the rare tail as world news ("Sources: Kaprizov has asked Minnesota for a trade"), and feed requests into AI shopping.

**Smallest version that is genuinely deep:** items 1, 2, 4 (without contagion) and 5. **Effort: L.** The ledger needs its own balancing and the lever-audit harness should re-measure morale's sim effect afterwards.

---

## 2. Squad dynamics, morale, locker room, leadership, captains

### What FM does

- **Hierarchy:** Team Leaders, Highly Influential, Influential, Other.
- **Social groups** (core, secondary, other) whose members react together. ([Passion4FM][p4fm], [Neoseeker FM22][neo])
- **Team cohesion, dressing-room atmosphere and support for the manager** are shown as bars.
- **Leaders act.** They come to you on behalf of unhappy players, and a broken promise to a leader spreads. The manager can hold team meetings, and influential players can "unsettle their friends". ([FullerFM][fuller])

### What we have

- `lockerRoom.ts` holds the captain/alternates, influence 0–100, relationships (friendship/mentorship/feud), familiarity, room morale and arrivals.
- `tickLockerRoom` (:355-532) runs for **every** team that played (`career.ts:4520-4525`).
- **Real sim couplings:**
  - `chemistryModifier` (±3%, `career.ts:2973`)
  - `developmentModifier` (mentorship up to +15%, feud −10%, `career.ts:6387, 7719`)
- **Morale into the sim is real:** the lever audit measured morale at 11.3 points.
- **Captains:** `electCaptain`, the user C button, and `nameCaptainByCoach`.
- `dynamics.ts` builds an FM-like Dynamics screen, with tiers, drivers and deterministic social-group partitions.
- `playerMindset.ts` provides plain-English reads.

### Placeholder check

- **"Morale contagion" is claimed and absent.** The `dynamics.ts:15` header says groups ride "ACTUAL sim coupling (chemistry, **morale contagion**, mentorship dev)". A repo-wide grep for "contagion" finds only that comment. No code moves one player's morale because of a friend's, a leader's, or a group's.
- **Influence feeds only two things:** the display, and the morale penalty when an influential player leaves (`lockerRoom.ts:604-606`). An influential unhappy player affects nobody.
- **Social groups** are computed in the view (`dynamics.ts:244-438`) and are not simulation state. The note on each group honestly says "Social only — no on-ice effect yet" for most of them.
- **Room morale** follows results (±3 per game plus captain blend, `lockerRoom.ts:438-453`). As covered in §1, the sim never reads it. So the Dynamics "Atmosphere" bar (`dynamics.ts:520`) is a mood ring.
- **Captaincy's only mechanical effect** is the captain's morale being blended into that unread room number, plus eligibility rules. Stripping the C costs nothing. There is no "leaders come to you" behaviour.
- **Rare events are thin.** A 1/30-per-game-day dice roll picks one of 3 hard-coded single-sentence stories (`lockerRoom.ts:455-529`). Examples: "Tensions flare between X and Y", or the captain "calls closed-door meeting" for +2–6 room morale.
- **The feud arc from a fiery presser** picks **two random skaters** (`career.ts:5018-5035`). It is a feud with no cause the player could name, which breaks NARRATIVE-ENGINE's own "every reaction traces to a cause" rule.

### Scores

| Axis | Score | Why |
|---|---|---|
| D | **1** | Captain choice and squad status. No team meeting, no "talk to the leaders", no way to break up a clique. |
| I | **3** | The Dynamics screen is genuinely informative, with drivers and tiers. |
| C | **1** | Chemistry and mentorship are real but small and automatic. Room morale, influence and groups do nothing. |
| F | **2** | Group notes are honest about the missing effects, but nothing attributes a result to room state. |
| U | **3** | FM-parity screen layout. |
| V | **1** | 3 hard-coded rare-event sentences. |
| W | **2** | Every club's room ticks, and feuds and mentorships arc league-wide. The effect is invisible and never becomes news outside the user's club. |

### Root cause

The locker room was built as a *display model* (the Dynamics screen) that reads state, not as an agent that writes state. The couplings that do exist are all on-ice multipliers. Nothing couples people to people.

### "True depth" spec

- **Contagion pass (weekly).** Each player's `socialGroupMood` happiness factor becomes the influence-weighted mean of his group's gmTrust and happiness. A leader's grievance counts about 3× that of an "other".
- **Leaders as agents.** When 2 or more members of a group sit below a threshold, or a leader is unhappy, the leaders ask for a meeting. This is a squad dilemma with real options: concede to them (gains group trust, costs authority with the coach), back the coach, or trade the ringleader.
- **Team meeting action** (FM-style). Available after losing streaks. Outcomes depend on GM trust with the leaders and on how often you have used it (diminishing returns).
- **Captaincy matters.**
  - The captain's gmTrust bounds how much his group trusts you.
  - Stripping the C is a trust event for him and his friends.
  - The captain's personality modifies the post-loss mood swing.
  - Room morale either becomes this derived number feeding a small effort multiplier, measured in the lever audit, or it is deleted.
- **Groups become state.** Persist group membership, recomputed at camp and after trades, so "you traded the core group's centre" is a real event with a factor on every member.

**Smallest deep version:** the contagion pass plus leaders' delegation dilemmas (both depend on the §1 ledger). **Effort: M** once §1 exists.

---

## 3. Staff and meetings (staff meeting, scout meeting, board meeting)

### What FM does

- **Staff responsibilities** let you delegate any chore and choose who advises you and how often; staff meetings run at a frequency you set. ([FM Dugout "Delegating for success FM26"][dugout], [Vortex FM26][vortex])
- **Advice quality depends on staff attributes** (Judging Ability/Potential, Man Management, and so on). Different staff can give conflicting reports.
- The **board and staff meetings** carry objectives and requests; board requests succeed based on confidence. ([sortitoutsi board request][sio])

### What we have

- **Staff meeting**
  - `staffMeetingScene.ts:161-400` builds up to 7 items: INFO briefings with real numbers, and DECISIONS that mutate the sim (scratch, move line, rest, LTIR, call-up, dev focus, tactic shift) through `applyStaffAction` (`career.ts:17695-17702`).
  - Declined call-ups are remembered (`declinedCallups`, `career.ts:3525`).
  - Delegate = safe defaults (:196-200).
- **Scout meeting**
  - `scoutMeeting.ts`: track a riser or refocus a scout. Items are raised one at a time (playtest B3 fix).
- **Board meeting**
  - `boardMeeting.ts:384-532`: accept, raise or soften the objective; declare direction; a wildcard.
  - Promises are tracked and judged at season end in `evaluateBoardPromises` (`career.ts:15150-15215`), at +6 confidence if kept and −8/−6 if broken. **This is the best-modelled people-system in the game.**

### Placeholder check

- **Staff do not have opinions; they have thresholds.** Findings are perfect-information rules: cold if `form <= -2`, hot if `form >= 3`, risk above 55, fit below 55 (`career.ts:16750-16800`). Staff attributes, demeanour and competence change *who says it* and the voice, never *what they notice*, how accurate they are, or whether two staff disagree.
- **No advice receipts.** A grep for any advice ledger or "followed" tracking finds nothing. When you promote the hot depth forward on the assistant's word, nobody ever tells you whether it worked. Ignoring the physio does not make him right later. So there is no staff credibility and no "I told you so". This is the unfinished half of Gap #6 ("true attribution").
- **"Meetings re-skin buttons you'd click anyway"** (playtest 07-23 §C) still holds. Every decision is a lineup edit available on the Tactics screen, and the meeting adds only a recommendation.
- **Board wildcard asymmetries.**
  - `wc-rebuild:ride` gives +2 confidence with no cost or tracking (:500-504).
  - `wc-fans:wins` has no effect at all (:515-518).
  - The `shedSalary` promise's check is `capUsed <= salaryCap` (`career.ts:15171-15172`). The game enforces the cap everywhere now (Gap #4), so it is almost always met automatically: a free +6 confidence.
- **Delegation spam.** The autopilot saw "You left it to the staff" 13–18 times a season, word for word, and "You left the board to the staff" 7–10 times (`docs/autopilot/summary-latest.md:43,46,57,60,72`).

### Scores

| Axis | Score | Why |
|---|---|---|
| D | **3** | Real sim-mutating options. The board meeting has genuine tradeoffs. |
| I | **3** | Real numbers, cited bullets, one item at a time. |
| C | **3** | Actions happen and board promises are judged. Staff advice has no follow-up. |
| F | **1** | Nobody tells you whether advice was right. The board is the exception. |
| U | **3** | Staged scenes with delegate escapes, fixed after the playtests. |
| V | **2** | Fixed phrasing per finding. The delegation headline repeats 13–18× a season. |
| W | **1** | Staff never disagree, never lobby, never react to being overruled, never leave over it. |

### Root cause

The meetings were designed as a *front end for existing actions* (EHM mirror) with "no new state". Staff were given faces and voices but no memory, no judgement quality and no stake.

### "True depth" spec

- **Advice ledger.**
  - Each accepted or rejected suggestion is stored as `{ staffId, claim, metric, baseline, dueInGames }`.
  - It is evaluated N games later ("Since the call-up: 5 points in 7, +3", "You played Letang through the flag; he's out 3 weeks").
  - The result produces a **receipt** in the next meeting and changes the staffer's `credibility`.
- **Staff judgement from attributes.** Detection thresholds and noise scale with the staffer's relevant attribute. A poor physio misses some risks and cries wolf on others, so **hiring better staff becomes visible**.
- **Disagreement items.** When two staff read the same player differently (the assistant wants to ride a hot hand, the physio wants rest), present it as one decision with two named advocates. Whoever you side with gains trust, the other loses it, and staff morale is tracked.
- **Stakes for staff.** A long run of ignored advice lowers that staffer's relationship with you. It can leak to press ("coach and GM not aligned") or lead him to leave in the summer, using the coach job market that already exists.
- **Board fixes.** Make `ride` a tracked promise (the core makes the playoffs), make `wins` a tracked points target, change `shedSalary` to a real payroll target (e.g. ≤ 95% of the cap), and vary or merge the delegation headlines.

**Smallest deep version:** the advice ledger with receipts plus credibility. **Effort: M.**

---

## 4. Board, owner, fans, pressure, job security

### What FM does

- **Separate board and supporter confidence.** The board focuses on objectives, finances and strategy. Supporters focus on identity, results against rivals, and individual players. Both show breakdowns. ([FM26 Supporter Confidence][fmsc])
- **Club Vision** is a multi-year plan with required and desired objectives.
- **Supporter Profile** segments (hardcore, corporate, and so on).
- The manager can **issue an ultimatum**, staking his job. ([fmscout confidence][fmscout])

### What we have

- **Board** (`league/board.ts`): mandate, confidence, patience, warnings, and a sustained-failure firing rule (:589-599). Rebuild sanctions protect the GM.
- **Pressure** (`league/pressure.ts`): an in-season fan mood from pace against target, form and playoff line. It checks every 10 games, tells a story on crossing into mutinous, angry or backing (once per band per season), and drains patience by 2–4 in hostile bands (`career.ts:16885-16925`).
- **Fanbase** (`league/fanbase.ts`): season-end interest leads to a budget multiplier of 0.78–1.22×.
- **Owner meddling** (`league/ownerMeddling.ts`, `career.ts:18037-18110`).
- **Coach carousel** for AI clubs (`coachCarousel.ts`).

### Placeholder check

- **Owner directives: accept is dominant and never checked.**
  - Accepting gives +4/+5 confidence and +2 patience. Declining gives −3/−4 and −1 (`ownerMeddling.ts:133-136`).
  - Accept sends "You assured the owner you would deliver" (`career.ts:18099-18101`), but nothing records or checks it: a grep for owner commitment or acceptance tracking finds nothing.
  - "Extend the fan favourite" → accept → let him walk costs nothing. The only right answer is "accept", every time.
- **Fans react only to results, never to what the GM does.** `updatePressure` inputs are rank, target, points, form, playoff spot and rebuild (`pressure.ts:108-124`). Trading the captain, letting a fan favourite walk, a fleecing, or a rookie phenom do not register. There is no fan-favourite metric apart from the owner template.
- **Board confidence has no breakdown.** It is a single `confidence` and `patience`, with no categories (results, finances, youth, conduct, media). The GM cannot see *why* the board is cool, apart from news beats.
- **Band stories** come from 3 headline variants each (`pressure.ts:206-222`) with one body template per band.
- **World:** `gmChange` exists as a chronicle kind (`chronicle.ts:25`) but has no writer, so AI GMs are never fired. Coaches are, through the carousel; that is the other auditor's area.

### Scores

| Axis | Score | Why |
|---|---|---|
| D | **2** | The board meeting is real. The owner requests are one accept/decline where accept always wins. |
| I | **2** | Band labels and news. No confidence breakdown. |
| C | **3** | Firing is real, patience drains, fan interest changes the budget. |
| F | **3** | Board promises are read back with your words. |
| U | **2** | Club Vision exists. The dashboard shows only "The owner wants a word". |
| V | **2** | 3 headlines per band, 5 owner templates. |
| W | **2** | AI coaches get fired. AI GMs, owners and fanbases do not exist as agents. |

### Root cause

The board was built as a results thermostat. The owner layer was added as a flavour popup with small symmetric deltas and no ledger, which is the same ledger-less pattern as §1.

### "True depth" spec

- **Owner commitments become board promises.** Reuse the `evaluateBoardPromises` machinery: acceptance writes a chronicle `promise` with a check ("Letang re-signed by July 1"). Breaking it costs more than declining would have, so accept stops being free.
- **Confidence breakdown.** Split confidence into 4–5 components (results vs mandate, finances/payroll, youth or direction promise, conduct and media, supporters). Show each with drivers, like Dynamics. Firing reads the weighted sum.
- **Fans react to deeds.**
  - A `fanFavourite` score per player: tenure, captaincy, points, local/draft pedigree.
  - Trading or letting go a favourite applies a mood hit that decays over months, with a jersey-in-the-concourse beat (the prose already exists in the NARRATIVE-ENGINE sample).
  - Winning the trade later ("the return scored 30") can repair it; LW4 retrospectives exist.
- **Ultimatum lever.** Use it in a board request (more budget or a GM power) staking patience. This is FM's highest-drama board mechanic and it is cheap here.

**Smallest deep version:** owner commitments tracked, plus fans reacting to favourite departures. **Effort: S–M.**

---

## 5. Media, press, The Feed, news, chronicle, biographies

### What FM does

- Press conferences are the "hated chore" (EXCELLENCE W2). FM26 removed gestures and tone combinations. ([sortitoutsi FM26 press][siopress])
- What makes the media matter in FM is that **answers about named players affect those players** (praise or criticism in press), and **journalists and outlets carry stories forward**.
- Supporter and board confidence respond to public ambitions: talking up ambition in a presser can sway a board request. ([Vortex][vortex])

### What we have

- **Presser answer** → `answerPressConference` (`career.ts:5007-5093`). Fiery gives +2 room morale and a 30% chance of a random feud; praise gives +1. The tone also shifts the asking pundit's rapport (`story/pundits.ts:100-129`).
- **Media Circuit screen:** Ally/Critic standings (#90).
- **The Feed:** salience detectors across the whole league (`career.ts:3818-3899`), GM persona voices.
- **Chronicle, biographies:** `story/biography.ts`, a detector-based, fact-proven Hades model, pre-populated for imported careers.
- **Content engine:** a no-repeat ledger and callback slots.

### Placeholder check

- **Pundit rapport feeds nothing.**
  - `coverageTilt()` (`pundits.ts:221-224`) has **zero callers**; the grep shows only its definition.
  - `punditState` is read only by `getMediaCircuit` (`career.ts:5100-5120`).
  - So the boundary beat "his columns will now give the GM the benefit of the doubt" / "expect every misstep to become a headline" (`career.ts:5067-5078`) promises a behaviour the engine never performs.
- **Press tone is nearly dominated.**
  - Praise gives +6 base rapport and +1 room morale. Measured gives +3. Fiery risks a random feud. Deflecting gives −6.
  - Apart from the national columnist's −3 on praise, "praise" or "measured" is always right. Nothing links an answer to a player, to the board, or to future questions.
- **The typed answer text is quoted and then discarded** (`career.ts:5038`). Only the tone button matters.
- **Repetition at scale** (autopilot, 25 seasons, `summary-latest.md:36-75`), per season:
  - "X report: X X" fired 32–63×
  - "Weekly scouting digest" fired 25–35× identically
  - "Breakdowns cost us — Coach postgame" 8–15×
  - "upside" appears 40–83×
  - 12–30 dramatic games per season had no story written.
  B4.5 ("no verbatim repeat in a season") is failing on the most common surfaces.
- **The chronicle does not know the people story.** It records trades, signings, awards, records and settled promises. It does not record trade requests, confrontations, captaincy changes, feuds, or "shopped" (`chronicle.ts:16-37`). Biographies, being fact-proven, therefore cannot tell "the year he asked out", which is exactly the CK3/Wildermyth story EXCELLENCE §1 sells.
- **Positives, to keep honest:**
  - The biography's "a claim the record cannot prove returns null" discipline is excellent. The trade-announcement tiers (A5) and the salience engine over all 32 clubs are real world-aliveness.
  - The Living Ledger's leak mechanism, where the player reads the story and his residue becomes "known", is the right causal pattern; it only needs the §1 fixes.

### Scores

| Axis | Score | Why |
|---|---|---|
| D | **1** | Press = pick a tone. Praise or measured is almost always correct. |
| I | **2** | The feed and news are rich but cluttered and repetitive. |
| C | **1** | Pundit relationships are display-only. The presser feud is random. |
| F | **2** | The Media Circuit shows standing. Nothing shows its effect, because there is none. |
| U | **3** | Feed as social timeline, biographies, press scene. |
| V | **2** | Big pools on some surfaces, 20–60× repeats on the most common ones. |
| W | **3** | League-wide salience detectors, GM voices, biographies for everyone. The most alive system here. |

### Root cause

Media was built as an *output* channel for the sim: prose about state. The relationship layer was added, but no *input* path back into the sim or the other writers was built.

### "True depth" spec

- **Close the loop on rapport.** `coverageTilt` selects the variant family in pressFallback and news writers: allies frame a loss as bad luck, critics frame it as a GM failure. A critic's hostility adds a small board-confidence "conduct/media" drain, which is §4's component.
- **Press questions about a named player.** "Is X a part of your plans?" gets the answers "Yes, he's core" (records a promise-lite plus a trust bump), "Everyone's evaluated" (the player reads it: a trust hit plus a leak), or "No comment". This ties the press into §1 and makes pressers a lever, which is W2's "fewer, better" answer.
- **Pundits remember quotes.** Store the GM's last strong claim per pundit ("we're a playoff team") and cite it back when it proves wrong or right. That is the chronicle-callback signature pointed at the media.
- **Chronicle people events.** Add `tradeRequest`, `confrontation`, `captaincy`, `feud`, `shopped`, `promiseBroken` kinds. Biographies gain a "relationship with the club" paragraph proven by those records.
- **Repetition triage.** Collapse the scouting digest and staff delegation into weekly rollups. Add variants to the top 10 shapes from the autopilot list. Gate "X report" behind novelty.

**Smallest deep version:** tilt wired, player-specific press questions, chronicle people events. **Effort: M.**

---

## 6. Voice / TTS — firm recommendation: **CUT it from the shipped experience for 1.0**

### What we have

- **Engine and worker:**
  - Kokoro-82M via onnxruntime-web WASM in a module worker (`renderer/lib/voice.worker.ts`, `kokoroVoice.ts`).
  - Main-thread blocking was fixed on 2026-08-27, from 43.9 s to 0 ms (PLAYTEST-08-26 §B1).
  - **Throughput on the user's machine was measured at about 0.6× realtime.** Below 1.15×, the engine hands lines to the system voice (`kokoroVoice.ts:378-395, 549, 578-580`).
- **Casting:** `voiceCast.ts` offers 5 quality-gated male voices in the character pool (`CHARACTER_POOL`, :104) plus small female and British pools.
- **Call sites:** phone, inbox concern reply, scout meeting, staff briefing, and match commentary through the shared announcer (`MatchViewer.tsx:42`).

### Evidence it cannot meet the bar

1. **Performance is a throughput limit, not a scheduling bug.**
   - At 0.6× realtime every line arrives late and the gap grows across a scene (the team's own finding).
   - The worker keeps the UI responsive but still spends a full CPU core, at the same time as the sim's own Web Worker. That is a plausible remaining cause of "the app lags"; it is unmeasured, and the CPU competition is inferred.
   - The model is a large download and cannot run on the Windows build without code signing (B4 / Gap #5, blocked).
2. **Casting is not stable, which is exactly the "voices all over the place" complaint.**
   - **Neural→system fallback mid-session.** The first lines of a session run neural. Once the throughput verdict is reached, *every* character switches to the **one** system voice: `SystemVoiceEngine` picks a single voice and ignores the cast (`announcer.ts:140-205`). So the same man sounds different on Tuesday and Wednesday, and then everyone sounds the same.
   - **Same person, different seed or traits by screen:**
     - The staff briefing opening is spoken as `role: 'coach'` with **no seed** (`StaffBriefingScreen.tsx:70, 125`), which gives the role default `am_fenrir`.
     - The same head coach's agenda items are spoken with his name seed plus demeanour traits (:72-76, 142-144). A calm coach is cast `am_michael`/`am_fenrir` from `DEMEANOR_MALE.calm`, so the head coach can change voice mid-meeting.
     - The scout-meeting host opens with seed and no traits (`ScoutMeetingScreen.tsx:106, 181`), but his items pass traits (:224-228).
   - **Agents have no identity.** An agent caller is seeded `"${playerName}'s agent"` (`phoneCalls.ts:88`), so one agent representing three players gets three voices.
   - **Accent collisions.** `CHARACTER_POOL` contains `bm_george` and `bm_fable` (British). `bm_george` is also the play-by-play and the owner's voice (`voiceCast.ts:74, 84, 104`). A Canadian winger can ring you in the play-by-play man's accent.
   - **Too few voices.** 5 voices cannot make hundreds of characters distinct. B5.4 requires "same character = same voice, always".
3. **Voicing a thin system does not deepen it.** The phone only rings, speaks, and deep-links (`PhoneCallOverlay.tsx:193-214`). Hanging up has no consequence. The spoken content is the fixed per-kind sentence from `messageFor`. Voice amplifies the shallowness the owner is reacting to.
4. **It has cost repeated engineering cycles** (sandbox crash, main-thread freeze, third-person narration bug ×3, casting pass, worker rewrite, throughput gate) that did not go into state depth.

### Recommendation (firm)

- **Cut dynamic TTS from the default experience for 1.0.**
  - Default neural voice OFF and remove the auto-download, which also removes the SmartScreen and first-launch exposure.
  - Remove match-commentary TTS.
  - Keep the code behind a hidden developer/experimental flag. Do **not** delete it, because Kokoro may be viable on better hardware later.
- **Keep the diegetic phone as a *UI device* without speech:** ring, face, a typed line, and — the important part — **answer options on the handset itself** (accept, stall, "call you back" with a cost), so the call *is* the decision.
- **If voice returns after 1.0,** use pre-rendered audio for name-agnostic tentpole lines only (draft podium lines, cup-win PA, the ring). Generate them offline at build time with a fixed cast table keyed by **personId, including agents and staff**, so it costs nothing at runtime and B5.4 consistency is guaranteed by construction.

### Scores (the axes fit voice loosely; the three that matter are C = what it changes, U = perf and polish, V = distinct voices)

| Axis | Score | Why |
|---|---|---|
| D | 0 | Voice adds no decisions. |
| I | 1 | A spoken line carries no more than the card does. |
| C | 0 | Voice changes nothing in the game. |
| F | 1 | — |
| U | **1** | Late lines, fallback flip, lag complaints. |
| V | **1** | 5 voices; the fallback collapses them to one. |
| W | 0 | — |

**Effort to cut: S.** It is a flag flip plus removing the auto-load.

---

## Scores summary

| System | D | I | C | F | U | V | W |
|---|---|---|---|---|---|---|---|
| 1 Player interactions | 2 | 1 | 1 | 2 | 2 | 2 | 0 |
| 2 Squad dynamics / room / captains | 1 | 3 | 1 | 2 | 3 | 1 | 2 |
| 3 Staff and meetings | 3 | 3 | 3 | 1 | 3 | 2 | 1 |
| 4 Board / owner / fans | 2 | 2 | 3 | 3 | 2 | 2 | 2 |
| 5 Media / feed / chronicle / bios | 1 | 2 | 1 | 2 | 3 | 2 | 3 |
| 6 Voice / TTS | 0 | 1 | 0 | 1 | 1 | 1 | 0 |

## Cross-cutting root causes

1. **A single drifting morale scalar is the only "memory" the people layer has.** Everything that should be a relationship is a delta on it.
2. **The Narrative Engine's "No new sim mechanics" rule** capped depth at delivery. Revisit it: the depth *is* new state (a happiness ledger, trust, advice and owner commitments).
3. **Write-only fields:** `roomMorale` (for the sim), `roomRespect`, pundit rapport and `coverageTilt`, owner acceptance, `surplus` status, and "morale contagion" (a comment only).
4. **Tests built on values the game never produces** (0–100 personality) and **mid-season reads of `p.stats`**. Two known bug classes hit the promise ledger, the centrepiece of B5.3.
5. **User-club-only scope** for interactions, concerns and the ledger means the world does not have people. It only has the GM's people.

## Immediate bug list (S-effort, fix regardless of roadmap)

1. **Ice-time promise baseline and evaluation.** Read `this.gp`/`this.totals` instead of `p.stats` (`career.ts:3765-3772, 4254-4262`; same pattern at `3542`, `12868`).
2. **Promises without `dueDay`.** Give authored and negotiation `iceTime` promises a due date and a real check; stop auto-keeping them at rollover (`career.ts:3541-3554, 12866-12880, 9230`).
3. **Living Ledger scale.** Rescale to 1–20 (`livingLedger.ts:144, 147, 266-277`) and fix the test fixtures (`livingLedger.test.ts:120-124`). Give scratch and send-down confrontations their own copy instead of "because you shopped him" (:360).
4. **Squad status.** Cap `keyPlayer`/`coreStarter` counts; make `surplus` cost something (`career.ts:21531, 21851-21873`).
5. **Unreachable consequence copy.** Remove or wire the owner "you assured the owner" text and the pundit "benefit of the doubt" text until the mechanics exist.

## Top 3 recommendations

1. **Build the Happiness Ledger + GM-trust model and fix the promise ledger (L).** Morale becomes a sum of *caused, visible, persistent* factors, with an FM-style happiness panel that links each factor to its GM action. Tone effects depend on personality × trust × history. This is the foundation every other "consequence" needs.
2. **Escalation and contagion, run for the whole league (M, after #1).**
   - Concerns expire into grievances; agent, then press leak, then social group, then leaders' meeting, then trade request.
   - Influence-weighted contagion through real relationships.
   - The same resolver runs headlessly for AI clubs, with AI GM personas choosing tone, so the world produces its own "X wants out of Y" stories and trade-market pressure.
3. **Cut TTS for 1.0 and reinvest in closing dead loops (S + M).**
   - Default voice off and hidden. Put the decision on the phone handset itself.
   - Owner commitments become tracked promises. Wire pundit tilt into coverage and board confidence.
   - Add a staff-advice receipt ledger (staff credibility and disagreements).
   - Add people events to the chronicle so biographies can tell the relationship story.

---

### Sources

- [Passion4FM — How to improve players' morale & happiness][p4fm]
- [Fuller FM — Player interactions in Football Manager][fuller]
- [GiveMeSport — FM24 Dynamics guide][gms]
- [Neoseeker — FM22 Squad Dynamics][neo]
- [FM Dugout — Delegating for success in FM26][dugout]
- [Vortex Gaming — FM26 staff responsibilities][vortex]
- [sortitoutsi — FM26 board request guide][sio]
- [sortitoutsi — FM26 press conferences guide][siopress]
- [footballmanager.com — Supporter Confidence (FM26)][fmsc]
- [FMScout — board confidence / requests / ultimatum][fmscout]
- Internal: `RnD/yt-digest.md` §5 ("press conferences are repetitive, don't mean anything … variety + consequence or skip/delegate").

[p4fm]: https://www.passion4fm.com/how-to-improve-players-morale-happiness-in-football-manager/
[fuller]: https://fullerfm.com/2023/01/05/player-interactions-in-football-manager/
[gms]: https://www.givemesport.com/football-manager-2024-dynamics-guide/
[neo]: https://www.neoseeker.com/football-manager-2022/guides/Squad_Dynamics
[dugout]: https://www.footballmanager.com/the-dugout/delegating-success-football-manager-26
[vortex]: https://vortexgaming.io/en/postdetail/623036
[sio]: https://sortitoutsi.net/content/76366/fm26-guide-how-to-make-a-board-request
[siopress]: https://sortitoutsi.net/content/76465/fm26-guide-press-conferences
[fmsc]: https://www.footballmanager.com/features/supporter-confidence
[fmscout]: https://www.fmscout.com/confidence.htm
