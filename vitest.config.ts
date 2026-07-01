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
    environment: 'node',
    // Fixed-seed full/quick-sim and full-season tests run several seconds each;
    // under a loaded serial run the 5s default caused false timeouts.
    testTimeout: 30000,
    hookTimeout: 30000
  }
})
