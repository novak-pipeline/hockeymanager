# Conversational negotiation — the LLM as bounded judge

Design doc (2026-07-02). Future feature, builds on docs/THE-FEED.md (fact
payloads, local writer) and the voice pipeline (whisper.cpp → local LLM →
Kokoro TTS, all local, no keys).

## The law, revised

Old law: "voice is a skin over evaluateProposal; the LLM never decides."
That keeps conversations cosmetic. Revised: **the LLM judges, the engine
decides** — your real negotiation ability moves outcomes within a band the
simulation defines.

- Engine computes the negotiation state: acceptance zone, ask, walk-away,
  patience (evaluateProposal / askTerms / GM & agent personas).
- Each user utterance is scored on a structured rubric —
  {professionalism, respect, argument_quality, cited_real_facts, tone} —
  mapped to CAPPED modifiers: rapport delta, patience drain/recovery, a
  bounded acceptance-zone nudge (±5-8% price, ±1 year term). Never more.
- The counterparty's replies are generated (persona + negotiation state +
  fact payload, so the agent cites real cap space and comparables); its
  DECISIONS are always the engine reading the scores.
- Anti-exploit: the model has no authority to accept anything. Prompt
  injection / sweet talk caps out at the modifier ceiling. Judge sees only
  transcript + rubric, outputs structured scores.

## Conduct ledger + the leak mechanic

Real GMs get fired when bad calls LEAK. Unprofessional/vulgar talk →
conduct score → negotiation dies, rapport poisoned persistently (chronicle;
the player's camp remembers forever) → personality-weighted roll: does it
leak? → insider account posts it to the Feed ("sources say talks turned
ugly", words paraphrased) → owner meeting scene (existing boardroom +
demeanor voice banks) → a pattern, or one extreme public incident = fired,
with receipts quoted back. Positive direction too: skilled, professional
handling can leak well ("camp says talks were professional; deal expected").

## Phasing

1. Text-chat negotiation first (same brain, cheaper interface); mic later —
   2-4s local latency reads naturally once it is literally a phone call.
2. Conduct/tone scoring ships day one (reliable on a ~3B model).
3. Argument-quality modifiers start conservative; widen as validated.
   Optionally offer a larger judge model (7-8B) as a quality download.

## Invariants

- All local, opt-in model download, no BYO keys.
- Engine outcomes bounded and auditable; every conversation writes a
  structured summary (scores + result) into the save, not just prose.
- Sim calibration untouched — negotiation effects flow through the same
  contract/trade systems as button-based play.

---

## SHIPPED 2026-08-27 — trade talk has memory (the authored layer)

Playtest finding: *"when receiving a counter offer in a trade it uses the same
base dialogue for 'we want this player'."* True, and worse than reported — a
trade call had **one** template per situation:

- `generateAiOffers` / `solicitOffersForPlayer`: `"{Club} are after {player} to
  shore up their {need}. On the table: …"` — third-person card prose, which the
  living phone then read *aloud*.
- `buildCounterOffer`: `"{GM}: We're close. Add {x} and you've got a deal."` —
  the same line on round one and round four, speaker-prefix and all.
- `gaugeTradeInterest`: four fixed lines, forever.
- The engine's fast-no (`"Not close. Your offer falls about 27% short…"`) —
  the single most-heard line in the game, identical every time.

### What shipped

**A negotiation is now a thread with state** (`src/engine/career/tradeThread.ts`).
Keyed on *who you are talking to* + *what you are chasing*, it remembers the
round, both sides' last positions, the direction and size of the gap, how many
times HE conceded, how many rounds you wasted, and how much patience is left.
Persisted additively on `CareerSnapshot.tradeThreads`, so a negotiation in
progress survives a reload with its rounds already spent.

**Dialogue selects on that state** (`src/engine/story/tradeTalk.ts`) using the
existing content engine — authored pools, most-specific-wins, per-save no-repeat
ledger, seeded tie-breaks. 152 authored lines across eight beats: `pitch`,
`counter`, `final`, `walk`, `cooloff`, `gauge`, `lapse`, `shortfall`. The
selection axes are `(round, persona, moved, gap, concessions, stalls, rapport,
deadline, chasingCore)` — persona is now one axis crossed with the arc, not the
only one.

**The arc has teeth.** Rounds spent *and* rounds wasted both drain patience
(`round + stalls` against a persona-derived budget of 3–6). Past it he tables a
**final offer** on a two-day clock; past that he **walks** — talks close, the
relationship takes a hit, and he refuses to pick up for a fortnight (four days
at the deadline). Dial him inside that window and he tells you so himself.

**Register changes with movement.** A concession sounds like one ("I've come
down twice now. I'm not coming down a third time"); holding firm sounds like a
man repeating himself deliberately ("You've sent me the same deal wearing a
different coat"); hardening calls out what you did.

### The law held

The model/dialogue layer never sets a sim value. Every number stays the
engine's: `evaluateProposal` owns the verdict and the shortfall, and the
`{short}` slot passes its percentage straight through. A hard blocker (no-trade
clause, cap, "nothing of substance") is still returned verbatim, because that is
a fact the GM needs to read literally.

### Spoken, not narrated

Every line is first person with no speaker prefix, because `PhoneCallOverlay`
reads `offer.message` aloud. News bodies attribute the speaker (`{GM}: "…"`) —
news is never voiced. A test enforces both.

### Measured (not "it feels better")

`tradeTalk.test.ts` runs full negotiations and counts verbatim repeats:

| negotiations in one season | spoken lines | distinct | repeat rate |
| --- | --- | --- | --- |
| 4 | 24 | 24 | 0.0% |
| 8 | 48 | 48 | 0.0% |
| 12 | 72 | 69 | 4.2% |
| 40 | 240 | 87 | 63.7% |

Within a single negotiation the repeat rate is **zero**, always — asserted over
200 threads. Past a realistic season volume the finite pools saturate, and a
separate test proves every repeat there is *forced*: a duplicate is only ever
possible once every eligible authored alternative has been spent. The old
behaviour was one line, i.e. 100% repeat from the second call onwards.
