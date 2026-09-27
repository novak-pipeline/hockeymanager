# The Show: 3D match presentation audit (looks and motion)

Date: 2026-09-27. Working tree: `improve-loop` @ dc4f53a, read as-is.
Harness: the main checkout on **port 5195**. Port 5190 was already taken by the stick-grip worktree's server, so I did not reuse it. The harness uses its own Vite cache dir via `vite.audit.config.mjs`.
Athletes: `owner/clip`, the owner's Fab models from the `auto` default. Seed 3.
Paths below are relative to the audit scratch folder (evidence kept locally, not committed).

**Scripts I wrote** (all in this folder):
- `batch.mjs`: stills
- `sheet.mjs`: timed contact sheets, with the game clock stamped on each frame
- `vprobe.mjs`: puck, blade, feet, facing, overlap, label and framing metrics
- `perfv.mjs`: uninstrumented vsync pacing, load time and memory
- `camprobe.mjs`: yaw rate per camera preset
- `streamprobe.mjs`, `shotprobe.mjs`, `saveprobe.mjs`: stream-level timing of shots, saves, goals and faceoffs

**Concurrency caveat:** about 33 Chrome processes and 6 Vite servers belonging to other agents were running at the same time. For about 30 s the main checkout also had a transient merge-conflict marker in `src/domain/league.ts`, which broke the harness until it cleared (see `vite.log`). Frame-time numbers taken under instrumentation are therefore pessimistic, and the uninstrumented `perfv` numbers are the reliable ones.

**Scope:** I did not re-report the recently fixed items (spline sawtooth, rig binding and bench-gate changes, stick flip/pops/hitches). Two items are already being worked on and are marked **[in progress]**: the awkward stick grip / bent blade, and the too-hard engine steering.

**Last column, "Agent engine?":** whether the new agent engine (MATCH-ENGINE-PLAN M1–M5) would fix the finding.
- **Y**: fixed by the engine, and the phase is named.
- **P**: partly fixed.
- **N**: renderer-only work.

---

## 1. Measurements

### 1.1 Motion probe (`scripts/dev/render3d-harness/motion-probe.mjs --port=5195`, raw output in `motionprobe.txt` and `motionprobe_speed.txt`)

| Segment | secs | maxSpeed | yawTwitch /rig-s (gate ≤0.1) | pops /rig-s (≤0.05) | hand/stick pops | boneP99 | handOffStick | frame p95 / max ms (instrumented) | >50 ms |
|---|---|---|---|---|---|---|---|---|---|
| `t=0.3&cam=broadcast` | 20 | 34.3 | **0.118 FAIL** | 0 | 0 | 5.2 | 0 / 38 292 | 37.6 / 58.3 | 17 |
| `goal=1&lead=8&cam=broadcast` | 20 | 33.7 | 0.020 | 0.017 | 0.096 | 4.68 | 0 / 43 050 | 33.3 / 58.4 | 3 |
| `goal=2&ev=hit&lead=6&cam=follow` | 20 | 40 | **0.126 FAIL** | 0.027 | 0.171 | 4.52 | 0 / 46 800 | 29.2 / 62.6 | 2 |
| `t=0.62&cam=broadcast` | 15 | 40 | 0.085 | 0.023 | 0.014 | 5.35 | 0 | 33.4 / 79 | 7 |
| `t=0.62&…&speed=2` | 20 | 40 | **0.122** | **3.88** | 0.73 | 10.19 | 0 | 29.2 / 66.6 | 2 |
| `t=0.3&…&speed=2` | 15 | 40 | **0.306** | **4.27** | 1.36 | 10.94 | 0 | 25 / 100 | 10 |
| `t=0.3&…&speed=4` | 15 | 40 | **0.203** | **40.6** | 0.08 | 20.43 | 0 | 29.3 / 58.5 | 12 |

**Worst pops:**
- `faceoff_draw`: stick 85.8 rad/s and spine 46 rad/s at t=879.5.
- One-timer blended into `celly_fistpump`: head 55 rad/s at t=207.75.
- `g_scramble` on a goalie in rig mode `idle`: stick 131 rad/s at t=2243.7.
- At 2× and 4× playback, the pops are almost all `spine`/`head` with no clip playing, in the `play`, `arriving` and `departing` modes.

### 1.2 Visual probe (`vprobe_t30_bc.json`, 20 s of `t=0.3&cam=broadcast`, 1 955 frames, 21 567 skater-frames)

**Puck**
- Puck height is **always 0.05 ft** (a single value across every frame).
- Puck speed: p50 12.5 ft/s, p99 154 ft/s, max 425 ft/s. There were 10 frames above 180 ft/s (teleports around clock 1093.9).

**Carried puck vs the carrier's blade** (1 135 carrier frames)
- Blade-to-puck distance: p50 1.15 ft, p90 2.81 ft.
- **31.6% of carried frames have the blade more than 1.5 ft from the puck.**

**Skater motion**
- 77.5% of skater-frames are faster than 8 ft/s. Of those, 6.9% are backward skating (170 samples without the `skate_back` clip) and 5.1% are sideways, facing 54–108° off the direction of travel.
- Idle skaters with no clip during play: 4.3%.
- Stride phase rate: 9.2 rad/s at 8–14 ft/s, 11.2 at 14–20, 12.2 at 20–26, 12.6 at 26+.

**Clip usage in 20 s** (skater-frames)

| Clip | Frames |
|---|---|
| `skate_start` | 1 667 |
| `hockey_stop` | 967 |
| `pass` | 68 |
| `hit_stagger` | 45 |
| `check` | 42 |

That is about one hockey stop per second somewhere on the ice. **`stickhandle` never plays.**

**Bodies and labels**
- **21.7% of frames** have at least one pair of bodies (skater or goalie) with centres less than 1.4 ft apart, i.e. interpenetrating.
- **77.3% of frames** have overlapping name labels on screen.

**Broadcast framing**
- Puck off-screen 6.2% of the time, and within the outer 10% of the frame another 8.3%.
- 7.9% of skater-frames are off-screen.
- Camera speed: p95 10.3 ft/s.

**Goalie facing** (degrees off the puck): p50 0.6°, p95 28°.

### 1.3 Stream timing (`stream_seed3.json`, `shotprobe.json`, `saveprobe.json`; 45 faceoffs, 54 shots, 49 saves, 5 goals, 599 completed passes)

**Faceoffs**
- The nearest skater of each team is about 2 ft from the dot, and both centres are within 4 ft in 44 of 45 faceoffs.
- In at least one faceoff the puck sits alone at the dot for **14 s** (p90 is 0).

**Shots**
- The shooter is the carrier in **0 of 54 shots at the event time**; the puck is already loose.
- Shooter-to-puck distance: 2.8 ft (p50) at −0.6 s, 3.1 ft at −0.3 s, **9.1 ft at −0.15 s**, 7.1 ft at 0 s, 19.7 ft at +0.3 s.
- In other words, the puck leaves about 0.15–0.25 s *before* the clip's contact frame, which is aligned to the event.

**Saves** (14 sampled live)
- At the save moment the rendered puck is **6.7–26 ft from the goalie** (median about 13 ft). Even the stream's puck is 5–22 ft away (median about 9 ft).
- Over the preceding second the rendered puck lags its stream target by up to **26.7 ft**.

**Goals:** on every goal the puck snaps from its last position to exactly **(−91, 0)**, the dead centre of the net, and stays there.

### 1.4 Camera probe (`camprobe.json`, 20 s each from `t=0.3`)

| Preset | Yaw p95 °/s | Max yaw °/s | Frames >90 °/s | Pan reversals | Max cam speed ft/s |
|---|---|---|---|---|---|
| broadcast | 9.4 | 10.2 | 0 | 1 | 11.4 |
| follow | **150** | **3 856** | **513 / 2 751 (19%)** | 8 | 145 |
| endzone | 0 | **43 902** | 3 | 2 | **272** |
| overhead | 0 | 0 | 0 | 0 | 2.5 |

### 1.5 Performance (`perfv.txt`, `shot.mjs --perf`)

The display runs at about 140 Hz and the GPU is an RTX 5090.

**Uninstrumented vsync (15 s each)**

| Preset | avg ms | p95 ms | p99 ms | max ms | Frames >50 ms |
|---|---|---|---|---|---|
| broadcast | 7.19 | 12.6 | 16.7 | 50 | 0 |
| endzone | 9.33 | 16.7 | 16.9 | 45.5 | 0 |
| goal | 7.5 | 12.9 | — | 29 | 0 |

**Uncapped, 1080p**
- Broadcast: avg 5.16 ms, p95 8.6 ms, renderer CPU 4.07 ms.
- Endzone with 4× CPU throttle: **avg 18.1 ms, p95 34.9 ms, CPU 16.45 ms/frame.** RENDER3D-UPGRADE.md recorded 12.0 / 16.7 for the same case, so this is a regression.
- Triangles: **1.62 M** (the docs say 838k for the Blender athletes; the owner models are about 29k tris × 26 rigs).
- Draw calls: 161–204.

**Load time** (page to ready, including the in-page full sim and asset load): 5.9–8.4 s.

**Memory**
- JS heap: 96–101 MB used, 126–158 MB total.
- GL: 87 geometries, 69–75 textures, 53 programs.
- Adaptive quality stayed at level 0.

**Console:** every page load logs `GL_INVALID_OPERATION: Mismatch between texture format and sampler type` (several times) and HLSL X4122 precision warnings.

---

## 2. Findings

**Severity levels**
- **blocker**: kills believability or readability for any viewer.
- **major**: obvious on first watch.
- **minor**: noticeable once you look for it.
- **polish**: nice to have.

### A. Athlete models

| ID | Observed | Evidence | Sev | Likely root cause | Size | Agent engine? |
|---|---|---|---|---|---|---|
| A1 | **Faces are tinted in team colour.** Blue-team skin reads purple/blue and red-team skin reads orange/red, on skaters and on goalies behind the mask. | `shots/face_home0.png`, `shots/close_home0.png`, `sheets/save_close.png` #5 and #8, `sheets/goal_celly_close.png` #1 | **major** | `ownerKit.ts gearMaterial()` swaps the "yellow/gold" accent over the whole gear texture. Face and skin share that texture, and warm, low-blue skin shadows pass the `g/r` and `b/r` key. Fix: exclude skin with a mask (a kit-map class or UV region), or tighten the key. | S | N |
| A2 | **Idle / stoppage stance is upright**, with the stick held vertically in front like a cane and both hands at the top of the shaft. There is no hockey ready stance at whistles or faceoff waits. | `shots/close_home0.png`, `close_away0.png`, `close_homeg.png` | major | The owner `skate_idle` plus hand IK. **[in progress: stick-grip agent]** | M | N |
| A3 | **Bodies interpenetrate.** A net-front skater stands inside the goalie, and checker and target merge into one silhouette during hits. | `shots/close_homeg.png`, `sheets/hit_close2.png` #3–#5, `hit_close3.png` #0–#1; 21.7% of frames have a pair closer than 1.4 ft (vprobe) | **major** | The sim has no body occupancy (the plan says so), and the renderer has no separation pass. | L (engine) / M (render-side soft separation) | **Y (M1 "bodies occupy space")** |
| A4 | **Close-up legibility is good**: the name bar and numbers on the back and shoulders read clearly (OLSEN 13, HOLM 51, GARRITY 59), and the kits contrast well (home blue vs away white/red). At broadcast distance numbers are unreadable (expected), and silhouettes read fine. | `shots/close_home0_back.png`, `sheets/bc_zoom_labels.png` | (positive) | — | — | — |
| A5 | **Handedness:** everyone shoots the same side (a known contract gap in the docs). With the owner models, all carries show the puck on one side. | `sheets/pass_close.png`, RENDER3D-UPGRADE.md "Known issues" | minor | `PlayerLabels` has no handedness field, and `puckCarriedOffset` is fixed to one side. | S + additive contract field | N (it needs a label field) |
| A6 | **The goalie model is strong** (mask art, pads, blocker, glove) and reads like a goalie. The weak spot is again the skin tint (A1). | `shots/close_awayg.png` | (positive) | — | — | — |
| A7 | **The video-board underside is a flat, untextured blue slab**, and the board says "HOME / AWAY" instead of team names. | `shots/jumbotron.png` | polish | `arena.ts` video board. | S | N |
| A8 | **Grounding and shadows are good**: the soft contact blobs and short key-light shadows seat the skates on the ice, and no skates sink into it (footMinY 0.255 ft on the foot bone; 0 frames below the ice). | `shots/close_home0.png`, vprobe | (positive) | — | — | — |
| A9 | **Triangle budget doubled** with the owner models: 1.62 M tris, 29k per athlete × 26 rigs. There is no LOD, even though at broadcast distance each athlete covers about 40 px of height. | perf section | minor | There are no LOD meshes for the owner imports. | M | N |

### B. Animation

| ID | Observed | Evidence | Sev | Likely root cause | Size | Agent engine? |
|---|---|---|---|---|---|---|
| B1 | **Shots don't read.** The shooter's upper body barely changes through the release, and the puck has already left 0.15–0.25 s before the clip's contact frame. At the event the shooter is never the carrier (0 of 54), and the puck is a median 7–9 ft away while the stick swings through empty ice. | `sheets/shot_fine.png` #2–#6, `sheets/shot_close.png`, `shotprobe.json` | **blocker** | 1) The stream has no `release` moment: carrier becomes null a frame before the shot event, and `splineXY` pre-empts the release. 2) Owner models have only `shot_slap`; wrist shots and one-timers are Blender clips retargeted with an `upper` mask, which is subtle on the owner body. 3) The puck spring (item C2) adds lag. | M (renderer: pin the puck to the blade until contact, then launch) + additive event fields | **P (M1 puck physics and M5 shot mapping, if the release time is emitted)** |
| B2 | **Saves happen 13 ft before the puck arrives**: the pad, glove or blocker save fires while the puck is a median 13 ft away (max 26 ft), then the puck crawls in. | `saveprobe.json`, `sheets/save_close.png` | **blocker** | The stream's puck is already 5–22 ft away at the `save` time, and the renderer's puck spring lags a further 6–27 ft. | M | **Y (M1 puck physics) + renderer puck fix (C2)** |
| B3 | **Hits are not readable**: in two live close-ups the checker shows no visible check, the target keeps skating, and the bodies pass through each other. A fall was seen once from broadcast distance. | `sheets/hit_close2.png`, `sheets/hit_close3.png`, `sheets/hit_close.png` #4–#6 | **blocker** (the owner's priority is "hits") | Hits are events, not collisions. `check` (42 frames) and `hit_stagger` (45) play briefly with a low weight (0.55 + 0.45·hardness), with no approach or contact geometry. | L | **Y (M3)** |
| B4 | **Missing clip coverage** (no trigger, or no clip at all): stickhandle (catalogued, never triggered), receive/settle, deke, poke check, board battle / pin along the wall (only `pinned_boards` on hit targets), net-front battles, fights, bench reactions (`bench_standup` untriggered), `rookie_lap` and `salute` untriggered, goalie T-push, cover/freeze, playing the puck, post-to-post (only shuffles), and the dejected skater. | `animCatalog.ts`, choreo grep (stickhandle is never `play()`ed), vprobe clip counts | major | There is no stream event for these actions, and the choreographer has no trigger. | L | **Y (M2–M5 add the actions; M5 maps them)** |
| B5 | **Owner and Blender clip mix**: the owner skater ships 8 clips (stride, back, crossovers L/R, idle, start, stop, slap shot). Everything else (wrist shot, one-timer, pass, faceoff, checks, falls, cellies) is a Blender clip retargeted onto the owner body, so the motion style is inconsistent. | `.glb` animation list (skater: `hockey_stop, shot_slap, skate_back, skate_crossover_L/R, skate_idle, skate_start, skate_stride`) | major | Asset coverage. | L (more owner or mocap clips) | N |
| B6 | **Yaw twitch fails the gate** in 2 of 4 segments at 1× (0.118 and 0.126 against the ≤0.1 gate). Skaters rock their facing left and right while steering. | `motionprobe.txt` | major | Constant micro-steering at maximum acceleration in the sim, with facing derived from smoothed velocity. **[in progress: engine steering]** | — | **Y (M1 momentum skating)** |
| B7 | **Constant stops and starts**: about 1 `hockey_stop` per second across the ice, and `skate_start` on 7.7% of skater-frames. Play looks like players stop, pivot and restart instead of flowing. | vprobe clip counts | major | Sharp deceleration in the sim triggers `wantsHockeyStop`. **[in progress: engine steering]** | — | **Y (M1)** |
| B8 | **Crab skating**: 5.1% of fast frames face 54–108° off the direction of travel with no crossover or lateral clip, and 170 fast backward samples play no `skate_back` weight. | vprobe (`sidewaysFracOfFast`, `backwardWithoutBackClip`) | minor | `facingTarget` squares players up to the puck while they move laterally, and the locomotion blend has no strafe clip. | M | **P (M1 backward and crossovers)** |
| B9 | **Clone celebrations**: 4–5 teammates do the same `celly_hug` pose in a line, then skate off in lockstep formation. | `sheets/goal_celly_close.png` #5–#11, `shots/goal0_bc_after.png` | minor | `celly_hug` is one clip with no per-player variation; the sim moves the group as a unit. | S | P (M5) |
| B10 | **Pops at fast-forward**: at 2× playback there are 3.9–4.3 body pops per rig-second and yaw twitch of 0.12–0.31; at 4×, 40.6 pops per rig-second. SimView offers 1/2/4/8×. Part of this is the metric (it isn't normalised for playback speed), but the spine and head do whip. | `motionprobe_speed.txt` | minor | Stride and bank are integrated at `simDt × min(speed, 4)`, and the owner full-body locomotion mask swings the spine. Either normalise the probe per game-second or cap the pose rate. | S | N |
| B11 | **Transition pops**: `faceoff_draw` (stick 86 rad/s, spine 46), a one-timer blending into `celly_fistpump` (head 55), and `g_scramble` on a goalie whose rig mode is `idle` (stick 131). | `motionprobe.txt` | minor | Crossfades that are too short between unrelated clips, and a goalie clip that fires while the goalie is flagged idle. | S | N |
| B12 | **The stride looks plausible**: the cadence rises with speed (9 to 12.6 rad/s), and skates stay on the ice with no visible foot-skating in the close-ups. | vprobe `strideRateBySpeed`, `sheets/pass_close.png` | (positive) | — | — | — |
| B13 | **Hands and stick**: hands never leave the shaft (0 of 38k–50k checks). Grip quality and the bent blade are **[in progress]**. | motion-probe `handOffStick` | — | — | — | — |

### C. Puck

| ID | Observed | Evidence | Sev | Likely root cause | Size | Agent engine? |
|---|---|---|---|---|---|---|
| C1 | **The puck never leaves the ice.** Every shot, including goals and glove saves, is a flat slide. There are no saucer passes, no deflections up, no puck over the glass, and no bounces. | vprobe `puckHeights: [0.05]`; `rink3dRenderer.ts` sets `puckMesh.position.y = PUCK_H/2` | **blocker** | The `FrameEvent.puck` contract is XY only. The renderer could synthesise a shot arc from `shot.target` (a target height exists in events), but it doesn't. | M (renderer arc from shot → save/goal target) / L (additive z field) | **Y (M1 puck physics, with the additive event field the plan recommends)** |
| C2 | **The rendered puck trails a fast puck by up to 27 ft.** Puck smoothing is a critically damped spring with a 0.08 s half-life, so the steady-state lag is about 0.095 s × speed (roughly 12 ft at 130 ft/s). Shots and passes arrive late, and saves and receptions happen before the puck gets there. | `saveprobe.json` (`maxRenderLagLast1s` 6–27 ft); `rink3dRenderer.ts renderAt()` springs `puckRenderX/Z` with `PLAYER_FOLLOW_HL` | **major** | The spring was meant for the carried-puck offset but applies to a free puck too. Fix: when the puck is loose, follow the stream sample directly and spring only the carried to loose handoff. | **S** | N (a pure renderer fix) |
| C3 | **The carried puck is off the blade**: 31.6% of carried frames have the blade more than 1.5 ft from the puck (p90 2.8 ft). The yellow carrier ring sits around a puck with no stick on it. | vprobe; `sheets/pass_close.png` #2–#3, `sheets/hit_close3.png` #0 | **major** | The puck target is `puckCarriedOffset(angle)`, a fixed body offset, while the clips and IK move the actual `stick_blade` bone elsewhere. Fix: put the puck on the blade bone's world position after the pose is applied. | **S–M** | N |
| C4 | **The puck teleports** at stoppages: rendered speeds of 290–425 ft/s at clock 1093.9, and at goals it snaps to the net centre (−91, 0) on every goal, whatever corner it went in. | vprobe `puckTeleports`; `stream_seed3.json` goals | minor | Stoppage snapping in the timeline, and the engine's goal position. | S | P (M1) |
| C5 | **The puck sits alone at the faceoff dot** before the players arrive: up to 14 s in one case, and the follow cam frames an empty dot. There is no linesman and no puck drop. | `sheets/faceoff_follow.png` #0–#3, `stream_seed3.json` (`puckAloneMax` 14) | minor | The engine places the puck at the next dot on the whistle; there are no officials. | S (hide or hold the puck until the drop) + M (a linesman figure) | P |
| C6 | **Visibility is good** at every camera: black puck on white ice plus the carrier halo. The halo is a gamey but readable choice; FM uses a similar ball highlight. | all stills | (positive) | — | — | — |

### D. Camera

| ID | Observed | Evidence | Sev | Likely root cause | Size | Agent engine? |
|---|---|---|---|---|---|---|
| D1 | **The follow camera whips**: yaw p95 150°/s, peaks of 3 856°/s, 19% of frames above 90°/s. It orbits 180° in about 2 s when the carrier changes or turns, and at a faceoff it cut to a frame filled with ice. | `camprobe.json`, `sheets/follow_faceoff_fine.png` #4–#11 | **major** | `cameraTargetFor('follow')` places the camera 28 ft behind the carrier's **facing angle** (`carrierAngle`), which flips with every turn and every change of carrier. Fix: follow along smoothed puck velocity, or keep a fixed broadcast-side offset. | S | N |
| D2 | **The endzone camera flies through the rink**: when the puck crosses ±15 ft the preset swaps ends, and the spring flies the camera about 220 ft at a height of 14 ft through the players (272 ft/s, 43 902°/s yaw). The bottom of the video board is in frame, and the near glass cap rail cuts across the frame at head height. | `camprobe.json`, `shots/ez_t30.png`, `sheets/goal_endzone.png` | major | `endzoneChooseEnd` flips the side and `springStep` interpolates it. Fix: make the swap a hard cut, lower the rail or put the camera above it, and tilt so the board is out of frame. | S | N |
| D3 | **The broadcast camera doesn't frame zone play.** It uses a fixed 30° FOV and a fixed height and depth (`py 50, pz −100`), and pans only 80%. Offensive-zone play ends up small in the top corner, the crowd fills the top third, and the puck is off-screen 6.2% of the time (near the edge another 8.3%). There is no zoom-in on zone play and no slot framing. | `sheets/shot_bc.png`, `shots/goal0_bc.png`, vprobe | **major** | `cameraTargetFor('broadcast')` ignores the zone: no dolly or zoom on depth, and the pan gain is 0.8. | M | N |
| D4 | **There are no replays and no highlight mode.** A goal gets only a 4.2 s push-in (broadcast preset only). There are no alternate angles or replay clock, no cut to the scorer or the bench, and no dynamic highlight selection. FM26 builds its match day around these. | code (`activateCue` goal branch); RENDER3D-UPGRADE.md "No instant replay yet" | **major** | Not built (a renderer-internal replay clock is allowed by the contract). | L | N (M5 lists replays) |
| D5 | **The overhead camera** is readable as a tactics view but tiny at 720p. A white key-light glare hotspot sits at the bottom centre of the ice, and the name plates are illegible grey slivers. | `shots/ov_t30.png` | minor | Key-light specular and bloom (the glare is noted as known in the docs), and labels are world-sized. | S | N |
| D6 | **Broadcast smoothness is excellent**: max yaw 10°/s, 1 pan reversal in 20 s, max camera speed 11 ft/s. | `camprobe.json` | (positive) | — | — | — |

### E. HUD labels and overlays

| ID | Observed | Evidence | Sev | Likely root cause | Size | Agent engine? |
|---|---|---|---|---|---|---|
| E1 | **Name labels are world-sized sprites with no depth test.** In close cameras they are huge and float far above heads ("Reilly" in mid-ice in the endzone cam; "Larsson" hovering over the wrong player in the follow cam). At broadcast distance they are unreadable 7 px text. They overlap in 77% of frames and stack into unreadable piles at celebrations and scrums. | `shots/ez_t30.png`, `shots/fo_t30.png`, `shots/face_home0.png` ("Carlsson/Persson" stacked), `sheets/goal_celly_close.png` top row, vprobe `labelOverlapFrameFrac 0.773` | **major** | `makeLabelSprite()` uses a fixed 4.4×1.1 ft world scale with `depthTest: false`, and nothing de-conflicts overlaps. Fix: screen-space labels with a constant pixel size and collision avoidance, shown only for the carrier and key players, as FM does. | M | N |

### F. Arena and atmosphere

| ID | Observed | Evidence | Sev | Likely root cause | Size | Agent engine? |
|---|---|---|---|---|---|---|
| F1 | **The crowd is blocky.** About 13k fans are cone-and-cube "chess pieces" with d6-dice heads. They pass at broadcast distance (though they fill a third of the frame), but look crude in the follow, endzone and close shots. | `shots/fo_t30.png`, `shots/face_home0.png`, `shots/bc_t30_play.png` | major (it takes up so much of the frame) | Low-poly instancing (known issue in the docs). Fix: sprite impostors, or a few mesh variants plus colour and clothing variety. | M | N |
| F2 | **Bench teammates are white or blue cubes** ("Lego blocks") with polyhedron heads. Players who leave the ice never appear on the bench, and the bench never reacts. | `shots/fo_t30.png` right side, `sheets/bench.png`, `shots/bc_t30_play.png` | major | `arena.ts buildBenches()` uses box fans. | M | P (M5 bench reactions) |
| F3 | **The crowd reacts only to goals** (`crowdExcitement(sinceGoal)`): nothing on big saves, hits, near misses, a power play or a pulled goalie. There is **no audio at all.** | `pose.ts crowdExcitement`, grep audio / sound in render3d (none) | major | Not built. | M | P (M3 momentum/crowd hooks; M5 sound) |
| F4 | **No officials** (referees or linesmen) and **no penalty boxes.** Penalised players simply skate to the bench gate. | grep (only the referee's crease is painted) | minor | Not built. | M | N |
| F5 | **Lighting glare**: a hot white specular blob on the ice in the follow and overhead cameras, and the red goal lamp throws a large red glare onto the mid-ice and the boards. | `shots/fo_t30.png`, `shots/ov_t30.png`, `sheets/goal_bc_full.png` #4–#6 | minor | The key-light glint and bloom threshold, and the goal PointLight at 900 intensity. | S | N |
| F6 | **The ice, boards, ads, nets and glass are good**: rulebook markings, a believable net and mesh, readable dasher ads, and reflections. | all stills | (positive) | — | — | — |
| F7 | **GL warning on every load**: `GL_INVALID_OPERATION: Mismatch between texture format and sampler type`, plus X4122 shader precision warnings. | batch output | polish | Pre-existing (noted in BLENDER-PIPELINE §7). Probably a shadow or depth sampler bound to a float texture. | S | N |

### G. Performance

| ID | Observed | Evidence | Sev | Likely root cause | Size | Agent engine? |
|---|---|---|---|---|---|---|
| G1 | **Laptop-class CPU headroom has regressed.** Endzone with 4× CPU throttle runs avg 18.1 ms and p95 34.9 ms (about 29 fps at p95), with 16.5 ms of CPU per frame; the docs recorded 12.0 / 16.7 before the owner models. | `shot.mjs --perf --1080 --cpu4` | minor (dev box 7 ms) → **major on target hardware** | 26 skinned 29k-tri meshes with no LOD, owner full-body locomotion blending plus IK per rig, and 13k crowd instances. | M | N |
| G2 | **Load time 5.9–8.4 s** to ready in the harness (this includes simulating the whole game up front). | `perfv.txt` | minor | Pre-simulating the full game (M4 plans chunked simulation), plus asset decode. | M | **Y (M4 live chunked sim)** |
| G3 | **On the dev box, steady-state pacing is fine**: uninstrumented, 0 frames above 50 ms, p99 about 16.8 ms, JS heap about 100 MB. | `perfv.txt` | (positive) | — | — | — |

---

## 3. Benchmark: what "FM 3D quality" means here

**FM24** ([FM Scout: FM24 match engine upgrades](https://www.fmscout.com/a-fm24-match-engine-upgrades.html)) brought:
- motion matching to pick context-appropriate animations
- IK driven by real captured data
- better locomotion and rotation
- off-the-ball movement such as half-turn receptions
- rewritten ball physics (drag, spin, friction)
- upgraded lighting

**FM26**, on Unity ([SI: FM26 match day](https://www.footballmanager.com/fm26/features/where-storytelling-evolves-fm26s-match-day-experience), [Operation Sports](https://www.operationsports.com/football-manager-26-showcases-major-matchday-overhaul/), [DSOGaming first look](https://www.dsogaming.com/videotrailer-news/heres-your-first-look-at-the-new-3d-engine-of-football-manager-26/), [Wikipedia](https://en.wikipedia.org/wiki/Football_Manager_26)), brought:
- 300+ new animations, including volumetric on-ball captures from real matches (Hawk-Eye)
- goalkeeper animation that mixes mocap with physics
- a Broadcast mode with multiple camera points and cinematic angles
- revamped replays, with the angle chosen by goal type
- a Dynamic Highlight mode
- new character models, kits and hair
- new lighting, pitch shader and stadiums
- an embedded 2D overview and data cards
- more real sounds

**How The Show compares**
- **Already comparable to FM**:
  - a calm broadcast camera (D6)
  - kit readability (A4)
  - the arena dressing (F6)
  - a strong goalie model (A6)
- **Clearly below FM**:
  - the ball/puck physics equivalent: the puck is flat and lagging (C1, C2, B2)
  - action readability, so that shots, saves and hits are *seen* to happen (B1–B3)
  - animation coverage and context selection (B4, B5)
  - broadcast direction: framing, cuts and replays (D3, D4)
  - label and overlay design (E1)
  - sound and crowd reaction (F3)

**Hockey-game bar** (EA NHL is explicitly *not* the target; readable, believable broadcast is): what matters is that the puck is where the stick is, that a shot visibly leaves the blade and reaches the goalie, that hits show contact, and that the camera keeps the puck in a sensible part of the frame. That makes the top of the list the puck and contact truth (C2, C3, B1, B2, C1), then framing and replays, then models and atmosphere.

---

## 4. Ranked top 15

| Rank | ID | Finding | Sev | Size | Fixed by agent engine? |
|---|---|---|---|---|---|
| 1 | **C2** | The rendered puck lags up to 27 ft (0.08 s spring on a loose puck), so every save and reception happens before the puck arrives. | major | **S** | N (renderer) |
| 2 | **B2** | Saves fire with the puck a median 13 ft away (stream about 9 ft, plus render lag). | blocker | M | Y (M1) + C2 |
| 3 | **B1** | Shots don't read: the puck leaves 0.15–0.25 s before the swing, the shooter is never the carrier at the event, and there is no visible release. | blocker | M | P (M1/M5 need a release field) |
| 4 | **C1** | The puck never leaves the ice (a flat slide on every shot and goal). | blocker | M | Y (M1 + additive z) |
| 5 | **B3** | Hits aren't readable: no contact, no reaction, bodies pass through. | blocker | L | Y (M3) |
| 6 | **C3** | The carried puck is off the blade 32% of the time (fixed offset, not the blade bone). | major | S–M | N |
| 7 | **A1** | Faces are tinted in team colour (the gear accent shader recolours the skin). | major | **S** | N |
| 8 | **D1** | The follow camera whips (p95 150°/s, peaks 3 856°/s, 180° orbits on carrier changes). | major | S | N |
| 9 | **E1** | Labels are world-sized with no depth test, overlapping in 77% of frames, huge up close and illegible at broadcast. | major | M | N |
| 10 | **D3** | The broadcast camera doesn't zoom or frame zone play; action is small in the top corner and the puck is off-screen 6%. | major | M | N |
| 11 | **A3** | Body interpenetration in 22% of frames (net front, hits). | major | L | Y (M1) |
| 12 | **B4 / B5** | Missing actions (stickhandle, receive, deke, poke, battles, T-push, freeze, fights, bench), and the owner/Blender clip-style mismatch. | major | L | Y (M2–M5) / N (assets) |
| 13 | **D4** | No replays, highlight mode or cut direction for goals. | major | L | N |
| 14 | **B6 / B7** | Yaw twitch fails the gate (0.118 and 0.126), and about one hockey stop per second across the ice. **[engine steering in progress]** | major | — | Y (M1) |
| 15 | **D2** | The endzone camera flies about 220 ft through the rink on a side swap; the board and cap rail are in frame. | major | S | N |

**Next five, outside the top 15:**
- F1 / F2: blocky crowd and Lego-block bench.
- F3: crowd reacts only to goals, and there is no audio.
- A2: the upright cane idle (in progress).
- G1: laptop CPU regression and no LOD.
- B9: clone celebrations.

**Quick wins** (all S, renderer-only, and independent of the new engine): C2, A1, D1, D2, and the C3 blade-bone puck, which is S–M.
