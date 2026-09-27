/**
 * Match analysis — the M0 realism scorecard (docs/MATCH-ENGINE-PLAN.md).
 *
 *   analyzeGame(stream, meta) → GameMetrics        per game, additive
 *   aggregate(games)          → GameMetrics        summed distributions
 *   compare(dist, targets)    → Scorecard          pass/fail vs NHL bands
 *
 * Plus the shape templates (coaching-system role positions), the reference
 * replay converter and the side-by-side eye-test page.
 */
export { analyzeGame, aggregate, emptyMetrics, HIST_SPECS, DEFAULT_ANGLE_EDGES, DEFAULT_DISTANCE_EDGES } from './analyze'
export type { GameMeta, GameMetrics } from './analyze'
export { compare, scorecardMarkdown } from './compare'
export type { Confidence, MatchTargets, MetricTarget, Scorecard, ScorecardRow, Verdict } from './compare'
export { METRICS, UNOBSERVABLE } from './metrics'
export type { MetricDef, MetricGroup, UnobservableDef } from './metrics'
export { SHAPE_TEMPLATES, assignShape, scoreShapes } from './shapes'
export type { RolePoint, ShapeAccum, ShapeTemplate } from './shapes'
export { trackingToStream, templateSequence, findSituationClip } from './reference'
export type { TrackedFrame, TrackedPlayer, TrackedSequence } from './reference'
export { sideBySideHtml } from './replayHtml'
export { histMean, histQuantile, histShareAbove, tvd } from './hist'
export type { Hist, Grid } from './hist'
