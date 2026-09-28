"""
chatterbox_worker.py - the Chatterbox booth voice as a child process (runs in
the Chatterbox venv of the local TTS lab). Offline/dev tool only: nothing here
ships in the game.

Protocol: one JSON job per stdin line
    {"text": "...", "seat": "pbp"|"color", "style": "excited"|"neutral"|"rising", "seed": 1, "out": "x.wav"}
and one reply line per job: "ok <path>" or "err <message>". Prints "ready" once
the model is loaded.
"""
import json
import re
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.environ.get("TTS_LAB", "K:/tts-lab")
for k, v in {"HF_HOME": f"{LAB}/hf-cache", "HF_HUB_CACHE": f"{LAB}/hf-cache/hub", "TORCH_HOME": f"{LAB}/torch-cache",
             "HF_HUB_OFFLINE": "1", "HF_HUB_DISABLE_SYMLINKS_WARNING": "1"}.items():
    os.environ.setdefault(k, v)

import torch  # noqa: E402
import soundfile as sf  # noqa: E402
from chatterbox.tts import ChatterboxTTS  # noqa: E402

device = "cuda" if torch.cuda.is_available() else "cpu"
model = ChatterboxTTS.from_pretrained(device=device)

# Zero-shot seats from Apache-2.0 Kokoro stock-voice clips (never a real person).
REF = {"pbp": os.path.join(HERE, "voices", "chatterbox_pbp_ref.wav"),
       "color": os.path.join(HERE, "voices", "chatterbox_color_ref.wav")}
# Resemble's guidance: high exaggeration + low cfg_weight = more dramatic.
STYLE = {
    "excited": dict(exaggeration=0.95, cfg_weight=0.3, temperature=0.8),
    "neutral": dict(exaggeration=0.45, cfg_weight=0.5, temperature=0.8),
    "rising": dict(exaggeration=0.55, cfg_weight=0.5, temperature=0.8),
}
CONDS = {}
for seat, p in REF.items():
    with torch.no_grad():
        model.prepare_conditionals(p, exaggeration=0.5)
    CONDS[seat] = model.conds

print("ready", flush=True)
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        job = json.loads(line)
        torch.manual_seed(int(job.get("seed", 1234)))
        model.conds = CONDS[job["seat"]]
        # Chatterbox has no SSML: a <break/> becomes a plain sentence gap.
        text = re.sub(r'<break[^>]*/>', ' ', job["text"]).strip()
        style = STYLE.get(job.get("style", "neutral"), STYLE["neutral"])
        if job["seat"] == "color" and job.get("style") == "neutral":
            style = dict(exaggeration=0.4, cfg_weight=0.5, temperature=0.8)
        with torch.no_grad():
            wav = model.generate(text, **style)
        sf.write(job["out"], wav.squeeze().cpu().numpy(), model.sr)
        print("ok " + job["out"], flush=True)
    except Exception as e:  # keep serving
        print("err " + str(e).replace("\n", " "), flush=True)
