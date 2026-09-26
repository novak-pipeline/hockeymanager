/**
 * DEV-ONLY broadcast harness (not in the production build: the renderer's
 * rollup input is index.html only). Open /dev/broadcast-harness.html on the dev
 * server: it starts a career on a generated (fictional) league, watches the
 * user's first game on the full engine, fetches the REAL pregame context the
 * worker would send, and mounts MatchViewer with it — so the broadcast open,
 * overlays and cues can be seen without Electron or a save.
 *
 * ?story=demo adds harness-only storylines (labelled as such in the console) so
 * every ceremony can be screenshotted on one game. Never used by the app.
 */
import { StrictMode, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { MotionConfig } from 'framer-motion'
import { generateLeague } from '@data/generate'
import { Career } from '@engine/career/career'
import type { BroadcastContext, BroadcastStoryline } from '@engine/story/broadcastStorylines'
import { MatchViewer } from '../MatchViewer'
import { MatchTimeline } from '@render2d'
import { absTime } from '../../render2d/timeline'
import '../index.css'

function Harness(): JSX.Element {
  const { game, ctx } = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const seed = Number(params.get('seed') ?? 7)
    const data = generateLeague({ seed })
    const career = new Career(data, seed, data.league.teams[Number(params.get('team') ?? 0)]!)
    let g = career.watchNext()
    for (let i = 0; i < 30 && !g; i++) g = career.watchNext()
    let c = career.getBroadcastContext() as BroadcastContext
    if (params.get('story') === 'demo' && g) {
      // Harness-only: fabricate one of each ceremony so all graphics show.
      const pick = (side: 'home' | 'away', pos?: string): string =>
        Object.values(c.players).find((p) => p.side === side && (!pos || p.position === pos) && p.jerseyNumber !== 0)!.id
      const homeC = c.home.starters[0] ?? pick('home')
      const scorer = g.stream.find((e) => e.type === 'goal')
      const vet = scorer && scorer.type === 'goal' ? scorer.scorer : pick('away')
      const demo: BroadcastStoryline[] = [
        { id: `debut:${homeC}`, kind: 'debut', side: 'home', playerId: homeC, title: 'NHL DEBUT', detail: `${c.players[homeC]!.name}, 19, plays his first NHL game`, priority: 90 },
        { id: `points:${vet}:1000`, kind: 'milestoneWatch', side: c.players[vet]!.side, playerId: vet, title: 'MILESTONE WATCH', detail: `${c.players[vet]!.name} is one point from 1,000`, priority: 62, milestone: { stat: 'points', before: 999, target: 1000 } },
      ]
      console.warn('[harness] ?story=demo — storylines below are FABRICATED for screenshots:', demo)
      c = { ...c, storylines: [...demo, ...c.storylines] }
    }
    try { localStorage.setItem('hockeyMatchRenderer', params.get('r') === '3d' ? '3d' : '2d') } catch { /* ignore */ }
    // Expose goal positions (as scrubber fractions) for the screenshot script.
    const tl = new MatchTimeline(g!.stream, (id) => g!.homePlayerIds.includes(id))
    ;(window as unknown as { __bc: unknown }).__bc = {
      goals: g!.stream.filter((e) => e.type === 'goal').map((e) => absTime(e.period, e.t) / tl.duration),
      duration: tl.duration,
    }
    return { game: g!, ctx: c }
  }, [])
  return (
    <div style={{ padding: 16, background: 'var(--bg0, #0b0e14)', minHeight: '100vh' }}>
      <MatchViewer game={game} broadcast={ctx} onClose={() => location.reload()} />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MotionConfig reducedMotion="user">
      <Harness />
    </MotionConfig>
  </StrictMode>,
)
