/**
 * Rating adjustment rule — see docs/MOD-DB-2026-UPDATE.md.
 *
 * The loader (src/data/modSchema.ts buildModPlayer) DERIVES a player's effective
 * rating from his `attributes`, not from the `overall` shorthand: `overall` only
 * fills attributes the mod omits, and this DB supplies all 33. So a rating change
 * must move ATTRIBUTES.
 *
 * Every composite in src/engine/ratings/composites.ts is a NORMALISED weighted
 * average of raw attributes, and `overall()` is a fixed convex combination of
 * composites. Therefore adding the same delta D to every attribute that feeds a
 * position's overall shifts that overall by exactly D (modulo the 1..99 clamp).
 * That is the whole rule: a uniform shift of the overall-driving attribute set.
 * Character/style attributes (aggression, discipline, faceoffs, checking,
 * strength, fighting, flair, leadership, …) are deliberately untouched — one
 * season of box-score production is no evidence about them.
 */

// Attributes that feed overall(), per position. Derived from SKATER_WEIGHTS /
// GOALIE_WEIGHTS and the overall() convex combination in composites.ts.
const F_ATTRS = ['wristShot','slapShot','deflections','offensiveIQ','composure','anticipation',
                 'passing','vision','stickhandling','balance','agility',
                 'speed','acceleration','stamina',
                 'defensiveIQ','positioning','stickChecking','shotBlocking'];
const D_ATTRS = ['defensiveIQ','positioning','stickChecking','shotBlocking','anticipation',
                 'speed','acceleration','agility','balance','stamina',
                 'takeaway','workRate',
                 'passing','vision','offensiveIQ','stickhandling',
                 'wristShot','slapShot','deflections','composure'];
const G_ATTRS = ['reflexes','positioningG','glove','blocker','reboundControl','recovery','composure','anticipation'];

function attrsFor(pos) { return pos === 'G' ? G_ATTRS : pos === 'D' ? D_ATTRS : F_ATTRS; }

/** Apply a uniform delta to the overall-driving attributes. Returns points actually moved. */
function shift(player, delta) {
  if (!delta) return 0;
  const keys = attrsFor(player.position);
  const a = player.attributes || (player.attributes = {});
  for (const k of keys) {
    const cur = a[k];
    if (typeof cur !== 'number') continue;          // never invent an absent attribute
    a[k] = Math.max(1, Math.min(99, Math.round(cur + delta)));
  }
  if (typeof player.overall === 'number') player.overall = Math.max(1, Math.min(99, Math.round(player.overall + delta)));
  // Keep potential >= overall and move the ceiling with the floor when a player
  // has already climbed past his stored ceiling.
  if (typeof player.potential === 'number' && typeof player.overall === 'number' && player.potential < player.overall)
    player.potential = player.overall;
  if (Array.isArray(player.potentialRange) && typeof player.overall === 'number') {
    const [lo, hi] = player.potentialRange;
    player.potentialRange = [Math.max(1, Math.min(99, Math.max(lo, player.overall))),
                             Math.max(1, Math.min(99, Math.max(hi, player.overall)))];
  }
  return delta;
}

/* ---- percentile helpers ---- */
function mean(xs){return xs.reduce((a,b)=>a+b,0)/xs.length;}
function sd(xs){const m=mean(xs);return Math.sqrt(mean(xs.map(x=>(x-m)**2)))||1;}
/** Value -> [0,1] percentile within a sorted ascending array. */
function pct(sorted, v){let lo=0,hi=sorted.length;while(lo<hi){const m=(lo+hi)>>1;if(sorted[m]<v)lo=m+1;else hi=m;}return sorted.length?lo/sorted.length:0.5;}
/** Percentile [0,1] -> value from a sorted ascending array. */
function quantile(sorted,p){if(!sorted.length)return 55;const i=Math.min(sorted.length-1,Math.max(0,Math.round(p*(sorted.length-1))));return sorted[i];}

module.exports = { F_ATTRS, D_ATTRS, G_ATTRS, attrsFor, shift, mean, sd, pct, quantile };
