"""
Pose authoring in the RENDERER's own semantics (the same numbers athlete.ts
apply() uses), turned into Blender keyframes.

A pose is a dict; every key is optional (defaults = ready hockey stance):
  hip      (x, y, z) offset of the hips from their auto height; 'y' None = auto
           (auto = the lowest skate blade touches the ice, like legDrop())
  hipRot   (pitch, yaw, roll) of the whole upper+lower body about the hips
  lean, yaw, roll     torso pitch / twist / side bend (spine 80%, chest 20% …)
  look     (pitch, yaw) extra head aim (neck/head counter-rotate the lean by default)
  L, R     legs: dict(flex, abduct, knee, ankle, splay, turn)  (turn = thigh yaw)
  shrugL/R clavicle raise (rad)
  stick    dict(blade=(x, y, z) blade middle, top=(x, y, z) top-hand grip point,
                yaw=blade heading (rad, 0 = +X), lowGrip=0..1 along the shaft, open=face tilt)
           or dict(hand='R'|'L', dir=(x, y, z)) = stick held in one hand
  handL/R  'stick' (grip the stick) or (x, y, z) free hand target (root space)
Arms are solved with the renderer's own two-bone IK (pose.ts solveTwoBone + aimBone).
"""

import math
from mathutils import Vector, Quaternion, Matrix

import rig
from rig import RIG, BONE_NAMES, PARENT, rest_offsets, q_three, q_from_to

UP = Vector((0, 1, 0))
DOWN = Vector((0, -1, 0))


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def leg(flex=0.52, abduct=0.13, knee=0.85, ankle=None, splay=0.0, turn=0.0):
    return dict(flex=flex, abduct=abduct, knee=knee, ankle=(knee - flex) if ankle is None else ankle, splay=splay, turn=turn)


READY = dict(lean=0.49, yaw=0.0, roll=0.0, L=leg(), R=leg())


def solve_two_bone(root, target, a, b, pole):
    d = target - root
    dist = d.length
    dirv = d / dist if dist > 1e-6 else Vector((0, -1, 0))
    dist = clamp(dist, abs(a - b) + 1e-4, a + b - 1e-4)
    hand = root + dirv * dist
    cosA = clamp((a * a + dist * dist - b * b) / (2 * a * dist), -1, 1)
    along = a * cosA
    h = a * math.sqrt(max(0, 1 - cosA * cosA))
    pv = pole - root
    perp = pv - dirv * pv.dot(dirv)
    if perp.length < 1e-6:
        perp = Vector((-dirv.z, 0, dirv.x)) if abs(dirv.y) < 0.9 else Vector((1, 0, 0))
    perp.normalize()
    elbow = root + dirv * along + perp * h
    return elbow, hand


class Fk:
    """Forward kinematics over the renderer skeleton (root space, root at origin)."""

    def __init__(self, goalie):
        self.goalie = goalie
        self.off = {n: Vector(o) for n, o in rest_offsets(goalie).items()}
        self.local = {n: Quaternion() for n in BONE_NAMES}
        self.pos_local = {n: Vector(self.off[n]) for n in BONE_NAMES}
        self.wrot = {}
        self.wpos = {}

    def solve(self):
        for n in BONE_NAMES:
            p = PARENT[n]
            if p is None:
                self.wrot[n] = self.local[n].copy()
                self.wpos[n] = self.pos_local[n].copy()
            else:
                self.wrot[n] = self.wrot[p] @ self.local[n]
                self.wpos[n] = self.wpos[p] + self.wrot[p] @ self.pos_local[n]

    def aim(self, name, dir_root):
        """Point bone −Y along a root-space direction (athlete.ts aimBone)."""
        self.solve()
        parent = self.wrot[PARENT[name]]
        desired = q_from_to(DOWN, dir_root)
        self.local[name] = parent.inverted() @ desired


def blade_points(fk, foot):
    """World (root-space) points on the steel runner under a foot bone."""
    r = fk.wrot[foot]
    p = fk.wpos[foot]
    return [p + r @ Vector((0, -RIG['skate'] + 0.035, z)) for z in (-0.34, 0.16, 0.68)]


def build(pose, goalie=False):
    """Pose dict → Fk with every bone's local rotation (+ hips / stick positions) solved."""
    P = dict(READY)
    P.update(pose)
    fk = Fk(goalie)
    lean, yaw, roll = P.get('lean', 0.49), P.get('yaw', 0.0), P.get('roll', 0.0)
    look = P.get('look', (0.0, 0.0))
    hr = P.get('hipRot', (0.0, 0.0, 0.0))
    fk.local['hips'] = q_three(hr[0], hr[1], hr[2], 'YXZ')
    fk.local['spine'] = q_three(lean * 0.8, yaw * 0.6, -roll)
    fk.local['chest'] = q_three(lean * 0.2, yaw * 0.4, 0)
    fk.local['neck'] = q_three(-lean * 0.45 + look[0] * 0.5, -yaw * 0.4 + look[1] * 0.5, 0)
    fk.local['head'] = q_three(-lean * 0.35 + look[0] * 0.5, -yaw * 0.3 + look[1] * 0.5, 0)
    fk.local['shoulder_L'] = q_three(0, 0, P.get('shrugL', 0.0))
    fk.local['shoulder_R'] = q_three(0, 0, -P.get('shrugR', 0.0))
    for L, side in (('L', 1), ('R', -1)):
        lg = P.get(L, leg())
        fk.local['thigh_' + L] = q_three(-lg['flex'], side * lg.get('turn', 0.0), side * lg['abduct'], 'ZXY')
        fk.local['shin_' + L] = q_three(lg['knee'], -side * lg.get('splay', 0.0), 0, 'YXZ')
        fk.local['foot_' + L] = q_three(-lg['ankle'], 0, 0)

    # hips height: auto so the lowest blade point sits on the ice
    hip = P.get('hip', (0.0, None, 0.0))
    fk.pos_local['hips'] = Vector((hip[0], rig.H, hip[2]))
    fk.solve()
    if hip[1] is None:
        low = min(pt.y for f in ('foot_L', 'foot_R') for pt in blade_points(fk, f))
        fk.pos_local['hips'].y = rig.H - low
    else:
        fk.pos_local['hips'].y = hip[1]
    fk.solve()

    # ── stick ──
    st = P.get('stick', 'carry')
    shR = fk.wpos['shoulder_R']
    hipY = fk.pos_local['hips'].y
    grips = {}
    if st == 'carry' or (isinstance(st, dict) and 'blade' in st):
        s = dict(blade=(1.2, 0.02, 3.0), top=(shR.x + 0.5, hipY + 0.5, 1.05), yaw=None, lowGrip=0.55, open=0.0)
        if isinstance(st, dict):
            s.update(st)
        yawb = s['yaw'] if s['yaw'] is not None else math.atan2(-0.28, 1.0)
        bdir = Vector((math.cos(yawb), 0, -math.sin(yawb)))
        mid = Vector(s['blade'])
        heel = mid - bdir * 0.45
        top = Vector(s['top'])
        d = top - heel
        shaft = d.normalized()
        top_grip = min(d.length, RIG['stickLen'] - 0.25)
        grips['R'] = heel + shaft * top_grip
        grips['L'] = heel + shaft * (top_grip * s['lowGrip'])
        fk.pos_local['stick'] = heel
        fk.local['stick'] = q_from_to(UP, shaft)
        fk.pos_local['stick_blade'] = heel
        fk.local['stick_blade'] = q_three(0, yawb, 0) @ q_three(s['open'], 0, 0)
    elif isinstance(st, dict) and 'hand' in st:
        # stick held in one hand: its shaft passes through that hand's target
        hand_t = Vector(P['hand' + st['hand']])
        shaft = Vector(st.get('dir', (0, -1, 0.3))).normalized()
        grip = st.get('grip', 3.6)
        heel = hand_t - shaft * grip
        grips[st['hand']] = hand_t
        fk.pos_local['stick'] = heel
        fk.local['stick'] = q_from_to(UP, shaft)
        fk.pos_local['stick_blade'] = heel
        fk.local['stick_blade'] = q_three(0, st.get('yaw', 0.0), 0) @ q_three(st.get('open', 0.0), 0, 0)
    fk.solve()

    # ── arms (two-bone IK, the renderer's poles) ──
    for L, side in (('L', 1), ('R', -1)):
        h = P.get('hand' + L, 'stick')
        if h == 'stick':
            if L not in grips:
                continue
            target = grips[L]
        else:
            target = Vector(h)
        fk.solve()
        sh = fk.wpos['upperarm_' + L]
        pole = P.get('pole' + L) or (sh + Vector((side * 1.6, -1.2, -0.8)))
        elbow, hand = solve_two_bone(sh, target, RIG['upperArm'], RIG['forearm'], Vector(pole))
        fk.aim('upperarm_' + L, (elbow - sh).normalized())
        fk.aim('forearm_' + L, (hand - elbow).normalized())
        if 'wrist' + L in P:
            w = P['wrist' + L]
            fk.local['hand_' + L] = q_three(w[0], w[1], w[2])
    fk.solve()
    return fk


# ── keyframing ─────────────────────────────────────────────────────────────

def key_pose(arm, fk, frame, prev=None):
    """Write an Fk onto the Blender armature as keyframes at `frame`."""
    goalie = fk.goalie
    rest = rig.rest_positions(goalie)
    out = {}
    for n in BONE_NAMES:
        if n == 'root':
            continue
        pb = arm.pose.bones[n]
        R = pb.bone.matrix_local.to_3x3()
        qb = (rig.C @ fk.local[n].to_matrix() @ rig.Ci)
        basis = (R.inverted() @ qb @ R).to_quaternion()
        if prev is not None and n in prev and prev[n].dot(basis) < 0:
            basis.negate()
        out[n] = basis
        pb.rotation_quaternion = basis
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        if n in ('hips', 'stick', 'stick_blade'):
            # pose location lives in the bone's rest frame, relative to its rest head
            # (hips' parent root is never posed, so parent-space == root space)
            d = rig.C @ (fk.pos_local[n] - rest[n])
            pb.location = R.inverted() @ d
            pb.keyframe_insert('location', frame=frame)
    return out
