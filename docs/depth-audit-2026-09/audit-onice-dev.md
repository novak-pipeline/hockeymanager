# Audit: On-ice and Development systems vs FM24/FM26

Read-only audit of `improve-loop` working tree, 2026-09-26. Evidence comes from docs/LEVER-AUDIT.md (measured), the three playtests, the autopilot summary, and code reads (file:line below). Nothing was edited and no simulations were run.

Scores run 0–5 on seven axes: **Dec**isions offered · **Info**rmation quality · **Con**sequence · **Fb** (feedback/attribution) · **UX** polish · **Var**iety of content · **World** aliveness (does this system run for the whole hockey world, or only for the GM's club?).

FM reference sources:
- FM26 in/out-of-possession tactics: https://www.footballmanager.com/fm26/features/possession-out-possession-fm26s-new-tactical-evolution
- FM26 individual training (IP role / OOP role / additional focus, intensity, coach advice, progress bar): https://www.fmscout.com/a-fm26-training-guide-and-schedules-by-jonasmorais.html, https://community.sports-interactive.com/sigames-manual/football-manager-mobile-2026/training-r5253/
- Sports scientists, workload, injury risk, jadedness: https://www.givemesport.com/football-manager-2024-medical-centre-guide/, https://www.footballmanager.com/the-byline/fighting-fatigue-and-preventing-injuries-fm21
- Touchline tablet, assistant "Show me / Ask for", shouts: https://community.sports-interactive.com/sigames-manual/football-manager-2024-touch-and-console/playing-a-match-r4990/, https://www.passion4fm.com/how-to-use-touchline-shouts-in-football-manager/

---

## Summary table

| System | Dec | Info | Con | Fb | UX | Var | World |
|---|---|---|---|---|---|---|---|
| 1 Training and development | 3 | 2 | 3 | 1 | 3 | 2 | 2 |
| 2 Tactics and coaching | 2 | 3 | 3* | 3 | 3 | 2 | 3 |
| 3 Match engine and match night | 1 | 3 | 1 | 3 | 3 | 2 | 3 |
| 4 Medical, injuries, fatigue | 2 | 2 | 3 | 2 | 3 | 2 | 3 |
| 5 Data hub and analytics | 1 | 3 | 1 | 1 | 3 | 2 | 3 |
| 6 Continue loop, calendar, first hour | 3 | 3 | 3 | 2 | 4 | 2 | 2 |

\*Line and roster levers score 5. The team-tactics system scores 1 on the default Continue path.

**One root cause runs through every system:** the GM's club is simulated in depth, and the depth then stops at a seam. Tactics stop at the quick-sim seam. Development stops at the "only the user club has a regimen" seam. Medical stops at the "display the risk, don't model it" seam. Analytics stop at the "display the stat, no decision reads it" seam. Match night stops at the "the game is already over when you watch it" seam.

---

## 1. Training and player development

### What FM does
- **Weekly schedule.** Three sessions a day, and the session type matters: match prep, rest, set pieces, tactical, general. Team intensity is set as a whole, and pre-season builds Condition and Match Sharpness.
- **Individual training** (FM26 has three slots). An in-possession role, an out-of-possession role, and an additional attribute focus that does not take a share of the training pie. Also per-player intensity, weaker-foot work, position retraining, and coach advice on where to channel effort.
- **Feedback.** Training ratings (a grade per player), a progress bar toward potential, attribute history graphs with trend arrows over time, and a monthly training report that names who is improving.
- **Inputs to growth.** Coach star ratings per category (coaches split by attacking, defending, fitness and so on), training and youth facilities, match experience and minutes, hidden personality traits (professionalism), mentoring groups, and loan monitoring. Potential is a hidden value, sometimes a range.
- **Aging and decline.** Physical decline first. Jadedness (long-term tiredness) needs holidays.

### What we have
- **Growth model.** Gap-closure toward a hidden per-attribute `potential` vector.
  - In-season micro-pass every 14 days (`inSeasonDevelopment.ts:123-227`). It runs on a per-season budget by age and gap (`:58-67`). Rate = persona × games × perf × devMod (`:186-190`).
  - Summer consolidation (`offseason.ts:266-415`). `growthScale 0.65` (`career.ts:7710`). A hidden per-player `devArc` bust/boom trait (`offseason.ts:168-176`), boom/bust ceiling drift (`:178-218`), and position-aware aging with a later goalie curve (`:380-401`).
- **Practice.** Seven team foci (`practice.ts:40-47`), each an attribute bias map with a 6% drag on untargeted attributes (`:95-155`). Fatigue per week by focus (`:163-171`, applied weekly at `career.ts:6287-6296`). Per-player focus overrides, a suggestion engine (`practice.ts:264-358`), and a Dev Center per-player focus that follows prospects anywhere (`career.ts:21502-21528`).
- **Other growth levers.**
  - Mentorship: `mentorshipDevBonus`, `career.ts:18161`.
  - Farm-trip bonus: `career.ts:7160`.
  - Owner development perk: `career.ts:7722`.
  - Locker-room `developmentModifier`.
  - Performance vs expectation: `expectedPointsFor`, `offseason.ts:237`.
- **UI.**
  - Practice plan panel: what the focus sharpens, the opportunity cost, coach delivery, fatigue per week, and who it reaches with their headroom (`TeamScreen.tsx:120-198`).
  - Development Center: stars, tier, projection and note (`developmentCenter.ts`).
  - A Season growth column next to the dev focus (`DevelopmentScreen.tsx:21-110`).
  - Trend arrows from `devTrend`/`ceilingTrend` (`player.ts:211-223`).
- **Measured (LEVER-AUDIT §4).** On prospects, playing him is worth +1.46 overall a season, deployment +0.51 and mentorship +0.35. Foci reallocate +0.3 to +0.7 onto the targeted composite, and recovery costs −0.18. On the NHL U23 cohort everything rounds to about 0.

### Placeholder check
1. **No attribution exists (Gap #6).**
   - Growth is applied in place. No per-cause ledger is ever written: no `devLedger`, `growthLog` or rating history. Grep across `src/` returns nothing.
   - `Player` keeps only the latest `devTrend`/`seasonDevAccrued` (`player.ts:211-223`). The offseason overwrites them (`offseason.ts:409-413`).
   - So the game cannot say "his skating grew +3, and +1.1 of that was your skating focus." It cannot draw an attribute history graph either, because no history exists.
2. **Coach development quality only scales the focus bias, not growth.**
   - `coachDevMult` (`career.ts:21474-21492`) multiplies only the attribute-bias map for the user's own focus.
   - An elite development coach under a `balanced` focus has zero effect: `practiceAttributeBias` returns undefined at `:21519`.
   - The base growth rate in both dev engines has no coaching term at all.
   - FM's number-one development input (coach quality) is therefore mostly inert here.
3. **Assistant coaches do nothing for development.** They are read only for coach reports (`career.ts:16567`) and the staff-quality display (`:18900`).
4. **No facilities concept.** Grep for "facilit" returns 0.
5. **Ice time never reaches development directly.**
   - `combinedDevGames` counts games dressed (LEVER-AUDIT flag 4).
   - `developPlayers`'s docstring still advertises `toiPerGame`, which no longer exists (`offseason.ts:257`).
   - A fourth-liner and a first-liner with the same GP develop the same.
6. **"Offseason training has transformed X" is generic.** The text is at `career.ts:7734-7737` and is only emitted for the league top-5 risers. It never names the cause.
7. **Recovery focus has no upside in development by construction.** This is honest, but the UI gives no dev-side receipt for it.

### World aliveness
- **Positive.** Every rostered player in the world runs the same in-season and offseason engine, including performance vs expectation, cross-league NHLe translation and locker-room modifiers (`career.ts:6370-6391`, `7701-7730`).
- **Negative.**
  - Only the user's club has a practice regimen (`career.ts:21497-21517`, "everyone else develops neutrally").
  - Only the user's club runs weekly practice fatigue (`:6284-6296`).
  - Only the user's club gets mentorships and the owner or farm-trip perks.
  - An AI club hiring the best development coach in the league changes nothing about its prospects.
  - "Club X is a prospect factory" cannot emerge.

### Scores
| Axis | Score | Why |
|---|---|---|
| Dec | 3 | Team focus plus per-player focus, mentorship, deployment and call-ups are real. There is no schedule, intensity, role or position training. |
| Info | 2 | The plan preview and headroom are honest. There is no history graph, no training grades and no "who is improving" report. |
| Con | 3 | Measured and real on prospects (+0.3 to +0.7 targeted, +1.46 from playing). About 0 on the NHL roster. |
| Fb | 1 | Zero causal attribution. Growth shows next to the focus, never caused by it. |
| UX | 3 | Clean panels, but spread across Practice, Development and Mentorship tabs. |
| Var | 2 | Seven foci and templated news. The autopilot flags "X grow over X X ceiling" firing 20–32 times a season. |
| World | 2 | The same growth engine runs for everyone, but coaching, practice and mentoring are user-club-only. |

### Root cause
Development was designed as a single stochastic gap-closure with multipliers bolted on. The multipliers are folded into one `rate` scalar, so no cause survives to be reported. Staff quality was wired as a modifier of the user's own choice rather than as an org property every club has.

### True-depth spec (smallest genuinely deep version)
1. **DevLedger (M).**
   - Decompose each pass's per-attribute delta into additive shares: base (age × gap × arc), games, performance, focus reallocation, coach quality, mentor, locker room. This is computable, because the rate is a product: attribute each factor's log-share.
   - Persist per player per season as compact `{attr: [cause shares]}`, plus an overall snapshot each pass (13 in-season plus 1 summer). That also gives the FM-style attribute history graph for free.
   - Receipt: "Skating +3 this season: 1.4 age/room, 0.9 your Skating focus (Coach Ruiz: strong), 0.4 AHL top-six minutes, 0.3 mentor Crosby."
2. **Coach quality as an org property for every club (S–M).**
   - A `developingYoungsters`/position-coach term multiplies the base rate (0.85–1.15) for every team.
   - AI clubs get a regimen picked from their coach profile (for example, a defensive coach runs Defense).
   - Measure with `leverDev.harness` so a development coach is priced in ovr/season. Then the coach market has a development axis.
3. **TOI into development and fatigue (S).** Pass per-player season TOI/GP. `gamesFactor` becomes minutes-weighted, which closes LEVER-AUDIT flag 4.
4. **Monthly development report as a story beat, not a nag (S).** It names 2–3 risers and fallers with ledger causes, and one "his focus isn't landing" (targeted attribute flat for 3 passes: suggest a change).
5. **Individual intensity (S), optional.** Low/normal/high, trading growth rate against fatigue and a small injury risk. This only makes sense once fatigue feeds injury (system 4).

---

## 2. Tactics and coaching

### What FM does
- **Structure.** FM26 has separate in-possession and out-of-possession formations. Each player has a role and duty for both phases. Team instructions cover in possession, in transition and out of possession. Opposition instructions apply per player (tight mark, show onto the weaker foot, press).
- **Set pieces.** A set-piece creator.
- **Staff.** Assistant analysis and tactical familiarity (a team learns a system over time).
- **Everything applies in every match, simmed or watched, because there is one engine.**

### What we have
- **GM levers (all measured REAL on the quick sim, LEVER-AUDIT §1):**

  | Lever | Standings points |
  |---|---|
  | Line assembly | +24.1 |
  | Line order alone | +10.1 |
  | PP1 | +6.5 |
  | PK1 | +4.9 |
  | Goalie order | +4.3 |
  | Coach PP edge | +3.4 |
  | Coach PK edge | +3.4 |
  | Coach fit | +2.5 |

  They are set on the Tactics screen: line board, depth chart, PP/PK units and saved setups (`TacticsScreen.tsx:1010-1207`).
- **Team tactics are coach-owned.**
  - `profileToTactics` (`coachProfile.ts:442-475`) runs for every club (`career.ts:2422-2440`).
  - The GM's only route is `suggestToCoach`, with five directions (`coachTactics.ts:32-38`), from the staff meeting (`StaffMeetingScreen.tsx:67`).
  - `setTactics`/`applyCoachSuggestion` have no caller in `src/renderer`, which was re-verified by grep.
- **Full-sim-only systems (LEVER-AUDIT §3):**

  | System | Standings points |
  |---|---|
  | Forecheck | −12.4 |
  | Pass risk | +11.4 |
  | Dumping | −10.3 |
  | Gap control | +8.2 |
  | Puck pressure | +8.0 |
  | Passing | −16.4 |
  | Aggressiveness | −3.2 |

  PP formation (−0.3), PK formation (−0.2), shooting, pace and hitting are all INCONCLUSIVE.
- **13 dead fields**, marked in `domain/tactics.ts:70-214`.

### Placeholder check
1. **The quick sim reads almost none of the team tactics.**
   - `quickSim.ts` touches tactics only at `:674` (`lineMatching`). It also reads `coachFit`, `ppEdge` and `pkEdge` (`:398`, `:480`).
   - So on the default Continue path, forecheck, gap, pressure, pass risk, dumping and aggressiveness do nothing.
2. **Four of the five staff-meeting suggestions are near-inert even when they "work".**
   - `faster` and `defensive` move `pace`/`shotEagerness`/`defensivePinch` (`coachTactics.ts:46-55`). All three are INCONCLUSIVE in the full sim and unread in the quick sim.
   - `physical` and `aggressiveForecheck` switch to 2-1-2 (`:56-63`). The audit measures that as **−12.4 pts vs trap**, but only on watched games.
   - The only quick-sim effect is the `coachFit` recompute (`career.ts:16648`), worth ±1.5% shot conversion (`coachProfile.ts:502-505`).
   - Result: a coach accepting "play faster" is a story beat with no sim consequence on 95%+ of games.
3. **`mentality` is written by `profileToTactics` (`:473`) and read by nothing.** This is a writer with no reader.
4. **Line synergy is user-club-only.**
   - `storyResolve` applies `lineSynergy`/`pairSynergy` only when `teamId === userTeamId` (`career.ts:2939-2946`). The stated reason is "applying it to all AI teams would alter AI-vs-AI quick-sim seeds, breaking existing tests."
   - That is a test-compatibility decision making the world asymmetric.
   - Synergy is also missing from the lever audit, so its value (±3% band) is unmeasured.
5. **Two engines disagree on what tactics are worth.** Line assembly is worth +24.1 in the quick sim but +14.6 in the full sim. Pressing Watch changes the tactical physics of that night.

### World aliveness
**3.** Every club runs its own coach's system with coachFit and PP/PK edges, and the coach carousel swaps systems on firings (`career.ts:16962-16967`). But no AI coach adapts to the opponent or the score, line synergy excludes AI clubs, and with systems inert in the quick sim, "the league's trap teams" cannot exist for AI-vs-AI games.

### Scores
| Axis | Score | Why |
|---|---|---|
| Dec | 2 | Lines, units and goalies are deep and real. Tactics are reduced to five coarse suggestions. There are no per-player instructions and no opposition instructions. |
| Info | 3 | The "What this board is worth" receipt is excellent (`deploymentValue.ts`), plus the coach-system summary and line-chemistry briefing. |
| Con | 3 | Lines score 5. Tactics score 1 on the Continue path. |
| Fb | 3 | The line board prices itself. Tactics changes get no receipt. |
| UX | 3 | Solid line board. The "argue with the coach" route is buried in the staff meeting. |
| Var | 2 | Seven coach systems, five suggestion texts, two acceptance lines (`coachTactics.ts:129-139`). |
| World | 3 | All clubs are coached. No in-game or opponent adaptation, and synergy is user-only. |

### Root cause
The tactical system was designed inside the full engine, but the game is played through the quick engine. The coach-owns-tactics design (defensible) removed the need to make them GM-legible. As a result nobody forced the quick sim to carry them.

### True-depth spec
1. **Carry the seven REAL systems into the quick sim (M).**
   - Express each as a quick-sim rate modifier: shot-for rate, shot-against rate, entry-success, takeaway and penalty rate.
   - Calibrate so the quick-sim mirror delta equals the full-sim delta from LEVER-AUDIT §3. The harness exists; `leverGuard` then pins it.
   - Includes a matchup term. Trap vs speed rosters is the hockey truth, and `teamStyleFit` already computes roster speed.
   - This single change converts ~50 standings points of dormant tactical span into the game everyone plays.
2. **A GM-owned "game plan" with coach buy-in (M).**
   - Four legible, measured-real levers: forecheck (trap / 1-2-2 / 2-1-2), zone entry (carry / mixed / dump), neutral-zone gap (loose to tight) and risk (pass risk / pinch).
   - The GM sets intent. The coach's `tacticsKnowledge` and roster fit determine execution quality. Overriding a stubborn coach costs relationship and morale. This keeps the "coach owns it" fiction and gives a real choice.
   - Delete or keep-dead the rest. Do not surface PP/PK formations until the shot model differentiates them (flag 3).
3. **Apply line synergy to all clubs (S).** Update the fixture seeds rather than exempting the world. Add it to the lever audit.
4. **Tactical familiarity (S–M).** A system switch starts at 70% execution and ramps up over ~10 games. This makes coach firings and midseason switches a real trade-off, and the world gets "new coach bump / system learning curve" stories.

---

## 3. Match engine and match night

### What FM does
- **Pre-match.** Team talk (tone per player, with reactions shown), opposition instructions, and a pre-match assistant briefing.
- **During the match.** Tactical changes, substitutions and touchline shouts (about 10-minute effect windows). A touchline tablet with momentum, pass maps, xG and heat maps, plus "Show me / Ask for" assistant advice. Half-time team talk.
- **Post-match.** Analysis (xG timeline, shot maps, player ratings with reasons), a post-match team talk, then a press conference.
- **The watched match is being simulated as you watch it**, so decisions change the outcome.

### What we have
- **Engines.** Full per-tick engine (`fullSim.ts`, 2370 lines: goalie pulls by deficit/aggressiveness `:185-192,840-851`, line matching `:463,1733`, PP edges `:1874-1878`) and quick sim (`quickSim.ts`). Both emit `GameEvent` streams.
- **Renderers.** 2D PixiJS, 3D three.js, a text gamecast `SimView.tsx` (a stable broadcast layout after F4), commentary, and highlights (`render2d/highlights.ts`).
- **Pregame frame.** "Keys to the game": real, citation-backed deltas (`matchNight.ts:51-184`). Buttons are Close / Sim view / Watch on the ice / Play (`MatchNightFrames.tsx:136-151`).
- **Postgame receipt.** Turning point (`matchNight.ts:216-306`), three stars (`:345`), persistent chronicle moment (`:394`), coach quote pool (`story/coachQuotes.ts`), box score.

### Placeholder check
1. **The watched game is over before you watch it.**
   - `watchRegularDay` (`career.ts:6941-6967`) runs `fullSimGame` to completion, applies the outcome and postgame, and returns the stream for playback.
   - No mid-game input path exists: no timeout, no line change, no goalie pull, no shout, no intermission adjustment. Grep in `MatchViewer.tsx` finds only playback speed and camera controls.
   - "Watch" is a replay with a better camera, not a match you manage.
2. **The pregame keys prescribe actions the GM has no lever for.**
   - "Hard-match him" (`matchNight.ts:90`): line matching is coach-owned and not GM-settable (LEVER-AUDIT §6).
   - "Stay out of the box" (`:65`): discipline and aggressiveness are coach-owned and full-sim-only.
   - "Draw penalties" (`:76`) and "shoot from everywhere" (`:121`): no lever.
   - This is advice-without-a-lever, a subtler Esports-Manager defect.
3. **B6.2's "pregame choices referenced when they mattered" cannot be met, because there are no pregame choices.** The pregame frame is a stop with no decision on every game day (`App.tsx:410-428`). Under B2.1 it is at best a thin story beat.
4. **Choosing Watch vs Play changes the engine and so the expected result.** Coach systems worth ±12 pts apply only when watched, and line assembly pays 14.6 vs 24.1. A GM with a trap coach is better off watching every game. Hidden, exploitable, and it contradicts principle #2 ("same attribute model, different resolution").
5. **Data Hub copy promises "shot maps"** (`DataHubScreen.tsx:1294`). No shot-map component exists in `src/renderer`: grep for shot map, heat map, momentum and xG race finds only that sentence. There is no in-match analytics surface. FM's "touchline tablet" is the most-loved object in `RnD/yt-digest.md:64,72`.
6. **Repetition.** From the autopilot:
   - "Breakdowns cost us — Coach postgame" appears 8–15 times a season.
   - "Rough night for <goalie>" appears 8–12 times.
   - "Collapse: a 2-goal lead slips away" appears 16 times.
   - 12–30 dramatic games a season get "no story written" (`docs/autopilot/summary-latest.md:44-73`).

### World aliveness
**3.** All AI games are simmed with full stats, injuries and fights. There is a league ticker (`LeagueTicker.tsx`). But there are no around-the-league score updates during your game, and no AI-bench in-game behaviour is visible.

### Scores
| Axis | Score | Why |
|---|---|---|
| Dec | 1 | Play/Watch/Sim only. No team talk and no in-game control. |
| Info | 3 | The keys cite real numbers. Box score, turning point, three stars. No xG timeline or shot map. |
| Con | 1 | Nothing the GM does on match night changes the match. Only the Watch/Play toggle does, silently. |
| Fb | 3 | Postgame receipts are good and chronicle-persistent. |
| UX | 3 | Stable gamecast. The postgame slow-load was not yet measured on a game day. |
| Var | 2 | Measured repetition, and undramatised games. |
| World | 3 | A full world sim runs, but its surface is thin during your game. |

### Root cause
The architecture sims a whole game atomically and treats rendering as playback. That is right for the event-stream contract, but no "segment" boundary exists at which a human decision could re-enter the sim. Match night was then built as presentation around an already-decided outcome.

### True-depth spec
1. **Segmented simulation (L; the keystone for FM-grade match night).**
   - Both engines expose `simSegment(state, untilT) -> {state, events}` with a serialisable `GameState` (score, clock, fatigue, penalties, rng cursor). A whole game is then just segments to 3600 s, so determinism holds, because a no-input run is byte-identical.
   - Decision points: each intermission, and optionally a timeout (one per game) and "at a stoppage".
   - Decisions: game-plan shift (the four levers from system 2), line juggling (swap two forwards, shorten the bench to three lines, which gives the top lines more TOI and fatigue), starting or pulled goalie, and pull timing (early / normal / late).
   - Delegation: "Let the coach run the bench" is the default, so Continue is unchanged.
2. **Pregame decisions that the postgame cites (S–M).**
   - Choose the starting goalie tonight (backup share is already modelled at `quickSim.ts:873-905`).
   - A matchup directive at home (hard-match their top line: the line-matching lever, now GM-settable and priced at +1.8/+2.5).
   - A team-talk tone (calm / fire up / challenge) applied to morale and form through the existing `effectiveResolve`. Personality decides the reaction. Morale is worth 11.3 pts over its range, so this is a real channel.
   - The postgame receipt then says "Your call to start Markström: .931 on 29" (B6.2).
3. **Bench tablet (M).** From the stream: shot map, xG race, shift chart, line-vs-line on-ice shots. Pure folds of the event stream, like `liveBoxScore.ts`. Use it in the gamecast and the postgame, and fix or remove the false "shot maps" claim.
4. **Keys only name levers that exist (S).** Rewrite the keys so each maps to a pregame decision in item 2, or phrases as coach intent ("Ruiz will hard-match him").

---

## 4. Medical, injuries, fatigue

### What FM does
- Separate **Condition** (short-term fitness), **Match Sharpness** (built by playing) and **Jadedness** (long-term overload that needs rest or a holiday).
- The **sports scientist** summarises match plus training load per player and categorises injury risk from susceptibility and fatigue. Sports scientists reduce some injuries and slow jadedness.
- **Physios** affect recovery. **Injury history** shows recurrence and injury-prone patterns. There are rush-back and "risk him" decisions.

### What we have
- **Injury roll per game.** It uses balance, aggression, TOI, age and DB proneness (`condition.ts:101-116`). It covers NHL, AHL (`career.ts:6617`, `6993`) and world leagues (`worldSim.ts:155`).
- **Injury types.** Four kinds with about 25 descriptions (`condition.ts:41-75`). Games out follow an exponential (`:90-95`). In-game departures come from the full sim (`career.ts:5354-5368`). Match rust applies after long layoffs (`condition.ts:182-233`).
- **Fatigue and condition.**
  - Fatigue: +8±2 per game played, scaled by stamina. Rest: −12 × natural fitness (`:236-252`).
  - The condition multiplier on the sim is 0.87–1.03 (`:424-433`), and it is the single biggest lever: **+37.9 pts** (LEVER-AUDIT §2).
- **Medical screen.** Body diagram, severity, estimated return, LTIR place/activate, a risk table, a Rest toggle, and the physio name and rating (`MedicalScreen.tsx`). Staff meeting findings `injuryRisk` and `fatigued` (`staffMeetingScene.ts:81-82`).

### Placeholder check
1. **The displayed injury risk is not the modelled injury risk.**
   - Risk = `proneness*0.55 + fatigue*0.45` (`career.ts:18491`). But `injuryChance` does not read fatigue (`condition.ts:101-116`).
   - The Medical screen, and the staff meeting's `injuryRisk` decision built from it, tell the GM a tired player is at higher injury risk. The sim disagrees.
   - Resting him avoids an injury only because he doesn't play (TOI 0). That is the same as scratching a fresh player.
   - This is a live "clear logic" violation (B7.3).
2. **The physio is display-only.** Reads: the Medical header (`career.ts:18523-18540`) and a staff-quality average (`:18902-18908`). Neither injury chance, games out nor recovery (`tickRecovery` decrements a flat 1, `condition.ts:218`) reads any physio or medical staff. Hiring a better physio does nothing.
3. **Fatigue is not ice-time aware.** Any player who played gets +8 (`condition.ts:236-242`). A 7-minute fourth-liner tires like a 26-minute D-man. So "shorten the bench" or "ride the top pair" has no fatigue cost. That same flatness is probably part of why freshness measures 38 pts (the whole roster moves together).
4. **No injury history, recurrence or re-injury.** `Player` stores only `injuryStatus` and `rustGames` (`player.ts:270-278`). Proneness is a static DB number and never grows with injuries.
5. **No medical decisions.** No rush-back or play-through-pain choice, and no cortisone/"play him in the playoffs" gamble. EXCELLENCE B5.5 names "injury gambles" as a desired decision event. `decisionEvents.ts` has two hits on this theme; this should be confirmed but it is not a system.
6. **No sharpness or jadedness split.** A single scalar carries both the short-term and the long-term meaning.

### World aliveness
**3.** Injuries roll league-wide including AHL and world leagues, and LTIR exists. But AI clubs' medical staff do nothing either, there is no league injury report or man-games-lost table, and AI clubs never make a rest decision (the user-only `resting` flag and weekly practice fatigue).

### Scores
| Axis | Score | Why |
|---|---|---|
| Dec | 2 | Rest, scratch and LTIR only. |
| Info | 2 | The risk number misrepresents the model, and the physio rating implies an effect that doesn't exist. |
| Con | 3 | Fatigue is enormous (38 pts, arguably over-weighted). Injuries are real. |
| Fb | 2 | Return and rust news exists. No "rest paid off" receipt. |
| UX | 3 | Good FM-style screen. |
| Var | 2 | Four kinds and flat durations. |
| World | 3 | League-wide injuries, no league-wide medical agency. |

### Root cause
Fatigue and injury were built as two independent dice systems. The UI then presented them as connected, and staff were added as roster rows without hooking them into either.

### True-depth spec (M)
1. **Load.** Fatigue per game ∝ TOI (with shift-length and back-to-back multipliers). Split into `condition` (short) and `load` (a 14-day rolling sum).
2. **Risk.** `injuryChance *= f(load, condition)`, calibrated so league man-games-lost stays in band. Then the risk column is true and Rest is a real injury lever.
3. **Staff.** The physio scales games out (±20%) and rust. A sports-science staff member (or the physio's second attribute) scales the load-to-risk slope. Measure both in the lever harness.
4. **History.** Store per-player injury history (kind, date, games). Recent same-region injuries raise recurrence odds for a window, and proneness drifts with repeated injuries.
5. **Rush-back decision.** When a key player is within 2–3 games of return before a big game or the playoffs, the physio offers "clear him early": −N games out, with recurrence risk shown. It becomes a decision event with a delayed callback.
6. **Recalibrate freshness.** Once fatigue is TOI-weighted, re-run LEVER-AUDIT §2 against real NHL back-to-back splits (flag 1).

---

## 5. Data hub, stats, analytics

### What FM does
- The Data Hub has analyst-produced reports: team and player performance vs league, set-piece analysis, and opposition reports with data. The analyst's quality affects the reports.
- Data flows into decisions: scouting recommendations, the tactical suggestions the assistant raises, and the pre-match opposition report.
- There is a touchline tablet with live data.

### What we have
- **`DataHubScreen.tsx` (1360 lines).**
  - Percentile radars, a team league table, an xA/60 × xG/60 scatter (declustered, #19c), leader tables.
  - Category tabs: offense, defence, PP, PK, goaltending.
  - Monte-Carlo playoff odds (`PlayoffOddsCard`), a "How you stack up" panel.
  - A Data Analyst hire gate (`:1277-1326`).
- **Analyst effect.** Analyst quality sets draft projection noise (`career.ts:20167-20172`), and projections are hidden without an analyst (`:20228-20230`).

### Placeholder check
1. **The analytics inform no in-season decision.** xG and xA appear in `buildViews.ts`, `views.ts`, the engines (producers) and `coachQuotes.ts` (prose) only. No decision code reads them: none of `lineup.ts` (coach auto-lines), `trades.ts`/`assetValue` (AI valuation), `contracts.ts`, `staffMeeting*` or `scouting.ts`. The hub is a spectator surface.
2. **"The better the analyst, the sharper the models"** (`DataHubScreen.tsx:1297`). This is true only for draft projections. The xG, percentiles and radars are exact regardless of analyst, so the analyst's in-season value is 0.
3. **The "shot maps" claim** (`:1294`) is false (see system 3).
4. **The `dataAnalyst` staff role exists in types** (`staff.ts:79`) and biographies, but `generateStaff` (`staff.ts:306-410`) never creates one for any club. AI clubs have no analytics departments, so the "analytics vs old-school GM" world contrast is impossible.
5. **The Data Hub is locked until an analyst is hired.** This hides the one information surface FM players expect on day one. It gates information rather than quality.

### World aliveness
**3.** The league table and scatter cover every club and player. No AI club uses analytics, and no pundit or story beat cites them. There is an analyst pundit, CarverNotes (`salience.ts:70`), whose posts are unverified against this data.

### Scores
| Axis | Score | Why |
|---|---|---|
| Dec | 1 | Hiring the analyst is the only decision. |
| Info | 3 | Rich, honest numbers. No shot or event maps, no on-ice line analytics. |
| Con | 1 | Only draft projection noise. |
| Fb | 1 | No insight is ever tied to an outcome. |
| UX | 3 | Good charts. The locked-until-hire gate works against the design. |
| Var | 2 | Static tables. |
| World | 3 | League-wide data, no league-wide analytics agency. |

### Root cause
Analytics were built as a screen, not a staff member. Nothing in the decision layer consumes them, so they cannot matter.

### True-depth spec (M)
1. **The analyst produces decisions, not charts.**
   - A weekly (or staff-meeting) analytics finding, ranked by expected standings points: "Line 2 is +8 xG% on ice. Line 3 is −12 over 10 games. Swap your 3C and 2C?"
   - Uses on-ice shot data. Add on-ice xGF/xGA per player to the box-score fold; the stream carries shooters and on-ice skaters.
   - Accepting it is a line change the line-board receipt already prices. The analyst's rating sets the noise and sample threshold (a weak analyst chases 5-game noise).
2. **AI clubs get an analytics posture** (old-school to analytics-driven) in their GM persona. It weights xG over points in AI trade valuation. That produces a world where analytics clubs buy undervalued possession players, and a story angle.
3. **Unlock the hub at a basic level for everyone.** The analyst adds the models: projections, regression flags, "shooting % unsustainable", opposition reports.
4. **Opposition report with data** feeds the pregame keys (system 3).

---

## 6. Continue loop, calendar and season rhythm, first hour

### What FM does
- **Continue** stops only on decisions or relevant news. Every chore can be delegated (the Responsibilities screen).
- **Induction.** A new save opens with the board-welcome sequence (club fact sheet, objectives, the assistant's best XI), then skippable inductions per subsystem delivered as inbox items over the first week (`yt-digest.md:26-28`).
- **Pacing.** A friendly or the first match comes quickly.

### What we have
- **The beat-gate law** (`beatGates.ts:1-159`): nine soft gates plus three hard gates. Each names itself on Continue and always routes or spends, so the softlock class is extinct (`beatGateAudit` covers 1400 presses).
- **Cadence filter** (`lib/cadence.ts:31-41`): the overlay holds on 45 of 60 advances.
- **Processing overlay** with a calendar, auto-close on quiet days, and a sticky Continue on the receipt.
- **Delegation.** Every meeting delegates to AGM, coach or scouts.
- **Season rhythm.** Training camp (8 days), dev camp, board meeting, deadline-day clock, offseason re-sign window (4 days), FA, and so on (SEASON-RHYTHM, OFFSEASON-2).
- **Robustness.** The 25-season autopilot finishes with 0 critical and 0 major issues (`summary-latest.md`).
- **Front door.** Title, club picker with job brief, and save manager (Gap #18, B1.1).

### Placeholder check
1. **The first hour opens on paperwork.** `startAtOffseason` (`career.ts:6820-6849`) drops a new GM into the re-sign window, then qualifying offers, offer sheets, July 1 FA, dev camp, the August compress, an 8-day camp, cut day, the board meeting, and finally opening night.
   - That is dozens of Continue presses before the first game, against B1.2 ("first session ends on a hook… never on paperwork").
   - There is no induction or hint system: grep for hint, onboard, tutorial or induction returns nothing (B1.3 not started).
2. **The pregame stop has no decision.** Every game day holds once on a frame whose only choices are how to consume a result (see system 3). About 82 stops a season could carry a decision.
3. **Delegation receipts repeat verbatim.**
   - "You left it to the staff" appears 13–18 times a season and "You left the board to the staff" 7–10 times.
   - "Weekly scouting digest" is identical 25–35 times a season.
   - That violates B4.5 and turns delegation into noise. It is also the most-seen text in a delegated playthrough (B2.3: "that playthrough still tells a story").
4. **The season-act tonal shifts (Gap #16) and the Thanksgiving benchmark are not built.** Nothing marks "act 2" in the loop, although playoff odds exist.
5. **World churn is deliberately silenced** (the `league` category is filtered from stops). That is correct for cadence, but it means the living world is only discoverable, never felt, unless it crosses salience 55.

### World aliveness
**2.** The calendar is the GM's calendar. League beats (other teams' streaks, coach firings, injuries to stars) exist as mail but have no rhythm slot, such as a weekly "around the league" digest that replaces the identical scouting digest.

### Scores
| Axis | Score | Why |
|---|---|---|
| Dec | 3 | Gates are real decisions (meetings, offers, camp cuts, deadline). The game-day stop has none. |
| Info | 3 | Continue names what it needs, and the overlay shows the calendar. |
| Con | 3 | Delegation and engagement both change state. |
| Fb | 2 | Delegation receipts are identical boilerplate. |
| UX | 4 | Softlock-proof, auto-closing overlay, instant advances (65 ms offseason). |
| Var | 2 | The measured repetition above. |
| World | 2 | The world is filtered out of the rhythm rather than given a slot. |

### Root cause
The loop was hardened for correctness (gates, softlocks), which was the right P0. It was never designed for *pace-to-first-joy*. The takeover start point was chosen for data fidelity (the DB is post-draft), not for the player's first hour.

### True-depth spec
1. **First-hour path (M).**
   - An "Express summer" option on a new career: the AGM auto-resolves re-signs and the FA shortlist with a one-screen digest ("here's what I did, veto any"). Then a jump to camp, with the first preseason game playable inside ~10 presses.
   - The first session ends on a hook: the opening-night pregame with a real decision (starting goalie / team talk), or a staged first-week dilemma from the decision-event library.
2. **Contextual hints (S).** A `hintsSeen` set in settings, plus one-line inline hints the first time each gate or screen appears, each ending with "or delegate". This is FM's induction model, not a tutorial.
3. **Make the game-day stop a decision (S, once system 3's item 2 exists).** Otherwise skip it when delegated.
4. **Delegation receipts become pooled content (S).**
   - 8+ variants each, citing *what the staff did* ("Ruiz kept Järnkrok in and sent Stecher down").
   - Collapse the weekly scouting digest into the monthly scout meeting unless a find crosses a threshold.
   - Add a weekly "Around the league" beat (injuries to stars, coach hot seats, hot teams) so the world has a rhythm slot.

---

## Cross-cutting: World aliveness findings (for the AI-world auditor)
- **User-only by design:** practice regimen, practice fatigue, mentorships, owner and farm-trip development perks, line synergy (explicitly, for test-seed stability, `career.ts:2939-2946`), rest/load management, analytics.
- **World-wide and good:** development engine, aging, ceiling drift, injuries (NHL, AHL, world), coach profiles to tactics, coachFit and PP/PK edges for every club, the coach carousel.
- **Recommendation.** Adopt a rule that any modifier the GM's club gets, every club gets through its staff and persona. Where fixtures would change seeds, regenerate the fixtures rather than exempt the world.

## Top 3 recommendations (by depth gained per effort)
1. **One engine truth for tactics, then a GM game plan (M, then M).** Port the seven REAL full-sim systems into the quick sim as calibrated rate modifiers (lever harness plus `leverGuard`). That turns about 50 pts of dormant tactical span live on the Continue path and removes the Watch-vs-Play exploit. Then expose four measured levers as GM intent, executed through coach buy-in. Apply line synergy to all clubs.
2. **The Development Ledger (M).** Per-pass, per-cause growth decomposition, persisted as history. It closes Gap #6 with true attribution, gives FM-style attribute graphs and a monthly development report, and makes coach quality a base-rate input for every club, so development coaches and prospect factories exist.
3. **Match night you can affect (L, staged).** Stage 1 (S–M): pregame decisions (starter, home matchup directive, team-talk tone into morale and form) cited by the postgame, and keys that name only real levers. Stage 2 (L): segmented simulation with intermission decisions and a bench tablet (shot map, xG race). Alongside it, fix the medical honesty bug: displayed risk uses fatigue but the injury model doesn't, and the physio is inert.
