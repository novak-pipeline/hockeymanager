# Booth reference voices

The fixed conditioning clips for the two booth seats. Re-rendering stems or
name banks with any other clip changes the booth's voice. See
docs/COMMENTARY-BOOTH.md.

| File | Origin | Licence |
|---|---|---|
| `dia2_pbp_prefix.wav` | `example_prefix1.wav` from github.com/nari-labs/dia2 (model output, per its README) | Apache-2.0, Copyright Nari Labs |
| `dia2_color_prefix.wav`, `chatterbox_color_ref.wav` | Kokoro-82M stock voice `am_michael`, rendered in the local TTS lab | Apache-2.0 (hexgrad/Kokoro-82M) |
| `chatterbox_pbp_ref.wav` | Kokoro-82M stock voice `bm_george`, rendered in the local TTS lab | Apache-2.0 (hexgrad/Kokoro-82M) |
| `transcripts.json` | Whisper-large-v3 word timings of the prefixes (a Dia2 input) | ours |

None of these is a real person's voice. Never replace them with a recording of
a real announcer.
