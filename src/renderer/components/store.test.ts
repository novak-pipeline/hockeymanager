import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bumpRefresh, toast, useUiStore } from './store'

beforeEach(() => {
  useUiStore.setState({ version: 0, toasts: [] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('refresh bus', () => {
  it('bump increments the version', () => {
    useUiStore.getState().bump()
    useUiStore.getState().bump()
    expect(useUiStore.getState().version).toBe(2)
  })

  it('bumpRefresh helper bumps from outside React', () => {
    bumpRefresh()
    expect(useUiStore.getState().version).toBe(1)
  })
})

describe('toasts', () => {
  it('pushToast appends with default kind info', () => {
    vi.useFakeTimers()
    useUiStore.getState().pushToast('hello')
    const toasts = useUiStore.getState().toasts
    expect(toasts).toHaveLength(1)
    expect(toasts[0]).toMatchObject({ message: 'hello', kind: 'info' })
  })

  it('toast helper pushes with an explicit kind', () => {
    vi.useFakeTimers()
    toast('boom', 'error')
    expect(useUiStore.getState().toasts[0]).toMatchObject({ message: 'boom', kind: 'error' })
  })

  it('auto-dismisses after the lifetime elapses', () => {
    vi.useFakeTimers()
    toast('temporary')
    expect(useUiStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(4_000)
    expect(useUiStore.getState().toasts).toHaveLength(0)
  })

  it('dismissToast removes only the targeted toast', () => {
    vi.useFakeTimers()
    toast('first')
    toast('second')
    const [first, second] = useUiStore.getState().toasts
    useUiStore.getState().dismissToast(first!.id)
    expect(useUiStore.getState().toasts).toEqual([second])
  })
})
