"""
Import OWNER-SUPPLIED rigged athletes (FBX / glTF / .blend) onto the
renderer's named skeleton, fully headless:

  blender --background --factory-startup --python scripts/blender/import_owner_assets.py -- \
      --role skater|goalie [--src assets/3d/incoming] [--out src/render3d/assets/owner] [--preview]

(`npm run import:owner-assets` runs both roles, then owner_textures.py.)

LICENSE: owner assets may ship inside the game but must NOT be redistributed —
the repo is public. Every output of this script is git-ignored
(src/render3d/assets/owner/, build/owner-assets/).

What it does (docs/graphics/BLENDER-PIPELINE.md, "Owner assets"):
 1. import the T-pose skeletal mesh; detect units + facing (report them);
 2. map the source skeleton onto the renderer's 22 bones — auto-detected
    conventions (UE mannequin, Mixamo, Unity humanoid, Rigify DEF-) plus
    `boneMap` overrides in owner_assets.json; every unmapped deform bone
    (fingers, twist, face, helpers) merges into its nearest mapped ancestor;
 3. CONFORM the rest pose to the renderer's convention (arms and legs hang
    straight down; every renderer rest frame is identity) by posing the source
    rig and applying that pose to the meshes — the owner's proportions are
    KEPT (the renderer reads the joint positions from the .glb);
 4. rebuild ONE mesh on a clean renderer-named armature (feet, +Y up in the
    renderer, +Z front), materials own:clothes / own:gear / own:visor, the
    gear textures' UVs packed into a 2×2 atlas (owner_textures.py bakes it);
 5. bind the owner's stick to the renderer's stick / stick_blade bones;
 6. retarget every source clip: world-space deltas from the source rest,
    through the conform rotations, into renderer-semantics local rotations;
    ROOT MOTION STRIPPED (pelvis travel and net yaw detrended — the sim owns
    position and facing); the stick's motion comes along when the file has it;
    clip names map onto the animCatalog slots (fuzzy + `clipMap` overrides),
    contact frames are detected (or pinned via `contact`) and written into the
    action name as `slot@cN`;
 7. export <out>/<role>.glb and build/owner-assets/report-<role>.json.
"""

import os
import sys
import json
import math

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy
from mathutils import Vector, Matrix, Quaternion

import rig
from rig import BONE_NAMES, PARENT
from build_athletes import export_glb, reset_scene

ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []


def arg(name, default=None):
    if name in argv:
        i = argv.index(name)
        return argv[i + 1] if i + 1 < len(argv) else default
    return default


ROLE = arg('--role', 'skater')
GOALIE = ROLE == 'goalie'
SRC = os.path.abspath(arg('--src', os.path.join(ROOT, 'assets', '3d', 'incoming')))
OUT = os.path.abspath(arg('--out', os.path.join(ROOT, 'src', 'render3d', 'assets', 'owner')))
REPORT_DIR = os.path.join(ROOT, 'build', 'owner-assets')
PREVIEW = '--preview' in argv
os.makedirs(OUT, exist_ok=True)
os.makedirs(REPORT_DIR, exist_ok=True)

CFG_ALL = json.load(open(os.path.join(HERE, 'owner_assets.json'), encoding='utf-8'))
CFG = CFG_ALL[ROLE]
BASE = os.path.join(SRC, CFG['dir'])
REPORT = {'role': ROLE, 'source': CFG['dir'], 'warnings': []}
FPS = 30


def warn(msg):
    print('WARN', msg)
    REPORT['warnings'].append(msg)


# ── import ─────────────────────────────────────────────────────────────────

def import_any(path):
    """Import a file; returns the set of NEW objects."""
    before = set(bpy.data.objects)
    ext = os.path.splitext(path)[1].lower()
    if ext == '.fbx':
        bpy.ops.import_scene.fbx(filepath=path, use_anim=True, automatic_bone_orientation=False, ignore_leaf_bones=False)
    elif ext in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == '.blend':
        with bpy.data.libraries.load(path, link=False) as (src, dst):
            dst.objects = list(src.objects)
        for ob in dst.objects:
            if ob is not None:
                bpy.context.scene.collection.objects.link(ob)
    else:
        raise RuntimeError('unsupported asset type: ' + path)
    return [o for o in bpy.data.objects if o not in before]


def main_armature(objs):
    arms = [o for o in objs if o.type == 'ARMATURE']
    if not arms:
        raise RuntimeError('no armature in the imported file')
    return max(arms, key=lambda a: len(a.data.bones))


def skinned_meshes(objs, arm):
    out = []
    for o in objs:
        if o.type != 'MESH':
            continue
        if any(m.type == 'ARMATURE' and m.object == arm for m in o.modifiers) or o.parent == arm:
            out.append(o)
    return out


def delete(objs):
    for o in objs:
        if o.name in bpy.data.objects:
            bpy.data.objects.remove(o, do_unlink=True)


# ── bone mapping ───────────────────────────────────────────────────────────

def norm_name(n):
    n = n.lower()
    if ':' in n:
        n = n.split(':')[-1]
    return n


def _sides(table):
    out = {}
    for k, v in table.items():
        if k.endswith('_L'):
            out[k] = v
            r = k[:-2] + '_R'
            out[r] = [x.replace('left', 'right').replace('_l', '_r').replace('.l', '.r') if ('left' in x or x.endswith('_l') or '_l_' in x or '.l' in x) else x for x in v]
        else:
            out[k] = v
    return out


CONVENTIONS = {
    'ue-mannequin': _sides({
        'hips': ['pelvis'], 'spine': ['spine_01'], 'chest': ['spine_02', 'spine_03', 'spine_04', 'spine_05'],
        'neck': ['neck_01', 'neck_02'], 'head': ['head'],
        'shoulder_L': ['clavicle_l'], 'upperarm_L': ['upperarm_l'], 'forearm_L': ['lowerarm_l'], 'hand_L': ['hand_l'],
        'thigh_L': ['thigh_l'], 'shin_L': ['calf_l'], 'foot_L': ['foot_l'],
    }),
    'mixamo': _sides({
        'hips': ['hips'], 'spine': ['spine'], 'chest': ['spine1', 'spine2'], 'neck': ['neck'], 'head': ['head'],
        'shoulder_L': ['leftshoulder'], 'upperarm_L': ['leftarm'], 'forearm_L': ['leftforearm'], 'hand_L': ['lefthand'],
        'thigh_L': ['leftupleg'], 'shin_L': ['leftleg'], 'foot_L': ['leftfoot'],
    }),
    'unity-humanoid': _sides({
        'hips': ['hips'], 'spine': ['spine'], 'chest': ['chest', 'upperchest'], 'neck': ['neck'], 'head': ['head'],
        'shoulder_L': ['leftshoulder'], 'upperarm_L': ['leftupperarm'], 'forearm_L': ['leftlowerarm'], 'hand_L': ['lefthand'],
        'thigh_L': ['leftupperleg'], 'shin_L': ['leftlowerleg'], 'foot_L': ['leftfoot'],
    }),
    'rigify-def': _sides({
        'hips': ['def-spine'], 'spine': ['def-spine.001'], 'chest': ['def-spine.002', 'def-spine.003'],
        'neck': ['def-spine.004', 'def-spine.005'], 'head': ['def-spine.006'],
        'shoulder_L': ['def-shoulder.l'], 'upperarm_L': ['def-upper_arm.l', 'def-upper_arm.l.001'],
        'forearm_L': ['def-forearm.l', 'def-forearm.l.001'], 'hand_L': ['def-hand.l'],
        'thigh_L': ['def-thigh.l', 'def-thigh.l.001'], 'shin_L': ['def-shin.l', 'def-shin.l.001'], 'foot_L': ['def-foot.l'],
    }),
}
BODY = [b for b in BONE_NAMES if b not in ('root', 'stick', 'stick_blade')]


def detect_bone_map(arm):
    names = {norm_name(b.name): b.name for b in arm.data.bones}
    best, best_map, best_hits = None, None, -1
    for conv, table in CONVENTIONS.items():
        m, hits = {}, 0
        for tgt, cands in table.items():
            found = [names[c] for c in cands if c in names]
            if found:
                m[tgt] = found
                hits += 1
        if hits > best_hits:
            best, best_map, best_hits = conv, m, hits
    for tgt, srcs in (CFG.get('boneMap') or {}).items():
        best_map[tgt] = [s for s in srcs if s in arm.data.bones]
    missing = [b for b in BODY if not best_map.get(b)]
    if missing:
        raise RuntimeError(f'bone map ({best}): no source bone for {missing} — add them to "boneMap" in owner_assets.json')
    REPORT['skeleton'] = {'convention': best, 'sourceBones': len(arm.data.bones)}
    return best, best_map


def merge_table(arm, bmap):
    """source bone name → renderer bone (mapped, or nearest mapped ancestor)."""
    direct = {}
    for tgt, srcs in bmap.items():
        for s in srcs:
            direct[s] = tgt
    out = {}
    for b in arm.data.bones:
        p = b
        while p is not None and p.name not in direct:
            p = p.parent
        out[b.name] = direct[p.name] if p is not None else None
    return out


# ── maths helpers ──────────────────────────────────────────────────────────

def wrot(arm, pb):
    return (arm.matrix_world @ pb.matrix).to_3x3().normalized().to_quaternion()


def wrot_rest(arm, bone):
    return (arm.matrix_world @ bone.matrix_local).to_3x3().normalized().to_quaternion()


def whead(arm, pb):
    return arm.matrix_world @ pb.head


def yaw_of(q):
    """Heading (rad about +Z) of the character's front (−Y) under world rotation q."""
    f = q @ Vector((0, -1, 0))
    return math.atan2(-f.x, -f.y)


def qz(a):
    return Quaternion((0, 0, 1), a)


# ── 1–3: skeleton, units, facing, conform ─────────────────────────────────

def conform(arm, prim_pos):
    """Pose the arms and legs straight down (world −Z), then make that the rest pose."""
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    Mw3i = arm.matrix_world.to_3x3().inverted()
    down = (Mw3i @ Vector((0, 0, -1))).normalized()
    chains = [('upperarm_L', 'forearm_L'), ('forearm_L', 'hand_L'), ('upperarm_R', 'forearm_R'), ('forearm_R', 'hand_R'),
              ('thigh_L', 'shin_L'), ('shin_L', 'foot_L'), ('thigh_R', 'shin_R'), ('shin_R', 'foot_R')]
    applied = {}
    for tgt, child in chains:
        pb = arm.pose.bones[prim_pos[tgt]]
        pc = arm.pose.bones[prim_pos[child]]
        cur = (pc.head - pb.head).normalized()
        r = cur.rotation_difference(down)
        h = pb.head.copy()
        pb.matrix = Matrix.Translation(h) @ r.to_matrix().to_4x4() @ Matrix.Translation(-h) @ pb.matrix
        bpy.context.view_layer.update()
        applied[tgt] = round(math.degrees(r.angle), 1)
    bpy.ops.object.mode_set(mode='OBJECT')
    REPORT['conformDegrees'] = applied
    return applied


def apply_pose_to_meshes(arm, meshes):
    for me in meshes:
        if me.data.shape_keys:
            n = len(me.data.shape_keys.key_blocks)
            bpy.context.view_layer.objects.active = me
            me.shape_key_clear()
            warn(f'{me.name}: removed {n} shape keys (facial/corrective) — not used by the renderer')
        mods = [m for m in me.modifiers if m.type == 'ARMATURE']
        bpy.context.view_layer.objects.active = me
        for m in mods:
            bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='POSE')
    bpy.ops.pose.armature_apply(selected=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def units_scale(hip_z):
    """World hip height → feet. The renderer's hips rest at ~3.3 ft."""
    cands = [(3.28084, 'metres'), (0.0328084, 'centimetres'), (1.0, 'feet'), (0.0833333, 'inches')]
    best = min(cands, key=lambda c: abs(math.log(max(1e-6, hip_z * c[0]) / rig.H)))
    return best


# ── 4: target armature + mesh ──────────────────────────────────────────────

def make_target_armature(name, joints_b):
    """joints_b: renderer bone → Blender-space position (feet)."""
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    up = Vector((0, 0, 0.35))
    child = {'hips': 'spine', 'spine': 'chest', 'chest': 'neck', 'neck': 'head',
             'upperarm_L': 'forearm_L', 'forearm_L': 'hand_L', 'upperarm_R': 'forearm_R', 'forearm_R': 'hand_R',
             'thigh_L': 'shin_L', 'shin_L': 'foot_L', 'thigh_R': 'shin_R', 'shin_R': 'foot_R'}
    for n in BONE_NAMES:
        b = arm.edit_bones.new(n)
        b.head = joints_b[n]
        if n in child and (joints_b[child[n]] - joints_b[n]).length > 0.05:
            b.tail = joints_b[child[n]]
        elif n.startswith(('hand', 'upperarm', 'forearm')):
            b.tail = joints_b[n] + Vector((0, 0, -0.4))
        elif n.startswith('foot'):
            b.tail = joints_b[n] + Vector((0, -0.45, -0.3))
        elif n.startswith('shoulder'):
            b.tail = joints_b[n] + Vector((0.3 if n.endswith('L') else -0.3, 0, 0))
        else:
            b.tail = joints_b[n] + up
        b.roll = 0.0
        b.use_deform = True
        eb[n] = b
    for n in BONE_NAMES:
        if PARENT[n]:
            eb[n].parent = eb[PARENT[n]]
            eb[n].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in ob.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return ob


def gear_uv(q, u, v):
    col, row = q % 2, q // 2
    u = u - math.floor(u) if (u < 0 or u > 1) else u
    v = v - math.floor(v) if (v < 0 or v > 1) else v
    return (col * 0.5 + u * 0.5, (1 - (row + 1) * 0.5) + v * 0.5)


def ensure_mat(name, col):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = col
    return m


CLOTHES_UV = []
OWN_MATS = [('own:clothes', (0.8, 0.8, 0.8, 1)), ('own:gear', (0.6, 0.6, 0.6, 1)), ('own:visor', (0.2, 0.25, 0.3, 1))]


def rebuild_mesh(src_meshes, G, merge, stick_obj):
    """Copy every source mesh into renderer space, remap weights + materials, join."""
    mats = {n: ensure_mat(n, c) for n, c in OWN_MATS}
    parts = []
    tri_before = {}
    uv_wrapped = 0
    for me in src_meshes:
        ob = me.copy()
        ob.data = me.data.copy()
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = None
        ob.modifiers.clear()
        ob.data.transform(G @ me.matrix_world)
        ob.matrix_world = Matrix.Identity(4)
        tri_before[me.name] = sum(len(p.vertices) - 2 for p in ob.data.polygons)
        # decimate if configured
        ratio = (CFG.get('decimate') or {}).get(me.name)
        if ratio:
            bpy.context.view_layer.objects.active = ob
            d = ob.modifiers.new('Decimate', 'DECIMATE')
            d.ratio = ratio
            bpy.ops.object.modifier_apply(modifier=d.name)
        # weights → renderer bones
        vg_names = {g.index: g.name for g in ob.vertex_groups}
        weights = []
        for v in ob.data.vertices:
            w = {}
            for g in v.groups:
                t = merge.get(vg_names.get(g.group))
                if t and g.weight > 1e-5:
                    w[t] = w.get(t, 0.0) + g.weight
            if ob is stick_obj or me is stick_obj:
                pass
            weights.append(w)
        for g in list(ob.vertex_groups):
            ob.vertex_groups.remove(g)
        groups = {b: ob.vertex_groups.new(name=b) for b in BONE_NAMES}
        empty = 0
        for i, w in enumerate(weights):
            top = sorted(w.items(), key=lambda t: -t[1])[:4]
            tot = sum(x for _, x in top)
            if tot <= 0:
                empty += 1
                continue
            for b, x in top:
                groups[b].add([i], x / tot, 'REPLACE')
        if empty:
            warn(f'{me.name}: {empty} vertices had no mapped weight (left on root)')
        # materials → own:*, gear UVs packed
        uvl = ob.data.uv_layers.active
        cats = []
        for slot in ob.material_slots:
            nm = slot.material.name if slot.material else ''
            base = nm.split('.')[0]
            cats.append((CFG['materials'].get(base) or CFG['materials'].get(nm) or 'gear:0'))
        ob.data.materials.clear()
        for n, _ in OWN_MATS:
            ob.data.materials.append(mats[n])
        for poly in ob.data.polygons:
            cat = cats[poly.material_index] if poly.material_index < len(cats) else 'gear:0'
            if cat == 'clothes':
                poly.material_index = 0
                # UV region map for owner_textures.py: sweater vs breezers vs socks
                if 'jersey' in me.name.lower() or 'shirt' in me.name.lower():
                    reg = 'jersey'
                else:
                    acc = {}
                    for vi in poly.vertices:
                        for b, x in weights[vi].items():
                            acc[b] = acc.get(b, 0) + x
                    top = max(acc, key=acc.get) if acc else 'hips'
                    reg = 'socks' if top.startswith(('shin', 'foot')) else 'pants'
                if uvl:
                    CLOTHES_UV.append({'r': reg, 'o': me.name, 'v': list(poly.vertices),
                                       'uv': [[round(uvl.data[li].uv[0], 5), round(uvl.data[li].uv[1], 5)] for li in poly.loop_indices]})
            elif cat == 'visor':
                poly.material_index = 2
            else:
                poly.material_index = 1
                q = int(cat.split(':')[1]) if ':' in cat else 0
                if uvl:
                    for li in poly.loop_indices:
                        u, v = uvl.data[li].uv
                        if u < 0 or u > 1 or v < 0 or v > 1:
                            uv_wrapped += 1
                        uvl.data[li].uv = gear_uv(q, u, v)
        parts.append(ob)
    if uv_wrapped:
        warn(f'{uv_wrapped} gear UVs were outside 0..1 and were wrapped into their atlas cell')
    # one UV layer only
    for ob in parts:
        while len(ob.data.uv_layers) > 1:
            ob.data.uv_layers.remove(ob.data.uv_layers[-1])
        if ob.data.uv_layers:
            ob.data.uv_layers[0].name = 'UVMap'
    bpy.ops.object.select_all(action='DESELECT')
    for ob in parts:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    out = bpy.context.view_layer.objects.active
    out.name = ROLE.capitalize()
    REPORT['trianglesBefore'] = tri_before
    return out


def uv_islands_vote(polys):
    """One region per UV island (majority of its faces): a sock top weighted to
    the thigh still belongs to the sock island."""
    parent = list(range(len(polys)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    seen = {}
    for i, p in enumerate(polys):
        for vi, uv in zip(p['v'], p['uv']):
            k = (p['o'], vi, uv[0], uv[1])
            if k in seen:
                a, b = find(i), find(seen[k])
                if a != b:
                    parent[a] = b
            else:
                seen[k] = i
    votes = {}
    for i, p in enumerate(polys):
        r = find(i)
        votes.setdefault(r, {}).setdefault(p['r'], 0)
        votes[r][p['r']] += 1
    out = []
    for i, p in enumerate(polys):
        v = votes[find(i)]
        out.append({'r': max(v, key=v.get), 'uv': p['uv']})
    return out


# ── 5: stick ────────────────────────────────────────────────────────────────

def stick_frame(stick_mesh, stick_arm):
    """Heel point + shaft / blade directions of the stick in WORLD rest space.

    Sticks come in any orientation: the FAB sticks are authored UPSIDE DOWN
    (knob at the pivot = the top-hand grip bone, blade at the far end). So the
    shaft axis is the longest bounding-box axis, and the BLADE END is the end
    whose cross-section is widest; the heel sits on the shaft axis at the blade
    end's extreme, the shaft direction points heel -> knob and the blade
    direction points heel -> toe (the renderer's stick / stick_blade semantics).
    """
    stick_arm.data.pose_position = 'REST'
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    ev = stick_mesh.evaluated_get(dg)
    m = ev.to_mesh()
    P = [stick_mesh.matrix_world @ v.co for v in m.vertices]
    ev.to_mesh_clear()
    stick_arm.data.pose_position = 'POSE'
    ext = [max(p[i] for p in P) - min(p[i] for p in P) for i in range(3)]
    k = ext.index(max(ext))  # shaft axis
    o = [i for i in range(3) if i != k]
    c0, c1 = min(p[k] for p in P), max(p[k] for p in P)
    L = c1 - c0

    def spread(lo, hi):
        S = [p for p in P if lo <= p[k] <= hi]
        return max((max(p[i] for p in S) - min(p[i] for p in S)) for i in o) if S else 0.0
    top = spread(c1 - 0.12 * L, c1) > spread(c0, c0 + 0.12 * L)
    end = c1 if top else c0
    sgn = 1.0 if top else -1.0  # knob -> blade along axis k
    mid = [p for p in P if c0 + 0.35 * L < p[k] < c0 + 0.65 * L]
    ax = sum(mid, Vector()) / max(1, len(mid))
    axis_pt = lambda p: Vector([ax[i] if i != k else p[k] for i in range(3)])  # noqa: E731
    near = [p for p in P if abs(p[k] - end) < 0.12 * L]
    far = max(near, key=lambda p: (p - axis_pt(p)).length)
    blade = far - axis_pt(far)
    blade[k] = 0.0
    blade.normalize()
    shaft = Vector((0, 0, 0))
    shaft[k] = -sgn
    heel = axis_pt(far)
    heel[k] = end
    REPORT['stickAuthored'] = {'axis': 'xyz'[k], 'bladeEnd': 'max' if top else 'min', 'flipped': bool(top)}
    return {'heel': heel, 'shaft': shaft, 'blade': blade, 'length': L, 'k': k, 'end': end, 'axis': ax}


def stick_to_rest(stick_mesh, sf, s):
    """Copy of the stick mesh placed in the renderer's stick rest frame (heel at
    the origin, shaft up +Z, blade along +X — Blender space), weighted stick/stick_blade."""
    ob = stick_mesh.copy()
    ob.data = stick_mesh.data.copy()
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = None
    ob.modifiers.clear()
    # rotation taking (blade, shaft) -> (+X, +Z)
    bx = sf['blade'].normalized()
    bz = sf['shaft'].normalized()
    by = bz.cross(bx)
    R = Matrix((bx, by, bz))  # rows: world -> stick frame
    M = Matrix.Scale(s, 4) @ R.to_4x4() @ Matrix.Translation(-sf['heel'])
    world = [stick_mesh.matrix_world @ v.co for v in stick_mesh.data.vertices]
    ob.data.transform(M @ stick_mesh.matrix_world)
    ob.matrix_world = Matrix.Identity(4)
    for g in list(ob.vertex_groups):
        ob.vertex_groups.remove(g)
    gs = ob.vertex_groups.new(name='__stick__')
    gb = ob.vertex_groups.new(name='__blade__')
    k = sf['k']
    for i, p in enumerate(world):
        q = p.copy()
        q[k] = sf['axis'][k]
        r = (q - sf['axis']).length
        if abs(p[k] - sf['end']) < 0.1 * sf['length'] and r > 0.04:
            gb.add([i], 1.0, 'REPLACE')
        else:
            gs.add([i], 1.0, 'REPLACE')
    return ob, M


# ── 6: clips ────────────────────────────────────────────────────────────────

SLOT_RULES = {
    False: [
        (('idle',), ['skate_idle']),
        (('skating', 'fwd', 'start'), ['skate_start']),
        (('skating', 'fwd', 'stop'), ['hockey_stop']),
        (('skating', 'fwd'), ['skate_stride']),
        (('skating', 'bwd', 'start'), []),
        (('skating', 'bwd', 'stop'), []),
        (('skating', 'bwd'), ['skate_back']),
        (('skating', 'l', 'start'), []),
        (('skating', 'l', 'stop'), []),
        (('skating', 'r', 'start'), []),
        (('skating', 'r', 'stop'), []),
        (('skating', 'l'), ['skate_crossover_L']),
        (('skating', 'r'), ['skate_crossover_R']),
        # shot type decided from the clip itself (shot_kind): a big wind-up is a slapshot
        (('shooting',), ['shot*']),
        (('shot',), ['shot*']),
        (('pass',), ['pass']),
        (('faceoff',), ['faceoff_draw']),
        (('check',), ['check']),
        (('celebration',), ['celly_armsup']),
    ],
    True: [
        (('idle',), ['g_stance']),
        (('butterfly',), ['g_butterfly']),
        (('down', 'left'), ['g_pad_save_L']),
        (('down', 'right'), ['g_pad_save_R']),
        (('glove', 'blocker'), ['g_blocker_save']),
        (('glove', 'trapper'), ['g_glove_save']),
        (('skating', 'fwd', 'start'), []),
        (('skating', 'fwd', 'stop'), []),
        (('skating', 'bwd', 'start'), []),
        (('skating', 'bwd', 'stop'), []),
        (('skating', 'l', 'start'), []),
        (('skating', 'l', 'stop'), []),
        (('skating', 'r', 'start'), []),
        (('skating', 'r', 'stop'), []),
        (('skating', 'fwd'), ['g_skate_fwd']),
        (('skating', 'bwd'), ['g_skate_back']),
        (('skating', 'l'), ['g_shuffle_L']),
        (('skating', 'r'), ['g_shuffle_R']),
    ],
}
LOOPS = {'skate_idle', 'skate_stride', 'skate_back', 'skate_crossover_L', 'skate_crossover_R', 'skate_glide',
         'g_stance', 'g_skate_fwd', 'g_skate_back', 'g_shuffle_L', 'g_shuffle_R'}
STOP_WORDS = {'anim', 'hockey', 'player', 'goalie', 'save', 'all', 'animations'}


def clip_tokens(stem):
    t = stem.replace('-', '_').replace(' ', '_').lower().split('_')
    return [x for x in t if x and x not in STOP_WORDS]


def slots_for(stem):
    override = (CFG.get('clipMap') or {}).get(stem)
    if override is not None:
        return list(override) if isinstance(override, list) else [override]
    toks = clip_tokens(stem)
    for need, slots in SLOT_RULES[GOALIE]:
        if all(n in toks for n in need) and (len(need) > 1 or True):
            # 'l'/'r' must be the whole direction token, and start/stop only match when asked for
            if ('start' in toks or 'stop' in toks) and not ('start' in need or 'stop' in need):
                continue
            return slots
    return None


def evaluate_clip(path, prim_rot, prim_pos, K, G_rot, s, ground, sf):
    """Import one animation file and sample it into renderer-space tracks."""
    acts_before = set(bpy.data.actions)
    new = import_any(path)
    arms = [o for o in new if o.type == 'ARMATURE']
    char = max(arms, key=lambda a: len(a.data.bones))
    stick_arm = next((a for a in arms if a is not char and len(a.data.bones) <= 3), None)
    act = char.animation_data.action if char.animation_data else None
    if act is None:
        delete(new)
        return None
    f0, f1 = int(round(act.frame_range[0])), int(round(act.frame_range[1]))
    frames = list(range(f0, f1 + 1))
    sc = bpy.context.scene
    R0 = {t: wrot_rest(char, char.data.bones[prim_rot[t]]) for t in BODY}
    pel0 = None
    samples = []
    for f in frames:
        sc.frame_set(f)
        D = {}
        for t in BODY:
            pb = char.pose.bones[prim_rot[t]]
            D[t] = wrot(char, pb) @ R0[t].inverted() @ K[t].inverted()
        pel = whead(char, char.pose.bones[prim_pos['hips']])
        st = None
        if stick_arm is not None and sf is not None:
            spb = stick_arm.pose.bones[0]
            M = stick_arm.matrix_world @ spb.matrix @ spb.bone.matrix_local.inverted() @ stick_arm.matrix_world.inverted()
            st = (M @ sf['heel'], (M.to_3x3() @ sf['shaft']).normalized(), (M.to_3x3() @ sf['blade']).normalized())
        hands = [whead(char, char.pose.bones[prim_pos[b]]) for b in ('hand_L', 'hand_R', 'foot_L', 'foot_R')]
        samples.append((D, pel, st, hands))
    delete(new)
    for a in list(bpy.data.actions):
        if a not in acts_before:
            bpy.data.actions.remove(a)
    # root motion: detrend pelvis travel and net yaw over the clip
    n = len(samples) - 1 or 1
    y0, y1 = yaw_of(samples[0][0]['hips']), yaw_of(samples[-1][0]['hips'])
    dy = math.atan2(math.sin(y1 - y0), math.cos(y1 - y0))
    p0, p1 = samples[0][1], samples[-1][1]
    travel = (Vector((p1.x - p0.x, p1.y - p0.y, 0))).length
    out = []
    for i, (D, pel, st, hands) in enumerate(samples):
        k = i / n
        Y = qz(-(y0 + dy * k)) if True else Quaternion()
        trend = Vector((p0.x + (p1.x - p0.x) * k, p0.y + (p1.y - p0.y) * k, 0))
        GR = G_rot @ Y

        def place(p):
            q = p - trend
            q = Y @ Vector((q.x, q.y, q.z))
            q = G_rot @ q
            return Vector((q.x * s, q.y * s, q.z * s + ground))
        # the yaw strip turns the whole pose (world); G_rot only changes the frame
        Dg = {t: G_rot @ Y @ D[t] @ G_rot.inverted() for t in BODY}
        hp = place(pel)
        # keep a little sway, never travel
        h = Vector((hp.x, hp.y, 0))
        if h.length > 0.6:
            h *= 0.6 / h.length
        hp = Vector((h.x, h.y, hp.z))
        stick = None
        if st:
            heel = place(st[0])
            stick = (heel, (GR @ st[1]).normalized(), (GR @ st[2]).normalized())
        out.append({'D': Dg, 'hips': hp, 'stick': stick, 'probe': [place(p) for p in hands]})
    return {'frames': out, 'travelFt': round(travel * s, 2), 'yawDeg': round(math.degrees(dy), 1), 'fps': sc.render.fps}


def heel_heights(tr):
    return [fr['stick'][0].z if fr['stick'] else 0.0 for fr in tr['frames']]


def shot_kind(tr):
    """'shot_slap' when the blade is wound up above the shoulders, else wrist / one-timer."""
    if not tr['frames'][0]['stick']:
        return ['shot_wrist', 'shot_onetimer']
    return ['shot_slap'] if max(heel_heights(tr)) > 3.5 else ['shot_wrist', 'shot_onetimer']


def detect_contact(tr, slot):
    """Contact frame. Shots: the fastest blade frame NEAR THE ICE (the release,
    not the wind-up's peak speed); saves: the sharpest hand / foot motion."""
    fr = tr['frames']
    best, bi = -1.0, 0
    for i in range(1, len(fr)):
        if fr[i]['stick'] and slot.startswith('shot'):
            if fr[i]['stick'][0].z > 0.9:
                continue
            v = (fr[i]['stick'][0] - fr[i - 1]['stick'][0]).length
        else:
            v = max((a - b).length for a, b in zip(fr[i]['probe'], fr[i - 1]['probe']))
        if v > best:
            best, bi = v, i
    return bi


def key_clip(arm, name, tr, rest_b):
    ad = arm.animation_data or arm.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ad.action = act
    prev = {}
    for f, fr in enumerate(tr['frames']):
        D = fr['D']
        D['root'] = Quaternion()
        for t in BODY:
            p = PARENT[t]
            L = (D[p] if p != 'root' else Quaternion()).inverted() @ D[t]
            pb = arm.pose.bones[t]
            R = pb.bone.matrix_local.to_3x3()
            q = (R.inverted() @ L.to_matrix() @ R).to_quaternion()
            if t in prev and prev[t].dot(q) < 0:
                q.negate()
            prev[t] = q
            pb.rotation_quaternion = q
            pb.keyframe_insert('rotation_quaternion', frame=f)
        pb = arm.pose.bones['hips']
        R = pb.bone.matrix_local.to_3x3()
        pb.location = R.inverted() @ (fr['hips'] - rest_b['hips'])
        pb.keyframe_insert('location', frame=f)
        if fr['stick']:
            heel, shaft, blade = fr['stick']
            for bn in ('stick', 'stick_blade'):
                pb = arm.pose.bones[bn]
                R = pb.bone.matrix_local.to_3x3()
                pb.location = R.inverted() @ (heel - rest_b[bn])
                pb.keyframe_insert('location', frame=f)
            # renderer semantics: stick = fromUnitVectors(UP, shaft); blade = yaw only
            # full frame (shaft + blade), not the shortest arc from +Z: a raised
            # stick (shaft pointing down in a wind-up) has no stable shortest arc
            # and flipped ~145° between frames
            _bx = (blade - shaft * blade.dot(shaft)).normalized()
            _bz = shaft.normalized()
            qs = Matrix((_bx, _bz.cross(_bx), _bz)).transposed().to_quaternion()
            pb = arm.pose.bones['stick']
            R = pb.bone.matrix_local.to_3x3()
            q = (R.inverted() @ qs.to_matrix() @ R).to_quaternion()
            if 'stick' in prev and prev['stick'].dot(q) < 0:
                q.negate()
            prev['stick'] = q
            pb.rotation_quaternion = q
            pb.keyframe_insert('rotation_quaternion', frame=f)
            # full blade orientation (it follows the shaft through a wind-up):
            # rest frame = blade +X, shaft +Z
            bx = (blade - shaft * blade.dot(shaft)).normalized()
            bz = shaft.normalized()
            qb = Matrix((bx, bz.cross(bx), bz)).transposed().to_quaternion()
            pb = arm.pose.bones['stick_blade']
            R = pb.bone.matrix_local.to_3x3()
            q = (R.inverted() @ qb.to_matrix() @ R).to_quaternion()
            if 'stick_blade' in prev and prev['stick_blade'].dot(q) < 0:
                q.negate()
            prev['stick_blade'] = q
            pb.rotation_quaternion = q
            pb.keyframe_insert('rotation_quaternion', frame=f)
    for fc in act.fcurves if hasattr(act, 'fcurves') else []:
        for kp in fc.keyframe_points:
            kp.interpolation = 'LINEAR'
    track = ad.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, 0, act)
    strip.name = name
    track.mute = True
    ad.action = None
    for pb in arm.pose.bones:
        pb.rotation_quaternion = Quaternion()
        pb.location = Vector()
    return act


# ── main ───────────────────────────────────────────────────────────────────

def main():
    reset_scene()
    bpy.context.scene.render.fps = FPS
    mesh_path = os.path.join(BASE, CFG['mesh'])
    objs = import_any(mesh_path)
    src = main_armature(objs)
    meshes = skinned_meshes(objs, src)
    drop = set(CFG.get('drop') or [])
    dropped = [m.name for m in meshes if m.name.split('.')[0] in drop]
    meshes = [m for m in meshes if m.name.split('.')[0] not in drop]
    REPORT['meshes'] = {m.name: sum(len(p.vertices) - 2 for p in m.data.polygons) for m in meshes}
    REPORT['dropped'] = dropped
    conv, bmap = detect_bone_map(src)
    prim_pos = {t: v[0] for t, v in bmap.items()}
    prim_rot = {t: v[-1] for t, v in bmap.items()}
    merge = merge_table(src, bmap)
    REPORT['boneMap'] = {t: bmap[t] for t in BODY}
    REPORT['merged'] = sorted({f'{s}→{t}' for s, t in merge.items() if t and s not in sum(bmap.values(), [])})
    REPORT['unmappedDropped'] = sorted(s for s, t in merge.items() if not t)

    # textures referenced (for the report)
    REPORT['textures'] = sorted({os.path.basename(im.filepath) for im in bpy.data.images if im.filepath})

    # rest rotations before the conform (world)
    R0 = {t: wrot_rest(src, src.data.bones[prim_rot[t]]) for t in BODY}
    conform(src, prim_pos)
    apply_pose_to_meshes(src, meshes)
    Rc = {t: wrot_rest(src, src.data.bones[prim_rot[t]]) for t in BODY}
    K = {t: Rc[t] @ R0[t].inverted() for t in BODY}

    # units + facing + ground
    jw = {t: src.matrix_world @ src.data.bones[prim_pos[t]].head_local for t in BODY}
    s, unit = units_scale(jw['hips'].z)
    left = jw['thigh_L'] - jw['thigh_R']
    theta = -math.atan2(left.y, left.x)
    G_rot = qz(theta)
    REPORT['units'] = {'detected': unit, 'scaleToFeet': s, 'facingRotationDeg': round(math.degrees(theta), 1)}
    cx, cy = jw['hips'].x, jw['hips'].y
    Gpre = Matrix.Scale(s, 4) @ G_rot.to_matrix().to_4x4() @ Matrix.Translation(Vector((-cx, -cy, 0)))
    zmin = min((Gpre @ (m.matrix_world @ v.co)).z for m in meshes for v in m.data.vertices)
    ground = -zmin
    G = Matrix.Translation(Vector((0, 0, ground))) @ Gpre
    joints_b = {t: G @ jw[t] for t in BODY}
    joints_b['root'] = Vector((0, 0, 0))
    joints_b['stick'] = Vector((0, 0, 0))
    joints_b['stick_blade'] = Vector((0, 0, 0))
    REPORT['jointsFt'] = {t: [round(c, 3) for c in rig.b2r(joints_b[t])] for t in BONE_NAMES}
    REPORT['heightFt'] = round(max((G @ (m.matrix_world @ v.co)).z for m in meshes for v in m.data.vertices), 2)

    # stick
    sf, stick_part, stick_info = None, None, None
    if CFG.get('stick') and os.path.exists(os.path.join(BASE, CFG['stick'])):
        sobjs = import_any(os.path.join(BASE, CFG['stick']))
        sarm = next((o for o in sobjs if o.type == 'ARMATURE'), None)
        smesh = next((o for o in sobjs if o.type == 'MESH'), None)
        if smesh is not None and sarm is not None:
            sf = stick_frame(smesh, sarm)
            stick_part, _ = stick_to_rest(smesh, sf, s)
            stick_info = {'lengthFt': round(sf['length'] * s, 2), 'material': [m.name for m in smesh.data.materials]}
            # the stick keeps its source material → gear
        delete([o for o in sobjs if o is not stick_part])
    REPORT['stick'] = stick_info or 'none (renderer keeps its procedural stick bones; no stick mesh)'

    # rebuild mesh in renderer space
    body_ob = rebuild_mesh(meshes, G, merge, None)
    if stick_part is not None:
        # stick weights → renderer stick bones, material → gear
        vg = {g.index: g.name for g in stick_part.vertex_groups}
        w = [(v.index, vg[v.groups[0].group] if v.groups else '__stick__') for v in stick_part.data.vertices]
        for g in list(stick_part.vertex_groups):
            stick_part.vertex_groups.remove(g)
        gs = stick_part.vertex_groups.new(name='stick')
        gb = stick_part.vertex_groups.new(name='stick_blade')
        for i, n in w:
            (gb if n == '__blade__' else gs).add([i], 1.0, 'REPLACE')
        uvl = stick_part.data.uv_layers.active
        base = stick_part.data.materials[0].name.split('.')[0] if stick_part.data.materials else ''
        q = int((CFG['materials'].get(base) or 'gear:0').split(':')[1])
        stick_part.data.materials.clear()
        for n, _ in OWN_MATS:
            stick_part.data.materials.append(bpy.data.materials[n])
        for poly in stick_part.data.polygons:
            poly.material_index = 1
            if uvl:
                for li in poly.loop_indices:
                    u, v = uvl.data[li].uv
                    uvl.data[li].uv = gear_uv(q, u, v)
        while len(stick_part.data.uv_layers) > 1:
            stick_part.data.uv_layers.remove(stick_part.data.uv_layers[-1])
        if stick_part.data.uv_layers:
            stick_part.data.uv_layers[0].name = 'UVMap'
        bpy.ops.object.select_all(action='DESELECT')
        body_ob.select_set(True)
        stick_part.select_set(True)
        bpy.context.view_layer.objects.active = body_ob
        bpy.ops.object.join()
    tris = sum(len(p.vertices) - 2 for p in body_ob.data.polygons)
    REPORT['triangles'] = tris
    REPORT['vertices'] = len(body_ob.data.vertices)
    delete(objs)

    # target armature + bind
    arm = make_target_armature(ROLE.capitalize() + 'Rig', joints_b)
    body_ob.parent = arm
    mod = body_ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm
    for poly in body_ob.data.polygons:
        poly.use_smooth = True

    # clips
    anim_dir = os.path.join(BASE, CFG.get('animDir') or '')
    files = sorted(f for f in os.listdir(anim_dir) if f.lower().endswith(('.fbx', '.glb', '.gltf'))) if os.path.isdir(anim_dir) else []
    clips_rep = {}
    covered = {}
    for f in files:
        stem = os.path.splitext(f)[0]
        if stem.lower().startswith('sk_'):
            continue
        slots = slots_for(stem)
        if not slots:
            clips_rep[stem] = {'slots': [], 'note': 'unmapped (not used)'}
            continue
        tr = evaluate_clip(os.path.join(anim_dir, f), prim_rot, prim_pos, K, G_rot, s, ground, sf)
        if tr is None:
            clips_rep[stem] = {'slots': [], 'note': 'no animation found'}
            continue
        if slots == ['shot*']:
            slots = shot_kind(tr)
        rep = {'slots': slots, 'frames': len(tr['frames']), 'rootTravelStrippedFt': tr['travelFt'], 'netYawStrippedDeg': tr['yawDeg'],
               'stick': tr['frames'][0]['stick'] is not None}
        for slot in slots:
            name = slot
            if slot not in LOOPS:
                c = (CFG.get('contact') or {}).get(slot)
                if c is None:
                    c = detect_contact(tr, slot)
                    rep.setdefault('contactDetected', {})[slot] = c
                name = f'{slot}@c{int(c)}'
            if slot in covered:
                warn(f'{slot}: {stem} ignored ({covered[slot]} already fills it)')
                continue
            key_clip(arm, name, tr, joints_b)
            covered[slot] = stem
        clips_rep[stem] = rep
    REPORT['clips'] = clips_rep
    REPORT['covered'] = covered

    keep = {tr.strips[0].action for tr in arm.animation_data.nla_tracks} if arm.animation_data else set()
    for a in list(bpy.data.actions):
        if a not in keep:
            bpy.data.actions.remove(a)
    out_glb = os.path.join(OUT, f'{ROLE}.glb')
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(REPORT_DIR, f'{ROLE}.blend'))
    export_glb(arm, body_ob, out_glb)
    REPORT['glbBytes'] = os.path.getsize(out_glb)
    if PREVIEW:
        preview(arm, body_ob)
    with open(os.path.join(REPORT_DIR, f'{ROLE}_clothes_uv.json'), 'w', encoding='utf-8') as fh:
        json.dump(uv_islands_vote(CLOTHES_UV), fh)
    with open(os.path.join(REPORT_DIR, f'report-{ROLE}.json'), 'w', encoding='utf-8') as fh:
        json.dump(REPORT, fh, indent=1)
    print('IMPORT OK', ROLE, 'tris', tris, 'clips', sorted(covered))


def preview(arm, me):
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'
    sc.display.shading.color_type = 'MATERIAL'
    sc.render.resolution_x = 520
    sc.render.resolution_y = 520
    cam_data = bpy.data.cameras.new('PreviewCam')
    cam_data.lens = 60
    cam = bpy.data.objects.new('PreviewCam', cam_data)
    sc.collection.objects.link(cam)
    sc.camera = cam
    target = Vector((0, 0, 3.0))
    ad = arm.animation_data
    shots = [(None, 0, -35), (None, 0, 90), (None, 0, 180)]
    for tr in ad.nla_tracks:
        act = tr.strips[0].action
        n = int(act.frame_range[1])
        shots.append((act, n // 2, -35))
    for i, (act, frame, az) in enumerate(shots):
        ad.action = act
        if act is None:
            for pb in arm.pose.bones:
                pb.rotation_quaternion = Quaternion()
                pb.location = Vector()
        sc.frame_set(frame)
        a = math.radians(az)
        cam.location = Vector((math.sin(a) * 19, -math.cos(a) * 19, 5.0))
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
        label = act.name.replace('@', '_') if act else f'rest{az}'
        sc.render.filepath = os.path.join(REPORT_DIR, f'pose-{ROLE}-{label}.png')
        bpy.ops.render.render(write_still=True)
    ad.action = None


if __name__ == '__main__':
    main()
