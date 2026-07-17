#!/usr/bin/env node
/**
 * Builds a self-contained "war room" dashboard from docs/autopilot/trace-latest.json.
 * Writes two files:
 *   docs/autopilot/dashboard.html        — full standalone, double-click to open locally
 *   docs/autopilot/dashboard.body.html   — body-only, for publishing as an Artifact
 * Run:  npm run autopilot:dashboard
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), 'docs', 'autopilot')
const trace = JSON.parse(readFileSync(join(DIR, 'trace-latest.json'), 'utf8'))

const BODY = `
<title>Autopilot War Room — ${trace.meta.userTeamName}</title>
<style>
  :root {
    --ground:#0b0f16; --panel:#121a24; --panel2:#0e151d; --line:#233140; --line2:#2f4356;
    --ink:#e8eef6; --muted:#8ea3b8; --faint:#5f7488;
    --accent:#38e1c8; --accent-dim:#1c6f66;
    --good:#4bd583; --warn:#f0b545; --crit:#ff5d6c;
    --contend:#38e1c8; --retool:#6aa6ff; --rebuild:#c58bf0;
    --r:14px; --r-sm:9px;
    font-synthesis:none; -webkit-font-smoothing:antialiased;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:radial-gradient(1200px 600px at 70% -10%, #16222f 0%, var(--ground) 55%) fixed; color:var(--ink);
    font-family:"Inter",system-ui,-apple-system,Segoe UI,Roboto,sans-serif; line-height:1.5; }
  .wrap { max-width:1120px; margin:0 auto; padding:34px 24px 80px; }
  .mono { font-variant-numeric:tabular-nums; font-feature-settings:"tnum"; }
  .eyebrow { text-transform:uppercase; letter-spacing:.16em; font-size:11px; font-weight:600; color:var(--faint); }

  /* scoreboard header */
  header.board { border:1px solid var(--line); border-radius:var(--r); background:linear-gradient(180deg,var(--panel),var(--panel2));
    padding:22px 24px; display:flex; flex-wrap:wrap; align-items:flex-end; gap:22px 34px; position:relative; overflow:hidden; }
  header.board::before { content:""; position:absolute; inset:0 auto 0 0; width:4px; background:linear-gradient(180deg,var(--accent),transparent); }
  .club h1 { margin:.1em 0 .12em; font-size:clamp(26px,4vw,40px); font-weight:800; letter-spacing:-.02em; text-wrap:balance; }
  .club .sub { color:var(--muted); font-size:13px; }
  .bugs { display:flex; gap:26px; margin-left:auto; flex-wrap:wrap; }
  .bug { text-align:right; }
  .bug .n { font-size:26px; font-weight:800; line-height:1; }
  .bug .l { font-size:10.5px; text-transform:uppercase; letter-spacing:.12em; color:var(--faint); margin-top:6px; }
  .bug.crit .n { color:var(--crit); } .bug.good .n { color:var(--good); } .bug.accent .n { color:var(--accent); }

  h2.sec { font-size:13px; text-transform:uppercase; letter-spacing:.15em; color:var(--muted); font-weight:700;
    margin:38px 0 14px; display:flex; align-items:center; gap:10px; }
  h2.sec::after { content:""; flex:1; height:1px; background:var(--line); }

  /* season strip */
  .seasons { display:grid; grid-template-columns:repeat(auto-fill,minmax(215px,1fr)); gap:14px; }
  .scard { border:1px solid var(--line); border-radius:var(--r); background:var(--panel); padding:16px 17px; display:flex; flex-direction:column; gap:11px; }
  .scard .yr { display:flex; align-items:baseline; justify-content:space-between; }
  .scard .yr b { font-size:22px; font-weight:800; letter-spacing:-.01em; }
  .pill { font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; padding:4px 9px; border-radius:999px; border:1px solid transparent; white-space:nowrap; }
  .pill.contend { color:var(--contend); border-color:var(--accent-dim); background:#0f2320; }
  .pill.retool  { color:var(--retool);  border-color:#2c4a7a; background:#12203a; }
  .pill.rebuild { color:var(--rebuild); border-color:#4a3560; background:#1e1530; }
  .scard .rec { font-size:20px; font-weight:700; }
  .scard .rec .pts { color:var(--muted); font-size:13px; font-weight:500; }
  .result { font-size:13px; font-weight:600; }
  .result.champ { color:var(--accent); } .result.miss { color:var(--faint); } .result.po { color:var(--good); }
  .scard .foot { display:flex; gap:14px; font-size:12px; color:var(--muted); margin-top:auto; padding-top:4px; border-top:1px solid var(--line); }
  .scard .foot .dot { color:var(--faint); }

  /* journal */
  .filters { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
  .chip { font-size:12px; color:var(--muted); background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:6px 13px; cursor:pointer; user-select:none; transition:.14s; }
  .chip:hover { border-color:var(--line2); color:var(--ink); }
  .chip[aria-pressed="true"] { background:var(--accent); color:#04201c; border-color:var(--accent); font-weight:600; }
  .journal { border:1px solid var(--line); border-radius:var(--r); background:var(--panel); overflow:hidden; }
  .row { display:grid; grid-template-columns:118px 20px 1fr; gap:12px; padding:11px 16px; border-top:1px solid var(--line); align-items:baseline; }
  .row:first-child { border-top:none; }
  .row:hover { background:#0e1620; }
  .row .when { font-size:11.5px; color:var(--faint); }
  .row .k { width:9px; height:9px; border-radius:3px; align-self:center; background:var(--faint); }
  .k.trade,.k.tradein,.k.deadlinebuy { background:var(--good); }
  .k.deadlinesell { background:var(--warn); }
  .k.draft { background:var(--rebuild); }
  .k.interaction { background:var(--retool); }
  .k.plan { background:var(--accent); }
  .row .txt b { font-weight:600; }
  .row .drv { color:var(--muted); font-size:12.5px; margin-top:2px; }
  .row.plan { background:#0f1a17; }
  .seasonhdr { padding:9px 16px; font-size:11px; text-transform:uppercase; letter-spacing:.14em; color:var(--faint); background:var(--panel2); border-top:1px solid var(--line); }

  /* issues */
  .issue { display:grid; grid-template-columns:auto 1fr; gap:12px; padding:12px 15px; border:1px solid var(--line); border-left-width:3px; border-radius:var(--r-sm); background:var(--panel); margin-bottom:8px; }
  .issue.critical { border-left-color:var(--crit); } .issue.major { border-left-color:var(--warn); } .issue.minor { border-left-color:var(--faint); }
  .issue .sev { font-size:10px; text-transform:uppercase; letter-spacing:.1em; font-weight:700; align-self:center; }
  .issue.critical .sev { color:var(--crit); } .issue.major .sev { color:var(--warn); } .issue.minor .sev { color:var(--muted); }
  .clean { border:1px dashed var(--line2); border-radius:var(--r); padding:26px; text-align:center; color:var(--muted); }
  .clean b { color:var(--good); }

  .notes { display:grid; gap:10px; }
  .note { border:1px solid var(--line); border-radius:var(--r-sm); background:var(--panel); padding:13px 15px; font-size:13.5px; color:var(--muted); }
  .note .tag { display:inline-block; font-size:10.5px; text-transform:uppercase; letter-spacing:.1em; color:var(--accent); font-weight:700; margin-right:8px; }

  details.screen { border:1px solid var(--line); border-radius:var(--r-sm); background:var(--panel); margin-bottom:8px; }
  details.screen > summary { padding:12px 15px; cursor:pointer; font-weight:600; font-size:13.5px; list-style:none; display:flex; justify-content:space-between; }
  details.screen > summary::-webkit-details-marker { display:none; }
  details.screen > summary .hint { color:var(--faint); font-weight:400; font-size:12px; }
  details.screen pre { margin:0; padding:14px 16px; border-top:1px solid var(--line); background:var(--panel2); overflow-x:auto; font-size:12px; color:var(--muted);
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace; line-height:1.55; max-height:420px; }
  footer { margin-top:44px; color:var(--faint); font-size:12px; text-align:center; }
  a { color:var(--accent); }
</style>

<div class="wrap">
  <header class="board" id="board"></header>
  <h2 class="sec">Season by season</h2>
  <div class="seasons" id="seasons"></div>
  <h2 class="sec">GM journal — every decision, and why</h2>
  <div class="filters" id="filters"></div>
  <div class="journal" id="journal"></div>
  <h2 class="sec">Issues the playtest tripped</h2>
  <div id="issues"></div>
  <h2 class="sec">The GM's read on each feature</h2>
  <div class="notes" id="notes"></div>
  <h2 class="sec">The screens it looked at</h2>
  <div id="screens"></div>
  <footer id="footer"></footer>
</div>

<script id="trace" type="application/json">${JSON.stringify(trace).replace(/</g, '\\u003c')}</script>
<script>
const T = JSON.parse(document.getElementById('trace').textContent);
const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const kcls = k => (k||'').replace(/[^a-z]/g,'');

// header
const s = T.summary, m = T.meta;
document.getElementById('board').innerHTML = \`
  <div class="club">
    <div class="eyebrow">Autopilot playtest · \${esc(m.source)}</div>
    <h1>\${esc(m.userTeamName)}</h1>
    <div class="sub">\${esc(m.leagueName)} · \${m.teams} teams · seed \${m.seed}</div>
  </div>
  <div class="bugs">
    <div class="bug accent"><div class="n mono">\${m.seasonsPlayed}</div><div class="l">Seasons</div></div>
    <div class="bug \${s.cups>0?'good':''}"><div class="n mono">\${s.cups}</div><div class="l">Cups</div></div>
    <div class="bug"><div class="n">\${esc(s.bestFinish)}</div><div class="l">Best finish</div></div>
    <div class="bug"><div class="n mono">\${T.decisions.length}</div><div class="l">Decisions</div></div>
    <div class="bug \${s.critical>0?'crit':'good'}"><div class="n mono">\${s.critical}</div><div class="l">Critical</div></div>
  </div>\`;

// seasons
const planCls = p => ({contend:'contend',retool:'retool',rebuild:'rebuild'}[p]||'retool');
const resCls = r => /Champ/.test(r)?'champ':/Miss|—/.test(r)?'miss':'po';
const planFor = y => (T.decisions.find(d=>d.kind==='plan'&&d.season===y)||{}).result;
document.getElementById('seasons').innerHTML = T.seasons.map(se => {
  const pl = planFor(se.year);
  return \`<div class="scard">
    <div class="yr"><b class="mono">\${se.year}</b>\${pl?\`<span class="pill \${planCls(pl)}">\${pl}</span>\`:''}</div>
    <div class="rec mono">\${esc(se.record||'—')} <span class="pts">\${se.points??''} pts · #\${se.rank??'?'}</span></div>
    <div class="result \${resCls(se.playoffResult)}">\${esc(se.playoffResult)}\${se.wonCup?' 🏆':''}</div>
    <div class="foot mono"><span>\${se.trades} trades</span><span class="dot">·</span><span>\${se.signings} signings</span><span class="dot">·</span><span>\${se.drafted} picks</span>\${se.critical?\`<span class="dot">·</span><span style="color:var(--crit)">\${se.critical} crit</span>\`:''}</div>
  </div>\`;
}).join('');

// journal + filters
const kinds = [...new Set(T.decisions.map(d=>d.kind))];
const label = {plan:'Plans',trade:'Trades','trade-in':'Trades',draft:'Draft','deadline-buy':'Deadline','deadline-sell':'Deadline',interaction:'Concerns',meeting:'Meetings',callup:'Roster','sign-fa':'Free agency',resign:'Re-signings',captain:'Captain'};
const groups = ['all','plan','trade','draft','deadline-buy','interaction','sign-fa','resign'];
let active = 'all';
const filt = document.getElementById('filters');
filt.innerHTML = groups.filter(g=>g==='all'||kinds.some(k=>k.startsWith(g)||k===g)).map(g =>
  \`<button class="chip" data-g="\${g}" aria-pressed="\${g==='all'}">\${g==='all'?'All':(label[g]||g)}</button>\`).join('');
function renderJournal() {
  const j = document.getElementById('journal');
  let html = '', curYr = null;
  for (const d of T.decisions) {
    if (active!=='all' && !(d.kind===active || d.kind.startsWith(active))) continue;
    if (d.season!==curYr) { curYr=d.season; html += \`<div class="seasonhdr">Season \${curYr}</div>\`; }
    html += \`<div class="row \${d.kind==='plan'?'plan':''}">
      <div class="when mono">\${esc(d.phase)} · d\${d.day}</div>
      <div class="k \${kcls(d.kind)}"></div>
      <div class="txt"><b>\${esc(d.summary)}</b>\${d.drivers&&d.drivers.length?\`<div class="drv">\${d.drivers.map(esc).join(' · ')}</div>\`:''}</div>
    </div>\`;
  }
  j.innerHTML = html || '<div class="row"><div></div><div></div><div class="drv">No decisions of this type.</div></div>';
}
filt.addEventListener('click', e => { const b=e.target.closest('.chip'); if(!b) return;
  active=b.dataset.g; filt.querySelectorAll('.chip').forEach(c=>c.setAttribute('aria-pressed', c===b)); renderJournal(); });
renderJournal();

// issues
const iss = document.getElementById('issues');
if (!T.issues.length) iss.innerHTML = '<div class="clean"><b>Clean run.</b> No softlocks, absurd values, or state bugs tripped across '+m.seasonsPlayed+' season'+(m.seasonsPlayed>1?'s':'')+'.</div>';
else iss.innerHTML = [...T.issues].sort((a,b)=>({critical:0,major:1,minor:2})[a.severity]-({critical:0,major:1,minor:2})[b.severity]).map(i=>
  \`<div class="issue \${i.severity}"><div class="sev">\${i.severity}</div><div><b>[\${esc(i.category)}]</b> \${esc(i.message)} <span style="color:var(--faint)">· S\${i.season} d\${i.day}\${i.context?' · '+esc(i.context):''}</span></div></div>\`).join('');

// feature notes
document.getElementById('notes').innerHTML = (T.featureNotes||[]).map(n=>{
  const mo=n.match(/^\\[([^\\]]+)\\]\\s*(.*)$/); return \`<div class="note"><span class="tag">\${esc(mo?mo[1]:'note')}</span>\${esc(mo?mo[2]:n)}</div>\`;
}).join('') || '<div class="note">No feature notes captured.</div>';

// screens
document.getElementById('screens').innerHTML = Object.entries(T.viewSamples||{}).map(([k,v])=>
  \`<details class="screen"><summary>\${esc(k)} <span class="hint">what the screen serves ▾</span></summary><pre>\${esc(JSON.stringify(v,null,2))}</pre></details>\`).join('') || '<div class="note">No screen snapshots.</div>';

document.getElementById('footer').innerHTML = \`Generated from docs/autopilot/trace-latest.json · \${T.decisions.length} decisions · \${(T.featureNotes||[]).length} feature notes · \${Object.keys(T.viewSamples||{}).length} screens\`;
</script>`;

writeFileSync(join(DIR, 'dashboard.body.html'), BODY)
writeFileSync(join(DIR, 'dashboard.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Autopilot · ${trace.meta.userTeamName}</title></head><body>${BODY}</body></html>`)
console.log('wrote docs/autopilot/dashboard.html (open locally) + dashboard.body.html (for Artifact)')
