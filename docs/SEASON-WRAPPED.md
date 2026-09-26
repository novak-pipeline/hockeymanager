# Season Wrapped

A "Spotify Wrapped" for every league year: a full-screen, swipeable deck of bold cards covering
what **you** did, what happened **around the league**, the **history** that was made, and — from
year two on — **hindsight** on your old calls ("You passed on him at #12, and he just won the
Calder"). Every past year stays browsable in the **Yearbook**, so a long save turns into a history
book. Serves EXCELLENCE.md **P4 / B4.2** ("what happened in 2029?") and **B5.2** (callbacks that
cite real history).

## When it fires, and why there

**At the close of the entry draft** — the `draft` stage of `Career.advanceOffseason`, right after
`pushDraftRecap()`.

The draft is the last act of the NHL's league year. By then the Cup has been lifted, the awards
are archived, the veterans have announced retirements and the first-overall pick has been called —
every card in the catalogue is settled. Nothing has rolled over yet: `this.totals`/`this.gp` still
hold the season (p.stats is only written at rollover), the bracket is still on the Career, the
standings are final. Firing any earlier (after the Final) would miss the draft and retirements;
firing later (July 1) would mix next season's free agency into this season's story.

It's an **event, not a nag**: the shell plays it once over whatever screen you're on
(`WrappedHost` in App.tsx), you can skip at any card, and it never blocks the sim. Closing it
marks the year seen; it's then replayable from **Competitions → Yearbook**. It holds while a
match is being watched. A takeover summer (a new career that starts in the offseason) or a season
with no games produces nothing.

## The deck

`cover` → YOUR YEAR → THE LEAGUE'S YEAR → HISTORY → HINDSIGHT → `outro`.

- **No filler.** A card exists only when its trigger fires. A quiet year is 3–5 cards; a big one
  is capped at **14 content cards** (cover/outro not counted), trimmed by salience (`weight`),
  then re-ordered for the reveal. At most **3 hindsight cards**, one per kind.
- **Numbers as prose.** The big number lives on the card (`hero`, `stats`); the body says what it
  meant, in a hockey writer's voice. Picks are said aloud ("two first-round picks and a 2027
  second-round pick"), small numbers are words ("twenty-one seasons").
- **Copy** lives in `src/engine/story/wrappedCopy.ts` — authored pools (Hades model), selected by
  `pickStable` keyed on `year:kind:subject`. Same subject → same line on every reopen; different
  subjects/years → different lines. No Rng, no ledger writes. Siblings are authored at equal
  specificity (see project_content-pool-craft).

### Card catalogue

| Card | Section | Fires when |
|---|---|---|
| `cover` | — | Always (season played). Club, record, finish. |
| `yourRun` | You | Always. Series-by-series run or how far from the cut line; framed against the September forecast (`expectedRankOf`). A Cup win is the climax here (`CHAMPIONS`). |
| `yourMvp` | You | Top skater ≥ 35 pts (20+ GP), or a starter goalie who won the Vezina/Hart or carried a weak offence. Share-of-goals words only when ≥ 30%. |
| `yourBreakout` | You | A (non-MVP) skater up ≥ 15 pts on last season to ≥ 35, or a rookie ≤ 23 with ≥ 28 pts. |
| `yourStat` | You | The single most telling club number: 7+ shutouts, 5+ twenty-goal scorers, a one-man offence, +45 GD (top 3), 13+ OT losses, rookies ≥ 20% of scoring, or −45 GD. |
| `yourTrade` | You | Your biggest deal since the last wrap, magnitude ≥ 14 — graded "how it looks now": player-for-player won/lost/even (±15 pts), futures-for-a-player (buyHit ≥ 40 / buy), player-for-futures (sell), picks-for-picks (early). |
| `yourSigning` | You | A new signing (30+ GP) who delivered: ≥ $6M and 55+ production, or < $4M and 35+ (best per dollar). |
| `yourWorstCall` | You | A player you traded away had a 60-pt / 30-win / award season elsewhere, else a ≥ $4.5M signing under 18 pts. |
| `champion` | League | A champion exists and it isn't you. **Sourced from `playoffs.championTeamId`** — never inferred. Favourite / longshot / sweep variants. |
| `upset` | League | Biggest series win by a team ≥ 14 standings points worse (not your series). |
| `awards` | League | Awards archived for the year (Hart, Art Ross, Richard, Norris, Calder, Vezina). |
| `recordBroken` | League | A single-season record changed hands this year, against a book with marks from ≥ 5 different years. |
| `milestones` | League | A major career milestone (500 G, 1,000 PTS, 1,000 GP, 50 SO — and round steps beyond) anywhere, or a big round number for one of yours. Computed as career − this season → career. |
| `firstOverall` | League | The #1 pick (lottery-jump variant; your own first pick beneath). |
| `leagueBreakout` | League | A non-user skater up ≥ 28 pts to ≥ 60 (veteran "turned back the clock" variant at 31+). |
| `leagueTrade` | League | Biggest non-user deal moving a 76+ player; "the trade that won a Cup" if the buyer won. |
| `coachingCarousel` | League | ≥ 2 firings/GM changes (or one touching you or the champion) — **consumed** from chronicle `coachFired`/`gmChange` events when the pressure system writes them; silently absent otherwise. |
| `retirements` | League | A retiree with 450+ pts, 800+ GP, 14+ seasons, or a 450-GP / 40-SO goalie. |
| `dynasty` | History | Champion repeats (back-to-back, three-peat) or has 3 titles in 6 years. |
| `droughtEnded` | History | Champion's previous title was ≥ 15 years ago in the record book. |
| `franchiseFirst` | History | Champion has never won in a record book ≥ 15 seasons deep. |
| `historySince` | History | First 60-goal / 130-point / 90-assist season in ≥ 4 years (≥ 8 for a 50-goal season), or ever in ≥ 10 years of records. |
| `hindsightDraft` | Hindsight | One of your round-1/2 picks from ≥ 2 drafts ago vs. the best player taken after him: *passed* (he has ≥ 1.8× + 25 of your pick's points, or won an award this year) or *steal* (your pick outscored ≥ 70% of those taken ahead of him). |
| `hindsightTrade` | Hindsight | A past deal (≤ 6 years, ≥ 1 full season) re-graded on what each side has produced **for the receiving club** since, including what traded picks became (`pickBecame`). Needs a ≥ 30 gap and ≥ 40 on the winning side; a deal is never "won" against picks that are unused or now ≤ 21 until the fourth summer. |
| `hindsightScout` | Hindsight | A scouting call written down at the draft (≥ 3 years old) vs. the player now: *bust called* (low ceiling on a top-15 pick you passed on, now a bust), *star called*, *star missed*, *undersold*. |
| `hindsightWalked` | Hindsight | A player on your org at last year's wrap signed elsewhere last summer: 55+ production/award (regret) or a ≥ $5M flop (relief). |
| `outro` | — | Always. Finish, playoffs, MVP, top pick, champion. |

A hindsight story is told **once per save** (`WrappedState.told` holds its subject, e.g.
`draft:<yourPick>:<laterPick>`); a new award makes a new subject, so "he just won the Hart" can
return in a later year, but the plain regret never repeats.

## Data sources (all settled at the wrap point)

- Standings, bracket, champion: `this.standings`, `this.playoffs` (the champion bug below is why
  this matters).
- Season lines: `this.totals` / `this.gp` / `goalieWins` / `shutouts` (NHL tier). Last season from
  `p.stats` (season Y−1, non-AHL), falling back to imported `careerHistory` for Y−1.
- Awards: `recordsState.awards` for the year (the canonical archive).
- Records / history: `recordsState.singleSeason` boards and `recordsState.seasons` (seeded
  fictional history, or real imported history on a mod DB — e.g. "The Senators had not won since
  1927").
- Draft, trades, signings, retirements, coaching changes: chronicle events **since the last wrap**
  (`WrappedState.cursor` = chronicle counter at the previous build).
- Hindsight: chronicle draftPick/trade events + `pickBecame` + provenance (the lookups that used to
  sit uncalled), `careerTotalsOf`, and Wrapped's own bookkeeping (below).

## Persistence

`CareerSnapshot.wrapped?: WrappedState` (optional/additive):

```ts
interface WrappedState {
  version: 1
  years: WrappedYear[]          // every built year, oldest first (≤ 60) — rendered cards, verbatim
  pendingYear: number | null    // built, not yet watched → the renderer plays it as an event
  cursor: number                // chronicle counter at the last build
  lastRoster: string[]          // your org at the last wrap ("players you let walk")
  lastRosterYear: number | null
  scoutCalls: WrappedScoutCall[] // calls recorded at the draft, graded ≥ 3 years later (≤ 120)
  told: string[]                // hindsight subjects already told (bounded)
}
```

A `WrappedYear` stores the **rendered** cards — text plus team chips (with colours) and player
chips (with faceIds) — so a 2031 page still renders in 2045 after the players have retired and
every source table has rolled over or been pruned. `normalizeWrapped` makes any older or damaged
shape valid; a save from before Wrapped loads with an empty yearbook and its cursor at the
chronicle's end, so its first wrap covers only what follows.

Scout calls: at each wrap, for your round-1/2 picks and the top 10 overall, the scouts' ceiling
(`scoutedCeilingWith` — knowledge-limited, ≥ 35 knowledge required) and its role label are written
down with the scout who watched him most closely (best judgment in `scoutHistory`).

## Worker protocol (additive)

New request/response types only — no existing shape touched (the same pattern as every screen
added since v2):

- `{ type: 'getWrapped'; year?: number }` → `{ type: 'wrapped'; wrapped: WrappedYear | null }`
  (no year = the pending event)
- `{ type: 'getYearbook' }` → `{ type: 'yearbook'; yearbook: WrappedYearbookView }`
- `{ type: 'markWrappedSeen'; year: number }` → `{ type: 'ok' }`

New view types (`WrappedYear`, `WrappedCard`, `WrappedYearbookView`, …) live in
`src/engine/story/wrapped.ts` and are re-exported from the protocol barrel. `views.ts` gains only
the optional `CareerSnapshot.wrapped` field.

## Fixed along the way

- **Champion bug.** Every spring the `champion` tentpole press piece (`queuePressJob('champion')`,
  rendered by `pressFallback.ts` CHAMPION_* templates) was written about the *user's* club — its
  fact sheet is the user's team — whoever actually won, so the inbox said "Your club are
  champions" every year. It now only runs when the user won; other clubs' titles keep the neutral
  "X win the championship!" news item. Covered by `wrapped.career.test.ts`.
- **Retirements in the chronicle.** Notable retirements (76+ OVR, 12+ seasons, 450+ pts or 700+
  GP) now write a durable `retirement` chronicle event with the club he retired from.

## UI

- `src/renderer/components/WrappedOverlay.tsx` — `WrappedPlayer` (the deck) and `WrappedHost`
  (event + yearbook replays, mounted in the shell). Click right/left third, swipe, ←/→/Space/Enter,
  Esc. Keys are captured so Space never also advances the game. `prefers-reduced-motion`: opacity
  only, no count-up, no drag. Styles in `wrapped.css` (its own dark poster stage, painted with the
  club's colours; a navy/black primary leads with the secondary).
- `src/renderer/screens/YearbookScreen.tsx` — Competitions → Yearbook.
- Dev preview (no worker/save needed): `src/renderer/wrapped-preview.html` +
  `src/renderer/dev/` render the grid and deck from a JSON dump. Not a build input.

## Verifying

- Unit: `src/engine/story/wrapped.test.ts` (triggers, no filler, caps, champion correctness,
  hindsight, persistence). Integration: `src/engine/story/wrapped.career.test.ts` (a real season →
  the draft closes it → Wrapped with the bracket champion; press bug; save/load; old saves).
- Harness (self-skips in the suite):
  `WRAPPED_RUN=1 WRAPPED_SEASONS=3 [WRAPPED_MOD=<mod database.json>] WRAPPED_OUT=out/wrapped npx vitest run src/engine/story/wrapped.harness.test.ts --no-file-parallelism`
  — plays N autopilot seasons and dumps each year as text + JSON (+ a save). Never copy a
  real-roster DB into the repo; committed screenshots use the fictional league.
- Screenshots: `docs/graphics/wrapped/`.

## What's left

- Playoff-only stats (a Conn Smythe card) — the sim does not separate playoff totals yet.
- Per-club share of a traded player's season (the trade card shows season totals, not post-trade).
- A "share this card" export (PNG) from the deck.
- Voice: a narrated intro line on the cover would fit B5.4 once the cast is settled.
