# Design North Star — the excellence bar

This is the standard every UI change chases, human or agent. We are not "cleaning up
what's there." We are building **top-of-the-line, premium game UI** that makes a
Steam player think *"this looks expensive"* in the first ten seconds.

## The bar (reference level)

Football Manager's information density + Out of the Park's data richness, rendered
with the motion, materiality, and taste of the best modern software and sports
broadcast graphics:

- **Apps:** Linear, Arc, Vercel/Raycast dashboards — dark, premium, fast, tactile.
- **Sports/broadcast:** EA/2K front-ends, NHL/TNT broadcast lower-thirds and stat
  bugs — energy on the *moments* (goals, wins, the Cup, the deadline).

If a screen looks like a bootstrap admin panel or a spreadsheet, it fails the bar.

## The pillars

1. **A real design system, not one-off styles.** Design tokens (a full color scale,
   spacing scale, radius scale, elevation/shadow scale, a type scale) and a small set
   of composable primitives — `Card`, `Button`, `Stat`, `Badge`, `Table`, `Tabs`,
   `Meter`, `Sparkline`. Every screen is built from these. Consistency is the floor of
   premium.
2. **True iconography — zero emoji in the chrome.** A proper SVG icon set
   (`lucide-react`). Emojis are not a design system. Crisp, consistent, sized on a grid,
   currentColor-tinted.
3. **Purposeful motion.** `framer-motion`. Fast (150–250ms), spring-based where things
   should feel physical. Page/tab transitions, list stagger on load, number tick-ups for
   changing stats, hover/press feedback, and *punchy* treatment for the big moments
   (goal, win, Cup lift, deadline buzzer). Never gratuitous. Always respects
   `prefers-reduced-motion`.
4. **First-class data visualization.** Radars, shot maps, xG scatters, trend lines,
   percentile bars — crisp, legible, animated-in, theme-aware. Not default-library ugly.
   (See `docs/` DataViz conventions; reuse the existing viz where present, elevate it.)
5. **Depth & materiality.** Layered elevation, subtle gradients, tasteful glass/blur on
   overlays, premium typography (Inter, already shipped), generous-but-dense spacing.
   Team-color theming used with restraint (accent, not paint-by-numbers).
6. **Micro-interactions & feedback everywhere.** Real hover/focus/active/disabled states,
   loading **skeletons** (not spinners), empty states with character, toasts,
   smooth state transitions. Nothing ever just "pops" into place.
7. **Broadcast energy on the moments.** A goal, a series win, hoisting the Cup, the
   trade deadline clock — these should feel like a broadcast, not a table cell updating.

## Non-negotiable rules

- **Theme-aware:** flawless in both light and dark.
- **60fps:** animations composited (transform/opacity), never layout-thrashing.
- **Accessible:** visible focus rings, WCAG-AA contrast, full `prefers-reduced-motion`
  fallback, keyboard-navigable.
- **Systemic:** new visuals come from tokens/primitives; no rogue hex codes or magic px.
- **Performant data:** big tables virtualize; heavy viz memoizes.

## Anti-goals

Emoji-as-iconography · default-library chrome · inconsistent one-off card styles ·
janky or decorative-only animation · light-mode-only or dark-mode-only screens ·
walls of undifferentiated text/numbers with no hierarchy.

## Approved dependencies (pure-JS only — supply-chain rules apply)

Per our npm wariness, additions must be **pure JS (no native postinstall)**, hugely
adopted, pinned to an **exact** version, installed with `--ignore-scripts`, and
documented here. Approved:

- **`framer-motion`** (a.k.a. `motion`) — animation/transitions. Pure JS.
- **`lucide-react`** — SVG icon set. Pure JS.

Anything beyond these two needs a human OK. Prefer inline SVG + CSS/Web Animations
over a new dependency whenever it's close.

## Process (how to actually get there)

1. **Foundation first** — establish the tokens + primitives + the motion layer + the
   icon system. This raises *everything* at once and makes later screens fast.
2. **Elevate flagship screens** in order of impact: Dashboard → the match / big moments
   → Squad & Player Profile → Trades/Deadline → Scouting → Standings/Stats.
3. **Each change verifies** (renderer typecheck + production build) and is committed
   small. Consistency with the system beats clever one-offs.

Excellence here is iterative and taste-driven — this doc is the standing target;
the human's eye sets the final calibration. But nothing ships that reads as "admin panel."
