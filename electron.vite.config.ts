import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

/** Opt-in profiling build — see the renderer `build` block below. */
const PROFILE_BUILD = process.env.PROFILE_BUILD === '1'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') },
        // node-llama-cpp is a native, optional dependency loaded lazily at
        // runtime (#149). Keep it (and its per-platform binary subpackages)
        // external so Rollup doesn't try to bundle a native .node / a platform
        // package that isn't installed on this OS.
        external: ['node-llama-cpp', /^@node-llama-cpp\//]
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        // The renderer runs with the Chromium sandbox ENABLED (webPreferences.sandbox:
        // true — required so onnxruntime-web's WASM voice runtime doesn't crash the
        // renderer). A sandboxed preload is evaluated as a plain CommonJS script and
        // canNOT use ESM `import` (Electron throws "Cannot use import statement outside a
        // module" and the window.hockey bridge silently never loads). Force a CommonJS
        // build with a .cjs extension so it's unambiguously CJS regardless of the
        // package's "type": "module".
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    resolve: {
      alias: {
        '@domain': resolve('src/domain'),
        '@engine': resolve('src/engine'),
        '@data': resolve('src/data'),
        '@calibrate': resolve('src/calibrate'),
        '@render2d': resolve('src/render2d'),
        '@render3d': resolve('src/render3d'),
        '@renderer': resolve('src/renderer')
      }
    },
    build: {
      // PROFILE_BUILD=1 produces a build a CPU profiler can read: names survive
      // (no minification) and React/Pixi land in their OWN chunks, so sampled
      // self-time can be attributed by file even though react-dom ships
      // pre-minified. Ordinary builds are untouched.
      ...(PROFILE_BUILD ? { minify: false as const } : {}),
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') },
        ...(PROFILE_BUILD
          ? { output: { manualChunks: { react: ['react', 'react-dom'], pixi: ['pixi.js'] } } }
          : {})
      }
    },
    plugins: [react()]
  }
})
