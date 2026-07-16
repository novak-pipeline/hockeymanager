/**
 * Persistence-layer tests. The save payload is gzip-compressed on disk; these
 * assert the write→read round-trip is lossless, that legacy uncompressed saves
 * still load (backward-compat via gzip-magic sniffing), and that listing lifts
 * headers out of a compressed file.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock Electron's app so savesDir() points at a throwaway temp directory.
const dataDir = mkdtempSync(join(tmpdir(), 'hm-saves-test-'))
vi.mock('electron', () => ({
  app: { getPath: () => dataDir }
}))

import { listSaves, readSave, savesDir, writeSave } from './saves'

const sampleSnapshot = (): string =>
  JSON.stringify({
    saveName: 'Test Save',
    savedAt: '2026-07-15T00:00:00.000Z',
    phase: 'regularSeason',
    year: 2031,
    userTeamId: 't1',
    leagueData: { teams: [['t1', { name: 'Sample Club' }]] },
    // Repetitive bulk that stands in for careerHistory — must survive intact.
    players: Array.from({ length: 50 }, (_, i) => ({
      id: `p${i}`,
      careerHistory: Array.from({ length: 12 }, (_, s) => ({
        season: 2019 + s,
        team: 'Junior Club',
        gp: 68,
        g: 20,
        a: 30,
        pts: 50
      }))
    }))
  })

afterEach(() => {
  vi.restoreAllMocks()
})

describe('save compression', () => {
  it('round-trips a snapshot losslessly', async () => {
    const json = sampleSnapshot()
    await writeSave('slot-1', json)
    const read = await readSave('slot-1')
    expect(read).toBe(json)
    // Parsed structure is preserved, including the bulky careerHistory arrays.
    expect(JSON.parse(read).players[0].careerHistory).toHaveLength(12)
  })

  it('writes a gzip file that is smaller than the raw JSON', async () => {
    const json = sampleSnapshot()
    await writeSave('slot-2', json)
    const onDisk = readFileSync(join(savesDir(), 'slot-2.json'))
    // gzip magic number — the file is compressed, not plain JSON.
    expect(onDisk[0]).toBe(0x1f)
    expect(onDisk[1]).toBe(0x8b)
    // Repetitive stat lines compress hard; well under the raw byte length.
    expect(onDisk.length).toBeLessThan(Buffer.byteLength(json, 'utf8') / 2)
  })

  it('still reads legacy uncompressed saves', async () => {
    const json = sampleSnapshot()
    // Simulate a save written before compression: plain UTF-8 JSON on disk.
    writeFileSync(join(savesDir(), 'legacy.json'), json, 'utf8')
    const read = await readSave('legacy')
    expect(read).toBe(json)
  })

  it('lists headers from a compressed save', async () => {
    await writeSave('slot-3', sampleSnapshot())
    const entries = await listSaves()
    const entry = entries.find((e) => e.slot === 'slot-3')
    expect(entry).toBeDefined()
    expect(entry?.header.saveName).toBe('Test Save')
    expect(entry?.header.teamName).toBe('Sample Club')
    expect(entry?.header.year).toBe(2031)
  })
})
