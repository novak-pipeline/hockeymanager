# The writing pass, part two — September 2026

> *"A thorough dedicated agent just for all of the writing … more unique and not
> repetitive. Priority being LOGIC though."* · *"I don't want it to feel like it
> was written by AI."*

The August pass (docs/WRITING-PASS-2026-08-26.md) fixed the season review, the
clipped inbox pane, BREAKING, the `reach` tag and the tweets' emoji. This pass
started from the 25-season autopilot run on the real imported league — **0 logic
bugs, 351 prose findings** — and worked the same order: logic, then repetition,
then tone. The authored template writer is now the shipped prose (the local AI
writer and TTS default off), so every line below is what players read.

Credibility test applied to every line touched: would a beat writer or a real
GM say it? Anything constructed, over-corrected or too precise was rewritten.

---

## Measured: before and after

Same harness, same seed, same club, same three seasons
(`AP_RUN=1 AP_SEASONS=3 npx vitest run src/engine/career/autopilot/run.harness.test.ts --no-file-parallelism`,
imported 32-team league, Florida, seed 2029).

| measure (3 seasons) | original audit | honest audit, before | **after** |
|---|---:|---:|---:|
| flavour findings (autopilot `minor`) | 45 | 42 | **0** |
| …repetition | 33 | 33 | **0** |
| …vocabulary ("upside", "the room", "the board" ≥15/season) | 9 | 7 | **0** |
| …undramatised games | 3 | 2 | **0** |
| inbox items per season | — | 827 / 835 / 853 | **622 / 629 / 628** |
| distinct headlines per season | — | 665 / 656 / 647 | **602 / 596 / 590** |
| most-repeated headline in a season | — | 25× ("Weekly scouting digest") | **3×** |
| most-repeated headline *shape* in a season | — | 63× ("Scout report: X") | **9×** |
| coach drought/slump headlines per season | — | 61–74 | **4–8** |
| dramatic nights whose mail was a bare scoreline | — | 11 / 11 / 6 | **0 / 0 / 0** |
| "upside" / "the room" / "the board" per season | — | 83 / 27 / 22 (worst) | **14 / 3 / 11** (worst) |
| BREAKING per season | — | 2 / 3 / 4 (one deal tagged twice) | **2 / 2 / 3** |

The inbox is a quarter smaller and says more: the items that went are the ones
that said nothing (the empty meeting note, the no-news digest, a second and
third item for the same game, other clubs' slumps), and the result mail that
stayed now carries the story of the night.

The owner's 25-season run reported 351 findings with the original audit; the
re-run for this pass is three seasons (a 25-season run is ~35 minutes and was
not repeated), so the three-season numbers above are the comparison.

### The measurement itself was wrong first

Two bugs in the autopilot's flavour audit inflated what it reported. Fixed
before anything else, so the numbers above are honest:

- **Re-harvest.** `seenNewsIds` was cleared at season end, so every item still
  sitting in the inbox was counted again as the next season's prose. Season-two
  and season-three repetition counts were roughly doubled.
- **Stale box score.** `getLastBoxScore()` returns the previous game on off-days,
  and the audit keyed dramatic games by *day*: one shutout on day 16 became an
  "undramatised" night on days 17, 18 and 19. Most of the "30 dramatic games
  with no story" were this.
- "Undramatised" now means what it says: a dramatic night whose only mail is the
  bare scoreline (`isBareScoreline`). Feed handles (`@CarverNotes`) are bylines,
  not prose, and no longer count as repeated headlines.
- `AP_FLAVOUR_DUMP=<file>` writes every harvested inbox line and every judged
  game as NDJSON, so a run can be read, not just summarised.

---

## Logic

The playtest's A2/A3/A7/A8 were closed in August; I re-verified each against
the imported league rather than trusting that. A2 (no review without a season)
and A3 (long mail scrolls) hold. A7 and A8 had holes, and the run turned up a
set of the same class — *a beautiful sentence about something untrue*:

| found | what the player saw | fix |
|---|---|---|
| Match clock | "It turned on Verhaeghe's goal at **-33:-9** of the third" — in the receipt and the mail | The event contract says `t` is in-period; the receipt assumed absolute. Converts only a `t` past the period start. |
| Playoff preview | "**Florida Panthersth** Florida Panthers vs. …" in every preview | Team names were fed to `ordinal()`. |
| Promises | "Last season you told Björnfot '**He believed you completely, which is the problem…**'" | The ledger stored the narrator's outcome as "your words". Stores the GM's line. |
| Injuries | "suffered a **flu**", "suffered a **tweaked his back**", "suffered a **blocked a shot — bruised foot**" | `injuryNoun()`: engine notes become nouns ("the flu", "a back injury"). |
| Slump quotes | 30–40 a season, fired at exactly five pointless games for *every* skater — mostly stay-at-home defencemen | Only men expected to score (same 0.55 P/G bar the league's cold-spell beat uses), a drought unusual for *him* (≥8 games, longer for lower scorers), once per man per season, one a fortnight. |
| "Legendary" | Torey Krug (483 pts) "retires after a legendary career"; 14 legends in one summer | Tiered by the record: legend (1,000 pts / 500 goals), great (700 pts / 1,100 GP), the rest in the retirement round-up. HOF ledger unchanged. |
| Ceilings | "Doubts grow over **Garnet Hathaway's ceiling**" (a 33-year-old checker) | Ceiling re-reads only for players 24 and under. |
| Expectations | Washington "beating all expectations" four times in one autumn; fired on day 11 | Opens after ~12 games; hysteresis — a story opens two places past the line it closes at. |
| Hot streaks | "Finn Rinne will not cool off" nine times in a season | A new streak draws a new line (keyed by day); the extension beat — which called the player "they" — now draws from the pool too. |
| Power rankings | "…after the early going" in February; "we're just getting started" from 29th in March | Headline and lede keyed to phase (pre / early / mid / late) and to rank. The monthly "quarter-pole" piece only runs at the quarter pole. |
| Scout notes | "**High-upside** prospect — projects as a **3rd-pair D**" (a UI chip in a sentence, and a contradiction) | Scout's words, banded by the projection: "Projects as a third-pair defenceman. A useful player if not a star." |
| Trade column | "a **middle-six regular** — walks straight into the **top of the lineup**" | Where he slots follows his level. |
| Press arcs | "Marchand — 4 away from 200 career goals The dressing room is…" (a label with no full stop) | Rendered as a sentence with a lead-in. |

**A7, BREAKING.** The trade *column* carried salience 85, so one deal wore the
tag twice (the report and the column), and a swap for a middle-six forward wore
it at all. The column is commentary; it sits at 70. The announcement keeps the
tag when the deal earns it.

**A8, curation.** Tagged at the write site, per the August rule:
- A delegated meeting where nothing needed doing leaves **no mail**.
- A scouting week with no new name and no unseen card leaves **no mail**.
- A player back from a no-rust knock is squad-screen information, not mail.
- A fight is colour: it rides in the result mail, not its own item.
- Another club's 1,000th game, breakout, slow start or ended slump is `ownClub`
  reach — the Feed's story, not the GM's desk.
- Anniversaries: durable moments only (a Cup, a record, an award, a first goal,
  a series), never two inside three weeks. A routine deadline trade a year on
  is not a memory.

---

## Repetition

**Every recurring trigger the run flagged now draws from an authored pool**
(`src/engine/story/inboxBeats.ts`) through `writeBeat` (`beatWriter.ts`):
most-specific variant, the save's shared no-repeat ledger, least-recently-used
when a pool runs dry. The craft rules from August hold and are now enforced by
`inboxBeats.test.ts`: every conditioned bucket is at least three deep (the
dominance trap), the frequent triggers have 8+ at their base, every headline
names its subject, every slot is documented.

**A headline carries its content.**

Every "now" line below is copied from the after-run's inbox, not written for
this document.

| was (per season) | now |
|---|---|
| "Weekly scouting digest" ×25–35 | "Calum Ritchie heads this week's 4 scouting finds" · "Top grade for Zayne Parekh in this week's scouting" · "Busy week for the scouts: Roman Kantserov, Elias Pettersson and others" |
| "You left it to the staff" ×13–18 | "Staff meeting: Matvei Shuravin now has a development plan" · "Handled in your absence: Evan Gardner now has a development plan" |
| "Collapse: a 2-goal lead slips away" ×16 | "How did that get away? Carolina Hurricanes win 7-3" · "Led by 2, lost in extra time to Los Angeles Kings" |
| "Rough night for Akira Schmid" ×8–12 | "Washington Capitals run away with it, 6-4" · "One to forget: 7-3 to Vancouver Canucks" · "Blown out by New York Rangers: 8-5" |
| "Comeback! Down 2, your club storms back to win" | "Two points from nowhere against Toronto Maple Leafs" · "Florida Panthers climb out of a 2-goal hole against Boston Bruins" |
| "Scout report: X" ×58–72 | "Isaac Howard, 22: a middle-six forward if it comes together" · "Report filed: Marco Kasper, DET" · "Scouting Calum Ritchie, 21, of NYI" |
| "X out N games" ×24–37 | "Brady Tkachuk to miss 1 game" · "Garnet Hathaway week-to-week" · "Blow for the lineup: Radko Gudas out 15 games" |
| "Offer tabled to X" ×15–24 | "Waiting on Dennis Hildeby: 4 years, $37 million" · "Matthew Schaefer's camp has your offer" |
| "Trade offer from BUF" | "Buffalo Sabres offer Radim Mrtka for Anton Lundell" · "Los Angeles Kings want Anton Lundell" |

One more logic bug hid in the rotation itself: when a pool ran out *inside one
day* — eighteen free-agent offers on the first morning of July — every day
stamp tied and least-recently-used handed back the same first variant eighteen
times. Recency is now the ledger's position, not its date (contentEngine and
the coach's rotation both).

**The coach.** Headlines 8+ per demeanor for big wins and bad losses (were 3),
most naming the opponent or score; rotation falls back to the line said longest
ago, not the hash pick. Streak and slump headline pools doubled.

**The press.** The weekly columns ran one fixed headline per branch, so an
over-performing club read "the league's most surprising story" every Monday;
the busiest branches now have three or four equivalent headlines, and the mood
line that closes most pieces has six per mood band instead of one. A recurring
dressing-room feud escalates in its wording (simmer → hot → boiling) instead of
repeating "Tensions flare between X and Y".

**Money.** "$7.95M × 7-year deal" was a spreadsheet cell in a sentence; mail
now reads "7 years at $8 million a season", and a headline uses the deal's
rounded total ("4 years, $37 million"). One decimal at most — the owner has
objected to two-decimal figures in prose before.

**Vocabulary.** "upside" (93/season) came almost entirely from the scout note;
"the board" from the delegated-meeting headline and the UFA mail; "the room"
from the mood line in every weekly column, the match write-up and the coach
carousel. Each now has range.

---

## Undramatised games

The result mail now **is** the story. On a dramatic night — a shutout, a
one-goal game, extra time, a rout, a comeback or collapse, a rare beat — its
body carries the same write-up as the postgame receipt (A5), under the
scoreline. A comeback or collapse, a stolen game or a shelling becomes the
mail's headline. No second or third item: the story sits in the mail the GM
already opens. An ordinary 4-2 keeps its plain line. The write-up names clubs,
not ticker codes ("The Florida Panthers dug out of it", not "The FLA").

---

## Tweets (A6)

Player posts with an emoji: 46% of the library → 29%, and most of what is left
belongs to the official club accounts, which really do post like that. The
corniest lines were rewritten to how players actually post — flatter, shorter,
the snark kept ("press box popcorn is elite at least 🍿" survives; "hattys hit
different when people spent all year doubting you 😤" does not). Scope is
unchanged and correct: your club always, elsewhere only stars or a queue site
that vouched for relevance.

---

## Gates

- `npm run typecheck`: clean.
- `tsc -p tsconfig.web.json`: **200** (bar ≤202; was 202 at the start — the
  playoff-preview `ordinal()` misuse was two of them). The shared
  `node_modules` in agent worktrees lacks `lucide-react`, which adds ~30
  environment-only errors in `icons.tsx` there; they are excluded from the count
  on both sides.
- `tsc -p tsconfig.node.json`: **165** (bar ≤167).
- Suite: 2,858 passed / 1 failed — `rules.test.ts` full-sim timeout under
  parallel load (a listed heavy-sim flake); passes on its own.
- Autopilot, 3 seasons, imported league: **0 critical / 0 major / 0 minor**.
- New tests: `inboxBeats.test.ts` (pool integrity, dominance trap, 8+ bases,
  same-day rotation, injury/role/money words, the audit's bare-scoreline rule),
  `writingPass.career.test.ts` (a real season). Updated where they pinned a
  retired headline: `arcs`, `records`, `scoutCenter`, `continueLabel`, the
  milestone audit's classifier.

## Not touched, deliberately

Trade negotiation dialogue (`tradeTalk.ts`, `tradeThread.ts`), `render3d`,
icons and styling, and the frozen contracts. No sim value changed: every edit is
to words, to which words are chosen, or to whether a line reaches the inbox.

## Where it lives

- `src/engine/story/inboxBeats.ts` — the pools, and `injuryNoun`, `roleInWords`,
  `moneyWords`/`moneyTotal`.
- `src/engine/story/beatWriter.ts` — `writeBeat`, the one call an inbox beat
  makes (ledgered; `pickStable` stays for view text).
- `src/engine/story/writingPass.career.test.ts` — a real season, asserted on
  shape: the form letters are gone, no headline dominates, dramatic nights carry
  a story, the clock is never negative, slump quotes are rare, no raw notes.
- `src/engine/career/autopilot/flavorAudit.ts` — the honest audit.
