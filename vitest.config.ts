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
    // Several engine tests sim tens of full games to get a clean signal; the
    // 5s default is a coin-flip on slower/CI machines and has nothing to do
    // with the behaviour under test.
    testTimeout: 60_000
  }
})
