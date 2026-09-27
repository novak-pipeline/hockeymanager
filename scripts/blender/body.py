"""
The hockey athlete meshes (skater + goalie), authored in renderer space.

Construction: the sweater (torso + sleeves) and the breezers are each ONE
continuous surface grown with the Skin modifier + Subdivision in an A-pose
(arms 40° out, so the armpits stay clean), weighted, then LBS-posed down into
the renderer's rest pose (arms hanging, every limb bone pointing −Y). The
rest are lofted / bevelled equipment pieces with rigid or blended weights.
"""

import math
from mathutils import Vector, Matrix, Quaternion

from rig import RIG, H, rest_positions
from meshkit import (Part, loft, ring, frame_for, rounded_box, ellipsoid, skin_shape, smooth, lerp, rigid,
                     REGION, WHITE_UV)

A_POSE = math.radians(40)


def seg_t(p, a, d):
    """Projection param of p on the ray a + t·d (d unit) and the perpendicular distance."""
    v = p - a
    t = v.dot(d)
    perp = (v - d * t).length
    return t, perp


def torso_w(y):
    sp = smooth(H + 0.2, H + 0.7, y)
    ch = smooth(H + 1.05, H + 1.55, y)
    return {'hips': 1 - sp, 'spine': sp * (1 - ch), 'chest': sp * ch}


def arm_w(t, L):
    ua, fa = RIG['upperArm'], RIG['forearm']
    f = smooth(ua - 0.3, ua + 0.2, t)
    h = smooth(ua + fa - 0.12, ua + fa + 0.05, t)
    return {'upperarm_' + L: (1 - f), 'forearm_' + L: f * (1 - h), 'hand_' + L: f * h}


def mix_w(a, b, k):
    out = {}
    for d, s in ((a, 1 - k), (b, k)):
        for bn, x in d.items():
            out[bn] = out.get(bn, 0) + x * s
    return out


# ── sweater ────────────────────────────────────────────────────────────────

def sweater(goalie):
    pos = rest_positions(goalie)
    g = 1.12 if goalie else 1.0
    sw = pos['shoulder_L'].x
    shY = pos['shoulder_L'].y
    arms = {}
    for L, s in (('L', 1), ('R', -1)):
        d = Vector((s * math.sin(A_POSE), -math.cos(A_POSE), 0))
        arms[L] = (Vector((s * sw, shY, 0.02)), d)
    ua, fa = RIG['upperArm'], RIG['forearm']
    wrist_t = ua + fa - 0.06
    sleeve = (0.44 * g, 0.3 * g, 0.22 * g)  # shoulder cap, elbow, cuff radii
    nodes = [
        (Vector((0, H - 0.24, 0)), 0.84 * g),    # 0 hem (flared)
        (Vector((0, H + 0.18, 0)), 0.76 * g),    # 1 waist
        (Vector((0, H + 0.78, 0)), 0.82 * g),    # 2 belly
        (Vector((0, H + 1.4, 0)), 0.94 * g),     # 3 chest
        (Vector((0, H + 1.9, 0)), 0.8 * g),      # 4 yoke (shoulder line)
        (Vector((0, H + 2.24, 0.03)), 0.3),      # 5 collar
    ]
    edges = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5)]
    for L in ('L', 'R'):
        a, d = arms[L]
        base = len(nodes)
        s = 1 if L == 'L' else -1
        nodes.append((Vector((s * (sw - 0.06), shY - 0.02, 0.02)), sleeve[0]))      # pad cap
        nodes.append((a + d * 0.45, sleeve[0] * 0.86))                              # upper sleeve
        nodes.append((a + d * ua, sleeve[1]))                                       # elbow
        nodes.append((a + d * (ua + 0.55), sleeve[2] * 1.08))                       # forearm
        nodes.append((a + d * wrist_t, sleeve[2]))                                  # cuff
        edges += [(4, base), (base, base + 1), (base + 1, base + 2), (base + 2, base + 3), (base + 3, base + 4)]
    verts, faces = skin_shape('sweater', nodes, edges, subsurf=2, branch_smooth=0.8)

    # ── per-vertex region / weights (A-pose) ──
    armness = []
    wts = []
    tvals = []
    for p in verts:
        best = (0.0, None, 0.0)
        for L in ('L', 'R'):
            a, d = arms[L]
            if (p.x > 0) != (L == 'L'):
                continue
            t, perp = seg_t(p, a, d)
            rs = lerp(sleeve[0], sleeve[2], min(1, max(0, t / wrist_t)))
            k = smooth(-0.12, 0.3, t) * (1 - smooth(rs + 0.08, rs + 0.3, perp))
            if k >= best[0]:
                best = (k, L, t)
        k, L, t = best
        armness.append(k)
        tvals.append((L, t))
        tw = torso_w(p.y)
        if L is None or k <= 0:
            wts.append(tw)
        else:
            aw = arm_w(t, L)
            # the shoulder pad cap rides the clavicle a little
            aw['shoulder_' + L] = 0.35 * (1 - smooth(0.0, 0.35, t))
            wts.append(mix_w(tw, aw, k))

    # ── shape tweaks: torso depth, flat back, flared hem, hem hang ──
    out = []
    for p, k in zip(verts, armness):
        q = Vector(p)
        tor = 1 - k
        depth = lerp(1.0, 0.72 if not goalie else 0.8, tor)
        q.z *= depth
        if q.z < 0:
            q.z *= lerp(1.0, 0.9, tor)  # flatter back
        # shoulder-pad shelf: square the slope of the shoulders
        sh = tor * smooth(H + 1.45, H + 1.85, q.y) * smooth(0.25, 0.55, abs(q.x)) * (1 - smooth(H + 2.15, H + 2.3, q.y))
        q.y += 0.1 * sh
        # flare the bottom ~0.35 ft outward (loose sweater over the breezers)
        fl = tor * (1 - smooth(H - 0.4, H + 0.15, q.y))
        if fl > 0:
            r = math.hypot(q.x, q.z)
            if r > 1e-4:
                q.x *= 1 + 0.1 * fl
                q.z *= 1 + 0.1 * fl
            q.y -= 0.04 * fl
        out.append(q)
    verts = out

    # ── pose the arms down into the renderer rest pose (LBS by the weights) ──
    rest = []
    for p, w in zip(verts, wts):
        q = Vector(p)
        for L, s in (('L', 1), ('R', -1)):
            wa = sum(w.get(b + L, 0) for b in ('upperarm_', 'forearm_', 'hand_'))
            if wa <= 0:
                continue
            a, _ = arms[L]
            R = Matrix.Rotation(-s * A_POSE, 3, 'Z')
            rq = a + R @ (p - a)
            q = q + (rq - p) * wa
        rest.append(q)

    part = Part('sweater')
    for q, w in zip(rest, wts):
        part.vert(q, w)
    # UVs: torso u = around the body (0 = front, 0.25 = left), v = height;
    # sleeves u = around the arm, v = wrist→shoulder. Computed in the A-pose.
    t0, t1 = H - 0.3, H + 2.33
    for f in faces:
        ks = [armness[i] for i in f]
        is_sleeve = sum(ks) / len(ks) > 0.5
        uvs = []
        if is_sleeve:
            L = tvals[f[0]][0] or ('L' if verts[f[0]].x > 0 else 'R')
            a, d = arms[L]
            ax_u, ax_v = frame_for(d)
            us = []
            for i in f:
                v = verts[i] - a
                ang = math.atan2(v.dot(ax_u), v.dot(ax_v)) / (2 * math.pi)
                us.append(ang % 1.0)
            if max(us) - min(us) > 0.5:
                # straddles the sleeve seam: pin the small side to 1.0 (stays in the slot)
                us = [1.0 if u < 0.5 else u for u in us]
            for i, u in zip(f, us):
                t = tvals[i][1] if tvals[i][0] == L else 0
                vv = min(1, max(0, t / wrist_t))
                s0, s1 = REGION['sleeve']
                # sleeve v: 0 = wrist, 1 = shoulder
                uvs.append((u, s0 + (1 - vv) * (s1 - s0)))
        else:
            us = []
            for i in f:
                p = verts[i]
                us.append((math.atan2(p.x, p.z) / (2 * math.pi)) % 1.0)
            if max(us) - min(us) > 0.5:
                # face straddles the front seam: pin the small side to 1.0
                us = [1.0 if u < 0.5 else u for u in us]
            for i, u in zip(f, us):
                y = verts[i].y
                vv = min(1, max(0, (y - t0) / (t1 - t0)))
                r0, r1 = REGION['torso']
                uvs.append((u, r0 + vv * (r1 - r0)))
        part.face(f, uvs, 'jersey')
    return part


# ── breezers ───────────────────────────────────────────────────────────────

def breezers(goalie):
    hw = RIG['hipHalfWidth']
    g = 1.1 if goalie else 1.0
    nodes = [
        (Vector((0, H + 0.42, 0)), 0.74 * g),
        (Vector((0, H + 0.02, 0)), 0.9 * g),
        (Vector((hw + 0.1, H - 0.42, 0.02)), 0.58 * g),
        (Vector((hw + 0.08, H - 1.02, 0.05)), 0.5 * g),
        (Vector((-hw - 0.1, H - 0.42, 0.02)), 0.58 * g),
        (Vector((-hw - 0.08, H - 1.02, 0.05)), 0.5 * g),
    ]
    edges = [(0, 1), (1, 2), (2, 3), (1, 4), (4, 5)]
    verts, faces = skin_shape('breezers', nodes, edges, subsurf=2, branch_smooth=0.7)
    part = Part('breezers')
    for p in verts:
        q = Vector(p)
        q.z *= 0.86
        side = 'L' if q.x > 0 else 'R'
        th = smooth(H - 0.15, H - 0.75, q.y) * smooth(0.02, 0.2, abs(q.x))
        part.vert(q, {'hips': 1 - th, 'thigh_' + side: th})
    for f in faces:
        part.face(f, [WHITE_UV] * len(f), 'pants')
    return part


# ── legs: sock over shin pad (one tube ankle → under the breezer hem) ─────

def legs(goalie):
    part = Part('legs')
    pos = rest_positions(goalie)
    for L, s in (('L', 1), ('R', -1)):
        x = s * RIG['hipHalfWidth']
        ankle = pos['foot_' + L].y
        knee = pos['shin_' + L].y
        top = H - 0.7
        prof = [  # (y, radius, front bulge)
            (ankle + 0.02, 0.19, 0.0), (ankle + 0.3, 0.22, 0.04), (ankle + 0.7, 0.27, 0.07),
            (knee - 0.55, 0.3, 0.09), (knee - 0.2, 0.31, 0.1), (knee + 0.05, 0.33, 0.12),
            (knee + 0.3, 0.33, 0.07), (knee + 0.7, 0.36, 0.02), (top, 0.39, 0.0),
        ]
        rings = []
        for y, r, bulge in prof:
            def shp(a, ru, rv, bulge=bulge):
                c = math.cos(a)
                return ru, rv + (bulge if c > 0 else 0) * c * c
            rings.append(ring((x, y, 0), (1, 0, 0), (0, 0, 1), r, r * 0.95, 16, shape=shp))
        k0, k1 = knee - 0.22, knee + 0.22

        def w(p, L=L):
            k = smooth(k0, k1, p.y)
            return {'shin_' + L: 1 - k, 'thigh_' + L: k}
        s0, s1 = REGION['sock']
        # v runs ankle (0) → hem (1)
        loft(part, rings, 'jersey', w, uv_region=(s0, s1))
    return part


# ── skates ─────────────────────────────────────────────────────────────────

def skates(goalie):
    part = Part('skates')
    pos = rest_positions(goalie)
    for L in ('L', 'R'):
        f = pos['foot_' + L]
        bone = 'foot_' + L
        w = rigid(bone)
        # lower boot: lofted along the foot, heel → toe (rounded-rect sections)
        prof = [  # (z, width, top y, bottom y)
            (-0.3, 0.22, 0.26, -0.26), (-0.26, 0.3, 0.32, -0.27), (-0.1, 0.34, 0.28, -0.28), (0.12, 0.35, 0.12, -0.28),
            (0.35, 0.34, -0.02, -0.28), (0.52, 0.3, -0.1, -0.28), (0.64, 0.2, -0.15, -0.27), (0.68, 0.08, -0.2, -0.26),
        ]
        rings = []
        for z, wd, ty, by in prof:
            cy = (ty + by) / 2
            rings.append(ring((f.x, f.y + cy, f.z + z), (1, 0, 0), (0, 1, 0), wd / 2, (ty - by) / 2, 14, power=3.2))
        loft(part, rings, 'boot', w, cap_start=True, cap_end=True)
        # ankle cuff + tendon guard
        cuff = []
        for y, r, back in ((0.1, 0.2, 0.0), (0.3, 0.2, 0.02), (0.44, 0.21, 0.1)):
            cuff.append(ring((f.x, f.y + y, f.z - 0.04 - back * 0.5), (1, 0, 0), (0, 0, 1), r, r * 1.05 + back * 0.4, 14))
        loft(part, cuff, 'boot', w)
        # holder + steel (slight rocker)
        rounded_box(part, (f.x, f.y - 0.31, f.z + 0.16), (0.09, 0.08, 0.92), 'boot', w, radius=0.02, segs=1)
        steel = []
        for i in range(9):
            t = i / 8
            z = lerp(-0.34, 0.68, t)
            lift = 0.03 * ((2 * t - 1) ** 4)
            steel.append((z, lift))
        rings = [ring((f.x, f.y - RIG['skate'] + 0.035 + lift, f.z + z), (1, 0, 0), (0, 1, 0), 0.016, 0.035, 4, phase=math.pi / 4)
                 for z, lift in steel]
        loft(part, rings, 'steel', w, cap_start=True, cap_end=True)
    return part


# ── gloves ─────────────────────────────────────────────────────────────────

def gloves(goalie):
    part = Part('gloves')
    pos = rest_positions(goalie)
    for L, s in (('L', 1), ('R', -1)):
        hp = pos['hand_' + L]
        bone = 'hand_' + L
        w = rigid(bone)
        if goalie and L == 'L':
            catcher(part, hp, s)
            continue
        if goalie and L == 'R':
            blocker(part, hp, s)
            continue
        # gauntlet cuff: flares up over the sleeve end
        cuff = [ring((hp.x, hp.y + y, hp.z), (1, 0, 0), (0, 0, 1), r, r * 1.05, 14)
                for y, r in ((-0.12, 0.19), (0.05, 0.215), (0.24, 0.245), (0.3, 0.235))]
        loft(part, cuff, 'gloves', lambda p, L=L: {'hand_' + L: 1.0}, cap_start=True)
        # padded back of the hand
        rounded_box(part, (hp.x, hp.y - 0.26, hp.z + 0.01), (0.3, 0.36, 0.4), 'gloves', w, radius=0.09, segs=2)
        # finger rolls (three stacked bumps down the fingers)
        for i, y in enumerate((-0.47, -0.56, -0.64)):
            rounded_box(part, (hp.x, hp.y + y, hp.z + 0.02 - 0.015 * i), (0.28, 0.1, 0.38 - 0.03 * i), 'gloves', w,
                        radius=0.045, segs=2)
        # thumb
        rounded_box(part, (hp.x - s * 0.02, hp.y - 0.34, hp.z + 0.24), (0.14, 0.24, 0.14), 'gloves', w, radius=0.06, segs=2)
    return part


def catcher(part, hp, s):
    w = rigid('hand_L')
    # a big cupped pocket facing out (+X): lathe along the X axis
    rings = []
    for x, r in ((0.0, 0.16), (0.08, 0.42), (0.18, 0.56), (0.28, 0.58), (0.34, 0.5), (0.36, 0.3)):
        rings.append(ring((hp.x + s * (x - 0.02), hp.y - 0.28, hp.z + 0.06), (0, 1, 0), (0, 0, 1), r, r * 0.92, 20))
    loft(part, rings, 'pad', w, cap_start=True, cap_end=True)
    # T-trap web
    rounded_box(part, (hp.x + s * 0.3, hp.y - 0.62, hp.z + 0.06), (0.08, 0.3, 0.46), 'padTrim', w, radius=0.03, segs=1)
    cuff = [ring((hp.x, hp.y + y, hp.z), (1, 0, 0), (0, 0, 1), r, r, 14) for y, r in ((-0.2, 0.24), (0.1, 0.27), (0.24, 0.26))]
    loft(part, cuff, 'pad', w, cap_start=True)


def blocker(part, hp, s):
    w = rigid('hand_R')
    # the board rides on the back (outside, −X) of the stick hand
    rounded_box(part, (hp.x + s * 0.2, hp.y - 0.2, hp.z + 0.04), (0.1, 1.0, 0.66), 'pad', w, radius=0.04, segs=2)
    rounded_box(part, (hp.x + s * 0.26, hp.y - 0.2, hp.z + 0.04), (0.02, 0.82, 0.5), 'padTrim', w, radius=0.01, segs=1)
    rounded_box(part, (hp.x, hp.y - 0.2, hp.z), (0.32, 0.46, 0.4), 'gloves', w, radius=0.09, segs=2)
    cuff = [ring((hp.x, hp.y + y, hp.z), (1, 0, 0), (0, 0, 1), r, r, 14) for y, r in ((-0.05, 0.22), (0.22, 0.25))]
    loft(part, cuff, 'gloves', w, cap_start=True)


# ── neck, head, helmet / mask ──────────────────────────────────────────────

def head(goalie):
    part = Part('head')
    pos = rest_positions(goalie)
    nk, hd = pos['neck'], pos['head']
    # neck (blends chest → neck)
    rings = [ring((0, nk.y + y, nk.z + 0.01), (1, 0, 0), (0, 0, 1), r, r * 1.02, 14)
             for y, r in ((-0.22, 0.24), (0.0, 0.2), (0.16, 0.185), (0.32, 0.19))]
    loft(part, rings, 'skin', lambda p: {'chest': 1 - smooth(nk.y - 0.05, nk.y + 0.2, p.y), 'neck': smooth(nk.y - 0.05, nk.y + 0.2, p.y)})
    hw = rigid('head')
    c = Vector((0, hd.y + 0.25, hd.z + 0.05))
    # skull / face
    ellipsoid(part, c, (0.25, 0.3, 0.28), 'skin', hw, 18, 12)
    # jaw + chin
    ellipsoid(part, c + Vector((0, -0.14, 0.08)), (0.2, 0.15, 0.2), 'skin', hw, 14, 8)
    # nose, brow, ears
    ellipsoid(part, c + Vector((0, -0.02, 0.28)), (0.045, 0.08, 0.06), 'skin', hw, 8, 6)
    ellipsoid(part, c + Vector((0, 0.07, 0.235)), (0.18, 0.045, 0.06), 'skin', hw, 10, 6)
    if goalie:
        # mask: full shell with a chin, plus a bar cage over the face
        def keep(p):
            # cut the eye / cage window out of the front of the shell
            return not (p.z > 0.2 and -0.22 < p.y < 0.14 and abs(p.x) < 0.24)
        ellipsoid(part, c + Vector((0, 0.02, -0.02)), (0.37, 0.4, 0.42), 'mask', hw, 22, 16, keep=keep)
        for i in range(5):
            x = (i - 2) * 0.1
            rounded_box(part, c + Vector((x, -0.04, 0.42 - abs(x) * 0.5)), (0.02, 0.42, 0.022), 'cage', hw, radius=0.009, segs=1)
        for j in range(4):
            y = -0.22 + j * 0.12
            rounded_box(part, c + Vector((0, y, 0.41)), (0.5, 0.02, 0.022), 'cage', hw, radius=0.009, segs=1)
        # back plate strap bump
        ellipsoid(part, c + Vector((0, 0.0, -0.32)), (0.2, 0.22, 0.1), 'mask', hw, 12, 8)
        return part
    # helmet shell: open face, ear guards, back ridge
    def keep(p):
        front = p.z > 0.25
        if front and p.y < 0.28:
            return False
        if p.y < -0.62 and p.z > -0.5:  # open underneath
            return False
        return True
    ellipsoid(part, c + Vector((0, 0.06, -0.03)), (0.36, 0.36, 0.41), 'helmet', hw, 24, 16, keep=keep)
    for s in (1, -1):
        ellipsoid(part, c + Vector((s * 0.31, -0.08, 0.02)), (0.07, 0.16, 0.14), 'helmet', hw, 10, 8)
    rounded_box(part, c + Vector((0, 0.33, -0.08)), (0.06, 0.08, 0.5), 'helmet', hw, radius=0.03, segs=1)
    # visor: a curved band across the eyes
    vis = []
    for y in (0.0, 0.1, 0.19):
        pts = []
        for k in range(15):
            a = math.radians(-78 + k * (156 / 14))
            pts.append(c + Vector((math.sin(a) * 0.37, y, math.cos(a) * 0.4 + 0.02)))
        vis.append(pts)
    # open strip (not a closed ring) → quads by hand
    base = len(part.v)
    for row in vis:
        for p in row:
            part.vert(p, {'head': 1.0})
    for i in range(len(vis) - 1):
        for k in range(14):
            a = base + i * 15 + k
            part.face((a, a + 1, a + 16, a + 15), [WHITE_UV] * 4, 'visor')
    # chin strap
    for s in (1, -1):
        rounded_box(part, c + Vector((s * 0.2, -0.24, 0.05)), (0.02, 0.2, 0.05), 'visor', hw, radius=0.01, segs=1)
    return part


# ── stick ──────────────────────────────────────────────────────────────────

def stick(goalie):
    part = Part('stick')
    ws = rigid('stick')
    wb = rigid('stick_blade')
    if goalie:
        rounded_box(part, (0, 2.2 + 1.3, 0), (0.09, 2.6, 0.07), 'stick', ws, radius=0.02, segs=1)
        rounded_box(part, (0, 1.1, 0), (0.22, 2.2, 0.08), 'stick', ws, radius=0.025, segs=1)
        rounded_box(part, (0, 4.72, 0), (0.1, 0.25, 0.08), 'tapeW', ws, radius=0.02, segs=1)
        blade_len, blade_h = 1.5, 0.3
    else:
        L = RIG['stickLen']
        rounded_box(part, (0, L / 2 + 0.1, 0), (0.085, L - 0.2, 0.065), 'stick', ws, radius=0.02, segs=1)
        rounded_box(part, (0, L - 0.2, 0), (0.1, 0.38, 0.08), 'tapeW', ws, radius=0.025, segs=1)
        # hosel tapering into the heel
        rounded_box(part, (0.03, 0.14, 0), (0.1, 0.3, 0.06), 'stick', ws, radius=0.02, segs=1)
        blade_len, blade_h = 1.0, 0.24
    # blade: lofted along +X, slight curve toward the forehand (+Z), rounded toe
    rings = []
    n = 9
    for i in range(n):
        t = i / (n - 1)
        x = 0.02 + t * blade_len
        z = 0.08 * t * t
        h = blade_h * (1 - 0.18 * t) * (1 if t < 0.85 else lerp(1, 0.55, (t - 0.85) / 0.15))
        rings.append(ring((x, h / 2, z), (0, 1, 0), (0, 0, 1), h / 2, 0.028, 8, power=4))
    loft(part, rings, 'tape' if not goalie else 'stick', wb, cap_start=True, cap_end=True)
    return part


# ── goalie equipment ───────────────────────────────────────────────────────

def goalie_pads():
    part = Part('pads')
    pos = rest_positions(True)
    for L, s in (('L', 1), ('R', -1)):
        k = pos['shin_' + L]
        th, sh = 'thigh_' + L, 'shin_' + L

        def w(p, th=th, sh=sh, ky=k.y):
            b = 1 - smooth(ky - 0.2, ky + 0.2, p.y)
            return {th: 1 - b, sh: b}
        cx = k.x + s * 0.02
        # the pad face: tall bevelled slab with an outer roll
        rounded_box(part, (cx, k.y - 0.55, k.z + 0.2), (0.86, 2.2, 0.46), 'pad', w, radius=0.12, segs=3)
        # knee stack + thigh rise
        rounded_box(part, (cx, k.y + 0.55, k.z + 0.26), (0.84, 0.5, 0.4), 'pad', w, radius=0.14, segs=3)
        # outer roll along the pad edge
        rings = [ring((cx + s * 0.4, y, k.z + 0.28), (1, 0, 0), (0, 0, 1), 0.1, 0.12, 10) for y in (k.y - 1.6, k.y - 0.5, k.y + 0.7)]
        loft(part, rings, 'pad', w, cap_start=True, cap_end=True)
        # trim bands on the face
        for dy in (0.15, -0.55, -1.25):
            rounded_box(part, (cx, k.y + dy, k.z + 0.44), (0.8, 0.1, 0.04), 'padTrim', w, radius=0.015, segs=1)
    return part


# ── assembly ───────────────────────────────────────────────────────────────

def build_parts(goalie):
    parts = [sweater(goalie), breezers(goalie), legs(goalie), skates(goalie), gloves(goalie), head(goalie), stick(goalie)]
    if goalie:
        parts.append(goalie_pads())
    return parts
