const fs = require('fs');
const cw = JSON.parse(fs.readFileSync('cw_all.json', 'utf8'));
const MON = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
function parseBorn(s) {           // "Aug. 7, 1987" -> [1987,8,7]
  if (!s) return null;
  // CapWages emits both "Aug. 7, 1987" and the comma-less "Mar 15 2002".
  const m = /^([A-Z][a-z]{2})\.?\s+(\d{1,2}),?\s*(\d{4})$/.exec(s.trim());
  if (!m) return null;
  return [ +m[3], MON[m[1]], +m[2] ];
}
const money = s => (typeof s === 'string' ? Number(s.replace(/[$,]/g, '')) : (typeof s === 'number' ? s : null));

const SEASONS = ['2026-27','2027-28','2028-29','2029-30','2030-31','2031-32','2032-33','2033-34','2034-35'];

// CapWages' own projected next contract, used ONLY for players with no signed
// 2026-27 deal (unsigned RFAs). Sourced estimate, never our invention.
const proj = {};
for (const pp of Object.values(cw)) for (const p of (pp.projections || [])) {
  // CapWages emits both a base projection and a "(LT)" long-term variant for
  // some players. Prefer the base row.
  const isLT = /\(LT\)/.test(p.name || '');
  if (proj[p.slug] && isLT) continue;
  proj[p.slug] = { capHit: money(p.projectedCapHit), years: Math.max(1, Math.min(8, parseInt(p.projectedLength, 10) || 1)), lt: isLT };
}

const rows = [];
for (const [tslug, pp] of Object.entries(cw)) {
  const tri = pp.teamMetadata.tricode;
  for (const bucket of ['roster', 'non-roster']) {
    const b = pp.data[bucket]; if (!b) continue;
    // Iterate EVERY group, not just F/D/G: CapWages also emits injury groups
    // ("Season-Ending Injured Reserve", "Long Term Injured Reserve", …) that
    // hold real rostered players (Pietrangelo, Ryan Ellis).
    for (const grp of Object.keys(b)) {
      if (!Array.isArray(b[grp])) continue;
      for (const p of b[grp]) {
        // Contract seasons still to run, newest deal first.
        const seasonMap = {};
        for (const c of (p.contracts || [])) {
          for (const d of (c.details || [])) {
            if (!seasonMap[d.season]) seasonMap[d.season] = { capHit: money(d.capHit), clause: d.clause || '', expiry: c.expiryStatus || '', type: c.type || '' };
          }
        }
        let years = 0, capHit = null, clause = '', expiry = '';
        for (const s of SEASONS) {
          if (seasonMap[s]) { years++; if (capHit === null) { capHit = seasonMap[s].capHit; clause = seasonMap[s].clause; expiry = seasonMap[s].expiry; } }
          else if (years > 0) break;
        }
        rows.push({
          tri, bucket, grp,
          name: p.name, slug: p.slug,
          born: parseBorn(p.born), bornRaw: p.born,
          pos: p.officialPosition || p.pos, status: p.status,
          shoots: p.shootsCatches, sweater: p.sweaterNumber ?? null,
          draftYear: p.draft_year ?? null,
          capHit, years, clause, expiry,
          terms: p.terms || '',
          proj: proj[p.slug] || null,
        });
      }
    }
  }
}
fs.writeFileSync('cw_players.json', JSON.stringify(rows));
console.log('players', rows.length);
console.log('with 2026-27 contract', rows.filter(r => r.years > 0).length, ' without', rows.filter(r => !r.years).length);
console.log('with parsed born', rows.filter(r => r.born).length);
const capSeasons = Object.values(cw)[0].seasons;
console.log('salary cap table', JSON.stringify(capSeasons));
// sanity: biggest cap hits
rows.filter(r=>r.years>0).sort((a,b)=>b.capHit-a.capHit).slice(0,15).forEach(r=>console.log(' ', r.tri, r.name, '$'+(r.capHit/1e6).toFixed(2)+'M', r.years+'y', r.clause||'-', r.expiry));
