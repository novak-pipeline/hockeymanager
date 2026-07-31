# Performance measurements

Raw output from the profilers, kept so a claim about performance can be checked
rather than believed. Regenerate any of them at any time.

| File | What it is |
|---|---|
| `2d-match-cpu-profile.txt` | V8 CPU profile of the 2D watched game **before** the C2 fix, taken in the real Electron app. |
| `2d-match-cpu-profile-after.txt` | The same profile **after** it. |
| `2d-playback-profile.txt` | Headless replay of a real full-sim stream: per-tick cost by layer, before vs after, plus the motion-resolution table. |

## Running them

The in-app CPU profile drives the real app with Playwright, walks a fresh career
to the first match day, opens the 2D viewer and profiles a window at 1× and 2×.
It needs the profiling build — that one keeps function names and puts React and
Pixi in their own chunks, so sampled self-time can be attributed by file even
though `react-dom` ships pre-minified:

```bash
PROFILE_BUILD=1 npm run build && node scripts/dev/profile-match-2d.mjs
```

The headless replay is deterministic (no machine noise) and is the right place
to compare two implementations of the same per-tick work:

```bash
npx vitest run --config vitest.profile.config.ts
```

## What the C2 measurement found (2026-07-31)

The watched game was **not** frame-limited at 2×. Main thread 84% idle at both
speeds; React commits 2.4% → 2.5%; Pixi draw 1.8% → 1.7%. The one thing that did
grow was MatchViewer's per-tick event processing — two full walks of a ~20k-event
stream on every rendered frame — and even that was under 2% of a core. What
changes with speed is *motion resolution*: the engine emits a positional frame
every 0.25 s, so the 2× nudge (4× in open play, 10× through whistle-to-faceoff
dead time) leaves as little as 1.5 rendered frames per engine frame and 40
interpolation direction changes a second. That is the judder.
