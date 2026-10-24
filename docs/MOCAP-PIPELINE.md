# Video mocap pipeline (pilot)

Real motion from legally usable video, solved onto our own skater rig by code.
The owner's licensed Fab pack is hand-keyed (14 clips, no stickhandling, no
slapshot) and AI hand-keying from reference has failed repeatedly, so this
pilot asks: can we get usable hockey motion from stock footage?

**Status (2026-10-18):** pilot. Three clips (`mocap_skate_stride`,
`mocap_stickhandle`, `mocap_shot_wrist`) are in the Blender build and the
animation catalogue, OFF by default. Turn them on with the renderer option
`mocap: true` (3D harness: `?mocap=1`). Quality notes are at the end.

## Sources and licences

| What | Where | Licence |
|---|---|---|
| Pexels 6340276 "Ice Hokey Player Skating" (Tony Schnagl) | https://www.pexels.com/video/ice-hokey-player-skating-6340276/ | Pexels licence |
| Pexels 6339375 "Ice hockey team training, dribbling" (Tony Schnagl) | https://www.pexels.com/video/ice-hockey-team-training-dribbling-6339375/ | Pexels licence |
| Pexels 40168220 "Ice hockey training with skaters and coaches" (Polina Istomina) | https://www.pexels.com/video/ice-hockey-training-with-skaters-and-coaches-40168220/ | Pexels licence |
| Pexels 6340068 "Players practicing before an ice hockey match" (Tony Schnagl) | https://www.pexels.com/video/players-practicing-before-a-ice-hockey-match-6340068/ | Pexels licence |
| Pexels 6848071 "Man playing ice hockey" (Tima Miroshnichenko) | https://www.pexels.com/video/man-playing-ice-hockey-6848071/ | Pexels licence |
| Pexels 6338358 "Two players during an ice hockey match" (Tony Schnagl) | https://www.pexels.com/video/two-players-during-an-ice-hockey-match-6338358/ | Pexels licence |
| MediaPipe (Python package, pinned `mediapipe==0.10.21`) | https://github.com/google-ai-edge/mediapipe | Apache-2.0 |
| Pose Landmarker Heavy model (`pose_landmarker_heavy.task`) | https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task | Apache-2.0 (model card "MediaPipe BlazePose GHUM 3D", "Licensed under") |

Pexels licence: https://www.pexels.com/license/ — free to use, modification
allowed, attribution not required; unaltered copies may not be resold or
redistributed. **The clips themselves are never committed.** They live in
`K:/mocap-lab/` (outside the repo) with a manifest of URLs, sizes and SHA-1s.
What the repo carries is derived: per-frame joint tracks
(`scripts/blender/mocap/*.json`, positions of a generic skeleton, no imagery)
and the clips solved from them onto our own rig (`src/render3d/assets/skater.glb`).
Credit (not required, but kind): footage by Tony Schnagl, Tima Miroshnichenko
and Polina Istomina on Pexels.

Not used: the Roboflow "hockey-stick-segmentation" dataset (CC BY 4.0 on its
page, but the export needs a signed-in Roboflow account, so it was skipped),
any NHL/SHL or other broadcast footage, the McGill / VIP-HTD datasets.

## Layout

```
K:/mocap-lab/                       (outside the repo, never committed)
  raw/        the Pexels downloads + downloads.json (url, bytes, sha1)
  models/     pose_landmarker_heavy.task
  .venv/      Python 3.12 venv, mediapipe pinned (requirements.lock.txt)
  scripts/    download + eyeballing helpers (download_pexels.py, montage.py)
  work/       pose/*.npz, tracks/*.json, previews, reel frames
  MANIFEST.md licences, URLs, sizes, hashes

scripts/mocap/                      (repo: pipeline code)
  extract.py         video -> MediaPipe landmarks (.npz), run in the venv
  contact.py         contact sheet per video (segment picking)
  process.py         landmarks -> clean renderer-space joint track (JSON)
  viz.py             stick-figure strip of a track
  preview_blender.py headless Workbench strips of the solved clips vs the authored ones
  metrics_blender.py jitter / skate slide / sink / blade-on-ice / loop seam per clip
  capture.mjs        frozen-pose frames from the 3D harness (headless Chrome)
  reel.py            side-by-side contact sheets + compare.mp4
  strip.py           assemble preview strips
scripts/blender/mocap.py            track -> rig solve (called from clips.py)
scripts/blender/mocap/*.json        the derived tracks the build solves
```

## Steps

1. **Pick segments.** `contact.py` makes a 12-frame contact sheet per video.
   Usable: 6848071 (one player, full body, fixed camera: stickhandling and
   five shots), the first 1.4 s of 6340276 (a skater striding head-on at the
   camera, full body until he fills the frame). 40168220 has ~0.5 s of a close
   side-on skater under a hard phone pan; 6340068 is a crowded drill; 6338358
   is skates only; 6339375 is a top-down drone shot (no pose).
2. **Landmarks.** `extract.py` runs the Pose Landmarker (VIDEO mode, Heavy)
   on a crop/scale of the frame and stores image + world landmarks for up to N
   people per frame.
3. **Clean-up** (`process.py`):
   - track the main subject (nearest hip centre to the last pick, seedable),
     drop jumps, fill gaps up to 0.2 s;
   - world landmarks -> camera space, feet;
   - Savitzky-Golay filter on every coordinate (window 5-7 at 25 fps);
   - bone-length normalisation (every bone at its median length, rebuilt
     outward from the hips);
   - ground plane: MediaPipe's own up (level camera) by default, a known
     `--tilt`, or `--up ice` = fit through the lowest skate points (only
     well-posed when the skates spread fore-aft; for hip-centred landmarks it
     over-tilted a 25 fps stride by 19 deg, so it is opt-in);
   - knee plausibility: a knee that monocular depth put behind the hip-ankle
     line is reflected to the front (none needed in the pilot clips);
   - camera pan: the heading (pelvis + shoulder line) is held constant per
     clip, or smoothed over `--heading-window` s for a panning camera, and
     taken out; residual hip/torso yaw stays;
   - resample to 30 fps; loops: best matching start/end pair inside a search
     window, then the last third cross-faded into the first frame.
4. **Solve onto the rig** (`scripts/blender/mocap.py`, run by the normal
   `npm run build:athletes`): every bone takes the video segment's DIRECTION at
   the rig's own length. Pelvis = hip line (yaw/roll), torso = spine +
   shoulder line (75% spine / 25% chest), head = ears -> nose (neck/head
   halves), knees solved as hinges (pelvis front when nearly straight), skates
   heel -> toe with the ankle capped at 0.55 rad. Hips drop every frame until
   the lowest skate-runner point is on the ice (contact lock; the skate can
   glide). The owner import (`import_owner_assets.py`) runs the same solve on
   the owner's proportions automatically (local build only).
5. **Stick** (no stick detector): from the hands plus our grip rules. The right
   hand holds the knob; the left hand's sideways/vertical offset from it,
   scaled out to the blade (the bottom hand rides ~45% down the shaft), sets
   where the blade sweeps; the depth comes from the stick length (the blade
   lands where a full-length shaft from the top hand meets the ice, in front).
   A carry/stickhandle blade stays on the ice; a shot's blade stays down
   through the release and lifts with the hands afterwards. Blade and top grip
   are smoothed over 5 frames; then `posekit.solve_stick_arms` (the same code
   the key-pose clips use) places the stick and solves both arms onto it.
6. **Catalogue** (`src/render3d/animCatalog.ts`): `mocap_*` entries carry the
   slot they stand in for (`mocapFor`) and their measured contact frame.
   `withMocapClips()` swaps them in under the slot name, so every rule keyed
   on the slot (stickhandle's puck hold, grounded clips, shot planning) still
   applies.

## Rebuilding

```
# landmarks (venv python, run with -I)
K:/mocap-lab/.venv/Scripts/python.exe -I scripts/mocap/extract.py <video> <out.npz> --poses 1 [--crop x0,y0,x1,y1] [--scale 0.6] [--start F --end F]
# tracks
python -I scripts/mocap/process.py pose/6340276.npz tracks/stride.json --name mocap_skate_stride --source pexels:6340276 --start 0 --end 34 --loop --loop-search 12 --sg 7
python -I scripts/mocap/process.py pose/6848071.npz tracks/stickhandle.json --name mocap_stickhandle --source pexels:6848071 --start 140 --end 196 --loop --loop-search 20 --sg 7
python -I scripts/mocap/process.py pose/6848071.npz tracks/shot.json --name mocap_shot_wrist --source pexels:6848071 --start 193 --end 225 --contact auto --sg 5
# copy tracks to scripts/blender/mocap/<name>.json, then
npm run build:athletes
# check
blender --background --factory-startup --python scripts/mocap/metrics_blender.py -- metrics.json
npx vite --config scripts/dev/render3d-harness/vite.config.mjs --port 5177
node scripts/mocap/capture.mjs <dir> owner "model=owner&loco=clip"            # and &mocap=1, model=blender
python -I scripts/mocap/reel.py <dir> .cache/mocap-pilot
```

Note: the stride slot only shows with `locomotion: 'clip'` (the default
'hybrid' mode keeps the code stride).

## Pilot results (2026-10-18)

Measured on our rig (`metrics_blender.py`, 30 fps; jitter = mean |2nd
difference| of hands, skates, head, blade in ft/frame^2):

| clip | length | jitter | support-skate speed (mean / max ft/s) | skate below ice (ft) | blade on ice | loop seam |
|---|---|---|---|---|---|---|
| mocap_skate_stride | 1.10 s | 0.047 | 3.8 / 10.0 | 0.000 | (lower body only) | 0 (cross-faded from 0.44 ft) |
| skate_stride (key poses) | 0.80 s | 0.057 | 6.5 / 17.7 | -0.138 | (lower body only) | 0 |
| mocap_stickhandle | 2.13 s | 0.030 | (upper body only) | 0.000 | 100% | 0 (raw 0.09 ft) |
| stickhandle (key poses) | 0.67 s | 0.014 | (upper body only) | 0.000 | 100% | 0 |
| mocap_shot_wrist | 1.23 s | 0.065 | (upper body only) | 0.000 | 84% (lifts after release) | - |
| shot_wrist (key poses) | 0.67 s | 0.080 | (upper body only) | 0.000 | 100% | - |

See the reel (`.cache/mocap-pilot/`) and the quality notes in the pilot report.

### Reel

The A/B reel: `.cache/mocap-pilot/` (git-ignored) holds `compare.mp4` and
`compare-<clip>-az<angle>.jpg`: owner body with the current clip, owner body
with the mocap clip, our rig with the current clip, our rig with the mocap
clip; each clip frozen at 12 evenly spaced times, side-on (az 90) and front
three-quarter (az 20). On the owner body the mocap clips are the Blender-rig
solve played through the fallback merge; `npm run import:owner-assets`
re-solves them on the owner's own proportions locally.

### Quality notes

- **Stride:** the best of the three. A real push-recover rhythm (each skate
  pushes out to the side and comes back under the hips), no skate ever under
  the ice (the key-pose stride sinks 0.14 ft between keys), lower jitter than
  the key poses. But it is a short, upright acceleration stride (the skater
  was coming up to speed head-on): less extension and less knee bend than a
  full-speed stride, and the 0.44 ft loop seam is hidden by a cross-fade over
  the last third, which reads as a slight "morph". Depth from a head-on
  camera is the weakest axis; it held here only because the knees stayed
  plausible.
- **Stickhandle:** usable but tame. The source player is mostly receiving and
  settling pucks, so the sweep is small and the stance tall; the top hand
  (right wrist) is hidden behind the body in much of the clip (MediaPipe
  visibility 0.1-0.5), so the stick comes from the grip rules more than from
  the video. The key-pose loop sweeps wider.
- **Wrist shot:** the most alive (real weight shift, hip/shoulder rotation,
  arms through the release), but the blade path is approximate: no stick
  detector, so the blade hugs a reconstructed arc and only lifts after the
  release; and the source shot goes ~45 deg to the shooter's right, so it is
  not aimed straight down his facing.
- **Not usable from this batch:** the overhead drone clip (no pose), the
  crowded drill and the phone-panned training clip (the tracker swaps between
  overlapping skaters), the skates-only close-ups.

## Fights (2026-10-18): footage tried, key poses shipped

The on-ice fight (`src/engine/agent/fight.ts`, `src/render3d/fightChoreo.ts`)
needed paired motion: two men, full body, side-on. Four Pexels clips were
licence-checked and downloaded to `K:/mocap-lab/raw/fights/` (MANIFEST.md):
4761806 "Two men sparring in kick boxing", 4761707, 4761709 (cottonbro studio)
and 8611524 (RDNE Stock project). Only 4761806 shows both men full body and
side-on, and it was not usable:

- the men fill about a quarter of the frame height behind the ring ropes;
  MediaPipe (Heavy, `--poses 2`) tracked both (305 of 340 frames), but
- arm depth is the weak axis exactly where a punch happens (the extension
  lands in the camera axis): forearms solved 0.34-0.67 ft and left/right
  asymmetric, no clean forward extension at the punch peaks;
- filtered jitter 0.11-0.15 ft/frame^2 (the hockey pilot: 0.03-0.06), and the
  guard loop flips the body mid-segment (`K:/mocap-lab/work/fights/tracks/*.png`).

The others are close-ups (no full body) or a stare-down. So the fight clips
(`fight_drop`, `fight_stance`, `fight_grab`, `fight_punch_R`, `fight_punch_L`,
`fight_hit_react`, `fight_clinch`, and the linesmen's `official_separate`) are
authored as key poses in `scripts/blender/clips.py`, upper body only so the
skating legs stay the code's. Nothing from the footage is in the repo.
