const fs = require('fs');
const DB_PATH = 'K:/Hockey Game/mods/nhl-ehm/database.json';
function load(p = DB_PATH) { return JSON.parse(fs.readFileSync(p, 'utf8')); }
function save(db, p) { fs.writeFileSync(p, JSON.stringify(db)); }

/** Walk every player in the DB, yielding {p, loc} where loc describes where it lives. */
function* walk(db) {
  for (const c of db.conferences) for (const d of c.divisions) for (const t of d.teams) {
    for (let i = 0; i < t.players.length; i++)
      yield { p: t.players[i], loc: { kind: 'nhl', conf: c.name, div: d.name, team: t.abbreviation, teamObj: t, arr: t.players, idx: i } };
    if (t.affiliate) for (let i = 0; i < t.affiliate.players.length; i++)
      yield { p: t.affiliate.players[i], loc: { kind: 'ahl', team: t.abbreviation, parent: t, teamObj: t.affiliate, arr: t.affiliate.players, idx: i } };
  }
  for (const comp of (db.competitions || [])) for (const t of comp.teams) {
    for (let i = 0; i < t.players.length; i++)
      yield { p: t.players[i], loc: { kind: 'comp', comp: comp.abbrev, compId: comp.id, compObj: comp, team: t.abbreviation, teamObj: t, arr: t.players, idx: i } };
  }
}

/** faces/<key>.png naming: lowercase, spaces->_, d_m_yyyy with NO zero padding. */
function faceKey(first, last, birthDate /* 'YYYY-MM-DD' */) {
  const [y, m, d] = birthDate.split('-').map(Number);
  const norm = (s) => s.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // strip accents
    .replace(/['’]/g, '').replace(/\s+/g, '_');
  return `${norm(first)}_${norm(last)}_${d}_${m}_${y}`;
}
/** Normalised name-only key for fuzzy joins. */
function nameKey(name) {
  return name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/['’.\-]/g, '').replace(/\s+/g, ' ').trim();
}
module.exports = { load, save, walk, faceKey, nameKey, DB_PATH };
