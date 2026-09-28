# The commentary booth

Spoken play-by-play and colour for **watched matches only**: a fixed two-man
booth whose every word is **recorded ahead of time**. The game never runs a
voice model. It plays Ogg/Opus clips and stitches a player's name onto a line.

The line library, the director that picks lines and the scheduler that plays
them are described in `docs/BROADCAST-PACKAGE.md` §4. This page covers the
voices, the offline renderer, the name banks, the runtime rules and the
licences.

**Status:** Commentary is a setting that is **OFF by default** until the owner
approves the sound (Settings → Commentary, or the Commentary button on the match
screen).

## 1. The voices

| Seat | Name | Dia2 booth (default) | Chatterbox booth (alternative) |
|---|---|---|---|
| Play-by-play | Graham Whitlock | Dia2-2B conditioned on `scripts/booth/voices/dia2_pbp_prefix.wav` | Chatterbox zero-shot from `chatterbox_pbp_ref.wav` |
| Colour | Dale Brennan | Dia2-2B conditioned on `dia2_color_prefix.wav` | Chatterbox zero-shot from `chatterbox_color_ref.wav` |

- The owner picked **Dia2-2B (Nari Labs)** in the blind listening test in
  `K:/tts-lab` because it "sounds more like American hockey announcers".
  **Chatterbox (Resemble AI)** had the best overall performance and is the
  alternative booth.
- **No real person's voice is cloned.**
  - `dia2_pbp_prefix.wav` is Dia2's own `example_prefix1.wav`, which Nari Labs
    say is model output.
  - The other three reference clips are Kokoro-82M stock voices (`bm_george`,
    `am_michael`), rendered by the lab.
  - All four are committed so the booth identity can be re-rendered exactly.
- **Consistency.** Dia2 is not fine-tuned on a single voice. Every render is
  therefore conditioned on the seat's fixed prefix clip, so the voice is the
  same across all stems and all name clips.
- **Delivery.**
  - The play-by-play man renders goal, save, fight and hit calls at `excited`
    (Dia2 classifier-free guidance 3.0) and the rest at `neutral` (cfg 2.0).
  - The colour man is always conversational.
  - `stemStyle()` in `commentaryLibrary.ts` decides this, and a test pins it.

## 2. Offline pipeline (`scripts/booth/`)

All of this runs on a developer or modder machine with the local TTS lab
(`K:/tts-lab`: Dia2 and Chatterbox venvs plus the downloaded weights). Nothing
here ships in the game.

| Script | Runs in | Does |
|---|---|---|
| `export-lines.mjs` | Node ≥ 22.6 | Prints the line library (`commentaryLibrary.ts`) as JSON. |
| `export-names.mjs` | Node | Lists every name to bank as the **exact text** `pronunciation.ts` gives the engine (the same function the game calls, so the bank key is what the game looks up). Use `--mod <dir>` for a mod DB (applies the mod's `pronunciations.json`) or `--fictional` for the repo's name pools, including every reachable output of the generated-surname builders. |
| `render_stems.py` | Dia2 venv | Renders stems and bare lines to `src/renderer/public/commentary/<pair>/`: 2 takes per clip, and the best take is chosen by Whisper-large-v3 word error rate. Writes a QA report to `.cache/booth/<pair>-stems-qa.json`. |
| `render_names.py` | Dia2 venv | Renders a name bank. It is **resumable** (the index is written after every batch), **pausable** (create a `PAUSE` file in the output folder), limited by `--max-minutes`, and `--estimate` prints the work left and the GPU time. |
| `chatterbox_worker.py` | Chatterbox venv | The Chatterbox booth as a child process (JSON lines over stdin/stdout). `render_stems.py --pair chatterbox` drives it. |
| `stitch_demo.py` | Dia2 venv | Writes stitched calls exactly as the game plays them, to judge the seams by ear. |
| `dia2_engine.py`, `audio_util.py` | shared | The Dia2 wrapper, and the trim, level, cut, Opus and QA helpers. |

Commands (from the repo root):
```sh
PY=K:/tts-lab/dia2/.venv/Scripts/python.exe
$PY scripts/booth/render_stems.py --pair dia2            # ~20 min on the RTX 5090
$PY scripts/booth/render_stems.py --pair chatterbox      # alternative booth
node scripts/booth/export-names.mjs --fictional > .cache/booth/fictional-jobs.json
$PY scripts/booth/render_names.py --jobs .cache/booth/fictional-jobs.json \
    --out src/renderer/public/commentary/dia2/names --variants pbp:excited,pbp:neutral
node scripts/booth/export-names.mjs --mod "mods/nhl-ehm" > .cache/booth/nhl-ehm-jobs.json
$PY scripts/booth/render_names.py --jobs .cache/booth/nhl-ehm-jobs.json \
    --out mods/nhl-ehm/commentary/dia2 --estimate
```

### Why Dia2 needs the extra machinery
Every rule below was learned from a failed render, and every one is measured in
the render logs.

- **Dia2 cannot say a lone word.** Every isolated name clip in the lab was
  mumble. A **name** is therefore rendered inside a carrier phrase and cut out.
  - The carriers are "Great shot, {name}!" (excited), "Nice work, {name}."
    (neutral) and "Wait, {name}?" (rising), set in
    `booth.config.json → nameCarriers`.
  - Each carrier ends in a stop consonant plus a comma, which leaves a gap in
    front of the name. "It's {name}" left the hiss of its "s" on the clip
    (Whisper heard "It's McDavid" in a stitched call).
- **Every stem is read whole, never cut.**
  - **Lead slot.** Dia2 garbles the first word of a verb-first fragment:
    "shoots, and scores!" came out "Fruits and scores" or "Foot and scores" in
    every take. A lead-slot line is therefore written so that what follows the
    name is a whole sentence of its own, `"{name}! He shoots, and scores!"`, and
    the stem is that sentence. A test enforces this.
  - **Tail slot.** Cutting the placeholder off "Big save, <break/> Jackson!"
    kept dropping the weak word right before the name ("…absolutely robbed by"
    lost its "by"). A tail stem ("Oh, what a save by") is now read on its own.
  - A tail stem is judged **stitched** to a reference name clip from the bank
    ("Murphy"), exactly as the game plays it. Heard on its own, Whisper drops a
    stem's trailing "for"/"by"/"on" nearly every time, so an isolated score says
    nothing.
- **Cuts are aligned with Whisper, not with Dia2's word stamps.**
  - Dia2's per-word stamps drift against the audio by a variable amount, worst
    around `<break/>`s.
  - Cuts placed on them clipped name onsets ("Crosby" came out "Crossbeast"),
    kept carrier scraps ("Work Matthews") and dropped a stem's last word ("…a
    milestone night for" lost its "for").
  - Now Whisper-large-v3 transcribes the render, with word timings:
    - the carrier words are the anchors;
    - the name is what is heard between one carrier and the next;
    - every edge snaps to the longest pause in the gap around it.
  - Dia2's stamps are still used to split a multi-line stem batch at its 0.9 s
    breaks. Every clip is QA'd afterwards, so a bad split is caught.
  - A last pass (`clean_edges`) drops a short burst that a ≥ 0.15 s pause cuts
    off from the rest of a name clip, such as the "t" of "shot" in front of
    "Doyle". A name has no pause that long inside it.
- **Every shipped clip is QA'd by Whisper-large-v3 against its exact text.**
  - A scrap of the conditioning prefix before the first word ("Well, the puck
    is down…") is trimmed.
  - Stems keep the best of 2–3 takes.
  - Clips whose word error rate is over 0.10 are re-rendered one line per call
    (`--recheck 0.1`).
- **Batching.**
  - Each Dia2 call pays a fixed cost of about 10–12 s on Windows (CUDA-graph
    capture and set-up).
  - Stems are rendered about 6 lines per call, separated by 0.9 s breaks.
  - Names are rendered **10 per call**: a 16-name excited batch drifted into
    gibberish.
  - Neighbouring clips share one split point, so neither keeps a scrap of the
    other. A split with no real pause is re-rendered solo, or retried with a new
    seed.
- **Respellings are one plain word per name.** `pronunciation.ts` turns
  "NEH-chahs" into "Nehchahs". Hyphenated respellings were spelled out by Dia2
  ("pahs-ter-nyahk" came out "Pops. Turn it."), and ALL-CAPS syllables are read
  letter by letter by every engine.
- **Prefix reuse.**
  - Dia2 re-feeds the seat's prefix through the transformer on every call. This
    is eager and kernel-launch-bound, about 20–25 s.
  - `dia2_engine.py` runs that warm-up once per seat, keeps the KV rows it
    wrote, and restores them on later calls, while still replaying the cheap
    text state machine.
  - Result: a 3 s line went from 28.6 s to 13.3 s.
- **Whisper** transcribes each prefix only once. The transcripts are cached in
  `scripts/booth/voices/transcripts.json`. After that, Whisper is only used for
  QA.
- **Levelling.** Every clip is normalised to the same voiced-frame loudness,
  −19 dBFS RMS (excited +1.5 dB), and peak-limited to −1 dBFS. A name next to a
  stem never jumps out.
- **Format.** Ogg/Opus, 24 kHz mono, about 32 kbps (libsndfile
  `compression_level=0.9`), which Chromium's `decodeAudioData` reads natively
  (verified in the dev harness).

## 3. Name banks

A bank maps `"<seat>|<style>|<spoken text>"` to a clip (`NameBankIndex` in
`clipManifest.ts`).
- It is keyed by the **spoken text**, not by player id. Everyone who shares a
  surname shares the clip, and so does a generated player who draws that
  surname years later.
- **Fictional pools** are the repo's own data, so their bank ships with the game
  in `src/renderer/public/commentary/<pair>/names/` and is committed. It covers:
  - the 50 `names.ts` surnames
  - every authored and generated surname in `nationNames.ts`
- **Real-roster mods.** Real names are mod data, so the bank lives with the mod
  in `mods/<mod>/commentary/<pair>/`. `mods/` is git-ignored, and the files
  never enter the repo.
- **Pronunciation** uses one resolver for both banking and lookup
  (`pronunciation.ts`):
  - a per-player `pronunciation` field
  - then the mod's `pronunciations.json`
  - then shipped overrides for the usual traps
  - then nationality letter rules

  The main process merges every mod's `pronunciations.json` and hands the result
  to the booth.
- **Fixing a hard name:**
  1. Add a respelling to `mods/<mod>/pronunciations.json`, in hyphenated
     syllables with stress in CAPS ("kah-PREE-zoff"). The engine gets one plain
     word, "Kahpreezoff".
  2. Re-run `export-names.mjs`, then `render_names.py`. Only the changed key is
     rendered, because the key is the spoken text.
- **QA.**
  - Whisper hears each batch.
  - A clip is rejected, retried once with a new seed and then marked failed if:
    - its phonetic similarity to the intended text is below 0.45, or
    - its duration is implausible.
  - Borderline clips (below 0.65) are listed under `check` in `state.json` for
    a listen.
  - Whisper spells unknown names however it likes, so this catches mumble, not
    a wrong stress.

## 4. Runtime (`src/renderer/lib/commentaryAudio.ts`, `src/main/booth.ts`)

- **No engine.** The module imports no TTS code, and a test fails if it ever
  does. The old live Kokoro name renderer, which spun a neural model up
  mid-game, is gone.
- **Files.**
  - The main process serves the stems and name banks over validated IPC
    (`booth:*`): pair, source and file names are pattern-checked, so there is
    no path traversal.
  - Packaged `file://` pages can't `fetch` local files. The browser dev harness
    falls back to `fetch` from the dev server.
- **Pregame.**
  - The booth loads the chosen pair's stems and indexes its name banks.
  - It then resolves tonight's two dressed rosters (every seat, form and
    inflection a line can ask for) and decodes those clips in the background.
    `decodeAudioData` runs off the main thread.
  - Name lookup falls back from the full name to the surname, and from `rising`
    to `neutral`.
  - A name that isn't banked plays the line's **bare** clip. A cue never waits
    for a name.
- **Stitching.**
  - `[name][stem]` or `[stem][name]` is played with a 30 ms breath
    (`STITCH_GAP_MS`).
  - The sink stops whatever is still sounding before it starts a line, so two
    lines never overlap.
  - The priority, barge-in and stale-drop rules are unchanged (see
    BROADCAST-PACKAGE §4).
- **Truthful lines.** The director picks lines from the real event stream (the
  scorer, the tie or lead state, PP/SH/EN, OT). Every stem is QA'd against its
  text with Whisper, so a clip says what its line says.
- **Stems-missing guard.**
  - If the chosen pair isn't installed, the other pair is used.
  - If none is installed, the match screen shows "Booth: commentary audio not
    installed".
  - The toggle never silently does nothing, and never falls back to TTS or the
    system voice.
- **Settings.** Settings → Commentary has:
  - on/off (default **off**)
  - volume
  - booth voices (Dia2 default, Chatterbox), each marked installed or not
  - "Hear the booth": one stitched goal call

## 5. Licences (checked 2026-09-28)

| Component | Code | Weights | Generated audio |
|---|---|---|---|
| **Dia2-2B** (Nari Labs) | Apache-2.0 (`K:/tts-lab/dia2/src/LICENSE`) | Apache-2.0 (HF model card) | No restriction on outputs. The model card forbids identity misuse (audio resembling real people without permission), deceptive content and illegal use. We clone no one, and the booth is clearly a fictional broadcast. |
| **Mimi codec** (Kyutai), used inside Dia2 | (Dia2 repo) | **CC-BY-4.0**: commercial use allowed, **attribution required** | Attribution goes in the game's credits / third-party notices: "Mimi audio codec by Kyutai, CC-BY-4.0". |
| **Chatterbox** (Resemble AI) | MIT (`chatterbox_tts-0.1.7`, `License-Expression: MIT`) | MIT (HF model card) | Commercial use allowed. **Every output carries Resemble's imperceptible Perth watermark.** That is harmless for us, and worth knowing. |
| **Kokoro-82M** (reference clips only) | Apache-2.0 | Apache-2.0 | Used only as the reference voices. |
| **Whisper-large-v3** (offline QA and prefix transcription only) | MIT | MIT | Not shipped. |

**Verdict:** nothing blocks shipping. Both engines allow commercial use, and
bundling the audio they generate is allowed. The obligations are:
1. the Mimi CC-BY-4.0 attribution in the credits;
2. keeping the Apache-2.0 NOTICE and licence text for the Dia2 example prefix
   clip we commit (`scripts/booth/voices/README.md`);
3. never conditioning on a real person's voice.

None of the engines ships in the game. Only their output does.

## 6. Numbers

Measured on the RTX 5090 under Windows (WDDM, busy desktop):

(filled in by the render runs; see the booth branch report)
