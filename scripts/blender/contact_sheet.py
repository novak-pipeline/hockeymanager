"""Dev helper (system Python + Pillow, not Blender): tile build/blender/pose-*.png into one sheet."""
import glob, os, sys
from PIL import Image, ImageDraw
here = os.path.dirname(os.path.abspath(__file__))
out_dir = os.path.join(here, '..', '..', 'build', 'blender')
pat = sys.argv[1] if len(sys.argv) > 1 else 'pose-skater-*.png'
files = sorted(glob.glob(os.path.join(out_dir, pat)))
cols = 6
tw = 260
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw, rows * tw), (40, 40, 40))
d = ImageDraw.Draw(sheet)
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB').resize((tw, tw))
    x, y = (i % cols) * tw, (i // cols) * tw
    sheet.paste(im, (x, y))
    d.text((x + 4, y + 4), os.path.basename(f)[5:-4], fill=(255, 255, 0))
dst = os.path.join(out_dir, 'sheet-' + pat.replace('*', 'all').replace('.png', '') + '.png')
sheet.save(dst)
print(dst)
