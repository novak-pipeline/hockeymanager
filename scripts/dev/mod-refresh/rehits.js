const fs=require('fs');const {index,match}=require('./dbmatch');
const ix=index(JSON.parse(fs.readFileSync('db_index.json','utf8')));
const truth=JSON.parse(fs.readFileSync('truth_players.json','utf8'));
const hits=[],miss=[];const how={};
for(const t of truth){const m=match(ix,t.first,t.last,t.bd);
 if(m){how[m.how]=(how[m.how]||0)+1;hits.push({t,db:m.row,how:m.how});}else miss.push(t);}
fs.writeFileSync('truth_hits.json',JSON.stringify(hits));
fs.writeFileSync('truth_miss.json',JSON.stringify(miss));
console.log('truth_hits',hits.length,how,'miss',miss.length,'| with proj:',hits.filter(h=>h.t.proj).length);
