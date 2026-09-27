/**
 * Standalone config for the M0 realism scorecard (`npm run scorecard`). Keeps
 * the multi-minute run out of `npm test` while using the real modules.
 */
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@domain': resolve('src/domain'),
      '@engine': resolve('src/engine'),
      '@data': resolve('src/data'),
      '@calibrate': resolve('src/calibrate'),
      '@render2d': resolve('src/render2d'),
      '@render3d': resolve('src/render3d')
    }
  },
  test: {
    include: ['src/engine/analysis/scorecard.harness.test.ts'],
    environment: 'node',
    testTimeout: 3_600_000,
    hookTimeout: 600_000
  }
})
