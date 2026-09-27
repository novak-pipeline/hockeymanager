/**
 * The assistant coach's read — what's working, what isn't, one suggestion.
 *
 * Authored templates, no LLM. Every line is a RECEIPT: it only fires when the
 * numbers behind it are really there (a shot share, a faceoff count, a goalie's
 * save% against what his chances predicted), and it quotes them. Candidates are
 * scored by how far the number sits from even, so the strongest real story of
 * the period is the one the assistant leads with. Variants are picked by a
 * stable hash of the game and period, so reopening the same intermission reads
 * the same, and the next intermission reads differently.
 *
 * Used at intermissions (a three-part read on the period just played, with the
 * game so far as context) and in the dead air between highlights (one line on
 * the game so far).
 *
 * Pure and DOM-free.
 */
import type { MatchStats, PlayerLine, Side, TeamStats } from './matchStats'
import { periodName } from './matchStats'
import type { PlayerRating } from './ratings'

export interface AssistantRead {
  working: string
  notWorking: string
  suggestion: string
}

interface Obs {
  id: string
  /** How strong the story is (bigger = leads). */
  weight: number
  lines: string[]
  /** What the assistant would do about it (negatives only). */
  fix?: string[]
}

/** FNV-1a — stable across runs and platforms. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function pick(list: string[], key: string): string {
  return list[hash(key) % list.length] ?? list[0] ?? ''
}

function fill(t: string, slots: Record<string, string | number>): string {
  return t.replace(/\{(\w+)\}/g, (_, k: string) => (slots[k] !== undefined ? String(slots[k]) : `{${k}}`))
}

const lastName = (full: string): string => {
  const parts = full.trim().split(/\s+/)
  return parts[parts.length - 1] ?? full
}

const pct = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 100) : 0)
const sv3 = (f: number): string => {
  const r = Math.round(Math.max(0, f) * 1000)
  return r >= 1000 ? '1.000' : `.${r.toString().padStart(3, '0')}`
}

export interface AssistantInput {
  /** Stats for the whole game so far. */
  game: MatchStats
  /** The slice being judged: a period's team stats (intermission) or the game (live). */
  us: TeamStats
  them: TeamStats
  userSide: Side
  ratings: PlayerRating[]
  /** 'period' = an intermission read of the period just played; 'game' = so far. */
  scope: 'period' | 'game'
  period: number
  /** Stable seed (game key). */
  seed: string
}

function observations(inp: AssistantInput): { pos: Obs[]; neg: Obs[] } {
  const { us, them, userSide } = inp
  const other: Side = userSide === 'home' ? 'away' : 'home'
  const when = inp.scope === 'period' ? `in the ${periodName(inp.period)}` : 'tonight'
  const pos: Obs[] = []
  const neg: Obs[] = []

  // Shots on goal.
  const sTot = us.shots + them.shots
  if (sTot >= 8) {
    const share = us.shots / sTot
    const slots = { sf: us.shots, sa: them.shots, when }
    if (share >= 0.58) {
      pos.push({
        id: 'shots+', weight: (share - 0.5) * 10,
        lines: [
          fill(`We're driving play — {sf} shots to their {sa} {when}.`, slots),
          fill(`We're living in their end: {sf}–{sa} on shots {when}.`, slots),
          fill(`The shot clock's ours, {sf} to {sa} {when}. Their D can't get it out.`, slots),
        ],
      })
    } else if (share <= 0.42) {
      neg.push({
        id: 'shots-', weight: (0.5 - share) * 10,
        lines: [
          fill(`They're outshooting us {sa}–{sf} {when}. We're chasing the puck.`, slots),
          fill(`{sa} shots against, {sf} for, {when}. We're spending too long in our own end.`, slots),
          fill(`We've been pinned in: {sa}–{sf} on shots {when}.`, slots),
        ],
        fix: [
          `Win the wall on the breakout and chip it past their pinching D — get the game back in their end.`,
          `Tighter gaps through the neutral zone. Make them dump it in instead of carrying it.`,
          `Shorter shifts. We're getting hemmed in because guys are staying out tired.`,
        ],
      })
    }
  }

  // Chance quality (expected goals).
  const xTot = us.xg + them.xg
  if (xTot >= 0.8) {
    const share = us.xg / xTot
    const slots = { xf: us.xg.toFixed(1), xa: them.xg.toFixed(1), when }
    if (share >= 0.62) {
      pos.push({
        id: 'xg+', weight: (share - 0.5) * 9,
        lines: [
          fill(`We're getting the better looks — {xf} expected goals to their {xa} {when}.`, slots),
          fill(`The chances are ours: {xf} xG for, {xa} against {when}. Keep going to the net.`, slots),
        ],
      })
    } else if (share <= 0.38) {
      neg.push({
        id: 'xg-', weight: (0.5 - share) * 9,
        lines: [
          fill(`They're getting the dangerous looks — {xa} expected goals to our {xf} {when}.`, slots),
          fill(`Too much in the slot: they've built {xa} xG to our {xf} {when}.`, slots),
        ],
        fix: [
          `Collapse on the slot. Let them have the outside and take away the middle.`,
          `Box out in front. Their second chances are coming off our net-front coverage.`,
        ],
      })
    }
  }

  // Faceoffs.
  if (us.faceoffs >= 8) {
    const p = pct(us.faceoffWins, us.faceoffs)
    const slots = { w: us.faceoffWins, n: us.faceoffs, p, when }
    if (p >= 58) {
      pos.push({
        id: 'fo+', weight: (p - 50) / 8,
        lines: [
          fill(`We're winning the dot — {w} of {n} {when}, so we're starting shifts with the puck.`, slots),
          fill(`Centres are doing their job: {p}% on draws {when}.`, slots),
        ],
      })
    } else if (p <= 42) {
      neg.push({
        id: 'fo-', weight: (50 - p) / 8,
        lines: [
          fill(`We're losing the draws — {w} of {n} {when}. We keep starting without the puck.`, slots),
          fill(`{p}% on faceoffs {when}. That's a lot of chasing to get it back.`, slots),
        ],
        fix: [
          `Wingers have to help on the draws — jump in on the loose ones.`,
          `Put our best man on the dot for the defensive-zone draws.`,
        ],
      })
    }
  }

  // Turnovers.
  if (us.giveaways >= 4 && us.giveaways >= us.takeaways + 2) {
    neg.push({
      id: 'give-', weight: 0.6 + us.giveaways * 0.15,
      lines: [
        fill(`We're coughing it up — {g} giveaways {when}.`, { g: us.giveaways, when }),
        fill(`{g} giveaways {when}. We're making plays that aren't there.`, { g: us.giveaways, when }),
      ],
      fix: [
        `Simplify. Glass and out when it's not there — no drop passes through the middle.`,
        `Put it deep and go get it. We're turning it over at their blue line.`,
      ],
    })
  } else if (us.takeaways >= 4 && us.takeaways >= us.giveaways + 2) {
    pos.push({
      id: 'take+', weight: 0.6 + us.takeaways * 0.12,
      lines: [
        fill(`Our sticks are good — {t} takeaways {when}.`, { t: us.takeaways, when }),
        fill(`We're taking pucks off them: {t} takeaways {when}.`, { t: us.takeaways, when }),
      ],
    })
  }

  // Physical play.
  if (us.hits + them.hits >= 10) {
    if (us.hits >= them.hits + 6) {
      pos.push({
        id: 'hits+', weight: 0.5 + (us.hits - them.hits) * 0.08,
        lines: [
          fill(`We're winning the physical battle — {h} hits to their {o} {when}. They're rushing plays.`, { h: us.hits, o: them.hits, when }),
          fill(`{h} hits {when}. Their D are getting rid of it early.`, { h: us.hits, o: them.hits, when }),
        ],
      })
    } else if (them.hits >= us.hits + 6) {
      neg.push({
        id: 'hits-', weight: 0.4 + (them.hits - us.hits) * 0.07,
        lines: [
          fill(`They're pushing us around — {o} hits to our {h} {when}.`, { h: us.hits, o: them.hits, when }),
        ],
        fix: [`Move the puck quicker. We're holding it long enough to get hit.`],
      })
    }
  }

  // Special teams: our power play, their power play (= our kill), discipline.
  if (us.powerPlays > 0) {
    if (us.powerPlayGoals > 0) {
      pos.push({
        id: 'pp+', weight: 1.4 + us.powerPlayGoals * 0.4,
        lines: [
          fill(`The power play delivered — {g} for {n} {when}.`, { g: us.powerPlayGoals, n: us.powerPlays, when }),
          fill(`Special teams won us that stretch: {g} on {n} power plays {when}.`, { g: us.powerPlayGoals, n: us.powerPlays, when }),
        ],
      })
    } else if (us.powerPlays >= 2) {
      neg.push({
        id: 'pp-', weight: 0.7 + us.powerPlays * 0.25,
        lines: [
          fill(`The power play is 0 for {n} {when}.`, { n: us.powerPlays, when }),
          fill(`{n} power plays, nothing to show for it {when}.`, { n: us.powerPlays, when }),
        ],
        fix: [
          `Shoot more on the man advantage. We're passing it around the perimeter.`,
          `Get a body in front of their goalie on the power play — he's seeing everything.`,
        ],
      })
    }
  }
  if (them.powerPlays > 0) {
    if (them.powerPlayGoals === 0 && them.powerPlays >= 2) {
      pos.push({
        id: 'pk+', weight: 0.8 + them.powerPlays * 0.25,
        lines: [
          fill(`The kill has been perfect — {n} for {n} {when}.`, { n: them.powerPlays, when }),
          fill(`Penalty killers have been outstanding: {n} kills, nothing through {when}.`, { n: them.powerPlays, when }),
        ],
      })
    } else if (them.powerPlayGoals > 0) {
      neg.push({
        id: 'pk-', weight: 1.1 + them.powerPlayGoals * 0.4,
        lines: [
          fill(`Their power play has hurt us — {g} on {n} {when}.`, { g: them.powerPlayGoals, n: them.powerPlays, when }),
        ],
        fix: [`The penalty kill needs to pressure up top. We're giving their shooters too long.`],
      })
    }
    if (them.powerPlays >= 2 && them.powerPlays >= us.powerPlays + 2) {
      neg.push({
        id: 'disc-', weight: 0.8 + them.powerPlays * 0.3,
        lines: [
          fill(`We're taking penalties — {n} trips to the box {when}.`, { n: them.powerPlays, when }),
          fill(`{n} penalties {when}. We can't keep killing.`, { n: them.powerPlays, when }),
        ],
        fix: [
          `Stay out of the box. Move the feet, don't reach with the stick.`,
          `Discipline. They're drawing us into it — skate away from the scrums.`,
        ],
      })
    }
  }

  // The goalies — game so far, the only honest sample.
  const goalieLine = (side: Side): PlayerLine | null => {
    let best: PlayerLine | null = null
    for (const l of inp.game.players) {
      if (!l.isGoalie || l.side !== side || l.shotsAgainst === 0) continue
      if (!best || l.shotsAgainst > best.shotsAgainst) best = l
    }
    return best
  }
  const ours = goalieLine(userSide)
  const theirs = goalieLine(other)
  if (ours && ours.shotsAgainst >= 8) {
    const gsax = ours.xga - ours.goalsAgainst
    const slots = { g: lastName(ours.name), sv: sv3(ours.saves / ours.shotsAgainst), n: ours.shotsAgainst, ga: ours.goalsAgainst }
    if (gsax >= 0.8) {
      pos.push({
        id: 'ourG+', weight: 0.9 + gsax * 0.8,
        lines: [
          fill(`{g} is keeping us in it — {sv} on {n} shots.`, slots),
          fill(`{g} has been our best player: {n} shots, {ga} past him.`, slots),
        ],
      })
    } else if (gsax <= -1) {
      neg.push({
        id: 'ourG-', weight: 0.9 + -gsax * 0.8,
        lines: [
          fill(`{g} is fighting it — {ga} on {n} shots, and not all of them were chances.`, slots),
          fill(`{g} doesn't look settled: {sv} on {n}.`, slots),
        ],
        fix: [
          `Clear the rebounds and give {g} clean sightlines. If it doesn't settle, the backup is ready.`,
          `Protect {g} — nothing through the middle until he finds his game.`,
        ].map((t) => fill(t, slots)),
      })
    }
  }
  if (theirs && theirs.shotsAgainst >= 8) {
    const gsax = theirs.xga - theirs.goalsAgainst
    const slots = { g: lastName(theirs.name), sv: sv3(theirs.saves / theirs.shotsAgainst), n: theirs.shotsAgainst }
    if (gsax >= 1) {
      neg.push({
        id: 'theirG+', weight: 0.8 + gsax * 0.7,
        lines: [
          fill(`{g} is standing on his head — {sv} on {n} shots.`, slots),
          fill(`Their goalie is the story: {g} has stopped {sv} of what we've thrown at him.`, slots),
        ],
        fix: [
          `Traffic. {g} is seeing every shot — get bodies to the net and go for the rebounds.`,
          `Change the angle on {g}: pull it across the slot before we shoot, he's square to everything.`,
        ].map((t) => fill(t, slots)),
      })
    } else if (gsax <= -1) {
      pos.push({
        id: 'theirG-', weight: 0.7 + -gsax * 0.6,
        lines: [
          fill(`{g} looks shaky — keep putting pucks on him.`, slots),
          fill(`{g} is leaking: {sv} on {n}. Shoot from everywhere.`, slots),
        ],
      })
    }
  }

  // People: our best and our weakest skater so far.
  const mine = inp.ratings.filter((r) => r.side === userSide && !r.isGoalie)
  const best = mine[0]
  if (best && best.rating >= 7.3 && best.drivers[0]) {
    pos.push({
      id: 'star+', weight: 0.6 + (best.rating - 7) * 0.8,
      lines: [
        fill(`{n} is our best player out there — {d}.`, { n: lastName(best.name), d: best.drivers[0].label }),
        fill(`{n} is flying tonight: {d}.`, { n: lastName(best.name), d: best.drivers[0].label }),
      ],
    })
  }
  const weak = [...mine].reverse().find((r) => r.line.toi >= 300 && r.rating <= 5.6)
  if (weak && weak.drivers[0] && weak.drivers[0].delta < 0) {
    neg.push({
      id: 'weak-', weight: 0.5 + (6 - weak.rating) * 0.8,
      lines: [
        fill(`{n} is having a hard night — {d}.`, { n: lastName(weak.name), d: weak.drivers[0].label }),
        fill(`{n} hasn't found it yet: {d}.`, { n: lastName(weak.name), d: weak.drivers[0].label }),
      ],
      fix: [
        fill(`I'd shelter {n} a bit — easier matchups until he settles.`, { n: lastName(weak.name) }),
        fill(`Talk to {n}. Keep it simple, get the puck deep, then build from there.`, { n: lastName(weak.name) }),
      ],
    })
  }

  return { pos, neg }
}

/** The score, from the user's chair, over the WHOLE game so far. */
function scoreState(inp: AssistantInput): { us: number; them: number } {
  return inp.userSide === 'home'
    ? { us: inp.game.home.goals, them: inp.game.away.goals }
    : { us: inp.game.away.goals, them: inp.game.home.goals }
}

function stateSuggestion(inp: AssistantInput, key: string): string {
  const { us, them } = scoreState(inp)
  const beforeOt = inp.scope === 'period' && inp.period >= 3 && us === them
  if (beforeOt) {
    return pick([
      `Three-on-three is a possession game. Regroup instead of forcing it — whoever keeps the puck wins this.`,
      `Overtime: nobody cheats for offence. One mistake ends it — make it theirs.`,
    ], key)
  }
  const lead = us - them
  if (lead >= 2) {
    return pick([
      `Same recipe. Keep it simple, get pucks deep, don't give them anything easy off the rush.`,
      `We've got a cushion — manage the game, don't sit on it. Keep making them defend.`,
    ], key)
  }
  if (lead === 1) {
    return pick([
      `A one-goal lead is nothing. Keep playing to win the next shift, not to protect the last one.`,
      `Stay aggressive on the forecheck. The next goal decides a lot here.`,
    ], key)
  }
  if (lead === 0) {
    return pick([
      `It's there for whoever wants the next goal more. Get pucks and bodies to the net.`,
      `Even game. Win the battles along the wall and the chances will come.`,
    ], key)
  }
  if (lead === -1) {
    return pick([
      `One shot away. Don't open it up and chase — keep the structure and push the pace.`,
      `We're one goal off. Get the D involved, activate from the point.`,
    ], key)
  }
  return pick([
    `We need a response early. Push the pace, get the D pinching — we have to take some risks now.`,
    `Get the next one and it's a game again. More bodies to the net, more shots from everywhere.`,
  ], key)
}

/** Intermission (or live) read: what's working, what isn't, one suggestion. */
export function assistantRead(inp: AssistantInput): AssistantRead {
  const { pos, neg } = observations(inp)
  pos.sort((a, b) => b.weight - a.weight)
  neg.sort((a, b) => b.weight - a.weight)
  const key = `${inp.seed}|${inp.scope}|${inp.period}`
  const topPos = pos[0]
  const topNeg = neg[0]
  const working = topPos
    ? pick(topPos.lines, `${key}|w|${topPos.id}`)
    : pick([
        `Nobody's found an edge yet — it's an even game out there.`,
        `We're holding our own. No one's tilted the ice either way.`,
      ], `${key}|w`)
  const notWorking = topNeg
    ? pick(topNeg.lines, `${key}|n|${topNeg.id}`)
    : pick([
        `Nothing's broken. We just haven't made their goalie work hard enough yet.`,
        `No alarms — but we can be harder on their D when they go back for pucks.`,
      ], `${key}|n`)
  const suggestion = topNeg?.fix && topNeg.fix.length > 0
    ? pick(topNeg.fix, `${key}|s|${topNeg.id}`)
    : stateSuggestion(inp, `${key}|s`)
  return { working, notWorking, suggestion }
}

/**
 * One line for the dead air between highlights: the strongest real story of
 * the game so far, positive or negative, in the assistant's voice.
 */
export function assistantLiveLine(inp: AssistantInput): string {
  const { pos, neg } = observations(inp)
  const all = [...pos, ...neg].sort((a, b) => b.weight - a.weight)
  const top = all[0]
  const key = `${inp.seed}|live|${Math.floor(inp.game.elapsed / 240)}`
  if (!top) return pick([
    `Even so far. Nobody's tilted the ice yet.`,
    `Tight one. Both teams are feeling it out.`,
  ], key)
  return pick(top.lines, `${key}|${top.id}`)
}
