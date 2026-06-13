/**
 * BoardScreen — Owner / Board room.
 *
 * Surfaces the franchise drama: mandate, confidence/patience meters, hot-seat
 * warnings, target vs current rank, and the board message feed. When the GM
 * has been fired it renders a somber "Relieved of duties" state.
 */
import type { BoardView } from '../../worker/protocol'
import { Notice, Panel, ScreenHeader, ScreenStateNotices } from '../components/ui'
import { useClient, useScreenData } from '../hooks/useSim'

/* ── helpers ── */

function ordinal(n: number): string {
  if (n >= 11 && n <= 13) return `${n}th`
  switch (n % 10) {
    case 1: return `${n}st`
    case 2: return `${n}nd`
    case 3: return `${n}rd`
    default: return `${n}th`
  }
}

/** Return CSS color for a 0–100 confidence value. */
function confidenceColor(c: number): string {
  if (c >= 60) return 'var(--green)'
  if (c >= 35) return 'var(--amber)'
  return 'var(--red)'
}

/** Return CSS color for a 0–100 patience value. */
function patienceColor(p: number): string {
  if (p >= 50) return 'var(--cyan)'
  if (p >= 25) return 'var(--amber)'
  return 'var(--red)'
}

/* ════════════════════════════════════════════════════════════════
   Meter bar
   ════════════════════════════════════════════════════════════════ */

/** Patience as an attitude phrase rather than a bare number. */
function patienceWord(p: number): string {
  if (p >= 80) return 'Rock solid'
  if (p >= 55) return 'Patient'
  if (p >= 35) return 'Watching closely'
  if (p >= 20) return 'Wearing thin'
  return 'Nearly exhausted'
}

function Meter(props: {
  label: string
  value: number
  color: string
  /** Attitude phrase shown instead of a raw number. */
  valueLabel: string
  sublabel?: string
}): JSX.Element {
  const pct = Math.max(0, Math.min(100, props.value))
  return (
    <div style={{ marginBottom: 'var(--sp-3)' }}>
      <div
        className="row-between small"
        style={{ marginBottom: 'var(--sp-1)' }}
      >
        <span style={{ fontWeight: 600 }}>{props.label}</span>
        <span style={{ color: props.color, fontWeight: 700 }}>{props.valueLabel}</span>
      </div>
      <div className="meter">
        <div
          style={{
            height: '100%',
            width: `${pct}%`,
            background: props.color,
            borderRadius: 'var(--radius-sm)',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      {props.sublabel && (
        <div className="muted small" style={{ marginTop: 2 }}>
          {props.sublabel}
        </div>
      )}
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════
   Main screen
   ════════════════════════════════════════════════════════════════ */

export function BoardScreen(): JSX.Element {
  const client = useClient()

  const { data, loading, error } = useScreenData<BoardView>(
    () => client.getBoard(),
    (r) => (r.type === 'board' ? r.board : null)
  )

  return (
    <section className="stack">
      <ScreenHeader title="Owner / Board" />

      <ScreenStateNotices
        loading={loading && !data}
        error={error}
        empty={!loading && !error && !data}
        emptyText="Board data not yet available — start a season first."
      />

      {data && <BoardBody board={data} />}
    </section>
  )
}

/* ════════════════════════════════════════════════════════════════
   Board body — two layouts: fired vs active
   ════════════════════════════════════════════════════════════════ */

function BoardBody(props: { board: BoardView }): JSX.Element {
  const { board } = props

  if (board.fired) {
    return <FiredState board={board} />
  }

  const hotSeat = board.confidence < 35
  const ultimatum = board.warnings >= 2

  return (
    <div className="stack">
      {/* ── hot-seat / ultimatum banner ── */}
      {hotSeat && (
        <div
          className="notice notice-danger"
          style={{
            fontWeight: 600,
            fontSize: 15,
            borderLeft: '4px solid var(--red)',
            paddingLeft: 'var(--sp-4)',
          }}
        >
          {ultimatum
            ? 'ULTIMATUM ISSUED — The board demands immediate improvement or faces a change in leadership.'
            : 'HOT SEAT — Board confidence is critically low. Results must improve urgently.'}
        </div>
      )}

      {/* ── 2-col layout: mandate + meters ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--sp-4)',
          alignItems: 'start',
        }}
      >
        {/* Mandate card */}
        <Panel title="Season Mandate">
          <div style={{ marginBottom: 'var(--sp-3)' }}>
            <span
              className="chip chip-violet"
              style={{ fontSize: 12, marginBottom: 'var(--sp-2)', display: 'inline-block' }}
            >
              {formatMandate(board.mandate)}
            </span>
            <div
              style={{
                fontSize: 15,
                fontStyle: 'italic',
                color: 'var(--text)',
                lineHeight: 1.55,
                marginTop: 'var(--sp-2)',
              }}
            >
              "{board.mandateText}"
            </div>
          </div>

          {/* Target vs current rank */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 'var(--sp-3)',
              marginTop: 'var(--sp-3)',
              paddingTop: 'var(--sp-3)',
              borderTop: '1px solid var(--line)',
            }}
          >
            <div className="stat">
              <div
                className="stat-value"
                style={{ color: 'var(--muted)', fontSize: 28 }}
              >
                {ordinal(board.targetRank)}
              </div>
              <div className="stat-label">Board target</div>
            </div>
            <div className="stat">
              <div
                className="stat-value"
                style={{
                  color: rankColor(board.currentRank, board.targetRank),
                  fontSize: 28,
                }}
              >
                {ordinal(board.currentRank)}
              </div>
              <div className="stat-label">Current rank</div>
            </div>
          </div>

          {board.warnings > 0 && (
            <div style={{ marginTop: 'var(--sp-3)' }}>
              <span
                className="chip chip-danger"
                style={{ fontSize: 11 }}
              >
                {board.warnings} warning{board.warnings === 1 ? '' : 's'} issued
              </span>
            </div>
          )}
        </Panel>

        {/* Confidence & patience meters */}
        <Panel title="Board Relationship">
          {/* Status label */}
          <div style={{ marginBottom: 'var(--sp-4)' }}>
            <div
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: statusColor(board),
              }}
            >
              {board.statusLabel}
            </div>
            <div className="muted small">Current standing with ownership</div>
          </div>

          <Meter
            label="Confidence"
            value={board.confidence}
            color={confidenceColor(board.confidence)}
            valueLabel={board.confidenceLabel}
          />

          <Meter
            label="Patience"
            value={board.patience}
            color={patienceColor(board.patience)}
            valueLabel={patienceWord(board.patience)}
            sublabel={board.patience <= 20 ? 'Nearly exhausted — one more miss could end things' : undefined}
          />
        </Panel>
      </div>

      {/* ── What matters this season ── */}
      <MandateGuidance board={board} />
    </div>
  )
}

/** Somber fired state — clearly communicates the GM's employment is over. */
function FiredState(props: { board: BoardView }): JSX.Element {
  const { board } = props
  return (
    <div className="stack">
      <div
        style={{
          background: 'var(--bg1)',
          border: '2px solid var(--red)',
          borderRadius: 'var(--radius)',
          padding: 'var(--sp-6)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontSize: 40,
            marginBottom: 'var(--sp-3)',
            opacity: 0.4,
          }}
        >
          ⬛
        </div>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--red)',
            marginBottom: 'var(--sp-2)',
          }}
        >
          Relieved of Duties
        </div>
        {board.firedAtYear !== null && (
          <div className="muted" style={{ marginBottom: 'var(--sp-4)' }}>
            The ownership group terminated your employment after the {board.firedAtYear} season.
          </div>
        )}
        <div
          style={{
            maxWidth: 480,
            margin: '0 auto',
            color: 'var(--muted)',
            fontSize: 13,
            lineHeight: 1.6,
          }}
        >
          "{board.mandateText}"
        </div>
        <div style={{ marginTop: 'var(--sp-4)' }}>
          <span className="chip chip-danger">
            {board.confidenceLabel} to the end ·{' '}
            {board.warnings} warning{board.warnings === 1 ? '' : 's'} issued
          </span>
        </div>
      </div>
    </div>
  )
}

/** Contextual guidance block: what does this mandate actually require? */
function MandateGuidance(props: { board: BoardView }): JSX.Element {
  const { board } = props

  const bullets = mandateBullets(board.mandate, board.targetRank)
  if (bullets.length === 0) return <></>

  return (
    <Panel title="What the board wants to see">
      <ul
        style={{
          margin: 0,
          paddingLeft: 'var(--sp-5)',
          color: 'var(--muted)',
          lineHeight: 1.7,
        }}
      >
        {bullets.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    </Panel>
  )
}

/* ── formatting helpers ── */

function formatMandate(m: string): string {
  switch (m) {
    case 'cupOrBust':           return 'Cup or Bust'
    case 'contend':             return 'Contend'
    case 'makePlayoffs':        return 'Make Playoffs'
    case 'competeRespectably':  return 'Compete Respectably'
    case 'developYouth':        return 'Develop Youth'
    case 'rebuild':             return 'Rebuild'
    case 'cutCosts':            return 'Cut Costs'
    default:                    return m
  }
}

function rankColor(current: number, target: number): string {
  if (current <= target) return 'var(--green)'
  if (current <= target + 3) return 'var(--amber)'
  return 'var(--red)'
}

function statusColor(board: BoardView): string {
  if (board.fired) return 'var(--red)'
  if (board.confidence >= 80) return 'var(--green)'
  if (board.confidence >= 40) return 'var(--violet-h)'
  if (board.confidence >= 25) return 'var(--amber)'
  return 'var(--red)'
}

function mandateBullets(mandate: string, targetRank: number): string[] {
  switch (mandate) {
    case 'cupOrBust':
      return [
        'Win the championship — nothing else is acceptable.',
        'A playoff exit will be viewed as a failure.',
        'The owner expects the roster to be built to win now.',
      ]
    case 'contend':
      return [
        `Finish around ${ordinal(targetRank)} or better in the league.`,
        'Qualify for the playoffs — missing out is a major setback.',
        'The board wants to see the team competing on nights that matter.',
      ]
    case 'makePlayoffs':
      return [
        'Qualify for the post-season.',
        `A ${ordinal(targetRank)}-place finish or better is the target.`,
        'Early playoff exits are acceptable as long as we qualify.',
      ]
    case 'competeRespectably':
      return [
        `Aim for a ${ordinal(targetRank)}-place finish — within ±4 ranks is fine.`,
        'Keep the fanbase engaged with competitive hockey.',
        'Budget discipline matters as much as results.',
      ]
    case 'developYouth':
      return [
        'Give meaningful ice time to young players.',
        'Wins are secondary to player development.',
        'The board will judge by the growth of prospects.',
      ]
    case 'rebuild':
      return [
        'This is a full rebuild — losing is expected.',
        'Develop prospects and accumulate draft capital.',
        'Do not sacrifice the future for short-term results.',
      ]
    case 'cutCosts':
      return [
        'Keep payroll lean and within the owner\'s budget.',
        'Results are secondary to financial responsibility.',
        'Avoid large, long-term contracts.',
      ]
    default:
      return []
  }
}
