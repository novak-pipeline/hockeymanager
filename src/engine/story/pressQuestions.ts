/**
 * Press conferences as REAL CHOICES (docs/MEDIA-BEAT.md §Pressers).
 *
 * The old presser asked one generic question after a 4-goal loss and let the
 * GM pick a tone; praise or measured was always right (audit §5, "press tone
 * is nearly dominated"). Pressers are now fewer and about something: a NAMED
 * player, the coach on the hot seat, the season's ambition, a skid. Each
 * answer carries a tone (for the pundit relationship, unchanged) AND a
 * consequence the career applies through systems that already exist — morale,
 * the room, fan interest, board patience, and the GM's public CLAIMS, which
 * the press remembers and quotes back when they prove right or wrong.
 *
 * No option is free:
 *  - backing someone publicly buys belief now and becomes a claim later;
 *  - candour ("everyone is evaluated") keeps options open and costs a man's
 *    trust;
 *  - no comment protects everyone and costs you the reporter.
 *
 * Pure data + text. The effects live in Career.applyPresserOption.
 */
import type { ContentVariant } from './contentEngine'
import { renderStable } from './prose'
import type { PressTone } from './factSheet'

export type PresserTopic = 'blowout' | 'playerPlans' | 'hotSeat' | 'seasonClaim' | 'skid'

export interface PresserOption {
  id: string
  label: string
  tone: PressTone
  /** A diegetic read of what the answer will cost — telegraphed, never a number. */
  hint: string
}

export interface PresserPrompt {
  topic: PresserTopic
  question: string
  context: string
  options: PresserOption[]
}

/* ─────────────────────────── questions ─────────────────────────── */

const Q: ContentVariant[] = [
  { id: 'pq.pp.a', conditions: { topic: 'playerPlans' }, text: `Is {name} part of your plans going forward?` },
  { id: 'pq.pp.b', conditions: { topic: 'playerPlans' }, text: `There's a lot of talk about {name}. Where does he fit with this team?` },
  { id: 'pq.pp.c', conditions: { topic: 'playerPlans' }, text: `Straight question: is {name} going to be here long term?` },
  { id: 'pq.pp.req.a', conditions: { topic: 'playerPlans', why: 'request' }, text: `{name} has asked out. Are you going to trade him?` },
  { id: 'pq.pp.req.b', conditions: { topic: 'playerPlans', why: 'request' }, text: `We're told {name} wants a trade. Does he have a future here?` },
  { id: 'pq.pp.req.c', conditions: { topic: 'playerPlans', why: 'request' }, text: `What's the status with {name}? Is this going to end in a trade?` },
  { id: 'pq.pp.sl.a', conditions: { topic: 'playerPlans', why: 'slump' }, text: `{name} has {n} games without a point. Is he still a big part of this?` },
  { id: 'pq.pp.sl.b', conditions: { topic: 'playerPlans', why: 'slump' }, text: `What do you say to people who think {name} is done here after {n} pointless games?` },
  { id: 'pq.pp.sl.c', conditions: { topic: 'playerPlans', why: 'slump' }, text: `{name} is stuck at {n} games without a point. Are you still committed to him?` },
  { id: 'pq.pp.ex.a', conditions: { topic: 'playerPlans', why: 'expiring' }, text: `{name}'s contract is up at the end of the year. Is he in your plans?` },
  { id: 'pq.pp.ex.b', conditions: { topic: 'playerPlans', why: 'expiring' }, text: `Are you going to get something done with {name}, or is he a trade chip?` },
  { id: 'pq.pp.ex.c', conditions: { topic: 'playerPlans', why: 'expiring' }, text: `{name} is on an expiring deal. What's the plan there?` },
  { id: 'pq.hs.a', conditions: { topic: 'hotSeat' }, text: `Does {coach} have your full support?` },
  { id: 'pq.hs.b', conditions: { topic: 'hotSeat' }, text: `{record}. Is {coach} the right man to turn this around?` },
  { id: 'pq.hs.c', conditions: { topic: 'hotSeat' }, text: `Is {coach}'s job safe?` },
  { id: 'pq.sc.a', conditions: { topic: 'seasonClaim' }, text: `Is this a playoff team?` },
  { id: 'pq.sc.b', conditions: { topic: 'seasonClaim' }, text: `What's the expectation for this group? Playoffs?` },
  { id: 'pq.sc.c', conditions: { topic: 'seasonClaim' }, text: `Fans want to know: are the playoffs the bar this year?` },
  { id: 'pq.bo.a', conditions: { topic: 'blowout' }, text: `You just lost {score}. What went wrong tonight?` },
  { id: 'pq.bo.b', conditions: { topic: 'blowout' }, text: `{score}. How do you explain a night like that?` },
  { id: 'pq.bo.c', conditions: { topic: 'blowout' }, text: `A {score} loss. Is that effort acceptable?` },
  { id: 'pq.sk.a', conditions: { topic: 'skid' }, text: `That's {n} straight losses. What has to change?` },
  { id: 'pq.sk.b', conditions: { topic: 'skid' }, text: `{n} in a row now. Are changes coming?` },
  { id: 'pq.sk.c', conditions: { topic: 'skid' }, text: `How concerned are you after {n} straight losses?` },
]

const CTX: ContentVariant[] = [
  { id: 'pc.pp.a', conditions: { topic: 'playerPlans' }, text: `The question is about {name}. He will read whatever you say.` },
  { id: 'pc.hs.a', conditions: { topic: 'hotSeat' }, text: `{record}, {rank}. The hot-seat talk has reached the podium.` },
  { id: 'pc.sc.a', conditions: { topic: 'seasonClaim' }, text: `Early-season media availability. Whatever you say goes on the record.` },
  { id: 'pc.bo.a', conditions: { topic: 'blowout' }, text: `After a {score} loss to {opp}.` },
  { id: 'pc.sk.a', conditions: { topic: 'skid' }, text: `After a {n}-game losing streak.` },
]

/** Build the prompt for a topic. `key` keeps the wording stable for the moment. */
export function presserPrompt(
  topic: PresserTopic,
  slots: Record<string, string>,
  key: string,
  extra: { why?: string; goalieName?: string } = {},
): PresserPrompt {
  const ctx = extra.why ? { topic, why: extra.why } : { topic }
  const question = renderStable(Q, ctx, `${key}|q`, slots)
  const context = renderStable(CTX, { topic }, `${key}|c`, slots)
  return { topic, question, context, options: optionsFor(topic, slots, extra) }
}

function optionsFor(topic: PresserTopic, s: Record<string, string>, extra: { goalieName?: string }): PresserOption[] {
  switch (topic) {
    case 'playerPlans':
      return [
        { id: 'core', label: `"${s.first ?? s.name} is a big part of what we're doing here."`, tone: 'praise', hint: `He'll hear it, and it goes on the record. If he's moved, it will be quoted back.` },
        { id: 'evaluate', label: `"Everybody in that room is being evaluated. Him included."`, tone: 'measured', hint: `Honest, and it keeps your options open. He will not enjoy reading it.` },
        { id: 'noComment', label: `"I'm not going to talk about individual players."`, tone: 'deflecting', hint: `Protects everyone. The reporter who asked will not forget the brush-off.` },
      ]
    case 'hotSeat':
      return [
        { id: 'back', label: `"${s.coach} has my full support."`, tone: 'praise', hint: `A vote of confidence. The room settles; if you fire him later, this gets replayed.` },
        { id: 'evaluate', label: `"We evaluate everything, every day."`, tone: 'measured', hint: `Keeps the door open. The players and the coach will hear the hedge.` },
        { id: 'deflect', label: `"That's not a conversation for today."`, tone: 'deflecting', hint: `Nobody will read it as a yes.` },
      ]
    case 'seasonClaim':
      return [
        { id: 'playoffs', label: `"We're a playoff team. I'll say it."`, tone: 'praise', hint: `The building loves it now. In April it's your quote, either way.` },
        { id: 'letPlay', label: `"We'll let the season answer that."`, tone: 'measured', hint: `Nothing to hold against you, nothing to sell a ticket with.` },
        { id: 'building', label: `"We're building something. Judge us in two years."`, tone: 'measured', hint: `Lowers the bar. Some fans will hear it as giving up.` },
      ]
    case 'blowout': {
      const opts: PresserOption[] = [
        { id: 'fiery', label: `"That was embarrassing, and every one of them knows it."`, tone: 'fiery', hint: `Lights a fire. Somebody might take it personally.` },
        { id: 'credit', label: `"Credit to them. We move on."`, tone: 'measured', hint: `Calm. Some will call it soft.` },
      ]
      if (extra.goalieName) {
        opts.splice(1, 0, {
          id: 'goalie',
          label: `"We need a save now and then."`,
          tone: 'fiery',
          hint: `${extra.goalieName} will know exactly who you mean.`,
        })
      }
      opts.push({ id: 'noComment', label: `"No comment."`, tone: 'deflecting', hint: `Ends it. The press hates it.` })
      return opts
    }
    case 'skid':
      return [
        { id: 'changes', label: `"Nobody's spot is safe. There will be changes."`, tone: 'fiery', hint: `Depth players hear opportunity; the stars hear a threat.` },
        { id: 'patience', label: `"Nothing. We believe in this group."`, tone: 'measured', hint: `The players believe you. The fans want action.` },
        { id: 'noComment', label: `"We'll talk about it internally."`, tone: 'deflecting', hint: `Closes the door. The reporters notice.` },
      ]
  }
}
