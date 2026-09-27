/**
 * Side-by-side eye-test page: two GameStreams (e.g. a reference sequence and a
 * sim clip in the same situation) drawn on two rinks with one shared clock.
 * Self-contained HTML (inline canvas + script, no network). Written by the
 * scorecard harness into the git-ignored .cache/ folder.
 */
import type { GameStream } from '@domain'

interface Pane {
  title: string
  subtitle?: string
  stream: GameStream
}

interface PackedFrame {
  t: number
  p: [number, number]
  c: string | null
  h: [string, number, number][]
  a: [string, number, number][]
  hg: [number, number]
  ag: [number, number]
}

function pack(stream: GameStream): { frames: PackedFrame[]; events: [number, string][] } {
  const frames: PackedFrame[] = []
  const events: [number, string][] = []
  for (const ev of stream) {
    if (ev.type === 'frame') {
      const r = (v: number): number => Math.round(v * 1000) / 1000
      frames.push({
        t: ev.t,
        p: [r(ev.puck.x), r(ev.puck.y)],
        c: ev.puckCarrier,
        h: ev.home.map((s) => [s.player, r(s.pos.x), r(s.pos.y)]),
        a: ev.away.map((s) => [s.player, r(s.pos.x), r(s.pos.y)]),
        hg: [r(ev.homeGoalie.pos.x), r(ev.homeGoalie.pos.y)],
        ag: [r(ev.awayGoalie.pos.x), r(ev.awayGoalie.pos.y)]
      })
    } else if (ev.type === 'pass' || ev.type === 'shot' || ev.type === 'hit' || ev.type === 'goal' || ev.type === 'save' || ev.type === 'takeaway' || ev.type === 'giveaway' || ev.type === 'blockedShot') {
      events.push([ev.t, ev.type])
    }
  }
  return { frames, events }
}

export function sideBySideHtml(left: Pane, right: Pane, pageTitle = 'Reference vs sim'): string {
  const data = JSON.stringify({
    panes: [left, right].map((p) => ({ title: p.title, subtitle: p.subtitle ?? '', ...pack(p.stream) }))
  }).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${pageTitle.replace(/</g, '&lt;')}</title>
<style>
:root{--bg:#f4f5f7;--fg:#1b1f24;--ice:#ffffff;--line:#c9ced6;--red:#c8323c;--blue:#2f5fd0;--home:#1f6feb;--away:#d9480f;--puck:#111;--muted:#5b6470}
@media (prefers-color-scheme:dark){:root{--bg:#14171b;--fg:#e8eaed;--ice:#1d2227;--line:#3a424c;--muted:#9aa4b0;--puck:#f5f5f5}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif}
header{padding:12px 16px}h1{font-size:16px;margin:0}p{margin:4px 0;color:var(--muted)}
.wrap{display:flex;flex-wrap:wrap;gap:12px;padding:0 16px}
.pane{flex:1 1 420px;min-width:0}.pane h2{font-size:14px;margin:6px 0 2px}
canvas{width:100%;height:auto;background:var(--ice);border-radius:8px;display:block}
.ctl{display:flex;gap:10px;align-items:center;padding:12px 16px;flex-wrap:wrap}
input[type=range]{flex:1;min-width:160px}button,select{font:inherit;padding:4px 10px}
.legend span{display:inline-block;width:10px;height:10px;border-radius:50%;margin:0 4px 0 10px;vertical-align:middle}
</style></head><body>
<header><h1>${pageTitle.replace(/</g, '&lt;')}</h1><p>Same clock on both rinks. Home = blue (attacks →), away = orange, puck = dot with ring; the carrier has a ring. Trails show the last 1.5 s.</p>
<p class="legend"><span style="background:var(--home)"></span>home<span style="background:var(--away)"></span>away</p></header>
<div class="ctl"><button id="play">Pause</button><select id="spd"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option></select><input id="scrub" type="range" min="0" max="1000" value="0"><span id="clock">0.0 s</span><label><input id="trails" type="checkbox" checked> trails</label></div>
<div class="wrap" id="wrap"></div>
<script>
const D=${data};
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const wrap=document.getElementById('wrap');
const panes=D.panes.map(p=>{const d=document.createElement('div');d.className='pane';d.innerHTML='<h2></h2><p></p>';d.querySelector('h2').textContent=p.title;d.querySelector('p').textContent=p.subtitle;const c=document.createElement('canvas');c.width=1000;c.height=425;d.appendChild(c);wrap.appendChild(d);return {...p,cv:c,ctx:c.getContext('2d'),dur:p.frames.length?p.frames[p.frames.length-1].t:0}});
const dur=Math.max(...panes.map(p=>p.dur),0.1);
let t=0,playing=true,last=performance.now();
const X=x=>(x+1)/2*1000, Y=y=>(y+1)/2*425;
function rink(ctx){ctx.clearRect(0,0,1000,425);ctx.lineWidth=2;ctx.strokeStyle=css('--line');ctx.beginPath();ctx.roundRect(1,1,998,423,140);ctx.stroke();
 const vl=(xf,col,w)=>{ctx.strokeStyle=col;ctx.lineWidth=w;ctx.beginPath();ctx.moveTo(X(xf/100),0);ctx.lineTo(X(xf/100),425);ctx.stroke()};
 vl(0,css('--red'),3);vl(25,css('--blue'),5);vl(-25,css('--blue'),5);vl(89,css('--red'),1.5);vl(-89,css('--red'),1.5);
 ctx.strokeStyle=css('--red');ctx.lineWidth=1.5;for(const [cx,cy] of [[69,22],[69,-22],[-69,22],[-69,-22],[0,0]]){ctx.beginPath();ctx.arc(X(cx/100),Y(cy/42.5),75,0,7);ctx.stroke()}}
function at(p,tt){const f=p.frames;if(!f.length)return null;if(tt<=f[0].t)return f[0];if(tt>=f[f.length-1].t)return f[f.length-1];
 let lo=0,hi=f.length-1;while(hi-lo>1){const m=(lo+hi)>>1;if(f[m].t<=tt)lo=m;else hi=m}const a=f[lo],b=f[hi],k=(tt-a.t)/Math.max(1e-6,b.t-a.t);
 const L=(u,v)=>u+(v-u)*k;const mp=(A,B)=>A.map(s=>{const o=B.find(q=>q[0]===s[0]);return o?[s[0],L(s[1],o[1]),L(s[2],o[2])]:s});
 return {t:tt,p:[L(a.p[0],b.p[0]),L(a.p[1],b.p[1])],c:a.c,h:mp(a.h,b.h),a:mp(a.a,b.a),hg:[L(a.hg[0],b.hg[0]),L(a.hg[1],b.hg[1])],ag:[L(a.ag[0],b.ag[0]),L(a.ag[1],b.ag[1])]}}
function draw(){const tr=document.getElementById('trails').checked;for(const p of panes){const g=p.ctx;rink(g);const fr=at(p,t);if(!fr)continue;
 if(tr){for(const [key,col] of [['h','--home'],['a','--away']]){g.strokeStyle=css(col);g.globalAlpha=.35;g.lineWidth=2;const ids=fr[key].map(s=>s[0]);for(const id of ids){g.beginPath();let first=true;for(let s=Math.max(0,t-1.5);s<=t;s+=0.1){const q=at(p,s);const pt=q&&q[key].find(z=>z[0]===id);if(!pt)continue;if(first){g.moveTo(X(pt[1]),Y(pt[2]));first=false}else g.lineTo(X(pt[1]),Y(pt[2]))}g.stroke()}}g.globalAlpha=1}
 for(const [key,col] of [['h','--home'],['a','--away']]){for(const s of fr[key]){g.fillStyle=css(col);g.beginPath();g.arc(X(s[1]),Y(s[2]),9,0,7);g.fill();if(s[0]===fr.c){g.strokeStyle=css('--puck');g.lineWidth=2;g.beginPath();g.arc(X(s[1]),Y(s[2]),13,0,7);g.stroke()}}}
 for(const [gp,col] of [[fr.hg,'--home'],[fr.ag,'--away']]){g.fillStyle=css(col);g.fillRect(X(gp[0])-7,Y(gp[1])-10,14,20)}
 g.fillStyle=css('--puck');g.beginPath();g.arc(X(fr.p[0]),Y(fr.p[1]),4.5,0,7);g.fill();
 const recent=p.events.filter(e=>e[0]<=t&&e[0]>t-1).map(e=>e[1]);g.font='16px system-ui';g.fillStyle=css('--fg');g.fillText(recent.join(' · '),14,24)}
 document.getElementById('clock').textContent=t.toFixed(1)+' s';document.getElementById('scrub').value=String(Math.round(t/dur*1000))}
function loop(now){const dt=(now-last)/1000;last=now;if(playing){t+=dt*Number(document.getElementById('spd').value);if(t>dur)t=0}draw();requestAnimationFrame(loop)}
document.getElementById('play').onclick=e=>{playing=!playing;e.target.textContent=playing?'Pause':'Play'};
document.getElementById('scrub').oninput=e=>{t=Number(e.target.value)/1000*dur;playing=false;document.getElementById('play').textContent='Play'};
requestAnimationFrame(loop);
</script></body></html>
`
}
