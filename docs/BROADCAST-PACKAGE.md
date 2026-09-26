# Broadcast package

TV presentation for watched games: a pregame open, on-ice and lower-third
graphics, ceremonial moments, and a two-man commentary booth. It works over both
the 2D and 3D match views.

It is built as three layers on top of the event stream. None of the layers
changes the stream or any frozen contract shape.

```
 GameStream (frozen) ─┐
                      ├─► PresentationDirector ──► BroadcastPlan ──► MatchViewer routes cues:
 BroadcastContext ────┘   (pure, seeded, tested)    pregame[] (wall ms)   overlay    → HTML/CSS layer (2D + 3D)
 (engine-built, pre-sim)                            game[]    (absT)      commentary → booth scheduler → WebAudio
                                                                          shot       → 3D renderer (BroadcastShotConsumer)
                                                                          moment     → 3D renderer + caption overlay
```

## 1. Storyline context: where "tonight" comes from

**File:** `src/engine/story/broadcastStorylines.ts`. It holds the types and the pure
`detectStorylines()`. `Career.buildBroadcastContext()` gathers the facts.

**Delivery path.** This is the additive request/response pattern that
`getMatchDayPreview` and `getPostgameReceipt` already use:
- The request is `{ type: 'getBroadcastContext' }` and the response is
  `{ type: 'broadcastContext', context }`. These are new union members; no
  existing message shape changed.
- The career builds the context **before** the watched game is simmed. It is built
  in `watchRegularDay` and `playPlayoffDay` right before `fullSimGame`. That way
  every count is "before tonight".
- MatchViewer fetches the context once the game arrives, and only accepts it if
  it matches the game's abbreviations.
- If the fetch fails (an old worker, a dev harness), `fallbackBroadcastContext()`
  builds a context from `WatchedGame` instead. That fallback carries **no
  storylines**, so nothing is ever invented renderer-side.

**Evidence rules.** These are the same rules the story layer already uses
(`careerLedger.ts`):

| Storyline | Fires when | What it drives |
|---|---|---|
| `debut` | A dressed skater or starting goalie has 0 NHL games on every record we trust, *and* his career is known: the imported history covers him, or the sim has archived NHL seasons, or he is ≤ 24 with no history. A 31-year-old import with an empty ledger never debuts. Backup goalies never debut. | Rookie lap in the pregame (regular season). A card in the playoffs. "His first NHL goal" call. |
| `homecoming` | He left tonight's **home** club this season or last (chronicle provenance, or the newest imported history row), he played ≥ 150 games there, and this is his first visit since (no completed game at that building with his club visiting). | Tribute video at the first whistle past 6:00 of P1, then a standing ovation. Revenge-goal call. |
| `revenge` | He was traded by tonight's opponent recently, but the tenure was short or tonight is at his own building. | Pregame card and revenge-goal call. No ceremony. |
| `milestoneWatch` | Regular season, known career, within 3 points or 2 goals of a round number. The ladders match the news milestones: points 500/1000/…, goals 100/200/…. | "Two points from 1,000" card. When a real goal crosses the mark: milestone graphic, standing ovation, a milestone call. |
| `milestoneGame` | Tonight is exactly his 500th, 1000th or 1500th game. | Recognition + ovation at the first whistle past 2:00. |
| `bannerNight` | Home opener of the regular season, and the home club holds the newest title in the record book (won in-save, or the imported real past). | Banner raising in the pregame. |
| `injuryReturn` | First game back after a layoff long enough to leave match rust. | Card. |
| `jerseyRetirement` | Wired end to end, but **nothing produces it**: the sim never retires numbers in-save. | Documented, not faked. |

A quiet night yields no storylines, and the open just runs the arena title,
lineups and goalie tape. `broadcastStorylines.test.ts` covers every rule.

Not detected yet:
- first game as captain (needs captaincy history)
- the first game after a trade *for his new club* (possible from provenance)
- shutout watch

## 2. The presentation director

**File:** `src/render2d/broadcast/director.ts` (`directBroadcast`).

The director is renderer-agnostic and pure. Variety comes from
`stableSeed(gameKey|slot)`, with no `Math.random`. The same game always produces
a byte-identical plan.

### Cue catalogue

| Channel | Cue | Trigger |
|---|---|---|
| overlay | `arenaTitle` | Start of the pregame. |
| overlay | `storyCard` | Top 2–3 earned storylines that have no ceremony of their own. |
| overlay | `startingLineup` ×2 | Pregame (full mode only): C, LW, RW, D, D, G with faces and season lines. |
| overlay | `goalieTape` | Pregame (full mode only). |
| overlay | `playerTag` | Every goal (scorer: GOAL + season total; assisters: 1ST/2ND ASSIST). Also a robbery save (BIG SAVE + saves tonight). |
| overlay | `lowerThird` | Every goal, 4.6 s after the call, once the tags have cleared. |
| overlay | `milestone` | A milestoneWatch player crosses his mark on a real goal. |
| overlay | `periodSummary` | Period end, and at the final. |
| overlay | `momentCaption` | Every moment cue ("Rookie lap — Ben Kindel, first NHL game"). |
| shot | `establishing`, `lineups`, `anthem`, `faceoffClose` | Pregame beats. |
| shot | `broadcast` | Puck drop: back to the main camera. |
| shot | `benchReaction`, `coachCloseup`, `goalReplay` | Goal sequence. The coach close-up comes only on a late tying goal or in OT. |
| shot | `saveReplay` | Robbery: shot danger ≥ 0.85, at most 3 a game. |
| shot | `penaltyBox`, `crowd`, `jumbotron` | Penalty or fight; ovation; tribute video or banner. |
| moment | `rookieLap`, `bannerRaising` | Pregame. |
| moment | `tributeVideo`, `standingOvation` | First TV timeout, or a milestone goal. |
| commentary | see §4 | |

### Timing rules
- **Pregame cues** are timed in wall ms and play while the renderer is paused.
  The open is skippable with the **SKIP OPEN** button or **Space**.
- **In-game cues** are keyed to game `absT`. MatchViewer fires them only on
  continuous playback: a seek, fast-forward or replay jump passes cues without
  firing them, and each cue fires at most once. Seeking backward re-arms the
  cues after the seek point.
- **The goal call** is cued at the goal's absT, with 0 delay, priority 3 and a
  maximum latency of 350 ms. Everything else in the goal sequence (tags, bench,
  replay, lower third, the analyst's line) has a `delayMs` behind it.
- **Presentation setting** (Full / Compact / Off, on the match screen and saved):
  - Compact drops the lineups, goalie tape, anthem and penalty-box shots, but
    keeps every earned moment.
  - Off shows no graphics at all; commentary is still planned.

## 3. Overlays

**Files:** `src/renderer/components/broadcast/BroadcastOverlays.tsx` and `broadcast.css`.

The overlays are HTML over the canvas, so the same graphics work over the 2D rink
and the 3D arena.

- **Motion:** framer-motion with short eased fades and rises. The app's
  `MotionConfig reducedMotion="user"` honours prefers-reduced-motion.
- **Layout stability:**
  - The scorebug cells are fixed width with tabular numerals, so scores never
    shift the layout.
  - The on-ice tag moves by `transform` only. Its position is eased toward the
    projected player and clamped inside the frame, so it follows smoothly and
    never jitters.
- **Puck area:**
  - The scorebug and captions sit in the top band. The lower third sits in the
    bottom band.
  - Pregame full-frame graphics only appear while the puck isn't in play.
  - Assist chips sit *below* their player and the scorer tag sits *above*, so a
    crease scrum never stacks three graphics on one spot.
- **Faces:** `FaceCutout` uses the mod facepack's cut-out PNG through the same
  `getFace` bridge `PlayerFace` uses. When there is no face, or the image fails,
  it draws a clean silhouette with initials, never a broken image.
- **Crests:** `CrestView` shows the real logo pack when present, otherwise a
  team-coloured roundel.
- **Style:** the on-ice tag and goal lower third follow the owner's EA-NHL
  references in our own design:
  - the face cut-out breaking out of the panel
  - FIRST name light, LAST name bold caps
  - number/position block
  - "GOAL 8:29 1ST · ASSISTS A. IVERSON, P. CROSBY"
  - PPG / SHG / EN / HAT TRICK tags
- **World anchoring:** `BroadcastProjector.projectPlayer(id)` gives a player's
  screen position.
  - The 2D renderer implements it (`RinkRenderer.projectPlayer`, an extra method
    that is not part of the frozen contract).
  - The 3D renderer can add it by projecting the rig's head bone.

Screenshots are in `docs/graphics/broadcast/`, taken on the dev harness from a
generated league. The "demo" storylines in those shots are harness-only
fabrications, which the page labels in its console:

| | |
|---|---|
| Pregame arena title | `pregame-arena-title-2d.png` |
| Rookie-lap caption | `pregame-rookie-lap-caption-2d.png` |
| Story card | `pregame-story-card-2d.png` |
| Starting lineup | `pregame-starting-lineup-2d.png` |
| Goalie tale of the tape | `pregame-goalie-tape-2d.png` |
| Scorebug with PP strip | `scorebug-2d.png` |
| On-ice goal tag and assist chips | `goal-onice-tag-2d.png` |
| Goal lower third, caption, milestone | `goal-lower-third-2d.png`, `milestone-card-2d.png` |
| Same graphics over the 3D view (this branch's pre-upgrade 3D) | `goal-lower-third-3d.png`, `milestone-card-3d.png`. There is no on-ice tag in 3D until `Rink3dRenderer` implements `projectPlayer`. |

To reproduce:
1. Start the dev server: `npx vite --config scripts/dev/vite.renderer-dev.config.mjs` (port 5179).
2. Run `node scripts/dev/broadcast-snaps.mjs` (add `--r=3d` for the 3D view). It
   uses a throwaway headless Chrome profile and never touches saves.

## 4. The booth: commentary

### Identity
There are two fixed voices. They are set in **one config file**,
`src/render2d/broadcast/booth.config.json`:

| Seat | Name | Engine / voice | Rate |
|---|---|---|---|
| Play-by-play | Graham Whitlock | Kokoro `bm_george` (grade C, British booth) | 1.10 |
| Colour | Dale Brennan | Kokoro `am_michael` (grade C+) | 1.04 |

Both come from `voiceCast.ts`'s quality-gated pools, and they are the same two
every night.

### Line library
**File:** `src/render2d/broadcast/commentaryLibrary.ts`. It holds 60 lines over
32 moments:
- **Pregame:** welcome, debut, homecoming, milestone, banner; rookie lap,
  tribute, ovation.
- **Goals:** goal, tie, go-ahead, **late tie**, **overtime**, **hat trick**,
  **PP**, **SH**, **empty net**, **revenge**, **milestone**, **first NHL goal**;
  plus the colour analyst's follow-up.
- **Saves:** big save, **robbery**, and the colour analyst's follow-up.
- **Everything else:** penalty, **fight**, big hit, period end, final, close
  final.

Each line's energy (intensity 1–3) is set by the moment it is picked for.

**Name slot rules** (enforced by tests):
- A line has at most one `{name}`, and only at the very start or end, so audio is
  stitched `[name][stem]` or `[stem][name]` with no mid-sentence splice.
- Every named line carries a `bare` version without the name.
- The name is the **surname** by default, as in real booths. The full name is
  used for introductions and the biggest moments: debut, first goal, milestone,
  rookie lap, tribute.
- Each line declares a `nameStyle` (`excited` for calls, `neutral` for colour),
  so the name clip matches the stem's energy.

**Selection:** a per-game `BoothPicker` never reuses a line until its moment's
pool is exhausted, and never repeats the previous line.

The old `render2d/commentary.ts` still generates the **text ticker**, and its
tests are unchanged. It no longer drives speech: the match no longer calls the
live-TTS announcer at all.

### Audio architecture: stitched pre-rendered clips, never live synthesis
Live neural TTS measured about 0.6× realtime in the renderer, so live calls would
lag. The booth plays only pre-rendered audio.

- **Stems** are built offline by `node scripts/dev/render-commentary.mjs`.
  - It renders every stem (`stem.<lineId>`) and every bare fallback
    (`bare.<lineId>`) with the booth voices.
  - It trims silence, writes 16-bit mono WAV to
    `src/renderer/public/commentary/clips/`, and writes `manifest.json`
    (clip id → file, duration, speaker, text).
  - **The audio is gitignored.** Only the manifest and the script are committed.
  - Format is WAV because no pure-JS Opus/MP3 encoder is in the dependency tree,
    and none was added.
  - The starter set is 96 clips, about 10 MB WAV. As Opus it would be about 1 MB.
- **Scheduler** (`audioScheduler.ts`, pure, tested with a fake clock and sink):
  - A cue that can start starts **in the same call**, with zero added latency.
  - Priority 3 barges in over lower priorities.
  - Other cues wait in a one-deep queue and are **dropped** once older than their
    `maxLatencyMs`.
  - The crowd and SFX bed is ducked from 0.7 to 0.3 while the booth talks.
  - A missing name clip plays the bare clip instead. A missing stem or bare clip
    is **silence**.
- **Never the system voice.** `commentaryAudio.ts` has no fallback engine. If
  Kokoro can't load, every line is played bare from the stems. If the stems are
  missing, the booth is silent. This is an owner rule: no "Microsoft Sam".
- **Setting:** Commentary has **its own toggle** (match screen, `hockey.broadcast.commentary`).
  It is independent of the general voice toggle, which stays off.
  **Commentary defaults to OFF until the owner approves the sound.**

### Player names are first-class
- **Background rendering** (`nameQueue.ts`, `BoothAudio.queueNames`), in priority order:
  - priority 0: tonight's starters (surname, excited and neutral)
  - priority 1: the rest of both dressed rosters, plus the full-name forms
  - priority 2: the rising variants
  - then the rest of the league (top 500 by points) trickles in 20 s into the
    game, in idle time
- Names are rendered by the **same engine and voice as the stems** (Kokoro on the
  existing `voice.worker.ts`, via the new `renderClipPcm`). It is never on the
  main thread: `renderClipPcm` refuses the in-process transport.
- Clips are cached in IndexedDB (`hockey-booth/names`), keyed by
  `nameClipKey(playerId, voiceId, form, style, pronunciationHash)`.
- If a name is not ready at call time, the line plays without it. **A cue never
  waits for a name.**
- **Intonation variants:** `neutral` ("Kaprizov."), `excited` ("Kaprizov!", rate
  +0.08) and `rising` ("Kaprizov?"). Kokoro has no style control, so style is
  terminator punctuation plus rate. A cloning engine with real style control
  would use it directly.

### Pronunciation (`pronunciation.ts`)
Pronunciation is resolved in this order (first hit wins):
1. **Per-player respelling.** A new optional field, `pronunciation`, on the mod DB
   player record. It is also on the `Player` domain type (additive, display and
   audio only). Examples: `"MAR-tin NEH-chahs"`, or the surname only,
   `"NEH-chahs"`.
2. **Community file** in the `PronunciationFile` format. A place in the mod folder
   is proposed; loading it through the mods bridge is not wired yet:
   ```json
   { "version": 1,
     "byExternalId": { "nhl-8478864": "KEE-rill kah-PREE-zoff" },
     "byName": { "Nečas": "NEH-chahs", "Martin Nečas": "MAR-tin NEH-chahs" } }
   ```
   Respelling format: syllables are hyphenated and the stressed syllable is in
   CAPS. The engine gets it lowercased.
3. **Shipped defaults** for common hockey traps, covering both diacritic and
   plain spellings (the imported DB writes "Necas" and "Pastrnak"). A
   whole-name table covers two-word surnames ("Oliver Ekman Larsson").
4. **Nationality letter rules:**
   - Czech/Slovak háčeks, `j`→y, `c`→ts
   - Scandinavian ö/ø/å/ä, `sj`
   - Finnish `j`, doubled vowels, ä/ö
   - Russian `-skiy`/`-iy` endings, `kh`
   - German w/ei/ie/umlauts
   - anything else: only the safe diacritic subset

### Engine-agnostic TTS
`clipManifest.ts` defines the engine interface:
```ts
interface TtsEngine { id: string; render({ text, voiceId, rate, style }): Promise<{ pcm, sampleRate }> }
```
- Kokoro is the baseline implementation: `KokoroWorkerTts` at runtime, and the
  same call in the Node build script.
- Because stems and names go through the same engine, voice and style, a name
  always sounds like the booth that says it.
- The manifest records the voices it was rendered with. The runtime warns when
  `booth.config.json` no longer matches, meaning the stems are stale.

**Plugging in a local cloning engine** (Chatterbox- or Orpheus-class). Nothing is
installed; this awaits the owner's listening test. It would need:
- **A reference sample per seat.** Set `speakers.<seat>.referenceSample` in the
  config: 10–30 s of clean, dry read at broadcast energy, one per style if the
  engine clones prosody from the reference.
- **Style control.** Map `neutral`, `excited` and `rising` to the engine's
  emotion/exaggeration parameter (Chatterbox) or tags (Orpheus), in place of the
  punctuation trick.
- **Render speed.** Stems are offline, so any speed is acceptable there. Name
  clips render during the pregame for about 40 players × up to 7 variants.
  - At ≥ 1× realtime that is about 1–2 minutes of background work, and the
    starters (priority 0) are done in about 20 s.
  - Anything slower just means more lines play bare early in the first game;
    later games hit the disk cache.
  - It must run in a worker or child process, never on the renderer thread.
- **The same `TtsEngine.render` signature**, returning mono PCM. Re-run
  `render-commentary.mjs` after switching, so the stems and names match.

### Rendered proof of concept
`render-commentary.mjs` on this machine (Node, onnxruntime-node CPU, fp32):
- The model loaded in about 60–75 s on first run. It is cached in `.cache/kokoro`,
  which is gitignored.
- Synthesis ran at **2.45× realtime** on a quiet machine, and 0.95× on a second run with other work competing for the CPU. That is fast enough to render
  tonight's names in the background well before puck drop. The in-browser worker
  is slower (the measured 0.6×), which is why names are queued by priority and
  cached to disk.

Output locations:
- **Stems:** `src/renderer/public/commentary/clips/*.wav`, 96 clips.
- **Name samples**, with real names from `mods/nhl-ehm/database.json` (read-only,
  not copied): `src/renderer/public/commentary/samples/`
  - `<name>.surname.neutral.wav` and `<name>.surname.excited.wav`: both intonations
  - `<name>.full.neutral.wav`: the introduction form
  - `samples/index.json`: which player each file is (gitignored, since it contains real names)
  - `<name>.demo.goal.wav` ("Kaprizov! … shoots, and scores!") and
    `<name>.demo.save.wav` ("Big save, … Kaprizov!"): stitched exactly as the
    scheduler plays them

## 5. 3D hand-off (how `src/render3d` consumes this)
The 3D renderer lives on another branch. It has the calm broadcast camera, the
critically-damped springs and the `AthleteRig` skeleton. Nothing in
`src/render3d` was edited here. The contract it implements is optional:

```ts
interface BroadcastShotConsumer {
  requestShot(cue: ShotCue): boolean      // false = can't frame it; host keeps broadcast cam
  playMoment?(cue: MomentCue): boolean    // skeleton ceremonies
}
interface BroadcastProjector {
  projectPlayer(playerId: string): { x: number; y: number } | null   // CSS px in host
}
```

- MatchViewer duck-types the live renderer for these interfaces
  (`shotConsumerOf` / `projectorOf`) and routes shot and moment cues when they
  are present. The 2D view ignores shots and implements the projector.
- **`SHOT_FRAMING`** (in `types.ts`) maps every `ShotKind` to:
  - an existing `CameraPreset`: `broadcast`, `overhead`, `endzone` or `follow`
  - or a `custom` framing: subject, fov hint, and motion `hold` / `push` / `pan`
- The shots follow the owner's steady-camera rule:
  - Framings are slow push-ins and pans only, with no whips and no shake.
    Impact is sold by the graphics.
  - `broadcast` always means "back to the main game camera".
  - A goal replay should reuse the renderer's fixed-spot push-in, which exists
    for exactly this.
- **`MOMENT_CHOREOGRAPHY`** describes each ceremony with pose drivers the rig
  already has. It needs no new bones; everything writes bone-local rotations on
  `BONE_NAMES`.
  - Rookie lap: a closed glide path in rink space, a solo skater, a wave pose.
  - Ovation: a stick raise, teammates tapping sticks, the crowd shader
    "standing".
  - Tribute: the video board shows "tribute", plus a helmet-off/wave.
  - Banner: both teams stand at the blue lines, and the video board shows the
    banner.
- `holdMs` on each cue says how long the renderer should hold the shot before
  returning to broadcast. The host never sends overlapping shots faster than it
  can frame them.

## 6. Verification and gates
- **Tests:**
  - `broadcastStorylines.test.ts`: earned-only, evidence rules, priority,
    determinism.
  - `director.test.ts`: determinism; no ceremonies without storylines; the rookie
    lap; the milestone ovation only on the crossing goal; tribute timing; goal
    calls at the goal with zero delay; no-repeat; tags and lower third; the
    presentation levels; PP windows; the 3D tables.
  - `audioScheduler.test.ts`: zero-latency start, stitching order, bare fallback,
    silence on missing audio, barge-in, stale drop, ducking.
  - `commentaryLibrary.test.ts`: slot rules, TTS-safe stems, moment coverage,
    fixed voices, pronunciation.
  - `broadcastContext.test.ts`: a real career builds a pre-sim context.
- **Type check:** `npx vitest run src/render2d src/renderer` is green. tsc errors
  are web 202 and node 167, both at the gate.

## 7. What's left
- **Owner listening test** for the booth voices before commentary defaults to on.
  Then consider a cloning engine (see §4).
- **Encode stems to Opus** once an encoder is approved, bringing about 10 MB of
  WAV down to about 1 MB. Or bundle the WAVs through the packager's
  `extraResources`, since they are not in git.
- **Load `pronunciations.json` from the mod folder** through the mods bridge. The
  format and resolver are done.
- **3D:**
  - implement `requestShot` / `playMoment` / `projectPlayer` on
    `Rink3dRenderer`, using the framing and choreography tables
  - the rookie lap and ovation poses need the skeleton follow-up
- **More storylines** from existing data:
  - the first game with a new club after a trade
  - the first game as captain (needs captaincy history)
  - a shutout watch
  - a playoff series clincher ("one win from the final")
- **In-game graphics not yet built:** a shot-count or "shots this period" strip,
  and an intermission stat panel with three stars. The `PeriodSummary` is the
  seed for both.
- **A settings-screen entry** for Presentation and Commentary. Today they live
  on the match screen, persisted in localStorage.
