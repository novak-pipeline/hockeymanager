// Rebuild the Blender-authored athletes (src/render3d/assets/skater.glb + goalie.glb)
// fully headless. Blender never opens a window.
//
//   npm run build:athletes              (uses $BLENDER, else the default install path)
//   npm run build:athletes -- --preview (also renders Workbench previews into build/blender/)
//
// The committed .glb files mean a fresh checkout runs without Blender; run this
// after editing anything in scripts/blender/.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const candidates = [
  process.env.BLENDER,
  'C:/Program Files/Blender Foundation/Blender 5.1/blender.exe',
  '/Applications/Blender.app/Contents/MacOS/Blender',
  '/usr/bin/blender',
].filter(Boolean)
const blender = candidates.find((p) => existsSync(p))
if (!blender) {
  console.error('Blender not found. Set BLENDER=/path/to/blender (5.1+).')
  process.exit(1)
}
const extra = process.argv.slice(2)
const r = spawnSync(
  blender,
  ['--background', '--factory-startup', '--python', join(here, 'build_athletes.py'), '--', ...extra],
  { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' }
)
const out = r.stdout ?? ''
for (const line of out.split('\n')) if (/BUILD OK|Error|Traceback|INFO: Finished/.test(line)) console.log(line)
if (r.status !== 0 || !out.includes('BUILD OK')) {
  console.error(out.slice(-4000))
  process.exit(r.status || 1)
}
