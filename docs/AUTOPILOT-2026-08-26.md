# Playtester run — 2026-08-26 (5 seasons, seed 2029, refreshed 2026-27 DB)

First run of the **flavour-tuned** playtester, and the first on the refreshed
database. `0 critical`, `18 major`, `76 minor`.

**Zero criticals — the crash fixes held.** No throws, no softlocks, five full
seasons played to completion. Every previous run had at least one.

---

## 1. THE CAP BASELINE IS WRONG — root cause of all 18 majors

Every major is the same finding repeating: *"over the cap: used $107.5M vs
ceiling $88.0M"*.

**The importer hardcodes `salaryCap: 88e6`** — three times, in
`src/data/modSchema.ts:1420, 1653, 1727` (and `generate.ts:713, 829`). The
refreshed database carries **real 2026-27 contracts priced against the real
$104.0M cap**. So every imported club begins roughly **$16M over a ceiling that
does not exist in reality**.

The hardcode pre-dates the refresh; the refresh *exposed* it. Under the old
2025-26 data the gap was smaller and read as ordinary cap pressure.

**This is almost certainly upstream of the decline in §2.** A club permanently
over the ceiling cannot add salary — and the autopilot made **4 trades and 5
signings in five seasons**. It may not be a passive GM; it may be a GM who is
never allowed to do anything. Stated as a hypothesis, not a conclusion: it needs
a re-run with the ceiling corrected to confirm.

---

## 2. THE FIVE-YEAR SLIDE — corrected framing

| season | record | pts | rank | result | trades | signings |
|---|---|---:|---:|---|---:|---:|
| 2025 | 48-29-5 | 101 | 8 | First Round | 0 | 0 |
| 2026 | 40-39-3 | 83 | 24 | Missed | 0 | 0 |
| 2027 | 36-41-5 | 77 | 26 | Missed | 1 | 1 |
| 2028 | 34-39-9 | 77 | 26 | Missed | 2 | 4 |
| 2029 | 31-43-8 | 70 | 28 | Missed | 1 | 0 |

**I originally called this a "third-year cliff" matching the Esports Manager
complaint. That framing was wrong and is withdrawn.** Rebuilds routinely take
three to five bad years; a club being poor for a stretch is not evidence of a
broken sim. Being bad is a legitimate outcome.

What is still worth investigating is narrower, and it is not "the club got bad":

1. **Nobody chose this.** A rebuild is a *decision* — sell veterans, bank picks,
   take the lumps. This club made **0 trades and 0 signings in its first two
   seasons** while falling from 101 points to 83. That is not a strategy being
   executed; that is a GM who did nothing. Whether he *chose* not to act or was
   *unable* to act is the actual question — and §1 (every club ~$16M over a
   phantom ceiling, so no salary can be added) is a strong candidate for the
   latter.
2. **It started as a playoff team.** 101 points and 8th in year one. A contender
   sliding to 70 points without a single deliberate sell-off is a different
   shape from a rebuild.
3. **There is no upswing inside the window.** 30 draft picks over five years and
   the curve never turns. A rebuild is only a rebuild if it *pays off* — five
   seasons may simply be too short to see it, which is a limitation of the run,
   not a finding about the game.

**The honest test is longer.** Five seasons cannot distinguish "a rebuild whose
payoff lies in year seven" from "a club that decays and never recovers". A
10-season run answers it; anything shorter is reading tea leaves.

---

---

## 2b. THE LONGER RUN SETTLES IT — there is no death spiral

A 10-season run on a **different seed (777)**, same club:

| yr | pts | lg rank | result |
|---|---:|---:|---|
| 2025 | 81 | 26 | Missed |
| 2026 | 83 | 20 | Missed |
| 2027 | 77 | 26 | Missed |
| 2028 | 72 | 28 | Missed |
| **2029** | **93** | **11** | **Conference Semifinal** |
| 2030 | 79 | 23 | Missed |
| 2031 | 71 | 28 | Missed |
| 2032 | 77 | 26 | Missed |
| 2033 | 84 | 25 | Missed |
| **2034** | **112** | **1** | First Round |

**The franchise oscillates and recovers — twice.** A four-year sag, a 93-point
playoff season, another dip, then **112 points and first overall in the league**.
That is a believable franchise arc, not a decaying one.

**The user's read was correct and my concern was wrong.** The seed-2029 slide in
§2 was seed-specific, not systemic. One seed is weak evidence — a lesson this
project has now learned three separate times, and the reason the autopilot gate
was originally cross-validated on two seeds.

What survives from §2 is only the *activity* question, and it is unchanged here:
**7 trades and 15 signings across ten seasons.** Note this run predates the
threshold fixes (the unreachable `cRank >= 20` rebuild branch and the cap-slack
filter), so it measures the OLD passive policy. Whether the fixes move it is the
open question the next run answers.

Still 0 Cups in 10 seasons — worth watching, but a club that finishes first
overall and reaches a conference final is not a broken sim.

---

## 3. FLAVOUR — the new detectors, and what they caught

The prose is **voluminous but repetitive**. Volume is not the problem; variety is.

| season | items | distinct | shapes | quiet days |
|---|---:|---:|---:|---:|
| 2025 | 744 | 571 | 229 | 36 |
| 2026 | 1080 | 803 | 310 | 48 |
| 2027 | 1102 | 827 | 331 | 45 |
| 2028 | 1154 | 858 | 354 | 38 |
| 2029 | 1140 | 835 | 335 | 41 |

**Worst offenders (2026):**
- one headline shape fired **62×**: `"X report: X X"`
- `"Weekly scouting digest"` — the *identical* headline **35×**
- `"X grow over X X ceiling"` **33×**, `"X out # games"` **30×**
- `"upside"` appears **61×** in a single season's prose; `"the room"` 28×;
  `"intrigue"` 15×
- `"You left it to the staff"` **13×**, `"You left the board to the staff"` 7×

**Undramatised games: 7 in 2025** — one-goal games that passed with no story
written at all. The sim knew the night was close; nobody said so.

**~40 silent days per season.** Not fatal on its own (an 82-game season has
gaps), but combined with the repetition it means the world speaks constantly in
the same few sentences and then says nothing for a week.

This is precisely the failure that dragged the comparable title to Mixed: not
absence of content, but content that reads the same every time.

---

## What this run says about priorities

1. **Fix the cap baseline first.** It is one constant in three files, it explains
   every major, and it may be silently strangling the whole career arc.
2. **Then re-run 5 seasons** and see whether the cliff survives. If it does, it is
   a real dynasty problem; if it flattens, §1 was the cause.
3. **The flavour work now has a scoreboard.** Headline shapes, verbatim repeats,
   watched words and undramatised games are numbers a chip can drive down, and
   this file is the before.
