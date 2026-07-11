# The LLM as a Personality / RP Layer (not a prose skin)

> Status: design + first vertical slice shipped (freeform reply to player concerns).
> Companion to `docs/THE-FEED.md` (which covers the *prose* use — the Feed writer).

## The one rule

The deterministic, calibrated sim is the **source of truth**. The local model
(Qwen2.5-1.5B, CPU, opt-in — see `docs/THE-FEED.md`) is a **personality and
interpretation layer wrapped around it**. It never authors a number, rating,
result, development outcome, trade value, or cap figure. If a value can affect
the save or a test, the engine owns it — always.

The model does exactly three mechanical jobs, in ascending order of ambition:

1. **PARSE** — turn the human's freeform words into a *structured intent the
   engine already understands*. Input: free text. Output: one enum value from a
   fixed, engine-supplied list (or `null`). The engine resolves it.
2. **CHOOSE IN CHARACTER** — when the engine hands it a set of *engine-validated*
   options, pick the one a given persona would pick. A nervous rookie and a proud
   veteran answer "you're a healthy scratch tonight" differently — but every
   option, and every option's consequence, is defined by the engine.
3. **AUTHOR AROUND A RESOLVED BRANCH** — once the engine has *decided* the
   outcome, the model writes the scene/dialogue. It dresses the result; it never
   decides it.

Everything below is one of these three jobs. Nothing is a fourth job.

## Why this is safe by construction

- **Enum-bounded output.** Job 1 and Job 2 match the model's output against a
  fixed list and discard anything else. A hallucination (or a prompt-injection in
  a player's message) can only ever produce a valid option id or `null` — never a
  new effect. `parseIntentChoice` returns `null` on no-match; the UI then falls
  back to the buttons rather than guessing.
- **Persist-once, never re-derive.** Anything the model produces that is shown or
  stored (a rewritten Feed post, a chosen option, an authored scene) is written
  to state **once** and read back verbatim thereafter. The sim never re-runs the
  model to reproduce a value, so determinism, saves, and tests are unaffected
  whether the model is on, off, or absent.
- **Template floor.** Every model use has a deterministic fallback (a template, a
  button, a default option). Model absent / disabled / errored ⇒ the game is
  identical minus the flavour. This is the same pattern as the Feed writer.

## Slice 1 (shipped): freeform reply to a player concern — a PARSE use

When a player raises a concern (ice-time, contract future, trade request, feud,
unhappy), the GM has always had a 3–4 button menu of response *tones*
(promise / supportive / firm / dismissive), resolved deterministically by
`applyInteractionResponse` with a promise possibly written to the ledger.

Now the GM can instead **type his reply in his own words**. The model classifies
those words into one of the *same* options, shows the GM how it read them
("Read as: *Promise a bigger role* — this goes in the book."), and on confirm
calls the **existing** `respondToInteraction(id, optionId)`. Nothing downstream
changed; the promise ledger, morale math, and escalation logic are untouched.

- Pure, tested classifier: `src/engine/story/interactionIntent.ts`
  (`buildIntentPrompt`, `parseIntentChoice`).
- UI: `ConcernCard` in `src/renderer/screens/InboxScreen.tsx` — a "✍️ Reply in
  your own words" mode, gated on the local model being enabled + ready.
- Inference runs **renderer → main over IPC** (the Web Worker can't reach the
  model), so the whole parse lives in the renderer and the worker/career stays a
  pure deterministic core.

This is the template for every future PARSE use (contract talks, press answers in
your own words, trade pitches phrased naturally, locker-room addresses).

## Roadmap — deep uses, mapped to existing engine hooks

Each item names the *engine decision that stays authoritative* and the *model
job* layered on top. None invents sim state.

### PARSE (freeform in → structured intent)
- **Contract negotiation in your own words. — SHIPPED (slice 2).** Type "five
  years, AAV around 6.5, modified no-trade" in the negotiation room → the model
  emits strict JSON, `parseOffer` clamps every field to the engine-legal range
  (salary floor/cap ceiling, 1–8 years, bonus ∈ {0,10,20,30}, valid clause), and
  the parsed numbers load into the SAME builder the GM confirms by tabling the
  offer. The DEPTH-1 engine (`evaluateRound`) decides accept/counter unchanged;
  the model never sets a number the engine trusts without the GM's confirm.
  - Pure/tested: `src/engine/story/offerParse.ts` (`buildOfferPrompt`,
    `parseOffer`, `describeOffer`). UI: `NegotiationScreen.tsx` "Draft from my
    words". Top parse risk (dollars-vs-millions, "7" vs "$7M") is handled by
    `normalizeSalary` + hard clamp + the visible confirm form.
- **Press conference free-answers.** Type your answer to a pundit's question →
  parse to the existing tone bucket the press engine scores. (Today it's buttons.)
- **Trade pitch phrasing.** "Would you move him for a first and a prospect?" →
  parse to the structured trade the AI GM evaluates via `evaluateProposal`.

### CHOOSE IN CHARACTER / AUTHOR (engine decides, persona voices)
- **Player replies with a *voice*. — SHIPPED (slice 3).** After the GM answers a
  concern, the engine resolves everything (morale delta, room ripple, whether it
  escalates to a trade demand) and returns a JSON-safe `ReactionSpec` (direction
  + personality traits + the deterministic `outcome` prose). The model authors
  ONE line of the player's spoken reply in that mood and personality; it never
  touches the delta, so two players with identical deltas can sound completely
  different while the sim stays byte-identical. Falls back to `outcome` when the
  model is off/errored.
  - `reactionSpec()` in `interactions.ts` (engine decides direction);
    `src/engine/story/reactionVoice.ts` (`buildReactionPrompt`,
    `sanitizeReactionLine`, pure/tested). The reaction rides back additively on
    the existing `respondToInteraction` `ok` response; the InboxScreen concern
    card shows the voiced reply, then Close.
- **AI-GM negotiation persona.** `LW2` gives each AI GM traits. When the trade engine
  returns "counter" with a validated counter-offer, the model chooses the *wording
  and posture* (hardball vs. collegial) from that GM's persona. The counter itself
  is engine math.
- **Variance as flavour, never as outcome.** "Personality-driven variance" means
  the *presentation* varies (a volatile star sulks visibly; a pro nods and moves
  on) over an identical deterministic delta — not that the delta changes. If we
  ever want the delta itself to vary, that variance lives in the engine's seeded
  RNG, not the model.

### AUTHOR AROUND A RESOLVED BRANCH (engine decides, model narrates)
- **Meeting scenes** (`M1` MeetingScene): the board/coach/player lines around a
  decision the engine already made (objective met? job safe?).
- **Feed / press prose** (`docs/THE-FEED.md`): already shipped.
- **Draft-night / radio dialogue** (`Feed E`, `#151`): panel banter over the pick
  the draft engine already produced.

## Guardrails checklist for any new model use

- [ ] Output is either matched against a fixed engine list or is pure display text.
- [ ] There is a deterministic fallback (template / button / default option).
- [ ] Model output that's stored is persisted once and never re-derived.
- [ ] No test asserts on model output; no sim value flows from the model.
- [ ] Runs off the main sim path (renderer/main), never inside the Web Worker sim.
