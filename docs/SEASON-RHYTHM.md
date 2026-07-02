# SEASON RHYTHM & MEETINGS
### The RP spine — research-backed design (July 2026)

Companion to `LIVING-WORLD.md`. Sources: FM design-psychology research (SI/Miles
Jacobson interviews, community delegation studies, press-conference post-mortems)
+ real NHL offseason calendar + EHM/FHM mechanics + fan wishlists. Full citations
in the research transcripts; the distilled laws live here.

---

## 1. Why FM works (the laws we must not break)

1. **The "one more game" flow is sacred.** The addiction lives *between* matches
   — tweak → sim → result → new info → tweak. Every mandatory click on the
   continue path damages it. Jacobson's own rule. **Meetings live at calendar
   landmarks, never on the daily path.**
2. **FM is a storytelling engine wearing a spreadsheet costume.** "An RPG with
   more NPCs than any other RPG on the planet" (Jacobson). Players remember the
   miracle run, not the numbers. Systems exist to generate memorable anomalies.
3. **Delayed, entangled consequences.** It's rarely obvious when a decision will
   backfire — that's why they keep playing. Consequence opacity is a feature;
   *criteria* opacity is a bug (see promises, below).
4. **Regen-love** (the Ivica Strok effect): attachment = discovery (fog-of-war
   find) × investment (dev decisions) × arc length (career records, callbacks).
   Give players artifacts: milestone news, "drafted by you 12 years ago",
   retrospectives. The Chronicle (LW1) exists for this.
5. **Judgment creates narrative.** Board pressure, fan confidence, sackability
   are story generators, not punishment. A GM who can't fail is a spreadsheet
   user, not a protagonist.

## 2. Interactions: the loved/hated separator

FM's press conferences are the canonical failure — per-match frequency, no
consequence, solvable scripts, no expressiveness → universally delegated.
Board *requests* and team talks survive: rare or stake-bearing, state-dependent,
instant visible receipts. The laws:

- **Frequency ∝ consequence.** Per-match ⇒ one click max. Once-a-year ⇒ can
  afford ceremony, unique dialogue, backdrop art.
- **Player-initiated > game-imposed.** Asking the board for something you want
  beats being summoned to answer filler questions.
- **No solvable scripts.** If one answer is always right, automate it. Right
  moves must depend on readable-but-shifting state (personalities, form,
  relationships) — and occasionally still fail.
- **Bets need visible receipts.** FM promises flopped because criteria were
  invisible. Every commitment made in a meeting becomes a tracked, quantified
  objective the game reads back to you later — same room, same people.
- **The delegation test (ship-gate):** if a rational player would auto-resolve
  an interaction, don't ship it as an interaction — make it a news item.

## 3. The preseason is the flagship chapter

The user's EHM insight, confirmed by FM research: preseason is the
**maximum-agency, zero-judgment hope phase** — every plan still undefeated.
Structure: **hope → bet → test.** Planning (FA/cap/re-signs) → the board
meeting locks in the season's bet → camp battles test it → the season is the
payoff on preseason's predictions.

### The authentic beat calendar (compressed from the real NHL year)

| Beat | ~When | GM decision | Drama/news |
|---|---|---|---|
| Season ends / exit interviews | Apr | evaluation mode | firings, review news |
| Draft lottery | May | none — reshapes the plan | euphoria/despair |
| Combine | early Jun | interview list, character reads | risers/fallers |
| Awards | mid Jun | none — raises re-sign prices | finalists, winners |
| Buyout window | mid–end Jun | eat dead cap vs flexibility | "X bought out" |
| **Entry draft** | late Jun | pick vs trade; floor deals | the biggest trade weekend |
| RFA qualifying offers | end Jun | tender or walk away | non-tender shockers |
| Offer-sheet window | Jun 30 | poach rival RFAs (rare, explosive) | match-or-picks drama |
| **July 1 FA frenzy** | Jul 1–2 | the big bets, term discipline | firehose of signings |
| **Development camp** | early Jul | ELC signings; first look at picks | daily coach reports |
| Arbitration | Jul–Aug | settle vs hearing vs walk away | courthouse drama |
| August lull | Aug | lingering RFAs, captaincy | compress in-game |
| PTO season | late Aug | gamble camp spots on vets | redemption arcs |
| Rookie camp + tournament | ~Sep 10 | main-camp invites earned | "forcing his way in" |
| **Main training camp** | mid Sep | line battles, who plays preseason | camp notebooks |
| Preseason games + cut waves | late Sep | cuts in waves; **the waiver trap** | each wave is news |
| **Opening-night roster** | early Oct | final 23, cap-compliant | surprise omissions |

**The waiver trap is the crown-jewel decision** (fan-confirmed): the best 23 ≠
the safest 23 — you keep the waiver-vulnerable vet and send down the better
waiver-exempt kid, or risk losing the vet for nothing. Surface it as
first-class UI (EHM had a dedicated waiver-eligibility screen).

**Decision beats vs drama beats:** buyouts/draft/QOs/Jul-1/arbitration/PTO/cuts
= decisions. Lottery/combine/awards/rookie-tournament/dev-camp scrimmage =
drama → these are where coach/scout REPORTS flow in, not choices.

### The winning formula (fan-sourced)
EHM's decision depth + FHM's narrative coverage + the bulk-action UX neither
had. #1 EHM camp complaint: per-player manual busywork (invite one-by-one,
report one-by-one). Every camp flow needs recall-all / invite-all /
report-all / pre-vs-post-camp development summaries.

## 4. The Meeting Scene framework (what we build)

A **MeetingScene** is a first-class calendar event with:
- **Backdrop art slot** (user-supplied AI artwork per venue: boardroom, coach's
  office, draft floor, war room, rink-side at camp).
- **Cast**: named, persistent characters with portraits — owner + board,
  head coach, AGM, head scout, (LW2 gives rival GMs). They disagree with each
  other; you adjudicate. (EHM's draft-table trio of conflicting recommendations
  is the loved pattern — more of that.)
- **Agenda items**: each a real decision or negotiation, never filler.
- **Receipts**: outcomes become chronicle events (`promise` kind) with
  quantified criteria, read back at the end-of-season review — your preseason
  quotes quoted back to you.

### The annual meeting slate (rare = ceremonial; all once-a-year)
1. **Preseason board meeting** (the user's north-star example): negotiate the
   season objective (push back on the mandate, promise a playoff berth to buy
   patience on youth, request budget), set the direction. Stakes: your job's
   terms for the year.
2. **Dev-camp debrief** (July): coaches present the class — risers, red flags,
   ELC recommendations. Sets your prospect plans.
3. **Camp roster meeting / cut days** (late Sept): staged cuts with coach
   input, waiver-risk warnings, position-battle verdicts. "He's making it
   hard to cut him."
4. **Deadline war-room** (in-season, day ~55–60): staff assemble buy/sell
   options against the live market (LW3 personas/postures feed this).
5. **End-of-season review**: the receipts meeting. Objectives vs outcomes,
   promises honored or broken, board verdict — sets next year's leash.

In-season player/coach conversations stay EVENT-DRIVEN and rare (LW5 rules:
2–4/season/player, only when something happened), never on a timer.

## 5. Build order (extends the Living World epic)
- **M1** — MeetingScene engine contract + renderer (backdrop slot, cast
  portraits, agenda/choice flow, chronicle receipts) + the Preseason Board
  Meeting as the first scene.
- **M2** — Offseason → beat calendar restructure (lottery, buyouts, QOs,
  July-1 frenzy pacing, arbitration, PTOs), each beat with its decision or
  report. Bulk-action UX throughout.
- **M3** — Dev camp + rookie/main camp + cut waves + waiver-trap UI +
  camp reports (pre/post development deltas, daily coach notes).
- **M4** — End-of-season review (receipts) + deadline war-room.
