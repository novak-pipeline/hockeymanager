# The writing pass — playtest 2026-08-26, section A

> *"Maybe we need a thorough dedicated agent just for all of the writing of
> things in the game and also to make them more unique and not repetitive.
> Priority being logic though."*

Logic first, then repetition, then tone. Everything below is measured by
`src/engine/story/proseAudit.harness.test.ts`, which sims four seasons, collects
**every** string the game writes to the player, and counts what repeats. Run it:

```bash
PA_RUN=1 PA_SEASONS=4 PA_TAG=mytag npx vitest run src/engine/story/proseAudit.harness.test.ts --no-file-parallelism
```

Reports land in `docs/autopilot/prose-audit-<tag>.md`. The before/after pair used
here is `prose-audit-before.md` / `prose-audit-after.md` (vanilla league, seed 2029).

---

## The headline numbers

| measure | before | after |
|---|---:|---:|
| distinct sentence skeletons (names/numbers masked) | 1,018 | **1,120** |
| repetition index (sentences per distinct skeleton) | 9.90 | **9.50** |
| **most-repeated single sentence** | **713** | **94** |
| inbox items tagged BREAKING (4 seasons) | 21 (5/season) | **8 (2/season)** |
| …of which were social posts | 9 | **0** |
| inbox items that are pure speculation | many | **0** (structurally impossible) |
| `intrigue` | 1 | **0** |

The repetition index moves only a little because its tail is dominated by lines
that *should* be identical — power-rankings table rows, score lines, contract
receipts. The number that matters is the peak: one sentence used to be 7% of
everything the game said. It is now 0.9%.

---

## A2 — the season review that fired before the season (LOGIC)

**Root cause.** Every new career starts at the **summer takeover**
(`Career.startAtOffseason`): the day after a draft, in the offseason, with an
untouched 0-0-0 league. Advancing walks `resign → freeAgency → preseason`, and
`checkPreseasonStage` fires the season review on entering `preseason`. So the
review ran before a puck had dropped, over empty standings — hence
*"over-delivered on every expectation … finish at 0-0-0 (0 pts, 15th of 32) …
they've beaten that projection by 3 spots."* Every clause false.

**Fix.** `checkPreseasonStage(state, seasonWasPlayed)` — the argument is
required, not optional, so no caller can forget it. When it is skipped the
`seasonReviewFired` flag stays down, so the review still lands at the end of the
first *real* season. `Career.seasonWasPlayed()` reads the standings, which
`startNewSeason` resets, so it is scoped to the live season by construction.

**Tests.** `pressSchedule.test.ts` (unit, both directions) and
`seasonReviewGate.career.test.ts` — which walks a real career from the takeover
to opening night and asserts nothing on the way claims a record, a finish or a
verdict. Verified failing before the fix.

### The sweep — same class, same rule

*A beautiful sentence about a fact that is not true is worse than a plain one.*

- **`expectationBlurb` / `overPerforming` / `underPerforming`** graded a season
  against its projection off a standings position. At 0-0-0 the league is sorted
  by tiebreak alone, and after four games it is noise. Now three registers,
  keyed to what the standings can actually support: **no games** → a
  forward-looking statement of the bar; **under 12 games** → hedged, the
  projection named but the gap not scored; **a real book** → the arithmetic, as
  before. Games played is *derived* from W-L-OTL rather than passed in, so no
  caller can re-open the hole.
- **Preseason power rankings** printed `0–0–0 (0 pts)` beside all thirty-two
  clubs. A projection shows an order; the record line is now dropped when
  nothing has been played.
- **Cut-day mail** printed `"…would be short of F players after this call-up.."`
  — an authored reason ending in a full stop with another appended. `oneSentence()`
  in the new `src/engine/story/prose.ts` guarantees exactly one terminator.
- **The weekly scout digest** interpolated the Scouting screen's own UI chip
  into a sentence: *"The department is out on Scouting draft class."* It now
  builds the sentence from the assignment targets in English, through an
  authored pool (it fires ~28 times a season and had one phrasing).
- **Possessives.** `{team}'s` produced *"the Crystal Bay Stingrays's best
  player"*. Half the club names in hockey end in *s*. `possessive()` plus
  `{teamPoss}` / `{namePoss}` / `{scorerPoss}` slots.

---

## A3 — long messages truncated with no way to read the rest

**Root cause, measured in a browser rather than guessed.** The inbox reading
pane is a fixed-height **column flex container**; each pane inside sets
`min-height: 100%` and `overflow: hidden`. Flex shrank each pane back to exactly
the container height (min-height clamped it there), its content ran past the
bottom, and its own `overflow: hidden` clipped it — while the scroll wrapper had
nothing to scroll, because the pane exactly filled it.

Reproduced with the real style values:

| | pane height | content height | clipped | wrapper scrollHeight / clientHeight | scrollTop after scrolling |
|---|---:|---:|:--:|---:|---:|
| before | 400 | 1044 | **yes** | 400 / 400 | **0** |
| after | 1044 | 1044 | no | 1044 / 400 | **644** |

**Fix.** `flexShrink: 0` on all four reading panes, so a pane keeps its content
height and the wrapper scrolls. The 2027 draft-class breakdown (up to ~17
bullets across four sections) now reads to the end.

---

## A4 — "the board" was doing every job

35 uses across a four-season run, concentrated in the scouting layer, where a
single prospect card could use the phrase three times in one paragraph.

The project's answer to repetition is **authored variants, not randomised
synonyms** (EXCELLENCE.md §4), so `scoutBoardNote` and the scout-report blurb
are now variant pools with real range in how the consensus is named — *the
published list, Central Scouting, the services, the industry, the public
rankings* — and each frame is a different sentence, not the same sentence with a
noun swapped.

**A view cannot use the Content Engine's ledger.** `contentEngine.selectVariant`
rolls an Rng and burns the variant in a per-save no-repeat ledger — right for a
beat that happens once at a moment in time, wrong for text a view rebuilds on
every render (the card would flicker and the save would churn). So
`prose.ts` adds `pickStable`: identical pools, identical most-specific-wins
selection, tie-broken by a **stable hash of a caller-supplied key** (a player
id, a game id). Same prospect → same sentence forever; two prospects in one
list → different sentences.

---

## A5 — the postgame write-up

**Where it lives, and why: inside the receipt card**, as a lede under the score
and directly above The Turning Point, which keeps its own labelled one-liner
unchanged.

- The receipt is already the ritual the GM stops for; a separate screen means a
  second click for something he is looking at anyway.
- The same playtest asks for the inbox to be curated by value (A8). Eighty-two
  automatic match stories a season is exactly that clutter.
- The write-up sets the scene and the turning point names the moment. They read
  as a pair only if they sit together.

**What it says.** Two sentences always — the *shape* of the game (a rally, a
collapse, a night the goalie stole it, a track meet, wire-to-wire) and the man
who actually decided it, found by walking the goals for the last lead change.
Then, occasionally, a third: a **rare beat**, detected from the event stream and
ranked rarest-first — a goaltender credited with an assist, four goals from one
man, a defenceman ending it in overtime, two shorthanded goals, three goals
inside two minutes, a goal in the opening minute, an empty-netter that closed a
one-goal game, a buzzer-beater, a 60-PIM night.

Every one of those fires **only when the stream actually contains it**, and
`matchReport.test.ts` pins both directions: it catches each, and it does not
invent one on an ordinary night. A wacky sentence is always a receipt.

**Flavour elsewhere, since it was framed as a general goal:** streak and slump
beats, the rumour mill, the scout's read on a prospect, and the head of
scouting's weekly deployment line all moved from one sentence to authored pools
in this pass.

---

## A6 — the tweets: the judgement call

**Verdict: the jokes are funny; the delivery is what grates.** Kept the humour,
cut the volume. Three things were causing it, and two are now enforced by test
so a future line cannot put them back:

1. **Stacked emoji.** `🎩🎩🎩`, `🚨🚨🚨`, `😭🙏`, `😤➡️😌`. Nobody posts like that
   but a parody of a hockey player. **Hard rule: at most one emoji per post**,
   counted as a human sees it (a base pictograph with its variation selector and
   any ZWJ-joined parts is one). Emoji across the library: **88 → 51**, over
   *more* variants than before.
2. **One emotional pitch.** Half the library reached for the crescendo — Mom and
   Dad, kid-me, pinch-me. Kept where a nineteen-year-old earns it, re-pitched
   elsewhere.
3. **Age did not carry the voice.** The user's exact note: *"a 19-year-old
   prospect and a 35-year-old captain do not post alike."* Only two pools keyed
   on age at all. **Every player pool now has a veteran register (30+)**: full
   sentences, no emoji, understatement — *"You stop counting somewhere in your
   twenties, and then a number like that turns up and you realise how long you
   have been at this."* Also enforced by test, including that a veteran line
   never wears an emoji.

The cocky sniper is still cocky and the fiery winger still subtweets. What
changed is that the volume is no longer identical on every post from every man
in the league.

---

## A7 — BREAKING, curated

Measured, the tag landed on 21 inbox items over four seasons — and **nine were
social posts from an analytics bot**, tagged solely because that story *pattern*
was firing for the first time in the save. Early in a save every pattern is
firing for the first time: `rare` is a novelty flag that was doing duty as an
importance flag. `@puckmodel · BREAKING` was the tell.

Two rules:

- **A social post is never breaking news.** A tweet is a reaction; the report is
  the story.
- **Novelty is not magnitude.** `rare` no longer qualifies on its own.

The bar moved to **85**, where the game's hand-authored tentpoles actually sit:
an all-time record broken (95), a playoff berth clinched (90), deadline day
(88), elimination and the blockbuster trade column (85). Five or six a season,
which is what the word should mean.

Admission and the tag are now **separate concepts** — `feedStoryReachesInbox`
keeps the old, lower bar so a big Feed story still crosses the desk; it just
arrives unbolded. Result: **21 → 8** tagged, **0** of them posts.

---

## A8 — the inbox, curated by value

The cited offenders were *"expiring deal adds intrigue"* and *"closing in on a
milestone"*. They share a property worth naming as a rule:

> **The inbox reports what happened. The Feed speculates about what might.**

A beat that says something *may* happen — a rumour spawning, a milestone being
approached, chatter "intensifying" — never earns desk space, whoever it is
about. The milestone itself will arrive, and so will the trade.

**Tagged at the site the beat is written, not sniffed out of the prose.** The
old curation matched headlines against `/point streak|on fire|closing in on/`.
That works exactly until a writer adds a second way of saying it — which this
pass does, everywhere — and then a whole class of chatter silently reappears on
the GM's desk. `NewsItem.reach` is now a structural tag:

| `reach` | meaning |
|---|---|
| `'ambient'` | speculation — never the inbox |
| `'ownClub'` | real league colour (a heater, a slump) — mail only when it is **your** man |
| absent | ordinary front-office mail |

The harness asserts the outcome: **0** ambient items reach the inbox. The old
regex is kept only for beats written before the tag existed (old saves).

---

## Where the writing craft now lives

- **`src/engine/story/prose.ts`** — `oneSentence`, `prosaicList`, `possessive`,
  and `pickStable` / `renderStable` (view-safe authored selection).
- **`src/engine/story/matchReport.ts`** — the postgame write-up and its rare-beat
  detector.
- **`src/engine/story/proseAudit.harness.test.ts`** — the measurement. Before
  changing prose, run it; after, run it again and compare.

**The lesson this pass learned twice, worth writing down:** under
most-specific-wins selection, *a condition bucket that fires often must be deep*.
A single variant behind `{star: true}` won every time and became the new
repeated line at 437 uses. Five variants in that bucket took it to ~90 each.
When you add a conditioned variant, add three.

---

## Gates

- `tsc`: **203 web / 167 node** — unchanged from baseline, neither rose.
- Suite: green. (Five heavy full-sim tests time out when the machine is loaded —
  they do so on the untouched baseline too, and all pass run on their own.)
- New tests: `prose.test.ts` (16), `matchReport.test.ts` (13),
  `seasonReviewGate.career.test.ts` (2), plus range/tone/pool guards added to
  `arcs.test.ts`, `voices.test.ts`, `scoutDraftRead.test.ts`, `news.test.ts`,
  `pressSchedule.test.ts`.
