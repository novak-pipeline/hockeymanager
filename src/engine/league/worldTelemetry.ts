/**
 * WORLD TELEMETRY — a league-wide measurement arm for the economy and the AI
 * front offices (docs/LIVING-WORLD-ECONOMY-AND-AI.md).
 *
 * The career layer ticks these counters as the world moves (AI-to-AI trades by
 * shape and window, free-agent signings, re-signs, offer sheets, floor
 * top-ups). They are pure observation: nothing in the sim ever READS them, so
 * they cannot change an outcome, and they are deliberately NOT persisted — a
 * loaded save starts counting afresh. The autopilot's world-health recorder
 * reads them once a season to judge the league against real-NHL bands.
 */

/** The shape of an AI-to-AI deal — the variety the wire should show. */
export type AiTradeShape =
  | 'rental'      // veteran on a short deal for picks (the classic deadline deal)
  | 'prospectFor' // veteran for a prospect-led return
  | 'hockey'      // player-for-player, need for need
  | 'goalie'      // a goalie changes hands
  | 'capDump'     // salary shed with a sweetener attached
  | 'pickSwap'    // draft-floor pick movement (move up / move down)

export interface SeasonTelemetry {
  year: number
  trades: {
    aiAi: number
    withUser: number
    inSeason: number
    deadlineDay: number
    offseason: number
    byShape: Partial<Record<AiTradeShape, number>>
  }
  faSignings: { ai: number; aiStars: number; user: number }
  resigns: { ai: number }
  offerSheets: { aiAi: number; aiAiWalked: number; atUser: number }
  /** AI clubs that had to top up to the cap floor (one count per signing). */
  floorSignings: number
  /** AI moves that were written up as news with the GM's reasoning. */
  aiMoveStories: number
}

export function emptySeasonTelemetry(year: number): SeasonTelemetry {
  return {
    year,
    trades: { aiAi: 0, withUser: 0, inSeason: 0, deadlineDay: 0, offseason: 0, byShape: {} },
    faSignings: { ai: 0, aiStars: 0, user: 0 },
    resigns: { ai: 0 },
    offerSheets: { aiAi: 0, aiAiWalked: 0, atUser: 0 },
    floorSignings: 0,
    aiMoveStories: 0,
  }
}

export class WorldTelemetry {
  private readonly seasons = new Map<number, SeasonTelemetry>()

  season(year: number): SeasonTelemetry {
    let s = this.seasons.get(year)
    if (!s) {
      s = emptySeasonTelemetry(year)
      this.seasons.set(year, s)
    }
    return s
  }

  /** Book one completed trade. `window` is where in the calendar it landed. */
  trade(year: number, args: { aiAi: boolean; window: 'inSeason' | 'deadlineDay' | 'offseason'; shape?: AiTradeShape }): void {
    const s = this.season(year)
    if (args.aiAi) s.trades.aiAi++
    else s.trades.withUser++
    s.trades[args.window]++
    if (args.shape) s.trades.byShape[args.shape] = (s.trades.byShape[args.shape] ?? 0) + 1
  }

  all(): SeasonTelemetry[] {
    return [...this.seasons.values()].sort((a, b) => a.year - b.year)
  }
}
