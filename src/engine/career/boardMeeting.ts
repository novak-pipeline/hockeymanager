/**
 * The Preseason Board Meeting — first MeetingScene of the Season Rhythm spine
 * (docs/SEASON-RHYTHM.md, M1).
 *
 * Once a year, before the puck drops, the GM sits down with ownership. This is
 * a NEGOTIATION, not a memo: the board states its expectation, and the GM can
 * accept it, promise more in exchange for backing, or ask for patience at a
 * price. Every commitment becomes a chronicle-tracked PROMISE with quantified
 * criteria, evaluated at season's end — your own words, read back to you.
 *
 * Anti-generic rules (from the FM research):
 *  - Characters speak from their actual profiles (owner demeanor, coach system,
 *    AGM judgment) and cite REAL numbers (last season's finish vs the media
 *    pick, payroll vs cap, named prospects). No filler lines.
 *  - Options are trades with teeth, not flavor. Asking for patience costs you;
 *    promising more is a real bet.
 *  - One condition-driven wildcard item per year keeps runs different.
 *
 * Pure module: builders take plain facts, return JSON-safe scenes/results.
 * The career layer supplies state and applies effects.
 */
import type { Rng } from '@engine/shared/rng'
import type { BoardState, Mandate } from '@engine/league/board'

/* ────────────────────────── scene model ────────────────────────── */

export interface MeetingSpeaker {
  id: string
  name: string
  /** "Owner", "Head Coach", "Assistant GM"… */
  title: string
  faceId?: string
  /** Personality hint for voice casting + tone. Optional/additive. */
  demeanor?: 'fiery' | 'calm' | 'analytical' | 'motivator' | 'pragmatic'
}

export interface MeetingLine {
  speakerId: string
  text: string
}

export interface MeetingOption {
  id: string
  /** Short imperative label ("Promise them the playoffs"). */
  label: string
  /** What you're actually committing to — the receipt preview. */
  detail: string
}

export interface MeetingAgendaItem {
  id: string
  title: string
  intro: MeetingLine[]
  options: MeetingOption[]
}

export interface BoardMeetingScene {
  year: number
  venue: 'boardroom'
  cast: MeetingSpeaker[]
  opening: MeetingLine[]
  agenda: MeetingAgendaItem[]
}

/** A quantified commitment the season will be judged against. */
export interface MeetingPromise {
  /** 'finishAtLeast' | 'playoffBerth' | 'winRound' | 'youthGames' | 'shedSalary' */
  kind: string
  /** Human sentence for the chronicle + review ("Finish 8th or better"). */
  text: string
  /** Criterion value: rank for finishAtLeast, GP threshold for youthGames, etc. */
  value: number
  /** For youthGames: how many U23 players must hit the GP threshold. */
  count?: number
  dueYear: number
}

export interface MeetingEffects {
  confidenceDelta: number
  patienceDelta: number
  /** Board grants a softer target (replaces targetRank). */
  targetRankOverride?: number
  mandateOverride?: { mandate: Mandate; text: string }
  sanctionRebuild?: boolean
  direction?: 'compete' | 'retool' | 'rebuild'
  promises: MeetingPromise[]
  /** One-line owner reaction per resolved item, in agenda order. */
  closingLines: MeetingLine[]
  /** Inbox summary body. */
  summary: string
}

/* ────────────────────────── facts in ────────────────────────── */

export interface BoardMeetingFacts {
  year: number
  teamName: string
  board: BoardState
  owner: { id: string; name: string; faceId?: string; demeanor?: string }
  coach: { id: string; name: string; faceId?: string; systemLabel: string }
  agm: { id: string; name: string; faceId?: string }
  /** Last season, if one has been played. */
  lastSeason?: { predictedRank: number; actualRank: number; madePlayoffs: boolean; wonCup: boolean }
  capUsed: number
  salaryCap: number
  /** User club stance from roster shape (LW2). */
  posture: 'contend' | 'retool' | 'rebuild'
  postureReason: string
  /** Average age of the top-6 core. */
  coreAge: number
  /** 0–100 fan interest. */
  fanInterest: number
  /** Up to 3 best U23 prospects in the org, best first (names for dialogue). */
  topProspects: string[]
  /** Number of teams (for rank talk). */
  teamCount: number
}

/* ────────────────────────── dialogue helpers ────────────────────────── */

const ord = (n: number): string => {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}

const money = (v: number): string => `$${(Math.abs(v) / 1e6).toFixed(1)}M`

/** Owner tone banks keyed by demeanor — same fact, different voice. */
function ownerVoice(demeanor: string | undefined, rng: Rng): {
  greet: (team: string) => string
  demand: (mandateText: string) => string
  onExceeded: (actual: number, predicted: number) => string
  onMissed: (actual: number, predicted: number) => string
} {
  const pick = <T>(arr: T[]): T => arr[rng.int(arr.length)]!
  switch (demeanor) {
    case 'fiery':
      return {
        greet: (t) => pick([
          `Sit down. I don't do long meetings, so let's get to it — this is about the ${t}.`,
          `Good, you're here. I've had a summer of season-ticket holders in my ear about the ${t}. Let's talk.`,
        ]),
        demand: (m) => pick([
          `Here's where I stand: ${m} Anything less and we're having a very different meeting in April.`,
          `${m} That's not a hope, that's the bar. Clear?`,
        ]),
        onExceeded: (a, p) => `The press had us ${ord(p)} and you delivered ${ord(a)}. Good. Do it again.`,
        onMissed: (a, p) => `They picked us ${ord(p)}. We finished ${ord(a)}. I don't pay for backsliding.`,
      }
    case 'analytical':
      return {
        greet: (t) => pick([
          `Thanks for coming in. I've been through the ${t}'s numbers twice this summer — let's compare notes.`,
          `Right on time. I have the season model in front of me; let's see if we read the ${t} the same way.`,
        ]),
        demand: (m) => pick([
          `The projection supports it: ${m} I think that's the rational target.`,
          `${m} That's where the underlying numbers say we should land. I'd like your read.`,
        ]),
        onExceeded: (a, p) => `Projection said ${ord(p)}; you returned ${ord(a)}. That's real signal, not noise.`,
        onMissed: (a, p) => `We modelled ${ord(p)} and landed ${ord(a)}. I want to understand the variance.`,
      }
    case 'calm':
      return {
        greet: (t) => pick([
          `Come in, sit down. Coffee's fresh. Let's talk about the year ahead for the ${t}.`,
          `Good to see you. Before camp opens I like to make sure we're rowing in the same direction with the ${t}.`,
        ]),
        demand: (m) => pick([
          `${m} I think that's fair to ask, and I'll back you while you chase it.`,
          `My ask this season: ${m} Nothing you can't handle.`,
        ]),
        onExceeded: (a, p) => `The pundits projected us ${ord(p)} in the league last season; we finished ${ord(a)}. That overachievement didn't go unnoticed.`,
        onMissed: (a, p) => `We were projected ${ord(p)} last season and finished ${ord(a)}. I'm not panicking — but I am paying attention.`,
      }
    case 'motivator':
      return {
        greet: (t) => pick([
          `There he is! Big year coming for the ${t} — I can feel it. Sit, sit.`,
          `Welcome back. I've told everyone in this building: this is the ${t}'s year to take a step.`,
        ]),
        demand: (m) => pick([
          `${m} And I genuinely believe this group can do it — sell me on how.`,
          `Here's the dream: ${m} Now tell me you believe it too.`,
        ]),
        onExceeded: (a, p) => `Picked ${ord(p)}, finished ${ord(a)} — that's the kind of story this city needed!`,
        onMissed: (a, p) => `We wanted more than ${ord(a)} when they'd picked us ${ord(p)}. This year we answer.`,
      }
    default: // pragmatic
      return {
        greet: (t) => pick([
          `Let's keep this efficient. One hour, three decisions, and the ${t} has its marching orders.`,
          `Appreciate you coming in early. Camp's around the corner and I want the ${t}'s plan on one page.`,
        ]),
        demand: (m) => pick([
          `${m} That's the business case. Hit it and everyone's job gets easier — including mine.`,
          `${m} It's what the market expects of this roster. I won't dress it up.`,
        ]),
        onExceeded: (a, p) => `${ord(a)} against a ${ord(p)} projection. That's over-delivery. Noted.`,
        onMissed: (a, p) => `${ord(a)} when the market priced us ${ord(p)}. That gap costs money and goodwill.`,
      }
  }
}

/* ────────────────────────── scene builder ────────────────────────── */

/** One notch softer than the current mandate (for the ask-patience path). */
function softerMandate(m: Mandate): { mandate: Mandate; text: string } | null {
  switch (m) {
    case 'cupOrBust': return { mandate: 'contend', text: 'Contend seriously — a deep playoff run.' }
    case 'contend': return { mandate: 'makePlayoffs', text: 'Make the playoffs.' }
    case 'makePlayoffs': return { mandate: 'competeRespectably', text: 'Stay competitive and finish respectably.' }
    case 'competeRespectably': return { mandate: 'developYouth', text: 'Develop the young core — results are secondary.' }
    default: return null
  }
}

export function buildBoardMeeting(facts: BoardMeetingFacts, rng: Rng): BoardMeetingScene {
  const cast: MeetingSpeaker[] = [
    { id: 'owner', name: facts.owner.name, title: 'Owner', ...(facts.owner.faceId ? { faceId: facts.owner.faceId } : {}) },
    { id: 'coach', name: facts.coach.name, title: 'Head Coach', ...(facts.coach.faceId ? { faceId: facts.coach.faceId } : {}) },
    { id: 'agm', name: facts.agm.name, title: 'Assistant GM', ...(facts.agm.faceId ? { faceId: facts.agm.faceId } : {}) },
  ]
  const voice = ownerVoice(facts.owner.demeanor, rng)

  /* ── opening: the owner reads last season back to you ── */
  const opening: MeetingLine[] = [{ speakerId: 'owner', text: voice.greet(facts.teamName) }]
  if (facts.lastSeason) {
    const ls = facts.lastSeason
    if (ls.wonCup) {
      opening.push({ speakerId: 'owner', text: `And before anything else — that banner is going to hang here forever. Champions. Now everyone in the league wants our throat.` })
    } else if (ls.actualRank < ls.predictedRank) {
      opening.push({ speakerId: 'owner', text: voice.onExceeded(ls.actualRank, ls.predictedRank) })
    } else if (ls.actualRank > ls.predictedRank + 1) {
      opening.push({ speakerId: 'owner', text: voice.onMissed(ls.actualRank, ls.predictedRank) })
    }
  }

  /* ── item 1: the season objective (the negotiation) ── */
  const softer = softerMandate(facts.board.mandate)
  const objectiveOptions: MeetingOption[] = [
    {
      id: 'accept',
      label: 'Accept the objective',
      detail: `Commit to: ${facts.board.mandateText} (target: ${ord(facts.board.targetRank)} or better)`,
    },
    {
      id: 'promiseMore',
      label: 'Promise more — and ask for backing',
      detail: `Stake your credibility on finishing ${ord(Math.max(1, facts.board.targetRank - 3))} or better. The board extends patience and loosens the purse strings now — but miss it and the fall is twice as far.`,
    },
  ]
  if (softer) {
    objectiveOptions.push({
      id: 'askPatience',
      label: 'Ask for patience — at a price',
      detail: `Argue the roster read (${facts.postureReason}). If the board accepts the softer bar — "${softer.text}" — they'll want a receipt: ${facts.topProspects[0] ?? 'your top prospects'} and the young core get real NHL minutes this season.`,
    })
  }
  const item1: MeetingAgendaItem = {
    id: 'objective',
    title: "The season's objective",
    intro: [
      { speakerId: 'owner', text: voice.demand(facts.board.mandateText) },
      {
        speakerId: 'coach',
        text: facts.posture === 'contend'
          ? `For what it's worth, the room is ready. We'll play ${facts.coach.systemLabel} and I like our matchups against anyone.`
          : facts.posture === 'rebuild'
            ? `I'll coach whatever you hand me, but I won't lie to the table — this roster is a work in progress, and ${facts.coach.systemLabel} only papers over so much.`
            : `We can push for it. The core's ${facts.coreAge.toFixed(0)} on average — the window's real, but it isn't infinite.`,
      },
    ],
    options: objectiveOptions,
  }

  /* ── item 2: the direction (youth vs now) ── */
  const prospectLine = facts.topProspects.length > 0
    ? `${facts.topProspects.slice(0, 2).join(' and ')} ${facts.topProspects.length > 1 ? 'are' : 'is'} knocking on the door.`
    : `The cupboard is thinner than I'd like — that's its own conversation.`
  const item2: MeetingAgendaItem = {
    id: 'direction',
    title: 'The direction of the roster',
    intro: [
      { speakerId: 'agm', text: `Second thing. ${prospectLine} We should decide out loud what this season is FOR — chasing now, or building the next window.` },
    ],
    options: [
      {
        id: 'now',
        label: 'This season is for winning',
        detail: 'Veterans play, kids earn every shift. The board raises its playoff expectation accordingly — and holds you to it.',
      },
      {
        id: 'balance',
        label: 'Compete, but grow the core',
        detail: 'Stay the course: no promises either way, no shields either way.',
      },
      {
        id: 'youth',
        label: 'This season is for the kids',
        detail: `Commit to real development minutes: at least two U23 players play 40+ NHL games. The board tolerates growing pains — IF the receipts show the kids actually played.`,
      },
    ],
  }

  /* ── item 3: the condition-driven wildcard (run variance) ── */
  const item3 = buildWildcard(facts, rng)

  return {
    year: facts.year,
    venue: 'boardroom',
    cast,
    opening,
    agenda: [item1, item2, ...(item3 ? [item3] : [])],
  }
}

/** Pick the one wildcard the season actually calls for — never filler. */
function buildWildcard(facts: BoardMeetingFacts, rng: Rng): MeetingAgendaItem | null {
  const over = facts.capUsed - facts.salaryCap
  if (over > 0) {
    return {
      id: 'wc-payroll',
      title: 'The payroll problem',
      intro: [
        { speakerId: 'owner', text: `One more thing, and it's not optional. Payroll is ${money(over)} over the ceiling. I'm not writing luxury cheques for a roster that hasn't won anything.` },
        { speakerId: 'agm', text: `We have movable contracts. It costs us depth or a sweetener, but it's doable before the deadline.` },
      ],
      options: [
        { id: 'shed', label: 'Promise to fix it by the deadline', detail: `Commit to a cap-compliant payroll by season's end. Fail, and the board's trust takes a real hit.` },
        { id: 'defend', label: 'Defend the spend', detail: `Argue the roster justifies it. The owner backs down — this time — but patience burns now.` },
      ],
    }
  }
  if (facts.posture === 'retool' && facts.coreAge >= 30) {
    return {
      id: 'wc-rebuild',
      title: 'The question nobody wants to ask',
      intro: [
        { speakerId: 'agm', text: `Before we adjourn — someone has to say it. The core averages ${facts.coreAge.toFixed(0)}. We're mid-pack with an aging spine. Do we retool on the fly… or call it and rebuild properly?` },
        { speakerId: 'coach', text: `Careful. Say "rebuild" out loud and the room hears it too.` },
      ],
      options: [
        { id: 'sanction', label: 'Put the rebuild on the table', detail: `Ask ownership to sanction a teardown: sell veterans for futures, shielded from a firing for the losing that follows.` },
        { id: 'ride', label: 'Ride the core one more year', detail: `No teardown. The window stays open by force of will — and you own the result.` },
      ],
    }
  }
  if (facts.fanInterest < 45) {
    return {
      id: 'wc-fans',
      title: 'The empty seats',
      intro: [
        { speakerId: 'owner', text: `Look at the gate numbers. Interest is at ${facts.fanInterest} — the building's a library on weeknights. Give me something to sell.` },
      ],
      options: [
        { id: 'star', label: 'Promise a name this market cares about', detail: `Commit to acquiring a marquee player this season (trade or signing). Deliver and the gate follows; don't, and the owner remembers.` },
        { id: 'wins', label: '"Winning sells tickets."', detail: `No stunts — the product on the ice is the marketing plan. The owner accepts it, grudgingly.` },
      ],
    }
  }
  // Healthy club: the owner offers a genuine perk choice instead.
  const scoutFirst = rng.chance(0.5)
  return {
    id: 'wc-invest',
    title: "The owner's cheque-book",
    intro: [
      { speakerId: 'owner', text: `Last item, a pleasant one. The books are healthy and I'm willing to invest. One project this year — where does it go?` },
    ],
    options: scoutFirst
      ? [
        { id: 'scouting', label: 'Expand the scouting department', detail: `Two extra scout positions funded — more eyes on the world, better draft intel.` },
        { id: 'development', label: 'Invest in player development', detail: `A development-staff upgrade: your prospects' growth gets a tailwind this season.` },
      ]
      : [
        { id: 'development', label: 'Invest in player development', detail: `A development-staff upgrade: your prospects' growth gets a tailwind this season.` },
        { id: 'scouting', label: 'Expand the scouting department', detail: `Two extra scout positions funded — more eyes on the world, better draft intel.` },
      ],
  }
}

/* ────────────────────────── resolution ────────────────────────── */

export function resolveBoardMeeting(
  scene: BoardMeetingScene,
  facts: BoardMeetingFacts,
  choices: Record<string, string>,
): MeetingEffects {
  const fx: MeetingEffects = {
    confidenceDelta: 0, patienceDelta: 0, promises: [], closingLines: [], summary: '',
  }
  const say = (text: string): void => { fx.closingLines.push({ speakerId: 'owner', text }) }
  const summaryBits: string[] = []

  /* objective */
  switch (choices['objective']) {
    case 'promiseMore': {
      const target = Math.max(1, facts.board.targetRank - 3)
      fx.patienceDelta += 10
      fx.confidenceDelta += 4
      fx.promises.push({
        kind: 'finishAtLeast',
        text: `Finish ${ord(target)} or better — your own raised bar`,
        value: target,
        dueYear: facts.year,
      })
      say(`Bold. I like bold — and I'll remember it word for word in April.`)
      summaryBits.push(`You raised the bar: ${ord(target)} or better, in exchange for the board's backing.`)
      break
    }
    case 'askPatience': {
      const softer = softerMandate(facts.board.mandate)
      if (softer) {
        // The board only truly grants it when they aren't already impatient.
        if (facts.board.patience >= 40 || facts.posture === 'rebuild') {
          fx.mandateOverride = { mandate: softer.mandate, text: softer.text }
          fx.targetRankOverride = Math.min(facts.teamCount, facts.board.targetRank + 4)
          fx.confidenceDelta -= 3
          fx.promises.push({
            kind: 'youthGames',
            text: 'Two U23 players play 40+ NHL games — the price of patience',
            value: 40,
            count: 2,
            dueYear: facts.year,
          })
          say(`Fine. You get your runway — but I want to SEE the kids on my ice, not hear about their potential.`)
          summaryBits.push(`The board softened the bar to "${softer.text}" — in exchange for real youth minutes (receipt tracked).`)
        } else {
          fx.patienceDelta -= 8
          fx.confidenceDelta -= 4
          say(`No. You've had runway. ${facts.board.mandateText} stands — and asking cost you something today.`)
          summaryBits.push(`The board REFUSED the softer target — patience is thin. The original objective stands.`)
        }
      }
      break
    }
    default: {
      fx.confidenceDelta += 2
      say(`Good. Then we understand each other.`)
      summaryBits.push(`You accepted the objective: ${facts.board.mandateText}`)
    }
  }

  /* direction */
  switch (choices['direction']) {
    case 'now':
      fx.direction = 'compete'
      fx.promises.push({
        kind: 'playoffBerth',
        text: 'A playoff berth — the price of declaring a win-now season',
        value: 0,
        dueYear: facts.year,
      })
      say(`Win-now it is. Playoffs, then. In writing.`)
      summaryBits.push('Declared a win-now season (playoff berth promised).')
      break
    case 'youth':
      fx.direction = 'retool'
      fx.patienceDelta += 6
      fx.promises.push({
        kind: 'youthGames',
        text: 'Two U23 players play 40+ NHL games — the development season, made real',
        value: 40,
        count: 2,
        dueYear: facts.year,
      })
      say(`A development year. I'll hold my tongue on the standings — and hold you to the ice time.`)
      summaryBits.push('Declared a development season (youth minutes promised; board tolerates growing pains).')
      break
    default:
      summaryBits.push('Stayed the course on roster direction.')
  }

  /* wildcard */
  const wc = scene.agenda.find((a) => a.id.startsWith('wc-'))
  if (wc) {
    const choice = choices[wc.id]
    switch (`${wc.id}:${choice}`) {
      case 'wc-payroll:shed':
        fx.promises.push({
          kind: 'shedSalary',
          text: 'Bring payroll under the cap by season\'s end',
          value: 0,
          dueYear: facts.year,
        })
        say(`Deadline. Not a day later.`)
        summaryBits.push('Promised a cap-compliant payroll by season\'s end (receipt tracked).')
        break
      case 'wc-payroll:defend':
        fx.patienceDelta -= 10
        say(`You're spending my money on your conviction. It had better cash.`)
        summaryBits.push('Defended the over-cap payroll — the owner relented, at a real cost to patience.')
        break
      case 'wc-rebuild:sanction':
        fx.sanctionRebuild = true
        fx.direction = 'rebuild'
        say(`Then we do it properly — futures over feelings. I'll wear the losing for one season. ONE.`)
        summaryBits.push('Ownership sanctioned a rebuild — veterans for futures, shielded from the standings for a year.')
        break
      case 'wc-rebuild:ride':
        fx.confidenceDelta += 2
        say(`One more year of the core. Your call, your name on it.`)
        summaryBits.push('Chose to ride the aging core one more year.')
        break
      case 'wc-fans:star':
        fx.promises.push({
          kind: 'marqueeName',
          text: 'Acquire a marquee player this season — something the market can sell',
          value: 0,
          dueYear: facts.year,
        })
        say(`A name. This market runs on names.`)
        summaryBits.push('Promised the owner a marquee acquisition this season (receipt tracked).')
        break
      case 'wc-fans:wins':
        say(`"Winning sells tickets." Fine. Then win.`)
        summaryBits.push('Told the owner the product on the ice is the marketing plan.')
        break
      case 'wc-invest:scouting':
        say(`Done. The scouts get their budget — bring me back a draft class worth bragging about.`)
        summaryBits.push('Owner investment: two extra scout positions funded this season.')
        break
      case 'wc-invest:development':
        say(`Done. Development it is — I want to watch the kids grow into the sweater.`)
        summaryBits.push('Owner investment: player-development upgrade this season.')
        break
    }
  }

  fx.summary = summaryBits.join(' ')
  return fx
}

/** Default choices when the GM sends the AGM instead (auto-resolve on sim).
 *  The AGM plays it straight: accept the objective, stay the course, comply
 *  where compliance is mandatory (cap), decline anything ambitious. */
export function defaultChoices(scene: BoardMeetingScene): Record<string, string> {
  const SAFE: Record<string, string> = {
    objective: 'accept',
    direction: 'balance',
    'wc-payroll': 'shed',      // the AGM would never tell the owner "no" on compliance
    'wc-rebuild': 'ride',
    'wc-fans': 'wins',
    'wc-invest': 'development',
  }
  const out: Record<string, string> = {}
  for (const item of scene.agenda) {
    out[item.id] = SAFE[item.id] ?? item.options[item.options.length - 1]!.id
  }
  return out
}

/* ────────────────────────── the End-of-Season Review (M4) ────────────────────────── */

/**
 * The receipts meeting. Same boardroom, same people — but now the season has
 * happened, and the owner reads your September commitments back to you with
 * the verdicts attached. One real choice: how you answer for it.
 */

export interface SeasonReviewFacts {
  year: number
  teamName: string
  owner: { id: string; name: string; faceId?: string; demeanor?: string }
  coach: { id: string; name: string; faceId?: string }
  agm: { id: string; name: string; faceId?: string }
  finalRank: number
  targetRank: number
  mandateText: string
  madePlayoffs: boolean
  wonCup: boolean
  verdict: 'exceeded' | 'met' | 'missed' | 'failed'
  fired: boolean
  /** This season's board-room promises with their verdicts. */
  promises: Array<{ text: string; resolved: 'met' | 'missed' }>
  confidence: number
  patience: number
}

export function buildSeasonReviewScene(facts: SeasonReviewFacts, rng: Rng): BoardMeetingScene {
  const cast: MeetingSpeaker[] = [
    { id: 'owner', name: facts.owner.name, title: 'Owner', ...(facts.owner.faceId ? { faceId: facts.owner.faceId } : {}) },
    { id: 'coach', name: facts.coach.name, title: 'Head Coach', ...(facts.coach.faceId ? { faceId: facts.coach.faceId } : {}) },
    { id: 'agm', name: facts.agm.name, title: 'Assistant GM', ...(facts.agm.faceId ? { faceId: facts.agm.faceId } : {}) },
  ]
  const voice = ownerVoice(facts.owner.demeanor, rng)

  const opening: MeetingLine[] = []
  // The verdict, in the owner's voice, with the season's real shape.
  if (facts.wonCup) {
    opening.push({ speakerId: 'owner', text: `Sit down — no, actually, stand. Everyone should be standing. We won the whole thing. Whatever was said in September, tonight it's champagne.` })
  } else {
    switch (facts.verdict) {
      case 'exceeded':
        opening.push({ speakerId: 'owner', text: voice.onExceeded(facts.finalRank, facts.targetRank) })
        break
      case 'met':
        opening.push({ speakerId: 'owner', text: `${ord(facts.finalRank)}, against a bar of ${ord(facts.targetRank)}. You did what you said. In this business that's rarer than it should be.` })
        break
      case 'missed':
        opening.push({ speakerId: 'owner', text: voice.onMissed(facts.finalRank, facts.targetRank) })
        break
      case 'failed':
        opening.push({ speakerId: 'owner', text: `${ord(facts.finalRank)}. The ask was "${facts.mandateText}" We're not going to pretend that's close. Talk.` })
        break
    }
  }
  // The receipts: every promise, quoted, with its verdict.
  for (const p of facts.promises) {
    opening.push({
      speakerId: 'owner',
      text: p.resolved === 'met'
        ? `September, this room, your words: "${p.text}." Delivered. Noted.`
        : `September, this room, your words: "${p.text}." It didn't happen. I keep the minutes.`,
    })
  }
  if (facts.promises.length === 0) {
    opening.push({ speakerId: 'agm', text: `For the record — no outstanding commitments from September. The slate was the standings.` })
  }
  if (facts.fired) {
    opening.push({ speakerId: 'owner', text: `You know how this ends. The league office has the paperwork. I wanted to tell you across the table, not through a press release.` })
  }

  // One agenda item: your answer. Options vary by how the year went.
  const options: MeetingOption[] =
    facts.verdict === 'exceeded' || facts.wonCup
      ? [
        { id: 'credit', label: 'Share the credit with the room', detail: `Point at the coach, the staff, the players. Costs nothing; the building hears it.` },
        { id: 'leverage', label: `Ask for more backing while you're up`, detail: `Cash in the goodwill: the board extends patience into next season — though the owner notes the ambition.` },
      ]
      : facts.verdict === 'met'
        ? [
          { id: 'steady', label: `"We did what we said we would."`, detail: `Solid, unremarkable, professional. Confidence firms up.` },
          { id: 'raise', label: `"Next year we take the next step."`, detail: `Signal ambition. The board will remember the phrase when September's objective is set.` },
        ]
        : [
          { id: 'own', label: 'Own it', detail: `No excuses, take the year on the chin. Accountability buys back a little trust.` },
          { id: 'defend', label: 'Defend the process', detail: `Argue injuries, growth, the underlying numbers. The owner has heard this speech before — it lands only if he reads the same numbers you do.` },
        ]

  return {
    year: facts.year,
    venue: 'boardroom',
    cast,
    opening,
    agenda: [{
      id: 'answer',
      title: 'Your answer',
      intro: [{ speakerId: 'owner', text: facts.fired ? `Anything you want on the record before we shake hands?` : `So. What do I tell the papers tomorrow?` }],
      options,
    }],
  }
}

export interface SeasonReviewOutcome {
  confidenceDelta: number
  patienceDelta: number
  closingLines: MeetingLine[]
  summary: string
}

export function resolveSeasonReview(facts: SeasonReviewFacts, choice: string): SeasonReviewOutcome {
  const out = (text: string, confidenceDelta: number, patienceDelta: number, summary: string): SeasonReviewOutcome =>
    ({ confidenceDelta, patienceDelta, closingLines: [{ speakerId: 'owner', text }], summary })
  switch (choice) {
    case 'credit':
      return out(
        `Humility from a winner. The room will run through walls for that. Enjoy the summer — you've earned a short one.`,
        2, 0, 'You shared the credit; the building noticed.'
      )
    case 'leverage':
      return out(
        `Fine — you've banked the right to ask. You'll have your rope. Use it on something that hangs banners.`,
        -1, 8, 'You cashed in the goodwill: the board extends its patience into next season.'
      )
    case 'steady':
      return out(
        `"Did what they said." I've fired a dozen men who couldn't manage that sentence. Good year.`,
        3, 0, 'A professional year, closed professionally.'
      )
    case 'raise':
      return out(
        `The next step. I'll hold you to the phrase — September me will remember it.`,
        2, 0, `You promised a step forward — expect September's bar to reflect it.`
      )
    case 'own':
      return out(
        `No excuses. That's the only answer that doesn't make it worse. We go again — but the leash is what it is.`,
        3, 0, 'You owned the season. It bought back a little trust — not much, but real.'
      )
    case 'defend': {
      const patientOwner = facts.owner.demeanor === 'calm' || facts.owner.demeanor === 'analytical'
      return patientOwner
        ? out(
          `…I've looked at the same numbers. There's a case. It had better cash next year.`,
          1, 0, 'You defended the process — and this owner, to his credit, actually read the numbers.'
        )
        : out(
          `The process. I bought the process last year. I'm running out of shelf space for process.`,
          -2, -4, 'You defended the process; the owner has heard that speech before.'
        )
    }
    default:
      return { confidenceDelta: 0, patienceDelta: 0, closingLines: [], summary: 'The meeting adjourned.' }
  }
}
