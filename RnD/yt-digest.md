# FM YouTube Research Digest

**Date:** 2026-07-02
**Sources:** 11 auto-transcribed FM24/FM26 YouTube videos in `RnD/Transcripts fromYoutube Vids/`:
- FOOTBALL MANAGER FOR BEGINNERS! (FM24 guide/tutorial)
- Football Manager: The ULTIMATE Beginner's Guide – Start Your Save Like a PRO
- CREATE CUSTOM VIEWS THAT'LL CHANGE YOUR FM24 FOREVER
- QUICK TIPS TO MAKE FM24 LOOK BETTER & PLAY FASTER
- Make Your Football Manager Look INSANELY Good in 2025!
- THE #1 SKIN EVERY FOOTBALL MANAGER 2024 PLAYER NEEDS! (WTCS Gold install guide)
- The MOST Powerful FM24 Skin That Helped Me WIn Everything (Tato skin)
- The Most GAMECHANGING FM24 Skin Is UNREAL! (Mustermann Iconic)
- The 7 ULTIMATE SKINS For FM24 (Tato, Andromeda, Just, OPZ Elite, Mustermann, WTCS, SAS 25)
- Mods You Need For Football Manager (top-10 mod ranking)
- They Fixed The UI (FM26 skin scene / anti-modding backlash)

---

## 1. Onboarding & beginner flow

What every beginner guide walks new players through, in order:

- **Preferences first, before the save**: text zoom (85–125%), colorblind options, units, autosave frequency, attribute-color thresholds. Guides treat "make the game readable for YOU" as step zero.
- **Save setup as a ritual**: pick club → choose world mode (real transfers pre-arranged vs "rewrite history") → choose which leagues/database size to load (explicit perf tradeoff, shown as a live player-count number) → advanced toggles (attribute masking on/off, disable first transfer window, no in-game editor as a "no cheating" badge of honor).
- **Manager avatar creation** (face, attire, points-buy managerial style with tooltips explaining what each stat affects) is a beloved identity moment — players know "determination = board says yes more often."
- **The hiring sequence**: boardroom welcome screen → club fact sheet (budget, rivals, history, media prediction) → assistant's best XI → **board objectives with importance levels** (required vs desired; negotiable, and accepting harder targets earns bigger budget) → supporter culture/club vision (5-year plan) → then a checklist of optional first actions: schedule intro press conference, arrange intra-squad friendly, set staff-meeting frequency.
- **Induction system**: each subsystem (scouting, transfers, training, dynamics, medical, set pieces) offers a skippable guided induction that lands as inbox items over the first week — spread out, not a wall of tutorials. Every one ends with "or delegate this to staff" via a central Responsibilities screen.
- **Delegation is the escape valve**: guides consistently tell beginners to delegate training, set pieces, scouting assignments, and youth loans until they care; the experienced player claws them back later. Staff-meeting frequency is user-tunable (weekly → monthly → never).
- **Universal advice**: "read the description" — every role/instruction/screen has hover text; and "winning covers everything" (morale/promises forgive a lot if results come).

**For our game:**
- Build a first-day scripted sequence: owner welcome → franchise fact sheet → AGM's projected lines → **negotiable board objectives with required/desired tiers** (accepting harder goals = bigger budget) → fan-culture expectations. We have pieces (expectations, inbox); string them into a ceremony.
- Ship an **induction inbox drip**: one skippable tutorial message per subsystem (scouting, lines, trades, farm, draft) over the first sim week, each ending with a "delegate to staff" button.
- A **Responsibilities screen** (delegate lineups, waivers, junior callups, scouting assignments to AGM/coaches) is the single best FM onboarding device — it lets beginners play shallow and veterans play deep on the same build.
- GM avatar + points-buy background (former player vs analytics exec) with tooltips on what each choice mechanically does.
- League/database-size choice at save creation with a live "players loaded" counter (maps to our multi-league world loader).

## 2. Custom views & information density

The power-user backbone of FM — how list screens work:

- Any list screen (squad, fixtures, search, shortlist, tactics) allows **right-click column header → insert column** from a categorized catalog of hundreds of fields; views auto-fork into "Copy of X" custom views the game remembers.
- A **"Customize current view" bulk editor**: alphabetical/filterable field list, add/remove many at once, reorder (move up/down = left/right), and per-column or all-column auto-size. Drag column edges to resize; horizontal scroll appears when overflowing.
- **Views are named, saved, exportable/importable as files** (.fmf in a `views/` folder) — creators share view packs (Ultimate Squad view, National-team view, Training view, Squad-profile/playing-time view, Match-stats analytics view). Views are screen-scoped (a squad view can't load on fixtures).
- A **Manage Views** dialog to rename/delete accumulated views.
- Pain points to avoid: auto-size is buggy/finicky; some screens inexplicably not customizable ("football manager please fix"); finding a field by name is trial-and-error because fields have multiple names.
- Mouse-over any column header gives a definition tooltip — essential when views have 30+ stat columns.
- QoL companion features: bookmarks/pinned pages, filter bars on squad screens (position, hide loaned/unavailable, homegrown-only).

**For our game:**
- Our Squad column-view system should support: right-click header → insert column, a bulk view editor with search + reorder, per-screen named saved views, and auto-size that actually works (their #1 gripe — we can win here).
- **Export/import views as JSON files** — cheap for us, and it seeds the community/modding culture we want pre-Steam.
- Ship curated preset views per job ("Contract planning", "Deadline day", "Prospect pipeline", "Line chemistry") so beginners get the benefit without building.
- Header tooltips defining every stat column (esp. our xG/analytics columns in Data Hub views).
- Extend the same view system to Schedule, Stats, draft board, and FA lists — FM's is universal, and users expect that.

## 3. Skins & UI ideals

Named skins: **WTCS Gold** ("gold standard", most-downloaded), **Tato** (clean/minimal), **Mustermann Iconic** (attributeless/Moneyball), **Just**, **Andromeda** (retro), **OPZ Elite**, **SAS 25**, plus FM26's Material skin. What they change and why players love them:

- **Better use of space** is the #1 stated reason. Vanilla FM = "a lot of blank space, small text, blockiness." The most popular skin (WTCS) "doesn't overdo anything, just makes the original skin better with cleaner use of space."
- **Fewer clicks: everything on the player page.** WTCS puts pros/cons, training setup, transfer status, form, and history on one profile screen with drop-down swappable panels. Users build muscle memory: "I know exactly where to look for each piece of information."
- **Dashboard home screens**: next-opponent report, last match, squad depth, team strengths/weaknesses, comparison vs league, finances, StatsBomb-style data report — all as tabs on the landing page so you rarely visit sidebar screens (Tato, Just, SAS).
- **The touchline tablet**: during matches, a clean overlay tablet with live stats, xG story, average formations, action zones, heat maps, passing networks — analytics at the bench without leaving the match. Repeatedly called the killer feature (Tato, Mustermann).
- **Attributeless/Moneyball skins (Mustermann)**: hide raw attribute numbers, replace with percentile "pizza charts" vs positional peers in top leagues, **player archetypes derived from stats** ("quarterback", "fox in the box", "wide threat") — praised as *more realistic* ("in real life you'd know he's a good passer, not that he's a 15"). Manager archetypes that evolve too. Scrolling profile that reveals info piece-by-piece instead of cramming one screen.
- **Immersion dressing**: club-info page styled like the club's website/shop, news styled like a real news site with real outlet branding, Twitter-style social feed, stadium/city photos, player faces on the tactics board, kit close-ups, Club Vision as an animated timeline rather than a table.
- **Customization affordances users expect**: attribute color thresholds and colors fully configurable; light + dark variants; pre-made color-scheme files; sidebar collapsible to icons-only; instant-result button; panel drop-downs everywhere; pop-out role detail (click a position → side panel with instructions + highlighted key attributes, no navigation).
- Meta-lesson from FM26: SI shipped an unmoddable UI and it was review-bombed; the community celebrated "hacking" skinning back in. **Moddability of the UI itself is a loyalty feature.**

**For our game:**
- Adopt the dashboard-home pattern: our Dashboard should absorb next-opponent scouting, last game, squad depth chart, playoff odds, and finances as tabs — the sidebar is for depth, the home screen for daily flow.
- Build the **bench tablet** into Match Center: live shot map, xG race chart, zone/heat data, line matchup view — this is the most-loved single UI object across all these videos.
- **Attributeless mode as a first-class option**: we already have fog-of-war ratings; add percentile polygon/pizza charts vs positional peers and stat-derived archetypes ("net-front presence", "puck-moving D", "quarterback PP1") on the Player Profile. Fits our scout-report wave and style-fit work.
- Player Profile = one screen, swappable panels (user-configurable drop-downs per panel slot), scroll for depth. Persist the user's arrangement.
- Configurable rating color thresholds/colors + colorblind palettes in Settings — trivially cheap, disproportionately demanded.
- Sidebar icons-only toggle; UI zoom (85–125%); light/dark accent theme files.
- Long-term: make our screens **data-driven/skinnable** (panel layout files) — the FM26 fiasco shows locking the UI actively costs goodwill on Steam.

## 4. Performance & QoL tips

- **Load less world**: only load leagues you'll interact with; add leagues mid-save if plans change; database size choice with visible player counts. (Our multi-league loader should allow adding a league to an existing save.)
- **Timeout continue**: if idle N seconds with nothing requiring input, auto-press Continue — but hard-pause on anything decision-critical (lineup submit, trade offer, registration). Also "longer but fewer processing breaks" option. Built for players half-watching a stream.
- **Rolling autosave**: autosave after every match, keep a 3-file rolling set as corruption insurance; noted gap — no matches in offseason means no autosaves, so time-based fallback needed. (We already ship throttled autosave; add rolling multi-slot.)
- Skin/graphics caching + explicit "reload skin"/"clear cache" as the universal fix-it; instant-result button for skipping matches.
- Space bar advances inbox; right-click Continue variants — keyboard-first message triage.
- Modding hygiene the community learned: user-data folders (`views/`, `graphics/faces|kits|logos`, `skins/`) with **config files mapping unique entity IDs → image files**; verify-integrity/restore paths; mods surviving updates.

**For our game:**
- Add **auto-continue after N idle seconds** (off by default), pausing on user-gated days (draft day, deadline day — already gated) and lineup submission. Pairs with our Continue loop.
- Rolling 3-slot autosave + calendar-based autosave so offseason isn't a loss window.
- Keyboard-first inbox: space = next item, enter = default action (we have Ctrl+K; extend to inbox triage).
- Our facepack/logo mod support should copy FM's exact convention: graphics folders + ID→file config maps — the community already knows this format (relevant to EHM facepack import plan).

## 5. Modding as content ecosystem (recurring theme)

The mod tier list reveals what a management-game community builds when allowed to:

- **Baseline mods "everybody needs"**: real-name fixes, face packs, logo packs, kit packs — identity/licensing gap-fillers. Exactly our fictional-DB + community-real-rosters legal model; make these folder-drop trivial.
- **NewGen face pack**: 100k AI faces assigned **ethnically accurately** to generated players — creators call it "the coolest thing I've been part of." Generated-player identity matters enormously.
- **Realism packs**: community mods that tighten AI transfer logic, close exploit loopholes, add missing competitions, adjust injuries — players *ask* for more difficulty and realism (validates our LW3 trade-realism direction).
- **Potential-ability range mod**: replacing fixed hidden potential with ranges for variance between saves — players dislike deterministic development; keep our dev model probabilistic per-save.
- **Retro database** (2013 rosters + 14,500 real-timeline regens appearing on schedule) and **world-restructure mods** (World Super League; 200-league megapacks) — alternate-history and world-scale fantasies.
- **Immersion media pack**: 2,400 real media outlets populating press conferences and social feeds. Note the counterpoint from beginner guides: vanilla press conferences are "repetitive, don't mean anything" — immersion features die without variety. (Directly relevant to our meetings-as-RP-spine vision: variety + consequence or skip/delegate.)
- Views, tactics, set pieces, skins are all **shared as files by creators to their audiences** — creator-distributable artifacts are free marketing.

**For our game:**
- Ship folder-drop mod support with config-ID conventions for faces/logos from v1 — it's the community's muscle memory and our legal roster model depends on it.
- Ethnically/regionally plausible generated-prospect identity (names, faces later) is worth real investment.
- Keep development/potential as ranges rolled per save; surface it only through scout confidence.
- Press conferences/meetings must have mechanical consequence and high template variety, plus delegate/skip — or they become the thing every guide tells players to turn off.
- Make tactics, views, and (eventually) draft classes exportable files so hockey creators can share them.

---

## TLDR — top cross-cutting insights

1. **Delegation is the difficulty slider**: FM onboards beginners by letting them hand every subsystem to staff via one Responsibilities screen and claw it back later — the single most transferable UX ritual.
2. **The most popular skin is the most conservative**: players reward space efficiency, fewer clicks, and everything-on-one-screen dashboards over visual flash; and locking the UI against modding (FM26) triggers open revolt.
3. **Attributeless/percentile presentation (Mustermann) is beloved as *more realistic*** — pizza charts vs positional peers + stat-derived archetypes map perfectly onto our fog-of-war ratings and scout-report system.
4. **Saved/importable custom column views** are the power-user backbone; ours should match FM's (insert column, bulk editor, per-screen named views, JSON export) and fix their notorious auto-size bugs.
5. **QoL trinity**: idle auto-continue that hard-pauses on decisions, rolling autosaves, and a bench "tablet" of live match analytics — the three features every tips video pushes.
