/**
 * Standalone config for the on-demand playback profiler (playtest C2). Keeps the
 * profiler out of `npm test` (it replays whole games and prints timings) while
 * still letting it run against the real modules:
 *
 *   npx vitest run --config vitest.profile.config.ts
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
    include: ['src/render2d/playbackProfile.test.ts'],
    environment: 'node',
    testTimeout: 600_000,
    hookTimeout: 600_000
  }
})
