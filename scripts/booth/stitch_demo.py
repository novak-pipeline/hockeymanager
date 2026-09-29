"""
stitch_demo.py - write stitched calls exactly as the game plays them
([stem][name] or [name][stem] with the scheduler's STITCH_GAP_MS breath), so a
human can judge the seams without launching the game.

  python scripts/booth/stitch_demo.py --pair dia2 --bank <names dir> --out <dir> \
      goal.2:Kaprizov save.robbery.2:Vasilevskiy goal.1:McDavid

Each argument is <lineId>:<surname as the bank spells it>. The name clip is the
pbp seat in the line's nameStyle. Writes <out>/<lineId>.<surname>.wav (48 kHz is
not needed: 24 kHz mono, 16-bit) plus the bare version for comparison.
"""
import argparse
import json
import os
import subprocess
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
from render_stems import load_lines  # noqa: E402

GAP_MS = 30  # src/render2d/broadcast/audioScheduler.ts STITCH_GAP_MS
SR = 24000


def read(path):
    a, sr = sf.read(path, dtype="float32")
    assert sr == SR, (path, sr)
    return a


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pair", default="dia2")
    ap.add_argument("--bank", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("calls", nargs="+")
    args = ap.parse_args()
    stems_dir = os.path.join(ROOT, "src", "renderer", "public", "commentary", args.pair)
    man = json.load(open(os.path.join(stems_dir, "manifest.json"), encoding="utf-8"))
    idx = json.load(open(os.path.join(args.bank, "index.json"), encoding="utf-8"))
    lines = {l["id"]: l for l in load_lines()}
    os.makedirs(args.out, exist_ok=True)
    gap = np.zeros(int(SR * GAP_MS / 1000), dtype=np.float32)
    for call in args.calls:
        lid, name = call.split(":", 1)
        l = lines[lid]
        seat, style = l["speaker"], l.get("nameStyle") or "neutral"
        key = f"{seat}|{style}|{name}"
        stem = read(os.path.join(stems_dir, man["clips"][f"stem.{lid}"]["file"]))
        if key not in idx["entries"]:
            print(f"! {key} not in bank")
            continue
        nm = read(os.path.join(args.bank, idx["entries"][key]))
        parts = [nm, gap, stem] if l["slot"] == "lead" else [stem, gap, nm]
        out = np.concatenate(parts)
        base = os.path.join(args.out, f"{lid}.{name}")
        sf.write(base + ".wav", out, SR, subtype="PCM_16")
        bare = man["clips"].get(f"bare.{lid}")
        if bare:
            sf.write(base + ".bare.wav", read(os.path.join(stems_dir, bare["file"])), SR, subtype="PCM_16")
        print(f"{base}.wav  ({len(out) / SR:.2f}s)  '{l['text'].replace('{name}', name)}'")


if __name__ == "__main__":
    main()
