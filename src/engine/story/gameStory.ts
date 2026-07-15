/**
 * Post-game story beats — surfacing the drama the sim actually produced.
 *
 * The engine now generates real dramatic swings: a goalie standing on his head and
 * stealing two points (per-game goalie variance), a team clawing back from two
 * down (score effects), a lead evaporating late. Those moments were invisible —
 * the recap just printed the score. This reads a finished game and, when it earned
 * one, returns a single punchy headline so the GM feels what happened, not just
 * the final digits. Pure and deterministic: a function of the box score.
 */

export type GameStoryKind = 'comeback' | 'blownLead' | 'goalieRobbery' | 'goalieShelled'

export interface GameStoryBeat {
  kind: GameStoryKind
  headline: string
  body: string
}

export interface GameStoryInput {
  /** Every goal in chronological order: true = the user's club scored it. Include
   *  the OT / shootout decider so a rally that finishes in the skills competition
   *  still reads as a comeback. */
  goalByUser: boolean[]
  won: boolean
  /** The user's starting goalie's night, if he faced shots. */
  goalie?: { name: string; saves: number; shotsAgainst: number; goalsAgainst: number }
  /** Shots for each side, to know if the winning goalie was under siege. */
  userShots: number
  oppShots: number
}

/** The biggest deficit the user faced, and the biggest lead the user held. */
function swings(goalByUser: boolean[]): { maxDeficit: number; maxLead: number } {
  let us = 0
  let them = 0
  let maxDeficit = 0
  let maxLead = 0
  for (const byUser of goalByUser) {
    if (byUser) us++
    else them++
    if (them - us > maxDeficit) maxDeficit = them - us
    if (us - them > maxLead) maxLead = us - them
  }
  return { maxDeficit, maxLead }
}

/**
 * Return the single most notable story beat for a finished user game, or null if
 * it was an ordinary night. Priority: a comeback or a collapse (the rarest, most
 * memorable swings) outrank a goalie's heroics or horror show.
 */
export function detectGameStory(inp: GameStoryInput): GameStoryBeat | null {
  const { maxDeficit, maxLead } = swings(inp.goalByUser)

  // 1. Comeback win — overcame a two-goal hole and won (by any route).
  if (inp.won && maxDeficit >= 2) {
    return {
      kind: 'comeback',
      headline: `Comeback! Down ${maxDeficit}, your club storms back to win`,
      body: `Trailing by ${maxDeficit}, the club dug in and rallied all the way back for the two points.`,
    }
  }

  // 2. Blown lead — held a two-goal lead and lost it.
  if (!inp.won && maxLead >= 2) {
    return {
      kind: 'blownLead',
      headline: `Collapse: a ${maxLead}-goal lead slips away`,
      body: `The club led by ${maxLead} and couldn't close it out, letting the game — and the points — get away.`,
    }
  }

  const g = inp.goalie
  // 3. Goalie robbery — won while badly outshot behind a huge night in net.
  if (inp.won && g && g.shotsAgainst >= 34 && g.saves / g.shotsAgainst >= 0.93 && inp.oppShots > inp.userShots + 6) {
    return {
      kind: 'goalieRobbery',
      headline: `${g.name} stole it — ${g.saves} saves`,
      body: `Under siege all night, ${g.name} turned aside ${g.saves} of ${g.shotsAgainst} shots to steal the two points.`,
    }
  }

  // 4. Goalie shelled — lost a game the netminder never had a chance in.
  if (!inp.won && g && g.goalsAgainst >= 6) {
    return {
      kind: 'goalieShelled',
      headline: `Rough night for ${g.name}`,
      body: `${g.name} was beaten ${g.goalsAgainst} times on ${g.shotsAgainst} shots — a night to forget between the pipes.`,
    }
  }

  return null
}

export type PlayerStoryKind = 'hatTrick' | 'bigNight' | 'shutout'

export interface PlayerStoryBeat {
  kind: PlayerStoryKind
  playerId: string
  headline: string
  body: string
}

/** One player's line from a finished game, for spotting individual heroics. */
export interface PlayerGameLine {
  playerId: string
  name: string
  isGoalie: boolean
  goals: number
  assists: number
  saves: number
  shotsAgainst: number
  goalsAgainst: number
}

/**
 * Pick the single most notable individual performance from a club's box score —
 * the hat trick, the big multi-point night, the shutout — or null on an ordinary
 * night. The hat trick is hockey's iconic personal moment, so it outranks a big
 * points night; a clean shutout is the goalie's equivalent. Pure/deterministic.
 */
export function detectPlayerStory(lines: PlayerGameLine[]): PlayerStoryBeat | null {
  let hat: PlayerGameLine | null = null // most goals ≥ 3
  let big: PlayerGameLine | null = null // most points ≥ 4 (non-hat)
  let sho: PlayerGameLine | null = null // shutout, most saves
  for (const l of lines) {
    const points = l.goals + l.assists
    if (!l.isGoalie && l.goals >= 3 && (!hat || l.goals > hat.goals || (l.goals === hat.goals && points > hat.goals + hat.assists))) {
      hat = l
    }
    if (!l.isGoalie && l.goals < 3 && points >= 4 && (!big || points > big.goals + big.assists)) big = l
    if (l.isGoalie && l.goalsAgainst === 0 && l.shotsAgainst >= 18 && (!sho || l.saves > sho.saves)) sho = l
  }

  if (hat) {
    const pts = hat.goals + hat.assists
    const label = hat.goals >= 4 ? `a ${hat.goals}-goal night` : 'a hat trick'
    const tail = pts > hat.goals ? ` (${pts} points)` : ''
    return {
      kind: 'hatTrick',
      playerId: hat.playerId,
      headline: `${hat.name} nets ${label}!`,
      body: `${hat.name} lit the lamp ${hat.goals} times${tail} — the kind of night that ends up on the highlight reel.`,
    }
  }
  if (big) {
    const pts = big.goals + big.assists
    return {
      kind: 'bigNight',
      playerId: big.playerId,
      headline: `${big.name} racks up a ${pts}-point night`,
      body: `${big.name} was all over the scoresheet: ${big.goals}G, ${big.assists}A.`,
    }
  }
  if (sho) {
    return {
      kind: 'shutout',
      playerId: sho.playerId,
      headline: `${sho.name} slams the door — ${sho.saves}-save shutout`,
      body: `${sho.name} turned aside all ${sho.shotsAgainst} shots for the clean sheet.`,
    }
  }
  return null
}
