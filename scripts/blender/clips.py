"""
The animation catalogue, authored as KEY POSES in the renderer's own pose
semantics (posekit.py) and keyed into Blender actions (Bezier, 30 fps).
Each action is pushed to a muted NLA track so the glTF exporter writes every
clip as its own animation, and so the owner can pick any clip in the Action
editor, tweak keys and re-export (see docs/graphics/BLENDER-PIPELINE.md).

Conventions (root space, feet): +Z = the player's front, +X = his LEFT. Every
skater shoots LEFT (blade on his left side, right hand on top of the stick).
The runtime metadata for each clip (layer mask, hands, loop, contact frame)
lives in src/render3d/animCatalog.ts; tests check both lists match.
"""

import math
import bpy
from mathutils import Vector

import rig
from posekit import build, key_pose, leg, READY

FPS = 30


def P(**kw):
    d = dict(READY)
    d['L'] = dict(READY['L'])
    d['R'] = dict(READY['R'])
    d.update(kw)
    return d


def mirror_leg(lg):
    return dict(lg)


def author(arm, name, keys, goalie):
    """keys: [(frame, pose dict)] → a Blender action on its own muted NLA track."""
    ad = arm.animation_data or arm.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ad.action = act
    prev = None
    for frame, pose in keys:
        fk = build(pose, goalie)
        prev = key_pose(arm, fk, frame, prev)
    # ease in/out on every key (Bezier auto-clamped is Blender's default)
    track = ad.nla_tracks.new()
    track.name = name
    strip = track.strips.new(name, int(keys[0][0]), act)
    strip.name = name
    track.mute = True
    ad.action = None
    return act


# ── helpers ────────────────────────────────────────────────────────────────

def stride_leg(phase_push):
    """A stride leg at the four canonical beats (0 = under body, 1 = full push, 2 = lift, 3 = recover forward)."""
    return [
        leg(flex=0.78, abduct=0.16, knee=1.18),                      # loaded under the hips
        leg(flex=0.22, abduct=0.58, knee=0.3, ankle=-0.02),          # full extension, toe flick
        leg(flex=0.62, abduct=0.3, knee=1.45, ankle=0.55),            # lifted, tucking back in
        leg(flex=1.0, abduct=0.05, knee=1.42, ankle=0.45),            # recovering forward
    ][phase_push]


def carry(sway=0.0, bz=3.0):
    return dict(blade=(1.2 + sway, 0.02, bz))


def stride_keys(extra=None):
    """Full-speed stride: 24 frames = one left push + one right push."""
    extra = extra or {}
    beats = [(0, 0, 3, 0.12), (6, 1, 3, 0.05), (9, 2, 0, -0.02), (12, 3, 0, -0.12), (18, 3, 1, -0.05), (21, 0, 2, 0.02), (24, 0, 3, 0.12)]
    keys = []
    for f, l_beat, r_beat, hx in beats:
        s = math.sin(f / 24 * 2 * math.pi)
        pose = P(lean=0.78, yaw=-0.13 * s, roll=0.04 * s, look=(0.0, 0.1 * s),
                 L=stride_leg(l_beat), R=stride_leg(r_beat), hip=(hx, None, 0.0),
                 hipRot=(0.0, 0.08 * s, 0.0), stick=carry(0.35 * s))
        pose.update(extra)
        keys.append((f, pose))
    return keys


# ── the catalogue ──────────────────────────────────────────────────────────

def skater_clips(arm):
    A = lambda n, k: author(arm, n, k, False)
    hipY = rig.H - 0.5  # approx. hips height in the stance (for hand targets)

    # ── locomotion ──
    A('skate_stride', stride_keys())
    g0 = P(lean=0.6, L=leg(0.58, 0.2, 1.0), R=leg(0.58, 0.2, 1.0), stick=carry(0.0))
    g1 = P(lean=0.62, roll=0.03, hip=(0.05, None, 0), L=leg(0.62, 0.18, 1.06), R=leg(0.54, 0.22, 0.95), stick=carry(0.12))
    g2 = P(lean=0.62, roll=-0.03, hip=(-0.05, None, 0), L=leg(0.54, 0.22, 0.95), R=leg(0.62, 0.18, 1.06), stick=carry(-0.1))
    A('skate_glide', [(0, g0), (13, g1), (27, g2), (40, g0)])

    def cross(mirror):
        s = -1 if mirror else 1
        o, i = ('R', 'L') if not mirror else ('L', 'R')  # outside leg crosses over the inside leg
        def pose(outer, inner, yaw):
            d = P(lean=0.72, yaw=s * yaw, stick=carry(0.2 * s), look=(0.0, s * 0.25))
            d[o] = outer
            d[i] = inner
            return d
        k0 = pose(leg(0.3, 0.52, 0.5), leg(0.75, 0.1, 1.15), 0.12)
        k1 = pose(leg(0.95, -0.3, 1.35, ankle=0.4), leg(0.6, -0.15, 0.95), 0.18)
        k2 = pose(leg(0.62, -0.28, 1.1), leg(0.28, -0.48, 0.42), 0.22)
        k3 = pose(leg(0.72, 0.12, 1.15), leg(0.95, 0.18, 1.4, ankle=0.4), 0.14)
        return [(0, k0), (5, k1), (10, k2), (15, k3), (20, k0)]
    A('skate_crossover_L', cross(False))
    A('skate_crossover_R', cross(True))

    def back(f, lp, rp):
        return (f, P(lean=0.28, look=(-0.15, 0.0), L=lp, R=rp, stick=carry(0.0, 2.6)))
    cc_in = leg(0.72, 0.1, 1.35)
    cc_out = lambda: leg(0.5, 0.48, 0.85, turn=-0.35)
    cc_mid = leg(0.62, 0.3, 1.1, turn=-0.2)
    A('skate_back', [back(0, cc_in, cc_mid), back(6, cc_out(), cc_in), back(12, cc_mid, cc_in), back(18, cc_in, cc_out()), back(24, cc_in, cc_mid)])

    st0 = P(lean=0.7, stick=carry(0.0))
    st1 = P(lean=0.35, yaw=-1.0, hipRot=(-0.2, 1.1, 0.0), L=leg(0.95, 0.25, 1.45), R=leg(0.45, 0.5, 0.8), stick=dict(blade=(0.2, 0.02, 2.6)))
    st2 = P(lean=0.45, yaw=-0.95, hipRot=(-0.12, 1.1, 0.0), L=leg(0.85, 0.22, 1.3), R=leg(0.5, 0.42, 0.9), stick=dict(blade=(0.3, 0.02, 2.8)))
    A('hockey_stop', [(0, st0), (5, st1), (12, st2), (18, st0)])

    sh = lambda f, bx, yaw, byaw: (f, P(yaw=yaw, stick=dict(blade=(bx, 0.02, 2.9), yaw=byaw), look=(0.25, 0.0)))
    A('stickhandle', [sh(0, 1.7, 0.08, -0.35), sh(5, 1.0, 0.0, -0.1), sh(10, 0.3, -0.08, 0.3), sh(15, 1.0, 0.0, -0.1), sh(20, 1.7, 0.08, -0.35)])

    # ── shots & passes (upper body; hands re-gripped on the stick at runtime) ──
    top = lambda x, dy, z: (x, hipY + dy, z)
    A('shot_wrist', [
        (0, P(stick=carry(0.0))),
        (5, P(yaw=0.42, lean=0.62, stick=dict(blade=(1.75, 0.02, 0.5), top=top(0.05, 0.62, 0.95), lowGrip=0.5, yaw=-0.1))),
        (9, P(yaw=0.0, lean=0.55, stick=dict(blade=(0.9, 0.03, 2.5), top=top(-0.2, 0.45, 1.05), lowGrip=0.5, yaw=-0.35))),
        (13, P(yaw=-0.38, lean=0.45, stick=dict(blade=(-0.25, 1.5, 3.7), top=top(-0.75, 0.95, 0.5), lowGrip=0.5, yaw=-0.9, open=0.4))),
        (20, P(stick=carry(0.0))),
    ])
    A('shot_slap', [
        (0, P(stick=carry(0.0))),
        (9, P(yaw=0.65, lean=0.35, L=leg(0.5, 0.36, 0.9), R=leg(0.45, 0.36, 0.85),
              stick=dict(blade=(2.3, 3.9, -1.3), top=top(0.25, 1.35, 0.25), lowGrip=0.42, yaw=0.3))),
        (16, P(yaw=0.35, lean=0.5, L=leg(0.55, 0.36, 0.95), R=leg(0.5, 0.36, 0.9),
               stick=dict(blade=(1.7, 1.3, 0.4), top=top(0.1, 0.85, 0.7), lowGrip=0.42, yaw=0.0))),
        (19, P(yaw=0.0, lean=0.6, L=leg(0.6, 0.38, 1.0), R=leg(0.45, 0.38, 0.8),
               stick=dict(blade=(0.85, 0.03, 2.0), top=top(-0.15, 0.4, 0.9), lowGrip=0.42, yaw=-0.3))),
        (24, P(yaw=-0.55, lean=0.45, L=leg(0.55, 0.3, 0.9), R=leg(0.35, 0.3, 0.6),
               stick=dict(blade=(-0.7, 2.7, 3.7), top=top(-0.85, 0.95, 0.4), lowGrip=0.42, yaw=-1.0, open=0.4))),
        (32, P(stick=carry(0.0))),
    ])
    A('shot_onetimer', [
        (0, P(yaw=0.45, lean=0.5, stick=dict(blade=(2.0, 2.2, -0.6), top=top(0.12, 1.1, 0.35), lowGrip=0.45, yaw=0.2))),
        (7, P(yaw=0.0, lean=0.6, stick=dict(blade=(0.85, 0.03, 2.2), top=top(-0.15, 0.42, 0.95), lowGrip=0.45, yaw=-0.3))),
        (12, P(yaw=-0.42, lean=0.45, stick=dict(blade=(-0.4, 2.0, 3.6), top=top(-0.8, 0.95, 0.45), lowGrip=0.45, yaw=-0.95, open=0.4))),
        (18, P(stick=carry(0.0))),
    ])
    A('pass', [
        (0, P(stick=carry(0.0))),
        (3, P(yaw=0.25, stick=dict(blade=(1.55, 0.02, 1.3), top=top(0.0, 0.55, 1.0), yaw=-0.15))),
        (6, P(yaw=-0.05, stick=dict(blade=(0.6, 0.02, 2.7), top=top(-0.2, 0.5, 1.05), yaw=-0.45))),
        (9, P(yaw=-0.22, stick=dict(blade=(-0.05, 0.45, 3.1), top=top(-0.45, 0.6, 0.9), yaw=-0.8, open=0.25))),
        (14, P(stick=carry(0.0))),
    ])
    fo = lambda f, bob: (f, P(lean=1.0, look=(-0.55, 0.0), hip=(0, None, -0.1), L=leg(0.95, 0.34, 1.55 + bob), R=leg(0.95, 0.34, 1.55 + bob),
                              stick=dict(blade=(0.35, 0.02, 2.3), top=top(-0.35, -0.2, 1.25), lowGrip=0.32, yaw=-0.25)))
    A('faceoff_crouch', [fo(0, 0.0), fo(15, 0.05), fo(30, 0.0)])
    A('faceoff_draw', [
        fo(0, 0.0),
        (4, P(lean=0.95, yaw=0.3, look=(-0.4, 0.0), L=leg(0.9, 0.34, 1.5), R=leg(0.9, 0.34, 1.5),
              stick=dict(blade=(0.9, 0.02, 1.0), top=top(-0.2, -0.1, 1.1), lowGrip=0.32, yaw=0.5))),
        (9, P(lean=0.8, yaw=0.45, L=leg(0.8, 0.3, 1.3), R=leg(0.8, 0.3, 1.3),
              stick=dict(blade=(1.5, 0.02, -0.2), top=top(0.05, 0.2, 0.8), lowGrip=0.35, yaw=0.9))),
        (16, P(stick=carry(0.0))),
    ])

    # ── hitting ──
    A('check', [
        (0, P(lean=0.72, stick=carry(0.0))),
        (5, P(lean=0.8, yaw=-0.55, L=leg(0.85, 0.25, 1.35), R=leg(0.85, 0.25, 1.35), shrugL=0.15,
              stick=dict(blade=(1.0, 0.1, 1.6), top=top(-0.1, 0.55, 0.8)))),
        (8, P(lean=0.3, yaw=-0.75, roll=-0.12, hip=(0, None, 0.35), L=leg(0.3, 0.2, 0.45), R=leg(0.45, 0.25, 0.6), shrugL=0.3,
              stick=dict(blade=(0.9, 0.35, 1.3), top=top(-0.2, 0.9, 0.75)))),
        (12, P(lean=0.45, yaw=-0.45, hip=(0, None, 0.2), stick=dict(blade=(1.0, 0.1, 2.0), top=top(-0.1, 0.6, 0.9)))),
        (18, P(stick=carry(0.0))),
    ])
    pin_hands = dict(handL=(0.55, hipY + 1.85, 1.9), handR=(-0.45, hipY + 1.7, 1.85),
                     stick=dict(hand='R', dir=(0.25, 0.9, -0.3), grip=3.4))
    A('check_boards', [
        (0, P(lean=0.72, stick=carry(0.0))),
        (5, P(lean=0.85, yaw=-0.5, L=leg(0.85, 0.25, 1.35), R=leg(0.85, 0.25, 1.35), shrugL=0.2,
              stick=dict(blade=(1.0, 0.1, 1.6), top=top(-0.1, 0.55, 0.8)))),
        (8, P(lean=0.45, yaw=-0.35, hip=(0, None, 0.35), L=leg(0.45, 0.3, 0.7), R=leg(0.7, 0.3, 1.0), **pin_hands)),
        (15, P(lean=0.5, yaw=-0.3, hip=(0, None, 0.3), L=leg(0.5, 0.3, 0.8), R=leg(0.72, 0.3, 1.05), **pin_hands)),
        (22, P(lean=0.48, yaw=-0.32, hip=(0, None, 0.32), L=leg(0.48, 0.3, 0.75), R=leg(0.7, 0.3, 1.0), **pin_hands)),
        (30, P(stick=carry(0.0))),
    ])
    A('hit_stagger', [
        (0, P(stick=carry(0.0))),
        (3, P(lean=0.05, roll=0.28, yaw=0.25, look=(-0.3, -0.3), stick=carry(0.4, 2.4))),
        (8, P(lean=0.85, roll=-0.12, yaw=-0.1, stick=carry(-0.2))),
        (18, P(stick=carry(0.0))),
    ])
    flail = dict(handL=(1.4, hipY + 1.2, 0.2), handR=(-1.4, hipY + 1.6, 0.4), stick=dict(hand='R', dir=(-0.3, -0.5, -0.8), grip=3.0))
    A('hit_stumble', [
        (0, P(stick=carry(0.0))),
        (4, P(lean=0.05, hipRot=(-0.28, 0.0, 0.1), hip=(0, None, -0.4), look=(-0.4, 0.0), L=leg(0.4, 0.3, 0.6), R=leg(0.6, 0.2, 0.9), **flail)),
        (10, P(lean=0.3, hipRot=(-0.15, 0.0, -0.1), hip=(0, None, -0.6), L=leg(1.0, 0.2, 1.5, ankle=0.6), R=leg(0.5, 0.45, 0.8), **flail)),
        (17, P(lean=0.95, L=leg(0.9, 0.35, 1.45), R=leg(0.85, 0.4, 1.4), stick=carry(0.0, 2.6))),
        (30, P(stick=carry(0.0))),
    ])
    down_arms = dict(handL=(1.6, 0.5, -0.4), handR=(-1.5, 0.6, -0.2), stick=dict(hand='R', dir=(-0.1, -0.15, 1.0), grip=3.2))
    A('hit_fall', [
        (0, P(stick=carry(0.0))),
        (4, P(lean=0.0, hipRot=(-0.45, 0.0, 0.15), hip=(0, None, -0.5), look=(-0.5, 0.0), L=leg(0.5, 0.3, 0.7), R=leg(0.8, 0.2, 1.2),
              handL=(1.5, hipY + 1.4, 0.3), handR=(-1.5, hipY + 1.6, 0.4), stick=dict(hand='R', dir=(-0.3, -0.5, -0.8), grip=3.0))),
        (10, P(lean=0.1, hipRot=(-1.0, 0.0, 0.2), hip=(0, 1.35, -1.1), look=(-0.2, 0.0), L=leg(1.1, 0.25, 1.2), R=leg(1.3, 0.2, 1.5),
               handL=(1.6, 1.4, -0.9), handR=(-1.6, 1.5, -0.8), stick=dict(hand='R', dir=(-0.2, -0.3, 1.0), grip=3.2))),
        (15, P(lean=0.15, hipRot=(-1.35, 0.0, 0.1), hip=(0, 0.75, -1.4), look=(0.35, 0.0), L=leg(0.9, 0.25, 0.9), R=leg(1.1, 0.2, 1.3), **down_arms)),
        (30, P(lean=0.1, hipRot=(-1.4, 0.0, 0.12), hip=(0, 0.7, -1.45), look=(0.45, 0.2), L=leg(0.6, 0.25, 0.5), R=leg(0.9, 0.2, 1.1), **down_arms)),
    ])
    A('getup', [
        (0, P(lean=0.1, hipRot=(-1.4, 0.0, 0.12), hip=(0, 0.7, -1.45), look=(0.45, 0.2), L=leg(0.6, 0.25, 0.5), R=leg(0.9, 0.2, 1.1), **down_arms)),
        (12, P(lean=1.0, hipRot=(-0.35, 0.0, 0.0), hip=(0, 0.85, -0.8), L=leg(1.5, 0.3, 2.1), R=leg(1.4, 0.25, 2.0),
               handL=(1.1, 0.15, 0.4), handR=(-1.0, 0.15, 0.6), stick=dict(hand='R', dir=(-0.05, 0.25, 0.97), grip=3.0))),
        (24, P(lean=0.35, hip=(0, 1.95, -0.2), L=leg(0.05, 0.15, 1.65), R=leg(0.1, 0.15, 1.7), look=(-0.2, 0.0),
               handL=(0.7, 1.6, 1.2), handR=(-0.8, 1.8, 1.1), stick=dict(hand='R', dir=(0.1, 0.2, 0.97), grip=3.0))),
        (32, P(lean=0.55, hip=(0, None, 0.0), L=leg(1.35, 0.15, 1.5), R=leg(0.1, 0.15, 1.65), stick=carry(0.0, 2.4))),
        (40, P(stick=carry(0.0))),
    ])
    glass = dict(handL=(0.95, hipY + 2.5, 1.15), handR=(-0.95, hipY + 2.35, 1.15), stick=dict(hand='R', dir=(0.1, 0.95, 0.25), grip=3.6))
    A('pinned_boards', [
        (0, P(stick=carry(0.0))),
        (3, P(lean=-0.05, roll=0.1, look=(0.1, 0.9), L=leg(0.45, 0.2, 0.8), R=leg(0.45, 0.2, 0.8), hip=(0, None, 0.25), **glass)),
        (15, P(lean=0.0, roll=0.06, look=(0.15, 0.85), L=leg(0.5, 0.22, 0.9), R=leg(0.48, 0.2, 0.85), hip=(0, None, 0.3), **glass)),
        (22, P(lean=0.05, roll=0.08, look=(0.1, 0.8), L=leg(0.5, 0.22, 0.9), R=leg(0.5, 0.2, 0.9), hip=(0, None, 0.28), **glass)),
        (30, P(stick=carry(0.0))),
    ])

    # ── celebrations ──
    fist_stick = dict(hand='L', dir=(-0.3, 0.6, -0.74), grip=3.2)
    fist = lambda f, y, z, lift: (f, P(lean=0.4, look=(-0.2, 0.0), handR=(-0.75, hipY + y, z), handL=(0.9, hipY + 0.45, 1.3),
                                       stick=fist_stick, L=leg(0.55 + lift, 0.15, 0.9 + lift * 1.6), R=leg(0.5, 0.18, 0.85)))
    A('celly_fistpump', [
        (0, P(stick=carry(0.0))),
        fist(6, 1.9, 0.8, 0.0), fist(10, 0.45, 1.25, 0.55), fist(16, 1.8, 0.8, 0.1), fist(21, 0.5, 1.2, 0.5), fist(30, 1.2, 0.9, 0.0),
        (40, P(stick=carry(0.0))),
    ])
    up = lambda f, dy, sway: (f, P(lean=0.1, look=(-0.45, 0.0), hip=(0, rig.H - 0.35 + dy, 0), L=leg(0.3, 0.14, 0.55), R=leg(0.3, 0.14, 0.55),
                                   handR=(-0.55 + sway, hipY + 3.1, 0.5), handL=(0.8 + sway, hipY + 2.95, 0.45),
                                   stick=dict(hand='R', dir=(0.15 + sway * 0.3, -0.95, 0.2), grip=4.4)))
    A('celly_armsup', [(0, P(stick=carry(0.0))), up(8, 0.15, 0.0), up(16, 0.0, 0.15), up(26, 0.08, -0.12), up(38, 0.0, 0.0), (50, P(stick=carry(0.0)))])
    hug = lambda f, dy: (f, P(lean=0.45, look=(-0.1, 0.35), hip=(0, rig.H - 0.55 + dy, 0), L=leg(0.45, 0.2, 0.85), R=leg(0.45, 0.2, 0.85),
                              handL=(0.25, hipY + 1.95, 1.75), handR=(-0.3, hipY + 1.9, 1.8),
                              stick=dict(hand='R', dir=(0.05, -0.7, -0.7), grip=4.2)))
    A('celly_hug', [(0, P(stick=carry(0.0))), hug(8, 0.0), hug(16, 0.12), hug(24, 0.0), hug(32, 0.1), hug(44, 0.0), (60, P(stick=carry(0.0)))])

    # ── broadcast moments ──
    lap = []
    for f, pose in stride_keys():
        s = math.sin(f / 24 * 2 * math.pi)
        pose = dict(pose)
        pose['lean'] = 0.45
        pose['handL'] = (1.25 + 0.2 * s, hipY + 2.9, 0.4)
        pose['look'] = (-0.2, 0.7)
        pose['stick'] = dict(hand='R', dir=(-0.35, 0.5, -0.8), grip=3.4)
        pose['handR'] = (-0.7, hipY + 0.35, 1.2)
        lap.append((f, pose))
    A('rookie_lap', lap)
    sal = lambda f, sway, look: (f, P(lean=0.12, look=(-0.35, look), hip=(0, None, 0), L=leg(0.3, 0.15, 0.5), R=leg(0.3, 0.15, 0.5),
                                      handR=(-0.4 + sway, hipY + 3.0, 0.75), handL=(0.95, hipY + 0.2, 0.6),
                                      stick=dict(hand='R', dir=(0.1 + sway * 0.4, -0.97, 0.15), grip=4.5)))
    A('salute', [(0, P(stick=carry(0.0))), sal(12, 0.0, -0.4), sal(26, 0.2, 0.0), sal(40, -0.15, 0.4), sal(52, 0.0, 0.1), (60, sal(60, 0.0, 0.0)[1])])
    seat = dict(hip=(0, 1.95, -0.25), L=leg(1.45, 0.2, 1.45, ankle=0.0), R=leg(1.45, 0.2, 1.45, ankle=0.0),
                handR=(-0.1, 3.0, 1.3), handL=(0.15, 2.7, 1.3), stick=dict(hand='R', dir=(0.02, 0.97, -0.22), grip=3.1))
    A('bench_standup', [
        (0, P(lean=0.25, look=(-0.1, 0.0), **seat)),
        (10, P(lean=0.25, look=(-0.1, 0.0), **seat)),
        (22, P(lean=0.95, hip=(0, 2.35, 0.25), L=leg(1.25, 0.2, 1.6), R=leg(1.25, 0.2, 1.6),
               handR=(-0.2, 3.2, 1.6), handL=(0.2, 2.9, 1.7), stick=dict(hand='R', dir=(0.0, 0.97, -0.22), grip=3.1))),
        (32, P(lean=0.4, L=leg(0.4, 0.15, 0.6), R=leg(0.4, 0.15, 0.6), stick=carry(0.0, 2.4))),
        (40, P(stick=carry(0.0))),
    ])


def goalie_clips(arm):
    A = lambda n, k: author(arm, n, k, True)
    hipY = rig.H - 0.55

    def G(**kw):
        d = dict(lean=0.45, L=leg(0.72, 0.3, 1.0), R=leg(0.72, 0.3, 1.0),
                 handL=(1.2, hipY + 0.75, 1.25), handR=(-1.0, hipY + 0.45, 1.25),
                 stick=dict(hand='R', dir=(-0.14, 0.5, -0.12), grip=2.0, yaw=0.05))
        d.update(kw)
        return d
    fly = lambda **kw: G(lean=0.14, hip=(0, 1.35, 0), L=leg(0.3, -0.1, 1.62, splay=1.15), R=leg(0.3, -0.1, 1.62, splay=1.15),
                         handL=(1.3, 2.3, 1.4), handR=(-1.1, 2.0, 1.4), stick=dict(hand='R', dir=(-0.1, 0.55, -0.35), grip=1.9, yaw=0.05), **kw)
    A('g_stance', [(0, G()), (30, G(lean=0.48, hip=(0.04, None, 0), handL=(1.22, hipY + 0.78, 1.25))), (60, G())])
    A('g_butterfly', [(0, G()), (4, fly()), (20, fly()), (30, G())])
    A('g_glove_save', [
        (0, G()),
        (4, G(roll=0.28, lean=0.35, look=(-0.25, 0.55), handL=(1.95, hipY + 2.1, 1.35), L=leg(0.55, 0.45, 0.8), R=leg(0.85, 0.2, 1.25))),
        (12, G(roll=0.22, lean=0.4, look=(-0.1, 0.5), handL=(1.6, hipY + 1.6, 1.2), L=leg(0.6, 0.4, 0.9), R=leg(0.8, 0.22, 1.2))),
        (24, G()),
    ])
    A('g_blocker_save', [
        (0, G()),
        (4, G(roll=-0.25, lean=0.4, look=(-0.2, -0.5), handR=(-1.95, hipY + 1.3, 1.2),
              stick=dict(hand='R', dir=(0.2, 0.4, -0.3), grip=1.9, yaw=0.1), R=leg(0.55, 0.45, 0.8), L=leg(0.85, 0.2, 1.25))),
        (11, G(roll=-0.18, lean=0.42, handR=(-1.6, hipY + 0.9, 1.25), R=leg(0.6, 0.4, 0.9), L=leg(0.8, 0.22, 1.2))),
        (20, G()),
    ])
    A('g_pad_save', [
        (0, G()),
        (4, G(roll=0.2, lean=0.3, hip=(0.25, None, 0), look=(0.2, -0.4), R=leg(0.15, 1.05, 0.08, ankle=0.2), L=leg(1.0, 0.25, 1.75, splay=0.6),
              handL=(1.4, 2.6, 1.3))),
        (12, G(roll=0.18, lean=0.32, hip=(0.25, None, 0), look=(0.25, -0.35), R=leg(0.15, 1.0, 0.1, ankle=0.2), L=leg(1.0, 0.25, 1.75, splay=0.6),
               handL=(1.4, 2.5, 1.3))),
        (24, G()),
    ])
    A('g_scramble', [
        (0, fly()),
        (8, G(hipRot=(0.1, 0.0, 0.7), hip=(-1.0, 1.1, 0.2), lean=0.3, roll=-0.2, look=(0.0, -0.6),
              L=leg(0.2, 0.9, 0.2), R=leg(0.5, -0.2, 1.3, splay=0.5), handR=(-2.2, 1.0, 1.6), handL=(0.6, 2.4, 1.2),
              stick=dict(hand='R', dir=(-0.2, 0.25, -0.95), grip=1.9, yaw=0.3))),
        (22, G(hipRot=(0.15, 0.0, 0.85), hip=(-1.2, 0.95, 0.3), lean=0.35, roll=-0.25, look=(0.1, -0.7),
               L=leg(0.15, 1.0, 0.15), R=leg(0.45, -0.2, 1.2, splay=0.5), handR=(-2.4, 0.5, 1.9), handL=(0.8, 2.6, 1.0),
               stick=dict(hand='R', dir=(-0.3, 0.1, -0.95), grip=1.9, yaw=0.35))),
        (32, fly()),
        (40, G()),
    ])
    sad = lambda look, dy=0.0: G(lean=0.2, look=look, hip=(0, rig.H - 0.4 + dy, 0), L=leg(0.2, 0.15, 0.35), R=leg(0.2, 0.15, 0.35),
                                 handR=(-0.75, hipY - 0.1, 1.0), handL=(0.8, hipY + 0.05, 0.9),
                                 stick=dict(hand='R', dir=(-0.1, 0.15, -0.98), grip=1.8, yaw=0.0))
    A('g_dejected', [(0, G()), (10, sad((0.75, 0.0))), (24, sad((0.8, 0.1), -0.03)), (38, sad((0.55, 0.65))), (50, sad((0.6, -0.5))), (60, sad((0.75, 0.0)))])


def author_all(arm, goalie):
    arm.animation_data_create()
    if goalie:
        goalie_clips(arm)
    else:
        skater_clips(arm)
