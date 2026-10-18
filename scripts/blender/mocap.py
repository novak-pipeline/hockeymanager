"""
Video-mocap clips: solve the cleaned joint tracks in scripts/blender/mocap/*.json
(written by scripts/mocap/process.py from MediaPipe world landmarks, see
docs/MOCAP-PIPELINE.md) onto the skater rig, one key per frame.

The tracks are renderer-space JOINT POSITIONS from a real person; the rig has
its own proportions. So nothing is copied position-for-position: every bone
takes the DIRECTION the matching body segment has in the video (bone lengths
are the rig's), the pelvis / torso / head take frames built from the hip,
shoulder and ear lines, knees are solved as hinges, and the hips drop so the
lowest skate blade sits on the ice every frame (the skate glides, it never
sinks or floats). The stick is inferred from the two hands with the same grip
rules the key-pose clips use (posekit.solve_stick_arms): the right hand holds
the knob, the shaft runs through the left hand, and a carried blade stays on
the ice. Everything goes through rig.RIG / rest_offsets, so the owner import
(import_owner_assets.py) re-solves the same tracks on the owner's proportions.
"""

import json
import math
import os

from mathutils import Vector, Quaternion, Matrix

import rig
from rig import RIG
import posekit
from posekit import Fk, blade_points

HERE = os.path.dirname(os.path.abspath(__file__))
TRACK_DIR = os.path.join(HERE, 'mocap')

# How each clip uses the stick:
#   'carry' - the key-pose carry (the clip is lower-body only: the stick is the renderer's)
#   'ice'   - from the hands, blade held on the ice (stickhandling)
#   'hands' - from the hands, the blade may leave the ice (shots, follow-through)
STICK_MODE = {
    'mocap_skate_stride': 'carry',
    'mocap_stickhandle': 'ice',
    'mocap_shot_wrist': 'hands',
}

UP = Vector((0, 1, 0))


def frame_xy(x, y):
    """World rotation whose +X runs along x and +Y (orthogonalised) along y."""
    x = x.normalized()
    y = (y - x * y.dot(x)).normalized()
    z = x.cross(y)
    return Matrix((x, y, z)).transposed().to_quaternion()


def frame_yx(y, x):
    """+Y exactly along y, +X (orthogonalised) along x."""
    y = y.normalized()
    x = (x - y * x.dot(y)).normalized()
    z = x.cross(y)
    return Matrix((x, y, z)).transposed().to_quaternion()


def frame_zx(z, x):
    z = z.normalized()
    x = (x - z * x.dot(z)).normalized()
    y = z.cross(x)
    return Matrix((x, y, z)).transposed().to_quaternion()


def slerp_id(q, t):
    return Quaternion().slerp(q, t)


def limit(q, ang):
    q = q.normalized()
    if q.w < 0:
        q.negate()
    if q.angle > ang:
        return Quaternion(q.axis, ang)
    return q


def smooth01(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def leg_frames(u, f, front):
    """Thigh / shin world frames as a knee HINGE: bone -Y along the segment, the
    knee bends about the shared local X, the shin swings toward local -Z. A
    nearly straight leg leans on the pelvis' front for the hinge axis."""
    perp = f - u * f.dot(u)
    k = smooth01(0.04, 0.2, perp.length)
    z = (-perp.normalized() if perp.length > 1e-6 else front) * k + front * (1 - k)
    y = -u
    z = (z - y * z.dot(y)).normalized()
    x = y.cross(z).normalized()
    Wt = Matrix((x, y, z)).transposed().to_quaternion()
    y2 = -f
    z2 = x.cross(y2).normalized()
    Ws = Matrix((x, y2, z2)).transposed().to_quaternion()
    return Wt, Ws


def solve_body(J, goalie=False):
    """One frame of joint positions (renderer space, feet) -> an Fk with the
    body posed (pelvis, spine, head, legs, hip height); arms/stick not yet."""
    fk = Fk(goalie)
    hipC = (J['hipL'] + J['hipR']) * 0.5
    shC = (J['shL'] + J['shR']) * 0.5
    # pelvis: the hip line (yaw + roll); the forward pitch belongs to the spine
    Wh = frame_xy(J['hipL'] - J['hipR'], UP)
    fk.local['hips'] = Wh
    # torso: up the spine, across the shoulders; 75% in the spine, the rest in the chest
    Wt = frame_yx(shC - hipC, J['shL'] - J['shR'])
    D = Wh.inverted() @ Wt
    sp = slerp_id(D, 0.75)
    fk.local['spine'] = sp
    fk.local['chest'] = sp.inverted() @ D
    # head: across the ears, toward the nose (the nose sits a little below the ear line)
    earC = (J['earL'] + J['earR']) * 0.5
    Whd = frame_zx(J['nose'] - earC, J['earL'] - J['earR']) @ Quaternion((1, 0, 0), -0.12)
    E = Wt.inverted() @ Whd
    E = limit(E, 1.1)
    nk = slerp_id(E, 0.5)
    fk.local['neck'] = nk
    fk.local['head'] = nk.inverted() @ E
    # legs (hinge knees) + skates
    front = Wh @ Vector((0, 0, 1))
    for L in ('L', 'R'):
        u = (J['knee' + L] - J['hip' + L]).normalized()
        f = (J['ank' + L] - J['knee' + L]).normalized()
        Wth, Wsh = leg_frames(u, f, front)
        fk.local['thigh_' + L] = Wh.inverted() @ Wth
        fk.local['shin_' + L] = Wth.inverted() @ Wsh
        # skate: heel -> toe is its blade; an ankle in a boot barely moves (capped)
        fwd = J['toe' + L] - J['heel' + L]
        Wf = frame_zx(fwd, Wsh @ Vector((1, 0, 0)))
        fk.local['foot_' + L] = limit(Wsh.inverted() @ Wf, 0.55)
    # hips height: the lowest blade point on the ice (contact lock, free to glide)
    fk.pos_local['hips'] = Vector((0.0, rig.H, 0.0))
    fk.solve()
    low = min(pt.y for ft in ('foot_L', 'foot_R') for pt in blade_points(fk, ft))
    fk.pos_local['hips'].y = rig.H - low
    fk.solve()
    return fk


def hand_targets(fk, J):
    """The video's shoulder->elbow->wrist directions at the rig's own arm lengths
    (the rig torso IS the video torso, so world directions carry over)."""
    hands = {}
    for L in ('L', 'R'):
        sh = fk.wpos['upperarm_' + L]
        el = sh + (J['el' + L] - J['sh' + L]).normalized() * RIG['upperArm']
        hands[L] = el + (J['wr' + L] - J['el' + L]).normalized() * RIG['forearm']
    return hands


def stick_targets(hands, mode, lift=0.0):
    """(top grip, blade middle) from the two hands + the grip rules.

    Monocular depth of the wrists is the least reliable number in the video
    (the top hand is often hidden behind the body, and the hands are only a
    foot or two apart), so the shaft is NOT the raw hand-to-hand line: the
    bottom hand's offset from the top hand is scaled out to the blade (the
    bottom hand rides ~45% of the way down the shaft), its sideways and
    vertical parts are kept, and the depth comes from the stick's length: the
    blade sits where a full-length shaft from the top hand reaches the ice, in
    front of the skater. The blade stays on the ice through a shot's wind-up
    and release; after the release (`hands`) it lifts as the hands rise
    (`lift`, ft). A carry keeps it on the ice (`ice`).
    """
    top = hands['R'].copy()
    top.z = min(1.7, max(0.5, top.z))
    low = hands['L']
    full = RIG['stickLen'] - 0.3
    v = (low - top) * 2.2
    bx = top.x + max(-1.6, min(2.6, v.x))
    by = 0.02 + (0.0 if mode == 'ice' else lift)
    dy = top.y - by
    r2 = full * full - dy * dy - (bx - top.x) ** 2
    bz = top.z + math.sqrt(max(0.25, r2))
    return top, Vector((bx, by, bz))


def stick_pose(top, blade):
    h = Vector((blade.x - top.x, 0, blade.z - top.z))
    th = math.atan2(h.z, h.x) if h.length > 1e-3 else 0.9
    # the toe turns ~37 deg off the shaft's heading, as the authored carry holds it
    yawb = -(th - 0.65)
    return dict(blade=tuple(blade), top=tuple(top), yaw=yawb, lowGrip=0.55)


def smooth_points(pts, k, loop):
    """Centred moving average (wraps for loops) - the stick is the noisiest channel."""
    n = len(pts)
    period = max(1, n - 1)  # a loop's last frame repeats its first
    out = []
    for i in range(n):
        acc = Vector((0, 0, 0))
        for j in range(i - k, i + k + 1):
            acc += pts[j % period] if loop else pts[min(n - 1, max(0, j))]
        out.append(acc / (2 * k + 1))
    return out


def load_tracks():
    if not os.path.isdir(TRACK_DIR):
        return []
    out = []
    for fn in sorted(os.listdir(TRACK_DIR)):
        if fn.endswith('.json'):
            with open(os.path.join(TRACK_DIR, fn), encoding='utf-8') as fh:
                out.append(json.load(fh))
    return out


def solve_track(tr, goalie=False):
    """A track -> [(frame, Fk)] (body every frame, stick smoothed over frames)."""
    mode = STICK_MODE.get(tr['name'], 'hands')
    n = len(tr['joints']['nose'])
    fks, hands = [], []
    for t in range(n):
        J = {k: Vector(v[t]) for k, v in tr['joints'].items()}
        fk = solve_body(J, goalie)
        fks.append(fk)
        hands.append(hand_targets(fk, J))
    tops, blades = [], []
    c = tr.get('contact')
    hy = [(h['L'].y + h['R'].y) * 0.5 for h in hands]
    for t in range(n):
        if mode == 'carry':
            break
        # follow-through: the blade rises with the hands after the release
        lift = 0.0 if c is None or t <= c else min(2.5, max(0.0, hy[t] - hy[c]) * 2.5)
        top, blade = stick_targets(hands[t], mode, lift)
        tops.append(top)
        blades.append(blade)
    if mode != 'carry':
        tops = smooth_points(tops, 2, tr.get('loop', False))
        blades = smooth_points(blades, 2, tr.get('loop', False))
    keys = []
    for t, fk in enumerate(fks):
        P = {'stick': 'carry'} if mode == 'carry' else {'stick': stick_pose(tops[t], blades[t])}
        posekit.solve_stick_arms(fk, P)
        keys.append((t, fk))
    return keys


def author_all(arm, author_fk, wanted=lambda name: True):
    """author_fk(name, [(frame, Fk)]) keys one action (clips.author_fks);
    tracks that 'wanted' rejects (clips.ONLY / SKIP) are not solved at all."""
    for tr in load_tracks():
        if wanted(tr['name']):
            author_fk(tr['name'], solve_track(tr))
