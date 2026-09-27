/**
 * Metric registry: turns aggregated GameMetrics into the named numbers the
 * scorecard compares against targets. One place to read "what exactly does
 * `possession.backShare.rush` measure".
 */
import type { GameMetrics } from './analyze'
import { histMean, histQuantile, histShareAbove, type Hist } from './hist'
import { SHAPE_TEMPLATES } from './shapes'

export type MetricGroup =
  | 'kinematics'
  | 'shape'
  | 'possession'
  | 'entries'
  | 'shots'
  | 'physical'
  | 'flow'
  | 'goalie'
  | 'motion'
  | 'shapeSim'

export interface MetricDef {
  id: string
  group: MetricGroup
  label: string
  unit: string
  /** Digits for display. */
  digits: number
  /** Headline metrics are listed first in the report. */
  headline?: boolean
  compute: (g: GameMetrics) => number
}

/** A metric the current stream cannot measure — and the additive field that would fix it. */
export interface UnobservableDef {
  id: string
  group: MetricGroup
  label: string
  needs: string
}

const ratio = (a: number | undefined, b: number | undefined): number => ((b ?? 0) > 0 ? (a ?? 0) / (b as number) : NaN)
const q = (h: Hist | undefined, p: number): number => (h ? histQuantile(h, p) : NaN)
const mean = (h: Hist | undefined): number => (h ? histMean(h) : NaN)
const teamGames = (g: GameMetrics): number => g.games * 2
const perTeamGame = (k: string) => (g: GameMetrics): number => ratio(g.counts[k], teamGames(g))
/** Per team per 60 minutes of game time. */
const perTeam60 = (k: string) => (g: GameMetrics): number => ratio(g.counts[k], (g.minutes * 2) / 60)

function passDefs(): MetricDef[] {
  const out: MetricDef[] = []
  const scopes: [string, string, boolean][] = [
    ['pass', 'all passes', true],
    ['pass.dz', 'from the defensive zone', false],
    ['pass.nz', 'from the neutral zone', false],
    ['pass.oz', 'from the offensive zone', false],
    ['pass.ozSetup', 'offensive-zone set play (not rush)', false],
    ['pass.rush', 'on the rush (transition: puck won outside the o-zone ≤ 8 s ago and already moved ≥ 15 ft up ice)', true],
    ['pass.oddMan', 'on odd-man rushes', true],
    ['pass.breakaway', 'on breakaways (no defender goal-side of the passer)', true],
    ['pass.pp', 'on the power play', false],
    ['pass.sh', 'shorthanded', false]
  ]
  for (const [k, label, headline] of scopes) {
    const short = k === 'pass' ? '' : `.${k.slice(5)}`
    out.push({
      id: `possession.backShare${short}`,
      group: 'possession',
      label: `Backward pass share — ${label}`,
      unit: 'share',
      digits: 3,
      headline,
      compute: (g) => ratio(g.counts[`${k}.back`], g.counts[`${k}.n`])
    })
    out.push({
      id: `possession.fwdShare${short}`,
      group: 'possession',
      label: `Forward pass share — ${label}`,
      unit: 'share',
      digits: 3,
      compute: (g) => ratio(g.counts[`${k}.fwd`], g.counts[`${k}.n`])
    })
  }
  out.push({
    id: 'possession.rushPassesPerTeamGame',
    group: 'possession',
    label: 'Rush passes per team-game (sample size for the rush back-share)',
    unit: '/team-game',
    digits: 1,
    compute: perTeamGame('pass.rush.n')
  })
  out.push({
    id: 'possession.breakawayPassesPerTeamGame',
    group: 'possession',
    label: 'Passes made on a breakaway per team-game',
    unit: '/team-game',
    digits: 2,
    compute: perTeamGame('pass.breakaway.n')
  })
  return out
}

export const METRICS: readonly MetricDef[] = [
  // --- Kinematics --------------------------------------------------------------
  { id: 'kinematics.speedMean', group: 'kinematics', label: 'Skater speed, mean (live play)', unit: 'mph', digits: 1, compute: (g) => mean(g.hists['skate.speedMph']) },
  { id: 'kinematics.speedP50', group: 'kinematics', label: 'Skater speed, median', unit: 'mph', digits: 1, compute: (g) => q(g.hists['skate.speedMph'], 0.5) },
  { id: 'kinematics.speedP90', group: 'kinematics', label: 'Skater speed, 90th pct', unit: 'mph', digits: 1, compute: (g) => q(g.hists['skate.speedMph'], 0.9) },
  { id: 'kinematics.speedP99', group: 'kinematics', label: 'Skater speed, 99th pct', unit: 'mph', digits: 1, headline: true, compute: (g) => q(g.hists['skate.speedMph'], 0.99) },
  { id: 'kinematics.shareAbove20', group: 'kinematics', label: 'Share of skater-time at 20+ mph', unit: 'share', digits: 4, compute: (g) => (g.hists['skate.speedMph'] ? histShareAbove(g.hists['skate.speedMph'], 20) : NaN) },
  { id: 'kinematics.gameMaxMean', group: 'kinematics', label: 'Per-skater game top speed, mean', unit: 'mph', digits: 1, headline: true, compute: (g) => mean(g.hists['skate.gameMaxMph']) },
  { id: 'kinematics.gameMaxMax', group: 'kinematics', label: 'Fastest skater top speed in the sample', unit: 'mph', digits: 1, compute: (g) => g.hists['skate.gameMaxMph']?.max ?? NaN },
  { id: 'kinematics.bursts20', group: 'kinematics', label: 'Speed bursts 20+ mph per skater-game', unit: '/skater-game', digits: 2, headline: true, compute: (g) => ratio(g.counts['skate.bursts20'], g.counts['skate.skaterGames']) },
  { id: 'kinematics.bursts22', group: 'kinematics', label: 'Speed bursts 22+ mph per skater-game', unit: '/skater-game', digits: 2, compute: (g) => ratio(g.counts['skate.bursts22'], g.counts['skate.skaterGames']) },
  { id: 'kinematics.milesPer60', group: 'kinematics', label: 'Distance skated per 60 min on ice', unit: 'mi/60', digits: 1, compute: (g) => mean(g.hists['skate.milesPer60']) },
  { id: 'kinematics.milesPer60F', group: 'kinematics', label: 'Distance per 60 on ice — forwards', unit: 'mi/60', digits: 1, compute: (g) => mean(g.hists['skate.milesPer60.F']) },
  { id: 'kinematics.milesPer60D', group: 'kinematics', label: 'Distance per 60 on ice — defence', unit: 'mi/60', digits: 1, compute: (g) => mean(g.hists['skate.milesPer60.D']) },
  { id: 'kinematics.accelP50', group: 'kinematics', label: 'Acceleration magnitude, median', unit: 'ft/s²', digits: 1, compute: (g) => q(g.hists['skate.accelFt'], 0.5) },
  { id: 'kinematics.accelP99', group: 'kinematics', label: 'Acceleration magnitude, 99th pct', unit: 'ft/s²', digits: 1, headline: true, compute: (g) => q(g.hists['skate.accelFt'], 0.99) },
  { id: 'kinematics.tangAccelP99', group: 'kinematics', label: 'Speed change (tangential accel), 99th pct', unit: 'ft/s²', digits: 1, compute: (g) => q(g.hists['skate.tangAccelFt'], 0.99) },
  { id: 'kinematics.latAccelP99', group: 'kinematics', label: 'Lateral (turning) accel ≥10 mph, 99th pct', unit: 'ft/s²', digits: 1, headline: true, compute: (g) => q(g.hists['skate.latAccelFt'], 0.99) },
  { id: 'kinematics.jerkP95', group: 'kinematics', label: 'Jerk (accel change), 95th pct', unit: 'ft/s³', digits: 0, headline: true, compute: (g) => q(g.hists['skate.jerkFt'], 0.95) },
  { id: 'kinematics.radiusP5_10to15', group: 'kinematics', label: 'Tightest turns at 10–15 mph (5th pct radius)', unit: 'ft', digits: 1, compute: (g) => q(g.hists['skate.radiusFt.10to15'], 0.05) },
  { id: 'kinematics.radiusP5_15to20', group: 'kinematics', label: 'Tightest turns at 15–20 mph (5th pct radius)', unit: 'ft', digits: 1, compute: (g) => q(g.hists['skate.radiusFt.15to20'], 0.05) },
  { id: 'kinematics.radiusP5_20plus', group: 'kinematics', label: 'Tightest turns at 20+ mph (5th pct radius)', unit: 'ft', digits: 1, headline: true, compute: (g) => q(g.hists['skate.radiusFt.20plus'], 0.05) },

  // --- Team shape ----------------------------------------------------------------
  { id: 'shape.spacingAtt', group: 'shape', label: 'Attacking 5 spacing (mean pairwise distance)', unit: 'ft', digits: 1, compute: (g) => mean(g.hists['shape.spacingAttFt']) },
  { id: 'shape.spacingDef', group: 'shape', label: 'Defending 5 spacing (mean pairwise distance)', unit: 'ft', digits: 1, compute: (g) => mean(g.hists['shape.spacingDefFt']) },
  { id: 'shape.compactDef', group: 'shape', label: 'Defending compactness (mean distance to centroid)', unit: 'ft', digits: 1, compute: (g) => mean(g.hists['shape.compactDefFt']) },
  { id: 'shape.widthAtt', group: 'shape', label: 'Attacking width (y-span)', unit: 'ft', digits: 1, compute: (g) => mean(g.hists['shape.widthAttFt']) },
  { id: 'shape.depthAtt', group: 'shape', label: 'Attacking depth (x-span)', unit: 'ft', digits: 1, compute: (g) => mean(g.hists['shape.depthAttFt']) },
  { id: 'shape.dPairDef', group: 'shape', label: 'Defending D-pair distance', unit: 'ft', digits: 1, compute: (g) => mean(g.hists['shape.dPairDefFt']) },
  { id: 'shape.dPairAtt', group: 'shape', label: 'Attacking D-pair distance', unit: 'ft', digits: 1, compute: (g) => mean(g.hists['shape.dPairAttFt']) },
  { id: 'shape.pressureP50', group: 'shape', label: 'Nearest defender to the carrier, median', unit: 'ft', digits: 1, compute: (g) => q(g.hists['shape.pressureFt'], 0.5) },
  { id: 'shape.gapP50', group: 'shape', label: 'Neutral-zone gap (goal-side defender to a carrier skating up ice), median', unit: 'ft', digits: 1, headline: true, compute: (g) => q(g.hists['shape.gapFt'], 0.5) },
  { id: 'shape.attackersInOz', group: 'shape', label: 'Attackers inside the zone when the puck is in', unit: 'skaters', digits: 2, compute: (g) => mean(g.hists['shape.attackersInOz']) },
  { id: 'shape.defendersInDz', group: 'shape', label: 'Defenders inside their zone when the puck is in', unit: 'skaters', digits: 2, compute: (g) => mean(g.hists['shape.defendersInDz']) },

  // --- Possession -----------------------------------------------------------------
  { id: 'possession.passesPerTeam60', group: 'possession', label: 'Pass attempts per team-60', unit: '/team-60', digits: 0, headline: true, compute: perTeam60('pass.n') },
  { id: 'possession.completion', group: 'possession', label: 'Pass completion', unit: 'share', digits: 3, compute: (g) => ratio(g.counts['pass.completed'], g.counts['pass.n']) },
  { id: 'possession.lengthMean', group: 'possession', label: 'Pass length, mean', unit: 'ft', digits: 1, compute: (g) => mean(g.hists['pass.lengthFt']) },
  { id: 'possession.speedMean', group: 'possession', label: 'Pass speed, mean (from puck frames, coarse at 4 fps)', unit: 'mph', digits: 1, compute: (g) => mean(g.hists['pass.speedMph']) },
  ...passDefs(),
  { id: 'possession.turnoversPerTeamGame', group: 'possession', label: 'Giveaways + takeaways per team-game', unit: '/team-game', digits: 1, compute: (g) => ratio((g.counts['giveaway.n'] ?? 0) + (g.counts['takeaway.n'] ?? 0), teamGames(g)) },
  { id: 'possession.giveawaysPerTeamGame', group: 'possession', label: 'Giveaways per team-game', unit: '/team-game', digits: 1, compute: perTeamGame('giveaway.n') },
  { id: 'possession.takeawaysPerTeamGame', group: 'possession', label: 'Takeaways per team-game', unit: '/team-game', digits: 1, compute: perTeamGame('takeaway.n') },
  { id: 'possession.lengthSecMean', group: 'possession', label: 'Possession length, mean', unit: 's', digits: 1, compute: (g) => mean(g.hists['flow.possessionSec']) },

  // --- Zone entries -----------------------------------------------------------------
  { id: 'entries.perTeam60', group: 'entries', label: 'Zone entries (puck over the offensive blue line) per team-60', unit: '/team-60', digits: 1, compute: perTeam60('entry.n') },
  { id: 'entries.controlledShare', group: 'entries', label: 'Controlled entries (carry + pass) share', unit: 'share', digits: 3, headline: true, compute: (g) => ratio((g.counts['entry.carry'] ?? 0) + (g.counts['entry.pass'] ?? 0), g.counts['entry.n']) },
  { id: 'entries.carryShare', group: 'entries', label: 'Carry-in share', unit: 'share', digits: 3, compute: (g) => ratio(g.counts['entry.carry'], g.counts['entry.n']) },
  { id: 'entries.oddManPerTeamGame', group: 'entries', label: 'Odd-man rushes (entries with attackers > goal-side defenders) per team-game', unit: '/team-game', digits: 2, compute: perTeamGame('entry.oddMan') },

  // --- Shots -------------------------------------------------------------------------
  { id: 'shots.sogPerTeamGame', group: 'shots', label: 'Shots on goal per team-game', unit: '/team-game', digits: 1, compute: perTeamGame('shot.sog') },
  { id: 'shots.goalsPerTeamGame', group: 'shots', label: 'Goals per team-game', unit: '/team-game', digits: 2, compute: perTeamGame('goal.n') },
  { id: 'shots.shootingPct', group: 'shots', label: 'Shooting % (goals / SOG)', unit: 'share', digits: 3, compute: (g) => ratio(g.counts['goal.n'], g.counts['shot.sog']) },
  { id: 'shots.blockedShare', group: 'shots', label: 'Blocked share of shot attempts', unit: 'share', digits: 3, compute: (g) => ratio(g.counts['shot.blocked'], (g.counts['shot.sog'] ?? 0) + (g.counts['shot.blocked'] ?? 0) + (g.counts['shot.missed'] ?? 0)) },
  { id: 'shots.locationTvd', group: 'shots', label: 'Shot location vs NHL (distance×angle total-variation distance)', unit: 'TVD', digits: 3, headline: true, compute: () => NaN /* filled by compare() against the NHL grid */ },
  { id: 'shots.meanDist', group: 'shots', label: 'Mean shot distance (bin-centre estimate)', unit: 'ft', digits: 1, compute: () => NaN /* filled by compare() */ },
  { id: 'shots.rushShareProxy', group: 'shots', label: 'Rush-shot share (NHL event-proxy: within 6 s of first OZ event)', unit: 'share', digits: 3, compute: (g) => ratio(g.counts['proxy.rushShots'], g.counts['proxy.shots']) },
  { id: 'shots.reboundShareProxy', group: 'shots', label: 'Rebound-shot share (within 3 s of the previous shot)', unit: 'share', digits: 3, compute: (g) => ratio(g.counts['proxy.reboundShots'], g.counts['proxy.shots']) },
  { id: 'shots.speedMean', group: 'shots', label: 'Shot speed, mean (from puck frames, coarse at 4 fps)', unit: 'mph', digits: 1, compute: (g) => mean(g.hists['shot.speedMph']) },
  { id: 'shots.dangerMean', group: 'shots', label: 'Mean shot danger (engine xG proxy)', unit: '0..1', digits: 3, compute: (g) => mean(g.hists['shot.danger']) },

  // --- Physical ----------------------------------------------------------------------
  { id: 'physical.hitsPerTeamGame', group: 'physical', label: 'Hits per team-game', unit: '/team-game', digits: 1, headline: true, compute: perTeamGame('hit.n') },
  { id: 'physical.hitBoardsShare', group: 'physical', label: 'Hits within 10 ft of the boards', unit: 'share', digits: 3, headline: true, compute: (g) => ratio(g.counts['hit.boards'], g.counts['hit.n']) },
  { id: 'physical.hitByDShare', group: 'physical', label: 'Hits thrown by defencemen', unit: 'share', digits: 3, compute: (g) => ratio(g.counts['hit.byD'], (g.counts['hit.byD'] ?? 0) + (g.counts['hit.byF'] ?? 0)) },
  { id: 'physical.hitOnCarrierShare', group: 'physical', label: 'Hits on the puck carrier', unit: 'share', digits: 3, compute: (g) => ratio(g.counts['hit.onCarrier'], g.counts['hit.n']) },
  { id: 'physical.hitOzShare', group: 'physical', label: 'Hits thrown in the hitter’s offensive zone (forecheck)', unit: 'share', digits: 3, compute: (g) => ratio(g.counts['hit.oz'], g.counts['hit.n']) },
  { id: 'physical.penaltiesPerTeamGame', group: 'physical', label: 'Penalties per team-game', unit: '/team-game', digits: 2, compute: perTeamGame('pen.n') },
  { id: 'physical.penaltyTypes', group: 'physical', label: 'Distinct penalty infractions seen', unit: 'types', digits: 0, headline: true, compute: (g) => Object.keys(g.counts).filter((k) => k.startsWith('pen.type.')).length },
  { id: 'physical.fightsPerGame', group: 'physical', label: 'Fights per game', unit: '/game', digits: 2, compute: (g) => ratio((g.counts['pen.type.fighting'] ?? 0) / 2, g.games) },

  // --- Flow ----------------------------------------------------------------------------
  { id: 'flow.ozShareProxy', group: 'flow', label: 'Zone time OZ share (NHL event-proxy)', unit: 'share', digits: 3, compute: (g) => zoneShare(g, 'proxy.zone.', 'oz') },
  { id: 'flow.nzShareProxy', group: 'flow', label: 'Zone time NZ share (NHL event-proxy)', unit: 'share', digits: 3, compute: (g) => zoneShare(g, 'proxy.zone.', 'nz') },
  { id: 'flow.dzShareProxy', group: 'flow', label: 'Zone time DZ share (NHL event-proxy)', unit: 'share', digits: 3, compute: (g) => zoneShare(g, 'proxy.zone.', 'dz') },
  { id: 'flow.nzShareFrames', group: 'flow', label: 'Neutral-zone time share (puck position, live frames)', unit: 'share', digits: 3, headline: true, compute: (g) => zoneShare(g, 'zone.', 'nz') },
  { id: 'flow.faceoffsPerGame', group: 'flow', label: 'Faceoffs per game', unit: '/game', digits: 1, compute: (g) => ratio(g.counts['fo.n'], g.games) },
  { id: 'flow.secBetweenFaceoffs', group: 'flow', label: 'Mean seconds between faceoffs', unit: 's', digits: 1, compute: (g) => mean(g.hists['flow.foGapSec']) },
  { id: 'flow.foHomeOz', group: 'flow', label: 'Faceoff mix — home offensive zone', unit: 'share', digits: 3, compute: (g) => foShare(g, 'oz') },
  { id: 'flow.foHomeNz', group: 'flow', label: 'Faceoff mix — neutral zone', unit: 'share', digits: 3, compute: (g) => foShare(g, 'nz') },
  { id: 'flow.foHomeDz', group: 'flow', label: 'Faceoff mix — home defensive zone', unit: 'share', digits: 3, compute: (g) => foShare(g, 'dz') },
  { id: 'flow.foFollowShot10', group: 'flow', label: 'Faceoffs followed by a winner-team attempt within 10 s', unit: 'share', digits: 3, compute: (g) => ratio(g.counts['fo.followShot10'], g.counts['fo.n']) },
  { id: 'flow.whistleReasonCoverage', group: 'flow', label: 'Whistles that carry a reason', unit: 'share', digits: 3, compute: (g) => 1 - ratio(g.counts['whistle.reason.none'], g.counts['whistle.n']) },
  { id: 'flow.shiftMeanF', group: 'flow', label: 'Shift length, forwards (mean)', unit: 's', digits: 1, headline: true, compute: (g) => mean(g.hists['shift.lenSec.F']) },
  { id: 'flow.shiftMeanD', group: 'flow', label: 'Shift length, defence (mean)', unit: 's', digits: 1, compute: (g) => mean(g.hists['shift.lenSec.D']) },
  { id: 'flow.onTheFlyShare', group: 'flow', label: 'Line changes made on the fly', unit: 'share', digits: 3, compute: (g) => ratio(g.counts['lc.onFly'], g.counts['lc.n']) },

  // --- Goalie ----------------------------------------------------------------------------
  { id: 'goalie.depthP50', group: 'goalie', label: 'Goalie depth off the goal line (puck in his zone), median', unit: 'ft', digits: 1, compute: (g) => q(g.hists['goalie.depthFt'], 0.5) },
  { id: 'goalie.angleErrP50', group: 'goalie', label: 'Goalie off the puck-to-net line, median', unit: 'ft', digits: 2, compute: (g) => q(g.hists['goalie.angleErrFt'], 0.5) },
  { id: 'goalie.latSpeedP99', group: 'goalie', label: 'Goalie lateral speed, 99th pct (post-to-post pushes)', unit: 'mph', digits: 1, compute: (g) => q(g.hists['goalie.latSpeedMph'], 0.99) },
  { id: 'goalie.freezeShare', group: 'goalie', label: 'Saves frozen (whistle) share', unit: 'share', digits: 3, compute: (g) => ratio(g.counts['save.freeze'], g.counts['save.n']) },

  // --- Motion quality (analyzer side) -----------------------------------------------------
  { id: 'motion.teleportsLive', group: 'motion', label: 'Position teleports in live play per game (>45 ft/s)', unit: '/game', digits: 2, headline: true, compute: (g) => ratio(g.counts['motion.teleportsLive'], g.games) },
  { id: 'motion.teleportsDead', group: 'motion', label: 'Position jumps during stoppages per game', unit: '/game', digits: 2, compute: (g) => ratio(g.counts['motion.teleportsDead'], g.games) },
  { id: 'motion.overlapPerFrame', group: 'motion', label: 'Overlapping skater pairs (<2.5 ft) per live frame', unit: '/frame', digits: 3, compute: (g) => ratio(g.counts['motion.overlapPairs'], g.counts['motion.liveFrames']) },

  // --- Shape similarity vs coaching templates -------------------------------------------------
  ...SHAPE_TEMPLATES.flatMap((t): MetricDef[] => [
    {
      id: `shapeSim.${t.id}.attack`,
      group: 'shapeSim',
      label: `${t.label} — possessing team shape error`,
      unit: 'ft',
      digits: 1,
      headline: t.id === 'breakoutWall' || t.id === 'ozLowCycle',
      compute: (g) => ratio(g.shapes[t.id]?.attackErrSum, g.shapes[t.id]?.frames)
    },
    {
      id: `shapeSim.${t.id}.defend`,
      group: 'shapeSim',
      label: `${t.label} — defending team shape error`,
      unit: 'ft',
      digits: 1,
      headline: t.id === 'breakoutWall' || t.id === 'ozLowCycle',
      compute: (g) => ratio(g.shapes[t.id]?.defendErrSum, g.shapes[t.id]?.frames)
    },
    {
      id: `shapeSim.${t.id}.framesPerGame`,
      group: 'shapeSim',
      label: `${t.label} — matching frames per game`,
      unit: '/game',
      digits: 1,
      compute: (g) => ratio(g.shapes[t.id]?.frames ?? 0, g.games)
    }
  ])
]

function zoneShare(g: GameMetrics, prefix: string, z: 'oz' | 'nz' | 'dz'): number {
  const tot = (g.counts[`${prefix}oz`] ?? 0) + (g.counts[`${prefix}nz`] ?? 0) + (g.counts[`${prefix}dz`] ?? 0)
  return ratio(g.counts[`${prefix}${z}`], tot)
}

function foShare(g: GameMetrics, z: 'oz' | 'nz' | 'dz'): number {
  const tot = (g.counts['fo.home.oz'] ?? 0) + (g.counts['fo.home.nz'] ?? 0) + (g.counts['fo.home.dz'] ?? 0)
  return ratio(g.counts[`fo.home.${z}`], tot)
}

/**
 * What the current GameEvent stream cannot show, and the ADDITIVE field that
 * would make it measurable (owner approved additive-only changes to
 * src/domain/events.ts; the analyzer does not change the contract itself).
 */
export const UNOBSERVABLE: readonly UnobservableDef[] = [
  { id: 'shots.missedPerTeamGame', group: 'shots', label: 'Missed shots (wide/high/post)', needs: 'ShotEvent `result?: "onNet" | "wide" | "high" | "post" | "crossbar"` (or a new `missedShot` variant). The engine currently never misses the net — every unblocked attempt is saved or scores (NHL: 14.0 misses per team-game).' },
  { id: 'shots.typeMix', group: 'shots', label: 'Shot type mix (wrist/slap/snap/backhand/tip/deflection/wrap)', needs: 'ShotEvent `shotType?: ShotType`' },
  { id: 'shots.speedExact', group: 'shots', label: 'Exact shot / pass release speed (frames at 4 fps under-read fast pucks)', needs: 'ShotEvent `speedMph?: number`, PassEvent `speedMph?: number`' },
  { id: 'shots.origin', group: 'shots', label: 'Shot origin tag (rush / cycle / rebound / point / one-timer) as decided by the engine', needs: 'ShotEvent `origin?: "rush" | "cycle" | "rebound" | "point" | "oneTimer" | "wrap" | "faceoff"` and `oddMan?: { attackers: number; defenders: number }`' },
  { id: 'possession.passKind', group: 'possession', label: 'Pass kind (tape / saucer / bank / rim / stretch / drop / D-to-D) and interceptor', needs: 'PassEvent `kind?: PassKind`, `interceptedBy?: PlayerRef`' },
  { id: 'entries.explicit', group: 'entries', label: 'Zone entries/exits as decided (carry / dump / chip / pass; failed; blocked at the line)', needs: 'new variant `zoneEntry` { team, player, kind, pos, success, attackers?, defenders? } and `zoneExit` (additive)' },
  { id: 'physical.hitForce', group: 'physical', label: 'Hit force, hit kind (pin / finish / open-ice / board) and whether the target had the puck', needs: 'HitEvent `force?: number` (0..1), `kind?: HitKind`, `targetHadPuck?: boolean`' },
  { id: 'physical.boardBattles', group: 'physical', label: 'Board / net-front / loose-puck battles and who won them', needs: 'new variant `battle` { pos, players: PlayerRef[], winner: PlayerRef | null, kind: "boards" | "netFront" | "loosePuck", durationS }' },
  { id: 'physical.penaltyTypeMix', group: 'physical', label: 'Penalty types (tripping, hooking, slashing, holding, interference, roughing, high-sticking, cross-checking, boarding, delay of game, too many men …)', needs: 'PenaltyEvent `infraction` filled with the real infraction name (it is a string already — the engine writes "minor" for every non-fight); optional `drawnBy?: PlayerRef`' },
  { id: 'flow.stoppageReasons', group: 'flow', label: 'Stoppage reason on every whistle (icing / offside / freeze / puck out of play / high stick / hand pass / net off)', needs: 'StoppageEvent `reason` set on EVERY whistle (the optional field exists; the engine only sets it for goals). Additive union members: "puckOutOfPlay" | "highStick" | "handPass" | "netOff"' },
  { id: 'flow.lineChangeKind', group: 'flow', label: 'Line change on the fly vs at a stoppage, and bench-door timing', needs: 'LineChangeEvent `onTheFly?: boolean`' },
  { id: 'kinematics.orientation', group: 'kinematics', label: 'Body orientation: backward skating, pivots, crossovers, stops', needs: 'SkaterSnapshot `facing?: number` (radians) and `move?: "forward" | "backward" | "pivot" | "crossover" | "stop" | "glide"`' },
  { id: 'kinematics.velocity', group: 'kinematics', label: 'Exact velocity (finite differences at 4 fps smear acceleration/jerk)', needs: 'SkaterSnapshot `vel?: XY` (ft/s) — or raise frame rate for watched games' },
  { id: 'goalie.stance', group: 'goalie', label: 'Goalie stance (upright / butterfly / RVH / scramble), post-to-post pushes, save type, rebound placement', needs: 'FrameEvent `homeGoalieStance?`/`awayGoalieStance?`, SaveEvent `saveType?`, `reboundTo?: XY`, `netPos?: XY`' },
  { id: 'puck.height', group: 'shots', label: 'Puck height (saucer passes, high shots, chips off the glass)', needs: 'FrameEvent `puckZ?: number` (ft)' },
  { id: 'faceoff.detail', group: 'flow', label: 'Faceoff loser / takers and clean-win vs scrum', needs: 'FaceoffEvent `loser?: PlayerRef`, `clean?: boolean`' }
]
