/**
 * NEW CAREER (playtest F6) — the two steps before you have a job.
 *
 * Step one: which world. A database (fictional, or a community roster mod)
 * and a seed, presented as choices with consequences rather than a form.
 * Step two lives in ClubPicker: which club's job you want.
 */
import { useState } from 'react'
import type { ModListEntry } from '../lib/mods'
import { Icon } from '../components/primitives'
import { Icons } from '../components/icons'
import { useSceneArt } from './TitleScreen'

/** A fresh random world seed (1..1,000,000). */
export function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000) + 1
}

export function NewCareerScreen(props: {
  seed: number
  setSeed: (n: number) => void
  busy: boolean
  availableMods: ModListEntry[]
  selectedModId: string
  setSelectedModId: (id: string) => void
  onCreate: () => void
  onBack: () => void
}): JSX.Element {
  const art = useSceneArt('arena-night')
  const [showSeed, setShowSeed] = useState(false)

  const databases: Array<{ id: string; name: string; note: string }> = [
    {
      id: '',
      name: 'Fictional league',
      note: 'A generated world with its own clubs, players and history. Ships with the game and is always legal to share.',
    },
    ...props.availableMods.map((m) => ({
      id: m.id,
      name: m.name + (m.season ? ` (${m.season})` : ''),
      note: `${m.teamCount} clubs · community database`,
    })),
  ]

  return (
    <div className="setup" style={art ? { backgroundImage: `url(${art})` } : undefined}>
      <div className="title-scrim" />
      <div className="setup-inner">
        <button className="setup-back" onClick={props.onBack} disabled={props.busy}>
          <Icon size={14}><Icons.Back /></Icon> Main menu
        </button>

        <header className="setup-head">
          <div className="setup-step">Step 1 of 2</div>
          <h1 className="setup-title">Choose your world</h1>
          <p className="setup-sub">
            You take over in the summer. The draft, free agency and training camp are yours
            before the puck drops.
          </p>
        </header>

        <div className="setup-cards">
          {databases.map((db) => (
            <button
              key={db.id}
              className={`setup-card${props.selectedModId === db.id ? ' on' : ''}`}
              onClick={() => props.setSelectedModId(db.id)}
              disabled={props.busy}
            >
              <span className="setup-card-head">
                <Icon size={18}>{db.id === '' ? <Icons.Globe /> : <Icons.Squad />}</Icon>
                <span className="setup-card-name">{db.name}</span>
                {props.selectedModId === db.id && (
                  <Icon size={16} className="setup-card-tick"><Icons.Check /></Icon>
                )}
              </span>
              <span className="setup-card-note">{db.note}</span>
            </button>
          ))}
        </div>

        <div className="setup-seed">
          <button className="setup-seed-toggle" onClick={() => setShowSeed((v) => !v)}>
            <Icon size={14}><Icons.ChevronRight /></Icon>
            World seed
            <span className="muted small">
              — random by default; set one only to replay an exact world
            </span>
          </button>
          {showSeed && (
            <div className="setup-seed-row">
              <input
                className="input"
                type="number"
                value={props.seed}
                onChange={(e) => props.setSeed(Number(e.target.value))}
                aria-label="World seed"
              />
              <button className="btn btn-ghost" onClick={() => props.setSeed(randomSeed())}>
                Randomize
              </button>
            </div>
          )}
        </div>

        <div className="setup-cta">
          <button className="btn btn-hero btn-lg" onClick={props.onCreate} disabled={props.busy}>
            {props.busy ? 'Building the world…' : 'Build the world'}
          </button>
          {props.busy && (
            <p className="setup-progress">
              Generating clubs, rosters, a draft class and a season of history. A moment.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
