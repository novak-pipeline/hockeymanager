/**
 * Per-game goalie variance — the "hot goalie steals it" (and "off night") lever.
 *
 * A goalie's true talent sets his SEASON save%, but game to game he swings hugely:
 * some nights he's square to everything and robs the other team blind, other
 * nights the first shot trickles through and he gets the hook. Real play-by-play
 * shows a game-save% spread far wider than shot-count noise alone — that extra
 * variance is what makes an underdog's netminder stealing two points, or a
 * Vezina guy laying an egg, part of the sport's drama.
 *
 * `goalieNightFactor` returns a one-per-game multiplier on the goals the goalie
 * concedes (mean 1.0), so the average night is unchanged — the season save% and
 * the calibration targets are untouched — while the game-to-game variance grows
 * to match reality. It's derived from a stable hash of the game seed + the
 * goalie's id, so it's deterministic and, crucially, consumes NONE of the game's
 * shot-by-shot RNG stream (the shot sequence replays byte-for-byte; only the
 * save outcomes bend with the goalie's night).
 */
import { Rng, deriveSeed } from './rng'

// A goalie's nightly night is applied as a multiplier straight on the opponent's
// per-shot goal probability, NOT via his rating: the save formula deliberately
// compresses rating → save% (real starters live in a narrow .890–.925 band), so
// even a big rating swing barely moves the needle. Multiplying goals-against
// directly gives the "hot goalie / off night" its real teeth while staying
// controllable. Std-dev ~9% on goals-against; a hot night ≈ 0.91×, an off night
// ≈ 1.09×. Symmetric around 1.0, so the LEAGUE mean goals (and calibration) are
// unchanged — it just adds realistic game-to-game (and season-to-season) spread,
// which between equal teams is worth a ~15-point swing in win rate on the night.
const NIGHT_SD = 0.09
/** Clamp the tails so one game can't make a starter unbeatable or a sieve. */
const NIGHT_CAP = 0.27

function hashId(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)

/** Multiplier on the goals the goalie concedes this game (mean 1.0): below 1 =
 *  hot/stealing it, above 1 = leaking. Deterministic from a stable hash of the
 *  game seed + goalie id, so it costs NONE of the game's shot-by-shot RNG. */
export function goalieNightFactor(gameSeed: number, goalieId: string): number {
  const rng = new Rng(deriveSeed(gameSeed, hashId(goalieId)))
  return 1 + clamp(rng.normal(0, NIGHT_SD), -NIGHT_CAP, NIGHT_CAP)
}
