# The Depth Pass — offseason, contracts, free agency, trading

Design doc (2026-07-07), from direct user feedback: "camps are three presses
of a sim button; I don't like seeing a few names pop up that just say SIGN;
we need a super in-depth contract, negotiation, trade value, and trading
system. Realism and 10x more depth."

The organizing principle, borrowed from the playtest audit: **depth the sim
consumes, not depth on display.** Every mechanic below changes an outcome or
reveals information — nothing is a new screen for its own sake.

─────────────────────────────────────────────────────────────────────────────
## PART 1 — CONTRACTS & NEGOTIATION (the core system everything else uses)

Today: askTerms() computes one number, you offer salary×years, a formula
accepts or rejects. That's a vending machine. The replacement is a
**negotiation session**: a stateful, multi-round conversation with an agent
who has a personality, a memory, and a client with priorities.

### 1.1 The contract object grows
- AAV + term (exists) · **signing bonus %** (lockout/buyout-proof money —
  agents love it, owners hate it) · **performance bonuses** (ELC and 35+
  only, per CBA — games played / points / awards tiers that can overage the
  cap next year) · **NMC / NTC / modified NTC** (10-team no-trade list the
  player nominates) · **two-way / one-way** (exists) · arbitration
  eligibility & rights (exists) · UFA/RFA year math: **every contract year
  buys or eats free-agency years** — a 24-year-old signing 4 years sells
  three RFA years and one UFA year, and the price per year reflects which
  side of that line it's on. This one rule creates the real NHL contract
  landscape (bridge deals vs. buying UFA years long).

### 1.2 The agent
Every player gets an agent (generated; star agents rep multiple players —
negotiating with one affects your relationship with his whole book):
- **Persona axes**: combative ↔ collaborative, patient ↔ deadline-squeezer,
  media-leaker ↔ discreet, comparable-obsessed ↔ fit-focused.
- **Relationship score with your club** (persistent, chronicled): lowball a
  client and his next client's ask opens 8% higher; treat one fairly at
  arbitration and the next negotiation opens warm.
- Agents **leak to the feed** (persona-gated): "hearing X's camp wants 8×8."

### 1.3 The player's priorities (hidden, discoverable)
Each player weights: money · term/security · role promised (top-6/top-4/
starter) · contender status · geography/market size · loyalty · clauses.
Weights derive from personality + age + family stage. Your scouts/agent
meetings partially reveal them ("he'll take less to stay" / "he wants to be
paid like the winger he outscored"). This is what makes two identical-ovr
players sign for different money — and makes negotiation a puzzle, not a
slider.

### 1.4 The negotiation session (the screen)
A stateful multi-round exchange (persisted; resumable across days — time
pressure is real):
- **Offer builder**: salary / term / signing bonus / bonuses / clause
  checkboxes / two-way toggle. Live cap preview and future-summers preview
  ("this walks him into UFA at 27").
- **Their response is prose with content**: not "rejected" but "the term
  works; the number is two comparables short — Girard signed 6×$6.5M last
  week and my client outscored him." Comparables are REAL (queried from the
  league's actual contracts — the data exists).
- **Temperature gauge** + rounds history. Each lowball round burns patience
  (agent persona sets the fuse). Patience out = talks off for N days, or
  (RFA) arbitration filing / offer-sheet shopping; (UFA) he signs elsewhere.
- **Trades within the deal**: "drop the NTC and we'll take 500k less" —
  the engine generates genuine barter moves from the priority weights.
- **Deadline dynamics**: asks rise as July 1 approaches for UFAs-to-be;
  extensions signed in-season carry a hometown-continuity discount; camp
  holdouts for unsigned RFAs (he doesn't report — real roster hole).
- Ends in: signed · talks paused · walked. All chronicled with receipts —
  the promise ledger already knows how to quote your words back.

### 1.5 Extension windows & the calendar
- Final-year players extendable from July 1 (real rule); pending-UFA stars
  generate "extend or trade him" storylines with board/fan pressure.
- Contract news cites structure ("6×$7.5M, full NMC years 1-3, $2M signing
  bonus") — the feed's insider account exists for exactly this.

### Implementation notes
Engine: `negotiation.ts` pure module — NegotiationState {playerId, agentId,
rounds[], patience, revealed priorities}, `evaluateOffer(state, offer) ->
{verdict, prose-parts, counters}`; comparables query over league contracts;
persisted in save. The existing askTerms becomes the *opening ask*
generator. UI: NegotiationScreen (backdrop: negotiation-room.png — already
installed!) with agent face, offer builder, response feed, comparables
panel. LATER: this exact state machine is what the local-LLM voice skin
wraps (docs/NEGOTIATION-CONVERSATIONS.md) — build the engine now, the
conversation layer plugs in unchanged.

─────────────────────────────────────────────────────────────────────────────
## PART 2 — FREE AGENCY (a market, not a list)

Today: a table of names with SIGN buttons and a decides-in-days counter.
The replacement is a **market with information, competition, and phases.**

### 2.1 The FA hub (new screen replacing the FA stage panel)
- **A real table**: pos/age/overall (fogged by your scouting!)/ask/agent/
  priority hints/interest-in-you meter/rival heat. Sort, filter (position,
  age band, max ask, UFA/RFA), search. Compare any two side-by-side.
- **Shortlist** (persisted): star players you're tracking; shortlisted names
  generate agent-contact suggestions and news pings when rivals bid.
- **Interest is two-way**: each FA shows *his* interest in your club
  (role open? cap? contender? city?) — a fourth-liner's agent returns your
  call in an hour; McDavid's doesn't return it at all.

### 2.2 Bidding wars with visible fog
- AI clubs place offers over days (exists) — but now YOUR standing offers
  sit on an **Offers board** with state: leading / matched / beaten (agent
  hints: "there's a stronger number on the table from a contender").
  You never see the rival number exactly — you see temperature.
- Players decide by **priority weights**, not just money: losing a bid
  produces a REASON in the news ("chose the contender", "wanted the top-4
  role you couldn't promise") — losses teach the market.

### 2.3 Market phases (cadence law applied)
- **Day 1-3 frenzy**: hourly-feel ticker, big boards move, day-1 digest
  (exists). - **Week 2+ value market**: asks drop for the unsigned
  (leverage decay), mid-July "best available" report (task).
- **August**: compressed (one press), PTO offers become the tool —
  invite to camp, no guarantee (ties Offseason 2.0 camps).
- **In-season FA**: unsigned vets sign PTO/league-minimum through December.

### 2.4 Negotiation, not SIGN
Clicking a free agent opens the same negotiation session from Part 1 —
same agent, same priorities, same comparables — with market pressure as an
extra term (rival offers raise his floor). One system, two entrances.

─────────────────────────────────────────────────────────────────────────────
## PART 3 — TRADING (a conversation between GMs, not a form)

Today: build a package, get accept/reject + a number. The evaluator under
the hood is genuinely good (Perri values, postures, deadline dynamics,
fleece-proofing) — the depth exists and never TALKS. The replacement puts
the negotiation on top of the evaluator.

### 3.1 Counter-offers (the single biggest upgrade)
Rejections become **counters with reasoning**, generated from the same
evaluation internals: "Karlsson doesn't move for futures alone — take
Dewar out, add your 2026 1st, and we're close." The engine already knows
WHY it rejected (value gap, depth guard, untouchable, posture); expose
those reasons as generated counter-packages (choose the smallest set of
adjustments that clears the bar). 2-3 rounds of haggling per session,
GM-persona-flavored (aggressive GMs anchor hard; collaborative ones meet
in the middle).

### 3.2 Trade talk lifecycle
- **Shop a player**: list him quietly (agent-safe) or publicly (feed
  rumor) → offers arrive over the following days, quality scaling with
  posture/deadline (LW3 machinery exists — point it at user-listed
  players). Public shopping tanks the player's morale if he learns.
- **Trade block screen**: your listed players + asking prices + interest.
- **Targets**: flag any player in the league "we want him" → your AGM
  reports what it would take (runs the evaluator in reverse — a real
  trade-finder).
- **AI calls YOU with specific pitches** referencing your cap/needs and
  THEIR posture ("we're selling; your 2nd for our rental D — yes or no by
  Friday"), with expiry timers.

### 3.3 Structure depth (P4 CBA tier folded in)
- **Three-team trades** (broker takes retained salary for a pick — the
  classic). - **Conditional picks** ("2nd, becomes a 1st if they win a
  round" — conditions tracked by the chronicle and RESOLVE with news).
- **Retained salary UI** made first-class in the builder (engine exists).
- **NMC/NTC enforcement**: a full NMC blocks the deal; a modified list
  means asking the player to waive — a mini-negotiation (sweeten with an
  extension, or he says no and the news says he said no).
- **LTIR** (from P4): injured stars off the cap → deadline LTIR
  gymnastics become possible, like real contenders.

### 3.4 Trade value transparency (EHM-style, fog-aware)
A value meter per side in the builder — but computed from YOUR staff's
evaluation (scout knowledge + AGM judgment), not the engine's truth. Bad
scouting = misleading meter. Depth that respects the fog.

─────────────────────────────────────────────────────────────────────────────
## PART 4 — CAMPS (finishing Offseason 2.0 — see OFFSEASON-2.md)

Dev camp week shipped (arrival/scrimmage/wrap). Remaining, in order:
1. **Training camp = Sep 15-28** (6 beats): invites incl. **PTO tryouts
   from the FA market** → scrimmage 1 (box score) → scrimmage 2 → **two
   PLAYABLE exhibition games** (full engine, watchable, stats feed camp
   lines) → first-cuts wave (veto the coach) → cut day argued by two weeks
   of accumulated camp stats + PTO sign/release decisions.
2. **Camp battle stakes**: winners open the season with form bonuses;
   losers' morale dips; a PTO cut generates a grudge line in the chronicle.
3. **Interactivity inside beats**: per-scrimmage line assignment (who
   plays with whom = who you learn about), drill-focus pick per camp day
   (skills/systems/conditioning → small biases on what the reports reveal).

─────────────────────────────────────────────────────────────────────────────
## BUILD ORDER (each phase shippable alone)

1. **Negotiation engine + screen** (Part 1) — the keystone; FA and
   extensions both consume it. ~2 focused sessions (engine, then UI).
2. **FA hub + offers board + market phases** (Part 2) — 1-2 sessions,
   mostly UI over existing market sim + the new negotiation entrance.
3. **Trade counters + shopping + AI pitches** (Part 3.1-3.2) — 1-2
   sessions on top of evaluateProposal internals.
4. **Training camp week** (Part 4) — 1 session, pattern proven by dev camp.
5. **Structure depth** (Part 3.3: 3-team, conditionals, LTIR, NMC lists)
   — 1-2 sessions, engine-heavy.
6. **Value transparency + agent relationships + holdouts** — polish tier.

Everything additive (new optional state, new screens), nothing touches sim
calibration, and every piece feeds the feed/chronicle so the depth is also
STORY. The negotiation state machine doubles as the substrate for the
voice/LLM conversation layer later — build once, skin twice.
