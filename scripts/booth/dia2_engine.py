"""
dia2_engine.py - the booth's Dia2-2B voice, for OFFLINE rendering only.

Run with the Dia2 venv from the local TTS lab (see docs/COMMENTARY-BOOTH.md):

    K:/tts-lab/dia2/.venv/Scripts/python.exe scripts/booth/render_stems.py ...

Nothing here ships in the game. The game only plays the audio files these
scripts write.

Why the extra machinery around `Dia2.generate`:

  * Voice identity. Dia2 is not fine-tuned on one voice; without a prefix every
    call is a new person. Each seat therefore has a fixed PREFIX clip
    (scripts/booth/voices/*.wav) that conditions every render.
  * Speed. Dia2 re-runs the prefix through the transformer one frame at a time
    on EVERY call (~25 s of eager, kernel-launch-bound work on Windows) before
    it generates a single new frame. We run that warm-up once per seat, keep
    the KV cache it produced, and restore it on later calls. Same maths, a
    fraction of the time (see `_patch_prefix_reuse`).
  * Whisper. Dia2 transcribes each prefix with Whisper-large-v3 on every call.
    The transcripts never change, so they are cached on disk
    (scripts/booth/voices/transcripts.json) and Whisper is only loaded for QA.
  * Word timestamps. `GenerationResult.timestamps` gives the frame each word
    started on, straight from the model's own text stream. That is what lets us
    cut a name out of a carrier sentence ("It's Kaprizov!") - Dia2 cannot say a
    lone word - and cut a stem at the name slot.
"""
from __future__ import annotations

import json
import os
import sys
import types
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
VOICES = os.path.join(HERE, "voices")


def _lab_root() -> str:
    return os.environ.get("TTS_LAB", "K:/tts-lab")


def setup_env() -> None:
    """Point every model cache at the lab (it holds the downloaded weights)."""
    lab = _lab_root()
    os.environ.setdefault("HF_HOME", f"{lab}/hf-cache")
    os.environ.setdefault("HF_HUB_CACHE", f"{lab}/hf-cache/hub")
    os.environ.setdefault("TORCH_HOME", f"{lab}/torch-cache")
    os.environ.setdefault("XDG_CACHE_HOME", f"{lab}/xdg-cache")
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    os.environ.setdefault("HF_HUB_OFFLINE", "1")  # weights are already local; never fetch
    # A `dia2/` folder in the cwd shadows the package: never run from the lab root.
    if os.path.isdir(os.path.join(os.getcwd(), "dia2", "src")):
        os.chdir(HERE)


SAMPLE_RATE = 24000


@dataclass(frozen=True)
class Seat:
    """One booth seat: its conditioning prefix and sampling per style."""
    prefix: str
    styles: Dict[str, Tuple[float, float]]  # style -> (cfg_scale, audio temperature)


# Dia2 has no emotion knob. Energy comes from the prefix, the text's
# punctuation, and classifier-free guidance (higher cfg = more committed, louder
# delivery; measured +7 st pitch lift on excited lines in the lab).
SEATS: Dict[str, Seat] = {
    "pbp": Seat(
        prefix=os.path.join(VOICES, "dia2_pbp_prefix.wav"),
        styles={"excited": (3.0, 0.9), "neutral": (2.0, 0.8), "rising": (2.0, 0.8)},
    ),
    "color": Seat(
        prefix=os.path.join(VOICES, "dia2_color_prefix.wav"),
        styles={"neutral": (2.0, 0.8), "excited": (2.5, 0.85), "rising": (2.0, 0.8)},
    ),
}


class Dia2Booth:
    def __init__(self, device: str = "cuda") -> None:
        setup_env()
        import torch

        # Dia2 targets torch>=2.9 (cudnn.conv precision API); the lab has 2.8.
        if not hasattr(torch.backends.cudnn, "conv"):
            torch.backends.cudnn.conv = types.SimpleNamespace()
        import dia2.engine as de
        import dia2.runtime.voice_clone as vc
        from dia2 import Dia2

        self.torch = torch
        self.device = device
        self._vc = vc
        self._transcripts_path = os.path.join(VOICES, "transcripts.json")
        self._transcripts: Dict[str, list] = {}
        if os.path.exists(self._transcripts_path):
            with open(self._transcripts_path, encoding="utf-8") as f:
                self._transcripts = json.load(f)
        vc.transcribe_words = self._transcribe_prefix
        self._patch_prefix_plan(de)
        self._patch_prefix_reuse(de)
        dtype = "bfloat16" if device == "cuda" else "float32"
        self.dia = Dia2.from_repo("nari-labs/Dia2-2B", device=device, dtype=dtype)

    # ── prefix transcripts: Whisper once, then from disk ─────────────────────
    def _transcribe_prefix(self, path, device, language=None):
        key = os.path.basename(path)
        if key not in self._transcripts:
            words = whisper_words_file(path)
            self._transcripts[key] = [[w, s, e] for (w, s, e) in words]
            with open(self._transcripts_path, "w", encoding="utf-8") as f:
                json.dump(self._transcripts, f, indent=1, ensure_ascii=False)
        return [self._vc.WhisperWord(text=w, start=float(s), end=float(e)) for (w, s, e) in self._transcripts[key]]

    @staticmethod
    def _patch_prefix_plan(de) -> None:
        orig = de.build_prefix_plan
        cache: Dict[tuple, object] = {}

        def cached(runtime, prefix, **kw):
            if prefix is None:
                return None
            k = (prefix.speaker_1, prefix.speaker_2)
            if k not in cache:
                cache[k] = orig(runtime, prefix, **kw)
            return cache[k]

        de.build_prefix_plan = cached

    def _patch_prefix_reuse(self, de) -> None:
        """Run the per-seat prefix warm-up once; restore its KV cache after.

        The warm-up only feeds the prefix's own audio tokens and forced
        new-word/pad tokens through the transformer. Its KV rows depend on the
        prefix alone, so the rows written on the first call are exactly the rows
        every later call would write. We still replay the (cheap, CPU-side) text
        state machine so the script cursor lands in the same place.
        """
        orig = de.warmup_with_prefix
        snaps: Dict[int, dict] = {}
        torch = self.torch

        def reuse(runtime, plan, state, generation):
            key = id(plan)
            cache = generation.decode.transformer
            n = plan.aligned_frames
            if key not in snaps:
                start = orig(runtime, plan, state, generation)
                snaps[key] = {
                    "slots": [
                        (s.keys[:, :, :n].clone(), s.values[:, :, :n].clone(), s.length.clone())
                        for s in cache.slots
                    ],
                    "step_tokens": generation.step_tokens.clone(),
                }
                return start
            snap = snaps[key]
            new_word_steps = set(plan.new_word_steps)
            step_tokens = generation.step_tokens
            branches = step_tokens.shape[0]
            tokens = plan.aligned_tokens.to(runtime.device)
            c = runtime.constants
            with torch.inference_mode():
                # The original loop minus the transformer forward: same token
                # writes, same state-machine transitions, in the same order.
                for t in range(n):
                    for cb in range(tokens.shape[0]):
                        delay = runtime.audio_delays[cb] if cb < len(runtime.audio_delays) else 0
                        idx = t - delay
                        step_tokens[:, 2 + cb, 0] = tokens[cb, idx] if idx >= 0 else c.audio_bos
                    forced = c.new_word if t in new_word_steps else c.pad
                    main_token, aux_token, _ = runtime.machine.process(t, state, forced, is_forced=True)
                    step_tokens[0, 0, 0] = main_token
                    step_tokens[0, 1, 0] = c.pad if aux_token == -1 else aux_token
                    if branches > 1:
                        step_tokens[1:, 0, 0] = c.zero
                        step_tokens[1:, 1, 0] = c.pad
                for slot, (k, v, ln) in zip(cache.slots, snap["slots"]):
                    slot.keys[:, :, :n].copy_(k)
                    slot.values[:, :, :n].copy_(v)
                    slot.length.copy_(ln)
            return max(n - 1, 0)

        de.warmup_with_prefix = reuse

    # ── generation ───────────────────────────────────────────────────────────
    def generate(self, text: str, seat: str, style: str, seed: int = 1234):
        """Render `text` in one seat's voice. Returns (wav float32 @24k, [(word, t_sec)])."""
        from dia2 import GenerationConfig, SamplingConfig

        s = SEATS[seat]
        cfg_scale, temp = s.styles.get(style, s.styles["neutral"])
        config = GenerationConfig(
            cfg_scale=cfg_scale,
            audio=SamplingConfig(temperature=temp, top_k=50),
            use_cuda_graph=(self.device == "cuda"),
        )
        self.torch.manual_seed(seed)
        r = self.dia.generate("[S1] " + text.strip(), config=config, prefix_speaker_1=s.prefix)
        wav = r.waveform.squeeze().float().cpu().numpy().astype(np.float32)
        return wav, list(r.timestamps)


# ── Whisper (QA + prefix transcripts) ────────────────────────────────────────
_WHISPER: dict = {}


def whisper_words(audio: np.ndarray, sr: int) -> List[Tuple[str, float, float]]:
    """Word-level Whisper-large-v3 transcript (text, start, end) of mono audio."""
    import torch
    import torchaudio
    import whisper_timestamped as wts

    if "m" not in _WHISPER:
        _WHISPER["m"] = wts.load_model("openai/whisper-large-v3", device="cuda" if torch.cuda.is_available() else "cpu")
    a = torchaudio.functional.resample(torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32)), sr, 16000).numpy()
    res = wts.transcribe(_WHISPER["m"], a, language="en", verbose=None)
    return [(w["text"], float(w["start"]), float(w["end"])) for seg in res.get("segments", []) for w in seg.get("words", [])]


def whisper_words_file(path: str):
    import soundfile as sf

    a, sr = sf.read(path, dtype="float32")
    if a.ndim > 1:
        a = a.mean(axis=1)
    return whisper_words(a, sr)
