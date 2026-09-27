#!/usr/bin/env node
/**
 * Build src/calibrate/matchTargets.json — the realism scorecard's targets.
 *
 *   node scripts/data/build-match-targets.mjs
 *
 * Inputs (all committed aggregates, no network):
 *   src/calibrate/targets.json          (legacy NHL-API aggregates, 60 games 2023-24)
 *   src/calibrate/nhlPbpAggregates.json (scripts/data/derive-nhl-pbp.mjs, same cache)
 *   the literature / estimate table below (every row cites its source + confidence)
 *
 * Bands: measured targets get a tolerance band around the NHL value; estimate
 * and design targets are bands only (value null) and are deliberately wide —
 * they exist to catch the obviously-wrong, not to tune to a number we do not
 * really know. Replace an estimate with a measured value the moment a legal
 * source for it exists.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const T = JSON.parse(readFileSync(join('src', 'calibrate', 'targets.json'), 'utf8'))
const P = JSON.parse(readFileSync(join('src', 'calibrate', 'nhlPbpAggregates.json'), 'utf8'))
const R = T.perTeamPerGame
const S = T.sequences

const around = (v, rel) => [+(v * (1 - rel)).toFixed(4), +(v * (1 + rel)).toFixed(4)]
const plusMinus = (v, abs) => [+(v - abs).toFixed(4), +(v + abs).toFixed(4)]
const m = (value, band, source, confidence, note) => ({ value, band, source, confidence, ...(note ? { note } : {}) })

const sources = {
  nhlApiLegacy: {
    title: 'NHL public API play-by-play (api-web.nhle.com), aggregates from the calibration cache',
    url: 'https://api-web.nhle.com/v1/gamecenter/{id}/play-by-play',
    license: 'NHL.com Terms of Service — personal/non-commercial use; automated compilation not authorised. FLAGGED for owner/legal review (docs/MATCH-DATA-SOURCES.md). Facts/aggregates only, nothing raw committed; no new fetching done for M0',
    dateRange: `${T.meta.season} regular season, ${T.meta.games}–${P.meta.games} evenly spaced games`,
    use: 'event rates, xG / shot-location grid, sequence proxies, hit locations, penalty/shot-type mixes'
  },
  zoneEntryTracking: {
    title: 'Public manual zone-entry tracking research (E. Tulsky, G. Detweiler, R. Spencer, C. Sznajder et al., "Using Zone Entry Data To Separate Offensive, Neutral, And Defensive Zone Performance", MIT Sloan Sports Analytics Conference 2013, and follow-up volunteer tracking projects)',
    license: 'Published research findings (facts), cited — no data copied',
    use: 'controlled-entry share band'
  },
  publicStatPages: {
    title: 'Widely published NHL figures noted by hand (NHL.com stat pages: average TOI per shift; NHL EDGE public leaderboards: top skating speeds ~24 mph, typical team neutral-zone time ~17–18%)',
    license: 'Individual public facts looked up manually for reference (no automated access); approximate — verify by hand when refreshing',
    use: 'shift length, top-speed and NZ-time bands'
  },
  sportsScience: {
    title: 'Skating biomechanics / sports-science literature (on-ice sprint acceleration ~3–6 m/s², lateral grip in tight turns ≲ 1 g, top in-game speeds 20–25 mph)',
    license: 'Published findings (facts), cited generally',
    use: 'acceleration, turning and speed-distribution bands (estimates)'
  },
  coachingTemplates: {
    title: 'Our own role-position diagrams of standard team systems (src/engine/analysis/shapes.ts), concepts checked against USA Hockey and Hockey Canada coach-education "team play / systems" material',
    license: 'Our original coordinates — no diagrams or text copied',
    use: 'shape-similarity targets'
  },
  design: {
    title: 'Owner / design requirements (docs/MATCH-ENGINE-PLAN.md gates; owner: "no backwards passing on rushes/breakaways")',
    license: 'n/a',
    use: 'motion gates, backward-pass bands, observability'
  }
}

const passesPerTeamGameNote = 'No legal public pass-count source; commercial trackers (Sportlogiq) report on the order of a few hundred passes per team-game. Wide estimate.'

const metrics = {
  // Kinematics (estimates)
  'kinematics.speedMean': m(null, [7, 14], 'sportsScience', 'estimate', 'mean over all live-play skater time, incl. standing/gliding'),
  'kinematics.speedP90': m(null, [13, 20], 'sportsScience', 'estimate'),
  'kinematics.speedP99': m(null, [17, 23.5], 'sportsScience', 'estimate'),
  'kinematics.shareAbove20': m(null, [0.002, 0.04], 'publicStatPages', 'estimate'),
  'kinematics.gameMaxMean': m(null, [19, 23.5], 'publicStatPages', 'estimate', 'EDGE per-game top speeds cluster ~20–22 mph'),
  'kinematics.gameMaxMax': m(null, [22, 25.5], 'publicStatPages', 'published', 'fastest EDGE-recorded skaters ≈ 24–25 mph'),
  'kinematics.bursts20': m(null, [0.3, 3], 'publicStatPages', 'estimate', 'EDGE 20+ mph burst leaders ≈ 2–3 per game; typical skater far fewer'),
  'kinematics.bursts22': m(null, [0.02, 0.6], 'publicStatPages', 'estimate'),
  'kinematics.milesPer60': m(null, [8, 14], 'publicStatPages', 'estimate', 'EDGE distance skated ≈ 3–5 mi per game at 15–25 min TOI'),
  'kinematics.accelP50': m(null, [1, 8], 'sportsScience', 'estimate'),
  'kinematics.accelP99': m(null, [8, 25], 'sportsScience', 'estimate', 'sprint starts peak ≈ 3–6 m/s² (10–20 ft/s²)'),
  'kinematics.tangAccelP99': m(null, [6, 20], 'sportsScience', 'estimate'),
  'kinematics.latAccelP99': m(null, [8, 32], 'sportsScience', 'estimate', '≤ ~1 g lateral grip'),
  'kinematics.jerkP95': m(null, [0, 120], 'design', 'design', 'catches bang-bang steering (max-accel twitch)'),
  'kinematics.radiusP5_20plus': m(null, [20, 250], 'sportsScience', 'estimate', 'r = v²/a_lat: 20 mph at ≤1 g → ≥ ~27 ft'),
  'kinematics.radiusP5_15to20': m(null, [10, 200], 'sportsScience', 'estimate'),

  // Team shape (estimates from coaching geometry)
  'shape.spacingAtt': m(null, [28, 55], 'coachingTemplates', 'estimate', 'template mean pairwise distance ≈ 35–50 ft'),
  'shape.spacingDef': m(null, [22, 45], 'coachingTemplates', 'estimate'),
  'shape.compactDef': m(null, [12, 30], 'coachingTemplates', 'estimate'),
  'shape.dPairDef': m(null, [15, 45], 'coachingTemplates', 'estimate'),
  'shape.pressureP50': m(null, [5, 16], 'coachingTemplates', 'estimate'),
  'shape.gapP50': m(null, [10, 35], 'coachingTemplates', 'estimate', 'coaching: "stick plus a stride" gap in the neutral zone'),
  'shape.attackersInOz': m(null, [3.5, 5], 'coachingTemplates', 'estimate'),
  'shape.defendersInDz': m(null, [3.5, 5], 'coachingTemplates', 'estimate'),

  // Possession
  'possession.passesPerTeam60': m(null, [150, 400], 'design', 'estimate', passesPerTeamGameNote),
  'possession.completion': m(null, [0.68, 0.88], 'design', 'estimate'),
  'possession.lengthMean': m(null, [18, 50], 'coachingTemplates', 'estimate'),
  'possession.speedMean': m(null, [25, 65], 'design', 'estimate', 'plan: passes ~30–60 mph; frames at 4 fps under-read'),
  'possession.backShare': m(null, [0.08, 0.3], 'design', 'design', 'D-to-D, wall-to-point and regroups are legitimately backward; everything else goes north'),
  'possession.backShare.oz': m(null, [0.12, 0.4], 'design', 'design', 'wall-to-point passes are backward by geometry'),
  'possession.backShare.nz': m(null, [0.05, 0.3], 'design', 'design'),
  'possession.backShare.dz': m(null, [0.03, 0.25], 'design', 'design'),
  'possession.backShare.rush': m(null, [0, 0.12], 'design', 'design', 'owner: no backward passing on rushes (a drop pass is the rare exception)'),
  'possession.backShare.oddMan': m(null, [0, 0.1], 'design', 'design'),
  'possession.backShare.breakaway': m(null, [0, 0.02], 'design', 'design', 'owner: never pass backwards on a breakaway'),
  'possession.fwdShare': m(null, [0.35, 0.65], 'design', 'estimate'),
  'possession.turnoversPerTeamGame': m(R.giveaways + R.takeaways, around(R.giveaways + R.takeaways, 0.2), 'nhlApiLegacy', 'measured'),
  'possession.giveawaysPerTeamGame': m(R.giveaways, around(R.giveaways, 0.2), 'nhlApiLegacy', 'measured'),
  'possession.takeawaysPerTeamGame': m(R.takeaways, around(R.takeaways, 0.2), 'nhlApiLegacy', 'measured'),

  // Entries
  'entries.perTeam60': m(null, [35, 80], 'zoneEntryTracking', 'estimate'),
  'entries.controlledShare': m(null, [0.4, 0.62], 'zoneEntryTracking', 'published', 'manual tracking: roughly half of entries are carried/passed in'),
  'entries.oddManPerTeamGame': m(null, [1, 6], 'design', 'estimate'),

  // Shots
  'shots.sogPerTeamGame': m(R.shotsOnGoal, around(R.shotsOnGoal, 0.12), 'nhlApiLegacy', 'measured'),
  'shots.goalsPerTeamGame': m(R.goals, around(R.goals, 0.12), 'nhlApiLegacy', 'measured'),
  'shots.shootingPct': m(T.shooting.shootingPct, around(T.shooting.shootingPct, 0.12), 'nhlApiLegacy', 'measured'),
  'shots.blockedShare': (() => {
    const v = R.blockedShots / (R.shotsOnGoal + R.missedShots + R.blockedShots)
    return m(+v.toFixed(4), plusMinus(v, 0.05), 'nhlApiLegacy', 'derived')
  })(),
  'shots.locationTvd': m(0, [0, 0.15], 'nhlApiLegacy', 'derived', 'distance×angle distribution vs NHL unblocked attempts (incl. misses; ours are SOG only)'),
  'shots.rushShareProxy': m(S.rushShotShare, plusMinus(S.rushShotShare, 0.1), 'nhlApiLegacy', 'measured', 'event-proxy definition identical to importNhl.ts'),
  'shots.reboundShareProxy': m(S.reboundShotShare, [0.035, 0.11], 'nhlApiLegacy', 'measured'),
  'shots.speedMean': m(null, [40, 80], 'publicStatPages', 'estimate', 'frames at 4 fps under-read fast shots'),

  // Physical
  'physical.hitsPerTeamGame': m(R.hits, around(R.hits, 0.15), 'nhlApiLegacy', 'measured'),
  'physical.hitBoardsShare': m(P.hits.boardsShare10ft, plusMinus(P.hits.boardsShare10ft, 0.06), 'nhlApiLegacy', 'measured', 'share of hits recorded within 10 ft of the boards'),
  'physical.hitByDShare': m(P.hits.byDShare, plusMinus(P.hits.byDShare, 0.08), 'nhlApiLegacy', 'measured'),
  'physical.hitOzShare': m(P.hits.zoneShareHitterPerspective.O, plusMinus(P.hits.zoneShareHitterPerspective.O, 0.1), 'nhlApiLegacy', 'measured'),
  'physical.penaltiesPerTeamGame': m(R.penalties, around(R.penalties, 0.2), 'nhlApiLegacy', 'measured'),
  'physical.penaltyTypes': m(P.penalties.distinctTypes, [10, 60], 'nhlApiLegacy', 'measured', 'distinct infraction names in the sample'),
  'physical.fightsPerGame': m(P.penalties.fightsPerGame, [0.08, 0.4], 'nhlApiLegacy', 'measured'),

  // Flow
  'flow.ozShareProxy': m(S.zoneTimeShare.offensive, plusMinus(S.zoneTimeShare.offensive, 0.08), 'nhlApiLegacy', 'measured', 'event-proxy'),
  'flow.nzShareProxy': m(S.zoneTimeShare.neutral, plusMinus(S.zoneTimeShare.neutral, 0.06), 'nhlApiLegacy', 'measured', 'event-proxy'),
  'flow.dzShareProxy': m(S.zoneTimeShare.defensive, plusMinus(S.zoneTimeShare.defensive, 0.08), 'nhlApiLegacy', 'measured', 'event-proxy'),
  'flow.nzShareFrames': m(null, [0.13, 0.24], 'publicStatPages', 'estimate', 'EDGE team zone-time pages show ~17–18% neutral'),
  'flow.faceoffsPerGame': m(R.faceoffs * 2, around(R.faceoffs * 2, 0.12), 'nhlApiLegacy', 'measured'),
  'flow.secBetweenFaceoffs': m(S.meanSecondsBetweenStoppages, around(S.meanSecondsBetweenStoppages, 0.18), 'nhlApiLegacy', 'measured'),
  'flow.foHomeOz': m(S.faceoffZoneMix.offensive, plusMinus(S.faceoffZoneMix.offensive, 0.07), 'nhlApiLegacy', 'measured'),
  'flow.foHomeNz': m(S.faceoffZoneMix.neutral, plusMinus(S.faceoffZoneMix.neutral, 0.07), 'nhlApiLegacy', 'measured'),
  'flow.foHomeDz': m(S.faceoffZoneMix.defensive, plusMinus(S.faceoffZoneMix.defensive, 0.07), 'nhlApiLegacy', 'measured'),
  'flow.foFollowShot10': m(P.faceoffs.winnerAttemptWithin10s, plusMinus(P.faceoffs.winnerAttemptWithin10s, 0.06), 'nhlApiLegacy', 'measured', 'NHL counts unblocked attempts incl. misses; ours SOG only'),
  'flow.whistleReasonCoverage': m(1, [0.95, 1], 'design', 'design', 'observability: every whistle should say why'),
  'flow.shiftMeanF': m(null, [36, 52], 'publicStatPages', 'published', 'NHL average forward TOI/shift ≈ 0:40–0:48'),
  'flow.shiftMeanD': m(null, [40, 58], 'publicStatPages', 'published', 'NHL average defence TOI/shift ≈ 0:45–0:55'),
  'flow.onTheFlyShare': m(null, [0.45, 0.85], 'design', 'estimate'),

  // Goalie
  'goalie.depthP50': m(null, [1, 5], 'sportsScience', 'estimate', 'modern goalies play at or just above the crease edge (crease = 6 ft)'),
  'goalie.angleErrP50': m(null, [0, 2], 'sportsScience', 'estimate'),
  'goalie.freezeShare': (() => {
    const saves = 2 * (R.shotsOnGoal - R.goals)
    const v = S.stoppagesPerGame.goalieFreeze / saves
    return m(+v.toFixed(4), plusMinus(v, 0.07), 'nhlApiLegacy', 'derived', 'goalie-freeze stoppages / saves')
  })(),

  // Motion quality
  'motion.teleportsLive': m(0, [0, 0], 'design', 'design', 'plan gate: 0 teleports'),
  'motion.teleportsDead': m(null, [0, 6], 'design', 'design'),
  'motion.overlapPerFrame': m(0, [0, 0.02], 'design', 'design', 'bodies occupy space')
}

// Shape-similarity bands (same for every template).
for (const id of ['breakoutWall', 'ozLowCycle', 'ozPointShot', 'nzRegroup', 'rushEntry', 'pp131', 'ppUmbrella']) {
  metrics[`shapeSim.${id}.attack`] = m(null, [0, 16], 'coachingTemplates', 'design', 'mean assigned distance to the textbook spot')
  metrics[`shapeSim.${id}.defend`] = m(null, [0, 16], 'coachingTemplates', 'design', 'mean assigned distance to the textbook spot')
}

const out = {
  meta: {
    generated: new Date().toISOString(),
    note: 'Realism-scorecard targets. Aggregates and bands only. Built by scripts/data/build-match-targets.mjs; sources and license verdicts in docs/MATCH-DATA-SOURCES.md.'
  },
  sources,
  metrics,
  shotGrid: {
    distanceEdges: T.xgSurface.distanceEdges,
    angleEdges: T.xgSurface.angleEdges,
    attempts: T.xgSurface.attempts
  },
  nhlMixes: {
    shotTypeShare: P.shots.typeShare,
    missedReasonShare: P.shots.missedReasonShare,
    penaltyTypeShare: P.penalties.typeShare,
    hitBoardDistShare5ftBins: P.hits.boardDistShare5ftBins,
    hitZoneShareHitterPerspective: P.hits.zoneShareHitterPerspective,
    missedPerTeamGame: P.shots.missedPerTeamGame
  }
}
writeFileSync(join('src', 'calibrate', 'matchTargets.json'), JSON.stringify(out, null, 2) + '\n')
console.log(`wrote src/calibrate/matchTargets.json (${Object.keys(metrics).length} metric targets)`)
