# Narrative Engine — Overhaul Epic #1 (APPROVED, with the living-world mandate)

Serves EXCELLENCE.md bars **B4.5** (no verbatim repeats), **B5.1** (5-character
test), **B5.2** (30% of beats cite the chronicle), **B5.3** (promise receipts),
**B5.5** (50 decision events), and FM-strength **F3** (receipts).

**User approval 2026-07-22, with one binding caveat:** the world must feel
ALIVE — narrative beats must trace back to *your actions*. "You put someone on
the trade block, you should expect to talk to him about it." The engine is
therefore TWO layers: Layer 0 decides **what happens and who reacts** (the
causal ecosystem); Layers 1+ decide **how it's said** (the content engine).
Random flavor with no cause is banned; the best beat is always a consequence.

## The problem, precisely

The game already has: a press content library, coach quotes, player
interactions, ambient news, the World Chronicle (permanent event memory), a
promise ledger, personalities, GM personas. The staleness the user feels is
NOT missing systems — it's that these systems (a) draw from small pools, (b)
select randomly instead of by specificity, (c) never check what you've already
seen, and (d) rarely cite memory. The LLM writer papered over none of this.

## Layer 0 — The Living Ledger (actions have witnesses)

This expands the World Chronicle (LW1) from "important events get remembered"
into a **stakeholder-indexed causal graph**. It is the ecosystem the user asked
for: the game actively assists the narrative by knowing who was affected by
what you did, and making them respond in character.

### The loop

```
GM ACTION (trade-block listing, scratch, demotion, lowball, promise,
           public criticism, waiver, trade, signing his rival, firing)
  → recorded as a WorldAction { id, kind, targets, visibility, day }
  → STAKEHOLDER SCAN: who cares?
      the player himself · his agent · his friends/linemates (dynamics graph)
      · room leaders · the coach · beat media · rival GMs · the fanbase
  → each stakeholder rolls a REACTION POLICY (personality × relationship ×
    context × visibility):
      immediate   — he's in your office before practice
      delayed     — plays flat for two weeks; agent brings it up at the table
      conditional — only if it LEAKS (quiet vs open shopping already exists)
      compounding — second offense this season escalates the response
      residue     — no scene now, but a permanent flag ("he knows he was shopped")
  → reactions are DELIVERED through Layers 1+ (a variant line, a phone call,
    or a full decision event) — always with explicit attribution: "because you…"
  → the reaction itself becomes a chronicle entry linked via causedBy,
    so callbacks can cite whole chains, not just moments.
```

### The worked example (the user's own): trade-block listing

You list a 29-year-old alternate captain:
1. **Day 0** — WorldAction recorded. Visibility = "quiet" (shopped to 3 GMs)
   or "open" (league-wide availability).
2. **Day 1–3** — rival GMs with roster need + persona-fit start calling with
   pitches (LW3 postures — now they call YOU; also closes the autopilot's
   0-trades friction gap).
3. **Day 2–5 (conditional)** — open shopping, or a leak roll on quiet
   shopping, produces the media story: "Sources: {player} available." Once it
   leaks, HE knows.
4. **The confrontation** — a decision event, personality-shaped: a proud vet
   walks into your office ("Eleven years and I find out from a reporter?");
   an unhappy player is relieved ("Between us — thank you"); a nervous kid's
   agent calls instead. Your answer sets promises/flags with due dates.
5. **Residue** — if you pull him off the block and keep him: permanent
   relationship flag `wasShopped(year)`. It resurfaces at his next
   negotiation, in his no-trade decisions, in the room if you shop him again.
6. **Every later beat cites the chain** — "their first meeting since the
   October listing" — because the graph links it all.

### Rules

- **Every named reaction traces to a cause** a player could state ("he's cold
  because I scratched him in the playoffs"). If the writers can't fill in the
  "because you…", the beat doesn't fire.
- **No omniscience**: stakeholders react only to what they'd plausibly know —
  visibility and leaks are mechanics, and secrecy is a real choice with a
  risk dial.
- **Conservation of drama**: cap concurrent open reaction-threads per club
  (~3) so consequences land as scenes, not spam; excess collapses into
  residue flags that surface later.
- **Reuse, don't rebuild**: the chronicle (LW1), ripples (LW4), dynamics
  graph, promise ledger, GM personas (LW2), and shopping/postures (LW3) all
  exist. Layer 0 is the connective tissue that makes them one ecosystem —
  a WorldAction table + stakeholder scan + reaction scheduler on top.

## The model (Hades, adapted)

One shared content engine, three consumers (news/press, interactions/quotes,
decision events):

```
trigger fires (e.g. 'losing-streak', severity 6, coach=fiery, arena=home)
  → collect eligible variants (all conditions satisfied)
  → pick MOST SPECIFIC eligible (most conditions matched), tie-break seeded
  → skip anything in the no-repeat ledger (this season)
  → fill slots: {player}, {coach}, {callback: chronicle query}
  → record use in ledger (persisted in save)
```

### Variant format (pure data — writers never touch engine code)

```ts
// src/engine/story/content/slump.ts  (one file per trigger family)
{
  id: 'slump.coach.fiery.home3',            // stable, ledger key
  trigger: 'losing-streak',
  conditions: { coachDemeanor: 'fiery', minStreak: 4, venueNext: 'home' },
  weight: 1,
  requires: ['coach'],                       // slot entities
  callback: { query: 'lastPlayoffExit', optional: true },
  speaker: 'coach',
  text: "Four straight. {coach.last} skipped the podium and sent a one-line statement instead: \"Practice is at six.\"{callback: Nobody in the room has forgotten how {cb.opponent} ended last spring, and it is starting to smell similar.}",
}
```

- `conditions` read existing sim state only (personality, standings, morale,
  rivalry heat, era, promise status, injury context). No new sim values.
- `{callback:...}` renders only when the chronicle query returns a hit —
  otherwise the sentence gracefully drops. This is how B5.2's 30% happens
  without ever inventing facts.
- The **no-repeat ledger** is a `Map<variantId, {year, day}>` on the career,
  serialized in the save. Audit script: sim 3 seasons, assert zero verbatim
  dupes in-season (a vitest gate, not a promise).

### Decision events (CK3-shaped, the 50-event library)

```ts
{
  id: 'ev.room.healthy-scratch-vet',
  trigger: { kind: 'lineup', when: 'vet 800+ GP scratched 3rd straight game' },
  scene: "{vet.name} closed the door of your office behind him. Eight hundred games, and he didn't sit down. \"Just tell me straight — am I done here, or am I in your plans? I've earned the truth either way.\"",
  options: [
    { label: "\"You're in my plans. You dress tomorrow.\"",
      effects: { promise: 'dress-within-1', vetMorale: +10 },
      callback: { inDays: 30, checks: 'promiseKept', onBroken: 'ev.room.vet-promise-broken' } },
    { label: "\"You deserve the truth: we're going younger.\"",
      effects: { vetMorale: -8, roomRespect: +6, vetAgent: 'requests-trade-quietly' } },
    { label: "\"I don't owe minutes to anyone. Door's behind you.\"",
      effects: { roomRespect: -10, coachTension: +5, mediaLeakChance: 0.4 } },
  ],
}
```

Rules: no objectively-correct option, every option costs something real, at
least one option plants a **delayed** callback. Effects map to EXISTING sim
levers (morale, promises, relationships, trade-request flags, media) — the
engine work is a thin event runner + trigger scan; the depth is in the writing.

### Tentpoles (bespoke, non-pooled)

Cup win, legend's last game, #1 overall pick, being fired, a 50-in-50 chase —
each gets ONE hand-built scene with full juice (Balatro rule). Maybe 10 total.

## Voice re-scope (B5.4)

Cut: thin ambient voicing. Keep and deepen: the diegetic phone (deadline,
agent hardball), draft night, playoff pressers. Hard rule: cast consistency —
a character keeps one voice for life (casting table keyed by personId, exists
in the voice system already).

## Writing standard — the actual bar

Every line must pass four tests: (1) **specific** — names, numbers, places, no
"the team has been struggling lately"; (2) **in-character** — a fiery coach
and an analytical coach must be distinguishable with names removed; (3)
**economical** — beat reporters write tight; (4) **consequence-aware** — text
acknowledges what the reader did/knows.

### Samples (judge these — this is the product)

*Slump, analytical coach, streak=5:*
> Five losses. {coach.last} spent eleven minutes on zone exits and never raised his voice, which the room has learned is worse. "The chances are fine. The puck management is not. That's correctable, and I expect it corrected Thursday."

*Milestone, enforcer scores rare goal, home crowd:*
> {player.last} has four goals in three years and the building reacted like it was a Cup clincher — because for him, it basically was. The bench emptied its gloves-taps; even {goalie.last} skated the length of the ice.

*Trade reaction, fan-favorite dealt at deadline, chronicle callback:*
> The return is defensible. The optics are not. {player.last} wore the letter here for six years{callback:, dragged this team to the {cb.round} in {cb.year} on a bad knee,} and the concourse tonight was rows of his jersey with nowhere to be.

*Agent hardball (phone, voiced), rapport=low:*
> "I'll save us both the dance. You lowballed my last two clients and told the press it was 'market rate.' So today the market rate is what I say it is. Call back when the number starts with a nine."

*Owner dilemma decision event (excerpt):*
> The owner's text arrives during warmups: "Sellout tonight. Media asking about {coach.last}. I'm not renewing him in April — but if you say it now, we look decisive. If it leaks later, we look cruel. Your call, and your name on it."

## Scope & sequencing (each slice ships green alone)

0. **Living Ledger**: WorldAction recording on the ~10 GM actions that matter
   most (block/shop, scratch, demote, waive, trade, sign, promise, lowball,
   public criticism, fire), stakeholder scan, reaction scheduler with the five
   policies, residue flags on relationships. Delivered through EXISTING
   surfaces first (inbox/phone/interactions) so it ships before the content
   engine and immediately makes the world feel causal. ~1–2 sessions.
1. **Engine**: variant store, condition matcher, specificity selection,
   no-repeat ledger (+ save field, additive), callback slot renderer over the
   chronicle — extended to query causal chains ("what did the GM do to X"). ~1 session.
2. **Retrofit consumers**: route existing pushNews/coach-quote/interaction
   call sites through the engine (their current strings become the seed
   'generic' variants — nothing regresses). ~1 session.
3. **Writing pass 1**: top 30 most-fired triggers to ≥8 conditioned variants
   (identified by instrumenting a 3-season autopilot run — write where players
   actually look). Several sessions; the long pole, on purpose.
4. **Decision events**: runner + first 15 events → then to 50.
5. **Voice re-scope** + tentpole scenes.
6. **Gates**: no-repeat vitest audit; callback-rate counter (≥30% where a
   chronicle hit exists); autopilot season report includes "narrative variety"
   stats.

## Non-goals

No new sim mechanics. No LLM in the default path. No new screens — this feeds
the inbox, feed, phone, and meeting surfaces that exist.
