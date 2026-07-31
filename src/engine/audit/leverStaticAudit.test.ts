/**
 * STATIC HALF OF THE LEVER AUDIT (task #154) — and the tripwire that keeps
 * docs/LEVER-AUDIT.md honest.
 *
 * Some levers do not need a simulation to classify: if no line of engine code
 * ever reads the field, the setting cannot possibly change a result. That is a
 * grep, not a statistic, and it is the strongest evidence available.
 *
 * This test walks every field of `TeamTactics` and asserts each one is in the
 * state the audit says it is:
 *   WIRED   — at least one non-test engine file reads it
 *   UNREAD  — no engine file reads it (a decorative setting)
 *
 * It fails when reality drifts from the audit in EITHER direction:
 *  - a WIRED lever quietly loses its last consumer (a lever silently going dead
 *    is precisely the Esports Manager failure), or
 *  - an UNREAD field gets wired without the audit being updated (good news that
 *    still needs the doc and the guard test to catch up).
 *
 * Unlike the measurement harnesses this is cheap, so it runs in `npm test`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEF_PAIR_SHARES, FWD_LINE_SHARES } from '@engine/league/deploymentValue'

/** Every field the tactics model exposes, and whether the engine reads it. */
export const WIRED_TACTICS = [
  'forecheck',
  'dZoneCoverage',
  'tempo',
  'specialTeams',
  'lineMatching',
  'aggressiveness',
  'gapControl',
  'puckPressure',
  'hitting',
  'passing',
  'shooting',
  'dumping',
] as const

/**
 * Fields the GM's tactics object carries that NO engine code reads. Every one
 * of these is decorative by construction — see docs/LEVER-AUDIT.md. None of
 * them is currently surfaced as a control in the UI, which is the only reason
 * they are not actively lying to the player.
 */
export const UNREAD_TACTICS = [
  'mentality',
  'backchecking',
  'tempoStyle',
  'breakout',
  'nzOffensive',
  'nzDefensive',
  'ozEntry',
  'forecheckVariant',
  'dZoneStructure',
  'offensiveFaceoff',
  'defensiveFaceoff',
  'shotTargeting',
  'personalTactics',
] as const

/** Nested tempo sliders, checked the same way. */
export const WIRED_TEMPO = ['pace', 'passRisk', 'shotEagerness', 'defensivePinch'] as const

const ENGINE_ROOTS = ['src/engine', 'src/render2d', 'src/render3d']

function sourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const e of entries) {
      const full = join(dir, e)
      if (statSync(full).isDirectory()) {
        walk(full)
      } else if (e.endsWith('.ts') && !e.includes('.test.') && !full.includes('audit')) {
        out.push(full)
      }
    }
  }
  for (const root of ENGINE_ROOTS) walk(resolve(process.cwd(), root))
  return out
}

/** Where in the engine a `tactics.<field>` read appears. */
function readsOf(field: string, files: string[]): string[] {
  // Matches `tactics.field`, `tactics?.field`, `tactics.tempo.field`, and
  // destructuring off a tactics object (`const { field } = t.tactics`).
  const direct = new RegExp(`tactics\\??\\.(tempo\\??\\.)?${field}\\b`)
  const destructured = new RegExp(`\\{[^}]*\\b${field}\\b[^}]*\\}\\s*=\\s*[A-Za-z0-9_.]*tactics`)
  const hits: string[] = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8')
    if (direct.test(src) || destructured.test(src)) hits.push(f)
  }
  return hits
}

describe('lever audit — static wiring (#154)', () => {
  const files = sourceFiles()

  it('finds engine sources to scan', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  for (const field of [...WIRED_TACTICS, ...WIRED_TEMPO]) {
    it(`tactics.${field} is still read by the engine`, () => {
      const hits = readsOf(field, files)
      expect(
        hits.length,
        `tactics.${field} is documented as WIRED in docs/LEVER-AUDIT.md but no engine file reads it any more. ` +
          `A lever that silently goes dead is the exact failure this audit exists to prevent — ` +
          `either restore the wiring or move the field to UNREAD_TACTICS and update the audit.`,
      ).toBeGreaterThan(0)
    })
  }

  it('the line board’s receipt uses the same deployment weights as the sim', () => {
    // deploymentValue.ts keeps a local copy of quickSim's line/pair usage weights
    // (the sim's are module-private). If the sim's weights change and the copy
    // does not, the GM's "what this board is worth" panel starts describing a
    // lineup model the engine no longer runs.
    const sim = readFileSync(resolve(process.cwd(), 'src/engine/quick/quickSim.ts'), 'utf8')
    const literal = (name: string): number[] => {
      const m = sim.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]+)\\]`))
      if (!m) throw new Error(`${name} not found in quickSim.ts`)
      return m[1]!.split(',').map((s) => Number(s.trim()))
    }
    expect(literal('FWD_LINE_WEIGHTS')).toEqual(FWD_LINE_SHARES)
    expect(literal('DEF_PAIR_WEIGHTS')).toEqual(DEF_PAIR_SHARES)
  })

  for (const field of UNREAD_TACTICS) {
    it(`tactics.${field} is still unread (decorative)`, () => {
      const hits = readsOf(field, files)
      expect(
        hits,
        `tactics.${field} is documented as DEAD in docs/LEVER-AUDIT.md but is now read by ${hits.join(', ')}. ` +
          `Good — but move it to WIRED_TACTICS, measure its real effect with the lever harness, ` +
          `and update docs/LEVER-AUDIT.md so the table stays true.`,
      ).toEqual([])
    })
  }
})
