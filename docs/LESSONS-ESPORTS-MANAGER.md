# What killed Esports Manager 2026 — and what it tells us

Source: Steam reviews, July 2026. English reviews **Mixed (563)**, all languages
Mostly Positive (2,939). A well-liked *premise* dragged to Mixed by a small
number of failures that repeat in almost every negative review.

This matters to us because it is the closest living analogue to what we are
building: a management sim for a niche competitive sport, made by a small team,
sold to people who have thousands of hours in Football Manager. Their failures
are our risks, and several are already on our Gap List **unstarted**.

---

## The one sentence that explains the Mixed rating

> *"Our tactical decisions dont seem to have any real impact on the gameplay.
> There are many tactical options but most of them do not make any difference,
> they just feel random."*

Every other complaint is downstream of this. The user's own summary after reading
these reviews was the same: **"biggest thing seems like ensuring things that are
changed actually effect results."**

That is not a feature request. It is the whole genre. A management game is a
promise that *your decisions are the game*. Break that promise and the depth
becomes decoration — and reviewers describe it exactly that way: *"the stats are
just there for show."*

---

## The failure modes, and where we stand on each

### 1. Levers that don't move outcomes
> *"most of them do not make any difference"* · *"stats are just there for show"*
> *"I didn't sim, I watched and called every strat and nothing would change"*

**Our exposure: HIGH and UNADDRESSED.** This is task **#154 — "AUDIT P1: Sim
credibility: every visible lever real"**, still `pending` and never started. We
have a very large surface of visible levers — tactics sliders, systems, line
matching, practice focus, deployment roles, coach fit, personal tactics,
special-teams units, mentorship, roommates. If a meaningful share of them do not
measurably change results, we are shipping their exact problem.

The fix is measurement, not opinion: for each lever, sim N seasons with it at
each setting and report the delta. A lever with no measurable effect is either
wired wrong, too weak to matter, or should be cut.

### 2. Real levers the player can't SEE working
> *"no part of the tutorial shows how they actually affect the game"*
> *"there should be statistics telling us how it improves or harms the team"*
> *"please add a guide or something to how to increase form"*

A lever that works but shows no receipt is indistinguishable from a broken one.
This is the generalised form of Gap #6's "payoff receipts", of which we have
shipped exactly one instance (season growth beside the dev-focus dropdown).

### 3. Quick-sim that feels random
> *"No-name teams easily beat my team… I get unrealistic random match results.
> At this point, it doesnt feel like there is an actual AI opponent playing.
> Matches are heavily scripted or purely random."*

**Our exposure: MEDIUM.** We have a quick/full parity harness (#155) and the
engine is calibrated against real NHL data, and I recently measured the real
win-rate curve by strength gap (0 → 52.8%, +4 → 63.5%, +8 → 72.3%) which is
sane. But *feeling* random is a separate bar from *being* calibrated: upsets
need to read as explicable, not arbitrary. The postgame receipt (turning point,
three stars, coach quote) is the right instrument for this.

### 4. Unexplained systems
> *"The potential is also not explained at all — can they currently play at that
> level at their peak? Or do they need to develop into that rating?"*
> *"I have no idea what I'm doing or how my team is doing well"*

We show potential as stars. Do we ever say what a star *means*, or how a player
gets there? Our scout reports are prose-first, which helps — but the reviewer's
confusion is about the core rating model, not the flavour text.

### 5. Dead stats
> *"player form is always at 60% no matter what"* · *"You can't develop igl stats,
> so you lose all igl's in the future"*

A number that never moves is worse than no number. Ours to check: form, morale,
consistency, and whether every role/position actually develops — especially
goalies, and the specialist roles we added in #73.

### 6. The three-year cliff
> *"After 3 years game falls off."*

**We have this symptom RIGHT NOW.** Today's autopilot run: 106 pts → 93 → 86,
zero Cups, over three seasons, with the club drifting downward. That is the same
shape as the complaint. Whether the cause is development, aging, AI roster
management or cap drift, a game whose third season is worse than its first has a
dynasty problem — and dynasty is our P4 pillar.

### 7. Chores
> *"map training is unbearable… you have to manually rotate the maps your team
> trains, constantly… This needs automation immediately."*

Vindication for Gap #6's chore-ectomy: we verified our weekly training nag no
longer exists. Keep it that way. Any per-day manual upkeep is a defect.

### 8. Calendar friction
> *"I would like to see a 'select date to fast forward to option' — otherwise you
> sit there cycling through each month."*

We have Continue, +7d and "To game". A "skip to date / next event" would close
this, and it pairs with the cadence work (Gap #7).

### 9. The sim must not look stupid
> *"Four players will stack inside the same doorway… ten Roombas were released
> onto Mirage with rifles taped to them."*

Visible nonsense destroys credibility faster than bad numbers, because everyone
can see it. Relevant to the live match-day sim view (C1) — the moment we show
more of the game, we are exposed to more of this.

---

## What they got RIGHT (and we should keep)

- *"The management loop is dangerously addictive. Scout players. Negotiate
  contracts. Hire coaches, analysts, psychologists… Develop prospects."* — the
  loop itself is the draw. We have this shape.
- *"equal parts deep, hilarious, addictive, broken, realistic, and completely
  unrealistic… malbsMd becoming the IGL of an American organization and somehow
  leading them to glory."* — **cursed emergent timelines are a feature.** The
  best review in the set is someone delighting in a story the game let them
  make. That is our story-first mandate, validated.
- Reviewers forgive a lot for a good premise. They do not forgive meaningless
  decisions.

---

## The takeaway for us

Depth we cannot demonstrate is indistinguishable from depth we do not have.
Before we add another system, every existing lever should be provably real and
visibly so — task #154, which has been pending long enough to become the single
most dangerous item on our list.
