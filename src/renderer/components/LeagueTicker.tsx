import { useEffect, useState } from 'react'
import type { ScoreboardView, LeagueWireView, InboxView } from '../../engine/career/views'
import { useClient, useScreenData } from '../hooks/useSim'
import { useNav } from './NavContext'

/**
 * ESPN BottomLine-style crawl pinned to the top of the shell. Presentation-only:
 * it consumes views the engine already emits (scoreboard, transactions ledger,
 * news) and refreshes on the global version bus after every sim. Three modes —
 * around-the-league Scores, the transactions/streaks Wire, and headline News.
 * Toggleable, pauses on hover, click-to-deep-link, honours prefers-reduced-motion.
 */

type Mode = 'scores' | 'wire' | 'news'
const MODES: Mode[] = ['scores', 'wire', 'news']
const MODE_LABEL: Record<Mode, string> = { scores: 'Scores', wire: 'Wire', news: 'News' }
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
  const [mode, setMode] = useState<Mode>(() => {
    const saved = localStorage.getItem(LS_MODE)
    return MODES.includes(saved as Mode) ? (saved as Mode) : 'scores'
  })

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
  const inbox = useScreenData<InboxView>(
    () => client.getInbox(),
    (r) => (r.type === 'inbox' ? r.inbox : null)
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

  let items: TickerItem[]
  if (mode === 'scores') {
    items = (scoreboard.data?.entries ?? [])
      .filter((e) => e.final)
      .map((e) => ({
        key: e.gameId,
        // Away @ Home is the broadcast convention; star the bigger margin.
        text: `${e.awayAbbr} ${e.awayGoals} – ${e.homeGoals} ${e.homeAbbr}`,
        accent: Math.abs(e.homeGoals - e.awayGoals) >= 4,
        onClick: () => nav.navigate('leagueScoreboard'),
      }))
  } else if (mode === 'wire') {
    items = (wire.data?.items ?? []).map((it, i) => ({
      key: `${it.kind}-${i}`,
      text: it.text,
      accent: it.accent,
      onClick: () => nav.navigate(it.kind === 'streak' ? 'standings' : 'leagueTransactions'),
    }))
  } else {
    // News: recent headlines from the feed (newest first).
    items = (inbox.data?.items ?? [])
      .slice(0, 25)
      .map((n) => ({
        key: n.id,
        text: n.headline,
        accent: !n.read,
        onClick: () => nav.navigate('inbox'),
      }))
  }

  // Keep the crawl speed roughly constant regardless of how much is in the feed.
  const durationSec = Math.max(18, items.length * 4.5)

  return (
    <div className="ticker">
      <div className="ticker-controls">
        <span className="ticker-brand">{MODE_LABEL[mode].toUpperCase()}</span>
        {MODES.map((m) => (
          <button
            key={m}
            className={`ticker-mode ${mode === m ? 'is-active' : ''}`}
            onClick={() => setMode(m)}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
        <button className="ticker-hide" onClick={() => setOn(false)} title="Hide the ticker">
          ✕
        </button>
      </div>
      <div className="ticker-viewport">
        {items.length === 0 ? (
          <span className="ticker-empty">
            {mode === 'scores'
              ? 'No final scores yet — sim a day to see results.'
              : mode === 'wire'
                ? 'No transactions on the wire yet.'
                : 'No news yet.'}
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
