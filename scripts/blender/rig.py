"""
Rig spec shared by every Blender build script.

The renderer (src/render3d/athlete.ts) owns the skeleton: bone NAMES, rest
positions and the convention that every rest bone frame is identity in
renderer space. This module mirrors restBoneOffsets() EXACTLY, so the glTF
joint positions line up with AthleteRig's rest skeleton (a vitest checks the
exported .glb against restBonePositions()).

Coordinates
  renderer / glTF : +Y up, +Z = player's front, +X = player's LEFT, units = feet
  Blender         : +Z up, -Y = front, +X = left (the standard "front view")
  r2b((x, y, z)) = (x, -z, y)    b2r((x, y, z)) = (x, z, -y)
"""

from mathutils import Vector, Matrix, Quaternion
import math

# ── proportions (pose.ts RIG) ──────────────────────────────────────────────
RIG = dict(
    thigh=1.5, shin=1.45, skate=0.38, hipHalfWidth=0.36, pelvisH=0.55, torsoH=2.05,
    shoulderHalfWidth=0.78, upperArm=1.05, forearm=0.98, neck=0.22, headR=0.36, stickLen=5.1,
)
H = RIG['thigh'] + RIG['shin'] + RIG['skate']  # REST_HIP_Y = 3.33

# ── proportion profile ─────────────────────────────────────────────────────
# The Blender athletes are built on RIG. An OWNER import (import_owner_assets.py)
# re-authors the same clips on its own skeleton: set_profile() swaps in that
# body's rest offsets and segment lengths so posekit solves every pose (auto hip
# height, arm IK, stick reach) for THOSE proportions; reset_profile() restores RIG.
_DEFAULT_RIG = dict(RIG)
_PROFILE = {'offsets': None}


def set_profile(offsets, dims):
    """offsets: bone → (x, y, z) rest offset from its parent (renderer space);
    dims: any RIG keys to override (upperArm, forearm, thigh, shin, skate, stickLen)."""
    global H
    RIG.update(dims)
    _PROFILE['offsets'] = {k: tuple(v) for k, v in offsets.items()}
    H = offsets['hips'][1]


def reset_profile():
    global H
    RIG.clear()
    RIG.update(_DEFAULT_RIG)
    _PROFILE['offsets'] = None
    H = RIG['thigh'] + RIG['shin'] + RIG['skate']

BONE_NAMES = [
    'root', 'hips', 'spine', 'chest', 'neck', 'head',
    'shoulder_L', 'upperarm_L', 'forearm_L', 'hand_L',
    'shoulder_R', 'upperarm_R', 'forearm_R', 'hand_R',
    'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R',
    'stick', 'stick_blade',
]

PARENT = {
    'root': None, 'hips': 'root', 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck',
    'shoulder_L': 'chest', 'upperarm_L': 'shoulder_L', 'forearm_L': 'upperarm_L', 'hand_L': 'forearm_L',
    'shoulder_R': 'chest', 'upperarm_R': 'shoulder_R', 'forearm_R': 'upperarm_R', 'hand_R': 'forearm_R',
    'thigh_L': 'hips', 'shin_L': 'thigh_L', 'foot_L': 'shin_L',
    'thigh_R': 'hips', 'shin_R': 'thigh_R', 'foot_R': 'shin_R',
    'stick': 'root', 'stick_blade': 'root',
}


def rest_offsets(goalie):
    if _PROFILE['offsets'] is not None and not goalie:
        return dict(_PROFILE['offsets'])
    sw = 0.95 if goalie else RIG['shoulderHalfWidth']
    ua, fa, th, sh = RIG['upperArm'], RIG['forearm'], RIG['thigh'], RIG['shin']
    hw = RIG['hipHalfWidth']
    return {
        'root': (0, 0, 0), 'hips': (0, H, 0), 'spine': (0, 0.32, 0), 'chest': (0, 0.8, 0),
        'neck': (0, 1.18, 0.02), 'head': (0, 0.15, 0.08),
        'shoulder_L': (sw, 0.88, 0.02), 'upperarm_L': (0, 0, 0), 'forearm_L': (0, -ua, 0), 'hand_L': (0, -fa, 0),
        'shoulder_R': (-sw, 0.88, 0.02), 'upperarm_R': (0, 0, 0), 'forearm_R': (0, -ua, 0), 'hand_R': (0, -fa, 0),
        'thigh_L': (hw, 0, 0), 'shin_L': (0, -th, 0), 'foot_L': (0, -sh, 0),
        'thigh_R': (-hw, 0, 0), 'shin_R': (0, -th, 0), 'foot_R': (0, -sh, 0),
        'stick': (0, 0, 0), 'stick_blade': (0, 0, 0),
    }


def rest_positions(goalie):
    """World rest position of every joint, renderer space."""
    off = rest_offsets(goalie)
    out = {}
    for n in BONE_NAMES:
        p = PARENT[n]
        o = Vector(off[n])
        out[n] = o + (out[p] if p else Vector((0, 0, 0)))
    return out


# ── space conversion ───────────────────────────────────────────────────────
def r2b(v):
    return Vector((v[0], -v[2], v[1]))


def b2r(v):
    return Vector((v[0], v[2], -v[1]))


# change of basis matrix (renderer → Blender)
C = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))
Ci = C.inverted()


def rot_r2b(q):
    """Renderer-space rotation (Quaternion) → the same rotation in Blender space."""
    return (C @ q.to_matrix() @ Ci).to_quaternion()


def q_axis(axis, ang):
    return Quaternion({'X': (1, 0, 0), 'Y': (0, 1, 0), 'Z': (0, 0, 1)}[axis], ang)


def q_three(x, y, z, order='XYZ'):
    """three.js Euler → Quaternion (renderer space). three 'XYZ' means R = Rx·Ry·Rz."""
    ang = {'X': x, 'Y': y, 'Z': z}
    q = Quaternion()
    for a in order:
        q = q @ q_axis(a, ang[a])
    return q


def q_from_to(a, b):
    """Minimal rotation taking unit vector a to unit vector b (three's setFromUnitVectors)."""
    a = Vector(a).normalized()
    b = Vector(b).normalized()
    return a.rotation_difference(b)


# bones that point UP in Blender (root/hips/spine/…) have identity glTF frames;
# limbs point down. Tails only matter for display + heat weighting.
def bone_tail(name, pos, goalie):
    p = pos[name]
    up = Vector((0, 0.35, 0))
    t = {
        'root': p + Vector((0, 0.5, 0)),
        'hips': pos['spine'],
        'spine': pos['chest'],
        'chest': pos['neck'],
        'neck': pos['head'],
        'head': p + Vector((0, 0.6, 0)),
        'upperarm_L': pos['forearm_L'], 'forearm_L': pos['hand_L'], 'hand_L': p + Vector((0, -0.45, 0)),
        'upperarm_R': pos['forearm_R'], 'forearm_R': pos['hand_R'], 'hand_R': p + Vector((0, -0.45, 0)),
        'thigh_L': pos['shin_L'], 'shin_L': pos['foot_L'], 'foot_L': p + Vector((0, -0.3, 0.45)),
        'thigh_R': pos['shin_R'], 'shin_R': pos['foot_R'], 'foot_R': p + Vector((0, -0.3, 0.45)),
        'stick': p + Vector((0, 1.0, 0)),
        'stick_blade': p + Vector((0, 0.6, 0)),
    }
    if name in ('shoulder_L', 'shoulder_R'):
        # clavicle: points outward along the shoulder line
        s = 1 if name.endswith('L') else -1
        return p + Vector((s * 0.3, 0, 0))
    return t.get(name, p + up)
