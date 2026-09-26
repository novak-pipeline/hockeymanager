// Renderer-only Vite dev server (no Electron) for UI harness pages, e.g.
//   npx vite --config scripts/dev/vite.renderer-dev.config.mjs
//   → http://localhost:5179/dev/broadcast-harness.html
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const r = (p) => resolve(import.meta.dirname, '..', '..', p)

export default defineConfig({
  root: r('src/renderer'),
  resolve: {
    alias: {
      '@domain': r('src/domain'),
      '@engine': r('src/engine'),
      '@data': r('src/data'),
      '@calibrate': r('src/calibrate'),
      '@render2d': r('src/render2d'),
      '@render3d': r('src/render3d'),
      '@renderer': r('src/renderer'),
    },
  },
  worker: { format: 'es' },
  plugins: [react()],
  server: { port: 5179, strictPort: true },
})
