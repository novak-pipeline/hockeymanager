/**
 * Command-line flags for the dev runners (viewer-truth / the reel).
 *
 * W3 S4: the S3 reel lost `--out` when the folder had a space in it. The
 * cause was cmd's caret escaping reaching node (unCaret, below). `npm run reel`
 * also takes its flags three ways, and the runner reads all of them:
 *  - `npm run reel -- --out=<dir>`: the flag reaches argv as `--out=<dir>`.
 *  - `npm run reel -- --out <dir>`: two argv entries; the value is the next one.
 *    (A quoted folder with a space is one entry; the old reader only knew the
 *    `=` form, so this one fell back to the default folder.)
 *  - `npm run reel --out=<dir>` (no `--`): npm takes `--out` as ITS config and
 *    never passes it on; it only survives as the env var `npm_config_out`.
 *    The runner read argv only, so the reel went to the default folder.
 *    `npm run reel --out <dir>` leaves `npm_config_out=true` and the path as a
 *    bare argument: that is refused loudly (strayArgs), never guessed.
 */

/**
 * Undo cmd.exe's caret escaping. `npm run reel` runs `electron-vite build &&
 * node viewer-truth.mjs …` through cmd; npm escapes an argument with a space
 * for cmd (`^--out=K:/Hockey^ Game/.cache/reel-s4^`), and because the chain
 * starts with a .cmd shim the carets reach node literally. The argument then
 * no longer started with `--out=`, so the reel silently fell back to the
 * default folder: that was the S3 "--out with a space is dropped" bug.
 * @param {string[]} argv
 */
export function unCaret(argv) {
  return argv.map((a) => (a.includes('^') ? a.replace(/\^(.)/g, '$1').replace(/\^$/, '') : a))
}

/**
 * @param {string[]} argv  process.argv
 * @param {Record<string, string | undefined>} env  process.env
 * @param {string} k  flag name without dashes
 * @param {unknown} d  default
 * @param {ReadonlySet<string>} [bool]  flags that never take a value
 */
export function readFlag(argv, env, k, d, bool = new Set()) {
  const args = argv.slice(2)
  const eq = args.find((a) => a.startsWith(`--${k}=`))
  if (eq !== undefined) return eq.slice(k.length + 3)
  const i = args.indexOf(`--${k}`)
  if (i >= 0) {
    const next = args[i + 1]
    return !bool.has(k) && next !== undefined && !next.startsWith('--') ? next : true
  }
  const npm = env[`npm_config_${k}`]
  if (npm === 'true') return true
  if (npm !== undefined && npm !== '' && !bool.has(k)) return npm
  return d
}

/**
 * Bare arguments nobody claimed (not a flag, not the value of a `--k <v>`
 * pair). When npm eats a flag, its value lands here and the runner stops.
 * @param {string[]} argv
 * @param {ReadonlySet<string>} [bool]
 */
export function strayArgs(argv, bool = new Set()) {
  const args = argv.slice(2)
  const out = []
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a.startsWith('--')) {
      const next = args[i + 1]
      if (!a.includes('=') && !bool.has(a.slice(2)) && next !== undefined && !next.startsWith('--')) i++
      continue
    }
    out.push(a)
  }
  return out
}
