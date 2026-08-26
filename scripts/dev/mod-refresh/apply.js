/**
 * Roll mods/nhl-ehm/database.json from 2025-26 to 2026-27.
 * Reads the researched inputs in this folder; writes database.2026-27.json.
 * Every pass prints what it changed. See docs/MOD-DB-2026-UPDATE.md.
 */
const fs = require('fs');
const { load, walk } = require('./dbio');
const { faceKey } = require('./facekey');
const R = require('./ratings');

const IN  = process.env.IN  || 'K:/Hockey Game/mods/nhl-ehm/database.2025-26.pre-update.bak.json';
const OUT = process.env.OUT || 'K:/Hockey Game/mods/nhl-ehm/database.2026-27.json';
const SEASON_YEAR = 2026;             // 2026-27 season; EHM age = year - birthYear
const LEAGUE_MIN = 800000;            // lowest 2026-27 cap hit observed league-wide

const truthHits  = JSON.parse(fs.readFileSync('truth_hits.json', 'utf8'));
const plan       = JSON.parse(fs.readFileSync('plan.json', 'utf8'));
const landings   = JSON.parse(fs.readFileSync('landings.json', 'utf8'));
const draftHits  = JSON.parse(fs.readFileSync('draft_hits.json', 'utf8'));
const draftMiss  = JSON.parse(fs.readFileSync('draft_miss.json', 'utf8'));
const skaters    = JSON.parse(fs.readFileSync('skaters_20252026.json', 'utf8'));
const goalies    = JSON.parse(fs.readFileSync('goalies_20252026.json', 'utf8'));
const COUNTRY    = JSON.parse(fs.readFileSync('country_map.json', 'utf8'));
Object.assign(COUNTRY, { SVN: 'Slovenia', POL: 'Poland', GBR: 'United Kingdom', AUS: 'Australia', BEL: 'Belgium', CHN: 'China' });

const report = { passes: [] };
const note = (s) => { console.log(s); report.passes.push(s); };

/* ================= load + census ================= */
const db = load(IN);
const nhlTeams = new Map();
for (const c of db.conferences) for (const d of c.divisions) for (const t of d.teams) nhlTeams.set(t.abbreviation, t);
const comps = new Map(db.competitions.map((c) => [c.abbrev, c]));

const entries = [];           // every player object, duplicates included
for (const { p, loc } of walk(db)) entries.push({ p, loc });
// The source export reuses 7 externalIds across genuinely different players
// (same name + birth year, different birth dates). Make them unique so nothing
// is silently collapsed here or by the loader.
{
  const seen = new Set(), fixed = [];
  for (const { p } of entries) {
    if (!seen.has(p.externalId)) { seen.add(p.externalId); continue; }
    const m = /_(\d{1,2})_(\d{1,2})_\d{4}$/.exec(p.faceId || '');
    let id = m ? `${p.externalId}-${m[1]}${m[2]}` : `${p.externalId}-b`;
    let n = 2; while (seen.has(id)) id = `${p.externalId}-${n++}`;
    fixed.push(`${p.name}: ${p.externalId} -> ${id}`);
    p.externalId = id; seen.add(id);
  }
  report.dedupedIds = fixed;
  if (fixed.length) note(`de-duplicated ${fixed.length} clashing externalIds`);
}
const pool = new Map(entries.map((e) => [e.p.externalId, e]));
note(`loaded ${entries.length} players, ${nhlTeams.size} NHL clubs, ${comps.size} competitions`);

/** DOB decoded from the faceId (verified to round-trip for all 11,104 players). */
const dobOfPlayer = (p) => {
  const m = /_(\d{1,2})_(\d{1,2})_(\d{4})$/.exec(p.faceId || '');
  return m ? { y: +m[3], m: +m[2], d: +m[1] } : null;
};

/* ================= PASS 1 - ages ================= */
{
  let changed = 0, fallback = 0;
  const overAge = [];
  for (const entry of entries) {
    const p = entry.p;
    const dob = dobOfPlayer(p);
    const age = dob ? SEASON_YEAR - dob.y : p.age + 1;
    if (!dob) fallback++;
    if (age > 45) { overAge.push(p.externalId); entry.drop = 'age>45'; continue; }
    if (age !== p.age) changed++;
    p.age = Math.max(16, age);
  }
  note(`PASS 1 ages: recomputed as ${SEASON_YEAR}-birthYear; ${changed} changed, ${fallback} without a DOB fell back to age+1, ${overAge.length} would exceed 45 and are dropped`);
  report.agedOut = overAge;
}

/* ================= PASS 2 - placement plan ================= */
const target = new Map();
for (const a of plan.assign) target.set(a.eid, { kind: a.kind, team: a.team });
const retiredList = [];
for (const d of plan.departures) {
  if (d.action === 'retire') { target.set(d.eid, { kind: 'drop' }); retiredList.push(d.name); }
  else if (d.action === 'europe') target.set(d.eid, { kind: 'euro', euro: d.euro, team: d.team });
  else target.set(d.eid, { kind: 'ahl', team: d.team, unsigned: d.action === 'demote' });
}
for (const entry of entries) if (entry.drop) target.set(entry.p.externalId, { kind: 'drop' });
note(`PASS 2 placement: ${plan.assign.length} contracted players placed from source, ${retiredList.length} verified retirements removed`);
report.retired = retiredList;

/* ================= PASS 3 - contracts ================= */
const truthByEid = new Map();
for (const h of truthHits) if (!truthByEid.has(h.db.eid)) truthByEid.set(h.db.eid, h.t);

{
  let realDeals = 0, projDeals = 0, minDeals = 0, rolled = 0, renewed = 0, clauses = 0;
  for (const { p } of entries) {
    const t = truthByEid.get(p.externalId);
    if (t) {
      if (t.years > 0 && t.capHit) { p.contract = { salary: t.capHit, years: Math.max(1, Math.min(8, t.years)) }; realDeals++; }
      else if (t.proj) { p.contract = { salary: t.proj.capHit, years: t.proj.years }; projDeals++; }
      else { p.contract = { salary: LEAGUE_MIN, years: 1 }; minDeals++; }
      const cl = (t.clause || '').toUpperCase();
      if (cl.includes('NMC')) { p.contract.noMovementClause = true; p.contract.noTradeClause = true; clauses++; }
      else if (cl.includes('NTC')) { p.contract.noTradeClause = true; clauses++; }
    } else if (p.contract) {
      p.contract.years -= 1; rolled++;
      if (p.contract.years < 1) { p.contract.years = 1; renewed++; }
    }
  }
  note(`PASS 3 contracts: ${realDeals} from signed 2026-27 deals, ${projDeals} from CapWages projections (unsigned RFAs), ${minDeals} at the $${(LEAGUE_MIN / 1e6).toFixed(2)}M league minimum, ${clauses} real NTC/NMC clauses; ${rolled} non-NHL deals rolled a year (${renewed} expired and renewed 1y)`);
}

/* ================= PASS 4 - ratings from 2025-26 production ================= */
/** grp -> (statline) => expected overall on this DB's scale. Reused in PASS 6. */
const expectedOverall = {};
{
  const skById = new Map(skaters.map((s) => [s.playerId, s]));
  const gById = new Map(goalies.map((s) => [s.playerId, s]));
  const cohort = { F: [], D: [], G: [] };
  for (const [eid, t] of truthByEid) {
    if (!t.nhlId) continue;
    const p = pool.get(eid) && pool.get(eid).p;
    if (!p) continue;
    if (p.position === 'G') {
      const g = gById.get(t.nhlId);
      if (!g || g.gamesPlayed < 15) continue;
      cohort.G.push({ p, sv: g.savePct, gs: g.gamesStarted });
    } else {
      const s = skById.get(t.nhlId);
      if (!s || s.gamesPlayed < 20) continue;
      const toiHours = (s.timeOnIcePerGame || 0) * s.gamesPlayed / 3600;
      if (toiHours <= 0) continue;
      cohort[p.position === 'D' ? 'D' : 'F'].push({ p, p60: s.points / toiHours, atoi: s.timeOnIcePerGame });
    }
  }
  const deltas = [];
  for (const grp of ['F', 'D', 'G']) {
    const c = cohort[grp];
    if (c.length < 20) continue;
    let score;
    if (grp === 'G') {
      const msv = R.mean(c.map((x) => x.sv)), ssv = R.sd(c.map((x) => x.sv));
      const mgs = R.mean(c.map((x) => x.gs)), sgs = R.sd(c.map((x) => x.gs));
      score = (x) => 0.75 * ((x.sv - msv) / ssv) + 0.25 * ((x.gs - mgs) / sgs);
    } else {
      const mp = R.mean(c.map((x) => x.p60)), sp = R.sd(c.map((x) => x.p60));
      const mt = R.mean(c.map((x) => x.atoi)), st = R.sd(c.map((x) => x.atoi));
      score = (x) => 0.55 * ((x.p60 - mp) / sp) + 0.45 * ((x.atoi - mt) / st);
    }
    for (const x of c) x.score = score(x);
    const sortedScores = c.map((x) => x.score).sort((a, b) => a - b);
    const sortedOvr = c.map((x) => x.p.overall == null ? 55 : x.p.overall).sort((a, b) => a - b);
    expectedOverall[grp] = (statline) => R.quantile(sortedOvr, R.pct(sortedScores, score(statline)));
    const CAP = grp === 'G' ? 5 : 6;
    for (const x of c) {
      const before = x.p.overall == null ? 55 : x.p.overall;
      const expected = R.quantile(sortedOvr, R.pct(sortedScores, x.score));
      const d = Math.max(-CAP, Math.min(CAP, Math.round(0.5 * (expected - before))));
      if (d !== 0) { R.shift(x.p, d); deltas.push({ name: x.p.name, grp, d, from: before, to: x.p.overall }); }
    }
  }
  note(`PASS 4 ratings: ${cohort.F.length}F/${cohort.D.length}D/${cohort.G.length}G qualified on 2025-26 production; ${deltas.length} adjusted (${deltas.filter((d) => d.d > 0).length} up, ${deltas.filter((d) => d.d < 0).length} down), capped at +/-6 (+/-5 for goalies)`);
  report.ratingDeltas = deltas.sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
}

/* ================= PASS 5 - 2026 entry draft ================= */
{
  let flagged = 0;
  for (const h of draftHits) {
    const p = pool.get(h.db.eid) && pool.get(h.db.eid).p;
    if (!p) continue;
    p.nhlDrafted = true;
    p.nhlDraftEligible = false;
    p.draftYear = 2026;
    p.draftRound = h.p.round;
    p.draftOverall = h.p.overall;
    p.draftClub = h.p.team;
    flagged++;
  }
  note(`PASS 5 draft: flagged ${flagged} of the 224 real 2026 entry-draft picks that the DB already carried`);
  report.draftFlagged = flagged;
}

/* ================= PASS 6 - create missing players ================= */
const created = [];
{
  const skaterById = new Map(skaters.map((x) => [x.playerId, x]));
  const goalieById = new Map(goalies.map((x) => [x.playerId, x]));
  const existingIds = new Set(pool.keys());
  const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const mkId = (name, y) => {
    const base = `nhl-${slug(name)}-${y}`;
    let id = base, n = 2;
    while (existingIds.has(id)) id = `${base}-${n++}`;
    existingIds.add(id);
    return id;
  };
  const POS = (c) => (c === 'G' ? 'G' : /^[LR]?D$/.test(c || '') ? 'D' : c === 'C' ? 'C' : 'W');
  const ROLE = { G: 'starter', D: 'shutdownD', C: 'twoWay', W: 'twoWay' };

  // Tier/position baseline = the 35th percentile of the DB's own population for
  // that tier: a newly-added name is depth, not a median regular.
  const tierBase = { nhl: {}, ahl: {} };
  for (const tier of ['nhl', 'ahl']) {
    for (const pos of ['C', 'W', 'D', 'G']) {
      const vals = entries.filter((x) => x.loc.kind === tier && x.p.position === pos)
        .map((x) => (x.p.overall == null ? 55 : x.p.overall)).sort((a, b) => a - b);
      tierBase[tier][pos] = vals.length ? vals[Math.floor(vals.length * 0.35)] : 55;
    }
  }
  report.tierBaselines = tierBase;

  const mk = (o) => {
    const dob = o.bd ? o.bd.split('-').map(Number) : null;
    const age = dob ? SEASON_YEAR - dob[0] : 22;
    const pos = POS(o.pos);
    const p = {
      externalId: mkId(o.name, dob ? dob[0] : 2000),
      name: o.name,
      age: Math.max(16, Math.min(45, age)),
      position: pos,
      handedness: o.shoots === 'R' ? 'R' : 'L',
      overall: o.overall,
      potential: o.potential,
      role: ROLE[pos],
      nhlDrafted: !!o.drafted,
      nhlDraftEligible: !o.drafted && age <= 20,
    };
    if (o.potentialRange) p.potentialRange = o.potentialRange;
    if (dob) p.faceId = faceKey(o.name, dob[0], dob[1], dob[2]);
    if (o.contract) p.contract = o.contract;
    if (o.country && COUNTRY[o.country]) p.nationality = COUNTRY[o.country];
    if (o.city) p.birthplace = o.country ? `${o.city}, ${o.country}` : o.city;
    if (o.hcm) p.heightCm = o.hcm;
    if (o.wkg) p.weightKg = o.wkg;
    if (o.draft) { p.draftYear = o.draft.year; p.draftRound = o.draft.round; p.draftOverall = o.draft.overall; p.draftClub = o.draft.club; }
    created.push({ p, where: o.where });
    return p;
  };

  /* A person is "already here" if someone with the same birthdate and a
     near-identical name exists — in the DB or among the players created above.
     Sources spell transliterated names differently (Khazheev/Khazheyev) and a
     2026 draftee can also appear as an NHL-contracted minor-leaguer (Kralovic),
     so a plain string key is not enough. */
  const { strip: nstrip, lev: nlev } = require('./dbmatch');
  const bornIndex = new Map();
  const remember = (bd, name) => {
    if (!bd) return;
    if (!bornIndex.has(bd)) bornIndex.set(bd, []);
    bornIndex.get(bd).push(nstrip(name));
  };
  for (const { p } of entries) {
    const d = dobOfPlayer(p);
    if (d) remember(`${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`, p.name);
  }
  const alreadyHere = (bd, name) => {
    const key = nstrip(name);
    return (bornIndex.get(bd) || []).some((k) => k === key || nlev(k, key) <= 2);
  };

  // A 2026 draftee can also already be under an NHL contract (Kralovic, TBL #90).
  // He is created once, in 6a - but he still needs his draft record.
  const pickAt = new Map();
  for (const pk of JSON.parse(fs.readFileSync('draft2026_full.json', 'utf8')))
    if (pk.bd) pickAt.set(`${pk.bd}|${nstrip(pk.last || '')}`, pk);

  /* 6a - NHL-contracted players the DB does not have */
  for (const c of plan.creates) {
    if (!c.bd || !c.first || !c.last || c.first === 'undefined') {
      report.skippedCreates = (report.skippedCreates || []).concat([`${c.tri} ${c.first} ${c.last} (no usable name/birthdate in source)`]);
      continue;
    }
    if (alreadyHere(c.bd, `${c.first} ${c.last}`)) { report.dupSkipped = (report.dupSkipped || []).concat([`${c.first} ${c.last} (${c.bd})`]); continue; }
    remember(c.bd, `${c.first} ${c.last}`);
    const land = c.nhlId ? landings[c.nhlId] : null;
    const pos = POS((land && land.pos) || c.pos);
    const tier = c.kind === 'nhl' ? 'nhl' : 'ahl';
    const age = SEASON_YEAR - Number(c.bd.slice(0, 4));
    // Same rule as PASS 4: if he actually played enough NHL hockey in 2025-26,
    // read his overall straight off the production->overall mapping rather than
    // the tier baseline.
    let ov = tierBase[tier][pos];
    if (c.nhlId) {
      if (pos === 'G') {
        const g = goalieById.get(c.nhlId);
        if (g && g.gamesPlayed >= 15 && expectedOverall.G) ov = expectedOverall.G({ sv: g.savePct, gs: g.gamesStarted });
      } else {
        const st = skaterById.get(c.nhlId);
        const grp = pos === 'D' ? 'D' : 'F';
        if (st && st.gamesPlayed >= 20 && expectedOverall[grp]) {
          const toiHours = (st.timeOnIcePerGame || 0) * st.gamesPlayed / 3600;
          if (toiHours > 0) ov = expectedOverall[grp]({ p60: st.points / toiHours, atoi: st.timeOnIcePerGame });
        }
      }
    }
    mk({
      name: `${c.first} ${c.last}`, bd: c.bd, pos: (land && land.pos) || c.pos,
      shoots: c.shoots || (land && land.shoots), hcm: c.hcm || (land && land.hcm), wkg: c.wkg || (land && land.wkg),
      country: c.country || (land && land.country), city: c.city || (land && land.city),
      overall: ov, potential: Math.min(99, ov + (age <= 22 ? 12 : age <= 25 ? 6 : 2)),
      contract: c.years > 0 && c.capHit ? { salary: c.capHit, years: Math.max(1, Math.min(8, c.years)) }
        : c.proj ? { salary: c.proj.capHit, years: c.proj.years }
          : { salary: LEAGUE_MIN, years: 1 },
      drafted: true,
      ...(pickAt.has(`${c.bd}|${nstrip(c.last)}`)
        ? (() => { const pk = pickAt.get(`${c.bd}|${nstrip(c.last)}`);
                   return { draft: { year: 2026, round: pk.round, overall: pk.overall, club: pk.team } }; })()
        : {}),
      where: { kind: c.kind, team: c.tri },
    });
  }

  /* 6b - 2026 draft picks the DB does not have. Ratings come from the DB's OWN
     values for the 179 picks it already carries, bucketed by draft slot. */
  const CURVE = [
    [10, 48, 58, [50, 63]], [31, 42, 52, [45, 63]], [62, 42, 52, [44, 63]],
    [93, 38, 50, [42, 54]], [124, 42, 48, [42, 54]], [155, 41, 50, [42, 54]],
    [186, 38, 46, [40, 54]], [224, 40, 48, [40, 54]],
  ];
  const curveFor = (slot) => CURVE.find((c) => slot <= c[0]) || CURVE[CURVE.length - 1];
  for (const pk of draftMiss) {
    const nm = `${String(pk.first || '').replace(/\s*\(.*?\)\s*/g, ' ').trim()} ${pk.last || ''}`.trim();
    if (!nm || /forfeit/i.test(nm)) continue;
    if (!pk.bd) { report.skippedDraftees = (report.skippedDraftees || []).concat([`#${pk.overall} ${nm} (no birthdate found)`]); continue; }
    const birthYear = Number(pk.bd.slice(0, 4));
    if (SEASON_YEAR - birthYear > 22) { report.skippedDraftees = (report.skippedDraftees || []).concat([`#${pk.overall} ${nm} (birthdate ${pk.bd} implausible for a 2026 draftee - bad ID match)`]); continue; }
    if (alreadyHere(pk.bd, nm)) { report.dupSkipped = (report.dupSkipped || []).concat([`#${pk.overall} ${nm} (${pk.bd})`]); continue; }
    remember(pk.bd, nm);
    const cur = curveFor(pk.overall);
    mk({
      name: nm, bd: pk.bd, pos: pk.pos, shoots: null, hcm: pk.hcm, wkg: pk.wkg,
      country: pk.country, city: pk.city,
      overall: cur[1], potential: cur[2], potentialRange: cur[3],
      drafted: true, draft: { year: 2026, round: pk.round, overall: pk.overall, club: pk.team },
      where: { kind: 'junior', league: pk.amLeague, club: pk.amClub, team: pk.team },
    });
  }
  note(`PASS 6 creates: ${created.length} players added (${created.filter((c) => c.where.kind !== 'junior').length} NHL-contracted, ${created.filter((c) => c.where.kind === 'junior').length} 2026 draftees)`);
  report.created = created.map((c) => ({ name: c.p.name, age: c.p.age, pos: c.p.position, ov: c.p.overall, where: c.where }));
}

/* ================= PASS 7 - rebuild rosters ================= */
{
  const nhlRosters = new Map([...nhlTeams.keys()].map((t) => [t, []]));
  const ahlRosters = new Map([...nhlTeams.keys()].map((t) => [t, []]));
  const dropped = [], euroMoves = [], orphaned = [];

  for (const t of nhlTeams.values()) { t.players = []; if (t.affiliate) t.affiliate.players = []; }

  // Junior/college/European clubs lose whoever turned pro - but a club that is
  // emptied at a position can no longer ice quick-sim lines (0 goalies crashes
  // buildLinesFromRoster). So a club never drops below min(what it had,
  // ModCompetition's documented 2G/5D/9F floor); the lowest-rated leavers stay
  // put instead. Whoever stays is NOT placed on an NHL/AHL roster.
  const FLOOR = { G: 2, D: 5, F: 9 };
  const grpOf = (p) => (p.position === 'G' ? 'G' : p.position === 'D' ? 'D' : 'F');
  const retained = [];
  for (const c of comps.values()) {
    for (const t of c.teams) {
      const before = { G: 0, D: 0, F: 0 };
      for (const p of t.players) before[grpOf(p)]++;
      const leaving = t.players.filter((p) => target.has(p.externalId));
      const keep = new Set();
      for (const g of ['G', 'D', 'F']) {
        const want = Math.min(before[g], FLOOR[g]);
        const staying = t.players.filter((p) => grpOf(p) === g && !target.has(p.externalId)).length;
        let short = want - staying;
        if (short <= 0) continue;
        const pickable = leaving.filter((p) => grpOf(p) === g).sort((a, b) => (a.overall || 0) - (b.overall || 0));
        for (const p of pickable.slice(0, short)) {
          keep.add(p.externalId);
          target.delete(p.externalId);
          retained.push(`${p.name} stays with ${c.abbrev} ${t.abbreviation} (${g} floor)`);
        }
      }
      t.players = t.players.filter((p) => !target.has(p.externalId) || keep.has(p.externalId));
    }
  }
  if (retained.length) note(`  held back ${retained.length} newly-pro players so their amateur club can still ice lines`);
  report.retainedForFloor = retained;

  for (const { p, loc } of entries) {
    const tg = target.get(p.externalId);
    if (!tg) continue;
    if (tg.kind === 'drop') { dropped.push(p.name); continue; }
    if (tg.kind === 'euro') {
      const comp = comps.get(tg.euro.comp);
      const club = comp && comp.teams.find((t) => `${t.city} ${t.nickname}` === (tg.euro.dbClub || tg.euro.club));
      if (club) { club.players.push(p); euroMoves.push(`${p.name} -> ${tg.euro.comp} ${club.city} ${club.nickname}`); }
      else { const a = ahlRosters.get(tg.team); if (a) a.push(p); else orphaned.push(p.name); }
      continue;
    }
    const arr = (tg.kind === 'nhl' ? nhlRosters : ahlRosters).get(tg.team);
    if (arr) arr.push(p); else orphaned.push(`${p.name} (unknown club ${tg.team})`);
  }

  for (const { p, where } of created) {
    if (where.kind === 'nhl') { const a = nhlRosters.get(where.team); if (a) a.push(p); else orphaned.push(p.name); }
    else if (where.kind === 'ahl') { const a = ahlRosters.get(where.team); if (a) a.push(p); else orphaned.push(p.name); }
    else {
      const comp = comps.get(String(where.league || '').toUpperCase());
      const want = String(where.club || '').toUpperCase();
      const club = comp && comp.teams.find((t) => `${t.city} ${t.nickname}`.toUpperCase().includes(want));
      if (club) club.players.push(p);
      else { const a = ahlRosters.get(where.team); if (a) a.push(p); else orphaned.push(p.name); }
    }
  }

  // Roster-minimum repair: the validator floor is 17 skaters + 2 goalies.
  const promotions = [];
  for (const tri of nhlTeams.keys()) {
    const nhl = nhlRosters.get(tri), ahl = ahlRosters.get(tri);
    const promote = (isG, min) => {
      let have = nhl.filter((p) => (p.position === 'G') === isG).length;
      while (have < min) {
        const pick = ahl.filter((p) => (p.position === 'G') === isG)
          .sort((a, b) => (b.overall || 0) - (a.overall || 0))[0];
        if (!pick) break;
        ahl.splice(ahl.indexOf(pick), 1);
        nhl.push(pick);
        promotions.push(`${tri}: ${pick.name}`);
        have++;
      }
    };
    promote(true, 2);
    promote(false, 17);
  }

  for (const [tri, t] of nhlTeams) {
    t.players = nhlRosters.get(tri);
    if (t.affiliate) t.affiliate.players = ahlRosters.get(tri);
    else t.players.push(...ahlRosters.get(tri));
  }
  const nhlN = [...nhlRosters.values()].reduce((a, x) => a + x.length, 0);
  const ahlN = [...ahlRosters.values()].reduce((a, x) => a + x.length, 0);
  note(`PASS 7 rosters: ${nhlN} on NHL rosters, ${ahlN} in AHL affiliates; ${dropped.length} removed (retired / aged out), ${euroMoves.length} moved to a European league, ${promotions.length} promoted to meet roster minimums, ${orphaned.length} orphaned`);
  report.dropped = dropped; report.euroMoves = euroMoves; report.promotions = promotions; report.orphaned = orphaned;
}

/* ================= PASS 8 - meta ================= */
db.meta.season = '2026-27';
db.meta.name = 'NHL (EHM import, dev) - 2026-27';
note(`PASS 8 meta: season "${db.meta.season}"`);

/* ================= write ================= */
fs.writeFileSync(OUT, JSON.stringify(db));
let total = 0;
for (const _ of walk(db)) total++;
note(`WROTE ${OUT} - ${total} players, ${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB`);
fs.writeFileSync('apply_report.json', JSON.stringify(report, null, 1));
