/**
 * THE STAFF BIOGRAPHY — the same content model, honestly scoped.
 *
 * A player's life is on the record: seasons, clubs, draft day, a peak, a
 * decline. A coach's is not. The game records his attributes, his tactical
 * identity, his demeanour, the club he works for, and — when a retired player
 * took a job — the career he had before it. That is a CHARACTER SKETCH, not a
 * career story, and pretending otherwise would mean inventing the tenures and
 * firings nobody wrote down.
 *
 * So this writes what it can prove and stops: what he is good at (his highest
 * attributes, named), what he is not (a genuinely low one, and only then), how
 * he wants the game played, and what he did before he was staff. Same Hades
 * machinery as {@link buildBiography} — authored pools, most-specific-wins,
 * seeded on his id so his sketch is stable and unlike the next man's.
 *
 * Serves EXCELLENCE.md B5.1 (the 5-character test): a coach the GM can
 * describe is a coach the GM remembers.
 */
import { Rng } from '@engine/shared/rng'
import { bioOpening } from '@engine/story/biography'
import {
  markUsed,
  renderTemplate,
  selectVariant,
  type ContentCtx,
  type ContentUse,
  type ContentVariant,
} from '@engine/story/contentEngine'

/* ═════════════════════════════ facts in ═════════════════════════════ */

export interface StaffBioFacts {
  staffId: string
  name: string
  role: 'headCoach' | 'assistantCoach' | 'assistantGM' | 'scout' | 'physio' | 'owner' | 'dataAnalyst'
  /** Plain-English role, as the personnel list prints it. */
  roleLabel: string
  /** The club he works for, as a nickname ("Penguins"). Absent = unattached.
   *  Templates supply the article, so this is never "the Penguins". */
  clubShort?: string
  /** The city half of that club's name ("Pittsburgh"). */
  clubCity?: string
  /** 40–90 quality. */
  rating: number
  /** 0–100 — how close his reads land to the truth. */
  judgment: number
  demeanor?: 'fiery' | 'calm' | 'analytical' | 'motivator' | 'pragmatic'
  specialty?: string
  /** EHM discipline attributes, 1–20, already labelled for display. */
  attributes: Array<{ label: string; value: number }>
  /** Head coaches only: his tactical identity. */
  system?: { label: string; philosophy: string; blurb: string }
  /**
   * He played before he coached. Only set when the game holds his playing
   * record — a hired retiree — never inferred from a name.
   */
  formerPlayer?: {
    position: string
    gamesPlayed: number
    points: number
    retiredYear: number
  }
}

export interface StaffBiographyView {
  paragraphs: string[]
  beats: string[]
  variantIds: string[]
}

/* ═════════════════════════════ helpers ═════════════════════════════ */

function hashId(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function commas(n: number): string {
  return Math.round(n).toLocaleString('en-US')
}

/** Attributes at or above this are worth naming as a strength. */
const STRONG = 15
/** At or below this, a weakness is real rather than noise. */
const WEAK = 6

/* ═══════════════════════════ authored pools ═══════════════════════════ */

/* ── IDENTITY. Slots: {name} {last} {roleLabel} {clubShort} {clubCity}
      {specialty} ── */

const IDENTITY_POOL: ContentVariant[] = [
  { id: 'sb.id.coach.fiery', conditions: { role: 'headCoach', demeanor: 'fiery', hasClub: true },
    text: `{last} coaches the {clubShort}, and the room knows within a week which version of him showed up to the rink.` },
  { id: 'sb.id.coach.calm', conditions: { role: 'headCoach', demeanor: 'calm', hasClub: true },
    text: `{last} is the head coach in {clubCity}. He does not raise his voice, and the players have worked out that this is not the same as not minding.` },
  { id: 'sb.id.coach.analytical', conditions: { role: 'headCoach', demeanor: 'analytical', hasClub: true },
    text: `{name} runs the {clubShort} bench off a laptop and a pre-scout, and he will tell you the shot map disagrees with you.` },
  { id: 'sb.id.coach.motivator', conditions: { role: 'headCoach', demeanor: 'motivator', hasClub: true },
    text: `{last} coaches the {clubShort}. His trade is the room: he gets more out of players than their files say he should.` },
  { id: 'sb.id.coach.pragmatic', conditions: { role: 'headCoach', demeanor: 'pragmatic', hasClub: true },
    text: `{last} has the {clubShort} bench. He coaches the roster he was given rather than the one he would have picked.` },
  { id: 'sb.id.coach', conditions: { role: 'headCoach', hasClub: true },
    text: `{name} is the head coach of the {clubShort}.` },

  // A club runs several scouts on the same beat, and their cards sit one above
  // the other — so this is the pool where a single sentence is most visible and
  // most damning. Siblings at equal specificity are the whole defence.
  { id: 'sb.id.scout.spec', conditions: { role: 'scout', hasSpecialty: true, hasClub: true },
    text: `{last} scouts {specialty} for the {clubShort}, which means airports, arenas, and a lot of bad coffee.` },
  { id: 'sb.id.scout.spec2', conditions: { role: 'scout', hasSpecialty: true, hasClub: true },
    text: `{specialty} is {last}'s patch. He files on it for the {clubShort}.` },
  { id: 'sb.id.scout.spec3', conditions: { role: 'scout', hasSpecialty: true, hasClub: true },
    text: `The {clubShort} send {last} to {specialty} and read what comes back.` },
  { id: 'sb.id.scout.spec4', conditions: { role: 'scout', hasSpecialty: true, hasClub: true },
    text: `{last} has {specialty}. Rinks nobody else in the organisation has been inside.` },
  { id: 'sb.id.scout.spec5', conditions: { role: 'scout', hasSpecialty: true, hasClub: true },
    text: `{name} works {specialty} for the {clubShort} — a lot of miles for a handful of names.` },
  { id: 'sb.id.scout.sharp', conditions: { role: 'scout', minJudgment: 75 },
    text: `{name} is a scout, and one of the ones whose reports turn out to have been right.` },
  { id: 'sb.id.scout', conditions: { role: 'scout', hasClub: true },
    text: `{name} scouts for the {clubShort}.` },
  { id: 'sb.id.scout2', conditions: { role: 'scout', hasClub: true },
    text: `{last} is one of the {clubShort} scouts.` },

  { id: 'sb.id.agm.sharp', conditions: { role: 'assistantGM', minJudgment: 75, hasClub: true },
    text: `{last} is the assistant general manager in {clubCity}, and his reads on a roster are worth listening to.` },
  { id: 'sb.id.agm', conditions: { role: 'assistantGM', hasClub: true },
    text: `{name} is the assistant general manager in {clubCity}.` },

  { id: 'sb.id.owner', conditions: { role: 'owner', hasClub: true },
    text: `{name} owns the {clubShort}. Everything you do gets reported to him eventually.` },
  { id: 'sb.id.physio', conditions: { role: 'physio', hasClub: true },
    text: `{name} keeps the {clubShort} on the ice. Nobody thanks him until somebody is out for three months.` },
  { id: 'sb.id.analyst', conditions: { role: 'dataAnalyst', hasClub: true },
    text: `{name} is the data analyst in {clubCity}, and half the arguments in that building start on one of his slides.` },
  { id: 'sb.id.assistant', conditions: { role: 'assistantCoach', hasClub: true },
    text: `{name} is an assistant coach with the {clubShort}.` },
  { id: 'sb.id.assistant.spec', conditions: { role: 'assistantCoach', hasClub: true, hasSpecialty: true },
    text: `{specialty} is {last}'s to run on the {clubShort} staff.` },
  { id: 'sb.id.assistant.spec2', conditions: { role: 'assistantCoach', hasClub: true, hasSpecialty: true },
    text: `{last} takes {specialty} for the {clubShort}. Nobody outside that room hears his name.` },
  { id: 'sb.id.assistant.spec3', conditions: { role: 'assistantCoach', hasClub: true, hasSpecialty: true },
    text: `On the {clubShort} bench, {specialty} is {last}'s corner of it.` },
  { id: 'sb.id.assistant2', conditions: { role: 'assistantCoach', hasClub: true },
    text: `{last} works the {clubShort} bench as an assistant.` },
  { id: 'sb.id.assistant3', conditions: { role: 'assistantCoach', hasClub: true },
    text: `{name} is second chair in {clubCity}.` },

  { id: 'sb.id.unattached', conditions: { hasClub: false },
    text: `{name} is a {roleLabel} without a club at the moment.` },
  { id: 'sb.id.plain', conditions: { hasClub: true },
    text: `{name} is the {roleLabel} in {clubCity}.` },
  { id: 'sb.id.bare',
    text: `{name} works as a {roleLabel}.` },
]

/* ── SYSTEM (head coaches). Slots: {systemLabel} {philosophy} {blurb} ── */

const SYSTEM_POOL: ContentVariant[] = [
  // The blurb is an authored sentence of its own, so it follows a full stop —
  // a capital letter after a colon reads as a seam.
  { id: 'sb.sys.a', text: `He plays a {systemLabel}. {blurb}` },
  { id: 'sb.sys.b', text: `{philosophy}. {blurb}` },
  { id: 'sb.sys.c', text: `The system is a {systemLabel}, and he is not interested in a debate about it. {blurb}` },
]

/* ── STRENGTHS. Slots: {strong1} {strong2} {strongVal1} ── */

const STRENGTH_POOL: ContentVariant[] = [
  { id: 'sb.str.two.elite', conditions: { minStrongVal1: 18, hasStrong2: true },
    text: `{strong1} and {strong2} are the two things he does better than almost anyone at his level.` },
  { id: 'sb.str.two', conditions: { hasStrong2: true },
    text: `What he is good at: {strong1}, and {strong2}.` },
  { id: 'sb.str.two2', conditions: { hasStrong2: true },
    text: `His file rates him highly for {strong1} and {strong2}.` },
  { id: 'sb.str.one.elite', conditions: { minStrongVal1: 18 },
    text: `{strong1} is the part of the job he is genuinely exceptional at.` },
  { id: 'sb.str.one',
    text: `He grades out strongest on {strong1}.` },
]

/* ── WEAKNESS. Slots: {weak1} ── */

const WEAKNESS_POOL: ContentVariant[] = [
  { id: 'sb.weak.a', text: `{weak1} is where he is thin, and it shows.` },
  { id: 'sb.weak.b', text: `He is weak on {weak1}, which is the thing to plan around.` },
  { id: 'sb.weak.c', text: `The gap in the file is {weak1}.` },
]

/* ── HE PLAYED. Slots: {playerPos} {playerGp} {playerPts} {retiredYear} ── */

const FORMER_PLAYER_POOL: ContentVariant[] = [
  { id: 'sb.played.long', conditions: { minPlayerGp: 800 },
    text: `He played {playerGp} games himself before he retired in {retiredYear}, so nobody in that room can tell him he does not know.` },
  { id: 'sb.played.scorer', conditions: { minPlayerPts: 500 },
    text: `He was a {playerPos} first: {playerPts} points across {playerGp} games, up to {retiredYear}.` },
  { id: 'sb.played.a',
    text: `He played {playerGp} games as a {playerPos} before hanging them up in {retiredYear}.` },
  { id: 'sb.played.b',
    text: `Before this he was a {playerPos}, and finished in {retiredYear} on {playerGp} games.` },
]

/* ── STANDING. Slots: {clubShort} ── */

const STANDING_POOL: ContentVariant[] = [
  { id: 'sb.stand.elite', conditions: { minRating: 82 },
    text: `He is among the best in the league at what he does, and other clubs know it.` },
  { id: 'sb.stand.elite2', conditions: { minRating: 82 },
    text: `There are maybe five people doing this job better anywhere.` },
  { id: 'sb.stand.elite3', conditions: { minRating: 82 },
    text: `Losing him would hurt more than losing most of the roster.` },
  { id: 'sb.stand.good', conditions: { minRating: 72 },
    text: `He is good at this. Not the best in the league, and close enough that it rarely matters.` },
  { id: 'sb.stand.good2', conditions: { minRating: 72 },
    text: `Solid. He will not win you anything on his own and he will not cost you anything either.` },
  { id: 'sb.stand.good3', conditions: { minRating: 72 },
    text: `Comfortably above the middle of the league at his job.` },
  { id: 'sb.stand.weak', conditions: { maxRating: 52 },
    text: `He is below the standard of the league, and an upgrade would not be hard to find.` },
  { id: 'sb.stand.weak2', conditions: { maxRating: 52 },
    text: `The market has better, and it does not have to look hard.` },
  { id: 'sb.stand.weak3', conditions: { maxRating: 52 },
    text: `This is a weak link, and a cheap one to replace.` },
]

/* ═════════════════════════════ the build ═════════════════════════════ */

interface StaffBeat {
  key: string
  pool: ContentVariant[]
  ctx: ContentCtx
  slots: Record<string, string>
}

/** Same sameness guard as the player biography: the first two words. */
function word(
  beat: StaffBeat,
  rng: Rng,
  ledger: ContentUse[],
  openings: Set<string>,
): { text: string; variantId: string } | null {
  let fallback: { text: string; variantId: string } | null = null
  for (let attempt = 0; attempt < 4; attempt++) {
    const v = selectVariant({ pool: beat.pool, ctx: beat.ctx, rng, ledger, year: 0 })
    if (v === null) break
    markUsed(ledger, v.id, 0, attempt)
    const text = renderTemplate(v.text, beat.slots)
    if (/\{[a-zA-Z0-9_.]+\}/.test(text)) continue
    if (fallback === null) fallback = { text, variantId: v.id }
    const key = bioOpening(text)
    if (openings.has(key)) continue
    openings.add(key)
    return { text, variantId: v.id }
  }
  if (fallback !== null) openings.add(bioOpening(fallback.text))
  return fallback
}

/**
 * Write a staff member's sketch. Null when there is nothing honest to say.
 *
 * `sharedLedger` is what stops a club's scouts reading as one paragraph printed
 * three times. Staff cards sit stacked on one screen, so unlike a player
 * profile — read one at a time — repetition here is side by side and obvious.
 * Pass ONE ledger for a whole personnel list and each man takes a variant the
 * one above him did not. The caller owns the array; this only appends.
 */
export function buildStaffBiography(
  facts: StaffBioFacts,
  sharedLedger?: ContentUse[],
): StaffBiographyView | null {
  const nameParts = facts.name.trim().split(/\s+/)
  const last = nameParts.length > 1 ? nameParts.slice(1).join(' ') : facts.name
  const club = facts.clubShort ?? ''

  const sorted = [...facts.attributes].sort((a, b) => b.value - a.value)
  const strong = sorted.filter((a) => a.value >= STRONG).slice(0, 2)
  const weak = sorted.filter((a) => a.value <= WEAK).slice(-1)

  const beats: StaffBeat[] = []

  beats.push({
    key: 'identity',
    pool: IDENTITY_POOL,
    ctx: {
      role: facts.role,
      hasClub: club.length > 0,
      hasSpecialty: (facts.specialty ?? '').length > 0,
      judgment: facts.judgment,
      ...(facts.demeanor !== undefined ? { demeanor: facts.demeanor } : {}),
    },
    slots: {
      name: facts.name,
      last,
      roleLabel: facts.roleLabel.toLowerCase(),
      clubShort: club,
      clubCity: facts.clubCity ?? club,
      specialty: facts.specialty ?? '',
    },
  })

  if (facts.system !== undefined) {
    beats.push({
      key: 'system',
      pool: SYSTEM_POOL,
      ctx: {},
      slots: {
        systemLabel: facts.system.label.toLowerCase(),
        philosophy: facts.system.philosophy,
        blurb: facts.system.blurb,
      },
    })
  }

  if (strong.length > 0) {
    beats.push({
      key: 'strength',
      pool: STRENGTH_POOL,
      ctx: { strongVal1: strong[0].value, hasStrong2: strong.length > 1 },
      slots: {
        strong1: strong[0].label.toLowerCase(),
        strong2: (strong[1]?.label ?? '').toLowerCase(),
        strongVal1: String(strong[0].value),
      },
    })
  }

  if (weak.length > 0) {
    beats.push({
      key: 'weakness',
      pool: WEAKNESS_POOL,
      ctx: {},
      slots: { weak1: weak[0].label.toLowerCase() },
    })
  }

  const fp = facts.formerPlayer
  if (fp !== undefined && fp.gamesPlayed > 0) {
    beats.push({
      key: 'formerPlayer',
      pool: FORMER_PLAYER_POOL,
      ctx: { playerGp: fp.gamesPlayed, playerPts: fp.points },
      slots: {
        playerPos: fp.position.toLowerCase(),
        playerGp: commas(fp.gamesPlayed),
        playerPts: commas(fp.points),
        retiredYear: String(fp.retiredYear),
      },
    })
  }

  beats.push({
    key: 'standing',
    pool: STANDING_POOL,
    ctx: { rating: facts.rating },
    slots: { clubShort: club },
  })

  const rng = new Rng(hashId(facts.staffId) ^ 0x9e37)
  const ledger = sharedLedger ?? []
  const openings = new Set<string>()
  const sentences: string[] = []
  const fired: string[] = []
  const variantIds: string[] = []

  for (const beat of beats) {
    const out = word(beat, rng, ledger, openings)
    if (out === null) continue
    sentences.push(out.text)
    fired.push(beat.key)
    variantIds.push(out.variantId)
  }

  if (sentences.length === 0) return null
  // Two paragraphs: who he is and how he works, then what he brings.
  const split = Math.min(2, sentences.length)
  const paragraphs = [sentences.slice(0, split).join(' ')]
  if (sentences.length > split) paragraphs.push(sentences.slice(split).join(' '))
  return { paragraphs, beats: fired, variantIds }
}

/** Every authored pool, for the content audit. */
export const STAFF_BIOGRAPHY_POOLS: Record<string, ContentVariant[]> = {
  identity: IDENTITY_POOL,
  system: SYSTEM_POOL,
  strength: STRENGTH_POOL,
  weakness: WEAKNESS_POOL,
  formerPlayer: FORMER_PLAYER_POOL,
  standing: STANDING_POOL,
}
