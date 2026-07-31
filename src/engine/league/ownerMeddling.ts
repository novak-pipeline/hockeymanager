/**
 * Owner meddling: the owner periodically leans on the GM with a business- or
 * win-now-motivated directive. The GM accepts (currying favour) or pushes back
 * (protecting his plan at a cost to the owner's confidence). Pure + deterministic
 * + JSON-safe; the career layer owns timing, persistence, and the confidence swing.
 */

import type { Rng } from '@engine/shared/rng'
import type { Mandate } from './board'

export type OwnerRequestKind =
  | 'signMarketableStar'
  | 'trimPayroll'
  | 'pushForPlayoffs'
  | 'developYouth'
  | 'extendFanFavourite'

export interface OwnerRequest {
  id: string
  kind: OwnerRequestKind
  year: number
  day: number
  title: string
  /** The owner's ask, with the business/competitive motive spelled out. */
  body: string
  /** The same ask as the owner would SAY it to you, first person, down a phone
   *  line — no narration, no consequence hints. `body` is written for a card and
   *  describes him in the third person; voicing that in his own mouth is how the
   *  living phone ended up making no sense. */
  spoken: string
  /** Board-confidence change if the GM goes along with it. */
  acceptConfidence: number
  /** Board-confidence change if the GM pushes back. */
  declineConfidence: number
  /** Patience change on accept / decline (owner's goodwill). */
  acceptPatience: number
  declinePatience: number
}

interface Template {
  kind: OwnerRequestKind
  title: string
  body: string
  spoken: string
}

/** Requests the owner is likely to make, biased by the season mandate. */
const TEMPLATES: Record<OwnerRequestKind, Template> = {
  signMarketableStar: {
    kind: 'signMarketableStar',
    title: 'The owner wants a marquee name',
    body: 'Season-ticket renewals are soft and the owner wants a marketable star brought in to put bums in seats — "Give the fans a reason to show up." A splashy signing would sell jerseys; passing risks the owner souring on you.',
    spoken:
      "Renewals are soft. I've seen the numbers and they are not good enough. I want a name — somebody the fans will buy a jersey for, somebody they'll pay to come and watch. Give them a reason to show up, and do it before the renewal window closes.",
  },
  trimPayroll: {
    kind: 'trimPayroll',
    title: 'The owner wants the payroll trimmed',
    body: 'The owner is looking at the balance sheet and wants the wage bill cut — "We are bleeding money." Moving salary pleases ownership; refusing protects the roster but tests his patience.',
    spoken:
      "I've got the balance sheet in front of me and we are bleeding money. I'm not asking you to gut the team. I am telling you the wage bill comes down. Find me the salary and move it — you know better than I do which contract you'd miss least.",
  },
  pushForPlayoffs: {
    kind: 'pushForPlayoffs',
    title: 'The owner wants a win-now push',
    body: 'The owner smells a playoff run and wants you to add a proven veteran for the stretch — "Go for it, the window is now." Buying in earns goodwill; standing pat reads as timid to the boss.',
    spoken:
      "I watch the standings same as everybody else, and I like what I'm looking at. Go and get me a proven man for the stretch — somebody who's been there. The window is now. I'd rather we swung and missed than sat on our hands and wondered.",
  },
  developYouth: {
    kind: 'developYouth',
    title: 'The owner wants the kids to play',
    body: 'The owner wants to see the prospects get a real look — cheaper, and the fans love a homegrown story. Leaning into youth pleases him; blocking their path frustrates him.',
    spoken:
      "I want to see the kids play. Not a token night here and there — a real look, real minutes. They're cheaper, and this town falls in love with a player it watched grow up. Stop parking them behind men who aren't beating them out.",
  },
  extendFanFavourite: {
    kind: 'extendFanFavourite',
    title: 'The owner wants a fan favourite kept',
    body: 'A beloved veteran is up for a new deal and the owner does not want to read the backlash if he walks — "He stays, figure it out." Keeping him is good PR; letting him go is a fight with the boss.',
    spoken:
      "There's a man in that room this city would riot over, and his deal is up. I am not reading a week of columns about how we let him walk. He stays. Figure out the money — that part is your job, not mine.",
  },
}

/** Which requests fit a given mandate (the owner asks for what suits his plan). */
function poolFor(mandate: Mandate): OwnerRequestKind[] {
  switch (mandate) {
    case 'cupOrBust':
    case 'contend':
      return ['pushForPlayoffs', 'signMarketableStar', 'extendFanFavourite']
    case 'makePlayoffs':
    case 'competeRespectably':
      return ['signMarketableStar', 'pushForPlayoffs', 'extendFanFavourite']
    case 'developYouth':
    case 'rebuild':
      return ['developYouth', 'trimPayroll', 'extendFanFavourite']
    case 'cutCosts':
      return ['trimPayroll', 'developYouth']
  }
}

/**
 * Generate an owner request appropriate to the mandate, or null when the owner
 * stays out of it this cycle. Deterministic given `rng`.
 */
export function generateOwnerRequest(args: {
  mandate: Mandate
  year: number
  day: number
  rng: Rng
  /** ~chance the owner meddles this cycle (default 0.5). */
  chance?: number
}): OwnerRequest | null {
  const { mandate, year, day, rng, chance = 0.5 } = args
  if (!rng.chance(chance)) return null
  const pool = poolFor(mandate)
  const kind = pool[rng.int(pool.length)]!
  const t = TEMPLATES[kind]
  // Deliberately low-stakes so a directive is flavour + a nudge, never a tax you
  // must pay: accepting curries a little favour, declining costs a little — small
  // enough that backing your own plan is always a legitimate choice. Win-now asks
  // carry marginally more weight than housekeeping.
  const heavy = kind === 'pushForPlayoffs' || kind === 'signMarketableStar'
  return {
    id: `owner-${year}-${day}`,
    kind,
    year,
    day,
    title: t.title,
    body: t.body,
    spoken: t.spoken,
    acceptConfidence: heavy ? 5 : 4,
    declineConfidence: heavy ? -4 : -3,
    acceptPatience: 2,
    declinePatience: -1,
  }
}
