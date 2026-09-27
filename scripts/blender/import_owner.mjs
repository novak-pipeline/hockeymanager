// Import the OWNER-SUPPLIED athletes (assets/3d/incoming/{skater,goalie}/…) onto
// the renderer's skeleton + bake their kit textures, fully headless:
//
//   npm run import:owner-assets                 (default source: assets/3d/incoming)
//   npm run import:owner-assets -- --src <dir> [--preview]
//
// Outputs go to src/render3d/assets/owner/ (+ reports / .blend in build/owner-assets/),
// ALL git-ignored: the Fab licence allows shipping the assets inside the game
// but not redistributing them, and this repo is public. The renderer picks them
// up automatically when present (athletes: 'auto') and falls back to the
// Blender athletes when they are not. Needs Blender 5.1+ ($BLENDER) and
// Python 3 with Pillow + numpy on PATH.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../..')
const args = process.argv.slice(2)
const srcIdx = args.indexOf('--src')
const src = resolve(srcIdx >= 0 ? args[srcIdx + 1] : join(root, 'assets/3d/incoming'))
const preview = args.includes('--preview')

const blender = [process.env.BLENDER, 'C:/Program Files/Blender Foundation/Blender 5.1/blender.exe', '/Applications/Blender.app/Contents/MacOS/Blender', '/usr/bin/blender'].filter(Boolean).find((p) => existsSync(p))
if (!blender) {
  console.error('Blender not found. Set BLENDER=/path/to/blender (5.1+).')
  process.exit(1)
}
const cfg = JSON.parse(readFileSync(join(here, 'owner_assets.json'), 'utf8'))
let built = 0
for (const role of ['skater', 'goalie']) {
  if (!existsSync(join(src, cfg[role].dir))) {
    console.log(`${role}: no source folder (${cfg[role].dir}) — skipped`)
    continue
  }
  const r = spawnSync(
    blender,
    ['--background', '--factory-startup', '--python', join(here, 'import_owner_assets.py'), '--', '--role', role, '--src', src, ...(preview ? ['--preview'] : [])],
    { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }
  )
  const out = r.stdout ?? ''
  for (const line of out.split('\n')) if (/IMPORT OK|WARN|Error|Traceback/.test(line)) console.log(line)
  if (r.status !== 0 || !out.includes('IMPORT OK')) {
    console.error(out.slice(-4000))
    process.exit(r.status || 1)
  }
  built++
}
if (!built) {
  console.log(`nothing to import under ${src}`)
  process.exit(0)
}
const py = process.platform === 'win32' ? 'python' : 'python3'
const t = spawnSync(py, [join(here, 'owner_textures.py'), '--src', src], { stdio: 'inherit' })
if (t.status !== 0) process.exit(t.status || 1)
console.log('owner athletes ready in src/render3d/assets/owner/ (git-ignored) — reports in build/owner-assets/')
