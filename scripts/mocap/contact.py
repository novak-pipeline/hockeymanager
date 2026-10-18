"""Contact sheet of N evenly spaced frames per video (for picking clean segments)."""
import sys, os, glob
import cv2
import numpy as np

raw, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
N = 12
for path in sorted(glob.glob(os.path.join(raw, '*.mp4'))):
    cap = cv2.VideoCapture(path)
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    fps = cap.get(cv2.CAP_PROP_FPS)
    w, h = int(cap.get(3)), int(cap.get(4))
    tiles = []
    for i in range(N):
        f = int(i * (n - 1) / (N - 1))
        cap.set(cv2.CAP_PROP_POS_FRAMES, f)
        ok, img = cap.read()
        if not ok:
            continue
        s = 320 / max(w, h)
        img = cv2.resize(img, (int(w * s), int(h * s)))
        cv2.putText(img, f'f{f} {f / fps:.1f}s', (5, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
        tiles.append(img)
    cols = 4
    rows = [np.hstack(tiles[r * cols:(r + 1) * cols]) for r in range(len(tiles) // cols)]
    sheet = np.vstack(rows)
    name = os.path.basename(path).split('_')[0]
    cv2.imwrite(os.path.join(out, f'sheet_{name}.jpg'), sheet)
    print(name, n, fps, w, h, f'{n / fps:.1f}s')
