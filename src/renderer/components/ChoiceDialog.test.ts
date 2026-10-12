/**
 * Loop audit F13: gates asked their question in a native OS dialog
 * (`window.confirm`, "OK / Cancel"). The in-app ChoiceDialog replaces it.
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { askChoice, askText, useChoiceDialog } from './ChoiceDialog'

describe('askChoice', () => {
  it('resolves with the answer, and a second question cancels the first', async () => {
    const first = askChoice({ title: 'A', body: 'a', confirmLabel: 'Yes', cancelLabel: 'No' })
    const second = askChoice({ title: 'B', body: 'b', confirmLabel: 'Let the coach name him', cancelLabel: 'Pick the C myself' })
    expect(await first).toBe(false)
    expect(useChoiceDialog.getState().open?.title).toBe('B')
    useChoiceDialog.getState().answer(true)
    expect(await second).toBe(true)
    expect(useChoiceDialog.getState().open).toBeNull()
  })
})

describe('askText', () => {
  it('returns the trimmed name, or null when cancelled or blank', async () => {
    const named = askText({ title: 'Save line setup', body: 'Name it.', confirmLabel: 'Save', cancelLabel: 'Cancel' })
    useChoiceDialog.getState().answer(true, '  Road lines ')
    expect(await named).toBe('Road lines')
    const cancelled = askText({ title: 'Save line setup', body: 'Name it.', confirmLabel: 'Save', cancelLabel: 'Cancel' })
    useChoiceDialog.getState().answer(false, 'ignored')
    expect(await cancelled).toBeNull()
    const blank = askText({ title: 'Save line setup', body: 'Name it.', confirmLabel: 'Save', cancelLabel: 'Cancel' })
    useChoiceDialog.getState().answer(true, '   ')
    expect(await blank).toBeNull()
  })
})

describe('no native dialogs', () => {
  it('nothing in the renderer calls window.confirm / alert / prompt', () => {
    const root = join(__dirname, '..')
    const offenders: string[] = []
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p); continue }
        if (!/\.tsx?$/.test(name) || /\.test\.tsx?$/.test(name)) continue
        const src = readFileSync(p, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
        if (/window\.(confirm|alert|prompt)\s*\(/.test(src)) offenders.push(p)
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
