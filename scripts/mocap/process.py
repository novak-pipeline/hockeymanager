"""
Mocap clean-up: MediaPipe pose tracks (extract.py .npz) -> one clean, renderer-space
joint track per clip (JSON, 30 fps, feet) that scripts/blender/mocap.py solves onto
the skater rig.

  python -I process.py <pose.npz> <out.json> --name mocap_skate_stride --start F --end F
         [--track x,y] [--loop] [--contact auto|none] [--mirror] [--sg 7]

Steps (docs/MOCAP-PIPELINE.md):
  1. track the main subject across frames (nearest hip centre to the last pick;
     `--track` seeds it in image pixels) and fill short gaps;
  2. MediaPipe world landmarks (metres, hip-centred, camera-oriented) -> camera
     space (x image-right, y up, z toward the camera), feet;
  3. temporal filter: Savitzky-Golay on every coordinate (window `--sg`);
  4. bone-length normalisation: every bone set to its median length, rebuilt
     outward from the hips (directions kept);
  5. ground plane: the plane through the lowest skate points over the whole
     segment (SVD) gives "up" (undoes the camera's tilt); everything is rotated
     so up = +Y and the ice is y = 0 (hip height from the lowest skate per frame:
     the support skate is locked to the ice, free to glide);
  6. camera pan: the skater's heading (pelvis line) is smoothed hard and taken
     out frame by frame, so a panning camera does not read as body twist; the
     residual (true hip/torso yaw) stays;
  7. resample to 30 fps; loops: the cycle end is cross-faded into its start.
Output joints are in the RENDERER frame: +X = the player's left, +Y up, +Z front.
"""
import argparse, json, math, os
import numpy as np
from scipy.signal import savgol_filter

FT = 3.28084
J = dict(nose=0, earL=7, earR=8, shL=11, shR=12, elL=13, elR=14, wrL=15, wrR=16,
         pinkyL=17, pinkyR=18, indexL=19, indexR=20, thumbL=21, thumbR=22,
         hipL=23, hipR=24, kneeL=25, kneeR=26, ankL=27, ankR=28, heelL=29, heelR=30, toeL=31, toeR=32)
# bones for length normalisation: (parent joint, child joint), built outward from the hip centre
BONES = [('hipL', 'kneeL'), ('kneeL', 'ankL'), ('ankL', 'heelL'), ('ankL', 'toeL'),
         ('hipR', 'kneeR'), ('kneeR', 'ankR'), ('ankR', 'heelR'), ('ankR', 'toeR'),
         ('shL', 'elL'), ('elL', 'wrL'), ('wrL', 'indexL'), ('wrL', 'pinkyL'), ('wrL', 'thumbL'),
         ('shR', 'elR'), ('elR', 'wrR'), ('wrR', 'indexR'), ('wrR', 'pinkyR'), ('wrR', 'thumbR')]


def pick_track(img, seed):
    """Per frame, the pose slot nearest the previous pick (image hip centre)."""
    T, P = img.shape[:2]
    hips = np.nanmean(img[:, :, [23, 24], :2], axis=2)  # T,P,2
    pick = np.full(T, -1)
    last = np.array(seed, float) if seed is not None else None
    for t in range(T):
        best, bd = -1, 1e18
        for p in range(P):
            h = hips[t, p]
            if np.isnan(h).any():
                continue
            d = 0.0 if last is None else float(np.sum((h - last) ** 2))
            if d < bd:
                best, bd = p, d
        # a jump of more than ~25% of the frame height is a different person: drop the frame
        if best >= 0 and last is not None and math.sqrt(bd) > 0.25 * np.nanmax(img[..., 1]):
            best = -1
        pick[t] = best
        if best >= 0:
            last = hips[t, best]
    return pick


def fill_gaps(x, valid, max_gap):
    """Linear-interpolate rows of x (T,...) where valid is False; long gaps stay NaN."""
    T = len(x)
    idx = np.arange(T)
    good = np.where(valid)[0]
    out = x.copy()
    if len(good) < 2:
        return out, valid
    for t in range(T):
        if valid[t]:
            continue
        a = good[good < t]
        b = good[good > t]
        if len(a) and len(b) and b[0] - a[-1] <= max_gap:
            k = (t - a[-1]) / (b[0] - a[-1])
            out[t] = x[a[-1]] * (1 - k) + x[b[0]] * k
    return out, ~np.isnan(out.reshape(T, -1)).any(1)


def rot_between(a, b):
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3) if c > 0 else -np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * ((1 - c) / (np.linalg.norm(v) ** 2))


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('npz')
    ap.add_argument('out')
    ap.add_argument('--name', required=True)
    ap.add_argument('--source', default='')
    ap.add_argument('--start', type=int, required=True)
    ap.add_argument('--end', type=int, required=True)
    ap.add_argument('--track', default='')
    ap.add_argument('--sg', type=int, default=7)
    ap.add_argument('--loop', action='store_true')
    ap.add_argument('--loop-search', type=int, default=0, help='search this many frames at each end for the best-matching cycle')
    ap.add_argument('--heading-window', type=float, default=0.0, help='seconds; 0 = one constant heading for the whole segment')
    ap.add_argument('--mirror', action='store_true', help='mirror left/right (a right-shot source onto our left-shot rig)')
    ap.add_argument('--up', default='camera', choices=['camera', 'ice'],
                    help="'camera': the camera is level (MediaPipe's own up); 'ice': fit the ice plane through the lowest skate points")
    ap.add_argument('--tilt', type=float, default=0.0, help='known camera pitch in degrees (+ = looking down)')
    ap.add_argument('--contact', default='none', help="'none', 'auto' (peak blade speed) or a source frame")
    a = ap.parse_args()

    d = np.load(a.npz)
    fps = float(d['fps'])
    f0 = int(d['start'])
    img, world = d['img'], d['world']
    s0, s1 = a.start - f0, a.end - f0
    img, world = img[s0:s1], world[s0:s1]
    seed = [float(v) for v in a.track.split(',')] if a.track else None
    pick = pick_track(img, seed)
    T = len(pick)
    W = np.full((T, 33, 3), np.nan)
    vis = np.zeros((T, 33))
    for t in range(T):
        if pick[t] >= 0:
            W[t] = world[t, pick[t]]
            vis[t] = img[t, pick[t], :, 3]
    valid = ~np.isnan(W[:, 0, 0])
    W, valid = fill_gaps(W, valid, max_gap=int(round(0.2 * fps)))
    if not valid.all():
        good = np.where(valid)[0]
        raise SystemExit(f'segment has unfilled gaps: {T - len(good)} of {T} frames missing (first ok {good[:3]}, last ok {good[-3:]})')

    # camera space, feet: x image-right, y up, z toward the camera
    C = np.stack([W[..., 0], -W[..., 1], -W[..., 2]], -1) * FT
    if a.mirror:
        C[..., 0] *= -1
        swap = list(range(33))
        for k, i in J.items():
            if k.endswith('L'):
                o = J[k[:-1] + 'R']
                swap[i], swap[o] = o, i
        C = C[:, swap]
        vis = vis[:, swap]

    # temporal filter
    win = a.sg if a.sg % 2 else a.sg + 1
    raw = C.copy()
    if win >= 5 and T > win:
        C = savgol_filter(C, win, 2, axis=0, mode='interp')
    jitter_raw = float(np.mean(np.linalg.norm(np.diff(raw, 2, axis=0), axis=-1)))
    jitter = float(np.mean(np.linalg.norm(np.diff(C, 2, axis=0), axis=-1)))

    # bone-length normalisation
    lens = {}
    for p, c in BONES:
        lens[(p, c)] = float(np.median(np.linalg.norm(C[:, J[c]] - C[:, J[p]], axis=-1)))
    N = C.copy()
    for p, c in BONES:
        v = C[:, J[c]] - C[:, J[p]]
        v /= np.linalg.norm(v, axis=-1, keepdims=True) + 1e-9
        N[:, J[c]] = N[:, J[p]] + v * lens[(p, c)]
    C = N

    # ground plane from the lowest skate points (heel / toe / ankle) per frame
    feet = [J[k] for k in ('heelL', 'toeL', 'heelR', 'toeR')]
    up = np.array([0.0, 1.0, 0.0])
    if a.tilt:
        # a known camera pitch (deg, + = camera looking down): rotate about the image x axis
        r = math.radians(a.tilt)
        up = np.array([0.0, math.cos(r), math.sin(r)])
    for _ in range(3 if a.up == 'ice' else 0):
        h = C[:, feet] @ up
        low = C[np.arange(T), np.array(feet)[np.argmin(h, 1)]]
        # a plane through the lowest points: its normal is "up"
        m = low.mean(0)
        _, _, vt = np.linalg.svd(low - m)
        n = vt[2] if vt[2] @ up > 0 else -vt[2]
        # the spread may be degenerate (feet barely move): only trust a well-conditioned fit
        if abs(n @ up) < 0.85:
            break
        up = n
    R_up = rot_between(up, np.array([0.0, 1.0, 0.0]))
    C = C @ R_up.T
    tilt = math.degrees(math.acos(min(1, abs(float(up[1])))))

    # heading: player's left = pelvis line; front = left x up
    left = C[:, J['hipL']] - C[:, J['hipR']] + 0.5 * (C[:, J['shL']] - C[:, J['shR']])
    front = np.cross(left, np.array([0, 1.0, 0]))
    fyaw = np.unwrap(np.arctan2(front[:, 0], front[:, 2]))  # 0 = +Z
    if a.heading_window > 0 and T > 5:
        k = max(3, int(a.heading_window * fps) | 1)
        k = min(k, T if T % 2 else T - 1)
        sm = savgol_filter(fyaw, k, 1, mode='nearest')
    else:
        sm = np.full(T, float(np.median(fyaw)))
    for t in range(T):
        C[t] = C[t] @ rot_y(-sm[t]).T
    pan = float(np.degrees(np.ptp(sm)))

    # depth plausibility: monocular depth often flips a knee BEHIND the hip-ankle
    # line (a knee bending the wrong way). Reflect it to the front side of that
    # line; hip, ankle and both segment lengths are unchanged.
    flips = 0
    fr = np.cross(C[:, J['hipL']] - C[:, J['hipR']], np.array([0, 1.0, 0]))
    fr /= np.linalg.norm(fr, axis=-1, keepdims=True)
    for side in ('L', 'R'):
        H, K, A = J['hip' + side], J['knee' + side], J['ank' + side]
        for t in range(T):
            ha = C[t, A] - C[t, H]
            ha /= np.linalg.norm(ha)
            kp = (C[t, K] - C[t, H]) - ha * np.dot(C[t, K] - C[t, H], ha)
            n = fr[t] - ha * np.dot(fr[t], ha)
            if np.linalg.norm(n) < 1e-6:
                continue
            n /= np.linalg.norm(n)
            if np.dot(kp, n) < -0.05:
                C[t, K] -= 2 * np.dot(kp, n) * n
                flips += 1

    # hips to the origin horizontally, ice at y = 0 (lowest skate point)
    hipc = 0.5 * (C[:, J['hipL']] + C[:, J['hipR']])
    C[..., 0] -= hipc[:, None, 0]
    C[..., 2] -= hipc[:, None, 2]
    lowest = C[:, feet, 1].min(1)
    C[..., 1] -= lowest[:, None]

    # resample to 30 fps
    t_src = np.arange(T) / fps
    n_out = int(round(t_src[-1] * 30)) + 1
    t_out = np.arange(n_out) / 30
    R = np.empty((n_out, 33, 3))
    for j in range(33):
        for c in range(3):
            R[:, j, c] = np.interp(t_out, t_src, C[:, j, c])

    loop_info = None
    if a.loop:
        # best cycle: the start/end pair (within the search) whose leg pose matches best
        legs = [J[k] for k in ('kneeL', 'ankL', 'toeL', 'kneeR', 'ankR', 'toeR', 'wrL', 'wrR')]
        S = a.loop_search
        best = (1e9, 0, n_out - 1)
        if S > 0:
            for i in range(0, min(S, n_out // 3)):
                for k in range(max(i + 10, n_out - 1 - S), n_out):
                    e = float(np.mean(np.linalg.norm(R[i, legs] - R[k, legs], axis=-1)))
                    if e < best[0]:
                        best = (e, i, k)
            R = R[best[1]:best[2] + 1]
        n_out = len(R)
        err = float(np.mean(np.linalg.norm(R[0, legs] - R[-1, legs], axis=-1)))
        # cross-fade the last third toward a copy that ends exactly on the first frame
        L = max(3, n_out // 3)
        delta = R[0] - R[-1]
        for i in range(L):
            w = (i + 1) / L
            w = w * w * (3 - 2 * w)
            R[n_out - L + i] += delta * w
        loop_info = {'seamErrFt': round(err, 3), 'cycleFrames': n_out - 1, 'cut': [best[1], best[2]]}

    # contact: the frame of peak hand speed (a shot's release) in the 30 fps track
    contact = None
    if a.contact == 'auto':
        hand = 0.5 * (R[:, J['wrL']] + R[:, J['wrR']])
        sp = np.linalg.norm(np.diff(hand, axis=0), axis=-1)
        contact = int(np.argmax(sp)) + 1
    elif a.contact not in ('none', ''):
        contact = int(round((int(a.contact) - a.start) / fps * 30))

    out = {
        'name': a.name,
        'source': a.source,
        'srcFrames': [a.start, a.end],
        'srcFps': round(fps, 3),
        'fps': 30,
        'loop': bool(a.loop),
        'contact': contact,
        'joints': {k: np.round(R[:, i], 4).tolist() for k, i in J.items()},
        'quality': {
            'frames': len(R),
            'meanVisibility': round(float(np.mean(vis[:, [J[k] for k in ('hipL', 'kneeL', 'ankL', 'hipR', 'kneeR', 'ankR', 'wrL', 'wrR')]])), 3),
            'jitterRawFt': round(jitter_raw, 4),
            'jitterFilteredFt': round(jitter, 4),
            'cameraTiltDeg': round(tilt, 1),
            'headingPanDeg': round(pan, 1),
            'kneeFlipFrames': flips,
            'boneLensFt': {f'{p}-{c}': round(v, 3) for (p, c), v in lens.items() if not c.startswith(('index', 'pinky', 'thumb'))},
            **({'loop': loop_info} if loop_info else {}),
        },
    }
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, separators=(',', ':'))
    print(json.dumps(out['quality'], indent=1), 'contact', contact)


if __name__ == '__main__':
    main()
