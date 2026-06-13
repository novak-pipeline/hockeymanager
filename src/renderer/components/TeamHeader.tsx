/**
 * TeamHeader — EHM-style team-navigation header shown at the top of every
 * Team section sub-tab when the user browses any team (their own or others).
 *
 * Layout:
 *   [◄]  [▼ affiliate]  [►]   ABBR  Team Name   [dropdown]   [Back to my club]
 *
 * ◄ / ► cycle through NHL teams in standings order.
 * ▼     jumps to the viewed team's AHL affiliate (or back to NHL parent).
 * Dropdown lists all NHL teams + AHL affiliates for direct jump.
 * "Back to my club" is shown when viewing any team other than the user's own.
 */
import { useEffect, useMemo, useState } from 'react'
import type { LeagueTeamsView } from '../../worker/protocol'
import { useClient, useScreenData } from '../hooks/useSim'
import { useNav } from './NavContext'
import type { ScreenId } from './NavContext'
import { crestColor } from './format'

interface TeamHeaderProps {
  /** The team currently being viewed (may be own team). */
  viewedTeamId: string
  /** The GM's own team. */
  userTeamId: string
  /** Current sub-tab so ◄/► preserve the active tab. */
  currentTab: ScreenId
}

export function TeamHeader({ viewedTeamId, userTeamId, currentTab }: TeamHeaderProps): JSX.Element {
  const client = useClient()
  const nav = useNav()

  const { data: leagueTeams } = useScreenData<LeagueTeamsView>(
    () => client.getLeagueTeams(),
    (r) => (r.type === 'leagueTeams' ? r.teams : null)
  )

  // Build a flat ordered list of NHL teams for cycling ◄/►
  const nhlList = useMemo(() => leagueTeams?.nhl ?? [], [leagueTeams])
  const allTeams = useMemo(
    () => [...(leagueTeams?.nhl ?? []), ...(leagueTeams?.ahl ?? [])],
    [leagueTeams]
  )

  // Current viewed team info
  const viewedTeam = useMemo(
    () => allTeams.find((t) => t.teamId === viewedTeamId),
    [allTeams, viewedTeamId]
  )

  // Affiliate jump target
  const affiliateId = viewedTeam?.affiliateId ?? null

  // Cycle index within NHL list
  const nhlIndex = useMemo(
    () => nhlList.findIndex((t) => t.teamId === viewedTeamId),
    [nhlList, viewedTeamId]
  )

  function goTo(teamId: string): void {
    if (teamId === userTeamId) {
      // Navigating back to user's own club — clear teamId param
      nav.navigate(currentTab)
    } else {
      nav.navigate(currentTab, { teamId })
    }
  }

  function goPrev(): void {
    if (nhlList.length === 0) return
    // If currently on an AHL team, go to its parent
    if (viewedTeam?.tier === 'ahl') {
      if (viewedTeam.affiliateId) goTo(viewedTeam.affiliateId)
      return
    }
    const prevIdx = (nhlIndex - 1 + nhlList.length) % nhlList.length
    const prev = nhlList[prevIdx]
    if (prev) goTo(prev.teamId)
  }

  function goNext(): void {
    if (nhlList.length === 0) return
    if (viewedTeam?.tier === 'ahl') {
      if (viewedTeam.affiliateId) goTo(viewedTeam.affiliateId)
      return
    }
    const nextIdx = (nhlIndex + 1) % nhlList.length
    const next = nhlList[nextIdx]
    if (next) goTo(next.teamId)
  }

  function goAffiliate(): void {
    if (!affiliateId) return
    goTo(affiliateId)
  }

  const isOwnTeam = viewedTeamId === userTeamId
  const isAhl = viewedTeam?.tier === 'ahl'
  const hasAffiliate = affiliateId !== null

  const [dropOpen, setDropOpen] = useState(false)

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropOpen) return
    function close(): void { setDropOpen(false) }
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [dropOpen])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--sp-2)',
        padding: '6px var(--sp-3)',
        background: 'var(--bg2)',
        borderBottom: '2px solid var(--team-primary, var(--border))',
        flexWrap: 'wrap',
      }}
    >
      {/* Prev arrow — only meaningful for NHL teams */}
      <button
        className="btn btn-ghost btn-sm"
        title="Previous team"
        onClick={goPrev}
        disabled={nhlIndex <= 0 && !isAhl}
        style={{ fontFamily: 'monospace', minWidth: 28 }}
      >
        ◄
      </button>

      {/* Affiliate toggle (▼ = go to farm; △ = back to NHL parent) */}
      <button
        className="btn btn-ghost btn-sm"
        title={isAhl ? 'Back to NHL parent' : 'View AHL affiliate'}
        onClick={goAffiliate}
        disabled={!hasAffiliate}
        style={{ fontFamily: 'monospace', minWidth: 28 }}
      >
        {isAhl ? '△' : '▼'}
      </button>

      {/* Next arrow */}
      <button
        className="btn btn-ghost btn-sm"
        title="Next team"
        onClick={goNext}
        disabled={!isAhl && nhlIndex >= nhlList.length - 1}
        style={{ fontFamily: 'monospace', minWidth: 28 }}
      >
        ►
      </button>

      {/* Crest + name */}
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 4,
          background: viewedTeam ? 'var(--team-primary, var(--bg3))' : 'var(--bg3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 11,
          color: '#fff',
          flexShrink: 0,
        }}
      >
        {viewedTeam?.abbreviation ?? '??'}
      </div>

      <span style={{ fontWeight: 600, fontSize: 14 }}>
        {viewedTeam?.name ?? viewedTeamId}
      </span>

      {isAhl && (
        <span className="chip chip-warn" style={{ fontSize: 10 }}>AHL</span>
      )}

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Team dropdown */}
      <div style={{ position: 'relative' }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={(e) => { e.stopPropagation(); setDropOpen((o) => !o) }}
          title="Jump to team"
        >
          Jump to team ▾
        </button>
        {dropOpen && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute',
              right: 0,
              top: '100%',
              zIndex: 200,
              background: 'var(--bg2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              minWidth: 220,
              maxHeight: 340,
              overflowY: 'auto',
              boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            }}
          >
            {leagueTeams && (
              <>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: 'var(--muted)',
                    padding: '6px 10px 2px',
                  }}
                >
                  NHL
                </div>
                {leagueTeams.nhl.map((t) => (
                  <button
                    key={t.teamId}
                    className={t.teamId === viewedTeamId ? 'dropdown-item active' : 'dropdown-item'}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '5px 10px',
                      background: t.teamId === viewedTeamId ? 'var(--team-accent-dim, var(--violet-dim))' : undefined,
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--fg)',
                      fontSize: 13,
                    }}
                    onClick={() => { setDropOpen(false); goTo(t.teamId) }}
                  >
                    <span style={{ fontWeight: 600, marginRight: 6, color: 'var(--muted)' }}>
                      {t.abbreviation}
                    </span>
                    {t.name}
                  </button>
                ))}
                {leagueTeams.ahl.length > 0 && (
                  <>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        color: 'var(--muted)',
                        padding: '6px 10px 2px',
                        borderTop: '1px solid var(--border)',
                        marginTop: 4,
                      }}
                    >
                      AHL
                    </div>
                    {leagueTeams.ahl.map((t) => (
                      <button
                        key={t.teamId}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '5px 10px',
                          background: t.teamId === viewedTeamId ? 'var(--team-accent-dim, var(--violet-dim))' : undefined,
                          border: 'none',
                          cursor: 'pointer',
                          color: 'var(--fg)',
                          fontSize: 12,
                        }}
                        onClick={() => { setDropOpen(false); goTo(t.teamId) }}
                      >
                        <span style={{ fontWeight: 600, marginRight: 6, color: 'var(--muted)' }}>
                          {t.abbreviation}
                        </span>
                        {t.name}
                      </button>
                    ))}
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Back to my club */}
      {!isOwnTeam && (
        <button
          className="btn btn-primary btn-sm"
          onClick={() => nav.navigate(currentTab)}
          title="Back to your club"
        >
          ← My club
        </button>
      )}
    </div>
  )
}
