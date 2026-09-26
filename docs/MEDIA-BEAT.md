# Media Beat — the club's daily outlet, honest rapport, injury disclosure, pressers that matter

Branch `media-beat`, 2026-09-26. Implements build-list items 1, 3, 4 and 5 of
`docs/MEDIA-SIMULATION-RESEARCH.md` §9 (item 2, the insider / two-phase-trade
pipeline, is deliberately out of scope). The prose system is the one described in
`docs/WRITING-PASS-2026-09.md`: authored pools + fact payloads, `pickStable` for
view text, and the shared no-repeat ledger for published pieces. No local-LLM
writer is involved, and none is needed.

## What the player sees

- **The Beat tab** on The Feed (`BeatReader.tsx`). It has a masthead (the outlet
  name and motto), a byline with the writer's handle, the market label, and "with
  you: Neutral/Friendly/Critic…" standing. Kind filters are Notebooks, Gameday,
  Grades, Mailbag, The Daily, Injuries and Features. Clicking a story opens an
  article view with a headline, dek and byline, body paragraphs, a line chart
  (forwards / defence / goalies / PP / PK / absent / chopping block), a
  **player-grade table**, or **mailbag Q&A**. A club picker reads any other
  club's lighter beat. Icons are Phosphor via `components/icons.tsx`, with no
  emoji.
- **Feed link posts**: `@DomLaraquePIT: <headline>. <tail> [read →]`. There are
  at most 2 per day, and each deep-links to the article.
- **Inbox stays curated.** At most one beat piece reaches the inbox per 7 days
  (`media.lastInboxKey`), and only pieces with an inbox weight qualify: big
  injury news, a hot-seat stage, a claim coming true or false. Decisions
  (pressers) are separate and are not limited by that budget.
- **From the beat** panel on other clubs' Team screen.
- **Presser answer cards** name the player or situation, show each answer's
  consequence in plain words, and include a delegate option.

Screenshots are in `docs/graphics/media/`: `beat-outlet-masthead.png`,
`beat-article-{notebook,gameday,grades,mailbag,feature}.png`,
`beat-other-club-light.png`, `feed-beat-link-posts.png` and
`presser-choices.png`.

## Engine layout

| Module | Role |
|---|---|
| `story/mediaCast.ts` | One beat outlet and one lead writer per club, derived from the club id (stable across saves, no saved state). The market model covers tier 1–3 (Canadian/big = 3), `boardEdge` (0.5/1/1.5), pieces per game day, how long a skid runs before a presser, and the hot-seat threshold. Market heat changes how much is written and how sharp it is, never whether it is true. |
| `story/beatDesk.ts` | Pure builders, one per piece: `buildNotebook`, `buildGameday`, `buildGrades`, `buildMoves`, `buildInjury*`, `buildMailbag`, `buildDaily`, `buildProspects`, act features, the hot seat and claims. Each takes a `DeskCtx` (outlet, key, ledger, tilt) and a facts object, and returns a `BeatArticle`. |
| `story/beatPools.ts` | All authored prose (heads, ledes, coach quotes, grade notes, closers, mailbag Q/A by topic × verdict, the Daily's "why it matters", injury, hot-seat and claim lines). |
| `story/injuryDisclosure.ts` | Official line (region + band) vs the sim's truth, with reveal / worse-than-thought / ahead-of-schedule stages. Stance is a stable function of club and injury. It never changes an injury value. |
| `story/pressQuestions.ts` | Presser topics: `playerPlans` (named player), `hotSeat` (vote of confidence), `seasonClaim`, `blowout` and `skid`. Each has options with a tone (pundit rapport) and a consequence id. |
| `story/mediaState.ts` | Saved state `CareerSnapshot.media?` (additive; old saves load with `emptyMediaState()`). It holds articles, disclosures, claims, the hot seat, notebook slot memory, mailbag memory and presser bookkeeping. |
| `career.ts` (`maybeNotebook`, `maybeGameday`, `maybeGrades`, `maybeMailbag`, `maybeDaily`, …) | Gathers facts from live sim state and schedules pieces by season act and market. |

Contracts are extended additively only: `CareerSnapshot.media?`,
`getBeat`/`beat` in the worker protocol, optional `answerPresser.optionId`, and new
view types in `views.ts`. The frozen shapes are unchanged.

## 1. The daily beat (PHN model)

Every piece is built from sim facts, and every number in the prose is a real number:

- **Practice notebook.** Covers the real lines, pairs and PP1/PP2/PK1/PK2 units,
  and who moved since the last notebook (with direction and size). The coach
  quote matches the move, and a veteran promoted from the press box does not get
  "knocking on the door". It also has the absent list in the **club's official
  words**, the chopping block (healthy scratches with games-played counts), and a
  farm player forcing the issue. Camp days have their own voice.
- **Gameday.** Records, the projected lineup, and the expected starter with his
  line. It says "expected" in the regular season, because the tandem rotation is
  decided at puck drop. "What to watch" covers injuries, a revenge game, playoff
  stakes, streaks, slumps and the opponent's top scorer.
- **Postgame grades.** Every dressed player gets a letter from the box score
  (goals, assists, +/-, shots, hits, blocks, and the engine rating at a small
  weight). Goalies are graded on save percentage against the sim's league
  average, and a goalie's note always agrees with his letter. The piece names the
  good and the bad, then points to the next game.
- **Roster moves.** Recalls, assignments, waivers and signings of the day are
  batched into one piece.
- **Injury updates.** See §3.
- **Weekly mailbag.** 3–5 fan questions, drawn only from what the state raises:
  cap room and expiring deals, the PP/PK rank, a hot farm prospect, a star on the
  third line, a streak, a rookie's first look, the team MVP, the draft slot, the
  goalie battle and the hot seat. Every answer cites a real number. The previous
  mailbag's questions sit a week out. In a thin week the mailbag runs 3
  questions rather than re-asking the same 5, and it always uses 5 different
  reader handles.
- **Morning roundup (The Daily).** Yesterday's result, the division scores (a
  game between two division rivals is one line with both gaps), and the league
  wire, each item with a "why it matters to us" line. How often it runs depends
  on the market: every 2, 3 or 4 days.
- **Prospect reports.** Farm and junior/college/Europe lines, led by the best
  point-per-game.
- **Season acts.** Camp, opener, American Thanksgiving, holiday break, deadline
  build-up, the stretch, playoffs, draft week, the July 1 tracker (signings only)
  and summer features. Tier-3 markets get more pieces per game day.
- **Lighter beat for every other club.** It is built on demand
  (`getBeat(teamId)`) from the same builders: notebook, feature and moves. It
  does no scheduling and saves no state.

## 2. Rapport that does what it says

- `pundits.tiltOf` (the thresholds match the Media Circuit standing) sets the
  **framing family** of the beat writer's pieces and weekly columns. With an ally,
  a loss reads "one loss, the larger picture is good". With a critic, it reads
  "the front office should be watching".
- **Measured conduct effect** (`applyColumnConduct`): when a critic or feud
  writer files a column after a losing week, board confidence drops by the market's
  `boardEdge`, rounded (1–2), **capped at 6 per season**. When an ally files a
  column after a winning week, fan interest rises by 1. The effect is small,
  bounded and telegraphed in the Media Circuit copy (`punditRead`), and it only
  reaches the board after a loss, so it cannot be farmed.
- **Identity collision fixed.** Sam Carver is only the Daily Gazette columnist
  (`@CarverNotes`). The `beat` press persona is now the club's own writer from
  `mediaCast` (Dom Laraque for Pittsburgh), in both `factSheet.ts` and
  `salience.ts`.
- Every promise in the copy has been checked against the code. Each clause in
  `punditRead` names an effect the engine performs.

## 3. Injury disclosure

The sim decides the injury. The club posts "a lower-body injury, week-to-week",
and the notebook and gameday repeat that official wording. Later beats close the
gap between the official line and the truth:

- **reveal**: "Rickard Rakell's injury is a charley horse, per sources";
- **worse than thought**: "'day-to-day' was optimistic: Declan Carlile still out
  after 4 games";
- **ahead of schedule**: a cautious club gets its man back before its own band;
- a national-insider scoop is reserved for stars (Vic Mercer).

The playoffs make disclosure vaguer. No sim values change.

## 4. The chronicle remembers people

The new chronicle kinds are `tradeRequest`, `shopped`, `confrontation`,
`captaincy`, `feud`, `hotSeat` (radar/recovered/fired), `voteOfConfidence`
(backed/hedged) and `claimResolved` (right/wrong). They are written where the
event happens, never age out, and feed `biography.ts` and Wrapped. The existing
kinds `retirement`, `coachFired` and `gmChange` are reused.

## 5. Pressers as real choices

- Pressers are rare (at most one per 12 days) and fire on a topic:
  - a named player, such as a star in trade talk or a man on the third line;
  - the coach on the **hot seat**, which asks for a vote of confidence;
  - the season's ambition;
  - a blowout;
  - a skid of 3, 4 or 5 games depending on the market.
- Each answer carries a tone for the pundit relationship and a consequence, which
  is applied through systems that already exist:
  - player morale and trust;
  - room morale;
  - fan interest;
  - board patience;
  - a **public claim** stored in `media.claims`.
- **Claims are quoted back.** Say "We're a playoff team" in October and in April
  the pundit who asked writes it up either way (`claimResolved`), with a rapport
  nudge.
- **Hot-seat arc**: radar → vote of confidence asked → recovered or fired. The
  vote of confidence ("backed") is a claim of its own.
- Pressers can be **skipped or delegated**. "Send the PR director" means the
  communications director takes the question: nobody is quoted, no claim is
  recorded, and nothing moves.

## Verify

```sh
# A readable dump of the Pittsburgh beat on the imported league (default 40 steps):
BEAT_RUN=1 AP_MOD_DB="K:/Hockey Game/mods/nhl-ehm/database.json" \
  npx vitest run src/engine/story/beatSample.harness.test.ts --no-file-parallelism
# BEAT_SEASON=1 plays a full season + summer and prints per-kind counts.
```

The harness prints per-kind counts, the top headline shapes and a verbatim-repeat
count (0 over 63 pieces). It also prints the lighter beat of another club, the
Feed link posts, the number of beat items in the inbox, and the Media Circuit.

Tests: `beatDesk.test.ts` (builders, grade and goalie consistency, pool truth),
`mediaBeat.career.test.ts` (career wiring, old-save load, inbox budget,
determinism), and the pundit, pressFallback, biography and salience suites.
