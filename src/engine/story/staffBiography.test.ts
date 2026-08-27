/**
 * Staff-sketch tests. The bar is the same as the player biography's, applied to
 * a much thinner record: it may name what the game measures (attributes, system,
 * demeanour, a hired retiree's playing career) and may not invent the tenures,
 * hirings and firings nobody wrote down.
 */
import { describe, expect, it } from 'vitest'
import { isEligible, type ContentCtx, type ContentUse } from './contentEngine'
import {
  STAFF_BIOGRAPHY_POOLS,
  buildStaffBiography,
  type StaffBioFacts,
} from './staffBiography'

function staff(o: Partial<StaffBioFacts> & { staffId: string }): StaffBioFacts {
  return {
    staffId: o.staffId,
    name: o.name ?? 'Dale Ferriman',
    role: o.role ?? 'headCoach',
    roleLabel: o.roleLabel ?? 'Head Coach',
    rating: o.rating ?? 68,
    judgment: o.judgment ?? 60,
    attributes: o.attributes ?? [],
    ...(o.clubShort !== undefined ? { clubShort: o.clubShort } : {}),
    ...(o.clubCity !== undefined ? { clubCity: o.clubCity } : {}),
    ...(o.demeanor !== undefined ? { demeanor: o.demeanor } : {}),
    ...(o.specialty !== undefined ? { specialty: o.specialty } : {}),
    ...(o.system !== undefined ? { system: o.system } : {}),
    ...(o.formerPlayer !== undefined ? { formerPlayer: o.formerPlayer } : {}),
  }
}

const coach = (): StaffBioFacts => staff({
  staffId: 's-coach',
  name: 'Dale Ferriman',
  role: 'headCoach',
  roleLabel: 'Head Coach',
  clubShort: 'Penguins',
  clubCity: 'Pittsburgh',
  rating: 84,
  judgment: 71,
  demeanor: 'analytical',
  attributes: [
    { label: 'tactics', value: 18 },
    { label: 'the power play', value: 16 },
    { label: 'man-management', value: 5 },
    { label: 'coaching forwards', value: 12 },
  ],
  system: {
    label: 'Low-Event Trap',
    philosophy: 'Defence-first puck-possession coach',
    blurb: 'Clogs the neutral zone, forces dumps, and wins on the margins.',
  },
})

describe('staff biography — truth', () => {
  it('names only attributes the record actually holds', () => {
    const text = buildStaffBiography(coach())!.paragraphs.join(' ')
    expect(text).toMatch(/tactics/)
    expect(text).toMatch(/power play/)
    expect(text).toMatch(/man-management/) // the genuine weakness
    // Nothing was supplied for these, so nothing may be said about them.
    expect(text).not.toMatch(/judging potential|physiotherapy/)
  })

  it('claims no playing career for a man who has none on file', () => {
    const text = buildStaffBiography(coach())!.paragraphs.join(' ')
    expect(text).not.toMatch(/played \d+ games|before he retired|hanging them up/i)
  })

  it('cites a playing career when the record book holds one', () => {
    const bio = buildStaffBiography(staff({
      staffId: 's-legend',
      name: 'Petr Novak',
      clubShort: 'Blues',
      clubCity: 'St. Louis',
      formerPlayer: { position: 'Defenseman', gamesPlayed: 1042, points: 511, retiredYear: 2029 },
    }))!
    const text = bio.paragraphs.join(' ')
    expect(bio.beats).toContain('formerPlayer')
    expect(text).toMatch(/1,042/)
    expect(text).toMatch(/2029/)
  })

  it('never invents a weakness when every attribute is strong', () => {
    const bio = buildStaffBiography(staff({
      staffId: 's-elite', clubShort: 'Avalanche', clubCity: 'Colorado', rating: 88,
      attributes: [{ label: 'tactics', value: 19 }, { label: 'motivating', value: 17 }],
    }))!
    expect(bio.beats).not.toContain('weakness')
  })

  it('says nothing about a club when he has none', () => {
    const text = buildStaffBiography(staff({
      staffId: 's-free', role: 'headCoach', roleLabel: 'Head Coach', rating: 61,
    }))!.paragraphs.join(' ')
    expect(text).toMatch(/without a club/i)
    expect(text).not.toMatch(/\bthe\s+[.,]/)
  })
})

describe('staff biography — craft', () => {
  const BANNED = [
    'notably', 'moreover', 'furthermore', 'additionally', 'showcasing',
    'boasts', 'a testament to', 'delve', 'not only', 'truly', 'undoubtedly',
  ]

  it('no authored variant uses generated-prose vocabulary', () => {
    for (const [pool, variants] of Object.entries(STAFF_BIOGRAPHY_POOLS)) {
      for (const v of variants) {
        for (const banned of BANNED) {
          expect(v.text.toLowerCase().includes(banned), `${pool}/${v.id} uses "${banned}"`).toBe(false)
        }
      }
    }
  })

  it('no authored variant reuses an id', () => {
    const seen = new Set<string>()
    for (const variants of Object.values(STAFF_BIOGRAPHY_POOLS)) {
      for (const v of variants) {
        expect(seen.has(v.id), `duplicate variant id ${v.id}`).toBe(false)
        seen.add(v.id)
      }
    }
  })

  it('every pool fires at the weakest state its detector can produce', () => {
    const floors: Record<string, ContentCtx[]> = {
      identity: [{ role: 'physio', hasClub: false }, { role: 'dataAnalyst', hasClub: true }],
      system: [{}],
      strength: [{ strongVal1: 15, hasStrong2: false }],
      weakness: [{}],
      formerPlayer: [{ playerGp: 1, playerPts: 0 }],
      standing: [{ rating: 60 }], // the mid band deliberately says nothing
    }
    for (const [pool, variants] of Object.entries(STAFF_BIOGRAPHY_POOLS)) {
      if (pool === 'standing') continue
      for (const ctx of floors[pool]) {
        expect(
          variants.filter((v) => isEligible(v, ctx)).length,
          `${pool} selects nothing for ${JSON.stringify(ctx)}`,
        ).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('an average staff member gets no verdict on his standing', () => {
    // Saying "he is fine" about everyone is noise. Only the ends speak.
    const bio = buildStaffBiography(staff({
      staffId: 's-mid', clubShort: 'Ducks', clubCity: 'Anaheim', rating: 62,
      attributes: [{ label: 'tactics', value: 11 }],
    }))!
    expect(bio.beats).not.toContain('standing')
  })

  it('two scouts on the same beat do not get the same sentence', () => {
    // The failure this catches was real and shipped to a screenshot: a club's
    // scouts sit stacked on one card, so two men on the same beat with the same
    // rating band read as one paragraph printed twice. Staff repetition is far
    // more visible than player repetition — the cards are adjacent.
    const beat = (id: string, name: string): StaffBioFacts => staff({
      staffId: id, name, role: 'scout', roleLabel: 'Scout',
      specialty: 'Europe', clubShort: 'Icebreakers', clubCity: 'Frost Harbor',
      rating: 40, judgment: 52, demeanor: 'calm',
      attributes: [{ label: 'judging players', value: 9 }],
    })
    // One shared ledger for the list is what guarantees it, rather than hoping
    // two seeds land differently.
    const ledger: ContentUse[] = []
    const names = ['Ivan Kane', 'Wyatt Stastny', 'Teemu Gallagher', 'Olli Rask']
    const shapes = names.map((n, i) => {
      const bio = buildStaffBiography(beat(`s-${i}`, n), ledger)!
      // Blank the names so only the authored SHAPE is compared.
      return bio.paragraphs.join(' ').replace(/[A-Z][a-z]+/g, 'X')
    })
    expect(new Set(shapes).size).toBe(shapes.length)
  })

  it('no single authored sentence dominates a staff list', () => {
    const shapes: string[] = []
    const ROLES = ['scout', 'assistantCoach', 'headCoach', 'physio'] as const
    for (let i = 0; i < 60; i++) {
      const bio = buildStaffBiography(staff({
        staffId: `d-${i}`,
        name: `Given${i} Family${i}`,
        role: ROLES[i % 4],
        roleLabel: 'Staff',
        specialty: ['Europe', 'College', 'Power Play', 'Forwards'][i % 4],
        clubShort: `Club${i % 7}`,
        clubCity: `City${i % 7}`,
        rating: 38 + (i % 50),
        judgment: 35 + (i % 55),
        demeanor: (['fiery', 'calm', 'analytical', 'motivator', 'pragmatic'] as const)[i % 5],
        attributes: [
          { label: 'tactics', value: 3 + (i % 18) },
          { label: 'motivating', value: 4 + (i % 16) },
        ],
      }))
      expect(bio).not.toBeNull()
      for (const s of bio!.paragraphs.join(' ').split(/(?<=\.) /)) {
        shapes.push(s.replace(/\d+/g, '#').replace(/\b(Club|City|Given|Family)\d*\b/g, 'X'))
      }
    }
    const counts = new Map<string, number>()
    for (const s of shapes) counts.set(s, (counts.get(s) ?? 0) + 1)
    const [worst, worstN] = [...counts].sort((a, b) => b[1] - a[1])[0]
    expect(
      worstN / 60,
      `"${worst}" is used by ${worstN} of 60 sketches — that pool needs siblings at its specificity`,
    ).toBeLessThanOrEqual(0.34)
  })

  it('is stable between openings and differs between people', () => {
    const a = buildStaffBiography(coach())
    expect(buildStaffBiography(coach())).toEqual(a)

    const sketches = new Set<string>()
    for (let i = 0; i < 24; i++) {
      const bio = buildStaffBiography(staff({
        staffId: `s-${i}`,
        name: `Coach ${i} Surname${i}`,
        role: (['headCoach', 'scout', 'assistantCoach', 'physio'] as const)[i % 4],
        roleLabel: 'Staff',
        clubShort: `Club${i % 6}`,
        clubCity: `City${i % 6}`,
        rating: 50 + (i % 40),
        judgment: 40 + (i % 50),
        demeanor: (['fiery', 'calm', 'analytical', 'motivator', 'pragmatic'] as const)[i % 5],
        attributes: [
          { label: 'tactics', value: 4 + (i % 16) },
          { label: 'motivating', value: 3 + (i % 17) },
        ],
      }))
      expect(bio).not.toBeNull()
      sketches.add(bio!.paragraphs.join(' '))
    }
    expect(sketches.size).toBe(24)
  })

  it('leaves no unfilled slot', () => {
    const cases = [
      coach(),
      staff({ staffId: 'z1', role: 'owner', roleLabel: 'Owner', clubShort: 'Flames', clubCity: 'Calgary' }),
      staff({ staffId: 'z2', role: 'scout', roleLabel: 'Scout', specialty: 'Scandinavia', clubShort: 'Wild', clubCity: 'Minnesota', judgment: 82 }),
      staff({ staffId: 'z3', role: 'assistantGM', roleLabel: 'Assistant GM', clubShort: 'Blue Jackets', clubCity: 'Columbus' }),
      staff({ staffId: 'z4', role: 'physio', roleLabel: 'Physio' }),
    ]
    for (const f of cases) {
      const bio = buildStaffBiography(f)
      expect(bio).not.toBeNull()
      const text = bio!.paragraphs.join(' ')
      expect(text, `unfilled slot for ${f.staffId}: ${text}`).not.toMatch(/\{[a-zA-Z]/)
      expect(text).not.toMatch(/ {2}/)
      expect(text).not.toMatch(/ [,.;]/)
    }
  })
})
