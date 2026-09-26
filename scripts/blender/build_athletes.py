"""
Build the rigged hockey athletes (skater + goalie) and their animation clips,
fully headless:

  "C:/Program Files/Blender Foundation/Blender 5.1/blender.exe" --background --factory-startup \
      --python scripts/blender/build_athletes.py -- [--preview] [--out build/blender]

Outputs (build outputs — regenerate, don't hand-edit):
  build/blender/athletes.blend           the working file (open it in Blender to tweak)
  src/render3d/assets/skater.glb         skinned skater + clips
  src/render3d/assets/goalie.glb         skinned goalie + clips
  build/blender/preview-*.png            (--preview) Workbench turnarounds
"""

import os
import sys
import math

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy
from mathutils import Vector, Matrix, Quaternion

import rig
from rig import BONE_NAMES, PARENT, rest_positions, r2b, bone_tail
import meshkit
import body

ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = '--preview' in argv
OUT = os.path.join(ROOT, 'build', 'blender')
ASSETS = os.path.join(ROOT, 'src', 'render3d', 'assets')
os.makedirs(OUT, exist_ok=True)
os.makedirs(ASSETS, exist_ok=True)


def reset_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob)
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.actions, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for x in list(coll):
            coll.remove(x)
    sc = bpy.context.scene
    sc.render.fps = 30
    sc.unit_settings.system = 'IMPERIAL'
    sc.unit_settings.length_unit = 'FEET'
    sc.unit_settings.scale_length = 0.3048  # 1 Blender unit = 1 ft


def make_armature(name, goalie):
    pos = rest_positions(goalie)
    arm = bpy.data.armatures.new(name)
    arm.display_type = 'OCTAHEDRAL'
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for n in BONE_NAMES:
        b = arm.edit_bones.new(n)
        b.head = r2b(pos[n])
        b.tail = r2b(bone_tail(n, pos, goalie))
        b.roll = 0.0
        b.use_deform = True
        eb[n] = b
    for n in BONE_NAMES:
        p = PARENT[n]
        if p:
            eb[n].parent = eb[p]
            eb[n].use_connect = False
    # IK helpers (non-deform → not exported): grip points on the stick shaft
    for gname, along in (('grip_top', rig.RIG['stickLen'] - 0.3), ('grip_low', 2.6)):
        g = arm.edit_bones.new(gname)
        g.head = r2b(Vector((0, along, 0)))
        g.tail = r2b(Vector((0, along + 0.2, 0)))
        g.parent = eb['stick']
        g.use_deform = False
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in ob.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return ob


def make_athlete(goalie):
    tag = 'Goalie' if goalie else 'Skater'
    arm = make_armature(tag + 'Rig', goalie)
    parts = body.build_parts(goalie)
    me = meshkit.build_object(tag, parts, BONE_NAMES)
    me.parent = arm
    mod = me.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    return arm, me


# ── posing in RENDERER semantics ───────────────────────────────────────────

def set_local(arm, name, q_renderer):
    """Write a renderer-space bone-local rotation onto the Blender pose bone."""
    pb = arm.pose.bones[name]
    rest = pb.bone.matrix_local.to_3x3()
    qb = rig.rot_r2b(q_renderer).to_matrix()
    basis = rest.inverted() @ qb @ rest
    pb.rotation_quaternion = basis.to_quaternion()


def set_hips(arm, pos_r, goalie):
    pb = arm.pose.bones['hips']
    rest_r = rest_positions(goalie)['hips']
    d = rig.C @ (Vector(pos_r) - rest_r)
    pb.location = pb.bone.matrix_local.to_3x3().inverted() @ d


def clear_pose(arm):
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()


# ── preview renders ────────────────────────────────────────────────────────

POSE_SHOTS = {
    False: [('skate_stride', 0), ('skate_stride', 6), ('shot_wrist', 5), ('shot_wrist', 13), ('shot_slap', 9), ('check', 8),
            ('hit_fall', 30), ('getup', 24), ('celly_armsup', 16), ('celly_fistpump', 10), ('faceoff_crouch', 0), ('skate_crossover_L', 10),
            ('skate_back', 6), ('hockey_stop', 12), ('pinned_boards', 15), ('bench_standup', 0), ('salute', 26), ('celly_hug', 16)],
    True: [('g_stance', 0), ('g_butterfly', 10), ('g_glove_save', 6), ('g_blocker_save', 6), ('g_pad_save', 8), ('g_scramble', 22), ('g_dejected', 24)],
}


def preview_poses(arm, tag, goalie, only=None):
    sc = bpy.context.scene
    cam = sc.camera
    target = Vector((0, 0, 2.8))
    a = math.radians(-40)
    cam.location = Vector((math.sin(a) * 19, -math.cos(a) * 19, 5.0))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.resolution_x = 520
    sc.render.resolution_y = 520
    ad = arm.animation_data
    for clip, frame in POSE_SHOTS[goalie]:
        if only and clip not in only:
            continue
        ad.action = bpy.data.actions[clip]
        sc.frame_set(frame)
        sc.render.filepath = os.path.join(OUT, f'pose-{tag}-{clip}-{frame}.png')
        bpy.ops.render.render(write_still=True)
    ad.action = None
    clear_pose(arm)


def preview(arm, me, tag, goalie):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'MATERIAL'
    sc.display.shading.show_cavity = True
    sc.render.resolution_x = 900
    sc.render.resolution_y = 900
    sc.render.film_transparent = False
    cam_data = bpy.data.cameras.get('PreviewCam') or bpy.data.cameras.new('PreviewCam')
    cam_data.lens = 70
    cam = bpy.data.objects.get('PreviewCam') or bpy.data.objects.new('PreviewCam', cam_data)
    if cam.name not in sc.collection.objects:
        sc.collection.objects.link(cam)
    sc.camera = cam
    target = Vector((0, 0, 3.1))
    for label, az in (('front34', -35), ('back34', 150), ('side', 90)):
        a = math.radians(az)
        d = 17
        cam.location = Vector((math.sin(a) * d, -math.cos(a) * d, 4.4))
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(OUT, f'preview-{tag}-{label}.png')
        bpy.ops.render.render(write_still=True)


def export_glb(arm, me, path):
    bpy.ops.object.select_all(action='DESELECT')
    arm.select_set(True)
    me.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_yup=True, export_texcoords=True, export_normals=True,
        export_materials='EXPORT', export_vertex_color='NONE',
        export_skins=True, export_def_bones=True, export_leaf_bone=False,
        export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
        export_frame_step=1, export_optimize_animation_size=True, export_reset_pose_bones=True,
        export_rest_position_armature=True, export_anim_slide_to_zero=True, export_extras=False,
    )


def main():
    import clips
    for goalie in (False, True):
        tag = 'goalie' if goalie else 'skater'
        reset_scene()
        arm, me = make_athlete(goalie)
        clips.author_all(arm, goalie)
        if PREVIEW:
            arm.animation_data.action = None
            clear_pose(arm)
            preview(arm, me, tag, goalie)
            preview_poses(arm, tag, goalie)
            bpy.context.scene.frame_set(0)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, f'{tag}.blend'))
        export_glb(arm, me, os.path.join(ASSETS, f'{tag}.glb'))
    print('BUILD OK')


main()
