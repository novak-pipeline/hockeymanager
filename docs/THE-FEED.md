# The Feed — social layer, curation, and the local AI writer

Design doc (2026-07-02). Companion to LIVING-WORLD.md. The thesis: we already
generate the *facts* (news pipeline, chronicle, personas, analytics); this epic
changes their *form* — short-form posts from characters, curated by the player —
and adds an optional local-AI "writer" that restyles facts into prose.

## Architecture: facts → renderer

Every post is backed by a structured **fact payload** (PostFacts): event kind,
actors (playerIds/teamIds/staffIds), the numbers (salary, term, score, ranks),
chronicle references (past trades, promises, anniversaries), and the author.
Something turns facts into text:

1. **Template renderer (floor)** — instant, deterministic, ships to everyone.
   Short-form hides template seams; "Jamie Oleksiak, 2 x $5M. Vancouver." IS
   how insiders write.
2. **Local LLM writer (ceiling)** — same payload + author persona → prose.
   node-llama-cpp, ~2-3B instruct model (Qwen2.5-3B class, ~2GB quantized),
   opt-in download in Settings (the proven Kokoro-TTS pattern). All local,
   no keys (see feedback: no BYO-key). Steam AI-content disclosure required.

Writer laws:
- The LLM is a **stylist, never a source**: it may only restate payload facts.
  Validate output (names/numbers present in payload) before display; fall back
  to template text on any failure.
- Generation runs in its own process, off the sim thread, with a **daily
  budget** — only high-importance/visible posts get LLM treatment.
- Generated text is **persisted into the save** — posts read identically on
  every view and after reload; no regeneration bills.

## The salience engine — noticing what's interesting

Detection is its own subsystem (`story/salience.ts`), separate from writing.
Principle: **interesting = deviation from a recorded expectation.** Nothing is
inherently a story; a 4-point night from a star is Tuesday, from a 7th-round
fourth-liner it's news.

- **Priors ledger** (persisted at season start): media predicted ranks,
  playoff odds, scout projections, draft slot, contract size, career
  baselines, league distributions. Deviation is computable AND citable —
  "we picked them 28th in October" is what turns a stat into a story.
- **Two detector classes:**
  1. *Authored* (high precision, known collisions): revenge games,
     pick-became, broken promise near the deadline, coach vs old team,
     return-from-injury heroics, milestone/record approaches.
  2. *Statistical* (coverage of the unimagined): generic z-score machinery
     over tracked stat streams — anything in the tail (~top 1%) of the
     current league distribution fires, whoever it is. This is what catches
     the backup goalie's quiet .945 without a hand-written trigger.
- **Salience score + daily budget**: 0-100 per candidate (deviation size ×
  actor prominence × user-relevance × novelty); only the top few per day
  become posts. The rest still write to the chronicle silently — fuel for
  anniversaries, retrospectives, the redraft.
- **Novelty memory (self-tuning)**: per-save counts of how often each
  detector fires; common patterns auto-dampen, rare ones auto-boost.
  "Surprise" is defined empirically from the save's own history.
- **Arc awareness**: streaks/droughts emit into story arcs with beats
  (game 5, game 10, record watch), never one post per game.
- **Division of labor**: detection is deterministic and engine-side — the
  LLM never decides what's newsworthy (it can't see the whole league; the
  salience engine can). It only writes up the top payloads.
- **Proof harness**: sim full seasons, dump the salience log, review volume/
  coverage/detector balance; hand-built scenario tests (underdog sweep,
  rookie outburst, backup steals the net) must fire.
- **Live detector library** (`src/engine/story/salience.ts`): expectation gap,
  streak outlier, breakout skater, goalie heater, and — for season-cadence
  colour (#177) — the Art Ross scoring race, the Rocket Richard goal race, the
  Vezina race (all at player checkpoints 30/60/90/105) and the playoff race
  (4th-vs-5th cutline gap on stretch days 95/108/116). NOTE: the player
  detectors read the LIVE in-season accumulators (`this.totals`/`this.gp`) —
  the per-season `p.stats` line isn't written until the rollover archive, so
  reading it mid-season silently starved every skater/goalie detector.

## Channels & authors

- **The Feed** (public): insider accounts (existing press personas), the stats
  account (PuckMarks-style — renders WAR/xG tables from the Data Hub as graphic
  cards after July 1 / deadline / awards), beat writers, later player accounts.
- **The Wire** (GM terminal): GM personas, agents, cap chatter, waiver notices,
  "hearing X is available" (LW3 rumor mill wearing its true face). No takes.
- **Inbox** (curated): club business + decisions + followed authors + must-see.

## Curation rules

- **Follow** any author from Feed/Wire; follows persist in the save. Followed
  authors' posts land in the inbox.
- **Importance floor**: every post carries an importance score; above threshold
  it reaches the inbox regardless of follows (your player's trade demand, an
  arbitration filing, a deadline blockbuster). You can curate a cozy bubble;
  the game never lets you miss a decision.
- **Decisions never live only in the feed** — anything actionable keeps its
  inbox card / banner / sim-hold exactly as today.

## Build order

- **A. Fact snapshots + Feed foundation** — PostFacts, authors, channels,
  engagement numbers (deterministic), template renderer, Feed screen with
  channel filters. Needed regardless of AI.
- **B. Curation** — follows in save, importance scoring, inbox = decisions +
  followed + must-see.
- **C. Local writer** — llama.cpp process, opt-in model download, background
  rewrite queue + budget, payload validation, save-persisted output.
- **D. Later** — player accounts (personality/morale/promise-driven; rate-
  limited), the user's own GM account (choice-post cards the engine reacts to:
  morale/board/rivals/followers; free text cosmetic only), **radio**: feed
  posts + persona voice + Kokoro TTS = listenable shows, channel switching
  while simming. Payloads must stay rich enough to be read aloud.

## Event broadcasts — live commentary for tentpole events

The same stack applied to paused, turn-based events; the draft first (it
already gates the sim, and between-picks time hides generation latency).

- **Panel**: 2-3 personas (anchor, scouting analyst, insider) consuming fact
  payloads, rendered as a commentary stream beside the draft board.
- **Shock is computed**: |actual pick − analyst board rank| drives tone —
  reaches get gasps and insider speculation; big slides get *anticipatory*
  tension ("he's STILL on the board") generated live from board state
  before anyone picks him.
- **Analysis reuses what exists**: scout-report elevator pitch, grades,
  "Shades of" comps, boom/bust, team needs vs depth chart, pick lineage
  from the chronicle ("this pick came over in the deadline deal — this
  player is what that trade bought"). The analyst may disagree with the
  user's own scouts on air.
- **User's pick gets the full panel treatment.**
- Templates floor / LLM restyle ceiling, same as posts; with the voice
  phase this becomes the first radio broadcast (draft night, Kokoro
  voices). Framework then extends to deadline day (war room ticker),
  July 1, awards night, playoff OT.

## Invariants

- Sim outcomes untouched — feed/writer are pure observers.
- Additive contracts only (protocol/views); posts likely extend NewsItem with
  optional channel/authorId/facts fields rather than a parallel store.
- Deterministic where seen by tests: template text + engagement numbers seeded;
  LLM output is cosmetic overlay persisted in the save, never asserted on.

## Feed C — local AI writer (#149): the Steam-ready decision

The writer is **pluggable and dependency-free** (`src/engine/story/feedWriter.ts`):
every post already carries `text` (deterministic template = the FLOOR) and
`facts: PostFacts`. `buildFeedPrompt(post, author)` turns the facts + template
draft into an ironclad-grounded prompt; `localModelFeedWriter(infer)` rewrites
it in prose (the CEILING) and **falls back to the template** on empty/garbage/
error; `selectFeedWriter(config)` is **off by default**. The runtime is injected
as `infer(prompt) => Promise<string>`, so the engine + tests never import a
native module.

**Ship-on-Steam architecture (chosen):**
- **Runtime:** `node-llama-cpp` via its **prebuilt binaries** (no on-user
  compilation). electron-builder bundles the per-platform binary into the app, so
  a Steam customer never runs npm. Reconciles with the supply-chain rule
  ([[feedback_npm-supply-chain]]) by pinning the exact version and treating the
  binary as a vetted BUILD-TIME artifact, not an unpinned postinstall on the
  player's machine.
- **Model:** **Qwen2.5-1.5B-Instruct, Apache-2.0** (commercially redistributable
  — required for a paid release), GGUF Q4_K_M (~1 GB), CPU-friendly.
- **Delivery:** **download-on-demand** into `userData` (pinned URL + SHA-256),
  gitignored; the base game download stays small, only opted-in players pull the
  weights. Off by default; dev-flagged until polished (matches [[feedback_no-byo-key]]).

**Remaining native step (needs user greenlight — the one thing not done here):**
1. `npm i -E node-llama-cpp` (with `--ignore-scripts` guidance / prebuilt path).
2. A main-process adapter that loads the GGUF and exposes `infer(prompt)` →
   `selectFeedWriter({ localEnabled, infer })`. ~30 lines; no changes to
   feedWriter.ts. Then the ceiling lights up.

### Update: on by default (ships out of the box)

The local writer is **ON BY DEFAULT** (opt-OUT, not opt-in) — it's the intended
shipped experience. Safe because it always falls back to the template writer
when the model is absent, so default-on never breaks the Feed.

Model resolution (`src/main/feedModel.ts` `modelPath()`): prefer a **BUNDLED**
copy at `process.resourcesPath/models/<file>`, else a user-**downloaded** copy in
`userData/models/`. For the real out-of-the-box Steam build, ship the GGUF as a
packaging asset (electron-builder `extraResources: [{ from: 'resources/models',
to: 'models' }]`, weights gitignored) — then first launch finds it, the writer is
already on, no download, no internet. In dev (unbundled) the Settings panel shows
a Download button and the Feed falls back to templates until it's fetched.
