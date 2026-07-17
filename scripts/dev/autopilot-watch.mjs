#!/usr/bin/env node
/**
 * Live "war room" for the autopilot — pretty-prints the decision/issue/season
 * stream as it plays. Run a campaign in one terminal, this in another:
 *
 *   npm run autopilot:watch
 *
 * Tails docs/autopilot/trace-live.ndjson and renders each event readably.
 */
import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs'
import { join } from 'node:path'

const FILE = join(process.cwd(), 'docs', 'autopilot', 'trace-live.ndjson')
const C = { dim: '\x1b[2m', reset: '\x1b[0m', red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', cyan: '\x1b[36m', bold: '\x1b[1m', mag: '\x1b[35m' }

function render(line) {
  let e
  try { e = JSON.parse(line) } catch { return }
  const d = e.data
  if (e.type === 'season') {
    console.log(`\n${C.bold}${C.cyan}══ SEASON ${d.year}: ${d.record ?? '?'} (${d.points ?? '?'} pts, #${d.rank ?? '?'}) → ${d.playoffResult}${d.wonCup ? ' 🏆 CUP' : ''} ══${C.reset}\n`)
    return
  }
  if (e.type === 'issue') {
    const col = d.severity === 'critical' ? C.red : d.severity === 'major' ? C.yellow : C.dim
    console.log(`${col}  ⚠ ${d.severity.toUpperCase()} [${d.category}] ${d.message}${C.reset}`)
    return
  }
  const d2 = d
  const kindCol = d2.kind === 'trade' || d2.kind === 'deadline-buy' ? C.green
    : d2.kind === 'draft' ? C.mag : d2.kind === 'interaction' ? C.cyan : C.reset
  console.log(`${C.dim}[${d2.season} d${String(d2.day).padStart(3)} ${d2.phase}]${C.reset} ${kindCol}${d2.summary}${C.reset}`)
  if (d2.drivers?.length) console.log(`${C.dim}      · ${d2.drivers.join(' · ')}${C.reset}`)
}

console.log(`${C.bold}Autopilot war room${C.reset} ${C.dim}— watching ${FILE}${C.reset}\nStart a run: ${C.cyan}AP_RUN=1 AP_SEASONS=6 npx vitest run src/engine/career/autopilot/run.harness.test.ts --no-file-parallelism${C.reset}\n`)

let pos = 0
let buf = ''
function poll() {
  if (!existsSync(FILE)) return
  const size = statSync(FILE).size
  if (size < pos) { pos = 0; buf = '' } // file was reset for a new run
  if (size === pos) return
  const fd = openSync(FILE, 'r')
  const len = size - pos
  const b = Buffer.alloc(len)
  readSync(fd, b, 0, len, pos)
  closeSync(fd)
  pos = size
  buf += b.toString('utf8')
  const parts = buf.split('\n')
  buf = parts.pop() ?? ''
  for (const line of parts) if (line.trim()) render(line)
}
setInterval(poll, 400)
poll()
