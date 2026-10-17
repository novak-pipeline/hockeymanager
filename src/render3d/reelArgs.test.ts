/**
 * The reel runner's flags (W3 S4 carry-over: `npm run reel` lost `--out` when
 * the folder had a space, and the S3 reel went to the default folder).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

type ReadFlag = (argv: string[], env: Record<string, string | undefined>, k: string, d: unknown, bool?: ReadonlySet<string>) => unknown
type StrayArgs = (argv: string[], bool?: ReadonlySet<string>) => string[]
type UnCaret = (argv: string[]) => string[]

const load = async (): Promise<{ readFlag: ReadFlag; strayArgs: StrayArgs; unCaret: UnCaret }> =>
  (await import(pathToFileURL(resolve(process.cwd(), 'scripts/dev/cliFlags.mjs')).href)) as { readFlag: ReadFlag; strayArgs: StrayArgs; unCaret: UnCaret }

const OUT = 'K:/Hockey Game/.cache/reel-s4'
const BOOL = new Set(['record'])
const argv = (...a: string[]): string[] => ['node', 'viewer-truth.mjs', '--record', ...a]

describe('reel runner flags', () => {
  it('reads --out with a space in every form npm hands it over', async () => {
    const { readFlag, strayArgs } = await load()
    // npm run reel -- --out=<dir>
    expect(readFlag(argv(`--out=${OUT}`), {}, 'out', 'd', BOOL)).toBe(OUT)
    // npm run reel -- --out <dir>
    expect(readFlag(argv('--out', OUT), {}, 'out', 'd', BOOL)).toBe(OUT)
    expect(strayArgs(argv('--out', OUT), BOOL)).toEqual([])
    // npm run reel --out=<dir>: npm keeps it as its own config
    expect(readFlag(argv(), { npm_config_out: OUT }, 'out', 'd', BOOL)).toBe(OUT)
    // the boolean flag never swallows the next argument
    expect(readFlag(argv(`--out=${OUT}`), {}, 'record', false, BOOL)).toBe(true)
    // npm run reel --out <dir>: npm eats the flag and leaves the path bare: refused, not guessed
    expect(strayArgs(argv(OUT), BOOL)).toEqual([OUT])
    expect(readFlag(argv(), {}, 'out', 'd', BOOL)).toBe('d')
  })

  it("undoes cmd's caret escaping (what `npm run reel -- --out=<dir with a space>` really hands node)", async () => {
    const { readFlag, unCaret } = await load()
    // captured from the S4 run: the chain starts with the electron-vite .cmd shim, so cmd's carets reach node
    const raw = argv('^--out=K:/Hockey^ Game/.cache/reel-s4^', '--only=ozCycleShot')
    expect(readFlag(raw, {}, 'out', 'default', BOOL)).toBe('default') // the S3 bug: --out silently ignored
    const args = unCaret(raw)
    expect(readFlag(args, {}, 'out', 'default', BOOL)).toBe(OUT)
    expect(readFlag(args, {}, 'only', null, BOOL)).toBe('ozCycleShot')
  })

  it('the runner reads its flags through cliFlags', () => {
    const src = readFileSync(resolve(process.cwd(), 'scripts/dev/viewer-truth.mjs'), 'utf8')
    expect(src).toMatch(/const ARGV = unCaret\(process\.argv\)/)
    expect(src).toMatch(/readFlag\(ARGV, process\.env/)
    expect(src).toMatch(/strayArgs\(ARGV/)
  })
})
