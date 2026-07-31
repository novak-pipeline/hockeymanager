# LEVER AUDIT — is every GM decision real?

**Task #154.** Measured 2026-07-31 against branch `improve-loop`.

> *"Our tactical decisions dont seem to have any real impact on the gameplay.
> There are many tactical options but most of them do not make any difference,
> they just feel random."*
> — the Steam review that explains Esports Manager 2026's Mixed rating
> (see [LESSONS-ESPORTS-MANAGER.md](LESSONS-ESPORTS-MANAGER.md))

A management game is a promise that the GM's decisions **are** the game. This
document is the audit of that promise: every lever the GM can move, simmed at
each setting, with the measured delta and a verdict. Nothing here is asserted
from reading the code. "Seems to work" is the failure mode being audited.

---

## Method

**The rig.** Two byte-identical clones of one generated roster face each other.
One bench gets the lever at its maximum, the other at its minimum; everything
else — talent, lines, goalies, coach — is the same object. Home ice alternates
every game so the home-ice edge cancels exactly. Any measured difference is the
lever and nothing else. A **null control** (both benches identical) runs in every
batch: it reads +0.4 points at 40,000 games (z = 1.0), so the rig is unbiased and
the rest of the table means what it says.

**The unit.** Per-game goal differential converted to the currency a GM thinks
in — **standings points across an 82-game season**:

```
seasonPoints = goalDiffPerGame × 82 × 2 / 6      (≈6 goals per win, 2 points per win)
```

Because one bench sits at max and the other at min, each figure is the lever's
**full span**: what moving it from its worst setting to its best is worth over a
season. Real decisions live inside that span, not at its ends.

**The bar** (fixed before any lever was run, applied identically to all of them —
`leverLab.ts: classify`):

| Verdict | Meaning |
| --- | --- |
| **REAL** | Significant (\|z\| ≥ 3) **and** worth ≥ 2 standings points. Two points decides playoff races; below that a GM cannot act on it. |
| **TOO WEAK** | Significant, but worth < 2 points. Wired and honest, just lost in a season's noise. |
| **DEAD** | Indistinguishable from zero, at a sample large enough to have found a 2-point effect. |
| **INCONCLUSIVE** | Not significant, and the sample could not have detected 2 points either. **Never** to be reported as "works". |

The **detection floor** column is the smallest effect that sample could have
proven (3 standard errors). It is printed so no verdict can hide behind an
underpowered run.

**Two engines, and it matters which.** `career.advanceDay` — the plain *Continue*
path, how most games get played — sims **every** game, including the user's,
through `quickSimGame`. Only a game the GM explicitly **watches** runs through the
full per-tick engine. So a lever wired only into the full sim does nothing on the
path most GMs play most nights. The table is split accordingly.

**Reproduce:**

```bash
LEVER_AUDIT=1 npx vitest run src/engine/audit/leverAudit.harness.test.ts --no-file-parallelism --reporter=verbose
```

---

## 1. Quick sim — the engine that plays your season

40,000 mirror games per lever, all thirteen from a single batch on one method.
Detection floor ±1.0 points, so anything real down to a single standings point is
visible. Every figure below reproduces byte-for-byte on re-run (fixed seeds).

| Lever | Where the GM sets it | Contrast | Δ pts / 82 | 95% CI | z | Δ shots/g | Δ own PP% | Verdict |
| --- | --- | --- | ---: | --- | ---: | ---: | ---: | --- |
| *NULL CONTROL* | — | identical benches | +0.4 | −0.3 … +1.0 | 1.0 | +0.01 | −0.16 | *rig reads zero* ✅ |
| **Line assembly** | Tactics → line board | best 12F/6D dressed and stacked vs worst dressed and stacked | **+24.1** | +23.4 … +24.8 | 70.7 | +3.89 | +0.47 | **REAL** |
| **Line order** *(same 18 dressed)* | Tactics → line board | strongest on L1/D1 vs weakest, same men | **+10.1** | +9.4 … +10.8 | 29.2 | +1.61 | +0.00 | **REAL** |
| **Power-play unit** | Tactics → PP1/PP2 | best scorers on PP1 vs worst | **+6.5** | +5.9 … +7.2 | 19.0 | +0.70 | **+5.64** | **REAL** |
| **Penalty-kill unit** | Tactics → PK1/PK2 | best defenders on PK1 vs worst | **+4.9** | +4.2 … +5.5 | 13.9 | +0.85 | +3.65 | **REAL** |
| **Goalie depth order** | Tactics → line board | better goalie starts vs worse | **+4.3** | +3.6 … +5.0 | 12.2 | −0.14 | +0.81 | **REAL** |
| **Coach PP edge** | Staff → hire coach | ppEdge 1.15 vs 0.85 | **+3.4** | +2.7 … +4.0 | 9.7 | +1.21 | **+3.92** | **REAL** |
| **Coach PK edge** | Staff → hire coach | pkEdge 0.85 vs 1.15 | **+3.4** | +2.8 … +4.1 | 9.9 | +1.10 | +3.65 | **REAL** |
| **Coach roster fit** | Staff → hire coach | coachFit 100 vs 0 | **+2.5** | +1.8 … +3.2 | 7.2 | −0.09 | +0.50 | **REAL** |
| Line matching | coach-owned, not GM-settable | on vs off | +1.8 | +1.1 … +2.4 | 5.0 | +0.32 | +0.03 | **TOO WEAK** *(by design — see §6)* |

**Read this table before anything else.** Line assembly is worth **twenty-four
standings points** — an order of magnitude more than any tactical setting. The
game's deepest lever is already the one on the screen the GM spends most of his
time on, and it works. The two line rows are deliberately separate because they
are two different decisions: *who dresses* and *what order they play in*.
Ordering alone — the same eighteen men, arranged worst-to-best — is worth 10.1
points on this roster (10.1 / 10.6 / 13.2 / 14.6 across four rosters), still
nearly four times the biggest coaching lever. Dressing the right men on top of
that roughly doubles it.

**Each lever moves the channel it is supposed to, not just the scoreboard.** The
`Δ own PP%` column is the check: stacking PP1 moves power-play conversion by
**+5.6 points** and a coach's PP competence by **+3.9**, while reordering the
even-strength lines moves it by **0.00** and line matching by **0.03** — exactly
as those levers should behave. A lever that moved the result through the wrong
mechanism would be a different kind of lie, and this rules it out.

---

## 2. Condition — the man-management channel

The route through which morale, fatigue and form reach the ice
(`condition.effectiveResolve`, which `career.ts` wraps every sim in). Squad-status
promises, healthy scratches, the recovery practice week, rest days, the
captaincy and locker-room work all cash out **here and nowhere else**, so these
numbers set the ceiling on what all of those decisions can be worth. Spans are
the realistic in-season range, not the model's clamps.

| Lever | Contrast | Δ pts / 82 | 95% CI | z | Δ shots/g | Verdict |
| --- | --- | ---: | --- | ---: | ---: | --- |
| **Team freshness (fatigue)** | fatigue 2 vs 18 | **+37.9** | +37.2 … +38.6 | 109.7 | +4.43 | **REAL** |
| **Team form** | +2.5 vs −2.5 across the roster | **+17.5** | +16.8 … +18.2 | 50.0 | +2.20 | **REAL** |
| **Team morale** | 80 vs 35 | **+11.3** | +10.6 … +12.0 | 32.3 | +1.37 | **REAL** |

**The single most powerful thing in the game is rest.** Freshness outweighs every
tactical setting combined by a factor of ten. That is a finding with two edges:
it is good that man-management is decisive, and it is a calibration risk that a
worn roster is a 38-point handicap. Flagged in §7, not quietly adjusted here.

---

## 3. Full sim — the watched-game engine

Every tactical system and slider the engine reads. All of them live **only** in
the full engine, so whatever they are worth, they are worth it only on nights the
GM presses *Watch* — see §6, and flag 2 in §7.

8,000 mirror games per lever. Detection floor ±2.7 points — coarser than §1
because the full engine is ~300× slower per game (93 ms vs 0.25 ms), so an
effect under about three points reads INCONCLUSIVE rather than DEAD. That is the
honest limit of this sample, not a claim that those levers work.

| Lever | Contrast | Δ pts / 82 | 95% CI | z | Δ shots/g | Δ xG/g | Verdict |
| --- | --- | ---: | --- | ---: | ---: | ---: | --- |
| *NULL CONTROL* | identical benches — must measure zero | +0.7 | −1.1 … +2.5 | 0.8 | −0.11 | −0.01 | *rig reads zero* |
| **Forecheck system** | '2-1-2' (aggressive)  vs  'trap' | −12.4 | −14.1 … −10.8 | -14.6 | −5.99 | −0.66 | **REAL** |
| **D-zone coverage** | 'man'  vs  'zone' | −2.2 | −4.0 … −0.4 | -2.4 | −0.79 | −0.13 | **TOO WEAK** |
| **Power-play formation** | '1-3-1'  vs  'overload' | −0.3 | −2.1 … +1.5 | -0.3 | −0.14 | −0.01 | **INCONCLUSIVE** |
| **Penalty-kill formation** | 'aggressive'  vs  'box' | −0.2 | −1.9 … +1.6 | -0.2 | +0.00 | −0.00 | **INCONCLUSIVE** |
| **Tempo: pace** | pace 1.0  vs  pace 0.0 | +0.8 | −0.9 … +2.6 | 0.9 | +0.36 | +0.11 | **INCONCLUSIVE** |
| **Tempo: pass risk** | passRisk 1.0  vs  passRisk 0.0 | +11.4 | +9.6 … +13.1 | 12.8 | +3.00 | +0.42 | **REAL** |
| **Tempo: shot eagerness** | shotEagerness 1.0  vs  shotEagerness 0.0 | +1.2 | −0.6 … +2.9 | 1.3 | +1.12 | +0.03 | **INCONCLUSIVE** |
| **Tempo: defensive pinch** | defensivePinch 1.0  vs  defensivePinch 0.0 | +1.8 | +0.0 … +3.6 | 2.0 | −0.04 | +0.06 | **INCONCLUSIVE** |
| **Aggressiveness** | 1.0 (chippy)  vs  0.0 (disciplined) | −3.2 | −4.9 … −1.4 | -3.5 | +0.09 | +0.01 | **REAL** |
| **Hitting** | 1.0 (punishing)  vs  0.0 (avoid contact) | +0.8 | −0.9 … +2.5 | 0.9 | +0.94 | +0.10 | **INCONCLUSIVE** |
| **Gap control** | 1.0 (tight)  vs  0.0 (loose) | +8.2 | +6.4 … +9.9 | 9.1 | +3.16 | +0.37 | **REAL** |
| **Puck pressure** | 1.0 (swarming)  vs  0.0 (passive) | +8.0 | +6.2 … +9.8 | 8.9 | +2.86 | +0.33 | **REAL** |
| **Passing** ⚠︎ | 1.0 (heavy puck movement)  vs  0.0 (individual) | ~~−66.0~~ **−16.4** | −18.4 … −14.4 | -15.7 | −5.94 | −0.65 | **REAL** *(was a defect — fixed, see below)* |
| **Shooting** | 1.0 (shoot on sight)  vs  0.0 (patient) | +0.1 | −1.7 … +1.8 | 0.1 | +1.40 | +0.01 | **INCONCLUSIVE** |
| **Dumping** | 1.0 (always dump)  vs  0.0 (always carry) | −10.3 | −12.1 … −8.6 | -11.5 | −3.88 | −0.45 | **REAL** |
| **Line matching (home last change)** | lineMatching on  vs  off | +2.5 | +0.7 … +4.2 | 2.8 | +0.37 | +0.05 | **TOO WEAK** |
| **Line assembly** | best 12F/6D dressed and stacked vs worst | +14.6 | +12.9 … +16.3 | 16.7 | +2.41 | +0.28 | **REAL** |

### What the full-sim table says

**Seven of the fifteen tactical levers are real, and two of the most legible are
not.** A GM can feel the forecheck (−12.4 — the trap beats a 2-1-2 press by a
dozen points against this roster), pass risk (+11.4), gap control (+8.2), puck
pressure (+8.0), dump-vs-carry (−10.3: carrying in is decisively better) and
discipline (−3.2 for playing chippy). Those are genuine hockey tradeoffs with
genuine magnitudes.

But **power-play formation reads −0.3 and penalty-kill formation −0.2** — the two
choices a hockey fan would most expect to matter, indistinguishable from nothing
at a ±2.7-point floor. So do `shooting` (+0.1), `pace` (+0.8) and `hitting`
(+0.8). They are wired — the static audit proves the engine reads them — but the
formations select positioning that the shot model then barely differentiates.
None of them is GM-facing today (§6), so none is currently lying to a player; all
five are logged as flag 3 in §7 rather than quietly written up as working.

**The passing defect (⚠︎).** Measured at its original setting, the `passing`
slider was worth **−66 standings points** across its span, with team shot volume
collapsing by 23.8 a game. That is not a stylistic tradeoff, it is a self-destruct
button — and it was **live**, because coach profiles set `passing` from their
offence and risk axes, so hiring a puck-movement coach quietly cost a club around
26 points a season.

The cause is one-sidedness: the model charges the *cost* of passing more (ticks
burned, turnover exposure) and pays none of the *benefit* — real puck movement
buys shot quality, not merely fewer shots. Paying that benefit means changing the
danger model, which is a feature project, not an audit fix. So the band the
slider may move pass frequency through was narrowed from 0.6–1.5 to 0.9–1.12,
which prices the full span at **−16.4 points** — the same order as forecheck and
dumping — and a realistic coach spread at about 6. Neutral-preserving: at the
default 0.5 the multiplier is exactly 1.0, so a club that never touches the
slider sims byte-identically to before.

---

## 4. Development levers

Measured by running a real season of development — 13 bi-weekly
`tickInSeasonDevelopment` passes plus the `developPlayers` summer pass at
`growthScale 0.65`, exactly as `career.ts` runs them — over a fixed cohort, then
differencing the arms. Unit: **overall rating points gained per player per
season**, plus movement in the composite the focus claims to target.

**Headroom is the whole story.** A development lever can only move a player who
has room left to his ceiling:

| Cohort | n | Room to ceiling | Baseline growth |
| --- | ---: | ---: | ---: |
| U23 skaters on an NHL roster | 82 | 2.23 ovr | **0.27 ovr/season** |
| U23 skaters everywhere else (farm, junior, Europe) | 143 | 11.39 ovr | **2.71 ovr/season** |

### 4a. On the NHL roster — the cohort the team regimen used to reach

| Lever | Contrast | Δ overall/season | Δ targeted composite |
| --- | --- | ---: | ---: |
| Practice focus: Offense | vs balanced | +0.01 | scoring +0.07 |
| Practice focus: Defense | vs balanced | +0.01 | defensiveZone +0.08 |
| Practice focus: Skating | vs balanced | +0.01 | skating +0.06 |
| Practice focus: Physical | vs balanced | −0.01 | hitting +0.06 |
| Practice focus: Recovery | vs balanced | −0.01 | scoring −0.02 |
| Mentorship pairing | mentored vs not | +0.04 | scoring +0.09 |
| Deployment (top-six vs fourth-line production) | 1.5× vs 0.7× expectation | +0.15 | scoring +0.08 |
| Playing him (82 GP vs 5) | dressed vs press box | +0.12 | scoring +0.15 |

Everything rounds to nothing. **Not because the wiring is broken** — the same
levers work on the cohort below — but because the team practice regimen was
pointed at the one group of young players with nothing left to learn.

### 4b. On the prospect pool — where development actually happens

| Lever | Contrast | Δ overall/season | Δ targeted composite | Verdict |
| --- | --- | ---: | ---: | --- |
| **Playing him** | 82 GP vs 5 GP | **+1.46** (54% of baseline) | scoring +1.31 | **REAL** |
| **Deployment** | producing 1.5× vs 0.7× of expectation | **+0.51** (19% of baseline) | scoring +0.49 | **REAL** |
| **Mentorship pairing** | mentored vs not | **+0.35** (13% of baseline) | scoring +0.31 | **REAL** |
| Practice focus: Skating | vs balanced | −0.01 | **skating +0.69** | **REAL** *(reallocates)* |
| Practice focus: Defense | vs balanced | +0.04 | **defensiveZone +0.58** | **REAL** *(reallocates)* |
| Practice focus: Physical | vs balanced | −0.15 | **hitting +0.40** | **REAL** *(reallocates)* |
| Practice focus: Offense | vs balanced | +0.06 | **scoring +0.32** | **REAL** *(reallocates)* |
| Practice focus: Recovery | vs balanced | −0.18 | scoring −0.16 | **REAL, and negative** |

A focus is *supposed* to trade breadth for depth, and it does: `offense` buys
+0.32 scoring and +0.44 playmaking while total growth barely moves. Over the four
or five seasons a prospect develops, that compounds to two or three composite
points in the area you chose — a real shaping decision, honestly priced.

`recovery` is the exception: it has **no** development upside by construction
(empty attribute bias, so every attribute takes the untargeted drag) and costs
−0.18 overall a season. Its payoff is entirely on the fatigue channel — and §2
prices fatigue at 2.4 standings points per point of average fatigue, so a
recovery week is a legitimate in-season trade, just never a development one.

---

## 5. Proven dead by inspection

No simulation needed: **no engine file reads these fields**, so no setting of
them can change any outcome. That is a grep, and it is stronger evidence than a
statistic. `leverStaticAudit.test.ts` re-proves it on every test run and fails in
**both** directions — if one of these is ever wired, the test demands the audit be
updated; if a wired lever loses its last consumer, the test says so.

| Field | Status |
| --- | --- |
| `tactics.mentality` | **DEAD** — unread |
| `tactics.backchecking` | **DEAD** — unread |
| `tactics.tempoStyle` | **DEAD** — unread |
| `tactics.breakout` | **DEAD** — unread |
| `tactics.nzOffensive` | **DEAD** — unread |
| `tactics.nzDefensive` | **DEAD** — unread |
| `tactics.ozEntry` | **DEAD** — unread |
| `tactics.forecheckVariant` | **DEAD** — unread |
| `tactics.dZoneStructure` | **DEAD** — unread |
| `tactics.offensiveFaceoff` | **DEAD** — unread |
| `tactics.defensiveFaceoff` | **DEAD** — unread |
| `tactics.shotTargeting` | **DEAD** — unread |
| `tactics.personalTactics` (all 5 sub-fields) | **DEAD** — unread |

Two of the `PersonalTactics` fields carried the comment **"ENGINE-WIRED"**. They
are not, and were not. That comment is exactly how a team convinces itself its
depth is real.

**Mitigating fact, and the only reason these were not already shipping the
Esports Manager defect: none of them is a GM-facing control.** No UI writes them;
the GM cannot even set team tactics today (see §6). They are labels a coach
profile writes and the staff-meeting screen displays.

**Action taken:** every one is now marked `DEAD — unread` in `src/domain/tactics.ts`
with an explicit instruction not to surface it as a control until it is wired
**and** measured. The fields are retained because saves, mods and the
coach-profile display carry them; deleting them under the 1.0 feature freeze
would break compatibility for no gain the player can see.

---

## 6. The finding that reframes the rest

**The GM cannot set team tactics directly — only argue for them.**

`setTactics` and `applyCoachSuggestion` exist in the worker protocol and in
`worker/client.ts`. **No screen calls either one.** The Tactics screen is a line
board, a depth chart, PP/PK units, a saved-setups dropdown and a *read-only*
summary of the coach's system. Every tactical value in §3 — forecheck, D-zone
coverage, pace, aggressiveness, all of it — is derived from the head coach's
profile.

The one route in is `suggestToCoach`, reachable from the Staff Meeting screen:
the GM pushes the system in a direction, the coach evaluates it against his own
beliefs and his roster, and **when he accepts, `team.tactics` really is
rewritten** (and his profile drifts toward what he agreed to, so it sticks). So
the GM's tactical levers are *which coach he hires* — priced by this audit at
+2.5 (fit) / +3.4 (PP) / +3.4 (PK) — and *what he can talk that coach into*.

This is a defensible design (it is close to how a real NHL GM works, and it is
the design memory records as deliberate), and it is *far* safer than the
alternative: **we are not shipping a wall of sliders that do nothing.** But it
changes what the §3 table means. Those levers are not "the GM's tactics that
don't work" — they are the coach's tactics, and they only run on watched games.

Line matching sits in the same bucket: coach-derived, +1.8 points, deliberately
calibrated ("worth only a point or two of win probability" — the comment in
`quickSim.ts` predates this audit and the measurement agrees with it). Real NHL
last change is worth about that. **TOO WEAK by the bar, correct by the sport.**
Left alone.

---

## 7. What was fixed, and what was left

### Fixed — a healthy scratch did not scratch

The Team screen's scratch toggle wrote `practiceState.scratched`. Reading that
list: the squad view (to draw a badge), the morale tick (to be annoyed at the
player), and the Living Ledger. **Not the lineup.** The scratched player kept his
line and played the game.

That is precisely the Esports Manager defect — a visible control that changes
nothing — and it was live in the shipping build. `prepareTeamsForDay` now calls
`enforceUserScratches()`: a scratched skater is swapped out for the best
available healthy replacement of his position group, he comes off the power play
and penalty kill too (`repairLines` only rebuilds a unit that is *illegal*, so
without that he would still have taken a PP shift), and a scratched starting
goalie hands the net to the backup. Deliberately conservative — the scratch is
only honoured when a legal replacement exists, because dressing eleven forwards
would be a worse lie than ignoring the toggle. `leverFixes.test.ts` covers all
four paths.

### Fixed — the team practice regimen reached only players who could not grow

`practiceAttributeBias` skipped anyone outside the user's **NHL** roster. §4 is
what that produced: a lever aimed exclusively at the cohort with 2.2 points of
headroom, delivering +0.07 to a composite. Meanwhile the affiliate — 11.4 points
of headroom, 2.7 overall a season of real growth — was untouched by the GM's
training decisions.

The regimen now covers the whole **pro organisation**, NHL club and AHL affiliate
both, which is also what an NHL development staff does in real life. The same
focus is worth roughly **+0.5 on its targeted composite per season** there. The
change is bounded (still no reach into junior or Europe, where only an explicit
individual plan follows a prospect) and `leverFixes.test.ts` fails without it.

### Fixed — the `passing` slider was a −66-point self-destruct button

Detailed in §3. Coach profiles set it, so it was live and costing clubs about 26
standings points a season for hiring a puck-movement coach. The frequency band
was narrowed (0.6–1.5 → 0.9–1.12), taking the full span to −16.4 points and
leaving the default byte-identical. The underlying one-sidedness — the model
charges passing's cost and pays none of its benefit — is a danger-model change
and is flagged below rather than attempted under the freeze.

### Left alone, on purpose

- **Line matching (+1.8, TOO WEAK).** Realistic. Inflating it to clear an
  arbitrary 2-point bar would be exactly the dishonesty this audit exists to
  prevent.
- **The 13 dead tactics fields.** Not GM-facing, so not yet a lie. Marked dead in
  the type, tripwired by a test, and explicitly barred from the UI until wired
  and measured. Wiring twelve tactical systems is a feature project, not an audit
  fix, and the 1.0 freeze says no new systems.
- **Team tactics being coach-owned (§6).** A design decision, not a defect.

### Flagged, not fixed — for the Gap List

1. **Freshness is worth 38 points.** Fatigue is ten times the strongest tactical
   lever. It should probably be decisive; it should probably not be *this*
   decisive. Needs a calibration pass against real NHL back-to-back and
   schedule-density splits, which is its own piece of work.
2. **A lever wired only into the full sim is off on the default path.** Anything
   in §3 is inert unless the GM watches. Either the systems should reach the
   quick sim (as `coachFit`, `ppEdge`, `pkEdge` and `lineMatching` already do), or
   the game should say plainly that tactics are a watched-game feature.
3. **Power-play and penalty-kill formation do nothing measurable.** −0.3 and −0.2
   points against a ±2.7-point floor. Of everything in the audit these are the
   two a hockey fan would most expect to matter, and the same is true of
   `shooting` (+0.1), `pace` (+0.8) and `hitting` (+0.8). They are read by the
   engine but land on a shot model that barely differentiates them. Not urgent
   while they stay coach-owned and off-screen; a blocker the day any of them
   becomes a GM control.
4. **Ice time reaches development only indirectly.** Neither dev engine takes
   TOI as an input — `combinedDevGames` counts games *dressed*, and
   `developPlayers`'s docstring still advertises a `toiPerGame` argument that no
   longer exists. Deployment does reach growth, but only through the production
   channel (a prospect in the top six out-produces expectation): measured at
   **+0.51 overall a season**, a third of what simply dressing him is worth
   (+1.46). Handing a prospect first-line minutes ought to develop him faster
   than that, and today's model can only get there by accident.

---

## 8. Legibility — the receipts

> *"A real lever with no receipt is indistinguishable from a broken one."*

### The line board now prices itself

`deploymentValue.ts` computes the **ice-time-weighted lineup rating**: every
dressed skater's overall, weighted by the share of the game his slot actually
plays, using the quick sim's own deployment weights. Move your second-best winger
up from the fourth line and the number goes up, exactly as your goal differential
does.

The conversion to standings points is **measured, not guessed** — four different
mirror rosters, 25,000 games each, dividing the observed season-point swing by
the weighted-rating gap between best-first and worst-first arrangements:

| Roster | Weighted-rating gap | Measured Δ pts/82 | Points per rating point |
| --- | ---: | ---: | ---: |
| 0 | 5.20 | 23.9 | 4.60 |
| 1 | 6.40 | 26.0 | 4.06 |
| 2 | 7.70 | 33.5 | 4.35 |
| 3 | 7.00 | 33.0 | 4.72 |
| **pooled** | | | **4.43** |

An independent contrast — the same eighteen men dressed on both benches, only the
*order* changed — pooled to **4.41** across the same four rosters, which is the
cross-check that matters: the constant is a property of the sim, not of one way
of perturbing it. `deploymentValue.test.ts` re-derives it from the live engine on
every test run, so the number on the GM's screen cannot silently drift away from
what the sim pays.

### "What this board is worth"

A strip on the Tactics screen, under the coach's system bar. It reads the club's
current state and reports, per lever, the standings points the present setup is
giving away:

```
WHAT THIS BOARD IS WORTH   ≈ 12.5 pts on the table  ⓘ     line order 78% of the best arrangement
```

— read off a real save (Frost Harbor, 25-4-1, coach-set lines, November). Hovering
opens the breakdown: line order, PP1, PK1, starting goalie, fresh legs and room
morale, each with what it currently rates, what the best available would rate, and
the standings points between them. Every span is a measured endpoint from this
audit; what the panel adds is a linear interpolation onto the club's own players,
and the tooltip says exactly that.

### The training screen says who the regimen reaches

`What this focus does` gains a fourth column: **who it reaches**. It names the
organisation (NHL club + affiliate), counts the developing players inside it, and
states their mean room to the ceiling — because §4 showed that a training
decision aimed at players with no headroom cannot do anything, however well it is
wired, and the GM had no way to know that.

### Already shipped, and the precedent for all of this

The Development screen shows season growth beside the dev-focus dropdown.

---

## 9. The tripwires

An audit is a photograph. These are the alarms.

| Test | In `npm test`? | What it catches |
| --- | --- | --- |
| `engine/audit/leverStaticAudit.test.ts` | yes | a wired lever losing its last consumer, or a dead field being wired without the audit being updated |
| `engine/audit/leverGuard.test.ts` | yes | any certified-REAL lever drifting out of its measured band (re-sims each one with real statistical power) |
| `engine/league/deploymentValue.test.ts` | yes | the line board's receipt drifting away from what the engine actually pays (it re-derives the conversion constant from the live sim) |
| `engine/league/leverReceipts.test.ts` | yes | a receipt failing to respond to the decision it is supposed to price |
| `engine/career/leverFixes.test.ts` | yes | the scratch toggle or the org-wide practice regimen regressing |
| `engine/audit/leverAudit.harness.test.ts` | no (on demand) | the full re-measurement, for when a number needs updating |
| `engine/audit/leverDev.harness.test.ts` | no (on demand) | the development table |

**If a guard fails, the lever changed. Re-run the harness and update this
document — do not widen the bound.**

---

## Summary

| Category | Count | Levers |
| --- | ---: | --- |
| **REAL — the GM's own decisions** | 8 | line assembly (+24.1) · line order alone (+10.1) · PP1 (+6.5) · PK1 (+4.9) · goalie order (+4.3) · coach PP edge (+3.4) · coach PK edge (+3.4) · coach fit (+2.5) |
| **REAL — man-management channel** | 3 | freshness (+37.9) · form (+17.5) · morale (+11.3) |
| **REAL — development** | 6 | playing prospects (+1.46 ovr/yr) · deployment (+0.51) · mentorship (+0.35) · four practice focuses (+0.3…+0.7 on the targeted composite) |
| **REAL — coach tactics (watched games only)** | 7 | forecheck (−12.4) · pass risk (+11.4) · dumping (−10.3) · gap control (+8.2) · puck pressure (+8.0) · passing (−16.4 after the fix) · aggressiveness (−3.2) |
| **TOO WEAK** | 2 | line matching (+1.8 quick / +2.5 full — correct for the sport, left alone) · D-zone coverage (−2.2) |
| **DEFECTS FOUND AND FIXED** | 3 | the healthy-scratch toggle never scratched · the practice regimen reached only players who could not grow · the `passing` slider was a live −26-point coach-hiring trap |
| **No measurable effect at this sample** | 5 | PP formation · PK formation · shooting · pace · hitting — reported as INCONCLUSIVE, never as working |
| **DEAD by inspection, documented and barred from the UI** | 13 | the unread tactics fields in §5 |

**The honest headline.** The levers a GM actually touches are real, and the
biggest of them — who plays, with whom, on which line — is worth twenty-four
standings points. The levers a GM *cannot* touch are a more mixed picture: seven
real coaching systems, five that measure as nothing, and one that measured as a
disaster and is now fixed. Nothing in this document was upgraded to make the
table look better, and three defects were found precisely because it was written
to be embarrassing if it could be.
