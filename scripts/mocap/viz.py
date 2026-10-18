"""Stick-figure strip of a processed track (front + side views) for eyeballing clean-up.

  python -I viz.py <track.json> <out.png> [--every 3]
"""
import argparse, json
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

SEG = [('hipL', 'hipR'), ('shL', 'shR'), ('hipL', 'shL'), ('hipR', 'shR'), ('shL', 'elL'), ('elL', 'wrL'), ('shR', 'elR'), ('elR', 'wrR'),
       ('hipL', 'kneeL'), ('kneeL', 'ankL'), ('ankL', 'heelL'), ('heelL', 'toeL'), ('ankL', 'toeL'),
       ('hipR', 'kneeR'), ('kneeR', 'ankR'), ('ankR', 'heelR'), ('heelR', 'toeR'), ('ankR', 'toeR'), ('earL', 'earR'), ('nose', 'earL'), ('nose', 'earR')]

ap = argparse.ArgumentParser()
ap.add_argument('track')
ap.add_argument('out')
ap.add_argument('--every', type=int, default=3)
a = ap.parse_args()
d = json.load(open(a.track))
J = {k: np.array(v) for k, v in d['joints'].items()}
T = len(J['nose'])
idx = list(range(0, T, a.every))
fig, axes = plt.subplots(2, len(idx), figsize=(1.3 * len(idx), 5.2))
for c, t in enumerate(idx):
    for r, (h, lab) in enumerate(((0, 'front (X=left)'), (2, 'side (Z=front)'))):
        ax = axes[r, c]
        for p, q in SEG:
            col = 'tab:blue' if p.endswith('L') or q.endswith('L') else 'tab:red'
            if p[:-1] == q[:-1] or p in ('nose',):
                col = 'k'
            ax.plot([J[p][t, h], J[q][t, h]], [J[p][t, 1], J[q][t, 1]], color=col, lw=1.2)
        if 'stick' in d and d['stick']:
            s = np.array(d['stick'][t])
            ax.plot([s[0][h], s[1][h]], [s[0][1], s[1][1]], color='tab:green', lw=1.5)
        ax.axhline(0, color='gray', lw=0.5)
        ax.set_xlim(-3, 3)
        ax.set_ylim(-0.3, 6.2)
        ax.set_aspect('equal')
        ax.set_xticks([])
        ax.set_yticks([])
        if c == 0:
            ax.set_ylabel(lab, fontsize=7)
        if r == 0:
            ax.set_title(f'f{t}' + (' C' if d.get('contact') == t else ''), fontsize=7)
fig.suptitle(f"{d['name']}  ({d['source']} src frames {d['srcFrames']})", fontsize=9)
plt.tight_layout()
plt.savefig(a.out, dpi=90)
