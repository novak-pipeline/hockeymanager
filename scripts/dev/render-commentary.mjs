#!/usr/bin/env node
/**
 * render-commentary.mjs — pre-render the broadcast booth's STEMS (and a proof-
 * of-concept set of player-name clips) with the booth's two fixed voices.
 *
 *   node scripts/dev/render-commentary.mjs            # stems + name samples
 *   node scripts/dev/render-commentary.mjs --stems    # stems only
 *   node scripts/dev/render-commentary.mjs --q8       # smaller/faster model
 *
 * Reads:
 *   src/render2d/broadcast/booth.config.json   engine, model, voices, styles
 *   src/render2d/broadcast/commentaryLibrary.ts the line library (type-stripped)
 *   src/render2d/broadcast/pronunciation.ts    how names are said
 *   mods/nhl-ehm/database.json (READ-ONLY, optional) real names for the samples
 *
 * Writes (audio is gitignored; only the manifest is committed):
 *   src/renderer/public/commentary/manifest.json
 *   src/renderer/public/commentary/clips/*.wav       stems (stem.* / bare.*)
 *   src/renderer/public/commentary/samples/*.wav     name clips + stitched demos
 *
 * Format: 16-bit mono WAV — no pure-JS Opus/MP3 encoder is in the dependency
 * tree and the owner hasn't approved adding one; see docs/BROADCAST-PACKAGE.md.
 *
 * The model is fetched once by transformers.js into ./.cache/kokoro (gitignored).
 * Requires Node ≥ 22.6 (TypeScript type-stripping for the .ts imports).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = join(ROOT, 'src', 'renderer', 'public', 'commentary')
const args = new Set(process.argv.slice(2))

const booth = JSON.parse(readFileSync(join(ROOT, 'src/render2d/broadcast/booth.config.json'), 'utf8'))
const lib = await import(pathToFileURL(join(ROOT, 'src/render2d/broadcast/commentaryLibrary.ts')).href)
const pron = await import(pathToFileURL(join(ROOT, 'src/render2d/broadcast/pronunciation.ts')).href)

/* ── engine: Kokoro in Node (the TtsEngine the app uses on its worker) ── */
const { env } = await import('@huggingface/transformers')
env.cacheDir = join(ROOT, '.cache', 'kokoro')
const { KokoroTTS } = await import('kokoro-js')
const dtype = args.has('--q8') ? 'q8' : booth.dtype
console.log(`[booth] loading ${booth.model} (${dtype}) …`)
const t0 = Date.now()
const tts = await KokoroTTS.from_pretrained(booth.model, { dtype, device: 'cpu' })
console.log(`[booth] model ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

let synthMs = 0
let audioSec = 0
/** TtsEngine.render: style → terminator + rate, exactly as the runtime does. */
async function render(text, speaker, style = 'neutral', rateBoost = 0) {
  const sp = booth.speakers[speaker]
  const st = booth.styles[style]
  const rate = Math.round((sp.rate + st.rateDelta + rateBoost) * 100) / 100
  const s = Date.now()
  const out = await tts.generate(text, { voice: sp.voiceId, speed: rate })
  synthMs += Date.now() - s
  audioSec += out.audio.length / out.sampling_rate
  return { pcm: trimSilence(out.audio, out.sampling_rate), sampleRate: out.sampling_rate }
}

/** Trim leading/trailing near-silence so stitched clips butt up cleanly. */
function trimSilence(pcm, sr) {
  const th = 0.012
  let a = 0
  let b = pcm.length - 1
  while (a < b && Math.abs(pcm[a]) < th) a++
  while (b > a && Math.abs(pcm[b]) < th) b--
  const pad = Math.round(sr * 0.03)
  return pcm.slice(Math.max(0, a - pad), Math.min(pcm.length, b + pad))
}

function wav(pcm, sr) {
  const n = pcm.length
  const buf = Buffer.alloc(44 + n * 2)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm[i] * 32767))), 44 + i * 2)
  return buf
}

function concat(parts, sr, gapMs = 40) {
  const gap = new Float32Array(Math.round((sr * gapMs) / 1000))
  const all = []
  parts.forEach((p, i) => { if (i) all.push(gap); all.push(p) })
  const len = all.reduce((s, p) => s + p.length, 0)
  const out = new Float32Array(len)
  let o = 0
  for (const p of all) { out.set(p, o); o += p.length }
  return out
}

mkdirSync(join(OUT, 'clips'), { recursive: true })
const manifest = {
  version: 1,
  engine: booth.engine,
  voices: { pbp: booth.speakers.pbp.voiceId, color: booth.speakers.color.voiceId },
  sampleRate: booth.sampleRate,
  format: 'wav',
  clips: {},
}

/* ── stems ── */
const stemByLine = new Map()
for (const line of lib.BOOTH_LINES) {
  const boost = line.intensity === 3 ? 0.06 : line.intensity === 1 ? -0.02 : 0
  const style = line.intensity >= 2 && /!$/.test(line.text) ? 'excited' : 'neutral'
  const jobs = [[lib.stemClipId(line.id), lib.stemText(line)]]
  if (line.bare) jobs.push([lib.bareClipId(line.id), line.bare])
  for (const [id, text] of jobs) {
    const a = await render(text, line.speaker, 'neutral', boost + (style === 'excited' ? 0.04 : 0))
    const file = `clips/${id}.wav`
    writeFileSync(join(OUT, file), wav(a.pcm, a.sampleRate))
    manifest.clips[id] = { file, durationMs: Math.round((a.pcm.length / a.sampleRate) * 1000), speaker: line.speaker, text }
    if (id.startsWith('stem.')) stemByLine.set(line.id, a)
  }
  process.stdout.write('.')
}
console.log(`\n[booth] ${Object.keys(manifest.clips).length} stem clips`)

/* ── proof-of-concept names (real imported names, both intonations) ── */
if (!args.has('--stems')) {
  const dbPath = resolve(ROOT, '..', '..', '..', 'mods', 'nhl-ehm', 'database.json')
  const altDb = join(ROOT, 'mods', 'nhl-ehm', 'database.json')
  const path = existsSync(dbPath) ? dbPath : existsSync(altDb) ? altDb : null
  // The imported DB spells without diacritics ("Martin Necas"), so match on a
  // folded surname; 'Ekman Larsson' is a two-word surname there.
  const fold = (x) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const wanted = ['Soderblom', 'Necas', 'Larsson', 'Kaprizov', 'Dahlin', 'Pastrnak', 'Zibanejad', 'Draisaitl', 'Vasilevskiy', 'Vasilevsky', 'Hischier', 'Kotkaniemi', 'Barkov', 'Rantanen', 'McDavid'].map(fold)
  const onlyFull = new Set(['oliver ekman larsson'])
  const found = []
  if (path) {
    const db = JSON.parse(readFileSync(path, 'utf8'))
    const seen = new Set()
    const walk = (o) => {
      if (!o || typeof o !== 'object') return
      if (Array.isArray(o)) { for (const x of o) walk(x); return }
      if (typeof o.name === 'string' && typeof o.position === 'string' && !seen.has(o.name)) {
        const last = fold(o.name.split(/\s+/).pop())
        const hit = wanted.includes(last) && (last !== 'larsson' || onlyFull.has(fold(o.name)))
        if (hit) { seen.add(o.name); found.push({ id: o.externalId ?? o.name, name: o.name, nationality: o.nationality, pronunciation: o.pronunciation, externalId: o.externalId }) }
      }
      for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v)
    }
    walk(db)
  } else {
    console.warn('[booth] mods/nhl-ehm/database.json not found — sample names skipped')
  }
  mkdirSync(join(OUT, 'samples'), { recursive: true })
  manifest.sampleNames = []
  const demoLine = lib.BOOTH_LINES.find((l) => l.id === 'goal.1') // "{name} shoots, and scores!"
  const demoTail = lib.BOOTH_LINES.find((l) => l.id === 'save.big.1') // "Big save, {name}!"
  for (const p of found) {
    const spoken = pron.spokenName(p)
    const slug = p.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z]+/g, '-').toLowerCase()
    const files = {}
    for (const style of ['neutral', 'excited']) {
      const a = await render(`${spoken.surname}${booth.styles[style].terminator}`, 'pbp', style)
      files[`surname.${style}`] = `samples/${slug}.surname.${style}.wav`
      writeFileSync(join(OUT, files[`surname.${style}`]), wav(a.pcm, a.sampleRate))
      if (style === 'excited') {
        // Stitched demos, exactly as the scheduler plays them.
        const lead = stemByLine.get(demoLine.id)
        const tail = stemByLine.get(demoTail.id)
        files['demo.lead'] = `samples/${slug}.demo.goal.wav`
        writeFileSync(join(OUT, files['demo.lead']), wav(concat([a.pcm, lead.pcm], a.sampleRate), a.sampleRate))
        files['demo.tail'] = `samples/${slug}.demo.save.wav`
        writeFileSync(join(OUT, files['demo.tail']), wav(concat([tail.pcm, a.pcm], a.sampleRate), a.sampleRate))
      }
    }
    const full = await render(`${spoken.full}.`, 'pbp', 'neutral')
    files['full.neutral'] = `samples/${slug}.full.neutral.wav`
    writeFileSync(join(OUT, files['full.neutral']), wav(full.pcm, full.sampleRate))
    manifest.sampleNames.push({ playerName: p.name, spoken: spoken.full, files })
    console.log(`[booth] ${p.name} → "${spoken.full}"`)
  }
}

// Real names stay out of git (fictional-by-default DB rule): the sample list goes
// next to the gitignored sample audio, not into the committed manifest.
if (manifest.sampleNames) {
  writeFileSync(join(OUT, 'samples', 'index.json'), JSON.stringify(manifest.sampleNames, null, 2) + '\n')
  delete manifest.sampleNames
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
const ratio = audioSec / (synthMs / 1000)
console.log(`[booth] done: ${audioSec.toFixed(1)}s of audio in ${(synthMs / 1000).toFixed(1)}s (${ratio.toFixed(2)}× realtime)`)
console.log(`[booth] manifest → ${join(OUT, 'manifest.json')}`)
