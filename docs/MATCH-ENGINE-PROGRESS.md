# Match Engine — Progress Log

Companion to `docs/MATCH-ENGINE-PLAN.md` (the brief). What has landed, what it
measured before/after, and what is next. Branch: `play-realism`.

## Step 0 — immediate relief: no aimless backward passing (current engine)

**Rule implemented** (`src/engine/full/fullSim.ts`, `doPass` + the set plays):
- A backward pass (`isBackwardPass` in `types.ts`: more than 6 ft toward the
  passer's own net and the backward component dominant, i.e. the pass is more than
  about 110° off the attack direction) is allowed **in our own half** (breakout
  support, D-to-D regroup, reverses). **Past the red line** it is allowed only as a
  **bail-out**: a defender in stick reach and closing (`underRealPressure`) and
  no real forward/across option (receiver with room plus an open lane).
  Even then, most carriers protect the puck and keep working it, and strong
  puck handlers do this more often.
- The pass decision now reads the ice. Each option is weighted by the
  receiver's open ice (`openIceFt`), the lane clearance (`laneClearanceFt`),
  and in the zone by how much more dangerous the receiver's spot is than the
  carrier's (xG surface). Receivers are led by their velocity, and the
  back/forward test uses the led point.
- **Lane to the net → attack.** A cycle carrier with a clear corridor to the
  net (`laneToNet`: slot range, nobody within 9 ft of him and nobody in an 8-ft
  corridor) takes it. He stops passing, the playbook drives him into the slot,
  and he shoots when in tight.
- Set plays fixed: the entry "drop pass to a trailer" is gone. When a carrier is
  pressured at the line, he moves the puck **across** to the lane-mate. The
  low-to-high (point-shot beat) now happens only under pressure, and an
  unpressured low carrier attacks himself. The 2-on-1 pass must go level or
  ahead. The seam feed waits until the receiver is across, and never goes back
  to him.
- FINISH_K was re-reconciled from 0.6 to 0.53 because the average attempt is
  now more dangerous (slot drives instead of point dishes).

**Measurements** (`src/engine/full/passDirection.test.ts`, 24 seeded games;
calibration snapshot = the calibration test's 40-game set, seeds 5000+):

| metric | before | after |
|---|---|---|
| backward share of passes thrown in the offensive half | **40.5%** | **8.0%** |
| of which unpressured (no defender closing in stick reach) | 1755 / 10386 | **0** |
| backward passes during rush / entry / counter beats | 147 / 252 (58%) | **0** / 24 |
| breakaways ending in a shot (rest: lost to a backcheck/whistle) | 97.1% | 97.2% (0 passes) |
| all passes, backward share (own-half regroups included) | 41.3% | 26.1% |
| passes / team / game | 428 | 401 |
| goals / team / game (NHL target 3.07) | 3.54 | 3.27 |
| shots on goal / team / game (target 30.0, band ±20%) | 34.85 | 34.86 |
| hits / takeaways / giveaways / penalties | 19.1 / 5.8 / 7.3 / 3.67 | 22.6 / 6.5 / 7.7 / 3.88 |

Tests: `passDirection.test.ts` asserts that breakaways end in a shot or a
forward pass at least 95% of the time, with zero back passes. It also asserts
zero backward passes on rushes, an offensive-half back share under 10%, and
zero unpressured offensive-half back passes. The engine-agnostic stream
analyzer (`passShape.ts`) is reusable by the scorecard and by the agent engine.

## Next
- M1: agent engine physics and movement in `src/engine/agent/`, behind a flag.
- M2: thinking agents on data-driven role-position templates (see the
  coordinator note: shape targets per situation, expressed relative to the
  puck and zone, so measured tracking targets can replace them later).
- M3: hits and battles.
