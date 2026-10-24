# Art-direction look test: tile look-test.mjs frames into comparison sheets
# (one row per style: broadcast frame | close-up) and the goal frames into a
# side-by-side MP4.
#   python -I scripts/dev/render3d-harness/look-montage.py <rawDir> <outDir> [model] [--video]
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont

raw, out = sys.argv[1], sys.argv[2]
model = sys.argv[3] if len(sys.argv) > 3 and not sys.argv[3].startswith('--') else 'owner'
STYLES = [('current', 'CURRENT (semi-realistic)'), ('cleanBroadcast', 'CLEAN STYLISED BROADCAST'), ('cartoony', 'BOLD CARTOONY (reference)')]
MOMENTS = ['cycle', 'goal', 'hit', 'faceoff']
TW, TH = 960, 540
os.makedirs(out, exist_ok=True)
try:
    font = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 26)
    small = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 20)
except OSError:
    font = small = ImageFont.load_default()

def label(img, text, sub=None):
    d = ImageDraw.Draw(img)
    w = d.textlength(text, font=font)
    d.rectangle([0, 0, w + 24, 40], fill=(10, 12, 16))
    d.text((12, 6), text, font=font, fill=(255, 255, 255))
    if sub:
        d.text((12, TH - 30), sub, font=small, fill=(255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0))

for m in MOMENTS:
    sheet = Image.new('RGB', (TW * 2, TH * len(STYLES)), (0, 0, 0))
    ok = False
    for row, (s, name) in enumerate(STYLES):
        for col, suf in enumerate(['', '_close']):
            p = os.path.join(raw, f'{m}_{s}_{model}{suf}.png')
            if not os.path.exists(p):
                continue
            ok = True
            t = Image.open(p).convert('RGB').resize((TW, TH), Image.LANCZOS)
            label(t, name if col == 0 else f'{name} - close-up')
            sheet.paste(t, (col * TW, row * TH))
    if ok:
        sheet.save(os.path.join(out, f'compare_{m}_{model}.png'))
        print('wrote', f'compare_{m}_{model}.png')

if '--video' in sys.argv:
    import cv2
    import numpy as np
    dirs = [os.path.join(raw, 'frames', f'{s}_{model}') for s, _ in STYLES]
    n = min(len(glob.glob(os.path.join(d, '*.jpg'))) for d in dirs)
    VW, VH = 640, 360
    path = os.path.join(out, f'goal_side_by_side_{model}.mp4')
    vw = None
    for fourcc in ('avc1', 'mp4v'):
        vw = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*fourcc), 30, (VW * 3, VH))
        if vw.isOpened():
            print('codec', fourcc)
            break
    for i in range(n):
        row = Image.new('RGB', (VW * 3, VH))
        for k, (d, (s, name)) in enumerate(zip(dirs, STYLES)):
            t = Image.open(os.path.join(d, f'{i:04d}.jpg')).convert('RGB').resize((VW, VH), Image.LANCZOS)
            dr = ImageDraw.Draw(t)
            dr.rectangle([0, 0, dr.textlength(name, font=small) + 16, 30], fill=(10, 12, 16))
            dr.text((8, 4), name, font=small, fill=(255, 255, 255))
            row.paste(t, (k * VW, 0))
        vw.write(cv2.cvtColor(np.asarray(row), cv2.COLOR_RGB2BGR))
    vw.release()
    print('wrote', path, n, 'frames')
