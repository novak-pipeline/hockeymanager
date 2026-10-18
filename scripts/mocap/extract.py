"""
Video -> per-frame MediaPipe pose (image + world landmarks) for every detected
person, with an optional crop box and frame range. Writes an .npz per run.

  python -I extract.py <video> <out.npz> [--start F] [--end F] [--crop x0,y0,x1,y1] [--scale S] [--poses N] [--debug dir]
"""
import argparse, os
import numpy as np
import cv2
import mediapipe as mp
from mediapipe.tasks.python import vision, BaseOptions

ap = argparse.ArgumentParser()
ap.add_argument('video')
ap.add_argument('out')
ap.add_argument('--model', default='K:/mocap-lab/models/pose_landmarker_heavy.task')
ap.add_argument('--start', type=int, default=0)
ap.add_argument('--end', type=int, default=-1)
ap.add_argument('--crop', default='')
ap.add_argument('--scale', type=float, default=1.0)
ap.add_argument('--poses', type=int, default=3)
ap.add_argument('--debug', default='')
a = ap.parse_args()

opts = vision.PoseLandmarkerOptions(
    base_options=BaseOptions(model_asset_path=a.model),
    running_mode=vision.RunningMode.VIDEO,
    num_poses=a.poses,
    min_pose_detection_confidence=0.4,
    min_pose_presence_confidence=0.4,
    min_tracking_confidence=0.5,
)
lm = vision.PoseLandmarker.create_from_options(opts)
cap = cv2.VideoCapture(a.video)
fps = cap.get(cv2.CAP_PROP_FPS)
n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
end = n if a.end < 0 else min(n, a.end)
W, H = int(cap.get(3)), int(cap.get(4))
crop = [int(v) for v in a.crop.split(',')] if a.crop else [0, 0, W, H]
cap.set(cv2.CAP_PROP_POS_FRAMES, a.start)
P = a.poses
img_lm = np.full((end - a.start, P, 33, 5), np.nan, np.float32)   # x,y (crop px->full px), z, vis, presence
world = np.full((end - a.start, P, 33, 3), np.nan, np.float32)
if a.debug:
    os.makedirs(a.debug, exist_ok=True)
for i, f in enumerate(range(a.start, end)):
    ok, frame = cap.read()
    if not ok:
        break
    x0, y0, x1, y1 = crop
    sub = frame[y0:y1, x0:x1]
    if a.scale != 1.0:
        sub = cv2.resize(sub, None, fx=a.scale, fy=a.scale, interpolation=cv2.INTER_AREA)
    sh, sw = sub.shape[:2]
    rgb = cv2.cvtColor(sub, cv2.COLOR_BGR2RGB)
    res = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(f * 1000 / fps))
    for k, (pl, wl) in enumerate(zip(res.pose_landmarks, res.pose_world_landmarks)):
        for j in range(33):
            p, w = pl[j], wl[j]
            img_lm[i, k, j] = (x0 + p.x * (x1 - x0), y0 + p.y * (y1 - y0), p.z * (x1 - x0), p.visibility, p.presence)
            world[i, k, j] = (w.x, w.y, w.z)
    if a.debug and i % 10 == 0:
        dbg = sub.copy()
        for k, pl in enumerate(res.pose_landmarks):
            for p in pl:
                cv2.circle(dbg, (int(p.x * sw), int(p.y * sh)), 4, ((0, 255, 0), (0, 0, 255), (255, 0, 0))[k % 3], -1)
        s = 480 / max(sw, sh)
        cv2.imwrite(os.path.join(a.debug, f'f{f:04d}.jpg'), cv2.resize(dbg, None, fx=s, fy=s))
    if i % 50 == 0:
        print(f, len(res.pose_landmarks), flush=True)
np.savez_compressed(a.out, img=img_lm, world=world, fps=fps, start=a.start, size=(W, H), crop=crop)
print('saved', a.out, img_lm.shape)
