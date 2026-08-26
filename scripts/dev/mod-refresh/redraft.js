const fs=require('fs');const {index,match}=require('./dbmatch');
const ix=index(JSON.parse(fs.readFileSync('db_index.json','utf8')));
const picks=JSON.parse(fs.readFileSync('draft2026_full.json','utf8'));
const hits=[],miss=[];const how={};
for(const p of picks){
  if(!p.last||/forfeit/i.test(p.first+' '+p.last)) continue;
  if(!p.bd){miss.push(p);continue;}
  const m=match(ix,p.first,p.last,p.bd);
  if(m){how[m.how]=(how[m.how]||0)+1;hits.push({p,db:m.row,how:m.how});}else miss.push(p);
}
fs.writeFileSync('draft_hits.json',JSON.stringify(hits));
fs.writeFileSync('draft_miss.json',JSON.stringify(miss));
console.log('2026 picks in the DB:',hits.length,how,'| to create:',miss.length);
// guard: one DB player must not be claimed by two picks
const seen=new Map();for(const h of hits){if(seen.has(h.db.eid))console.log('  !! DOUBLE-CLAIM',h.db.name,'#'+h.p.overall,'and #'+seen.get(h.db.eid));seen.set(h.db.eid,h.p.overall);}
