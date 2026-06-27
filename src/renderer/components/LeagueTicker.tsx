import { useEffect, useState } from 'react'
import type { ScoreboardView, LeagueWireView } from '../../engine/career/views'
import { useClient, useScreenData } from '../hooks/useSim'
import { useNav } from './NavContext'

/**
 * ESPN BottomLine-style crawl pinned to the bottom of the shell. Presentation-only:
 * it consumes views the engine already emits (scoreboard, transactions ledger) and
 * refreshes on the global version bus after every sim. Two modes — around-the-league
 * Scores and the breaking-news Wire. The ticker is the LEAGUE's voice; the inbox is
 * the club's. Toggleable, pauses on hover, click-to-deep-link, and honours
 * prefers-reduced-motion (static list instead of a crawl).
 */

type Mode = 'scores' | 'wire'
const LS_MODE = 'hg.ticker.mode'
const LS_ON = 'hg.ticker.on'

interface TickerItem {
  key: string
  text: string
  accent?: boolean
  onClick: () => void
}

export function LeagueTicker(): JSX.Element {
  const client = useClient()
  const nav = useNav()
  const [on, setOn] = useState(() => localStorage.getItem(LS_ON) !== '0')
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem(LS_MODE) === 'wire' ? 'wire' : 'scores'))

  useEffect(() => { localStorage.setItem(LS_ON, on ? '1' : '0') }, [on])
  useEffect(() => { localStorage.setItem(LS_MODE, mode) }, [mode])

  const scoreboard = useScreenData<ScoreboardView>(
    () => client.getScoreboard(),
    (r) => (r.type === 'scoreboard' ? r.scoreboard : null)
  )
  const wire = useScreenData<LeagueWireView>(
    () => client.getLeagueWire(),
    (r) => (r.type === 'leagueWire' ? r.leagueWire : null)
  )

  if (!on) {
    return (
      <div className="ticker ticker--collapsed">
        <button className="ticker-handle" onClick={() => setOn(true)} title="Show the league ticker">
          ▸ League Ticker
        </button>
      </div>
    )
  }

  const items: TickerItem[] =
    mode === 'scores'
      ? (scoreboard.data?.entries ?? [])
          .filter((e) => e.final)
          .map((e) => ({
            key: e.gameId,
            // Away @ Home is the broadcast convention; star the bigger margin.
            text: `${e.awayAbbr} ${e.awayGoals} – ${e.homeGoals} ${e.homeAbbr}`,
            accent: Math.abs(e.homeGoals - e.awayGoals) >= 4,
            onClick: () => nav.navigate('leagueScoreboard'),
          }))
      : (wire.data?.items ?? []).map((it, i) => ({
          key: `${it.kind}-${i}`,
          text: it.text,
          accent: it.accent,
          onClick: () => nav.navigate(it.kind === 'streak' ? 'standings' : 'leagueTransactions'),
        }))

  // Keep the crawl speed roughly constant regardless of how much is in the feed.
  const durationSec = Math.max(18, items.length * 4.5)

  return (
    <div className="ticker">
      <div className="ticker-controls">
        <span className="ticker-brand">{mode === 'scores' ? 'SCORES' : 'WIRE'}</span>
        <button
          className={`ticker-mode ${mode === 'scores' ? 'is-active' : ''}`}
          onClick={() => setMode('scores')}
        >
          Scores
        </button>
        <button
          className={`ticker-mode ${mode === 'wire' ? 'is-active' : ''}`}
          onClick={() => setMode('wire')}
        >
          Wire
        </button>
        <button className="ticker-hide" onClick={() => setOn(false)} title="Hide the ticker">
          ✕
        </button>
      </div>
      <div className="ticker-viewport">
        {items.length === 0 ? (
          <span className="ticker-empty">
            {mode === 'scores' ? 'No final scores yet — sim a day to see results.' : 'No transactions on the wire yet.'}
          </span>
        ) : (
          // Two copies of the track give a seamless loop; the second is aria-hidden.
          <div className="ticker-track" style={{ animationDuration: `${durationSec}s` }}>
            {[0, 1].map((copy) => (
              <div className="ticker-run" key={copy} aria-hidden={copy === 1}>
                {items.map((it) => (
                  <button
                    key={`${copy}-${it.key}`}
                    className={`ticker-item ${it.accent ? 'is-accent' : ''}`}
                    onClick={it.onClick}
                    tabIndex={copy === 1 ? -1 : 0}
                  >
                    {it.text}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
