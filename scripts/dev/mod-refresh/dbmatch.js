const strip = s => (s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z]/g,'');
const soft = s => strip(s).replace(/ph/g,'f').replace(/ck/g,'k').replace(/sch/g,'s').replace(/[yij]+/g,'i')
  .replace(/kh/g,'h').replace(/ts/g,'c').replace(/([a-z])\1+/g,'$1').replace(/[aeou]/g,'');
/** Levenshtein, capped. */
function lev(a,b){const m=a.length,n=b.length;if(Math.abs(m-n)>4)return 99;let prev=[...Array(n+1).keys()];
 for(let i=1;i<=m;i++){const cur=[i];for(let j=1;j<=n;j++)cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur;}return prev[n];}

function dobOf(faceId){const m=/_(\d{1,2})_(\d{1,2})_(\d{4})$/.exec(faceId||'');
 return m ? `${m[3]}-${String(+m[2]).padStart(2,'0')}-${String(+m[1]).padStart(2,'0')}` : null;}

/** Build indexes over rows shaped {name, face, ...}. */
function index(rows){
  const byDob = new Map();
  for(const r of rows){ const d = dobOf(r.face); if(!d) continue; if(!byDob.has(d)) byDob.set(d,[]); byDob.get(d).push(r); r._dob = d; }
  const byFull = new Map();
  for(const r of rows){ const k = strip(r.name); if(!byFull.has(k)) byFull.set(k,[]); byFull.get(k).push(r); }
  return { byDob, byFull, rows };
}

/**
 * Match one truth row {first,last,bd} against the DB index.
 * Tiers: exact DOB + exact last | DOB + soft last | DOB + fuzzy last (lev<=2)
 *        | DOB alone (unique) | exact full name (unique).
 */
function match(ix, first, last, bd){
  const cands = ix.byDob.get(bd) || [];
  const L = strip(last), F = strip(first);
  const lastOf = r => strip(r.name.split(' ').slice(1).join(' ')) || strip(r.name);
  const firstOf = r => strip(r.name.split(' ')[0]);
  // Twins exist (Liam and Markus Ruck: same birthday, same club, both drafted by
  // Pittsburgh in 2026), so a shared birthdate + surname is NOT unique. When more
  // than one candidate survives the surname test, the first name decides.
  const pick2 = (list) => (list.length === 1 ? list[0] : null);
  const pick = (list) => {
    if (list.length <= 1) return list[0];
    return list.find(r => firstOf(r) === F) || list.find(r => lev(firstOf(r), F) <= 2) || null;
  };
  let h = pick(cands.filter(r => lastOf(r) === L));             if (h) return {row:h, how:'dob+last'};
  h = pick(cands.filter(r => soft(lastOf(r)) === soft(L)));     if (h) return {row:h, how:'dob+softlast'};
  h = pick(cands.filter(r => lev(lastOf(r), L) <= 2));          if (h) return {row:h, how:'dob+fuzzylast'};
  // NOTE: DOB alone is NOT sufficient — the DB has many same-DOB players and a
  // DOB-only join produced verified false positives (Geertsen -> Saros). Require
  // last-name evidence, or an exact unique full-name hit.
  // Sources disagree on where a multi-word surname starts ("Molgaard, Oscar
  // Fisker" vs "Oscar Fisker Mølgaard"), which defeats a surname-only test.
  // Same birthdate + a near-identical FULL name is decisive.
  const FULL = strip(first + last);
  h = pick2(cands.filter(r => strip(r.name) === FULL));            if (h) return {row:h, how:'dob+fullname'};
  h = pick2(cands.filter(r => lev(strip(r.name), FULL) <= 2));     if (h) return {row:h, how:'dob+fuzzyfull'};
  const full = ix.byFull.get(FULL);
  if (full && full.length === 1) return {row: full[0], how:'fullname'};
  return null;
}
module.exports = { index, match, dobOf, strip, soft, lev };
