/**
 * TITLE SCREEN — the first sixty seconds (playtest F6, bar B1.1).
 *
 * What used to greet a new player was a seed field and a "Generate league"
 * button: a developer's entry point, not a game's. This is the front door —
 * the club you were last managing, one keystroke from carrying on; a new
 * career; your saves; settings; and the door out. Nothing else.
 *
 * The backdrop is the same scene-art pipeline the meeting screens use
 * (assets/scenes/arena-night.png). When it isn't there — browser dev, a
 * stripped install — the CSS fallback underneath is a designed surface in its
 * own right, not a blank panel.
 */
import { useEffect, useState } from 'react'
import { getScene } from '../lib/mods'
import { Icon } from '../components/primitives'
import { Icons } from '../components/icons'
import { fmtDate } from '../components/format'

export interface ResumeInfo {
  slot: string
  teamName: string
  year: number
  phase: string
  savedAt?: string
}

function phaseLabel(p: string): string {
  return p === 'offseason' ? 'the offseason' : p === 'playoffs' ? 'the playoffs' : 'the regular season'
}

/** The scene backdrop, or null when the bridge/art isn't there. */
export function useSceneArt(name: string): string | null {
  const [art, setArt] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void getScene(name).then((url) => { if (alive) setArt(url) })
    return () => { alive = false }
  }, [name])
  return art
}

export function TitleScreen(props: {
  resume: ResumeInfo | null
  saveCount: number
  busy: boolean
  engineVersion: string
  onContinue: () => void
  onNewCareer: () => void
  onLoad: () => void
  onSettings: () => void
  onQuit: () => void
}): JSX.Element {
  const art = useSceneArt('arena-night')

  return (
    <div className="title" style={art ? { backgroundImage: `url(${art})` } : undefined}>
      <div className="title-scrim" />
      <div className="title-inner">
        <header className="title-brand">
          <h1 className="title-wordmark">THE SHOW</h1>
          <div className="title-tagline">Franchise Hockey Manager</div>
        </header>

        <nav className="title-menu">
          {props.resume && (
            <MenuItem
              primary
              icon={<Icons.Play />}
              label="Continue"
              sub={`${props.resume.teamName} · ${props.resume.year}, ${phaseLabel(props.resume.phase)}${
                props.resume.savedAt ? ` · saved ${fmtDate(props.resume.savedAt)}` : ''
              }`}
              disabled={props.busy}
              onClick={props.onContinue}
              autoFocus
            />
          )}
          <MenuItem
            icon={<Icons.Briefcase />}
            label="New career"
            sub="Choose a database, a world and the club whose job you want"
            disabled={props.busy}
            onClick={props.onNewCareer}
            autoFocus={!props.resume}
          />
          <MenuItem
            icon={<Icons.History />}
            label="Load career"
            sub={props.saveCount === 0
              ? 'No saved careers yet'
              : `${props.saveCount} saved ${props.saveCount === 1 ? 'career' : 'careers'}`}
            disabled={props.busy || props.saveCount === 0}
            onClick={props.onLoad}
          />
          <MenuItem
            icon={<Icons.Settings />}
            label="Settings"
            sub="Presentation, voices and the writer"
            disabled={props.busy}
            onClick={props.onSettings}
          />
          <MenuItem
            icon={<Icons.Back />}
            label="Quit"
            sub="Close the game"
            disabled={props.busy}
            onClick={props.onQuit}
          />
        </nav>

        <footer className="title-foot">
          <span>Engine {props.engineVersion}</span>
          <span className="title-foot-dot">·</span>
          <span>Fictional database. Community rosters load as mods.</span>
        </footer>
      </div>
    </div>
  )
}

function MenuItem(props: {
  icon: JSX.Element
  label: string
  sub: string
  primary?: boolean
  disabled?: boolean
  autoFocus?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      className={`title-item${props.primary ? ' primary' : ''}`}
      onClick={props.onClick}
      disabled={props.disabled}
      autoFocus={props.autoFocus}
    >
      <Icon size={20} className="title-item-icon">{props.icon}</Icon>
      <span className="title-item-text">
        <span className="title-item-label">{props.label}</span>
        <span className="title-item-sub">{props.sub}</span>
      </span>
      <Icon size={16} className="title-item-chev"><Icons.ChevronRight /></Icon>
    </button>
  )
}
