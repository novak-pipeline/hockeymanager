const fs = require('fs');
const cwp = JSON.parse(fs.readFileSync('cw_players.json','utf8'));
const rosters = JSON.parse(fs.readFileSync('rosters2627.json','utf8'));
const strip = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'');
const soft = s => strip(s).replace(/ph/g,'f').replace(/ck/g,'k').replace(/sch/g,'s').replace(/[yij]+/g,'i')
  .replace(/kh/g,'h').replace(/ts/g,'c').replace(/([a-z])\1+/g,'$1').replace(/[aeou]/g,'');

const api = [];
for (const [tri, list] of Object.entries(rosters)) for (const p of list) {
  api.push({ tri, id: p.id, first: p.firstName.default, last: p.lastName.default, bd: p.birthDate, pos: p.positionCode, slot: p.slot,
    shoots: p.shootsCatches, hcm: p.heightInCentimeters, wkg: p.weightInKilograms, country: p.birthCountry, city: p.birthCity?.default, headshot: p.headshot });
}
const apiByBorn = new Map();
for (const a of api) { if (!apiByBorn.has(a.bd)) apiByBorn.set(a.bd, []); apiByBorn.get(a.bd).push(a); }

let matched = 0; const unmatched = [];
for (const c of cwp) {
  if (!c.born) continue;
  c.bd = `${c.born[0]}-${String(c.born[1]).padStart(2,'0')}-${String(c.born[2]).padStart(2,'0')}`;
  const last = strip(c.name.split(',')[0]);
  const cands = apiByBorn.get(c.bd) || [];
  const hit = cands.find(a => strip(a.last) === last) || cands.find(a => soft(a.last) === soft(last));
  if (hit) {
    Object.assign(c, { nhlId: hit.id, apiTri: hit.tri, first: hit.first, last: hit.last,
      shoots: c.shoots || hit.shoots, hcm: hit.hcm, wkg: hit.wkg, country: hit.country, city: hit.city, headshot: hit.headshot });
    matched++;
  } else {
    const parts = c.name.split(',');
    c.last = (parts[0]||'').trim(); c.first = (parts[1]||'').trim();
    unmatched.push(c);
  }
}
const dis = cwp.filter(c => c.nhlId && c.apiTri !== c.tri);
console.log('CW matched to NHL API:', matched, '| CW-only:', unmatched.length, '| team disagreements:', dis.length);
dis.forEach(d => console.log('   DISAGREE', d.name, 'CW:'+d.tri, 'API:'+d.apiTri));

const cwIds = new Set(cwp.filter(c=>c.nhlId).map(c=>c.nhlId));
const apiOnly = api.filter(a => !cwIds.has(a.id));
console.log('API-only (not on CapWages):', apiOnly.length);
apiOnly.forEach(a=>console.log('   ', a.tri, a.first, a.last, a.bd, a.pos));

// Canonical truth rows
const truth = [];
for (const c of cwp) truth.push({
  src: c.nhlId ? 'cw+api' : 'cw', tri: c.tri, bucket: c.bucket,
  first: c.first, last: c.last, bd: c.bd, born: c.born,
  pos: c.pos, status: c.status, shoots: c.shoots || null, sweater: c.sweater,
  capHit: c.capHit, years: c.years, clause: c.clause, expiry: c.expiry, proj: c.proj || null,
  draftYear: c.draftYear, nhlId: c.nhlId || null,
  hcm: c.hcm || null, wkg: c.wkg || null, country: c.country || null, city: c.city || null, headshot: c.headshot || null,
});
for (const a of apiOnly) truth.push({
  src: 'api', tri: a.tri, bucket: a.slot === 'G' ? 'non-roster' : 'non-roster',
  first: a.first, last: a.last, bd: a.bd, born: a.bd.split('-').map(Number),
  pos: a.pos, status: 'Minor', shoots: a.shoots, sweater: null,
  capHit: null, years: 0, clause: '', expiry: '', proj: null, draftYear: null, nhlId: a.id,
  hcm: a.hcm, wkg: a.wkg, country: a.country, city: a.city, headshot: a.headshot,
});
fs.writeFileSync('truth_players.json', JSON.stringify(truth));
console.log('TRUTH ROWS:', truth.length, '| NHL bucket:', truth.filter(t=>t.bucket==='roster').length);
