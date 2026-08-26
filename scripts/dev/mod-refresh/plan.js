/**
 * Decide, for every player in the world, where he belongs for 2026-27.
 * Emits plan.json consumed by apply.js. No DB mutation happens here.
 */
const fs = require('fs');
const { index, match, dobOf } = require('./dbmatch');

const dbIndex = JSON.parse(fs.readFileSync('db_index.json','utf8'));
const ix = index(dbIndex);
const truth = JSON.parse(fs.readFileSync('truth_players.json','utf8'));

/* ── Verified retirements (NHL.com 2026-27 free-agency tracker "Retirements",
      plus individually-sourced announcements). Keyed by name|birthYear. ── */
const RETIRED = [
  'Jonathan Quick','Anze Kopitar','Jonathan Toews','Jordan Oesterle',
  'Shea Weber','Carey Price','Max McCormick','Andrew Agozzino','Gannon Laroque',
];
/* ── Verified moves out of the NHL to a European league (club → DB competition). ── */
// `dbClub` is the EHM-fictionalised club name this DB actually uses. EHM strips
// KHL club identities, so "Moskva Moskva" appears twice (Dynamo and Spartak) and
// the two cannot be told apart — Fedotov is placed on the first of them.
const EUROPE = {
  'Ivan Fedotov':   { comp: 'KHL', club: 'Spartak Moscow',  dbClub: 'Moskva Moskva' },
  'Yegor Zamula':   { comp: 'KHL', club: 'CSKA Moscow',     dbClub: 'Moskva Armeitsy' },
  'Ivan Prosvetov': { comp: 'KHL', club: 'Avangard Omsk',   dbClub: 'Omsk Omsk' },
};

/* ── 1. Truth → DB assignment ── */
const assign = new Map();       // db externalId -> {kind:'nhl'|'ahl', team, truth}
const creates = [];             // truth rows with no DB player
const claimed = new Set();
for (const t of truth) {
  const m = match(ix, t.first, t.last, t.bd);
  // CapWages bucket is the source of truth for NHL roster vs minors. Two
  // exceptions: a player on season-ending IR and a PTO body are parked in the
  // affiliate — this sim has no LTIR and no way to import "already injured", so
  // leaving them on the NHL roster would both break the cap and hand the club a
  // phantom regular. (Krug/STL, Pietrangelo/VGK, Petersen/WSH.)
  const parked = t.status === 'IR' || t.status === 'PTO';
  const kind = t.bucket === 'roster' && !parked ? 'nhl' : 'ahl';
  if (!m) { creates.push({ ...t, kind }); continue; }
  if (claimed.has(m.row.eid)) {           // duplicate truth row for one player
    continue;
  }
  claimed.add(m.row.eid);
  assign.set(m.row.eid, { kind, team: t.tri, truth: t, dbKind: m.row.kind, dbTeam: m.row.team, dbComp: m.row.comp });
}

/* ── 2. Everyone currently on an NHL or AHL roster who is NOT in the truth set ── */
const departures = [];
for (const r of dbIndex) {
  if (r.kind !== 'nhl' && r.kind !== 'ahl') continue;
  if (assign.has(r.eid)) continue;
  const retired = RETIRED.includes(r.name);
  const euro = EUROPE[r.name];
  departures.push({
    eid: r.eid, name: r.name, team: r.team, kind: r.kind, age: r.age, pos: r.pos, ov: r.ov,
    action: retired ? 'retire' : euro ? 'europe' : (r.kind === 'nhl' ? 'demote' : 'stay'),
    ...(euro ? { euro } : {}),
  });
}

fs.writeFileSync('plan.json', JSON.stringify({
  assign: [...assign.entries()].map(([eid, v]) => ({ eid, ...v })),
  creates, departures,
}, null, 1));

const byAction = departures.reduce((a,d)=>{a[d.action]=(a[d.action]||0)+1;return a;},{});
console.log('assignments', assign.size, '| creates', creates.length, '| departures', departures.length, byAction);
const moves = [...assign.values()].filter(v => v.dbKind !== v.kind || v.dbTeam !== v.team);
console.log('players changing club/tier:', moves.length);
const intoNhl = moves.filter(m=>m.kind==='nhl');
console.log('  -> onto an NHL roster:', intoNhl.length, '| -> into an AHL affiliate:', moves.length-intoNhl.length);
console.log('  sources:', moves.reduce((a,m)=>{const k=m.dbComp?('comp:'+m.dbComp):m.dbKind;a[k]=(a[k]||0)+1;return a;},{}));
