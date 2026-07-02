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

## Invariants

- Sim outcomes untouched — feed/writer are pure observers.
- Additive contracts only (protocol/views); posts likely extend NewsItem with
  optional channel/authorId/facts fields rather than a parallel store.
- Deterministic where seen by tests: template text + engagement numbers seeded;
  LLM output is cosmetic overlay persisted in the save, never asserted on.
