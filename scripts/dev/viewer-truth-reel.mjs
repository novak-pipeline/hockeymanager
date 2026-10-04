/**
 * Builds the owner-scored reel page (docs/gameplan-2026-09-28 W0/W1): one card
 * per golden-scenario clip with the clip, the per-kind checklist, a 1–5 score
 * and a note. Scores live in the page's localStorage and export as JSON (the
 * owner sends that file back; the milestone exits at ≥ 4 on every clip).
 * Self-contained HTML next to the clips — open it straight from disk.
 */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const clock = (t) => {
  const p = Math.min(4, Math.floor(t / 1200) + 1)
  const r = 1200 - (t - (p - 1) * 1200)
  return `P${p} ${Math.floor(r / 60)}:${String(Math.floor(r % 60)).padStart(2, '0')}`
}

export function buildReelHtml(report, checklist, name = 'v0') {
  const cards = []
  for (const [engine, { clips }] of Object.entries(report.engines ?? {})) {
    for (const c of clips) {
      const id = `${engine}-${c.kind}`
      const reds = c.vt.filter((r) => r.status === 'red')
      cards.push(`
<article class="clip" data-id="${esc(id)}">
  <header>
    <h2>${esc(c.label.replace(/^\w+-/, ''))} <span class="kind">${esc(SCEN[c.kind] ?? c.kind)}</span></h2>
    <p class="meta">${esc(engine)} engine · ${esc(c.homeAbbr)} v ${esc(c.awayAbbr)} · seed ${c.seed} · ${esc(clock(c.absT))} · ${esc(c.note)}</p>
  </header>
  ${c.clipFile ? `<video src="${esc(c.clipFile)}" controls preload="metadata" playsinline></video>` : '<p class="noclip">(no clip recorded)</p>'}
  <div class="judge">
    <fieldset class="checks"><legend>Checklist</legend>
      ${(checklist[c.kind] ?? []).map((q, i) => `<label><input type="checkbox" data-k="c${i}"> ${esc(q)}</label>`).join('\n      ')}
    </fieldset>
    <fieldset class="score"><legend>Score</legend>
      ${[1, 2, 3, 4, 5].map((n) => `<label><input type="radio" name="s-${esc(id)}" value="${n}"> ${n}</label>`).join(' ')}
    </fieldset>
    <textarea placeholder="What looked wrong? (free text)" data-k="note"></textarea>
  </div>
  <details class="vt"><summary>Detectors: ${reds.length ? `<b class="red">${reds.map((r) => r.id).join(' ')} red</b>` : '<b class="green">all green / n/a</b>'}</summary>
    <ul>${c.vt.map((r) => `<li class="${r.status}"><b>${r.id}</b> ${esc(r.name)}: ${esc(r.value)}${r.evidence.length ? `<br><small>${r.evidence.slice(0, 3).map(esc).join('<br>')}</small>` : ''}</li>`).join('')}</ul>
  </details>
</article>`)
    }
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reel ${name} — watched game</title>
<style>
:root{--bg:#0e1116;--card:#171b22;--ink:#e8ebf0;--dim:#97a0ad;--line:#2a313c;--red:#ff6b6b;--green:#5fd38d;--acc:#7aa2ff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,Segoe UI,sans-serif}
main{max-width:1280px;margin:0 auto;padding:24px 16px 80px}
h1{margin:0 0 4px;font-size:24px}.lead{color:var(--dim);margin:0 0 18px}
.bar{position:sticky;top:0;background:var(--bg);padding:10px 0;border-bottom:1px solid var(--line);display:flex;gap:16px;align-items:center;flex-wrap:wrap;z-index:2}
.bar b{font-size:20px}button{background:var(--acc);color:#0b0e14;border:0;border-radius:6px;padding:8px 14px;font-weight:600;cursor:pointer}
.clip{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:18px 0}
.clip h2{margin:0;font-size:18px}.kind{color:var(--dim);font-weight:400;font-size:14px}.meta{color:var(--dim);margin:4px 0 10px;font-size:13px}
video{width:100%;max-height:72vh;background:#000;border-radius:6px}
.judge{display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-top:10px}
fieldset{border:1px solid var(--line);border-radius:8px;margin:0}legend{color:var(--dim);font-size:13px}
.checks label{display:block;margin:3px 0}.score label{margin-right:10px;font-size:18px}
textarea{grid-column:1/-1;min-height:60px;background:#0b0e14;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px;font:inherit}
.vt{margin-top:10px;color:var(--dim);font-size:13px}.vt li{margin:4px 0}.vt li.red b{color:var(--red)}.vt li.green b{color:var(--green)}
.red{color:var(--red)}.green{color:var(--green)}
@media (max-width:700px){.judge{grid-template-columns:1fr}}
</style></head><body><main>
<h1>Reel ${name} — the watched game, as you see it</h1>
<p class="lead">Recorded from the real app on a copy of your save, at your settings (3D, broadcast camera, Full mode, replays on). Watch each clip, tick what reads right, score it 1–5 (5 = "I'd show a friend"), and note what's wrong. Scores save in this page as you go; press <b>Export scores</b> when done and send the file back. The milestone exits when every clip scores 4 or more.</p>
<div class="bar"><span>Average: <b id="avg">–</b></span><span id="done"></span><button id="export">Export scores</button></div>
${cards.join('\n')}
</main>
<script>
const KEY = 'reel-${name}-scores'
let data = {}
try { data = JSON.parse(localStorage.getItem(KEY) || '{}') } catch (e) { data = {} }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)) } catch (e) {} ; summary() }
function summary() {
  const s = Object.values(data).map((d) => d.score).filter(Boolean)
  document.getElementById('avg').textContent = s.length ? (s.reduce((a, b) => a + b, 0) / s.length).toFixed(2) : '–'
  document.getElementById('done').textContent = s.length + ' / ' + document.querySelectorAll('.clip').length + ' scored'
}
for (const card of document.querySelectorAll('.clip')) {
  const id = card.dataset.id
  const d = data[id] || (data[id] = {})
  for (const el of card.querySelectorAll('input,textarea')) {
    if (el.type === 'radio') { el.checked = d.score === Number(el.value); el.onchange = () => { d.score = Number(el.value); save() } }
    else if (el.type === 'checkbox') { el.checked = !!d[el.dataset.k]; el.onchange = () => { d[el.dataset.k] = el.checked; save() } }
    else { el.value = d.note || ''; el.oninput = () => { d.note = el.value; save() } }
  }
}
document.getElementById('export').onclick = () => {
  const blob = new Blob([JSON.stringify({ reel: '${name}', exportedAt: new Date().toISOString(), scores: data }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'reel-${name}-scores.json'; a.click()
}
summary()
</script></body></html>
`
}

const SCEN = {
  breakaway: 'Breakaway', twoOnOne: '2-on-1 rush', ozCycleShot: 'OZ cycle into a shot', ppSetPlay: 'PP set play',
  goalReplay: 'Goal + celebration + replay', lineChangeOnFly: 'Line change on the fly', faceoffWinPlay: 'Faceoff win into play',
  bigHit: 'Big hit', saveRebound: 'Save + rebound', emptyNetLate: 'Empty net / late game',
}
