"""
render_names.py - render a NAME BANK offline: every name the booth may say, in
each booth seat's voice and inflection, cut from carrier phrases (Dia2 cannot
say a lone word). Resumable and pausable. Run with the Dia2 venv:

  # the real-roster mod (real names are mod data: the bank lives in the mod folder)
  node scripts/booth/export-names.mjs --mod "K:/Hockey Game/mods/nhl-ehm" > .cache/booth/nhl-ehm-jobs.json
  python scripts/booth/render_names.py --jobs .cache/booth/nhl-ehm-jobs.json \
         --out "K:/Hockey Game/mods/nhl-ehm/commentary/dia2" --estimate
  python scripts/booth/render_names.py --jobs ... --out ... --max-minutes 25

  # the fictional name pools (repo data: the bank ships with the game)
  node scripts/booth/export-names.mjs --fictional > .cache/booth/fictional-jobs.json
  python scripts/booth/render_names.py --jobs .cache/booth/fictional-jobs.json \
         --out src/renderer/public/commentary/dia2/names

Pause:  create a file named PAUSE in --out; the run finishes its current
        batch, then waits until PAUSE is deleted. Stop any time with Ctrl+C;
        re-running resumes where it left off (index.json is written after
        every batch).
Limits: --max-minutes N stops cleanly after N minutes. --tiers 0,1 renders
        only those tiers. --variants pbp:excited,pbp:neutral picks the clips.

Output: <out>/index.json   {"version":1,"pair","voices","entries":{"<seat>|<style>|<text>": "<file>"}}
        <out>/*.ogg        one clip per entry
        <out>/state.json   attempts, failures, QA notes, measured throughput
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Dict, List, Tuple

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import audio_util as au  # noqa: E402

CONFIG = json.load(open(os.path.join(ROOT, "src/render2d/broadcast/booth.config.json"), encoding="utf-8"))
BREAK = ' <break time="0.5s"/> '
DEFAULT_VARIANTS = "pbp:excited,pbp:neutral,color:neutral"
MIN_SIM = 0.45  # phonetic similarity of Whisper's hearing vs the text


def job_key(seat: str, style: str, text: str) -> str:
    return f"{seat}|{style}|{text}"


def carrier(style: str, text: str) -> str:
    return CONFIG["nameCarriers"][style].replace("{name}", text)


def build_jobs(jobs_file: dict, variants: List[Tuple[str, str]], tiers) -> List[dict]:
    """Ordered jobs: tier, then variant (the most-used clip first), then frequency."""
    out = []
    for vi, (seat, style) in enumerate(variants):
        for e in jobs_file["entries"]:
            if tiers is not None and e["tier"] not in tiers:
                continue
            # Full names are only used by pbp lines and the colour intros; the
            # colour seat never says a full name excitedly.
            out.append(dict(key=job_key(seat, style, e["text"]), seat=seat, style=style, text=e["text"],
                            form=e["form"], tier=e["tier"], vi=vi, count=e["count"]))
    out.sort(key=lambda j: (j["tier"], j["vi"], -j["count"]))
    return out


def split_batch(wav: np.ndarray, ts: List[Tuple[str, float]], batch: List[dict]):
    """Cut each name out of 'It's A! <break/> It's B! ...' using the model's word
    starts. The name begins at its first word (Dia2 stamps a word slightly late,
    so the cut is the quietest frame just before it); it ends at the middle of
    the pause before the next carrier. Returns [(start, end, trusted)] or None
    when the word stream doesn't line up."""
    words = [(w, t) for (w, t) in ts if w.strip()]
    per = [len(carrier(j["style"], j["text"]).split()) for j in batch]
    lead = [n - len(j["text"].split()) for n, j in zip(per, batch)]
    if len(words) != sum(per):
        return None
    dur = len(wav) / au.SR
    res, i = [], 0
    for j, n, ld in zip(batch, per, lead):
        t_name = words[i + ld][1]
        s = au.quietest_point(wav, max(0.0, t_name - 0.05), 0.09)
        if i + n < len(words):
            e, quiet = au.silence_boundary(wav, t_name + 0.2, words[i + n][1] + 0.05)
        else:
            e, quiet = dur, 1.0
        res.append((s, e, quiet >= 0.06))
        i += n
    return res


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--pair", default=CONFIG["defaultPair"])
    ap.add_argument("--variants", default=DEFAULT_VARIANTS)
    ap.add_argument("--tiers", default="")
    ap.add_argument("--limit", type=int, default=0, help="render at most N clips this run")
    ap.add_argument("--batch", type=int, default=24)
    ap.add_argument("--max-minutes", type=float, default=0)
    ap.add_argument("--estimate", action="store_true", help="print the work left + time estimate and exit")
    args = ap.parse_args()

    pair = CONFIG["pairs"][args.pair]
    if pair["engine"] != "dia2":
        sys.exit("render_names.py renders the Dia2 bank; the Chatterbox pair ships stems only (see docs/COMMENTARY-BOOTH.md)")
    variants = [tuple(v.split(":")) for v in args.variants.split(",") if v]
    tiers = {int(t) for t in args.tiers.split(",") if t != ""} or None
    jobs_file = json.load(open(args.jobs, encoding="utf-8"))
    os.makedirs(args.out, exist_ok=True)
    idx_path = os.path.join(args.out, "index.json")
    st_path = os.path.join(args.out, "state.json")
    voices = {s: pair["speakers"][s]["voiceId"] for s in ("pbp", "color")}
    index = json.load(open(idx_path, encoding="utf-8")) if os.path.exists(idx_path) else None
    if not index or index.get("voices") != voices:
        index = dict(version=1, pair=args.pair, voices=voices, format="ogg", entries={})
    state = json.load(open(st_path, encoding="utf-8")) if os.path.exists(st_path) else dict(attempts={}, failed={}, check={}, perf=[])

    jobs = [j for j in build_jobs(jobs_file, variants, tiers)
            if j["key"] not in index["entries"] and j["key"] not in state["failed"]]
    sec_per_clip = (sum(p[0] for p in state["perf"]) / max(1, sum(p[1] for p in state["perf"]))) if state["perf"] else 1.45
    by_tier: Dict[int, int] = {}
    for j in jobs:
        by_tier[j["tier"]] = by_tier.get(j["tier"], 0) + 1
    print(f"[names:{args.pair}] {len(index['entries'])} done, {len(jobs)} to go "
          f"({', '.join(f'tier {t}: {n}' for t, n in sorted(by_tier.items()))}); "
          f"~{sec_per_clip:.2f} s/clip -> ~{len(jobs) * sec_per_clip / 3600:.1f} h of GPU time", flush=True)
    if args.estimate or not jobs:
        return
    if args.limit:
        jobs = jobs[: args.limit]

    from dia2_engine import Dia2Booth
    booth = Dia2Booth()
    t_start = time.time()
    done_this_run = 0
    retry: List[dict] = []
    queue = jobs[:]
    while queue or retry:
        if args.max_minutes and time.time() - t_start > args.max_minutes * 60:
            print(f"[names] --max-minutes reached; stopping cleanly", flush=True)
            break
        while os.path.exists(os.path.join(args.out, "PAUSE")):
            print("[names] paused (delete PAUSE to continue)", flush=True)
            time.sleep(15)
        if not queue:
            queue, retry = retry, []
        # One batch = one seat + style.
        head = queue[0]
        batch = [j for j in queue if j["seat"] == head["seat"] and j["style"] == head["style"]][: args.batch]
        ids = {id(j) for j in batch}
        queue = [j for j in queue if id(j) not in ids]
        text = BREAK.join(carrier(j["style"], j["text"]) for j in batch)
        seed = 1000 + sum(state["attempts"].get(j["key"], 0) for j in batch) * 7 + len(index["entries"])
        t0 = time.time()
        wav, ts = booth.generate(text, head["seat"], head["style"], seed)
        spans = split_batch(wav, ts, batch)
        from dia2_engine import whisper_words
        wwords = whisper_words(wav, au.SR)  # QA: did it say the name?
        ok = 0
        for k, j in enumerate(batch):
            state["attempts"][j["key"]] = state["attempts"].get(j["key"], 0) + 1
            reason = ""
            clip = None
            if spans is None:
                reason = "word-stream mismatch"
            else:
                s, e, trusted = spans[k]
                seg = au.cut(wav, s, e)
                heard_txt = au.words_in_span(wwords, s, e)
                sim = au.similarity(j["text"], heard_txt)
                d = len(au.trim_silence(seg)) / au.SR
                max_d = 3.2 if j["form"] == "full" else 2.2
                if not trusted:
                    reason = "no pause after the name"
                elif d < 0.18 or d > max_d:
                    reason = f"duration {d:.2f}s"
                elif sim < MIN_SIM:
                    reason = f"heard '{heard_txt}' ({sim:.2f})"
                else:
                    clip = au.finish(seg, j["style"])
                    if sim < 0.65:
                        state["check"][j["key"]] = heard_txt
            if clip is not None:
                fn = f"{au.slug(j['text'])}.{j['seat']}.{j['style']}.ogg"
                au.write_ogg(os.path.join(args.out, fn), clip)
                index["entries"][j["key"]] = fn
                ok += 1
                done_this_run += 1
            elif state["attempts"][j["key"]] >= 2:
                state["failed"][j["key"]] = reason
            else:
                retry.append(j)
        dt = time.time() - t0
        state["perf"] = (state["perf"] + [[round(dt, 2), len(batch)]])[-200:]
        au.atomic_json(idx_path, index)
        au.atomic_json(st_path, state)
        el = time.time() - t_start
        print(f"  {head['seat']}/{head['style']} x{len(batch)}: {ok} ok in {dt:.0f}s "
              f"({dt / len(batch):.2f} s/clip) | run {done_this_run} clips, {el / 60:.1f} min", flush=True)
        if args.limit and done_this_run >= args.limit:
            break

    print(f"[names] index has {len(index['entries'])} clips; failed {len(state['failed'])}; "
          f"to check by ear {len(state['check'])}", flush=True)


if __name__ == "__main__":
    main()
