"""
Quality numbers for the mocap clips vs the clips they stand in for, measured on
the skater rig in headless Blender (the same actions the .glb exports):

  blender --background --factory-startup --python scripts/mocap/metrics_blender.py -- [out.json]

  jitter     mean |second difference| of hands, skates, head and blade (ft / frame^2 at 30 fps)
  slide      support skate's horizontal speed (ft/s) - an in-place loop's skate should move
             only as much as a real push/glide does; the sim's travel is added by the renderer
  sink       lowest skate point min/max height over the clip (ft) - 0 = on the ice
  bladeIce   share of frames the stick blade is within 0.15 ft of the ice
  seam       loops: mean bone-position gap between the last and first frame (ft)
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.normpath(os.path.join(HERE, '..', 'blender')))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else None
sys.argv = [sys.argv[0]]

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
import build_athletes as ba  # noqa: E402
import clips  # noqa: E402
import rig  # noqa: E402

PAIRS = [('mocap_skate_stride', 'skate_stride'), ('mocap_stickhandle', 'stickhandle'), ('mocap_shot_wrist', 'shot_wrist')]
WANT = {n for p in PAIRS for n in p}

ba.reset_scene()
arm, me = ba.make_athlete(False)
clips.ONLY = WANT
arm.animation_data_create()
clips.skater_clips(arm)
clips.ONLY = None
sc = bpy.context.scene
ad = arm.animation_data
TRACK = ['hand_L', 'hand_R', 'foot_L', 'foot_R', 'head', 'stick_blade']


def world(pb, local=Vector((0, 0, 0))):
    return rig.b2r(arm.matrix_world @ pb.matrix @ local)


def sample(name):
    act = bpy.data.actions[name]
    ad.action = act
    f0, f1 = (int(v) for v in act.frame_range)
    frames = []
    for fr in range(f0, f1 + 1):
        sc.frame_set(fr)
        P = {b: world(arm.pose.bones[b]) for b in TRACK}
        # skate runner points under each foot (posekit.blade_points, in bone space)
        runner = {}
        for ft in ('foot_L', 'foot_R'):
            pb = arm.pose.bones[ft]
            pts = []
            for z in (-0.34, 0.16, 0.68):
                # renderer-space offset (0, -skate+0.035, z) under the foot joint, as a Blender bone-local point
                off_r = Vector((0, -rig.RIG['skate'] + 0.035, z))
                pts.append(world(pb, pb.bone.matrix_local.to_3x3().inverted() @ rig.r2b(off_r)))
            runner[ft] = pts
        blade = arm.pose.bones['stick_blade']
        frames.append((P, runner, world(blade)))
    return frames, act.frame_range


def metrics(name):
    fr, rng = sample(name)
    n = len(fr)
    jit = []
    for t in range(1, n - 1):
        for b in TRACK:
            jit.append((fr[t + 1][0][b] - 2 * fr[t][0][b] + fr[t - 1][0][b]).length)
    lows = [min(p.y for ft in ('foot_L', 'foot_R') for p in fr[t][1][ft]) for t in range(n)]
    slide = []
    for t in range(1, n):
        # support skate = the one with the lowest runner point this frame
        sup = min(('foot_L', 'foot_R'), key=lambda ft: min(p.y for p in fr[t][1][ft]))
        a = sum(fr[t][1][sup], Vector()) / 3
        b = sum(fr[t - 1][1][sup], Vector()) / 3
        slide.append(Vector((a.x - b.x, 0, a.z - b.z)).length * 30)
    blade_ice = sum(1 for t in range(n) if fr[t][2].y < 0.15) / n
    seam = sum((fr[-1][0][b] - fr[0][0][b]).length for b in TRACK) / len(TRACK)
    return {
        'frames': n,
        'seconds': round((n - 1) / 30, 2),
        'jitter': round(sum(jit) / len(jit), 4),
        'slideMean': round(sum(slide) / len(slide), 2),
        'slideMax': round(max(slide), 2),
        'sinkMin': round(min(lows), 3),
        'sinkMax': round(max(lows), 3),
        'bladeIce': round(blade_ice, 2),
        'seam': round(seam, 3),
    }


res = {}
for m, base in PAIRS:
    for k in (m, base):
        if k in bpy.data.actions:
            res[k] = metrics(k)
            print('METRIC', k, json.dumps(res[k]))
if OUT:
    with open(OUT, 'w') as fh:
        json.dump(res, fh, indent=1)
print('METRICS OK')
