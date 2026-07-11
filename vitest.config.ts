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
    include: ['src/**/*.test.ts'],
    // draftCalibration is a STANDALONE calibration harness, not a unit test: it
    // sims 3 full seasons in one synchronous loop (minutes, un-timeout-able since
    // it never yields), so it would stall/kill the shared suite worker. Run it on
    // demand: `npx vitest run --config vitest.config.ts src/engine/career/draftCalibration.test.ts`
    // (it self-excludes only from the default `npm test`).
    exclude: ['**/node_modules/**', '**/dist/**', 'src/engine/career/draftCalibration.test.ts'],
    environment: 'node',
    // Fixed-seed full/quick-sim and full-season tests run several seconds each;
    // under a loaded serial run the 5s default caused false timeouts.
    testTimeout: 30000,
    hookTimeout: 30000
  }
})
