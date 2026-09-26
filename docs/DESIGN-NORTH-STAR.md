# Design North Star — The Show (Franchise Hockey Manager)

Target: **top-of-the-line, premium game UI** — the polish of Linear / Arc / Vercel
dashboards fused with EA / broadcast sports graphics. Dense but legible, deep-indigo
dark theme, violet/team-accent, information-rich, tastefully animated. Not an admin panel.

## Design foundation (shipped)

Lives in `src/renderer/index.css` (`:root` tokens + primitive classes + motion layer)
and `src/renderer/components/`.

### Tokens (CSS variables)
- **Color**: neutral surface ramp `--bg0…--bg3`, `--line`, ink `--text`/`--muted`,
  violet primary + team `--accent-rgb`, semantic `--green/amber/red/cyan/orange/pink`.
- **Spacing**: `--sp-1…--sp-8` (4→64px).
- **Radius**: `--radius-xs/sm/(base)/lg/pill`.
- **Elevation**: `--shadow-1…--shadow-4`, `--shadow-accent`, `--edge-top` (crisp top hairline).
- **Type scale**: `--fs-2xs…--fs-4xl`, line-heights `--lh-tight/snug/normal`, `--tracking-cap`.
- **Motion**: durations `--dur-1…--dur-4`, easings `--ease-out/inout/spring`.

### Primitive components (`src/renderer/components/primitives.tsx`)
`Card` (interactive / railed / pad), `CardHead`, `Icon` (SVG sizing wrapper),
`Stat` (value + label + delta), `Badge` (solid/soft/success/warn/danger/neutral),
`Meter` (animated fill), `Sparkline` (dependency-free SVG).

### Icon system (`src/renderer/components/icons.tsx`)
Semantic vocabulary over `@phosphor-icons/react` — `Icons.*` and `CategoryIcon` / `categoryColor`
for news categories. Screens never import Phosphor directly or use emoji-as-iconography.
Content icons are **duotone**, chrome (chevrons/ticks/close) **bold**, the nav rail
duotone at rest and **fill** when active. Full mapping: `docs/graphics/UI-POLISH.md`.
(Replaced lucide-react 2026-09 — the GM judged the thin outline set "worse than emojis".)

### Motion layer (`index.css`)
Keyframe utilities (`.anim-fade/rise/scale/pop`, `.stagger`), `.skeleton` shimmer,
all compositor-friendly (transform/opacity only) and fully disabled under
`@media (prefers-reduced-motion: reduce)`.

## Dependencies added (per explicit user approval)

Both pure-JS, no native postinstall, pinned to an EXACT version, installed with
`--ignore-scripts` (respecting the project's supply-chain rules).

| Package | Version | Purpose |
|---|---|---|
| `@phosphor-icons/react` | `2.1.10` | SVG icon set, 6 weights (replaced `lucide-react` 1.24.0, since removed) |
| `framer-motion` | `12.42.2` | animation/transition primitives |

Notes:
- Phosphor is imported per icon (`@phosphor-icons/react/dist/csr/<Name>`), never via
  the barrel, which would pull ~1,500 components into the dev server and vitest graph.
- The install raced against a timed-out first attempt (Windows `EPERM`/`ENOTEMPTY` during
  npm cleanup); packages extracted fully but `package.json` wasn't written, so the two
  deps were added to `package.json` by hand. **`package-lock.json` may need one
  `npm install` to reconcile on merge.**

## Elevation order (screens)
Dashboard → match / big-moments → Squad & Player Profile → Trades/Deadline →
Scouting → Standings/Stats. Apply the system, add tasteful motion, kill all emoji icons.
