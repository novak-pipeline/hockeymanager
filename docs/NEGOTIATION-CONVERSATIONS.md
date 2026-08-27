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
