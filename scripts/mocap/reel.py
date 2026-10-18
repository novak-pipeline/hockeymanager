"""
Assemble the mocap A/B reel from capture.mjs frames:
  <out>/compare-<clip>-az<A>.jpg   contact sheet: one row per config, frames across
  <out>/compare.mp4                side-by-side video (configs as columns), every clip + angle in turn

  python -I reel.py <framesDir> <outDir> --configs owner,owner_mocap,blender,blender_mocap
"""
import argparse, glob, os
import cv2
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('frames')
ap.add_argument('out')
ap.add_argument('--configs', default='owner,owner_mocap,blender,blender_mocap')
ap.add_argument('--clips', default='skate_stride,stickhandle,shot_wrist')
ap.add_argument('--az', default='90,20')
ap.add_argument('--fps', type=float, default=10)
a = ap.parse_args()
os.makedirs(a.out, exist_ok=True)
cfgs = a.configs.split(',')
LABEL = {
    'owner': 'owner body - current clip',
    'owner_mocap': 'owner body - VIDEO MOCAP',
    'blender': 'our rig - current clip',
    'blender_mocap': 'our rig - VIDEO MOCAP',
}


def label(img, text, sub=''):
    img = img.copy()
    cv2.rectangle(img, (0, 0), (img.shape[1], 44), (20, 20, 20), -1)
    cv2.putText(img, text, (8, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
    if sub:
        cv2.putText(img, sub, (8, 37), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (150, 210, 255), 1, cv2.LINE_AA)
    return img


video = None
for clip in a.clips.split(','):
    for az in a.az.split(','):
        seqs = {}
        for c in cfgs:
            fs = sorted(glob.glob(os.path.join(a.frames, f'{c}-{clip}-az{az}-*.png')))
            if fs:
                seqs[c] = [cv2.imread(f) for f in fs]
        if not seqs:
            continue
        n = min(len(s) for s in seqs.values())
        # contact sheet: half-size frames, every other one
        rows = []
        for c, s in seqs.items():
            small = [cv2.resize(f, (f.shape[1] // 2, f.shape[0] // 2)) for f in s[:n:2]]
            tag = np.full((small[0].shape[0], 190, 3), 25, np.uint8)
            cv2.putText(tag, LABEL.get(c, c)[:24], (6, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1, cv2.LINE_AA)
            cv2.putText(tag, LABEL.get(c, c)[24:], (6, 140), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (255, 255, 255), 1, cv2.LINE_AA)
            cv2.putText(tag, f'{clip}  az {az}', (6, 165), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (150, 210, 255), 1, cv2.LINE_AA)
            rows.append(np.hstack([tag] + small))
        cv2.imwrite(os.path.join(a.out, f'compare-{clip}-az{az}.jpg'), np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 85])
        # video: configs side by side, the clip played twice
        for rep in range(2):
            for k in range(n):
                panel = np.hstack([label(seqs[c][k], LABEL.get(c, c), f'{clip}  (az {az})') for c in seqs])
                if video is None:
                    size = (panel.shape[1], panel.shape[0])
                    video = cv2.VideoWriter(os.path.join(a.out, 'compare.mp4'), cv2.VideoWriter_fourcc(*'mp4v'), a.fps, size)
                if (panel.shape[1], panel.shape[0]) != size:
                    panel = cv2.resize(panel, size)
                video.write(panel)
if video is not None:
    video.release()
print('reel written to', a.out)
