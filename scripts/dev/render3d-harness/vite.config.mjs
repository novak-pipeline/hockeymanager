// Standalone dev harness for the 3D match renderer (no Electron, no worker).
// Runs the real full-fidelity engine in the page on a generated league and
// mounts Rink3dRenderer on the resulting GameStream.
//   npx vite --config scripts/dev/render3d-harness/vite.config.mjs --port 5175
// Query params: ?t=0.35 (seek fraction) &cam=broadcast|overhead|endzone|follow
//               &play=1 &speed=2 &seed=3 &w=1280&h=720
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { defineConfig } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
export default defineConfig({
  root: here,
  // Own dep-optimizer cache: node_modules may be shared (worktree junction) with
  // a running electron-vite dev server — never clobber its node_modules/.vite.
  cacheDir: resolve(tmpdir(), 'the-show-render3d-harness-vite'),
  resolve: {
    alias: {
      '@domain': resolve(root, 'src/domain'),
      '@engine': resolve(root, 'src/engine'),
      '@data': resolve(root, 'src/data'),
      '@calibrate': resolve(root, 'src/calibrate'),
      '@render2d': resolve(root, 'src/render2d'),
      '@render3d': resolve(root, 'src/render3d'),
      '@renderer': resolve(root, 'src/renderer'),
    },
  },
  server: { fs: { allow: [root] } },
})
