# The Feed v2 — a living social layer worth browsing

Design doc for review. Playtest #9: *"Nothing happens in The Feed. I wanted this
like an actual polished social media feed where you can even see your players
tweeting, and there's more interesting journalist or stat graphs created.
Something fun and interesting to browse that isn't just the GM inbox. Let's
rethink how to make this a better part of the game / world — it's also kind of
hidden right now."*

Builds on the shipped Feed A/B/C (`docs/THE-FEED.md`) and the pending epics
Feed D (#150, player/GM accounts) and Feed E (#151, draft broadcast). Nothing
here is a rewrite — it's the layer that makes the existing pipe feel alive.

## What exists today (grounding, not fiction)
- `salience.ts`: `DETECTORS` scan world state → candidate posts → `selectPosts`
  (novelty-gated) → attributed to **4 pundit accounts** (`FEED_AUTHORS`:
  @MercerHockey insider, @CarverNotes analyst, @puckmodel stats, @TheWire wire).
- `career.ts` (~3256): posts land in `feedPosts` (save-serialized `NewsItem[]`,
  capped 400); followed authors + floor-clearers also reach the inbox.
- `FeedScreen.tsx`: an **Inbox subtab** ("The Feed") with follow chips + an
  All / Media / GM Wire filter. Empty most of the time → "Quiet timeline."

**Why it feels dead:** only journalist voices, text-only, a novelty gate tuned
so quiet periods produce nothing, and it's buried one level under Inbox.

## The vision
The pulse of the hockey world on one scrollable surface — players, GMs,
journalists, and stat bots all posting, with embedded **visual cards** (stat
sparklines, mini-standings, shot dots), reactions, and the occasional thread.
Every post traces to a real event (the living-world rule). Fun to *browse*,
never an obligation — the inbox stays the guaranteed surface, the feed is the
one you dip into because it's alive.

## Four gaps → four workstreams

### 1. Voices — players and GMs post, not just pundits  *(the headline win; = Feed D #150)*
Add two author KINDS beyond the 4 pundits:
- **Players** post off their own beats, personality-flavored: first NHL goal,
  hat trick, milestone, injury return, a callup ("Dream come true 🙌"), a
  healthy-scratch gripe (only from low-loyalty/fiery types), a trade reaction
  ("Thankful for my time in {city}"), a contract signing, a playoff clincher.
  Voice varies by personality (a cocky sniper ≠ a quiet vet ≠ a rookie).
- **GMs** (incl. rivals) post PR lines: a signing announcement, a "we believe
  in this group" after a losing streak, deadline posturing, a fired-coach
  statement. Uses the existing GM-persona traits (LW2).
- Rivalry banter: two players/clubs needle each other after a chippy game.

Authoring = Hades-model variant pools keyed to personality + event, no-repeat
ledger (the content engine already exists). Optional local-LLM garnish per the
existing opt-in writer.

### 2. Density — the timeline is never dead in-season  *(lower the floor)*
Ambient low-salience content so there's always something to scroll:
- game-day reactions (a beat writer's one-liner on tonight's result),
- "on this day" from the chronicle, stat-of-the-night, milestone watch,
- fan-account chatter (unverified @handles reacting to the club's form),
- weekly power-ranking blurb, a quiet-day "slow news day" pundit joke.

Split the novelty gate: **ambient** posts clear a much lower bar (they're
allowed to be mundane), **headline** posts keep the current high bar. The
**inbox floor stays high** — density lives in the feed only, so we don't
re-flood the inbox (respects #180 and the user's "not a second inbox").

### 3. Rich media — stat graphs and cards
A post can embed a typed `card` drawn from EXISTING view data (no new sim data):
- `sparkline` — a player's last-10 points/save% trend,
- `standings` — a mini division snapshot,
- `leaderboard` — top-5 in a stat this week,
- `shotdots` — a handful of shot locations from a game,
- `headToHead` — the all-time record vs tonight's opponent (from LW1 chronicle).

@puckmodel becomes genuinely visual. New renderer piece: a `FeedCard` component
keyed by `cardType`, reusing DataHub/standings view builders. This is the
"stat graphs created" ask.

### 4. Surfacing — stop hiding it
- Promote a **"Trending" dashboard panel**: the 2–3 hottest posts (by
  salience×engagement) with a "Open The Feed →" link. The dashboard is the
  first thing seen; the feed earns a window there.
- Keep the Inbox subtab, but also make The Feed reachable from the sidebar
  (or the top ticker links into it).

## Interactivity (phase 2 — nice, not required for "alive")
- **Threads/quote-posts**: a beat writer quote-posts a player's brag with a
  skeptical take; the GM's own move gets reactions (ties to the Living Ledger —
  shop a player, watch the feed react).
- Reaction counts (already have `engagement`), the GM can like/mute accounts,
  verified badges for stars/known pundits.
- **Draft-night live broadcast** (Feed E #151): the panel reacts pick-by-pick.

## Invariants (unchanged from THE-FEED.md)
- Every post traces to a real fact/event — no hallucinated content, living-world.
- Deterministic (seeded `rngFor`), save-safe (`feedPosts` already serialized;
  new fields additive/optional). Frozen contracts additive-only.
- Authored pools + no-repeat ledger; local-LLM is optional garnish over facts,
  never the source of truth.
- The feed never gates Continue and never obligates the inbox.

## Proposed build order (one slice at a time, each shippable + verified in-app)
1. **FEED-V2-1 Voices** — player + GM author kinds + personality-flavored
   post detectors. Biggest visible change; makes the timeline feel human.
2. **FEED-V2-2 Density** — ambient detectors + split novelty gate; the feed is
   alive every game day. Verify: no inbox re-flood.
3. **FEED-V2-3 Cards** — `FeedCard` renderer + `sparkline`/`standings`/
   `leaderboard` card posts from existing view data.
4. **FEED-V2-4 Surfacing** — dashboard Trending panel + sidebar/ticker entry.
5. **FEED-V2-5 Interactivity** — threads/reactions/mute (optional).
6. **FEED-V2-6 Draft broadcast** (#151).

## Open questions for the user
- **Scope of player voices**: all players, or only your club + notable names
  league-wide? (Recommend: your club always + league stars, to avoid noise.)
- **Tone**: how real-social should it read — emoji, hashtags, snark — vs
  buttoned-up? (Recommend: real-social but tasteful; personality-scaled.)
- **Surfacing**: dashboard panel + Inbox subtab enough, or a full top-level
  Feed screen in the sidebar?
- **Start slice**: FEED-V2-1 (voices) is the recommended first build — it's the
  single change that most makes it "fun to browse."
