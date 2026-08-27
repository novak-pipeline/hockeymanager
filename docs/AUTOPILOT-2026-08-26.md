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

---

# ANSWERED — 2026-08-27 (same 5 seasons, same seed 2029, ceiling corrected)

## §1 is fixed. The ceiling now comes from the data.

`ModDatabase.rules.salaryCap` is a new optional field. The importer writes the
real ceiling for the season it exported (`DB_SALARY_CAP`, $104.0M for 2026-27);
the loader reads it; absent, it falls back to `DEFAULT_SALARY_CAP` ($88.0M), so
every mod written before the field existed loads exactly as it did. The
fictional league is untouched — verified by hashing the full generated league
(teams + players + schedule) on four seeds before and after: byte-identical.

The salary **floor** rode along, because it was hardcoded too. `CAP_FLOOR` was a
flat $65M — meaningless under a $104M ceiling. It is now `capFloorFor(cap)` at
73.9%, which reproduces the real NHL pairs ($95.5M/$70.6M, $104.0M/$77.1M) and
still returns exactly $65,000,000 for the fictional league's $88M.

Day one on the real database, before → after:

| | before | after |
|---|---|---|
| ceiling | $88.0M | $104.0M |
| floor | $65.0M | $76.9M |
| clubs over the ceiling | 32 of 32 | 2 of 32 |
| median club | $97.0M (**+10%**) | $97.0M (−7%) |

The two survivors are Florida ($107.5M) and Toronto ($105.8M) — the real clubs
that carry real LTIR relief, which we do not model. Both sit inside the
playtester's 5% tolerance. That is cap-pressed, not frozen.

**And the cap growth curve is sane from the corrected base.** `CAP_GROWTH` is
1.045/yr; from $104.0M that is 108.7 / 113.6 / 118.7 / 124.0 / 129.6 five years
out. It reaches today's real 2027-28 ceiling ($113.5M) one season late, which is
the right shape — the NHL's current 9%/yr is a one-off escrow catch-up, not a
rate to compound forever. Compounding off the **old** $88.0M base, the league
would not have reached today's real ceiling until 2030.

## §2 SURVIVES. The cliff is not the cap.

| season | before | after |
|---|---|---|
| 2025 | 101 pts (#8) | 96 pts (#13) |
| 2026 | 83 (#24) | 78 (#26) |
| 2027 | 77 (#26) | 78 (#26) |
| 2028 | 77 (#26) | 70 (#30) |
| 2029 | 70 (#28) | 70 (#29) |

Still monotonic, still −26 points across five years, still four straight missed
playoffs, still zero Cups. **The hypothesis in §1 was wrong.** The GM was not
forbidden — he was freed and stayed passive.

The freeing is real and measurable. Cap-blocked decisions fell from **65 of 296
(22%)** to **15 of 334 (4.5%)**, and the survivors are near-misses — "$0.4M over
the cap", "$1.4M over" — instead of a $19.5M wall. Free-agent signing *attempts*
went from 25 to 80. But the conversions barely moved: **4 → 5 trades, 5 → 7
signings** across five seasons. Given room, this GM does not use it.

So the dynasty problem is real and separate, and the candidates from §2 narrow
to three: development failing to replace aging; the draft turning 22–30 picks in
five years into nobody; or the autopilot policy being too timid to act on the
room it now has. That is the next chase, and it is a bigger one than this was.

## What the fix exposed underneath

One new `major`, and it is the same species as the old one: **"NHL roster size
29 outside 18–26"** at 2029 day 0. Under the broken ceiling the club could never
sign anybody, so the roster limit was never tested. With real cap room the GM
signs past the limit and nothing trims him back at season start. Filed
separately — it is an enforcement gap, not a regression.

Issue totals: **0 critical, 18 major, 76 minor → 0 critical, 1 major, 75 minor.**
