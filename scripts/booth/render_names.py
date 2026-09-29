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
from typing import Dict, List, Optional, Tuple

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)
import audio_util as au  # noqa: E402

CONFIG = json.load(open(os.path.join(ROOT, "src/render2d/broadcast/booth.config.json"), encoding="utf-8"))
BREAK = ' <break time="0.6s"/> '
DEFAULT_VARIANTS = "pbp:excited,pbp:neutral,color:neutral"
MIN_SIM = 0.45
# Words of the carrier phrases: hearing one inside a name clip means the cut
# kept a scrap of "It's" / "That's".
CARRIER_WORDS = {"great", "shot", "nice", "work", "wait"}  # phonetic similarity of Whisper's hearing vs the text


def job_key(seat: str, style: str, text: str) -> str:
    return f"{seat}|{style}|{text}"


def carrier(style: str, text: str) -> str:
    """The carrier phrase a name is cut from ("Great shot, McDavid!")."""
    return CONFIG["nameCarriers"][style].replace("{name}", text)


NAME_BREAK = '<break time="0.3s"/>'


def carrier_render(style: str, text: str) -> str:
    """The carrier as sent to the engine: a forced pause in front of the name,
    so the name is the last sound of its unit, set apart by silence on both
    sides. (Name-first carriers were tried: Whisper then often transcribed
    nothing past the first line, so the batch could not be aligned.)"""
    return CONFIG["nameCarriers"][style].replace("{name}", f"{NAME_BREAK} {text}")


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


def _match(word: str, target: str) -> bool:
    """A carrier word as Whisper spells it. Strict: the loose name similarity
    matched "Barkoff" and "Ovechkin" to "work,"."""
    return au._norm_word(word) == au._norm_word(target) or au.similarity(target, word) >= 0.9


class StitchCheck:
    """Second opinion on a name clip, the way the player hears it: stitched
    after a plain line of the same seat ("And it is in!" + name). Whatever
    Whisper hears after that line's words is the name; a scrap of the carrier
    shows up there as an extra word."""
    LEAD = {"pbp": "bare.goal.4", "color": "stem.hit.big.1"}

    def __init__(self, pair: str):
        import soundfile as sf
        d = os.path.join(ROOT, "src", "renderer", "public", "commentary", pair)
        man = json.load(open(os.path.join(d, "manifest.json"), encoding="utf-8"))["clips"]
        self.lead = {}
        for seat, cid in self.LEAD.items():
            e = man.get(cid)
            if e:
                self.lead[seat] = (sf.read(os.path.join(d, e["file"]), dtype="float32")[0], e["text"])
        # A longer gap than the game's 30 ms: Whisper tends to swallow a
        # name glued to the end of a sentence.
        self.gap = np.zeros(int(au.SR * 0.15), dtype=np.float32)

    def heard(self, clip: np.ndarray, seat: str) -> Optional[str]:
        if seat not in self.lead:
            return None
        from dia2_engine import whisper_words
        a, text = self.lead[seat]
        words = [w for (w, _s, _e) in whisper_words(np.concatenate([a, self.gap, clip]), au.SR)]
        lead = [au._norm_word(w) for w in text.split()]
        i = 0
        # Drop the lead line's words (Whisper may merge or drop one of them).
        for lw in lead:
            if i < len(words) and (au._norm_word(words[i]) == lw or au.similarity(lw, words[i]) >= 0.8):
                i += 1
        return " ".join(words[i:])


def _align_anchors(ww, batch: List[dict], lead_words: List[str]) -> List[Optional[int]]:
    """When Whisper dropped or doubled a carrier word, line the transcript up
    with the script (difflib over sound skeletons) and take each unit's anchor
    from the alignment. A unit whose anchor wasn't heard gets None and fails on
    its own instead of sinking the whole batch."""
    import difflib
    exp, owner = [], []  # expected tokens, and (unit, is_anchor) per token
    for k, j in enumerate(batch):
        for i, w in enumerate(lead_words):
            exp.append(au.phonetic_key(w))
            owner.append((k, i == len(lead_words) - 1))
        for w in j["text"].split():
            exp.append(au.phonetic_key(w))
            owner.append((k, False))
    heard = [au.phonetic_key(w) for (w, _s, _e) in ww]
    anchors: List[Optional[int]] = [None] * len(batch)
    sm = difflib.SequenceMatcher(None, exp, heard, autojunk=False)
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag not in ("equal", "replace") or (i2 - i1) != (j2 - j1):
            continue
        for d in range(i2 - i1):
            k, is_anchor = owner[i1 + d]
            if is_anchor and _match(ww[j1 + d][0], lead_words[-1]):
                anchors[k] = j1 + d
    return anchors


def split_batch(wav: np.ndarray, ww: List[Tuple[str, float, float]], batch: List[dict]):
    """Cut each name out of 'Great shot, <pause> A! <break/> Great shot, <pause> B! ...'.

    Aligned with Whisper, not Dia2's word stamps (those drift against the audio
    around <break/>s). Whisper's word ORDER is reliable and its word EDGES are
    loose, so it only says roughly where each unit is: the carrier's last word
    ("shot,"/"work,") is the anchor, and the name is what it hears between one
    anchor and the next carrier. The cut then comes from the audio itself: the
    unit's LAST stretch of sound (keep_last_segment), because the render puts
    a forced pause in front of every name.
    Returns per job (start, end, heard), or None for a job it can't place."""
    dur = len(wav) / au.SR
    lead_words = [w for w in CONFIG["nameCarriers"][batch[0]["style"]].split("{name}")[0].split() if au._norm_word(w)]
    key, before = lead_words[-1], lead_words[:-1]
    anchors = [i for i, (w, _s, _e) in enumerate(ww) if _match(w, key)]
    if len(anchors) != len(batch):
        anchors = _align_anchors(ww, batch, lead_words)
    out = []
    for k, a in enumerate(anchors):
        if a is None:
            out.append(None)
            continue
        first = a + 1
        nxt_a = next((x for x in anchors[k + 1:] if x is not None), None)
        last = (nxt_a if nxt_a is not None else len(ww)) - 1
        # The next carrier's opening words ("Great") belong to the next unit.
        while nxt_a is not None and last >= first and any(_match(ww[last][0], b) for b in before):
            last -= 1
        if last < first:
            out.append(None)
            continue
        name_words = ww[first:last + 1]
        heard = " ".join(w for (w, _s, _e) in name_words)
        # A generous span: from inside the anchor word to the pause before the
        # next carrier. keep_last_segment() then drops the carrier.
        s0 = ww[a][1] + 0.05
        if last + 1 < len(ww):
            e0, _ = au.silence_boundary(wav, name_words[0][1] + 0.25, max(name_words[0][1] + 0.3, ww[last + 1][1] + 0.02))
        else:
            e0 = dur
        out.append((s0, max(e0, s0 + 0.1), heard))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--jobs", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--pair", default=CONFIG["defaultPair"])
    ap.add_argument("--variants", default=DEFAULT_VARIANTS)
    ap.add_argument("--tiers", default="")
    ap.add_argument("--limit", type=int, default=0, help="render at most N clips this run")
    # Long batches of unusual words make Dia2 drift into gibberish (a 16-name
    # excited batch fell apart completely); 10 keeps it on script.
    ap.add_argument("--batch", type=int, default=10)
    ap.add_argument("--max-minutes", type=float, default=0)
    ap.add_argument("--estimate", action="store_true", help="print the work left + time estimate and exit")
    ap.add_argument("--retry-failed", action="store_true", help="give the names marked failed another go")
    args = ap.parse_args()

    pair = CONFIG["pairs"][args.pair]
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

    if args.retry_failed:
        for k in state["failed"]:
            state["attempts"][k] = 0
        state["failed"] = {}
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

    if pair["engine"] == "dia2":
        from dia2_engine import Dia2Booth
        booth = Dia2Booth()
        generate = booth.generate
    else:
        # Chatterbox (its own venv, as a child process). Splitting is by
        # Whisper anyway, so the same carrier batches work for it.
        from render_stems import ChatterboxRenderer
        generate = ChatterboxRenderer().render
    check = StitchCheck(args.pair)
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
        text = BREAK.join(carrier_render(j["style"], j["text"]) for j in batch)
        seed = 1000 + sum(state["attempts"].get(j["key"], 0) for j in batch) * 7 + len(index["entries"])
        t0 = time.time()
        wav, ts = generate(text, head["seat"], head["style"], seed)
        from dia2_engine import whisper_words
        ww = whisper_words(wav, au.SR)
        spans = split_batch(wav, ww, batch)
        ok = 0
        for k, j in enumerate(batch):
            state["attempts"][j["key"]] = state["attempts"].get(j["key"], 0) + 1
            reason = ""
            clip = None
            if spans[k] is None:
                reason = "could not align the batch"
            else:
                s, e, heard_txt = spans[k]
                seg = au.keep_last_segment(au.clean_edges(au.trim_silence(au.cut(wav, s, e))))
                d = len(seg) / au.SR
                max_d = 3.2 if j["form"] == "full" else 2.2
                sim = au.similarity(j["text"], heard_txt)
                if d < 0.25 or d > max_d:
                    reason = f"duration {d:.2f}s"
                elif any(au._norm_word(w) in CARRIER_WORDS for w in heard_txt.split()):
                    reason = f"carrier bleed: heard '{heard_txt}'"

                elif sim < MIN_SIM:
                    reason = f"heard '{heard_txt}' ({sim:.2f})"
                else:
                    cand = au.finish(seg, j["style"])
                    stitched = check.heard(cand, j["seat"])
                    bleed = [w for w in (stitched or "").split()
                             if au._norm_word(w) in CARRIER_WORDS and au.similarity(j["text"], w) < 0.6]
                    if bleed:
                        reason = f"carrier bleed (stitched): heard '{stitched}'"
                    else:
                        clip = cand
                        if sim < 0.65 or (stitched is not None and au.similarity(j["text"], stitched) < MIN_SIM):
                            # Report-only: listen to these. Whisper often drops
                            # a name glued to the end of a sentence.
                            state["check"][j["key"]] = f"batch: {heard_txt} | stitched: {stitched}"
            if clip is not None:
                fn = f"{au.slug(j['text'])}.{j['seat']}.{j['style']}.ogg"
                au.write_ogg(os.path.join(args.out, fn), clip)
                index["entries"][j["key"]] = fn
                ok += 1
                done_this_run += 1
            elif state["attempts"][j["key"]] >= 3:
                state["failed"][j["key"]] = reason
            else:
                state.setdefault("retried", {})[j["key"]] = reason
            if clip is None and state["attempts"][j["key"]] < 3:
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
