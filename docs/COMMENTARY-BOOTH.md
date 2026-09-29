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
  - The renderer adds a forced `<break/>` in front of the name, so the name is
    the last stretch of sound in its unit.
  - `keep_last_segment` keeps only what follows the last real pause.
  - Carriers tried and rejected:
    - "It's {name}!" left the hiss of its "s" on the clip.
    - Name-first carriers ("{name}! Great shot!") made Whisper stop
      transcribing after the first line.
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
    (the first names.ts surname Whisper hears cleanly), exactly as the game
    plays it. Heard on its own, Whisper drops a
    stem's trailing "for"/"by"/"on" nearly every time, so an isolated score says
    nothing.
- **Name cuts: Whisper finds the unit, the audio finds the edge.**
  - Dia2's per-word stamps drift against the audio by a variable amount, worst
    around `<break/>`s. Cuts placed on them clipped name onsets ("Crosby" came
    out "Crossbeast") and dropped stems' last words.
  - Whisper-large-v3 transcribes each batch. The carrier's last word
    ("shot,"/"work,") anchors each unit; its word order is reliable, its word
    edges are not.
  - The actual cut comes from the audio: the pause before the next carrier ends
    the clip, and `keep_last_segment` / `clean_edges` drop any carrier left in
    front of the name.
- **Two QA gates per name clip:**
  1. What Whisper hears between the anchors must resemble the name (phonetic
     similarity ≥ 0.45).
  2. The clip, **stitched after a plain line of the same seat** ("And it is
     in!" + name), must not be heard with a carrier word in it. That is exactly
     how a player would hear a bad cut.

  A clip that fails is retried with a new seed, up to 3 times, then marked
  failed. A failed name is simply not said: the line plays bare.
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

## 6. Numbers (RTX 5090, Windows, busy desktop; 2026-09-28)

| | |
|---|---|
| Stems (Dia2) | 96 clips (62 stems + 34 bare), **270 s of audio, 1.4 MB** Ogg/Opus, committed. First full pass: 28 min for 2 takes of every clip. The targeted re-renders that followed added about 1.5 h in total. |
| Stem QA | After the re-renders, every stem is word-perfect for Whisper or within its spelling noise ("Milestone Watch"). Tail stems were scored stitched to a reference name. |
| Name throughput | **About 3–4 s of GPU per accepted clip**: batches of 10, plus Whisper QA and retries. The fixed cost of about 10 s per Dia2 call is the floor. |
| Name clip size | About 6 KB per clip (about 1 s Opus). |
| Vanilla bank (committed) | The 50 `names.ts` surnames × 3 variants (pbp excited/neutral, colour neutral). |
| Demo mod bank (not committed) | 20 NHL stars × 3 variants in `mods/nhl-ehm/commentary/dia2/`. |

**Estimates for the full banks.** Each is a GPU job over 30 min, so it needs
owner approval before it runs. All are resumable and pausable.

| Bank | Clips | GPU time | Size |
|---|---:|---:|---:|
| Fictional pools, all 3,251 surnames × 3 variants | 9.75k | about 9–11 h | about 60 MB (at the repo's ~60 MB line: commit pbp-only, or git-ignore it and treat it as a build step) |
| Fictional pools, pbp excited + neutral only | 6.5k | about 6–7 h | about 40 MB |
| nhl-ehm, NHL rosters (660 surnames + 699 full names) × 3 | 4.1k | about 4 h | about 25 MB (mod folder) |
| nhl-ehm, whole DB (8,555 surnames + 699 full) × 3 | 27.8k | about 25–30 h | about 170 MB (mod folder) |

## 7. Known issues and what's left

- **The owner must listen.** Every automatic check here goes through Whisper,
  which spells unknown names however it likes and sometimes drops a name glued
  to a sentence. Samples are listed in the booth branch report. The
  `state.json → check` list in each bank names the clips to spot-check.
- **Name-cut yield.** On hard names (the NHL demo), only about 70–75 % of clips
  pass both gates within 3 attempts. The rest play bare.
  - The cleaner fix is a real forced aligner, torchaudio's MMS_FA, which needs a
    one-time ~1.2 GB model download (owner approval).
  - Or fine-tune Dia2 on the two seat voices, which would let it say a lone word.
- **Dia2 call overhead.** CUDA graphs are re-captured on every call. Keeping the
  graph and buffers across calls (a deeper patch of `run_generation_loop`)
  would roughly halve the name-bank time.
- **Chatterbox pair.** The worker and the render path are in place
  (`render_stems.py --pair chatterbox`, and `render_names.py` accepts it), but
  its stems were not rendered in this pass. Settings shows it as
  "not installed".
- **No runtime fallback voice for unbanked names.** A pregame Chatterbox child
  process was deliberately not added:
  - its voice would not match the Dia2 booth;
  - it would ship a 7 GB Python stack.

  Unbanked names play the bare line. Modders re-run `render_names.py` (it only
  renders what's missing) after a roster refresh or a draft.
- **Library wording.** Lead-slot lines were rewritten as "{name}! He …" (whole
  sentences). The bare line of `goal.tie.2` is now "All tied up!", because Dia2
  said "Tie game" as "Time game" in every take.
- **Pronunciation defaults** were written for Kokoro. They are now rendered as
  one plain word ("Kahpreezoff"). A few (Tkachuk → "Kuhchuck") may be better
  left as spelled. That is for the owner's ear.
- **Credits.** Add the Mimi CC-BY-4.0 attribution to the game's credits /
  third-party notices before shipping.
