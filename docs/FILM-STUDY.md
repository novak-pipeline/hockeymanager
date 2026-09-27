# Film Study: Real NHL Motion, Pose and Shape Reference

**Date:** 2026-09-27
**Purpose:** A realism benchmark for the 3D match view (motion, pose, team shape, broadcast grammar), taken from watching public NHL highlight video.
**Method:** Watch only. I streamed public highlights from the NHL's official YouTube channel in a browser, muted, and stepped through them with pause/seek. Nothing was downloaded or saved, no frames were extracted, no computer vision was run, and no commentary or captions were transcribed. Everything below is my own observation.

> **Every number in this file is an EYE ESTIMATE** taken from paused broadcast frames. Perspective, lens zoom and camera height distort distances by roughly +/-25%. Angles are +/-10 deg. Timings come from player timecode stepped at 0.1 to 0.5 s. Replays are often slow motion, and they're marked **(replay)** where a timing could be affected. Use these as targets to check against, not as ground truth. `src/engine/analysis` + the scorecard remain the quantitative authority.

Reference sizes used when estimating: an NHL player is about 6'1" (about 6.5 ft on skates), a stick is about 5.2 to 5.5 ft, the goal crease is 8 ft wide by 6 ft deep, the net mouth is 6 ft wide, faceoff circles have a 15 ft radius, the dot to the hash marks is about 15 ft, and the goal line to the blue line is 64 ft.

---

## Sources watched

| # | Video (official NHL channel) | URL | Used for |
|---|---|---|---|
| V1 | Flames vs. Oilers, NHL Preseason Highlights, Sep 26, 2026 | https://www.youtube.com/watch?v=2wPXisFVwk0 | skating/carry close-ups, D-zone shape, overhead goalie cam, goal sequence, broadcast |
| V2 | Hardest Hits of the 2025-26 NHL Season | https://www.youtube.com/watch?v=oqQX0gy_Pbs | hit setup/timing, target reactions, national-feed scorebugs |
| V3 | Super Slow Mo: Hardest Hits | https://www.youtube.com/watch?v=x-7sd7GyrXg | hit body mechanics in slow motion |
| V4 | Best Saves of the 2025-26 NHL Season | https://www.youtube.com/watch?v=UsIrhddU8Jg | goalie depth, butterfly slide, desperation stretch, breakaway challenge |
| V5 | IVAR STENBERG preseason HAT TRICK! | https://www.youtube.com/watch?v=2tilDTsifWQ | goal/celebration/replay pacing, PP 1-3-1 vs PK box, circle shot |
| V6 | Celebrini's CAPTAIN ERA Starts With a GOAL! | https://www.youtube.com/watch?v=c2q63GGr22M | neutral-zone shape, zone entry gaps, center-ice faceoff |
| V7 | Senators vs. Canadiens, NHL Preseason Highlights, Sep 26, 2026 | https://www.youtube.com/watch?v=eIYDkxqmR0E | faceoff (overhead + tight), PP/PK structure, penalty graphics, net-front scramble |
| V8 | Just ELEVEN SECONDS into Overtime!! | https://www.youtube.com/watch?v=DJ1di4f-Xck | 3v3 OT spacing, shot follow-through, replay angle set |
| V9 | Glove Saves, Pad Extensions & Pure Robbery, NHL Week 12 Saves | https://www.youtube.com/watch?v=pT8HwB5wCA4 | RVH post seal, scramble saves |
| V10 | Penguins vs. Sabres, NHL Preseason Highlights, Sep 26, 2026 | https://www.youtube.com/watch?v=ZNLMWjJy3nI | net-front battle, whistle/freeze behaviour, slot shot vs butterfly |
| (x) | Tage Thompson offseason workout | https://www.youtube.com/watch?v=VPK7NZO-zEw | gym footage only, no on-ice content, **not used** |

---

## 1. Skating

**S1. Puck carrier at moderate speed (two hands on the stick).** V1, https://www.youtube.com/watch?v=2wPXisFVwk0&t=165 (165.0 to 166.4 s, tight follow cam)
- Seen: an Oilers forward carries up the wall with **both hands on the stick** the whole time. His legs alternate pushes about every 0.30 s, which is about 3.3 pushes/s (about 1.6 full L+R cycles/s). His torso leans about 35 to 45 deg forward of vertical and his knees are bent to about 100 to 110 deg (included angle). With two hands on the stick his arms don't swing. The shoulders counter-rotate slightly with each push instead.
- **Target:** a with-puck skate cycle of about 0.55 to 0.65 s per L+R cycle at cruising speed. Torso lean 35 to 45 deg. Knee flexion to about 100 to 110 deg at push. No free-arm swing while two-handed.

**S2. Full stride without the puck.** V1, https://www.youtube.com/watch?v=2wPXisFVwk0&t=164 (#2 at 164.0 to 164.25 s)
- Seen: at full extension the recovery foot is under the hips and the pushing leg is fully straight, back and out at about 40 to 50 deg from the direction of travel. The skate-to-skate spread is about 1.3 to 1.5 body-widths at the moment of push. The stick is held in the **top hand only**, with the blade low near the ice and trailing to the side.
- **Target:** push legs finish *straight* and *out to the side* (not straight back). One-handed stick carry when skating hard without the puck.

**S3. Backward skating defender closing a gap.** V1, https://www.youtube.com/watch?v=2wPXisFVwk0&t=165 (defender, 165.3 to 166.2 s)
- Seen: the defender skates backward in a "sitting" crouch, knees about 90 to 100 deg, torso about 25 to 35 deg forward, head up. His stick is **one-handed and fully extended** at the puck (stick plus arm is about 7.5 to 8 ft of reach). The gap closes from about 15 ft to about 4 ft in about 0.9 s, then he turns his hips to match the carrier's inside cut.
- **Target:** backward-skating pose is deeper than forward cruising (knees about 90 to 100 deg). The stick leads one-handed at full extension. Gap closure is about 10 ft/s before the pivot.

**S4. Cut and protect.** V1, https://www.youtube.com/watch?v=2wPXisFVwk0&t=166 (165.75 to 166.35 s)
- Seen: when the defender arrives, the carrier rises to about 20 deg lean, pulls the puck across to his backhand side close to his skates, and turns his near shoulder into the defender. His body ends up between the defender and the puck.
- **Target:** under pressure the carrier's puck-to-body distance drops from about 3 ft to about 1 to 1.5 ft, and his shoulder turns toward the checker. Don't keep the blade out in front during a protect.

**S5. Lateral lunge / lane block.** V1, https://www.youtube.com/watch?v=2wPXisFVwk0&t=109 (#7, close-up)
- Seen: a defender drops into a wide lateral lunge with one leg bent deep and the other straight out. His body is tilted about 45 deg from vertical and his stick is flat along the ice to cover a passing lane.
- **Target:** a "lane block" pose exists: hips about 1.5 ft off the ice, stick shaft flat on the ice, lasting about 0.5 to 1 s.

**S6. Coasting / celebration / after whistles.** V5, https://www.youtube.com/watch?v=2tilDTsifWQ&t=9 (9.5 to 14.5 s). V10, https://www.youtube.com/watch?v=ZNLMWjJy3nI&t=31
- Seen: after a goal every skater stops striding and **glides upright** (lean under 15 deg). The four teammates reach the scorer within about 3 s. After a whistle, players decelerate over about 1 to 2 s and drift toward the crease.
- **Target:** play-stopped states switch to upright glides with no leg cycle. Converging teammates arrive within about 3 s.

**Not captured cleanly (gap):** top-speed stride cadence for a breakaway, crossover counts through the neutral zone, hockey-stop slide length, D mohawk pivots. Highlight edits cut these quickly. They need a longer tight-follow clip in a later session.

---

## 2. Stick & puck

**P1. Two-hand carry geometry.** V1, https://www.youtube.com/watch?v=2wPXisFVwk0&t=165
- Seen: the blade is about 2.5 to 3 ft ahead of the front skate and about 1.5 to 2 ft to the forehand side. The shaft is at about 30 to 35 deg to the ice. The top hand is at about hip/waist height, just in front of the body, and the bottom hand is about 1/3 of the way down the shaft.
- **Target:** carry blade about 1/2 a stick-length ahead and slightly outside the skates. Shaft angle 30 to 35 deg. Top hand at the hip, not the chest.

**P2. One-handed reach is the default defensive stick.** V1, https://www.youtube.com/watch?v=2wPXisFVwk0&t=164 (a Flames forward, 164.0 s). V10, https://www.youtube.com/watch?v=ZNLMWjJy3nI&t=140 (two backcheckers on the shooter)
- Seen: defenders reaching for pucks or blades go **one-handed at full arm extension**, with the stick about parallel to the ice. Reach from the shoulder to the blade is about 7.5 to 8 ft.
- **Target:** a defensive stick reach of about 7.5 ft one-handed, versus about 5 ft two-handed. Pokes and lifts should use the one-hand pose.

**P3. Slot shot (replay).** V10, https://www.youtube.com/watch?v=ZNLMWjJy3nI&t=139 (138.5 to 141.4 s, **replay**)
- Seen: while the puck arrives, the shooter's blade is **raised to about shoulder height** (the load). The release comes from the high slot about 15 to 20 ft out. The follow-through finishes low toward the net, and two defenders reach from about 6 to 8 ft behind him.
- **Target:** the load, release and follow-through are three distinct poses, and the blade is visibly lifted before a one-timer. In real time, load to release is well under 0.5 s. The replay stretches it to about 1.8 s.

**P4. Circle-dot wrist/snap shot (replay).** V5, https://www.youtube.com/watch?v=2tilDTsifWQ&t=164 (164.3 to 166.3 s, **replay**)
- Seen: the shooter stands on the faceoff dot with feet about 1.3x shoulder width. The blade starts beside/behind the back foot and travels about 2 to 3 ft to ahead of the front foot before release. The follow-through stays **low** (blade under knee height) and points at the target. A PK player slides feet-first into the lane at the same time.
- **Target:** wrist/snap shots have a short blade path (about 2 to 3 ft) and a low finish. Only slap shots and one-timers finish high.

**P5. Slap shot / one-timer finish.** V8, https://www.youtube.com/watch?v=DJ1di4f-Xck&t=11 (11.0 to 12.3 s)
- Seen: the shot from the right circle finishes with the **stick blade above head height**. The shooter's arms are up in celebration about 0.6 s later.
- **Target:** high follow-through reserved for slap shots and one-timers. The celebration pose starts about 0.5 to 1 s after the release.

**P6. Point shot in a low lunge.** V5, https://www.youtube.com/watch?v=2tilDTsifWQ&t=5 (5.5 s, wide shot, low resolution)
- Seen (tentatively, the figure is small): the point shooter is in a very deep lunge with the back knee close to the ice as he shoots.
- **Target:** point one-timers can drop the hips about 1.5 to 2 ft below standing. Worth a closer check in a future session.

---

## 3. Contact

**C1. Boards hit from the side/behind a puck-watcher.** V2, https://www.youtube.com/watch?v=oqQX0gy_Pbs&t=6 (6.5 to 10 s)
- Seen: the target plays the puck along the wall with his head down. The hitter approaches at about 30 to 45 deg to the boards from about 10 to 15 ft. At contact both of the hitter's skates briefly **leave the ice**, and his shoulder/chest meets the target's chest/upper arm. The target folds into the boards and slides to the base in about 1.2 s.
- **Target:** boards hits come at an angle (not perpendicular). The hitter hops at contact. The target's collapse to the ice takes about 1 to 1.5 s, not an instant ragdoll.

**C2. "Finished" check just after a puck release.** V2, https://www.youtube.com/watch?v=oqQX0gy_Pbs&t=31 (31.5 to 36 s)
- Seen: the puck leaves the target's stick about 0.3 to 0.5 s before contact. The target is **upended** (legs go above his torso) and lands about 1.5 s after contact. He sits up about 2 s later. The hitter stays upright, decelerates within about one body-length, and keeps his stick low with two hands.
- **Target:** hits usually land 0.3 to 0.5 s *after* the puck is moved. Big hits have a 1.5 s airborne/fall phase and a 2 s recovery (sit, then stand). The hitter doesn't fall.

**C3. Open-ice hit, slow motion.** V3, https://www.youtube.com/watch?v=x-7sd7GyrXg&t=25
- Seen: the hitter is compact, with knees about 120 deg and his trailing leg extended back as a push. Contact is torso to torso. The target's torso whips back about 45 deg and his **feet slide out forward**, so he falls backward. The hitter rides through on his skates.
- **Target:** open-ice targets fall *backward* (feet out front), and boards targets fall *down* (fold and slide).

**C4. Boards pin, slow motion.** V3, https://www.youtube.com/watch?v=x-7sd7GyrXg&t=26 (26.5 to 29.5 s)
- Seen: the target had just chipped the puck by. The hitter squares up and drives through. His skates leave the ice and his momentum carries him *up* the boards. The target drops with his legs trapped under him.
- **Target:** boards contact transfers the hitter's momentum upward, so show him rising or rebounding off the glass rather than stopping dead.

**C5. Blue-line approach timing.** V2, https://www.youtube.com/watch?v=oqQX0gy_Pbs&t=43 (43 to 44.7 s)
- Seen: the hitter crosses from about 20 ft away at about 45 deg and reaches the carrier on the half-wall about 1.7 s later.
- **Target:** hit approaches last about 1.5 to 2 s of visible setup. The engine/renderer should telegraph them over that window.

**C6. Net-front battle.** V10, https://www.youtube.com/watch?v=ZNLMWjJy3nI&t=101. V7, https://www.youtube.com/watch?v=eIYDkxqmR0E&t=80
- Seen: the defender stands at the crease edge beside the post, **facing out**, with his stick blade on the ice in the lane. He leans into the forward with his forearm and hip (a lean, not a wrestle). On point shots, 4 to 6 bodies sit within about 8 ft of the crease.
- **Target:** net-front D face up-ice with the stick down, and bodies are in contact (overlap distance of about 0). Crease traffic reaches 4 to 6 skaters on sustained pressure.

**C7. Whistle / freeze behaviour.** V10, https://www.youtube.com/watch?v=ZNLMWjJy3nI&t=29 (29 to 32 s)
- Seen: the goalie covers the puck and stays down about 1.5 to 2 s. The referee's arm points at the crease. Skaters converge, one attacker is still on a knee at the crease, and there are light shoves, then everyone disperses slowly.
- **Target:** a freeze gets about 2 s of "scrum settle": converge, brief pushes, then a slow drift away. It isn't an instant reset.

**Gap:** long wall battles (duration, who wins) weren't visible for more than about 1 s in these edits.

---

## 4. Goalies

**G1. Depth = top of the crease.** V4, https://www.youtube.com/watch?v=UsIrhddU8Jg&t=9 and https://www.youtube.com/watch?v=UsIrhddU8Jg&t=22 (overhead). V1 overhead, https://www.youtube.com/watch?v=2wPXisFVwk0&t=429
- Seen: against slot and point threats, the goalie's skates sit at or just beyond the **front edge of the painted crease**, about 4 to 5 ft out from the goal line, squared to the puck.
- **Target:** default depth is about 4 to 5 ft off the goal line. Against a sharp-angle puck, retreat to the post (see G5).

**G2. Ready stance.** V4, https://www.youtube.com/watch?v=UsIrhddU8Jg&t=22 (overhead). V10, https://www.youtube.com/watch?v=ZNLMWjJy3nI&t=140
- Seen: knees bent about 110 to 120 deg with the pads nearly touching at the knee. The glove is open at hip-to-waist height, held about 1 ft out to the side and slightly forward. The blocker is at his side with the stick blade flat on the ice about 1 ft ahead of the skates, covering the five-hole.
- **Target:** glove at the hip (not the shoulder), stick flat on the ice, pads close.

**G3. Butterfly timing and lateral slide.** V4, https://www.youtube.com/watch?v=UsIrhddU8Jg&t=9 (9.0 to 11.4 s). V1 overhead, https://www.youtube.com/watch?v=2wPXisFVwk0&t=429 (428 to 432 s)
- Seen: in-close, the goalie drops to the butterfly (both knees down, pads flared to about 70% of the crease width) as the shot or pass is released. On a cross-slot pass he **slides in the butterfly** about half to one crease-width in about 0.7 s. On the end-of-period 1v1, he held his feet until the shooter was about 15 ft out, then dropped.
- **Target:** the butterfly drop is tied to release, not to proximity. Butterfly slide about 5 to 8 ft/s laterally. The pads' horizontal span is about 5 to 6 ft.

**G4. Desperation stretch.** V4, https://www.youtube.com/watch?v=UsIrhddU8Jg&t=38 (38.5 to 41 s). V1 overhead, https://www.youtube.com/watch?v=2wPXisFVwk0&t=317 (315 to 318.3 s)
- Seen: the goalie lays fully horizontal along the goal line (about 6 to 7 ft of body plus pad) with the glove raised. The crossing takes about 1.5 s from butterfly at one side to full extension at the far post.
- **Target:** a full-length pad-extension/sprawl pose that covers the whole crease width. Crossing time is about 1.5 s. After a goal the goalie often stays down 1 to 2 s.

**G5. Post seal (RVH) on sharp angles.** V9, https://www.youtube.com/watch?v=pT8HwB5wCA4&t=28. V4, https://www.youtube.com/watch?v=UsIrhddU8Jg&t=126 (overhead)
- Seen: with the puck at or below the goal line, the lead pad lies **flat on the ice along the post**, the back knee is down, the torso is upright, and the glove is up.
- **Target:** puck behind or beside the goal line triggers an RVH pose at the near post, not a standing stance at the top of the crease.

**G6. Breakaway challenge.** V4, https://www.youtube.com/watch?v=UsIrhddU8Jg&t=37 (37 to 38.5 s)
- Seen: the goalie is well out beyond the paint (about 8 to 12 ft off the goal line), then retreats as the shooter cuts wide. When the shooter goes around, the goalie lays flat, pads stacked, along the goal line.
- **Target:** on breakaways the goalie moves well past normal depth, then retreats on the deke.

**Gap:** clean glove-save and blocker-save mechanics, and rebound direction statistics. The highlight edits were too fast and too far for a reliable read.

---

## 5. Team shape (wide shots)

**T1. Faceoff alignment.** V7 overhead, https://www.youtube.com/watch?v=eIYDkxqmR0E&t=2 (2.5 to 4 s) and tight, https://www.youtube.com/watch?v=eIYDkxqmR0E&t=83. V6, https://www.youtube.com/watch?v=c2q63GGr22M&t=1
- Seen: centers **crouch very deep** with the torso about 60 to 70 deg forward (nearly horizontal), heads about 1 to 2 ft apart over the dot, the bottom hand low on the shaft and the blade at the dot. In the offensive zone one center turns his shoulder into the other (a tie-up). The wingers stand at the circle edges/hashes about 15 ft either side. The D are about 25 to 35 ft back and spread. The linesman drops the puck from about waist height and immediately steps back about 4 to 5 ft.
- **Target:** the faceoff pose is much lower than a standing stance. Winger width is about 15 ft each side and D depth is about 30 ft.

**T2. Neutral-zone defense.** V6, https://www.youtube.com/watch?v=c2q63GGr22M&t=4 and https://www.youtube.com/watch?v=c2q63GGr22M&t=8
- Seen: the defending team sets 3 to 4 players across or just inside its own blue line as a flat wall, with one forechecker higher. The carrier meets a blocked lane about 20 to 25 ft before the line.
- **Target:** without the puck, teams form a line across the blue line (a 1-2-2 / 1-3 look), not a chase.

**T3. Zone-entry gap.** V6, https://www.youtube.com/watch?v=c2q63GGr22M&t=9 (9.2 s)
- Seen: at the entry, the two retreating D are about 15 to 20 ft ahead of the carrier, and three backcheckers trail within about 20 ft.
- **Target:** D gap at the blue line is about 15 to 20 ft and shrinks to about 5 ft by the top of the circles (compare S3).

**T4. Defensive-zone coverage.** V1, https://www.youtube.com/watch?v=2wPXisFVwk0&t=98
- Seen: the goalie is at the crease, both D and the center are within about 15 ft of the net, and the wingers sit higher (top of the circles) toward the points. It's compact and low.
- **Target:** D-zone shape is roughly a house or box collapsed toward the net. Three defenders sit within about 15 ft of the goal when the puck is low.

**T5. Power play vs penalty kill.** V5, https://www.youtube.com/watch?v=2tilDTsifWQ&t=121. V7, https://www.youtube.com/watch?v=eIYDkxqmR0E&t=90
- Seen: **PP 1-3-1**: one player high at the blue line, two flankers at the half-wall/top of the circles, one bridge in the high slot, one at the net front. **PK box**: four players in a square about 20 to 25 ft on a side, centered on the slot, with the high pair near the top of the circles and the low pair beside the crease.
- **Target:** a recognisable 1-3-1 against a box on every PP possession, with PK box sides of about 20 to 25 ft.

**T6. PK through the neutral zone.** V7, https://www.youtube.com/watch?v=eIYDkxqmR0E&t=87
- Seen: the PK sends one forechecker high, with three stacked behind (a 1-1-2 / 1-3 look). The PP regroups with all four players in its own half.
- **Target:** the PK neutral zone uses one pressure skater and three waiting at the line.

**T7. 3v3 overtime spacing.** V8, https://www.youtube.com/watch?v=DJ1di4f-Xck&t=1 and https://www.youtube.com/watch?v=DJ1di4f-Xck&t=8
- Seen: the opening faceoff has three per side with huge open ice. On the 4-on-3 the attackers spread to both circles and the net front, about 25 to 30 ft apart.
- **Target:** OT spacing is about 25 to 30 ft between attackers. The screen should look mostly empty.

**Gap:** line changes. None was clearly visible in these highlight edits (packages cut around them). Forecheck F1/F2/F3 distances are also a gap. Both need a full-game or longer broadcast clip.

---

## 6. Broadcast conventions

**B1. Main game camera.** Every game highlight. For example V7, https://www.youtube.com/watch?v=eIYDkxqmR0E&t=45 and V5, https://www.youtube.com/watch?v=2tilDTsifWQ&t=6
- Seen: a high side camera (around upper-bowl height, looking down about 20 to 30 deg) frames **about a third to half of the rink length** (blue line to end boards in the zone). Players are about 1/8 to 1/6 of frame height. The camera pans smoothly with the puck, kept slightly off-center toward the attacking net, and zooms a little tighter for low-zone play.
- **Target:** default 3D camera is a zone-width framing (about 70 to 100 ft visible) from a high side angle, not a full-rink framing.

**B2. Tight follow shot.** V1, https://www.youtube.com/watch?v=2wPXisFVwk0&t=165
- Seen: highlight packages often use a tighter follow shot for carries and one-on-ones, with the player about 1/2 of frame height.

**B3. Goal sequence pacing.** V5, https://www.youtube.com/watch?v=2tilDTsifWQ&t=9 (9 to 40 s). V1, https://www.youtube.com/watch?v=2wPXisFVwk0&t=293 (293 to 320 s). V7, https://www.youtube.com/watch?v=eIYDkxqmR0E&t=135
- Seen: goal, then the **wide shot holds about 1.5 to 4 s**, then a cut to a tight celebration (about 3 to 5 s), then **crowd shots about 5 to 10 s**, then a team-branded "REPLAY" stinger/wipe (about 0.5 to 1 s), then 2 to 4 replay angles, usually slowed.
- **Target:** the goal cutaway sequence in that order. Total goal-to-faceoff dead time in a highlight is about 25 to 35 s.

**B4. Replay angles used.** V8, https://www.youtube.com/watch?v=DJ1di4f-Xck&t=54 (to 78 s). V1 overhead, https://www.youtube.com/watch?v=2wPXisFVwk0&t=316. V7 behind-net, https://www.youtube.com/watch?v=eIYDkxqmR0E&t=55
- Seen: high side (same as live), reverse high side, **straight-down overhead net cam** (shows the crease geometry and goalie depth perfectly), low behind-net/in-net cam, and ice-level behind-the-glass.
- **Target:** in 3D, offer an overhead crease cam and a low reverse cam as replay presets.

**B5. Scorebug.** V2, https://www.youtube.com/watch?v=oqQX0gy_Pbs&t=48. V7, https://www.youtube.com/watch?v=eIYDkxqmR0E&t=90 and https://www.youtube.com/watch?v=eIYDkxqmR0E&t=140. V8, https://www.youtube.com/watch?v=DJ1di4f-Xck&t=8
- Seen: national feeds put a compact bug **top-left** (about 25 to 30% of frame width) with team marks, score, shots on goal, period and clock. Some regional feeds put it **top-center**. State expands as a **strip under the bug**: power-play timer ("4 ON 3"), penalty description ("PENALTY / name / infraction / time") and "TEAM GOAL". Some feeds add a shots-on-goal lower third at bottom center (V5, https://www.youtube.com/watch?v=2tilDTsifWQ&t=53) and a separate "POWER PLAY" panel (V5, https://www.youtube.com/watch?v=2tilDTsifWQ&t=121). Tenths of a second show under one minute (V1, https://www.youtube.com/watch?v=2wPXisFVwk0&t=429).
- **Target:** a small top-left bug with an expandable state strip beneath it. Keep it small; it must never cover the upper third of play.

**B6. Faceoff camera.** V7, https://www.youtube.com/watch?v=eIYDkxqmR0E&t=2
- Seen: the opening draw is shown from a straight-down overhead camera, then cuts to the main side camera about 1 s after the drop.

**B7. Transitions between highlight clips.** V1, https://www.youtube.com/watch?v=2wPXisFVwk0&t=113. V7, https://www.youtube.com/watch?v=eIYDkxqmR0E&t=168
- Seen: a dissolve lasting about 0.5 s with a large player cut-out graphic.

---

## Most important differences to check in our 3D view

The 15 observations I expect to matter most for perceived realism, each phrased as a target. All numbers are eye estimates; verify them in the scorecard or with a render snapshot.

1. **Default camera framing is one zone, not the whole rink.** High side angle (about 20 to 30 deg down), about 70 to 100 ft of ice visible, players about 1/8 to 1/6 of frame height, smooth puck-led pan. (B1)
2. **Skaters lean 35 to 45 deg forward with knees at about 100 to 110 deg while striding.** An upright skater reads instantly as fake. (S1, S2)
3. **Stride cadence is about 3 to 3.5 pushes/s at cruising speed with the puck**, and push legs finish straight and *out to the side* at about 40 to 50 deg. (S1, S2)
4. **Two hands on the stick while carrying; one hand when skating hard without the puck; one hand at full extension when reaching defensively (about 7.5 ft).** (S2, P1, P2)
5. **Carry blade about 2.5 to 3 ft ahead and 1.5 to 2 ft to the forehand side, shaft at 30 to 35 deg, top hand at the hip.** Under pressure the puck comes in to about 1 ft and the shoulder turns into the checker. (P1, S4)
6. **Backward-skating D are deeper than forwards (knees about 90 to 100 deg), stick out one-handed, closing gaps at about 10 ft/s before pivoting.** (S3, T3)
7. **Goalie depth sits at the top of the crease (about 4 to 5 ft off the goal line), with the glove at the hip and the stick flat on the ice.** (G1, G2)
8. **The butterfly drops on release, not on proximity. Lateral butterfly slides are about 5 to 8 ft/s, with a full crease-width stretch in about 1.5 s.** (G3, G4)
9. **Puck at or below the goal line triggers an RVH post seal** (lead pad flat along the post, back knee down). (G5)
10. **Hits are telegraphed over about 1.5 to 2 s and land 0.3 to 0.5 s after the puck is moved.** Approach at about 30 to 45 deg, and the hitter hops at contact. (C1, C2, C5)
11. **Target reactions differ by location: open-ice targets fall backward (feet out front), boards targets fold and slide down. Falls take about 1 to 1.5 s and get-ups about 2 s.** (C1 to C4)
12. **Wrist/snap shots have a short (2 to 3 ft) blade path and a low follow-through. Only slap shots and one-timers load the blade to shoulder height and finish above the head.** (P3 to P5)
13. **Faceoffs: centers crouch nearly horizontal, wingers about 15 ft wide on the hashes, D about 30 ft back, and the linesman steps back about 5 ft after the drop.** (T1)
14. **Structures are visible: a 1-3-1 PP against a 20 to 25 ft PK box, D-zone collapse with three defenders within about 15 ft of the net, and a neutral-zone wall at the blue line.** (T2, T4, T5)
15. **Stoppages breathe: on goals, hold wide about 2 to 4 s, cut to the celebration, crowd, then replays (including an overhead crease cam). On freezes, give about 2 s of converging, light shoves and a slow drift.** Everyone switches to upright glides when play stops. (B3, B4, C7, S6)

---

## Gaps for the next film session

- Top-speed breakaway stride cadence and crossover counts (need a long tight-follow clip).
- Hockey-stop slide length and D mohawk/crossover pivot timing.
- Glove vs blocker save mechanics and rebound direction.
- Line changes (timing, route to the bench, bench-door behaviour). Highlight edits hide these, so try a condensed game or full-shift clip.
- Forecheck F1/F2/F3 spacing and breakout support positions from a wide camera.
- Wall battles longer than 1 s (who wins, body position).
