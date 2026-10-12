# W3 log: positioning and decision quality (logged during W2, not fixed)

These come from the owner's reel v0 notes and the W2 detector runs. They are about how the agent engine plays, so they belong to W3 (designed team plays). W2 left them alone on purpose.

## From the owner's reel v0 notes
- **D runs to the far boards.** "defenseman skating into boards on other side of play for no reason" (2-on-1). The D chooses support or a gap read with no relation to the rush.
- **Two defend one.** "two people defending one guy" (2-on-1). Coverage assignment doubles the puck carrier and leaves the second attacker open.
- **New men ignore the puck.** "three people come off the bench and ignore the guy with the puck right in front of them" (line change). Men coming on skate to their shape spots before they read the puck. W2 now brings them over the boards at their own door, so W3 should judge this again.
- **Positioning looks bad overall.** "positioning of all the players just looks bad" (save + rebound). There is no shared D-zone coverage structure, such as a box+1 or a collapse on the rebound.
- **Standing still in dangerous areas.** "too much standing still in dangerous areas". Support players arrive at a spot and stop (low-urgency support). The 0.25 s re-think with no play intent is the root cause (ROOT-CAUSES RC4).
- **Crease camping.** "he stands in the crease with the puck for so long doing nothing" (classic PP; check it on the agent engine). Carrier decisions in tight have no time-out and no "jam it / walk out" choice.
- **Looked offside.** "looked offside" (classic empty net). Check offside reads on the agent engine against the drawn blue line.

## Found by the detectors during W2
- **VT8: an on-the-fly shape change mid-ice.** An extra attacker returning, or a strength change during live play, swaps men in place: `deploySide(s, true, true)` from `beginChange` when incoming ≠ outgoing. Those men should go through the door like any other change. Seen once in 10 clips (empty net, P3 1:23).
- **VT9: framing.** The puck is on screen only 74–96% of live broadcast frames, and the carrier sits in the middle third 55–100% of the time. The camera framing lock is part of the W3 exit ("camera framing locked for this slice").
- **Stoppage time eats the period clock in the agent sim.** `now` runs through dead time. Any longer faceoff set or change therefore cuts live play and shot volume. A stricter faceoff "set" check (speed < 3 ft/s) cost about 6% of shots, so it was reverted. W3 should decide whether dead time stops the sim clock (as in the NHL) and then recalibrate once.
- **The bench is empty.** W2 deleted the standing bench rigs (they read as "too many men"). Nobody sits on the bench now, and the goal sequence's bench shot shows empty benches ("bench doesn't celebrate"). Bench life is W5 content.

## S1 intent and coverage (2026-10-12)

What shipped (W3-DESIGN item 2 and the D-zone / rush-defence part of item 3):
- **Plans** (`src/engine/agent/plans.ts`). Every skater holds a role and a job ("puck", "chase", "mark:<id>", "lane", "twoOnOne", "support", "spot", "change", "carry"), written on each frame as the additive `role` / `job` snapshot fields. Roles are re-assigned only on a trigger: the possession side, the shape (a line must be crossed by 3 ft; the strong side flips only 6 ft past the middle), the carrier or their pass receiver, the men in the pool (a change, a man taking the puck), or a man lost far from his job. A mark is held at least 1 s and only replaced by one 8 ft better; a man keeps his mark 8 ft past the radius he took it at.
- **Claims.** The carrier belongs to the presser; every other attacker is covered by at most one man. A man covering someone does not leave him to line up the carrier. The lane man collapses onto the carrier only when nobody in the slot is open.
- **D-zone roles** `DZ_SD` / `DZ_WD` (strong-side and weak-side D), `DZ_F1` / `DZ_F2` / `DZ_F3`. The man on the puck vacates the role nearest the puck. Zone coverage takes the attacker in a role's area: goal-side and tight in the house, and from the slot side of his lane further out. A spare man becomes the low support on the puck; one who has stood 1 s in front of his net picks up a free attacker.
- **Rush defence** `NZ_SD` / `NZ_WD` / `NZ_F1-3`. A lane becomes a mark, goal-side and inside of the attacker in it. With one man back on an odd-man rush, he plays the pass ("twoOnOne"), not the carrier. A pass of theirs that the defender cannot reach first is no longer chased (that was the D skating off to the far boards); he plays the receiver.
- **New men** start in the departing man's role and the shape re-plans at once. The closest man within 10 ft of their carrier takes him (from behind, onto his hip). Men skating to the bench are out of the shape.
- **Drift loops removed.** Support men pick open ice around their spot (room, plus a lane from the puck), hold it 1.2 s, move on after 0.8 s standing, and skate there with intent. The old low-urgency creep read as standing. The breakout centre and partner D move up with the puck. A loose puck behind the net is now chased round the post: two chasers pushing on the cage was a stall that froze everyone.

Detectors (stream, imported league, 480 games, seeds 7000-7479, per 60 live minutes): VT13 aimless 30.3 → 17.1; VT14 coverage 6.4 → 3.8 (doubles 0.93 → 0.81, far side 4.96 → 2.62, ignored carrier 0.53 → 0.34); VT16 crease camping 0 → 0.003; job flips 28.5 → 22.8 per player-minute. The gate in `agentSim.test.ts` (generated league): VT13 < 30, VT14 < 5, flips < 26. Viewer (5 clips): before, VT13 was red on dZoneCoverage (a D standing 11 ft off his crease with nobody near) and VT14/VT16 green; after, VT13/VT14/VT16 are green on all five.

Calibration (same 480 games): goals 3.12 → 3.10, shots 29.7 → 28.7, PP goals 0.45 → 0.43, penalties 3.76 → 3.30, hits 22.9 → 21.0 (claims stop a covering man lining up the carrier), rebound-shot share 0.061 → 0.100 (NHL band 0.035-0.110). No scalar changed.

Left for later slices:
- Rebound share is up (still in band, but further from the 0.067 target), and close-range rebound shots fail VT3's flight rule on the saveRebound / twoOnOne clips. Physical rebounds are S6; shot timing is S2.
- A designed net-front screen (on the shot line, which the sim's screen bonus rewards on every shot) was tried and pulled because it raised goals. The net-front man holds his spot until S4/S5.
- VT8 is red on the dZoneCoverage clip: three men swapped mid-ice in live play, most likely the known strength-change deploy (S3).
- The generated league scores about 2.5 goals per team-game against the NHL's 3.07, on both engines. The agent band test now samples 96 games so it measures the engine rather than the seeds; closing the gap is S9's job.
