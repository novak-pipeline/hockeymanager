"""Assemble preview frames <dir>/<clip>-<view>-NN.png into one labelled sheet (a row per clip+view).

  python -I strip.py <dir> <out.jpg> clipA clipB ...
"""
import glob, os, sys
import cv2
import numpy as np

d, out, names = sys.argv[1], sys.argv[2], sys.argv[3:]
rows = []
for n in names:
    for view in ('front', 'side'):
        fs = sorted(glob.glob(os.path.join(d, f'{n}-{view}-*.png')))
        if not fs:
            continue
        ims = [cv2.imread(f) for f in fs[:10]]
        h = 210
        ims = [cv2.resize(i, (int(i.shape[1] * h / i.shape[0]), h)) for i in ims]
        while len(ims) < 10:
            ims.append(np.full_like(ims[0], 40))
        row = np.hstack(ims)
        label = np.full((h, 170, 3), 30, np.uint8)
        cv2.putText(label, n, (6, 90), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
        cv2.putText(label, view, (6, 115), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (180, 220, 255), 1)
        rows.append(np.hstack([label, row]))
w = max(r.shape[1] for r in rows)
rows = [cv2.copyMakeBorder(r, 0, 2, 0, w - r.shape[1], cv2.BORDER_CONSTANT, value=(0, 0, 0)) for r in rows]
cv2.imwrite(out, np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 88])
