"""Audio helpers shared by the booth render scripts (numpy + soundfile only)."""
from __future__ import annotations

import difflib
import json
import os
import re
import unicodedata
from typing import List, Optional, Sequence, Tuple

import numpy as np

SR = 24000
FRAME = 240  # 10 ms at 24 kHz

# Every clip is levelled to the same speech loudness so a name dropped next to
# a stem never jumps out. Measured on voiced frames only (pauses don't count).
TARGET_RMS_DB = -19.0
PEAK_CEILING = 0.89  # ~ -1 dBFS
STYLE_GAIN_DB = {"excited": 1.5, "neutral": 0.0, "rising": 0.0}


def frame_rms(a: np.ndarray) -> np.ndarray:
    n = len(a) // FRAME
    if n == 0:
        return np.zeros(0, dtype=np.float32)
    f = a[: n * FRAME].reshape(n, FRAME)
    return np.sqrt(np.mean(f * f, axis=1) + 1e-12)


def db(x: float) -> float:
    return 20.0 * np.log10(max(x, 1e-9))


def trim_silence(a: np.ndarray, rel_db: float = -38.0, pad_ms: int = 30) -> np.ndarray:
    """Trim leading/trailing silence relative to the clip's loudest frame."""
    r = frame_rms(a)
    if r.size == 0:
        return a
    thr = r.max() * (10 ** (rel_db / 20.0))
    on = np.where(r > thr)[0]
    if on.size == 0:
        return a[:0]
    pad = int(pad_ms / 10)
    s = max(0, (on[0] - pad) * FRAME)
    e = min(len(a), (on[-1] + 1 + pad) * FRAME)
    return a[s:e]


def quietest_point(a: np.ndarray, t_sec: float, window_sec: float = 0.12) -> float:
    """The quietest 10 ms frame within +-window of t (a clean place to cut)."""
    r = frame_rms(a)
    if r.size == 0:
        return t_sec
    c = int(t_sec * SR / FRAME)
    w = max(1, int(window_sec * SR / FRAME))
    lo, hi = max(0, c - w), min(len(r), c + w + 1)
    if lo >= hi:
        return t_sec
    i = lo + int(np.argmin(r[lo:hi]))
    return (i * FRAME + FRAME / 2) / SR


def fade(a: np.ndarray, in_ms: int = 8, out_ms: int = 25) -> np.ndarray:
    a = a.copy()
    ni, no = int(SR * in_ms / 1000), int(SR * out_ms / 1000)
    if len(a) > ni + no:
        a[:ni] *= np.linspace(0.0, 1.0, ni, dtype=np.float32)
        a[-no:] *= np.linspace(1.0, 0.0, no, dtype=np.float32)
    return a


def level(a: np.ndarray, style: str = "neutral") -> np.ndarray:
    """Normalise voiced-frame RMS to the booth target (+ style gain), peak-limited."""
    r = frame_rms(a)
    if r.size == 0 or r.max() <= 0:
        return a
    voiced = r[r > r.max() * 0.1]
    cur = float(np.sqrt(np.mean(voiced ** 2))) if voiced.size else float(r.max())
    target = TARGET_RMS_DB + STYLE_GAIN_DB.get(style, 0.0)
    g = 10 ** ((target - db(cur)) / 20.0)
    out = a * g
    peak = float(np.max(np.abs(out))) if out.size else 0.0
    if peak > PEAK_CEILING:
        out = out * (PEAK_CEILING / peak)
    return out.astype(np.float32)


def cut(a: np.ndarray, start: float, end: float) -> np.ndarray:
    s = max(0, int(start * SR))
    e = min(len(a), int(end * SR))
    return a[s:e]


def finish(a: np.ndarray, style: str) -> np.ndarray:
    """trim -> level -> fades: the last step before encoding."""
    return fade(level(trim_silence(a), style))


def write_ogg(path: str, a: np.ndarray) -> float:
    """Ogg/Opus, 24 kHz mono (Chromium's decodeAudioData reads it natively).
    Returns the duration in ms."""
    import soundfile as sf

    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp.ogg"
    # libsndfile maps compression_level to the Opus bitrate: 0.9 ~ 32 kbps for
    # 24 kHz speech (0.6 ~ 108 kbps, 1.0 ~ 7 kbps). Transparent for a voice
    # under crowd noise, ~4 KB per second of audio.
    sf.write(tmp, np.clip(a, -1, 1), SR, format="OGG", subtype="OPUS", compression_level=0.9)
    os.replace(tmp, path)
    return round(len(a) / SR * 1000)


def atomic_json(path: str, obj) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False, sort_keys=True)
    os.replace(tmp, path)


def slug(text: str) -> str:
    """File-safe key for a spoken name ("neh-chahs" -> "neh-chahs", "Mäkelä" -> "makela_x...")."""
    base = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode().lower()
    base = re.sub(r"[^a-z0-9]+", "-", base).strip("-")[:48] or "name"
    # A short hash keeps distinct spellings that fold to the same ASCII apart.
    h = 2166136261
    for ch in text:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return f"{base}_{h:08x}"


# ── QA: does the audio say roughly what we asked? ────────────────────────────
def _norm_word(w: str) -> str:
    w = unicodedata.normalize("NFKD", w).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9' ]+", "", w).strip()


def phonetic_key(w: str) -> str:
    """A crude sound skeleton: close enough to compare a name with Whisper's
    guess at it ("Kotkaniemi" ~ "cotkaniemi"), which spells unknown names
    however it likes."""
    s = _norm_word(w).replace(" ", "").replace("-", "").replace("'", "")
    for a, b in (("ph", "f"), ("ck", "k"), ("q", "k"), ("c", "k"), ("x", "ks"), ("z", "s"), ("w", "v"),
                 ("y", "i"), ("j", "i"), ("dh", "d"), ("th", "t"), ("gh", "g"), ("kh", "k"), ("sch", "sh")):
        s = s.replace(a, b)
    if not s:
        return s
    head, tail = s[0], re.sub(r"[aeiou]+", "a", s[1:])
    return head + re.sub(r"(.)\1+", r"\1", tail)


def similarity(expected: str, heard: str) -> float:
    return difflib.SequenceMatcher(None, phonetic_key(expected), phonetic_key(heard)).ratio()


def wer(expected: str, heard: str) -> float:
    e = [_norm_word(w) for w in expected.split() if _norm_word(w)]
    h = [_norm_word(w) for w in heard.split() if _norm_word(w)]
    if not e:
        return 0.0
    sm = difflib.SequenceMatcher(None, e, h)
    matched = sum(b.size for b in sm.get_matching_blocks())
    return 1.0 - matched / max(len(e), len(h))


def words_in_span(words: Sequence[Tuple[str, float, float]], start: float, end: float) -> str:
    """Whisper words whose midpoint falls inside [start, end)."""
    return " ".join(w for (w, s, e) in words if start <= (s + e) / 2 < end)


def silence_boundary(a: np.ndarray, t0: float, t1: float, rel_db: float = -32.0) -> Tuple[float, float]:
    """Where to split two utterances that sit somewhere in [t0, t1]: the middle
    of the LONGEST quiet run in that window (quiet = rel_db below the clip's
    loudest frame). Returns (split_sec, quiet_run_sec); a run of 0 means there
    was no pause at all (the caller should not trust the split)."""
    r = frame_rms(a)
    if r.size == 0:
        return t0, 0.0
    lo, hi = max(0, int(t0 * SR / FRAME)), min(len(r), int(t1 * SR / FRAME) + 1)
    if lo >= hi:
        return t0, 0.0
    thr = r.max() * (10 ** (rel_db / 20.0))
    best_len, best_mid, run_start = 0, None, None
    for i in range(lo, hi + 1):
        quiet = i < hi and r[i] < thr
        if quiet and run_start is None:
            run_start = i
        elif not quiet and run_start is not None:
            n = i - run_start
            if n > best_len:
                best_len, best_mid = n, (run_start + i) / 2
            run_start = None
    if best_mid is None:
        i = lo + int(np.argmin(r[lo:hi]))
        return (i * FRAME + FRAME / 2) / SR, 0.0
    return best_mid * FRAME / SR, best_len * FRAME / SR
