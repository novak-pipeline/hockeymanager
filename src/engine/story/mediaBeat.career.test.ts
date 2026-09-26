/**
 * The media layer on a real career (docs/MEDIA-BEAT.md): the beat files every
 * day from live sim state, links its pieces on the Feed, respects the inbox
 * budget, survives a save, covers other clubs on demand, and the presser and
 * people events write into the systems they promise to.
 */
import { describe, expect, it } from 'vitest'
import { generateLeague } from '@data/generate'
import { Career } from '@engine/career/career'

function play(career: Career, steps: number): void {
  for (let i = 0; i < steps; i++) {
    const pc = career.getPressConference()
    if (pc) career.answerPressConference('', pc.options?.[1]?.tone ?? 'measured', pc.options?.[1]?.id)
    if (!career.step()) {
      const c = career as unknown as { delegateStaffMeeting: () => unknown; delegateScoutMeeting: () => unknown; resolveScoutDigest: () => unknown }
      c.delegateStaffMeeting()
      c.delegateScoutMeeting()
      c.resolveScoutDigest()
      if (!career.step()) break
    }
  }
}

describe('the daily beat on a real career', () => {
  const data = generateLeague({ seed: 4242 })
  const userTid = data.league.teams[5]!
  const career = new Career(data, 4242, userTid)
  play(career, 45)
  const beat = career.getBeat()

  it('files from live state: grades, gamedays, notebooks, a mailbag', () => {
    const kinds = new Set(beat.articles.map((a) => a.kind))
    expect(kinds.has('grades')).toBe(true)
    expect(kinds.has('gameday')).toBe(true)
    expect(kinds.has('notebook')).toBe(true)
    expect(kinds.has('mailbag')).toBe(true)
    // Grades name men who actually dressed for the club.
    const grades = beat.articles.find((a) => a.kind === 'grades')!
    expect(grades.grades!.length).toBeGreaterThanOrEqual(15)
    for (const a of beat.articles) {
      const t = [a.headline, a.dek, ...a.body, ...(a.sections ?? []).flatMap((s) => s.lines), ...(a.qa ?? []).flatMap((q) => [q.question, q.answer])].join(' ')
      expect(t, a.headline).not.toMatch(/\{[a-zA-Z]|undefined|NaN/)
    }
  })

  it('no headline repeats verbatim in a stretch of the season', () => {
    const heads = beat.articles.map((a) => a.headline)
    const dups = heads.filter((h, i) => heads.indexOf(h) !== i)
    expect(dups).toEqual([])
  })

  it('the writer is one person with one outlet, distinct from the columnist', () => {
    expect(beat.writer.name).not.toMatch(/Carver|Mercer|Doyle/)
    const mc = career.getMediaCircuit()
    const beatRow = mc.rows.find((r) => r.personaId === 'beat')!
    expect(beatRow.name).toBe(beat.writer.name)
    expect(beatRow.outlet).toBe(beat.outlet)
  })

  it('links its pieces on the Feed, and the link opens an article that exists', () => {
    const feed = career.getFeed()
    const links = feed.posts.filter((p) => p.authorId === beat.authorId)
    expect(links.length).toBeGreaterThan(3)
    expect(feed.authors[beat.authorId]?.kind).toBe('beat')
    const ids = new Set(beat.articles.map((a) => a.id))
    for (const p of links) if (p.articleId) expect(ids.has(p.articleId)).toBe(true)
  })

  it('keeps the inbox curated: at most one beat item a week', () => {
    const inBox = beat.articles.filter((a) => a.inbox)
    const days = beat.articles.length > 0 ? beat.articles[0]!.day - beat.articles[beat.articles.length - 1]!.day : 0
    expect(inBox.length).toBeLessThanOrEqual(Math.ceil((days + 1) / 7))
  })

  it('covers another club lightly, on demand, from its own lines and injuries', () => {
    const other = career.getBeat(data.league.teams[0] as string)
    expect(other.light).toBe(true)
    expect(other.outlet).not.toBe(beat.outlet)
    expect(other.articles.some((a) => a.kind === 'notebook')).toBe(true)
  })

  it('survives a save; an old save without media loads empty', () => {
    const snap = career.exportSnapshot('t', '2029-01-01')
    const back = Career.fromSnapshot(structuredClone(snap))
    expect(back.getBeat().articles.length).toBe(beat.articles.length)
    const old = structuredClone(snap) as unknown as Record<string, unknown>
    delete old.media
    const legacy = Career.fromSnapshot(old as unknown as typeof snap)
    expect(legacy.getBeat().articles).toEqual([])
  })
})

describe('pressers, claims and the chronicle', () => {
  it('backing the coach on the record, then firing him, is quoted back and written down', () => {
    const data = generateLeague({ seed: 77 })
    const career = new Career(data, 77, data.league.teams[2]!)
    play(career, 20)
    const c = career as unknown as {
      queuePresserV2: (t: string, s: Record<string, string>, d: number, e?: object, sub?: { id: string; name: string }) => void
      getTeamStaff: (id: string) => { headCoach: { id: string; name: string } }
      userTeamId: string
      chronicle: { events: Array<{ kind: string; details?: { verdict?: string } }> }
      media: { claims: Array<{ kind: string; status: string }> }
      currentDay: number
      pressConference: unknown
    }
    const coach = c.getTeamStaff(c.userTeamId).headCoach
    c.pressConference = null
    c.queuePresserV2('hotSeat', { coach: coach.name, record: '5-10-2', rank: '30th' }, c.currentDay, {}, { id: coach.id, name: coach.name })
    const pc = career.getPressConference()!
    expect(pc.options!.map((o) => o.id)).toContain('back')
    career.answerPressConference('', 'praise', 'back')
    expect(c.media.claims.some((cl) => cl.kind === 'coachBacked' && cl.status === 'open')).toBe(true)
    expect(c.chronicle.events.some((e) => e.kind === 'voteOfConfidence')).toBe(true)
    career.fireCoach()
    expect(c.media.claims.some((cl) => cl.kind === 'coachBacked' && cl.status === 'wrong')).toBe(true)
    expect(c.chronicle.events.some((e) => e.kind === 'claimResolved' && e.details?.verdict === 'wrong')).toBe(true)
    expect(career.getBeat().articles.some((a) => a.kind === 'claim')).toBe(true)
  })

  it('answers diverge: "core" lifts the man and goes on the record; "evaluated" costs him', () => {
    const mk = (): { career: Career; pid: string; morale: () => number; c: { queuePresserV2: Function; media: { claims: Array<{ kind: string }> }; currentDay: number; pressConference: unknown } } => {
      const data = generateLeague({ seed: 91 })
      const career = new Career(data, 91, data.league.teams[1]!)
      play(career, 10)
      const team = data.teams.get(data.league.teams[1]!)!
      const pid = team.roster.find((id) => data.players.get(id)!.position !== 'G')! as string
      const p = data.players.get(pid as never)!
      p.morale = 50
      return { career, pid, morale: () => p.morale, c: career as never }
    }
    const a = mk()
    a.c.pressConference = null
    a.c.queuePresserV2('playerPlans', { name: 'X', first: 'X' }, a.c.currentDay, {}, { id: a.pid, name: 'X' })
    a.career.answerPressConference('', 'praise', 'core')
    const b = mk()
    b.c.pressConference = null
    b.c.queuePresserV2('playerPlans', { name: 'X', first: 'X' }, b.c.currentDay, {}, { id: b.pid, name: 'X' })
    b.career.answerPressConference('', 'measured', 'evaluate')
    expect(a.morale()).toBeGreaterThan(b.morale())
    expect(a.c.media.claims.some((cl) => cl.kind === 'playerCore')).toBe(true)
    expect(b.c.media.claims.some((cl) => cl.kind === 'playerCore')).toBe(false)
  })

  it('a new captain enters the chronicle and his biography can tell it', () => {
    const data = generateLeague({ seed: 5 })
    const career = new Career(data, 5, data.league.teams[0]!)
    const team = data.teams.get(data.league.teams[0]!)!
    const pick = team.roster.find((id) => data.players.get(id)!.position !== 'G' && id !== team.captainId)!
    expect(career.setCaptain(pick as string).ok).toBe(true)
    const c = career as unknown as { chronicle: { events: Array<{ kind: string; playerIds: string[] }> } }
    expect(c.chronicle.events.some((e) => e.kind === 'captaincy' && e.playerIds[0] === (pick as string))).toBe(true)
  })

  it('a delegated presser changes nothing', () => {
    const data = generateLeague({ seed: 13 })
    const career = new Career(data, 13, data.league.teams[4]!)
    const c = career as unknown as { queuePresserV2: Function; currentDay: number; punditState: { pundits: Array<{ rapport: number; interactions: number }> } }
    const before = JSON.stringify(c.punditState)
    c.queuePresserV2('seasonClaim', {}, c.currentDay)
    career.answerPressConference('', 'measured', 'delegate')
    expect(career.getPressConference()).toBeNull()
    expect(JSON.stringify(c.punditState)).toBe(before)
  })
})
