"""
Headless Blender preview of the mocap clips on the skater rig (Workbench), next
to the key-pose clip each one stands in for:

  blender --background --factory-startup --python scripts/mocap/preview_blender.py -- <outdir> [clip ...]

Writes <outdir>/<clip>-<view>-fNN.png frames (the montage is assembled outside).
"""
import os
import sys
import math

HERE = os.path.dirname(os.path.abspath(__file__))
BL = os.path.normpath(os.path.join(HERE, '..', 'blender'))
sys.path.insert(0, BL)

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(HERE, 'preview')
WANT = argv[1:] or ['mocap_skate_stride', 'skate_stride', 'mocap_stickhandle', 'stickhandle', 'mocap_shot_wrist', 'shot_wrist']
os.makedirs(OUT, exist_ok=True)
sys.argv = [sys.argv[0]]  # build_athletes parses argv on import

import build_athletes as ba  # noqa: E402
import clips  # noqa: E402

ba.reset_scene()
arm, me = ba.make_athlete(False)
clips.ONLY = set(WANT)
arm.animation_data_create()
clips.skater_clips(arm)
clips.ONLY = None

sc = bpy.context.scene
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'MATERIAL'
sc.render.resolution_x = 360
sc.render.resolution_y = 420
cam_data = bpy.data.cameras.new('Cam')
cam_data.lens = 60
cam = bpy.data.objects.new('Cam', cam_data)
sc.collection.objects.link(cam)
sc.camera = cam
ad = arm.animation_data
target = Vector((0, 0, 2.6))
for name in WANT:
    act = bpy.data.actions.get(name)
    if not act:
        print('MISSING', name)
        continue
    ad.action = act
    f0, f1 = (int(v) for v in act.frame_range)
    n = f1 - f0
    step = max(1, n // 8)
    for view, az in (('front', 0), ('side', 90)):
        a = math.radians(az)
        cam.location = Vector((math.sin(a) * 17, -math.cos(a) * 17, 3.4))
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
        for k, fr in enumerate(range(f0, f1 + 1, step)):
            sc.frame_set(fr)
            sc.render.filepath = os.path.join(OUT, f'{name}-{view}-{k:02d}.png')
            bpy.ops.render.render(write_still=True)
print('PREVIEW OK')
