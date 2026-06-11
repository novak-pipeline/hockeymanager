/**
 * Sanity checks for the sequence-rhythm targets extracted from NHL play-by-play.
 *
 * These tests load CALIBRATION_TARGETS (which reads targets.json) and verify
 * that the extracted SequenceTargets are present and fall within plausible
 * real-NHL ranges.  If a number is wildly out of range, it signals a bug in
 * the extraction logic in importNhl.ts.
 *
 * Extracted numbers (60 games, 2023-24 season):
 *   stoppagesPerGame: offside=4.35, icing=8.02, goalieFreeze=16.85, other=13.43
 *   zoneTimeShare: OZ=0.680, NZ=0.099, DZ=0.221
 *   entriesPerTeamPer60: 37.9
 *   shotsPerEntry: 1.09
 *   rushShotShare: 0.529  (≈ 53% of shots come within 6s of a zone entry)
 *   reboundShotShare: 0.067
 *   meanSecondsBetweenStoppages: 66.7
 *   faceoffZoneMix: OZ=0.361, NZ=0.299, DZ=0.340
 */
import { describe, it, expect } from 'vitest'
import { CALIBRATION_TARGETS } from './index'

describe('sequence targets', () => {
  it('sequences key is present in CALIBRATION_TARGETS', () => {
    expect(CALIBRATION_TARGETS.sequences).toBeDefined()
  })

  describe('stoppagesPerGame', () => {
    it('offside is in plausible range [1, 8] per game', () => {
      const v = CALIBRATION_TARGETS.sequences!.stoppagesPerGame.offside
      expect(v).toBeGreaterThan(1)
      expect(v).toBeLessThan(8)
    })

    it('icing is in plausible range [2, 12] per game', () => {
      const v = CALIBRATION_TARGETS.sequences!.stoppagesPerGame.icing
      expect(v).toBeGreaterThan(2)
      expect(v).toBeLessThan(12)
    })

    it('goalieFreeze is in plausible range [5, 30] per game', () => {
      const v = CALIBRATION_TARGETS.sequences!.stoppagesPerGame.goalieFreeze
      expect(v).toBeGreaterThan(5)
      expect(v).toBeLessThan(30)
    })

    it('other stoppages is in plausible range [2, 25] per game', () => {
      const v = CALIBRATION_TARGETS.sequences!.stoppagesPerGame.other
      expect(v).toBeGreaterThan(2)
      expect(v).toBeLessThan(25)
    })
  })

  describe('zoneTimeShare', () => {
    it('zone shares are all positive', () => {
      const z = CALIBRATION_TARGETS.sequences!.zoneTimeShare
      expect(z.offensive).toBeGreaterThan(0)
      expect(z.neutral).toBeGreaterThan(0)
      expect(z.defensive).toBeGreaterThan(0)
    })

    it('zone shares are all less than 1', () => {
      const z = CALIBRATION_TARGETS.sequences!.zoneTimeShare
      expect(z.offensive).toBeLessThan(1)
      expect(z.neutral).toBeLessThan(1)
      expect(z.defensive).toBeLessThan(1)
    })

    it('zone shares sum to approximately 1', () => {
      const z = CALIBRATION_TARGETS.sequences!.zoneTimeShare
      const sum = z.offensive + z.neutral + z.defensive
      expect(sum).toBeCloseTo(1, 5)
    })
  })

  describe('entriesPerTeamPer60', () => {
    it('is in plausible range [20, 90] per team per 60 min', () => {
      const v = CALIBRATION_TARGETS.sequences!.entriesPerTeamPer60
      expect(v).toBeGreaterThan(20)
      expect(v).toBeLessThan(90)
    })
  })

  describe('shotsPerEntry', () => {
    it('is in plausible range [0.5, 3] unblocked attempts per entry', () => {
      const v = CALIBRATION_TARGETS.sequences!.shotsPerEntry
      expect(v).toBeGreaterThan(0.5)
      expect(v).toBeLessThan(3)
    })
  })

  describe('rushShotShare', () => {
    it('is in plausible range (0, 1)', () => {
      const v = CALIBRATION_TARGETS.sequences!.rushShotShare
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThan(1)
    })
  })

  describe('reboundShotShare', () => {
    it('is in plausible range (0, 1)', () => {
      const v = CALIBRATION_TARGETS.sequences!.reboundShotShare
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThan(1)
    })

    it('is less than rushShotShare (rebounds are rarer than rush shots)', () => {
      const seq = CALIBRATION_TARGETS.sequences!
      expect(seq.reboundShotShare).toBeLessThan(seq.rushShotShare)
    })
  })

  describe('meanSecondsBetweenStoppages', () => {
    it('is in plausible range [20, 120] seconds', () => {
      const v = CALIBRATION_TARGETS.sequences!.meanSecondsBetweenStoppages
      expect(v).toBeGreaterThan(20)
      expect(v).toBeLessThan(120)
    })
  })

  describe('faceoffZoneMix', () => {
    it('all shares are in (0, 1)', () => {
      const f = CALIBRATION_TARGETS.sequences!.faceoffZoneMix
      expect(f.offensive).toBeGreaterThan(0)
      expect(f.offensive).toBeLessThan(1)
      expect(f.neutral).toBeGreaterThan(0)
      expect(f.neutral).toBeLessThan(1)
      expect(f.defensive).toBeGreaterThan(0)
      expect(f.defensive).toBeLessThan(1)
    })

    it('shares sum to approximately 1', () => {
      const f = CALIBRATION_TARGETS.sequences!.faceoffZoneMix
      const sum = f.offensive + f.neutral + f.defensive
      expect(sum).toBeCloseTo(1, 5)
    })
  })
})
