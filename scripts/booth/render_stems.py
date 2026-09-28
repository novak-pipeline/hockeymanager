"""
render_stems.py - render the booth's line library (stems + bare fallbacks)
OFFLINE into Ogg/Opus clips the game plays. Run with the Dia2 venv:

    K:/tts-lab/dia2/.venv/Scripts/python.exe scripts/booth/render_stems.py --pair dia2
    K:/tts-lab/dia2/.venv/Scripts/python.exe scripts/booth/render_stems.py --pair chatterbox

Options: --takes N (default 2; best take per clip wins on Whisper WER)
         --only goal.1,save.big.2   --force   --no-qa

Writes src/renderer/public/commentary/<pair>/clips/*.ogg + manifest.json, and a
QA report to .cache/booth/<pair>-stems-qa.json.

How a line becomes clips:
  * no name slot  -> stem.<id> is the whole line.
  * name slot     -> stem.<id> is the line rendered with a placeholder surname
                     ("Big save, Jackson!") and cut AT the placeholder, so the
                     stem carries the real lead-in to a name; bare.<id> is the
                     authored bare line, rendered whole.
Dia2 renders several lines per call (separated by <break/> pauses) and gives
each word's start time, so the cuts are exact; Chatterbox renders one line per
call and the cut points come from Whisper word timings.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import subprocess
import sys
import time
from typing import Dict, List, Optional, Tuple

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import audio_util as au  # noqa: E402

NODE = os.environ.get("NODE", "C:/Program Files/nodejs/node.exe")
CONFIG = json.load(open(os.path.join(ROOT, "src/render2d/broadcast/booth.config.json"), encoding="utf-8"))
BREAK = ' <break time="0.9s"/> '
MAX_BATCH_WORDS = 55


def load_lines() -> list:
    out = subprocess.run([NODE, os.path.join(HERE, "export-lines.mjs")], capture_output=True, text=True,
                         encoding="utf-8", check=True)
    return json.loads(out.stdout)


def units_for(lines: list, placeholder: str) -> List[dict]:
    """Every clip to render: {clip, seat, style, text, cut}."""
    units = []
    for l in lines:
        style = l["stemStyle"]
        if l["slot"]:
            txt = l["text"].replace("{name}", placeholder)
            units.append(dict(clip=f"stem.{l['id']}", seat=l["speaker"], style=style, text=txt,
                              cut=l["slot"], stem=l["stem"]))
            units.append(dict(clip=f"bare.{l['id']}", seat=l["speaker"], style=style, text=l["bare"], cut=None,
                              stem=l["bare"]))
        else:
            units.append(dict(clip=f"stem.{l['id']}", seat=l["speaker"], style=style, text=l["text"], cut=None,
                              stem=l["text"]))
    return units


def batches(units: List[dict], rng: random.Random) -> List[List[dict]]:
    """Group by (seat, style); shuffle so each take hears different neighbours."""
    groups: Dict[Tuple[str, str], List[dict]] = {}
    for u in units:
        groups.setdefault((u["seat"], u["style"]), []).append(u)
    out = []
    for g in groups.values():
        g = g[:]
        rng.shuffle(g)
        cur, n = [], 0
        for u in g:
            w = len(u["text"].split())
            if cur and n + w > MAX_BATCH_WORDS:
                out.append(cur)
                cur, n = [], 0
            cur.append(u)
            n += w
        if cur:
            out.append(cur)
    return out


# ── cutting ──────────────────────────────────────────────────────────────────
def unit_spans(wav: np.ndarray, ts: List[Tuple[str, float]], batch: List[dict]):
    """Split a batch render into per-unit (start, end, words, trusted) using the
    model's word starts. Neighbouring units share ONE split point: the middle of
    the longest pause between the last word of one and the first of the next,
    so no unit keeps a scrap of its neighbour. `trusted` is False when there was
    no real pause to split in. None when the word count doesn't line up."""
    words = [(w, t) for (w, t) in ts if w.strip()]
    counts = [len(u["text"].split()) for u in batch]
    if len(words) != sum(counts):
        return None
    dur = len(wav) / au.SR
    firsts, lasts, i = [], [], 0
    for c in counts:
        firsts.append(i)
        lasts.append(i + c - 1)
        i += c
    cuts = [(0.0, 1.0)]
    for k in range(1, len(batch)):
        t_last = words[lasts[k - 1]][1]
        t_next = words[firsts[k]][1]
        cuts.append(au.silence_boundary(wav, t_last + 0.2, t_next + 0.05))
    cuts.append((dur, 1.0))
    spans = []
    for k in range(len(batch)):
        s, e = cuts[k][0], cuts[k + 1][0]
        ok = cuts[k][1] >= 0.08 and cuts[k + 1][1] >= 0.08
        ws = words[firsts[k]:lasts[k] + 1]
        spans.append((s, e, [(w, t - s) for (w, t) in ws], ok))
    return spans


def cut_placeholder(seg: np.ndarray, words: List[Tuple[str, float]], cut: str, placeholder: str) -> Optional[np.ndarray]:
    """Remove the placeholder name from a rendered named line."""
    idx = next((i for i, (w, _) in enumerate(words) if placeholder.lower() in w.lower().strip(",.!?")), None)
    if idx is None:
        idx = max(range(len(words)), key=lambda i: au.similarity(placeholder, words[i][0]), default=None)
        if idx is None or au.similarity(placeholder, words[idx][0]) < 0.6:
            return None
    if cut == "tail":
        t = words[idx][1]
        # Dia2 stamps a word slightly after its onset; search back a little.
        c = au.quietest_point(seg, max(0.0, t - 0.06), 0.1)
        return seg[: int(c * au.SR)]
    # lead: keep everything after the placeholder
    if idx + 1 >= len(words):
        return None
    t = words[idx + 1][1]
    c = au.quietest_point(seg, max(0.0, t - 0.06), 0.1)
    return seg[int(c * au.SR):]


# ── engines ──────────────────────────────────────────────────────────────────
class Dia2Renderer:
    batched = True

    def __init__(self):
        from dia2_engine import Dia2Booth
        self.b = Dia2Booth()

    def render(self, text: str, seat: str, style: str, seed: int):
        return self.b.generate(text, seat, style, seed)


class ChatterboxRenderer:
    """Chatterbox lives in its own venv: talk to a child process over JSON lines."""
    batched = False

    def __init__(self):
        lab = os.environ.get("TTS_LAB", "K:/tts-lab")
        py = os.path.join(lab, "chatterbox", ".venv", "Scripts", "python.exe")
        self.proc = subprocess.Popen([py, os.path.join(HERE, "chatterbox_worker.py")], stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, text=True, encoding="utf-8", cwd=HERE)
        ready = self.proc.stdout.readline()
        if "ready" not in ready:
            raise RuntimeError("chatterbox worker failed: " + ready)
        self.tmp = os.path.join(ROOT, ".cache", "booth", "cb-tmp")
        os.makedirs(self.tmp, exist_ok=True)
        self.n = 0

    def render(self, text: str, seat: str, style: str, seed: int):
        import soundfile as sf
        self.n += 1
        out = os.path.join(self.tmp, f"{self.n}.wav")
        self.proc.stdin.write(json.dumps(dict(text=text, seat=seat, style=style, seed=seed, out=out)) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line.startswith("ok"):
            raise RuntimeError("chatterbox render failed: " + line)
        a, sr = sf.read(out, dtype="float32")
        if sr != au.SR:
            import torch, torchaudio
            a = torchaudio.functional.resample(torch.from_numpy(a), sr, au.SR).numpy()
        # No native word timings: Whisper provides them (start times).
        words = au_whisper(a)
        return a, [(w, s) for (w, s, e) in words]


def au_whisper(a: np.ndarray):
    from dia2_engine import whisper_words
    return whisper_words(a, au.SR)


# ── main ─────────────────────────────────────────────────────────────────────
def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pair", default=CONFIG["defaultPair"], choices=sorted(CONFIG["pairs"].keys()))
    ap.add_argument("--takes", type=int, default=2)
    ap.add_argument("--only", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--no-qa", action="store_true")
    args = ap.parse_args()

    from dia2_engine import setup_env
    setup_env()
    pair = CONFIG["pairs"][args.pair]
    out_dir = os.path.join(ROOT, "src", "renderer", "public", "commentary", args.pair)
    man_path = os.path.join(out_dir, "manifest.json")
    qa_path = os.path.join(ROOT, ".cache", "booth", f"{args.pair}-stems-qa.json")
    os.makedirs(os.path.dirname(qa_path), exist_ok=True)
    manifest = json.load(open(man_path, encoding="utf-8")) if os.path.exists(man_path) else None
    voices = {s: pair["speakers"][s]["voiceId"] for s in ("pbp", "color")}
    if not manifest or manifest.get("voices") != voices:
        manifest = dict(version=1, engine=pair["engine"], voices=voices, sampleRate=au.SR, format="ogg", clips={})
    qa = json.load(open(qa_path, encoding="utf-8")) if os.path.exists(qa_path) else {}

    lines = load_lines()
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    units = [u for u in units_for(lines, CONFIG["stemPlaceholder"])
             if (not only or u["clip"].split(".", 1)[1] in only)
             and (args.force or u["clip"] not in manifest["clips"])]
    print(f"[stems:{args.pair}] {len(units)} clips to render, {args.takes} take(s) each", flush=True)
    if not units:
        return

    eng = Dia2Renderer() if pair["engine"] == "dia2" else ChatterboxRenderer()
    takes: Dict[str, List[dict]] = {u["clip"]: [] for u in units}
    t0 = time.time()
    gen_audio = 0.0
    for take in range(args.takes):
        rng = random.Random(1000 + take)
        groups = batches(units, rng) if eng.batched else [[u] for u in units]
        for bi, batch in enumerate(groups):
            seat, style = batch[0]["seat"], batch[0]["style"]
            text = BREAK.join(u["text"] for u in batch)
            seed = 7919 * (take + 1) + bi
            wav, ts = eng.render(text, seat, style, seed)
            gen_audio += len(wav) / au.SR
            spans = unit_spans(wav, ts, batch)
            if spans is None and len(batch) > 1:
                # Word stream didn't line up: fall back to one line per call.
                spans = []
                for u in batch:
                    w1, t1 = eng.render(u["text"], seat, style, seed)
                    gen_audio += len(w1) / au.SR
                    sp = unit_spans(w1, t1, [u])
                    if sp:
                        takes[u["clip"]].append(dict(seg=w1, words=sp[0][2], take=take))
                continue
            if spans is None:
                print(f"  ! {batch[0]['clip']}: word stream mismatch, skipped this take", flush=True)
                continue
            for u, (s, e, words, ok) in zip(batch, spans):
                if not ok:
                    # No clean pause to split at: render this line on its own.
                    w1, t1 = eng.render(u["text"], seat, style, seed + 101)
                    gen_audio += len(w1) / au.SR
                    sp = unit_spans(w1, t1, [u])
                    if sp:
                        takes[u["clip"]].append(dict(seg=w1, words=sp[0][2], take=take))
                    continue
                takes[u["clip"]].append(dict(seg=au.cut(wav, s, e), words=words, take=take))
            print(f"  take {take + 1} batch {bi + 1}/{len(groups)} ({seat}/{style}, {len(batch)} lines) "
                  f"{time.time() - t0:.0f}s elapsed", flush=True)

    # Pick the best take per clip, cut the placeholder, finish + encode.
    for u in units:
        cands = []
        for c in takes[u["clip"]]:
            seg = c["seg"]
            clip = seg if not u["cut"] else cut_placeholder(seg, c["words"], u["cut"], CONFIG["stemPlaceholder"])
            if clip is None or len(clip) < au.SR * 0.3:
                continue
            clip = au.trim_silence(clip)
            heard, score = "", 0.0
            if not args.no_qa:
                # QA the clip that will SHIP, against the words it must say (a
                # scrap of a neighbour or a leftover placeholder scores badly).
                heard = " ".join(w for (w, s, e) in au_whisper(clip))
                score = au.wer(u["stem"], heard)
            cands.append((score, -float(np.sqrt(np.mean(clip ** 2))), c["take"], clip, heard))
        if not cands:
            print(f"  ! {u['clip']}: no usable take", flush=True)
            qa[u["clip"]] = dict(text=u["text"], status="failed")
            continue
        cands.sort(key=lambda x: (round(x[0], 2), x[1]))
        score, _, take, clip, heard = cands[0]
        final = au.finish(clip, u["style"])
        rel = f"clips/{u['clip']}.ogg"
        ms = au.write_ogg(os.path.join(out_dir, rel), final)
        manifest["clips"][u["clip"]] = dict(file=rel, durationMs=ms, speaker=u["seat"], text=u["stem"])
        qa[u["clip"]] = dict(text=u["stem"], heard=heard, wer=round(score, 3), take=take, style=u["style"],
                             status="ok" if score <= 0.25 else "check")
        au.atomic_json(man_path, manifest)
        au.atomic_json(qa_path, qa)
        flag = "" if score <= 0.25 else "   <-- CHECK"
        print(f"  {u['clip']}: wer {score:.2f} take {take + 1} {ms} ms{flag}", flush=True)

    el = time.time() - t0
    print(f"[stems:{args.pair}] done: {len(units)} clips, {gen_audio:.0f}s audio generated in {el:.0f}s "
          f"(RTF {el / max(gen_audio, 1e-6):.2f})", flush=True)


if __name__ == "__main__":
    main()
