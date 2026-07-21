/**
 * Ambient league milestone news — pure story flavour that makes the league feel
 * alive (hot/cold team streaks). No sim or calibration impact; the career layer
 * tracks the streak counters and decides when to surface these.
 */
import type { Rng } from '@engine/shared/rng'
import {
  isEligible,
  markUsed,
  renderTemplate,
  selectVariant,
  type ContentUse,
  type ContentVariant,
} from '@engine/story/contentEngine'

/**
 * A hot/cold streak headline + body when a team's run hits a notable threshold
 * (6 games, then every 2 after — 6, 8, 10, …), else null. `streak` is signed:
 * positive = consecutive wins, negative = winless run (losses incl. OT). Pure
 * and deterministic.
 */
export function streakMilestone(
  teamName: string,
  streak: number,
  /** Content-engine hookup: seeded pick + season no-repeat. Without it, the
   *  most specific first variant serves (original deterministic behaviour). */
  opts?: { rng: Rng; ledger: ContentUse[]; year: number; day: number }
): { headline: string; body: string } | null {
  const n = Math.abs(streak)
  if (n < 6 || n % 2 !== 0) return null
  const pool = streak > 0 ? WIN_STREAK_POOL : SKID_POOL
  const ctx = { n }
  const v = opts
    ? selectVariant({ pool, ctx, rng: opts.rng, ledger: opts.ledger, year: opts.year })
    : pool.filter((p) => isEligible(p, ctx)).sort(
        (a, b) => Object.keys(b.conditions ?? {}).length - Object.keys(a.conditions ?? {}).length
      )[0]
  if (!v) return null
  if (opts) markUsed(opts.ledger, v.id, opts.year, opts.day)
  const slots = { team: teamName, n: String(n) }
  return { headline: renderTemplate(v.text, slots), body: renderTemplate(v.text2 ?? '', slots) }
}

/** The same hot run used to print the same sentence at 6, 8 AND 10 games.
 *  Now the run escalates: ordinary heat first, history at ten. */
const WIN_STREAK_POOL: ContentVariant[] = [
  { id: 'streak.win.ten', conditions: { minN: 10 },
    text: `{n} straight: {team} are chasing history`,
    text2: `Double digits. {team} haven't lost in {n} games, the kind of run that gets remembered in April — and opponents are starting to play them like a team they'd rather not see.` },
  { id: 'streak.win.hottest',
    text: `{team} ride a {n}-game winning streak`,
    text2: `{team} have reeled off {n} straight — the hottest team in the league right now.` },
  { id: 'streak.win.finding-ways',
    text: `{n} in a row for {team}`,
    text2: `Tight ones, blowouts, a comeback — {team} keep finding ways. {n} straight wins, and the room has that quiet swagger good teams get.` },
  { id: 'streak.win.building',
    text: `Nobody wants to play {team} right now`,
    text2: `{n} consecutive wins have turned {team} into the fixture opponents circle nervously. Streaks end; the habits underneath them tend not to.` },
]

const SKID_POOL: ContentVariant[] = [
  { id: 'streak.skid.ten', conditions: { minN: 10 },
    text: `{n} without a win: {team} in free fall`,
    text2: `There is no framing {n} straight winless games as a rough patch. {team} are in a full spiral, and everyone — the room, the press box, the owner's suite — knows something has to change.` },
  { id: 'streak.skid.pressure',
    text: `{team} skid to {n} straight losses`,
    text2: `It's gone cold for {team}: {n} consecutive games without a win, and the pressure is mounting.` },
  { id: 'streak.skid.answers',
    text: `{n} straight defeats — {team} searching for answers`,
    text2: `Different nights, same ending. {team} have dropped {n} in a row, and the post-game answers are getting shorter.` },
  { id: 'streak.skid.weight',
    text: `The losses are piling up for {team}`,
    text2: `{n} games without a win now for {team}. Skids like this get heavier as they get longer — every mistake magnified, every bounce remembered.` },
]
