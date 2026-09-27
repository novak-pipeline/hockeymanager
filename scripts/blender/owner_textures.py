"""
Bake the owner-supplied athlete textures into what the renderer needs
(system Python 3 + Pillow + numpy; run by scripts/blender/import_owner.mjs):

  python scripts/blender/owner_textures.py [--src assets/3d/incoming] [--out src/render3d/assets/owner]

Per role (skater / goalie) it writes, all git-ignored (the Fab licence forbids
redistribution — never commit these):
  <role>_clothes_d.jpg   1024² sweater/breezer/sock diffuse (kept only where the
                         class map says "keep": brand patches, background)
  <role>_clothes_k.png   1024² KIT MAP: R = class×40 (0 keep, 1 jersey, 2 trim,
                         3 trim2, 4 pants, 5 socks), G = shade×200 — the renderer
                         recolours every team from it (textures.ts ownerClothes)
  <role>_clothes_n.jpg   1024² normal map (OpenGL convention)
  <role>_gear_d.jpg      2048² atlas: the gear textures in 2×2 quadrants, in the
                         order owner_assets.json lists them (the importer packed
                         the UVs to match)
  <role>_gear_n.jpg      1024² normal atlas, same layout
  owner_layout.json      number / name / crest boxes on the sweater (image
                         fractions) + per-role reports

Region + stripe classes come from the layered T_Clothes.psd (Masks/* for the
regions, Diffuse/* layers for stripes, numbers, name and logos); the stripe
COLOURS are read from each role's own diffuse under those layer masks, so the
goalie (same UV layout, different colours) uses the skater's PSD.
"""

import json
import os
import sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
argv = sys.argv[1:]


def arg(name, default):
    return argv[argv.index(name) + 1] if name in argv else default


SRC = os.path.abspath(arg('--src', os.path.join(ROOT, 'assets', '3d', 'incoming')))
OUT = os.path.abspath(arg('--out', os.path.join(ROOT, 'src', 'render3d', 'assets', 'owner')))
CFG = json.load(open(os.path.join(HERE, 'owner_assets.json'), encoding='utf-8'))
N = CFG['texture']['clothes']
GEAR = CFG['texture']['gear']
NRM = CFG['texture']['normal']
os.makedirs(OUT, exist_ok=True)


# ── PSD: layer tree ────────────────────────────────────────────────────────

def psd_layers(path):
    """[(index, 'Group/Sub/Layer', bbox)] — groups rebuilt from the section dividers."""
    im = Image.open(path)
    stack = [[]]
    for i, (name, _mode, bbox, _tile) in enumerate(im.layers):
        empty = bbox[2] - bbox[0] <= 0
        if name == '</Layer group>':
            stack.append([])
            continue
        if empty and len(stack) > 1:
            kids = stack.pop()
            stack[-1].extend((k[0], name + '/' + k[1], k[2]) for k in kids)
            continue
        stack[-1].append((i, name, bbox))
    return im, sorted(stack[0])


_ALPHA = {}


def layer_alpha(im, idx, bbox, size):
    """Full-canvas alpha of one layer, resampled to size×size (float 0..1).
    Pillow's PSD reader only loads layers reliably in order, so the first call
    walks every layer once and caches them all."""
    key = (im.filename, size)
    if key not in _ALPHA:
        cache = {}
        seq = Image.open(im.filename)
        for i, (_n, _m, bb, _t) in enumerate(seq.layers):
            if bb[2] - bb[0] <= 0:
                continue
            seq.seek(i + 1)
            L = seq.copy().convert('RGBA')
            full = Image.new('L', (4096, 4096), 0)
            full.paste(L.getchannel('A'), (bb[0], bb[1]))
            a = np.asarray(full.resize((size, size), Image.BOX), dtype=np.float32) / 255.0
            # mask layers are painted grey-scale (white = inside) on an opaque layer
            lumL = Image.new('L', (4096, 4096), 0)
            lumL.paste(L.convert('L'), (bb[0], bb[1]))
            m = np.asarray(lumL.resize((size, size), Image.BOX), dtype=np.float32) / 255.0
            cache[i] = a
            cache[('lum', i)] = a * m
        _ALPHA[key] = cache
    return _ALPHA[key][idx]


def layer_mask(im, idx, bbox, size):
    """Grey-scale mask layer (white inside) × its alpha."""
    layer_alpha(im, idx, bbox, size)
    return _ALPHA[(im.filename, size)][('lum', idx)]


def rgb2hsv(c):
    c = np.asarray(c, dtype=np.float32) / 255.0
    mx, mn = c.max(), c.min()
    return mx, (mx - mn) / mx if mx > 1e-6 else 0.0


def lum(a):
    return a[..., 0] * 0.2126 + a[..., 1] * 0.7152 + a[..., 2] * 0.0722


# ── clothes ────────────────────────────────────────────────────────────────

def bake_clothes(role, rcfg, layout):
    base = os.path.join(SRC, rcfg['dir'])
    c = rcfg['clothes']
    D = np.asarray(Image.open(os.path.join(base, c['diffuse'])).convert('RGB').resize((N, N), Image.LANCZOS), dtype=np.float32)
    psd_path = os.path.normpath(os.path.join(base, c['psd']))
    im, layers = psd_layers(psd_path)
    by = {p: (i, b) for i, p, b in layers}

    def A(path):
        i, b = by[path]
        return layer_mask(im, i, b, N)

    cls = np.zeros((N, N), dtype=np.uint8)
    # regions: the importer's clothes UV triangles, rasterised (the PSD's Masks/*
    # layers are shaped by layer masks Pillow can't read)
    from PIL import ImageDraw
    uvj = os.path.join(ROOT, 'build', 'owner-assets', f'{role}_clothes_uv.json')
    polys = json.load(open(uvj, encoding='utf-8'))
    region = {}
    for reg in ('jersey', 'pants', 'socks'):
        img = Image.new('L', (N, N), 0)
        d = ImageDraw.Draw(img)
        for pl in polys:
            if pl['r'] == reg:
                d.polygon([(u * N, (1 - v) * N) for u, v in pl['uv']], fill=255, outline=255)
        region[reg] = np.asarray(img) > 127
    cls[region['socks']] = 5
    cls[region['pants']] = 4
    cls[region['jersey']] = 1
    base_cls = {'jersey': 1, 'pants': 4, 'socks': 5}
    rep = {'palette': {}}
    # Stripe / cuff / yoke colours: the PSD's stripe layers are shaped by layer
    # masks Pillow can't read, so cluster THIS role's diffuse inside each region
    # instead (k-means). Largest cluster = the region's base; a saturated one =
    # trim (the team accent); the rest = trim2.
    rng = np.random.default_rng(7)
    for reg, bc in base_cls.items():
        m = region[reg]
        if m.sum() < 100:
            continue
        px = D[m]
        sample = px[rng.choice(len(px), size=min(20000, len(px)), replace=False)]
        k = 4
        cent = sample[rng.choice(len(sample), size=k, replace=False)].copy()
        for _ in range(25):
            lab = np.argmin(((sample[:, None, :] - cent[None]) ** 2).sum(-1), axis=1)
            for j in range(k):
                if (lab == j).any():
                    cent[j] = sample[lab == j].mean(0)
        lab_all = np.argmin(((px[:, None, :] - cent[None]) ** 2).sum(-1), axis=1)
        counts = np.bincount(lab_all, minlength=k)
        order = np.argsort(-counts)
        base_j = order[0]
        mapping = {}
        for j in range(k):
            if j == base_j or np.abs(cent[j] - cent[base_j]).sum() < 45:
                mapping[j] = bc
            else:
                _v, sat = rgb2hsv(cent[j])
                mapping[j] = 2 if sat > 0.35 else 3
        out = np.array([mapping[j] for j in lab_all], dtype=np.uint8)
        cls[m] = out
        rep['palette'][reg] = [{'rgb': [int(x) for x in cent[j]], 'share': round(float(counts[j] / counts.sum()), 3), 'class': int(mapping[j])} for j in order]
    # decals: numbers / name / crests → sweater base (the renderer paints its own)
    boxes = {}
    for i, p, b in layers:
        if not p.startswith('Diffuse/Decals/'):
            continue
        a = np.zeros((N, N), dtype=bool)
        x0, y0 = max(0, b[0] * N // 4096 - 2), max(0, b[1] * N // 4096 - 2)
        x1, y1 = min(N, b[2] * N // 4096 + 3), min(N, b[3] * N // 4096 + 3)
        a[y0:y1, x0:x1] = True
        box = [b[0] / 4096, b[1] / 4096, b[2] / 4096, b[3] / 4096]
        key = None
        if '/Numbers/Back/' in p:
            key = 'numberBack'
        elif '/Numbers/Left/' in p:
            key = 'numberLeft'
        elif '/Numbers/Right/' in p:
            key = 'numberRight'
        elif '/Player_Name/' in p:
            key = 'name'
        elif '/Jersey/Front/' in p:
            key = 'crestFront'
        elif '/Jersey/Left/' in p:
            key = 'crestLeft'
        elif '/Jersey/Right/' in p:
            key = 'crestRight'
        if key is None:
            continue  # brand tags / breezer logo: keep the owner's art
        if key in ('crestLeft', 'crestRight'):
            # shoulder patches sit on the yoke: fill with the box border's class
            border = np.concatenate([cls[y0, x0:x1], cls[y1 - 1, x0:x1], cls[y0:y1, x0], cls[y0:y1, x1 - 1]])
            cls[a] = int(np.bincount(border).argmax())
        else:
            cls[a & region['jersey']] = 1
            cls[a & ~region['jersey']] = 0
        old = boxes.get(key)
        boxes[key] = box if old is None else [min(old[0], box[0]), min(old[1], box[1]), max(old[2], box[2]), max(old[3], box[3])]
    # brand tags + breezer logo: keep the owner's pixels (their bbox, non-base colours)
    for i, p, b in layers:
        if p.startswith('Diffuse/Decals/Logo/Brands/Pants/') or p.endswith('Jersey/Brand'):
            x0, y0, x1, y1 = b[0] * N // 4096, b[1] * N // 4096, b[2] * N // 4096 + 1, b[3] * N // 4096 + 1
            sub = cls[y0:y1, x0:x1]
            sub[(sub == 2) | (sub == 3)] = 0
    # shade relative to each class's reference colour
    L = lum(D) / 255.0
    shade = np.ones((N, N), dtype=np.float32)
    rep['classRef'] = {}
    for k in (1, 2, 3, 4, 5):
        m = cls == k
        if m.sum() == 0:
            continue
        ref = float(np.median(L[m]))
        shade[m] = np.clip(1.0 + (L[m] - ref) * 1.6, 0.55, 1.25)
        rep['classRef'][int(k)] = round(ref, 3)
    for key in ('numberBack', 'numberLeft', 'numberRight', 'name', 'crestFront', 'crestLeft', 'crestRight'):
        if key in boxes:
            x0, y0, x1, y1 = (int(v * N) for v in boxes[key])
            sub = cls[y0:y1, x0:x1]
            shade[y0:y1, x0:x1][sub == 1] = 1.0
    K = np.zeros((N, N, 3), dtype=np.uint8)
    K[..., 0] = cls * 40
    K[..., 1] = np.clip(shade * 200, 0, 255).astype(np.uint8)
    Image.fromarray(K, 'RGB').save(os.path.join(OUT, f'{role}_clothes_k.png'), optimize=True)
    Image.fromarray(D.astype(np.uint8), 'RGB').save(os.path.join(OUT, f'{role}_clothes_d.jpg'), quality=90)
    save_normal(os.path.join(base, c['normal']), os.path.join(OUT, f'{role}_clothes_n.jpg'), NRM)
    rep['classPixels'] = {int(k): int((cls == k).sum()) for k in range(6)}
    layout[role] = {'boxes': boxes, 'rotation': {'numberBack': 180, 'name': 180, 'numberLeft': -90, 'numberRight': 90}, 'report': rep}


def save_normal(src, dst, size):
    """UE (DirectX) normals → OpenGL: flip green, unless a Unity_NORMALS copy exists."""
    unity = os.path.join(os.path.dirname(src), 'Unity_NORMALS', os.path.basename(src))
    flip = True
    if os.path.exists(unity):
        src, flip = unity, False
    a = np.asarray(Image.open(src).convert('RGB').resize((size, size), Image.LANCZOS)).copy()
    if flip:
        a[..., 1] = 255 - a[..., 1]
    Image.fromarray(a, 'RGB').save(dst, quality=92)
    return flip


# ── gear atlas ─────────────────────────────────────────────────────────────

def bake_gear(role, rcfg):
    base = os.path.join(SRC, rcfg['dir'])
    for kind, size, fill in (('diffuse', GEAR, (0, 0, 0)), ('normal', NRM, (128, 128, 255))):
        atlas = Image.new('RGB', (size, size), fill)
        q = size // 2
        for i, rel in enumerate(rcfg['gear'][kind]):
            p = os.path.join(base, rel)
            if kind == 'normal':
                tmp = os.path.join(OUT, '_tmp_n.jpg')
                save_normal(p, tmp, q)
                img = Image.open(tmp).convert('RGB')
                img.load()
                os.remove(tmp)
            else:
                img = Image.open(p).convert('RGB').resize((q, q), Image.LANCZOS)
            atlas.paste(img, ((i % 2) * q, (i // 2) * q))
        atlas.save(os.path.join(OUT, f'{role}_gear_{"d" if kind == "diffuse" else "n"}.jpg'), quality=90)


def main():
    layout = {}
    for role in ('skater', 'goalie'):
        rcfg = CFG[role]
        if not os.path.isdir(os.path.join(SRC, rcfg['dir'])):
            print('skip', role, '(no source folder)')
            continue
        bake_clothes(role, rcfg, layout)
        bake_gear(role, rcfg)
        print('TEXTURES OK', role)
    with open(os.path.join(OUT, 'owner_layout.json'), 'w', encoding='utf-8') as fh:
        json.dump(layout, fh, indent=1)


if __name__ == '__main__':
    main()
