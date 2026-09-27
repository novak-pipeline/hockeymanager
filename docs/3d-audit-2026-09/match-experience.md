# Match Experience Audit: The Show vs Football Manager match day

*Read-only audit, 2026-09-27, branch `improve-loop` @ `dc4f53a`. No repo files were edited.*

## How it was tested

- Fresh `electron-vite build` into a scratch `out/`, launched with Playwright against the real Electron binary. The window was parked off-screen and used a throwaway `--user-data-dir`.
- A **copy** of the owner's autosave (Pittsburgh, 1 Oct 2026, imported NHL DB with facepacks) was loaded from that throwaway dir. The copy was deleted afterwards. The owner's saves folder was only read.
- Two real match nights were played:
  - **@TBL on Oct 2.** Watched in 3D (Full). Then toggled to 2D, which restarted the game, and ran Key Moments to the final whistle (7-3). Then Back to hub and the inbox match report.
  - **@BOS on Oct 4.** Opened in Sim view (gamecast), then Watch on the ice. Ran 3D Full at 2x. Seeked to the first goal and to the end of the 1st period. Tried every camera, Presentation Full/Compact/Off, and the Commentary toggle.
- Screenshots are in `shots/`, referenced as `[shot: …]`.
- **Performance caveat.** This session's Electron fell back to software GL ("Microsoft Basic Render Driver"). 2D and 3D both measured about 9–10 fps, so these frame times are **not** a verdict on the owner's GPU. The repo's own numbers (`docs/graphics/RENDER3D-UPGRADE.md`: 1.2 ms/frame) stand. One real performance risk still follows from it; see F-29.

## What FM does (the bar)

- **Highlight levels.** FM offers commentary-only, key, extended, comprehensive and full match, with a separate match-speed slider and a replay on/off toggle ([SI manual, FM24](https://community.sports-interactive.com/sigames-manual/football-manager-2024-touch-and-console/playing-a-match-r4990/)). FM26 adds a **Dynamic Highlight Mode** that "adapts in real-time to match context and drama" ([FM Scout FM26 features](https://www.fmscout.com/a-football-manager-2026-new-features.html)).
- **Condensed-highlight gaps are useful.** During the dead spells between highlights FM shows "key information highlighting how the match is going, and advice arrives from your coaching staff" (SI manual). FM26's Match Overview adds a 2D pitch view, xG/xA assistant advice and expandable data cards (FM Scout).
- **Live management.** Tactical changes, substitutions and touchline shouts are all available mid-match. Shouts were removed at the FM26 launch and restored in 26.1.0 ([TheSixthAxis](https://www.thesixthaxis.com/2025/12/09/football-manager-26-update-26-1-0-brings-back-shouts/)). The assistant manager gives in-match feedback ([Passion4FM](https://www.passion4fm.com/football-manager-best-assistant-managers/)).
- **Team talks.** There is a pre-match talk, a half-time talk (the natural decision point) and a post-match talk. After the game come the post-match analysis (xG, shot maps, player ratings) and the press conference.
- **Broadcast presentation.** FM26 has a rebuilt camera with "multiple camera points and all-new cinematic angles", and replays that pick "the most appropriate and bespoke replay angle" for each goal type (FM Scout).
- **Real hockey TV.** The scorebug shows score, clock, period, **SOG** and a PP/penalty timer. The clock **stops at every whistle**. Goals get a multi-angle replay (usually 2–3 angles, slow-mo, from the net cam). Each intermission has a report: shots and hits by period, the scoring summary, and a player interview or analyst panel. The end of the game shows FINAL plus three stars.

## Findings

Severity: **B** = blocker, **Ma** = major, **Mi** = minor, **P** = polish. Fix size: S / M / L. The Plan column cites a MATCH-ENGINE-PLAN phase or says **MISSING**.

### A. Can the GM manage the game? (the core FM gap)

| # | Finding | FM / broadcast | What we do | Sev | Root cause | Fix | Plan |
|---|---|---|---|---|---|---|---|
| F-1 | **The game is decided before you watch it.** "Watch on the ice" returned a fully simulated game in 2.2 s. Everything after is playback. Leave game, Sim view and Watch all show the same fixed result. | FM sims as you watch, so decisions change the outcome. | Pre-sim, then playback [shot: 04-hero] | **B** | `watchRegularDay` → `fullSimGame` runs to completion (audit-onice-dev §3). No segment boundary exists. | L | M4 (live watched games) |
| F-2 | **No in-game levers at all.** The only controls are speed, camera, 2D/3D, presentation, commentary and SFX. There are no shouts, line juggling, timeout, goalie pull or tactic change. | FM: shouts, subs, tactics, assistant "Ask for". | [shot: 06-play3d-a] | **B** | Follows from F-1. `MatchViewer.tsx` has no input path to the sim. | L (after F-1) | M4 |
| F-3 | **No intermission.** At 0:00 of the 1st the clock rolls straight into the 2nd (20:00 → 19:59). An "End of 1st period" card plays for ~3 s over live 2nd-period play. There is no break, no report, no decision. | FM half-time team talk. The TV intermission report. | [shot: 22-period-end-0] | **Ma** | There is no intermission phase in `MatchViewer`, and the `periodSummary` overlay is time-keyed at the period change. | M (presentation), L (with decisions) | M4 names "intermission decisions" but **the intermission presentation** (stats panel, assistant read, a pause point) is **MISSING** |
| F-4 | **The pregame has no decisions.** It offers no team talk and no starting-goalie pick; the starter is shown as fact. "Keys to the game" was "No tape yet… keep the first period simple" in both games, and one read "1 games played". | FM pre-match team talk + opposition instructions. | [shot: 03-after-continue, 16-state] | **Ma** | `MatchNightFrames` / `matchNight.ts` keys with no lever (audit-onice-dev §3.2). "1 games" is a pluralisation bug. | S–M | **MISSING** from MATCH-ENGINE-PLAN. It is in the depth-audit spec ("pregame decisions the postgame cites") but not in any M-phase. |
| F-5 | **No postgame in the match flow.** At the final the view freezes on 0:01. There is no FINAL graphic, no three stars and no analysis; "Back to hub" drops you on the dashboard. The only postgame is an inbox "Match Report" paragraph. | FM post-match analysis, player ratings, post-match talk, presser. | [shot: 13-key-end2, 14-after-hub, 15-match-report] | **Ma** | `MatchViewer` ends at `view.ended`. The P6 postgame receipt is not shown after a watched game. | M | M6 (analysis). The **in-flow postgame screen** is **MISSING**. |
| F-6 | **No match stats, ratings, shot map or xG on the watch screen.** None of SOG, hits, faceoffs, box score, player ratings or xG race exists in the on-ice view. `SimView` has team stats and a box score, but it is a separate screen, and switching to it restarts the game (F-12). | FM widgets: stats, ratings, xG, heat maps, visible during play. | [shot: 06-play3d-a vs 17-simview-b] | **Ma** | `MatchViewer` only has a text ticker. `liveBoxScore` exists (SimView) but is not composed into the ice view. | M | M6 (post-match). The **live in-match panel** is **MISSING**. |
| F-7 | **No player ratings anywhere during or after the match.** | FM's live 1–10 ratings are a core read. | — | Ma | Not built. | M | M6 ("ratings that explain themselves", postgame only). Live ratings **MISSING**. |
| F-8 | **Dead air carries no information.** In Key and Extended, the gaps between highlights are a spinning FAST-FORWARDING clock with a hard-coded "to the next goal…" (wrong in Extended). The ticker even stops updating during the skip. | FM uses the gaps for stats and assistant advice. | [shot: 11-2d-key-sheet, 13-key-*] | Ma | `ffOverlayStyle` block in `MatchViewer.tsx`; `visibleLines` is only backfilled on cut-in. | S–M | **MISSING** |

### B. Watch modes, pacing, replays

| # | Finding | FM / broadcast | What we do | Sev | Root cause | Fix | Plan |
|---|---|---|---|---|---|---|---|
| F-9 | **"Key Moments ~60 sec" is not 60 s.** The full broadcast open (arena title, 2–3 rookie laps, debut cards, both starting lineups, goalie tape) plays first: about 25–30 s before the first puck. After that, every goal is **auto-replayed** (4.5 s celebration + 8 s replay). On the 7-3 game the reel ran well past 4 minutes. | FM key highlights are short, and replays are a toggle. | [shot: 11-2d-key-sheet, 12-2d-keyplay-*] | Ma | The pregame plan does not depend on mode (`directBroadcast(..., {presentation})`). The auto replay is a `setTimeout` in the goal handler (`MatchViewer.tsx` ~l.565) that ignores mode. | S | **MISSING** |
| F-10 | **Only 3 of FM's 5 levels, and none adapts.** There is no commentary-only mode at the ice (Sim view is a separate screen) and no "comprehensive". Key = goals only; big saves, fights and PPs don't qualify. There is no dynamic highlight mode. | FM key/extended/comprehensive/full; FM26 dynamic. | [shot: 04-hero] | Mi | `highlights.ts` `selectMode` (key = goals only). | S–M | M6 mentions a highlight reel that "picks the genuinely best moments". Mode design is **MISSING**. |
| F-11 | **The replay rewinds the score.** During a goal replay the scorebug **and** the top scoreboard drop back to the pre-goal score (PIT 2-1 → 1-1 during Kindel's replay, and every goal after). No broadcast does this. | The TV scorebug holds the live score and shows "REPLAY". | [shot: 12-2d-keyplay-17 vs -21] | **Ma** (bug) | The replay is a `seekFraction` of the live renderer. `Scoreboard` and `Scorebug` read `view` from the renderer. | S (freeze the bug state during replay) | **MISSING** |
| F-12 | **Switching views restarts the game.** 3D↔2D resets to "DROP THE PUCK" at 20:00 and loses all progress. Sim view → Watch on the ice also restarts from 20:00, after you have already seen the score. | FM keeps one match state; the view is a camera choice. | [shot: 10-2d-full, 18-sim-to-ice] | **Ma** (bug) | `handleToggleRenderer` does `setPhase('hero')` and `setView(null)` (`MatchViewer.tsx:766`). SimView → MatchViewer passes no clock. | S | **MISSING** |
| F-13 | **Replays are the same camera at 0.6× from 8 s back, with no angle choice.** 3D doesn't implement `requestShot`, `playMoment` or `projectPlayer` (grep finds none in `src/render3d`). So there is no goal-replay framing, no save replay, no bench or crowd shots, no rookie-lap/ovation ceremonies (the caption plays over players standing at centre ice) and no on-ice goal tag in 3D. | FM26 bespoke replay angle per goal type; TV multi-angle slo-mo. | [shot: 05-pregame-2, 21-3d-goal-sheet] | **Ma** | BROADCAST-PACKAGE §5/§7 "3D: implement requestShot / playMoment / projectPlayer" is still open. | M | M5 (broadcast camera cuts and 3D replays) |
| F-14 | **"Watch replay" / "Skip replay" buttons.** This is a "click here for event" button, which the owner's rule forbids. It also stacks with the auto replay. | The replay just happens and can be skipped with a key. | [shot: 12-2d-keyplay-17] | Mi | Goal banner block in `MatchViewer.tsx` ~l.966. | S | MISSING |
| F-15 | **The "Continue — play the game" CTA is the primary button, and Watch is secondary.** For an FM-style game the watched match should be the hero on a notable night. This is a judgement call and fits the owner's "Continue always advances" law. | — | [shot: 03-after-continue] | P | `MatchNightFrames.tsx` | S | — |

### C. Readability: can you follow the puck?

| # | Finding | FM / broadcast | What we do | Sev | Root cause | Fix | Plan |
|---|---|---|---|---|---|---|---|
| F-16 | **3D broadcast camera is too far away and badly framed.** Skaters are ~50–60 px tall on a 1391 px frame, and 30–45 % of the frame is crowd. The heavy EMA means the action often sits at a frame edge while the camera shows empty centre ice. The camera also orbits noticeably between shots. | EA/TV: the puck carrier sits in the middle third with the zone filled. FM's camera keeps the ball central. | [shot: 06-play3d-b, 08-burst-sheet, 23-pres-off] | **Ma** | `CAMERA_TUNING.broadcast` (tau 0.9/1.2 s, 6×5 ft dead-band, springHL 0.6) plus a distance/FOV that frames the whole zone and the stands. | S–M (tuning) | M5 (broadcast camera). Framing targets are **MISSING** from the gates. |
| F-17 | **You can't see the puck or who has it.** The puck is a tiny black dot, and the carrier "glow ring" is barely visible at broadcast distance. In most sampled frames I could not find the puck at all. | TV: the puck is readable from the camera choice. FM highlights the ball carrier. | [shot: 06-play3d-b, 23-pres-off, 09-cams-sheet overhead] | **Ma** | `puckMesh` at real scale; `puckGlowRing` is too subtle. No carrier name emphasis. | S | **MISSING** (the M0 motion gates don't cover legibility) |
| F-18 | **3D name plates are unreadable.** They are grey slabs ~7 px tall with light text; they float at the boards for players who aren't visible; in Follow cam they clip at the frame edge. | FM: short name + number, sized for the view, carrier emphasised. | [shot: 07-zoom-tags, 09-cams-sheet follow] | Ma | `makeLabelSprite` scale 4.4×1.1 ft in world space (`rink3dRenderer.ts:712`); no screen-space sizing; labels not culled with occlusion. | S | MISSING |
| F-19 | **Overhead 3D is worse than 2D.** It shows tiny un-numbered figures with no labels and no visible puck, so the "tactical cam" teaches nothing. Endzone has an artifact: a blue rectangle and brackets at the top of the frame, likely an arena object clipping the near plane. Follow shows a grey square artifact at the right edge, and the puck carrier is often out of shot. | FM's 2D/tactical view is the analyst's view. | [shot: 09-cams-sheet] | Mi | Camera preset poses in `rink3dRenderer.ts`; label visibility is per preset. | S–M | M5 |
| F-20 | **2D rink renders at 1/DPR size.** At 150 % Windows scaling the rink fills ~62 % of the viewport, left-aligned, with dead space right and below. Lower thirds land below the rink in empty space. **The owner is on 150 % scaling on this machine** (devicePixelRatio 1.5). | — | [shot: 10-2d-full, 11-2d-key-08, 13-key-end2] | **Ma** (bug) | `RinkRenderer.computeMetrics` divides `renderer.width` by `devicePixelRatio` again, though Pixi v8 `renderer.width` is already in CSS px with `autoDensity` (`src/render2d/rinkRenderer.ts:84-85`). | S | MISSING |
| F-21 | **2D labels collide.** At faceoffs, names overprint ("PcCrosby", "GoncalvesRobertson"). The on-ice goal tag overlaps the scorebug when the goal is near the top-left. | — | [shot: 11-2d-key-08, 12-2d-keyplay-17] | Mi | No label de-confliction in `rinkRenderer.ts`; the tag clamp ignores the scorebug band. | S | MISSING |
| F-22 | **The game clock runs during stoppages and celebrations.** The scorebug ticked 17:48 → 17:42 while players celebrated. Whistle at 11:27.5 and faceoff at 11:23.5: 4 s of clock burned. A period's "20:00" includes dead time. | NHL: the clock stops on every whistle. | [shot: 21-3d-goal-sheet] | **Ma** (credibility) | The engine advances `t` through celebration and faceoff staging (`fullSim.ts` celebration/`deadPuckPos` phases). | S (freeze the *display* clock in dead windows), M (engine: stoppage time off-clock, then recalibrate) | M1/M2 realism. Not listed. **MISSING** |
| F-23 | **Two scoreboards.** The app's `Scoreboard` above the viewport duplicates the broadcast scorebug inside it. | One scorebug. | [shot: 06-play3d-a] | P | `MatchViewer.tsx` top bar | S | — |
| F-24 | **No SOG on the scorebug; no penalty graphic beyond the PP strip.** The ticker/overlay just says "STOPPED" or "PENALTY", with the box over the play. | TV bug: SOG + PP timer with the player's number. | [shot: 19-3d-full-00] | Mi | BROADCAST-PACKAGE §7 "shot-count strip not built". | S | M5 (overlays). SOG itself is **MISSING**. |
| F-25 | **Stoppage chip covers the play.** "STOPPED" / "OFFSIDE" sits dead-centre over the players. | TV puts it in the bug. | [shot: 19-kits-zoom] | P | `stoppageChipStyle` | S | — |
| F-26 | **Home and away both use gold in the UI.** In PIT @ BOS both scoreboard dots and the SimView stat bars are gold, so the team-stat bars read as one colour. The 3D kits (white vs black) are fine. | Clash-aware alternates. | [shot: 17-simview-b, 18-sim-to-ice] | Mi | No colour-clash resolution in `teamInk` or SimView bars. | S | MISSING |

### D. Commentary, text and data bugs

| # | Finding | Sev | Root cause | Fix |
|---|---|---|---|---|
| F-27 | **The ticker narrates the shot's outcome before knowing it.** "Benjamin Kindel shoots — drifts wide." was immediately followed by "GOAL — Benjamin Kindel!" at the same timestamp. Low-danger lines also say "right to the goalie" or "easy work for the netminder" for shots that score or miss. | Ma | `commentary.ts` `case 'shot'` picks from `SHOT_LOW_DANGER` using `danger` only. It doesn't look ahead to the save/goal/miss that follows. | S |
| F-28 | **Clock strings are malformed:** "0:9.5", "18:56.75", "0:1.25". | Mi | `commentary.ts:56 clockStr` pads a fractional seconds value. | S |
| F-29 | **Commentary toggle ON is silent in this checkout, yet starts Kokoro.** The stems are git-ignored and absent (`src/renderer/public/commentary/` has only `manifest.json`), so every clip request 404s. Meanwhile "Booth: preparing 228 name clips…" spins up the TTS worker mid-game. That is wasted work, and on a weak machine a perf risk. | Mi | BROADCAST-PACKAGE §7 (stems not bundled). No "stems missing → disable button" check. | S |
| F-30 | **Match report facts disagree with the box.** It names Malkin (3-2) as "what turned out to be the winner" while the official GWG is Rust (the 4th goal vs 3 against). It calls a game tied at 1-1 and 2-2 "wire-to-wire". The report was dated 1 Oct for a 2 Oct game. | Mi | `matchReport.ts:105 decisiveScorer` uses "last go-ahead goal", not the NHL GWG rule; the shape copy ignores ties; date stamping. | S |
| F-31 | **Implausible volume.** The first watched game was 7-3 with TBL on **54 shots** (headline "54 shots, not enough"). | Mi–Ma | Engine calibration on the watched-game path (M0 scorecard territory). | — (M0/M2) |
| F-32 | **Assist chips are unnamed** ("1ST ASSIST" under a dot). With 2D labels on this is acceptable; in 3D the chips never appear (no projector). | P | `BroadcastOverlays` playerTag | S |
| F-33 | **Ticker ordering and score phrasing.** "TBL 1-2 PIT" uses away-first scoring from the away team's side, while the scorebug reads PIT first. | P | `commentary.ts` goal line | S |

### E. 2D vs 3D parity

| Feature | 2D | 3D |
|---|---|---|
| On-ice goal tag + assist chips | yes | **no** (no `projectPlayer`) |
| Director shot cues (goal replay framing, bench, crowd, penalty box) | ignored (by design) | **not implemented** |
| Ceremonies (rookie lap, ovation, banner) | caption only | caption only; players stand at centre ice |
| Name labels | readable but colliding | unreadable |
| Camera choice | fixed top-down | 4 presets (broadcast, overhead, endzone, follow) |
| Rink fills viewport | **no at DPR≠1 (F-20)** | yes |
| Puck legibility | good | poor |

## Top 15 (ranked by impact on "FM-quality match day")

1. **F-1/F-2: the watched game is pre-simulated, so there are no levers.** This is the keystone (M4). Build segmented simulation first. Everything FM-like (shouts, intermission decisions, a goalie pull you choose) hangs on it.
2. **F-3: no intermission.** Add an intermission phase with period stats, three stars so far, shots and hits by period, an assistant read, and later the decisions. It is also the natural FM "half-time".
3. **F-5/F-6/F-7: no in-flow postgame, no live stats panel, no ratings.** Compose `liveBoxScore` and the SimView stats into the ice view as a toggleable side panel, and end the watch on a postgame screen (three stars, box, shot map, turning point) instead of a frozen 0:01.
4. **F-16/F-17: 3D broadcast framing and puck legibility.** Tighter shot, less crowd, puck carrier centred, a visible puck/carrier treatment. Today you can't follow the play.
5. **F-11: replay rewinds the score** (bug, S).
6. **F-12: switching 2D/3D or Sim view → Ice restarts the game** (bug, S).
7. **F-20: 2D rink at 1/DPR size on the owner's 150 % display** (bug, S).
8. **F-13: 3D has no broadcast consumer** (replay angles, ceremonies, on-ice tag). BROADCAST-PACKAGE's open item.
9. **F-22: clock runs through stoppages.** Freeze the display clock now (S); move dead time off-clock in the engine later.
10. **F-9/F-14: Key Moments isn't ~60 s,** because of the full open plus forced replays. Scale the open to the mode, make replays a setting (not a button), and drop the "Watch replay" click-button.
11. **F-18: unreadable 3D name plates.** Use screen-space labels; carrier plus nearby players only.
12. **F-27: commentary says "drifts wide" before a goal.** Make it outcome-aware.
13. **F-4: pregame has no decision.** Add team talk, starting goalie and a matchup directive, and keys that only name real levers.
14. **F-8/F-10: dead air and highlight levels.** Fill the gaps with stats and assistant advice; add a "comprehensive" level and an FM26-style dynamic mode.
15. **F-24/F-23/F-28/F-30: broadcast and data polish.** SOG on the bug, one scoreboard, clock strings, GWG/date/"wire-to-wire" accuracy.

## Plan gaps (not covered by MATCH-ENGINE-PLAN M0–M7)

MATCH-ENGINE-PLAN is almost entirely **engine** work (agents, physics, hits) plus M4's live GM, M5's animation/camera and M6's postgame analysis. The **match-day product layer** is missing:

1. **The match-day flow as a screen sequence:** pregame decisions → watch → intermission ×2 → postgame. It needs an owner and an M-phase. Today M4 lists "intermission decisions" but not the intermission *screen*, and M6 is postgame-only.
2. **A live in-match information layer:** a stats panel, live ratings, shot map and xG race *during* play (FM's tablet), plus a use for the dead air in condensed modes.
3. **The highlight and pacing design:** mode-aware pregame length, replay policy (setting, not button), more levels, and a dynamic mode. None of this is in the plan.
4. **A 3D readability gate:** puck and carrier legibility, label legibility, and framing targets (subject size, % of frame on ice). The M0 gates cover motion quality only, not "can a viewer follow the puck".
5. **Viewer-state integrity bugs:** replay score, view-switch restarts, DPR sizing, clock during stoppages. These are cheap and not tracked anywhere.
6. **Pregame decisions:** team talk, starting goalie, matchup directive. They are in the depth-audit spec (`audit-onice-dev.md` §3, "True-depth spec" item 2) but absent from MATCH-ENGINE-PLAN.
7. **Commentary truthfulness:** an outcome-aware text ticker. Also a stems-missing guard so the Commentary toggle doesn't silently spin up TTS.
8. **Unifying SimView and MatchViewer.** Today they are two separate products with different controls (SimView has 1/2/4/8× speed and "Jump to the horn"; the ice view has 0.5/1/2 nudge) and no shared clock.

## Evidence index

| Topic | Screenshot(s) |
|---|---|
| Pregame frame | `03-after-continue`, `16-state` |
| Hero / modes | `04-hero` |
| Pregame open | `05-pregame-0..7` |
| 3D play | `06-play3d-a/b`, `08-burst-sheet` |
| Name tags | `07-zoom-tags` |
| Cameras | `09-cams-sheet` |
| 2D DPR bug + restart on toggle | `10-2d-full`, `11-2d-key-sheet`, `11-2d-key-08` |
| 2D goal and replay score rewind | `12-2d-keyplay-17`, `12-2d-keyplay-21` |
| End with no final | `13-key-end2` |
| Hub and match report | `14-after-hub`, `15-match-report` |
| Sim view and its restart | `17-simview-b`, `18-sim-to-ice` |
| 3D goal sequence | `21-3d-goal-sheet` |
| Period end | `22-period-end-0` |
| Presentation Off / Compact | `23-pres-off`, `23-pres-compact` |

The throwaway build and driver are in `out/` and `driver.mjs`.
