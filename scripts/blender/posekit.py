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


# film study S1 / P1: 35-45° forward lean with the puck (was 0.49 rad ≈ 28°: the bottom hand couldn't reach its grip)
READY = dict(lean=0.66, yaw=0.0, roll=0.0, L=leg(), R=leg())


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


# Owner grips (import_owner_assets.py measures them from the owner's own idle):
# per hand, the shaft direction in the hand bone's frame ('axis') and the palm
# point where the shaft passes ('palm'), renderer space. None = wrist on the shaft.
GRIP = {'L': None, 'R': None}
# Owner sticks skin the blade with its natural lie: the stick bones take the
# FULL frame (shaft + blade heading). The Blender stick keeps a flat blade (yaw only).
STICK = {'fullFrame': False}


def arm_reach():
    # the palm sits past the wrist but not along the arm: owner grips count the arm alone
    return (RIG['upperArm'] + RIG['forearm']) * (0.95 if any(GRIP.values()) else 0.985)


def grip_on_shaft(heel, dirv, sh, want, reach, lo, hi):
    """athlete.ts gripOnShaft: the reachable grip (ft along the shaft) nearest `want`, + a stick shift if none is."""
    d = sh - heel
    tc = d.dot(dirv)
    perp = d - dirv * tc
    dist = perp.length
    cl = lambda x: min(hi, max(lo, x))  # noqa: E731
    if dist >= reach:
        t = cl(tc)
        to = sh - (heel + dirv * t)
        return t, to * ((to.length - reach * 0.98) / (to.length or 1))
    half = math.sqrt(reach * reach - dist * dist)
    t = cl(min(tc + half, max(tc - half, want)))
    if abs(t - tc) <= half + 1e-6:
        return t, None
    p = heel + dirv * t
    to = sh - p
    return t, to * ((to.length - reach * 0.98) / (to.length or 1))


def stick_frame(shaft, bdir, open_=0.0):
    if not STICK['fullFrame']:
        return q_from_to(UP, shaft)
    x = bdir - shaft * bdir.dot(shaft)
    if x.length < 1e-4:
        x = Vector((1, 0, 0)) - shaft * shaft.x
    x.normalize()
    y = shaft.normalized()
    z = x.cross(y)
    return Matrix((x, y, z)).transposed().to_quaternion() @ q_three(open_, 0, 0)


def blade_frame(shaft, bdir, yawb, open_):
    if STICK['fullFrame']:
        return stick_frame(shaft, bdir, open_)
    return q_three(0, yawb, 0) @ q_three(open_, 0, 0)


def arm_frames(sh, elbow, hand, pole):
    """World frames of the upper arm and forearm as a HINGE: each bone's -Y runs
    along it, the elbow bends about the shared local X, and the forearm swings
    toward local +Z (the elbow crease faces +Z at rest). No shortest-arc twist:
    the elbow always bends in its own plane."""
    u = (elbow - sh).normalized()
    f = (hand - elbow).normalized()
    # the forearm's swing off the upper arm, plus a small steady share of the
    # pole's side: a nearly straight arm never flips its twist between keys
    pv = pole - sh
    z0 = -(pv - u * pv.dot(u))
    if z0.length < 1e-6:
        z0 = Vector((0, 0, 1)) - u * u.z
    z = (f - u * f.dot(u)) + z0.normalized() * 0.08
    if z.length < 1e-6:
        z = z0
    z.normalize()
    y = -u
    x = y.cross(z).normalized()
    Wu = Matrix((x, y, z)).transposed().to_quaternion()
    y2 = -f
    z2 = x.cross(y2).normalized()
    Wf = Matrix((x, y2, z2)).transposed().to_quaternion()
    return Wu, Wf


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


    def aim_arm(self, L, sh, elbow, hand, pole):
        self.solve()
        Wu, Wf = arm_frames(sh, elbow, hand, pole)
        self.local['upperarm_' + L] = self.wrot['shoulder_' + L].inverted() @ Wu
        self.local['forearm_' + L] = Wu.inverted() @ Wf
        self.local['hand_' + L] = Quaternion()
        self.solve()

    def grip_hand(self, L, shaft_w, axis_local, limit=1.4):
        """Turn the hand so its grip axis runs along the shaft (angle-limited: a wrist, not a ball joint)."""
        self.solve()
        Wf = self.wrot['forearm_' + L]
        cur = Wf @ axis_local
        # always the SAME end of the shaft (heel → knob, as measured): picking the
        # nearer end flipped the glove 180° between frames
        q = cur.rotation_difference(shaft_w)
        if q.angle > limit:
            q = Quaternion(q.axis, limit)
        self.local['hand_' + L] = Wf.inverted() @ q @ Wf
        self.solve()


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
    lean, yaw, roll = P.get('lean', READY['lean']), P.get('yaw', 0.0), P.get('roll', 0.0)
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
    one_hand = None
    if st == 'carry' or (isinstance(st, dict) and 'blade' in st):
        s = dict(blade=(1.2, 0.02, 3.0), top=(shR.x + 0.5, hipY + 0.5, 1.05), yaw=None, lowGrip=0.55, open=0.0)
        if isinstance(st, dict):
            s.update(st)
        yawb = s['yaw'] if s['yaw'] is not None else math.atan2(-0.28, 1.0)
        bdir = Vector((math.cos(yawb), 0, -math.sin(yawb)))
        mid = Vector(s['blade'])
        heel = mid - bdir * 0.45
        top = Vector(s['top'])
        # The top hand holds the KNOB: the authored blade + top hand set the
        # shaft's line, and the blade slides out along it (on the ice: along the
        # ice, keeping its height) until the shaft is full length. A grip part
        # way down a long stick left the knob poking up past the helmet.
        full = RIG['stickLen'] - 0.3
        d = top - heel
        if d.length < full:
            if heel.y < 0.3:
                hor = Vector((heel.x - top.x, 0, heel.z - top.z))
                dy = heel.y - top.y
                if hor.length > 1e-3 and full > abs(dy):
                    heel = top + hor.normalized() * math.sqrt(full * full - dy * dy)
                    heel.y = top.y + dy
            else:
                heel = top + (heel - top).normalized() * full
        d = top - heel
        shaft = d.normalized()
        top_grip = min(d.length, RIG['stickLen'] - 0.25)
        low_grip = top_grip * s['lowGrip']
        # both hands must REACH their grips (shorter arms, a longer stick):
        # slide each grip along the shaft; if the shaft is out of reach, the
        # stick comes to the top hand (athlete.ts gripOnShaft, same rule)
        reach = arm_reach()
        fk.solve()
        tr, shift = grip_on_shaft(heel, shaft, fk.wpos['upperarm_R'], top_grip, reach, top_grip * 0.7, top_grip)
        if shift is not None:
            heel = heel + shift
        top_grip = tr
        if s.get('oneHand') != 'R':
            tl, _ = grip_on_shaft(heel, shaft, fk.wpos['upperarm_L'], low_grip, reach, low_grip * 0.6, top_grip - 0.35)
            grips['L'] = heel + shaft * tl
        grips['R'] = heel + shaft * top_grip
        fk.pos_local['stick'] = heel
        fk.local['stick'] = stick_frame(shaft, bdir, 0.0)
        fk.pos_local['stick_blade'] = heel
        fk.local['stick_blade'] = blade_frame(shaft, bdir, yawb, s['open'])
    elif isinstance(st, dict) and 'hand' in st:
        # stick held in one hand: its shaft passes through that hand's target
        hand_t = Vector(P['hand' + st['hand']])
        shaft = Vector(st.get('dir', (0, -1, 0.3))).normalized()
        grip = st.get('grip', 3.6)
        heel = hand_t - shaft * grip
        grips[st['hand']] = hand_t
        yawb = st.get('yaw', 0.0)
        bdir = Vector((math.cos(yawb), 0, -math.sin(yawb)))
        one_hand = (st['hand'], shaft, grip)
        fk.pos_local['stick'] = heel
        fk.local['stick'] = stick_frame(shaft, bdir, 0.0)
        fk.pos_local['stick_blade'] = heel
        fk.local['stick_blade'] = blade_frame(shaft, bdir, yawb, st.get('open', 0.0))
    fk.solve()

    # ── arms (two-bone IK, hinge frames) ──
    for L, side in (('L', 1), ('R', -1)):
        h = P.get('hand' + L, 'stick')
        on_stick = h == 'stick' or (one_hand is not None and one_hand[0] == L)
        if h == 'stick':
            if L not in grips:
                continue
            target = grips[L]
        else:
            target = Vector(h)
        fk.solve()
        sh = fk.wpos['upperarm_' + L]
        pole = Vector(P.get('pole' + L) or (sh + Vector((side * 1.6, -1.2, -0.8))))
        gr = GRIP.get(L) if on_stick else None
        shaft_w = (fk.wrot['stick'] @ UP).normalized()
        want = target
        for _ in range(4 if gr else 1):
            elbow, hand = solve_two_bone(sh, want, RIG['upperArm'], RIG['forearm'], pole)
            fk.aim_arm(L, sh, elbow, hand, pole)
            if gr:
                # the glove closes around the shaft: turn the hand so its grip axis
                # lies along the shaft, then put the PALM (not the wrist) on the grip
                fk.grip_hand(L, shaft_w, gr['axis'])
                want = target - fk.wrot['hand_' + L] @ gr['palm']
        if 'wrist' + L in P:
            w = P['wrist' + L]
            fk.local['hand_' + L] = q_three(w[0], w[1], w[2])
    fk.solve()
    if one_hand is not None:
        # a one-handed stick follows the hand it is in (its target may be out of reach)
        L, shaft, grip = one_hand
        gr = GRIP.get(L)
        pw = fk.wpos['hand_' + L] + (fk.wrot['hand_' + L] @ gr['palm'] if gr else Vector())
        heel = pw - shaft * grip
        fk.pos_local['stick'] = heel
        fk.pos_local['stick_blade'] = heel
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
