# Match data sources — what "real hockey" the scorecard is measured against

*M0 of docs/MATCH-ENGINE-PLAN.md. Written 2026-09-26. Owner's goal: "we have numerically what should happen, but we need to replicate what that realistically LOOKS like."*

This file lists every source considered, its licence verdict for a **commercial** game in a **public** repo, and what (if anything) was derived. The scorecard's targets live in `src/calibrate/matchTargets.json` (aggregates and bands only). Each target carries a `confidence` tag:

| Confidence | Meaning |
|---|---|
| measured | Derived from real NHL data (aggregates only). |
| derived | Arithmetic on measured aggregates. |
| published | A public figure noted by hand from a cited source. |
| estimate | Expert or physics estimate with a wide band. Replace it when a legal source exists. |
| design | An owner or design requirement, not an NHL fact (motion gates, no backward passes on breakaways). |

## Headline finding

**No frame-level hockey tracking data is licensed for commercial use.** Every public player-trajectory dataset is either research-only or built from NHL broadcast video. So today the "what it looks like" ground truth comes from three places:

1. **Event-level NHL aggregates.** Where events happen, such as hits (94% within 10 ft of the boards), shots (distance × angle grid), faceoffs and entries. These come from the play-by-play sample the calibration importer had already cached (legal flag below).
2. **Coaching-system role templates.** These are our own coordinates for breakout, forecheck, regroup, rush, cycle, PP and PK shapes (`src/engine/analysis/shapes.ts`), scored as a shape error in feet.
3. **Published facts and physics.** Top speeds, shift lengths, turning grip and zone-entry research go into estimate bands.

The long-term route to real trajectories is **our own tracking of footage we have rights to** (CV pipeline spec below), or a **commercial licence** (Sportlogiq / Stathletes / NHL).

---

## 1. Frame-level tracking datasets

| Source | Contents | Licence (checked 2026-09-26) | Verdict |
|---|---|---|---|
| **Stathletes Big Data Cup**: github.com/bigdatacup, repos 2021 (= 2022 edition), 2024, 2025, 2026 | 2022: women's Olympic games, event data **plus player tracking generated from broadcast video** (6 games, `TrackingData/`, with PP info and a PBP join notebook). 2024: women's event data + shifts. 2025/26: event data. | `legal.md`, "Stathletes Public Data User Agreement": data is for research, and research may be shared "provided that said research is not used for profit". No OSS licence on the repos. | **NOT USED.** Non-commercial. Nothing downloaded, nothing derived. Documented only. |
| **VIP-HTD** (Univ. of Waterloo VIP lab hockey tracking) | 22 broadcast clips from 8 NHL games, 30/60 Hz, with MOT boxes | Academic research release; the underlying footage is NHL broadcast (NHL copyright) | **NOT USED.** Research-only, and the source video is NHL-owned. |
| **HockeyOrient / HockeyRink** (ACM MMSys 2025 datasets) | Orientation labels and rink keypoints on broadcast frames | Research releases on broadcast footage | **NOT USED** for data. Useful as *method* references for the CV pipeline. |
| Other academic papers ("Player tracking and identification in ice hockey", "Multi Player Tracking in Ice Hockey with Homographic Projections", etc.) | Methods; data mostly private or NHL-broadcast | Research | Method references only. |

If a commercial-OK tracking source ever appears (a purchased licence, or our own capture), `src/engine/analysis/reference.ts` already converts a neutral `TrackedSequence` into our FrameEvent stream. From there the same analyzer computes role positions, spacing, rush lanes, forecheck closing speed, gaps and pass vectors, per situation, as measured shape targets.

## 2. NHL public API and NHL EDGE

| Endpoint | What it has | Terms | Verdict |
|---|---|---|---|
| `api-web.nhle.com/v1/gamecenter/{id}/play-by-play` | Events with x/y, types, shot types, miss reasons, penalty names, hitter/hittee, faceoff winner/loser, `situationCode`, rosters with positions | Covered by the **NHL.com Terms of Service**. §2 prohibits "unauthorized spidering, scraping, or harvesting of content or information, or use any other unauthorized automated means to compile information". §7 limits use to "non-commercial, informational, personal use". (`api-web.nhle.com` has no robots.txt or terms of its own.) | **No new automated pulls.** The M0 brief says to stop using an endpoint whose terms forbid automated use, so M0 did **not** fetch the two seasons of PBP, shift charts or EDGE it originally asked for. |
| `api.nhle.com/stats/rest/en/shiftcharts` | Per-player shift start/end | Same ToS | Not fetched. |
| NHL EDGE (nhl.com/nhl-edge, and the `/v1/edge/...` endpoints behind it) | Skating speed and bursts (20+/22+ mph), distance skated, zone time, shot speed | Same ToS (nhl.com property) | Not fetched. A few widely published facts were noted by hand (fastest skaters ≈ 24–25 mph; teams spend ≈ 17–18% of time in the neutral zone). They are cited as `publicStatPages` / `published` or `estimate`. |

**Legacy data, flagged for owner/legal review.** `src/calibrate/targets.json` was built by an earlier session (`src/calibrate/importNhl.ts`, 2026-06-11) from 60 evenly spaced 2023-24 games fetched from the play-by-play endpoint. The raw JSON sits in the git-ignored `.cache/nhl/` of the main checkout (64 games). M0 **re-read that existing local cache** (no network) with `scripts/data/derive-nhl-pbp.mjs` and wrote `src/calibrate/nhlPbpAggregates.json`, which holds aggregates only:

- hits: 22.5 per team-game, **94.3% within 10 ft of the boards** (83.7% within 5 ft), **34.5% thrown by defencemen**, 44% in the hitter's offensive zone and 45% in his defensive zone;
- penalties: 3.70 per team-game across **27 distinct infraction names** (tripping, hooking, roughing, slashing, high-sticking, interference and holding lead); 0.23 fights per game;
- shots: 13.9 missed per team-game (32% of unblocked attempts); type mix wrist 55%, snap 13%, slap 12%, tip 8%, backhand 7%; miss reasons (wide 75%, high 17%, post/bar 6%);
- faceoffs: 54.9 per game; the winning team gets an unblocked attempt within 10 s after **14.3%** of faceoffs.

The committed files are facts and aggregates; nothing raw is committed. Automated collection and commercial use of NHL data is nonetheless a live ToS question for a commercial Steam game. **Owner decision needed:** keep these aggregates (common practice in hobby analytics, but not licensed), replace them with a licensed feed, or replace them with our own tracked data. The scorecard marks every target that comes from them as `nhlApiLegacy`.

## 3. Published research and facts (cited, not copied)

| Id | Source | Used for |
|---|---|---|
| zoneEntryTracking | Tulsky, Detweiler, Spencer, Sznajder, "Using Zone Entry Data To Separate Offensive, Neutral, And Defensive Zone Performance" (MIT Sloan SAC 2013) and follow-up volunteer tracking | Controlled-entry share band (≈ half of entries are carried or passed in) |
| publicStatPages | NHL.com averages for TOI per shift (forwards ≈ 0:40–0:48, D ≈ 0:45–0:55) and EDGE public leaderboards | Shift-length, top-speed and NZ-time bands |
| sportsScience | Skating biomechanics literature: on-ice sprint acceleration ≈ 3–6 m/s², lateral grip ≈ 1 g or less, in-game top speeds 20–25 mph | Kinematic estimate bands |

## 4. Coaching-system templates (our own diagrams)

`src/engine/analysis/shapes.ts` holds seven situation snapshots. Each gives the puck position plus all ten skaters, in feet, in the possessing team's attack frame with the puck side mirrored to +Y. The concepts were checked against USA Hockey and Hockey Canada coach-education team-play material and standard coaching texts. **No diagrams or text were copied; the coordinates are ours.**

| Template | Possessing team | Defending team |
|---|---|---|
| `breakoutWall` | D1 retrieves in the corner, D2 net-side, strong W on the half-wall, C swinging low, weak W stretching the mid-lane | 1-2-2 forecheck: F1 pressure, F2 strong-side wall, F3 high, both D holding the blue line |
| `ozLowCycle` | F1 on the wall low, F2 low support, F3 net-front, D on the points | Box+1: strong D on the puck, weak D net-front, C low strong-side, wingers covering the point lanes and high slot |
| `ozPointShot` | D walking the line, net-front screen, wall and weak-side low support | Wingers pressure the points; C in the slot; D low |
| `nzRegroup` | D-to-D regroup, forwards swinging wide / middle / wide | 1-2-2 neutral-zone forecheck: F1 steers, F2/F3 in the lanes, D with gap |
| `rushEntry` | 3-lane rush: wide carrier, middle drive, far-lane drive, D trailer | 2 D gapping up, two backcheckers, one late forward |
| `pp131` | 1-3-1 power play: half-wall flank with the puck, Q up top, weak-side one-timer flank, bumper, net-front | PK box shading the strong side |
| `ppUmbrella` | Umbrella: point plus two flanks up top, net-front, low bumper | PK diamond |

For the **lead engine agent**, these are the target pictures its agents' role logic should produce. The scorecard reports, per role, the mean offset (sim − template) in feet, so it can see which role is systematically out of position. The engine plan also calls for 2-1-2 and 1-3-1 trap forechecks, a reverse breakout, a stretch breakout and a PK diamond at 5v4 with the puck low. They are straightforward to add as further `ShapeTemplate` entries; add them when the agent engine has those systems.

## 5. Computer-vision tracking pipeline (design only; not built)

This is the long-term legal source of real trajectories. **The footage-rights rule:** run it only on footage we own or have written permission to use, such as games we film ourselves with league, venue and player (or guardian) consent, or openly licensed clips (CC-BY / CC0) with the licence recorded next to the data. **Never on NHL, AHL or other broadcast video.** Tracks inherit the footage's licence. Nothing tracked goes into the public repo unless that licence allows redistribution; only aggregates are committed.

**Pipeline (fits the owner's RTX 5090):**

1. **Capture.** Record from a fixed, high, wide camera (2 cameras for full-sheet coverage) at 60 fps, 4K. Fixed cameras make homography trivial and avoid broadcast cuts.
2. **Rink registration (homography).** Detect rink keypoints (blue/red/goal lines, faceoff dots, crease) and solve a per-frame homography with OpenCV (Apache-2.0) `findHomography` + RANSAC. For fixed cameras, a one-time manual calibration per venue is enough. For moving cameras, train a keypoint model (HRNet, MIT) on our own labelled frames.
3. **Detection.** Use players, goalies, referees and puck as classes. Pick commercially usable detectors: **RT-DETR** (Apache-2.0, via Hugging Face `transformers`), **RF-DETR** (Apache-2.0), YOLOX (Apache-2.0) or Detectron2 (Apache-2.0). **Avoid Ultralytics YOLOv5/v8/v11** (AGPL-3.0; it needs a paid enterprise licence for a closed commercial product). Fine-tune on our own labelled frames (a few thousand boxes), labelled with **CVAT** (MIT) or Label Studio (Apache-2.0).
4. **Multi-object tracking.** ByteTrack (MIT), OC-SORT (MIT) or BoT-SORT (MIT), via Roboflow `supervision` (MIT) for glue code.
5. **Team and identity.** Separate teams by jersey colour clustering (k-means on torso crops). Read jersey numbers with PARSeq (Apache-2.0) scene-text recognition, and fuse over time with the tracker IDs. The puck needs a dedicated small-object detector plus Kalman gap-filling. Expect puck recall to be the weakest link.
6. **Projection and smoothing.** Map foot points through the homography to rink feet, then smooth with Savitzky-Golay or a constant-acceleration Kalman filter. Output our neutral `TrackedSequence` format (`src/engine/analysis/reference.ts`) at 10–30 Hz.
7. **Situation tagging.** Tag breakout, NZ regroup, entry, cycle, rush, PP/PK and forecheck with the same rules the analyzer uses. Many of them can be derived from positions: puck third, possession team, skater counts.
8. **Derive shape targets.** Use `analyzeGame(trackingToStream(seq))` → role positions relative to the puck per situation, spacing, rush lanes, forecheck closing speed, D gaps and pass vectors. These replace the `estimate` bands with `measured` ones.

Rough effort: about 1–2 weeks to reach usable fixed-camera tracks of a local game, plus labelling time. Test it first on openly licensed footage (search Wikimedia Commons for CC-BY hockey video) before filming.

## 6. What was derived, where

| Artifact | Content | Committed? |
|---|---|---|
| `src/calibrate/targets.json` | Legacy NHL aggregates (rates, xG grid, sequence proxies) | yes (pre-existing) |
| `src/calibrate/nhlPbpAggregates.json` | Hit locations/positions/zones, penalty and shot-type mixes, miss reasons, faceoff follow-ups | yes (aggregates only) |
| `src/calibrate/matchTargets.json` | All scorecard targets, bands, sources and confidence; NHL shot grid | yes |
| `.cache/nhl/*.json` | Raw PBP cache | **no** (git-ignored) |
| `.cache/replay/*.html` / `*.stream.json` | Eye-test pages and reference streams | **no** (git-ignored, regenerated by `npm run scorecard`) |

Scripts: `scripts/data/derive-nhl-pbp.mjs` reads a local cache and makes no network calls. `scripts/data/build-match-targets.mjs` builds `matchTargets.json` (also available as `npm run scorecard:targets`).
